-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 04 — MIGRATION
--  Source seq      : 004
--  Source migration: migrations/004_contract_templates_and_progress_models.sql
--  Purpose         : contract templates + boq_progress_model
--  Run order       : STEP 4 of 48 (after STEP 3, before STEP 5).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Contract Templates & Progress Models
--  File:    004_contract_templates_and_progress_models.sql
--
--  Run order: 4 of 4 (final migration)
--  Depends on: 001, 002, 003
--
--  Motivation:
--    Analysis of real contracts (231001101771 Beeah, 241039011332 Sharat)
--    revealed a schema gap and two behavioural requirements:
--
--    Gap: No table stores the per-contract BOQ and staff item definitions
--         that buildClaimTemplate() needs to construct the claim form.
--
--    Behavioural req 1: The BOQ progress model (count/percentage/monthly_lump_sum)
--         varies by contract and by item. The contract provides a default;
--         individual items may override it.
--
--    Behavioural req 2: Items 1 & 2 in contract 231001101771 were each
--         claimed twice (200% of unit_price) and approved without a formal CO.
--         The variation trigger must allow a director to explicitly override
--         the block with written justification — the "soft block" model.
--
--  Contents:
--    A. Column additions to contracts
--         1. contracts.boq_progress_model
--    B. Column additions to claim_boq_items
--         2. progress_model     (item-level override — already in 001)
--         3. contractual_qty    (already in 001)
--         4–6. variation_override_* (already in 001)
--    C. Column additions to change_order_boq_items
--         7. progress_model
--         8. contractual_qty    (already in 003)
--    D. New tables
--         9.  contract_boq_templates
--        10.  contract_staff_templates
--    E. updated_at triggers for new tables
--    F. Replace fn_block_approval_if_variation_unresolved()
--         — adds director override (variation_override_by IS NOT NULL) path
--    G. Indexes
--    H. RLS for new template tables
--
--  NOTE on idempotency:
--    Section B and C columns (progress_model, contractual_qty,
--    variation_override_*) are already defined in 001_base_schema.sql.
--    The ALTER TABLE ADD COLUMN IF NOT EXISTS statements here are
--    intentional safe no-ops — they document intent and allow this
--    file to run cleanly if the columns somehow don't exist.
--
--    Section C (change_order_boq_items columns) are already in 003.
--    Again, safe no-ops with IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. contracts.boq_progress_model
--
--  Contract-level default billing model for all base BOQ items.
--
--  Supported values and computation rules:
--
--    'count'
--      Input:   curr_progress = decimal completion count (0.66, 1, 2 …)
--      Formula: period_amount = curr_progress × unit_price
--      Overage: (prev + curr) > contractual_qty
--      Use:     Engineering report deliverables (contract 231001101771)
--               Construction items measured by count or linear metre
--
--    'percentage'
--      Input:   curr_progress = 0–100+ (percent of item scope this period)
--      Formula: period_amount = (curr_progress / 100) × unit_price
--      Overage: (prev + curr) > 100
--      Use:     Standard construction BOQ with percentage completion
--
--    'monthly_lump_sum'
--      Input:   curr_progress = months attended (0 or 1 typically)
--      Formula: period_amount = curr_progress × unit_price (monthly rate)
--      Overage: (prev + curr) > contractual_qty
--      Use:     VO-01 supervision lump sum (465,000 SAR/month × 24 months)
--
--  Item-level overrides in contract_boq_templates.progress_model and
--  claim_boq_items.progress_model take precedence when non-NULL.
--  Staff items always use 'days_prorated' — this column does not apply to them.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS boq_progress_model TEXT NOT NULL DEFAULT 'count'
    CONSTRAINT contracts_boq_progress_model_check
    CHECK (boq_progress_model IN ('count', 'percentage', 'monthly_lump_sum'));

COMMENT ON COLUMN contracts.boq_progress_model IS
  'Default progress model for all base BOQ items in this contract. '
  'count: period_amount = curr × unit_price; overage when (prev+curr) > contractual_qty. '
  'percentage: period_amount = (curr/100) × unit_price; overage when (prev+curr) > 100. '
  'monthly_lump_sum: period_amount = curr × unit_price; overage when (prev+curr) > contractual_qty. '
  'Item-level overrides (contract_boq_templates.progress_model) take precedence when non-NULL. '
  'Staff items always use days_prorated — this column does not apply to them.';


-- ─────────────────────────────────────────────────────────────────
--  B. claim_boq_items column additions (idempotent — already in 001)
--
--  These ALTER TABLE statements are safe no-ops when 001 has already
--  created the columns. Kept for completeness and to document intent.
-- ─────────────────────────────────────────────────────────────────

