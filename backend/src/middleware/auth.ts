import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AppError } from './errorHandler';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase admin client — uses the SERVICE ROLE KEY, which is server-side only.
// PRD §5.4: never expose the service role key to the client.
// PRD §9: backend uses service role key for JWT validation and admin operations.
// ─────────────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    '[auth] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Extend Express Request with the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Supabase user ID extracted from the validated JWT */
      userId: string;
      /** Raw Supabase user object — use sparingly; prefer userId */
      supabaseUser: {
        id: string;
        email?: string;
        role?: string;
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAuth middleware
//
// Validates the Supabase JWT from the Authorization: Bearer <token> header.
// On success: attaches req.userId and req.supabaseUser, then calls next().
// On failure: responds with 401 UNAUTHORISED using the standard error format.
//
// PRD §9: all API communication over HTTPS/TLS 1.2+
// PRD §5.5 (Architecture §1.5): JWT validation middleware on all protected routes
// ─────────────────────────────────────────────────────────────────────────────
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORISED',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
        statusCode: 401,
      },
    });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    // Validate the JWT using Supabase's getUser() — this verifies the RS256
    // signature against Supabase's public key and checks expiry.
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORISED',
          message: 'Invalid or expired JWT. Please sign in again.',
          statusCode: 401,
        },
      });
      return;
    }

    req.userId = data.user.id;

    // Build the user object — only include optional fields when defined
    // (required by exactOptionalPropertyTypes: true in tsconfig)
    const supabaseUser: Express.Request['supabaseUser'] = { id: data.user.id };
    if (data.user.email !== undefined) supabaseUser.email = data.user.email;
    if (data.user.role !== undefined) supabaseUser.role = data.user.role;
    req.supabaseUser = supabaseUser;

    next();
  } catch (err) {
    // Propagate unexpected errors to the global error handler
    next(new AppError('INTERNAL_ERROR', 'Authentication service error.', 500));
  }
}

export { supabaseAdmin };
