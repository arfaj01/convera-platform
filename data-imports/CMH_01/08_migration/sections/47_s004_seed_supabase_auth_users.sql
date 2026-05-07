-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 47 — SEED
--  Source seq      : s004
--  Source migration: seeds/004_seed_supabase_auth_users.sql
--  Purpose         : auth.users bootstrap
--  Run order       : STEP 47 of 48 (after STEP 46, before STEP 48).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
--  SEED files perform INSERTs; they are idempotent (`ON CONFLICT DO NOTHING`).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Seed: Supabase Auth Users (Optional)
--  File: 004_seed_supabase_auth_users.sql
--
--  Run order: 4 (optional — run ONLY if migrating to Supabase Auth)
--  Depends on: All migrations (001-006)
--
--  PURPOSE:
--    Creates proper auth.users entries so the system can use
--    Supabase Auth (supabase.auth.signInWithPassword) instead of
--    the convera_users prototype flow.
--
--    The on_auth_user_created trigger in migration 001 will
--    auto-create profiles rows. However, since we already have
--    profiles from 001_seed_profiles.sql, the ON CONFLICT (id)
--    DO NOTHING clause in the trigger handles duplicates safely.
--
--  ╔═══════════════════════════════════════════════════════════════╗
--  ║  ⚠️  BOOTSTRAP PASSWORD: 0555180602                         ║
--  ║  This is a TEMPORARY password for testing/staging ONLY.     ║
--  ║  ALL users must change their password before production.    ║
--  ║  Never deploy with this password to a public environment.   ║
--  ╚═══════════════════════════════════════════════════════════════╝
--
--  HOW TO RUN:
--    This script uses Supabase's auth.users internal table.
--    It must be run in the Supabase SQL Editor as a superuser.
--    The password is hashed using pgcrypto's crypt() with bf (bcrypt).
--
--  AFTER RUNNING:
--    1. Update the frontend to use supabase.auth.signInWithPassword()
--    2. Remove the convera_users login flow
--    3. Remove 005_rls_prototype_access.sql permissive policies
--    4. Drop convera_users and convera_otp tables
-- ═══════════════════════════════════════════════════════════════════


-- ─── Helper: create auth user with known UUID ────────────────────
-- Supabase stores passwords as bcrypt hashes in auth.users.
-- The encrypted_password column uses the format: $2a$10$...

DO $$
DECLARE
  v_password_hash TEXT;
BEGIN
  -- Generate bcrypt hash of the bootstrap password
  v_password_hash := crypt('0555180602', gen_salt('bf', 10));

  -- ── A. Director ──────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000001-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'Ma.Alarfaj@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Mohammed Alarfaj',
      'full_name_ar', 'محمد العرفج',
      'role', 'director'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── B. Admin ─────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000002-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'halhablayn-Contractor@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Hossam Al-Hablayn',
      'full_name_ar', 'حسام الحبلين',
      'role', 'admin'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── C. Consultant ────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000003-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'mahmoud.ragab@beeah.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Mahmoud Ragab',
      'full_name_ar', 'محمود رجب',
      'role', 'consultant'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── D. Contractor (Beeah) ───────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000004-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'abdullah.albahdal@beeah.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Abdullah Albahdal',
      'full_name_ar', 'عبدالله البهدل',
      'role', 'contractor'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── E. Contractor (Sharat) ──────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000005-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'arfaj001@gmail.com',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Malik Al-Oqab',
      'full_name_ar', 'مالك العقاب',
      'role', 'contractor'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── F. Internal Reviewer ────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000006-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'reviewer@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Ahmed Al-Rashidi',
      'full_name_ar', 'أحمد الراشدي',
      'role', 'reviewer'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  RAISE NOTICE 'Supabase Auth users created with bootstrap password.';
  RAISE NOTICE '⚠️  Change all passwords before production deployment!';
END $$;


-- ─── Verification ──────────────────────────────────────────────

SELECT
  id,
  email,
  raw_user_meta_data->>'full_name' AS name,
  raw_user_meta_data->>'role'      AS role,
  email_confirmed_at IS NOT NULL   AS confirmed,
  created_at::DATE                 AS created
FROM auth.users
WHERE id::TEXT LIKE 'a1000%'
ORDER BY id;
