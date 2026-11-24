import { PostHog } from 'posthog-node';
import { prisma } from '../lib/prisma';
import { Sentry } from './sentry';

// ─────────────────────────────────────────────────────────────────────────────
// Server-side analytics — Oshi_Analytics_Plan.docx §1: "Track on the server
// side for business-critical events (saves, purchases)".
//
// Events that only the backend sees: RevenueCat subscription lifecycle, AI
// processing outcomes, and pushes sent. Client events stay in the app.
//
// - No-op when POSTHOG_API_KEY is unset (local dev, tests).
// - Respects the user's opt-out (users.analytics_opt_out, synced from the
//   app's Settings toggle), so the server never tracks someone the app won't.
// - distinctId is the Supabase user id, matching the app's identify() call,
//   so server and client events land on the same person. No PII in properties.
// - Never throws: analytics must not break the request/job that emitted it.
// ─────────────────────────────────────────────────────────────────────────────

const apiKey = process.env.POSTHOG_API_KEY;
const client = apiKey
  ? new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST ?? 'https://app.posthog.com',
      flushAt: 20,
      flushInterval: 10_000,
    })
  : null;

export type ServerEvent =
  | 'trial_started'
  | 'subscription_purchased'
  | 'subscription_cancelled'
  | 'subscription_expired'
  | 'save_ai_processed'
  | 'save_ai_failed'
  | 'notification_sent';

export async function trackServerEvent(
  userId: string,
  event: ServerEvent,
  properties: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!client) return;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { analyticsOptOut: true },
    });
    if (!user || user.analyticsOptOut) return;
    client.capture({ distinctId: userId, event, properties: { ...properties, source: 'server' } });
  } catch (err) {
    Sentry.captureException(err, { extra: { event } });
  }
}

/** Flush queued events; call during graceful shutdown. */
export async function shutdownAnalytics(): Promise<void> {
  await client?.shutdown();
}
