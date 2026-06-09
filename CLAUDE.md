# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## What Oshi is

Oshi is a **smart content inbox**: users share links (Instagram reels, YouTube
videos, TikToks, articles, etc.) into the app, an AI pipeline auto-categorises
and summarises each save, and daily reminder notifications nudge users to
revisit their unread library. Free tier is capped (20 saves/month, 3 custom
categories); **Oshi Pro** unlocks unlimited saves, unlimited categories, faster
AI processing, and per-category reminders.

This repo is a **monorepo with two independently-installed packages**:

| Path       | What it is                          | Stack |
|------------|-------------------------------------|-------|
| `app/`     | Mobile client                       | React Native 0.81 + Expo SDK 54 + TypeScript |
| `backend/` | REST API + async workers + cron     | Node 20 + Express 4 + TypeScript + Prisma |

There is **no root `package.json`** — `app/` and `backend/` each have their own
`node_modules` and are installed/run separately.

## Authoritative documents

These root files are the source of truth. When behaviour is ambiguous, **read
them before guessing** — code comments throughout reference them by section
number (e.g. "PRD §3.2.2", "API contract §3"):

- `PRODUCT_REQUIREMENTS.md` (PRD) — the master spec for all features/business rules.
- `API_CONTRACT.md` — exact request/response shapes for every endpoint. Backend and app must both conform.
- `TECHNICAL_ARCHITECTURE.md` — system layers, data flows, infra, security model.
- `.docx` files (`Oshi_*.docx`) — analytics plan, QA plan, deployment guide, App Store listing. Reference only; not code.

> Note: code occasionally diverges from the older docs (e.g. SDK/library
> versions below). When code and docs disagree on a **version or library**,
> trust the code; when they disagree on **business logic**, trust the PRD and
> flag the discrepancy.

## Commands

### Backend (`cd backend`)
```bash
npm install                # install deps
npm run dev                # tsx watch — hot-reloading dev server on :3000
npm run build              # tsc → dist/
npm start                  # node dist/index.js (production)
npm run lint               # tsc --noEmit  (THIS is the only "lint"/typecheck)
npm run prisma:generate    # regenerate Prisma client after schema.prisma changes
npm run prisma:migrate     # prisma migrate deploy (uses DIRECT_URL, not pooled)
```

### App (`cd app`)
```bash
npm install                # install deps
npm start                  # expo start (Metro)
npm run ios                # expo run:ios   (native build; needs Xcode)
npm run android            # expo run:android
```
EAS build profiles live in `app/eas.json` (`development` / `staging` /
`production`), each injecting a different `EXPO_PUBLIC_API_BASE_URL`.

### Testing & type-checking
- **There is no test framework** wired up (no Jest/Vitest, no `test` script). Do
  not invent test commands. If asked to "run tests", say so and run the
  typecheck instead.
- The de-facto quality gate is **`tsc --noEmit`** in each package. Run it after
  changes:
  - backend: `cd backend && npm run lint`
  - app: `cd app && npx tsc --noEmit`
- Both `tsconfig.json` files use `"strict": true`. The backend additionally
  enables `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — this is
  why you'll see patterns like `req.params['id'] as string` and conditional
  object spreads instead of assigning `undefined` to optional fields. **Preserve
  these patterns.**

## Backend architecture (`backend/src`)

Bootstrapping order matters and is enforced in `index.ts`:
1. **Sentry is initialised first** (`./services/sentry`) — before any other
   import so it can auto-instrument modules. Keep it the first import.
2. Express app: CORS (allowlist in `index.ts`), `trust proxy`, JSON body limit
   1mb, global rate limiter, routers mounted under `/api/v1`, then the Sentry
   error handler, then `notFoundHandler`, then `globalErrorHandler` **last**.
3. Background workers + cron jobs start in the same process (`startAiWorkers`,
   `startNotificationWorker`, `startDeadLinkChecker`, `startDailyReminderScheduler`,
   `startMonthlySaveCountReset`). Graceful shutdown (`SIGTERM`/`SIGINT`) drains
   them. **The API server and the workers are one deployable** on Railway.

### Layout
```
src/
  index.ts            App wiring, CORS, worker/cron startup, graceful shutdown
  health.ts           GET /health (no auth)
  lib/                prisma.ts (singleton client), redis.ts
  middleware/         auth.ts (requireAuth), errorHandler.ts, rateLimiter.ts
  routes/             auth, saves, categories, engagement, users, notifications, subscriptions
  services/           aiService, metadataService, youtubeService, smartSortService,
                      notificationService, sentry
  queue/index.ts      BullMQ queues + enqueue helpers + Redis connection
  workers/            aiProcessor, deadLinkChecker, notificationScheduler
  cron/scheduler.ts   node-cron: daily reminders (every min), monthly counter reset
  prisma/schema.prisma  DB models (snake_case tables, camelCase fields via @map)
