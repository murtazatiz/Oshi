import { prisma } from '../lib/prisma';
import { redisCache } from '../lib/redis';

// ─────────────────────────────────────────────────────────────────────────────
// Smart Sort Service — PRD §3.2.2
//
// Scores each save on four signals, weights them, and returns a stable sorted
// order that is cached in Redis for 1 hour per (user × category) combination.
//
// Score formula (max 1.0):
//   recency    × 0.30   — how recently was it saved?
//   length     × 0.25   — shorter content ranks higher (quick wins first)
//   engagement × 0.25   — user's historical open rate for this content_type+category
//   notification × 0.20 — boosted if save's category appeared in an opened notification
//
// Cache invalidation (call invalidateSmartSortCache) on:
//   • POST /saves          — new item added
//   • PATCH /saves/:id     — status changed to done/skipped, or category changed
//   • POST /engagement/signal — user behaviour updated
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 3_600; // 1 hour — PRD §3.2.2

/** Serialised shape stored in Redis */
export interface ScoredSaveEntry {
  id: string;
  score: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache key helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getCacheKey(
  userId: string,
  categoryId: string | null | undefined,
): string {
  // Use literal 'all' for the cross-category view so the key is always safe
  return `smart_sort:${userId}:${categoryId ?? 'all'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recency signal (30% weight).
 * 1.0 for items saved in the last 24 h, 0.3 for items older than 7 days,
 * with linear decay in between.
 */
function recencyScore(savedAt: Date): number {
  const ageMs = Date.now() - savedAt.getTime();
  const ONE_DAY_MS = 86_400_000;
  const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

  if (ageMs <= ONE_DAY_MS) return 1.0;
  if (ageMs >= SEVEN_DAYS_MS) return 0.3;
  return 1.0 - ((ageMs - ONE_DAY_MS) / (SEVEN_DAYS_MS - ONE_DAY_MS)) * 0.7;
}

/**
 * Content length signal (25% weight).
 * < 5 min (300 s) → 1.0, > 30 min (1800 s) → 0.3, null → 0.5 (neutral).
 * Linear decay between the two bounds.
 */
function contentLengthScore(estimatedTimeSeconds: number | null): number {
  if (estimatedTimeSeconds === null) return 0.5;
  if (estimatedTimeSeconds <= 300) return 1.0;
  if (estimatedTimeSeconds >= 1800) return 0.3;
  return 1.0 - ((estimatedTimeSeconds - 300) / 1500) * 0.7;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query the database, score every qualifying save, sort by score, and write
 * the result to the Redis cache.  Returns the sorted entries.
 *
 * This is the "cold path" — called on cache miss and on explicit invalidation.
 */
async function computeAndCache(
  userId: string,
  categoryId: string | null | undefined,
): Promise<ScoredSaveEntry[]> {
  // ── 1. Fetch all qualifying saves (minimal field set for scoring) ──────────
  const saves = await prisma.save.findMany({
    where: {
      userId,
      deletedAt: null,
      ...(categoryId ? { categoryId } : {}),
    },
    select: {
      id: true,
      savedAt: true,
      estimatedTimeSeconds: true,
      contentType: true,
      categoryId: true,
    },
  });

  if (saves.length === 0) {
    // Cache the empty result so we skip the DB query for empty libraries
    const cacheKey = getCacheKey(userId, categoryId);
    await redisCache.setex(cacheKey, CACHE_TTL_SECONDS, '[]').catch(() => {});
    return [];
  }

  // ── 2. Engagement signal ratios ───────────────────────────────────────────
  // Group by (content_type × category_id × action) for this user, then compute
  // the ratio of 'opened' actions vs total for each (type × category) pair.
  const signalGroups = await prisma.userEngagementSignal.groupBy({
    by: ['contentType', 'categoryId', 'action'],
    where: { userId },
    _count: { action: true },
  });

  const rawEngagement = new Map<string, { opens: number; total: number }>();
  for (const sg of signalGroups) {
    const key = `${sg.contentType ?? ''}:${sg.categoryId ?? ''}`;
    const prev = rawEngagement.get(key) ?? { opens: 0, total: 0 };
    prev.total += sg._count.action;
    if (sg.action === 'opened') prev.opens += sg._count.action;
    rawEngagement.set(key, prev);
  }

  // open ratio: 0.0–1.0. Default 0.5 (neutral) when no data exists yet.
  const engagementMap = new Map<string, number>();
  for (const [key, { opens, total }] of rawEngagement) {
    engagementMap.set(key, total > 0 ? opens / total : 0.5);
  }

  // ── 3. Notification context ───────────────────────────────────────────────
  // A save gets the full notification weight (0.2) when its category has
  // appeared in at least one notification the user actually opened.
  const openedNotifLogs = await prisma.notificationLog.findMany({
    where: { userId, opened: true, categoryId: { not: null } },
    select: { categoryId: true },
  });
  const notifOpenCategoryIds = new Set(
    openedNotifLogs
      .map((l) => l.categoryId)
      .filter((id): id is string => id !== null),
  );

  // ── 4. Score each save ────────────────────────────────────────────────────
  const scored: ScoredSaveEntry[] = saves.map((save) => {
    const engKey = `${save.contentType ?? ''}:${save.categoryId ?? ''}`;
    const engagement = engagementMap.get(engKey) ?? 0.5;
    const notif =
      save.categoryId !== null && notifOpenCategoryIds.has(save.categoryId)
        ? 1.0
        : 0.0;

    const score =
      recencyScore(save.savedAt) * 0.3 +
      contentLengthScore(save.estimatedTimeSeconds) * 0.25 +
      engagement * 0.25 +
      notif * 0.2;

    return { id: save.id, score };
  });

  // ── 5. Sort: score DESC, id ASC (deterministic tiebreaker) ───────────────
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // ── 6. Cache ──────────────────────────────────────────────────────────────
  const cacheKey = getCacheKey(userId, categoryId);
  await redisCache
    .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(scored))
    .catch((err: Error) => {
      console.warn('[smart-sort] Failed to write cache:', err.message);
    });

  return scored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return scored save entries for a user+category in descending score order.
 *
 * Hot path: reads from Redis. If the key is absent or Redis is down, falls
 * back to a fresh DB computation (and re-populates the cache if possible).
 */
export async function getSortedSaveIds(
  userId: string,
  categoryId?: string | null,
): Promise<ScoredSaveEntry[]> {
  const cacheKey = getCacheKey(userId, categoryId);

  try {
    const cached = await redisCache.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as ScoredSaveEntry[];
    }
  } catch (err) {
    // Redis unavailable — log and fall through to fresh computation
    console.warn('[smart-sort] Cache read failed, computing fresh:', (err as Error).message);
  }

  return computeAndCache(userId, categoryId);
}

/**
 * Delete cached sort orders for the given user + one or more category IDs.
 *
 * Always deletes the cross-category 'all' key because any save change affects
 * the merged view, regardless of which category the save belongs to.
 *
 * Pass as many categoryIds as needed (e.g. old + new when reassigning a save).
 * Null/undefined entries are silently ignored.
 *
 * Errors are swallowed — a stale cache is preferable to a 500 response.
 */
export async function invalidateSmartSortCache(
  userId: string,
  ...categoryIds: (string | null | undefined)[]
): Promise<void> {
  try {
    const keys = new Set<string>();

    // The 'all' view is always invalidated
    keys.add(getCacheKey(userId, null));

    for (const catId of categoryIds) {
      if (catId) keys.add(getCacheKey(userId, catId));
    }

    const keyArray = [...keys];
    if (keyArray.length > 0) {
      await redisCache.del(...keyArray);
    }
  } catch (err) {
    console.warn('[smart-sort] Cache invalidation failed:', (err as Error).message);
  }
}
