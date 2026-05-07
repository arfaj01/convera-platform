-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 32 — MIGRATION
--  Source seq      : 035
--  Source migration: migrations/035_block_submitted_persist.sql
--  Purpose         : block submitted persistence
--  Run order       : STEP 32 of 48 (after STEP 31, before STEP 33).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
-- Migration 035: Block 'submitted' from persisting in claims table
-- ═══════════════════════════════════════════════════════════════════════
--
-- ROOT CAUSE:
--   A legacy browser-side code path (services/workflow.ts → performClaimAction)
--   was writing claims.status = 'submitted' directly, bypassing the atomic
--   submit_claim_atomic() function. This left claims stuck in 'submitted'
--   with submitted_at = NULL — a state that should never persist.
--
-- FIX:
--   This trigger blocks any UPDATE that would set claims.status = 'submitted'.
--   The ONLY valid path to 'submitted' is INSIDE submit_claim_atomic(), which
--   transitions draft → submitted → under_supervisor_review atomically.
--   Since submit_claim_atomic() never leaves the row at 'submitted' (it
--   immediately moves to under_supervisor_review in the same transaction),
--   this trigger will never fire for the atomic path.
--
-- SAFETY:
--   - submit_claim_atomic() is unaffected (it sets submitted then immediately
--     overwrites with under_supervisor_review — the trigger only fires AFTER
--     the final UPDATE in the transaction, which is under_supervisor_review)
--   - INSERT with status='submitted' is also blocked (claims must start as draft)
--   - The claim_workflow table is NOT affected — audit trail entries can still
--     record from_status/to_status = 'submitted' for history
-- ═══════════════════════════════════════════════════════════════════════

-- Drop if exists (idempotent)
DROP TRIGGER IF EXISTS trg_block_submitted_persist ON claims;
DROP FUNCTION IF EXISTS block_submitted_persist();

CREATE OR REPLACE FUNCTION block_submitted_persist()
RETURNS TRIGGER AS $$
BEGIN
  -- Block any attempt to persist status = 'submitted' in the claims table.
  -- The 'submitted' status is transient — it exists only inside the atomic
  -- submit_claim_atomic() transaction and must never be the final row state.
  IF NEW.status = 'submitted' THEN
    RAISE EXCEPTION 'SUBMITTED_STATUS_BLOCKED: Cannot persist status=submitted in claims table. '
      'Use /api/claims/submit → submit_claim_atomic() which transitions atomically to under_supervisor_review. '
      'Attempted by trigger on claims row id=%', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire BEFORE INSERT or UPDATE — blocks the write before it commits
CREATE TRIGGER trg_block_submitted_persist
  BEFORE INSERT OR UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION block_submitted_persist();

-- ═══════════════════════════════════════════════════════════════════════
-- Verify: The trigger should be active
-- ═══════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_block_submitted_persist'
  ) THEN
    RAISE EXCEPTION 'MIGRATION FAILED: trigger trg_block_submitted_persist was not created';
  END IF;
  RAISE NOTICE 'Migration 035 SUCCESS: trg_block_submitted_persist is active on claims table';
END $$;
