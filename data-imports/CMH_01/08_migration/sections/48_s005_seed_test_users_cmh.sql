-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 48 — SEED
--  Source seq      : s005
--  Source migration: seeds/005_seed_test_users_cmh.sql
--  Purpose         : IAM-3 aligned test users
--  Run order       : STEP 48 of 48 (after STEP 47, before STEP 99 (verification)).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
--  SEED files perform INSERTs; they are idempotent (`ON CONFLICT DO NOTHING`).
-- ════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════
--  CONVERA — Test User Seeding for Happy-Path Smoke Test (Phase 2.6)
--  File:        SQL/seeds/005_seed_test_users_cmh.sql
--
--  ┌─────────────────────────────────────────────────────────────────┐
--  │  OFFICIAL PROJECT PATH:                                         │
--  │  C:\Users\Administrator\Desktop\convera-platform                │
--  │                                                                  │
--  │  Do not edit stale copies outside this repository.              │
--  │  See logs/REPOSITORY_PATH_AND_SEEDING_RULES.md for the full      │
--  │  list of forbidden / allowed locations.                          │
--  │                                                                  │
--  │  This seed must be run only after confirming the target          │
--  │  contracts mapping (project_code + contract_no) below.           │
--  └─────────────────────────────────────────────────────────────────┘
--
--  Run order : after Migration 046 + 045 + 040 are applied.
--  Targets   : contracts CMH_01 / CMH_02 / CMH_03 — joined ONLY via
--              the (project_code, contract_no) mapping in PHASE 0.
--              No prefix matching, no `-C01` suffix, no contract_no
--              wildcards.
--  Safety    : NON-DESTRUCTIVE — no rows deleted from auth.users,
--              profiles, contracts, claims, or change_orders. Only:
--                • auth.users / auth.identities : NEVER WRITTEN.
--                  This script is now READ-ONLY against the auth.*
--                  schema. Direct INSERTs on auth.users were
--                  proven to leave users in an inconsistent state
--                  (the GoTrue server returns "Database error
--                  querying schema" at sign-in), so all auth-user
--                  provisioning is delegated to the Supabase Admin
--                  API — see scripts/create-test-auth-users.js.
--                • profiles               : INSERTed if missing,
--                  UPDATEd in place (single-user WHERE-clause). Each
--                  upsert depends on auth.users already containing
--                  the matching row.
--                • user_contract_roles    : prior rows for these 3
--                  contracts are SOFT-DEACTIVATED (is_active=false).
--                • contract_approvers     : director added if missing,
--                  re-activated if previously soft-revoked.
--
--  Excludes  : `auditor` is NOT used in this batch — Phase 2.6 maps
--              "تدقيق" / "مراجع" / "الجهة الفنية" all to contract_role
--              `reviewer` (the Technical Unit gate). The script raises
--              EXCEPTION rather than silently skipping if it ever
--              tries to write `auditor` (defensive guard).
--
--  Run as    : Supabase SQL Editor (service_role / postgres).
--
--  ⚠ PRE-FLIGHT: every test user MUST already exist in auth.users
--              with a matching row in auth.identities (provider='email')
--              and `email_confirmed_at` set, BEFORE this seed runs.
--              Use scripts/create-test-auth-users.js (Admin API) to
--              create / update them. Phase 2 below verifies this and
--              raises a clear EXCEPTION if any user is missing.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0a. (removed) Bootstrap password section ────────────────────────
--    The earlier version of this seed set passwords directly via
--    crypt(...) on auth.users.encrypted_password.  That path was
--    removed because GoTrue refuses to authenticate users that were
--    inserted into auth.users by raw SQL even when the bcrypt hash
--    is correct ("Database error querying schema").  Passwords are
--    now provisioned exclusively through the Admin API helper:
--        scripts/create-test-auth-users.js  (npm run seed:auth-users)
--    This SQL file no longer touches passwords.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 0b — TARGET CONTRACTS (single source of truth)
-- ════════════════════════════════════════════════════════════════════
--
-- All subsequent phases JOIN against this mapping.  Every CTE below
-- that references contracts SHALL go through `target_contracts` —
-- NEVER through a bare `contracts.contract_no LIKE 'CMH_%'` or any
-- prefix matching.  This guarantees the script touches exactly the
-- three target contracts and nothing else.

-- The mapping is captured as a temp view so every DO block / CTE
-- below sees the same rows.

DROP VIEW IF EXISTS pg_temp.target_contracts;
CREATE TEMP VIEW pg_temp.target_contracts AS
WITH src(project_code, contract_no) AS (
  VALUES
    -- CMH_01 uses the legacy short code 'CMH_01-C01' as its contract_no
    -- in the test DB (verified 2026-05-04). CMH_02 / CMH_03 carry the
    -- 12-digit MoMaH numbers. Update this VALUES block — and only this
    -- block — when the test environment changes.
    ('CMH_01', 'CMH_01-C01'),
    ('CMH_02', '250101116428'),
    ('CMH_03', '241039011332')
)
SELECT s.project_code, s.contract_no, c.id AS contract_id
  FROM src s
  LEFT JOIN contracts c ON c.contract_no = s.contract_no;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 — Resolve contract IDs and fail loudly on any miss / dup
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
  v_dup_count int;
BEGIN
  -- 1a) Every project_code MUST resolve to exactly one contract row.
  FOR r IN SELECT * FROM pg_temp.target_contracts LOOP
    IF r.contract_id IS NULL THEN
      RAISE EXCEPTION
        'Contract not found for project_code=% / contract_no=%. '
        'Verify the contracts table has a row with this contract_no '
        'before running.', r.project_code, r.contract_no;
    END IF;
    RAISE NOTICE 'OK: % → contract_no=% → contract_id=%',
      r.project_code, r.contract_no, r.contract_id;
  END LOOP;

  -- 1b) No two project_codes may share the same contract_no.
  --     (Defends against a typo in Phase 0b.)
  SELECT COUNT(*) - COUNT(DISTINCT contract_no)
    INTO v_dup_count
    FROM pg_temp.target_contracts;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Duplicate contract_no in target_contracts mapping. '
      'Each project_code must map to a unique contract_no.';
  END IF;

  -- 1c) No two contracts in the DB may share the same contract_no
  --     (already enforced by UNIQUE constraint on contracts.contract_no
  --      in Migration 001, but we double-check defensively).
  SELECT COUNT(*) INTO v_dup_count
    FROM contracts c
   WHERE c.contract_no IN (SELECT contract_no FROM pg_temp.target_contracts)
   GROUP BY c.contract_no
  HAVING COUNT(*) > 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'More than one contract row found for one of the target contract_no values.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 2 — READ-ONLY pre-flight on auth.users + auth.identities
