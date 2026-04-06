import { Worker, type Job } from 'bullmq';
import { prisma } from '../lib/prisma';
import { redisConnection, QUEUE_NAMES, type AiProcessingJobData } from '../queue';
import { fetchContentMetadata } from '../services/metadataService';
import { classifyContent } from '../services/aiService';
import { Sentry } from '../services/sentry';

// ─────────────────────────────────────────────────────────────────────────────
// AI Processing Worker — PRD §1.2 (Architecture) critical path
//
// Data flow (steps 8–12 from PRD Technical Architecture §1.2):
//
//   8.  Worker picks up job from BullMQ 'ai-processing' queue.
//   9.  Worker fetches URL metadata (OG / YouTube API / Cheerio).
//   10. Worker calls OpenAI GPT-4o-mini with structured prompt.
//   11. Worker updates saves record: processing_status='complete', category,
//       summary, tags, thumbnail_url.
//   12. Supabase Realtime fires change event → mobile app updates live.
//
// Two queues:
//   ai-processing          — free tier (PRD §8.2 — 30s target at p95)
//   ai-processing-priority — Pro tier  (PRD §8.2 — 5s target)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single save: fetch metadata → classify with AI → update DB.
 */
async function processJob(job: Job<AiProcessingJobData>): Promise<void> {
  const { saveId, url, platform } = job.data;

  // Mark as processing
  await prisma.save.update({
    where: { id: saveId },
    data: { processingStatus: 'processing' },
  });

  // Step 8-9: Fetch metadata
  const metadata = await fetchContentMetadata(url, platform);

  // Fetch the user's categories so the AI can pick from the actual list
  const save = await prisma.save.findUnique({
    where: { id: saveId },
    select: { userId: true },
  });
  if (!save) return; // Save was deleted while processing

  const userCategories = await prisma.category.findMany({
    where: { userId: save.userId },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  const categoryNames = userCategories.map((c) => c.name);
  const nameToId = new Map<string, string>(
    userCategories.map((c) => [c.name.toLowerCase(), c.id]),
  );

  // Step 10: Classify with AI (passing the user's actual category names)
  const classification = await classifyContent(metadata, categoryNames);

  if (!classification) {
    // All retries exhausted — PRD §3.2.1: save with processing_status='failed'
    await prisma.save.update({
      where: { id: saveId },
      data: {
        processingStatus: 'failed',
        platform: metadata.platform,
        title: metadata.title || null,
        thumbnailUrl: metadata.thumbnailUrl ?? null,
        creatorName: metadata.channelOrAuthor || null,
      },
    });
    return;
  }

  // Resolve the AI category name to the user's category row using the
  // previously fetched categories. Matching is case-insensitive and always
  // falls back to the user's "Other" category when present.
  let categoryId = nameToId.get(classification.category.toLowerCase()) ?? null;
  if (!categoryId) {
    categoryId = nameToId.get('other') ?? null;
  }

  console.log('[ai-processor] Classification result:', {
    category: classification.category,
    confidence: classification.confidence_score,
    categoryId,
  });

  // Step 11: Update the saves record with AI results
  await prisma.save.update({
    where: { id: saveId },
    data: {
      processingStatus: 'complete',
      categoryId,
      platform: metadata.platform,
      contentType: classification.content_type,
      title: metadata.title || null,
      summary: classification.summary || null,
      thumbnailUrl: metadata.thumbnailUrl ?? null,
      tags: classification.tags,
      creatorName: metadata.channelOrAuthor || null,
      estimatedTimeSeconds: classification.estimated_read_time_seconds || null,
      aiConfidenceScore: classification.confidence_score,
    },
  });

  // Step 12: Supabase Realtime fires automatically when the row is updated —
  // no additional code needed here. The mobile app is subscribed to
  // postgres_changes on the saves table filtered by user_id.
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker instances
// ─────────────────────────────────────────────────────────────────────────────

function createWorker(queueName: string, concurrency: number): Worker<AiProcessingJobData> {
  const worker = new Worker<AiProcessingJobData>(
    queueName,
    async (job: Job<AiProcessingJobData>) => {
      await processJob(job);
    },
    {
      connection: redisConnection,
      concurrency,
      limiter: {
        max: 30,
        duration: 60_000, // 30 jobs per minute to stay under OpenAI rate limits
      },
    },
  );

  worker.on('completed', (job: Job) => {
    console.info(`[${queueName}] Completed job ${job.id} (save: ${job.data.saveId})`);
  });

  worker.on('failed', (job: Job | undefined, error: Error) => {
    const saveId = job?.data?.saveId ?? 'unknown';
    console.error(`[${queueName}] Failed job (save: ${saveId}):`, error.message);
    Sentry.captureException(error, { extra: { queueName, saveId } });
  });

  worker.on('error', (error: Error) => {
    console.error(`[${queueName}] Worker error:`, error.message);
    Sentry.captureException(error, { extra: { queueName } });
  });

  return worker;
}

/** Start both workers. Call once during server bootstrap. */
export function startAiWorkers(): {
  standardWorker: Worker<AiProcessingJobData>;
  priorityWorker: Worker<AiProcessingJobData>;
} {
  console.info('[workers] Starting AI processing workers');

  const standardWorker = createWorker(QUEUE_NAMES.AI_PROCESSING, 3);
  // Priority queue for Pro users — higher concurrency for 5s target
  const priorityWorker = createWorker(QUEUE_NAMES.AI_PROCESSING_PRIORITY, 5);

  return { standardWorker, priorityWorker };
}

/**
 * Gracefully shut down both workers.
 * Call during server shutdown to let in-flight jobs finish.
 */
export async function stopAiWorkers(
  workers: { standardWorker: Worker; priorityWorker: Worker },
): Promise<void> {
  console.info('[workers] Stopping AI processing workers');
  await Promise.all([
    workers.standardWorker.close(),
    workers.priorityWorker.close(),
  ]);
}
