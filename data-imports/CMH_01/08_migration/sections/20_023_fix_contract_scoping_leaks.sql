-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 20 — MIGRATION
--  Source seq      : 023
--  Source migration: migrations/023_fix_contract_scoping_leaks.sql
--  Purpose         : plug contract-scoping leaks
--  Run order       : STEP 20 of 48 (after STEP 19, before STEP 21).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 023: Fix All Contract-Level Scoping Leaks
--  File: 023_fix_contract_scoping_leaks.sql
--
--  REQUIREMENT (2026-03-24)
--  ─────────────────────────────────────────────────────────────────────
--  "عند تعديلات الصلاحية وتعطيل ارتباط المستخدم بعقد ما ، يجب ان لا
--   يظهر له اي معلومة عن هذا العقد الغير مرتبط بكل المنصة"
--  When a user is unlinked from a contract (removed from user_contracts),
--  ZERO information about that contract should appear anywhere in the
--  platform — not on the dashboard, contracts page, claims, or anywhere.
--
--  DATA LEAKS FOUND
--  ─────────────────────────────────────────────────────────────────────
--  1. contract_amendments: "amendments_select_all" uses USING (true)
--     → ALL authenticated users can read ALL amendments
--
--  2. documents: "public_all_documents" uses USING (true) WITH CHECK (true)
--     AND "documents_auth_read" uses USING (auth.uid() IS NOT NULL)
--     → ALL authenticated users can read/write ALL documents
--
--  3. change_orders: External policies (co_external_select, co_external_insert)
--     use contracts.external_user_id = auth.uid() — DEPRECATED column.
--     After migration 019, user_contracts is the single source of truth.
--     external_user_id is NOT updated when a user is unlinked.
--
--  4. contract_ceiling_summary VIEW: Owned by postgres (superuser),
--     so RLS on the underlying contracts table is BYPASSED.
--     External users see ceiling data for ALL contracts.
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  Phase 1: Fix contract_amendments — scope by user_contracts
--  Phase 2: Fix documents — scope by user_contracts via claim_id/contract_id FK
--  Phase 3: Fix change_orders — use user_contracts instead of external_user_id
--  Phase 4: Fix contract_ceiling_summary — enable security_invoker
--  Phase 5: Verification queries
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + CREATE).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — Fix contract_amendments RLS
--
--  Problem: "amendments_select_all" uses USING (true) — no scoping.
--  Fix: Internal users keep full access. External users (contractor,
--       consultant) can only see amendments for their linked contracts.
-- ════════════════════════════════════════════════════════════════════

-- Drop the open policy
DROP POLICY IF EXISTS "amendments_select_all" ON contract_amendments;

-- Internal users: full SELECT access (they need to see all amendments)
DROP POLICY IF EXISTS "amendments_internal_select" ON contract_amendments;
CREATE POLICY "amendments_internal_select"
  ON contract_amendments FOR SELECT
  USING (is_internal());

-- External users: scoped to their linked contracts via user_contracts
DROP POLICY IF EXISTS "amendments_external_select" ON contract_amendments;
CREATE POLICY "amendments_external_select"
  ON contract_amendments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contract_amendments.contract_id
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — Fix documents RLS
--
--  Problem: Multiple open policies from migrations 008 and 012:
--    - "public_all_documents"  → USING (true) WITH CHECK (true)
--    - "documents_auth_read"   → USING (auth.uid() IS NOT NULL)
--  These override the proper scoped policies from 001.
--
--  ACTUAL TABLE SCHEMA (from migration 001):
--    documents.claim_id    UUID FK → claims(id)
--    documents.contract_id UUID FK → contracts(id)
--    Constraint: exactly one parent (claim XOR contract)
--
--  Fix: Drop all open policies. Recreate with:
--    - Internal: full access
--    - External: only see documents for linked contracts (via user_contracts)
-- ════════════════════════════════════════════════════════════════════

-- Drop the dangerous open policies
DROP POLICY IF EXISTS "public_all_documents"    ON documents;
DROP POLICY IF EXISTS "documents_auth_read"     ON documents;

-- Also drop older policies that may conflict
DROP POLICY IF EXISTS "documents_internal_all"  ON documents;
DROP POLICY IF EXISTS "documents_external_select" ON documents;
DROP POLICY IF EXISTS "documents_external_insert" ON documents;
DROP POLICY IF EXISTS "documents_external_delete" ON documents;
DROP POLICY IF EXISTS "documents_view"          ON documents;
DROP POLICY IF EXISTS "documents_insert"        ON documents;

-- Internal users: full access to all documents
CREATE POLICY "documents_internal_all"
  ON documents FOR ALL
  USING (is_internal());

