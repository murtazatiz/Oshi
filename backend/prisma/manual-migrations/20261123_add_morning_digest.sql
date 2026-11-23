-- 2026-11-23 — Morning Digest (PRD §3.7.2)
--
-- RUN THIS IN THE SUPABASE SQL EDITOR *BEFORE* DEPLOYING THE BACKEND THAT
-- CONTAINS users.morningDigest IN schema.prisma. Prisma names every model
-- column in its queries, so until morning_digest exists every users query
-- fails with "column users.morning_digest does not exist".
--
-- This repo has no prisma/migrations baseline (so `npm run prisma:migrate`
-- is a no-op); schema changes are applied by hand. Safe to re-run.

-- 1. Preference column (off by default; Pro-only, enforced by the API)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS morning_digest boolean NOT NULL DEFAULT false;

-- 2. Allow 'morning_digest' in notification_logs.notification_type.
--    The existing CHECK constraint's name isn't known from the repo, so drop
--    whichever CHECK constraint references notification_type, then recreate it.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.notification_logs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%notification_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_logs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_notification_type_check
  CHECK (notification_type IN (
    'daily_reminder', 'trial_expiry_warning', 'trial_expiry_day',
    'reengagement', 'morning_digest'
  ));
