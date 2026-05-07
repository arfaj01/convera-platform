-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 22 — MIGRATION
--  Source seq      : 025
--  Source migration: migrations/025_contract_scoped_roles.sql
--  Purpose         : introduce user_contract_roles
--  Run order       : STEP 22 of 48 (after STEP 21, before STEP 23).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  Migration 025: Contract-Scoped Roles — Sprint A
--  CONVERA — وزارة البلديات والإسكان
--
--  PURPOSE:
--    Introduce the contract_role enum and user_contract_roles table
--    to support multi-role-per-user-per-contract permissions.
--
--  SCOPE (Sprint A ONLY):
--    ✓ Create contract_role enum
--    ✓ Create user_contract_roles table with RLS
--    ✓ Create SQL helper functions (SECURITY DEFINER)
--    ✓ Seed data from user_contracts + profiles.role
--    ✗ Does NOT modify existing RLS policies
--    ✗ Does NOT change APIs or frontend
--    ✗ Does NOT drop or modify user_contracts table
--
--  ROLLBACK:
--    DROP TABLE IF EXISTS user_contract_roles CASCADE;
--    DROP FUNCTION IF EXISTS has_contract_role(UUID, contract_role);
--    DROP FUNCTION IF EXISTS has_contract_access(UUID);
--    DROP FUNCTION IF EXISTS get_contract_role(UUID);
--    DROP TYPE IF EXISTS contract_role;
--
--  IDEMPOTENCY:
--    All statements use IF NOT EXISTS / IF EXISTS guards.
--    Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  PHASE 1: Prerequisites check
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles       BOOLEAN;
  v_has_contracts      BOOLEAN;
  v_has_user_contracts BOOLEAN;
  v_has_user_role      BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles')
    INTO v_has_profiles;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contracts')
    INTO v_has_contracts;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_contracts')
    INTO v_has_user_contracts;

  SELECT EXISTS (SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'user_role')
    INTO v_has_user_role;

  IF NOT v_has_profiles THEN
    RAISE EXCEPTION 'MISSING: profiles table. Run migrations 001+ first.';
  END IF;
  IF NOT v_has_contracts THEN
    RAISE EXCEPTION 'MISSING: contracts table. Run migrations 001+ first.';
  END IF;
  IF NOT v_has_user_contracts THEN
    RAISE EXCEPTION 'MISSING: user_contracts table. Run migration 010 first.';
  END IF;
  IF NOT v_has_user_role THEN
    RAISE EXCEPTION 'MISSING: user_role enum. Run migration 001 first.';
  END IF;

  RAISE NOTICE '✓ Prerequisites verified: profiles, contracts, user_contracts, user_role enum all present.';
END $$;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 2: Create contract_role enum
-- ─────────────────────────────────────────────────────────────────
--
--  Role mapping from old system (user_role → contract_role):
--    contractor  → contractor   (creates and submits claims)
--    consultant  → supervisor   (first-stage review — renamed for clarity)
--    admin       → auditor      (second-stage financial audit)
--    reviewer    → reviewer     (third-stage اعتماد alignment check)
--    director    → N/A          (global role, not contract-scoped)
--
--  New role:
--    viewer      → read-only access (for observation / limited visibility)
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'contract_role'
  ) THEN
    CREATE TYPE contract_role AS ENUM (
      'contractor',    -- مقاول — creates and submits claims
      'supervisor',    -- جهة الإشراف — first review stage (was 'consultant')
      'auditor',       -- مدقق — financial audit stage (was 'admin')
      'reviewer',      -- مراجع — اعتماد alignment check
      'viewer'         -- مشاهد — read-only access
    );
    RAISE NOTICE '✓ Created contract_role enum.';
  ELSE
    RAISE NOTICE '⊘ contract_role enum already exists — skipping.';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 3: Create user_contract_roles table
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_contract_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  user_id       UUID NOT NULL
                  REFERENCES profiles(id) ON DELETE CASCADE,

  -- Which contract
  contract_id   UUID NOT NULL
                  REFERENCES contracts(id) ON DELETE CASCADE,

  -- What role on this contract
  contract_role contract_role NOT NULL,

  -- Audit fields
  assigned_by   UUID REFERENCES profiles(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft-delete: deactivate revokes access without losing history
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  -- Optional notes (e.g., "Assigned during project kickoff")
  notes         TEXT,

  -- One role per user per contract
  UNIQUE (user_id, contract_id)
);

