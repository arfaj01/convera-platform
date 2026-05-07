-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 24 — MIGRATION
--  Source seq      : 027
--  Source migration: migrations/027_contract_role_browser_helpers.sql
--  Purpose         : browser helpers for contract roles
--  Run order       : STEP 24 of 48 (after STEP 23, before STEP 25).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 027: Browser-Accessible Contract Role Helpers
--  File: 027_contract_role_browser_helpers.sql
--
--  PURPOSE
--  ─────────────────────────────────────────────────────────────────
--  Migration 025 created the user_contract_roles table and
--  SECURITY DEFINER helper functions (has_contract_role, etc.),
--  but the table has RLS enabled with no direct-read policies.
--
--  The browser client needs to discover WHICH contracts a user
--  holds a specific role on (e.g., "give me all my contractor
--  contracts"). This migration adds:
--
--  1. get_my_contracts_by_role(_role) — returns contract IDs
--  2. get_my_contract_roles()        — returns full assignment rows
--  3. Self-read RLS policy on user_contract_roles
--
--  All functions are SECURITY DEFINER to bypass RLS safely.
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
--  1. get_my_contracts_by_role — returns contract UUIDs
--     Usage: supabase.rpc('get_my_contracts_by_role', { _role: 'contractor' })
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_contracts_by_role(
  _role contract_role
) RETURNS SETOF UUID AS $$
  SELECT contract_id
  FROM user_contract_roles
  WHERE user_id       = auth.uid()
    AND contract_role = _role
    AND is_active     = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_my_contracts_by_role(contract_role) IS
  'Returns contract IDs where the current user has the specified active role. '
  'SECURITY DEFINER — bypasses RLS on user_contract_roles. '
  'Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  2. get_my_contract_roles — returns full assignment rows
--     Usage: supabase.rpc('get_my_contract_roles')
--     Returns: { contract_id, contract_role, is_active, assigned_at }
-- ────────────────────────────────────────────────────────────────

-- Custom return type for the function
DO $$ BEGIN
  CREATE TYPE my_contract_role_row AS (
    contract_id   UUID,
    contract_role contract_role,
    is_active     BOOLEAN,
    assigned_at   TIMESTAMPTZ,
    notes         TEXT
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION get_my_contract_roles()
RETURNS SETOF my_contract_role_row AS $$
  SELECT contract_id, contract_role, is_active, assigned_at, notes
  FROM user_contract_roles
  WHERE user_id   = auth.uid()
    AND is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_my_contract_roles() IS
  'Returns all active contract-role assignments for the current user. '
  'SECURITY DEFINER — bypasses RLS. Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  3. get_user_contract_roles_admin — director-only, any user
--     Usage: supabase.rpc('get_user_contract_roles_admin', { _user_id: '...' })
--     For the user management page.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_contract_roles_admin(
  _user_id UUID
) RETURNS TABLE (
  id            UUID,
  contract_id   UUID,
  contract_role contract_role,
  is_active     BOOLEAN,
  assigned_at   TIMESTAMPTZ,
  notes         TEXT
) AS $$
BEGIN
  -- Only director can call this
  IF NOT (SELECT role FROM profiles WHERE profiles.id = auth.uid()) = 'director' THEN
    RAISE EXCEPTION 'غير مصرح — مدير الإدارة فقط';
  END IF;

  RETURN QUERY
    SELECT ucr.id, ucr.contract_id, ucr.contract_role,
           ucr.is_active, ucr.assigned_at, ucr.notes
    FROM user_contract_roles ucr
    WHERE ucr.user_id = _user_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_user_contract_roles_admin(UUID) IS
  'Director-only: returns all contract-role assignments for a given user. '
  'SECURITY DEFINER — bypasses RLS. Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  4. Self-read RLS policy on user_contract_roles
--     Users can read their own rows. Directors can read all.
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "ucr_self_select" ON user_contract_roles;
CREATE POLICY "ucr_self_select"
  ON user_contract_roles FOR SELECT
  USING (
    user_id = auth.uid()
    OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );

-- Director can manage all rows (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "ucr_director_all" ON user_contract_roles;
CREATE POLICY "ucr_director_all"
  ON user_contract_roles FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );


COMMIT;

-- ── Verification ───────────────────────────────────────────────

-- Test: get your own contractor contracts
-- SELECT * FROM get_my_contracts_by_role('contractor');

-- Test: get all your active roles
-- SELECT * FROM get_my_contract_roles();

-- Test (as director): get another user's roles
-- SELECT * FROM get_user_contract_roles_admin('a1000005-0000-0000-0000-000000000005');

-- Confirm policies exist
SELECT policyname, cmd, permissive
FROM pg_policies
WHERE tablename = 'user_contract_roles'
ORDER BY policyname;
