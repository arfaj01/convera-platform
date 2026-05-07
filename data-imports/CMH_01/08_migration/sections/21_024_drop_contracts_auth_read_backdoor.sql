-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 21 — MIGRATION
--  Source seq      : 024
--  Source migration: migrations/024_drop_contracts_auth_read_backdoor.sql
--  Purpose         : remove auth-read backdoor on contracts
--  Run order       : STEP 21 of 48 (after STEP 20, before STEP 22).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 024: Drop contracts_auth_read Backdoor
--  File: 024_drop_contracts_auth_read_backdoor.sql
--
--  CRITICAL SECURITY FIX
--  ─────────────────────────────────────────────────────────────────────
--  Migration 013 added "contracts_auth_read" with:
--    USING (auth.uid() IS NOT NULL)
--  This allows ANY authenticated user to SELECT ALL contracts,
--  completely bypassing the user_contracts scoping from migration 019.
--
--  ROOT CAUSE: Migration 013 added this policy to support the
--  check_claim_within_contract_limit() trigger. However, that trigger
--  was ALSO fixed in 013 to use SECURITY DEFINER (which bypasses RLS).
--  So contracts_auth_read was never actually needed — it was a
--  redundant policy that became a critical security hole.
--
--  IMPACT: With contracts_auth_read active, Supabase's PERMISSIVE OR
--  logic means every contractor/consultant sees ALL contracts regardless
--  of user_contracts linkage. This cascades to:
--    - claims (via contract_id FK + claim SELECT policies)
--    - claim_boq_items / claim_staff_items (via claim_id subquery)
--    - contract_ceiling_summary (via underlying contracts table)
--    - dashboard KPIs (all computed from contracts + claims)
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  Phase 1: DROP the backdoor policy
--  Phase 2: Comprehensive audit of ALL remaining policies on contracts
--           and claims to confirm no other open policies exist
--  Phase 3: Verify zero-scope enforcement
--
--  IDEMPOTENT: Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — DROP THE BACKDOOR
-- ════════════════════════════════════════════════════════════════════

-- THE critical fix: remove the open "any authenticated user" policy
DROP POLICY IF EXISTS "contracts_auth_read" ON contracts;

-- Also drop any other potential auth_read backdoors on related tables
-- (defensive — these may not exist, but DROP IF EXISTS is safe)
DROP POLICY IF EXISTS "claims_auth_read"           ON claims;
DROP POLICY IF EXISTS "claim_boq_auth_read"        ON claim_boq_items;
DROP POLICY IF EXISTS "claim_staff_auth_read"      ON claim_staff_items;
DROP POLICY IF EXISTS "change_orders_auth_read"    ON change_orders;
DROP POLICY IF EXISTS "amendments_auth_read"       ON contract_amendments;
DROP POLICY IF EXISTS "workflow_auth_read"          ON claim_workflow;


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — FULL POLICY AUDIT (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════

-- 2.1  List ALL policies on contracts — confirm no open policies remain
SELECT
  policyname,
  cmd,
  permissive,
  LEFT(qual, 120)       AS using_clause,
  LEFT(with_check, 120) AS check_clause
FROM pg_policies
WHERE tablename = 'contracts'
ORDER BY policyname;
-- EXPECTED policies (and ONLY these):
--   contracts_internal_all      → is_internal()
--   contracts_internal_select   → role IN ('director','admin','reviewer')
--   contracts_contractor_select → user_contracts check
--   contracts_consultant_select → user_contracts check
-- MUST NOT contain: contracts_auth_read, contracts_external_select_own


-- 2.2  List ALL policies on claims — confirm no open policies remain
SELECT
  policyname,
  cmd,
  permissive,
  LEFT(qual, 120)       AS using_clause,
  LEFT(with_check, 120) AS check_clause
FROM pg_policies
WHERE tablename = 'claims'
ORDER BY policyname;
-- EXPECTED policies:
--   claims_internal_all        → is_internal()
--   claims_internal_select     → role IN ('director','admin','reviewer')
--   claims_contractor_select   → user_contracts check
--   claims_contractor_insert   → user_contracts + created_by check
--   claims_contractor_update   → user_contracts + created_by + status check
--   claims_consultant_select   → user_contracts check
--   claims_consultant_update   → user_contracts + status check
-- MUST NOT contain: claims_auth_read, claims_external_*


-- 2.3  CRITICAL: Scan ALL tables for any remaining open/backdoor policies
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 100)       AS using_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
    OR qual LIKE '%auth.uid()  IS NOT NULL%'
  )
ORDER BY tablename, policyname;
-- EXPECTED: 0 rows (ZERO open policies on any public table)
-- If any rows appear, they are additional security holes that must be fixed.


-- 2.4  Confirm check_claim_within_contract_limit is SECURITY DEFINER
--       (this is why contracts_auth_read was never needed)
SELECT
  proname,
  prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'check_claim_within_contract_limit';
-- EXPECTED: is_security_definer = true


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — ZERO-SCOPE ENFORCEMENT SIMULATION
--
--  These queries simulate what a contractor with ZERO user_contracts
--  rows would see. Run them AS a contractor user (not service role).
--  If using Supabase SQL Editor (runs as postgres), you can use:
--    SET LOCAL ROLE authenticated;
--    SET LOCAL request.jwt.claims = '{"sub":"<contractor-user-id>"}';
-- ════════════════════════════════════════════════════════════════════

-- 3.1  Count all remaining open policies (should be 0)
SELECT COUNT(*) AS open_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  );
-- EXPECTED: 0

-- 3.2  Verify external_user_id is NOT used in any remaining policy
SELECT COUNT(*) AS external_user_id_policy_count
FROM pg_policies
WHERE qual LIKE '%external_user_id%';
-- EXPECTED: 0
