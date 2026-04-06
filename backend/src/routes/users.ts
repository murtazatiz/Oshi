import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { supabaseAdmin } from '../middleware/auth';
import { Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Avatar upload — multer with memory storage
//
// PRD §3.7.1: "compress to max 500KB (expo-image-manipulator on client)"
// The 500KB limit is enforced at client side before upload. The backend
// accepts up to 600KB to allow for minor encoding overhead.
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_MAX_BYTES = 600 * 1024; // 600 KB
const AVATAR_BUCKET = 'avatars';
const SIGNED_URL_TTL_SECONDS = 365 * 24 * 3600; // 1 year

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are accepted.'));
    }
  },
}).single('avatar');

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const PatchMeSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(100).optional(),
  notification_permission: z.enum(['not_asked', 'granted', 'denied']).optional(),
  /**
   * Updated by the app on every foreground event (PRD §3.4.2).
   * Backend uses this to decide whether to skip sending a push notification
   * when the user opened the app within 2 hours of their reminder time.
   */
  last_opened_at: z.string().datetime({ message: 'last_opened_at must be an ISO 8601 datetime string' }).optional(),
  /**
   * Set to true by the app after showing the day-3 notification re-request
   * modal (PRD §3.4.2) — prevents the modal from appearing again.
   */
  notification_reask_shown: z.boolean().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Response formatter — maps Prisma user → API contract shape
// ─────────────────────────────────────────────────────────────────────────────

function formatUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  subscriptionStatus: string;
  subscriptionExpiresAt: Date | null;
  streakCount: number;
  itemsSavedThisMonth: number;
  notificationPermission: string;
  reminderTime: string;
  reminderDays: unknown;
  trialStartedAt: Date | null;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    subscription_status: user.subscriptionStatus,
    streak_count: user.streakCount,
    items_saved_this_month: user.itemsSavedThisMonth,
    notification_permission: user.notificationPermission,
    reminder_time: user.reminderTime,
    reminder_days: user.reminderDays,
  };

  if (user.displayName !== null) out.display_name = user.displayName;
  if (user.avatarUrl !== null) out.avatar_url = user.avatarUrl;
  if (user.subscriptionExpiresAt !== null)
    out.subscription_expires_at = user.subscriptionExpiresAt.toISOString();
  if (user.trialStartedAt !== null)
    out.trial_started_at = user.trialStartedAt.toISOString();

  return out;
}

// Used by PATCH /users/me response (base fields only)
const userSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  subscriptionStatus: true,
  subscriptionExpiresAt: true,
  streakCount: true,
  itemsSavedThisMonth: true,
  notificationPermission: true,
  reminderTime: true,
  reminderDays: true,
  trialStartedAt: true,
} as const;

