/**
 * errorMonitoring.ts — Sentry React Native wrapper (PRD §5.8)
 *
 * Centralises all Sentry operations so the rest of the codebase
 * never imports @sentry/react-native directly — just uses this module.
 *
 * Initialisation: call `initSentry()` as early as possible in App.tsx,
 * before any other imports that might throw.
 *
 * User context: call `setSentryUser(id)` on login, `clearSentryUser()` on logout.
 */
import * as Sentry from '@sentry/react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const environment = (process.env.APP_ENV ?? 'development') as
    | 'development'
    | 'staging'
    | 'production';

  // Skip in dev if no DSN configured
  if (!dsn && __DEV__) return;

  Sentry.init({
    dsn,
    environment,
    // Only send in production by default; you can lower this threshold
    tracesSampleRate: environment === 'production' ? 0.2 : 0,
    // Capture unhandled JS exceptions + unhandled promise rejections
    enableCaptureFailedRequests: false,
    debug: __DEV__,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// User context — PRD §5.8: no PII, only user.id
// ─────────────────────────────────────────────────────────────────────────────

export function setSentryUser(userId: string): void {
  Sentry.setUser({ id: userId });
}

export function clearSentryUser(): void {
  Sentry.setUser(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual error capture
// ─────────────────────────────────────────────────────────────────────────────

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (context) Sentry.setContext('extra', context);
  Sentry.captureException(error);
}

export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(message, level);
}

// ─────────────────────────────────────────────────────────────────────────────
// HOC — wrap root App component (PRD §5.8)
// ─────────────────────────────────────────────────────────────────────────────

export const wrapWithSentry = Sentry.wrap;