-- External users: SELECT documents linked to their contracts
-- documents.claim_id → claims.contract_id → user_contracts
-- documents.contract_id → user_contracts
CREATE POLICY "documents_external_select"
  ON documents FOR SELECT
  USING (
    -- Claim documents: accessible if user is linked to the claim's contract
    (claim_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM claims cl
      JOIN user_contracts uc ON uc.contract_id = cl.contract_id
      WHERE cl.id = documents.claim_id
        AND uc.user_id = auth.uid()
    ))
    OR
    -- Contract documents: accessible if user is linked to the contract
    (contract_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = documents.contract_id
    ))
  );

-- External users: INSERT documents for their linked claims/contracts
CREATE POLICY "documents_external_insert"
  ON documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      -- Can attach to claims on linked contracts (editable states only)
      (claim_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims cl
        JOIN user_contracts uc ON uc.contract_id = cl.contract_id
        WHERE cl.id = documents.claim_id
          AND uc.user_id = auth.uid()
          AND cl.status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                            'returned_by_supervisor', 'returned_by_auditor')
      ))
      OR
      -- Can attach to linked contracts directly
      (contract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_contracts
        WHERE user_id     = auth.uid()
          AND contract_id = documents.contract_id
      ))
    )
  );

-- External users: DELETE only documents they uploaded on linked draft claims
CREATE POLICY "documents_external_delete"
  ON documents FOR DELETE
  USING (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims cl
        JOIN user_contracts uc ON uc.contract_id = cl.contract_id
        WHERE cl.id = documents.claim_id
          AND uc.user_id = auth.uid()
          AND cl.status = 'draft'
      ))
      OR
      (contract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_contracts
        WHERE user_id     = auth.uid()
          AND contract_id = documents.contract_id
      ))
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — Fix change_orders external policies
--
--  Problem: co_external_select/insert use the deprecated
--           contracts.external_user_id = auth.uid() approach.
--           After user_contracts became the single source of truth,
--           external_user_id is NOT updated when unlinking users.
--
--  Fix: Replace with user_contracts-based scoping.
-- ════════════════════════════════════════════════════════════════════

-- Drop the old external_user_id-based policies
DROP POLICY IF EXISTS "co_external_select"       ON change_orders;
DROP POLICY IF EXISTS "co_external_insert"        ON change_orders;
DROP POLICY IF EXISTS "co_external_update_draft"  ON change_orders;

-- External users: SELECT change orders for their linked contracts
CREATE POLICY "co_external_select"
  ON change_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  );

-- External users: INSERT draft change orders for their linked active contracts
CREATE POLICY "co_external_insert"
  ON change_orders FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts uc
      JOIN   contracts c ON c.id = uc.contract_id
      WHERE  uc.user_id     = auth.uid()
        AND  uc.contract_id = change_orders.contract_id
        AND  c.status       = 'active'
    )
  );

-- External users: UPDATE only draft COs they created
CREATE POLICY "co_external_update_draft"
  ON change_orders FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — Fix contract_ceiling_summary VIEW
--
--  Problem: Views in PostgreSQL execute as the VIEW OWNER by default.
--  The owner is 'postgres' (superuser), which BYPASSES RLS on the
--  underlying contracts table. External users querying this view
--  through PostgREST see ceiling data for ALL contracts.
--
--  Fix: Set security_invoker = true (PostgreSQL 15+ feature).
--  This makes the view execute with the INVOKER's (API user's)
--  privileges, so RLS on contracts is properly enforced.
-- ════════════════════════════════════════════════════════════════════

ALTER VIEW contract_ceiling_summary SET (security_invoker = true);


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — VERIFICATION QUERIES (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════

-- 1. Confirm NO open policies remain on key tables
SELECT
  tablename,
  policyname,
  LEFT(qual, 80)  AS condition_preview
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  )
ORDER BY tablename, policyname;
-- EXPECTED: 0 rows (all open policies should be gone)


-- 2. Confirm all external policies now use user_contracts
SELECT
  tablename,
  policyname,
  LEFT(qual, 120) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
  AND policyname LIKE '%external%'
ORDER BY tablename, policyname;
-- EXPECTED: All policies should reference user_contracts


-- 3. Confirm contract_ceiling_summary has security_invoker
SELECT
  schemaname,
  viewname,
  viewowner,
  -- Check if security_invoker is set
  (SELECT reloptions FROM pg_class WHERE relname = 'contract_ceiling_summary')
    AS view_options
FROM pg_views
WHERE viewname = 'contract_ceiling_summary';
-- EXPECTED: view_options should contain {security_invoker=true}


-- 4. Full policy inventory for affected tables
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 100) AS using_clause,
  LEFT(with_check, 100) AS check_clause
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
ORDER BY tablename, policyname;


-- 5. Confirm deprecated external_user_id is no longer used in any policy
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%external_user_id%';
-- EXPECTED: 0 rows (no policies should reference external_user_id)