// Extended select for GET /users/me — includes fields needed for computed flags
const getMeSelect = {
  ...userSelect,
  createdAt: true,
  notificationReaskShown: true,
  trialExpiryBannerDue: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/me — full profile + subscription status + computed flags
//
// Computed flags returned alongside the standard user fields:
//
//   notification_reask_due (PRD §3.4.2):
//     true when ALL of:
//       - notification_permission = 'denied'
//       - notification_reask_shown = false  (modal not yet shown)
//       - created_at < NOW() - 3 days       (at least 3 days old)
//       - saves count >= 3                  (user has enough content to care)
//     App renders the contextual "Enable Reminders" modal on seeing this flag.
//     After showing the modal: PATCH /users/me { notification_reask_shown: true }
//
//   trial_expiry_banner_due (PRD §3.4.3):
//     Set to true by the trial_expiry_day BullMQ job.
//     App renders the "Your Pro trial ends today — Upgrade Now" top banner.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: getMeSelect,
      });

      if (!user) {
        next(Errors.notFound('User'));
        return;
      }

      // ── Compute notification_reask_due flag ───────────────────────────────
      let notificationReaskDue = false;

      if (
        user.notificationPermission === 'denied' &&
        !user.notificationReaskShown
      ) {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        if (user.createdAt < threeDaysAgo) {
          // Only query save count when the other conditions are met
          const saveCount = await prisma.save.count({
            where: { userId, deletedAt: null },
          });
          if (saveCount >= 3) {
            notificationReaskDue = true;
          }
        }
      }

      // ── Build response ────────────────────────────────────────────────────
      const response: Record<string, unknown> = formatUser(user);

      if (notificationReaskDue) {
        response.notification_reask_due = true;
      }

      if (user.trialExpiryBannerDue) {
        response.trial_expiry_banner_due = true;
      }

      res.json(response);
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /users/me — update display name, timezone, notification permission
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  '/me',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = PatchMeSchema.safeParse(req.body);
      if (!parsed.success) {
        next(Errors.validation(parsed.error.flatten()));
        return;
      }

      const {
        display_name,
        timezone,
        notification_permission,
        last_opened_at,
        notification_reask_shown,
      } = parsed.data;

      // Build update payload — only include provided fields
      const data: {
        displayName?: string;
        timezone?: string;
        notificationPermission?: string;
        lastOpenedAt?: Date;
        notificationReaskShown?: boolean;
      } = {};

      if (display_name !== undefined) data.displayName = display_name;
      if (timezone !== undefined) data.timezone = timezone;
      if (notification_permission !== undefined)
        data.notificationPermission = notification_permission;
      if (last_opened_at !== undefined)
        data.lastOpenedAt = new Date(last_opened_at);
      if (notification_reask_shown !== undefined)
        data.notificationReaskShown = notification_reask_shown;

      const updated = await prisma.user.update({
        where: { id: req.userId },
        data,
        select: userSelect,
      });

      res.json(formatUser(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /users/avatar — multipart upload to Supabase Storage
//
// Flow:
//   1. multer parses the multipart body and buffers the file in memory
//   2. Upload buffer to Supabase Storage at avatars/[user_id]/profile.jpg
//   3. Generate a signed URL (1-year TTL per API contract §5)
//   4. Persist the signed URL in users.avatar_url
//   5. Return { avatar_url }
//
// PRD §3.7.1: expose as avatars/[user_id]/profile.jpg (upsert enabled so
// re-uploads always overwrite the same path).
// Storage RLS (PRD §5.4): service role key bypasses RLS for this upload.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/avatar',
  // Wrap multer in a middleware that converts its callback errors to next(err)
  (req: Request, res: Response, next: NextFunction) => {
    avatarUpload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          next(
            Errors.validation({
              _errors: [`File too large. Maximum size is ${AVATAR_MAX_BYTES / 1024} KB.`],
            }),
          );
        } else {
          next(Errors.validation({ _errors: [err.message] }));
        }
      } else if (err instanceof Error) {
        next(Errors.validation({ _errors: [err.message] }));
      } else {
        next();
      }
    });
  },
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) {
        next(
          Errors.validation({ _errors: ['No file provided. Send as multipart/form-data field "avatar".'] }),
        );
        return;
      }

      const userId = req.userId;
      const storagePath = `${userId}/profile.jpg`;
      const contentType = req.file.mimetype;

      // ── 1. Upload to Supabase Storage (upsert = overwrite if exists) ──────
      const { error: uploadError } = await supabaseAdmin.storage
        .from(AVATAR_BUCKET)
        .upload(storagePath, req.file.buffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        console.error('[users/avatar] Storage upload error:', uploadError.message);
        next(Errors.internal('Failed to upload avatar. Please try again.'));
        return;
      }

      // ── 2. Generate signed URL (1-year TTL) ───────────────────────────────
      const { data: signedData, error: signedError } = await supabaseAdmin.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

      if (signedError || !signedData?.signedUrl) {
        console.error('[users/avatar] Signed URL error:', signedError?.message);
        next(Errors.internal('Avatar uploaded but failed to generate URL.'));
        return;
      }

      const avatarUrl = signedData.signedUrl;

      // ── 3. Persist avatar URL in user record ──────────────────────────────
      await prisma.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });

      res.json({ avatar_url: avatarUrl });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /users/me — initiate soft delete (PRD §3.7.5)
//
// Flow:
//   1. Set users.deleted_at = NOW() (30-day retention window)
//   2. Return 200 so the mobile app can clear local state and navigate to onboarding
//
// Notes:
//   - Supabase JWTs expire after 1 hour — no explicit session revocation needed
//     for the MVP. The mobile app clears SecureStore on receiving this response.
//   - A nightly cron job permanently purges rows where deleted_at < NOW() - 30 days.
//   - Users who sign in within the 30-day window are offered account restoration
//     (PRD §3.7.5 — handled by the auth flow, not this endpoint).
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  '/me',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.userId;

      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, deletedAt: true },
      });

      if (!existing || existing.deletedAt !== null) {
        next(Errors.notFound('User'));
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      });

      // Mobile app is responsible for: clearing SecureStore, clearing Zustand,
      // and navigating to the Onboarding screen on receiving this 200.
      res.json({
        message:
          'Account deletion initiated. Your data will be permanently removed within 30 days.',
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
