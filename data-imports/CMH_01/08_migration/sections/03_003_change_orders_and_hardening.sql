-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 03 — MIGRATION
--  Source seq      : 003
--  Source migration: migrations/003_change_orders_and_hardening.sql
--  Purpose         : change_orders family
--  Run order       : STEP 3 of 48 (after STEP 2, before STEP 4).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Change Orders & Hardening
--  File:    003_change_orders_and_hardening.sql
--
--  Run order: 3 of 4 (bootstrap sequence)
--  Depends on: 001_base_schema.sql, 002_step0_fixes.sql
--
--  Contents:
--    A. New ENUM: change_order_status
--    B. New tables
--         1. change_orders
--         2. change_order_boq_items
--         3. change_order_staff_items
--         4. change_order_workflow
--    C. Notification type extensions (change order events)
--    D. Variation approval blocker trigger
--         fn_block_approval_if_variation_unresolved()
--         trg_block_claim_approval ON claims
--    E. Indexes
--    F. RLS — change order tables (4 tables × per-operation policies)
--
--  Architecture notes:
--
--  change_orders are contract-level records — they are NOT attached to
--  individual claims. Once a CO reaches status='approved', its items
--  are merged into the claim template for ALL future claims whose
--  period_from >= co.effective_from. This merging happens in the
--  buildClaimTemplate() server utility (claim-template.ts).
--
--  Bootstrap note:
--    claim_boq_items.change_order_id and claim_staff_items.change_order_id
--    could not be defined in 001 (FK to change_orders which didn't exist yet).
--    Section B below adds these FK columns via ALTER TABLE ADD COLUMN IF NOT EXISTS
--    immediately after change_orders is created, then updates the RLS policies
--    on those tables to add the change_order_id IS NULL write guard.
--
--  claim_boq_items.change_order_id and claim_staff_items.change_order_id
--  are SYSTEM-DERIVED: set by the server action from the template,
--  never by user form input. Three layers enforce this:
--    1. UI: no form input for change_order_id
--    2. Server action: strips change_order_id from user-submitted data
--    3. RLS: external INSERT/UPDATE policies (updated in Section B below)
--
--  The variation trigger added here (fn_block_approval_if_variation_unresolved)
--  is replaced in migration 004 to add the director override path.
--  The trigger itself (trg_block_claim_approval) is NOT re-created in 004 —
--  CREATE OR REPLACE on the function updates it in-place.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. ENUM: change_order_status
-- ─────────────────────────────────────────────────────────────────

CREATE TYPE change_order_status AS ENUM (
  'draft',
  'submitted',
  'under_admin_review',
  'pending_director_approval',
  'approved',       -- terminal: CO is in force
  'rejected'        -- terminal: CO is cancelled
);

COMMENT ON TYPE change_order_status IS
  'Five-stage workflow for Change Orders. '
  'approved is terminal — approved COs are permanent contract records. '
  'Transitions: draft→submitted→under_admin_review→pending_director_approval→approved|rejected.';


-- ─────────────────────────────────────────────────────────────────
--  B. NEW TABLES
-- ─────────────────────────────────────────────────────────────────

-- ── B1. change_orders ─────────────────────────────────────────────

CREATE TABLE change_orders (
  id               UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id      UUID                NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  co_no            TEXT                NOT NULL,     -- e.g. 'VO-01', 'VO-02'
  title            TEXT                NOT NULL,
  title_ar         TEXT                NOT NULL,
  description      TEXT,

  -- Scope classification
  scope_type       TEXT                NOT NULL DEFAULT 'combined'
    CONSTRAINT co_scope_type_check
    CHECK (scope_type IN (
      'boq_addition',       -- adds new deliverable BOQ items
      'staff_addition',     -- adds new staff positions
      'price_adjustment',   -- modifies unit prices of existing items
      'duration_extension', -- extends contract duration
      'scope_reduction',    -- reduces or removes scope
      'combined'            -- multiple change types
    )),

  status           change_order_status NOT NULL DEFAULT 'draft',

  -- Financial impact
  value_added      NUMERIC(15,2)       NOT NULL DEFAULT 0,    -- new scope added (positive)
  value_deducted   NUMERIC(15,2)       NOT NULL DEFAULT 0,    -- scope removed (stored positive)
  net_value_change NUMERIC(15,2)       GENERATED ALWAYS AS (value_added - value_deducted) STORED,
  duration_change  INTEGER             DEFAULT 0,             -- months: positive=extension

  -- Effective date: first claim period this CO's items apply to
  effective_from   DATE,

  -- People
  submitted_by     UUID                REFERENCES profiles(id),
  reviewed_by      UUID                REFERENCES profiles(id),
  approved_by      UUID                REFERENCES profiles(id),

  -- Notes
  rejection_reason TEXT,
  review_notes     TEXT,
  return_reason    TEXT,

  -- Timestamps
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  created_by       UUID                NOT NULL REFERENCES profiles(id),
  updated_by       UUID                REFERENCES profiles(id),
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

  CONSTRAINT change_orders_contract_co_no_unique UNIQUE (contract_id, co_no)
);

COMMENT ON TABLE change_orders IS
  'Formal contract scope modifications. Linked to contracts, not individual claims. '
  'Once approved, CO items appear in all claim templates with period_from >= effective_from. '
  'Items defined in change_order_boq_items and change_order_staff_items.';


-- ── B2. change_order_boq_items ────────────────────────────────────

CREATE TABLE change_order_boq_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  change_order_id UUID          NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  item_no         INTEGER       NOT NULL,
  description     TEXT          NOT NULL,
  description_ar  TEXT,
  unit            TEXT          NOT NULL DEFAULT 'عدد',
  unit_price      NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Quantity and progress model: carried into claim_boq_items at template build time
  contractual_qty NUMERIC(10,4) NOT NULL DEFAULT 1,
  progress_model  TEXT
    CONSTRAINT co_boq_pm_check
    CHECK (progress_model IN ('count', 'percentage', 'monthly_lump_sum')),
    -- NULL = inherit from parent contract.boq_progress_model

  -- Total contractual value of this CO item (display/reporting only)
  total_value     NUMERIC(15,2) GENERATED ALWAYS AS (unit_price * contractual_qty) STORED,

  -- Functional classification
  item_type       TEXT          NOT NULL DEFAULT 'report'
    CONSTRAINT co_boq_item_type_check
    CHECK (item_type IN ('report', 'supervision_lump', 'other')),

  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT co_boq_items_co_item_unique UNIQUE (change_order_id, item_no)
);

