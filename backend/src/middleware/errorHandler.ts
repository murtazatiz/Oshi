import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Sentry } from '../services/sentry';

// ─────────────────────────────────────────────────────────────────────────────
// Standard error codes — PRD §6.8
// ─────────────────────────────────────────────────────────────────────────────
export type ErrorCode =
  | 'UNAUTHORISED'          // 401 — Invalid or expired JWT
  | 'FORBIDDEN'             // 403 — Valid JWT but insufficient permissions
  | 'SAVE_LIMIT_REACHED'    // 403 — Free user at 20 save limit
  | 'CATEGORY_LIMIT_REACHED'// 403 — Free user at 3 category limit
  | 'NOT_FOUND'             // 404 — Resource does not exist or belongs to another user
  | 'VALIDATION_ERROR'      // 422 — Invalid request body
  | 'RATE_LIMITED'          // 429 — Too many requests
  | 'INTERNAL_ERROR';       // 500 — Unexpected server error

// ─────────────────────────────────────────────────────────────────────────────
// Standard error response shape — PRD §6.8
//
// All API errors return:
// {
//   "error": {
//     "code": "SAVE_LIMIT_REACHED",
//     "message": "You have reached your monthly save limit...",
//     "statusCode": 403
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    /** Only included in development for debugging — never in production */
    details?: unknown;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AppError — throw this anywhere in route handlers.
// The global error handler below converts it to the standard response format.
// ─────────────────────────────────────────────────────────────────────────────
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    // Restore prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Convenience factory functions for the most common error types
export const Errors = {
  unauthorised: (msg = 'Invalid or expired JWT. Please sign in again.') =>
    new AppError('UNAUTHORISED', msg, 401),

  forbidden: (msg = 'You do not have permission to perform this action.') =>
    new AppError('FORBIDDEN', msg, 403),

  saveLimitReached: () =>
    new AppError(
      'SAVE_LIMIT_REACHED',
      'You have reached your monthly save limit. Upgrade to Oshi Pro for unlimited saves.',
      403,
    ),

  categoryLimitReached: () =>
    new AppError(
      'CATEGORY_LIMIT_REACHED',
      'You have reached the maximum of 3 categories on the free plan. Upgrade to Oshi Pro for unlimited categories.',
      403,
    ),

  notFound: (resource = 'Resource') =>
    new AppError('NOT_FOUND', `${resource} not found.`, 404),

  validation: (details?: unknown) =>
    new AppError('VALIDATION_ERROR', 'Invalid request body.', 422, details),

  internal: (msg = 'An unexpected error occurred. Please try again.') =>
    new AppError('INTERNAL_ERROR', msg, 500),
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Global error handler — must be registered LAST in Express middleware chain.
//
// Handles:
//   AppError  → structured response using the error's own code/status
//   ZodError  → 422 VALIDATION_ERROR with field details
//   Unknown   → 500 INTERNAL_ERROR, reported to Sentry
//
// PRD §5.8: backend Sentry handler wraps all unhandled errors.
// ─────────────────────────────────────────────────────────────────────────────
export const globalErrorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // next must be declared even if unused — Express requires all 4 params
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const isDev = process.env.NODE_ENV === 'development';

  // ── AppError (our own structured errors) ──────────────────────────────────
  if (err instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        ...(isDev && err.details !== undefined ? { details: err.details } : {}),
      },
    };

    // Report 5xx errors to Sentry; 4xx are expected client errors
    if (err.statusCode >= 500) {
      Sentry.captureException(err, { extra: { path: req.path, body: req.body as unknown } });
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // ── Zod validation errors ─────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const body: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body.',
        statusCode: 422,
        ...(isDev ? { details: err.flatten() } : {}),
      },
    };
    res.status(422).json(body);
    return;
  }

  // ── Unknown / unhandled errors ────────────────────────────────────────────
  Sentry.captureException(err, {
    extra: {
      path: req.path,
      method: req.method,
      // Never log sensitive headers (Authorization) — PRD §backend rule
    },
  });

  const body: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again.',
      statusCode: 500,
      ...(isDev ? { details: err instanceof Error ? err.message : String(err) } : {}),
    },
  };

  res.status(500).json(body);
};

// ─────────────────────────────────────────────────────────────────────────────
// 404 handler — attach before globalErrorHandler for unmatched routes
// ─────────────────────────────────────────────────────────────────────────────
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
      statusCode: 404,
    },
  } satisfies ErrorResponse);
}
