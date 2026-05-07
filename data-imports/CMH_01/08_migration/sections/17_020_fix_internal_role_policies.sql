-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 17 — MIGRATION
--  Source seq      : 020
--  Source migration: migrations/020_fix_internal_role_policies.sql
--  Purpose         : internal-role policy fixes
--  Run order       : STEP 17 of 48 (after STEP 16, before STEP 18).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 020: Fix Internal Role Policy Mismatch
--  File: 020_fix_internal_role_policies.sql
--
--  ROOT CAUSE
--  ─────────────────────────────────────────────────────────────────────
--  The DB user_role enum (migration 001) uses:
--    director | admin | reviewer | consultant | contractor
--
--  Migration 010 (production schema) was written assuming a DIFFERENT
--  enum that used 'auditor' and 'supervisor' instead of 'admin' and
--  'consultant'. As a result, every "internal" RLS policy in migration
--  010 checks for role IN ('director', 'reviewer', 'auditor') — but
--  'auditor' does NOT exist in the enum. The actual internal admin role
--  is 'admin'.
--
--  SYMPTOM
--  ─────────────────────────────────────────────────────────────────────
--  Users with role='admin' (e.g., حسام الحبلين) cannot see ANY contracts
--  or claims through RLS because no policy grants them access. The
--  frontend shows empty lists and permission errors for these users.
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  1. Fixes is_internal() helper function: 'admin' instead of 'auditor'
--  2. Drops and recreates all affected SELECT policies to include 'admin'
--     in the role check (replacing 'auditor' wherever it appears)
--  3. Fixes profiles_internal_select which also uses the wrong role name
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + CREATE).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — Fix is_internal() helper function
--  The function is used in some policies — fix it first.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_internal()
RETURNS BOOLEAN AS $$
BEGIN
  -- 'admin' is the actual DB enum value for the auditor/admin role.
  -- 'auditor' does NOT exist in user_role enum — this was a schema mismatch.
  RETURN (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('director', 'admin', 'reviewer');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION is_internal() IS
  'Returns true if current user is director, admin, or reviewer (internal staff roles). '
  'Note: DB enum uses ''admin'', not ''auditor''. Updated by migration 020.';


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — Fix profiles_internal_select
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_internal_select" ON profiles;
-- Use is_internal() which is SECURITY DEFINER — bypasses RLS on profiles
-- to avoid infinite recursion (a policy on profiles cannot sub-select from profiles).
CREATE POLICY "profiles_internal_select"
  ON profiles FOR SELECT
  USING (is_internal());


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — Fix contracts policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "contracts_internal_select" ON contracts;
CREATE POLICY "contracts_internal_select"
  ON contracts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );

-- NOTE: contract_assignments table does not exist in this schema.
-- The supervisor/consultant assignment model uses user_contracts instead.
-- Skipping contract_assignments_internal_all policy.


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — Fix claims policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "claims_internal_select" ON claims;
CREATE POLICY "claims_internal_select"
  ON claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — Fix change_orders policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "change_orders_internal_select" ON change_orders;
CREATE POLICY "change_orders_internal_select"
  ON change_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 6 — Fix kpi_snapshots policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "kpi_snapshots_internal_select" ON kpi_snapshots;
CREATE POLICY "kpi_snapshots_internal_select"
  ON kpi_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 7 — Fix audit_logs policy (add 'admin' access)
-- ════════════════════════════════════════════════════════════════════

-- Admin users should also be able to read audit logs (they are internal staff)
DROP POLICY IF EXISTS "audit_logs_director_reviewer_select" ON audit_logs;
CREATE POLICY "audit_logs_director_reviewer_select"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 8 — Also fix the claims_admin_update policy from migration 012
--  That policy already uses 'admin' correctly, but let's confirm it
--  exists and is correct. No changes needed there.
--
--  Verification queries:
-- ════════════════════════════════════════════════════════════════════

COMMIT;

-- ── After running, verify the fix ────────────────────────────────

-- 1. Confirm is_internal() now returns TRUE for 'admin' role:
--    SELECT is_internal() AS should_be_true;
--    (Run as an admin-role user)

-- 2. Confirm all internal policies now mention 'admin':
SELECT
  tablename,
  policyname,
  LEFT(qual, 120) AS condition_preview
FROM pg_policies
WHERE tablename IN (
  'contracts', 'claims', 'change_orders', 'kpi_snapshots',
  'audit_logs', 'profiles'
)
  AND policyname LIKE '%internal%'
ORDER BY tablename, policyname;

-- 3. Confirm 'auditor' no longer appears in any policy condition:
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%auditor%'
   OR with_check LIKE '%auditor%';
-- Expected: 0 rows (no policies should reference 'auditor' since it's not a valid role)
