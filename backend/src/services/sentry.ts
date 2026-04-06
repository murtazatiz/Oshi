import * as Sentry from '@sentry/node';

// ─────────────────────────────────────────────────────────────────────────────
// Sentry initialisation — PRD §5.8
// Uses @sentry/node v8 API (Handlers.requestHandler / Handlers.errorHandler
// were removed in v8; use Sentry.init + setupExpressErrorHandler instead).
//
// Captures:
//   - All unhandled errors and promise rejections (automatic in v8)
//   - environment tag set to APP_ENV ('development'|'staging'|'production')
//   - User context set on login via setSentryUser() — no PII like email
//   - User context cleared on logout via clearSentryUser()
//
// Alert thresholds (configure in Sentry dashboard):
//   - Alert if error rate > 1%
//   - Alert on any new issue in production
// ─────────────────────────────────────────────────────────────────────────────

export function initialiseSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.warn('[Sentry] SENTRY_DSN not set — error monitoring disabled.');
    return;
  }

  const environment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';

  Sentry.init({
    dsn,
    environment,
    // Capture 10% of transactions in production to control volume;
    // 100% in dev/staging for full observability during development.
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    sampleRate: 1.0,
  });
}

/**
 * Call after a user authenticates to attach their ID to all subsequent events.
 * PRD §5.8: user.id only — never email or other PII.
 */
export function setSentryUser(userId: string): void {
  Sentry.setUser({ id: userId });
}

/** Call on sign-out to detach user context from subsequent Sentry events. */
export function clearSentryUser(): void {
  Sentry.setUser(null);
}

export { Sentry };