COMMENT ON TABLE user_contract_roles IS
  'Contract-scoped role assignments. Each row grants a user a specific role '
  'on a specific contract. Replaces the single profiles.role + user_contracts '
  'model for permission checks. Director role remains global via profiles.role.';

COMMENT ON COLUMN user_contract_roles.contract_role IS
  'The role this user holds on this contract: contractor, supervisor, auditor, reviewer, or viewer.';

COMMENT ON COLUMN user_contract_roles.is_active IS
  'Soft-delete flag. Setting to FALSE immediately revokes contract access without losing audit history.';


-- ─────────────────────────────────────────────────────────────────
--  PHASE 4: Performance indexes
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ucr_user_id
  ON user_contract_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_ucr_contract_id
  ON user_contract_roles(contract_id);

CREATE INDEX IF NOT EXISTS idx_ucr_role
  ON user_contract_roles(contract_role);

-- Composite index for the most common query pattern:
-- "What active role does user X have on contract Y?"
CREATE INDEX IF NOT EXISTS idx_ucr_user_contract_active
  ON user_contract_roles(user_id, contract_id)
  WHERE is_active = TRUE;

-- Composite index for listing:
-- "All active users on contract Y"
CREATE INDEX IF NOT EXISTS idx_ucr_contract_active
  ON user_contract_roles(contract_id)
  WHERE is_active = TRUE;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 5: Enable RLS
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE user_contract_roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running (idempotency)
DROP POLICY IF EXISTS "ucr_internal_select" ON user_contract_roles;
DROP POLICY IF EXISTS "ucr_own_select" ON user_contract_roles;
DROP POLICY IF EXISTS "ucr_director_manage" ON user_contract_roles;

-- Policy: Internal users (director, admin, reviewer) can read all role assignments
CREATE POLICY "ucr_internal_select"
  ON user_contract_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('director', 'admin', 'reviewer')
    )
  );

-- Policy: External users can see their own role assignments
CREATE POLICY "ucr_own_select"
  ON user_contract_roles FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Only director can manage (INSERT/UPDATE/DELETE) role assignments
CREATE POLICY "ucr_director_manage"
  ON user_contract_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'director'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'director'
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  PHASE 6: SQL helper functions (SECURITY DEFINER)
--
--  These functions will be used by RLS policies in Sprint B.
--  Created now so they can be tested independently.
--  SECURITY DEFINER = executes with the function owner's
--  privileges (bypasses RLS to avoid infinite recursion).
-- ─────────────────────────────────────────────────────────────────

