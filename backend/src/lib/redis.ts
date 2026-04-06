import IORedis from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Redis client — used exclusively for application-level caching
// (smart sort scores, etc.). Separate from the BullMQ queue connections so
// that queue reconnect logic does not interfere with cache operations.
//
// BullMQ already connects to Redis for job queues (src/queue/index.ts).
// This client is for GET-heavy read-through caching with short TTLs.
// ─────────────────────────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Prevent duplicate connections when tsx watch hot-reloads modules.
const globalForRedis = globalThis as unknown as {
  redisCache: IORedis | undefined;
};

export const redisCache: IORedis =
  globalForRedis.redisCache ??
  new IORedis(redisUrl, {
    // Retry up to 3 times with 200 ms backoff on connection errors.
    // Cache operations are best-effort; failures fall through to DB queries.
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    // Silence connection errors so they don't crash the process —
    // the application still works without Redis (degraded, uncached).
    lazyConnect: true,
  });

// Suppress uncaught 'error' events: Redis connection errors are logged
// via the error handler below, not via unhandledRejection.
redisCache.on('error', (err: Error) => {
  console.warn('[redis-cache] Connection error (cache degraded):', err.message);
});

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redisCache = redisCache;
}