```

### Conventions that are non-negotiable in route handlers
- Every handler is `async (req, res, next)` wrapped in `try/catch` → `next(err)`.
  Never let a promise reject unhandled.
- **Validate every request body/query with Zod** before use. See `saves.ts`
  schemas for the pattern.
- Throw `AppError` / use the `Errors.*` factories (`errorHandler.ts`) for
  expected failures. The global handler renders the standard shape:
  `{ error: { code, message, statusCode } }`. 5xx are reported to Sentry; 4xx
  are not.
- All protected routes call `router.use(requireAuth)`. `requireAuth` validates
  the Supabase JWT server-side via the **service-role** Supabase admin client and
  sets `req.userId`. Always scope DB queries by `req.userId`.
- Responses use **snake_case** (per API contract) even though Prisma fields are
  camelCase. Routes have explicit mapping helpers (e.g. `formatSave` in
  `saves.ts`) that also **omit null optional fields** and never return `null` for
  array fields.
- Rate limiting: a global limiter is applied; tighter per-route limiters exist
  (e.g. `savesLimiter` on `POST /saves`).
- **Never AI-process inside a request.** `POST /saves` returns `201` in <300ms
  and enqueues a BullMQ job; the worker does metadata fetch + OpenAI call.

### Async pipeline (the critical path)
`POST /saves` → create row (`processing_status='pending'`) + increment monthly
counter atomically in a `$transaction` → `enqueueAiJob` (Pro users → priority
queue) → **aiProcessor worker**: `fetchContentMetadata` → `classifyContent`
(GPT-4o-mini, temp 0.2, 3 retries w/ backoff, forces "Other" if confidence <0.5)
→ update row to `complete`/`failed` → **Supabase Realtime** pushes the change to
the app (no polling). See `workers/aiProcessor.ts` and `services/aiService.ts`.

Queues (`queue/index.ts`): `ai-processing` (free), `ai-processing-priority`
(Pro), `notification-scheduler` (delayed trial-expiry pushes). Redis connection
is derived from `REDIS_URL`.

Cron (`cron/scheduler.ts`, all UTC):
- Daily reminders: runs **every minute**, finds users whose `reminder_time`
  hour:minute matches now and whose `reminder_days` includes today; skips users
  with zero unread saves or who opened the app within the last 2h.
- Monthly reset: `0 0 1 * *` resets `items_saved_this_month` to 0.

### Data model (`prisma/schema.prisma`)
Tables: `users`, `categories`, `saves`, `user_engagement_signals`,
`notification_logs`. Notes:
- `User.id` is the **Supabase Auth UUID** — not generated by Prisma.
- Enum-like fields are plain strings documented at the top of the schema;
  valid values are enforced by **Supabase CHECK constraints**, not by Prisma.
- Soft deletes: `saves.deleted_at` (purged after 7 days), `users.deleted_at`
  (30 days). Always filter `deletedAt: null` in queries.
- `DATABASE_URL` must include `?pgbouncer=true` (pooled, runtime). Migrations
  use `DIRECT_URL` (non-pooled) because PgBouncer blocks advisory locks.

## Mobile app architecture (`app/src`)

`App.tsx` is the root. Order: Sentry init → analytics init →
`ShareIntentProvider` → `ThemeProvider` → `AuthInitialiser` (restores session,
syncs JWT to the iOS App Group for the share extension, wires RevenueCat +
PostHog + Sentry user context) → `AppNavigator` → share handlers → offline-queue
banner → milestone celebration overlay. The whole tree is wrapped with the
Sentry error boundary (`wrapWithSentry`).

### Layout
```
src/
  navigation/   AppNavigator.tsx (stacks/tabs + deep-link config), types.ts (param lists)
  screens/      auth/, onboarding/, library/, search/, settings/ + top-level screens
  components/   OshiCard, CategoryTabs, StreakDisplay, UndoToast, *SkeletonCard, etc.
  store/        Zustand: authStore, savesStore, onboardingStore, subscriptionStore
  services/     apiClient (axios), supabase, analytics, errorMonitoring, purchases,
                offlineQueue, shareExtension
  lib/          supabase.ts (re-export for back-compat)
  theme/        index.ts (design tokens), ThemeContext.tsx (light/dark)
  utils/        thumbnailCache.ts
