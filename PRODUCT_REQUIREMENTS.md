OSHI
Product Requirements Document v2.0
Smart Content Inbox — Save Anything, Revisit Everything
Platform: iOS & Android (React Native + Expo)  •  Developer Tool: Cursor IDE
Version 2.0  •  February 2026  •  Supersedes v1.0
 
1. Product Overview
1.1 Vision Statement
Oshi is a mobile-first smart content inbox that lets users save any piece of content discovered while doom scrolling — videos, articles, social posts, podcasts, products — and automatically organises it into meaningful categories using AI. Oshi reminds users at their preferred time to revisit saved content, transforming passive scrolling into intentional, actionable consumption.
The name 'Oshi' derives from Japanese: a dedicated favourite — something deeply followed and supported. Oshi represents the content users actually care about, rescued from the noise.
1.2 Problem Statement
Every day, people encounter genuinely valuable content while scrolling but the context in that moment makes immediate engagement impossible. Existing solutions are broken:
•	Sending content to yourself via DM creates a graveyard of unread links buried in conversation threads.
•	Native platform Save features are siloed — Instagram saves stay on Instagram, YouTube saves on YouTube. No unified cross-platform view.
•	Generic bookmarking apps (Pocket, Instapaper) are desktop-first, have poor social media link handling, and offer no AI organisation or reminders.
•	No existing product combines cross-platform saving, AI categorisation, and behavioural re-engagement reminders in a mobile-first experience.
1.3 App Icon & Visual Identity
The Oshi icon concept: A bold, stylised letter 'O' that doubles as an abstract inbox or container shape. The O has a subtle downward arrow element integrated into its negative space, symbolising 'drop in' or 'save here.' Rendered in the primary navy (#1A1A2E) on a clean white or off-white background. The style is geometric, minimal, and confident — no gradients in v1.
Icon specifications required by Xcode and Google Play:
•	iOS: 1024x1024px PNG (master), no transparency, no rounded corners (iOS applies rounding automatically)
•	Android: 512x512px PNG for Play Store listing; adaptive icon with foreground layer (108x108dp) and background layer
•	Splash screen: 1284x2778px (iPhone 14 Pro Max), centered Oshi wordmark on #1A1A2E background, exported as PNG
•	In Expo: configure via app.json — icon field for iOS, android.adaptiveIcon for Android
⚠️ The developer must use placeholder assets matching these dimensions from day one. Mismatched dimensions cause App Store rejection.

2. Goals & Success Metrics
2.1 Business Goals
•	10,000 downloads within 90 days of launch on iOS and Android.
•	30% conversion rate from free tier to Oshi Pro within 6 months.
•	Monthly churn rate below 5% for Pro subscribers.
•	4.5+ star average rating on both App Store and Google Play within 3 months.
2.2 Key Performance Indicators
Metric	Target (Month 3)
Monthly Active Users	5,000+
Daily Active Users	1,500+
Avg. items saved per user/month	25+
Pro conversion rate	20%+
Notification open rate	40%+
AI categorisation override rate	<15%
Day-7 retention	45%+
Day-30 retention	25%+
Free Trial to Pro conversion	30%+

3. Features & Functional Requirements
3.1 Share Extension
3.1.1 Core Flow
1.	User sees content in any app and taps the native Share button.
2.	User selects 'Oshi' from the share sheet.
3.	Oshi share extension modal appears as an overlay — user never leaves the originating app.
4.	Extension shows a skeleton loader for up to 1.5 seconds while queuing the URL to the backend.
5.	Confirmation card appears: thumbnail, title, assigned category badge, 'Saved to Oshi ✓'.
6.	Light haptic fires on save confirmation (expo-haptics: ImpactFeedbackStyle.Light).
7.	User can tap the category badge to change it from a bottom sheet picker.
8.	Auto-dismisses after 3 seconds or user taps Done. User is back in the originating app.
9.	If offline: shows 'Queued — will save when back online' and stores in AsyncStorage queue.
3.1.2 Supported Platforms — Phase 1
Platform	Content & Metadata Behaviour
Instagram	⚠️ LIMITED: Instagram actively blocks scraping. Oshi uses Open Graph tags only (og:title, og:image, og:description). No video duration, no full caption, no engagement stats. The confirmation card shows 'Instagram preview may be limited' subtitle. AI categorises from the partial caption. Expected accuracy: ~75%.
YouTube	FULL: YouTube Data API v3. Fields: snippet.title, snippet.description, snippet.thumbnails.maxres, snippet.channelTitle, contentDetails.duration (ISO 8601 → convert to seconds), statistics.viewCount. Extract video ID from URL using regex.
TikTok	PARTIAL: Open Graph tags only. Same limitation as Instagram. Note in card: 'TikTok preview may be limited'.
Safari / Chrome	FULL: Open Graph + full page text extraction via Cheerio. Best metadata quality.
Twitter / X	PARTIAL: Open Graph title and description. Twitter cards if available.
LinkedIn	PARTIAL: Open Graph tags. Article content if public.
Spotify	FULL: Spotify Embed API for podcast/episode metadata including duration.
Any URL	FALLBACK: Open Graph tags + page title. Cheerio extraction of first 500 words for AI context.
⚠️ Never attempt to scrape instagram.com, tiktok.com, or twitter.com server-side beyond Open Graph. These platforms actively block scrapers and will result in IP bans for the backend server.
3.1.3 iOS Share Extension Technical Setup
•	Create a new Xcode target of type 'Share Extension' named 'OshiShareExtension'.
•	Add App Group entitlement: group.com.oshi.app — shared between main app and extension.
•	NSExtensionActivationRule in Info.plist: NSExtensionActivationSupportsWebURLWithMaxCount = 1.
•	Extension stores shared URL in App Group UserDefaults under key 'oshi_pending_share'.
•	Main app checks App Group on foreground and processes any pending share.
•	Extension UI: React Native component rendered via react-native-share-extension package.
•	Maximum extension memory: 120MB. Keep extension bundle lean — no heavy SDKs.
•	Extension must handle cold start (app process not running) within 1.5 seconds.
3.1.4 Android Share Intent Setup
•	Register in AndroidManifest.xml: intent-filter with action android.intent.action.SEND and mimeType text/plain.
•	Also register text/html and text/* for broader URL capture.
•	Create ShareHandlerActivity.kt (minimal native activity) that extracts the URL from Intent extras.
•	ShareHandlerActivity calls the React Native bridge to render the same confirmation card UI.
•	Handle cold start: Activity initialises the React Native bridge, shows confirmation card, user taps Done, activity finishes.
3.1.5 Offline Save Queue
•	When device has no internet during a share: store the URL + timestamp in AsyncStorage under key 'oshi_offline_queue' as a JSON array.
•	On app foreground and on network reconnection (NetInfo event), check the queue and process all pending saves.
•	Show a non-blocking banner: 'X saves queued — syncing now...' with a progress indicator.
•	Clear processed items from the queue after successful API response.
3.2 AI Processing Engine
3.2.1 Full OpenAI Prompt Template
The following is the exact system prompt and user message structure to send to OpenAI GPT-4o-mini. This must be implemented verbatim in backend/src/services/aiService.ts:
SYSTEM PROMPT: You are a content categorisation assistant for Oshi, a smart content inbox app. Your job is to analyse content metadata and return a structured JSON classification. You must return ONLY a valid JSON object — no explanation, no markdown, no backticks.  Available categories: Learning, Business, Travel, Food, Fitness, Entertainment, Shopping, Inspiration, Tech, People, Other  Content types: short_video, long_video, article, podcast, post, product, image, other  USER MESSAGE TEMPLATE: {   "url": "<the full URL>",   "platform": "<instagram|youtube|tiktok|web|twitter|linkedin|spotify|other>",   "title": "<og:title or page title>",   "description": "<og:description or meta description, first 300 chars>",   "text_snippet": "<first 500 words of page text if available, else empty string>",   "channel_or_author": "<creator name if available, else empty string>",   "duration_seconds": <integer if video/podcast, else 0> }  REQUIRED JSON RESPONSE FORMAT: {   "category": "<one of the 11 categories above>",   "content_type": "<one of the 8 types above>",   "summary": "<1-2 sentences, max 120 characters, present tense, no spoilers>",   "tags": ["<tag1>", "<tag2>", "<tag3>"],   "confidence_score": <float 0.0 to 1.0>,   "estimated_read_time_seconds": <integer — for articles use word_count/3.33, for video use duration, for posts use 30> }
•	If confidence_score < 0.6: set category to 'Other', still return summary and tags.
•	Temperature: 0.2 (low randomness for consistent categorisation).
•	Max tokens: 200 (response is always small JSON).
•	Model: gpt-4o-mini.
•	Retry logic: 3 attempts with exponential backoff: 1s, 2s, 4s. On all retries failed: save with processing_status='failed'.
3.2.2 AI Smart Sort Algorithm
The AI Recommended sort order surfaces the most relevant content to the top of each category based on the following weighted scoring:
Signal	Weight & Logic
Recency	30% — items saved in last 24 hours score 1.0, decaying to 0.3 after 7 days
Content length	25% — shorter content scores higher (quick wins: <5 min = 1.0, >30 min = 0.3)
User engagement pattern	25% — tracks what content_type and category user actually opens vs skips. If user opens 80% of Business articles but only 20% of Business videos, articles score higher for that user.
Notification context	20% — if item was featured in a notification the user opened, score +0.2 boost
Smart sort score is calculated server-side on GET /saves and cached per user per category for 1 hour. Recalculated on new save, mark-done, or skip action.
Store engagement signals in a new table: user_engagement_signals (user_id, content_type, category_id, action: 'opened'|'skipped'|'done', created_at).
3.2.3 Dead Link Detection
Background job runs nightly (2 AM UTC) for all saves that are >7 days old and have not been marked done:
•	Send a HEAD request to the saved URL with a 5-second timeout.
•	If response is 404, 410, or connection refused: set saves.link_status = 'unavailable'.
•	If response is 401 or 403 (private content): set saves.link_status = 'private'.
•	If response is 200: keep saves.link_status = 'active'.
•	Add link_status column to saves table: ENUM('active', 'unavailable', 'private'), default 'active'.
•	Content cards with link_status != 'active' show a warning badge: 🔒 Private or ⚠️ Unavailable.
3.3 Home Screen — The Library
3.3.1 Layout & Skeleton Loading
On app open, while fetching saves from the backend, display skeleton loader cards:
•	Skeleton cards match the exact dimensions of real OshiCards in the current view mode (grid or list).
•	Animate using a left-to-right shimmer effect (Reanimated 2 shared value cycling 0→1 on a 1.2-second loop).
•	Show 6 skeleton cards in grid mode, 4 in list mode.
•	Skeleton cards fade out and real cards fade in using a staggered 150ms delay per card.
•	If data loads in under 300ms, skip skeleton and show content directly to avoid a flash.
3.3.2 Empty States
Global empty state (no saves at all — new user):
•	Full-screen animated illustration: a phone with a tiny animated arrow entering an inbox icon. Lottie animation, 2-second loop.
•	Headline: 'Your saved content will appear here'
•	Subtext: 'Go to Instagram or YouTube, find something you love, tap Share, and choose Oshi.'
•	CTA button: 'How to Save Your First Item' — opens a 3-step bottom sheet tutorial.
Per-category empty state (category exists but has no saves):
•	Category-specific illustration (different per category — e.g. graduation cap for Learning, briefcase for Business, plane for Travel).
•	Headline: 'Nothing in [Category Name] yet'
•	Subtext: category-specific tip, e.g. for Business: 'Save business tips, startup advice, productivity hacks, and money content here.'
•	No CTA button — keep it minimal. The reminder of what to save is enough.
3.3.3 Content Card States
State	Visual Treatment
Unread (default)	Full colour thumbnail, white card background, normal opacity.
Done	Thumbnail has 50% opacity overlay, green checkmark badge in top-right corner, card has a subtle #F0FDF4 green-tinted background. Card moves to bottom of list on next refresh (not instantly — avoid jarring reorder mid-session).
Skipped	Thumbnail has 30% opacity, grey diagonal 'skip' badge. Card de-emphasised but not hidden. Can be un-skipped via three-dot menu.
Processing (pending)	Thumbnail shows platform colour gradient placeholder. Title shows 'Processing...' in muted grey italic. A subtle pulse animation on the title.
Failed	Warning icon overlay on thumbnail. Title: '[Platform] content — tap to retry'. Retry triggers re-queue to AI processor.
Unavailable	⚠️ badge on thumbnail. Title shown in muted grey. 'Open in [Platform]' button still shown but tapping shows: 'This content may no longer be available on [Platform].'
Private	🔒 badge on thumbnail. Note: 'This content is now private or requires login.'
3.3.4 Swipe Gestures
•	Implement using react-native-gesture-handler and react-native-reanimated 2.
•	Swipe right (≥80px): Reveals green 'Done' background with checkmark icon. On release past threshold (160px): marks as Done + fires ImpactFeedbackStyle.Medium haptic + shows Undo toast.
•	Swipe left (≥80px): Reveals red 'Delete' background with trash icon. On release past threshold (160px): shows confirmation — 'Delete this save?' with Yes/Cancel. On confirm: deletes + shows Undo toast.
•	Gestures only active in List view. Grid view uses the three-dot menu for actions (cards too small for reliable swipe).
•	The swipe gesture must not conflict with the horizontal ScrollView of category tabs. Implement proper gesture handler prioritisation.
3.3.5 Multi-Select Mode
•	Triggered by: long press on any content card (500ms press duration).
•	On activation: card shows a circular checkbox in top-left. All other cards show empty circular checkboxes. Top navigation bar changes to show 'X Selected' count and action icons.
•	Bulk actions available: Mark Done, Skip, Move to Category, Delete.
•	'Move to Category' opens a bottom sheet with category list picker.
•	'Select All in Category' button appears in the action bar when ≥1 item is selected.
•	Deactivate multi-select: tap the X in the action bar, or tap outside any card, or press back.
•	Haptic on multi-select activation: ImpactFeedbackStyle.Heavy.
3.3.6 Undo Toast
•	After every Mark as Done, Skip, or Delete action: show an Undo toast at the bottom of the screen above the tab bar.
•	Toast content: '[Action] — Undo' e.g. 'Marked as Done — Undo' or 'Deleted — Undo'.
•	Auto-dismisses after 5 seconds with a visible progress bar shrinking from full width to zero.
•	Tapping 'Undo' reverses the action and restores the card to its previous state and position.
•	Only one Undo toast active at a time. A new action replaces the previous toast.
•	Toast is NOT shown for bulk actions (too complex to undo multiple items). Bulk delete shows a confirmation dialog instead.
3.3.7 Sort Options
•	Sort control: a segmented control or dropdown accessible via a filter icon in the top-right of the Library screen.
Sort Option	Behaviour
AI Recommended (default)	Smart sort score calculated server-side. See Section 3.2.2 for algorithm.
Most Recent	Sorted by saved_at DESC.
Oldest First	Sorted by saved_at ASC.
Shortest First	Sorted by estimated_read_time_seconds ASC. Null values go last.
Manual	User drag-to-reorder. Saves a sort_order integer per save per user. Drag handled by react-native-draggable-flatlist.
•	Selected sort preference is persisted per category in AsyncStorage (key: 'oshi_sort_[category_id]').
•	Manual sort order stored in saves.manual_sort_order (integer, nullable) in the database.
3.3.8 Search
Search bar is always visible at the top of the Library. Searching is real-time (debounced 300ms).
•	Search scope: content title, AI-generated summary, user's personal notes, tags, creator/author name.
•	Platform name is NOT in search scope — platform filtering is handled by a dedicated filter pill row.
•	Search highlights matching terms in the card title with a yellow background highlight.
•	Search results show across all categories regardless of active category tab.
•	Empty search state: 'No results for "[query]"' with suggestion to try different keywords.
3.4 Reminder & Notification System
3.4.1 Daily Reminder
•	User sets reminder time during onboarding. Stored as UTC in users.reminder_time.
•	Reminder modes: Daily, Weekdays only, Weekends only, Custom days (multi-select).
•	Notification content: 'Your [Category] picks are ready [emoji]' — uses category with most unread items.
•	Body: title of most recently saved item + count of others. Example: 'How to think like Elon Musk — and 4 more Business saves.'
•	Rich notification: thumbnail image attached (iOS 15+, Android 8+).
•	Notification deep link: oshi://library/[category_slug] — opens Library to that category tab.
3.4.2 Smart Notification Logic
•	Do NOT send notification if: user has zero unread saves, OR user opened Oshi within 2 hours before the reminder time.
•	If reminder fires while app is in foreground: show in-app toast banner at top — 'Your [Category] picks are ready' — auto-dismisses after 4 seconds. No OS-level notification fired.
•	Notification permission denied during onboarding: proceed normally. On day 3, if user has saved ≥3 items, show contextual in-app modal: 'You've saved [N] things — want Oshi to remind you to actually watch them? Enable reminders.' with 'Go to Settings' button that deep links to iOS/Android notification settings for Oshi.
3.4.3 Free Trial Expiry Notifications
•	24 hours before trial expires: send push notification — 'Your Oshi Pro trial ends tomorrow. Keep unlimited saves and smart reminders.'
•	On the day of expiry: show in-app banner at the top of the Library — 'Your Pro trial ends today — upgrade to keep everything' with 'Upgrade Now' CTA button.
•	Both notifications use RevenueCat's entitlement expiry webhook to trigger. Backend receives webhook, schedules the notifications.
3.4.4 Streak System
•	Streak increments by 1 each day the user opens the app via a reminder notification AND views at least one content detail.
•	Streak resets to 0 if user misses a day entirely (no engagement on their reminder day) — Duolingo-style hard reset.
•	Grace period: NONE. Missing one day resets to zero. This is intentional and motivating.
•	Streak milestones with celebrations: 3, 7, 14, 30, 60, 100 days.
•	Milestone celebration: full-screen confetti animation (react-native-confetti-cannon) + strong haptic (NotificationFeedbackType.Success) + in-app badge unlocked.
•	Streak displayed as a flame emoji counter on the home screen header.
•	Streak freeze: NOT available in v1. Users who want grace periods can upgrade to Pro in a future version that offers streak freezes.
3.5 Onboarding Flow
3.5.1 Screen Sequence
10.	Welcome — 'Your content. Organised. Revisited.' Full-screen Lottie animation. CTA: 'Get Started'. Skip button in top-right corner (skips to account creation).
11.	Value 1 — Save Anything. Skip button. CTA: 'Next'.
12.	Value 2 — AI Organises. Skip button. CTA: 'Next'.
13.	Value 3 — Never Forget. Skip button. CTA: 'Next'.
14.	Account Creation — NO skip. Apple Sign In, Google Sign In, Email/Password. Terms of Service and Privacy Policy links visible. Email flow: email field → password field (min 8 chars, 1 number) → confirm password.
15.	Reminder Setup — Time picker pre-filled at 7:00 PM. Day selector. CTA: 'Set My Reminder'. Skip button: 'Skip for now' (sets default 7 PM daily).
16.	Notification Permission — system permission prompt fires here. If denied: continue silently (day-3 re-request handles this later).
17.	Share Sheet Setup Guide — step-by-step animated GIF showing iOS share sheet setup. CTA: 'Done — Let's Go'. Skip button.
18.	First Save Prompt — 'Try saving something right now.' Sample card shown. CTA: 'Open Instagram' (deep links to Instagram). Skip button: 'I'll try later'.
⚠️ Steps 1–4 have skip buttons. Step 5 (account creation) has no skip. Steps 6–9 have skip buttons. This is the required flow.
3.5.2 Password Reset Flow
•	On Login screen: 'Forgot password?' link below the password field.
•	Tapping opens a single-field screen: 'Enter your email address' with 'Send Reset Link' button.
•	Calls Supabase Auth resetPasswordForEmail(). Supabase sends a reset email.
•	Success screen: 'Check your email — we've sent a reset link.' Back to Login button.
•	On iOS: the reset link opens the app via deep link oshi://auth/reset?token=[token] and shows a new password screen.
•	Deep link handler: extract token, call Supabase updateUser() with new password.
3.5.3 Session Management
•	Use Supabase's built-in session refresh. Access tokens expire every 1 hour; Supabase SDK auto-refreshes using the refresh token.
•	Store session in Expo SecureStore (key: 'oshi_session'). NEVER AsyncStorage.
•	On app open: call supabase.auth.getSession(). If valid session exists, proceed to Library. If no session, go to Onboarding/Login.
•	On 401 API response: attempt one silent token refresh. If refresh fails: clear SecureStore, redirect to Login with message 'Your session expired — please sign in again.'
•	Auto-logout after 30 days of no app open (refresh token expiry). This is handled by Supabase automatically.
3.6 Content Detail View
•	Full-width 16:9 thumbnail at the top (aspect ratio enforced, fallback: platform gradient placeholder).
•	Platform badge + content type label (e.g. 'YouTube • Long Video').
•	Full title (no truncation in detail view).
•	Creator/channel name with a small avatar if available.
•	AI summary (full 1–2 sentences, styled in slightly larger italic text).
•	Tags displayed as horizontally scrollable pills below the summary.
•	Estimated time: '8 min read' or '14 min watch' with a clock icon.
•	Date saved: 'Saved 3 days ago' (relative time).
•	Primary CTA: 'Open in [Platform]' — large, full-width, accent colour button. Deep links to original content.
•	Opening content: use Linking.openURL(). On return to Oshi, do NOT auto-mark as done. User must explicitly mark done.
•	Secondary actions row: Mark Done, Skip, Change Category, Add Note, Copy Link, Share, Delete.
•	Personal Note section: expandable text area. Placeholder: 'Add your thoughts...' Notes are searchable.
•	If link_status is 'unavailable' or 'private': show inline warning banner between summary and CTA. CTA still shown but tapping shows alert.
3.7 Profile & Settings
3.7.1 Profile Screen
•	Initials avatar displayed as a large circle with accent colour background. Initials auto-generated from display name (e.g. 'MR' for Murtaza Rasheed).
•	Profile photo upload: tap the avatar circle to open an action sheet: 'Take Photo' or 'Choose from Library'.
•	Photo upload flow: expo-image-picker → compress to max 500KB (use expo-image-manipulator) → upload to Supabase Storage bucket 'avatars' → path: avatars/[user_id]/profile.jpg → update users.avatar_url.
•	Display name: editable inline — tap to enter edit mode, shows text field, tap Save.
•	Email: displayed but NOT editable inline. 'Change Email' navigates to a dedicated screen.
•	Streak display: flame icon + current streak count.
•	Pro badge: displayed if subscription_status = 'pro'.
•	Saved stats: 'X items saved', 'Y items done', 'Z categories'.
3.7.2 Reminder Settings
•	Daily reminder time: time picker.
•	Reminder days: toggle chips for Mon–Sun.
•	Morning Digest toggle (Pro feature): sends a brief morning summary at 8 AM of items saved yesterday.
•	Per-category reminder times (Pro): expandable section showing each category with an optional override time.
3.7.3 Category Management
•	List of all categories in drag-to-reorder order (react-native-draggable-flatlist).
•	Tap category row to edit: rename, change emoji, change reminder override (Pro).
•	Swipe left on a category to delete. Confirmation: 'Delete [Category]? All saves in this category will move to Other.'
•	'Add Category' button at bottom. Free: disabled if at 3 category limit, shows upgrade prompt. Pro: unlimited.
3.7.4 Subscription Downgrade Behaviour
•	When RevenueCat webhook signals cancellation: set subscription_status = 'cancelled', subscription_expires_at = end of current billing period.
•	At subscription_expires_at: set subscription_status = 'free'.
•	All existing saves and categories are PRESERVED. User can view all content.
•	New saves are blocked once the user's save count exceeds 20 in the current month OR they have more than 3 active categories. Show paywall on the blocked action.
•	A persistent soft banner on the Library: 'You're on the free plan — some features are limited. Upgrade to Pro.' Dismissible once per session.
3.7.5 Account Deletion
•	Accessible via Settings → Account → Delete Account.
•	Two-step confirmation: (1) 'Are you sure?' with consequences listed. (2) Type 'DELETE' in a text field to confirm.
•	On confirm: set users.deleted_at = NOW(). All user data is retained in DB for 30 days.
•	A nightly job purges all data for users where deleted_at < NOW() - 30 days.
•	User is immediately signed out and returned to onboarding.
•	During the 30-day window: if user signs back in with the same email, offer to restore their account.

4. Deep Link URL Scheme
Oshi uses a custom URL scheme for push notification deep links, password reset, and OAuth redirects. Register in app.json under scheme: 'oshi'.
Deep Link URL	Destination & Behaviour
oshi://library	Opens Library, default (All) tab
oshi://library/[category_slug]	Opens Library, scrolls to specified category tab. category_slug is lowercase category name with hyphens e.g. 'business', 'travel', 'learning'
oshi://save/[save_id]	Opens content detail view for the specified save
oshi://auth/reset?token=[token]	Password reset flow — opens new password screen
oshi://onboarding	Returns to onboarding (used after account deletion)
oshi://settings/reminders	Opens reminder settings screen directly
oshi://settings/subscription	Opens subscription/paywall screen directly
oshi://notifications/enable	Deep links to iOS/Android notification settings for Oshi (used in day-3 re-request)
Deep link handling: in App.tsx, use Linking.addEventListener and Linking.getInitialURL() on cold start. Route based on URL path using the navigation ref.

5. Technical Architecture
5.1 Technology Stack
Layer	Technology & Version
Mobile Framework	React Native 0.74.x with Expo SDK 51
Language	TypeScript 5.x — strict mode throughout
Navigation	React Navigation v6 — native stack + bottom tabs
State Management	Zustand 4.x
Animations	React Native Reanimated 3.x — ALL animations, never use Animated from RN core
Gestures	React Native Gesture Handler 2.x
Backend	Node.js 20 LTS + Express 4.x
ORM	Prisma 5.x
Database	PostgreSQL via Supabase
Auth	Supabase Auth (Apple, Google, Email)
Realtime	Supabase Realtime (Postgres changes)
Storage	Supabase Storage (avatars bucket)
AI	OpenAI GPT-4o-mini via REST API
Push Notifications	Expo Push Notifications (wraps APNs + FCM)
In-App Purchases	RevenueCat SDK (react-native-purchases ^7.x)
Job Queue	BullMQ 5.x + Redis (Railway Redis add-on)
Metadata Scraping	Cheerio 1.x + Axios 1.x
YouTube API	YouTube Data API v3 (Google Cloud Console)
Analytics	PostHog React Native SDK
Error Monitoring	Sentry React Native SDK
Image Handling	expo-image (display) + expo-image-manipulator (compression)
Image Picker	expo-image-picker
Haptics	expo-haptics
Secure Storage	expo-secure-store (JWT only — never AsyncStorage for auth)
Offline Queue	AsyncStorage (for offline save queue only)
Drag & Drop	react-native-draggable-flatlist
Confetti	react-native-confetti-cannon
Bottom Sheet	react-native-bottom-sheet 4.x
In-App Purchases	RevenueCat react-native-purchases 7.x
5.2 Three Environments
Environment	Purpose & Configuration
Development	Local machine. Backend runs on localhost:3000. Uses Supabase dev project. Uses RevenueCat sandbox. Uses Expo Go for device testing. .env.development file.
Staging	Deployed backend on Railway (separate service). Separate Supabase project. RevenueCat sandbox. EAS build profile 'staging'. Used for QA testing before release.
Production	Deployed backend on Railway (production service). Production Supabase project. RevenueCat production keys. EAS build profile 'production'. App Store / Google Play builds only.
In app.json, configure three EAS build profiles under 'build': development, staging, production. Each points to different EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_SUPABASE_URL values.
5.3 Database Schema
Table: users
Column	Type & Notes
id	UUID — PK, auto-generated by Supabase Auth
email	TEXT NOT NULL
display_name	TEXT
avatar_url	TEXT — Supabase Storage URL
created_at	TIMESTAMPTZ DEFAULT NOW()
subscription_status	TEXT DEFAULT 'free' — values: free, trial, pro, cancelled
subscription_expires_at	TIMESTAMPTZ
reminder_time	TIMETZ DEFAULT '19:00:00+00'
reminder_days	JSONB DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]'
timezone	TEXT DEFAULT 'UTC'
streak_count	INTEGER DEFAULT 0
streak_last_engaged_date	DATE — date of last qualifying engagement
last_opened_at	TIMESTAMPTZ
notification_token	TEXT — Expo push token
notification_permission	TEXT DEFAULT 'not_asked' — values: not_asked, granted, denied
notification_reask_shown	BOOLEAN DEFAULT FALSE
deleted_at	TIMESTAMPTZ — soft delete timestamp
items_saved_this_month	INTEGER DEFAULT 0 — reset on 1st of month by cron job
trial_started_at	TIMESTAMPTZ — when 7-day trial began
Table: categories
Column	Type & Notes
id	UUID — PK
user_id	UUID — FK to users.id ON DELETE CASCADE
name	TEXT NOT NULL
emoji	TEXT DEFAULT '📌'
reminder_override_time	TIMETZ — Pro feature, nullable
sort_order	INTEGER DEFAULT 0
is_system_default	BOOLEAN DEFAULT FALSE — for the 11 default categories
created_at	TIMESTAMPTZ DEFAULT NOW()
Table: saves
Column	Type & Notes
id	UUID — PK
user_id	UUID — FK to users.id ON DELETE CASCADE
category_id	UUID — FK to categories.id
url	TEXT NOT NULL
title	TEXT
summary	TEXT — max 300 chars, AI-generated
thumbnail_url	TEXT
platform	TEXT — instagram, youtube, tiktok, web, twitter, linkedin, spotify, other
content_type	TEXT — short_video, long_video, article, podcast, post, product, image, other
tags	JSONB DEFAULT '[]'
creator_name	TEXT
estimated_time_seconds	INTEGER
ai_confidence_score	FLOAT
processing_status	TEXT DEFAULT 'pending' — pending, processing, complete, failed
status	TEXT DEFAULT 'unread' — unread, done, skipped
done_at	TIMESTAMPTZ
skipped_at	TIMESTAMPTZ
user_note	TEXT
saved_at	TIMESTAMPTZ DEFAULT NOW()
viewed_at	TIMESTAMPTZ
link_status	TEXT DEFAULT 'active' — active, unavailable, private
manual_sort_order	INTEGER — nullable, used for manual drag sort
Table: user_engagement_signals
Column	Type & Notes
id	UUID — PK
user_id	UUID — FK to users.id ON DELETE CASCADE
save_id	UUID — FK to saves.id ON DELETE CASCADE
content_type	TEXT
category_id	UUID
action	TEXT — opened, skipped, done
created_at	TIMESTAMPTZ DEFAULT NOW()
Table: notification_logs
Column	Type & Notes
id	UUID — PK
user_id	UUID — FK to users.id
sent_at	TIMESTAMPTZ DEFAULT NOW()
notification_type	TEXT — daily_reminder, trial_expiry_warning, trial_expiry_day, reengagement
category_id	UUID — nullable
item_count	INTEGER
opened	BOOLEAN DEFAULT FALSE
opened_at	TIMESTAMPTZ
5.4 Supabase Row Level Security Policies
⚠️ RLS must be enabled on ALL tables. The following SQL policies must be applied exactly. Without these, any authenticated user can access any other user's data.
-- Enable RLS on all tables ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE categories ENABLE ROW LEVEL SECURITY; ALTER TABLE saves ENABLE ROW LEVEL SECURITY; ALTER TABLE user_engagement_signals ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;  -- users: users can only read/update their own row CREATE POLICY "users_select_own" ON users FOR SELECT USING (auth.uid() = id); CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = id);  -- categories: full CRUD on own categories only CREATE POLICY "categories_all_own" ON categories FOR ALL USING (auth.uid() = user_id);  -- saves: full CRUD on own saves only CREATE POLICY "saves_all_own" ON saves FOR ALL USING (auth.uid() = user_id);  -- engagement signals: full CRUD on own signals CREATE POLICY "signals_all_own" ON user_engagement_signals FOR ALL USING (auth.uid() = user_id);  -- notification_logs: read-only for users (backend writes via service role key) CREATE POLICY "notif_logs_select_own" ON notification_logs FOR SELECT USING (auth.uid() = user_id);  -- Storage: avatars bucket policy -- Users can only upload/update their own avatar CREATE POLICY "avatar_upload_own" ON storage.objects FOR INSERT   WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]); CREATE POLICY "avatar_select_own" ON storage.objects FOR SELECT   USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]); CREATE POLICY "avatar_update_own" ON storage.objects FOR UPDATE   USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
5.5 Backend CORS Configuration
// In backend/src/index.ts import cors from 'cors';  const allowedOrigins = [   'http://localhost:8081',           // Expo dev server   'http://localhost:3000',           // Local backend   'exp://192.168.x.x:8081',         // Expo Go on device (dynamic — use regex)   'https://oshi-staging.railway.app', // Staging   'https://api.oshi.app',           // Production ];  app.use(cors({   origin: (origin, callback) => {     if (!origin || allowedOrigins.some(o => origin.startsWith(o)) ||         /^exp:\/\/192\.168\./.test(origin)) {       callback(null, true);     } else {       callback(new Error('Not allowed by CORS'));     }   },   credentials: true,   methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],   allowedHeaders: ['Content-Type', 'Authorization'], }));
5.6 RevenueCat Native Setup
iOS Setup
•	Add react-native-purchases to package.json.
•	Run: npx pod-install (installs native iOS dependencies).
•	In AppDelegate.mm: import RCTPurchases and call [RCTPurchases addAttributionData:fromNetwork:] if needed.
•	In Xcode: add StoreKit capability to the main app target (not the share extension).
•	In Xcode: add In-App Purchase capability.
•	In app.json plugins: add 'react-native-purchases' to the plugins array for EAS Build compatibility.
Android Setup
•	In android/build.gradle: ensure minSdkVersion is 21.
•	In AndroidManifest.xml: add com.android.vending.BILLING permission.
•	No additional native code required for Android — the npm package handles it.
SDK Initialisation (app/src/services/purchases.ts)
import Purchases, { LOG_LEVEL } from 'react-native-purchases'; import { Platform } from 'react-native';  export async function initialisePurchases(userId: string) {   const apiKey = Platform.OS === 'ios'     ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY!     : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY!;    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);    await Purchases.configure({ apiKey });   await Purchases.logIn(userId); }  // Product identifiers — must match what's configured in RevenueCat dashboard export const PRODUCT_IDS = {   monthly: 'oshi_pro_monthly',   annual: 'oshi_pro_annual', };  export const ENTITLEMENT_ID = 'pro';
5.7 YouTube Data API Integration
// Extract video ID from YouTube URL function extractYouTubeId(url: string): string | null {   const patterns = [     /youtube\.com\/watch\?v=([^&]+)/,     /youtu\.be\/([^?]+)/,     /youtube\.com\/shorts\/([^?]+)/,     /youtube\.com\/embed\/([^?]+)/,   ];   for (const pattern of patterns) {     const match = url.match(pattern);     if (match) return match[1];   }   return null; }  // YouTube API call — fields requested const YT_API_URL = 'https://www.googleapis.com/youtube/v3/videos'; const params = {   id: videoId,   key: process.env.YOUTUBE_DATA_API_KEY,   part: 'snippet,contentDetails,statistics',   fields: 'items(snippet(title,description,thumbnails/maxres,channelTitle),contentDetails/duration,statistics/viewCount)', };  // Parse ISO 8601 duration to seconds function parseDuration(iso: string): number {   const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);   if (!match) return 0;   return (parseInt(match[1] || '0') * 3600) +          (parseInt(match[2] || '0') * 60) +           parseInt(match[3] || '0'); }
5.8 Sentry Configuration
•	Initialise Sentry in app/src/App.tsx using @sentry/react-native.
•	Set environment tag to process.env.APP_ENV ('development'|'staging'|'production').
•	Capture all unhandled errors and promise rejections.
•	Set user context on login: Sentry.setUser({ id: user.id }) — no PII like email.
•	Clear user context on logout: Sentry.setUser(null).
•	Backend: initialise @sentry/node in index.ts. Add Sentry.Handlers.requestHandler() before routes and Sentry.Handlers.errorHandler() after routes.
•	Alert thresholds: configure in Sentry dashboard — alert if error rate > 1% or any new issue occurs in production.
5.9 PostHog Analytics Configuration
•	Initialise PostHog in app/src/App.tsx using posthog-react-native.
•	Set opted_out: false by default. User can opt out in Settings → App Settings → Disable Analytics.
•	Store opt-out preference in AsyncStorage key 'oshi_analytics_opt_out'.
•	All event names must match the Analytics Event Tracking Plan document exactly.
•	Backend also sends server-side events to PostHog for subscription events using posthog-node.

6. API Endpoints
6.1 Authentication
•	POST /auth/signup — { email, password, display_name } → creates Supabase user + default categories
•	POST /auth/signin — { email, password } → returns session
•	POST /auth/social — { provider: 'apple'|'google', id_token } → Supabase OAuth
•	POST /auth/signout — invalidates session
•	POST /auth/reset-password — { email } → triggers Supabase password reset email
•	POST /auth/update-password — { token, new_password } → updates password
6.2 Saves
•	POST /saves — { url, source_app? } → creates save record, queues AI job, returns { id, status: 'pending' }
•	GET /saves — query params: category_id?, status?, sort?, page?, limit=20 → paginated saves list
•	GET /saves/:id — full save details
•	PATCH /saves/:id — { status?, category_id?, user_note?, manual_sort_order? } → update save
•	DELETE /saves/:id — soft delete (sets deleted_at)
•	POST /saves/:id/retry — re-queues failed AI processing job
•	GET /saves/check-duplicate — query param: url → { exists: bool, save_id? }
6.3 Categories
•	GET /categories — all categories for current user with unread count
•	POST /categories — { name, emoji, sort_order }
•	PATCH /categories/:id — { name?, emoji?, reminder_override_time?, sort_order? }
•	DELETE /categories/:id — moves saves to 'Other' category, then deletes
6.4 Notifications
•	POST /notifications/token — { expo_push_token } → saves token to users.notification_token
•	PATCH /notifications/settings — { reminder_time, reminder_days, morning_digest? }
•	POST /notifications/log-open — { notification_log_id } → marks notification as opened
6.5 Users
•	GET /users/me — returns current user profile + subscription status
•	PATCH /users/me — { display_name?, timezone?, notification_permission? }
•	POST /users/avatar — multipart form upload → uploads to Supabase Storage, returns avatar_url
•	DELETE /users/me — initiates 30-day soft delete
6.6 Subscriptions
•	GET /subscriptions/status — current subscription details
•	POST /subscriptions/webhook — RevenueCat webhook (validates Authorization header)
6.7 Engagement
•	POST /engagement/signal — { save_id, action: 'opened'|'skipped'|'done' } → records signal for smart sort
6.8 Error Response Format
All API errors return a consistent JSON structure:
{   "error": {     "code": "SAVE_LIMIT_REACHED",     "message": "You have reached your monthly save limit. Upgrade to Oshi Pro for unlimited saves.",     "statusCode": 403   } }
Error Code	HTTP Status & When Used
UNAUTHORISED	401 — Invalid or expired JWT
FORBIDDEN	403 — Valid JWT but insufficient permissions
SAVE_LIMIT_REACHED	403 — Free user at 20 save limit
CATEGORY_LIMIT_REACHED	403 — Free user at 3 category limit
NOT_FOUND	404 — Resource does not exist or belongs to another user
VALIDATION_ERROR	422 — Invalid request body
RATE_LIMITED	429 — Too many requests
INTERNAL_ERROR	500 — Unexpected server error

7. Design System
7.1 Colour Palette
Token	Hex Value & Usage
color.primary	#1A1A2E — Navy. App background (dark), primary text, logo.
color.secondary	#16213E — Dark blue. Section headers.
color.accent	#E94560 — Vibrant red-pink. CTAs, active tabs, badges, streak flame.
color.background	#FAFAFA — Off-white. Main app background (light mode).
color.surface	#FFFFFF — Pure white. Cards, modals, bottom sheets.
color.textPrimary	#1A1A2E — Main readable text.
color.textSecondary	#666666 — Supporting text, labels.
color.textMuted	#999999 — Timestamps, hints, placeholders.
color.border	#E0E0E0 — Dividers, card borders.
color.success	#22C55E — Done state, checkmarks.
color.warning	#F59E0B — Warning badges, caution states.
color.error	#EF4444 — Delete actions, error states.
color.skeletonBase	#E0E0E0 — Skeleton loader base colour.
color.skeletonHighlight	#F5F5F5 — Skeleton loader shimmer colour.
7.2 Typography
Token	Spec & Usage
font.display	Sora Bold — app name, hero text, onboarding headlines
font.heading1	Inter SemiBold 24px — screen titles
font.heading2	Inter SemiBold 18px — section headers, card titles
font.body	Inter Regular 16px — body text, summaries
font.bodySmall	Inter Regular 14px — metadata, timestamps, tags
font.caption	Inter Regular 12px — legal text, fine print
font.button	Inter SemiBold 16px — all button labels
font.code	Courier New 14px — technical content only
7.3 Spacing & Border Radius
Token	Value & Usage
spacing.xs	4px
spacing.sm	8px
spacing.md	16px
spacing.lg	24px
spacing.xl	32px
spacing.xxl	48px
radius.sm	8px — buttons, chips
radius.md	16px — cards
radius.lg	20px — modals, bottom sheets
radius.pill	100px — tags, badges
shadow.card	0 2px 12px rgba(0,0,0,0.08)
7.4 Dark Mode
•	Dark mode uses a ThemeContext wrapping the entire app.
•	Theme toggle in Settings: Light, Dark, System (default).
•	Dark mode colour overrides: background → #0F0F1A, surface → #1A1A2E, textPrimary → #FFFFFF, textSecondary → #AAAAAA, border → #2A2A3E, skeletonBase → #2A2A3E.
•	All other design tokens remain the same in dark mode.
•	System mode uses useColorScheme() from React Native.
•	Selected theme persisted in AsyncStorage key 'oshi_theme'.
7.5 Device & Orientation
•	Supported devices: iPhone only (iOS 15+). No iPad support in v1.
•	Orientation: Portrait only. Lock in app.json: orientation: 'portrait'.
•	Add UIRequiresFullScreen in iOS Info.plist to prevent Split View on iPad.
•	Safe area: use SafeAreaProvider and SafeAreaView from react-native-safe-area-context throughout — never hardcode status bar heights.
•	Dynamic Island and notch: handled automatically by SafeAreaView.

8. Monetisation
8.1 Free Tier Limits
•	20 saves per calendar month. Counter resets on the 1st of each month (cron job).
•	3 active categories maximum.
•	One global daily reminder time.
•	Basic AI: category + summary only. No tags, no confidence score shown.
•	7-day free Pro trial on account creation.
8.2 Oshi Pro
•	Unlimited saves.
•	Unlimited custom categories.
•	Per-category reminder times.
•	AI tags + confidence display.
•	Weekly AI digest (in-app + optional email).
•	Priority AI processing (5 second target vs 30 seconds for free).
•	Morning Digest notification.
•	Export library as CSV or JSON.
•	Pricing: $4.99/month or $39.99/year. Both with 7-day free trial.
8.3 Paywall Trigger Points
•	21st save attempt in a month — show paywall mid-flow with context count.
•	4th category creation attempt — show paywall.
•	Tapping any Pro-only feature toggle in Settings — show paywall.
•	Day 5 soft upsell banner on Library home screen for free users.
8.4 Subscription Downgrade
Fully specified in Section 3.7.4. Summary: all data preserved, new saves blocked until under free limit, persistent soft banner shown.

9. Security & Privacy
•	All API communication: HTTPS/TLS 1.2+ only.
•	JWT tokens: stored in Expo SecureStore. Never AsyncStorage.
•	OpenAI API key: backend only. Never shipped in client bundle.
•	RevenueCat webhook: validate Authorization header against REVENUECAT_WEBHOOK_AUTH_HEADER env var.
•	Rate limits: POST /saves → 60/minute/user. POST /auth/signin → 10/minute/IP. All others → 120/minute/user.
•	Supabase RLS: fully specified in Section 5.4. Must be applied before any data is written.
•	Privacy Policy: must explain URL content is sent to OpenAI for processing. Link visible in onboarding and Settings.
•	GDPR: users can export data (Pro) and delete account (30-day soft delete). Data never sold.
•	Analytics: PostHog, opt-out available in Settings. No PII in event properties.

10. Non-Functional Requirements
10.1 Performance
•	Share extension: UI visible within 1.5 seconds of activation.
•	App cold start to interactive: under 2.5 seconds on iPhone 12 or newer.
•	API POST /saves: under 300ms at p95 (not including AI processing).
•	AI processing: under 5 seconds for Pro, under 30 seconds for Free, at p95.
•	All animations target 60fps. Use Reanimated worklets (runOnUI) to keep animations off JS thread.
•	FlatList optimisation: use keyExtractor, getItemLayout where possible, windowSize=10, removeClippedSubviews=true.
10.2 Offline
•	Cached saves visible offline (last loaded data cached in Zustand + AsyncStorage hydration).
•	Mark Done offline: optimistic update in Zustand, queued PATCH request in AsyncStorage, synced on reconnect.
•	Queue new saves offline: stored in AsyncStorage, processed on reconnect.
•	Offline banner: non-intrusive banner at top using NetInfo from @react-native-community/netinfo.

11. Phase Roadmap
Phase 1 — MVP (Weeks 1–10)
•	Share extension: Instagram + YouTube on iOS and Android.
•	AI categorisation with full prompt template as specified.
•	Library with skeleton loaders, empty states, swipe gestures, multi-select, sort options.
•	Content detail view with all states.
•	Daily reminder notifications + smart notification logic.
•	Onboarding with skip logic + day-3 notification re-request.
•	Streak system (hard reset).
•	Profile photo upload.
•	Free tier + Oshi Pro with RevenueCat.
•	Trial expiry warnings.
•	Subscription downgrade handling.
•	Undo toast.
•	Dark mode.
•	Three environments (dev/staging/prod).
•	Sentry + PostHog integrated.
•	All RLS policies applied.
Phase 2 — Growth (Weeks 11–18)
•	TikTok, Twitter/X, LinkedIn, Spotify share extension support.
•	Per-category reminder times.
•	Weekly AI digest.
•	iOS home screen widget.
•	Streak freeze (Pro feature).
•	Profile photo from Google/Apple auto-import option.
Phase 3 — Expansion (Weeks 19–26)
•	Browser extension (Chrome/Safari) for desktop saving.
•	Collaborative collections.
•	AI weekly insights.
•	Referral program.

12. Environment Variables Reference
Backend (.env)
Variable	Description
SUPABASE_URL	Your Supabase project URL
SUPABASE_SERVICE_ROLE_KEY	Supabase service role key — NEVER expose to client
OPENAI_API_KEY	OpenAI API key
REVENUECAT_WEBHOOK_AUTH_HEADER	RevenueCat shared secret for webhook validation
YOUTUBE_DATA_API_KEY	Google API key with YouTube Data API v3 enabled
REDIS_URL	Redis connection string (Railway provides automatically)
EXPO_ACCESS_TOKEN	Expo account token for sending push notifications
SENTRY_DSN	Sentry DSN for backend error tracking
POSTHOG_API_KEY	PostHog server-side API key
NODE_ENV	development, staging, or production
PORT	3000 (default)
Mobile App (.env)
Variable	Description
EXPO_PUBLIC_SUPABASE_URL	Supabase project URL (safe for client)
EXPO_PUBLIC_SUPABASE_ANON_KEY	Supabase anon key (safe for client)
EXPO_PUBLIC_API_BASE_URL	Backend API base URL
EXPO_PUBLIC_REVENUECAT_IOS_KEY	RevenueCat iOS public API key
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY	RevenueCat Android public API key
EXPO_PUBLIC_POSTHOG_API_KEY	PostHog client-side key
EXPO_PUBLIC_SENTRY_DSN	Sentry DSN for React Native
13. Key Dependencies
Package	Version & Purpose
expo	~51.0
react-native	0.74.x
@supabase/supabase-js	^2.x
react-navigation/native + native-stack + bottom-tabs	^6.x
zustand	^4.x
react-native-reanimated	^3.x
react-native-gesture-handler	^2.x
react-native-purchases	^7.x — RevenueCat
expo-notifications	^0.28.x
expo-secure-store	^13.x
expo-haptics	^13.x
expo-image-picker	^15.x
expo-image-manipulator	^12.x
expo-image	^1.x — high performance image display
@react-native-community/netinfo	^11.x — network status
react-native-bottom-sheet	^4.x
react-native-draggable-flatlist	^4.x
react-native-confetti-cannon	^1.x
@sentry/react-native	^5.x
posthog-react-native	^3.x
lottie-react-native	^6.x — Lottie animations
express	^4.x
prisma	^5.x
bullmq	^5.x
cheerio	^1.x
openai	^4.x — official OpenAI SDK
axios	^1.x
date-fns	^3.x
node-cron	^3.x — scheduled jobs

