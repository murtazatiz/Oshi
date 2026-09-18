# ADR-0012 — savesStore derives the visible list through one helper

**Status:** Accepted · **Decided:** 2026-09-18

## Context
The invariant `saves ≡ applyFilter(allSaves, filters)` was maintained by hand at ~20 call sites; markDone/markSkipped were near-clones; a slow fetch could derive with a stale-filter mix.

## Decision
`withDerivedSaves(state, newAllSaves, overrides?)` is the only path that writes `{ allSaves, saves }` (applyFilter has exactly one call site, inside it). markDone/markSkipped share the private `mutateStatus` implementation. Derivation always uses state at set-time.

## Consequences
The invariant is structural, not disciplinary. New mutations MUST go through the helper. FIX-20260918-04/05, TC-LIB-07, TC-ACT-*.
