import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { sendDailyReminder } from '../services/notificationService';
import { Sentry } from '../services/sentry';

// ─────────────────────────────────────────────────────────────────────────────
// Day-of-week constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maps Date.prototype.getUTCDay() (0=Sun) to PRD reminder_days values. */
const UTC_DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level task handles — used by stopSchedulers()
// ─────────────────────────────────────────────────────────────────────────────

let dailyReminderTask: cron.ScheduledTask | null = null;
let monthlyResetTask: cron.ScheduledTask | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches users whose reminder_time matches the current UTC hour:minute
 * AND whose reminder_days JSONB array includes today's day name.
 *
 * Uses $queryRawUnsafe because Prisma's type-safe query builder does not
 * support SPLIT_PART on a TEXT column or the JSONB @> operator.
 */
async function getUsersToRemind(
  currentHour: number,
  currentMinute: number,
  currentDay: string,
): Promise<
  Array<{
    id: string;
    notification_token: string;
    last_opened_at: Date | null;
  }>
> {
  console.info(
    '[reminder-cron] getUsersToRemind called',
    JSON.stringify({ currentHour, currentMinute, currentDay }),
  );

  const users = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      notification_token: string;
      last_opened_at: Date | null;
    }>
  >(
    `
    SELECT id, notification_token, last_opened_at
    FROM   users
    WHERE  notification_permission = 'granted'
      AND  notification_token IS NOT NULL
      AND  deleted_at IS NULL
      AND  SPLIT_PART(reminder_time, ':', 1)::int = $1
      AND  SPLIT_PART(reminder_time, ':', 2)::int = $2
      AND  reminder_days @> $3::jsonb
    `,
    currentHour,
    currentMinute,
    JSON.stringify([currentDay]),
  );

  console.info(
    '[reminder-cron] getUsersToRemind result count:',
    Array.isArray(users) ? users.length : 'non-array result',
  );

  return users;
}

/**
 * Finds the category with the most unread saves for a user, fetches the
 * most recently saved item title in that category, then sends the push.
 *
 * Pre-condition: caller has already confirmed the user has a valid token and
 * was NOT opened within the last 2 hours.
 */
