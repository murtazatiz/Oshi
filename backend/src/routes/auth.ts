/**
 * Auth routes — API Contract §2
 *
 *   POST /auth/signup          — create account, seed categories, return session
 *   POST /auth/signin          — email/password sign-in, return session
 *   POST /auth/signout         — invalidate session (requires auth)
 *   POST /auth/forgot-password — send password reset email
 *   POST /auth/reset-password  — update password with OTP token
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';

import { supabaseAdmin, requireAuth } from '../middleware/auth';
import { authSigninLimiter } from '../middleware/rateLimiter';
import { AppError, Errors } from '../middleware/errorHandler';
import { prisma } from '../lib/prisma';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const SignupSchema = z.object({
  email: z.string().email({ message: 'A valid email is required.' }),
  password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters.' })
    .regex(/\d/, { message: 'Password must contain at least one number.' }),
  display_name: z.string().min(1).max(100),
});

const SigninSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

const ResetPasswordSchema = z.object({
  /** OTP token from the password reset email deep link */
  token: z.string().min(1),
  new_password: z
    .string()
    .min(8, { message: 'Password must be at least 8 characters.' })
    .regex(/\d/, { message: 'Password must contain at least one number.' }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Default categories seeded for every new user — API Contract §2, PRD §5.3
// 11 categories; "Other" is always last and flagged as system default.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES: Array<{
  name: string;
  emoji: string;
  sortOrder: number;
  isSystemDefault: boolean;
}> = [
  { name: 'Business',    emoji: '💼', sortOrder: 0,  isSystemDefault: false },
  { name: 'Learning',    emoji: '🎓', sortOrder: 1,  isSystemDefault: false },
  { name: 'Travel',      emoji: '✈️', sortOrder: 2,  isSystemDefault: false },
  { name: 'Food',        emoji: '🍔', sortOrder: 3,  isSystemDefault: false },
  { name: 'Fitness',     emoji: '💪', sortOrder: 4,  isSystemDefault: false },
  { name: 'Finance',     emoji: '💰', sortOrder: 5,  isSystemDefault: false },
  { name: 'Technology',  emoji: '💻', sortOrder: 6,  isSystemDefault: false },
  { name: 'Culture',     emoji: '🎭', sortOrder: 7,  isSystemDefault: false },
  { name: 'News',        emoji: '📰', sortOrder: 8,  isSystemDefault: false },
  { name: 'Personal',    emoji: '📝', sortOrder: 9,  isSystemDefault: false },
  { name: 'Other',       emoji: '📌', sortOrder: 10, isSystemDefault: true  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper — format a Supabase session into the API contract shape
// ─────────────────────────────────────────────────────────────────────────────
function formatSession(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}): { access_token: string; refresh_token: string; expires_at: number } {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/signup
//
// 1. Create Supabase auth user
// 2. Create public.users row (Prisma)
// 3. Seed 11 default categories
// 4. Return user + session
//
// API Contract §2: 201 on success, 409 if email already registered.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/signup',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = SignupSchema.safeParse(req.body);
    if (!parsed.success) {
      next(Errors.validation(parsed.error.flatten()));
      return;
    }

    const { email, password, display_name } = parsed.data;

    try {
      // Step 1: create Supabase auth user
      const { data: authData, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // skip email confirmation for smoother onboarding
          user_metadata: { display_name },
        });

      if (authError) {
        if (
          authError.message.toLowerCase().includes('already registered') ||
          authError.message.toLowerCase().includes('already been registered') ||
          authError.code === 'email_exists'
        ) {
          res.status(409).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'An account with this email address already exists.',
              statusCode: 409,
            },
          });
          return;
        }
        throw new AppError('INTERNAL_ERROR', authError.message, 500);
      }

      if (!authData.user) {
        throw Errors.internal('Supabase user creation returned no user object.');
      }

      const userId = authData.user.id;
      const now = new Date();

      // Step 2: create public.users row and seed categories atomically
      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email,
            displayName: display_name,
            subscriptionStatus: 'trial',
            trialStartedAt: now,
            // TIMETZ column — must be supplied as a plain string in HH:MM:SS+00 format.
            // Prisma maps this to a String field; omitting it causes Postgres to reject
            // the implicit default cast and throw "time out of range".
            reminderTime: '19:00:00',
          },
        });

        // Step 3: create all 11 default categories
        await tx.category.createMany({
          data: DEFAULT_CATEGORIES.map((cat) => ({
            userId,
            name: cat.name,
            emoji: cat.emoji,
            sortOrder: cat.sortOrder,
            isSystemDefault: cat.isSystemDefault,
          })),
        });
      });

      // Step 4: create a session — admin.createUser does not return one,
      // so we sign in immediately with the email and password to obtain tokens.
      const { data: sessionData, error: sessionError } =
        await supabaseAdmin.auth.signInWithPassword({ email, password });

      if (sessionError || !sessionData.session) {
        // User created but session failed — still report success; client can sign in
        throw Errors.internal('Account created but session initialisation failed. Please sign in.');
      }

      res.status(201).json({
        user: {
          id: userId,
          email,
          display_name,
          created_at: authData.user.created_at,
        },
        session: formatSession(sessionData.session),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/signin
//
// Rate-limited: 10 req/min/IP (authSigninLimiter — PRD §9)
// API Contract §2: 200 on success, 401 INVALID_CREDENTIALS on failure.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/signin',
  authSigninLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = SigninSchema.safeParse(req.body);
    if (!parsed.success) {
      next(Errors.validation(parsed.error.flatten()));
      return;
    }

    const { email, password } = parsed.data;

    try {
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.session) {
        // Do not reveal whether the email exists — generic credential error
        res.status(401).json({
          error: {
            code: 'UNAUTHORISED',
            message: 'Invalid email or password.',
            statusCode: 401,
          },
        });
        return;
      }

      const user = data.user;

      // Fetch display_name from public.users (may not exist for OAuth users)
      let displayName: string | null = null;
      try {
        const profile = await prisma.user.findUnique({
          where: { id: user.id },
          select: { displayName: true },
        });
        displayName = profile?.displayName ?? null;
      } catch {
        // Non-fatal — return what we have
      }

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email ?? email,
          display_name:
            displayName ??
            (user.user_metadata?.display_name as string | undefined) ??
            '',
          created_at: user.created_at,
        },
        session: formatSession(data.session),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/signout
//
// Requires auth — invalidates the JWT on Supabase's side.
// Client must also clear the token from SecureStore (PRD §3.5.3).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/signout',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract the raw token from the Authorization header
      const token = (req.headers.authorization as string).slice(7);

      // Revoke the specific JWT via the admin API so it can't be reused
      await supabaseAdmin.auth.admin.signOut(token);

      res.status(200).json({ message: 'Signed out successfully.' });
    } catch (err) {
      next(err);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/forgot-password
//
// Sends a password reset email via Supabase.
// Always returns 200 regardless of whether the email exists — prevents
// account enumeration (API Contract §2, PRD §9).
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/forgot-password',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      next(Errors.validation(parsed.error.flatten()));
      return;
    }

    const { email } = parsed.data;

    try {
      // Supabase sends a reset email with a link that includes an OTP token.
      // The deep link redirectTo is the oshi://auth/reset URL (PRD §4).
      await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: 'oshi://auth/reset',
      });
    } catch {
      // Swallow errors — never reveal whether the email exists
    }

    // Always respond 200 (API Contract §2)
    res.status(200).json({ message: 'If an account with that email exists, a reset link has been sent.' });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/reset-password
//
// The mobile app receives an OTP token via the oshi://auth/reset?token= deep
// link and POSTs it here along with the new password.
//
// Uses verifyOtp to exchange the token for a session, then updates the password.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  '/reset-password',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      next(Errors.validation(parsed.error.flatten()));
      return;
    }

    const { token, new_password } = parsed.data;

    try {
      // Exchange the OTP token for a short-lived session
      const { data: verifyData, error: verifyError } =
        await supabaseAdmin.auth.verifyOtp({
          token_hash: token,
          type: 'recovery',
        });

      if (verifyError || !verifyData.user) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'The password reset link is invalid or has expired. Please request a new one.',
            statusCode: 400,
          },
        });
        return;
      }

      // Update the password using the admin API
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        verifyData.user.id,
        { password: new_password },
      );

      if (updateError) {
        throw new AppError('INTERNAL_ERROR', updateError.message, 500);
      }

      res.status(200).json({ message: 'Password updated successfully. Please sign in with your new password.' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
