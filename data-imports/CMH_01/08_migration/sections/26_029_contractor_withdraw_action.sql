-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 26 — MIGRATION
--  Source seq      : 029
--  Source migration: migrations/029_contractor_withdraw_action.sql
--  Purpose         : contractor withdraw action
--  Run order       : STEP 26 of 48 (after STEP 25, before STEP 27).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 029: Contractor Self-Service (Withdraw)
--
--  PURPOSE: Allow contractors to withdraw claims that are in
--  under_supervisor_review — before supervisor takes action.
--
--  Changes:
--    1. Add 'withdraw' to claim_workflow_action_check constraint
--    2. (No new tables, no RLS changes)
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
--  1. Drop and recreate the claim_workflow action constraint
--     to include 'withdraw' as a valid action
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
    'comment',             -- informational note, no status change
    -- Consultant/Supervisor review stage
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

COMMIT;

-- ── Verification ───────────────────────────────────────────────

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'claim_workflow_action_check';