share-extension/  ShareExtension.tsx (iOS App Group pending-share handler)
plugins/          withShareExtension.js, withAndroidShareTarget.js (Expo config plugins)
```

### Navigation & deep links
React Navigation **v7**. Root gate in `AppNavigator.tsx`: shows `Main` only when
there is **both** a Supabase session **and** completed onboarding (`onboardingStore`).
Deep-link prefix is `oshi://` (e.g. `oshi://library/:categorySlug`,
`oshi://save/:saveId`, `oshi://settings/reminders`). `oshi://notifications/enable`
is intercepted to open OS settings rather than an in-app screen. `navigationRef`
is exported for navigating outside the React tree.

### State (Zustand)
- Zustand for all shared/global state; persisted UI prefs via AsyncStorage.
- `savesStore` is the heart of the Library: it fetches **all** saves once
  (`limit=500`) and does category/search/platform/status filtering **client-side**
  via `applyFilter`. Mutations are **optimistic** (update local state, call API,
  roll back on failure) and re-derive the visible `saves` list each time.
- Realtime updates flow through `savesStore.updateSave(payload.new)`.
- Stores export `useShallow`-wrapped selector hooks (`useSaves`,
  `useSavesActions`, etc.) — prefer these over subscribing to the whole store.

### API client & auth
- `services/apiClient.ts` — axios instance, base URL from
  `EXPO_PUBLIC_API_BASE_URL`. A request interceptor attaches the current
  Supabase JWT; a response interceptor does a **single silent refresh on 401**
  (queuing concurrent requests), and signs out if refresh fails.
- `services/supabase.ts` is the canonical Supabase client. JWTs are stored in
  **Expo SecureStore only** (key `oshi_session`) via a custom storage adapter —
  never AsyncStorage. The client uses the **anon** key (`EXPO_PUBLIC_*`).

### Theme
`theme/index.ts` holds design tokens (colours, typography, spacing, radius,
shadows) from PRD §7, with a dark-mode override set. Use tokens; don't hardcode
colours/sizes. Light/dark is provided via `ThemeContext`.

## API surface (all under `/api/v1`, see `API_CONTRACT.md`)

- **auth**: `POST /auth/signup`, `/signin`, `/reset-password`, + 2 more
- **saves**: `GET /saves`, `GET /saves/check-duplicate` (registered before `/:id`),
  `GET /saves/:id`, `POST /saves`, `PATCH /saves/:id`, `DELETE /saves/:id`,
  `POST /saves/:id/retry`
- **categories**: `GET`, `POST`, `PATCH /:id`, `DELETE /:id` (deletes move saves to "Other")
- **engagement**: `POST /engagement/signal` (feeds the AI smart-sort)
- **users**: `GET /users/me`, `PATCH /users/me`, `POST /users/avatar`, `DELETE /users/me`
- **notifications**: register token, log opens, etc.
- **subscriptions**: `POST /subscriptions/webhook` (RevenueCat; validated via
  `REVENUECAT_WEBHOOK_AUTH_HEADER`) + status read

## Key business rules (don't break these)
- Free tier: 20 saves/month (enforced atomically in `POST /saves`), 3 custom
  categories. Pro/trial bypass both.
