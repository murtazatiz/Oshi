import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { scheduleNotification } from '../queue';
import { Sentry } from '../services/sentry';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// RevenueCat webhook payload schema
//
// RevenueCat sends events as: { event: { type, app_user_id, ... }, api_version }
// We only validate the fields we act on; the full payload is much larger.
// ─────────────────────────────────────────────────────────────────────────────

const RevenueCatEventSchema = z.object({
  event: z.object({
    /** Event type — one of the values in the API contract §6 table */
    type: z.string(),
    /**
     * The user ID passed to Purchases.logIn() in the mobile app.
     * Must be the Oshi user UUID (Supabase auth.users.id).
     */
    app_user_id: z.string(),
    /**
     * Unix timestamp (ms) when the subscription or trial expires.
     * Present on INITIAL_PURCHASE, RENEWAL, CANCELLATION, PRODUCT_CHANGE,
     * TRIAL_STARTED, and TRIAL_CANCELLED events.
     */
    expiration_at_ms: z.number().nullable().optional(),
    /** Unix timestamp (ms) of the original purchase. Present on most events. */
    purchased_at_ms: z.number().nullable().optional(),
    /** RevenueCat environment — 'PRODUCTION' | 'SANDBOX' */
    environment: z.string().optional(),
  }),
  api_version: z.string().optional(),
});

type RevenueCatEvent = z.infer<typeof RevenueCatEventSchema>['event'];

// ─────────────────────────────────────────────────────────────────────────────
// PRD constants
// ─────────────────────────────────────────────────────────────────────────────

/** Trial duration: 7 days (PRD §8.1, §8.2) */
const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Send trial warning 24 hours before expiry (PRD §3.4.3) */
const TRIAL_WARNING_OFFSET_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers
// Each function is responsible for one RevenueCat event type.
// Errors inside handlers are caught by the caller and logged — the webhook
// always returns 200 to prevent RevenueCat from retrying for server errors.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one place a RevenueCat event becomes a subscription status write.
 * Six of the eight webhook events differ only in the status they set
 * (and previously had six copy-pasted handlers):
 *   'pro'       — INITIAL_PURCHASE, RENEWAL, TRIAL_CONVERTED, PRODUCT_CHANGE
 *   'cancelled' — CANCELLATION, TRIAL_CANCELLED (PRD §3.7.4: user keeps
 *                 access until expires_at; EXPIRATION later sets 'free')
 *   'free'      — EXPIRATION (expires_at cleared)
 */
async function setSubscriptionStatus(
  userId: string,
  status: 'pro' | 'cancelled' | 'free',
  event?: RevenueCatEvent,
): Promise<void> {
  const expiresAt = event?.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: status,
      ...(status === 'free'
        ? { subscriptionExpiresAt: null }
        : expiresAt
          ? { subscriptionExpiresAt: expiresAt }
          : {}),
    },
  });
}

