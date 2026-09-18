# Architecture Decision Records

> One numbered file per decision. Statuses: **Accepted** · **Superseded by NNNN** · **Rejected**.
> Reversing a decision = a new ADR that supersedes the old one; never edit history.
> ADRs 0001–0008 are recorded retroactively (2026-09-18) from decisions made during initial build (≈2026-06); they are canonical from that date. `context.md` §7 is the historical narrative they came from.
>
> Architecture reviews (`docs/ARCHITECTURE_REVIEW_*.md`) must not re-litigate Accepted ADRs unless the friction is real enough to reopen one — say so explicitly in the review.

| ADR | Title | Status | Decided |
|-----|-------|--------|---------|
| [0001](0001-fetch-all-client-side-filtering.md) | Fetch-all + client-side filtering for the Library | Accepted | ~2026-06 |
| [0002](0002-never-clear-saves-before-fetch.md) | Never clear the saves array before a fetch completes | Accepted | ~2026-06 |
| [0003](0003-dynamic-ai-category-prompt.md) | AI category prompt built from the user's live categories | Accepted | ~2026-06 |
| [0004](0004-async-ai-processing-via-bullmq.md) | AI processing is async via BullMQ, never in-request | Accepted | ~2026-06 |
| [0005](0005-platform-detection-before-web-fallback.md) | Explicit platform detection before the generic web fallback | Accepted | ~2026-06 |
| [0006](0006-import-tab-replaces-search-tab.md) | Middle tab is Import; search lives inline in the Library | Accepted | ~2026-06 |
| [0007](0007-auth-tokens-in-securestore-only.md) | Auth tokens live in SecureStore only | Accepted | ~2026-06 |
| [0008](0008-onboarding-gate-separate-from-session.md) | Onboarding completion gates Main separately from the session | Accepted | ~2026-06 |
| [0009](0009-single-owner-offline-queue.md) | offlineQueue.ts is the sole owner of the offline queue | Accepted | 2026-06-09 |
| [0010](0010-single-platform-detection-module.md) | One shared platform-detection module | Accepted | 2026-09-18 |
| [0011](0011-aiservice-owns-categorisation.md) | aiService owns categorisation semantics end-to-end | Accepted | 2026-09-18 |
| [0012](0012-derive-once-saves-store.md) | savesStore derives the visible list through one helper | Accepted | 2026-09-18 |
| [0013](0013-realtime-owned-by-service-module.md) | Realtime subscription owned by services/realtime.ts | Accepted | 2026-09-18 |
| [0014](0014-param-lists-as-type-aliases.md) | Navigation param lists are type aliases, not interfaces | Accepted | 2026-09-18 |
| [0015](0015-manual-test-catalogue-for-now.md) | Manual test catalogue instead of a test framework, for now | Accepted | 2026-09-18 |
| [0016](0016-app-platform-constants-module.md) | App renders platform metadata through constants/platforms | Accepted | 2026-09-18 |
| [0017](0017-authstore-single-session-source.md) | authStore is the single source of session truth | Accepted | 2026-09-18 |

**Doc version:** 1.0 · **Created:** 2026-09-18 17:34 UTC
