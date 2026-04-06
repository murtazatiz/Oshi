import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';
import { invalidateSmartSortCache } from '../services/smartSortService';

const router = Router();

// All engagement routes require a valid JWT
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema
// ─────────────────────────────────────────────────────────────────────────────

const PostSignalSchema = z.object({
  save_id: z.string().uuid('save_id must be a valid UUID'),
  action: z.enum(['opened', 'skipped', 'done'], {
    errorMap: () => ({ message: 'action must be one of: opened, skipped, done' }),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /engagement/signal
//
// Called by the mobile app to record user interaction with a save:
//   'opened'  — user tapped a card to view the content detail
//   'done'    — user explicitly marked the save as done
//   'skipped' — user explicitly marked the save as skipped
//
// These signals feed the AI smart sort algorithm (PRD §3.2.2):
//   higher open rate for a (content_type × category) pair → that combination
//   ranks higher for this user in future smart sort results.
//
// After inserting the signal, the smart sort cache for this user is
// invalidated so the next GET /saves reflects the updated preference model.
//
// API contract §7: returns { recorded: true } on success.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/signal',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PostSignalSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const { save_id, action } = parsed.data;
      const userId = req.userId;

      // ── Fetch save to verify ownership and get metadata for the signal ────
      // We need content_type and category_id to make the signal queryable
      // by the smart sort scoring function.
      const save = await prisma.save.findFirst({
        where: { id: save_id, userId, deletedAt: null },
        select: { id: true, contentType: true, categoryId: true },
      });

      if (!save) {
        next(Errors.notFound('Save'));
        return;
      }

      // ── Insert engagement signal ───────────────────────────────────────────
      await prisma.userEngagementSignal.create({
        data: {
          userId,
          saveId: save.id,
          action,
          // Store content_type and category_id denormalised so the smart sort
          // aggregation query (GROUP BY contentType, categoryId, action) never
          // needs to JOIN back to the saves table.
          contentType: save.contentType,
          categoryId: save.categoryId,
        },
      });

      // ── Invalidate smart sort cache ────────────────────────────────────────
      // The engagement ratio for this (content_type × category) combination
      // has changed, so the cached sort order is stale.
      // Always invalidates 'all' key + the specific category key.
      await invalidateSmartSortCache(userId, save.categoryId);

      res.json({ recorded: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
