# ADR-0014 — Navigation param lists are type aliases, not interfaces

**Status:** Accepted · **Decided:** 2026-09-18

## Context
React Navigation v7's `ParamListBase` constraint requires an implicit index signature. TypeScript grants one to object type aliases but never to interfaces — declaring param lists as `interface` produced ~24 cascade errors and killed the type gate.

## Decision
All `*ParamList` shapes in `app/src/navigation/types.ts` are `type` aliases. A comment in the file records why.

## Consequences
Do not "clean up" these to interfaces; the gate (TC-GATE-01) breaks. FIX-20260918-03.
