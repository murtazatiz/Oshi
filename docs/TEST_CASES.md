# Oshi — Regression Test Cases & Scenarios

> The regression catalogue. **Before merging any feature, run the sections it touches; before any release, run every P0.**
> When you add a feature, add its cases here in the same PR — a feature without cases is untested by definition.
>
> **Doc version:** 1.0 · **Created:** 2026-09-18 17:33 UTC · **Last updated:** 2026-09-18 17:33 UTC · **App/Backend:** 1.0.0

## How to run

There is no automated test framework yet (ADR-0015) — these are structured manual cases, split by **Type**:

- **[gate]** — run in a terminal, no environment needed beyond `npm install`.
- **[api]** — run with `curl` against a dev backend (`cd backend && npm run dev`, needs `.env` with Supabase/Redis/OpenAI). Get a JWT by signing in through the app or Supabase dashboard, then:
  `export T="Bearer <jwt>"; export API=http://localhost:3000/api/v1`
- **[app]** — run in the app (Expo dev client / simulator).
- **[e2e]** — app + backend + external service together.

**Priorities:** P0 = release-blocking core path · P1 = important, run before feature merges in the area · P2 = edge/rare.

**Recording runs:** copy the section table into the PR description or a dated file `docs/test-runs/RUN_YYYY-MM-DD.md`, mark ✅/❌/⏭, link failures to FIXES_LOG entries.

Status legend for cases themselves: *Active* unless marked **Retired** (IDs are never reused).

---

## 0 · Quality gate

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-GATE-01 | P0 | gate | Both packages typecheck | `cd backend && npm run lint` · `cd app && npx tsc --noEmit` | Both exit 0 with zero errors. This gate was restored on 2026-09-18 (FIX-20260918-03) — treat any new error as a regression, not baseline. |

## 1 · Auth & onboarding

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-AUTH-01 | P0 | e2e | Signup seeds account | Complete onboarding through account creation with a fresh email | Session created; `GET /users/me` shows `subscription_status: "trial"`, `trial_started_at` set; `GET /categories` returns exactly the 11 **PRD §3.2.1** defaults: Learning, Business, Travel, Food, Fitness, Entertainment, Shopping, Inspiration, Tech, People, Other (seeding previously used non-PRD names — FIX-20260918-15) |
| TC-AUTH-02 | P0 | app | Onboarding gate | Create account (step 5 of 9), kill the app, reopen | App resumes **onboarding**, not the Library — Main requires session AND onboarding-complete (ADR-0008) |
| TC-AUTH-03 | P0 | e2e | Password reset loop | Request reset from Login → open email link `oshi://auth/reset?token=…` → set new password | `POST /auth/reset-password {email}` → 200 (even for unknown email); deep link opens the reset screen; `POST /auth/update-password {token,new_password}` → 200; new password signs in, old doesn't. **Regression guard for FIX-20260918-11** (this flow used to 422/404 end-to-end) |
| TC-AUTH-07 | P1 | api | Signin error code | `POST /auth/signin` with a wrong password | `401` with `code: "INVALID_CREDENTIALS"` per contract §2 (was `UNAUTHORISED` — FIX-20260918-16); message doesn't reveal whether the email exists |
| TC-AUTH-04 | P1 | app | Sign out hygiene | Sign out from Settings | Returned to Auth stack; SecureStore session cleared; iOS App Group JWT cleared (share extension now queues offline instead of posting) |
| TC-AUTH-05 | P0 | app | Session restore + silent refresh | Reopen app with a stored (possibly expired) session | Library loads without a login prompt; on 401 the apiClient refreshes once and retries; if refresh fails, user is signed out cleanly |
| TC-AUTH-06 | P2 | e2e | Account deletion | Settings → delete account → confirm | `DELETE /users/me` soft-deletes (30-day window), user is signed out; sign-in with the deleted account does not restore the library UI |

