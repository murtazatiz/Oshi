import { prisma } from '../lib/prisma';
import { supabaseAdmin } from '../middleware/auth';
import { Sentry } from './sentry';

// ─────────────────────────────────────────────────────────────────────────────
// Soft-delete purge — PRD §3.3 / §3.7.5
//
// DELETE /saves/:id and DELETE /users/me only set deleted_at. This module
// permanently removes what has outlived its retention window:
//   saves  — deleted_at older than 7 days  (undo window is long gone)
//   users  — deleted_at older than 30 days (PRD §3.7.5: "purges all data")
//
// Dependent rows are deleted explicitly, in one transaction per batch/user,
// rather than relying on ON DELETE CASCADE: schema.prisma declares cascades,
// but the live schema was created by hand (no migrations baseline — see
// ADR-0020), so the database's constraints can't be assumed to match.
// ─────────────────────────────────────────────────────────────────────────────

export const SAVE_RETENTION_DAYS = 7;
export const USER_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const SAVE_BATCH_SIZE = 500;
/** Users purged per run — a backlog clears over successive nights. */
const USER_BATCH_SIZE = 100;

/** Must match AVATAR_BUCKET in routes/users.ts (avatars/[user_id]/profile.jpg). */
const AVATAR_BUCKET = 'avatars';

/** Permanently delete saves soft-deleted more than 7 days before `now`. Returns the count removed. */
export async function purgeDeletedSaves(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SAVE_RETENTION_DAYS * DAY_MS);
  let purged = 0;

  for (;;) {
    const batch = await prisma.save.findMany({
      where: { deletedAt: { lt: cutoff } },
      select: { id: true },
      take: SAVE_BATCH_SIZE,
    });
    if (batch.length === 0) break;

    const ids = batch.map((s) => s.id);
    await prisma.$transaction([
      prisma.userEngagementSignal.deleteMany({ where: { saveId: { in: ids } } }),
      prisma.save.deleteMany({ where: { id: { in: ids } } }),
    ]);
    purged += ids.length;
    if (batch.length < SAVE_BATCH_SIZE) break;
  }

  return purged;
}

/**
 * Permanently delete users soft-deleted more than 30 days before `now`: all
 * their rows, their avatar, and their Supabase Auth account (so the email
 * can't sign back into an account with no data behind it). A failure on one
 * user is reported and skipped; it is retried on the next run.
 */
export async function purgeDeletedUsers(
  now: Date = new Date(),
): Promise<{ purged: number; failed: number }> {
  const cutoff = new Date(now.getTime() - USER_RETENTION_DAYS * DAY_MS);
  const users = await prisma.user.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
    take: USER_BATCH_SIZE,
  });

  let purged = 0;
  let failed = 0;

  for (const { id: userId } of users) {
    try {
      await prisma.$transaction([
        prisma.userEngagementSignal.deleteMany({ where: { userId } }),
        prisma.notificationLog.deleteMany({ where: { userId } }),
        prisma.save.deleteMany({ where: { userId } }),
        prisma.category.deleteMany({ where: { userId } }),
        prisma.user.delete({ where: { id: userId } }),
      ]);

      // Removing a file that doesn't exist is not an error in Supabase Storage
      const { error: storageError } = await supabaseAdmin.storage
        .from(AVATAR_BUCKET)
        .remove([`${userId}/profile.jpg`]);
      if (storageError) {
        Sentry.captureException(storageError, { extra: { userId, step: 'avatar' } });
      }

      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      // 404: the auth user is already gone (e.g. removed in the dashboard)
      if (authError && authError.status !== 404) {
        Sentry.captureException(authError, { extra: { userId, step: 'auth' } });
      }

      purged += 1;
    } catch (err) {
      failed += 1;
      Sentry.captureException(err, { extra: { userId, step: 'database' } });
    }
  }

  return { purged, failed };
}
