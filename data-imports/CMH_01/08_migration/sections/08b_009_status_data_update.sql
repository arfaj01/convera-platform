-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 08b — Status data UPDATE (guarded, split from 009)
--  Source seq      : 009
--  Source migration: migrations/009_rename_claim_statuses.sql  [GUARDED v2.4 split]
--  Purpose         : Re-map legacy claim_status / change_order_status values to new labels. Each UPDATE is gated on a pg_enum lookup so missing old labels do NOT cause 22P02.
--  Run order       : After 08a in a SEPARATE Run-button submission. Before STEP 9.
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result on FRESH staging: "Success. No rows returned" — every guarded block skips because the old labels never existed in change_order_status, and claims/claim_workflow are empty.
--  Expected result on a database that still has old labels: rows updated.
--  PG safety: pg_enum lookups + EXECUTE on dynamic SQL avoid parse-time enum literal validation.
--  On error: STOP. Capture the full PG error.
-- ════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
--  Guarded data update for legacy claim_status / change_order_status.
--
--  This file replays the UPDATE statements that the original
--  legacy/CONVERA/SQL/migrations/009_rename_claim_statuses.sql would
--  apply on a database that still has the OLD workflow status labels.
--
--  Each UPDATE is wrapped in `IF EXISTS (... pg_enum lookup ...)`
--  so that:
--    • Fresh STAGING (no old labels in change_order_status) → skips
--      cleanly. No 22P02 because the UPDATE is never parsed when the
--      label doesn't exist.
--    • A production-like database with the old labels present →
--      executes the migration normally.
--
--  On fresh staging, EVERY block here is expected to be a no-op
--  (the IF guard returns false because change_order_status never had
--  the consultant/admin labels, and claims/claim_workflow are empty).
--  That is the intended outcome — keep this file in the run order so
--  any future re-apply against a non-fresh database remains correct.
--
--  This file MUST run AFTER 08a in a SEPARATE Run-button submission
--  (PG transaction). Same-transaction execution would trip 55P04.
-- ──────────────────────────────────────────────────────────────────

DO $migrate_status$
DECLARE
  v_label_exists BOOLEAN;
BEGIN
  -- claim_status: 'under_consultant_review' → 'under_supervisor_review'
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_consultant_review'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE claims
         SET status = 'under_supervisor_review'::claim_status
       WHERE status::text = 'under_consultant_review';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET to_status = 'under_supervisor_review'::claim_status
       WHERE to_status::text = 'under_consultant_review';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET from_status = 'under_supervisor_review'::claim_status
       WHERE from_status::text = 'under_consultant_review';
    $sql$;
  END IF;

  -- claim_status: 'returned_by_consultant' → 'returned_by_supervisor'
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_consultant'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE claims
         SET status = 'returned_by_supervisor'::claim_status
       WHERE status::text = 'returned_by_consultant';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET to_status = 'returned_by_supervisor'::claim_status
       WHERE to_status::text = 'returned_by_consultant';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET from_status = 'returned_by_supervisor'::claim_status
       WHERE from_status::text = 'returned_by_consultant';
    $sql$;
  END IF;

  -- claim_status: 'under_admin_review' → 'under_auditor_review'
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_admin_review'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE claims
         SET status = 'under_auditor_review'::claim_status
       WHERE status::text = 'under_admin_review';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET to_status = 'under_auditor_review'::claim_status
       WHERE to_status::text = 'under_admin_review';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET from_status = 'under_auditor_review'::claim_status
       WHERE from_status::text = 'under_admin_review';
    $sql$;
  END IF;

  -- claim_status: 'returned_by_admin' → 'returned_by_auditor'
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_admin'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE claims
         SET status = 'returned_by_auditor'::claim_status
       WHERE status::text = 'returned_by_admin';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET to_status = 'returned_by_auditor'::claim_status
       WHERE to_status::text = 'returned_by_admin';
    $sql$;
    EXECUTE $sql$
      UPDATE claim_workflow
         SET from_status = 'returned_by_auditor'::claim_status
       WHERE from_status::text = 'returned_by_admin';
    $sql$;
  END IF;

  -- change_order_status: 'under_consultant_review' → 'under_supervisor_review'
  -- (label-existence guard prevents 22P02 on fresh staging where
  --  change_order_status never had the consultant label)
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'change_order_status' AND e.enumlabel = 'under_consultant_review'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE change_orders
         SET status = 'under_supervisor_review'::change_order_status
       WHERE status::text = 'under_consultant_review';
    $sql$;
  END IF;

  -- change_order_status: 'under_admin_review' → 'under_auditor_review'
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'change_order_status' AND e.enumlabel = 'under_admin_review'
  ) INTO v_label_exists;
  IF v_label_exists THEN
    EXECUTE $sql$
      UPDATE change_orders
         SET status = 'under_auditor_review'::change_order_status
       WHERE status::text = 'under_admin_review';
    $sql$;
  END IF;
END
$migrate_status$;