- New signups get **11 default categories** + `trial_started_at = NOW()`.
- Save status: `unread` → `done` (sets `done_at`) / `skipped` (sets `skipped_at`);
  reverting to `unread` clears both.
- "Smart sort" (`ai_recommended`) is computed in `smartSortService`, cached in
  Redis per (user × category) for 1h, and **invalidated** on new save / status
  change / category move. Other sorts use Prisma cursor pagination directly.
- Streaks are Duolingo-style hard-reset (`streak_count`).

## Environment variables

Secrets are **gitignored** (`.env`, `.env.*`). No `.env.example` exists — derive
needed vars from code.

**Backend** (`backend/.env`): `DATABASE_URL` (with `?pgbouncer=true`),
`DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`,
`OPENAI_API_KEY`, `YOUTUBE_DATA_API_KEY`, `REVENUECAT_WEBHOOK_AUTH_HEADER`,
`SENTRY_DSN`, `PORT`, `APP_ENV`/`NODE_ENV`.

**App** (`app/.env`, must be `EXPO_PUBLIC_*` to reach the client):
`EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`,
`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_SENTRY_DSN`,
`EXPO_PUBLIC_POSTHOG_API_KEY`, `APP_ENV`.

## External services
Supabase (Postgres + Auth + Storage + Realtime), Redis (BullMQ), OpenAI
GPT-4o-mini, YouTube Data API v3, Expo Push, RevenueCat (payments), PostHog
(analytics), Sentry (errors). Backend deploys to **Railway**; app ships via
**EAS**.

## Coding conventions (from `.cursor/rules/*.mdc` + observed practice)

- **TypeScript strict everywhere. Never `any`** — use `unknown` and narrow.
- Functional components only; guard clauses over nested `if`.
- Descriptive boolean names (`isLoading`, `hasError`, `canSubmit`).
- Handle errors explicitly — no silent failures. (Stores do swallow some network
  errors intentionally to keep the UI responsive; mirror the existing pattern
  rather than adding new silent catches elsewhere.)
- React Native: wrap screens in `SafeAreaProvider`/`SafeAreaView`; never hardcode
  insets/status-bar heights; min touch target **44×44px**; portrait-only; no
  iPad. `FlatList` should set `keyExtractor`, `removeClippedSubviews`, `windowSize`.
- Zustand: use `useShallow` selectors; tokens in SecureStore, not `persist`.
- Supabase: RLS on every table; client uses anon key only; service-role key is
  **server-side only**; prefer Realtime over polling.

### Known drift between the Cursor rules and the actual code
The `.cursor/rules` predate the current code in a few places. **Match the
existing code**, not the rule, when they conflict:
- Rules say "Expo SDK 51 / React Navigation v6". Code uses **Expo SDK 54 / RN
  0.81 / React Navigation v7**.
- Rules mandate "Reanimated 2 for animations" — Reanimated is **not** a
  dependency; animations use `react-native-confetti-cannon` /
  `react-native-draggable-flatlist` / core APIs.
- Rules say "use `interface`, never `type`" and "no `console.log`" — the codebase
  uses some `type` aliases and leaves `console.log`/`console.info` in stores,
  workers, and cron (used for diagnostics). Don't add gratuitous logs, but this
  is the established baseline.

## Editor/tooling config (`.cursor/`)
`.cursor/hooks.json` runs Prettier (`--write`) and `tsc --noEmit` after each file
edit **via `cmd.exe`** (Windows-oriented). `.cursor/mcp.json` and
`.cursor/settings.json` configure MCP servers (context7, Supabase, GitHub) and
plugins, with placeholder tokens. These are Cursor-specific and don't affect
Claude Code, but they signal the intended **Prettier + strict-typecheck** loop —
keep edits formatted and type-clean.

## Git workflow
- Repo: `murtazatiz/Oshi`. Default branch: `main`.
- Do active development on the designated feature branch
  (`claude/...` matching the session). Branch names that don't start with
  `claude/` and match the session id will fail to push (403). Push with
  `git push -u origin <branch>`.
- Commit with clear messages; only commit/push when asked.
</content>
</invoke>
