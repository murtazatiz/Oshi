/**
 * Offline queue processor — PRD §3.1.5
 *
 * Processes URLs saved while offline. The queue lives in AsyncStorage under
 * key 'oshi_offline_queue' as a JSON array of { url, source_app, timestamp }.
 *
 * Triggers:
 *   1. App foreground (AppState 'active')
 *   2. Network reconnect (@react-native-community/netinfo)
 *
 * Shows a non-blocking banner: "X saves syncing…" while processing.
 * Clears processed items from the queue on successful API response.
 */
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

import { apiClient } from './apiClient';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OFFLINE_QUEUE_KEY = 'oshi_offline_queue';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueuedShare {
  url: string;
  source_app: string;
  timestamp: string;
}

export interface SyncResult {
  processed: number;
  failed: number;
  remaining: number;
}

export type SyncStatusListener = (status: SyncStatus) => void;

export type SyncStatus =
  | { type: 'idle' }
  | { type: 'syncing'; count: number }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Queue CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function readQueue(): Promise<QueuedShare[]> {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedShare[];
  } catch {
    return [];
  }
}

export async function writeQueue(queue: QueuedShare[]): Promise<void> {
  if (queue.length === 0) {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  } else {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  }
}

export async function enqueue(url: string, sourceApp: string): Promise<void> {
  const queue = await readQueue();
  queue.push({
    url,
    source_app: sourceApp,
    timestamp: new Date().toISOString(),
  });
  await writeQueue(queue);
}

export async function getQueueLength(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

let isProcessing = false;

export async function processQueue(): Promise<SyncResult> {
  if (isProcessing) return { processed: 0, failed: 0, remaining: 0 };

  const queue = await readQueue();
  if (queue.length === 0) return { processed: 0, failed: 0, remaining: 0 };

  isProcessing = true;
  let processed = 0;
  let failed = 0;
  const stillQueued: QueuedShare[] = [];

  for (const item of queue) {
    try {
      await apiClient.post('/saves', {
        url: item.url,
        source_app: item.source_app,
      });
      processed += 1;
    } catch {
      failed += 1;
      stillQueued.push(item);
    }
  }

  await writeQueue(stillQueued);
  isProcessing = false;

  return { processed, failed, remaining: stillQueued.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-processor — subscribes to AppState + NetInfo
//
// Call `startOfflineQueueProcessor()` once at app startup.
// Call `stopOfflineQueueProcessor()` on teardown (rarely needed).
// ─────────────────────────────────────────────────────────────────────────────

let statusListener: SyncStatusListener | null = null;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
let netInfoUnsub: (() => void) | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

function notifyStatus(status: SyncStatus): void {
  statusListener?.(status);
}

async function onTrigger(): Promise<void> {
  const queue = await readQueue();
  if (queue.length === 0) {
    notifyStatus({ type: 'idle' });
    return;
  }

  // Check connectivity before attempting
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) return;

  notifyStatus({ type: 'syncing', count: queue.length });

  try {
    const result = await processQueue();
    notifyStatus({ type: 'done', result });

    // Auto-reset to idle after 3s
    setTimeout(() => notifyStatus({ type: 'idle' }), 3_000);
  } catch {
    notifyStatus({ type: 'error', message: 'Failed to sync saves.' });
  }
}

/**
 * Sets a listener that receives sync status updates for UI rendering.
 * Only one listener is supported — calling again replaces the previous one.
 */
export function setStatusListener(listener: SyncStatusListener | null): void {
  statusListener = listener;
}

/**
 * Starts background listeners for app foreground and network reconnect.
 * Processes the offline queue automatically when either event fires.
 */
export function startOfflineQueueProcessor(): void {
  // AppState — process on foreground
  appStateSub = AppState.addEventListener('change', (nextState) => {
    if (lastAppState.match(/inactive|background/) && nextState === 'active') {
      void onTrigger();
    }
    lastAppState = nextState;
  });

  // NetInfo — process on network reconnect
  let wasConnected = true;
  netInfoUnsub = NetInfo.addEventListener((state: NetInfoState) => {
    const connected = state.isConnected ?? false;
    if (!wasConnected && connected) {
      void onTrigger();
    }
    wasConnected = connected;
  });

  // Immediate check on start
  void onTrigger();
}

/**
 * Tears down listeners. Call on app unmount (rarely needed).
 */
export function stopOfflineQueueProcessor(): void {
  appStateSub?.remove();
  appStateSub = null;
  netInfoUnsub?.();
  netInfoUnsub = null;
  statusListener = null;
}
