import cron from 'node-cron';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { Sentry } from '../services/sentry';
import { subDays } from 'date-fns';

// ─────────────────────────────────────────────────────────────────────────────
// Dead Link Detection — PRD §3.2.3
//
// Background job runs nightly at 2 AM UTC for all saves that are:
//   - older than 7 days (saved_at < NOW() - 7 days)
//   - not marked as done (status != 'done')
//   - not soft-deleted (deleted_at IS NULL)
//
// HEAD request with 5-second timeout:
//   200           → link_status = 'active'
//   404, 410      → link_status = 'unavailable'
//   401, 403      → link_status = 'private'
//   Connection refused / timeout → link_status = 'unavailable'
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const HEAD_TIMEOUT = 5_000; // PRD §3.2.3: 5-second timeout
const CONCURRENT_CHECKS = 10;

type LinkStatus = 'active' | 'unavailable' | 'private';

/**
 * Determine link status from an HTTP HEAD request.
 */
async function checkUrl(url: string): Promise<LinkStatus> {
  try {
    const response = await axios.head(url, {
      timeout: HEAD_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on any HTTP status
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OshiBot/1.0; +https://oshi.app)',
      },
    });

    const status = response.status;

    if (status >= 200 && status < 400) return 'active';
    if (status === 401 || status === 403) return 'private';
    if (status === 404 || status === 410) return 'unavailable';

    // Other 4xx/5xx — treat as unavailable
    return 'unavailable';
  } catch {
    // Network error, timeout, connection refused → unavailable
    return 'unavailable';
  }
}

/**
 * Process a batch of saves, checking each URL concurrently (up to CONCURRENT_CHECKS).
 */
async function processBatch(
  saves: Array<{ id: string; url: string; linkStatus: string }>,
): Promise<{ checked: number; updated: number }> {
  let updated = 0;

  // Process in chunks of CONCURRENT_CHECKS to avoid overwhelming the network
  for (let i = 0; i < saves.length; i += CONCURRENT_CHECKS) {
    const chunk = saves.slice(i, i + CONCURRENT_CHECKS);

    const results = await Promise.allSettled(
      chunk.map(async (save) => {
        const newStatus = await checkUrl(save.url);

        // Only update if the status actually changed
        if (newStatus !== save.linkStatus) {
          await prisma.save.update({
            where: { id: save.id },
            data: { linkStatus: newStatus },
          });
          updated++;
        }
      }),
    );

    // Log any unexpected errors (they should be caught by checkUrl, but just in case)
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[dead-link] Unexpected error in batch:', result.reason);
      }
    }
  }

  return { checked: saves.length, updated };
}

/**
 * Run the full dead link check — processes all qualifying saves in batches.
 */
async function runDeadLinkCheck(): Promise<void> {
  const startTime = Date.now();
  console.info('[dead-link] Starting nightly dead link check');

  const sevenDaysAgo = subDays(new Date(), 7);

  let totalChecked = 0;
  let totalUpdated = 0;
  let cursor: string | undefined;

  // Paginate through all qualifying saves using cursor-based pagination
  // to avoid loading everything into memory at once
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rawSaves = await prisma.save.findMany({
      where: {
        savedAt: { lt: sevenDaysAgo },
        status: { not: 'done' },
        deletedAt: null,
      },
      select: {
        id: true,
        url: true,
        linkStatus: true,
      },
      take: BATCH_SIZE,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
      orderBy: { id: 'asc' },
    });

    if (rawSaves.length === 0) break;

    const { checked, updated } = await processBatch(rawSaves);
    totalChecked += checked;
    totalUpdated += updated;

    const lastSave = rawSaves[rawSaves.length - 1];
    cursor = lastSave?.id;

    if (rawSaves.length < BATCH_SIZE) break;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.info(
    `[dead-link] Completed: ${totalChecked} checked, ${totalUpdated} updated, ${elapsed}s elapsed`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron scheduler
// PRD §3.2.3: runs nightly at 2 AM UTC
// ─────────────────────────────────────────────────────────────────────────────

let scheduledTask: cron.ScheduledTask | null = null;

/**
 * Start the dead link checker cron job.
 * Call once during server bootstrap.
 */
export function startDeadLinkChecker(): void {
  // '0 2 * * *' = every day at 02:00 UTC
  scheduledTask = cron.schedule(
    '0 2 * * *',
    () => {
      runDeadLinkCheck().catch((err: unknown) => {
        console.error('[dead-link] Cron job failed:', err);
        Sentry.captureException(err);
      });
    },
    { timezone: 'UTC' },
  );

  console.info('[dead-link] Cron job scheduled: nightly at 2 AM UTC');
}

/**
 * Stop the dead link checker cron job.
 * Call during graceful shutdown.
 */
export function stopDeadLinkChecker(): void {
  scheduledTask?.stop();
  scheduledTask = null;
}

/**
 * Manually trigger a dead link check (useful for testing and admin endpoints).
 */
export { runDeadLinkCheck };
