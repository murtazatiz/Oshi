# Oshi — Documentation

> Index of the living project documentation. Product code lives in `app/` and `backend/`;
> everything about *how the product behaves, how we test it, and why we built it this way* lives here.
>
> **Doc version:** 1.0 · **Created:** 2026-09-18 17:31 UTC · **App/Backend version at creation:** 1.0.0

---

## Contents

| Document | What it holds | Update when… |
|----------|---------------|--------------|
| [TEST_CASES.md](TEST_CASES.md) | The full regression test-case and scenario catalogue. Run the relevant sections before merging any feature; run P0s before every release. | A feature is added/changed — add its cases in the same PR. |
| [APP_BEHAVIOUR.md](APP_BEHAVIOUR.md) | Precise runtime semantics: state machines, data flows, business rules, error shapes, performance targets. | Behaviour changes, even subtly. |
| [USER_JOURNEYS.md](USER_JOURNEYS.md) | Every user journey end-to-end, with flow diagrams. | A journey is added, removed, or its steps change. |
| [FIXES_LOG.md](FIXES_LOG.md) | Dated, versioned log of every bug fix and structural fix, with root cause and verification. | Any fix lands. Append; never rewrite past entries. |
| [ARCHITECTURE_REVIEW_2026-09-18.md](ARCHITECTURE_REVIEW_2026-09-18.md) | Point-in-time architecture review (deepening candidates found, applied, deferred). Reviews are snapshots — new reviews get new dated files. | Run a new review → new dated file. |
| [adr/](adr/README.md) | Architecture Decision Records — one numbered file per decision. | A decision is made or reversed (reversal = new ADR superseding the old). |

Related documents at the repo root (these predate `docs/` and remain authoritative for their scopes):

- `PRODUCT_REQUIREMENTS.md` — the PRD; business rules source of truth.
- `API_CONTRACT.md` — request/response shapes for every endpoint.
- `TECHNICAL_ARCHITECTURE.md` — infrastructure and system design.
- `context.md` — project-wide context for developers and AI assistants. Its §7 "Key Architectural Decisions" predates the ADR log; **from 2026-09-18 onward `docs/adr/` is the canonical decision record.**
- `CLAUDE.md` — AI-assistant working guidance (commands, conventions, gotchas).

## Conventions

**Dating & timing.** Every document carries a `Created` and `Last updated` timestamp in UTC (`YYYY-MM-DD HH:MM UTC`). Log-style documents (FIXES_LOG, ADRs) date every entry individually.

**Versioning.** Documents carry a `Doc version` (major.minor): bump minor for additions/corrections, major for restructures. Point-in-time documents (architecture reviews) are never edited after the fact — supersede them with a new dated file. Each doc's version history table sits at the bottom of the doc.

**Test-case IDs** are stable and never reused: `TC-<AREA>-<NN>` (e.g. `TC-SAVE-03`). A retired case keeps its ID with status *Retired* so old run records stay interpretable.

**ADR numbering** is sequential (`0001-…`), status one of `Accepted`, `Superseded by NNNN`, `Rejected`.

**Quality gate.** There is still no automated test framework (see ADR-0015). The de-facto gate is `tsc --noEmit` in each package plus the manual P0 cases in TEST_CASES.md.

---

| Doc version | Date (UTC) | Change |
|-------------|------------|--------|
| 1.0 | 2026-09-18 17:31 | Initial documentation suite created. |