-- 6A. Check if current user has a specific role on a contract
CREATE OR REPLACE FUNCTION has_contract_role(
  _contract_id UUID,
  _role contract_role
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_contract_roles
    WHERE user_id       = auth.uid()
      AND contract_id   = _contract_id
      AND contract_role = _role
      AND is_active     = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_contract_role(UUID, contract_role) IS
  'Returns TRUE if the current authenticated user has the specified '
  'contract_role on the given contract and the assignment is active.';


-- 6B. Check if current user has ANY active role on a contract
CREATE OR REPLACE FUNCTION has_contract_access(
  _contract_id UUID
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_contract_roles
    WHERE user_id     = auth.uid()
      AND contract_id = _contract_id
      AND is_active   = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_contract_access(UUID) IS
  'Returns TRUE if the current authenticated user has any active '
  'role assignment on the given contract (scope check).';


-- 6C. Get the user's role on a specific contract (or NULL)
CREATE OR REPLACE FUNCTION get_contract_role(
  _contract_id UUID
) RETURNS contract_role AS $$
  SELECT contract_role FROM user_contract_roles
  WHERE user_id     = auth.uid()
    AND contract_id = _contract_id
    AND is_active   = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_contract_role(UUID) IS
  'Returns the contract_role for the current user on the given contract, '
  'or NULL if no active assignment exists.';


-- ─────────────────────────────────────────────────────────────────
--  PHASE 7: Seed data from user_contracts + profiles.role
--
--  This copies existing role assignments into the new table.
--  The mapping is:
--    profiles.role  →  contract_role
--    ─────────────     ──────────────
--    contractor     →  contractor
--    consultant     →  supervisor
--    admin          →  auditor
--    reviewer       →  reviewer
--    director       →  (SKIPPED — global role, not contract-scoped)
--
--  Data sources:
--    1. user_contracts table (user_id + contract_id pairs)
--    2. profiles table (role for each user)
--    3. contracts table (admin_id, reviewer_id for implicit assignments)
--
--  ON CONFLICT DO NOTHING: safe for re-runs.
-- ─────────────────────────────────────────────────────────────────

-- 7A. Seed from user_contracts + profiles.role
--     This covers contractor and consultant/supervisor assignments
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  uc.user_id,
  uc.contract_id,
  CASE p.role
    WHEN 'contractor'  THEN 'contractor'::contract_role
    WHEN 'consultant'  THEN 'supervisor'::contract_role
    WHEN 'admin'       THEN 'auditor'::contract_role
    WHEN 'reviewer'    THEN 'reviewer'::contract_role
    ELSE                    'viewer'::contract_role
  END,
  'Migrated from user_contracts + profiles.role (migration 025)'
FROM user_contracts uc
JOIN profiles p ON p.id = uc.user_id
WHERE p.role != 'director'  -- Director is global, skip
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7B. Seed from contracts.admin_id (auditor assignments)
--     These may not exist in user_contracts yet
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.admin_id,
  c.id,
  'auditor'::contract_role,
  'Migrated from contracts.admin_id (migration 025)'
FROM contracts c
WHERE c.admin_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7C. Seed from contracts.reviewer_id (reviewer assignments)
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.reviewer_id,
  c.id,
  'reviewer'::contract_role,
  'Migrated from contracts.reviewer_id (migration 025)'
FROM contracts c
WHERE c.reviewer_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7D. Seed from contracts.external_user_id (contractor assignments)
--     Safety net — should already be covered by 7A via user_contracts
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.external_user_id,
  c.id,
  'contractor'::contract_role,
  'Migrated from contracts.external_user_id (migration 025)'
FROM contracts c
WHERE c.external_user_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 8: Audit log entry (safe — will NOT block migration)
--
--  Production audit_logs schema (from migration 001):
--    action: audit_action ENUM (create|update|...), NOT free text
--    entity_type: TEXT (e.g. 'claim', 'contract')
--    entity_id: UUID
--    old_values / new_values: JSONB
--    metadata: JSONB
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs')
  THEN
    INSERT INTO audit_logs (
      action,
      entity_type,
      entity_id,
      entity_label,
      old_values,
      new_values,
      metadata
    ) VALUES (
      'create'::audit_action,
      'user_contract_roles',
      gen_random_uuid(),
      'Migration 025 — Contract-Scoped Roles',
      NULL,
      jsonb_build_object(
        'migration', '025_contract_scoped_roles',
        'description', 'Created contract_role enum + user_contract_roles table + helper functions + seeded data',
        'executed_at', NOW()::text
      ),
      jsonb_build_object('source', 'migration', 'version', '025')
    );
    RAISE NOTICE '✓ Audit log entry created.';
  ELSE
    RAISE NOTICE '⊘ audit_logs table not found — skipping audit entry.';
  END IF;
EXCEPTION
  WHEN undefined_column OR undefined_table OR invalid_text_representation THEN
    RAISE NOTICE '⊘ audit_logs schema mismatch — skipping audit entry (non-blocking).';
  WHEN OTHERS THEN
    RAISE NOTICE '⊘ audit_logs insert failed: % — skipping (non-blocking).', SQLERRM;
END $$;


-- ═══════════════════════════════════════════════════════════════════
--  VERIFICATION QUERIES
--  Run these after applying the migration to confirm correctness.
-- ═══════════════════════════════════════════════════════════════════


-- ── V1: Confirm enum exists with correct values ──────────────────
SELECT
  t.typname AS enum_name,
  e.enumlabel AS value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public' AND t.typname = 'contract_role'
ORDER BY e.enumsortorder;


-- ── V2: Confirm table structure ──────────────────────────────────
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_contract_roles'
ORDER BY ordinal_position;


-- ── V3: Row count ────────────────────────────────────────────────
SELECT COUNT(*) AS total_rows FROM user_contract_roles;


-- ── V4: Seeded data detail — who has what role on which contract ─
SELECT
  ucr.user_id,
  p.full_name_ar                      AS user_name,
  p.role::TEXT                         AS old_global_role,
  c.contract_no,
  SUBSTRING(c.title_ar, 1, 40)        AS contract_title,
  ucr.contract_role::TEXT              AS new_contract_role,
  ucr.is_active,
  ucr.notes
FROM user_contract_roles ucr
JOIN profiles p ON p.id = ucr.user_id
JOIN contracts c ON c.id = ucr.contract_id
ORDER BY c.contract_no, ucr.contract_role;


-- ── V5: Role mapping validation ──────────────────────────────────
-- Every row should show matching old→new role mapping
SELECT
  p.role::TEXT                         AS old_role,
  ucr.contract_role::TEXT              AS new_role,
  CASE
    WHEN p.role = 'contractor'  AND ucr.contract_role = 'contractor'  THEN '✓ correct'
    WHEN p.role = 'consultant'  AND ucr.contract_role = 'supervisor'  THEN '✓ correct'
    WHEN p.role = 'admin'       AND ucr.contract_role = 'auditor'     THEN '✓ correct'
    WHEN p.role = 'reviewer'    AND ucr.contract_role = 'reviewer'    THEN '✓ correct'
    ELSE '✗ UNEXPECTED MAPPING'
  END AS mapping_status,
  COUNT(*) AS count
FROM user_contract_roles ucr
JOIN profiles p ON p.id = ucr.user_id
GROUP BY p.role, ucr.contract_role,
  CASE
    WHEN p.role = 'contractor'  AND ucr.contract_role = 'contractor'  THEN '✓ correct'
    WHEN p.role = 'consultant'  AND ucr.contract_role = 'supervisor'  THEN '✓ correct'
    WHEN p.role = 'admin'       AND ucr.contract_role = 'auditor'     THEN '✓ correct'
    WHEN p.role = 'reviewer'    AND ucr.contract_role = 'reviewer'    THEN '✓ correct'
    ELSE '✗ UNEXPECTED MAPPING'
  END
ORDER BY old_role;


-- ── V6: Cross-check with user_contracts (no orphans) ─────────────
-- Every row in user_contracts for non-director users should have
-- a corresponding row in user_contract_roles
SELECT
  uc.user_id,
  p.full_name_ar,
  p.role::TEXT AS global_role,
  uc.contract_id,
  c.contract_no,
  CASE WHEN ucr.id IS NOT NULL THEN '✓ migrated' ELSE '✗ MISSING' END AS status
FROM user_contracts uc
JOIN profiles p ON p.id = uc.user_id
JOIN contracts c ON c.id = uc.contract_id
LEFT JOIN user_contract_roles ucr
  ON ucr.user_id = uc.user_id
  AND ucr.contract_id = uc.contract_id
WHERE p.role != 'director'
ORDER BY c.contract_no, p.role;


-- ── V7: Verify helper functions exist ────────────────────────────
SELECT
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('has_contract_role', 'has_contract_access', 'get_contract_role')
ORDER BY routine_name;


-- ── V8: RLS is enabled on new table ─────────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'user_contract_roles';


-- ── V9: Policies on new table ────────────────────────────────────
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  SUBSTRING(qual::TEXT, 1, 80) AS using_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_contract_roles'
ORDER BY policyname;


-- ── V10: Confirm NO existing policies were modified ──────────────
-- Spot-check: contracts and claims policies should be unchanged
SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contracts', 'claims')
ORDER BY tablename, policyname;
