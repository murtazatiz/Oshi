# ADR-0017 — authStore is the single source of session truth

**Status:** Accepted · **Decided:** 2026-09-18

## Context
AppNavigator's private `useAuthSession` hook ran its own `supabase.auth.getSession()` + `onAuthStateChange` listener in parallel with `authStore.initialise()`'s pair — two subscriptions holding two session states that could disagree around sign-out/refresh timing.

## Decision
`authStore` (initialised once by App.tsx's AuthInitialiser) is the only module that talks to Supabase auth state. RootNavigator selects `session`/`isInitialised` from it. No component registers its own auth listener.

## Consequences
Session transitions have one code path to debug (TC-AUTH-05). Any future auth-scoped side effect (e.g. realtime resubscription) hooks authStore, not Supabase directly. FIX-20260918-18.
