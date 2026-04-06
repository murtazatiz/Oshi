// Sentry MUST be initialised before any other import so it can instrument
// all modules automatically (PRD §5.8)
import { initialiseSentry, Sentry } from './services/sentry';
initialiseSentry();

import express, { Router } from 'express';
import cors from 'cors';
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { defaultLimiter } from './middleware/rateLimiter';
import healthRouter from './health';
import authRouter from './routes/auth';
import savesRouter from './routes/saves';
import engagementRouter from './routes/engagement';
import categoriesRouter from './routes/categories';
import usersRouter from './routes/users';
import notificationsRouter from './routes/notifications';
import subscriptionsRouter from './routes/subscriptions';
import { startAiWorkers, stopAiWorkers } from './workers/aiProcessor';
import { startDeadLinkChecker, stopDeadLinkChecker } from './workers/deadLinkChecker';
import {
  startNotificationWorker,
  stopNotificationWorker,
} from './workers/notificationScheduler';
import {
  startDailyReminderScheduler,
  startMonthlySaveCountReset,
  stopSchedulers,
} from './cron/scheduler';

// ─────────────────────────────────────────────────────────────────────────────
// CORS — implemented exactly as specified in PRD §5.5
// ─────────────────────────────────────────────────────────────────────────────
const allowedOrigins: string[] = [
  'http://localhost:8081',            // Expo dev server
  'http://localhost:3000',            // Local backend (self-calls / Swagger)
  'exp://192.168.x.x:8081',          // Expo Go on device (dynamic — matched by regex below)
  'https://oshi-staging.railway.app', // Staging
  'https://api.oshi.app',            // Production
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }

    const isAllowed =
      allowedOrigins.some((o) => origin.startsWith(o)) ||
      /^exp:\/\/192\.168\./.test(origin); // Expo Go — dynamic LAN IP

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// ─────────────────────────────────────────────────────────────────────────────
// App setup
// ─────────────────────────────────────────────────────────────────────────────
const app = express();

// ── Security headers ─────────────────────────────────────────────────────────
app.set('trust proxy', 1); // Required for express-rate-limit to read real IP behind Railway
app.disable('x-powered-by');

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight requests for all routes
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Sentry v8: request context is set up automatically via Sentry.init().
// No explicit requestHandler middleware needed.

// ── Global rate limiter — 120 req/min/user (PRD §9) ──────────────────────────
// Applied globally here; specific routes override with tighter limiters.
app.use(defaultLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check — no auth, no rate limit override (PRD §1.4)
app.use('/health', healthRouter);

// API v1 — base URL: /api/v1 (API contract §1)
const apiV1 = Router();
apiV1.use('/auth',          authRouter);
apiV1.use('/saves',         savesRouter);
apiV1.use('/engagement',    engagementRouter);
apiV1.use('/categories',    categoriesRouter);
apiV1.use('/users',         usersRouter);
apiV1.use('/notifications', notificationsRouter);
apiV1.use('/subscriptions', subscriptionsRouter);
app.use('/api/v1', apiV1);

// ── Sentry error handler — must come BEFORE globalErrorHandler (PRD §5.8) ────
// Sentry v8 API: setupExpressErrorHandler instruments the app to capture
// all unhandled Express errors and forward them to Sentry automatically.
Sentry.setupExpressErrorHandler(app);

// ── 404 — must come after all routes ─────────────────────────────────────────
app.use(notFoundHandler);

// ── Global error handler — must be LAST middleware (PRD §6.8) ────────────────
app.use(globalErrorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ── Start background workers and cron jobs ───────────────────────────────────
const aiWorkers = startAiWorkers();
const notifWorker = startNotificationWorker();
startDeadLinkChecker();
startDailyReminderScheduler();
startMonthlySaveCountReset();

const server = app.listen(PORT, () => {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  console.info(`[Oshi API] Listening on port ${PORT} (${env})`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// Closes the HTTP server before process exits so Railway can safely replace
// the container without dropping in-flight requests.
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
  console.info(`[Oshi API] ${signal} received — shutting down gracefully`);

  // Stop all cron jobs immediately
  stopDeadLinkChecker();
  stopSchedulers();

  // Stop BullMQ workers — lets in-flight jobs finish
  await stopAiWorkers(aiWorkers);
  await stopNotificationWorker(notifWorker);

  server.close(() => {
    console.info('[Oshi API] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if server hasn't closed (stuck requests)
  setTimeout(() => {
    console.error('[Oshi API] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });

export default app;
