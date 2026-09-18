# ADR-0004 — AI processing is async via BullMQ, never in-request

**Status:** Accepted · **Decided:** ~2026-06 (recorded 2026-09-18)

## Context
Classification takes 2–10s; the share extension needs confirmation in <300ms.

## Decision
`POST /saves` creates a `pending` row + enqueues (`ai-processing`, Pro → `ai-processing-priority`) and returns 201 immediately. The worker does metadata + OpenAI + row update; Supabase Realtime pushes the result. No AI call ever runs inside a request handler.

## Consequences
Requires Redis and the pending/processing/complete/failed state machine on every card. API server + workers deploy as one Railway process. TC-SAVE-01, TC-AI-01.
