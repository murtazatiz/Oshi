# ADR-0018 — Limit errors open the paywall from the apiClient interceptor

**Status:** Accepted · **Decided:** 2026-11-23

## Context
PRD §8.3 requires the paywall on the 21st save and the 4th custom category. Saves are created from five places (Save URL modal, Import, share sheet, iOS share extension, offline-queue flush) and categories from Settings. Having each call site detect `SAVE_LIMIT_REACHED` / `CATEGORY_LIMIT_REACHED` and navigate meant six chances to forget, and before this ADR every one of them did.

## Decision
`apiClient`'s response interceptor calls `openPaywall(trigger)` (`services/paywall.ts`) whenever a response carries a limit code, then still rejects so the caller can stop work and show its own message. `openPaywall` is the single entry point for every trigger, including non-error ones (Settings upgrade row, Pro-only toggles, trial banner). It no-ops when navigation isn't mounted (cold start, iOS share-extension context) or the paywall is already open. Background requests the user didn't just initiate pass `{ skipPaywall: true }`; today that's the offline-queue flush.

## Consequences
New save/category surfaces get the paywall automatically. Callers must still handle the rejected promise sensibly (stop a batch, close any RN `Modal` that would cover the paywall, don't queue the save as if offline). Any new background caller of a limited endpoint must pass `skipPaywall`. `navigationRef` lives in `navigation/navigationRef.ts` so services can navigate without importing the screen tree. FIX-20261123-01, TC-SUB-01/05/06.
