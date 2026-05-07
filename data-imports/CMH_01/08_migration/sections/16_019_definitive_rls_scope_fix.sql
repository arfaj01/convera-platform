-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 16 — MIGRATION
--  Source seq      : 019
--  Source migration: migrations/019_definitive_rls_scope_fix.sql
--  Purpose         : definitive RLS scoping
--  Run order       : STEP 16 of 48 (after STEP 15, before STEP 17).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 019: Definitive RLS Scope Enforcement
--  File: 019_definitive_rls_scope_fix.sql
--
--  WHY THIS EXISTS
--  ───────────────
--  Supabase evaluates PERMISSIVE policies with OR logic: if ANY policy
--  grants access, the row is returned.  Previous migrations (017) dropped
--  policies from 010_production_schema.sql, but left the ORIGINAL policies
--  from 001_base_schema.sql alive.  Those older policies use:
--    • contracts.external_user_id = auth.uid()    (deprecated column approach)
--    • claims.submitted_by = auth.uid()           (ignores user_contracts)
--    • claims.created_by  = auth.uid()            (ignores user_contracts)
--  meaning a contractor whose user_contracts rows are deleted can STILL
--  see contracts and claims through the old policies.
--
--  Additionally migration 012 added:
--    • claims_consultant_select: role = 'consultant'   (NO scope check at all)
--  allowing any consultant to read ALL claims platform-wide.
--
--  WHAT THIS MIGRATION DOES
--  ────────────────────────
--  Phase 1 — DROP every policy on contracts, claims, claim_boq_items,
--             claim_staff_items that uses the deprecated external_user_id /
--             submitted_by / created_by approach or has no scope check.
--
--  Phase 2 — RECREATE correct policies using user_contracts as the single
--             authoritative scope table for contractor and consultant roles.
--
--  Phase 3 — Verification query.
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + DO $$).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — DROP ALL STALE / OPEN / SCOPE-LESS POLICIES
-- ════════════════════════════════════════════════════════════════════

-- ── contracts ────────────────────────────────────────────────────────

-- 001: external_user_id = auth.uid() (ignores user_contracts)
DROP POLICY IF EXISTS "contracts_external_select_own"   ON contracts;

-- 010: submitted_by-based  (wrong source of truth)
DROP POLICY IF EXISTS "contracts_contractor_select"     ON contracts;
-- 010: 'supervisor'::user_role cast + contract_assignments (enum mismatch + wrong table)
DROP POLICY IF EXISTS "contracts_supervisor_select"     ON contracts;

-- 017: drop the versions added by 017 so we recreate them cleanly below
DROP POLICY IF EXISTS "contracts_consultant_select"     ON contracts;

-- ── claims ───────────────────────────────────────────────────────────

-- 001: submitted_by / created_by / external_user_id  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_external_select"          ON claims;
-- 001: INSERT check using contracts.external_user_id  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_external_insert"          ON claims;
-- 001 / 011: UPDATE using created_by / submitted_by without scope check
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;

-- 010: submitted_by = auth.uid() for SELECT  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_contractor_select"        ON claims;
-- 010: INSERT using role check + submitted_by, no user_contracts
DROP POLICY IF EXISTS "claims_contractor_insert"        ON claims;
-- 010: UPDATE draft using submitted_by, no user_contracts
DROP POLICY IF EXISTS "claims_contractor_update_draft"  ON claims;
-- 010: 'supervisor'::user_role + contract_assignments (enum mismatch + wrong table)
DROP POLICY IF EXISTS "claims_supervisor_select"        ON claims;

-- 012: role = 'consultant' with NO scope check  ← most dangerous: all claims visible
DROP POLICY IF EXISTS "claims_consultant_select"        ON claims;
-- 012: consultant UPDATE without user_contracts
DROP POLICY IF EXISTS "claims_consultant_update"        ON claims;

-- 017: drop then recreate cleanly below
DROP POLICY IF EXISTS "claims_contractor_select"        ON claims;

-- ── claim_boq_items ──────────────────────────────────────────────────

-- 001: all use external_user_id approach
DROP POLICY IF EXISTS "claim_boq_external_select"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_insert"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_update"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_delete"       ON claim_boq_items;

-- ── claim_staff_items ────────────────────────────────────────────────

