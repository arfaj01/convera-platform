-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 01 — MIGRATION
--  Source seq      : 001
--  Source migration: migrations/001_base_schema.sql
--  Purpose         : foundational base schema
--  Run order       : STEP 1 of 48 (after STEP 00 (preflight), before STEP 2).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Base Schema (Bootstrap Safe)
--  File:    001_base_schema.sql
--  Project: Contract Oversight & Governance Platform
--  Client:  وزارة البلديات والإسكان — إدارة التطوير والتأهيل
--
--  Run order: 1 of 5  (after 000_reset if rebuilding)
--  Depends on: Supabase Auth (auth.users must exist)
--
--  Contents:
--    A. Extensions
--    B. ENUM types (7 types)
--    C. Core tables
--         1.  profiles          — extends auth.users
--         2.  contracts         — contract master records
--         3.  contract_amendments — formal amendments (pre-CO model)
--         4.  claims            — financial claims (المستخلصات)
--         5.  claim_boq_items   — BOQ line items per claim
--         6.  claim_staff_items — staff/manpower line items per claim
--         7.  claim_workflow    — full audit trail of workflow transitions
--         8.  documents         — uploaded files (Supabase Storage references)
--         9.  audit_logs        — system-wide immutable audit log
--        10.  notifications     — per-user notification inbox
--        11.  kpi_snapshots     — periodic financial KPI snapshots
--    D. Indexes
--    E. Functions & Triggers
--    F. Row Level Security (RLS) — all tables
--    G. Views (claims_full, contracts_summary)
--
--  Bootstrap notes:
--    This file is safe to run on a brand new empty Supabase project.
--    change_order_id FK columns on claim_boq_items and claim_staff_items
--    are intentionally deferred to 003 because they reference change_orders,
--    which is created in migration 003. The RLS guards for those columns
--    are also added in 003.
--
--  Design notes:
--    • claim_boq_items.prev_progress and curr_progress use NUMERIC(10,4)
--      to support the 'count' progress model where values may be decimal
--      (e.g. 0.6667 for partial completion) or exceed 1.
--    • contracts.vat_value and total_value are GENERATED columns (15% VAT).
--    • claims.gross_amount, net_amount, total_amount are GENERATED columns.
--    • retention_pct default is 5.00 — the standard KSA government rate.
--    • No seed data. Run 002–004 migrations before inserting any records.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. EXTENSIONS
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ─────────────────────────────────────────────────────────────────
--  B. ENUM TYPES
-- ─────────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM (
  'director',     -- مدير الإدارة — full access, final approval authority
  'admin',        -- مدقق / مسؤول — review, manage, forward to director
  'reviewer',     -- مراجع — can review claims and return with notes
  'consultant',   -- استشاري (external) — submit & track own claims
  'contractor'    -- مقاول (external) — submit & track own claims
);

CREATE TYPE contract_status AS ENUM (
  'draft',
  'active',
  'suspended',
  'completed',
  'closed'
);

CREATE TYPE contract_type AS ENUM (
  'design',               -- دراسات وتصاميم
  'supervision',          -- إشراف هندسي
  'design_supervision',   -- دراسات وتصاميم وإشراف
  'construction',         -- تنفيذ
  'consultancy',          -- استشارات
  'maintenance'           -- صيانة
);

-- Full 10-state claim lifecycle.
-- Transitions are enforced by the WorkflowActions component and server actions.
-- The variation trigger (migration 003) adds a DB-level guard on the
-- draft→approved and submitted→approved paths.
CREATE TYPE claim_status AS ENUM (
  'draft',
  'submitted',
  'under_consultant_review',
  'returned_by_consultant',
  'under_admin_review',
  'returned_by_admin',
  'pending_director_approval',
  'approved',
  'rejected',
  'closed'
);

CREATE TYPE document_type AS ENUM (
  'contract',
  'claim',
  'invoice',
  'approval',
  'report',
  'other'
);

CREATE TYPE audit_action AS ENUM (
  'create', 'update', 'delete',
  'submit', 'review', 'approve', 'reject', 'return', 'close',
  'login', 'logout', 'upload', 'download'
);

CREATE TYPE notification_type AS ENUM (
  'claim_submitted',
  'claim_reviewed',
  'claim_approved',
  'claim_rejected',
  'claim_returned',
  'contract_updated',
  'user_assigned',
  'document_uploaded',
  'system'
  -- change_order notification values added in migration 003
);


