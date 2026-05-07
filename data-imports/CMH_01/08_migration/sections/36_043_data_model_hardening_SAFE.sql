-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 36 — MIGRATION
--  Source seq      : 043
--  Source migration: migrations/043_data_model_hardening_SAFE.sql
--  Purpose         : D2 hardening SAFE variant
--  Run order       : STEP 36 of 48 (after STEP 35, before STEP 37).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- Migration 043_SAFE: Data Model Hardening (production-verified)
-- Date: 2026-04-27
-- Scope: Only operations verified against actual production schema
--
-- DEFERRED to future migration (require RPC coordination):
--   - documents.change_order_id cascade (column missing on prod)
--   - contract_scoped_roles index (table missing — uses contract_approvers)
--   - enforce_status_via_workflow trigger (may break submit_claim_atomic)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── F3: Compound indexes (verified tables) ───────────────────────

CREATE INDEX IF NOT EXISTS idx_boq_discipline
  ON contract_boq_templates(contract_id, description);

CREATE INDEX IF NOT EXISTS idx_workflow_claim_time
  ON claim_workflow(claim_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_status_time
  ON claim_workflow(to_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_record_time
  ON audit_logs(table_name, record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claims_status_transition
  ON claims(status, last_transition_at);

-- ─── F2: Unique constraint to prevent duplicate contractor refs ──

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_contract_ref_unique;
ALTER TABLE claims
  ADD CONSTRAINT claims_contract_ref_unique
  UNIQUE (contract_id, reference_no);

COMMIT;

-- Verification:
SELECT 'Migration 043_SAFE applied' AS status,
       COUNT(*) FILTER (WHERE indexname LIKE 'idx_%') AS new_indexes,
       COUNT(*) FILTER (WHERE indexname LIKE '%_unique') AS new_unique
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_boq_discipline', 'idx_workflow_claim_time', 'idx_workflow_status_time',
    'idx_audit_record_time', 'idx_claims_status_transition',
    'claims_contract_ref_unique'
  );
