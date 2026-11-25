# ADR-0021 — The soft-delete purge deletes dependent rows explicitly and removes the auth account

**Status:** Accepted · **Decided:** 2026-11-23

## Context
Saves and users are soft-deleted (`deleted_at`). PRD §3.7.5 requires a nightly job that "purges all data" for users deleted more than 30 days ago, and the code and docs promised a 7-day purge for saves, but no job existed. `schema.prisma` declares `onDelete: Cascade` from users to their rows, but the live schema was created by hand with no migrations baseline (ADR-0020), so those cascades may not exist in the database.

## Decision
`services/purgeService.ts`, run at 03:00 UTC:
- **Saves** deleted more than 7 days ago are removed in batches of 500, each batch in one transaction with their engagement signals.
- **Users** deleted more than 30 days ago (up to 100 a night): their engagement signals, notification logs, saves, categories and user row are deleted in **one transaction**, then their avatar is removed from Storage and their **Supabase Auth account is deleted**. Otherwise the email could sign back into an account with no data behind it, and the email itself is personal data covered by "all data".
- Dependents are deleted **explicitly** rather than relying on database cascades. Failures go to Sentry, and that user is retried the next night.

## Consequences
The purge works whatever FK constraints the live database has. If the transaction commits but the auth deletion fails, the auth account remains (reported to Sentry) and the next sign-in finds no user row. Fixing that is a manual dashboard deletion. The PRD's "restore within 30 days" sign-in offer is still unbuilt. Deleting sooner or later only means changing `SAVE_RETENTION_DAYS` / `USER_RETENTION_DAYS`. TC-PURGE-01/02.