-- ─────────────────────────────────────────────────────────────────
--  C. TABLES
-- ─────────────────────────────────────────────────────────────────

-- ── C1. profiles ──────────────────────────────────────────────────
-- Extends Supabase Auth users. Created automatically via trigger on
-- auth.users INSERT. All application queries join through this table.

CREATE TABLE profiles (
  id              UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT         NOT NULL UNIQUE,
  full_name       TEXT         NOT NULL,
  full_name_ar    TEXT,
  role            user_role    NOT NULL DEFAULT 'contractor',
  phone           TEXT,
  phone_masked    TEXT,                      -- e.g. +966 *** *** 602
  organization    TEXT,
  job_title       TEXT,
  avatar_url      TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  is_verified     BOOLEAN      NOT NULL DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE profiles IS
  'Application user profiles. One row per auth.users row. '
  'Created automatically by the on_auth_user_created trigger. '
  'All role-based access control derives from the role column.';


-- ── C2. contracts ─────────────────────────────────────────────────

CREATE TABLE contracts (
  id               UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_no      TEXT            NOT NULL UNIQUE,  -- e.g. 231001101771
  title            TEXT            NOT NULL,
  title_ar         TEXT            NOT NULL,
  type             contract_type   NOT NULL,
  status           contract_status NOT NULL DEFAULT 'draft',

  -- Parties
  party_name       TEXT            NOT NULL,          -- contractor/consultant EN name
  party_name_ar    TEXT,                              -- contractor/consultant AR name
  party_tax_no     TEXT,                              -- رقم التعريف الضريبي

  -- Financials
  -- base_value: contract value before VAT (القيمة الأساسية)
  -- vat_value / total_value: GENERATED at 15% KSA VAT
  base_value       NUMERIC(15,2)   NOT NULL DEFAULT 0,
  vat_value        NUMERIC(15,2)   GENERATED ALWAYS AS (ROUND(base_value * 0.15, 2)) STORED,
  total_value      NUMERIC(15,2)   GENERATED ALWAYS AS (ROUND(base_value * 1.15, 2)) STORED,

  -- حجز الختامي — standard KSA rate is 5%
  -- Some contracts (e.g. 241039011332) have 0% retention applied to claims
  -- even though the performance bond guarantee is 5%.
  retention_pct    NUMERIC(5,2)    NOT NULL DEFAULT 5.00,

  -- Dates
  start_date       DATE,
  end_date         DATE,
  duration_months  INTEGER,

  -- Location
  region           TEXT            DEFAULT 'الرياض',

  -- Team assignment
  director_id      UUID            REFERENCES profiles(id),
  admin_id         UUID            REFERENCES profiles(id),
  reviewer_id      UUID            REFERENCES profiles(id),
  external_user_id UUID            REFERENCES profiles(id), -- consultant/contractor

  -- Metadata
  description      TEXT,
  notes            TEXT,
  created_by       UUID            NOT NULL REFERENCES profiles(id),
  updated_by       UUID            REFERENCES profiles(id),
  created_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE contracts IS
  'Contract master records. Each contract has one external user (consultant or contractor) '
  'and one or more internal team members (director, admin, reviewer). '
  'boq_progress_model column added in migration 004.';

COMMENT ON COLUMN contracts.retention_pct IS
  'Percentage of each claim retained as performance guarantee (حجز الختامي). '
  'Defaults to 5%. Some contracts may have 0% based on ministry decisions. '
  'This value is suggested to the user when creating a claim; they may override it.';


-- ── C3. contract_amendments ───────────────────────────────────────
-- Formal contract amendments (not the same as Change Orders).
-- Amendments affect the contract header (value, duration).
-- Change Orders (migration 003) affect the scope/BOQ/staff.

CREATE TABLE contract_amendments (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id     UUID         NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  amendment_no    TEXT         NOT NULL,
  title           TEXT         NOT NULL,
  description     TEXT,
  value_change    NUMERIC(15,2) NOT NULL DEFAULT 0,   -- positive = increase, negative = reduction
  duration_change INTEGER       DEFAULT 0,            -- months added (positive) or removed (negative)
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by     UUID         REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  created_by      UUID         NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


-- ── C4. claims ────────────────────────────────────────────────────
-- Financial claims (المستخلصات). Each claim belongs to a contract.
-- claim_no is sequential per contract, auto-set by trigger.

CREATE TABLE claims (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_no         INTEGER        NOT NULL,
  contract_id      UUID           NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  reference_no     TEXT,                              -- الرقم المرجعي / منصة اعتماد ref

  status           claim_status   NOT NULL DEFAULT 'draft',

  -- Claim period
  period_from      DATE,
  period_to        DATE,
  invoice_date     DATE,

  -- Financials
  -- boq_amount:    sum of claim_boq_items.after_perf
  -- staff_amount:  sum of claim_staff_items.after_perf
  -- gross_amount:  boq + staff (GENERATED)
  -- retention_amount: explicitly set — user may override the formula suggestion
  -- net_amount:    gross - retention (GENERATED)
  -- vat_amount:    explicitly set — server action computes net × 0.15
  -- total_amount:  net + vat (GENERATED)
  boq_amount       NUMERIC(15,2)  NOT NULL DEFAULT 0,
  staff_amount     NUMERIC(15,2)  NOT NULL DEFAULT 0,
  gross_amount     NUMERIC(15,2)  GENERATED ALWAYS AS (boq_amount + staff_amount) STORED,
  retention_amount NUMERIC(15,2)  NOT NULL DEFAULT 0,
  net_amount       NUMERIC(15,2)  GENERATED ALWAYS AS (boq_amount + staff_amount - retention_amount) STORED,
  vat_amount       NUMERIC(15,2)  NOT NULL DEFAULT 0,
  total_amount     NUMERIC(15,2)  GENERATED ALWAYS AS (boq_amount + staff_amount - retention_amount + vat_amount) STORED,

  -- Performance
  performance_rating    NUMERIC(3,2) DEFAULT 1.00,   -- 0.00 to 1.00
  performance_deduction NUMERIC(15,2) DEFAULT 0,

  -- claim_type: computed by server action from boq/staff amounts
  -- Added here with a wide default so migration 003 ALTER TABLE ADD COLUMN
  -- works without data migration. The CHECK constraint is the DB safety net.
  -- Values: boq_only | staff_only | mixed | supervision
  claim_type       TEXT           NOT NULL DEFAULT 'mixed'
    CONSTRAINT claims_claim_type_check
    CHECK (claim_type IN ('boq_only', 'staff_only', 'mixed', 'supervision')),

  -- People
  submitted_by     UUID           REFERENCES profiles(id),
  reviewed_by      UUID           REFERENCES profiles(id),
  approved_by      UUID           REFERENCES profiles(id),

  -- Notes
  submission_notes TEXT,
  review_notes     TEXT,
  rejection_reason TEXT,
  return_reason    TEXT,

  -- Timestamps
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  created_by       UUID           NOT NULL REFERENCES profiles(id),
  updated_by       UUID           REFERENCES profiles(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT claims_contract_no_unique UNIQUE (contract_id, claim_no)
);

COMMENT ON TABLE claims IS
  'Financial claims (المستخلصات). Sequential per contract. '
  'Financials are set by server action computeClaimTotals(). '
  'Gross, net, and total are GENERATED columns. '
  'The variation trigger (migration 003) blocks status → approved if '
  'any BOQ item has requires_variation=TRUE and no resolution.';

COMMENT ON COLUMN claims.claim_type IS
  'Computed by server action: '
  'boq_only (BOQ > 0, staff = 0), staff_only (staff > 0, BOQ = 0), '
  'mixed (both > 0 or both = 0), supervision (only monthly_lump_sum BOQ). '
  'Set on every save. Never set by the client directly.';

COMMENT ON COLUMN claims.retention_amount IS
  'Explicitly stored — not GENERATED — because users may override the formula '
  'suggestion (gross × retention_pct%). The server action pre-fills the suggested '
  'amount; the user may change it (e.g. to 0 after the ministry waives retention).';


-- ── C5. claim_boq_items ───────────────────────────────────────────
-- One row per BOQ line item per claim.
-- Populated from contract_boq_templates at claim creation time.
-- progress_model, contractual_qty, and variation columns added in migration 004.

CREATE TABLE claim_boq_items (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id         UUID          NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  item_no          INTEGER       NOT NULL,
  description      TEXT          NOT NULL,
  description_ar   TEXT,
  unit             TEXT          DEFAULT 'عدد',
  unit_price       NUMERIC(15,2) NOT NULL DEFAULT 0,

  -- Progress tracking
  -- NUMERIC(10,4) to support count model (e.g. 0.6667, 2.0) and large decimal values
  prev_progress    NUMERIC(10,4) DEFAULT 0,   -- cumulative progress before this claim
  curr_progress    NUMERIC(10,4) DEFAULT 0,   -- progress added in this claim period
  period_amount    NUMERIC(15,2) DEFAULT 0,   -- curr × unit_price (count) or (curr/100) × price (pct)

  -- Performance
  performance_pct  NUMERIC(5,2)  DEFAULT 100, -- reviewer-set deduction (0–100)
  after_perf       NUMERIC(15,2) DEFAULT 0,   -- period_amount × (performance_pct/100)
  cumulative       NUMERIC(15,2) DEFAULT 0,   -- (prev + curr) × unit_price

  -- Progress model (item-level override — see migration 004 for full semantics)
  -- NULL = inherit from contracts.boq_progress_model
  -- Valid values: count | percentage | monthly_lump_sum
  progress_model   TEXT
    CONSTRAINT claim_boq_items_progress_model_check
    CHECK (progress_model IN ('count', 'percentage', 'monthly_lump_sum')),

  -- Variation tracking
  -- contractual_qty: threshold for requires_variation (count/monthly_lump_sum models)
  -- change_order_id: added in migration 003 after change_orders table is created
  contractual_qty        NUMERIC(10,4) NOT NULL DEFAULT 1,
  requires_variation     BOOLEAN       NOT NULL DEFAULT false,
  -- change_order_id deferred to 003 (FK to change_orders, created in 003)
  variation_override_by  UUID          REFERENCES profiles(id),
  variation_override_notes TEXT,
  variation_override_at  TIMESTAMPTZ,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT claim_boq_items_claim_item_unique UNIQUE (claim_id, item_no)
);

COMMENT ON TABLE claim_boq_items IS
  'BOQ line items for a claim. Populated from contract_boq_templates on creation. '
  'All computed fields (period_amount, after_perf, cumulative, requires_variation) '
  'are set by the server action computeBOQRow() — never computed by the DB. '
  'change_order_id: NULL = base contract item, non-NULL = CO-added item. '
  'variation_override_*: director override path for unresolved variations.';

COMMENT ON COLUMN claim_boq_items.prev_progress IS
  'Sum of curr_progress from all previously APPROVED claims for this item. '
  'Loaded by loadPrevProgress() when building a new claim template. '
  'Not user-editable.';

-- Note: change_order_id column and its COMMENT are added in migration 003.


-- ── C6. claim_staff_items ─────────────────────────────────────────
-- One row per staff position per claim.
-- Staff always uses the days_prorated billing model.
-- Formula: basic = (days/30) × rate; extra = (rate/192) × 1.5 × ot_hours

CREATE TABLE claim_staff_items (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id         UUID          NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  item_no          INTEGER       NOT NULL,
  position         TEXT          NOT NULL,
  position_ar      TEXT,
  monthly_rate     NUMERIC(10,2) NOT NULL DEFAULT 0,
  contract_months  INTEGER       DEFAULT 24, -- per-row — varies by position

  -- User inputs
  working_days     INTEGER       DEFAULT 0,          -- 0–31
  overtime_hours   NUMERIC(6,2)  DEFAULT 0,          -- decimal ≥ 0

  -- Computed by server action (formula constants: 30 days/month, 192 hrs/month, 1.5× OT)
  basic_amount     NUMERIC(15,2) DEFAULT 0,          -- (days/30) × rate
  extra_amount     NUMERIC(15,2) DEFAULT 0,          -- (rate/192) × 1.5 × hours
  total_amount     NUMERIC(15,2) DEFAULT 0,          -- basic + extra
  performance_pct  NUMERIC(5,2)  DEFAULT 100,
  after_perf       NUMERIC(15,2) DEFAULT 0,          -- total × (perf/100)
  cumulative       NUMERIC(15,2) DEFAULT 0,          -- sum of after_perf across all approved claims

  -- change_order_id: added in migration 003 after change_orders table is created

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT claim_staff_items_claim_item_unique UNIQUE (claim_id, item_no)
);

COMMENT ON TABLE claim_staff_items IS
  'Staff/manpower line items for a claim. All computed fields set by server action. '
  'Staff always uses days_prorated model — no progress_model column needed. '
  'Formulas verified against real contract 231001101771 data.';


-- ── C7. claim_workflow ────────────────────────────────────────────
-- Full audit trail of all claim status transitions and actions.
-- One row per action. Immutable after INSERT.

CREATE TABLE claim_workflow (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id     UUID         NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  action       TEXT         NOT NULL
    CONSTRAINT claim_workflow_action_check
    CHECK (action IN (
      -- External user actions
      'submit',              -- submits a draft claim
      'resubmit',            -- resubmits after return
      'comment',             -- informational note, no status change
      -- Consultant review stage
      'consultant_review',   -- moved to under_consultant_review
      'consultant_return',   -- returned from consultant review
      -- Admin review stage
      'admin_review',        -- moved to under_admin_review (skipping consultant)
      'admin_return',        -- admin returns to submitter
      -- Director stage
      'forward',             -- admin forwards to director
      'approve',             -- director approves
      'reject',              -- director rejects
      'director_return',     -- director returns to admin
      -- Lifecycle
      'close',
      'reopen'
    )),
  from_status  claim_status,
  to_status    claim_status,
  actor_id     UUID         NOT NULL REFERENCES profiles(id),
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE claim_workflow IS
  'Immutable audit trail of all claim state transitions. '
  'Mirrors the shape of change_order_workflow for component reuse. '
  'Every action is logged here — the timeline on the claim detail page reads from this table.';


-- ── C8. documents ─────────────────────────────────────────────────
-- References to files uploaded to Supabase Storage.
-- Each document belongs to exactly one parent (contract OR claim).

CREATE TABLE documents (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT           NOT NULL,
  original_name TEXT           NOT NULL,
  file_path     TEXT           NOT NULL,              -- Supabase Storage path
  file_size     BIGINT,
  mime_type     TEXT,
  type          document_type  NOT NULL DEFAULT 'other',

  -- Exactly one parent — enforced by CHECK constraint
  contract_id   UUID           REFERENCES contracts(id) ON DELETE CASCADE,
  claim_id      UUID           REFERENCES claims(id)    ON DELETE CASCADE,

  description   TEXT,
  is_public     BOOLEAN        DEFAULT false,
  uploaded_by   UUID           NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT documents_has_exactly_one_parent CHECK (
    (contract_id IS NOT NULL)::INT + (claim_id IS NOT NULL)::INT = 1
  )
);

COMMENT ON TABLE documents IS
  'References to files in Supabase Storage. '
  'Each document belongs to exactly one parent (contract XOR claim). '
  'file_path is the storage object path, e.g. claims/{claim_id}/{timestamp}_{name}.';


-- ── C9. audit_logs ────────────────────────────────────────────────
-- System-wide immutable event log. Written by server actions.
-- Not subject to user-facing RLS deletions.

CREATE TABLE audit_logs (
  id           UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     UUID           REFERENCES profiles(id),
  actor_email  TEXT,
  actor_role   user_role,
  action       audit_action   NOT NULL,
  entity_type  TEXT           NOT NULL,  -- 'claim' | 'contract' | 'user' | 'document'
  entity_id    UUID,
  entity_label TEXT,                     -- human-readable (e.g. 'مستخلص #7 — عقد 231001101771')
  old_values   JSONB,
  new_values   JSONB,
  metadata     JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_logs IS
  'Immutable system-wide event log. Written by server actions. '
  'Includes variation override approvals (director override model, migration 004).';


-- ── C10. notifications ────────────────────────────────────────────

CREATE TABLE notifications (
  id          UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID               NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        notification_type  NOT NULL,
  title       TEXT               NOT NULL,
  title_ar    TEXT,
  body        TEXT,
  body_ar     TEXT,
  entity_type TEXT,
  entity_id   UUID,
  is_read     BOOLEAN            NOT NULL DEFAULT false,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);


-- ── C11. kpi_snapshots ────────────────────────────────────────────
-- Periodic snapshots of contract-level financial KPIs.
-- Created by the KPI dashboard cron job or on demand.

CREATE TABLE kpi_snapshots (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id       UUID         NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  snapshot_date     DATE         NOT NULL DEFAULT CURRENT_DATE,
  total_paid        NUMERIC(15,2) DEFAULT 0,
  total_retention   NUMERIC(15,2) DEFAULT 0,
  completion_pct    NUMERIC(5,2)  DEFAULT 0,
  claims_count      INTEGER       DEFAULT 0,
  approved_claims   INTEGER       DEFAULT 0,
  pending_claims    INTEGER       DEFAULT 0,
  avg_review_days   NUMERIC(5,2),
  avg_approval_days NUMERIC(5,2),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (contract_id, snapshot_date)
);


-- ─────────────────────────────────────────────────────────────────
--  D. INDEXES
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_profiles_role         ON profiles(role);
CREATE INDEX idx_profiles_active       ON profiles(is_active);
CREATE INDEX idx_contracts_status      ON contracts(status);
CREATE INDEX idx_contracts_external    ON contracts(external_user_id);
CREATE INDEX idx_claims_contract       ON claims(contract_id);
CREATE INDEX idx_claims_status         ON claims(status);
CREATE INDEX idx_claims_submitted_by   ON claims(submitted_by);
CREATE INDEX idx_claims_type           ON claims(contract_id, claim_type);
CREATE INDEX idx_claim_boq_claim       ON claim_boq_items(claim_id);
CREATE INDEX idx_claim_staff_claim     ON claim_staff_items(claim_id);

-- Partial index: only flagged variation rows (the common query target)
CREATE INDEX idx_claim_boq_variation   ON claim_boq_items(claim_id, requires_variation)
  WHERE requires_variation = TRUE;

-- idx_claim_boq_co_id and idx_claim_staff_co_id created in migration 003
-- after change_order_id FK columns are added to these tables.

-- Partial index: non-NULL progress_model overrides
CREATE INDEX idx_claim_boq_progress    ON claim_boq_items(progress_model)
  WHERE progress_model IS NOT NULL;

CREATE INDEX idx_claim_workflow_claim  ON claim_workflow(claim_id);
CREATE INDEX idx_documents_contract    ON documents(contract_id);
CREATE INDEX idx_documents_claim       ON documents(claim_id);
CREATE INDEX idx_audit_actor           ON audit_logs(actor_id);
CREATE INDEX idx_audit_entity          ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created         ON audit_logs(created_at DESC);
CREATE INDEX idx_notifications_user    ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);


-- ─────────────────────────────────────────────────────────────────
--  E. FUNCTIONS & TRIGGERS
-- ─────────────────────────────────────────────────────────────────

-- E1. Auto-update updated_at on any table that has the column
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON contracts         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON claims            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_amendments_updated_at
  BEFORE UPDATE ON contract_amendments FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- E2. Auto-create profile on Supabase Auth user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'contractor')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- E3. Auto-number claims sequentially per contract
-- If claim_no is not provided (NULL or 0), assign MAX(claim_no)+1 for this contract.
-- This is safe for concurrent inserts because MAX() within a transaction
-- reads uncommitted rows from the same session.
CREATE OR REPLACE FUNCTION auto_claim_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.claim_no IS NULL OR NEW.claim_no = 0 THEN
    SELECT COALESCE(MAX(claim_no), 0) + 1
    INTO   NEW.claim_no
    FROM   claims
    WHERE  contract_id = NEW.contract_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_claim_number
  BEFORE INSERT ON claims
  FOR EACH ROW EXECUTE FUNCTION auto_claim_number();


-- ─────────────────────────────────────────────────────────────────
--  F. ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────────────────────────

-- Enable RLS on all application tables
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_amendments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims               ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_boq_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_staff_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_workflow       ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_snapshots        ENABLE ROW LEVEL SECURITY;


-- Helper functions (SECURITY DEFINER — execute with elevated privileges)

CREATE OR REPLACE FUNCTION auth_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_internal()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role IN ('director','admin','reviewer') FROM profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_external()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role IN ('consultant','contractor') FROM profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ── profiles ──────────────────────────────────────────────────────
-- Own row + internal users can read all. Admin can manage all.

CREATE POLICY "profiles_select_own_or_internal"
  ON profiles FOR SELECT
  USING (id = auth.uid() OR is_internal());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_admin_all"
  ON profiles FOR ALL
  USING (auth_role() IN ('director', 'admin'));


-- ── contracts ─────────────────────────────────────────────────────

CREATE POLICY "contracts_internal_all"
  ON contracts FOR ALL
  USING (is_internal());

CREATE POLICY "contracts_external_select_own"
  ON contracts FOR SELECT
  USING (external_user_id = auth.uid());


-- ── claims ────────────────────────────────────────────────────────

CREATE POLICY "claims_internal_all"
  ON claims FOR ALL
  USING (is_internal());

CREATE POLICY "claims_external_select"
  ON claims FOR SELECT
  USING (
    submitted_by = auth.uid()
    OR created_by = auth.uid()
    OR contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );

CREATE POLICY "claims_external_insert"
  ON claims FOR INSERT
  WITH CHECK (
    contract_id IN (
      SELECT id FROM contracts
      WHERE  external_user_id = auth.uid()
        AND  status = 'active'
    )
    AND status = 'draft'
    AND created_by = auth.uid()
  );

-- External users can update their own claims when in an editable state.
-- With CHECK prevents setting status to anything other than these states
-- (status transitions to submitted/approved are done via server actions with
-- service role client, which bypasses RLS).
CREATE POLICY "claims_external_update_editable"
  ON claims FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin')
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin', 'submitted')
  );


-- ── claim_boq_items ───────────────────────────────────────────────
-- Internal: full access.
-- External: split into explicit per-operation policies.
-- NOTE: change_order_id IS NULL guard added in migration 003
-- after the change_order_id FK column is added.

CREATE POLICY "claim_boq_internal_all"
  ON claim_boq_items FOR ALL
  USING (is_internal());

CREATE POLICY "claim_boq_external_select"
  ON claim_boq_items FOR SELECT
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

-- claim_boq_external_insert: upgraded in 003 to add change_order_id IS NULL guard
-- (column added in 003; guard cannot exist in 001)
CREATE POLICY "claim_boq_external_insert"
  ON claim_boq_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

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
    -- change_order_id IS NULL guard added in migration 003
  );

CREATE POLICY "claim_boq_external_delete"
  ON claim_boq_items FOR DELETE
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );


-- ── claim_staff_items ─────────────────────────────────────────────

CREATE POLICY "claim_staff_internal_all"
  ON claim_staff_items FOR ALL
  USING (is_internal());

CREATE POLICY "claim_staff_external_select"
  ON claim_staff_items FOR SELECT
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

-- claim_staff_external_insert: upgraded in 003 to add change_order_id IS NULL guard
CREATE POLICY "claim_staff_external_insert"
  ON claim_staff_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

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
    -- change_order_id IS NULL guard added in migration 003
  );

