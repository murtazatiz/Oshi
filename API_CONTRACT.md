OSHI
API Contract
Complete Request & Response Specifications for All Endpoints
Oshi v1.0  •  February 2026
Backend and Frontend must both reference this document
 
1. Global Conventions
Convention	Specification
Base URL (dev)	http://localhost:3000/api/v1
Base URL (staging)	https://oshi-staging.railway.app/api/v1
Base URL (production)	https://api.oshi.app/api/v1
Authentication	Bearer token in Authorization header: 'Authorization: Bearer [supabase_jwt]'
Content-Type	application/json for all requests and responses
Date format	ISO 8601: 2026-02-14T19:00:00.000Z
Pagination	cursor-based via ?cursor=[last_id]&limit=[n] (default limit: 20, max: 50)
Empty arrays	Return [] not null for empty collections
Null fields	Omit null optional fields from response rather than including them as null
2. Authentication Endpoints
POST /auth/signup
Request:
{ "email": "user@example.com", "password": "SecurePass1", "display_name": "Murtaza Rasheed" }
Response 201:
{ "user": { "id": "uuid", "email": "user@example.com", "display_name": "Murtaza Rasheed", "created_at": "2026-02-14T10:00:00Z" }, "session": { "access_token": "eyJ...", "refresh_token": "...", "expires_at": 1739534400 } }
On signup: backend automatically creates all 11 default categories for the user and sets trial_started_at = NOW().
Errors: 409 if email already registered.
POST /auth/signin
Request: { email, password }
Response 200: same as signup response.
Errors: 401 INVALID_CREDENTIALS.
POST /auth/reset-password
Request: { email }
Response 200: { message: 'Reset email sent' }
Always returns 200 even if email not found (security: don't reveal whether email exists).
3. Saves Endpoints
POST /saves
Request:
{ "url": "https://www.instagram.com/reel/ABC123/", "source_app": "instagram" }
Response 201:
{ "id": "uuid", "url": "https://www.instagram.com/reel/ABC123/",   "platform": "instagram", "processing_status": "pending",   "saved_at": "2026-02-14T19:30:00Z", "category": { "id": "uuid", "name": "Other" } }
Backend immediately increments users.items_saved_this_month. If this exceeds 20 for free users, returns 403 SAVE_LIMIT_REACHED before creating the record.
Duplicate check: if URL already exists for this user, return 200 with existing save + field 'duplicate': true.
GET /saves
Query parameters:
Parameter	Type & Description
category_id	UUID — filter by category. Omit for 'All' tab.
status	string — 'unread', 'done', 'skipped'. Omit for all statuses.
sort	string — 'ai_recommended', 'recent', 'oldest', 'shortest', 'manual'. Default: 'ai_recommended'
search	string — searches title, summary, notes, tags, creator_name
cursor	UUID — last save ID from previous page for pagination
limit	integer — default 20, max 50
Response 200:
{ "saves": [     { "id": "uuid", "url": "...", "title": "How to think like Elon Musk",       "summary": "Five mental models used by top entrepreneurs.",       "thumbnail_url": "https://...", "platform": "youtube",       "content_type": "long_video", "category": { "id": "uuid", "name": "Business" },       "tags": ["business", "mindset", "productivity"],       "creator_name": "Valuetainment", "estimated_time_seconds": 840,       "processing_status": "complete", "status": "unread",       "link_status": "active", "saved_at": "2026-02-14T19:30:00Z",       "ai_confidence_score": 0.94 }   ],   "next_cursor": "uuid-of-last-item",   "total_count": 47,   "has_more": true }
PATCH /saves/:id
Request (all fields optional):
{ "status": "done", "category_id": "uuid", "user_note": "Watch this tonight", "manual_sort_order": 3 }
Response 200: full updated save object.
Setting status to 'done' automatically sets done_at = NOW(). Setting to 'skipped' sets skipped_at = NOW().
DELETE /saves/:id
Response 204: No Content.
Soft delete: sets saves.deleted_at = NOW(). Record excluded from all GET queries. Purged after 7 days by cron.
4. Categories Endpoints
GET /categories
Response 200:
{ "categories": [     { "id": "uuid", "name": "Business", "emoji": "💼",       "sort_order": 1, "is_system_default": true,       "unread_count": 12, "total_count": 34,       "reminder_override_time": null }   ] }
POST /categories
Request: { name, emoji?, sort_order? }
Free tier: returns 403 CATEGORY_LIMIT_REACHED if user already has 3 categories.
Response 201: new category object.
DELETE /categories/:id
Backend: finds the user's 'Other' category. Moves all saves from deleted category to Other. Then deletes the category. Response 204.
5. Users Endpoints
GET /users/me
Response 200:
{ "id": "uuid", "email": "user@example.com", "display_name": "Murtaza",   "avatar_url": "https://supabase.co/storage/v1/object/sign/avatars/uuid/profile.jpg?token=...",   "subscription_status": "pro", "subscription_expires_at": "2026-03-14T00:00:00Z",   "streak_count": 7, "items_saved_this_month": 45,   "notification_permission": "granted", "reminder_time": "19:00:00+00",   "reminder_days": ["mon","tue","wed","thu","fri","sat","sun"] }
POST /users/avatar
Request: multipart/form-data with field 'avatar' containing the image file (JPEG or PNG, max 500KB).
Backend: uploads to Supabase Storage at path avatars/[user_id]/profile.jpg. Generates signed URL (expires 1 year). Updates users.avatar_url. Returns { avatar_url: '...' }.
6. Subscriptions Webhook
POST /subscriptions/webhook
Called by RevenueCat when subscription state changes.
Security: validate 'Authorization' header === process.env.REVENUECAT_WEBHOOK_AUTH_HEADER. Return 401 if mismatch.
Handled events and actions:
RevenueCat Event	Oshi Action
INITIAL_PURCHASE	Set status='pro', subscription_expires_at from event
RENEWAL	Update subscription_expires_at
CANCELLATION	Status stays 'pro' until expires_at. Set cancelled flag.
EXPIRATION	Set status='free'
TRIAL_STARTED	Set status='trial', trial_started_at=NOW()
TRIAL_CONVERTED	Set status='pro'
TRIAL_CANCELLED	Set status='free' at trial end
PRODUCT_CHANGE	Update to new product's expires_at
Response: always return 200 immediately to acknowledge. Process asynchronously if needed.
7. Engagement Endpoint
POST /engagement/signal
Request: { save_id: 'uuid', action: 'opened' | 'skipped' | 'done' }
Backend: inserts row into user_engagement_signals. This feeds the AI smart sort algorithm.
Response 200: { recorded: true }
Call this from the mobile app: on 'opened' → when user taps a card to open detail view. On 'done' → when user marks done. On 'skipped' → when user marks skipped.
8. WebSocket / Realtime
Oshi uses Supabase Realtime (not custom WebSockets) for live updates.
Client-side subscription (implement in app/src/services/realtime.ts):
const subscription = supabase   .channel('saves-updates')   .on('postgres_changes', {     event: 'UPDATE',     schema: 'public',     table: 'saves',     filter: `user_id=eq.${userId}`,   }, (payload) => {     // payload.new contains the updated save record     // Update Zustand store with new data     useSavesStore.getState().updateSave(payload.new);   })   .subscribe();  // Cleanup on unmount return () => supabase.removeChannel(subscription);
