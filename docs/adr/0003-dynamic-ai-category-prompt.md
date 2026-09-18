# ADR-0003 — AI category prompt built from the user's live categories

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
The PRD hardcoded 11 category names in the OpenAI system prompt, but users rename/add categories.

## Decision
`aiService.buildSystemPrompt` injects the user's actual category names (PRD defaults only as fallback); "Other" is always present; `confidence_score < 0.5` forces "Other".

## Consequences
Renames take effect immediately (TC-CAT-02); the worker must fetch categories per job — acceptable cost. See ADR-0011 for the ownership boundary.
