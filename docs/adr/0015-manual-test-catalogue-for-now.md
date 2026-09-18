# ADR-0015 — Manual test catalogue instead of a test framework, for now

**Status:** Accepted · **Decided:** 2026-09-18

## Context
The repo has no test framework; the only automated gate is `tsc --noEmit`. Retrofitting Jest/Vitest across an Expo app + Express backend is real work, and most historical bugs here were integration-shaped (cache invalidation, endpoint mismatches, queue races) that unit scaffolding would not have caught cheaply.

## Decision
Regressions are guarded by `docs/TEST_CASES.md` (64 structured manual cases, P0/P1/P2) run per-area before merges and P0-wide before releases, plus the strict typecheck in both packages. Seams were prepared for future automation (parseAiResponse/resolveCategoryId exported; detectPlatform pure) so unit tests can land at module interfaces when a framework arrives.

## Consequences
Test discipline is procedural until then; adding a framework should start at the exported pure seams and supersede this ADR.
