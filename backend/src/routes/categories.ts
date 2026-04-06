import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { invalidateSmartSortCache } from '../services/smartSortService';
import type { Prisma } from '@prisma/client';

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const PostCategorySchema = z.object({
  name: z.string().min(1).max(50),
  emoji: z.string().min(1).max(10).default('📌'),
  sort_order: z.number().int().min(0).optional(),
});

const PatchCategorySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  emoji: z.string().min(1).max(10).optional(),
  // TIMETZ stored as string — format validated by DB CHECK constraint
  reminder_override_time: z.string().nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared formatting helper
// ─────────────────────────────────────────────────────────────────────────────

function formatCategory(
  cat: {
    id: string;
    name: string;
    emoji: string;
    sortOrder: number;
    isSystemDefault: boolean;
    reminderOverrideTime: string | null;
    createdAt: Date;
  },
  counts: { unread: number; total: number },
): Record<string, unknown> {
  return {
    id: cat.id,
    name: cat.name,
    emoji: cat.emoji,
    sort_order: cat.sortOrder,
    is_system_default: cat.isSystemDefault,
    unread_count: counts.unread,
    total_count: counts.total,
    created_at: cat.createdAt.toISOString(),
    ...(cat.reminderOverrideTime !== null
      ? { reminder_override_time: cat.reminderOverrideTime }
      : { reminder_override_time: null }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /categories
//
// Returns all categories for the authenticated user with unread and total
// save counts. Sorted by sort_order ASC, then created_at ASC.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;

      // Fetch categories and save counts in parallel
      const [categories, totalCounts, unreadCounts] = await Promise.all([
        prisma.category.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            emoji: true,
            sortOrder: true,
            isSystemDefault: true,
            reminderOverrideTime: true,
            createdAt: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        // Total saves per category (not deleted)
        prisma.save.groupBy({
          by: ['categoryId'],
          where: { userId, deletedAt: null },
          _count: { id: true },
        }),
        // Unread saves per category (not deleted)
        prisma.save.groupBy({
          by: ['categoryId'],
          where: { userId, deletedAt: null, status: 'unread' },
          _count: { id: true },
        }),
      ]);

      // Build lookup maps from categoryId → count
      const totalMap = new Map(totalCounts.map((r) => [r.categoryId, r._count.id]));
      const unreadMap = new Map(unreadCounts.map((r) => [r.categoryId, r._count.id]));

      res.json({
        categories: categories.map((cat) =>
          formatCategory(cat, {
            total: totalMap.get(cat.id) ?? 0,
            unread: unreadMap.get(cat.id) ?? 0,
          }),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /categories
//
// Free tier limit: 3 active categories max (PRD §8.1, API contract §4).
// Pro users: unlimited.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PostCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const userId = req.userId;
      const { name, emoji, sort_order } = parsed.data;

      // ── Free tier category limit check ────────────────────────────────────
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionStatus: true },
      });

      const isPro =
        user?.subscriptionStatus === 'pro' || user?.subscriptionStatus === 'trial';

      if (!isPro) {
        const categoryCount = await prisma.category.count({ where: { userId } });
        if (categoryCount >= 3) {
          next(Errors.categoryLimitReached());
          return;
        }
      }

      // Determine next sort_order if not provided
      const nextSortOrder =
        sort_order !== undefined
          ? sort_order
          : await prisma.category
              .aggregate({ where: { userId }, _max: { sortOrder: true } })
              .then((r) => (r._max.sortOrder ?? -1) + 1);

      const category = await prisma.category.create({
        data: {
          userId,
          name,
          emoji,
          sortOrder: nextSortOrder,
          isSystemDefault: false,
        },
        select: {
          id: true,
          name: true,
          emoji: true,
          sortOrder: true,
          isSystemDefault: true,
          reminderOverrideTime: true,
          createdAt: true,
        },
      });

      res.status(201).json(formatCategory(category, { unread: 0, total: 0 }));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /categories/:id
//
// Updates name, emoji, reminder_override_time (Pro feature), sort_order.
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PatchCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const categoryId = req.params['id'] as string;
      const userId = req.userId;
      const { name, emoji, reminder_override_time, sort_order } = parsed.data;

      // Verify ownership
      const existing = await prisma.category.findFirst({
        where: { id: categoryId, userId },
        select: { id: true },
      });
      if (!existing) {
        next(Errors.notFound('Category'));
        return;
      }

      const data: Prisma.CategoryUpdateInput = {};
      if (name !== undefined) data.name = name;
      if (emoji !== undefined) data.emoji = emoji;
      if (reminder_override_time !== undefined)
        data.reminderOverrideTime = reminder_override_time;
      if (sort_order !== undefined) data.sortOrder = sort_order;

      const updated = await prisma.category.update({
        where: { id: categoryId },
        data,
        select: {
          id: true,
          name: true,
          emoji: true,
          sortOrder: true,
          isSystemDefault: true,
          reminderOverrideTime: true,
          createdAt: true,
        },
      });

      // Category name/emoji changes affect smart sort display — invalidate cache
      await invalidateSmartSortCache(userId, categoryId);

      res.json(formatCategory(updated, { unread: 0, total: 0 }));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /categories/:id
//
// Business rules (API contract §4, PRD §3.7.3):
//   1. Cannot delete the 'Other' category — it is the global fallback.
//   2. All saves in the deleted category are moved to 'Other' first.
//   3. Then the category itself is deleted.
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const categoryId = req.params['id'] as string;
      const userId = req.userId;

      // Verify ownership and fetch the category name
      const category = await prisma.category.findFirst({
        where: { id: categoryId, userId },
        select: { id: true, name: true },
      });
      if (!category) {
        next(Errors.notFound('Category'));
        return;
      }

      // Prevent deleting the 'Other' category — it is the universal fallback
      if (category.name === 'Other') {
        next(
          Errors.validation({
            _errors: ["The 'Other' category cannot be deleted."],
          }),
        );
        return;
      }

      // Find the user's 'Other' category to receive the orphaned saves
      const otherCategory = await prisma.category.findFirst({
        where: { userId, name: 'Other' },
        select: { id: true },
      });

      // Atomically: re-home saves → delete category
      await prisma.$transaction([
        // Move all saves (including done/skipped) to Other
        prisma.save.updateMany({
          where: { categoryId, userId, deletedAt: null },
          data: {
            categoryId: otherCategory?.id ?? null,
          },
        }),
        // Delete the category
        prisma.category.delete({ where: { id: categoryId } }),
      ]);

      // Invalidate smart sort for both the deleted category and Other
      await invalidateSmartSortCache(userId, categoryId, otherCategory?.id);

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default router;