CREATE POLICY "claim_staff_external_delete"
  ON claim_staff_items FOR DELETE
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );


-- ── claim_workflow ────────────────────────────────────────────────

CREATE POLICY "workflow_internal_all"
  ON claim_workflow FOR ALL
  USING (is_internal());

CREATE POLICY "workflow_external_select"
  ON claim_workflow FOR SELECT
  USING (
    claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );

-- External users may only insert submit/resubmit/comment entries for their own claims.
-- Internal workflow entries (review/forward/approve/reject) are written
-- via service role client in server actions, bypassing RLS.
CREATE POLICY "workflow_external_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND action IN ('submit', 'resubmit', 'comment')
    AND claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
  );


-- ── documents ─────────────────────────────────────────────────────

CREATE POLICY "documents_internal_all"
  ON documents FOR ALL
  USING (is_internal());

CREATE POLICY "documents_external_select"
  ON documents FOR SELECT
  USING (
    uploaded_by = auth.uid()
    OR claim_id IN (
      SELECT c.id FROM claims c
      JOIN contracts ct ON c.contract_id = ct.id
      WHERE ct.external_user_id = auth.uid()
    )
    OR contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );

CREATE POLICY "documents_external_insert"
  ON documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      claim_id IN (
        SELECT c.id FROM claims c
        JOIN contracts ct ON c.contract_id = ct.id
        WHERE ct.external_user_id = auth.uid()
      )
      OR contract_id IN (
        SELECT id FROM contracts WHERE external_user_id = auth.uid()
      )
    )
  );

