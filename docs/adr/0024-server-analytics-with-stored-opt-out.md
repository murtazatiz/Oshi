# ADR-0024 — Server-side analytics, with the opt-out stored on the user

**Status:** Accepted · **Decided:** 2026-11-24

## Context
The analytics plan tracks "business-critical events (saves, purchases)" server-side. Subscription lifecycle (RevenueCat webhooks), AI processing outcomes and pushes sent are visible only to the backend. The app's opt-out lived only in AsyncStorage on the device, so a server client couldn't honour it.

## Decision
`backend/src/services/analytics.ts` wraps posthog-node. It does nothing without `POSTHOG_API_KEY`, never throws, and uses the Supabase user id as distinctId, matching the app's identify. Before every event it checks `users.analytics_opt_out`. The app sets that column from the Settings toggle and re-sends a device opt-out on each sign-in. The app keeps all UX events; the server owns `trial_started`, `subscription_purchased`/`_cancelled`/`_expired`, `save_ai_processed`/`_failed` and `notification_sent`.

## Consequences
One indexed lookup per server event (all low-volume). Opting out stops both client and server tracking, and opt-outs made offline reach the server on the next sign-in. New column, so it needs the 20261124 manual migration before deploying (ADR-0020). Current posthog-node needs Node ^20.20.0 or >=22.22.0, and backend `engines` now says so. TC-ANL-02.
