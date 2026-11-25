# ADR-0016 — App renders platform metadata through constants/platforms

**Status:** Accepted · **Decided:** 2026-09-18

## Context
The app carried three diverged copies of platform knowledge: a `Platform_` union + `PLATFORM_META` in OshiCard, a second identical `PLATFORM_META` in ContentDetailScreen, and a detect+label pair in ShareHandlerScreen. All three omitted `facebook`, which the backend emits — unguarded map indexing made any facebook save a render-crash.

## Decision
`app/src/constants/platforms.ts` owns the `Platform` type, the one `PLATFORM_META`, the total accessor `getPlatformMeta()` (unknown → 'other' badge), and `detectPlatformFromUrl` mirroring the backend detector (ADR-0010). Render code never indexes `PLATFORM_META` directly with server data.

## Consequences
Adding a platform is: backend `services/platform.ts` + app `constants/platforms.ts` — two files, both named "platform". Unknown values degrade instead of crashing (TC-LIB-09). FIX-20260918-12.
