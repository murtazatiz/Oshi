# ADR-0020 — Schema changes ship as hand-run SQL until a Prisma migrations baseline exists

**Status:** Accepted · **Decided:** 2026-11-23

## Context
`backend/prisma` has no `migrations/` directory, so `npm run prisma:migrate` (`prisma migrate deploy`) applies nothing; the live Supabase schema was created by hand. Adding the first Prisma migration now would need a baseline of the whole existing schema, and `prisma migrate dev` would report drift. That's worth doing deliberately, not as a side effect of one feature. The Morning Digest needed a new column (`users.morning_digest`) and a wider CHECK constraint on `notification_logs.notification_type`.

## Decision
Schema changes go in `backend/prisma/manual-migrations/YYYYMMDD_<name>.sql`: idempotent SQL that's safe to re-run, applied in the Supabase SQL editor **before** deploying backend code that depends on it. `schema.prisma` is updated in the same commit and its doc comment names the SQL file. Constraints whose names aren't known from the repo are replaced by looking them up in `pg_constraint`, not by guessing names.

## Consequences
Every deploy needs a manual check that pending manual migrations have been run. Prisma lists every model column in its queries, so deploying first breaks all queries on the affected table. When the team adopts `prisma migrate`, baseline the live schema (`prisma migrate diff --from-empty`), mark it applied, fold these files in, and supersede this ADR. First use: `20261123_add_morning_digest.sql` (FIX-20261123-04).
