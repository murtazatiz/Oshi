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
- **Commit:** wave-2 commit · **Related:** ARCHITECTURE_REVIEW addendum A1.

### FIX-20260918-12 — Rendering a Facebook save crashed the app
- **Area:** app · **Severity:** bug
- **Symptom:** Any save with `platform: "facebook"` (which the backend emits, and whose filter chip HomeScreen offers) threw `TypeError: undefined is not an object` when a card or the detail screen rendered its platform badge.
- **Root cause:** The app's `Platform_` union and BOTH copy-pasted `PLATFORM_META` maps (OshiCard, ContentDetailScreen) omitted `facebook`, and lookups indexed the map unguarded. A third diverged copy (ShareHandlerScreen's detect + labels) also lacked it.
- **Fix:** New `app/src/constants/platforms.ts` — single `Platform` type (with facebook), one `PLATFORM_META`, total `getPlatformMeta()` accessor (unknown → 'other' badge), and `detectPlatformFromUrl` mirroring the backend detector. All three files consume it; the triplication is gone.
- **Verified by:** app tsc · TC-LIB-09 (new).
- **Commit:** wave-2 commit · **Related:** ADR-0016.

### FIX-20260918-13 — Undo-after-delete could never restore the save
- **Area:** backend + app · **Severity:** bug
- **Symptom:** Delete a card, tap Undo → the card reappears for a moment, then vanishes again. The server row stayed deleted.
- **Root cause:** Undo issued `PATCH /saves/:id`, but every route (correctly) filters `deletedAt: null`, so the PATCH 404'd and the store's rollback removed the card again. No endpoint could clear a soft delete.
- **Fix:** New `POST /saves/:id/restore` clears `deleted_at` (status/timestamps were untouched by delete, so the save returns exactly as it was) and invalidates the smart-sort cache; `savesStore.undoAction` uses it for the deleted path. Documented in API_CONTRACT §3.
- **Verified by:** both tsc · TC-ACT-03.
- **Commit:** wave-2 commit.

### FIX-20260918-14 — Worker never invalidated the smart-sort cache after classification
- **Area:** backend · **Severity:** bug
- **Symptom:** After AI moved a save from "Other" to its real category, the cached AI-recommended order for both categories stayed stale up to 1h — the same defect family as FIX-20260918-01, on the worker leg.
- **Fix:** `aiProcessor` now selects the pre-classification `categoryId` and calls `invalidateSmartSortCache(userId, oldCategoryId, newCategoryId)` after the complete-update. The invalidation contract (POST/PATCH/DELETE/restore/worker) is now uniform everywhere a save's presence, status, or category changes.
- **Verified by:** backend tsc · TC-SORT-05 (new).
- **Commit:** wave-2 commit.

### FIX-20260918-15 — Seeded default categories contradicted the PRD
- **Area:** backend · **Severity:** bug (business rule)
- **Symptom:** New users got Finance/Technology/Culture/News/Personal instead of the PRD §3.2.1 list (Entertainment/Shopping/Inspiration/Tech/People); the AI's fallback list used the PRD names, so the two halves of the system disagreed about what the default categories even are.
- **Root cause:** Two hardcoded lists (auth.ts seeding, aiService fallback) with no shared source.
- **Fix:** New `backend/src/constants/defaultCategories.ts` (PRD names + emojis, "Other" last/system) consumed by both. Per CLAUDE.md, PRD wins on business logic. Existing users' categories are untouched — this affects new signups.
- **Verified by:** backend tsc · TC-AUTH-01 (expected list updated).
- **Commit:** wave-2 commit.

### FIX-20260918-16 — Signin error code drifted from the contract
- **Area:** backend · **Severity:** correctness-hazard
- **Fix:** `POST /auth/signin` wrong-credentials now returns `INVALID_CREDENTIALS` (contract §2) instead of `UNAUTHORISED`; code added to the `ErrorCode` union. Clients matching on the code can now do so per contract.
- **Verified by:** backend tsc · TC-AUTH-07 (new).
- **Commit:** wave-2 commit.