COMMENT ON TABLE change_order_boq_items IS
  'BOQ line items introduced by a Change Order. '
  'Merged into claim BOQ templates by mergeCOBOQItems() for claims '
  'with period_from >= co.effective_from. '
  'progress_model: NULL inherits contract default; set explicitly for '
  'items of a different type (e.g. supervision_lump in a count-based contract).';

COMMENT ON COLUMN change_order_boq_items.contractual_qty IS
  'Maximum claimable quantity for this CO BOQ item. '
  'Determines when requires_variation is triggered. '
  'count: 1 for a single-delivery report. '
  'monthly_lump_sum: total contracted months (e.g. 24 for VO-01 supervision).';


-- ── B3. change_order_staff_items ──────────────────────────────────

CREATE TABLE change_order_staff_items (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  change_order_id UUID          NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  item_no         INTEGER       NOT NULL,
  position        TEXT          NOT NULL,
  position_ar     TEXT,
  monthly_rate    NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- contract_months: MUST be stored per row — different positions have different durations.
  -- Real data: VO-01 positions mostly 24 months, منسق فني = 25 months.
  contract_months INTEGER       NOT NULL DEFAULT 24,

  total_value     NUMERIC(15,2) GENERATED ALWAYS AS (monthly_rate * contract_months) STORED,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT co_staff_items_co_item_unique UNIQUE (change_order_id, item_no)
);

