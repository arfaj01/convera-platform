-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 06 — MIGRATION
--  Source seq      : 007
--  Source migration: migrations/007_contract_amendments_enhancement.sql
--  Purpose         : amendments enhancement
--  Run order       : STEP 6 of 48 (after STEP 5, before STEP 7).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 007: Contract Amendments Enhancement
--
--  Purpose: Activate the contract_amendments table (created in 001)
--  with additional columns, replace the claim limit trigger with
--  amendment-aware two-tier ceiling logic, and add RLS policies.
--
--  Business Rules:
--    1. A contract may have multiple amendments (+/- value_change)
--    2. No amendments: allowed_max = base_value × 1.10 (provisional)
--    3. With amendments: allowed_max = base_value + SUM(approved.value_change)
--       — NO additional 10% on top of amended ceiling
--    4. Draft claims skip validation; enforcement at submit/approve only
--    5. Net amendment effect (Option A): SUM includes both + and - changes
--
--  Run order: 7 (after 006)
--  Safe to run multiple times (all operations are idempotent)
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. ENHANCE contract_amendments TABLE
-- ─────────────────────────────────────────────────────────────────

-- Add columns for document attachment and workflow
ALTER TABLE contract_amendments
  ADD COLUMN IF NOT EXISTS document_path TEXT,
  ADD COLUMN IF NOT EXISTS document_name TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

-- Unique constraint: one amendment_no per contract
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_amendment_contract_no'
  ) THEN
    ALTER TABLE contract_amendments
      ADD CONSTRAINT uq_amendment_contract_no UNIQUE (contract_id, amendment_no);
  END IF;
END $$;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_amendments_contract
  ON contract_amendments(contract_id);

CREATE INDEX IF NOT EXISTS idx_amendments_status
  ON contract_amendments(contract_id, status);


-- ─────────────────────────────────────────────────────────────────
--  B. REPLACE CLAIM LIMIT TRIGGER — Two-Tier Ceiling Logic
-- ─────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS check_claim_within_contract_limit() CASCADE;

CREATE OR REPLACE FUNCTION check_claim_within_contract_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_base            NUMERIC;
  v_amendment_count INTEGER;
  v_amendments_net  NUMERIC;
  v_ceiling         NUMERIC;
  v_others          NUMERIC;
  v_new_gross       NUMERIC;
BEGIN
  -- ── Draft claims always pass (no financial check) ──
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- ── Get contract base_value ──
  SELECT base_value INTO v_base
  FROM contracts
  WHERE id = NEW.contract_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'العقد غير موجود';
  END IF;

  -- ── Count and sum approved amendments ──
  SELECT COUNT(*), COALESCE(SUM(value_change), 0)
  INTO v_amendment_count, v_amendments_net
  FROM contract_amendments
  WHERE contract_id = NEW.contract_id
    AND status = 'approved';

  -- ── Two-tier ceiling calculation ──
  IF v_amendment_count > 0 THEN
    -- Tier 2: Amendments exist → exact amended ceiling, NO extra 10%
    v_ceiling := v_base + v_amendments_net;
  ELSE
    -- Tier 1: No amendments → provisional 10% tolerance
    v_ceiling := v_base * 1.10;
  END IF;

  -- ── Cumulative spend (excluding rejected and draft) ──
  SELECT COALESCE(SUM(boq_amount + staff_amount), 0)
  INTO v_others
  FROM claims
  WHERE contract_id = NEW.contract_id
    AND id != NEW.id
    AND status NOT IN ('rejected', 'draft');

  v_new_gross := COALESCE(NEW.boq_amount, 0) + COALESCE(NEW.staff_amount, 0);

  -- ── Enforce ceiling ──
  IF (v_others + v_new_gross) > v_ceiling THEN
    RAISE EXCEPTION
      'المبلغ الإجمالي للمستخلصات (% ريال) يتجاوز سقف العقد (% ريال)',
      ROUND(v_others + v_new_gross, 2),
      ROUND(v_ceiling, 2);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_check_claim_limit ON claims;
CREATE TRIGGER trg_check_claim_limit
  BEFORE INSERT OR UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION check_claim_within_contract_limit();

COMMENT ON FUNCTION check_claim_within_contract_limit() IS
  'Two-tier claim ceiling: without amendments = base_value × 1.10; '
  'with approved amendments = base_value + SUM(amendments). '
  'Drafts are always allowed. Enforced at submit/approve.';


-- ─────────────────────────────────────────────────────────────────
--  C. RLS POLICIES FOR contract_amendments
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE contract_amendments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "amendments_select_internal" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_select_external" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_insert_admin" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_update_director" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_select_all" ON contract_amendments;

-- For prototype: allow all authenticated users to read
-- (matches 005_rls_prototype_access.sql pattern)
CREATE POLICY "amendments_select_all"
  ON contract_amendments FOR SELECT
  TO authenticated
  USING (true);

-- Admin can create amendments
CREATE POLICY "amendments_insert_admin"
  ON contract_amendments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'director')
    )
  );

-- Director can update (approve/reject)
CREATE POLICY "amendments_update_director"
  ON contract_amendments FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'director'
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  D. HELPER VIEW — Contract ceiling summary
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW contract_ceiling_summary AS
SELECT
  c.id AS contract_id,
  c.contract_no,
  c.base_value,
  COALESCE(a.amendment_count, 0)   AS amendment_count,
  COALESCE(a.amendments_total, 0)  AS amendments_total,
  CASE
    WHEN COALESCE(a.amendment_count, 0) > 0
    THEN c.base_value + COALESCE(a.amendments_total, 0)
    ELSE c.base_value * 1.10
  END AS ceiling,
  COALESCE(a.amendment_count, 0) > 0 AS has_amendments,
  COALESCE(cl.total_spent, 0)      AS total_spent,
  CASE
    WHEN COALESCE(a.amendment_count, 0) > 0
    THEN c.base_value + COALESCE(a.amendments_total, 0) - COALESCE(cl.total_spent, 0)
    ELSE c.base_value * 1.10 - COALESCE(cl.total_spent, 0)
  END AS remaining
FROM contracts c
LEFT JOIN (
  SELECT
    contract_id,
    COUNT(*)         AS amendment_count,
    SUM(value_change) AS amendments_total
  FROM contract_amendments
  WHERE status = 'approved'
  GROUP BY contract_id
) a ON a.contract_id = c.id
LEFT JOIN (
  SELECT
    contract_id,
    SUM(boq_amount + staff_amount) AS total_spent
  FROM claims
  WHERE status NOT IN ('rejected', 'draft')
  GROUP BY contract_id
) cl ON cl.contract_id = c.id;


-- ─────────────────────────────────────────────────────────────────
--  E. VERIFICATION
-- ─────────────────────────────────────────────────────────────────

-- 1. Verify trigger exists
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'claims'
  AND trigger_name = 'trg_check_claim_limit';

-- 2. Verify new columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'contract_amendments'
  AND column_name IN ('document_path', 'document_name', 'rejection_reason', 'submitted_by', 'submitted_at')
ORDER BY column_name;

-- 3. Verify ceiling view
SELECT * FROM contract_ceiling_summary;
