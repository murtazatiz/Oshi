/**
 * Share Extension service — bridges the native iOS Share Extension with the
 * React Native main app.
 *
 * PRD §3.1.3 / §3.1.5:
 *   - Reads pending shares from App Group UserDefaults
 *   - Syncs JWT and API base URL to App Group for the extension to use
 *   - Checks for pending shares on app foreground
 *
 * Offline queue ownership: offlineQueue.ts owns oshi_offline_queue exclusively.
 * This module drains the App Group queue into offlineQueue, then delegates
 * the actual flush to offlineQueue.processQueue() (which has isProcessing guard).
 *
 * App Group: group.com.oshi.app
 * UserDefaults keys:
 *   - oshi_pending_share   → JSON array of queued { url, source_app, timestamp }
 *   - oshi_shared_session  → JWT access token for the extension
 *   - oshi_api_base_url    → API base URL for the extension
 */
import { NativeModules, Platform } from 'react-native';

import { supabase } from './supabase';
import {
  enqueue,
  processQueue,
  getQueueLength,
  type SyncResult,
} from './offlineQueue';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const APP_GROUP = 'group.com.oshi.app';
const PENDING_SHARE_KEY = 'oshi_pending_share';
const SESSION_KEY = 'oshi_shared_session';
const API_BASE_KEY = 'oshi_api_base_url';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

// ─────────────────────────────────────────────────────────────────────────────
// App Group UserDefaults bridge
//
// On iOS, we use the SharedGroupPreferences native module to read/write the
// App Group UserDefaults. When the module is unavailable (Android / Expo Go),
// operations are no-ops.
// ─────────────────────────────────────────────────────────────────────────────

interface SharedGroupPreferencesModule {
  getItem: (key: string, group: string) => Promise<string | null>;
  setItem: (key: string, value: string, group: string) => Promise<void>;
  removeItem: (key: string, group: string) => Promise<void>;
}

function getSharedPrefs(): SharedGroupPreferencesModule | null {
  if (Platform.OS !== 'ios') return null;
  // react-native-shared-group-preferences or similar native module
  const mod = NativeModules.SharedGroupPreferences as
    | SharedGroupPreferencesModule
    | undefined;
  return mod ?? null;
}

async function readAppGroup(key: string): Promise<string | null> {
  const prefs = getSharedPrefs();
  if (!prefs) return null;
  try {
    return await prefs.getItem(key, APP_GROUP);
  } catch {
    return null;
  }
}

async function writeAppGroup(key: string, value: string): Promise<void> {
  const prefs = getSharedPrefs();
  if (!prefs) return;
  try {
    await prefs.setItem(key, value, APP_GROUP);
  } catch {
    // Silently fail — extension may just not get the value
  }
}

async function removeAppGroup(key: string): Promise<void> {
  const prefs = getSharedPrefs();
  if (!prefs) return;
  try {
    await prefs.removeItem(key, APP_GROUP);
  } catch {
    // Silently fail
  }
}

// Re-export so callers don't need to know which module owns the sync result type.
export type { SyncResult as ShareProcessResult } from './offlineQueue';

// ─────────────────────────────────────────────────────────────────────────────
// JWT Sync — keeps the extension's JWT up to date
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Syncs the current Supabase JWT and API base URL to App Group UserDefaults
 * so the Share Extension can authenticate its API calls.
 *
 * Call this:
 *   - On successful sign-in / session restore
 *   - On token refresh
 *   - On app foreground
 */
export async function syncSessionToAppGroup(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      await writeAppGroup(SESSION_KEY, token);
    } else {
      await removeAppGroup(SESSION_KEY);
    }
    await writeAppGroup(API_BASE_KEY, API_BASE_URL);
  } catch {
    // Non-fatal — extension will queue offline if it can't read the token
  }
}

/**
 * Clears the shared session from App Group (call on sign-out).
 */
export async function clearSessionFromAppGroup(): Promise<void> {
  await removeAppGroup(SESSION_KEY);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending Share Processing
// ─────────────────────────────────────────────────────────────────────────────

interface AppGroupShare {
  url: string;
  source_app: string;
  timestamp: string;
}

/**
 * Reads the pending share queue from App Group UserDefaults.
 * The native Share Extension writes to this key when it saves a URL offline.
 */
async function readPendingShares(): Promise<AppGroupShare[]> {
  const raw = await readAppGroup(PENDING_SHARE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as AppGroupShare[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Processes pending shares from both sources:
 *   1. App Group UserDefaults (written by the iOS Share Extension while offline)
 *   2. AsyncStorage offline queue (owned by offlineQueue.ts)
 *
 * App Group items are moved into the offline queue first, then
 * offlineQueue.processQueue() flushes everything (single flush, no race).
 *
 * PRD §3.1.5: show a banner "X saves queued — syncing now..." while processing.
 */
export async function processPendingShares(): Promise<SyncResult> {
  const appGroupPending = await readPendingShares();

  // Move App Group items into the offline queue (offlineQueue.ts owns the key)
  for (const share of appGroupPending) {
    await enqueue(share.url, share.source_app);
  }
  await removeAppGroup(PENDING_SHARE_KEY);

  return processQueue();
}

/**
 * Returns the count of pending shares across both sources (for badges / banners).
 */
export async function getPendingShareCount(): Promise<number> {
  const [appGroup, offlineCount] = await Promise.all([
    readPendingShares(),
    getQueueLength(),
  ]);
  return appGroup.length + offlineCount;
}
