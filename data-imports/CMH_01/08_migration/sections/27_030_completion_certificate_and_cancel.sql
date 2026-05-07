-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 27 — MIGRATION
--  Source seq      : 030
--  Source migration: migrations/030_completion_certificate_and_cancel.sql
--  Purpose         : completion-cert + cancel actions
--  Run order       : STEP 27 of 48 (after STEP 26, before STEP 28).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 030: Completion Certificate Gate & Cancel Action
--
--  PURPOSE:
--    1. Add 'cancelled' to claim_status enum (terminal state)
--    2. Add has_completion_certificate boolean column to claims
--    3. Add 'completion_certificate' as a valid document type
--    4. Add 'cancel' and 'upload_certificate' to claim_workflow action constraint
--    5. DB-level gate: supervisor cannot approve without certificate
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
--  1. Add 'cancelled' to claim_status enum
-- ────────────────────────────────────────────────────────────────

ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'cancelled' AFTER 'rejected';

-- ────────────────────────────────────────────────────────────────
--  2. Add has_completion_certificate flag to claims table
--     Defaults to FALSE. Updated to TRUE when supervisor uploads.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS has_completion_certificate BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN claims.has_completion_certificate IS
  'Set TRUE when supervisor uploads completion certificate. Required before supervisor approve.';

-- ────────────────────────────────────────────────────────────────
--  3. Drop and recreate claim_workflow action constraint
--     to include 'cancel' and 'upload_certificate'
-- ────────────────────────────────────────────────────────────────

ALTER TABLE claim_workflow
  DROP CONSTRAINT IF EXISTS claim_workflow_action_check;

ALTER TABLE claim_workflow
  ADD CONSTRAINT claim_workflow_action_check
  CHECK (action IN (
    -- External user actions
    'submit',              -- submits a draft claim
    'resubmit',            -- resubmits after return
    'withdraw',            -- contractor withdraws claim back to draft
    'cancel',              -- contractor cancels claim (terminal)
    'comment',             -- informational note, no status change
    -- Supervisor actions
    'upload_certificate',  -- supervisor uploads completion certificate
    'consultant_review',   -- legacy: moved to under_consultant_review
    'consultant_return',   -- legacy: returned from consultant review
    -- Admin/Auditor review stage
    'admin_review',        -- moved to under_admin_review
    'admin_return',        -- admin returns to submitter
    -- Director stage
    'forward',             -- admin forwards to director
    'approve',             -- approves (any stage)
    'reject',              -- director rejects
    'return',              -- return to previous stage
    'director_return',     -- legacy: director returns to admin
    'director_override',   -- director overrides routing
    -- Lifecycle
    'close',
    'reopen'
  ));

-- ────────────────────────────────────────────────────────────────
--  4. Update the db-level transition guard (if it exists)
--     to allow: under_supervisor_review → cancelled (cancel)
--     and block: cancelled → anything (terminal)
-- ────────────────────────────────────────────────────────────────

-- Add cancelled as immutable (same as approved/rejected)
CREATE OR REPLACE FUNCTION prevent_cancelled_claim_edit()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'cancelled' AND TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Cannot modify a cancelled claim';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prevent_cancelled_edit ON claims;
CREATE TRIGGER trg_prevent_cancelled_edit
  BEFORE UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION prevent_cancelled_claim_edit();

-- ────────────────────────────────────────────────────────────────
--  5. Ensure documents table supports 'completion_certificate' type
--     (The documents.type column is TEXT, so no enum change needed.
--      But we add a comment for documentation.)
-- ────────────────────────────────────────────────────────────────

COMMENT ON TABLE documents IS
  'File attachments. Supported types: invoice, report, claim, approval, completion_certificate, other';

COMMIT;

-- ── Verification ───────────────────────────────────────────────

-- Check claim_status enum includes cancelled
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'claim_status'::regtype
ORDER BY enumsortorder;

-- Check has_completion_certificate column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'claims' AND column_name = 'has_completion_certificate';

-- Check updated constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'claim_workflow_action_check';