async function handleTrialStarted(userId: string, event: RevenueCatEvent): Promise<void> {
  const now = new Date();

  // Determine trial expiry: use RevenueCat's expiration if provided,
  // otherwise fall back to 7 days from now (PRD §8.1).
  const expiresAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : new Date(now.getTime() + TRIAL_DURATION_MS);

  await prisma.user.update({
    where: { id: userId },
    data: {
      subscriptionStatus: 'trial',
      trialStartedAt: now,
      subscriptionExpiresAt: expiresAt,
    },
  });

  // ── Schedule trial expiry notifications (PRD §3.4.3) ─────────────────────
  //
  // "24 hours before trial expires: send push notification"
  // "On the day of expiry: show in-app banner"
  //
  // We schedule two BullMQ delayed jobs:
  //   1. trial_expiry_warning — fires 24h before expiry
  //   2. trial_expiry_day     — fires at expiry time
  //
  // The notification worker reads the user's push token at fire time (not
  // stored in the job) so it always uses the current token even if it changes.

  const expiresAtMs = expiresAt.getTime();
  const expiresAtIso = expiresAt.toISOString();
  const warningFireAtMs = expiresAtMs - TRIAL_WARNING_OFFSET_MS;

  // Schedule 24h-before warning (skip if already within 24h)
  if (warningFireAtMs > Date.now()) {
    await scheduleNotification(
      { userId, notificationType: 'trial_expiry_warning', expiresAt: expiresAtIso },
      warningFireAtMs,
    );
  }

  // Schedule expiry-day notification
  await scheduleNotification(
    { userId, notificationType: 'trial_expiry_day', expiresAt: expiresAtIso },
    expiresAtMs,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /subscriptions/webhook
//
// Called by RevenueCat on every subscription lifecycle event.
//
// Security: Authorization header must equal REVENUECAT_WEBHOOK_AUTH_HEADER
// env var (shared secret, NOT a Supabase JWT). No requireAuth middleware.
//
// Idempotency: always return 200. If our DB update fails, we log to Sentry
// so it can be investigated rather than triggering RevenueCat retries that
// could put us in an inconsistent state.
//
// API contract §6: "Response: always return 200 immediately to acknowledge."
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // ── Authorization header validation ───────────────────────────────────
    const expectedSecret = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
    const receivedSecret = req.headers.authorization;

    if (!expectedSecret) {
      // Misconfiguration — log but still return 200 to avoid RevenueCat loops
      console.error('[subscriptions/webhook] REVENUECAT_WEBHOOK_AUTH_HEADER not set');
      res.sendStatus(200);
      return;
    }

    if (receivedSecret !== expectedSecret) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORISED',
          message: 'Invalid webhook authorisation.',
          statusCode: 401,
        },
      });
      return;
    }

    // ── Acknowledge immediately ───────────────────────────────────────────
    // Per RevenueCat's requirements, respond 200 before processing.
    res.sendStatus(200);

    // ── Parse and validate payload ────────────────────────────────────────
    const parsed = RevenueCatEventSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn('[subscriptions/webhook] Invalid payload shape:', parsed.error.flatten());
      return;
    }

    const { event } = parsed.data;
    const userId = event.app_user_id;
    const eventType = event.type;

    // Verify the user exists in our database before updating
    const user = await prisma.user
      .findUnique({ where: { id: userId }, select: { id: true } })
      .catch(() => null);

    if (!user) {
      console.warn(
        `[subscriptions/webhook] Unknown user "${userId}" for event "${eventType}"`,
      );
      return;
    }

    // ── Dispatch to event handler ─────────────────────────────────────────
    try {
      switch (eventType) {
        case 'INITIAL_PURCHASE':
          await setSubscriptionStatus(userId, 'pro', event);
          break;

        case 'RENEWAL':
          await setSubscriptionStatus(userId, 'pro', event);
          break;

        case 'CANCELLATION':
          await setSubscriptionStatus(userId, 'cancelled', event);
          break;

        case 'EXPIRATION':
          await setSubscriptionStatus(userId, 'free');
          break;

        case 'TRIAL_STARTED':
          await handleTrialStarted(userId, event);
          break;

        case 'TRIAL_CONVERTED':
          await setSubscriptionStatus(userId, 'pro', event);
          break;

        case 'TRIAL_CANCELLED':
          await setSubscriptionStatus(userId, 'cancelled', event);
          break;

        case 'PRODUCT_CHANGE':
          await setSubscriptionStatus(userId, 'pro', event);
          break;

        default:
          // Unknown event type — log and skip rather than error
          console.info(
            `[subscriptions/webhook] Unhandled event type "${eventType}" for user "${userId}"`,
          );
      }

      console.info(
        `[subscriptions/webhook] Processed "${eventType}" for user "${userId}"`,
      );
    } catch (err) {
      // Do NOT call next(err) — the response is already sent (200).
      // Log to Sentry so the team can investigate.
      console.error(
        `[subscriptions/webhook] Failed to process "${eventType}" for user "${userId}":`,
        err,
      );
      Sentry.captureException(err, {
        extra: { eventType, userId, webhookPayload: req.body as unknown },
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /subscriptions/status — current subscription details (JWT authenticated)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: {
          subscriptionStatus: true,
          subscriptionExpiresAt: true,
          trialStartedAt: true,
          itemsSavedThisMonth: true,
        },
      });

      if (!user) {
        next(Errors.notFound('User'));
        return;
      }

      const out: Record<string, unknown> = {
        subscription_status: user.subscriptionStatus,
        items_saved_this_month: user.itemsSavedThisMonth,
      };

      if (user.subscriptionExpiresAt !== null)
        out.subscription_expires_at = user.subscriptionExpiresAt.toISOString();
      if (user.trialStartedAt !== null)
        out.trial_started_at = user.trialStartedAt.toISOString();

      res.json(out);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