## 2 · Saving content

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-SAVE-01 | P0 | api | Create save | `curl -X POST $API/saves -H "Authorization: $T" -H 'Content-Type: application/json' -d '{"url":"https://youtube.com/watch?v=abc"}'` | `201` in <300ms; body has `id`, `processing_status:"pending"`, `status:"unread"`, `platform:"youtube"`, `tags:[]`, category = user's "Other"; snake_case keys; no `null`-valued optional keys |
| TC-SAVE-02 | P0 | api | Duplicate URL | POST the same URL twice | Second call → `200` with the existing save + `"duplicate": true`; no new row; monthly counter NOT incremented twice |
| TC-SAVE-03 | P0 | api | Free-tier monthly limit | As a `free` user with `items_saved_this_month = 20`, POST a new URL | Typed error `SAVE_LIMIT_REACHED` (no row created); app shows paywall. As `trial`/`pro`: save succeeds |
| TC-SAVE-04 | P1 | api | Limit increments atomically | POST a save; read `items_saved_this_month` before/after | Exactly +1, and the save row exists — both or neither (single `$transaction`) |
| TC-SAVE-05 | P1 | api | Invalid body | POST `{"url":"not-a-url"}` and `{}` | `VALIDATION_ERROR` envelope `{error:{code,message,statusCode}}`; no row |
| TC-SAVE-06 | P1 | api | Platform detection matrix | POST URLs: `youtu.be/x`, `instagram.com/reel/x`, `tiktok.com/@u/video/1`, `x.com/u/status/1`, `linkedin.com/posts/x`, `fb.watch/x`, `spotify.com/track/x` **and** `open.spotify.com/track/x`, `example.com/article` | `platform` = youtube, instagram, tiktok, twitter, linkedin, facebook, **spotify (both)**, web. Both spotify hosts must agree — the route and worker share one detector (FIX-20260918-02) |
| TC-SAVE-07 | P1 | app | Manual Save URL modal | Open SaveUrl modal, paste a URL, save | Card appears at top instantly (optimistic `addSaveToTop`), category tab badge bumps, then AI fills it in |

## 3 · AI pipeline

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-AI-01 | P0 | e2e | Happy path | Save a rich URL (e.g. a YouTube cooking video); watch the card | pending → processing → complete; category sensible (e.g. Food), summary ≤120 chars, ≤3 tags, thumbnail, `ai_confidence_score` in [0,1]; free p95 ≤30s, pro ≤5s |
| TC-AI-02 | P0 | e2e | Failure & retry | Save an unreachable URL (or run with OpenAI key removed) | Card lands in Failed state, keeping any fetched title/thumbnail. Tap Retry → `POST /saves/:id/retry` → Processing again. Retrying a non-failed save → `422` |
| TC-AI-03 | P1 | api | Low confidence → Other | Feed `parseAiResponse` (exported, `backend/src/services/aiService.ts`) a JSON string with `confidence_score: 0.3, category: "Travel"` and valid names `["Travel","Other"]` | Returned category is `"Other"`. Also: markdown-fenced JSON is stripped; unknown `content_type` → `"other"`; >3 tags truncated; confidence clamped to [0,1] |
| TC-AI-04 | P1 | api | Category deleted mid-processing | `resolveCategoryId("Travel", categories-without-Travel-but-with-Other)` | Returns the "Other" id; with no "Other" either → `null`. Case-insensitive: `"travel"` matches `"Travel"` |
| TC-AI-05 | P0 | e2e | Realtime card update | Two devices (or device + DB console): complete processing for a save | Card updates **without any refresh** via the `saves-updates` channel; category tab counts refresh when processing completes or category changes |