-- External users can only delete their own uploads (not others')
CREATE POLICY "documents_external_delete"
  ON documents FOR DELETE
  USING (uploaded_by = auth.uid());


-- ── audit_logs ────────────────────────────────────────────────────
-- Read only. Written exclusively by server actions.

CREATE POLICY "audit_director_admin_all"
  ON audit_logs FOR SELECT
  USING (auth_role() IN ('director', 'admin'));

CREATE POLICY "audit_own_actions"
  ON audit_logs FOR SELECT
  USING (actor_id = auth.uid());


-- ── notifications ─────────────────────────────────────────────────

CREATE POLICY "notifications_own_all"
  ON notifications FOR ALL
  USING (user_id = auth.uid());


-- ── kpi_snapshots ─────────────────────────────────────────────────

CREATE POLICY "kpi_internal_all"
  ON kpi_snapshots FOR ALL
  USING (is_internal());

CREATE POLICY "kpi_external_own"
  ON kpi_snapshots FOR SELECT
  USING (
    contract_id IN (
      SELECT id FROM contracts WHERE external_user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  G. VIEWS
-- ─────────────────────────────────────────────────────────────────

-- G1. claims_full — claims with joined context for the list and detail pages
CREATE OR REPLACE VIEW claims_full AS
SELECT
  cl.*,
  ct.contract_no,
  ct.title         AS contract_title,
  ct.title_ar      AS contract_title_ar,
  ct.party_name,
  ct.base_value    AS contract_value,
  p_sub.full_name  AS submitted_by_name,
  p_rev.full_name  AS reviewed_by_name,
  p_apr.full_name  AS approved_by_name,
  (SELECT COUNT(*) FROM documents   d  WHERE d.claim_id  = cl.id) AS doc_count,
  (SELECT COUNT(*) FROM claim_workflow wf WHERE wf.claim_id = cl.id) AS workflow_steps
FROM  claims cl
JOIN  contracts ct    ON cl.contract_id  = ct.id
LEFT JOIN profiles p_sub ON cl.submitted_by = p_sub.id
LEFT JOIN profiles p_rev ON cl.reviewed_by  = p_rev.id
LEFT JOIN profiles p_apr ON cl.approved_by  = p_apr.id;

COMMENT ON VIEW claims_full IS
  'Claims with contract context and people names pre-joined. '
  'Used by the claims list page and claim detail page. '
  'Subject to RLS on the underlying claims table.';


-- G2. contracts_summary — contract list with aggregated claim financials
CREATE OR REPLACE VIEW contracts_summary AS
SELECT
  ct.*,
  COUNT(DISTINCT cl.id)                                                     AS total_claims,
  COUNT(DISTINCT cl.id) FILTER (WHERE cl.status = 'approved')               AS approved_claims,
  COUNT(DISTINCT cl.id) FILTER (
    WHERE cl.status NOT IN ('draft','approved','rejected','closed')
  )                                                                         AS pending_claims,
  COALESCE(SUM(cl.total_amount)     FILTER (WHERE cl.status = 'approved'), 0) AS total_paid,
  COALESCE(SUM(cl.retention_amount) FILTER (WHERE cl.status = 'approved'), 0) AS total_retention,
  CASE WHEN ct.base_value > 0
    THEN ROUND(
      COALESCE(SUM(cl.gross_amount) FILTER (WHERE cl.status = 'approved'), 0)
      / ct.base_value * 100,
      2
    )
    ELSE 0
  END                                                                       AS completion_pct,
  p_ext.full_name AS external_user_name,
  p_dir.full_name AS director_name,
  p_adm.full_name AS admin_name
FROM  contracts ct
LEFT JOIN claims    cl    ON cl.contract_id      = ct.id
LEFT JOIN profiles  p_ext ON ct.external_user_id = p_ext.id
LEFT JOIN profiles  p_dir ON ct.director_id      = p_dir.id
LEFT JOIN profiles  p_adm ON ct.admin_id         = p_adm.id
GROUP BY ct.id, p_ext.full_name, p_dir.full_name, p_adm.full_name;

COMMENT ON VIEW contracts_summary IS
  'Contracts with aggregated claim counts and financial totals. '
  'Used by the contracts list page and dashboard KPI section.';


-- ─────────────────────────────────────────────────────────────────
--  Storage buckets are provisioned in migration 002.
--  See: 002_step0_fixes.sql → Section: Storage Buckets
-- ─────────────────────────────────────────────────────────────────