COMMENT ON TABLE change_order_staff_items IS
  'Staff positions added by a Change Order. '
  'contract_months stored per row — never inherited from contract header. '
  'Real data: most VO-01 positions = 24 months, منسق فني = 25 months. '
  'Merged into claim staff templates by mergeCOStaffItems().';


-- ── B4. change_order_workflow ─────────────────────────────────────

CREATE TABLE change_order_workflow (
  id              UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  change_order_id UUID                NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  action          TEXT                NOT NULL
    CONSTRAINT co_workflow_action_check
    CHECK (action IN (
      'submit',        -- CO submitted for review
      'admin_review',  -- admin/director begins review
      'co_return',     -- returned to draft (admin or director)
      'forward',       -- forwarded to pending_director_approval
      'approve',       -- director final approval
      'reject',        -- director final rejection
      'comment'        -- informational note, no status change
    )),
  from_status     change_order_status,
  to_status       change_order_status,
  actor_id        UUID                NOT NULL REFERENCES profiles(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE change_order_workflow IS
  'Immutable audit trail of Change Order state transitions. '
  'Shape mirrors claim_workflow for component reuse on the CO detail page.';




-- ─────────────────────────────────────────────────────────────────
--  B. DEFERRED FK COLUMNS  (could not be in 001 — change_orders didn't exist)
--
--  Now that change_orders exists, add change_order_id to the two claim
--  line item tables and update their external RLS write policies to
--  enforce change_order_id IS NULL (system-derived only).
--
--  All operations use IF NOT EXISTS / IF EXISTS for idempotency.
-- ─────────────────────────────────────────────────────────────────

-- B1. claim_boq_items.change_order_id
--
--  NULL  = base contract item
--  non-NULL = item introduced by the referenced Change Order
--
--  SET NULL on CO delete preserves the claim row (requires_variation
--  will still flag it). The server action never sets this from user input.

ALTER TABLE claim_boq_items
  ADD COLUMN IF NOT EXISTS change_order_id UUID
    REFERENCES change_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN claim_boq_items.change_order_id IS
  'System-derived FK. NULL = base contract item. '
  'Set by server action from template, never by user input. '
  'RLS below enforces change_order_id IS NULL on external INSERT/UPDATE.';


-- B2. claim_staff_items.change_order_id (same semantics)

ALTER TABLE claim_staff_items
  ADD COLUMN IF NOT EXISTS change_order_id UUID
    REFERENCES change_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN claim_staff_items.change_order_id IS
  'System-derived FK. NULL = base contract staff position. '
  'Set by server action from template, never by user input.';


-- B3. Partial indexes on the new FK columns

CREATE INDEX IF NOT EXISTS idx_claim_boq_co_id
  ON claim_boq_items(change_order_id)
  WHERE change_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claim_staff_co_id
  ON claim_staff_items(change_order_id)
  WHERE change_order_id IS NOT NULL;


-- B4. Update RLS: add change_order_id IS NULL guard to external write policies
--
--  The policies created in 001 did not have this guard (column didn't exist).
--  Drop and recreate them with the full guard now that the column exists.

-- claim_boq_items insert — add change_order_id IS NULL guard
DROP POLICY IF EXISTS "claim_boq_external_insert" ON claim_boq_items;
CREATE POLICY "claim_boq_external_insert"
  ON claim_boq_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
    AND change_order_id IS NULL   -- system-derived only; external cannot set this
  );

-- claim_boq_items update — add change_order_id IS NULL guard to WITH CHECK
DROP POLICY IF EXISTS "claim_boq_external_update" ON claim_boq_items;
CREATE POLICY "claim_boq_external_update"
  ON claim_boq_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  )
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
    AND change_order_id IS NULL
  );

-- claim_staff_items insert
DROP POLICY IF EXISTS "claim_staff_external_insert" ON claim_staff_items;
CREATE POLICY "claim_staff_external_insert"
  ON claim_staff_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
    AND change_order_id IS NULL
  );

-- claim_staff_items update
DROP POLICY IF EXISTS "claim_staff_external_update" ON claim_staff_items;
CREATE POLICY "claim_staff_external_update"
  ON claim_staff_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  )
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
    AND change_order_id IS NULL
  );