## 4 · Library (Home screen)

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-LIB-01 | P0 | app | Fetch-all model | Cold-open the Library with a seeded account; observe network | Exactly one `GET /saves?sort=…&limit=500` (no `category_id` param); tab switches, search, chips cause **zero** further GETs |
| TC-LIB-02 | P0 | app | Category tabs | Switch tabs rapidly | Instant filtering; the list is **never blanked** while data exists (ADR-0002); counts per tab match visible cards |
| TC-LIB-03 | P1 | app | Search fields | Search a term that appears only in a tag; only in a creator name; only in the URL | All three match (title/creator/summary/tags/URL), case-insensitive, debounced ~300ms |
| TC-LIB-04 | P1 | app | Chips independence | Select only platform chips → then only status chips → then both | Platform-only filters any status; status-only filters any platform; both = AND. Clear-all resets chips UI and store together |
| TC-LIB-05 | P1 | api | Server search parity | `GET $API/saves?search=foo` | OR-match across title/summary/user_note/creator_name (one shared clause on both sort paths); works combined with `status`/`category_id` |
| TC-LIB-06 | P1 | app | Sorts | Cycle all 5 sorts | recent=newest-first; oldest inverse; shortest ascending with nulls last; manual honours custom order, nulls fall back to recency; selection survives app restart (AsyncStorage) |
| TC-LIB-07 | P1 | app | Filters during slow fetch | Throttle network; trigger refresh; switch category mid-request | When the response lands, the visible list reflects the category selected **now** — no stale-filter mix (FIX-20260918-04) |
| TC-LIB-08 | P2 | app | Pull-to-refresh vs header refresh | Use both | Pull shows the RefreshControl (isRefreshing), header button spins; existing cards remain visible throughout |
| TC-LIB-09 | P0 | app | Facebook save renders | Save an `fb.watch`/`facebook.com` URL; view it in grid, list, and detail | Card and detail render the Facebook badge (📘) — no crash. Unknown/future platform values degrade to the generic Link badge via `getPlatformMeta`. **Regression guard for FIX-20260918-12** |

