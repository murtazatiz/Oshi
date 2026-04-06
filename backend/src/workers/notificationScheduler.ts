import { Worker, type Job } from 'bullmq';
import { redisConnection, QUEUE_NAMES, type NotificationJobData } from '../queue';
import { prisma } from '../lib/prisma';
import {
  sendTrialExpiryWarning,
  sendTrialExpiryDay,
} from '../services/notificationService';
import { Sentry } from '../services/sentry';

// ─────────────────────────────────────────────────────────────────────────────
// Notification Scheduler Worker
//
// Processes delayed BullMQ jobs from the 'notification-scheduler' queue.
// Jobs are enqueued by the subscription webhook handler (subscriptions.ts)
// when a TRIAL_STARTED event fires.
//
// Job types:
//   trial_expiry_warning  — fires 24 h before trial ends (PRD §3.4.3)
//   trial_expiry_day      — fires at trial expiry; also sets banner flag
//
// Design decisions:
//   - Push token is read at fire time (not at schedule time) so that token
//     changes during the trial period are always honoured.
//   - State is re-validated at fire time: if the user has already converted
//     to Pro, cancelled, or deleted their account, the job is silently skipped.
//   - Worker concurrency = 5 (notification jobs are I/O-bound, not CPU-bound).
// ─────────────────────────────────────────────────────────────────────────────

async function handleTrialExpiryWarning(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      notificationToken: true,
      notificationPermission: true,
      subscriptionStatus: true,
      deletedAt: true,
    },
  });

  // Guard: user may have been deleted or upgraded since the job was scheduled
  if (!user || user.deletedAt !== null) {
    console.info(
      `[notif-worker] trial_expiry_warning skipped — user ${userId} deleted`,
    );
    return;
  }

  if (user.subscriptionStatus === 'pro') {
    console.info(
      `[notif-worker] trial_expiry_warning skipped — user ${userId} already Pro`,
    );
    return;
  }

  if (user.notificationPermission !== 'granted' || !user.notificationToken) {
    console.info(
      `[notif-worker] trial_expiry_warning skipped — user ${userId} has no push token`,
    );
    return;
  }

  await sendTrialExpiryWarning({
    userId,
    token: user.notificationToken,
  });

  console.info(`[notif-worker] trial_expiry_warning sent to user ${userId}`);
}

async function handleTrialExpiryDay(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      notificationToken: true,
      notificationPermission: true,
      subscriptionStatus: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt !== null) {
    console.info(
      `[notif-worker] trial_expiry_day skipped — user ${userId} deleted`,
    );
    return;
  }

  // If user converted to Pro before expiry, still clear any banner that might
  // have been set, but don't send the notification.
  if (user.subscriptionStatus === 'pro') {
    // Clear any previously set banner flag
    await prisma.user.update({
      where: { id: userId },
      data: { trialExpiryBannerDue: false },
    });
    console.info(
      `[notif-worker] trial_expiry_day skipped — user ${userId} already Pro`,
    );
    return;
  }

  // sendTrialExpiryDay sets trialExpiryBannerDue = true regardless of push
  // delivery (PRD §3.4.3 — in-app banner is separate from push).
  const token = user.notificationToken ?? '';
  const hasToken =
    user.notificationPermission === 'granted' && user.notificationToken !== null;

  if (hasToken) {
    await sendTrialExpiryDay({ userId, token });
  } else {
    // No push token — still set the in-app banner flag
    await prisma.user.update({
      where: { id: userId },
      data: { trialExpiryBannerDue: true },
    });
  }

  console.info(`[notif-worker] trial_expiry_day processed for user ${userId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────────────────────

export function startNotificationWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    QUEUE_NAMES.NOTIFICATION_SCHEDULER,
    async (job: Job<NotificationJobData>): Promise<void> => {
      const { userId, notificationType } = job.data;

      switch (notificationType) {
        case 'trial_expiry_warning':
          await handleTrialExpiryWarning(userId);
          break;

        case 'trial_expiry_day':
          await handleTrialExpiryDay(userId);
          break;

        default: {
          const _exhaustive: never = notificationType;
          console.warn(
            `[notif-worker] Unknown notification type: ${String(_exhaustive)}`,
          );
        }
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[notif-worker] Job ${job?.id ?? 'unknown'} failed:`, err);
    Sentry.captureException(err, {
      extra: { jobId: job?.id, jobData: job?.data as unknown },
    });
  });

  worker.on('error', (err) => {
    console.error('[notif-worker] Worker error:', err);
    Sentry.captureException(err);
  });

  console.info('[notif-worker] Notification scheduler worker started');
  return worker;
}

export async function stopNotificationWorker(
  worker: Worker<NotificationJobData>,
): Promise<void> {
  await worker.close();
  console.info('[notif-worker] Notification scheduler worker stopped');
}
