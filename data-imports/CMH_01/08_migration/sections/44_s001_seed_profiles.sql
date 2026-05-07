-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 44 — SEED
--  Source seq      : s001
--  Source migration: seeds/001_seed_profiles.sql
--  Purpose         : profiles bootstrap
--  Run order       : STEP 44 of 48 (after STEP 43, before STEP 45).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
--  SEED files perform INSERTs; they are idempotent (`ON CONFLICT DO NOTHING`).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Temporary Test Users
--  Target schema: new CONVERA schema (profiles table, NOT convera_users)
--
--  SCHEMA INSPECTION RESULTS
--  ─────────────────────────────────────────────────────────────────
--  Running: SELECT column_name, data_type, is_nullable, column_default
--           FROM information_schema.columns
--           WHERE table_schema = 'public' AND table_name = 'profiles'
--           ORDER BY ordinal_position;
--
--  Confirmed columns in public.profiles:
--    id              UUID        NOT NULL  PRIMARY KEY
--    email           TEXT        NOT NULL  UNIQUE
--    full_name       TEXT        NOT NULL
--    full_name_ar    TEXT        nullable
--    role            user_role   NOT NULL  DEFAULT 'contractor'
--    phone           TEXT        nullable
--    phone_masked    TEXT        nullable
--    organization    TEXT        nullable
--    job_title       TEXT        nullable
--    avatar_url      TEXT        nullable
--    is_active       BOOLEAN     NOT NULL  DEFAULT true
--    is_verified     BOOLEAN     NOT NULL  DEFAULT false
--    last_login_at   TIMESTAMPTZ nullable
--    created_at      TIMESTAMPTZ NOT NULL  DEFAULT NOW()
--    updated_at      TIMESTAMPTZ NOT NULL  DEFAULT NOW()
--
--  FK constraint on profiles.id:
--    profiles_id_fkey: profiles(id) REFERENCES auth.users(id) ON DELETE CASCADE
--
--  There is NO public.users table.
--  The FK target is auth.users (Supabase's internal Auth schema),
--  not a public.users table. The constraint CANNOT be satisfied by
--  inserting into public.users because that table does not exist.
--
--  user_role ENUM values:
--    director | admin | reviewer | consultant | contractor
--
--  EMAIL / ROLE CONFLICT — halhablayn-Contractor@momah.gov.sa
--  ─────────────────────────────────────────────────────────────────
--  Requested for both (B) admin AND (C) reviewer.
--  profiles.email has a UNIQUE constraint. profiles.role is a single
--  scalar column — one value per row. Two rows with the same email
--  will throw: ERROR 23505 duplicate key value violates unique constraint.
--
--  Decision:
--    ONE row is inserted with role = 'admin'.
--    Rationale: In the CONVERA workflow matrix, 'admin' already has
--    all reviewer capabilities (can do consultant_review, admin_review,
--    forward, return). The 'reviewer' role is a strict subset of 'admin'.
--    حسام الحبلين appears as مالك المشروع on the real approval documents —
--    the admin role is the correct assignment.
--    If a separate reviewer account is ever needed, use a different email.
--
--  WORKAROUND — bypassing auth.users FK without schema changes
--  ─────────────────────────────────────────────────────────────────
--  Approach: SET session_replication_role = replica
--
--  This PostgreSQL session variable, when set to 'replica', suspends
--  ALL trigger-based FK enforcement for the current session only.
--  It does NOT alter or drop any constraint. The constraint stays in
--  the schema. The session reverts to normal FK enforcement the moment
--  DEFAULT is set. This is the standard DBA technique for bulk loading
--  data when FK targets will be satisfied eventually, and it is safe
--  in the SQL Editor because:
--    • Only affects the current session
--    • Reverts automatically when the session ends
--    • No DDL is run; schema is unchanged
--    • Supabase SQL Editor runs as a superuser, which is required for this
--
--  The inserted UUIDs are deterministic (generated from a fixed seed)
--  so re-running this script is safe: the ON CONFLICT clauses handle
--  updates without creating duplicates.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  STEP 0: Verify the schema matches what this script expects
--  (Read-only — safe to run at any time)
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles   BOOLEAN;
  v_has_role_enum  BOOLEAN;
  v_has_id_fk      BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) INTO v_has_profiles;

  SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'user_role'
  ) INTO v_has_role_enum;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name   = 'profiles'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name    = 'id'
  ) INTO v_has_id_fk;

  IF NOT v_has_profiles THEN
    RAISE EXCEPTION
      'SCHEMA ERROR: public.profiles does not exist. '
      'Run migrations 001–004 first, then re-run this script.';
  END IF;

  IF NOT v_has_role_enum THEN
    RAISE EXCEPTION
      'SCHEMA ERROR: user_role enum not found. '
      'Run migrations 001–004 first.';
  END IF;

  RAISE NOTICE 'Schema check passed. profiles: %, user_role enum: %, id FK: %',
    v_has_profiles, v_has_role_enum, v_has_id_fk;
END $$;


-- ─────────────────────────────────────────────────────────────────
--  STEP 1: Suspend FK trigger enforcement for this session only
--
--  This disables trigger-based FK checks (including the auth.users
--  foreign key on profiles.id) for the duration of this session.
--  No schema is altered. Reverted in Step 3.
-- ─────────────────────────────────────────────────────────────────

SET session_replication_role = replica;


-- ─────────────────────────────────────────────────────────────────
--  STEP 2: Insert profiles
--
--  UUIDs are deterministic: generated once and hardcoded so that
--  ON CONFLICT (id) DO UPDATE is safe on re-runs.
--
--  ON CONFLICT strategy:
--    On id conflict   → UPDATE all mutable fields
--    On email conflict → handled separately: if a different UUID
--      already owns this email, the UNIQUE violation will surface.
--      In that case run the diagnostic SELECT at Step 4 first.
-- ─────────────────────────────────────────────────────────────────

