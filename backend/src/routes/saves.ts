import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { savesLimiter } from '../middleware/rateLimiter';
import { AppError, Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { enqueueAiJob } from '../queue';
import {
  getSortedSaveIds,
  invalidateSmartSortCache,
} from '../services/smartSortService';
import type { Prisma } from '@prisma/client';

const router = Router();

// All saves routes require a valid Supabase JWT
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Prisma select — consistent shape used across all route handlers
// ─────────────────────────────────────────────────────────────────────────────

const saveSelect = {
  id: true,
  url: true,
  title: true,
  summary: true,
  thumbnailUrl: true,
  platform: true,
  contentType: true,
  tags: true,
  creatorName: true,
  estimatedTimeSeconds: true,
  aiConfidenceScore: true,
  processingStatus: true,
  status: true,
  linkStatus: true,
  savedAt: true,
  doneAt: true,
  skippedAt: true,
  viewedAt: true,
  userNote: true,
  manualSortOrder: true,
  userId: true,
  categoryId: true,
  deletedAt: true,
  category: {
    select: { id: true, name: true, emoji: true },
  },
} as const;

type SaveWithCategory = Prisma.SaveGetPayload<{ select: typeof saveSelect }>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect platform from URL hostname.
 * facebook.com/fb.com → facebook, linkedin.com → linkedin, twitter.com/x.com → twitter;
 * these are checked before the generic "web" fallback.
 * Kept local to avoid importing the full metadataService bundle in this route —
 * the BullMQ worker does the authoritative detection after the job is queued.
 */
function detectPlatformFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (/youtube\.com|youtu\.be/.test(hostname)) return 'youtube';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('linkedin.com')) return 'linkedin';
    if (hostname.includes('facebook.com') || hostname.includes('fb.com') || hostname.includes('fb.watch') || hostname.includes('fb.me')) return 'facebook';
    if (hostname.includes('open.spotify.com')) return 'spotify';
    return 'web';
  } catch {
    return 'other';
  }
}

/**
 * Map a Prisma save row → API contract response shape (snake_case).
 * Omits null/undefined optional fields per API contract §1.
 */
function formatSave(save: SaveWithCategory): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: save.id,
    url: save.url,
    processing_status: save.processingStatus,
    status: save.status,
    link_status: save.linkStatus,
    saved_at: save.savedAt.toISOString(),
    // tags is always a JSON array — never return null
    tags: Array.isArray(save.tags) ? (save.tags as string[]) : [],
    category: save.category
      ? { id: save.category.id, name: save.category.name }
      : null,
  };

  // Optional fields — omit when null (API contract §1)
  if (save.title !== null) out.title = save.title;
  if (save.summary !== null) out.summary = save.summary;
  if (save.thumbnailUrl !== null) out.thumbnail_url = save.thumbnailUrl;
  if (save.platform !== null) out.platform = save.platform;
  if (save.contentType !== null) out.content_type = save.contentType;
  if (save.creatorName !== null) out.creator_name = save.creatorName;
  if (save.estimatedTimeSeconds !== null)
    out.estimated_time_seconds = save.estimatedTimeSeconds;
  if (save.aiConfidenceScore !== null)
    out.ai_confidence_score = save.aiConfidenceScore;
  if (save.doneAt !== null) out.done_at = save.doneAt?.toISOString();
  if (save.skippedAt !== null) out.skipped_at = save.skippedAt?.toISOString();
  if (save.viewedAt !== null) out.viewed_at = save.viewedAt?.toISOString();
  if (save.userNote !== null) out.user_note = save.userNote;
  if (save.manualSortOrder !== null) out.manual_sort_order = save.manualSortOrder;

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod request schemas
// ─────────────────────────────────────────────────────────────────────────────

const PostSaveSchema = z.object({
  url: z.string().url('url must be a valid URL'),
  source_app: z.string().optional(),
});

