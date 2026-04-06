import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Maps getUTCDay() (0=Sun) to PRD reminder_days values */
const UTC_DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Returns true if the user's reminder_time is within the last `windowMinutes`
 * of the current UTC clock, and today is in reminder_days.
 */
function isReminderWithinWindow(
  reminderTime: string,
  reminderDays: unknown,
  windowMinutes: number,
): boolean {
  // Parse "HH:MM:SS±HH" → extract hours and minutes (UTC)
  const timeMatch = /^(\d{2}):(\d{2})/.exec(reminderTime);
  if (!timeMatch) return false;

  const reminderHour = parseInt(timeMatch[1]!, 10);
  const reminderMinute = parseInt(timeMatch[2]!, 10);

  // Day-of-week guard
  const now = new Date();
  const currentDayName = UTC_DAY_NAMES[now.getUTCDay()] as string;
  const days = Array.isArray(reminderDays)
    ? (reminderDays as unknown[]).filter((d) => typeof d === 'string')
    : [];
  if (!days.includes(currentDayName)) return false;

  // Wrap-safe minute difference (handles midnight crossing)
  const nowUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const reminderUtcMinutes = reminderHour * 60 + reminderMinute;
  const diff = (nowUtcMinutes - reminderUtcMinutes + 24 * 60) % (24 * 60);

  return diff <= windowMinutes;
}

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const PostTokenSchema = z.object({
  expo_push_token: z
    .string()
    .min(1)
    .regex(
      /^ExponentPushToken\[.+\]$/,
      'expo_push_token must be in format ExponentPushToken[...]',
    ),
});

// TIMETZ format validation: "HH:MM:SS+HH" or "HH:MM:SS+HH:MM"
// Examples: "19:00:00+00", "07:30:00+05:30"
const timetzRegex = /^\d{2}:\d{2}:\d{2}[+-]\d{2}(:\d{2})?$/;

const PatchSettingsSchema = z.object({
  reminder_time: z
    .string()
    .regex(timetzRegex, 'reminder_time must be in format HH:MM:SS+HH (e.g. "19:00:00+00")')
    .optional(),
  reminder_days: z
    .array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']))
    .min(1, 'At least one reminder day is required')
    .optional(),
});

