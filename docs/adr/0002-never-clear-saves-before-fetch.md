# ADR-0002 — Never clear the saves array before a fetch completes

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
Earlier `setActiveCategory`/`fetchSaves` called `set({ saves: [] })` before network requests → empty screens during loading.

## Decision
The visible list is only ever *replaced* after a successful fetch; `isLoading` shows a subtle indicator over existing cards.

## Consequences
Stale-but-visible beats blank. Any future loading state must respect this. TC-LIB-02 guards it.
