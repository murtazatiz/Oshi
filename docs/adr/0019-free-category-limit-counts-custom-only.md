# ADR-0019 — The free-tier category limit counts custom categories only

**Status:** Accepted (pending product confirmation of PRD wording) · **Decided:** 2026-11-23

## Context
PRD §8.1 says free users get "3 active categories maximum", but §3.2.1 seeds 11 default categories for every user and §8.2 promises Pro "unlimited **custom** categories". Read literally, §8.1 can never be satisfied: every user starts at 11. The code took the literal reading (`count(all) >= 3`), so no free user could ever create a category. `CLAUDE.md` and `context.md` already stated the rule as "3 custom categories".

## Decision
Free users may create **3 custom categories** on top of the 11 defaults. All seeded categories carry `is_system_default = true` (the PRD §5 schema's stated purpose for that column); the limit counts rows with `is_system_default = false`, both in `POST /categories` and in the Settings gate.

## Consequences
A user who deletes default categories doesn't gain custom slots. That's deliberate: slots are for categories you create. Pre-2026-11-23 dev accounts need the backfill in FIXES_LOG FIX-20261123-02. If product meant a total cap, supersede this ADR and also reduce the seeded set, since a total cap below 11 contradicts seeding 11. TC-CAT-01.
