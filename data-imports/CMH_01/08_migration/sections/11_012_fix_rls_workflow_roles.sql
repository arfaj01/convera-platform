-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 11 — MIGRATION
--  Source seq      : 012
--  Source migration: migrations/012_fix_rls_workflow_roles.sql
--  Purpose         : RLS fix workflow roles
--  Run order       : STEP 11 of 48 (after STEP 10, before STEP 12).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 012: Fix RLS for All Workflow Roles
--  File: 012_fix_rls_workflow_roles.sql
--
--  Problem: The prototype policy (005) granting broad access was either
--  never applied or was removed. Internal workflow roles (consultant/
--  supervisor, admin/auditor, reviewer, director) lacked explicit
--  SELECT and UPDATE policies to read and act on claims.
--
--  Fix: Add targeted RLS policies for each workflow role covering:
--    - SELECT: consultant can read all claims (for review queue)
--    - UPDATE: each role can transition claims at their assigned stage
--    - INSERT: all roles can log claim_workflow entries
--    - SELECT: all authenticated users can read documents
-- ═══════════════════════════════════════════════════════════════════

-- 1. Consultant (supervisor role in UI) can SELECT all claims
DROP POLICY IF EXISTS "claims_consultant_select" ON claims;
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant');

-- 2. Consultant can UPDATE claims at supervisor stages
--    (submitted → under_supervisor_review → under_auditor_review | returned_by_supervisor)
DROP POLICY IF EXISTS "claims_consultant_update" ON claims;
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted', 'under_supervisor_review')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
  );

-- 3. Admin (auditor role in UI) can UPDATE claims at auditor stage
--    (under_auditor_review → under_reviewer_check | returned_by_auditor)
DROP POLICY IF EXISTS "claims_admin_update" ON claims;
CREATE POLICY "claims_admin_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    AND status IN ('under_auditor_review')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 4. Reviewer can UPDATE claims at reviewer stage
--    (under_reviewer_check → pending_director_approval | returned_by_auditor)
DROP POLICY IF EXISTS "claims_reviewer_update" ON claims;
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer'
    AND status IN ('under_reviewer_check')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer'
  );

-- 5. Director can UPDATE claims at final approval stage
--    (pending_director_approval → approved | rejected | under_auditor_review)
DROP POLICY IF EXISTS "claims_director_update" ON claims;
CREATE POLICY "claims_director_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
    AND status IN ('pending_director_approval')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );

-- 6. All workflow roles can INSERT claim_workflow audit entries
DROP POLICY IF EXISTS "claim_workflow_roles_insert" ON claim_workflow;
CREATE POLICY "claim_workflow_roles_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid())
      IN ('consultant', 'admin', 'reviewer', 'director', 'contractor')
  );

-- 7. All authenticated users can SELECT documents (for attachment visibility)
DROP POLICY IF EXISTS "documents_auth_read" ON documents;
CREATE POLICY "documents_auth_read"
  ON documents FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verification
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'claims' ORDER BY policyname;
