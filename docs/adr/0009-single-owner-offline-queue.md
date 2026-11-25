# ADR-0009 — offlineQueue.ts is the sole owner of the offline queue

**Status:** Accepted · **Decided:** 2026-06-09 (PR #2)

## Context
`shareExtension.ts` and `offlineQueue.ts` both read/wrote `oshi_offline_queue` with independent foreground-triggered flush loops — a race that could double-post saves.

## Decision
`offlineQueue.ts` exclusively owns the key and the flush (`isProcessing` guard). `shareExtension.ts` owns only the iOS App Group queue and drains it into `offlineQueue.enqueue()` before delegating to `processQueue()`.

## Consequences
One flush path, no double-posts (TC-OFF-03). Any new save-producing surface must enqueue via offlineQueue, never touch AsyncStorage directly. FIX-20260609-01.
