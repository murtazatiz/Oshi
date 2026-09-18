# ADR-0007 — Auth tokens live in SecureStore only

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
Zustand persist + AsyncStorage is the convenient default, but AsyncStorage is unencrypted.

## Decision
The Supabase session lives in Expo SecureStore (key `oshi_session`) via a custom storage adapter. Zustand persist is for non-sensitive UI prefs only. The client holds the anon key; the service-role key is server-side only. The JWT is mirrored to the iOS App Group solely for the share extension and cleared on sign-out.

## Consequences
TC-SEC-05 enforces it. Any new storage of credentials must go through SecureStore.