async function processUserReminder(
  userId: string,
  token: string,
): Promise<void> {
  // ── Find category with most unread saves ──────────────────────────────────
  const categoryUnreadCounts = await prisma.save.groupBy({
    by: ['categoryId'],
    where: { userId, status: 'unread', deletedAt: null },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 1,
  });

  const topEntry = categoryUnreadCounts[0];

  // No unread saves at all — skip silently
  if (!topEntry || topEntry._count.id === 0) return;

  const categoryId = topEntry.categoryId;
  const unreadCount = topEntry._count.id;

  // ── Resolve category display info ─────────────────────────────────────────
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

  // ── Get most recently saved item in that category ─────────────────────────
  const recentSave = await prisma.save.findFirst({
    where: {
      userId,
      categoryId: categoryId ?? null,
      status: 'unread',
      deletedAt: null,
    },
    orderBy: { savedAt: 'desc' },
    select: { title: true, thumbnailUrl: true },
  });

  const topSaveTitle = recentSave?.title ?? 'Your latest save';

  // Build args — only include thumbnailUrl when it is a non-null string
  // (exactOptionalPropertyTypes: optional properties cannot be set to undefined)
  const reminderArgs: Parameters<typeof sendDailyReminder>[0] = {
    userId,
    token,
    categoryId,
    categoryName,
    categoryEmoji,
    topSaveTitle,
    unreadCount,
  };
  if (recentSave?.thumbnailUrl) reminderArgs.thumbnailUrl = recentSave.thumbnailUrl;

  console.info(
    '[reminder-cron] Calling sendDailyReminder',
    JSON.stringify({
      userId,
      categoryId,
      categoryName,
      unreadCount,
      hasThumbnail: !!recentSave?.thumbnailUrl,
    }),
  );

  await sendDailyReminder(reminderArgs);

  console.info('[reminder-cron] sendDailyReminder completed', { userId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily Reminder Scheduler — runs every minute
//
// PRD §3.4.1: "User sets reminder time during onboarding. Stored as UTC."
// PRD §3.4.2: "Do NOT send if user has zero unread saves OR opened Oshi within
//              2 hours before the reminder time."
//
// The cron fires every UTC minute. For the current hour:minute we find all
// users whose reminder_time matches, apply the skip conditions, and dispatch
// push notifications for each eligible user.
//
// Concurrency guard (isRunning flag): if a batch takes longer than 60 seconds
// (unlikely but possible under load) we skip the next tick rather than
// letting two batches overlap and double-sending.
//
// Batch processing: 10 users processed concurrently per iteration. This keeps
// memory usage predictable without blocking the event loop on large user bases.
// ─────────────────────────────────────────────────────────────────────────────

export function startDailyReminderScheduler(): void {
  let isRunning = false;

  dailyReminderTask = cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) return;
      isRunning = true;

      try {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();
        const currentDay = UTC_DAY_NAMES[now.getUTCDay()] as string;

        console.info(
          '[reminder-cron] Tick at',
          `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(
            2,
            '0',
          )} UTC (day: ${currentDay})`,
        );

        const usersToRemind = await getUsersToRemind(currentHour, currentMinute, currentDay);

        if (usersToRemind.length === 0) {
          console.info('[reminder-cron] No users to remind for this minute.');
          return;
        }

        console.info(
          `[reminder-cron] ${usersToRemind.length} user(s) to remind at ` +
            `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')} UTC`,
        );

        // Process in batches of 10 to limit concurrent DB + HTTP calls
        const BATCH_SIZE = 10;

        for (let i = 0; i < usersToRemind.length; i += BATCH_SIZE) {
          const batch = usersToRemind.slice(i, i + BATCH_SIZE);

          await Promise.allSettled(
            batch.map(async (user) => {
              try {
                // PRD §3.4.2: skip if user opened the app within the last 2 hours
                if (user.last_opened_at !== null) {
                  const twoHoursAgoMs = Date.now() - 2 * 60 * 60 * 1000;
                  if (user.last_opened_at.getTime() > twoHoursAgoMs) {
                    console.info(
                      '[reminder-cron] Skipping user due to recent activity',
                      JSON.stringify({ userId: user.id, last_opened_at: user.last_opened_at }),
                    );
                    return; // User is actively using the app
                  }
                }

                console.info(
                  '[reminder-cron] Processing user reminder',
                  JSON.stringify({ userId: user.id }),
                );

                await processUserReminder(user.id, user.notification_token);
              } catch (err) {
                console.error(
                  `[reminder-cron] Error processing user ${user.id}:`,
                  err,
                );
                Sentry.captureException(err, { extra: { userId: user.id } });
              }
            }),
          );
        }
      } catch (err) {
        console.error('[reminder-cron] Scheduler error:', err);
        Sentry.captureException(err);
      } finally {
        isRunning = false;
      }
    },
    { timezone: 'UTC' },
  );

  console.info('[scheduler] Daily reminder cron started (every minute, UTC)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly Save Count Reset — runs at 00:00 UTC on the 1st of each month
//
// PRD §8.1: "20 saves/month limit for free users — reset on 1st of each month."
// Resets users.items_saved_this_month = 0 for all non-deleted users so they
// start each month with a fresh allowance.
// ─────────────────────────────────────────────────────────────────────────────

export function startMonthlySaveCountReset(): void {
  monthlyResetTask = cron.schedule(
    '0 0 1 * *',
    async () => {
      console.info('[monthly-reset] Resetting items_saved_this_month for all users');
      try {
        const result = await prisma.user.updateMany({
          where: { deletedAt: null },
          data: { itemsSavedThisMonth: 0 },
        });
        console.info(`[monthly-reset] Reset complete — ${result.count} users updated`);
      } catch (err) {
        console.error('[monthly-reset] Error:', err);
        Sentry.captureException(err);
      }
    },
    { timezone: 'UTC' },
  );

  console.info('[scheduler] Monthly save count reset cron started (1st of month, 00:00 UTC)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop all cron tasks — called during graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

export function stopSchedulers(): void {
  dailyReminderTask?.stop();
  monthlyResetTask?.stop();
  console.info('[scheduler] All cron tasks stopped');
}