const GetSavesSchema = z.object({
  category_id: z.string().uuid().optional(),
  status: z.enum(['unread', 'done', 'skipped']).optional(),
  sort: z
    .enum(['ai_recommended', 'recent', 'oldest', 'shortest', 'manual'])
    .default('ai_recommended'),
  search: z.string().max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

const PatchSaveSchema = z.object({
  status: z.enum(['unread', 'done', 'skipped']).optional(),
  category_id: z.string().uuid().nullable().optional(),
  user_note: z.string().max(5000).nullable().optional(),
  manual_sort_order: z.number().int().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /saves/check-duplicate
//
// IMPORTANT: registered BEFORE /:id so Express doesn't treat
// the literal string "check-duplicate" as a save UUID parameter.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/check-duplicate',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string') {
        next(Errors.validation({ url: ['url query parameter is required'] }));
        return;
      }

      const existing = await prisma.save.findFirst({
        where: { userId: req.userId, url, deletedAt: null },
        select: { id: true },
      });

      res.json({ exists: !!existing, ...(existing ? { save_id: existing.id } : {}) });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /saves
//
// Query params: category_id, status, sort, search, cursor, limit
// Sort options: ai_recommended | recent | oldest | shortest | manual
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetSavesSchema.safeParse(req.query);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const { category_id, status, sort, search, cursor, limit } = parsed.data;
      const userId = req.userId;

      // ── Base WHERE clause (applied to all sort modes) ─────────────────────
      const baseWhere: Prisma.SaveWhereInput = {
        userId,
        deletedAt: null,
        ...(category_id !== undefined ? { categoryId: category_id } : {}),
        ...(status !== undefined ? { status } : {}),
        // Search across title, summary, user_note, creator_name.
        // Tags (JSONB array) full-text search requires a GIN index + $queryRaw;
        // it is not included here to keep the query in Prisma's type-safe layer.
        ...(search !== undefined && search.length > 0
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' as const } },
                { summary: { contains: search, mode: 'insensitive' as const } },
                { userNote: { contains: search, mode: 'insensitive' as const } },
                { creatorName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      // ── AI Recommended sort (PRD §3.2.2) ─────────────────────────────────
      if (sort === 'ai_recommended') {
        // Get the cached (or freshly computed) scored order from Redis.
        // The service caches per (userId × categoryId) for 1 hour.
        // On cache miss it queries the DB, scores, sorts, and writes back.
        const sortedEntries = await getSortedSaveIds(userId, category_id);

        // Build a position map for O(1) re-sort after fetching save data
        const idToRank = new Map(sortedEntries.map((e, i) => [e.id, i]));

        // Find where the cursor save sits in the sorted order so we know
        // which IDs to fetch (everything after the cursor)
        let startRank = 0;
        if (cursor) {
          const cursorRank = idToRank.get(cursor);
          if (cursorRank !== undefined) startRank = cursorRank + 1;
        }

        // Slice the sorted IDs starting at the cursor position
        const remainingIds = sortedEntries
          .slice(startRank)
          .map((e) => e.id);

        if (remainingIds.length === 0) {
          res.json({ saves: [], next_cursor: null, total_count: 0, has_more: false });
          return;
        }

        // Fetch actual save data for those IDs, applying status/search filters.
        // Also count the total across all pages (not just the current slice).
        const [filteredSaves, totalCount] = await Promise.all([
          prisma.save.findMany({
            where: {
              id: { in: remainingIds },
              // Re-apply the same status/search conditions (deletedAt is already
              // handled by the service not including deleted saves in the cache)
              deletedAt: null,
              ...(status !== undefined ? { status } : {}),
              ...(search !== undefined && search.length > 0
                ? {
                    OR: [
                      { title: { contains: search, mode: 'insensitive' as const } },
                      { summary: { contains: search, mode: 'insensitive' as const } },
                      { userNote: { contains: search, mode: 'insensitive' as const } },
                      { creatorName: { contains: search, mode: 'insensitive' as const } },
                    ],
                  }
                : {}),
            },
            select: saveSelect,
          }),
          // Total count uses the full baseWhere (not sliced by cursor)
          prisma.save.count({ where: baseWhere }),
        ]);

        // Re-sort fetched saves according to the cached rank order
        filteredSaves.sort(
          (a, b) => (idToRank.get(a.id) ?? Infinity) - (idToRank.get(b.id) ?? Infinity),
        );

        const hasMore = filteredSaves.length > limit;
        const page = filteredSaves.slice(0, limit);

        res.json({
          saves: page.map(formatSave),
          next_cursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
          total_count: totalCount,
          has_more: hasMore,
        });
        return;
      }

      // ── Standard sorts — Prisma cursor-based pagination ───────────────────
      const orderBy = ((): Prisma.SaveOrderByWithRelationInput[] => {
        switch (sort) {
          case 'recent':
            return [{ savedAt: 'desc' }, { id: 'asc' }];
          case 'oldest':
            return [{ savedAt: 'asc' }, { id: 'asc' }];
          case 'shortest':
            return [
              { estimatedTimeSeconds: { sort: 'asc', nulls: 'last' } },
              { id: 'asc' },
            ];
          case 'manual':
            // Manual sort falls back to most-recent for items with no custom order
            return [
              { manualSortOrder: { sort: 'asc', nulls: 'last' } },
              { savedAt: 'desc' },
              { id: 'asc' },
            ];
          default:
            return [{ savedAt: 'desc' }, { id: 'asc' }];
        }
      })();

      // Fetch limit+1 rows to determine has_more without a second round-trip
      const [saves, totalCount] = await Promise.all([
        prisma.save.findMany({
          where: baseWhere,
          select: saveSelect,
          orderBy,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: limit + 1,
        }),
        prisma.save.count({ where: baseWhere }),
      ]);

      const hasMore = saves.length > limit;
      const page = hasMore ? saves.slice(0, limit) : saves;

      res.json({
        saves: page.map(formatSave),
        next_cursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
        total_count: totalCount,
        has_more: hasMore,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /saves
//
// Rate limited 60/min/user (PRD §9).
// Returns 201 immediately — AI processing runs asynchronously via BullMQ.
// Response target: <300ms (PRD §10.1).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  savesLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PostSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const { url } = parsed.data;
      const userId = req.userId;

      // ── Fetch user (subscription + monthly counter) ───────────────────────
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          subscriptionStatus: true,
          itemsSavedThisMonth: true,
          deletedAt: true,
        },
      });
      if (!user || user.deletedAt !== null) {
        next(Errors.notFound('User'));
        return;
      }

      const isPro =
        user.subscriptionStatus === 'pro' || user.subscriptionStatus === 'trial';

      // ── Free tier save limit — PRD §8.1 (20 saves/month) ─────────────────
      if (!isPro && user.itemsSavedThisMonth >= 20) {
        next(Errors.saveLimitReached());
        return;
      }

      // ── Duplicate URL check — API contract §3 ─────────────────────────────
      const existing = await prisma.save.findFirst({
        where: { userId, url, deletedAt: null },
        select: saveSelect,
      });
      if (existing) {
        res.status(200).json({ ...formatSave(existing), duplicate: true });
        return;
      }

      // ── Detect platform for the immediate response ─────────────────────────
      const platform = detectPlatformFromUrl(url);

      // ── Default category: 'Other' (seeded at signup for every user) ───────
      const otherCategory = await prisma.category.findFirst({
        where: { userId, name: 'Other' },
        select: { id: true },
      });

      // ── Atomic: create save row + increment monthly counter ───────────────
      const [newSave] = await prisma.$transaction([
        prisma.save.create({
          data: {
            userId,
            url,
            platform,
            processingStatus: 'pending',
            status: 'unread',
            linkStatus: 'active',
            categoryId: otherCategory?.id ?? null,
            tags: [],
          },
          select: saveSelect,
        }),
        prisma.user.update({
          where: { id: userId },
          data: { itemsSavedThisMonth: { increment: 1 } },
        }),
      ]);

      // ── Enqueue AI processing — Pro users get priority queue (PRD §8.2) ───
      await enqueueAiJob({ saveId: newSave.id, url, platform }, isPro);

      // ── Invalidate smart sort cache (PRD §3.2.2) ──────────────────────────
      // A new save changes the recency ranking for this user's library.
      // Always invalidate the 'all' view and the assigned category view.
      await invalidateSmartSortCache(userId, newSave.categoryId);

      res.status(201).json(formatSave(newSave));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /saves/:id — full save detail
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // req.params is typed as ParamsDictionary = { [key: string]: string }
      // The explicit cast guards against exactOptionalPropertyTypes strictness.
      const saveId = req.params['id'] as string;

      const save = await prisma.save.findFirst({
        where: { id: saveId, userId: req.userId, deletedAt: null },
        select: saveSelect,
      });
      if (!save) {
        next(Errors.notFound('Save'));
        return;
      }

      res.json(formatSave(save));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /saves/:id
//
// Allowed fields: status, category_id, user_note, manual_sort_order.
// status='done'    → done_at = NOW(), skipped_at = null
// status='skipped' → skipped_at = NOW(), done_at = null
// status='unread'  → both timestamps cleared
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PatchSaveSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const saveId = req.params['id'] as string;
      const { status, category_id, user_note, manual_sort_order } = parsed.data;

      // Verify ownership
      const existing = await prisma.save.findFirst({
        where: { id: saveId, userId: req.userId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        next(Errors.notFound('Save'));
        return;
      }

      // Verify the target category belongs to this user
      if (category_id !== undefined && category_id !== null) {
        const cat = await prisma.category.findFirst({
          where: { id: category_id, userId: req.userId },
          select: { id: true },
        });
        if (!cat) {
          next(Errors.notFound('Category'));
          return;
        }
      }

      const data: Prisma.SaveUpdateInput = {};

      if (status !== undefined) {
        data.status = status;
        if (status === 'done') {
          data.doneAt = new Date();
          data.skippedAt = null;
        } else if (status === 'skipped') {
          data.skippedAt = new Date();
          data.doneAt = null;
        } else {
          // Reverting to 'unread' clears both timestamps
          data.doneAt = null;
          data.skippedAt = null;
        }
      }

      // In Prisma 5, FK fields on relations are updated via the relation object
      if (category_id !== undefined) {
        if (category_id === null) {
          data.category = { disconnect: true };
        } else {
          data.category = { connect: { id: category_id } };
        }
      }

      if (user_note !== undefined) data.userNote = user_note;
      if (manual_sort_order !== undefined) data.manualSortOrder = manual_sort_order;

      // Fetch the save before updating so we know the OLD category for cache
      // invalidation in case the category is being changed.
      const beforeUpdate = await prisma.save.findUnique({
        where: { id: saveId },
        select: { categoryId: true },
      });

      const updated = await prisma.save.update({
        where: { id: saveId },
        data,
        select: saveSelect,
      });

      // ── Invalidate smart sort cache (PRD §3.2.2) ──────────────────────────
      // Invalidate when:
      //   • status → done or skipped (changes smart sort ranking)
      //   • category changes (affects both old and new category caches)
      const statusChanged =
        status === 'done' || status === 'skipped' || status === 'unread';
      const categoryChanged = category_id !== undefined;

      if (statusChanged || categoryChanged) {
        // Pass old categoryId (before update) and new categoryId so both
        // category-specific caches are cleared.
        await invalidateSmartSortCache(
          req.userId,
          beforeUpdate?.categoryId,   // old category
          updated.categoryId,         // new category (may be same)
        );
      }

      res.json(formatSave(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /saves/:id — soft delete (sets deleted_at = NOW())
//
// Record is excluded from all GET queries immediately.
// Permanently purged after 7 days by a nightly cron job.
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const saveId = req.params['id'] as string;

      const existing = await prisma.save.findFirst({
        where: { id: saveId, userId: req.userId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) {
        next(Errors.notFound('Save'));
        return;
      }

      await prisma.save.update({
        where: { id: saveId },
        data: { deletedAt: new Date() },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /saves/:id/retry — re-queue a failed AI processing job
//
// Only saves with processing_status='failed' are eligible (PRD §3.3.3).
// Resets processing_status → 'pending' so the card shows the Processing state.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/:id/retry',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const saveId = req.params['id'] as string;

      const save = await prisma.save.findFirst({
        where: { id: saveId, userId: req.userId, deletedAt: null },
        select: {
          id: true,
          url: true,
          platform: true,
          processingStatus: true,
        },
      });
      if (!save) {
        next(Errors.notFound('Save'));
        return;
      }

      if (save.processingStatus !== 'failed') {
        next(
          new AppError(
            'VALIDATION_ERROR',
            'Only saves with processing_status="failed" can be retried.',
            422,
          ),
        );
        return;
      }

      // Determine queue priority from user's subscription status
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { subscriptionStatus: true },
      });
      const isPro =
        user?.subscriptionStatus === 'pro' || user?.subscriptionStatus === 'trial';

      // Reset status so the mobile app reflects the Processing state via Realtime
      await prisma.save.update({
        where: { id: saveId },
        data: { processingStatus: 'pending' },
      });

      await enqueueAiJob(
        { saveId: save.id, url: save.url, platform: save.platform ?? 'other' },
        isPro,
      );

      res.json({ queued: true, save_id: saveId });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
