import { Queue, type ConnectionOptions } from 'bullmq';

// ─────────────────────────────────────────────────────────────────────────────
// Redis connection — used by both queues and workers.
// REDIS_URL is auto-injected by Railway in staging/production (PRD §5.1).
// Defaults to localhost for development.
// ─────────────────────────────────────────────────────────────────────────────
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const parsedUrl = new URL(redisUrl);

export const redisConnection: ConnectionOptions = {
  host: parsedUrl.hostname,
  port: parseInt(parsedUrl.port || '6379', 10),
  ...(parsedUrl.password ? { password: decodeURIComponent(parsedUrl.password) } : {}),
  ...(parsedUrl.username && parsedUrl.username !== 'default'
    ? { username: parsedUrl.username }
    : {}),
};

// ─────────────────────────────────────────────────────────────────────────────
// Queue names
// ─────────────────────────────────────────────────────────────────────────────
export const QUEUE_NAMES = {
  AI_PROCESSING: 'ai-processing',
  AI_PROCESSING_PRIORITY: 'ai-processing-priority',
  NOTIFICATION_SCHEDULER: 'notification-scheduler',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Job data types
// ─────────────────────────────────────────────────────────────────────────────
export interface AiProcessingJobData {
  saveId: string;
  url: string;
  platform: string;
}

/**
 * Payload for scheduled push notification jobs.
 * Processed by the notification worker when the delayed job fires.
 */
export interface NotificationJobData {
  /** Oshi user UUID — used to look up push token at fire time */
  userId: string;
  /** 'trial_expiry_warning' = 24h before trial ends, 'trial_expiry_day' = on the day */
  notificationType: 'trial_expiry_warning' | 'trial_expiry_day';
  /** ISO timestamp of when the trial/subscription expires (for message copy) */
  expiresAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queues
// ─────────────────────────────────────────────────────────────────────────────

/** Free tier AI processing queue (PRD §8.2 — 30s target at p95) */
export const aiProcessingQueue = new Queue<AiProcessingJobData>(
  QUEUE_NAMES.AI_PROCESSING,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    },
  },
);

/** Pro tier AI processing queue — higher priority (PRD §8.2 — 5s target) */
export const aiProcessingPriorityQueue = new Queue<AiProcessingJobData>(
  QUEUE_NAMES.AI_PROCESSING_PRIORITY,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 5_000 },
    },
  },
);

/** Notification scheduler queue — delayed jobs for push notifications */
export const notificationQueue = new Queue<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATION_SCHEDULER,
  {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1_000 },
    },
  },
);

/**
 * Enqueue an AI processing job.
 * Picks the priority queue for Pro users (PRD §8.2 — 5s target vs 30s free).
 */
export async function enqueueAiJob(
  data: AiProcessingJobData,
  isPro: boolean,
): Promise<void> {
  const queue = isPro ? aiProcessingPriorityQueue : aiProcessingQueue;
  await queue.add('process-save', data);
}

/**
 * Schedule a push notification job to fire at a specific future timestamp.
 * Uses BullMQ's `delay` option so the job is held until it's time to send.
 *
 * @param data      Job payload (userId, notificationType, expiresAt)
 * @param fireAtMs  Unix timestamp (ms) when the notification should be sent
 */
export async function scheduleNotification(
  data: NotificationJobData,
  fireAtMs: number,
): Promise<void> {
  const delay = Math.max(0, fireAtMs - Date.now());
  await notificationQueue.add(data.notificationType, data, { delay });
}
