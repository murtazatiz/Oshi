import axios from 'axios';
import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Expo Push API — PRD §5.1 ("Push Notifications: Expo Push Notifications")
//
// Expo wraps APNs (iOS) and FCM (Android) behind a single unified REST API.
// No SDK required on the server — plain HTTPS POST to the endpoint below.
// Reference: https://docs.expo.dev/push-notifications/sending-notifications/
// ─────────────────────────────────────────────────────────────────────────────

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: 'default' | null;
  /** Rich notification thumbnail — iOS 15+, Android 8+ (PRD §3.4.1) */
  richContent?: { image?: string };
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface NotificationPayload {
  /** ExponentPushToken[xxx...] */
  token: string;
  title: string;
  body: string;
  /** Deep link URL attached as data.url — read by the app on notification tap */
  deepLinkUrl?: string;
  /** Optional thumbnail for rich notifications (PRD §3.4.1) */
  thumbnailUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a single push notification via the Expo Push API.
 *
 * Returns true if Expo accepted the message (ticket status = 'ok').
 * Does NOT throw — callers can decide whether to log, retry, or ignore failures.
 *
 * Delivery failures (invalid token, device offline, APNs/FCM refusal) are
 * separate from HTTP-level failures and are tracked by Expo's push receipt API.
 * For an MVP this level of receipt polling is omitted; Expo retries internally
 * for a short window.
 */
export async function sendPushNotification(
  payload: NotificationPayload,
): Promise<boolean> {
  const message: ExpoPushMessage = {
    to: payload.token,
    title: payload.title,
    body: payload.body,
    sound: 'default',
  };

  if (payload.deepLinkUrl) {
    message.data = { url: payload.deepLinkUrl };
  }

  if (payload.thumbnailUrl) {
    message.richContent = { image: payload.thumbnailUrl };
  }

  try {
    console.info('[notificationService] Sending push via Expo', {
      to: payload.token,
      hasThumbnail: !!payload.thumbnailUrl,
      hasDeepLink: !!payload.deepLinkUrl,
    });

    const response = await axios.post<{ data: ExpoPushTicket[] }>(
      EXPO_PUSH_ENDPOINT,
      [message],
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10_000,
      },
    );

    const ticket = response.data.data[0];

    if (!ticket || ticket.status === 'error') {
      console.warn('[notificationService] Push ticket error:', ticket);
      return false;
    }

    console.info('[notificationService] Push accepted by Expo', ticket);

    return true;
  } catch (err) {
    console.warn(
      '[notificationService] Expo Push API error:',
      (err as Error).message,
    );
    return false;
  }
}

/**
 * Persists a notification_logs row.
 * Returns the new log entry's id (used by log-open tracking).
 */
export async function logNotification(opts: {
  userId: string;
  notificationType: string;
  categoryId?: string | null;
  itemCount?: number | null;
}): Promise<string> {
  const data: {
    userId: string;
    notificationType: string;
    categoryId?: string;
    itemCount?: number;
  } = {
    userId: opts.userId,
    notificationType: opts.notificationType,
  };

  if (opts.categoryId) data.categoryId = opts.categoryId;
  if (opts.itemCount !== null && opts.itemCount !== undefined)
    data.itemCount = opts.itemCount;

  const log = await prisma.notificationLog.create({
    data,
    select: { id: true },
  });

  return log.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-specific senders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Composes and sends the daily reminder push notification (PRD §3.4.1).
 *
 * Title: "Your [Category] picks are ready [emoji]"
 * Body:  "[Most recent title] — and N more [Category] saves."
 *        OR just "[Most recent title]" if unread count = 1.
 * Deep link: oshi://library/[category-slug]
 */
export async function sendDailyReminder(opts: {
  userId: string;
  token: string;
  categoryId: string | null;
  categoryName: string;
  categoryEmoji: string;
  topSaveTitle: string;
  unreadCount: number;
  thumbnailUrl?: string | null;
}): Promise<void> {
  const { userId, token, categoryName, categoryEmoji, topSaveTitle, unreadCount } = opts;

  const title = `Your ${categoryName} picks are ready ${categoryEmoji}`;
  const othersCount = unreadCount - 1;
  const body =
    othersCount > 0
      ? `${topSaveTitle} — and ${othersCount} more ${categoryName} save${othersCount === 1 ? '' : 's'}.`
      : topSaveTitle;

  // category_slug: lowercase, hyphens replacing spaces
  const categorySlug = categoryName.toLowerCase().replace(/\s+/g, '-');

  // Build push payload — only include thumbnailUrl when it's a non-null string
  // (exactOptionalPropertyTypes: optional properties cannot be set to undefined)
  const pushPayload: NotificationPayload = {
    token,
    title,
    body,
    deepLinkUrl: `oshi://library/${categorySlug}`,
  };
  if (opts.thumbnailUrl) pushPayload.thumbnailUrl = opts.thumbnailUrl;

  const sent = await sendPushNotification(pushPayload);

  if (sent) {
    await logNotification({
      userId,
      notificationType: 'daily_reminder',
      categoryId: opts.categoryId,
      itemCount: unreadCount,
    });
  }
}

/**
 * Sends the trial expiry warning push (24 h before trial ends — PRD §3.4.3).
 * "Your Oshi Pro trial ends tomorrow. Keep unlimited saves and smart reminders."
 */
export async function sendTrialExpiryWarning(opts: {
  userId: string;
  token: string;
}): Promise<void> {
  const sent = await sendPushNotification({
    token: opts.token,
    title: 'Your Oshi Pro trial ends tomorrow',
    body: 'Keep unlimited saves and smart reminders.',
    deepLinkUrl: 'oshi://settings/subscription',
  });

  if (sent) {
    await logNotification({
      userId: opts.userId,
      notificationType: 'trial_expiry_warning',
    });
  }
}

/**
 * Handles trial expiry day (PRD §3.4.3).
 *
 * Two effects:
 *  1. Sets users.trial_expiry_banner_due = true — the in-app banner is shown
 *     the next time the app calls GET /users/me (regardless of push delivery).
 *  2. Sends a push notification so the user is alerted even when the app is
 *     in the background.
 */
export async function sendTrialExpiryDay(opts: {
  userId: string;
  token: string;
}): Promise<void> {
  // Set the banner flag unconditionally — push may not be delivered
  await prisma.user.update({
    where: { id: opts.userId },
    data: { trialExpiryBannerDue: true },
  });

  const sent = await sendPushNotification({
    token: opts.token,
    title: 'Your Oshi Pro trial ends today',
    body: "Upgrade to keep unlimited saves and smart reminders.",
    deepLinkUrl: 'oshi://settings/subscription',
  });

  if (sent) {
    await logNotification({
      userId: opts.userId,
      notificationType: 'trial_expiry_day',
    });
  }
}
