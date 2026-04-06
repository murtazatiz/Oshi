OSHI
Technical Architecture Document
System Design, Data Flow & Component Map
Oshi v1.0  •  February 2026
Reference alongside PRD v2.0
 
1. System Overview
Oshi is composed of four primary layers: the React Native mobile app (client), a Node.js/Express REST API (backend), a PostgreSQL database managed via Supabase, and an asynchronous AI processing pipeline using BullMQ and Redis. Third-party services handle authentication, payments, push notifications, and analytics.

## 1.1 Architecture Overview

The Oshi system has four layers:

LAYER 1 — USER'S PHONE (React Native / Expo)
- App shell, Zustand state store, iOS/Android screens
- Share Extension (iOS) and Share Intent handler (Android)
- API Service Layer using axios for all backend calls
- Communicates to backend via HTTPS / TLS 1.2+

LAYER 2 — BACKEND (Railway — Node.js 20 + Express 4 + TypeScript)
- Routes: Auth, Saves, Notifications, Subscriptions, Webhook
- BullMQ Job Queues: ai-processing (save URLs), notification-scheduler (daily reminders)

LAYER 3 — EXTERNAL SERVICES
- Supabase: PostgreSQL database + Auth + Storage
- OpenAI GPT-4o-mini: AI content categorisation
- Expo Push API: push notifications (APNs/FCM)
- YouTube Data API v3: video metadata
- RevenueCat: subscription and payment management
- PostHog: analytics
- Sentry: error monitoring

DATA FLOW (Save a URL):
Mobile App → POST /saves → Backend validates → BullMQ queue → 
AI Worker → OpenAI categorises → Supabase updated → 
Supabase Realtime → Mobile App updates live

1.2 Data Flow: Saving Content (Critical Path)
Step	What Happens
1	User taps Share in Instagram → selects Oshi from share sheet
2	iOS Share Extension activates. Extracts URL from share payload.
3	Extension stores URL in App Group UserDefaults ('oshi_pending_share').
4	Extension calls POST /saves with the URL + user JWT (from SecureStore).
5	Backend validates JWT via Supabase. Checks save limit (free tier). Creates saves record with status='pending'. Returns { id, status: 'pending' } in <300ms.
6	Backend adds job to BullMQ 'ai-processing' queue with { save_id, url, platform }.
7	Share Extension shows confirmation card. User is returned to Instagram.
8	BullMQ worker picks up job. Fetches URL metadata (Open Graph / YouTube API / Cheerio).
9	Worker calls OpenAI GPT-4o-mini with structured prompt. Receives JSON: category, content_type, summary, tags, confidence_score.
10	Worker updates saves record: processing_status='complete', category, summary, tags, thumbnail_url.
11	Supabase Realtime fires a change event to the mobile app (subscribed to saves table for this user).
12	App receives realtime event. Content card updates with AI data — no manual refresh needed.
1.3 Data Flow: Daily Reminder Notifications
Step	What Happens
1	BullMQ notification-scheduler worker runs every minute.
2	Worker queries: SELECT * FROM users WHERE reminder_time IS WITHIN CURRENT MINUTE AND subscription_status != 'deleted' AND deleted_at IS NULL
3	For each qualifying user: check if they have unread saves. If none, skip.
4	Check if user opened app within last 2 hours (last_opened_at). If yes, skip.
5	Build personalised notification: find category with most unread saves, get most recent save title.
6	Call Expo Push API with Expo push token. Attach category deep link URL.
7	Log notification in notification_logs table.
8	User receives push notification. Taps it.
9	App opens via deep link oshi://library/[category_slug]. Navigation routes to correct category tab.
10	App calls POST /notifications/log-open to mark notification as opened.
1.4 Infrastructure Components
Component	Service & Configuration
Backend API	Railway.app — Node.js service. Auto-scaling enabled. Health check endpoint: GET /health. Deploy on git push to main branch.
Redis	Railway Redis add-on — connected to backend via REDIS_URL env var. Used exclusively by BullMQ for job queue.
PostgreSQL	Supabase managed Postgres. Connection via Prisma ORM using DATABASE_URL. Connection pooling via Supabase PgBouncer (use ?pgbouncer=true in connection string for serverless).
File Storage	Supabase Storage — 'avatars' bucket (private). Files served via Supabase CDN with signed URLs.
Authentication	Supabase Auth — handles JWT issuance, refresh, OAuth flows. Apple and Google OAuth configured in Supabase dashboard.
Realtime	Supabase Realtime — Postgres change notifications. Subscribed client-side to saves table filtered by user_id.
Push Notifications	Expo Push Notification Service — wraps APNs (iOS) and FCM (Android). Backend calls Expo API; Expo handles platform routing.
CI/CD	GitHub Actions — runs on push to main. Runs tests, then triggers Railway deploy via Railway deploy hook.
1.5 Security Architecture
Layer	Security Measure
Transport	All connections HTTPS/TLS 1.2+. HSTS headers on all API responses.
Authentication	Supabase JWT — RS256 signed. 1-hour access token, 30-day refresh token. Tokens stored in SecureStore, never AsyncStorage.
Database	RLS policies on all tables. Backend uses service role key only for admin operations (webhook, cron). All user requests validated via JWT.
API	JWT validation middleware on all protected routes. Rate limiting via express-rate-limit. Input validation via zod schemas.
AI Processing	OpenAI API key server-side only. URLs sent to OpenAI — inform users in Privacy Policy.
Payments	RevenueCat handles all payment data. Oshi never sees card numbers. Webhook validated via shared secret.
Storage	Supabase Storage RLS — users can only access their own avatar. Signed URLs expire in 1 hour.