const PostLogOpenSchema = z.object({
  notification_log_id: z.string().uuid('notification_log_id must be a valid UUID'),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /notifications/token
//
// Saves the user's Expo push token.
// Sets notification_permission = 'granted' — the client only calls this
// after the OS permission has been granted and a token issued (PRD §3.4.2).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/token',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PostTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      await prisma.user.update({
        where: { id: req.userId },
        data: {
          notificationToken: parsed.data.expo_push_token,
          notificationPermission: 'granted',
        },
      });

      res.json({ registered: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /notifications/settings
//
// Updates the user's daily reminder schedule (PRD §3.4.1).
// Both fields are optional — send only what has changed.
//
// reminder_time: TIMETZ stored as string e.g. "19:00:00+00" (UTC).
// reminder_days: JSONB array e.g. ["mon","tue","wed","thu","fri","sat","sun"].
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/settings',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PatchSettingsSchema.safeParse(req.body);
      if (!parsed.success) {
        const flattened = parsed.error.flatten();
        console.error('[notifications] PATCH /settings validation failed', {
          requestBody: req.body,
          zodFlattened: flattened,
          zodIssues: parsed.error.issues,
        });
        next(Errors.validation(flattened));
        return;
      }

      const { reminder_time, reminder_days } = parsed.data;

      if (reminder_time !== undefined) {
        console.log('[notifications] PATCH /settings received reminder_time:', reminder_time);
      }

      if (reminder_time === undefined && reminder_days === undefined) {
        next(
          Errors.validation({
            _errors: ['At least one of reminder_time or reminder_days must be provided.'],
          }),
        );
        return;
      }

      const data: { reminderTime?: string; reminderDays?: string[] } = {};
      if (reminder_time !== undefined) data.reminderTime = reminder_time;
      if (reminder_days !== undefined) data.reminderDays = reminder_days;

      const updated = await prisma.user.update({
        where: { id: req.userId },
        data,
        select: {
          reminderTime: true,
          reminderDays: true,
        },
      });

      if (data.reminderTime !== undefined) {
        console.log('[notifications] Saved reminder_time to database:', updated.reminderTime);
      }

      res.json({
        reminder_time: updated.reminderTime,
        reminder_days: updated.reminderDays,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /notifications/log-open
//
// Marks a notification as opened by the user.
// Called when the user taps a push notification and the app opens (PRD §1.3).
// Sets opened = true, opened_at = NOW() on the notification_logs row.
//
// Used by the smart sort algorithm as a signal that the user engaged with
// a notification for a specific category (PRD §3.2.2 notification context).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/log-open',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PostLogOpenSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const { notification_log_id } = parsed.data;

      // Verify the log entry exists and belongs to this user before updating
      const log = await prisma.notificationLog.findFirst({
        where: { id: notification_log_id, userId: req.userId },
        select: { id: true, opened: true },
      });

      if (!log) {
        next(Errors.notFound('NotificationLog'));
        return;
      }

      // Idempotent — silently succeed if already marked opened
      if (!log.opened) {
        await prisma.notificationLog.update({
          where: { id: notification_log_id },
          data: {
            opened: true,
            openedAt: new Date(),
          },
        });
      }

      res.json({ recorded: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /notifications/pending
//
// Polled by the app when it comes to the foreground (PRD §3.4.2).
// If the user's reminder fired within the last 5 minutes AND they have unread
// saves → return in-app toast data so the app can show the banner without
// firing an OS-level notification.
//
// Why 5 minutes: the cron fires at the exact reminder minute. On average the
// app polls within seconds of foregrounding; 5 minutes gives headroom for
// slow network / clock drift without triggering stale toasts.
//
// If the user opened via a push notification tap they navigate via deep link
// and do NOT poll this endpoint — so the mere fact the endpoint is called
// implies the app was already in the foreground when the reminder fired.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/pending',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          reminderTime: true,
          reminderDays: true,
        },
      });

      if (!user) {
        next(Errors.notFound('User'));
        return;
      }

      // Check whether the reminder window is active right now
      if (!isReminderWithinWindow(user.reminderTime, user.reminderDays, 5)) {
        res.json({ showInAppToast: false });
        return;
      }

      // ── Find category with most unread saves ──────────────────────────────
      const categoryUnreadCounts = await prisma.save.groupBy({
        by: ['categoryId'],
        where: { userId, status: 'unread', deletedAt: null },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 1,
      });

      const topEntry = categoryUnreadCounts[0];

      if (!topEntry || topEntry._count.id === 0) {
        res.json({ showInAppToast: false });
        return;
      }

      const categoryId = topEntry.categoryId;
      const unreadCount = topEntry._count.id;

      // ── Resolve category display info ─────────────────────────────────────
      let categoryName = 'Other';
      let categoryEmoji = '📌';

      if (categoryId !== null) {
        const cat = await prisma.category.findUnique({
          where: { id: categoryId },
          select: { name: true, emoji: true },
        });
        if (cat) {
          categoryName = cat.name;
          categoryEmoji = cat.emoji;
        }
      }

      const categorySlug = categoryName.toLowerCase().replace(/\s+/g, '-');

      res.json({
        showInAppToast: true,
        category: categoryName,
        category_slug: categorySlug,
        emoji: categoryEmoji,
        unread_count: unreadCount,
        /** "Your Business picks are ready 💼" — app renders this as the toast title */
        message: `Your ${categoryName} picks are ready ${categoryEmoji}`,
        deep_link: `oshi://library/${categorySlug}`,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
