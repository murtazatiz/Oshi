# ADR-0001 — Fetch-all + client-side filtering for the Library

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
Per-category API calls with TTL caches (`lastFetchedAt`, `isCategoryFresh`) caused blank screens on tab switches, stale data, and cache-invalidation bugs.

## Decision
`GET /saves?limit=500` with no category param fetches everything into `allSaves`; category tabs, search, and chips filter in memory. The API is called only on load, refresh, new save, and sort change. Category counts derive from `allSaves`.

## Consequences
Instant tab switching, no cache bugs; acceptable for libraries <500 saves. Revisit (server pagination per view) only if users routinely exceed the limit. See APP_BEHAVIOUR §3, TC-LIB-01.