## 5 · Smart sort & cache

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-SORT-01 | P1 | api | Ranking cache | `GET /saves?sort=ai_recommended` twice within an hour | Second call served from the (user × category) Redis cache — same order, faster |
| TC-SORT-02 | P1 | e2e | Invalidate on new save | Cached order → POST a save → GET again | Order recomputed (cache invalidated for "all" + the save's category) |
| TC-SORT-03 | P1 | e2e | Invalidate on status/category change | Cached order → PATCH a save to done, and separately move one across categories | Recomputed; on category move BOTH old and new category caches invalidate |
| TC-SORT-04 | P0 | e2e | Invalidate on delete | Cached order → DELETE a save → `GET /saves?sort=ai_recommended` immediately | Fresh ranking without the deleted id; `total_count` correct; full pages (no shrunken page from a stale cached order). **Regression guard for FIX-20260918-01** |
| TC-SORT-05 | P1 | e2e | Invalidate after AI classification | Warm the cache while a save is processing → let classification move it from "Other" to its real category → GET again | Fresh ranking reflecting the new category (both "Other" and the destination category caches cleared). **Regression guard for FIX-20260918-14** |

## 6 · Save actions & undo

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-ACT-01 | P0 | e2e | Done / Skip semantics | Mark done; mark another skipped; revert each to unread (via undo or detail) | done sets `done_at` + clears `skipped_at`; skip inverse; revert clears **both**; engagement signals `done`/`skipped` recorded; done also evicts the cached thumbnail |
| TC-ACT-02 | P1 | api | PATCH validation | PATCH someone-else's save id; PATCH with a category_id not owned; PATCH garbage body | 404 (not 403) for both not-mine cases; `VALIDATION_ERROR` for garbage; ownership check is one query that also feeds cache invalidation |
| TC-ACT-03 | P0 | e2e | Delete + undo | Swipe-delete a card; hit Undo within 5s | Card vanishes instantly, undo toast with progress bar; undo calls `POST /saves/:id/restore` → the row's `deleted_at` clears and the card stays back with its pre-delete status/timestamps intact; letting the toast expire leaves the soft-delete in place. **Regression guard for FIX-20260918-13** (undo used to re-vanish the card) |
| TC-ACT-04 | P0 | app | Optimistic rollback | Kill the backend (or airplane-mode after load); mark a card done | Card flips instantly, then **rolls back** when the PATCH fails; no crash, no stuck state |
| TC-ACT-05 | P1 | app | Bulk done/skip/delete | Long-press → select 3+ across categories → each bulk action | All selected update optimistically; multi-select exits; counts refresh; per-item failures don't block the rest (`Promise.allSettled`) |
| TC-ACT-06 | P1 | app | Bulk move category | Multi-select → move to another category | Cards re-badge; they appear under the target tab; counts on both tabs update |
| TC-ACT-07 | P1 | app | Single-save edit category | Kebab → Edit category → pick one | That save moves (PATCH with `category_id`), detail + list reflect it, counts refresh |

## 7 · Categories

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-CAT-01 | P0 | e2e | Free custom-category limit | As free, create 3 custom categories, then a 4th | First three succeed; 4th → typed limit error → paywall. Trial/pro unlimited |
| TC-CAT-02 | P1 | e2e | Rename feeds the AI | Rename "Tech" → "Gadgets", save a tech article | AI prompt uses live names: the save lands in "Gadgets" (dynamic prompt, ADR-0003) |
| TC-CAT-03 | P0 | api | Delete moves saves to Other | Delete a category holding saves | `DELETE /categories/:id` succeeds; its saves now carry the "Other" category; nothing deleted |
| TC-CAT-04 | P2 | api | Counts | `GET /categories` after mixed statuses | Each category's `unread_count`/`total_count` match reality; deleted saves excluded |
| TC-CAT-05 | P1 | api | Formatter contract | `PATCH /categories/:id` (rename) on a populated category; inspect any category payload | PATCH response carries **real** unread/total counts (was hardcoded 0/0 — FIX-20260918-19); every category payload includes `slug` (lowercase-hyphenated name); `reminder_override_time` is **omitted** when null, never `null` |

## 8 · Import

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-IMP-01 | P1 | app | Paste URLs | Paste 5 URLs (1 duplicate, 1 junk line) into Import → Paste | Live detection shows 4 valid; sequential POSTs with progress; result = 3 imported, 1 skipped-duplicate; junk ignored |
| TC-IMP-02 | P1 | app | Bookmarks HTML | Pick an exported bookmarks `.html` | File is readable (needs `copyToCacheDirectory` — FIX-20260918-03 №3); links parsed with checkboxes; batch import respects selection |
| TC-IMP-03 | P2 | e2e | Import hits the limit | Free user at 18/20 imports 5 URLs | 2 succeed, then limit error surfaces mid-batch with a clear count + paywall path; no partial-row corruption |

## 9 · Offline queue

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-OFF-01 | P0 | app | Enqueue offline | Airplane mode → share/save 2 URLs | Both queued (`getQueueLength`=2); banner "2 saves queued"; nothing POSTed |
| TC-OFF-02 | P0 | app | Flush on reconnect/foreground | Restore network / background+foreground the app | One flush runs: both URLs POSTed once, queue empties, banner shows synced then idle |
| TC-OFF-03 | P0 | app | No double-flush | Trigger foreground + reconnect near-simultaneously with a seeded queue | Each URL posted **exactly once** (`isProcessing` guard, single owner — ADR-0009 / FIX-20260609-01); server shows no duplicates |
| TC-OFF-04 | P1 | app | iOS App Group drain | Save via share extension while the main app is killed & offline; then open the app online | App-Group pending shares drain into the offline queue, then flush; failed items are re-queued for the next attempt |

## 10 · Notifications & reminders

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-NOTIF-01 | P0 | e2e | Reminder fires on schedule | Set `reminder_time` to 2 minutes from now (UTC-aware), have ≥1 unread, don't open the app | Push arrives that minute, personalised with the biggest unread category |
| TC-NOTIF-02 | P1 | e2e | Skip rules | (a) zero unread; (b) app opened <2h before reminder time | No push in either case |
| TC-NOTIF-03 | P0 | e2e | Notification deep link selects the tab | Tap the reminder push (e.g. `oshi://library/business`) | App opens the Library **with the Business tab selected** (slug matched against category names; `GET /categories` payloads now carry `slug`); open logged via `/notifications/log-open`. **Regression guard for FIX-20260918-17** (the slug used to be dropped) |
| TC-NOTIF-04 | P2 | e2e | Monthly reset | On the 1st (UTC) or by manually running the cron | Every user's `items_saved_this_month` = 0; free users can save again |

## 11 · Subscription & paywall

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-SUB-01 | P0 | app | Paywall triggers | Hit save limit; hit category limit; touch a Pro feature | Paywall modal each time, with the correct trigger copy |
| TC-SUB-02 | P0 | api | Webhook auth | POST `/subscriptions/webhook` without / with wrong / with correct `REVENUECAT_WEBHOOK_AUTH_HEADER` | Unauthorized rejected; correct secret updates `subscription_status` per event |
| TC-SUB-03 | P1 | e2e | Upgrade unlocks | Complete a (sandbox) purchase | Status → pro; saves beyond 20 succeed; new AI jobs route to the priority queue (observe faster completion) |
| TC-SUB-04 | P1 | e2e | Downgrade preserves | Expire/cancel to free with >20 saves and >3 categories | Everything remains visible/usable; only **new** saves/categories beyond limits are blocked |

## 12 · Engagement & streaks

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-ENG-01 | P1 | api | Signals recorded | Open, skip, done a save; `POST /engagement/signal` each | Rows in `user_engagement_signals` with correct action + save; smart sort shifts accordingly over time |
| TC-ENG-02 | P2 | app | Streak hard reset | Active two days, skip a day, return | Streak was 2, resets to 1 on return (no freeze — post-v1); milestone overlay fires at thresholds |

## 13 · Security & API conventions

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-SEC-01 | P0 | api | Auth required | Call any protected endpoint with no/garbage token | 401 envelope; `/health` alone works unauthenticated |
| TC-SEC-02 | P0 | api | User scoping | With user A's token, GET/PATCH/DELETE user B's save id | **404** each time (no existence leak, no 403) |
| TC-SEC-03 | P1 | api | Response conventions | Inspect any save/category payload | snake_case keys; null optionals omitted; `tags` always an array; timestamps ISO-8601 |
| TC-SEC-04 | P1 | api | Rate limiting | Hammer `POST /saves` >60/min | 429 from `savesLimiter`; global limiter guards the rest |
| TC-SEC-05 | P0 | app | Secret hygiene | Grep the app bundle/env usage | Only `EXPO_PUBLIC_*` + anon key on the client; service-role key server-side only; JWT in SecureStore, never AsyncStorage |

## 14 · Deep links

| ID | P | Type | Case | Steps | Expected |
|----|---|------|------|-------|----------|
| TC-DEEP-01 | P1 | app | Full matrix | Open each: `oshi://library`, `oshi://library/food`, `oshi://save/<id>`, `oshi://settings/reminders`, `oshi://settings/subscription`, `oshi://notifications/enable` | Library home · Food tab · ContentDetail modal · Reminders · Subscription · OS notification settings (intercepted). Unauthenticated → Auth stack first, no crash |

---

## Coverage map

| Area | Cases | Journeys |
|------|-------|----------|
| Gate 0 | TC-GATE-01 | all |
| Auth 1 | 7 | J1, J12, J13 |
| Saves 2 | 7 | J2 |
| AI 3 | 5 | J2, J10 |
| Library 4 | 9 | J5 |
| Smart sort 5 | 5 | J5 |
| Actions 6 | 7 | J5, J6 |
| Categories 7 | 5 | J8 |
| Import 8 | 3 | J7 |
| Offline 9 | 4 | J3 |
| Notifications 10 | 4 | J4 |
| Subscription 11 | 4 | J9 |
| Engagement 12 | 2 | J11 |
| Security 13 | 5 | — |
| Deep links 14 | 1 | J4, J12 |

**Total: 68 cases (P0: 24 · P1: 33 · P2: 11 — plus the gate).**

> ⚠ Known-blocked areas (see the architecture review's backlog): TC-SUB-01's paywall triggers are currently **unwired** in the app (PaywallScreen unreachable) — expect this case to fail until the paywall wiring lands; run it to confirm the gap, not to pass it.

---

| Doc version | Date (UTC) | Change |
|-------------|------------|--------|
| 1.0 | 2026-09-18 17:33 | Initial catalogue: 64 cases across 15 areas. |
| 1.1 | 2026-09-18 18:30 | +4 regression cases for the wave-2 fixes (AUTH-07, LIB-09, SORT-05, CAT-05); AUTH-01/03, ACT-03, NOTIF-03 sharpened; paywall known-blocked note. |
