# ADR-0011 — aiService owns categorisation semantics end-to-end

**Status:** Accepted · **Decided:** 2026-09-18

## Context
parseAiResponse validated the category *name* inside aiService, but the worker re-implemented name→id resolution (case-insensitive + "Other" fallback) inline — the rule leaked across the seam, and parsing rules were untestable without a live OpenAI call.

## Decision
aiService exports `resolveCategoryId()` (the only name→id mapping) and `parseAiResponse()` (the parsing test surface). Callers never re-implement matching.

## Consequences
Categorisation rules change in one module (TC-AI-03/04). FIX-20260918-07.