-- ─────────────────────────────────────────────────────────────────
--  C. NOTIFICATION TYPE EXTENSIONS
--
--  ADD VALUE must run outside a transaction if the type is already in use.
--  IF NOT EXISTS (PostgreSQL 9.6+) makes this idempotent.
-- ─────────────────────────────────────────────────────────────────

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'change_order_submitted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'change_order_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'change_order_required';


-- ─────────────────────────────────────────────────────────────────
--  D. TRIGGERS
-- ─────────────────────────────────────────────────────────────────

-- D1. updated_at on change_orders
CREATE TRIGGER trg_change_orders_updated_at
  BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- D2. Variation approval blocker
--
--  RULE:
--    A claim CANNOT transition to status='approved' if any of its BOQ items have:
--      requires_variation = TRUE
--      AND (change_order_id IS NULL OR linked CO is not yet 'approved')
--
--  ENFORCEMENT LAYERS:
--    Layer 1 (UX): approveClaimAction() server action runs a pre-flight query
--                  and returns a typed VARIATION_UNRESOLVED error before the
--                  DB write, giving the UI rich data for the override modal.
--    Layer 2 (DB): This trigger fires on EVERY claims UPDATE, regardless of
--                  client, API route, or script. It is the authoritative guard.
--
--  TRIGGER FIRES WHEN:
--    NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
--    (Only on the transition TO approved — not on every update)
--
--  ERROR FORMAT (SQLSTATE P0001):
--    CONVERA_VARIATION_UNRESOLVED:claim={uuid}:items={n,...}:count={n}
--    Parsed by parseTriggerError() in claim-calculations.ts.
--
--  NOTE: This function is REPLACED in migration 004 to add the director
--  override path (variation_override_by IS NOT NULL).
--  The trigger DDL itself is NOT recreated in 004 — CREATE OR REPLACE
--  on the function updates it in-place.

CREATE OR REPLACE FUNCTION fn_block_approval_if_variation_unresolved()
RETURNS TRIGGER AS $$
DECLARE
  v_unresolved_count INTEGER;
  v_unresolved_items TEXT;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN

    SELECT COUNT(*)
    INTO   v_unresolved_count
    FROM   claim_boq_items boq
    WHERE  boq.claim_id          = NEW.id
      AND  boq.requires_variation = TRUE
      AND  (
             boq.change_order_id IS NULL
             OR (
               SELECT co.status FROM change_orders co
               WHERE  co.id = boq.change_order_id
             ) <> 'approved'
           );

    IF v_unresolved_count > 0 THEN

      SELECT string_agg(boq.item_no::TEXT, ',' ORDER BY boq.item_no)
      INTO   v_unresolved_items
      FROM   claim_boq_items boq
      WHERE  boq.claim_id          = NEW.id
        AND  boq.requires_variation = TRUE
        AND  (
               boq.change_order_id IS NULL
               OR (
                 SELECT co.status FROM change_orders co
                 WHERE  co.id = boq.change_order_id
               ) <> 'approved'
             );

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
  'Blocks claims.status transition to approved when any BOQ item has '
  'requires_variation=TRUE without a linked approved Change Order. '
  'REPLACED in migration 004 to also honour director override '
  '(variation_override_by IS NOT NULL). '
  'Error: CONVERA_VARIATION_UNRESOLVED:claim={uuid}:items={n,...}:count={n}. '
  'SQLSTATE P0001.';

CREATE TRIGGER trg_block_claim_approval
  BEFORE UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION fn_block_approval_if_variation_unresolved();

COMMENT ON TRIGGER trg_block_claim_approval ON claims IS
  'DB-level enforcement of the variation approval rule. '
  'Cannot be bypassed via direct DB writes. '
  'Complements the Layer 1 pre-flight check in approveClaimAction() server action. '
  'The trigger function is updated in-place by migration 004.';


-- ─────────────────────────────────────────────────────────────────
--  E. INDEXES
-- ─────────────────────────────────────────────────────────────────