### FIX-20260918-17 — Reminder deep link dropped its category (tab never selected)
- **Area:** backend + app · **Severity:** bug
- **Symptom:** Tapping a daily-reminder push (`oshi://library/business`) opened the Library on "All" — the slug param was parsed by navigation but read by nothing; `CategoryData.slug` was typed in the app yet never returned by the backend.
- **Fix:** `formatCategory` now emits `slug` (same `slugifyCategoryName` formula the notifications use); HomeScreen reads `route.params.categorySlug` and selects the matching tab once categories load.
- **Verified by:** both tsc · TC-NOTIF-03, TC-DEEP-01.
- **Commit:** wave-2 commit.

### FIX-20260918-18 — Two parallel sources of session truth
- **Area:** app · **Severity:** correctness-hazard
- **Symptom:** AppNavigator's private `useAuthSession` ran its own `getSession()` + `onAuthStateChange` listener alongside `authStore.initialise()`'s pair — two subscriptions, two session states that could disagree (e.g. during sign-out edge timing).
- **Fix:** RootNavigator now selects `session`/`isInitialised` from authStore (which App.tsx initialises on mount); the duplicate hook and its listener are gone. Also replaced the `React.createElement(require('react-native').Text, …)` TabIcon hack with a plain imported `Text`.
- **Verified by:** app tsc · TC-AUTH-05.
- **Commit:** wave-2 commit · **Related:** ADR-0017.

### FIX-20260918-19 — Backend duplication collapsed (webhook handlers, reminder blocks, social fetchers, category formatter)
- **Area:** backend · **Severity:** hygiene
- **Fix, four sites:**
  1. `subscriptions.ts`: six copy-pasted RevenueCat handlers → one `setSubscriptionStatus(userId, status, event?)`; dispatch table unchanged in behaviour.
  2. Reminder "top unread category" block (groupBy + display resolve + slug + day-names) existed in both `routes/notifications.ts` and `cron/scheduler.ts` → moved into `notificationService` (`getTopUnreadCategory`, `slugifyCategoryName`, `UTC_DAY_NAMES`).
  3. `metadataService`: identical `fetchLinkedIn`/`fetchFacebook` → one `fetchWithBrowserHeaders(url, platform, fallbackThumb)`.
  4. `categories.ts` `formatCategory`: dead both-branches ternary now follows the omit-null convention; `PATCH /categories/:id` returns **real** unread/total counts (was hardcoded `0/0` even for populated categories); `aiService.buildSystemPrompt` no longer mutates the caller's array.
- **Verified by:** backend tsc · TC-SUB-02, TC-NOTIF-01, TC-CAT-05 (new).
- **Commit:** wave-2 commit.

### FIX-20260918-20 — App dead weight removed (state, deps, files, assets) + shared URL predicate
- **Area:** app · **Severity:** hygiene
- **Fix:**
  1. subscriptionStore's never-rendered banner state removed (trial-expiry copy duplicated savesStore's live one; downgrade-banner flags had zero consumers — the PRD §3.7.4 banner remains unbuilt, see backlog).
  2. Zero-import dependencies uninstalled: `expo-router`, `react-native-draggable-flatlist` (its required Reanimated peer was never even installed), `expo-linking`, `expo-font`. `react-native-svg` kept (optional PostHog peer).
  3. Dead files: `screens/auth/OnboardingScreen.tsx` re-export (zero importers); unreferenced assets (`animations/welcome.json`, root-level `icon.png`/`splash-icon.png`/`android-icon-*`/`favicon.png` — app.json uses `assets/images/*` only).
  4. URL validation written inline three times (SaveUrlScreen, ImportScreen ×2) → `utils/url.ts isValidHttpUrl`.
  5. CLAUDE.md's stale claim that draggable-flatlist is used was corrected.
- **Verified by:** app tsc · TC-GATE-01.
- **Commit:** wave-2 commit.

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
