import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import {
  sendDailyReminder,
  sendMorningDigest,
  getTopUnreadCategory,
  UTC_DAY_NAMES,
  type ReminderScope,
} from '../services/notificationService';
import { Sentry } from '../services/sentry';
import { purgeDeletedSaves, purgeDeletedUsers } from '../services/purgeService';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level task handles — used by stopSchedulers()
// ─────────────────────────────────────────────────────────────────────────────

let dailyReminderTask: cron.ScheduledTask | null = null;
let monthlyResetTask: cron.ScheduledTask | null = null;
let morningDigestTask: cron.ScheduledTask | null = null;
let nightlyPurgeTask: cron.ScheduledTask | null = null;

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
    subscription_status: string;
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
      subscription_status: string;
    }>
  >(
    `
    SELECT id, notification_token, last_opened_at, subscription_status
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
 * Pro per-category reminders (PRD §3.7.2) due this minute: categories whose
 * reminder_override_time matches, for Pro/trial users with notifications on,
 * on one of their reminder days. Overrides left behind by a downgrade are
 * ignored (the plan filter), not deleted, so they return on re-upgrade.
 */
async function getCategoryRemindersDue(
  currentHour: number,
  currentMinute: number,
  currentDay: string,
): Promise<
  Array<{
    category_id: string;
    user_id: string;
    notification_token: string;
    last_opened_at: Date | null;
  }>
> {
  return prisma.$queryRawUnsafe(
    `
    SELECT c.id AS category_id, u.id AS user_id, u.notification_token, u.last_opened_at
    FROM   categories c
    JOIN   users u ON u.id = c.user_id
    WHERE  c.reminder_override_time IS NOT NULL
      AND  SPLIT_PART(c.reminder_override_time::text, ':', 1)::int = $1
      AND  SPLIT_PART(c.reminder_override_time::text, ':', 2)::int = $2
      AND  u.subscription_status IN ('pro', 'trial')
      AND  u.notification_permission = 'granted'
      AND  u.notification_token IS NOT NULL
      AND  u.deleted_at IS NULL
      AND  u.reminder_days @> $3::jsonb
    `,
    currentHour,
    currentMinute,
    JSON.stringify([currentDay]),
  );
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
  scope: ReminderScope = {},
): Promise<void> {
  // ── Category with most unread saves (shared with the in-app route) ────────
  const top = await getTopUnreadCategory(userId, scope);

  // No unread saves at all — skip silently
  if (!top) return;

  const { categoryId, unreadCount, name: categoryName, emoji: categoryEmoji } = top;

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

        const [dailyDue, categoryDue] = await Promise.all([
          getUsersToRemind(currentHour, currentMinute, currentDay),
          getCategoryRemindersDue(currentHour, currentMinute, currentDay),
        ]);

        // One job per push. Pro users' daily reminder skips categories that
        // have their own time; each per-category reminder covers just that
        // category. Both go through the same skip rules below.
        const usersToRemind: Array<{
          id: string;
          notification_token: string;
          last_opened_at: Date | null;
          scope: ReminderScope;
        }> = [
          ...dailyDue.map((u) => ({
            id: u.id,
            notification_token: u.notification_token,
            last_opened_at: u.last_opened_at,
            scope: {
              excludeOverridden: u.subscription_status === 'pro' || u.subscription_status === 'trial',
            },
          })),
          ...categoryDue.map((c) => ({
            id: c.user_id,
            notification_token: c.notification_token,
            last_opened_at: c.last_opened_at,
            scope: { onlyCategoryId: c.category_id },
          })),
        ];

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

                await processUserReminder(user.id, user.notification_token, user.scope);
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
// Morning Digest — Pro feature, 8 AM in each user's own timezone (PRD §3.7.2)
//
// Runs every minute (timezones with :30/:45 offsets, e.g. India, never hit
// 08:00 on an hourly UTC tick) and sends to Pro/trial users who turned the
// digest on and whose local clock reads 08:00. "Yesterday" is the user's
// local calendar day. Users who saved nothing yesterday get no push.
// ─────────────────────────────────────────────────────────────────────────────

const DIGEST_LOCAL_HOUR = 8;

/** Wall-clock hour/minute in an IANA timezone; falls back to UTC for invalid zones. */
function localClock(timezone: string, at: Date): { hour: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return { hour: at.getUTCHours(), minute: at.getUTCMinutes() };
  }
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

async function processMorningDigest(user: { id: string; token: string }, localMidnight: Date): Promise<void> {
  const yesterdayStart = new Date(localMidnight.getTime() - 24 * 60 * 60 * 1000);
  const savedYesterday = { userId: user.id, deletedAt: null, savedAt: { gte: yesterdayStart, lt: localMidnight } };

  const [count, top] = await Promise.all([
    prisma.save.count({ where: savedYesterday }),
    prisma.save.findFirst({
      where: { ...savedYesterday, title: { not: null } },
      orderBy: { savedAt: 'desc' },
      select: { title: true },
    }),
  ]);
  if (count === 0) return;

  await sendMorningDigest({
    userId: user.id,
    token: user.token,
    savedYesterday: count,
    topSaveTitle: top?.title ?? null,
  });
}

export function startMorningDigestScheduler(): void {
  let isRunning = false;

  morningDigestTask = cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        const now = new Date();
        now.setUTCSeconds(0, 0);

        const candidates = await prisma.user.findMany({
          where: {
            morningDigest: true,
            subscriptionStatus: { in: ['pro', 'trial'] },
            notificationToken: { not: null },
            deletedAt: null,
          },
          select: { id: true, timezone: true, notificationToken: true },
        });

        const due = candidates.flatMap((u) => {
          const { hour, minute } = localClock(u.timezone, now);
          if (hour !== DIGEST_LOCAL_HOUR || minute !== 0 || u.notificationToken === null) return [];
          return [{ id: u.id, token: u.notificationToken }];
        });
        if (due.length === 0) return;

        // At 08:00 local, local midnight is exactly 8 hours ago
        const localMidnight = new Date(now.getTime() - DIGEST_LOCAL_HOUR * 60 * 60 * 1000);
        console.info(`[digest-cron] Sending morning digest to ${due.length} user(s)`);

        const BATCH_SIZE = 10;
        for (let i = 0; i < due.length; i += BATCH_SIZE) {
          const results = await Promise.allSettled(
            due.slice(i, i + BATCH_SIZE).map((u) => processMorningDigest(u, localMidnight)),
          );
          for (const r of results) {
            if (r.status === 'rejected') Sentry.captureException(r.reason);
          }
        }
      } catch (err) {
        console.error('[digest-cron] Error:', err);
        Sentry.captureException(err);
      } finally {
        isRunning = false;
      }
    },
    { timezone: 'UTC' },
  );

  console.info('[scheduler] Morning digest cron started (every minute, 08:00 user-local)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Nightly purge — 03:00 UTC (after the 02:00 dead-link check)
//
// Permanently removes saves soft-deleted > 7 days ago and users soft-deleted
// > 30 days ago (PRD §3.7.5). See services/purgeService.ts.
// ─────────────────────────────────────────────────────────────────────────────

export function startNightlyPurge(): void {
  nightlyPurgeTask = cron.schedule(
    '0 3 * * *',
    async () => {
      try {
        const savesPurged = await purgeDeletedSaves();
        const { purged, failed } = await purgeDeletedUsers();
        console.info(
          `[purge] Removed ${savesPurged} save(s) and ${purged} user(s)` +
            (failed > 0 ? ` (${failed} user purge(s) failed — retried next run)` : ''),
        );
      } catch (err) {
        console.error('[purge] Error:', err);
        Sentry.captureException(err);
      }
    },
    { timezone: 'UTC' },
  );

  console.info('[scheduler] Nightly purge cron started (03:00 UTC)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop all cron tasks — called during graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

export function stopSchedulers(): void {
  dailyReminderTask?.stop();
  monthlyResetTask?.stop();
  morningDigestTask?.stop();
  nightlyPurgeTask?.stop();
  console.info('[scheduler] All cron tasks stopped');
}