-- 001: all use external_user_id approach
DROP POLICY IF EXISTS "claim_staff_external_select"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_insert"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_update"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_delete"     ON claim_staff_items;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — CREATE CORRECT SCOPE-ENFORCED POLICIES
--
--  Scope rule for external roles (contractor, consultant/supervisor):
--    A row is accessible ONLY when there is a row in user_contracts
--    linking auth.uid() to the contract_id of that resource.
--
--  Internal roles (director, admin, reviewer) are intentionally global
--  and are handled by existing is_internal() / claims_internal_all policies.
-- ════════════════════════════════════════════════════════════════════

-- ── 2.1  contracts — contractor SELECT ───────────────────────────────
DROP POLICY IF EXISTS "contracts_contractor_select" ON contracts;
CREATE POLICY "contracts_contractor_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 2.2  contracts — consultant/supervisor SELECT ────────────────────
DROP POLICY IF EXISTS "contracts_consultant_select" ON contracts;
CREATE POLICY "contracts_consultant_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 2.3  claims — contractor SELECT (scoped to linked contracts) ─────
DROP POLICY IF EXISTS "claims_contractor_select" ON claims;
CREATE POLICY "claims_contractor_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.4  claims — contractor INSERT ──────────────────────────────────
DROP POLICY IF EXISTS "claims_contractor_insert" ON claims;
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts uc
      JOIN   contracts c ON c.id = uc.contract_id
      WHERE  uc.user_id     = auth.uid()
        AND  uc.contract_id = claims.contract_id
        AND  c.status       = 'active'
    )
    AND created_by = auth.uid()
  );

-- ── 2.5  claims — contractor UPDATE (draft / returned states) ────────
DROP POLICY IF EXISTS "claims_contractor_update" ON claims;
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                   'returned_by_supervisor',           'returned_by_auditor')
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.6  claims — consultant/supervisor SELECT ───────────────────────
DROP POLICY IF EXISTS "claims_consultant_select" ON claims;
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.7  claims — consultant/supervisor UPDATE ───────────────────────
DROP POLICY IF EXISTS "claims_consultant_update" ON claims;
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted', 'under_supervisor_review')
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.8  claim_boq_items — contractor / consultant ───────────────────
DROP POLICY IF EXISTS "claim_boq_scoped_select"        ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_insert"    ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_update"    ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_delete"    ON claim_boq_items;

CREATE POLICY "claim_boq_scoped_select"
  ON claim_boq_items FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM claims
    )
  );

CREATE POLICY "claim_boq_contractor_insert"
  ON claim_boq_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
    AND change_order_id IS NULL
  );

CREATE POLICY "claim_boq_contractor_update"
  ON claim_boq_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_boq_contractor_delete"
  ON claim_boq_items FOR DELETE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status = 'draft'
    )
  );

-- ── 2.9  claim_staff_items — contractor / consultant ─────────────────
DROP POLICY IF EXISTS "claim_staff_scoped_select"       ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_insert"   ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_update"   ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_delete"   ON claim_staff_items;

CREATE POLICY "claim_staff_scoped_select"
  ON claim_staff_items FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM claims
    )
  );

CREATE POLICY "claim_staff_contractor_insert"
  ON claim_staff_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_staff_contractor_update"
  ON claim_staff_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_staff_contractor_delete"
  ON claim_staff_items FOR DELETE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — VERIFICATION
-- ════════════════════════════════════════════════════════════════════

COMMIT;

-- ── After running, execute these to verify ───────────────────────────

-- 1. List all current policies on key tables
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 80) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contracts', 'claims', 'claim_boq_items', 'claim_staff_items')
ORDER BY tablename, policyname;

-- 2. Confirm NONE of the old open policies remain:
SELECT COUNT(*) AS should_be_zero
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
  AND policyname IN (
    'contracts_external_select_own',
    'contracts_supervisor_select',
    'claims_external_select',
    'claims_external_insert',
    'claims_external_update_editable',
    'claims_supervisor_select',
    'claims_contractor_select'   -- old submitted_by version
  );
-- Expected: 0

-- 3. Simulate contractor with NO user_contracts — should return 0 rows:
-- (Run as the contractor user, not as service role)
-- SELECT COUNT(*) FROM contracts;   → should be 0
-- SELECT COUNT(*) FROM claims;      → should be 0

-- 4. Confirm new policies exist:
SELECT policyname FROM pg_policies
WHERE tablename = 'contracts'
  AND policyname IN ('contracts_contractor_select', 'contracts_consultant_select');
-- Expected: 2 rows
