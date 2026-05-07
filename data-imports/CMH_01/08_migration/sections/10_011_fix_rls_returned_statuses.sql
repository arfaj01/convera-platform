-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 10 — MIGRATION
--  Source seq      : 011
--  Source migration: migrations/011_fix_rls_returned_statuses.sql
--  Purpose         : RLS fix returned statuses
--  Run order       : STEP 10 of 48 (after STEP 9, before STEP 11).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- Migration 011: Fix claims RLS to include new returned_by_* status names
-- The original claims_external_update_editable policy referenced old status names
-- (returned_by_consultant, returned_by_admin). Migration 009 added new names
-- (returned_by_supervisor, returned_by_auditor) but this policy was not updated.

DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;

CREATE POLICY "claims_external_update_editable"
  ON claims FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN (
      'draft',
      'returned_by_supervisor',
      'returned_by_auditor',
      'returned_by_consultant',
      'returned_by_admin'
    )
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN (
      'draft',
      'returned_by_supervisor',
      'returned_by_auditor',
      'returned_by_consultant',
      'returned_by_admin',
      'submitted'
    )
  );
