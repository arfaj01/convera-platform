-- ════════════════════════════════════════════════════════════════════
-- BACKFILL — public.profiles row for fayez@gdc.com
--
-- Status:  DRAFT — NOT applied. Awaits operator approval.
-- Approval phrase required: APPROVE-BACKFILL-FAYEZ-PROFILE
--
-- Target:  Production project ref ngwxlockzkjpmzuvgakx (CONVERA / main).
--          Confirm Studio breadcrumb shows MOMAH > CONVERA > main · PRODUCTION
--          before pasting this into the SQL Editor.
--
-- Why this exists:
--   Diagnostic Probe 3 (2026-05-10) found 16 auth.users rows but only
--   15 matching public.profiles rows. The missing profile is for
--   fayez@gdc.com (auth.users.id = 7acfb002-7970-48ae-a4a8-8ef8fd0bee38,
--   per the Studio Authentication > Users screenshot).
--
--   The standard Supabase pattern is that an `on_auth_user_created`
--   trigger inserts a public.profiles row whenever an auth.users row
--   is created. For Fayez that did not happen — likely because the
--   user was created via a code path that bypassed the trigger
--   (admin API with a custom-id, or seed SQL that disabled the
--   trigger), or the trigger silently no-op'd via ON CONFLICT.
--
-- Whether this fixes the Auth Admin /admin/users 500
--   Almost certainly NOT — GoTrue's listUsers reads only auth.* and
--   does not JOIN to public.profiles. This patch fixes a separate
--   app-data-sync issue that was discovered alongside the Auth Admin
--   investigation. We are documenting it because the Auth Admin
--   diagnostic surfaced it.
--
-- Idempotency
--   - Pre-check raises if the profile already exists (no double-insert).
--   - INSERT uses NOT EXISTS guard for belt-and-braces.
--   - Wrapped in BEGIN/COMMIT — if anything fails, the whole patch
--     rolls back.
--
-- What it touches
--   INSERT INTO public.profiles  (one row).
--   No UPDATE on auth.users.
--   No ALTER on any schema.
--   No DROP on any object.
--
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pre-flight: confirm we are NOT on staging ────────────────────
DO $$
DECLARE
  v_setting_text TEXT;
BEGIN
  SELECT current_setting('cluster_name', true) INTO v_setting_text;
  IF v_setting_text IS NOT NULL AND v_setting_text ILIKE '%jrqkzwacerdudmeacvar%' THEN
    RAISE EXCEPTION 'STAGING_DETECTED — cluster_name suggests staging project. Aborting backfill.';
  END IF;
END $$;

-- ── 2. Pre-flight: profile must be missing in production ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE email = 'fayez@gdc.com') THEN
    RAISE EXCEPTION 'PROFILE_ALREADY_EXISTS — public.profiles row for fayez@gdc.com is present. No backfill needed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'fayez@gdc.com') THEN
    RAISE EXCEPTION 'AUTH_USER_NOT_FOUND — auth.users has no row for fayez@gdc.com. Aborting (would create orphan).';
  END IF;
END $$;

-- ── 3. Backfill from auth.users ────────────────────────────────────
INSERT INTO public.profiles (
  id,
  email,
  full_name,
  full_name_ar,
  role,
  organization,
  is_active,
  is_verified,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.email,
  -- full_name: prefer raw_user_meta_data.full_name, fall back to email-prefix
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    initcap(split_part(u.email, '@', 1))
  ) AS full_name,
  -- full_name_ar: NULL if not provided (column allows NULL)
  NULLIF(u.raw_user_meta_data->>'full_name_ar', '')
    AS full_name_ar,
  -- role: prefer metadata; default to contractor (matches Probe-3 finding)
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'role', '')::user_role,
    'contractor'::user_role
  ) AS role,
  -- organization: free-text, NULL if absent
  NULLIF(u.raw_user_meta_data->>'organization', '')
    AS organization,
  -- is_active: true (matches Supabase default)
  true,
  -- is_verified: derive from email_confirmed_at presence
  (u.email_confirmed_at IS NOT NULL) AS is_verified,
  u.created_at,
  NOW() AS updated_at
FROM auth.users u
WHERE u.email = 'fayez@gdc.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = u.id
  );

-- ── 4. Verify exactly one row was inserted ─────────────────────────
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.profiles WHERE email = 'fayez@gdc.com';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'POST_BACKFILL_VERIFICATION_FAILED — expected 1 row, got %', v_count;
  END IF;
END $$;

-- ── 5. Show the new row (one-line confirmation) ─────────────────────
SELECT id, email, full_name, role, organization, is_active, is_verified, created_at
  FROM public.profiles
 WHERE email = 'fayez@gdc.com';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK INSTRUCTIONS
-- ════════════════════════════════════════════════════════════════════
-- If this patch was applied in error and the backfill needs to be
-- removed, run the following ON THE SAME PROJECT (production):
--
--   DELETE FROM public.profiles
--    WHERE email = 'fayez@gdc.com'
--      AND created_at >= '2026-05-10'::date;  -- safety guard
--
-- NB: deleting the profile does NOT touch auth.users (auth user
--     remains; user can still log in).
--
-- ════════════════════════════════════════════════════════════════════
-- AUDIT NOTE
-- ════════════════════════════════════════════════════════════════════
-- This patch performs a single INSERT against public.profiles. It
-- does not change any user's password, does not modify auth.users,
-- does not alter any other table. The only user-facing effect is
-- that fayez@gdc.com now appears in the platform's user list
-- (currently they would be missing from any UI driven by profiles).
