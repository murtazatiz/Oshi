# ADR-0022 — Pushes carry their log id; taps route through the linking config

**Status:** Accepted · **Decided:** 2026-11-24

## Context
Every push carried an `oshi://` URL, but the app had no notification-response handling, so taps never followed it. `POST /notifications/log-open` existed for open tracking (PRD §3.4), but it needs a `notification_log_id`, and the backend wrote the log row only after sending, so no push ever carried one.

## Decision
- **Backend:** `notificationService.sendLoggedPush` is the only way to send a push. It writes the `notification_logs` row first, sends `{ url, notification_log_id, notification_type }` in the push data, and deletes the row if Expo rejects the push, so open rates count only delivered pushes.
- **App:** `services/notificationTaps` records the open (log-open + PostHog `notification_opened`) and returns the URL. React Navigation's linking config consumes it through `getInitialURL` (a tap that cold-starts the app) and `subscribe` (taps while running), so it routes exactly like any deep link once navigation is mounted. The last response is cleared after handling so it isn't replayed on the next launch.

## Consequences
New push types get open tracking and routing for free if they go through `sendLoggedPush` with a `deepLinkUrl`. A push whose send fails leaves no log row. TC-NOTIF-03, TC-NOTIF-08.