-- ════════════════════════════════════════════════════════════════════
--
-- This phase performs ZERO writes against the auth.* schema.
-- Direct INSERT/UPDATE on auth.users (and auth.identities) is now
-- forbidden — see logs/REPOSITORY_PATH_AND_SEEDING_RULES.md and the
-- header banner above. All test-user provisioning is delegated to
-- the Supabase Admin API helper:
--     scripts/create-test-auth-users.js  (npm run seed:auth-users)
--
-- For each required email this phase verifies that:
--   (a) a row exists in auth.users (case-insensitive lookup)
--   (b) the user has an `auth.identities` row with provider='email'
--   (c) the user's email_confirmed_at is NOT NULL
-- If ANY of these fails, the script raises an exception with the
-- exact email and a clear remediation message. No subsequent phases
-- run unless every required user is auth-ready.

DO $$
DECLARE
  v_email      TEXT;
  v_user_id    UUID;
  v_confirmed  TIMESTAMPTZ;
  v_has_ident  BOOLEAN;
  required_emails TEXT[] := ARRAY[
    'ma.alarfaj@momah.gov.sa',
    'halhablayn-Contractor@momah.gov.sa',
    'aaldera-contractor@momah.gov.sa',
    'anaalghamdi-contractor@momah.gov.sa',
    'mahmoud.ragab@beeah.sa',
    'info@gdci.com.sa',
    'fakher@alleanzaa.com',
    'malek.h.mkh@gmail.com'
  ];
BEGIN
  FOREACH v_email IN ARRAY required_emails LOOP

    -- (a) auth.users must exist (case-insensitive).
    SELECT id, email_confirmed_at
      INTO v_user_id, v_confirmed
      FROM auth.users
     WHERE LOWER(email) = LOWER(v_email)
     LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: auth.users row missing for email "%". '
        'Create this user via Supabase Dashboard / Admin API first '
        '(run: npm run seed:auth-users from the convera-platform repo).',
        v_email;
    END IF;

    -- (b) auth.identities must include provider='email'.
    SELECT EXISTS (
      SELECT 1 FROM auth.identities
       WHERE user_id  = v_user_id
         AND provider = 'email'
    ) INTO v_has_ident;

    IF NOT v_has_ident THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: auth.identities row missing (provider=email) '
        'for "%". GoTrue cannot authenticate this user without it. '
        'Create this user via Supabase Dashboard / Admin API first '
        '(run: npm run seed:auth-users).',
        v_email;
    END IF;

    -- (c) email_confirmed_at must be set.
    IF v_confirmed IS NULL THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: email_confirmed_at IS NULL for "%". '
        'Confirm the email in Supabase Dashboard or set email_confirm=true '
        'when creating the user via the Admin API '
        '(npm run seed:auth-users does this automatically).',
        v_email;
    END IF;

    RAISE NOTICE 'PRE-FLIGHT OK: % → user_id=% confirmed_at=%',
      v_email, v_user_id, v_confirmed;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 3 — Upsert profiles for the 8 users
-- ════════════════════════════════════════════════════════════════════

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Mohammed Alarfaj', 'محمد العرفج',
       'director'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('ma.alarfaj@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  role         = 'director'::user_role,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Hossam Al-Hablayn', 'حسام الحبلين',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('halhablayn-Contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Abdullah Al-Dera', 'عبدالله الدرع',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('aaldera-contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Anas Al-Ghamdi', 'أنس الغامدي',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('anaalghamdi-contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Mahmoud Massad', 'محمود مساد',
       'consultant'::user_role,
       'BEEAH',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('mahmoud.ragab@beeah.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email,
       'Gulf Development Contracting Co.',
       'شركة الخليج المتطورة للمقاولات',
       'contractor'::user_role,
       'GDCI',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('info@gdci.com.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email,
       'Alleanzaa Contracting',
       'شركة إليانزا للمقاولات',
       'contractor'::user_role,
       'Alleanzaa',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('fakher@alleanzaa.com')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Malik Al-Oqab', 'مالك العقاب',
       'contractor'::user_role,
       NULL,
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('malek.h.mkh@gmail.com')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  is_active    = true,
  updated_at   = NOW();

-- ════════════════════════════════════════════════════════════════════
-- PHASE 4 — Soft-deactivate prior user_contract_roles
--           (only the 3 target contracts — joined via target_contracts)
-- ════════════════════════════════════════════════════════════════════

UPDATE user_contract_roles ucr
   SET is_active = false,
       notes     = COALESCE(notes, '') ||
                   ' [deactivated 2026-05-04 — Phase 2.6 role refresh, replaced by 005_seed_test_users_cmh.sql]'
  FROM pg_temp.target_contracts tc
 WHERE ucr.contract_id = tc.contract_id
   AND ucr.is_active   = true;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 5 — Insert / re-activate the new role assignments
-- ════════════════════════════════════════════════════════════════════
--
-- Per the Phase 2.6 mapping:
--   مقاول            → contractor
--   مكتب استشاري      → supervisor
--   تدقيق / مراجع / الجهة الفنية → reviewer
--   جودة             → quality
--   مدير مشروع       → project_manager
--   معتمد نهائي      → final_approver
--
-- Migration 045 changed UNIQUE to (user_id, contract_id, contract_role).
-- A user holding multiple roles on the same contract now requires
-- multiple rows — this script does not exercise that, but the
-- ON CONFLICT clause uses the 3-tuple constraint so future re-runs
-- are safe.

WITH role_mapping(project_code, email_lc, role) AS (
  VALUES
    -- CMH_01 (contract_no=CMH_01-C01) — 6 roles ──────────────────
    ('CMH_01', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_01', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_01', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_01', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_01', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_01', LOWER('info@gdci.com.sa'),                       'contractor'),
    -- CMH_02 (contract_no=250101116428) — 6 roles ─────────────────
    ('CMH_02', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_02', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_02', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_02', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_02', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_02', LOWER('fakher@alleanzaa.com'),                   'contractor'),
    -- CMH_03 (contract_no=241039011332) — 6 roles ─────────────────
    ('CMH_03', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_03', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_03', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_03', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_03', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_03', LOWER('malek.h.mkh@gmail.com'),                  'contractor')
)
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, is_active, notes)
SELECT u.id,
       tc.contract_id,
       m.role::contract_role,
       true,
       'Seeded by 005_seed_test_users_cmh.sql on 2026-05-04 (Phase 2.6 smoke test) — '
         || m.project_code || ' / ' || tc.contract_no
  FROM role_mapping m
  JOIN pg_temp.target_contracts tc ON tc.project_code = m.project_code
  JOIN auth.users u                ON LOWER(u.email)   = m.email_lc
ON CONFLICT (user_id, contract_id, contract_role) DO UPDATE SET
  is_active = true,
  notes     = 'Reactivated by 005_seed_test_users_cmh.sql on 2026-05-04 (Phase 2.6 smoke test)';

-- 5b) Defensive guard: NO row with contract_role='auditor' may have
--     been written by THIS run on the target contracts.  This catches
--     any future maintainer who edits the role_mapping CTE wrongly.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT COUNT(*) INTO v_bad_count
    FROM user_contract_roles ucr
    JOIN pg_temp.target_contracts tc ON tc.contract_id = ucr.contract_id
   WHERE ucr.contract_role = 'auditor'
     AND ucr.is_active     = true
     AND ucr.notes LIKE '%005_seed_test_users_cmh.sql on 2026-05-04%';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'Defensive guard tripped: this run wrote % active auditor row(s) on the '
      'target contracts. Phase 2.6 forbids auditor in the smoke-test data set.',
      v_bad_count;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 6 — Add Mohammed Alarfaj as final_approver in contract_approvers
-- ════════════════════════════════════════════════════════════════════

INSERT INTO contract_approvers (contract_id, user_id, approval_scope, granted_at, is_active, notes)
SELECT tc.contract_id,
       u.id,
       'final_approver'::approval_scope,
       NOW(),
       true,
       'Seeded by 005_seed_test_users_cmh.sql on 2026-05-04 — '
         || tc.project_code || ' / ' || tc.contract_no
  FROM pg_temp.target_contracts tc
  JOIN auth.users u
    ON LOWER(u.email) = LOWER('ma.alarfaj@momah.gov.sa')
ON CONFLICT (contract_id, user_id, approval_scope) DO UPDATE SET
  is_active  = true,
  revoked_at = NULL,
  notes      = 'Reactivated by 005_seed_test_users_cmh.sql on 2026-05-04';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 7 — Verification queries (run AFTER COMMIT, INFORMATIONAL)
-- ════════════════════════════════════════════════════════════════════
-- The temp view drops with the session; rerun PHASE 0b before these
-- if you reconnect.

-- VAL-1: confirm each contract has exactly 6 active roles.
-- Expected: 3 rows, each with role_count = 6.
SELECT tc.project_code,
       tc.contract_no,
       COUNT(*) AS role_count
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
 WHERE ucr.is_active = true
 GROUP BY tc.project_code, tc.contract_no
 ORDER BY tc.project_code;

-- VAL-2: confirm each contract has exactly the 6 expected ContractRole values.
-- Expected: 18 rows total (3 contracts × 6 roles), no `auditor` rows.
SELECT tc.project_code,
       tc.contract_no,
       ucr.contract_role,
       p.full_name_ar,
       p.email
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
  JOIN profiles p              ON p.id = ucr.user_id
 WHERE ucr.is_active = true
 ORDER BY tc.project_code,
          CASE ucr.contract_role
            WHEN 'contractor'      THEN 1
            WHEN 'supervisor'      THEN 2
            WHEN 'reviewer'        THEN 3
            WHEN 'quality'         THEN 4
            WHEN 'project_manager' THEN 5
            WHEN 'final_approver'  THEN 6
            ELSE 99
          END;

-- VAL-3: confirm zero `auditor` rows are active on these 3 contracts.
-- Expected: 0 rows.
SELECT tc.project_code, tc.contract_no, ucr.contract_role
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
 WHERE ucr.is_active     = true
   AND ucr.contract_role = 'auditor';

-- VAL-4: confirm Mohammed Alarfaj has an active contract_approvers row
-- on each of the 3 contracts.
-- Expected: 3 rows.
SELECT tc.project_code,
       tc.contract_no,
       p.full_name_ar AS approver,
       ca.approval_scope,
       ca.is_active,
       ca.revoked_at
  FROM pg_temp.target_contracts tc
  JOIN contract_approvers ca ON ca.contract_id = tc.contract_id
  JOIN profiles p             ON p.id = ca.user_id
 WHERE ca.approval_scope = 'final_approver'
   AND ca.is_active      = true
 ORDER BY tc.project_code;

-- VAL-5: snapshot of soft-deactivated rows from Phase 4.
-- Expected: lists prior assignments now is_active=false with the marker note.
SELECT tc.project_code,
       tc.contract_no,
       p.full_name_ar,
       ucr.contract_role,
       ucr.is_active,
       ucr.notes
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
  JOIN profiles p              ON p.id = ucr.user_id
 WHERE ucr.is_active = false
   AND ucr.notes LIKE '%Phase 2.6 role refresh%'
 ORDER BY tc.project_code, p.full_name_ar;

-- VAL-6: claims unaffected — count of rows per contract.
-- Compare this with a pre-run snapshot taken before COMMIT.
SELECT tc.project_code, tc.contract_no, COUNT(cl.id) AS claim_count
  FROM pg_temp.target_contracts tc
  LEFT JOIN claims cl ON cl.contract_id = tc.contract_id
 GROUP BY tc.project_code, tc.contract_no
 ORDER BY tc.project_code;
