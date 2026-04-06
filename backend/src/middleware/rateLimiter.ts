import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Rate limits — PRD §9 (Security & Privacy)
//
//   POST /saves           →  60  requests / minute / user  (savesLimiter)
//   POST /auth/signin     →  10  requests / minute / IP    (authSigninLimiter)
//   All other routes      →  120 requests / minute / user  (defaultLimiter)
//
// Key strategy:
//   - Auth routes key by IP (user not yet authenticated)
//   - Authenticated routes key by req.userId (set by requireAuth middleware)
//     Falls back to IP if userId is not yet populated (e.g. mis-ordered middleware)
// ─────────────────────────────────────────────────────────────────────────────

/** Standard 429 response matching the PRD §6.8 error format */
const rateLimitHandler = (
  _req: Request,
  res: Response,
): void => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.',
      statusCode: 429,
    },
  });
};

/** Key by authenticated userId — falls back to IP for unauthenticated requests */
function keyByUser(req: Request): string {
  return req.userId ?? req.ip ?? 'unknown';
}

/** Key by client IP address */
function keyByIp(req: Request): string {
  return req.ip ?? 'unknown';
}

function makeOptions(
  max: number,
  keyGenerator: (req: Request) => string,
): Partial<Options> {
  return {
    windowMs: 60 * 1000, // 1 minute rolling window
    max,
    standardHeaders: true,  // Return RateLimit-* headers
    legacyHeaders: false,   // Disable X-RateLimit-* headers
    keyGenerator,
    handler: rateLimitHandler,
    // Skip rate limiting in test environments
    skip: () => process.env.NODE_ENV === 'test',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Named limiters — apply these directly to the relevant router/route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /saves — 60 req/min/user (PRD §9)
 * Apply after requireAuth so req.userId is populated.
 */
export const savesLimiter: RateLimitRequestHandler = rateLimit(
  makeOptions(60, keyByUser),
);

/**
 * POST /auth/signin — 10 req/min/IP (PRD §9)
 * Keyed by IP because the user is not authenticated at sign-in time.
 */
export const authSigninLimiter: RateLimitRequestHandler = rateLimit(
  makeOptions(10, keyByIp),
);

/**
 * Default — 120 req/min/user (PRD §9)
 * Applied globally in index.ts; covers all routes not given a specific limiter.
 */
export const defaultLimiter: RateLimitRequestHandler = rateLimit(
  makeOptions(120, keyByUser),
);