-- B2. Item-level progress model override (NULL = inherit contract default)
ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS progress_model TEXT
    CONSTRAINT claim_boq_items_progress_model_check
    CHECK (progress_model IN ('count', 'percentage', 'monthly_lump_sum'));

-- B3. Contracted quantity — overage threshold for requires_variation flag
ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS contractual_qty NUMERIC(10,4) NOT NULL DEFAULT 1;

-- B4–B6. Director override path for unresolved variations
--
--  A variation row is FULLY RESOLVED when EITHER:
--    (a) change_order_id → approved Change Order (formal CO path)
--    (b) variation_override_by IS NOT NULL       (director override path)
--
--  The director override is audited: the server action logs an audit_logs
--  entry with action='approve' and metadata.variation_override=true.
--  This provides full accountability without requiring a formal CO.
ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS variation_override_by    UUID REFERENCES profiles(id);
ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS variation_override_notes TEXT;
ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS variation_override_at    TIMESTAMPTZ;


-- ─────────────────────────────────────────────────────────────────
--  C. change_order_boq_items column additions (idempotent)
-- ─────────────────────────────────────────────────────────────────

-- C7. Progress model for CO BOQ items (NULL = inherit contract default)
--     Must be set explicitly when the CO adds items of a different type
--     than the contract default (e.g. supervision_lump in a count contract).
ALTER TABLE change_order_boq_items
  ADD COLUMN IF NOT EXISTS progress_model TEXT
    CONSTRAINT co_boq_items_pm_check
    CHECK (progress_model IN ('count', 'percentage', 'monthly_lump_sum'));

-- C8. Contractual quantity (already in 003 — idempotent)
ALTER TABLE change_order_boq_items
  ADD COLUMN IF NOT EXISTS contractual_qty NUMERIC(10,4) NOT NULL DEFAULT 1;


-- ─────────────────────────────────────────────────────────────────
--  D. NEW TABLES
-- ─────────────────────────────────────────────────────────────────

-- ── D9. contract_boq_templates ────────────────────────────────────
--
--  Master list of claimable BOQ deliverables per contract.
--  This is the source of truth for buildClaimTemplate() —
--  it queries this table to populate the BOQ rows of a new claim.
--
--  WRITE OWNERSHIP:
--    Internal users manage template rows at contract setup time.
--    External users have SELECT-only access to their contract's templates.
--    Scope changes after contract activation go through Change Orders.
--
--  SNAPSHOT MODEL:
--    Claim rows are point-in-time snapshots. Changes to templates after a
--    claim is drafted do NOT retroactively affect that claim.
--
--  progress_model NULL: inherit contract.boq_progress_model.
--  progress_model set:  use this model for this item regardless of contract default.

CREATE TABLE IF NOT EXISTS contract_boq_templates (
  id              UUID          NOT NULL DEFAULT uuid_generate_v4(),
  contract_id     UUID          NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  item_no         INTEGER       NOT NULL,
  description     TEXT          NOT NULL,
  description_ar  TEXT,

  unit            TEXT          NOT NULL DEFAULT 'عدد',
  unit_price      NUMERIC(15,2) NOT NULL DEFAULT 0,
  contractual_qty NUMERIC(10,4) NOT NULL DEFAULT 1,

  -- NULL = inherit contract.boq_progress_model
  progress_model  TEXT
    CONSTRAINT cbt_progress_model_check
    CHECK (progress_model IN ('count', 'percentage', 'monthly_lump_sum')),

  -- Display order in the claim form BOQ section
  sort_order      INTEGER       NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT contract_boq_templates_pkey            PRIMARY KEY (id),
  CONSTRAINT contract_boq_templates_contract_item   UNIQUE (contract_id, item_no)
);

COMMENT ON TABLE contract_boq_templates IS
  'Master BOQ item definitions per contract. '
  'Queried by loadContractBOQTemplate() to build new claim forms. '
  'Read-only for external users. Managed by admin/director at contract setup. '
  'Scope additions after contract activation go through Change Orders.';

COMMENT ON COLUMN contract_boq_templates.contractual_qty IS
  'Maximum claimable quantity. When (prev_progress + curr_progress) exceeds '
  'this value, requires_variation is set TRUE on the claim row. '
  'count/monthly_lump_sum: typical value is 1 (one report) or 24 (months). '
  'percentage: this column is not used (overage is always vs 100%).';