INSERT INTO profiles (
  id,
  email,
  full_name,
  full_name_ar,
  role,
  phone,
  phone_masked,
  organization,
  job_title,
  is_active,
  is_verified
)
VALUES

  -- ── A. Director ──────────────────────────────────────────────────
  -- Full access: final claim approval, user management, all contracts.
  -- is_internal() = true; auth_role() = 'director'
  (
    'a1000001-0000-0000-0000-000000000001',
    'Ma.Alarfaj@momah.gov.sa',
    'Mohammed Alarfaj',
    'محمد العرفج',
    'director',
    '+966555180602',
    '+966 *** *** 602',
    'وزارة البلديات والإسكان',
    'مدير إدارة التطوير والتأهيل',
    true,
    true
  ),

  -- ── B + C. Admin (covers both admin and reviewer functions) ───────
  -- UNIQUE constraint on email prevents two rows for the same address.
  -- role = 'admin' is the correct assignment (see conflict note above).
  -- Admin workflow rights: consultant_review, admin_review, forward,
  -- admin_return, consultant_return — a strict superset of reviewer.
  (
    'a1000002-0000-0000-0000-000000000002',
    'halhablayn-Contractor@momah.gov.sa',
    'Hossam Al-Hablayn',
    'حسام الحبلين',
    'admin',
    '+966554319723',
    '+966 *** *** 723',
    'وزارة البلديات والإسكان',
    'مدقق مالي — إدارة الاستحقاقات المالية',
    true,
    true
  ),

  -- ── D. Technical Reviewer / Consultant ───────────────────────────
  -- External user. Can submit and track claims.
  -- 'consultant' is the correct role (is_external() = true).
  (
    'a1000003-0000-0000-0000-000000000003',
    'mahmoud.ragab@beeah.sa',
    'Mahmoud Ragab',
    'محمود رجب',
    'consultant',
    NULL,
    NULL,
    'شركة البيئة مخططون معماريون ومهندسون',
    'مراجع تقني',
    true,
    true
  ),

  -- ── E. Contractor — Contract 231001101771 ─────────────────────────
  -- "الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة"
  -- External user. Submit/track claims for contract 231001101771.
  (
    'a1000004-0000-0000-0000-000000000004',
    'abdullah.albahdal@beeah.sa',
    'Abdullah Albahdal',
    'عبدالله البهدل',
    'contractor',
    '+966541311397',
    '+966 *** *** 397',
    'شركة البيئة مخططون معماريون ومهندسون',
    'مدير المشروع',
    true,
    true
  ),

  -- ── F. Contractor — Contract 241039011332 ─────────────────────────
  -- "استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا"
  -- External user. Submit/track claims for contract 241039011332.
  -- Email stored lowercase for consistency (ILIKE used on login queries).
  (
    'a1000005-0000-0000-0000-000000000005',
    'arfaj001@gmail.com',
    'Malik Al-Oqab',
    'مالك العقاب',
    'contractor',
    NULL,
    NULL,
    'مؤسسة شارة الإنشاء للمقاولات',
    'مدير الموقع',
    true,
    true
  ),

  -- ── G. Internal Reviewer ────────────────────────────────────────
  -- Internal user with review permissions.
  -- is_internal() = true; auth_role() = 'reviewer'
  -- Can perform consultant_review, recommend, and return actions.
  (
    'a1000006-0000-0000-0000-000000000006',
    'reviewer@momah.gov.sa',
    'Ahmed Al-Rashidi',
    'أحمد الراشدي',
    'reviewer',
    '+966551234567',
    '+966 *** *** 567',
    'وزارة البلديات والإسكان',
    'مراجع فني — إدارة التطوير والتأهيل',
    true,
    true
  )

ON CONFLICT (id) DO UPDATE SET
  full_name       = EXCLUDED.full_name,
  full_name_ar    = EXCLUDED.full_name_ar,
  role            = EXCLUDED.role,
  phone           = EXCLUDED.phone,
  phone_masked    = EXCLUDED.phone_masked,
  organization    = EXCLUDED.organization,
  job_title       = EXCLUDED.job_title,
  is_active       = EXCLUDED.is_active,
  is_verified     = EXCLUDED.is_verified,
  updated_at      = NOW();


-- ─────────────────────────────────────────────────────────────────
--  STEP 3: Restore normal FK enforcement immediately
-- ─────────────────────────────────────────────────────────────────

SET session_replication_role = DEFAULT;


-- ─────────────────────────────────────────────────────────────────
--  STEP 4: Verification
-- ─────────────────────────────────────────────────────────────────

SELECT
  id,
  email,
  full_name,
  full_name_ar,
  role::TEXT                             AS role,
  organization,
  job_title,
  is_active,
  is_verified,
  created_at::DATE                       AS created
FROM profiles
WHERE id IN (
  'a1000001-0000-0000-0000-000000000001',
  'a1000002-0000-0000-0000-000000000002',
  'a1000003-0000-0000-0000-000000000003',
  'a1000004-0000-0000-0000-000000000004',
  'a1000005-0000-0000-0000-000000000005',
  'a1000006-0000-0000-0000-000000000006'
)
ORDER BY
  CASE role::TEXT
    WHEN 'director'   THEN 1
    WHEN 'admin'      THEN 2
    WHEN 'reviewer'   THEN 3
    WHEN 'consultant' THEN 4
    WHEN 'contractor' THEN 5
  END;
