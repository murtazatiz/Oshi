/**
 * Share Extension service — bridges the native iOS Share Extension with the
 * React Native main app.
 *
 * PRD §3.1.3 / §3.1.5:
 *   - Reads pending shares from App Group UserDefaults
 *   - Processes queued shares via POST /saves API
 *   - Syncs JWT and API base URL to App Group for the extension to use
 *   - Checks for pending shares on app foreground
 *
 * App Group: group.com.oshi.app
 * UserDefaults keys:
 *   - oshi_pending_share   → JSON array of queued { url, source_app, timestamp }
 *   - oshi_shared_session  → JWT access token for the extension
 *   - oshi_api_base_url    → API base URL for the extension
 */
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient } from './apiClient';
import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const APP_GROUP = 'group.com.oshi.app';
const PENDING_SHARE_KEY = 'oshi_pending_share';
const SESSION_KEY = 'oshi_shared_session';
const API_BASE_KEY = 'oshi_api_base_url';
const OFFLINE_QUEUE_KEY = 'oshi_offline_queue';

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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingShare {
  url: string;
  source_app: string;
  timestamp: string;
}

export interface ShareProcessResult {
  processed: number;
  failed: number;
  queued: PendingShare[];
}

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

/**
 * Reads the pending share queue from App Group UserDefaults.
 * The native Share Extension writes to this key when it saves a URL.
 */
async function readPendingShares(): Promise<PendingShare[]> {
  const raw = await readAppGroup(PENDING_SHARE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as PendingShare[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Reads the offline queue from AsyncStorage.
 * PRD §3.1.5: URLs saved while offline are stored here by the main app.
 */
async function readOfflineQueue(): Promise<PendingShare[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingShare[];
  } catch {
    return [];
  }
}

/**
 * Processes all pending shares from both:
 *   1. App Group UserDefaults (written by the native Share Extension when offline)
 *   2. AsyncStorage offline queue (written by the main app when offline)
 *
 * Call this on:
 *   - App foreground (AppState 'active')
 *   - Network reconnection (NetInfo)
 *
 * PRD §3.1.5: show a banner "X saves queued — syncing now..." while processing.
 */
export async function processPendingShares(): Promise<ShareProcessResult> {
  const [appGroupPending, offlinePending] = await Promise.all([
    readPendingShares(),
    readOfflineQueue(),
  ]);

  const allPending = [...appGroupPending, ...offlinePending];

  if (allPending.length === 0) {
    return { processed: 0, failed: 0, queued: [] };
  }

  let processed = 0;
  let failed = 0;
  const stillQueued: PendingShare[] = [];

  for (const share of allPending) {
    try {
      await apiClient.post('/saves', {
        url: share.url,
        source_app: share.source_app,
      });
      processed += 1;
    } catch {
      failed += 1;
      stillQueued.push(share);
    }
  }

  // Clear the App Group queue (everything was attempted)
  await removeAppGroup(PENDING_SHARE_KEY);

  // Write back any failed items to AsyncStorage for the next attempt
  if (stillQueued.length > 0) {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(stillQueued));
  } else {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  }

  return { processed, failed, queued: stillQueued };
}

/**
 * Returns the count of pending shares across both queues (for badges / banners).
 */
export async function getPendingShareCount(): Promise<number> {
  const [appGroup, offline] = await Promise.all([
    readPendingShares(),
    readOfflineQueue(),
  ]);
  return appGroup.length + offline.length;
}

/**
 * Queues a URL for later processing (called when the main app detects
 * an incoming share intent but has no network).
 */
export async function queueOfflineShare(
  url: string,
  sourceApp: string,
): Promise<void> {
  const queue = await readOfflineQueue();
  queue.push({
    url,
    source_app: sourceApp,
    timestamp: new Date().toISOString(),
  });
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}
