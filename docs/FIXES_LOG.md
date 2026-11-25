# Fixes Log

> Append-only log of bug fixes and structural fixes. Newest entries first within each dated section.
> Every entry: what was wrong → root cause → the fix → how it was verified. Past entries are never rewritten.
>
> **Doc version:** 1.0 · **Created:** 2026-09-18 17:32 UTC

Entry template:

```
### FIX-YYYYMMDD-NN — <title>
- **Area:** backend | app | repo
- **Severity:** bug | correctness-hazard | hygiene
- **Symptom:** what a user/developer would observe
- **Root cause:** …
- **Fix:** … (files touched)
- **Verified by:** … (gate run / test case ID)
- **Commit:** <sha> · **Related:** ADR-NNNN / TC-…
```

---

## 2026-11-23 (session 03:55–04:15 UTC, branch `claude/claude-md-mm3k18orohhzfkc4-Y2yiI`)

### FIX-20261123-01 — The paywall was unreachable (PRD §8.3 triggers unwired)
- **Area:** app · **Severity:** bug (monetization)
- **Symptom:** No path in the app opened `PaywallScreen`. Hitting the 20-save limit showed a raw "Request failed with status code 403" (Save URL), was miscounted as "duplicate skipped" (Import), or was silently queued as if offline (share sheet). The Settings "Upgrade to Pro" row did nothing, the trial-banner CTA led to a placeholder screen, and the Morning Digest toggle was hidden from free users.
- **Root cause:** `PaywallScreen` was registered in the navigator with zero `navigate` call sites, and no code read the backend's `SAVE_LIMIT_REACHED` / `CATEGORY_LIMIT_REACHED` codes.
- **Fix:**
  1. `app/src/services/paywall.ts` — `openPaywall(trigger)` is the single entry point (no-op before navigation mounts or when the paywall is already open, so a batch import can't stack paywalls). `navigationRef` moved to `navigation/navigationRef.ts` so services can navigate without importing the screen tree.
  2. `apiClient`'s response interceptor opens the paywall on either limit code, so no call site can forget to. Requests can opt out with `{ skipPaywall: true }`; the offline-queue flush does, so a queued over-limit save stays queued and syncs after an upgrade or the monthly reset without popping the paywall on every foreground. New `getApiError()` / `isLimitError()` read the API contract's error envelope.
  3. Call sites: Import **stops** at the first limit error and reports "N not imported — monthly save limit reached" (it previously labelled every failure a "duplicate"); the share sheet shows a limit message instead of queueing; Save URL shows the backend's message; Settings' new-category sheet closes on the limit error (an RN `Modal` renders above navigation and would hide the paywall).
  4. Triggers: Settings → Upgrade to Pro, the Morning Digest toggle for free users, the trial-banner CTA, and the new Subscription screen all call `openPaywall`.
  5. `PaywallScreen` reads its `trigger` param, shows the matching headline ("You've used all 20 saves this month", …), and sends the real trigger to PostHog `paywall_viewed` (was hardcoded `'direct'`).
  6. `SubscriptionScreen` (deep-link target of `oshi://settings/subscription` and trial-expiry pushes) replaced its placeholder with current plan, upgrade, Manage subscription (store page), and restore.
- **Verified by:** `cd app && npx tsc --noEmit` → 0 errors · TC-SUB-01, TC-SUB-05, TC-SUB-06, TC-SUB-07, TC-IMP-03.
- **Commit:** `8a45a69` · **Related:** ADR-0018.

### FIX-20261123-02 — Free users could never create a category
- **Area:** backend + app · **Severity:** bug (business rule)
- **Symptom:** On the free plan, "+ Add Category" always showed the upgrade alert and `POST /categories` always returned 403, even for a brand-new user who had created nothing.
- **Root cause:** Both the backend (`prisma.category.count({ where: { userId } }) >= 3`) and the Settings screen (`categories.length >= 3`) counted **all** categories, and every user is seeded 11 at signup. The PRD is internally inconsistent here: §8.1 says "3 active categories maximum", but §3.2.1 seeds 11 defaults and §8.2 says Pro gets "unlimited **custom** categories". `CLAUDE.md` and `context.md` already stated the rule as "3 custom categories", which is the only reading that can be satisfied.
- **Fix:** All 11 seeded categories now carry `is_system_default = true`, which is the PRD §5 schema's stated purpose for that column (seeding previously set it only on "Other"). The limit counts `is_system_default = false` rows in both the backend route and the Settings gate. The error message and API contract §4 now say "custom categories". The flag has no other behaviour anywhere in the code, so this changes nothing else.
- **Existing data:** accounts seeded before this fix still have 10 defaults flagged `false`, so they stay blocked until backfilled. Production isn't deployed, so this only affects dev/test data. Backfill (run in the Supabase SQL editor):
  ```sql
  UPDATE categories SET is_system_default = true
  WHERE name IN ('Learning','Business','Travel','Food','Fitness','Entertainment','Shopping',
                 'Inspiration','Tech','People','Other',
                 'Finance','Technology','Culture','News','Personal');  -- pre-2026-09-18 seed names
  ```
  Caveat: this also flags any *custom* category a dev user happened to create with one of those names.
- **Verified by:** `cd backend && npm run lint` → 0 errors · TC-CAT-01.
- **Commit:** `8a45a69` · **Related:** ADR-0019. **Flag for product:** confirm "3 custom categories" is the intended rule and correct PRD §8.1's wording.

### FIX-20261123-03 — `oshi://settings/reminders` opened a placeholder screen
- **Area:** app · **Severity:** bug
- **Symptom:** The Reminders deep link (and its route) rendered a "Reminder Settings" placeholder; the real editor only existed inline in Settings.
- **Fix:** The editor (permission, time, days, Morning Digest, load/save) moved out of `SettingsScreen` into `components/ReminderSettings.tsx`, which both Settings and `RemindersScreen` render, so the two can't drift. The code was moved, not rewritten; Settings lost ~340 lines.
- **Verified by:** `cd app && npx tsc --noEmit` → 0 errors · TC-NOTIF-07.
- **Commit:** `6b5ca0b`.

### FIX-20261123-04 — Morning Digest toggle was never saved, and nothing sent a digest
- **Area:** backend + app · **Severity:** bug (Pro feature missing)
- **Symptom:** The Pro "Morning Digest" switch reset on every visit and no digest push ever existed. The app already read `morning_digest` from `/users/me`, but the backend never returned it and the save never sent it.
- **Fix:** New `users.morning_digest` column (Prisma `morningDigest`, default false). `PATCH /notifications/settings` accepts `morning_digest` and returns 403 when a free user tries to enable it. `/users/me` returns it. The reminder editor sends it for Pro users. A new cron (`startMorningDigestScheduler`, every minute) sends "Your morning digest ☀️" at **08:00 in each user's own timezone**, to Pro/trial users with the toggle on, summarising the saves from their previous local day. Users who saved nothing get no push. Downgraded users stop receiving it because the cron checks the plan. Logged as `notification_type = 'morning_digest'`.
- **⚠ Deploy order:** run `backend/prisma/manual-migrations/20261123_add_morning_digest.sql` in Supabase **before** deploying this backend. Prisma names every model column, so all `users` queries fail until the column exists. The same script widens the `notification_logs.notification_type` CHECK constraint to allow `morning_digest`. See ADR-0020.
- **Verified by:** backend tsc · the clock helper tested against Asia/Kolkata (+5:30), America/New_York (EST and EDT), UTC, an invalid zone (UTC fallback), and midnight-reads-as-0 · TC-NOTIF-05, TC-NOTIF-06.
- **Commit:** `6b5ca0b`.

### FIX-20261123-05 — Day-5 soft upsell banner (PRD §8.3) didn't exist
- **Area:** backend + app · **Severity:** missing feature (monetization)
- **Fix:** `/users/me` returns `upsell_banner_due` when the plan is `free` and the account is ≥ 5 days old. Every signup starts a 7-day trial, so in practice this is every user whose trial has ended. The Library shows "You're on the free plan — get unlimited saves with Oshi Pro" with **See Pro** (opens the paywall with trigger `upsell_banner`) and ✕, which snoozes it for 7 days (AsyncStorage). It never shows alongside the trial-expiry banner.
- **Verified by:** both tsc · TC-SUB-08.
- **Commit:** `6b5ca0b`.

---

## 2026-11-25 — Product confirmations (01:55 UTC)

The product owner confirmed all three readings that had been flagged, and the PRD now states them directly:

- **ADR-0019, custom-category limit:** free users get 3 custom categories on top of the 11 defaults. PRD §3.7.3 and §8.1 updated.
- **ADR-0023, banner audiences:** the day-5 upsell targets trial users; free-plan users see the §3.7.4 banner instead. PRD §8.3 updated.
- **FIX-20261124-09, downgraded save block:** a free user holding more than 3 custom categories can't add saves until they're back within the limit. PRD §3.7.4 updated ("active" became "custom").

No code changes; the implementation already matched. The "flag for product" notes on FIX-20261123-02 and FIX-20261124-09 are resolved by this entry.

---

## 2026-11-24, cutover tooling (16:30–16:50 UTC)

### FIX-20261124-11 — The post-merge steps had no runbook; P0 count mis-tallied
- **Area:** repo / docs · **Severity:** hygiene
- **Fix:** `scripts/first-deploy-wizard.sh`, generated from the repo's `wizard` skill template with the library left unchanged. It walks the cutover steps that need human access, in dependency order: both migrations (`psql` on `DIRECT_URL` with confirmation, else the SQL editor with the SQL copied to the clipboard), column verification, the optional category backfill (confirmation required), the backend's `POSTHOG_API_KEY` (offers to reuse the app's key and sets it on Railway via CLI if available), the deploy with Node-version and `/health` checks, and a guided P0 run that writes `docs/test-runs/RUN_<date>.md`. Verified statically: `bash -n` passes; all 34 P0 rows parse into ID/case/steps/expected; scoped env-file reads tested; bash 3.2-safe for macOS. Not run end-to-end, since it needs your accounts and input.
- **Also:** TEST_CASES' priority summary had been mis-tallied since v1.0. Actual: P0 33 · P1 51 · P2 8, plus the P0 gate. I'd been describing "28 P0 cases"; there are 34 P0 rows including the gate.
- **Not done:** recording the three product readings (ADR-0019 custom-category limit, ADR-0023 banner audiences, FIX-20261124-09 downgraded save block) as confirmed and rewording the PRD to match. That needs an explicit product sign-off, not an inference from "go ahead".
- **Commit:** see `git log` for 2026-11-24 16:50.

---

## 2026-11-24, wave 6 (15:40–16:25 UTC, branch `claude/claude-md-mm3k18orohhzfkc4-Y2yiI`)

### FIX-20261124-08 — The day-5 upsell and the PRD's downgrade banner targeted the same users; the downgrade banner didn't exist
- **Area:** backend + app · **Severity:** missing feature / spec reconciliation
- **Root cause:** FIX-20261123-05 showed the day-5 upsell to free users ≥ 5 days old. Every signup starts a 7-day trial, so that's every user whose trial ended, which is also exactly the audience of PRD §3.7.4's downgrade banner (never built).
- **Fix (ADR-0023):** `upsell_banner_due` now targets **trial** users from day 5, with new copy and headline. New `downgrade_banner_due` (free plan) shows the PRD's copy, "You're on the free plan — some features are limited. Upgrade to Pro.", dismissible once per session, with its own paywall trigger and headline. `downgrade_banner_viewed` fires once per session and `_dismissed` on dismiss.
- **Verified by:** both tsc · TC-SUB-08 (rewritten), TC-SUB-09.
- **Commit:** `b725cc2`.

### FIX-20261124-09 — Downgraded users with more than 3 custom categories could keep saving (PRD §3.7.4)
- **Area:** backend + app · **Severity:** business rule not enforced
- **Rule:** "New saves are blocked once the user's save count exceeds 20 in the current month OR they have more than 3 active categories." Only the monthly half was enforced.
- **Fix:** `POST /saves` returns 403 `CATEGORY_LIMIT_REACHED` (which opens the paywall) to a free user holding more than 3 custom categories, with a message giving their count and the way out (delete some, or upgrade). Nothing is deleted, and the defaults don't count (ADR-0019). Free-plan limits moved to `backend/src/constants/limits.ts`. Import and share-sheet copy now says "free-plan limit reached".
- **Flag for product:** this blocks *saving*, not just creating categories. That's what §3.7.4 says, but confirm it's the intended experience.
- **Verified by:** both tsc · TC-SUB-10.
- **Commit:** `91506f5`.

### FIX-20261124-10 — No server-side analytics; opt-out was device-only
- **Area:** backend + app · **Severity:** missing instrumentation
- **Fix (ADR-0024):** `backend/src/services/analytics.ts` (posthog-node ^5.74.0; no-op without `POSTHOG_API_KEY`, optional `POSTHOG_HOST`). It tracks `trial_started`, `subscription_purchased` (from_trial), `subscription_cancelled` (during_trial), `subscription_expired` (all tagged with the RevenueCat environment), `save_ai_processed`/`_failed`, and `notification_sent`, and flushes on shutdown. Each event checks the new `users.analytics_opt_out`, which the Settings toggle sets via `PATCH /users/me` and the app re-sends on sign-in. The app's three now-server-owned helpers were removed.
- **⚠ Deploy order:** run `backend/prisma/manual-migrations/20261124_add_analytics_opt_out.sql` (after the 20261123 one) **before** deploying this backend. Set `POSTHOG_API_KEY` on Railway to turn the events on.
- **⚠ Runtime:** current posthog-node needs Node ^20.20.0 or >=22.22.0, and backend `engines` now declares that range (was `>=20.0.0`). Check that Railway's Node version satisfies it.
- **Verified by:** both tsc · TC-ANL-02.
- **Commit:** `f4764cc`.

---

## 2026-11-24 (session 04:10–04:50 UTC, branch `claude/claude-md-mm3k18orohhzfkc4-Y2yiI`)

### FIX-20261124-01 — expo-share-intent required SDK 55; expo-linking peer restored
- **Area:** app · **Severity:** bug (build)
- **Symptom:** `expo-share-intent` was pinned at `^6.0.0`, which requires Expo SDK 55; the app is on SDK 54. This was the open item recorded on 2026-11-23, and it risked a broken Android share-intent build.
- **Root cause, plus a correction:** the pin predates this branch. Separately, **FIX-20260918-20 was wrong to remove `expo-linking`**: the app never imports it, but `expo-share-intent` imports it at runtime (`useLinkingURL`, `createURL`) and declares it as a peer dependency. npm had been quietly nesting an SDK 55 build (`expo-linking@55.0.7`) under share-intent.
- **Fix:** `expo-share-intent@5.1.1`, the line whose peer range is `expo ^54`. `expo-linking ~8.0.12` (SDK 54) is a direct dependency again, shared with share-intent. Also applied `expo install --fix` patch alignments within SDK 54. `expo install --check` now reports "Dependencies are up to date".
- **Verified by:** app tsc · `expo install --check`.
- **Commit:** `ec15641`.

### FIX-20261124-02 — Signing back in during the 30-day window gave no restore offer (PRD §3.7.5)
- **Area:** backend + app · **Severity:** missing feature
- **Fix:** `GET /users/me` reports `account_deleted_at` and `purge_after` for an account pending deletion. `POST /users/me/restore` clears `deleted_at` inside the window (404 afterwards); the window comes from `purgeService.purgeDate`. All four sign-in paths (email, Apple, Google OAuth, session restore) load the profile through one `fetchProfile()` (Apple sign-in previously skipped it). A root-level `AccountRestorePrompt` offers "Restore my account" or "Keep it deleted and sign out", and shows the purge date.
- **Verified by:** both tsc · TC-AUTH-08.
- **Commit:** `189a7b2`.

### FIX-20261124-03 — Free users looked like trial users an hour into a session
- **Area:** app · **Severity:** bug
- **Symptom:** After the first hourly token refresh, a free user's UI behaved as if they were on a trial: the category gate, the Morning Digest switch and the Subscription screen all used the wrong plan. The server still enforced the real limits.
- **Root cause:** the auth listener rebuilt the user from the JWT alone on every event that carried a session, including `TOKEN_REFRESHED`. That discarded the backend profile, and `subscriptionStatus` fell back to its `'trial'` default.
- **Fix:** refresh events keep the profile already loaded for the same account (`userForSession`); `_setSession` does the same.
- **Verified by:** app tsc · TC-AUTH-09.
- **Commit:** `189a7b2`.

### FIX-20261124-04 — Per-category reminder times (Pro) didn't exist
- **Area:** backend + app · **Severity:** missing feature (sold on the paywall)
- **Fix:** The reminder cron also sends a category's own reminder at its `reminder_override_time` (Pro/trial users, on their reminder days, with the same skip rules). Pro users' daily reminder then skips categories that have their own time. Overrides left after a downgrade are ignored, not deleted. `PATCH /categories/:id` validates the time format and rejects setting one on the free plan (403). In Settings, the category edit sheet has an "Own reminder time · Pro" switch with a time picker, and category rows show the time. `TimePicker` moved to `components/`, and local↔UTC conversion moved to `utils/reminderTime`.
- **Also fixed:** the reminder editor read times back via 1 January 1970 but saved them using today's date, so in timezones with daylight saving a reminder read back an hour off in summer. Both directions now use today's date (round-trip tested in Kolkata, New York, London and UTC).
- **Verified by:** both tsc · TC-NOTIF-09.
- **Commit:** `2ae7ceb`.

### FIX-20261124-05 — Notification taps didn't follow their link, and opens were never logged
- **Area:** backend + app · **Severity:** bug
- **Symptom:** Tapping a reminder opened the app wherever it last was, not the category in the push. `POST /notifications/log-open` was never called, so no opens were recorded.
- **Root cause:** the app had no notification-response handling. The backend also logged pushes after sending them, so no push carried the log id that `log-open` needs.
- **Fix:** ADR-0022: `sendLoggedPush` (log first, id in the payload, row deleted if the send fails) for all four push types; `services/notificationTaps` feeds taps into the linking config (cold start and while running) and records the open.
- **Verified by:** both tsc · TC-NOTIF-03, TC-NOTIF-08.
- **Commit:** `f85a35b`.

### FIX-20261124-06 — The reminder time picked during onboarding was stored in the wrong timezone
- **Area:** app · **Severity:** bug
- **Symptom:** A 7 PM reminder picked in onboarding by a user in India fired at 00:30 local time, and Settings showed "12:30 AM". The Skip default had the same problem (7 PM UTC, not 7 PM local).
- **Root cause:** `StepReminder.toApiTime` appended `+00` to the local time without converting it.
- **Fix:** both paths use `utils/reminderTime.localToUtcTimetz`.
- **Verified by:** app tsc · TC-NOTIF-10.
- **Commit:** `82b7968`.

### FIX-20261124-07 — Most of the analytics plan wasn't measured
- **Area:** app · **Severity:** missing instrumentation
- **Fix:** 26 never-called helpers are now fired from the single place that owns each action (auth store, saves store, save creation, the API client's limit path, and the relevant screens). See commit `82b7968` for the full list. `save_duplicate_detected` now sends the platform instead of the URL (plan §1: no PII). Left uncalled on purpose: `trial_started`, `trial_expired` and `subscription_cancelled` are server-side events in the plan, and the backend has no analytics client; the downgrade-banner events have no banner yet. `SaveUrlScreen`'s `as any` is now properly typed.
- **Verified by:** app tsc; a scan confirms only those five helpers (plus the `app_version` constant) remain uncalled · TC-ANL-01.
- **Commit:** `82b7968`.

---

## 2026-11-23, backlog wave (06:10–07:05 UTC, branch `claude/claude-md-mm3k18orohhzfkc4-Y2yiI`)

The remaining items from the 2026-09-18 architecture review's backlog that didn't need a product decision.

### FIX-20261123-06 — The theme's fonts were never loaded
- **Area:** app · **Severity:** bug (design system)
- **Symptom:** Every screen rendered in the system font. `theme/index.ts` named `Sora-Bold`, `Inter-SemiBold` and `Inter-Regular` (PRD §7), but no font files were bundled and nothing loaded them.
- **Fix:** `@expo-google-fonts/sora` + `@expo-google-fonts/inter` + `expo-font` (installed with `expo install` for SDK 54). `App.tsx` registers the three faces under exactly the theme's family names and keeps the native splash up until they load. If loading fails, it renders with system fonts rather than hanging.
- **Verified by:** app tsc · TC-UI-01 (needs a device: check Android, where a custom family plus a `fontWeight` can trigger synthetic bolding).
- **Commit:** `9621800`.

### FIX-20261123-07 — Navigation chrome ignored dark mode
- **Area:** app · **Severity:** bug
- **Symptom:** In dark mode the tab bar, stack backgrounds, loading spinner backdrop and transition backdrop stayed light, because `AppNavigator` styled them from the static light theme object.
- **Fix:** Each navigator reads live tokens from `useTheme`, and `NavigationContainer` gets a matching React Navigation theme built from the app's tokens.
- **Verified by:** app tsc · TC-UI-02.
- **Commit:** `9621800`.

### FIX-20261123-08 — Four copy-pasted category pickers (one of them dead)
- **Area:** app · **Severity:** bug + hygiene
- **Symptom:** The Library and Content Detail pickers listed every category in a column that couldn't scroll, which ran off-screen with the 11 defaults plus custom ones. Each picker looked slightly different. Content Detail and the share handler each fetched `/categories` into their own local copy. The fourth copy, in `share-extension/ShareExtension.tsx`, could never open (its visibility flag was never set true, and the save id it would update was never assigned), yet it fetched `/categories` on every app launch.
- **Fix:** `components/CategoryPickerSheet.tsx`: one scrollable, themed sheet, used by the Library (titled "Change Category" or "Move to Category"), Content Detail and the share handler. Those screens read `savesStore` categories and fetch into the store only when it's empty. The dead picker was removed along with its state, fetch, handler and styles.
- **Verified by:** app tsc · TC-CAT-06.
- **Commit:** `ab4c9d8`.

### FIX-20261123-09 — Settings kept its own category list; reorder and counts were wrong
- **Area:** app · **Severity:** bug
- **Symptom:** (1) A rename, delete or reorder in Settings didn't reach the Library tabs or the category names on cards until the next Library fetch. (2) Reordering patched only the moved row, writing its list index as `sort_order`, and never updated the neighbour it swapped with. Two categories could then share a `sort_order`, and the order didn't reliably survive a reload. (3) Every row said "undefined saves", and the delete confirmation said "All undefined saves … will move to Other", because Settings read `save_count`, which the API never returns (it sends `total_count`).
- **Fix:** `savesStore` now owns category management: `createCategory`, `updateCategory` (also renames the category on loaded saves), `deleteCategory` (reloads saves and categories because the server moves the saves to "Other"), and `moveCategory` (swaps both rows' existing `sort_order` values, patches both, and rolls back on failure). Settings reads the store's list and uses `total_count`.
- **Verified by:** app tsc · TC-CAT-07, TC-CAT-08, TC-CAT-09.
- **Commit:** `11f4164`.

### FIX-20261123-10 — No soft-delete purge existed
- **Area:** backend · **Severity:** bug (data retention / privacy)
- **Symptom:** Deleted saves and deleted accounts were kept forever. Route comments, `CLAUDE.md` and PRD §3.7.5 all described a nightly purge that didn't exist.
- **Fix:** `services/purgeService.ts`, scheduled at 03:00 UTC. Saves deleted more than 7 days ago are removed in batches with their engagement signals. Users deleted more than 30 days ago lose all their rows (in one transaction), their avatar and their Supabase Auth account. Dependent rows are deleted explicitly instead of relying on database cascades (ADR-0021).
- **Verified by:** backend tsc. **Not exercised against a database**; run TC-PURGE-01/02 on a staging copy before relying on it.
- **Commit:** `217e842`.

### Open item found during this wave (not fixed)
- `app/package.json` pins `expo-share-intent` at `^6.0.0`, which requires Expo SDK 55; the app is on SDK 54. This was already on `main` before this branch. `expo install` warns about it, and it can break the Android share-intent build. Fix: install the SDK 54-compatible major (see expo-share-intent's compatibility table) or upgrade the SDK. That's a dependency decision, so it's left for you.

---

## 2026-09-18 (session 17:15–17:35 UTC, branch `claude/claude-md-mm3k18orohhzfkc4-Y2yiI`)

### FIX-20260918-01 — DELETE /saves/:id left deleted saves in the smart-sort cache
- **Area:** backend · **Severity:** bug
- **Symptom:** After deleting a save under the AI-recommended sort, pages could come back short and `total_count`/ranking positions stayed stale for up to 1 hour (the cache TTL). The deleted save itself did not render (fetch re-filters on `deleted_at`), so the bug was subtle rather than glaring.
- **Root cause:** POST and PATCH invalidate the per-(user × category) Redis ranking cache; DELETE never did — the cache contract was applied to two of the three mutation paths.
- **Fix:** DELETE's ownership check now also selects `categoryId`, and after the soft-delete it calls `invalidateSmartSortCache(userId, categoryId)` — same contract as its siblings. (`backend/src/routes/saves.ts`)
- **Verified by:** `cd backend && npm run lint` (tsc) · manual case TC-SORT-04.
- **Commit:** `a394f8c` · **Related:** ARCHITECTURE_REVIEW_2026-09-18 candidate 6.

### FIX-20260918-02 — Platform detection had two diverged implementations
- **Area:** backend · **Severity:** bug
- **Symptom:** A Spotify link like `https://spotify.com/…` (any non-`open.` host) was created with `platform: "web"` by POST /saves, then flipped to `"spotify"` when the worker re-detected during processing — the card's platform badge changed after the fact.
- **Root cause:** `saves.ts` kept a private copy of platform detection (checking only `open.spotify.com`) alongside `metadataService.detectPlatform` (checking `spotify.com`); the copies drifted.
- **Fix:** New single-owner module `backend/src/services/platform.ts` (typed, total — unparseable URL → `'other'`); both the route and metadataService now import it; metadataService re-exports for back-compat. (`saves.ts`, `metadataService.ts`, `platform.ts`)
- **Verified by:** backend tsc · TC-SAVE-06.
- **Commit:** `a394f8c` · **Related:** ADR-0010.

### FIX-20260918-03 — App failed its only quality gate (~30 tsc errors)
- **Area:** app · **Severity:** correctness-hazard
- **Symptom:** `npx tsc --noEmit` in `app/` failed with ~30 errors, so the project's single quality gate could not catch newly-introduced type errors.
- **Root cause (four independent):**
  1. Navigation param lists declared as `interface` — React Navigation v7's `ParamListBase` constraint requires an implicit index signature that TS grants only to object *type aliases* (cascaded into every navigator/screen: ~24 errors).
  2. `expo-file-system` SDK 54 removed the `{ size }` option from `getInfoAsync` (`thumbnailCache.ts`, 2 errors).
  3. `expo-document-picker` option misspelled `copyToCacheDir` → real name `copyToCacheDirectory` (`ImportScreen.tsx`) — the picked bookmarks file was never copied to cache, so bookmark import could fail on iOS with a permissions error on the original URI.
  4. `SaveUrlScreen.tsx` referenced nonexistent theme tokens `typography.h3` and `borderRadius.full` (the `?? 999` fallback masked it at runtime) → now `heading2` / `pill`.
- **Fix:** All four clusters corrected; a comment in `navigation/types.ts` records the alias constraint so it isn't "cleaned up" backwards.
- **Verified by:** `npx tsc --noEmit` → **0 errors** · TC-GATE-01.
- **Commit:** `55da3e7` · **Related:** ADR-0014.

### FIX-20260918-04 — savesStore could render with stale filters after a slow fetch
- **Area:** app · **Severity:** correctness-hazard
- **Symptom:** Switch category (or type in search) while a `fetchSaves` request is in flight → when the response lands, the visible list was derived with the *pre-request* category/search but the *post-request* platform/status filters — an inconsistent mix.
- **Root cause:** `fetchSaves` captured `activeCategoryId`/`searchQuery` before the `await` and `platformFilter`/`statusFilter` after it.
- **Fix:** Part of the derive-once refactor — the visible list is now always derived from the store state *at set time* via `withDerivedSaves(get(), …)`. (`app/src/store/savesStore.ts`)
- **Verified by:** app tsc · TC-LIB-07.
- **Commit:** `55da3e7` · **Related:** ADR-0012.

### FIX-20260918-05 — Structural: derive-once invariant, shared status mutation, debug-log cleanup
- **Area:** app · **Severity:** hygiene
- **Symptom:** ~20 call sites hand-maintained the `saves = applyFilter(allSaves, …)` invariant; `markDone`/`markSkipped` were 30-line near-clones; leftover per-tap `console.log`s in filter actions.
- **Fix:** `withDerivedSaves` helper is the single derivation path (one `applyFilter` call site remains, inside it); `mutateStatus` shared by markDone/markSkipped (rollback on API failure preserved; thumbnail cache still cleared only on done); debug logs removed. Public store interface unchanged.
- **Verified by:** app tsc · TC-ACT-01…07 exercise every mutation path.
- **Commit:** `55da3e7` · **Related:** ADR-0012, ARCHITECTURE_REVIEW candidate 3.

### FIX-20260918-06 — Structural: realtime subscription moved to `services/realtime.ts`
- **Area:** app · **Severity:** hygiene
- **Symptom:** The app-global Supabase channel lived inside HomeScreen (ref + teardown + row-merging), contradicting API contract §8's service seam.
- **Fix:** New `app/src/services/realtime.ts` owns the channel as a module singleton (`subscribeToSaveUpdates`/`unsubscribeFromSaveUpdates`); HomeScreen's effect is three lines. Behaviour identical (idempotent resubscribe, unsubscribe on unmount/sign-out).
- **Verified by:** app tsc · TC-AI-05.
- **Commit:** `55da3e7` · **Related:** ADR-0013.

### FIX-20260918-07 — Structural: aiService owns categorisation end-to-end
- **Area:** backend · **Severity:** hygiene
- **Symptom:** Category name→id resolution (case-insensitive + "Other" fallback) was re-implemented inline in the worker; response-parsing rules were unreachable without a live OpenAI call.
- **Fix:** `resolveCategoryId()` added to aiService and consumed by the worker; `parseAiResponse` exported as the parsing test surface. (`aiService.ts`, `workers/aiProcessor.ts`)
- **Verified by:** backend tsc · TC-AI-03/04.
- **Commit:** `a394f8c` · **Related:** ADR-0011.

### FIX-20260918-08 — GET /saves search clause deduplicated; PATCH double-fetch collapsed
- **Area:** backend · **Severity:** hygiene
- **Fix:** `buildSearchWhere()` used by both sort paths (was pasted twice); PATCH's ownership check now also returns `categoryId`, removing its second pre-update query.
- **Verified by:** backend tsc · TC-LIB-05, TC-ACT-02.
- **Commit:** `a394f8c`.

### FIX-20260918-09 — Removed unused backend dependencies
- **Area:** backend · **Severity:** hygiene
- **Symptom:** `posthog-node` and `@google/generative-ai` sat in `package.json` with zero imports anywhere in `backend/src` — dead weight and a misleading signal that backend analytics/Gemini were wired up.
- **Fix:** `npm uninstall` both; lockfile synced.
- **Verified by:** backend tsc; `grep` confirms no imports.
- **Commit:** `a394f8c`.

### FIX-20260918-10 — Removed duplicate root CONTEXT.md
- **Area:** repo · **Severity:** hygiene
- **Symptom:** Both `CONTEXT.md` (2026-06-09 original) and `context.md` (2026-06-11 rework on main, canonical) existed — two sources of truth guaranteed to drift.
- **Fix:** Uppercase original removed; `context.md` is canonical. `.claude/skills/` (locally-installed tooling) gitignored alongside the existing `.agents/` rule. *(Note: the deletion was staged into commit `a394f8c` alongside the backend work; the gitignore change is `71019bf`.)*
- **Verified by:** `git status` clean of duplicates.
- **Commit:** `a394f8c` / `71019bf`.

---

## 2026-09-18, second wave (17:45–18:20 UTC — fixes from the deep exploration pass)

### FIX-20260918-11 — Password-reset flow was broken end-to-end
- **Area:** backend (+contract) · **Severity:** bug
- **Symptom:** "Forgot password" always failed with a validation error; the reset deep link's "set new password" step always 404'd. The whole J12 reset journey was dead.
- **Root cause:** Three-way endpoint mismatch. The contract says `POST /auth/reset-password {email}`; the app conformed (`reset-password {email}`, then `update-password {token,new_password}`); the backend served the email step at `/auth/forgot-password` and the token step at `/auth/reset-password` — so the app's email call hit the token endpoint (422) and its token call hit nothing (404).
- **Fix:** Backend renamed to match contract + app: `/auth/reset-password {email}` sends the email, `/auth/update-password {token,new_password}` sets the password. The app needed **zero changes**. `/auth/update-password` documented in API_CONTRACT §2 (it was missing entirely).
- **Verified by:** backend tsc · TC-AUTH-03.
- **Commit:** `de01516` · **Related:** ARCHITECTURE_REVIEW addendum A1.

### FIX-20260918-12 — Rendering a Facebook save crashed the app
- **Area:** app · **Severity:** bug
- **Symptom:** Any save with `platform: "facebook"` (which the backend emits, and whose filter chip HomeScreen offers) threw `TypeError: undefined is not an object` when a card or the detail screen rendered its platform badge.
- **Root cause:** The app's `Platform_` union and BOTH copy-pasted `PLATFORM_META` maps (OshiCard, ContentDetailScreen) omitted `facebook`, and lookups indexed the map unguarded. A third diverged copy (ShareHandlerScreen's detect + labels) also lacked it.
- **Fix:** New `app/src/constants/platforms.ts` — single `Platform` type (with facebook), one `PLATFORM_META`, total `getPlatformMeta()` accessor (unknown → 'other' badge), and `detectPlatformFromUrl` mirroring the backend detector. All three files consume it; the triplication is gone.
- **Verified by:** app tsc · TC-LIB-09 (new).
- **Commit:** `de01516` · **Related:** ADR-0016.

### FIX-20260918-13 — Undo-after-delete could never restore the save
- **Area:** backend + app · **Severity:** bug
- **Symptom:** Delete a card, tap Undo → the card reappears for a moment, then vanishes again. The server row stayed deleted.
- **Root cause:** Undo issued `PATCH /saves/:id`, but every route (correctly) filters `deletedAt: null`, so the PATCH 404'd and the store's rollback removed the card again. No endpoint could clear a soft delete.
- **Fix:** New `POST /saves/:id/restore` clears `deleted_at` (status/timestamps were untouched by delete, so the save returns exactly as it was) and invalidates the smart-sort cache; `savesStore.undoAction` uses it for the deleted path. Documented in API_CONTRACT §3.
- **Verified by:** both tsc · TC-ACT-03.
- **Commit:** `de01516`.

### FIX-20260918-14 — Worker never invalidated the smart-sort cache after classification
- **Area:** backend · **Severity:** bug
- **Symptom:** After AI moved a save from "Other" to its real category, the cached AI-recommended order for both categories stayed stale up to 1h — the same defect family as FIX-20260918-01, on the worker leg.
- **Fix:** `aiProcessor` now selects the pre-classification `categoryId` and calls `invalidateSmartSortCache(userId, oldCategoryId, newCategoryId)` after the complete-update. The invalidation contract (POST/PATCH/DELETE/restore/worker) is now uniform everywhere a save's presence, status, or category changes.
- **Verified by:** backend tsc · TC-SORT-05 (new).
- **Commit:** `de01516`.

### FIX-20260918-15 — Seeded default categories contradicted the PRD
- **Area:** backend · **Severity:** bug (business rule)
- **Symptom:** New users got Finance/Technology/Culture/News/Personal instead of the PRD §3.2.1 list (Entertainment/Shopping/Inspiration/Tech/People); the AI's fallback list used the PRD names, so the two halves of the system disagreed about what the default categories even are.
- **Root cause:** Two hardcoded lists (auth.ts seeding, aiService fallback) with no shared source.
- **Fix:** New `backend/src/constants/defaultCategories.ts` (PRD names + emojis, "Other" last/system) consumed by both. Per CLAUDE.md, PRD wins on business logic. Existing users' categories are untouched — this affects new signups.
- **Verified by:** backend tsc · TC-AUTH-01 (expected list updated).
- **Commit:** `de01516`.

### FIX-20260918-16 — Signin error code drifted from the contract
- **Area:** backend · **Severity:** correctness-hazard
- **Fix:** `POST /auth/signin` wrong-credentials now returns `INVALID_CREDENTIALS` (contract §2) instead of `UNAUTHORISED`; code added to the `ErrorCode` union. Clients matching on the code can now do so per contract.
- **Verified by:** backend tsc · TC-AUTH-07 (new).
- **Commit:** `de01516`.

### FIX-20260918-17 — Reminder deep link dropped its category (tab never selected)
- **Area:** backend + app · **Severity:** bug
- **Symptom:** Tapping a daily-reminder push (`oshi://library/business`) opened the Library on "All" — the slug param was parsed by navigation but read by nothing; `CategoryData.slug` was typed in the app yet never returned by the backend.
- **Fix:** `formatCategory` now emits `slug` (same `slugifyCategoryName` formula the notifications use); HomeScreen reads `route.params.categorySlug` and selects the matching tab once categories load.
- **Verified by:** both tsc · TC-NOTIF-03, TC-DEEP-01.
- **Commit:** `de01516`.

### FIX-20260918-18 — Two parallel sources of session truth
- **Area:** app · **Severity:** correctness-hazard
- **Symptom:** AppNavigator's private `useAuthSession` ran its own `getSession()` + `onAuthStateChange` listener alongside `authStore.initialise()`'s pair — two subscriptions, two session states that could disagree (e.g. during sign-out edge timing).
- **Fix:** RootNavigator now selects `session`/`isInitialised` from authStore (which App.tsx initialises on mount); the duplicate hook and its listener are gone. Also replaced the `React.createElement(require('react-native').Text, …)` TabIcon hack with a plain imported `Text`.
- **Verified by:** app tsc · TC-AUTH-05.
- **Commit:** `de01516` · **Related:** ADR-0017.

### FIX-20260918-19 — Backend duplication collapsed (webhook handlers, reminder blocks, social fetchers, category formatter)
- **Area:** backend · **Severity:** hygiene
- **Fix, four sites:**
  1. `subscriptions.ts`: six copy-pasted RevenueCat handlers → one `setSubscriptionStatus(userId, status, event?)`; dispatch table unchanged in behaviour.
  2. Reminder "top unread category" block (groupBy + display resolve + slug + day-names) existed in both `routes/notifications.ts` and `cron/scheduler.ts` → moved into `notificationService` (`getTopUnreadCategory`, `slugifyCategoryName`, `UTC_DAY_NAMES`).
  3. `metadataService`: identical `fetchLinkedIn`/`fetchFacebook` → one `fetchWithBrowserHeaders(url, platform, fallbackThumb)`.
  4. `categories.ts` `formatCategory`: dead both-branches ternary now follows the omit-null convention; `PATCH /categories/:id` returns **real** unread/total counts (was hardcoded `0/0` even for populated categories); `aiService.buildSystemPrompt` no longer mutates the caller's array.
- **Verified by:** backend tsc · TC-SUB-02, TC-NOTIF-01, TC-CAT-05 (new).
- **Commit:** `de01516`.

### FIX-20260918-20 — App dead weight removed (state, deps, files, assets) + shared URL predicate
- **Area:** app · **Severity:** hygiene
- **Fix:**
  1. subscriptionStore's never-rendered banner state removed (trial-expiry copy duplicated savesStore's live one; downgrade-banner flags had zero consumers — the PRD §3.7.4 banner remains unbuilt, see backlog).
  2. Zero-import dependencies uninstalled: `expo-router`, `react-native-draggable-flatlist` (its required Reanimated peer was never even installed), `expo-linking`, `expo-font`. `react-native-svg` kept (optional PostHog peer).
  3. Dead files: `screens/auth/OnboardingScreen.tsx` re-export (zero importers); unreferenced assets (`animations/welcome.json`, root-level `icon.png`/`splash-icon.png`/`android-icon-*`/`favicon.png` — app.json uses `assets/images/*` only).
  4. URL validation written inline three times (SaveUrlScreen, ImportScreen ×2) → `utils/url.ts isValidHttpUrl`.
  5. CLAUDE.md's stale claim that draggable-flatlist is used was corrected.
- **Verified by:** app tsc · TC-GATE-01.
- **Commit:** `de01516`.

---

## 2026-06-09 (PR #2, merged 2026-06-09)

### FIX-20260609-01 — Offline queue double-flush race
- **Area:** app · **Severity:** bug
- **Symptom:** Coming back online / foregrounding with queued saves could POST the same URL twice (duplicate cards) or clobber the failed-item write-back.
- **Root cause:** `shareExtension.ts` and `offlineQueue.ts` both owned the `oshi_offline_queue` AsyncStorage key with independent flush loops, both triggered on app-foreground events.
- **Fix:** `offlineQueue.ts` is the sole owner (has the `isProcessing` guard); `shareExtension.ts` drains the iOS App Group queue into `offlineQueue.enqueue()` then delegates to `processQueue()`. Duplicate `PendingShare`/`ShareProcessResult` types collapsed into `QueuedShare`/`SyncResult`.
- **Verified by:** app tsc at the time · TC-OFF-03 covers it going forward.
- **Commit:** `1dd6b85` (PR #2) · **Related:** ADR-0009.

---

| Doc version | Date (UTC) | Change |
|-------------|------------|--------|
| 1.0 | 2026-09-18 17:32 | Initial log: 2026-09-18 session fixes + retroactive PR #2 entry. |
| 1.1 | 2026-09-18 18:20 | Second wave (FIX-11…20) from the deep exploration pass. |
| 1.2 | 2026-11-23 04:11 | Paywall wiring (FIX-20261123-01) and custom-category limit (FIX-20261123-02). |
| 1.3 | 2026-11-23 04:23 | Reminders screen, Morning Digest persistence + sender, day-5 upsell banner (FIX-20261123-03…05). |
| 1.4 | 2026-11-23 07:05 | Backlog wave: fonts, dark-mode navigation, category pickers, Settings categories, purge (FIX-20261123-06…10); expo-share-intent open item. |
| 1.7 | 2026-11-24 16:47 | Cutover wizard + P0 count correction (FIX-20261124-11). |
| 1.8 | 2026-11-25 01:55 | Product confirmations for ADR-0019, ADR-0023 and FIX-20261124-09; PRD updated. |
| 1.6 | 2026-11-24 16:23 | Wave 6: banner split + downgrade banner, downgraded save block, server-side analytics with stored opt-out (FIX-20261124-08…10). |
| 1.5 | 2026-11-24 04:48 | FIX-20261124-01…07: share-intent/SDK fix (+ expo-linking correction), account restore, plan-on-refresh, per-category reminders, notification taps, onboarding UTC, analytics. |