COMMENT ON COLUMN contract_boq_templates.progress_model IS
  'Item-level override. NULL = inherit contract.boq_progress_model. '
  'Set explicitly when this item uses a different billing model than the contract. '
  'Example: supervision lump sum item in a count-based contract → monthly_lump_sum.';


-- ── D10. contract_staff_templates ────────────────────────────────
--
--  Master list of contracted staff positions per contract.
--  Used by loadContractStaffTemplate() to build the staff section of a new claim.
--  All staff items use the days_prorated billing model — no progress_model needed.
--
--  Staff billing formulas (verified against contract 231001101771 real data):
--    basic_amount = (working_days / 30) × monthly_rate
--    extra_amount = (monthly_rate / 192) × 1.5 × overtime_hours
--    total_amount = basic_amount + extra_amount
--    after_perf   = total_amount × (performance_pct / 100)
--
--  Constants:
--    30   = billing days per calendar month
--    192  = billing hours per month (24 working days × 8 hours/day)
--    1.5  = KSA standard overtime multiplier

CREATE TABLE IF NOT EXISTS contract_staff_templates (
  id              UUID          NOT NULL DEFAULT uuid_generate_v4(),
  contract_id     UUID          NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  item_no         INTEGER       NOT NULL,
  position        TEXT          NOT NULL,
  position_ar     TEXT,
  monthly_rate    NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- CRITICAL: stored per row — do NOT inherit from contract header.
  -- Real data: most VO-01 positions = 24 months, منسق فني = 25 months.
  contract_months INTEGER       NOT NULL DEFAULT 24,

  sort_order      INTEGER       NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT contract_staff_templates_pkey           PRIMARY KEY (id),
  CONSTRAINT contract_staff_templates_contract_item  UNIQUE (contract_id, item_no)
);

COMMENT ON TABLE contract_staff_templates IS
  'Master staff position definitions per contract. '
  'Queried by loadContractStaffTemplate() to build the staff section of new claim forms. '
  'Staff always uses days_prorated billing — no progress_model column needed. '
  'Read-only for external users. Managed by admin/director at contract setup.';

COMMENT ON COLUMN contract_staff_templates.contract_months IS
  'Total contracted months for this position. '
  'Must be stored per row — different positions can have different durations. '
  'Verified real data: VO-01 positions mostly = 24 months, منسق فني = 25 months.';

COMMENT ON COLUMN contract_staff_templates.monthly_rate IS
  'Monthly rate in SAR. '
  'Used in: basic_amount = (working_days / 30) × monthly_rate, '
  'and: extra_amount = (monthly_rate / 192) × 1.5 × overtime_hours.';


-- ─────────────────────────────────────────────────────────────────
--  E. UPDATED_AT TRIGGERS FOR NEW TABLES
-- ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_contract_boq_templates_updated_at
  BEFORE UPDATE ON contract_boq_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contract_staff_templates_updated_at
  BEFORE UPDATE ON contract_staff_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─────────────────────────────────────────────────────────────────
--  F. REPLACE fn_block_approval_if_variation_unresolved()
--
--  CHANGES FROM MIGRATION 003:
--    The original function only checked the CO resolution path.
--    This version adds the director override path:
--
--    A BOQ row is UNRESOLVED when ALL of these are true:
--      1. requires_variation = TRUE
--      2. variation_override_by IS NULL     ← NEW condition
--      3. No linked approved Change Order
--
--    A BOQ row is RESOLVED when EITHER:
--      (a) linked CO has status = 'approved'
--      (b) variation_override_by IS NOT NULL  ← NEW path
--
--  The trigger trg_block_claim_approval already exists from migration 003.
--  CREATE OR REPLACE on the function updates it in-place — no trigger DDL needed.
--
--  Error format (unchanged):
--    CONVERA_VARIATION_UNRESOLVED:claim={uuid}:items={n,...}:count={n}
--    SQLSTATE P0001
--    Parsed by parseTriggerError() in claim-calculations.ts.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_block_approval_if_variation_unresolved()
RETURNS TRIGGER AS $$
DECLARE
  v_unresolved_count INTEGER;
  v_unresolved_items TEXT;
