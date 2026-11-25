# ADR-0010 — One shared platform-detection module

**Status:** Accepted · **Decided:** 2026-09-18

## Context
The POST /saves route kept a private copy of platform detection that had drifted from metadataService's (spotify hostname rules differed), on a void "avoid the bundle" justification — server and workers are one process.

## Decision
`backend/src/services/platform.ts` owns the `Platform` type and `detectPlatform()` (pure, total: unparseable URL → 'other'). metadataService re-exports for back-compat; the route imports it directly.

## Consequences
Adding a platform is a one-file change; route and worker can never disagree (TC-SAVE-06). FIX-20260918-02.
