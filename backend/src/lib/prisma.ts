import { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Prisma 5 client singleton
//
// In Prisma 5, the connection URL is read from the DATABASE_URL environment
// variable declared in prisma/schema.prisma (datasource db.url).
// Do NOT pass datasourceUrl to the constructor — that is Prisma 7 syntax.
//
// DATABASE_URL must include ?pgbouncer=true for Supabase connection pooling
// (PRD §1.4). Migrations use DIRECT_URL (set in prisma/schema.prisma
// directUrl field) to bypass PgBouncer's advisory lock restriction.
// ─────────────────────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
  throw new Error('[prisma] Missing DATABASE_URL environment variable.');
}

// Singleton pattern: prevents multiple PrismaClient instances during
// development when tsx watch restarts the module.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