-- change_orders
CREATE INDEX IF NOT EXISTS idx_change_orders_contract   ON change_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_status     ON change_orders(status);
CREATE INDEX IF NOT EXISTS idx_change_orders_effective  ON change_orders(effective_from)
  WHERE status = 'approved';   -- partial: only approved COs queried by effective_from

-- Change order line items
CREATE INDEX IF NOT EXISTS idx_co_boq_items_co          ON change_order_boq_items(change_order_id);
CREATE INDEX IF NOT EXISTS idx_co_staff_items_co        ON change_order_staff_items(change_order_id);
CREATE INDEX IF NOT EXISTS idx_co_boq_progress_model    ON change_order_boq_items(progress_model)
  WHERE progress_model IS NOT NULL;

-- Change order workflow
CREATE INDEX IF NOT EXISTS idx_co_workflow_co           ON change_order_workflow(change_order_id);
CREATE INDEX IF NOT EXISTS idx_co_workflow_created      ON change_order_workflow(created_at DESC);


-- ─────────────────────────────────────────────────────────────────
--  F. RLS — CHANGE ORDER TABLES
--
--  Pattern:
--    Internal users (director/admin/reviewer): FOR ALL USING (is_internal())
--    External users: explicit per-operation policies.
--
--  Status transition note:
--    Status changes (draft→submitted, etc.) are performed by server actions
--    using the service role client, bypassing RLS.
--    External client policies therefore only need to cover DRAFT operations.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE change_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_boq_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_staff_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_workflow    ENABLE ROW LEVEL SECURITY;


-- F1. change_orders

CREATE POLICY "co_internal_all"
  ON change_orders FOR ALL
  USING (is_internal());

CREATE POLICY "co_external_select"
  ON change_orders FOR SELECT
  USING (
    contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );

CREATE POLICY "co_external_insert"
  ON change_orders FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'draft'
    AND contract_id IN (
      SELECT id FROM contracts
      WHERE  external_user_id = auth.uid()
        AND  status = 'active'
    )
  );

-- External users may only edit draft COs they created/submitted.
-- WITH CHECK restricts write-back to draft status only (prevents self-escalation).
CREATE POLICY "co_external_update_draft"
  ON change_orders FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
  );


-- F2. change_order_boq_items

CREATE POLICY "co_boq_internal_all"
  ON change_order_boq_items FOR ALL
  USING (is_internal());

CREATE POLICY "co_boq_external_select"
  ON change_order_boq_items FOR SELECT
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

CREATE POLICY "co_boq_external_insert"
  ON change_order_boq_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );

CREATE POLICY "co_boq_external_update"
  ON change_order_boq_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  )
  WITH CHECK (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );

CREATE POLICY "co_boq_external_delete"
  ON change_order_boq_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );


-- F3. change_order_staff_items  (same structure as BOQ items)

CREATE POLICY "co_staff_internal_all"
  ON change_order_staff_items FOR ALL
  USING (is_internal());

CREATE POLICY "co_staff_external_select"
  ON change_order_staff_items FOR SELECT
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

CREATE POLICY "co_staff_external_insert"
  ON change_order_staff_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );

CREATE POLICY "co_staff_external_update"
  ON change_order_staff_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  )
  WITH CHECK (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );

CREATE POLICY "co_staff_external_delete"
  ON change_order_staff_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
        AND co.status = 'draft'
    )
  );


-- F4. change_order_workflow

CREATE POLICY "co_workflow_internal_all"
  ON change_order_workflow FOR ALL
  USING (is_internal());

CREATE POLICY "co_workflow_external_select"
  ON change_order_workflow FOR SELECT
  USING (
    change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

-- External users may only log submit and comment actions.
-- Internal review/forward/approve/reject entries are written via service role.
CREATE POLICY "co_workflow_external_insert"
  ON change_order_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND action IN ('submit', 'comment')
    AND change_order_id IN (
      SELECT co.id FROM change_orders co
      JOIN contracts ct ON co.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );
