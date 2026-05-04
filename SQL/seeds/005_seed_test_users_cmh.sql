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
--                • auth.users / profiles : INSERTed if missing,
--                  UPDATEd in place (single-user WHERE-clause).
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
--  ⚠ PASSWORD: this script ships WITHOUT a password literal. Before
--             running, replace '<PASSWORD>' on the SELECT set_config
--             line below. The script refuses to run with the placeholder
--             still in place. The password is never echoed back.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0a. Pre-flight: bootstrap password from session config ───────────
SELECT set_config('cmh.bootstrap_password', '<PASSWORD>', true);

DO $$
BEGIN
  IF current_setting('cmh.bootstrap_password', true) IS NULL
     OR current_setting('cmh.bootstrap_password', true) = ''
     OR current_setting('cmh.bootstrap_password', true) = '<PASSWORD>' THEN
    RAISE EXCEPTION
      'Refuse to run: bootstrap password not set. '
      'Edit the SELECT set_config(...) line above with a real password before running.';
  END IF;
END $$;

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
    ('CMH_01', '220339524310'),
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
-- PHASE 2 — Upsert auth.users (8 unique users across the 3 contracts)
-- ════════════════════════════════════════════════════════════════════
--
-- Email is case-insensitive: lookups go through LOWER(email). If the
-- email already exists in auth.users with any casing, we keep the
-- existing UUID and only refresh the password + metadata.  If the
-- email does NOT exist, we INSERT a new row with a fresh UUID.
--
-- `Ma.Alarfaj@momah.gov.sa` and `ma.alarfaj@momah.gov.sa` collapse to
-- a single user via LOWER(email).

DO $$
DECLARE
  v_pwd_hash    TEXT;
  v_existing_id UUID;
  v_new_id      UUID;

  -- Per-user closure for the upsert pattern. Each entry: email, full_name,
  -- full_name_ar, profiles.role fallback (a value that exists in the prod
  -- user_role enum — never 'final_approver' since it may not be present
  -- in prod yet — and never the ContractRole-only values).
  user_specs   TEXT[][] := ARRAY[
    ARRAY['Ma.Alarfaj@momah.gov.sa',                'Mohammed Alarfaj',                'محمد العرفج',                  'director'],
    ARRAY['halhablayn-Contractor@momah.gov.sa',     'Hossam Al-Hablayn',               'حسام الحبلين',                  'reviewer'],
    ARRAY['aaldera-contractor@momah.gov.sa',        'Abdullah Al-Dera',                'عبدالله الدرع',                 'reviewer'],
    ARRAY['anaalghamdi-contractor@momah.gov.sa',    'Anas Al-Ghamdi',                  'أنس الغامدي',                   'reviewer'],
    ARRAY['mahmoud.ragab@beeah.sa',                 'Mahmoud Massad',                  'محمود مساد',                    'consultant'],
    ARRAY['info@gdci.com.sa',                       'Gulf Development Contracting',    'شركة الخليج المتطورة للمقاولات', 'contractor'],
    ARRAY['fakher@alleanzaa.com',                   'Alleanzaa Contracting',           'شركة إليانزا للمقاولات',         'contractor'],
    ARRAY['malek.h.mkh@gmail.com',                  'Malik Al-Oqab',                   'مالك العقاب',                    'contractor']
  ];
  i INT;
BEGIN
  v_pwd_hash := crypt(current_setting('cmh.bootstrap_password', true), gen_salt('bf', 10));

  FOR i IN 1..array_length(user_specs, 1) LOOP
    SELECT id INTO v_existing_id
      FROM auth.users
     WHERE LOWER(email) = LOWER(user_specs[i][1])
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      v_new_id := gen_random_uuid();
      INSERT INTO auth.users (
        id, instance_id, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_user_meta_data, role, aud
      ) VALUES (
        v_new_id,
        '00000000-0000-0000-0000-000000000000',
        user_specs[i][1],
        v_pwd_hash,
        NOW(), NOW(), NOW(),
        jsonb_build_object(
          'full_name',    user_specs[i][2],
          'full_name_ar', user_specs[i][3],
          'role',         user_specs[i][4]
        ),
        'authenticated', 'authenticated'
      );
      RAISE NOTICE 'Created auth user: % (% — %)',
        user_specs[i][3], v_new_id, user_specs[i][4];
    ELSE
      UPDATE auth.users
         SET encrypted_password = v_pwd_hash,
             raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) ||
                                  jsonb_build_object(
                                    'full_name',    user_specs[i][2],
                                    'full_name_ar', user_specs[i][3],
                                    'role',         user_specs[i][4]
                                  ),
             updated_at = NOW()
       WHERE id = v_existing_id;
      RAISE NOTICE 'Refreshed auth user: % (% — %)',
        user_specs[i][3], v_existing_id, user_specs[i][4];
    END IF;
  END LOOP;
END $$;

-- 2b) Defensive guard: every required user must now exist in auth.users.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT email_lc INTO v_missing
    FROM (VALUES
      (LOWER('ma.alarfaj@momah.gov.sa')),
      (LOWER('halhablayn-Contractor@momah.gov.sa')),
      (LOWER('aaldera-contractor@momah.gov.sa')),
      (LOWER('anaalghamdi-contractor@momah.gov.sa')),
      (LOWER('mahmoud.ragab@beeah.sa')),
      (LOWER('info@gdci.com.sa')),
      (LOWER('fakher@alleanzaa.com')),
      (LOWER('malek.h.mkh@gmail.com'))
    ) AS req(email_lc)
   WHERE NOT EXISTS (
     SELECT 1 FROM auth.users u WHERE LOWER(u.email) = req.email_lc
   )
   LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Required test user is missing from auth.users after upsert phase: %. '
      'Cannot proceed.', v_missing;
  END IF;
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
    -- CMH_01 (contract_no=220339524310) — 6 roles ─────────────────
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