BEGIN
  -- Only enforce on the transition INTO 'approved'.
  -- Re-approving an already-approved claim does NOT re-trigger the check.
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN

    -- Count BOQ rows that are flagged and have NEITHER resolution path active.
    --
    -- UNRESOLVED when ALL of the following are true:
    --   1. requires_variation = TRUE
    --   2. variation_override_by IS NULL   (director override not applied)
    --   3. No linked approved Change Order
    SELECT COUNT(*)
    INTO   v_unresolved_count
    FROM   claim_boq_items boq
    WHERE  boq.claim_id              = NEW.id
      AND  boq.requires_variation    = TRUE
      AND  boq.variation_override_by IS NULL  -- director override path not used
      AND  (
             boq.change_order_id IS NULL
             OR (
               SELECT co.status FROM change_orders co
               WHERE  co.id = boq.change_order_id
             ) <> 'approved'
           );

    IF v_unresolved_count > 0 THEN

      -- Build comma-separated item numbers for the structured error.
      -- parseTriggerError() extracts these to populate the override modal UI.
      SELECT string_agg(boq.item_no::TEXT, ',' ORDER BY boq.item_no)
      INTO   v_unresolved_items
      FROM   claim_boq_items boq
      WHERE  boq.claim_id              = NEW.id
        AND  boq.requires_variation    = TRUE
        AND  boq.variation_override_by IS NULL
        AND  (
               boq.change_order_id IS NULL
               OR (
                 SELECT co.status FROM change_orders co
                 WHERE  co.id = boq.change_order_id
               ) <> 'approved'
             );

      -- Raise with structured message for parseTriggerError()
      RAISE EXCEPTION
        'CONVERA_VARIATION_UNRESOLVED:claim=%:items=%:count=%',
        NEW.id, v_unresolved_items, v_unresolved_count
        USING ERRCODE = 'P0001';

    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION fn_block_approval_if_variation_unresolved() IS
  'Guards claims.status transition to approved. '
  'Raises P0001 if any BOQ item has requires_variation=TRUE and is not resolved. '
  'Resolution paths: (a) linked approved Change Order, OR (b) director override. '
  'Migration 004 change: added variation_override_by IS NOT NULL check. '
  'Trigger trg_block_claim_approval on claims fires this function. '
  'Error format: CONVERA_VARIATION_UNRESOLVED:claim={uuid}:items={n,...}:count={n}.';


-- ─────────────────────────────────────────────────────────────────
--  G. INDEXES
-- ─────────────────────────────────────────────────────────────────

-- Template tables — primary access pattern is always by contract
CREATE INDEX IF NOT EXISTS idx_boq_tmpl_contract
  ON contract_boq_templates(contract_id, sort_order);

COMMENT ON INDEX idx_boq_tmpl_contract IS
  'Supports loadContractBOQTemplate(contractId). '
  'sort_order included for in-order retrieval without additional sort.';

CREATE INDEX IF NOT EXISTS idx_staff_tmpl_contract
  ON contract_staff_templates(contract_id, sort_order);

COMMENT ON INDEX idx_staff_tmpl_contract IS
  'Supports loadContractStaffTemplate(contractId). '
  'sort_order included for in-order retrieval.';

-- Partial index on non-NULL progress_model overrides in CO items
CREATE INDEX IF NOT EXISTS idx_co_boq_items_pm
  ON change_order_boq_items(progress_model)
  WHERE progress_model IS NOT NULL;

-- Partial index on non-NULL progress_model overrides in claim BOQ items
CREATE INDEX IF NOT EXISTS idx_claim_boq_progress_model
  ON claim_boq_items(progress_model)
  WHERE progress_model IS NOT NULL;

-- Variation override lookup — partial index for rows where override is set
CREATE INDEX IF NOT EXISTS idx_claim_boq_override
  ON claim_boq_items(claim_id, variation_override_by)
  WHERE variation_override_by IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────
--  H. RLS FOR TEMPLATE TABLES
--
--  Internal users: full access (manage templates at contract setup).
--  External users: SELECT only for their own contract's templates.
--    They query templates to populate the claim form — no write access.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE contract_boq_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_staff_templates ENABLE ROW LEVEL SECURITY;


-- H1. contract_boq_templates

CREATE POLICY "boq_tmpl_internal_all"
  ON contract_boq_templates FOR ALL
  USING (is_internal());

CREATE POLICY "boq_tmpl_external_select"
  ON contract_boq_templates FOR SELECT
  USING (
    contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );


-- H2. contract_staff_templates

CREATE POLICY "staff_tmpl_internal_all"
  ON contract_staff_templates FOR ALL
  USING (is_internal());

CREATE POLICY "staff_tmpl_external_select"
  ON contract_staff_templates FOR SELECT
  USING (
    contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  END OF MIGRATION 004
--
--  Schema is now complete. Next step: run seed files.
--  Seed order:
--    001_seed.sql         — users (must create auth.users first via Supabase Auth)
--    002_seed_<contract>  — per-contract BOQ and staff templates
-- ─────────────────────────────────────────────────────────────────
