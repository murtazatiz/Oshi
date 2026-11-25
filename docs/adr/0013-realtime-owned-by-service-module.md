# ADR-0013 — Realtime subscription owned by services/realtime.ts

**Status:** Accepted · **Decided:** 2026-09-18

## Context
The app-global Supabase channel lived inside HomeScreen (ref + teardown + row merging), contradicting API contract §8's service seam.

## Decision
`services/realtime.ts` owns the channel as a module singleton behind `subscribeToSaveUpdates`/`unsubscribeFromSaveUpdates`, routing rows into savesStore — the same module-owned-side-effect pattern as offlineQueue.

## Consequences
Screens hold no realtime infrastructure; auth-scoped resubscription has one home. FIX-20260918-06, TC-AI-05.
