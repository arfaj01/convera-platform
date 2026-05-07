-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 15 — MIGRATION
--  Source seq      : 017
--  Source migration: migrations/017_fix_contracts_rls_user_contracts.sql
--  Purpose         : RLS fix contracts/user_contracts join
--  Run order       : STEP 15 of 48 (after STEP 14, before STEP 16).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 017: Fix Contracts RLS — Use user_contracts
--  File: 017_fix_contracts_rls_user_contracts.sql
--
--  Problem:
--    • contracts_contractor_select  → scoped by "has submitted a claim"
--                                     (claims.submitted_by = auth.uid())
--                                     Removing a contractor from user_contracts
--                                     has NO effect because this policy ignores
--                                     that table entirely.
--    • contracts_supervisor_select  → scoped by contract_assignments table
--                                     AND uses 'supervisor'::user_role which is
--                                     not a valid enum value (should be 'consultant').
--
--  Fix:
--    Both external-role policies now use user_contracts as the single
--    source of truth for contract visibility.  Director is the only one
--    who writes to user_contracts (via the admin API), so removing a
--    row there immediately removes visibility for that user.
--
--  Roles affected:
--    • contractor  (DB role = 'contractor')
--    • supervisor  (DB role = 'consultant'  — legacy name in user_role enum)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Drop outdated policies ─────────────────────────────────────

DROP POLICY IF EXISTS "contracts_contractor_select"  ON contracts;
DROP POLICY IF EXISTS "contracts_supervisor_select"  ON contracts;
-- Drop the consultant variant too in case it was created by a prior patch
DROP POLICY IF EXISTS "contracts_consultant_select"  ON contracts;

-- ── 2. Contractor — scope to user_contracts ───────────────────────
--
-- A contractor can see a contract only when there is a row in
-- user_contracts that links their profile to that contract.
-- The director manages these rows via the admin users UI.

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

-- ── 3. Supervisor / Consultant — scope to user_contracts ──────────
--
-- Same logic for the consultant role (shown as "supervisor" in UI).
-- The DB enum value is 'consultant'; the old policy mistakenly used
-- 'supervisor'::user_role which never matched anything.

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

-- ── 4. Fix claims RLS — contractor can only see claims on linked contracts ──
--
-- Current policy (claims_contractor_select in 010_production_schema.sql):
--   USING (submitted_by = auth.uid() OR created_by = auth.uid())
--
-- This lets a contractor see ALL claims they ever submitted, even on contracts
-- they have since been removed from.  Fix: scope to user_contracts too.

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

-- ── 5. Fix claims RLS — consultant scope via user_contracts ───────
--
-- Drop old supervisor-style policy if it exists and replace with
-- a proper user_contracts check for the consultant role.

DROP POLICY IF EXISTS "claims_supervisor_select"  ON claims;
DROP POLICY IF EXISTS "claims_consultant_select"  ON claims;

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

-- ── 6. Verification ───────────────────────────────────────────────
-- Run after applying to confirm expected policies exist:
SELECT
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
ORDER BY tablename, policyname;

-- Expected new/updated policies:
--   contracts → contracts_consultant_select  (user_contracts-based)
--   contracts → contracts_contractor_select  (user_contracts-based)
--   claims    → claims_contractor_select     (user_contracts-based)
--   claims    → claims_consultant_select     (user_contracts-based)
--   (other pre-existing policies remain unchanged)
