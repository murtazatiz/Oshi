# Oshi — Project Context

> Living reference for developers and AI assistants working on this codebase.
> Last updated: June 2026 · GitHub: [murtazatiz/Oshi](https://github.com/murtazatiz/Oshi)

---

## 1. What Is Oshi?

**Oshi** is a mobile-first smart content inbox for iOS and Android. Users save links discovered while scrolling (YouTube, Instagram, articles, podcasts, social posts, etc.) and Oshi automatically organises them into meaningful categories using AI, then reminds users to revisit saved content at their preferred time.

The name derives from Japanese *oshi* — a dedicated favourite, something deeply followed and supported.

### Core Value Proposition

| Problem | Oshi's Answer |
|---------|---------------|
| Links sent to yourself via DM become unread graveyards | Unified cross-platform inbox |
| Native platform saves are siloed per app | One library for everything |
| Bookmarking apps are desktop-first with poor social media support | Mobile-first, share-sheet native |
| No product combines saving + AI organisation + behavioural reminders | All three in one experience |

### Target Platforms

- **iOS** and **Android** only (portrait, no iPad)
- Built with **React Native + Expo SDK 54**
- Bundle ID: `com.oshi.app`
- Deep link scheme: `oshi://`

---

## 2. Repository Structure

```
oshi/
├── app/                          # React Native / Expo mobile app
│   ├── src/
│   │   ├── components/           # Reusable UI (OshiCard, CategoryTabs, etc.)
│   │   ├── lib/                  # Supabase client re-export (back-compat)
│   │   ├── navigation/           # AppNavigator, route types
│   │   ├── screens/              # All screens (Library, Import, Settings, Auth, Onboarding)
│   │   ├── services/             # apiClient, supabase, analytics, offlineQueue,
│   │   │                         #   shareExtension, purchases, errorMonitoring
│   │   ├── store/                # Zustand stores (saves, auth, onboarding, subscription)
│   │   ├── theme/                # Design tokens + ThemeContext
│   │   └── utils/                # thumbnailCache, etc.
│   ├── plugins/                  # Expo config plugins (share extension, Android share target)
│   ├── share-extension/          # iOS share extension React component
│   ├── assets/                   # Icons, splash, Lottie animations
│   ├── app.json                  # Expo config
│   └── eas.json                  # EAS build profiles (dev / staging / production)
│
├── backend/                      # Node.js REST API
│   ├── src/
│   │   ├── routes/               # auth, saves, categories, users, notifications,
│   │   │                         #   subscriptions, engagement
│   │   ├── services/             # aiService, metadataService, youtubeService,
│   │   │                         #   smartSortService, notificationService, sentry
│   │   ├── workers/              # aiProcessor (BullMQ), deadLinkChecker (node-cron),
│   │   │                         #   notificationScheduler (BullMQ delayed)
│   │   ├── cron/                 # scheduler.ts — daily reminders, monthly save-count reset
│   │   ├── middleware/           # auth (requireAuth), rateLimiter, errorHandler
│   │   ├── queue/                # BullMQ queue setup + enqueue helpers
│   │   └── lib/                  # prisma (singleton), redis
│   └── prisma/schema.prisma      # Database schema
│
├── .cursor/rules/                # Cursor IDE coding standards (partly outdated — see §13)
├── .agents/skills/               # Local agent skills (gitignored)
├── CLAUDE.md                     # AI assistant guidance (commands, conventions, gotchas)
├── PRODUCT_REQUIREMENTS.md       # PRD v2.0 — full feature spec
├── TECHNICAL_ARCHITECTURE.md     # System design, data flows, infrastructure
├── API_CONTRACT.md               # All endpoint request/response specs
└── CONTEXT.md                    # This file
```

There is **no root `package.json`** — `app/` and `backend/` are installed and run independently.

---

## 3. Technical Stack

### Mobile App (`app/`)

| Layer | Technology |
|-------|------------|
| Framework | React Native 0.81 + Expo SDK 54 |
| Language | TypeScript (strict mode) |
| Navigation | React Navigation v7 (native stack + bottom tabs) |
| State | Zustand v5 with `useShallow` selectors |
| HTTP | Axios (`apiClient`) with JWT interceptor + 401 silent refresh |
| Auth | Supabase Auth (JWT in Expo SecureStore, key `oshi_session`) |
| Realtime | Supabase Realtime (Postgres change notifications on `saves` table) |
| Payments | RevenueCat (`react-native-purchases`) |
| Analytics | PostHog (`posthog-react-native`) |
| Error monitoring | Sentry (`@sentry/react-native`) |
| Gestures | React Native Gesture Handler |
| Animations | React Native Animated (core) — Reanimated is **not** a dependency |
| Haptics | expo-haptics |
| Share | expo-share-intent + custom iOS share extension plugin |
| Offline | AsyncStorage queue (`offlineQueue.ts` — sole owner, see Decision 10) |
| File import | expo-document-picker (bookmark HTML import) |
| Build | EAS (Expo Application Services) |

### Backend (`backend/`)

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 LTS |
| Framework | Express 4 + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| ORM | Prisma 5 (PostgreSQL via Supabase) |
| Job queue | BullMQ + Redis |
| AI | OpenAI GPT-4o-mini (categorisation + summarisation) |
| Metadata | Cheerio (HTML parsing), YouTube Data API v3, Open Graph |
| Validation | Zod (all request bodies and query params) |
| Auth | Supabase JWT validated server-side via service-role admin client |
| Rate limiting | express-rate-limit (global + per-route) |
| Cron | node-cron (daily reminders, monthly resets, nightly dead-link check at 02:00 UTC) |
| Error monitoring | Sentry (`@sentry/node`) — initialised **first** in `index.ts` |
| Payments webhook | RevenueCat webhook handler (`REVENUECAT_WEBHOOK_AUTH_HEADER`) |
| Push notifications | Expo Push API |

> ⚠️ `posthog-node` and `@google/generative-ai` are listed in `backend/package.json`
> but are **not imported anywhere** in `backend/src`. Backend analytics is not wired
> up; Gemini is unused. Treat both as dormant dependencies.

### Infrastructure & External Services

| Component | Service |
|-----------|---------|
| Database | Supabase PostgreSQL (PgBouncer connection pooling) |
| Auth | Supabase Auth (Apple, Google, Email/Password) |
| File storage | Supabase Storage (`avatars` bucket, signed URLs) |
| Realtime | Supabase Realtime |
| Backend hosting | Railway.app — API server, workers, and cron are **one deployable** |
| Redis | Railway Redis add-on |
| CI/CD | GitHub Actions — **planned, not yet set up** |
| Push (APNs/FCM) | Expo Push Notification Service |

### API Base URLs

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:3000/api/v1` |
| Staging | `https://oshi-staging.railway.app/api/v1` |
| Production | `https://api.oshi.app/api/v1` |

---

## 4. System Architecture

### Three-Layer Model

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1 — USER'S PHONE (React Native / Expo)           │
│  App shell, Zustand stores, screens, share extension    │
│  API calls via axios → HTTPS/TLS 1.2+                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  LAYER 2 — BACKEND (Railway — Node.js + Express)        │
│  Routes: Auth, Saves, Categories, Users, Notifications  │
│  BullMQ queues: ai-processing, ai-processing-priority,  │
│  notification-scheduler · node-cron jobs                │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  LAYER 3 — EXTERNAL SERVICES                            │
│  Supabase (DB + Auth + Storage + Realtime)              │
│  OpenAI GPT-4o-mini, YouTube API, Expo Push, RevenueCat │
│  PostHog (app only), Sentry                             │
└─────────────────────────────────────────────────────────┘
```

### Critical Path: Saving a URL

1. User taps Share in any app → selects Oshi from share sheet
2. Share extension extracts URL, calls `POST /saves` with JWT
3. Backend validates JWT, checks save limit (free tier: 20/month, enforced atomically in a `$transaction`), creates `saves` record with `processing_status: 'pending'`
4. Backend enqueues BullMQ `ai-processing` job (Pro users → `ai-processing-priority`) → returns `201` in <300ms
5. Share extension shows confirmation card; user returns to originating app
6. BullMQ worker fetches URL metadata (Open Graph / YouTube API / Cheerio)
7. Worker calls OpenAI GPT-4o-mini → receives JSON: category, content_type, summary, tags, confidence_score
8. Worker updates `saves` record: `processing_status: 'complete'`, category, summary, tags, thumbnail_url
9. Supabase Realtime fires change event to mobile app
10. App receives realtime event → `updateSave()` in Zustand store → card updates without manual refresh

### Daily Reminder Flow

1. node-cron job (`cron/scheduler.ts`) runs **every minute** (UTC)
2. Queries users whose `reminder_time` hour:minute matches now and whose `reminder_days` includes today
3. Skips if: zero unread saves, or user opened app within last 2 hours
4. Builds personalised notification from category with most unread saves
5. Calls Expo Push API with deep link `oshi://library/[category_slug]`
6. User taps → app opens to correct category tab

---

## 5. Data Model (Key Tables)

Defined in `backend/prisma/schema.prisma` (snake_case tables, camelCase Prisma fields via `@map`):

| Table | Purpose |
|-------|---------|
| `users` | Profile, subscription status, reminder settings, streak, push token. **`id` is the Supabase Auth UUID** — not generated by Prisma |
| `categories` | User categories (11 system defaults on signup), emoji, sort order, reminder override |
| `saves` | Saved URLs with AI metadata, status, platform, thumbnail, processing state |
| `user_engagement_signals` | opened / skipped / done actions — feeds AI smart sort |
| `notification_logs` | Push notification delivery and open tracking |

Soft deletes: `saves.deleted_at` (purged after 7 days), `users.deleted_at` (30 days). **Always filter `deletedAt: null`.**

`DATABASE_URL` must include `?pgbouncer=true` (pooled, runtime). Migrations use `DIRECT_URL` (non-pooled) because PgBouncer blocks advisory locks.

### Key Enums (plain strings, enforced by Supabase CHECK constraints — not Prisma)

- **platform**: `instagram | youtube | tiktok | web | twitter | linkedin | facebook | spotify | other`
- **content_type**: `short_video | long_video | article | podcast | post | product | image | other`
- **processing_status**: `pending | processing | complete | failed`
- **status** (save): `unread | done | skipped`
- **link_status**: `active | unavailable | private`
- **subscription_status**: `free | trial | pro | cancelled`

### Default Categories (created on signup)

Learning, Business, Travel, Food, Fitness, Entertainment, Shopping, Inspiration, Tech, People, Other

---

## 6. Mobile App Architecture

### Navigation Structure

```
RootStack
├── Auth (no session or onboarding incomplete)
│   ├── Onboarding (9-step flow)
│   ├── Login / Signup / ForgotPassword / ResetPassword
│
└── Main (authenticated + onboarding complete)
    ├── MainTabs (bottom tab navigator)
    │   ├── LibraryTab → LibraryStack → LibraryHome (HomeScreen)
    │   ├── SearchTab  → ImportScreen  (tab label: "Import" — see Decision 6)
    │   └── SettingsTab → SettingsStack → SettingsHome, Profile, Reminders, Subscription
    │
    ├── ContentDetail (modal sheet)
    ├── Paywall (modal sheet)
    └── SaveUrl (modal sheet — manual URL paste)
```

### Deep Links (`oshi://`)

| Pattern | Destination |
|---------|-------------|
| `oshi://library` | Library home (all categories) |
| `oshi://library/:categorySlug` | Library pre-scrolled to category |
| `oshi://save/:saveId` | Content detail modal |
| `oshi://settings/reminders` | Reminders settings |
| `oshi://settings/subscription` | Subscription settings |
| `oshi://auth/reset?token=xxx` | Password reset screen |
| `oshi://notifications/enable` | Intercepted → opens OS notification settings |

### Zustand Stores

| Store | Responsibility |
|-------|----------------|
| `savesStore` | Library data: `allSaves`, filtered `saves`, categories, search, sort, filters, multi-select, undo |
| `authStore` | Session, user profile |
| `onboardingStore` | Onboarding completion flag (AsyncStorage-persisted) |
| `subscriptionStore` | RevenueCat entitlements, paywall state |

Stores export `useShallow`-wrapped selector hooks (`useSaves`, `useSavesActions`, etc.) — prefer these over subscribing to the whole store.

### Library Data Flow (Current Architecture)

The Library uses a **fetch-all, filter client-side** model:

```
App load / pull-to-refresh / header refresh / new save
        ↓
GET /saves?sort=...&limit=500   (no category_id param)
        ↓
allSaves[]  (master in-memory array)
        ↓
applyFilter(allSaves, category, search, platformFilter, statusFilter)
        ↓
saves[]  (visible filtered view)
```

**`GET /saves` is only called on:** app load, pull-to-refresh, header refresh button tap, after a new save is added.

**Category tab switches, search, and filter chips are purely client-side** — no API call per category. Mutations are **optimistic** (update local state, call API, roll back on failure).

---

## 7. Key Architectural Decisions

### Decision 1: Fetch-All + Client-Side Filtering (Library)

**Context:** Earlier implementations used per-category API calls with TTL-based caching (`lastFetchedAt`, `isCategoryFresh`). This caused blank screens on category switch, stale data, and complex cache invalidation bugs.

**Decision:** Fetch all saves once (limit=500), store in `allSaves`, filter in memory. Category counts come from counting `allSaves` per category.

**Rationale:** Simpler, more reliable, instant category switching, no cache bugs. Acceptable for users with <500 saves.

**Files:** `app/src/store/savesStore.ts`, `app/src/screens/HomeScreen.tsx`

---

### Decision 2: Never Clear `saves` Array Before Fetch Completes

**Context:** Previous `setActiveCategory` and `fetchSaves` implementations called `set({ saves: [] })` before network requests, causing empty screens during loading.

**Decision:** The `saves` array is never set to empty. It is only replaced with new data after a successful fetch. `isLoading: true` shows a subtle indicator while existing cards remain visible.

---

### Decision 3: Dynamic AI Category Prompt

**Context:** PRD specified a hardcoded list of 11 categories in the OpenAI system prompt. Users can rename/add categories.

**Decision:** `aiService.ts` builds the system prompt dynamically with the user's actual category names from the database. Falls back to PRD defaults if none provided. Always includes "Other" as fallback.

**Threshold:** `confidence_score < 0.5` → force category to "Other".

---

### Decision 4: Async AI Processing via BullMQ

**Context:** AI categorisation takes 2–10 seconds. Cannot block the share extension confirmation.

**Decision:** `POST /saves` creates a pending record and returns immediately (<300ms). BullMQ worker handles metadata fetch + OpenAI call asynchronously. Supabase Realtime pushes the update to the app. **Never AI-process inside a request handler.**

---

### Decision 5: Platform Detection Before Generic "web" Fallback

**Context:** URLs from LinkedIn, Facebook, Twitter/X were falling through to generic web handling with poor thumbnails.

**Decision:** Explicit hostname checks in both `metadataService.ts` and the `saves.ts` route handler:
- `facebook.com`, `fb.com`, `fb.watch`, `fb.me` → `facebook`
- `linkedin.com` → `linkedin`
- `twitter.com`, `x.com` → `twitter`

LinkedIn and Facebook use browser-like HTTP headers for Open Graph fetch, with platform-specific fallback thumbnails if `og:image` is empty.

---

### Decision 6: Import Tab Replaces Search Tab

**Context:** PRD §3.3.8 specified a dedicated search screen. Search was implemented inline in the Library header. The Search tab was a placeholder.

**Decision:** Repurpose the middle tab as **Import** (`ImportScreen.tsx`, mounted on `SearchTab`) with two sub-tabs:
1. **Paste URLs** — multiline input, live URL detection, sequential `POST /saves` with progress bar
2. **Browser Bookmarks** — HTML file picker, parse `<a href>` links, checkbox preview, batch import

Duplicate detection: `POST /saves` returning `{ duplicate: true }` counts as skipped. (`screens/search/SearchScreen.tsx` still exists as a placeholder.)

---

### Decision 7: Search + Filter Chips in Library Header

**Context:** PRD specified search in Library with platform filter pills. Implemented as inline search bar with filter chips below.

**Decision:**
- Search bar spans full width on its own row; action buttons (sort, view, refresh, +) on a separate row below
- Filter chips (platform + status) appear when search bar is focused or has text
- Platform and status filters are **independent** — each only applies when its array is non-empty
- Local UI state (`localPlatformFilter`, `localStatusFilter`) synced with store to avoid stale state on first app open
- Chips use `Pressable` (not `TouchableOpacity`) inside a `View` with `flexWrap: 'wrap'` (not `ScrollView`) to avoid touch interception

---

### Decision 8: Auth Token in SecureStore, Not Zustand Persist

JWT/session stored in Expo SecureStore (key `oshi_session`) via a custom storage adapter — **never AsyncStorage**. Zustand persist only for non-sensitive UI preferences (sort option, view mode). The app uses the Supabase **anon** key; the service-role key is server-side only.

---

### Decision 9: Onboarding Gate Separate from Auth Session

**Context:** Supabase session is set at step 5 (account creation) but onboarding has 9 steps.

**Decision:** `RootNavigator` shows Main only when **both** `session !== null` AND `onboardingStore.isComplete === true`. This lets onboarding continue after sign-up.

---

### Decision 10: Single Owner for the Offline Queue (June 2026, PR #2)

**Context:** `shareExtension.ts` and `offlineQueue.ts` both read/wrote the `oshi_offline_queue` AsyncStorage key, each with its own `POST /saves` flush loop, and both subscribed to app-foreground events. Two concurrent flushes could double-post the same URL or clobber each other's failed-item write-back.

**Decision:** `offlineQueue.ts` is the **sole owner** of `oshi_offline_queue` (it has an `isProcessing` guard). `shareExtension.ts` only owns the iOS App Group queue (`oshi_pending_share`): `processPendingShares()` drains App Group items into `offlineQueue.enqueue()`, then delegates the flush to `offlineQueue.processQueue()`. The duplicate `PendingShare`/`ShareProcessResult` types collapsed into `QueuedShare`/`SyncResult`.

**Files:** `app/src/services/offlineQueue.ts`, `app/src/services/shareExtension.ts`

---

## 8. Issues Resolved

### Library / Data Fetching

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Blank screen on category switch | `set({ saves: [] })` called before fetch | Fetch-all model; never clear saves array |
| Stale saves after category change | Per-category TTL cache with race conditions | Removed all TTL/caching; client-side filter only |
| Category counts wrong in tabs | Counts from last fetched category subset | Count from `allSaves` in memory per category |
| `GET /saves` returned 422 | App sent `limit=500`; Zod `max(50)` | Updated schema to `z.coerce.number().max(500)` |

### Edit Category (Single Save)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Kebab menu "Edit Category" didn't update save | Category picker `onSelect` was wired to bulk move only | Added `saveForCategoryEdit` state; picker calls `PATCH /saves/:id` + `updateSave` + `fetchCategories` for single-save edits |

### Search & Filter Chips

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Platform/status chips not filtering | Stale store state on toggle; ScrollView intercepting touches | Compute next filter from local state; replaced ScrollView with flexWrap View; changed to Pressable |
| Filters not working on first app open | `togglePlatformFilter` read stale store arrays | Compute `next` from `localPlatformFilter`/`localStatusFilter` directly before calling store |
| Clear button didn't reset chip UI | Only store arrays reset, not local chip state | `handleClearAllFilters` resets both store and local state |

### Backend / Metadata

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| LinkedIn/Facebook poor thumbnails | Generic User-Agent blocked by platforms | Browser-like headers + platform-specific fallback thumbnail URLs |
| Facebook URLs detected as "web" | Missing hostname checks | Added `facebook.com`, `fb.com`, `fb.watch`, `fb.me` detection before web fallback |

### Offline Queue

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Potential double-post of queued saves | Two modules owned `oshi_offline_queue` with independent flush loops | Consolidated ownership into `offlineQueue.ts` (Decision 10) |

### Import Screen

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Search tab was placeholder | Not yet implemented | Built `ImportScreen.tsx` with Paste URLs + Browser Bookmarks tabs; wired into `SearchTab` as "Import" |

---

## 9. Feature Implementation Status

### Implemented

- [x] Auth flow (email/password, session management, 401 silent refresh)
- [x] 9-step onboarding flow
- [x] Library / Home screen (category tabs, search, sort, grid/list view)
- [x] Client-side filtering (category, search, platform, status)
- [x] OshiCard with status states (unread, done, skipped, processing, failed)
- [x] Swipe gestures (list view: right=Done, left=Delete)
- [x] Long-press multi-select + bulk actions
- [x] Undo toast (5s auto-dismiss with progress bar)
- [x] Supabase Realtime subscription (live card updates after AI processing)
- [x] Content detail modal
- [x] Save URL modal (manual paste fallback)
- [x] Import screen (paste URLs + browser bookmarks)
- [x] Settings, Profile, Reminders, Subscription screens
- [x] Paywall screen
- [x] Share extension setup (iOS + Android intent filters)
- [x] Offline save queue (single-owner, race-free)
- [x] AI categorisation pipeline (BullMQ + OpenAI GPT-4o-mini)
- [x] Metadata extraction (YouTube API, Open Graph, Cheerio, platform-specific)
- [x] Smart sort algorithm (server-side, Redis-cached 1h per user×category)
- [x] Dead link checker (nightly cron, 02:00 UTC)
- [x] Notification scheduler (daily reminders)
- [x] RevenueCat subscription webhook
- [x] Streak system + milestone celebrations
- [x] Sentry error monitoring (app + backend)
- [x] PostHog analytics hooks (app only — backend not wired)
- [x] Deep link routing

### Partially Implemented / In Progress

- [ ] Search screen (search is inline in Library; dedicated `SearchScreen.tsx` is still a placeholder)
- [ ] iOS share extension cold-start performance (<1.5s target)
- [ ] Android share handler full flow
- [ ] Morning Digest notification (Pro feature)
- [ ] Per-category reminder overrides (Pro feature)
- [ ] EAS production submit credentials (placeholders in eas.json)

### Not Yet Started

- [ ] App Store / Play Store submission
- [ ] Production Railway deployment
- [ ] GitHub Actions CI pipeline
- [ ] Backend PostHog analytics (dep installed, not wired)
- [ ] Spotify metadata beyond Open Graph/embed handling
- [ ] Streak freeze (deferred to post-v1 Pro feature)
- [ ] Test framework — **there are no tests**; `tsc --noEmit` is the only quality gate

---

## 10. API Endpoints Summary

All under `/api/v1`. Full specs: `API_CONTRACT.md`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/signup` | Create account + 11 default categories + trial start |
| POST | `/auth/signin` | Sign in |
| POST | `/auth/signout` | Sign out |
| POST | `/auth/forgot-password` | Send password reset email |
| POST | `/auth/reset-password` | Set new password with reset token |
| GET | `/saves` | List saves (sort, search, cursor pagination; app uses limit=500) |
| GET | `/saves/check-duplicate` | Duplicate check (registered **before** `/:id`) |
| GET | `/saves/:id` | Single save |
| POST | `/saves` | Create save (returns `{ duplicate: true }` if URL exists) |
| PATCH | `/saves/:id` | Update status, category, note, manual sort order |
| DELETE | `/saves/:id` | Soft delete |
| POST | `/saves/:id/retry` | Re-enqueue failed AI processing |
| GET | `/categories` | List categories with unread/total counts |
| POST | `/categories` | Create category (free: max 3 custom) |
| PATCH | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Delete category (moves saves to Other) |
| GET | `/users/me` | Current user profile + subscription + streak |
| PATCH | `/users/me` | Update profile / reminder settings |
| POST | `/users/avatar` | Upload profile photo |
| DELETE | `/users/me` | Soft-delete account |
| POST | `/engagement/signal` | Record opened/skipped/done for smart sort |
| POST | `/notifications/log-open` | Mark notification as opened |
| POST | `/subscriptions/webhook` | RevenueCat webhook |
| GET | `/health` | Health check (no auth) |

Responses use **snake_case** (per API contract) even though Prisma fields are camelCase — routes have explicit mapping helpers (e.g. `formatSave`) that omit null optional fields.

---

## 11. Monetization Model

| Tier | Limits |
|------|--------|
| **Free** | 20 saves/month, 3 custom categories, basic reminders |
| **Trial** | 7-day Pro trial on signup (all Pro features) |
| **Pro** | Unlimited saves, unlimited categories, AI smart sort priority, morning digest, per-category reminder overrides |

- Payments handled entirely by RevenueCat — Oshi never sees card numbers
- Paywall triggered on: save limit reached, category limit reached, Pro feature access
- Downgrade preserves all existing content; blocks new saves/categories beyond free limits
- Save limit enforced **atomically** in `POST /saves` via Prisma `$transaction`

---

## 12. Design System

Defined in `app/src/theme/index.ts` (PRD §7). Use tokens; don't hardcode colours/sizes.

### Colors (Light Mode)

| Token | Value | Usage |
|-------|-------|-------|
| `primary` | `#1A1A2E` | Navy — app icon, headers |
| `accent` | `#E94560` | Coral red — CTAs, active states |
| `background` | `#FAFAFA` | Screen background |
| `surface` | `#FFFFFF` | Cards, modals |
| `textPrimary` | `#1A1A2E` | Body text |
| `textSecondary` | `#666666` | Metadata |
| `textMuted` | `#999999` | Placeholders |
| `success` | `#22C55E` | Done state, positive feedback |
| `error` | `#EF4444` | Errors, delete actions |

Dark mode overrides exist for `background`, `surface`, `textPrimary`, `textSecondary`, `border`. Light/dark provided via `ThemeContext`.

### Typography

- **Display**: Sora Bold 32px
- **Heading 1**: Inter SemiBold 24px
- **Heading 2**: Inter SemiBold 18px
- **Body**: Inter Regular 16px
- **Body Small**: Inter Regular 14px
- **Caption**: Inter Regular 12px
- **Button**: Inter SemiBold 16px

### Spacing Scale

`xs: 4` · `sm: 8` · `md: 16` · `lg: 24` · `xl: 32` · `xxl: 48`

---

## 13. Coding Standards

Source: `.cursor/rules/*.mdc` + observed practice. **Where the rules and the code conflict, match the code** (the rules predate the current implementation).

### TypeScript (everywhere)
- Strict mode throughout; backend also enables `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — hence patterns like `req.params['id'] as string` and conditional object spreads. **Preserve these.**
- Never use `any` — use `unknown` and narrow explicitly
- Guard clauses for early returns (no nested ifs)
- Handle errors explicitly — no new silent failures (stores intentionally swallow some network errors; mirror the existing pattern only)

### React Native
- Functional components only
- SafeAreaProvider + SafeAreaView on every screen; never hardcode insets
- FlatList must include `keyExtractor`, `removeClippedSubviews`, `windowSize`
- Minimum touch target: 44×44px
- Portrait only, no iPad

### State
- Zustand for all global state; always use `useShallow` selectors
- Auth tokens in SecureStore, not Zustand persist

### Backend
- All routes: `async (req, res, next)` with `try/catch` → `next(error)`
- Zod validation on all inputs; `AppError` / `Errors.*` factories for expected failures
- All protected routes use `requireAuth`; always scope DB queries by `req.userId`
- BullMQ for async jobs — never synchronous AI in route handlers
- Rate limiting on all routes (global + tighter per-route)

### Known drift in `.cursor/rules` (do NOT follow these)
- Rules say "Expo SDK 51 / React Navigation v6" → code uses **SDK 54 / v7**
- Rules mandate "Reanimated 2" → **not a dependency**; core Animated is used
- Rules say "use `interface`, never `type`" and "no `console.log`" → codebase uses some `type` aliases and leaves `console.log`/`console.info` in stores/workers/cron for diagnostics

---

## 14. Environment Variables

Secrets are **gitignored** (`.env`, `.env.*`). No `.env.example` exists. Variable names below are verified against the code.

### Backend (`backend/.env`)

```
DATABASE_URL=                     # Supabase pooled connection (?pgbouncer=true)
DIRECT_URL=                       # Supabase direct connection (Prisma migrations only)
REDIS_URL=                        # Railway Redis
OPENAI_API_KEY=
YOUTUBE_DATA_API_KEY=             # note: DATA in the name
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=        # server-side ONLY — never ship to client
REVENUECAT_WEBHOOK_AUTH_HEADER=
SENTRY_DSN=
PORT=
APP_ENV= / NODE_ENV=
```

### App (`app/.env` — must be `EXPO_PUBLIC_*` to reach the client)

```
EXPO_PUBLIC_API_BASE_URL=
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=    # anon key only — never the service-role key
EXPO_PUBLIC_POSTHOG_API_KEY=
EXPO_PUBLIC_SENTRY_DSN=
EXPO_PUBLIC_REVENUECAT_IOS_KEY=
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=
APP_ENV=
```

EAS build profiles (`app/eas.json`: `development` / `staging` / `production`) each inject a different `EXPO_PUBLIC_API_BASE_URL`.

---

## 15. Development Workflow

### Running Locally

```bash
# Backend
cd backend
npm install
npm run dev          # tsx watch src/index.ts — http://localhost:3000

# Mobile app
cd app
npm install
npm start            # Expo dev server (Metro)
```

### Quality Gate

**There is no test framework.** The de-facto check is `tsc --noEmit` in each package:

```bash
cd backend && npm run lint       # tsc --noEmit
cd app && npx tsc --noEmit
```

### Git

- Repository: [github.com/murtazatiz/Oshi](https://github.com/murtazatiz/Oshi)
- Default branch: `main`
- AI-assisted development happens on `claude/*` session branches → PR → merge

### Build & Deploy

```bash
# EAS builds
eas build --profile development   # Dev client
eas build --profile staging       # Internal APK/IPA
eas build --profile production    # Store submission

# Backend deploys to Railway (API + workers + cron in one process)
```

---

## 16. Related Documents

| Document | Contents |
|----------|----------|
| `CLAUDE.md` | AI assistant guidance — commands, conventions, gotchas |
| `PRODUCT_REQUIREMENTS.md` | Full PRD v2.0 — features, flows, KPIs, monetization |
| `TECHNICAL_ARCHITECTURE.md` | System design, data flows, infrastructure, security |
| `API_CONTRACT.md` | Complete endpoint specs with request/response examples |
| `.cursor/rules/*.mdc` | Cursor IDE coding standards (partly outdated — see §13) |

When code and docs disagree on a **version or library**, trust the code; on **business logic**, trust the PRD and flag the discrepancy.

---

## 17. AI Processing Details

### OpenAI Prompt Structure (`backend/src/services/aiService.ts`)

- **Model**: `gpt-4o-mini`
- **Temperature**: 0.2
- **Max tokens**: 200
- **Retry**: 3 attempts, exponential backoff (1s, 2s, 4s)
- **System prompt**: Built dynamically with user's actual category names (Decision 3)
- **User message**: platform, title, description (300 chars), text_snippet (500 chars), channel_or_author, duration_seconds
- **Response**: `{ category, content_type, summary, tags, confidence_score, estimated_read_time_seconds }`
- **Low confidence**: `confidence_score < 0.5` → category forced to "Other"

### Metadata Extraction (`backend/src/services/metadataService.ts`)

| Platform | Method | Quality |
|----------|--------|---------|
| YouTube | YouTube Data API v3 | Full (title, description, thumbnail, duration, views, channel) |
| Instagram | Open Graph only | Limited (~75% accuracy) |
| TikTok | Open Graph only | Limited |
| Twitter/X | Open Graph | Partial |
| LinkedIn | Open Graph + browser headers + fallback thumb | Partial |
| Facebook | Open Graph + browser headers + fallback thumb | Partial |
| Spotify | Embed/Open Graph handling | Partial |
| Web/Articles | Open Graph + Cheerio (first 500 words) | Full |
| Any URL | Open Graph fallback | Basic |

⚠️ **Never scrape** instagram.com, tiktok.com, or twitter.com beyond Open Graph — IP ban risk.

---

*This document should be updated when significant architectural decisions are made or major features are completed.*
