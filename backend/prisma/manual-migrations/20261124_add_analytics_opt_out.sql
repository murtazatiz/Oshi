-- 2026-11-24 — Server-side analytics opt-out
--
-- RUN THIS IN THE SUPABASE SQL EDITOR *BEFORE* DEPLOYING THE BACKEND THAT
-- CONTAINS users.analyticsOptOut IN schema.prisma. Prisma names every model
-- column in its queries, so until analytics_opt_out exists every users query
-- fails with "column users.analytics_opt_out does not exist". (Same deploy
-- rule as 20261123_add_morning_digest.sql — run that one first if you
-- haven't.) Safe to re-run. See ADR-0020.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS analytics_opt_out boolean NOT NULL DEFAULT false;
