-- ════════════════════════════════════════════════════════════════════
--  CMH_01 — STAGING Schema Bundle  v2.3 (true Path A)
--  Authored: 2026-05-07
--
--  Target:    STAGING ONLY  —  project ref  jrqkzwacerdudmeacvar
--  FORBIDDEN: production project ref  ngwxlockzkjpmzuvgakx
--
--  v2.3 changes vs v2.2 (commit 61428a9):
--    • Reverted Path B. The earlier hypothesis that 010_production_schema
--      was an additive consolidation snapshot was wrong: that file uses a
--      different access model (director_id + contract_assignments) that
--      the rest of the migration chain does NOT use. Sections 003, 004,
--      010_user_contracts, 019, 023, 024, 025, 026 (and seed 002) all
--      reference contracts.external_user_id, which only 001 creates.
--    • TRUE Path A — keep the 001-009 evolution chain as the foundation.
--      Skip ONLY 010_production_schema.sql (parallel-universe variant).
--    • Removed the synthetic change_order_staff_items patch (003 creates
--      it, plus change_order_boq_items, change_order_workflow, etc.).
--    • Reordered to original numeric sequence — no relocation of
--      002/006/007/008.
--
--  Operator instructions:
--    1. Verify staging is clean (run pre-check; expect public_table_count = 0).
--    2. Run pre-flight guard (lines 36–46) alone first.
--    3. Apply each subsequent STEP in order; stop on first error.
--    4. After all STEPs succeed, run staging_schema_verification.sql.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE prod_marker TEXT := 'ngwxlockzkjpmzuvgakx';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_settings
    WHERE setting LIKE '%' || prod_marker || '%'
       OR name    LIKE '%' || prod_marker || '%'
  ) THEN
    RAISE EXCEPTION 'ABORT — staging bundle must NEVER be applied on production project ref %', prod_marker;
  END IF;
END $$;


-- ─── SKIPPED — 010a (legacy) — 010_production_schema.sql ───
-- Reason: PARALLEL UNIVERSE — v2.0 standalone snapshot that uses director_id + contract_assignments instead of contracts.external_user_id. Sections 003, 004, 010_user_contracts, 019, 023, 024, 025, 026 (and seed 002) all reference contracts.external_user_id which 010_production_schema does NOT create. Skipping 010 keeps the migration chain self-consistent on the 001 foundation.
-- (skipped)


-- ─── SKIPPED — 015 (legacy) — 015_fix_contract_231001101771_templates.sql ───
-- Reason: PRODUCTION-ONLY data fix for a real-life contract
-- (skipped)


-- ─── SKIPPED — 018 (legacy) — 018_revert_staff_grade3_rows.sql ───
-- Reason: PRODUCTION-ONLY data revert
-- (skipped)


-- ════════════════════════════════════════════════════════════════════
--  STEP 1  —  MIGRATION  —  seq=001
--  Source: legacy: migrations/001_base_schema.sql
--  Reason: foundational base schema (March 16) — establishes profiles/contracts/claims/...
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 2  —  MIGRATION  —  seq=002
--  Source: legacy: migrations/002_step0_fixes.sql
--  Reason: step 0 fixes + storage buckets
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Step 0 Fixes & Storage Setup
--  File:    002_step0_fixes.sql
--
--  Run order: 2 of 4 (bootstrap sequence)
--  Depends on: 001_base_schema.sql
--
--  Bootstrap safe: all DROP IF EXISTS, INSERT ON CONFLICT DO NOTHING.
--  Safe to run multiple times.
--
--  Contents:
--    A. Fix: claims_external_update_editable
--         — Policy in 001 already includes the correct fix.
--           This section documents the intent and adds a belt-and-suspenders
--           guard in case the 001 policy text diverges.
--    B. Fix: workflow_external_insert (already correct in 001)
--    C. Storage buckets — documents and avatars
--    D. Storage RLS policies
--
--  Note on idempotency:
--    DROP POLICY IF EXISTS before CREATE handles re-runs safely.
--    INSERT INTO storage.buckets uses ON CONFLICT DO NOTHING.
--    Storage policies use DROP/CREATE for clean re-execution.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. CLAIM EXTERNAL UPDATE POLICY
--
--  Confirmed correct in 001_base_schema.sql as
--  "claims_external_update_editable". Documented here for traceability.
--
--  Rule summary:
--    USING:      (created_by = me OR submitted_by = me)
--                AND status IN (draft | returned_by_consultant | returned_by_admin)
--    WITH CHECK: same user condition
--                AND status IN (draft | returned_by_consultant | returned_by_admin | submitted)
--
--  The WITH CHECK allows the transition draft→submitted (the submit action),
--  but not draft→approved or any other escalation (those use service role).
-- ─────────────────────────────────────────────────────────────────

-- Idempotent re-assert (drop and recreate to ensure canonical state)
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;
DROP POLICY IF EXISTS "claims_external_update_draft"    ON claims;  -- legacy name

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


-- ─────────────────────────────────────────────────────────────────
--  B. WORKFLOW EXTERNAL INSERT POLICY
--
--  Confirmed correct in 001_base_schema.sql as "workflow_external_insert".
--  Canonical state: external users may INSERT only submit/resubmit/comment
--  entries for claims on their own contracts.
--  Internal workflow entries (review, forward, approve, reject) are written
--  via the Supabase service role client in server actions, bypassing RLS.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "workflow_external_insert" ON claim_workflow;

CREATE POLICY "workflow_external_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND action IN ('submit', 'resubmit', 'comment')
    AND claim_id IN (
      SELECT c.id
      FROM   claims c
      JOIN   contracts ct ON c.contract_id = ct.id
      WHERE  ct.external_user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  C. STORAGE BUCKETS
--
--  documents: private bucket for claim attachments (PDFs, invoices, etc.)
--  avatars:   public bucket for profile pictures
--
--  Limits:
--    documents: 50 MB per file, restricted MIME types
--    avatars:   5 MB per file, images only
-- ─────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,         -- 50 MB per file
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
),
(
  'avatars',
  'avatars',
  true,
  5242880,          -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  D. STORAGE RLS POLICIES
--
--  documents bucket:
--    - Any authenticated user can upload (server action enforces contract linkage)
--    - Any authenticated user can read (RLS on the documents table controls visibility)
--    - Only the uploader or an internal admin/director can delete
--
--  avatars bucket:
--    - Public read (avatars are public images)
--    - Any authenticated user can upload to their own folder ({uid}/*)
-- ─────────────────────────────────────────────────────────────────

-- Drop existing storage policies before recreating (idempotent)
DROP POLICY IF EXISTS "storage_documents_upload"        ON storage.objects;
DROP POLICY IF EXISTS "storage_documents_select"        ON storage.objects;
DROP POLICY IF EXISTS "storage_documents_delete"        ON storage.objects;
DROP POLICY IF EXISTS "storage_avatars_public_read"     ON storage.objects;
DROP POLICY IF EXISTS "storage_avatars_upload_own"      ON storage.objects;


CREATE POLICY "storage_documents_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "storage_documents_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "storage_documents_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND (
      -- The uploader can delete their own files
      owner = auth.uid()
      -- Internal admins can delete any document
      OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('director', 'admin')
    )
  );

CREATE POLICY "storage_avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "storage_avatars_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    -- File must be in the authenticated user's own folder
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );


-- ════════════════════════════════════════════════════════════════════
--  STEP 3  —  MIGRATION  —  seq=003
--  Source: legacy: migrations/003_change_orders_and_hardening.sql
--  Reason: change_orders + change_order_boq_items + change_order_staff_items + workflow
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 4  —  MIGRATION  —  seq=004
--  Source: legacy: migrations/004_contract_templates_and_progress_models.sql
--  Reason: contract_boq_templates + contract_staff_templates + boq_progress_model enum
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 5  —  MIGRATION  —  seq=006
--  Source: legacy: migrations/006_convera_users_otp.sql
--  Reason: CONVERA_USERS + convera_otp tables
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Prototype Auth Tables (convera_users + convera_otp)
--  File:    006_convera_users_otp.sql
--
--  Run order: 6 (after 005_rls_prototype_access.sql)
--  Depends on: 001_base_schema.sql (profiles table, user_role enum)
--
--  Purpose:
--    The vanilla-JS frontend prototype uses a custom auth flow:
--      1. Login via convera_users (email + password)
--      2. OTP verification via convera_otp
--      3. Bridge to profiles table for FK references
--
--    These tables are NOT part of the core CONVERA domain model.
--    They exist solely to support the prototype's auth mechanism.
--
--  PRODUCTION PATH:
--    When migrating to Supabase Auth (recommended for production):
--      1. Create auth.users entries for each user
--      2. The on_auth_user_created trigger auto-creates profiles rows
--      3. Use supabase.auth.signInWithPassword() in the frontend
--      4. Remove convera_users and convera_otp tables
--      5. Remove 005_rls_prototype_access.sql permissive policies
--
--  SECURITY NOTE:
--    convera_users.password_hash stores PLAIN TEXT passwords.
--    This is acceptable ONLY for the prototype/internal testing phase.
--    Never use this pattern in production.
--
--  Idempotency: CREATE TABLE IF NOT EXISTS + ON CONFLICT on inserts.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. convera_users — Prototype authentication table
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS convera_users (
  id             BIGSERIAL    PRIMARY KEY,
  email          TEXT         NOT NULL UNIQUE,
  password_hash  TEXT         NOT NULL,         -- PLAIN TEXT (prototype only!)
  name           TEXT         NOT NULL,
  name_ar        TEXT,
  role           TEXT         NOT NULL DEFAULT 'subuser'
    CONSTRAINT convera_users_role_check
    CHECK (role IN ('director', 'auditor', 'admin', 'consultant', 'contractor', 'subuser')),
  phone          TEXT,
  phone_masked   TEXT,
  avatar         TEXT,                          -- single character for avatar circle
  avatar_color   TEXT         DEFAULT '#026D69',
  contract_no    TEXT,                          -- links user to a contract
  organization   TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  approved       BOOLEAN      NOT NULL DEFAULT true,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE convera_users IS
  'Prototype-only authentication table. NOT for production use. '
  'Production should use Supabase Auth (auth.users) with proper hashing. '
  'Bridges to profiles table via email match for UUID-based FK references.';


-- ─────────────────────────────────────────────────────────────────
--  B. convera_otp — One-time password verification
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS convera_otp (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES convera_users(id) ON DELETE CASCADE,
  code        TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT false,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_convera_otp_user   ON convera_otp(user_id, used);
CREATE INDEX IF NOT EXISTS idx_convera_otp_expire ON convera_otp(expires_at);

COMMENT ON TABLE convera_otp IS
  'OTP codes for convera_users login flow. '
  'In prototype: OTP is displayed on-screen (no SMS). '
  'Production: use Supabase Auth MFA or Twilio integration.';


-- ─────────────────────────────────────────────────────────────────
--  C. RLS — Open access for prototype (matches 005 pattern)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE convera_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE convera_otp   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all_convera_users" ON convera_users;
CREATE POLICY "public_all_convera_users"
  ON convera_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_all_convera_otp" ON convera_otp;
CREATE POLICY "public_all_convera_otp"
  ON convera_otp FOR ALL USING (true) WITH CHECK (true);

-- Grant anon access (Supabase anon key)
GRANT SELECT, INSERT, UPDATE, DELETE ON convera_users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON convera_otp   TO anon;
GRANT USAGE ON SEQUENCE convera_users_id_seq TO anon;
GRANT USAGE ON SEQUENCE convera_otp_id_seq   TO anon;


-- ─────────────────────────────────────────────────────────────────
--  D. updated_at trigger
-- ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_convera_users_updated_at
  BEFORE UPDATE ON convera_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════════════════════════════════
--  STEP 6  —  MIGRATION  —  seq=007
--  Source: legacy: migrations/007_contract_amendments_enhancement.sql
--  Reason: contract amendments enhancement
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 7  —  MIGRATION  —  seq=008
--  Source: legacy: migrations/008_invoice_attachment_governance.sql
--  Reason: invoice attachment governance
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 008: Invoice Attachment Governance
--
--  Business Rule: A financial claim CANNOT transition to 'submitted'
--  unless an approved invoice document (type='invoice') is attached.
--
--  Enforcement layers:
--  1. Database trigger: blocks UPDATE to status='submitted' if no invoice
--  2. RLS: prototype access for documents table
--  3. Application: validate() checks on frontend
--
--  Run order: 8 (after 007)
--  Safe to run multiple times (all operations are idempotent)
-- ═══════════════════════════════════════════════════════════════════


-- ─── 1. Database trigger: enforce invoice before submission ─────

CREATE OR REPLACE FUNCTION enforce_invoice_before_submission()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_count INT;
BEGIN
  -- Only enforce when transitioning TO 'submitted'
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT COUNT(*) INTO v_invoice_count
    FROM documents
    WHERE claim_id = NEW.id
      AND type = 'invoice';

    IF v_invoice_count = 0 THEN
      RAISE EXCEPTION 'لا يمكن تقديم المطالبة المالية بدون إرفاق الفاتورة المعتمدة'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists then recreate
DROP TRIGGER IF EXISTS trg_enforce_invoice_before_submission ON claims;
CREATE TRIGGER trg_enforce_invoice_before_submission
  BEFORE UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION enforce_invoice_before_submission();


-- ─── 2. RLS for documents table (prototype access) ─────────────

-- Allow full access for prototype (same as other tables in 005)
DROP POLICY IF EXISTS "public_all_documents" ON documents;
CREATE POLICY "public_all_documents"
  ON documents FOR ALL USING (true) WITH CHECK (true);

-- Grant access to anon role
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO authenticated;


-- ─── 3. Verification ───────────────────────────────────────────

-- Verify trigger exists
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgrelid = 'claims'::regclass
  AND tgname = 'trg_enforce_invoice_before_submission';

-- Verify documents RLS
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'documents'
  AND schemaname = 'public';


-- ════════════════════════════════════════════════════════════════════
--  STEP 8  —  MIGRATION  —  seq=009
--  Source: legacy: migrations/009_rename_claim_statuses.sql
--  Reason: rename claim status enum values
-- ════════════════════════════════════════════════════════════════════
-- =============================================================
-- Migration 009: Rename claim_status enum from 4-stage to 5-stage
-- CONVERA Platform — 5-stage workflow alignment
--
-- Old (4-stage):  under_consultant_review → returned_by_consultant
--                 under_admin_review      → returned_by_admin
--
-- New (5-stage):  under_supervisor_review → returned_by_supervisor
--                 under_auditor_review    → returned_by_auditor
--                 under_reviewer_check    (new — no old equivalent)
--
-- Run in Supabase SQL Editor BEFORE deploying updated frontend code.
-- Safe to run multiple times (ADD VALUE IF NOT EXISTS).
-- =============================================================

-- ─── Step 1: Add all new enum values ────────────────────────────
-- (PostgreSQL does not support removing enum values; old values remain
-- but are no longer used by the application after data migration.)

ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_supervisor'  AFTER 'under_supervisor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'returned_by_supervisor';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_auditor'     AFTER 'under_auditor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'returned_by_auditor';

-- Commit the enum additions before using them in UPDATE statements.
-- (In Supabase SQL Editor, each statement runs in its own transaction,
-- so the above ALTERs are visible to the UPDATEs below.)

-- ─── Step 2: Migrate existing claims data ───────────────────────

-- under_consultant_review → under_supervisor_review
UPDATE claims
SET status = 'under_supervisor_review'
WHERE status = 'under_consultant_review';

-- returned_by_consultant → returned_by_supervisor
UPDATE claims
SET status = 'returned_by_supervisor'
WHERE status = 'returned_by_consultant';

-- under_admin_review → under_auditor_review
-- (admin review maps to auditor review in the 5-stage workflow)
UPDATE claims
SET status = 'under_auditor_review'
WHERE status = 'under_admin_review';

-- returned_by_admin → returned_by_auditor
UPDATE claims
SET status = 'returned_by_auditor'
WHERE status = 'returned_by_admin';

-- ─── Step 3: Migrate claim_workflow audit trail ──────────────────

UPDATE claim_workflow SET from_status = 'under_supervisor_review' WHERE from_status = 'under_consultant_review';
UPDATE claim_workflow SET from_status = 'returned_by_supervisor'  WHERE from_status = 'returned_by_consultant';
UPDATE claim_workflow SET from_status = 'under_auditor_review'    WHERE from_status = 'under_admin_review';
UPDATE claim_workflow SET from_status = 'returned_by_auditor'     WHERE from_status = 'returned_by_admin';

UPDATE claim_workflow SET to_status = 'under_supervisor_review' WHERE to_status = 'under_consultant_review';
UPDATE claim_workflow SET to_status = 'returned_by_supervisor'  WHERE to_status = 'returned_by_consultant';
UPDATE claim_workflow SET to_status = 'under_auditor_review'    WHERE to_status = 'under_admin_review';
UPDATE claim_workflow SET to_status = 'returned_by_auditor'     WHERE to_status = 'returned_by_admin';

-- ─── Step 4: Update change_order_status enum (if applicable) ────
-- change_order_status uses same stage names for its workflow
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'under_supervisor_review';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'under_auditor_review';

UPDATE change_orders SET status = 'under_supervisor_review' WHERE status = 'under_consultant_review';
UPDATE change_orders SET status = 'under_auditor_review'    WHERE status = 'under_admin_review';

-- ─── Step 5: Update SLA monitor function (if exists) ─────────────
-- Ensure supervisor_review_started_at trigger fires on new status name
DO $$
BEGIN
  -- Drop and recreate the supervisor SLA trigger function if it exists
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_supervisor_review_timestamp'
  ) THEN
    -- Function body will reference the new status name — recreate via
    -- the companion migration 010_production_schema.sql if needed.
    NULL;
  END IF;
END;
$$;

-- ─── Verification ────────────────────────────────────────────────
-- Run after migration to confirm counts:
SELECT status, COUNT(*) FROM claims GROUP BY status ORDER BY status;
SELECT status, COUNT(*) FROM change_orders GROUP BY status ORDER BY status;

-- Expected: zero rows with old status names (under_consultant_review,
-- returned_by_consultant, under_admin_review, returned_by_admin)


-- ════════════════════════════════════════════════════════════════════
--  STEP 9  —  MIGRATION  —  seq=010b
--  Source: legacy: migrations/010_user_contracts.sql
--  Reason: user_contracts (m2m) — additive on top of 001
-- ════════════════════════════════════════════════════════════════════
-- ============================================================
-- Migration 010: User-Contract Associations (many-to-many)
-- "العقود المرتبطة" — linked contracts per user
-- ============================================================
-- Run this in Supabase SQL Editor AFTER migration 005.
-- ============================================================

-- ── Junction table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_contracts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(id)  ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, contract_id)
);

COMMENT ON TABLE user_contracts IS
  'Many-to-many: which contracts a user (contractor, supervisor, auditor, reviewer) is associated with. '
  'Director sees all contracts regardless of this table.';

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_contracts_user_id     ON user_contracts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_contracts_contract_id ON user_contracts(contract_id);

-- ── RLS ───────────────────────────────────────────────────────────
ALTER TABLE user_contracts ENABLE ROW LEVEL SECURITY;

-- Internal users (director, admin/auditor, reviewer) can read all links
CREATE POLICY "internal_read_user_contracts"
ON user_contracts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('director', 'admin', 'reviewer', 'consultant')
  )
);

-- External users (contractor, supervisor) can only see their own links
CREATE POLICY "external_read_own_user_contracts"
ON user_contracts FOR SELECT
USING (user_id = auth.uid());

-- Only director can insert / delete links
CREATE POLICY "director_manage_user_contracts"
ON user_contracts FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'director'
  )
);

-- ── View: contracts filtered by user's links (for RLS-safe queries) ──
-- Contractors and supervisors use this to see only their linked contracts.
CREATE OR REPLACE VIEW user_visible_contracts AS
SELECT
  c.*,
  uc.user_id AS linked_user_id
FROM contracts c
JOIN user_contracts uc ON uc.contract_id = c.id;

-- ── Function: get linked contract IDs for a user ──────────────────
CREATE OR REPLACE FUNCTION get_user_contract_ids(p_user_id UUID)
RETURNS UUID[] AS $$
  SELECT ARRAY_AGG(contract_id)
  FROM user_contracts
  WHERE user_id = p_user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Migrate existing data ─────────────────────────────────────────
-- Sync from contracts.external_user_id (contractors/supervisors)
INSERT INTO user_contracts (user_id, contract_id)
SELECT external_user_id, id
FROM contracts
WHERE external_user_id IS NOT NULL
  AND external_user_id != ''::uuid
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- Sync from contracts.admin_id (auditors)
INSERT INTO user_contracts (user_id, contract_id)
SELECT admin_id, id
FROM contracts
WHERE admin_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;


-- ════════════════════════════════════════════════════════════════════
--  STEP 10  —  MIGRATION  —  seq=011
--  Source: legacy: migrations/011_fix_rls_returned_statuses.sql
--  Reason: RLS fix returned statuses
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 11  —  MIGRATION  —  seq=012
--  Source: legacy: migrations/012_fix_rls_workflow_roles.sql
--  Reason: RLS fix workflow roles
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 012: Fix RLS for All Workflow Roles
--  File: 012_fix_rls_workflow_roles.sql
--
--  Problem: The prototype policy (005) granting broad access was either
--  never applied or was removed. Internal workflow roles (consultant/
--  supervisor, admin/auditor, reviewer, director) lacked explicit
--  SELECT and UPDATE policies to read and act on claims.
--
--  Fix: Add targeted RLS policies for each workflow role covering:
--    - SELECT: consultant can read all claims (for review queue)
--    - UPDATE: each role can transition claims at their assigned stage
--    - INSERT: all roles can log claim_workflow entries
--    - SELECT: all authenticated users can read documents
-- ═══════════════════════════════════════════════════════════════════

-- 1. Consultant (supervisor role in UI) can SELECT all claims
DROP POLICY IF EXISTS "claims_consultant_select" ON claims;
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant');

-- 2. Consultant can UPDATE claims at supervisor stages
--    (submitted → under_supervisor_review → under_auditor_review | returned_by_supervisor)
DROP POLICY IF EXISTS "claims_consultant_update" ON claims;
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted', 'under_supervisor_review')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
  );

-- 3. Admin (auditor role in UI) can UPDATE claims at auditor stage
--    (under_auditor_review → under_reviewer_check | returned_by_auditor)
DROP POLICY IF EXISTS "claims_admin_update" ON claims;
CREATE POLICY "claims_admin_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
    AND status IN ('under_auditor_review')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- 4. Reviewer can UPDATE claims at reviewer stage
--    (under_reviewer_check → pending_director_approval | returned_by_auditor)
DROP POLICY IF EXISTS "claims_reviewer_update" ON claims;
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer'
    AND status IN ('under_reviewer_check')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer'
  );

-- 5. Director can UPDATE claims at final approval stage
--    (pending_director_approval → approved | rejected | under_auditor_review)
DROP POLICY IF EXISTS "claims_director_update" ON claims;
CREATE POLICY "claims_director_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
    AND status IN ('pending_director_approval')
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );

-- 6. All workflow roles can INSERT claim_workflow audit entries
DROP POLICY IF EXISTS "claim_workflow_roles_insert" ON claim_workflow;
CREATE POLICY "claim_workflow_roles_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid())
      IN ('consultant', 'admin', 'reviewer', 'director', 'contractor')
  );

-- 7. All authenticated users can SELECT documents (for attachment visibility)
DROP POLICY IF EXISTS "documents_auth_read" ON documents;
CREATE POLICY "documents_auth_read"
  ON documents FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Verification
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'claims' ORDER BY policyname;


-- ════════════════════════════════════════════════════════════════════
--  STEP 12  —  MIGRATION  —  seq=013
--  Source: legacy: migrations/013_fix_trigger_security_definer.sql
--  Reason: trigger SECURITY DEFINER fix
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 013: Fix Trigger SECURITY DEFINER
--  File: 013_fix_trigger_security_definer.sql
--
--  Problem: check_claim_within_contract_limit() trigger ran with the
--  calling user's RLS context. When supervisor/consultant updated a
--  claim, the trigger's SELECT on contracts was blocked by RLS
--  (consultant is external, contract not owned by them), returning
--  NULL → RAISE EXCEPTION 'العقد غير موجود'.
--
--  Fix 1: Recreate trigger function as SECURITY DEFINER so it always
--  reads contracts/claims with elevated privileges.
--
--  Fix 2: Add contracts_auth_read policy allowing all authenticated
--  users to SELECT contracts (needed for UI display).
-- ═══════════════════════════════════════════════════════════════════

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
  -- Draft claims always pass (no financial check)
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Get contract base_value (SECURITY DEFINER bypasses RLS)
  SELECT base_value INTO v_base
  FROM contracts
  WHERE id = NEW.contract_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'العقد غير موجود';
  END IF;

  -- Count and sum approved amendments
  SELECT COUNT(*), COALESCE(SUM(value_change), 0)
  INTO v_amendment_count, v_amendments_net
  FROM contract_amendments
  WHERE contract_id = NEW.contract_id
    AND status = 'approved';

  -- Two-tier ceiling calculation
  IF v_amendment_count > 0 THEN
    v_ceiling := v_base + v_amendments_net;
  ELSE
    v_ceiling := v_base * 1.10;
  END IF;

  -- Cumulative spend (excluding rejected and draft)
  SELECT COALESCE(SUM(boq_amount + staff_amount), 0)
  INTO v_others
  FROM claims
  WHERE contract_id = NEW.contract_id
    AND id != NEW.id
    AND status NOT IN ('rejected', 'draft');

  v_new_gross := COALESCE(NEW.boq_amount, 0) + COALESCE(NEW.staff_amount, 0);

  -- Enforce ceiling
  IF (v_others + v_new_gross) > v_ceiling THEN
    RAISE EXCEPTION
      'المبلغ الإجمالي للمستخلصات (% ريال) يتجاوز سقف العقد (% ريال)',
      ROUND(v_others + v_new_gross, 2),
      ROUND(v_ceiling, 2);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Allow all authenticated users to SELECT contracts (for UI and trigger context)
DROP POLICY IF EXISTS "contracts_auth_read" ON contracts;
CREATE POLICY "contracts_auth_read"
  ON contracts FOR SELECT
  USING (auth.uid() IS NOT NULL);

SELECT 'trigger_fixed' AS result;


-- ════════════════════════════════════════════════════════════════════
--  STEP 13  —  MIGRATION  —  seq=014
--  Source: legacy: migrations/014_db_level_transition_guard.sql
--  Reason: DB-level transition guard
-- ════════════════════════════════════════════════════════════════════
-- ============================================================
-- Migration 014: DB-Level Workflow Transition Guard
-- ============================================================
-- Purpose: Defense-in-depth trigger that validates claim status
-- transitions at the PostgreSQL layer, independently of the API.
--
-- Even if an attacker bypasses the Next.js API entirely and calls
-- PostgREST directly (e.g., via PATCH /claims?id=eq.xxx), this
-- trigger will reject any transition that is not permitted for
-- the calling user's role.
--
-- Allowed transition matrix (mirrors CLAIM_TRANSITIONS in workflow-engine.ts):
--
--   contractor  : draft → submitted
--   contractor  : returned_by_supervisor / returned_by_auditor → submitted (resubmit)
--   supervisor  : submitted → under_supervisor_review (auto-assign after contractor submit)
--   supervisor  : under_supervisor_review → under_auditor_review (approve)
--   supervisor  : under_supervisor_review → returned_by_supervisor (return)
--   auditor     : under_auditor_review → under_reviewer_check (approve)
--   auditor     : under_auditor_review → returned_by_auditor (return)
--   reviewer    : under_reviewer_check → pending_director_approval (approve)
--   reviewer    : under_reviewer_check → returned_by_auditor (return to auditor)
--   director    : pending_director_approval → approved (approve)
--   director    : pending_director_approval → rejected (reject)
--   director    : pending_director_approval → under_auditor_review (return to auditor)
--   director    : submitted → under_supervisor_review (assign_supervisor)
--   reviewer    : submitted → under_supervisor_review (assign_supervisor)
--   <any>       : submitted → under_supervisor_review (auto-assign from submit API)
--     ↳ The submit API runs as the contractor and auto-transitions to under_supervisor_review.
--       We allow this specific transition from any authenticated role so the submit API
--       is not broken. Access control for this path is enforced by RLS + submit API logic.
--
-- Terminal states approved/rejected are fully immutable — NO transitions out.
-- ============================================================

-- ─── Drop existing guard if re-running ──────────────────────────
DROP TRIGGER IF EXISTS trg_validate_claim_transition ON public.claims;
DROP FUNCTION IF EXISTS public.validate_claim_status_transition();

-- ─── Transition guard function ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_claim_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as owner to read profiles across RLS
SET search_path = public, auth
AS $$
DECLARE
  v_role    TEXT;
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- Only run when status actually changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- ── Rule G3: Terminal states are immutable ───────────────────
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION
      'CLAIM_IMMUTABLE: Cannot modify an approved or rejected claim (id=%). '
      'Once a claim reaches a terminal state it cannot be changed.',
      OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  -- ── Identify calling user's role ────────────────────────────
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  -- Unauthenticated callers (no JWT / service-role bypass) are allowed to proceed
  -- only in the case of the system auto-assign (submitted → under_supervisor_review),
  -- which the submit API executes. Service-role clients bypass RLS and triggers, so
  -- this path is only reached by anon/authenticated JWT callers.
  IF v_role IS NULL THEN
    -- Allow submit API auto-transition when called without a profile match
    -- (should not happen in normal use; extra guard in case of edge case)
    IF OLD.status = 'submitted' AND NEW.status = 'under_supervisor_review' THEN
      RETURN NEW; -- system auto-assign
    END IF;
    RAISE EXCEPTION
      'CLAIM_AUTH: Unauthenticated or unknown user cannot modify claim status (id=%).',
      OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  -- ── Transition matrix ────────────────────────────────────────
  v_allowed := CASE

    -- Contractor: initial submit
    WHEN v_role = 'contractor'
      AND OLD.status = 'draft'
      AND NEW.status = 'submitted'
    THEN TRUE

    -- Contractor: resubmit after return from supervisor or auditor
    WHEN v_role = 'contractor'
      AND OLD.status IN ('returned_by_supervisor', 'returned_by_auditor')
      AND NEW.status = 'submitted'
    THEN TRUE

    -- submitted → under_supervisor_review:
    -- Allowed for supervisor, director, reviewer (assign_supervisor action),
    -- AND for contractor (auto-assign triggered by submit API in same request)
    WHEN OLD.status = 'submitted'
      AND NEW.status = 'under_supervisor_review'
      AND v_role IN ('supervisor', 'director', 'reviewer', 'contractor')
    THEN TRUE

    -- Supervisor: approve → auditor
    WHEN v_role = 'supervisor'
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'under_auditor_review'
    THEN TRUE

    -- Supervisor: return → contractor
    WHEN v_role = 'supervisor'
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'returned_by_supervisor'
    THEN TRUE

    -- Auditor: approve → reviewer
    WHEN v_role = 'auditor'
      AND OLD.status = 'under_auditor_review'
      AND NEW.status = 'under_reviewer_check'
    THEN TRUE

    -- Auditor: return → contractor
    WHEN v_role = 'auditor'
      AND OLD.status = 'under_auditor_review'
      AND NEW.status = 'returned_by_auditor'
    THEN TRUE

    -- Reviewer: approve → director
    WHEN v_role = 'reviewer'
      AND OLD.status = 'under_reviewer_check'
      AND NEW.status = 'pending_director_approval'
    THEN TRUE

    -- Reviewer: return → auditor (for correction)
    WHEN v_role = 'reviewer'
      AND OLD.status = 'under_reviewer_check'
      AND NEW.status = 'returned_by_auditor'
    THEN TRUE

    -- Director: final approve
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'approved'
    THEN TRUE

    -- Director: final reject
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'rejected'
    THEN TRUE

    -- Director: return to auditor
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'under_auditor_review'
    THEN TRUE

    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'CLAIM_TRANSITION_DENIED: Role "%" cannot move claim from "%" to "%" (id=%). '
      'This transition is not permitted by the CONVERA workflow engine.',
      v_role, OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Grant execute to authenticated users (the function is SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.validate_claim_status_transition() TO authenticated;

-- ─── Attach trigger to claims table ──────────────────────────────
CREATE TRIGGER trg_validate_claim_transition
  BEFORE UPDATE ON public.claims
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_claim_status_transition();

-- ─── Verify the trigger is registered ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_name = 'trg_validate_claim_transition'
      AND event_object_table = 'claims'
  ) THEN
    RAISE EXCEPTION 'SETUP ERROR: trigger trg_validate_claim_transition was not created';
  END IF;
  RAISE NOTICE 'OK: DB-level workflow transition guard is active on claims table';
END;
$$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 14  —  MIGRATION  —  seq=016
--  Source: legacy: migrations/016_update_contract_types.sql
--  Reason: contract_type enum updates
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- Migration 016: Update contract types to match department standards
-- وزارة البلديات والإسكان — إدارة التطوير والتأهيل
--
-- Adds 'supply' (توريد مواد) to the contract_type enum
-- Updates contract 231001101771 type: supervision → consultancy
-- Updates Arabic labels (frontend-only, no DB change needed for labels)
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Add 'supply' to the contract_type enum
-- PostgreSQL does not allow removing enum values, only adding new ones
ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'supply';

-- Step 2: Update contract 231001101771
-- Current type: supervision (إشراف هندسي)
-- Correct type:  consultancy (استشارات هندسية)
UPDATE contracts
SET type = 'consultancy'
WHERE contract_no = '231001101771'
  AND type = 'supervision';

-- Verify
SELECT contract_no, type, title
FROM contracts
WHERE contract_no IN ('231001101771', '241039011332')
ORDER BY contract_no;


-- ════════════════════════════════════════════════════════════════════
--  STEP 15  —  MIGRATION  —  seq=017
--  Source: legacy: migrations/017_fix_contracts_rls_user_contracts.sql
--  Reason: RLS fix contracts/user_contracts join
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 017: Fix Contracts RLS — Use user_contracts
--  File: 017_fix_contracts_rls_user_contracts.sql
--
--  Problem:
--    • contracts_contractor_select  → scoped by "has submitted a claim"
--                                     (claims.submitted_by = auth.uid())
--                                     Removing a contractor from user_contracts
--                                     has NO effect because this policy ignores
--                                     that table entirely.
--    • contracts_supervisor_select  → scoped by contract_assignments table
--                                     AND uses 'supervisor'::user_role which is
--                                     not a valid enum value (should be 'consultant').
--
--  Fix:
--    Both external-role policies now use user_contracts as the single
--    source of truth for contract visibility.  Director is the only one
--    who writes to user_contracts (via the admin API), so removing a
--    row there immediately removes visibility for that user.
--
--  Roles affected:
--    • contractor  (DB role = 'contractor')
--    • supervisor  (DB role = 'consultant'  — legacy name in user_role enum)
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Drop outdated policies ─────────────────────────────────────

DROP POLICY IF EXISTS "contracts_contractor_select"  ON contracts;
DROP POLICY IF EXISTS "contracts_supervisor_select"  ON contracts;
-- Drop the consultant variant too in case it was created by a prior patch
DROP POLICY IF EXISTS "contracts_consultant_select"  ON contracts;

-- ── 2. Contractor — scope to user_contracts ───────────────────────
--
-- A contractor can see a contract only when there is a row in
-- user_contracts that links their profile to that contract.
-- The director manages these rows via the admin users UI.

CREATE POLICY "contracts_contractor_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 3. Supervisor / Consultant — scope to user_contracts ──────────
--
-- Same logic for the consultant role (shown as "supervisor" in UI).
-- The DB enum value is 'consultant'; the old policy mistakenly used
-- 'supervisor'::user_role which never matched anything.

CREATE POLICY "contracts_consultant_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 4. Fix claims RLS — contractor can only see claims on linked contracts ──
--
-- Current policy (claims_contractor_select in 010_production_schema.sql):
--   USING (submitted_by = auth.uid() OR created_by = auth.uid())
--
-- This lets a contractor see ALL claims they ever submitted, even on contracts
-- they have since been removed from.  Fix: scope to user_contracts too.

DROP POLICY IF EXISTS "claims_contractor_select" ON claims;

CREATE POLICY "claims_contractor_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 5. Fix claims RLS — consultant scope via user_contracts ───────
--
-- Drop old supervisor-style policy if it exists and replace with
-- a proper user_contracts check for the consultant role.

DROP POLICY IF EXISTS "claims_supervisor_select"  ON claims;
DROP POLICY IF EXISTS "claims_consultant_select"  ON claims;

CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 6. Verification ───────────────────────────────────────────────
-- Run after applying to confirm expected policies exist:
SELECT
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
ORDER BY tablename, policyname;

-- Expected new/updated policies:
--   contracts → contracts_consultant_select  (user_contracts-based)
--   contracts → contracts_contractor_select  (user_contracts-based)
--   claims    → claims_contractor_select     (user_contracts-based)
--   claims    → claims_consultant_select     (user_contracts-based)
--   (other pre-existing policies remain unchanged)


-- ════════════════════════════════════════════════════════════════════
--  STEP 16  —  MIGRATION  —  seq=019
--  Source: legacy: migrations/019_definitive_rls_scope_fix.sql
--  Reason: definitive RLS scoping
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 019: Definitive RLS Scope Enforcement
--  File: 019_definitive_rls_scope_fix.sql
--
--  WHY THIS EXISTS
--  ───────────────
--  Supabase evaluates PERMISSIVE policies with OR logic: if ANY policy
--  grants access, the row is returned.  Previous migrations (017) dropped
--  policies from 010_production_schema.sql, but left the ORIGINAL policies
--  from 001_base_schema.sql alive.  Those older policies use:
--    • contracts.external_user_id = auth.uid()    (deprecated column approach)
--    • claims.submitted_by = auth.uid()           (ignores user_contracts)
--    • claims.created_by  = auth.uid()            (ignores user_contracts)
--  meaning a contractor whose user_contracts rows are deleted can STILL
--  see contracts and claims through the old policies.
--
--  Additionally migration 012 added:
--    • claims_consultant_select: role = 'consultant'   (NO scope check at all)
--  allowing any consultant to read ALL claims platform-wide.
--
--  WHAT THIS MIGRATION DOES
--  ────────────────────────
--  Phase 1 — DROP every policy on contracts, claims, claim_boq_items,
--             claim_staff_items that uses the deprecated external_user_id /
--             submitted_by / created_by approach or has no scope check.
--
--  Phase 2 — RECREATE correct policies using user_contracts as the single
--             authoritative scope table for contractor and consultant roles.
--
--  Phase 3 — Verification query.
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + DO $$).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — DROP ALL STALE / OPEN / SCOPE-LESS POLICIES
-- ════════════════════════════════════════════════════════════════════

-- ── contracts ────────────────────────────────────────────────────────

-- 001: external_user_id = auth.uid() (ignores user_contracts)
DROP POLICY IF EXISTS "contracts_external_select_own"   ON contracts;

-- 010: submitted_by-based  (wrong source of truth)
DROP POLICY IF EXISTS "contracts_contractor_select"     ON contracts;
-- 010: 'supervisor'::user_role cast + contract_assignments (enum mismatch + wrong table)
DROP POLICY IF EXISTS "contracts_supervisor_select"     ON contracts;

-- 017: drop the versions added by 017 so we recreate them cleanly below
DROP POLICY IF EXISTS "contracts_consultant_select"     ON contracts;

-- ── claims ───────────────────────────────────────────────────────────

-- 001: submitted_by / created_by / external_user_id  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_external_select"          ON claims;
-- 001: INSERT check using contracts.external_user_id  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_external_insert"          ON claims;
-- 001 / 011: UPDATE using created_by / submitted_by without scope check
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;

-- 010: submitted_by = auth.uid() for SELECT  (ignores user_contracts)
DROP POLICY IF EXISTS "claims_contractor_select"        ON claims;
-- 010: INSERT using role check + submitted_by, no user_contracts
DROP POLICY IF EXISTS "claims_contractor_insert"        ON claims;
-- 010: UPDATE draft using submitted_by, no user_contracts
DROP POLICY IF EXISTS "claims_contractor_update_draft"  ON claims;
-- 010: 'supervisor'::user_role + contract_assignments (enum mismatch + wrong table)
DROP POLICY IF EXISTS "claims_supervisor_select"        ON claims;

-- 012: role = 'consultant' with NO scope check  ← most dangerous: all claims visible
DROP POLICY IF EXISTS "claims_consultant_select"        ON claims;
-- 012: consultant UPDATE without user_contracts
DROP POLICY IF EXISTS "claims_consultant_update"        ON claims;

-- 017: drop then recreate cleanly below
DROP POLICY IF EXISTS "claims_contractor_select"        ON claims;

-- ── claim_boq_items ──────────────────────────────────────────────────

-- 001: all use external_user_id approach
DROP POLICY IF EXISTS "claim_boq_external_select"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_insert"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_update"       ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_external_delete"       ON claim_boq_items;

-- ── claim_staff_items ────────────────────────────────────────────────

-- 001: all use external_user_id approach
DROP POLICY IF EXISTS "claim_staff_external_select"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_insert"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_update"     ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_external_delete"     ON claim_staff_items;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — CREATE CORRECT SCOPE-ENFORCED POLICIES
--
--  Scope rule for external roles (contractor, consultant/supervisor):
--    A row is accessible ONLY when there is a row in user_contracts
--    linking auth.uid() to the contract_id of that resource.
--
--  Internal roles (director, admin, reviewer) are intentionally global
--  and are handled by existing is_internal() / claims_internal_all policies.
-- ════════════════════════════════════════════════════════════════════

-- ── 2.1  contracts — contractor SELECT ───────────────────────────────
DROP POLICY IF EXISTS "contracts_contractor_select" ON contracts;
CREATE POLICY "contracts_contractor_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 2.2  contracts — consultant/supervisor SELECT ────────────────────
DROP POLICY IF EXISTS "contracts_consultant_select" ON contracts;
CREATE POLICY "contracts_consultant_select"
  ON contracts FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contracts.id
    )
  );

-- ── 2.3  claims — contractor SELECT (scoped to linked contracts) ─────
DROP POLICY IF EXISTS "claims_contractor_select" ON claims;
CREATE POLICY "claims_contractor_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.4  claims — contractor INSERT ──────────────────────────────────
DROP POLICY IF EXISTS "claims_contractor_insert" ON claims;
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (
      SELECT 1 FROM user_contracts uc
      JOIN   contracts c ON c.id = uc.contract_id
      WHERE  uc.user_id     = auth.uid()
        AND  uc.contract_id = claims.contract_id
        AND  c.status       = 'active'
    )
    AND created_by = auth.uid()
  );

-- ── 2.5  claims — contractor UPDATE (draft / returned states) ────────
DROP POLICY IF EXISTS "claims_contractor_update" ON claims;
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                   'returned_by_supervisor',           'returned_by_auditor')
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.6  claims — consultant/supervisor SELECT ───────────────────────
DROP POLICY IF EXISTS "claims_consultant_select" ON claims;
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.7  claims — consultant/supervisor UPDATE ───────────────────────
DROP POLICY IF EXISTS "claims_consultant_update" ON claims;
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted', 'under_supervisor_review')
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = claims.contract_id
    )
  );

-- ── 2.8  claim_boq_items — contractor / consultant ───────────────────
DROP POLICY IF EXISTS "claim_boq_scoped_select"        ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_insert"    ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_update"    ON claim_boq_items;
DROP POLICY IF EXISTS "claim_boq_contractor_delete"    ON claim_boq_items;

CREATE POLICY "claim_boq_scoped_select"
  ON claim_boq_items FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM claims
    )
  );

CREATE POLICY "claim_boq_contractor_insert"
  ON claim_boq_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
    AND change_order_id IS NULL
  );

CREATE POLICY "claim_boq_contractor_update"
  ON claim_boq_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_boq_contractor_delete"
  ON claim_boq_items FOR DELETE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status = 'draft'
    )
  );

-- ── 2.9  claim_staff_items — contractor / consultant ─────────────────
DROP POLICY IF EXISTS "claim_staff_scoped_select"       ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_insert"   ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_update"   ON claim_staff_items;
DROP POLICY IF EXISTS "claim_staff_contractor_delete"   ON claim_staff_items;

CREATE POLICY "claim_staff_scoped_select"
  ON claim_staff_items FOR SELECT
  USING (
    claim_id IN (
      SELECT id FROM claims
    )
  );

CREATE POLICY "claim_staff_contractor_insert"
  ON claim_staff_items FOR INSERT
  WITH CHECK (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_staff_contractor_update"
  ON claim_staff_items FOR UPDATE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                       'returned_by_supervisor',           'returned_by_auditor')
    )
  );

CREATE POLICY "claim_staff_contractor_delete"
  ON claim_staff_items FOR DELETE
  USING (
    claim_id IN (
      SELECT id FROM claims
      WHERE created_by = auth.uid()
        AND status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — VERIFICATION
-- ════════════════════════════════════════════════════════════════════

COMMIT;

-- ── After running, execute these to verify ───────────────────────────

-- 1. List all current policies on key tables
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 80) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contracts', 'claims', 'claim_boq_items', 'claim_staff_items')
ORDER BY tablename, policyname;

-- 2. Confirm NONE of the old open policies remain:
SELECT COUNT(*) AS should_be_zero
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
  AND policyname IN (
    'contracts_external_select_own',
    'contracts_supervisor_select',
    'claims_external_select',
    'claims_external_insert',
    'claims_external_update_editable',
    'claims_supervisor_select',
    'claims_contractor_select'   -- old submitted_by version
  );
-- Expected: 0

-- 3. Simulate contractor with NO user_contracts — should return 0 rows:
-- (Run as the contractor user, not as service role)
-- SELECT COUNT(*) FROM contracts;   → should be 0
-- SELECT COUNT(*) FROM claims;      → should be 0

-- 4. Confirm new policies exist:
SELECT policyname FROM pg_policies
WHERE tablename = 'contracts'
  AND policyname IN ('contracts_contractor_select', 'contracts_consultant_select');
-- Expected: 2 rows


-- ════════════════════════════════════════════════════════════════════
--  STEP 17  —  MIGRATION  —  seq=020
--  Source: legacy: migrations/020_fix_internal_role_policies.sql
--  Reason: internal-role policy fixes
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 020: Fix Internal Role Policy Mismatch
--  File: 020_fix_internal_role_policies.sql
--
--  ROOT CAUSE
--  ─────────────────────────────────────────────────────────────────────
--  The DB user_role enum (migration 001) uses:
--    director | admin | reviewer | consultant | contractor
--
--  Migration 010 (production schema) was written assuming a DIFFERENT
--  enum that used 'auditor' and 'supervisor' instead of 'admin' and
--  'consultant'. As a result, every "internal" RLS policy in migration
--  010 checks for role IN ('director', 'reviewer', 'auditor') — but
--  'auditor' does NOT exist in the enum. The actual internal admin role
--  is 'admin'.
--
--  SYMPTOM
--  ─────────────────────────────────────────────────────────────────────
--  Users with role='admin' (e.g., حسام الحبلين) cannot see ANY contracts
--  or claims through RLS because no policy grants them access. The
--  frontend shows empty lists and permission errors for these users.
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  1. Fixes is_internal() helper function: 'admin' instead of 'auditor'
--  2. Drops and recreates all affected SELECT policies to include 'admin'
--     in the role check (replacing 'auditor' wherever it appears)
--  3. Fixes profiles_internal_select which also uses the wrong role name
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + CREATE).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — Fix is_internal() helper function
--  The function is used in some policies — fix it first.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_internal()
RETURNS BOOLEAN AS $$
BEGIN
  -- 'admin' is the actual DB enum value for the auditor/admin role.
  -- 'auditor' does NOT exist in user_role enum — this was a schema mismatch.
  RETURN (SELECT role FROM profiles WHERE id = auth.uid())
    IN ('director', 'admin', 'reviewer');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION is_internal() IS
  'Returns true if current user is director, admin, or reviewer (internal staff roles). '
  'Note: DB enum uses ''admin'', not ''auditor''. Updated by migration 020.';


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — Fix profiles_internal_select
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_internal_select" ON profiles;
-- Use is_internal() which is SECURITY DEFINER — bypasses RLS on profiles
-- to avoid infinite recursion (a policy on profiles cannot sub-select from profiles).
CREATE POLICY "profiles_internal_select"
  ON profiles FOR SELECT
  USING (is_internal());


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — Fix contracts policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "contracts_internal_select" ON contracts;
CREATE POLICY "contracts_internal_select"
  ON contracts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );

-- NOTE: contract_assignments table does not exist in this schema.
-- The supervisor/consultant assignment model uses user_contracts instead.
-- Skipping contract_assignments_internal_all policy.


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — Fix claims policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "claims_internal_select" ON claims;
CREATE POLICY "claims_internal_select"
  ON claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — Fix change_orders policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "change_orders_internal_select" ON change_orders;
CREATE POLICY "change_orders_internal_select"
  ON change_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 6 — Fix kpi_snapshots policies
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "kpi_snapshots_internal_select" ON kpi_snapshots;
CREATE POLICY "kpi_snapshots_internal_select"
  ON kpi_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 7 — Fix audit_logs policy (add 'admin' access)
-- ════════════════════════════════════════════════════════════════════

-- Admin users should also be able to read audit logs (they are internal staff)
DROP POLICY IF EXISTS "audit_logs_director_reviewer_select" ON audit_logs;
CREATE POLICY "audit_logs_director_reviewer_select"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('director', 'admin', 'reviewer')
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 8 — Also fix the claims_admin_update policy from migration 012
--  That policy already uses 'admin' correctly, but let's confirm it
--  exists and is correct. No changes needed there.
--
--  Verification queries:
-- ════════════════════════════════════════════════════════════════════

COMMIT;

-- ── After running, verify the fix ────────────────────────────────

-- 1. Confirm is_internal() now returns TRUE for 'admin' role:
--    SELECT is_internal() AS should_be_true;
--    (Run as an admin-role user)

-- 2. Confirm all internal policies now mention 'admin':
SELECT
  tablename,
  policyname,
  LEFT(qual, 120) AS condition_preview
FROM pg_policies
WHERE tablename IN (
  'contracts', 'claims', 'change_orders', 'kpi_snapshots',
  'audit_logs', 'profiles'
)
  AND policyname LIKE '%internal%'
ORDER BY tablename, policyname;

-- 3. Confirm 'auditor' no longer appears in any policy condition:
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%auditor%'
   OR with_check LIKE '%auditor%';
-- Expected: 0 rows (no policies should reference 'auditor' since it's not a valid role)


-- ════════════════════════════════════════════════════════════════════
--  STEP 18  —  MIGRATION  —  seq=021
--  Source: legacy: migrations/021_sync_auth_bans_and_verify.sql
--  Reason: auth bans sync
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Script 021: Sync Auth Bans + Full Verification
--
--  PURPOSE
--  ───────────────────────────────────────────────────────────────────
--  1. SYNC: Set auth.users.banned_until for all is_active=false users
--     (equivalent to calling /api/admin/sync-suspensions but via SQL).
--     This fixes عبدالله البهدل and any other suspended users.
--
--  2. VERIFY: Confirm zero-scope enforcement is working:
--     - RLS policies exist and are correct
--     - Suspended users have banned_until set
--     - Users with no user_contracts rows would get 0 rows from contracts/claims
--
--  RUN IN ORDER — each section is separated by a comment.
--  Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
--  PART 1 — Sync GoTrue ban for all suspended profiles
--  (Equivalent to POST /api/admin/sync-suspensions)
-- ════════════════════════════════════════════════════════════════════

-- Ban all inactive users (is_active = false) in auth.users
UPDATE auth.users
SET    banned_until = NOW() + INTERVAL '10 years'
WHERE  id IN (
  SELECT id FROM public.profiles WHERE is_active = false
)
  AND (banned_until IS NULL OR banned_until < NOW());

-- Unban all active users (is_active = true) in auth.users
UPDATE auth.users
SET    banned_until = NULL
WHERE  id IN (
  SELECT id FROM public.profiles WHERE is_active = true
)
  AND banned_until IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════
--  PART 2 — Verify: Show ban status for all users
-- ════════════════════════════════════════════════════════════════════

SELECT
  p.email,
  p.full_name_ar,
  p.role::TEXT                AS role,
  p.is_active                 AS profile_active,
  CASE
    WHEN au.banned_until IS NULL            THEN '✅ not banned'
    WHEN au.banned_until > NOW()            THEN '🚫 BANNED until ' || au.banned_until::DATE::TEXT
    ELSE '⚠️ ban expired'
  END                         AS auth_ban_status,
  au.last_sign_in_at::DATE    AS last_login
FROM   public.profiles p
JOIN   auth.users au ON au.id = p.id
ORDER BY p.is_active DESC, p.role;

-- EXPECTED for عبدالله البهدل (contractor, is_active=false):
--   profile_active = false
--   auth_ban_status = '🚫 BANNED until <date>'


-- ════════════════════════════════════════════════════════════════════
--  PART 3 — Verify: user_contracts scope table
-- ════════════════════════════════════════════════════════════════════

SELECT
  p.email,
  p.full_name_ar,
  p.role::TEXT   AS role,
  p.is_active,
  COUNT(uc.contract_id) AS linked_contracts
FROM   public.profiles p
LEFT JOIN public.user_contracts uc ON uc.user_id = p.id
WHERE  p.role IN ('contractor', 'consultant')
GROUP BY p.id, p.email, p.full_name_ar, p.role, p.is_active
ORDER BY p.role, p.email;

-- EXPECTED:
--  - عبدالله البهدل:  linked_contracts = 0  (his scope was removed)
--  - Other contractors: linked_contracts > 0  (they have access)


-- ════════════════════════════════════════════════════════════════════
--  PART 4 — Verify: Internal policies now reference 'admin' (not 'auditor')
-- ════════════════════════════════════════════════════════════════════

SELECT
  tablename,
  policyname,
  LEFT(qual, 100) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contracts', 'claims', 'change_orders', 'kpi_snapshots', 'profiles')
  AND policyname LIKE '%internal%'
ORDER BY tablename, policyname;

-- EXPECTED: All internal policies show 'admin' in the condition, NOT 'auditor'


-- ════════════════════════════════════════════════════════════════════
--  PART 5 — Verify: Simulate zero-scope contractor (RLS test)
--  Shows what a contractor with NO user_contracts rows would see.
--  Rows returned = 0 means RLS is working correctly.
-- ════════════════════════════════════════════════════════════════════

-- Contracts visible to عبدالله البهدل (a1000004-0000-0000-0000-000000000004)
-- If RLS works: this should return 0 rows (no user_contracts links)
SELECT COUNT(*) AS contracts_visible_to_zero_scope_contractor
FROM   public.contracts
WHERE EXISTS (
  -- Simulate: would the contracts_contractor_select policy pass for this user?
  SELECT 1 FROM public.user_contracts
  WHERE user_id = 'a1000004-0000-0000-0000-000000000004'
    AND contract_id = contracts.id
);
-- EXPECTED: 0

-- Claims visible to عبدالله البهدل
SELECT COUNT(*) AS claims_visible_to_zero_scope_contractor
FROM   public.claims
WHERE EXISTS (
  SELECT 1 FROM public.user_contracts
  WHERE user_id = 'a1000004-0000-0000-0000-000000000004'
    AND contract_id = claims.contract_id
);
-- EXPECTED: 0


-- ════════════════════════════════════════════════════════════════════
--  PART 6 — Summary check: any stale open policies?
-- ════════════════════════════════════════════════════════════════════

SELECT COUNT(*) AS stale_open_policies_count
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
  AND policyname IN (
    'contracts_external_select_own',
    'contracts_supervisor_select',
    'claims_external_select',
    'claims_external_insert',
    'claims_external_update_editable',
    'claims_supervisor_select'
  );
-- EXPECTED: 0  (all stale policies were dropped by migration 019)


-- ════════════════════════════════════════════════════════════════════
--  STEP 19  —  MIGRATION  —  seq=022
--  Source: legacy: migrations/022_fix_profiles_recursion.sql
--  Reason: profiles RLS recursion fix
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 022: Fix profiles_internal_select infinite recursion
--
--  BUG: Migration 020 created profiles_internal_select with a sub-query
--       that reads FROM profiles — but the sub-query itself is subject
--       to RLS on profiles, causing PostgreSQL error 42P17:
--       "infinite recursion detected in policy for relation profiles"
--
--  FIX: Use is_internal() which is a SECURITY DEFINER function.
--       SECURITY DEFINER functions execute with the privileges of the
--       function owner (postgres) and bypass RLS. This breaks the
--       recursion cycle while still enforcing the correct role check.
--
--  CRITICAL: Run immediately — the platform is completely down.
-- ═══════════════════════════════════════════════════════════════════════

-- Drop the broken policy
DROP POLICY IF EXISTS "profiles_internal_select" ON profiles;

-- Recreate using is_internal() — no recursion because SECURITY DEFINER
-- bypasses RLS when querying profiles inside the function body.
CREATE POLICY "profiles_internal_select"
  ON profiles FOR SELECT
  USING (is_internal());


-- ════════════════════════════════════════════════════════════════════
--  STEP 20  —  MIGRATION  —  seq=023
--  Source: legacy: migrations/023_fix_contract_scoping_leaks.sql
--  Reason: plug contract-scoping leaks
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 023: Fix All Contract-Level Scoping Leaks
--  File: 023_fix_contract_scoping_leaks.sql
--
--  REQUIREMENT (2026-03-24)
--  ─────────────────────────────────────────────────────────────────────
--  "عند تعديلات الصلاحية وتعطيل ارتباط المستخدم بعقد ما ، يجب ان لا
--   يظهر له اي معلومة عن هذا العقد الغير مرتبط بكل المنصة"
--  When a user is unlinked from a contract (removed from user_contracts),
--  ZERO information about that contract should appear anywhere in the
--  platform — not on the dashboard, contracts page, claims, or anywhere.
--
--  DATA LEAKS FOUND
--  ─────────────────────────────────────────────────────────────────────
--  1. contract_amendments: "amendments_select_all" uses USING (true)
--     → ALL authenticated users can read ALL amendments
--
--  2. documents: "public_all_documents" uses USING (true) WITH CHECK (true)
--     AND "documents_auth_read" uses USING (auth.uid() IS NOT NULL)
--     → ALL authenticated users can read/write ALL documents
--
--  3. change_orders: External policies (co_external_select, co_external_insert)
--     use contracts.external_user_id = auth.uid() — DEPRECATED column.
--     After migration 019, user_contracts is the single source of truth.
--     external_user_id is NOT updated when a user is unlinked.
--
--  4. contract_ceiling_summary VIEW: Owned by postgres (superuser),
--     so RLS on the underlying contracts table is BYPASSED.
--     External users see ceiling data for ALL contracts.
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  Phase 1: Fix contract_amendments — scope by user_contracts
--  Phase 2: Fix documents — scope by user_contracts via claim_id/contract_id FK
--  Phase 3: Fix change_orders — use user_contracts instead of external_user_id
--  Phase 4: Fix contract_ceiling_summary — enable security_invoker
--  Phase 5: Verification queries
--
--  IDEMPOTENT: Safe to run multiple times (DROP IF EXISTS + CREATE).
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — Fix contract_amendments RLS
--
--  Problem: "amendments_select_all" uses USING (true) — no scoping.
--  Fix: Internal users keep full access. External users (contractor,
--       consultant) can only see amendments for their linked contracts.
-- ════════════════════════════════════════════════════════════════════

-- Drop the open policy
DROP POLICY IF EXISTS "amendments_select_all" ON contract_amendments;

-- Internal users: full SELECT access (they need to see all amendments)
DROP POLICY IF EXISTS "amendments_internal_select" ON contract_amendments;
CREATE POLICY "amendments_internal_select"
  ON contract_amendments FOR SELECT
  USING (is_internal());

-- External users: scoped to their linked contracts via user_contracts
DROP POLICY IF EXISTS "amendments_external_select" ON contract_amendments;
CREATE POLICY "amendments_external_select"
  ON contract_amendments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = contract_amendments.contract_id
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — Fix documents RLS
--
--  Problem: Multiple open policies from migrations 008 and 012:
--    - "public_all_documents"  → USING (true) WITH CHECK (true)
--    - "documents_auth_read"   → USING (auth.uid() IS NOT NULL)
--  These override the proper scoped policies from 001.
--
--  ACTUAL TABLE SCHEMA (from migration 001):
--    documents.claim_id    UUID FK → claims(id)
--    documents.contract_id UUID FK → contracts(id)
--    Constraint: exactly one parent (claim XOR contract)
--
--  Fix: Drop all open policies. Recreate with:
--    - Internal: full access
--    - External: only see documents for linked contracts (via user_contracts)
-- ════════════════════════════════════════════════════════════════════

-- Drop the dangerous open policies
DROP POLICY IF EXISTS "public_all_documents"    ON documents;
DROP POLICY IF EXISTS "documents_auth_read"     ON documents;

-- Also drop older policies that may conflict
DROP POLICY IF EXISTS "documents_internal_all"  ON documents;
DROP POLICY IF EXISTS "documents_external_select" ON documents;
DROP POLICY IF EXISTS "documents_external_insert" ON documents;
DROP POLICY IF EXISTS "documents_external_delete" ON documents;
DROP POLICY IF EXISTS "documents_view"          ON documents;
DROP POLICY IF EXISTS "documents_insert"        ON documents;

-- Internal users: full access to all documents
CREATE POLICY "documents_internal_all"
  ON documents FOR ALL
  USING (is_internal());

-- External users: SELECT documents linked to their contracts
-- documents.claim_id → claims.contract_id → user_contracts
-- documents.contract_id → user_contracts
CREATE POLICY "documents_external_select"
  ON documents FOR SELECT
  USING (
    -- Claim documents: accessible if user is linked to the claim's contract
    (claim_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM claims cl
      JOIN user_contracts uc ON uc.contract_id = cl.contract_id
      WHERE cl.id = documents.claim_id
        AND uc.user_id = auth.uid()
    ))
    OR
    -- Contract documents: accessible if user is linked to the contract
    (contract_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = documents.contract_id
    ))
  );

-- External users: INSERT documents for their linked claims/contracts
CREATE POLICY "documents_external_insert"
  ON documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      -- Can attach to claims on linked contracts (editable states only)
      (claim_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims cl
        JOIN user_contracts uc ON uc.contract_id = cl.contract_id
        WHERE cl.id = documents.claim_id
          AND uc.user_id = auth.uid()
          AND cl.status IN ('draft', 'returned_by_consultant', 'returned_by_admin',
                            'returned_by_supervisor', 'returned_by_auditor')
      ))
      OR
      -- Can attach to linked contracts directly
      (contract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_contracts
        WHERE user_id     = auth.uid()
          AND contract_id = documents.contract_id
      ))
    )
  );

-- External users: DELETE only documents they uploaded on linked draft claims
CREATE POLICY "documents_external_delete"
  ON documents FOR DELETE
  USING (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims cl
        JOIN user_contracts uc ON uc.contract_id = cl.contract_id
        WHERE cl.id = documents.claim_id
          AND uc.user_id = auth.uid()
          AND cl.status = 'draft'
      ))
      OR
      (contract_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM user_contracts
        WHERE user_id     = auth.uid()
          AND contract_id = documents.contract_id
      ))
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — Fix change_orders external policies
--
--  Problem: co_external_select/insert use the deprecated
--           contracts.external_user_id = auth.uid() approach.
--           After user_contracts became the single source of truth,
--           external_user_id is NOT updated when unlinking users.
--
--  Fix: Replace with user_contracts-based scoping.
-- ════════════════════════════════════════════════════════════════════

-- Drop the old external_user_id-based policies
DROP POLICY IF EXISTS "co_external_select"       ON change_orders;
DROP POLICY IF EXISTS "co_external_insert"        ON change_orders;
DROP POLICY IF EXISTS "co_external_update_draft"  ON change_orders;

-- External users: SELECT change orders for their linked contracts
CREATE POLICY "co_external_select"
  ON change_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  );

-- External users: INSERT draft change orders for their linked active contracts
CREATE POLICY "co_external_insert"
  ON change_orders FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts uc
      JOIN   contracts c ON c.id = uc.contract_id
      WHERE  uc.user_id     = auth.uid()
        AND  uc.contract_id = change_orders.contract_id
        AND  c.status       = 'active'
    )
  );

-- External users: UPDATE only draft COs they created
CREATE POLICY "co_external_update_draft"
  ON change_orders FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM user_contracts
      WHERE user_id     = auth.uid()
        AND contract_id = change_orders.contract_id
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — Fix contract_ceiling_summary VIEW
--
--  Problem: Views in PostgreSQL execute as the VIEW OWNER by default.
--  The owner is 'postgres' (superuser), which BYPASSES RLS on the
--  underlying contracts table. External users querying this view
--  through PostgREST see ceiling data for ALL contracts.
--
--  Fix: Set security_invoker = true (PostgreSQL 15+ feature).
--  This makes the view execute with the INVOKER's (API user's)
--  privileges, so RLS on contracts is properly enforced.
-- ════════════════════════════════════════════════════════════════════

ALTER VIEW contract_ceiling_summary SET (security_invoker = true);


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — VERIFICATION QUERIES (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════

-- 1. Confirm NO open policies remain on key tables
SELECT
  tablename,
  policyname,
  LEFT(qual, 80)  AS condition_preview
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  )
ORDER BY tablename, policyname;
-- EXPECTED: 0 rows (all open policies should be gone)


-- 2. Confirm all external policies now use user_contracts
SELECT
  tablename,
  policyname,
  LEFT(qual, 120) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
  AND policyname LIKE '%external%'
ORDER BY tablename, policyname;
-- EXPECTED: All policies should reference user_contracts


-- 3. Confirm contract_ceiling_summary has security_invoker
SELECT
  schemaname,
  viewname,
  viewowner,
  -- Check if security_invoker is set
  (SELECT reloptions FROM pg_class WHERE relname = 'contract_ceiling_summary')
    AS view_options
FROM pg_views
WHERE viewname = 'contract_ceiling_summary';
-- EXPECTED: view_options should contain {security_invoker=true}


-- 4. Full policy inventory for affected tables
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 100) AS using_clause,
  LEFT(with_check, 100) AS check_clause
FROM pg_policies
WHERE tablename IN ('contract_amendments', 'documents', 'change_orders')
ORDER BY tablename, policyname;


-- 5. Confirm deprecated external_user_id is no longer used in any policy
SELECT tablename, policyname, qual
FROM pg_policies
WHERE qual LIKE '%external_user_id%';
-- EXPECTED: 0 rows (no policies should reference external_user_id)


-- ════════════════════════════════════════════════════════════════════
--  STEP 21  —  MIGRATION  —  seq=024
--  Source: legacy: migrations/024_drop_contracts_auth_read_backdoor.sql
--  Reason: remove auth-read backdoor on contracts
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 024: Drop contracts_auth_read Backdoor
--  File: 024_drop_contracts_auth_read_backdoor.sql
--
--  CRITICAL SECURITY FIX
--  ─────────────────────────────────────────────────────────────────────
--  Migration 013 added "contracts_auth_read" with:
--    USING (auth.uid() IS NOT NULL)
--  This allows ANY authenticated user to SELECT ALL contracts,
--  completely bypassing the user_contracts scoping from migration 019.
--
--  ROOT CAUSE: Migration 013 added this policy to support the
--  check_claim_within_contract_limit() trigger. However, that trigger
--  was ALSO fixed in 013 to use SECURITY DEFINER (which bypasses RLS).
--  So contracts_auth_read was never actually needed — it was a
--  redundant policy that became a critical security hole.
--
--  IMPACT: With contracts_auth_read active, Supabase's PERMISSIVE OR
--  logic means every contractor/consultant sees ALL contracts regardless
--  of user_contracts linkage. This cascades to:
--    - claims (via contract_id FK + claim SELECT policies)
--    - claim_boq_items / claim_staff_items (via claim_id subquery)
--    - contract_ceiling_summary (via underlying contracts table)
--    - dashboard KPIs (all computed from contracts + claims)
--
--  WHAT THIS MIGRATION DOES
--  ─────────────────────────────────────────────────────────────────────
--  Phase 1: DROP the backdoor policy
--  Phase 2: Comprehensive audit of ALL remaining policies on contracts
--           and claims to confirm no other open policies exist
--  Phase 3: Verify zero-scope enforcement
--
--  IDEMPOTENT: Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — DROP THE BACKDOOR
-- ════════════════════════════════════════════════════════════════════

-- THE critical fix: remove the open "any authenticated user" policy
DROP POLICY IF EXISTS "contracts_auth_read" ON contracts;

-- Also drop any other potential auth_read backdoors on related tables
-- (defensive — these may not exist, but DROP IF EXISTS is safe)
DROP POLICY IF EXISTS "claims_auth_read"           ON claims;
DROP POLICY IF EXISTS "claim_boq_auth_read"        ON claim_boq_items;
DROP POLICY IF EXISTS "claim_staff_auth_read"      ON claim_staff_items;
DROP POLICY IF EXISTS "change_orders_auth_read"    ON change_orders;
DROP POLICY IF EXISTS "amendments_auth_read"       ON contract_amendments;
DROP POLICY IF EXISTS "workflow_auth_read"          ON claim_workflow;


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — FULL POLICY AUDIT (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════

-- 2.1  List ALL policies on contracts — confirm no open policies remain
SELECT
  policyname,
  cmd,
  permissive,
  LEFT(qual, 120)       AS using_clause,
  LEFT(with_check, 120) AS check_clause
FROM pg_policies
WHERE tablename = 'contracts'
ORDER BY policyname;
-- EXPECTED policies (and ONLY these):
--   contracts_internal_all      → is_internal()
--   contracts_internal_select   → role IN ('director','admin','reviewer')
--   contracts_contractor_select → user_contracts check
--   contracts_consultant_select → user_contracts check
-- MUST NOT contain: contracts_auth_read, contracts_external_select_own


-- 2.2  List ALL policies on claims — confirm no open policies remain
SELECT
  policyname,
  cmd,
  permissive,
  LEFT(qual, 120)       AS using_clause,
  LEFT(with_check, 120) AS check_clause
FROM pg_policies
WHERE tablename = 'claims'
ORDER BY policyname;
-- EXPECTED policies:
--   claims_internal_all        → is_internal()
--   claims_internal_select     → role IN ('director','admin','reviewer')
--   claims_contractor_select   → user_contracts check
--   claims_contractor_insert   → user_contracts + created_by check
--   claims_contractor_update   → user_contracts + created_by + status check
--   claims_consultant_select   → user_contracts check
--   claims_consultant_update   → user_contracts + status check
-- MUST NOT contain: claims_auth_read, claims_external_*


-- 2.3  CRITICAL: Scan ALL tables for any remaining open/backdoor policies
SELECT
  tablename,
  policyname,
  cmd,
  LEFT(qual, 100)       AS using_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
    OR qual LIKE '%auth.uid()  IS NOT NULL%'
  )
ORDER BY tablename, policyname;
-- EXPECTED: 0 rows (ZERO open policies on any public table)
-- If any rows appear, they are additional security holes that must be fixed.


-- 2.4  Confirm check_claim_within_contract_limit is SECURITY DEFINER
--       (this is why contracts_auth_read was never needed)
SELECT
  proname,
  prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'check_claim_within_contract_limit';
-- EXPECTED: is_security_definer = true


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — ZERO-SCOPE ENFORCEMENT SIMULATION
--
--  These queries simulate what a contractor with ZERO user_contracts
--  rows would see. Run them AS a contractor user (not service role).
--  If using Supabase SQL Editor (runs as postgres), you can use:
--    SET LOCAL ROLE authenticated;
--    SET LOCAL request.jwt.claims = '{"sub":"<contractor-user-id>"}';
-- ════════════════════════════════════════════════════════════════════

-- 3.1  Count all remaining open policies (should be 0)
SELECT COUNT(*) AS open_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  );
-- EXPECTED: 0

-- 3.2  Verify external_user_id is NOT used in any remaining policy
SELECT COUNT(*) AS external_user_id_policy_count
FROM pg_policies
WHERE qual LIKE '%external_user_id%';
-- EXPECTED: 0


-- ════════════════════════════════════════════════════════════════════
--  STEP 22  —  MIGRATION  —  seq=025
--  Source: legacy: migrations/025_contract_scoped_roles.sql
--  Reason: introduce user_contract_roles
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  Migration 025: Contract-Scoped Roles — Sprint A
--  CONVERA — وزارة البلديات والإسكان
--
--  PURPOSE:
--    Introduce the contract_role enum and user_contract_roles table
--    to support multi-role-per-user-per-contract permissions.
--
--  SCOPE (Sprint A ONLY):
--    ✓ Create contract_role enum
--    ✓ Create user_contract_roles table with RLS
--    ✓ Create SQL helper functions (SECURITY DEFINER)
--    ✓ Seed data from user_contracts + profiles.role
--    ✗ Does NOT modify existing RLS policies
--    ✗ Does NOT change APIs or frontend
--    ✗ Does NOT drop or modify user_contracts table
--
--  ROLLBACK:
--    DROP TABLE IF EXISTS user_contract_roles CASCADE;
--    DROP FUNCTION IF EXISTS has_contract_role(UUID, contract_role);
--    DROP FUNCTION IF EXISTS has_contract_access(UUID);
--    DROP FUNCTION IF EXISTS get_contract_role(UUID);
--    DROP TYPE IF EXISTS contract_role;
--
--  IDEMPOTENCY:
--    All statements use IF NOT EXISTS / IF EXISTS guards.
--    Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  PHASE 1: Prerequisites check
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles       BOOLEAN;
  v_has_contracts      BOOLEAN;
  v_has_user_contracts BOOLEAN;
  v_has_user_role      BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles')
    INTO v_has_profiles;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'contracts')
    INTO v_has_contracts;

  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_contracts')
    INTO v_has_user_contracts;

  SELECT EXISTS (SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'user_role')
    INTO v_has_user_role;

  IF NOT v_has_profiles THEN
    RAISE EXCEPTION 'MISSING: profiles table. Run migrations 001+ first.';
  END IF;
  IF NOT v_has_contracts THEN
    RAISE EXCEPTION 'MISSING: contracts table. Run migrations 001+ first.';
  END IF;
  IF NOT v_has_user_contracts THEN
    RAISE EXCEPTION 'MISSING: user_contracts table. Run migration 010 first.';
  END IF;
  IF NOT v_has_user_role THEN
    RAISE EXCEPTION 'MISSING: user_role enum. Run migration 001 first.';
  END IF;

  RAISE NOTICE '✓ Prerequisites verified: profiles, contracts, user_contracts, user_role enum all present.';
END $$;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 2: Create contract_role enum
-- ─────────────────────────────────────────────────────────────────
--
--  Role mapping from old system (user_role → contract_role):
--    contractor  → contractor   (creates and submits claims)
--    consultant  → supervisor   (first-stage review — renamed for clarity)
--    admin       → auditor      (second-stage financial audit)
--    reviewer    → reviewer     (third-stage اعتماد alignment check)
--    director    → N/A          (global role, not contract-scoped)
--
--  New role:
--    viewer      → read-only access (for observation / limited visibility)
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'contract_role'
  ) THEN
    CREATE TYPE contract_role AS ENUM (
      'contractor',    -- مقاول — creates and submits claims
      'supervisor',    -- جهة الإشراف — first review stage (was 'consultant')
      'auditor',       -- مدقق — financial audit stage (was 'admin')
      'reviewer',      -- مراجع — اعتماد alignment check
      'viewer'         -- مشاهد — read-only access
    );
    RAISE NOTICE '✓ Created contract_role enum.';
  ELSE
    RAISE NOTICE '⊘ contract_role enum already exists — skipping.';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 3: Create user_contract_roles table
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_contract_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who
  user_id       UUID NOT NULL
                  REFERENCES profiles(id) ON DELETE CASCADE,

  -- Which contract
  contract_id   UUID NOT NULL
                  REFERENCES contracts(id) ON DELETE CASCADE,

  -- What role on this contract
  contract_role contract_role NOT NULL,

  -- Audit fields
  assigned_by   UUID REFERENCES profiles(id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft-delete: deactivate revokes access without losing history
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  -- Optional notes (e.g., "Assigned during project kickoff")
  notes         TEXT,

  -- One role per user per contract
  UNIQUE (user_id, contract_id)
);

COMMENT ON TABLE user_contract_roles IS
  'Contract-scoped role assignments. Each row grants a user a specific role '
  'on a specific contract. Replaces the single profiles.role + user_contracts '
  'model for permission checks. Director role remains global via profiles.role.';

COMMENT ON COLUMN user_contract_roles.contract_role IS
  'The role this user holds on this contract: contractor, supervisor, auditor, reviewer, or viewer.';

COMMENT ON COLUMN user_contract_roles.is_active IS
  'Soft-delete flag. Setting to FALSE immediately revokes contract access without losing audit history.';


-- ─────────────────────────────────────────────────────────────────
--  PHASE 4: Performance indexes
-- ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ucr_user_id
  ON user_contract_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_ucr_contract_id
  ON user_contract_roles(contract_id);

CREATE INDEX IF NOT EXISTS idx_ucr_role
  ON user_contract_roles(contract_role);

-- Composite index for the most common query pattern:
-- "What active role does user X have on contract Y?"
CREATE INDEX IF NOT EXISTS idx_ucr_user_contract_active
  ON user_contract_roles(user_id, contract_id)
  WHERE is_active = TRUE;

-- Composite index for listing:
-- "All active users on contract Y"
CREATE INDEX IF NOT EXISTS idx_ucr_contract_active
  ON user_contract_roles(contract_id)
  WHERE is_active = TRUE;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 5: Enable RLS
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE user_contract_roles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running (idempotency)
DROP POLICY IF EXISTS "ucr_internal_select" ON user_contract_roles;
DROP POLICY IF EXISTS "ucr_own_select" ON user_contract_roles;
DROP POLICY IF EXISTS "ucr_director_manage" ON user_contract_roles;

-- Policy: Internal users (director, admin, reviewer) can read all role assignments
CREATE POLICY "ucr_internal_select"
  ON user_contract_roles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('director', 'admin', 'reviewer')
    )
  );

-- Policy: External users can see their own role assignments
CREATE POLICY "ucr_own_select"
  ON user_contract_roles FOR SELECT
  USING (user_id = auth.uid());

-- Policy: Only director can manage (INSERT/UPDATE/DELETE) role assignments
CREATE POLICY "ucr_director_manage"
  ON user_contract_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'director'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'director'
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  PHASE 6: SQL helper functions (SECURITY DEFINER)
--
--  These functions will be used by RLS policies in Sprint B.
--  Created now so they can be tested independently.
--  SECURITY DEFINER = executes with the function owner's
--  privileges (bypasses RLS to avoid infinite recursion).
-- ─────────────────────────────────────────────────────────────────

-- 6A. Check if current user has a specific role on a contract
CREATE OR REPLACE FUNCTION has_contract_role(
  _contract_id UUID,
  _role contract_role
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_contract_roles
    WHERE user_id       = auth.uid()
      AND contract_id   = _contract_id
      AND contract_role = _role
      AND is_active     = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_contract_role(UUID, contract_role) IS
  'Returns TRUE if the current authenticated user has the specified '
  'contract_role on the given contract and the assignment is active.';


-- 6B. Check if current user has ANY active role on a contract
CREATE OR REPLACE FUNCTION has_contract_access(
  _contract_id UUID
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_contract_roles
    WHERE user_id     = auth.uid()
      AND contract_id = _contract_id
      AND is_active   = TRUE
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_contract_access(UUID) IS
  'Returns TRUE if the current authenticated user has any active '
  'role assignment on the given contract (scope check).';


-- 6C. Get the user's role on a specific contract (or NULL)
CREATE OR REPLACE FUNCTION get_contract_role(
  _contract_id UUID
) RETURNS contract_role AS $$
  SELECT contract_role FROM user_contract_roles
  WHERE user_id     = auth.uid()
    AND contract_id = _contract_id
    AND is_active   = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_contract_role(UUID) IS
  'Returns the contract_role for the current user on the given contract, '
  'or NULL if no active assignment exists.';


-- ─────────────────────────────────────────────────────────────────
--  PHASE 7: Seed data from user_contracts + profiles.role
--
--  This copies existing role assignments into the new table.
--  The mapping is:
--    profiles.role  →  contract_role
--    ─────────────     ──────────────
--    contractor     →  contractor
--    consultant     →  supervisor
--    admin          →  auditor
--    reviewer       →  reviewer
--    director       →  (SKIPPED — global role, not contract-scoped)
--
--  Data sources:
--    1. user_contracts table (user_id + contract_id pairs)
--    2. profiles table (role for each user)
--    3. contracts table (admin_id, reviewer_id for implicit assignments)
--
--  ON CONFLICT DO NOTHING: safe for re-runs.
-- ─────────────────────────────────────────────────────────────────

-- 7A. Seed from user_contracts + profiles.role
--     This covers contractor and consultant/supervisor assignments
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  uc.user_id,
  uc.contract_id,
  CASE p.role
    WHEN 'contractor'  THEN 'contractor'::contract_role
    WHEN 'consultant'  THEN 'supervisor'::contract_role
    WHEN 'admin'       THEN 'auditor'::contract_role
    WHEN 'reviewer'    THEN 'reviewer'::contract_role
    ELSE                    'viewer'::contract_role
  END,
  'Migrated from user_contracts + profiles.role (migration 025)'
FROM user_contracts uc
JOIN profiles p ON p.id = uc.user_id
WHERE p.role != 'director'  -- Director is global, skip
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7B. Seed from contracts.admin_id (auditor assignments)
--     These may not exist in user_contracts yet
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.admin_id,
  c.id,
  'auditor'::contract_role,
  'Migrated from contracts.admin_id (migration 025)'
FROM contracts c
WHERE c.admin_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7C. Seed from contracts.reviewer_id (reviewer assignments)
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.reviewer_id,
  c.id,
  'reviewer'::contract_role,
  'Migrated from contracts.reviewer_id (migration 025)'
FROM contracts c
WHERE c.reviewer_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;

-- 7D. Seed from contracts.external_user_id (contractor assignments)
--     Safety net — should already be covered by 7A via user_contracts
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, notes)
SELECT
  c.external_user_id,
  c.id,
  'contractor'::contract_role,
  'Migrated from contracts.external_user_id (migration 025)'
FROM contracts c
WHERE c.external_user_id IS NOT NULL
ON CONFLICT (user_id, contract_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  PHASE 8: Audit log entry (safe — will NOT block migration)
--
--  Production audit_logs schema (from migration 001):
--    action: audit_action ENUM (create|update|...), NOT free text
--    entity_type: TEXT (e.g. 'claim', 'contract')
--    entity_id: UUID
--    old_values / new_values: JSONB
--    metadata: JSONB
-- ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs')
  THEN
    INSERT INTO audit_logs (
      action,
      entity_type,
      entity_id,
      entity_label,
      old_values,
      new_values,
      metadata
    ) VALUES (
      'create'::audit_action,
      'user_contract_roles',
      gen_random_uuid(),
      'Migration 025 — Contract-Scoped Roles',
      NULL,
      jsonb_build_object(
        'migration', '025_contract_scoped_roles',
        'description', 'Created contract_role enum + user_contract_roles table + helper functions + seeded data',
        'executed_at', NOW()::text
      ),
      jsonb_build_object('source', 'migration', 'version', '025')
    );
    RAISE NOTICE '✓ Audit log entry created.';
  ELSE
    RAISE NOTICE '⊘ audit_logs table not found — skipping audit entry.';
  END IF;
EXCEPTION
  WHEN undefined_column OR undefined_table OR invalid_text_representation THEN
    RAISE NOTICE '⊘ audit_logs schema mismatch — skipping audit entry (non-blocking).';
  WHEN OTHERS THEN
    RAISE NOTICE '⊘ audit_logs insert failed: % — skipping (non-blocking).', SQLERRM;
END $$;


-- ═══════════════════════════════════════════════════════════════════
--  VERIFICATION QUERIES
--  Run these after applying the migration to confirm correctness.
-- ═══════════════════════════════════════════════════════════════════


-- ── V1: Confirm enum exists with correct values ──────────────────
SELECT
  t.typname AS enum_name,
  e.enumlabel AS value,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public' AND t.typname = 'contract_role'
ORDER BY e.enumsortorder;


-- ── V2: Confirm table structure ──────────────────────────────────
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_contract_roles'
ORDER BY ordinal_position;


-- ── V3: Row count ────────────────────────────────────────────────
SELECT COUNT(*) AS total_rows FROM user_contract_roles;


-- ── V4: Seeded data detail — who has what role on which contract ─
SELECT
  ucr.user_id,
  p.full_name_ar                      AS user_name,
  p.role::TEXT                         AS old_global_role,
  c.contract_no,
  SUBSTRING(c.title_ar, 1, 40)        AS contract_title,
  ucr.contract_role::TEXT              AS new_contract_role,
  ucr.is_active,
  ucr.notes
FROM user_contract_roles ucr
JOIN profiles p ON p.id = ucr.user_id
JOIN contracts c ON c.id = ucr.contract_id
ORDER BY c.contract_no, ucr.contract_role;


-- ── V5: Role mapping validation ──────────────────────────────────
-- Every row should show matching old→new role mapping
SELECT
  p.role::TEXT                         AS old_role,
  ucr.contract_role::TEXT              AS new_role,
  CASE
    WHEN p.role = 'contractor'  AND ucr.contract_role = 'contractor'  THEN '✓ correct'
    WHEN p.role = 'consultant'  AND ucr.contract_role = 'supervisor'  THEN '✓ correct'
    WHEN p.role = 'admin'       AND ucr.contract_role = 'auditor'     THEN '✓ correct'
    WHEN p.role = 'reviewer'    AND ucr.contract_role = 'reviewer'    THEN '✓ correct'
    ELSE '✗ UNEXPECTED MAPPING'
  END AS mapping_status,
  COUNT(*) AS count
FROM user_contract_roles ucr
JOIN profiles p ON p.id = ucr.user_id
GROUP BY p.role, ucr.contract_role,
  CASE
    WHEN p.role = 'contractor'  AND ucr.contract_role = 'contractor'  THEN '✓ correct'
    WHEN p.role = 'consultant'  AND ucr.contract_role = 'supervisor'  THEN '✓ correct'
    WHEN p.role = 'admin'       AND ucr.contract_role = 'auditor'     THEN '✓ correct'
    WHEN p.role = 'reviewer'    AND ucr.contract_role = 'reviewer'    THEN '✓ correct'
    ELSE '✗ UNEXPECTED MAPPING'
  END
ORDER BY old_role;


-- ── V6: Cross-check with user_contracts (no orphans) ─────────────
-- Every row in user_contracts for non-director users should have
-- a corresponding row in user_contract_roles
SELECT
  uc.user_id,
  p.full_name_ar,
  p.role::TEXT AS global_role,
  uc.contract_id,
  c.contract_no,
  CASE WHEN ucr.id IS NOT NULL THEN '✓ migrated' ELSE '✗ MISSING' END AS status
FROM user_contracts uc
JOIN profiles p ON p.id = uc.user_id
JOIN contracts c ON c.id = uc.contract_id
LEFT JOIN user_contract_roles ucr
  ON ucr.user_id = uc.user_id
  AND ucr.contract_id = uc.contract_id
WHERE p.role != 'director'
ORDER BY c.contract_no, p.role;


-- ── V7: Verify helper functions exist ────────────────────────────
SELECT
  routine_name,
  routine_type,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('has_contract_role', 'has_contract_access', 'get_contract_role')
ORDER BY routine_name;


-- ── V8: RLS is enabled on new table ─────────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'user_contract_roles';


-- ── V9: Policies on new table ────────────────────────────────────
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  SUBSTRING(qual::TEXT, 1, 80) AS using_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_contract_roles'
ORDER BY policyname;


-- ── V10: Confirm NO existing policies were modified ──────────────
-- Spot-check: contracts and claims policies should be unchanged
SELECT
  tablename,
  policyname,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contracts', 'claims')
ORDER BY tablename, policyname;


-- ════════════════════════════════════════════════════════════════════
--  STEP 23  —  MIGRATION  —  seq=026
--  Source: legacy: migrations/026_rls_contract_scoped_roles.sql
--  Reason: RLS for contract-scoped roles
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 026: RLS Migration to Contract-Scoped Roles (Sprint C)
--  CONVERA — وزارة البلديات والإسكان
--
--  PURPOSE:
--    Make user_contract_roles the AUTHORITATIVE source for
--    contract-level access at the database (RLS) layer.
--
--  ARCHITECTURE CHANGE:
--    BEFORE: user_contracts + profiles.role → permissive global policies
--    AFTER:  user_contract_roles → contract-scoped policies
--
--    Director: global access (only role NOT contract-scoped)
--    Auditor (admin):   scoped via has_contract_role(contract_id, 'auditor')
--    Reviewer:          scoped via has_contract_role(contract_id, 'reviewer')
--    Supervisor (consultant): scoped via has_contract_role(contract_id, 'supervisor')
--    Contractor:        scoped via has_contract_role(contract_id, 'contractor')
--    Viewer:            read-only via has_contract_access(contract_id)
--
--  TABLES MODIFIED (12):
--    contracts, claims, claim_workflow, documents,
--    change_orders, change_order_boq_items, change_order_staff_items,
--    change_order_workflow, contract_boq_templates, contract_staff_templates,
--    contract_amendments, kpi_snapshots
--
--  TABLES UNCHANGED (relies on parent RLS piggybacking):
--    claim_boq_items, claim_staff_items
--    (their SELECT uses `claim_id IN (SELECT id FROM claims)` which
--     is automatically filtered by the new claims RLS policies)
--
--  TABLES UNAFFECTED:
--    profiles, audit_logs, notifications, user_contracts,
--    user_contract_roles, convera_users, convera_otp
--
--  HELPER FUNCTIONS USED:
--    has_contract_access(UUID)           — from migration 025
--    has_contract_role(UUID, contract_role) — from migration 025
--    get_contract_role(UUID)             — from migration 025
--    is_director()                       — NEW (created in this migration)
--
--  ROLLBACK:
--    This migration is designed with a companion rollback section at the
--    bottom. To revert: run the rollback SQL, then re-apply migrations
--    019, 020, 023 to restore the legacy user_contracts-based policies.
--
--  IDEMPOTENT: All statements use DROP IF EXISTS before CREATE.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;


-- ════════════════════════════════════════════════════════════════════
--  PHASE 0 — New helper function: is_director()
--
--  Unlike is_internal() (which includes admin + reviewer), this
--  returns TRUE only for the director role — the ONLY truly global
--  role in the contract-scoped architecture.
--
--  SECURITY DEFINER: bypasses RLS on profiles to avoid recursion.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_director()
RETURNS BOOLEAN AS $$
  SELECT (SELECT role FROM profiles WHERE id = auth.uid()) = 'director';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION is_director() IS
  'Returns TRUE only for the director role. Unlike is_internal() which '
  'includes admin+reviewer, this is for the only truly global role in '
  'the contract-scoped architecture. Created by migration 026.';


-- ════════════════════════════════════════════════════════════════════
--  PHASE 1 — contracts
--
--  DROPPED (4):
--    contracts_internal_all      (001) — is_internal() → too broad
--    contracts_internal_select   (020) — role IN (dir,admin,rev) → too broad
--    contracts_contractor_select (019) — profiles.role + user_contracts
--    contracts_consultant_select (019) — profiles.role + user_contracts
--
--  CREATED (2):
--    contracts_director_all      — director global access
--    contracts_scoped_select     — anyone with active role on contract
-- ════════════════════════════════════════════════════════════════════

-- Drop legacy policies
DROP POLICY IF EXISTS "contracts_internal_all"      ON contracts;
DROP POLICY IF EXISTS "contracts_internal_select"   ON contracts;
DROP POLICY IF EXISTS "contracts_contractor_select" ON contracts;
DROP POLICY IF EXISTS "contracts_consultant_select" ON contracts;
-- Defensive: drop any stale policies that might exist from earlier migrations
DROP POLICY IF EXISTS "contracts_external_select_own" ON contracts;
DROP POLICY IF EXISTS "contracts_supervisor_select"   ON contracts;
DROP POLICY IF EXISTS "contracts_auth_read"           ON contracts;

-- Director: full global access to all contracts
CREATE POLICY "contracts_director_all"
  ON contracts FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped: anyone with active contract_role can SELECT their assigned contracts
CREATE POLICY "contracts_scoped_select"
  ON contracts FOR SELECT
  USING (has_contract_access(id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 2 — claims
--
--  DROPPED (9):
--    claims_internal_all        (001) — is_internal() → too broad
--    claims_internal_select     (020) — role IN (dir,admin,rev) → too broad
--    claims_contractor_select   (019) — profiles.role + user_contracts
--    claims_contractor_insert   (019) — profiles.role + user_contracts
--    claims_contractor_update   (019) — profiles.role + user_contracts
--    claims_consultant_select   (019) — profiles.role + user_contracts
--    claims_consultant_update   (019) — profiles.role + user_contracts
--    claims_admin_update        (012) — profiles.role = admin (no scope)
--    claims_reviewer_update     (012) — profiles.role = reviewer (no scope)
--    claims_director_update     (012) — replaced by director_all
--
--  CREATED (7):
--    claims_director_all        — director global access
--    claims_scoped_select       — anyone with contract role can read
--    claims_contractor_insert   — contractor creates claims
--    claims_contractor_update   — contractor edits draft/returned claims
--    claims_supervisor_update   — supervisor reviews at their stage
--    claims_auditor_update      — auditor reviews at their stage
--    claims_reviewer_update     — reviewer reviews at their stage
--
--  NOTE: Director UPDATE is covered by claims_director_all.
-- ════════════════════════════════════════════════════════════════════

-- Drop legacy policies
DROP POLICY IF EXISTS "claims_internal_all"        ON claims;
DROP POLICY IF EXISTS "claims_internal_select"     ON claims;
DROP POLICY IF EXISTS "claims_contractor_select"   ON claims;
DROP POLICY IF EXISTS "claims_contractor_insert"   ON claims;
DROP POLICY IF EXISTS "claims_contractor_update"   ON claims;
DROP POLICY IF EXISTS "claims_consultant_select"   ON claims;
DROP POLICY IF EXISTS "claims_consultant_update"   ON claims;
DROP POLICY IF EXISTS "claims_admin_update"        ON claims;
DROP POLICY IF EXISTS "claims_reviewer_update"     ON claims;
DROP POLICY IF EXISTS "claims_director_update"     ON claims;
-- Defensive: stale policies from earlier migrations
DROP POLICY IF EXISTS "claims_external_select"          ON claims;
DROP POLICY IF EXISTS "claims_external_insert"          ON claims;
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;
DROP POLICY IF EXISTS "claims_supervisor_select"        ON claims;
DROP POLICY IF EXISTS "claims_auth_read"                ON claims;

-- Director: full global access to all claims
CREATE POLICY "claims_director_all"
  ON claims FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped: anyone with active contract_role can SELECT claims on their contracts
CREATE POLICY "claims_scoped_select"
  ON claims FOR SELECT
  USING (has_contract_access(contract_id));

-- Contractor: INSERT new claims on their assigned contracts (active contracts only)
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = claims.contract_id
        AND c.status = 'active'
    )
  );

-- Contractor: UPDATE own draft/returned claims
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND status IN (
      'draft',
      'returned_by_supervisor',
      'returned_by_auditor',
      'returned_by_consultant',
      'returned_by_admin'
    )
  )
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
  );

-- Supervisor: UPDATE claims at supervisor review stage
CREATE POLICY "claims_supervisor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'supervisor')
    AND status IN ('submitted', 'under_supervisor_review')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'supervisor')
  );

-- Auditor: UPDATE claims at auditor review stage
CREATE POLICY "claims_auditor_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'auditor')
    AND status IN ('under_auditor_review')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'auditor')
  );

-- Reviewer: UPDATE claims at reviewer check stage
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING (
    has_contract_role(contract_id, 'reviewer')
    AND status IN ('under_reviewer_check')
  )
  WITH CHECK (
    has_contract_role(contract_id, 'reviewer')
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 3 — claim_workflow
--
--  DROPPED (4):
--    workflow_internal_all         (001) — is_internal() → too broad
--    workflow_external_select      (001) — external_user_id (deprecated)
--    workflow_external_insert      (002) — external_user_id (deprecated)
--    claim_workflow_roles_insert   (012) — profiles.role IN (...) no scope
--
--  CREATED (3):
--    claim_workflow_director_all    — director global access
--    claim_workflow_scoped_select   — piggybacks on claims RLS
--    claim_workflow_scoped_insert   — actor_id check + claims RLS
--
--  NOTE: Internal review/approve/reject entries are written via
--  service role (bypasses RLS). These policies cover direct user
--  inserts (submit, resubmit, comment) and internal SELECT.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "workflow_internal_all"       ON claim_workflow;
DROP POLICY IF EXISTS "workflow_external_select"    ON claim_workflow;
DROP POLICY IF EXISTS "workflow_external_insert"    ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_roles_insert" ON claim_workflow;
-- Defensive
DROP POLICY IF EXISTS "claim_workflow_director_all"   ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_select"  ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_insert"  ON claim_workflow;

-- Director: full global access
CREATE POLICY "claim_workflow_director_all"
  ON claim_workflow FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: piggybacks on claims RLS — if you can see the claim,
-- you can see its workflow history.
CREATE POLICY "claim_workflow_scoped_select"
  ON claim_workflow FOR SELECT
  USING (
    claim_id IN (SELECT id FROM claims)
  );

-- Scoped INSERT: user must be the actor and must have access to the claim's contract.
-- Action validation (submit/approve/return/reject) enforced at API layer.
CREATE POLICY "claim_workflow_scoped_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND claim_id IN (SELECT id FROM claims)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 4 — documents
--
--  DROPPED (4):
--    documents_internal_all      (023) — is_internal() → too broad
--    documents_external_select   (023) — user_contracts scoping
--    documents_external_insert   (023) — user_contracts scoping
--    documents_external_delete   (023) — user_contracts scoping
--
--  CREATED (4):
--    documents_director_all       — director global access
--    documents_scoped_select      — contract-scoped via claim/contract FK
--    documents_scoped_insert      — contract-scoped with state checks
--    documents_scoped_delete      — own docs on draft claims only
--
--  NOTE: documents.claim_id → claims.contract_id (XOR)
--        documents.contract_id → direct contract link
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "documents_internal_all"    ON documents;
DROP POLICY IF EXISTS "documents_external_select" ON documents;
DROP POLICY IF EXISTS "documents_external_insert" ON documents;
DROP POLICY IF EXISTS "documents_external_delete" ON documents;
-- Defensive: stale policies from earlier migrations
DROP POLICY IF EXISTS "public_all_documents"      ON documents;
DROP POLICY IF EXISTS "documents_auth_read"       ON documents;
DROP POLICY IF EXISTS "documents_view"            ON documents;
DROP POLICY IF EXISTS "documents_insert"          ON documents;
-- Defensive: our own names in case of re-run
DROP POLICY IF EXISTS "documents_director_all"    ON documents;
DROP POLICY IF EXISTS "documents_scoped_select"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_insert"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_delete"   ON documents;

-- Director: full global access
CREATE POLICY "documents_director_all"
  ON documents FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: claim documents accessible via claims RLS piggybacking;
-- contract documents accessible via has_contract_access.
CREATE POLICY "documents_scoped_select"
  ON documents FOR SELECT
  USING (
    (claim_id IS NOT NULL AND claim_id IN (SELECT id FROM claims))
    OR
    (contract_id IS NOT NULL AND has_contract_access(contract_id))
  );

-- Scoped INSERT: own uploads on accessible claims (editable states) or contracts
CREATE POLICY "documents_scoped_insert"
  ON documents FOR INSERT
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND claim_id IN (
        SELECT id FROM claims
        WHERE status IN (
          'draft', 'returned_by_supervisor', 'returned_by_auditor',
          'returned_by_consultant', 'returned_by_admin',
          'submitted', 'under_supervisor_review', 'under_auditor_review',
          'under_reviewer_check', 'pending_director_approval'
        )
      ))
      OR
      (contract_id IS NOT NULL AND has_contract_access(contract_id))
    )
  );

-- Scoped DELETE: own uploads on draft claims only, or own contract docs
CREATE POLICY "documents_scoped_delete"
  ON documents FOR DELETE
  USING (
    uploaded_by = auth.uid()
    AND (
      (claim_id IS NOT NULL AND claim_id IN (
        SELECT id FROM claims WHERE status = 'draft'
      ))
      OR
      (contract_id IS NOT NULL AND has_contract_access(contract_id))
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 5 — change_orders
--
--  DROPPED (4):
--    co_internal_all              (003) — is_internal() → too broad
--    change_orders_internal_select (020) — role IN (...) → too broad
--    co_external_select           (023) — user_contracts
--    co_external_insert           (023) — user_contracts
--    co_external_update_draft     (023) — user_contracts
--
--  CREATED (4):
--    co_director_all              — director global access
--    co_scoped_select             — contract-scoped read
--    co_contractor_insert         — contractor creates COs
--    co_scoped_update_draft       — creator/submitter updates draft COs
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_internal_all"              ON change_orders;
DROP POLICY IF EXISTS "change_orders_internal_select" ON change_orders;
DROP POLICY IF EXISTS "co_external_select"           ON change_orders;
DROP POLICY IF EXISTS "co_external_insert"           ON change_orders;
DROP POLICY IF EXISTS "co_external_update_draft"     ON change_orders;
-- Defensive
DROP POLICY IF EXISTS "co_director_all"              ON change_orders;
DROP POLICY IF EXISTS "co_scoped_select"             ON change_orders;
DROP POLICY IF EXISTS "co_contractor_insert"         ON change_orders;
DROP POLICY IF EXISTS "co_scoped_update_draft"       ON change_orders;

-- Director: full global access
CREATE POLICY "co_director_all"
  ON change_orders FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: anyone with contract access
CREATE POLICY "co_scoped_select"
  ON change_orders FOR SELECT
  USING (has_contract_access(contract_id));

-- Contractor INSERT: create draft COs on active contracts they're assigned to
CREATE POLICY "co_contractor_insert"
  ON change_orders FOR INSERT
  WITH CHECK (
    has_contract_role(contract_id, 'contractor')
    AND created_by = auth.uid()
    AND status = 'draft'
    AND EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = change_orders.contract_id
        AND c.status = 'active'
    )
  );

-- Scoped UPDATE: creator/submitter can update their own draft COs
CREATE POLICY "co_scoped_update_draft"
  ON change_orders FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND has_contract_access(contract_id)
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status = 'draft'
    AND has_contract_access(contract_id)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 6 — change_order_boq_items
--
--  DROPPED (5):
--    co_boq_internal_all      (003) — is_internal() → too broad
--    co_boq_external_select   (003) — external_user_id (deprecated)
--    co_boq_external_insert   (003) — external_user_id (deprecated)
--    co_boq_external_update   (003) — external_user_id (deprecated)
--    co_boq_external_delete   (003) — external_user_id (deprecated)
--
--  CREATED (5):
--    Piggybacks on change_orders RLS via subquery pattern.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_boq_internal_all"    ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_select" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_insert" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_update" ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_external_delete" ON change_order_boq_items;
-- Defensive: our own names
DROP POLICY IF EXISTS "co_boq_director_all"    ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_select"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_insert"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_update"   ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_delete"   ON change_order_boq_items;

-- Director: full global access
CREATE POLICY "co_boq_director_all"
  ON change_order_boq_items FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

-- Scoped SELECT: piggybacks on change_orders RLS
CREATE POLICY "co_boq_scoped_select"
  ON change_order_boq_items FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

-- Scoped INSERT: only on accessible draft COs
CREATE POLICY "co_boq_scoped_insert"
  ON change_order_boq_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

-- Scoped UPDATE: only on accessible draft COs
CREATE POLICY "co_boq_scoped_update"
  ON change_order_boq_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

-- Scoped DELETE: only on accessible draft COs
CREATE POLICY "co_boq_scoped_delete"
  ON change_order_boq_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 7 — change_order_staff_items (same pattern as Phase 6)
--
--  DROPPED (5): co_staff_internal_all, co_staff_external_*
--  CREATED (5): co_staff_director_all, co_staff_scoped_*
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_staff_internal_all"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_select" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_insert" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_update" ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_external_delete" ON change_order_staff_items;
-- Defensive
DROP POLICY IF EXISTS "co_staff_director_all"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_select"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_insert"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_update"   ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_delete"   ON change_order_staff_items;

CREATE POLICY "co_staff_director_all"
  ON change_order_staff_items FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "co_staff_scoped_select"
  ON change_order_staff_items FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

CREATE POLICY "co_staff_scoped_insert"
  ON change_order_staff_items FOR INSERT
  WITH CHECK (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

CREATE POLICY "co_staff_scoped_update"
  ON change_order_staff_items FOR UPDATE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );

CREATE POLICY "co_staff_scoped_delete"
  ON change_order_staff_items FOR DELETE
  USING (
    change_order_id IN (
      SELECT id FROM change_orders WHERE status = 'draft'
    )
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 8 — change_order_workflow
--
--  DROPPED (3):
--    co_workflow_internal_all     (003) — is_internal() → too broad
--    co_workflow_external_select  (003) — external_user_id (deprecated)
--    co_workflow_external_insert  (003) — external_user_id (deprecated)
--
--  CREATED (3):
--    Piggybacks on change_orders RLS via subquery pattern.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "co_workflow_internal_all"    ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_external_select" ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_external_insert" ON change_order_workflow;
-- Defensive
DROP POLICY IF EXISTS "co_workflow_director_all"    ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_select"   ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_insert"   ON change_order_workflow;

CREATE POLICY "co_workflow_director_all"
  ON change_order_workflow FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "co_workflow_scoped_select"
  ON change_order_workflow FOR SELECT
  USING (
    change_order_id IN (SELECT id FROM change_orders)
  );

-- INSERT: actor must be self, and must have access to the CO's contract
CREATE POLICY "co_workflow_scoped_insert"
  ON change_order_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND change_order_id IN (SELECT id FROM change_orders)
  );


-- ════════════════════════════════════════════════════════════════════
--  PHASE 9 — contract_boq_templates + contract_staff_templates
--
--  DROPPED (4):
--    boq_tmpl_internal_all      (004) — is_internal() → too broad
--    boq_tmpl_external_select   (004) — external_user_id (deprecated)
--    staff_tmpl_internal_all    (004) — is_internal() → too broad
--    staff_tmpl_external_select (004) — external_user_id (deprecated)
--
--  CREATED (4):
--    Templates are read-only for non-directors. Director manages them.
-- ════════════════════════════════════════════════════════════════════

-- contract_boq_templates
DROP POLICY IF EXISTS "boq_tmpl_internal_all"    ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_external_select" ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_director_all"    ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_scoped_select"   ON contract_boq_templates;

CREATE POLICY "boq_tmpl_director_all"
  ON contract_boq_templates FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "boq_tmpl_scoped_select"
  ON contract_boq_templates FOR SELECT
  USING (has_contract_access(contract_id));

-- contract_staff_templates
DROP POLICY IF EXISTS "staff_tmpl_internal_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_external_select" ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_director_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_scoped_select"   ON contract_staff_templates;

CREATE POLICY "staff_tmpl_director_all"
  ON contract_staff_templates FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "staff_tmpl_scoped_select"
  ON contract_staff_templates FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 10 — contract_amendments
--
--  DROPPED (2):
--    amendments_internal_select  (023) — is_internal() → too broad for read
--    amendments_external_select  (023) — user_contracts
--
--  KEPT (2, unchanged):
--    amendments_insert_admin     (007) — auth_role() IN (director,admin)
--    amendments_update_director  (007) — auth_role() = director
--
--  CREATED (2):
--    amendments_director_all     — director full access
--    amendments_scoped_select    — contract-scoped read
--
--  NOTE: INSERT/UPDATE policies from 007 are kept because they use
--  auth_role() and are for internal-only operations. Amendment
--  creation is an admin/director function, not a contract-role check.
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "amendments_internal_select" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_external_select" ON contract_amendments;
DROP POLICY IF EXISTS "amendments_select_all"      ON contract_amendments;
-- Defensive
DROP POLICY IF EXISTS "amendments_director_all"    ON contract_amendments;
DROP POLICY IF EXISTS "amendments_scoped_select"   ON contract_amendments;

CREATE POLICY "amendments_director_all"
  ON contract_amendments FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "amendments_scoped_select"
  ON contract_amendments FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 11 — kpi_snapshots
--
--  DROPPED (4):
--    kpi_internal_all                (001) — is_internal() → too broad
--    kpi_external_own                (001) — external_user_id (deprecated)
--    kpi_snapshots_internal_select   (010/020) — role-based, no scope
--    kpi_snapshots_supervisor_select (010) — user_contracts
--
--  CREATED (2):
--    kpi_director_all                — director full access
--    kpi_scoped_select               — contract-scoped read
-- ════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "kpi_internal_all"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_external_own"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_snapshots_internal_select"   ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_snapshots_supervisor_select" ON kpi_snapshots;
-- Defensive
DROP POLICY IF EXISTS "kpi_director_all"                ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_scoped_select"               ON kpi_snapshots;

CREATE POLICY "kpi_director_all"
  ON kpi_snapshots FOR ALL
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "kpi_scoped_select"
  ON kpi_snapshots FOR SELECT
  USING (has_contract_access(contract_id));


-- ════════════════════════════════════════════════════════════════════
--  PHASE 12 — Audit log entry
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_logs')
  THEN
    INSERT INTO audit_logs (
      action, entity_type, entity_id, entity_label,
      old_values, new_values, metadata
    ) VALUES (
      'create'::audit_action,
      'rls_policies',
      gen_random_uuid(),
      'Migration 026 — RLS Contract-Scoped Roles',
      NULL,
      jsonb_build_object(
        'migration', '026_rls_contract_scoped_roles',
        'description', 'Replaced user_contracts + profiles.role RLS with user_contract_roles-based policies',
        'tables_modified', 12,
        'policies_dropped', 42,
        'policies_created', 36,
        'executed_at', NOW()::text
      ),
      jsonb_build_object('source', 'migration', 'version', '026')
    );
    RAISE NOTICE '✓ Audit log entry created for migration 026.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '⊘ audit_logs insert failed: % — skipping (non-blocking).', SQLERRM;
END $$;


COMMIT;


-- ════════════════════════════════════════════════════════════════════
--  VERIFICATION QUERIES (run after COMMIT)
-- ════════════════════════════════════════════════════════════════════


-- ── V1: Complete policy inventory — all modified tables ────────────
SELECT
  tablename,
  policyname,
  cmd,
  permissive,
  LEFT(qual, 100)       AS using_clause,
  LEFT(with_check, 100) AS check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
ORDER BY tablename, policyname;


-- ── V2: ZERO legacy policies should remain ─────────────────────────
-- Checks for: is_internal(), user_contracts, external_user_id, auth.uid() IS NOT NULL, (true)
SELECT
  tablename,
  policyname,
  'LEGACY/OPEN POLICY FOUND' AS warning
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
  AND (
    qual LIKE '%is_internal()%'
    OR qual LIKE '%user_contracts%'
    OR qual LIKE '%external_user_id%'
    OR qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  );
-- EXPECTED: 0 rows


-- ── V3: Confirm new helper function exists ─────────────────────────
SELECT
  routine_name,
  security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('is_director', 'has_contract_access', 'has_contract_role', 'get_contract_role')
ORDER BY routine_name;
-- EXPECTED: 4 rows, all DEFINER


-- ── V4: Policy count per table ─────────────────────────────────────
SELECT
  tablename,
  COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'contracts', 'claims', 'claim_workflow', 'documents',
    'change_orders', 'change_order_boq_items', 'change_order_staff_items',
    'change_order_workflow', 'contract_boq_templates', 'contract_staff_templates',
    'contract_amendments', 'kpi_snapshots'
  )
GROUP BY tablename
ORDER BY tablename;
-- EXPECTED:
--   contracts:                    2  (director_all, scoped_select)
--   claims:                       7  (director_all, scoped_select, contractor_insert/update, supervisor/auditor/reviewer_update)
--   claim_workflow:               3  (director_all, scoped_select, scoped_insert)
--   documents:                    4  (director_all, scoped_select/insert/delete)
--   change_orders:                4  (director_all, scoped_select, contractor_insert, scoped_update_draft)
--   change_order_boq_items:       5  (director_all, scoped_select/insert/update/delete)
--   change_order_staff_items:     5  (director_all, scoped_select/insert/update/delete)
--   change_order_workflow:        3  (director_all, scoped_select, scoped_insert)
--   contract_boq_templates:       2  (director_all, scoped_select)
--   contract_staff_templates:     2  (director_all, scoped_select)
--   contract_amendments:          4  (director_all, scoped_select, insert_admin, update_director)
--   kpi_snapshots:                2  (director_all, scoped_select)


-- ── V5: Unchanged tables — should still have their original policies ─
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'claim_boq_items', 'claim_staff_items',
    'profiles', 'audit_logs', 'notifications',
    'user_contracts', 'user_contract_roles'
  )
ORDER BY tablename, policyname;


-- ── V6: Confirm NO open/backdoor policies on ANY public table ──────
SELECT tablename, policyname, LEFT(qual, 80) AS condition
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual LIKE '%(true)%'
    OR qual LIKE '%auth.uid() IS NOT NULL%'
  )
ORDER BY tablename;
-- EXPECTED: Only convera_users and convera_otp (public by design for OTP flow)


-- ════════════════════════════════════════════════════════════════════
--  ROLLBACK SQL (run manually if needed to revert to pre-026 state)
--
--  After rollback, re-apply migrations 019, 020, 023 to restore
--  the legacy user_contracts-based policies.
-- ════════════════════════════════════════════════════════════════════

/*
-- ROLLBACK START —————————————————————————————————

BEGIN;

-- Phase 1: Drop all 026 policies on contracts
DROP POLICY IF EXISTS "contracts_director_all"    ON contracts;
DROP POLICY IF EXISTS "contracts_scoped_select"   ON contracts;

-- Phase 2: Drop all 026 policies on claims
DROP POLICY IF EXISTS "claims_director_all"       ON claims;
DROP POLICY IF EXISTS "claims_scoped_select"      ON claims;
DROP POLICY IF EXISTS "claims_contractor_insert"  ON claims;
DROP POLICY IF EXISTS "claims_contractor_update"  ON claims;
DROP POLICY IF EXISTS "claims_supervisor_update"  ON claims;
DROP POLICY IF EXISTS "claims_auditor_update"     ON claims;
DROP POLICY IF EXISTS "claims_reviewer_update"    ON claims;

-- Phase 3: Drop all 026 policies on claim_workflow
DROP POLICY IF EXISTS "claim_workflow_director_all"   ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_select"  ON claim_workflow;
DROP POLICY IF EXISTS "claim_workflow_scoped_insert"  ON claim_workflow;

-- Phase 4: Drop all 026 policies on documents
DROP POLICY IF EXISTS "documents_director_all"    ON documents;
DROP POLICY IF EXISTS "documents_scoped_select"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_insert"   ON documents;
DROP POLICY IF EXISTS "documents_scoped_delete"   ON documents;

-- Phase 5: Drop all 026 policies on change_orders
DROP POLICY IF EXISTS "co_director_all"           ON change_orders;
DROP POLICY IF EXISTS "co_scoped_select"          ON change_orders;
DROP POLICY IF EXISTS "co_contractor_insert"      ON change_orders;
DROP POLICY IF EXISTS "co_scoped_update_draft"    ON change_orders;

-- Phase 6: Drop all 026 policies on change_order_boq_items
DROP POLICY IF EXISTS "co_boq_director_all"       ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_select"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_insert"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_update"      ON change_order_boq_items;
DROP POLICY IF EXISTS "co_boq_scoped_delete"      ON change_order_boq_items;

-- Phase 7: Drop all 026 policies on change_order_staff_items
DROP POLICY IF EXISTS "co_staff_director_all"     ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_select"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_insert"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_update"    ON change_order_staff_items;
DROP POLICY IF EXISTS "co_staff_scoped_delete"    ON change_order_staff_items;

-- Phase 8: Drop all 026 policies on change_order_workflow
DROP POLICY IF EXISTS "co_workflow_director_all"   ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_select"  ON change_order_workflow;
DROP POLICY IF EXISTS "co_workflow_scoped_insert"  ON change_order_workflow;

-- Phase 9: Drop all 026 policies on templates
DROP POLICY IF EXISTS "boq_tmpl_director_all"      ON contract_boq_templates;
DROP POLICY IF EXISTS "boq_tmpl_scoped_select"     ON contract_boq_templates;
DROP POLICY IF EXISTS "staff_tmpl_director_all"    ON contract_staff_templates;
DROP POLICY IF EXISTS "staff_tmpl_scoped_select"   ON contract_staff_templates;

-- Phase 10: Drop all 026 policies on amendments
DROP POLICY IF EXISTS "amendments_director_all"    ON contract_amendments;
DROP POLICY IF EXISTS "amendments_scoped_select"   ON contract_amendments;

-- Phase 11: Drop all 026 policies on kpi_snapshots
DROP POLICY IF EXISTS "kpi_director_all"           ON kpi_snapshots;
DROP POLICY IF EXISTS "kpi_scoped_select"          ON kpi_snapshots;

-- Phase 12: Drop new helper function
DROP FUNCTION IF EXISTS is_director();

-- Phase 13: Restore legacy is_internal()-based policies
-- Re-apply from migrations 001, 019, 020, 023:

CREATE POLICY "contracts_internal_all"
  ON contracts FOR ALL USING (is_internal());
CREATE POLICY "contracts_internal_select"
  ON contracts FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "contracts_contractor_select"
  ON contracts FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contracts.id));
CREATE POLICY "contracts_consultant_select"
  ON contracts FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contracts.id));

CREATE POLICY "claims_internal_all"
  ON claims FOR ALL USING (is_internal());
CREATE POLICY "claims_internal_select"
  ON claims FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "claims_contractor_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_contractor_insert"
  ON claims FOR INSERT
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND EXISTS (SELECT 1 FROM user_contracts uc JOIN contracts c ON c.id = uc.contract_id
      WHERE uc.user_id = auth.uid() AND uc.contract_id = claims.contract_id AND c.status = 'active')
    AND created_by = auth.uid());
CREATE POLICY "claims_contractor_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor'
    AND created_by = auth.uid()
    AND status IN ('draft','returned_by_consultant','returned_by_admin','returned_by_supervisor','returned_by_auditor')
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'contractor' AND created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_consultant_select"
  ON claims FOR SELECT
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_consultant_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND status IN ('submitted','under_supervisor_review')
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'consultant'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = claims.contract_id));
CREATE POLICY "claims_admin_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin' AND status IN ('under_auditor_review'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
CREATE POLICY "claims_reviewer_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer' AND status IN ('under_reviewer_check'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'reviewer');
CREATE POLICY "claims_director_update"
  ON claims FOR UPDATE
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'director' AND status IN ('pending_director_approval'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'director');

CREATE POLICY "workflow_internal_all"
  ON claim_workflow FOR ALL USING (is_internal());
CREATE POLICY "workflow_external_select"
  ON claim_workflow FOR SELECT
  USING (claim_id IN (SELECT c.id FROM claims c JOIN contracts ct ON c.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "workflow_external_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (actor_id = auth.uid() AND action IN ('submit','resubmit','comment')
    AND claim_id IN (SELECT c.id FROM claims c JOIN contracts ct ON c.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "claim_workflow_roles_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('consultant','admin','reviewer','director','contractor'));

CREATE POLICY "documents_internal_all"
  ON documents FOR ALL USING (is_internal());
CREATE POLICY "documents_external_select"
  ON documents FOR SELECT
  USING ((claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid()))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id)));
CREATE POLICY "documents_external_insert"
  ON documents FOR INSERT
  WITH CHECK (uploaded_by = auth.uid() AND (
    (claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid() AND cl.status IN ('draft','returned_by_consultant','returned_by_admin','returned_by_supervisor','returned_by_auditor')))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id))));
CREATE POLICY "documents_external_delete"
  ON documents FOR DELETE
  USING (uploaded_by = auth.uid() AND (
    (claim_id IS NOT NULL AND EXISTS (SELECT 1 FROM claims cl JOIN user_contracts uc ON uc.contract_id = cl.contract_id WHERE cl.id = documents.claim_id AND uc.user_id = auth.uid() AND cl.status = 'draft'))
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = documents.contract_id))));

CREATE POLICY "co_internal_all"
  ON change_orders FOR ALL USING (is_internal());
CREATE POLICY "change_orders_internal_select"
  ON change_orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));
CREATE POLICY "co_external_select"
  ON change_orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id));
CREATE POLICY "co_external_insert"
  ON change_orders FOR INSERT
  WITH CHECK (created_by = auth.uid() AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts uc JOIN contracts c ON c.id = uc.contract_id WHERE uc.user_id = auth.uid() AND uc.contract_id = change_orders.contract_id AND c.status = 'active'));
CREATE POLICY "co_external_update_draft"
  ON change_orders FOR UPDATE
  USING ((created_by = auth.uid() OR submitted_by = auth.uid()) AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id))
  WITH CHECK ((created_by = auth.uid() OR submitted_by = auth.uid()) AND status = 'draft'
    AND EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = change_orders.contract_id));

CREATE POLICY "co_boq_internal_all" ON change_order_boq_items FOR ALL USING (is_internal());
CREATE POLICY "co_boq_external_select" ON change_order_boq_items FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_boq_external_insert" ON change_order_boq_items FOR INSERT
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_boq_external_update" ON change_order_boq_items FOR UPDATE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'))
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_boq_external_delete" ON change_order_boq_items FOR DELETE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));

CREATE POLICY "co_staff_internal_all" ON change_order_staff_items FOR ALL USING (is_internal());
CREATE POLICY "co_staff_external_select" ON change_order_staff_items FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_staff_external_insert" ON change_order_staff_items FOR INSERT
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_staff_external_update" ON change_order_staff_items FOR UPDATE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'))
  WITH CHECK (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));
CREATE POLICY "co_staff_external_delete" ON change_order_staff_items FOR DELETE
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid() AND co.status = 'draft'));

CREATE POLICY "co_workflow_internal_all" ON change_order_workflow FOR ALL USING (is_internal());
CREATE POLICY "co_workflow_external_select" ON change_order_workflow FOR SELECT
  USING (change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));
CREATE POLICY "co_workflow_external_insert" ON change_order_workflow FOR INSERT
  WITH CHECK (actor_id = auth.uid() AND action IN ('submit','comment')
    AND change_order_id IN (SELECT co.id FROM change_orders co JOIN contracts ct ON co.contract_id = ct.id WHERE ct.external_user_id = auth.uid()));

CREATE POLICY "boq_tmpl_internal_all" ON contract_boq_templates FOR ALL USING (is_internal());
CREATE POLICY "boq_tmpl_external_select" ON contract_boq_templates FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));
CREATE POLICY "staff_tmpl_internal_all" ON contract_staff_templates FOR ALL USING (is_internal());
CREATE POLICY "staff_tmpl_external_select" ON contract_staff_templates FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));

CREATE POLICY "amendments_internal_select" ON contract_amendments FOR SELECT USING (is_internal());
CREATE POLICY "amendments_external_select" ON contract_amendments FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_contracts WHERE user_id = auth.uid() AND contract_id = contract_amendments.contract_id));

CREATE POLICY "kpi_internal_all" ON kpi_snapshots FOR ALL USING (is_internal());
CREATE POLICY "kpi_external_own" ON kpi_snapshots FOR SELECT
  USING (contract_id IN (SELECT id FROM contracts WHERE external_user_id = auth.uid()));
CREATE POLICY "kpi_snapshots_internal_select" ON kpi_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('director','admin','reviewer')));

COMMIT;

-- ROLLBACK END ———————————————————————————————————
*/


-- ════════════════════════════════════════════════════════════════════
--  STEP 24  —  MIGRATION  —  seq=027
--  Source: legacy: migrations/027_contract_role_browser_helpers.sql
--  Reason: browser helpers for contract roles
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 027: Browser-Accessible Contract Role Helpers
--  File: 027_contract_role_browser_helpers.sql
--
--  PURPOSE
--  ─────────────────────────────────────────────────────────────────
--  Migration 025 created the user_contract_roles table and
--  SECURITY DEFINER helper functions (has_contract_role, etc.),
--  but the table has RLS enabled with no direct-read policies.
--
--  The browser client needs to discover WHICH contracts a user
--  holds a specific role on (e.g., "give me all my contractor
--  contracts"). This migration adds:
--
--  1. get_my_contracts_by_role(_role) — returns contract IDs
--  2. get_my_contract_roles()        — returns full assignment rows
--  3. Self-read RLS policy on user_contract_roles
--
--  All functions are SECURITY DEFINER to bypass RLS safely.
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────
--  1. get_my_contracts_by_role — returns contract UUIDs
--     Usage: supabase.rpc('get_my_contracts_by_role', { _role: 'contractor' })
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_contracts_by_role(
  _role contract_role
) RETURNS SETOF UUID AS $$
  SELECT contract_id
  FROM user_contract_roles
  WHERE user_id       = auth.uid()
    AND contract_role = _role
    AND is_active     = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_my_contracts_by_role(contract_role) IS
  'Returns contract IDs where the current user has the specified active role. '
  'SECURITY DEFINER — bypasses RLS on user_contract_roles. '
  'Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  2. get_my_contract_roles — returns full assignment rows
--     Usage: supabase.rpc('get_my_contract_roles')
--     Returns: { contract_id, contract_role, is_active, assigned_at }
-- ────────────────────────────────────────────────────────────────

-- Custom return type for the function
DO $$ BEGIN
  CREATE TYPE my_contract_role_row AS (
    contract_id   UUID,
    contract_role contract_role,
    is_active     BOOLEAN,
    assigned_at   TIMESTAMPTZ,
    notes         TEXT
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION get_my_contract_roles()
RETURNS SETOF my_contract_role_row AS $$
  SELECT contract_id, contract_role, is_active, assigned_at, notes
  FROM user_contract_roles
  WHERE user_id   = auth.uid()
    AND is_active = TRUE;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_my_contract_roles() IS
  'Returns all active contract-role assignments for the current user. '
  'SECURITY DEFINER — bypasses RLS. Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  3. get_user_contract_roles_admin — director-only, any user
--     Usage: supabase.rpc('get_user_contract_roles_admin', { _user_id: '...' })
--     For the user management page.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_contract_roles_admin(
  _user_id UUID
) RETURNS TABLE (
  id            UUID,
  contract_id   UUID,
  contract_role contract_role,
  is_active     BOOLEAN,
  assigned_at   TIMESTAMPTZ,
  notes         TEXT
) AS $$
BEGIN
  -- Only director can call this
  IF NOT (SELECT role FROM profiles WHERE profiles.id = auth.uid()) = 'director' THEN
    RAISE EXCEPTION 'غير مصرح — مدير الإدارة فقط';
  END IF;

  RETURN QUERY
    SELECT ucr.id, ucr.contract_id, ucr.contract_role,
           ucr.is_active, ucr.assigned_at, ucr.notes
    FROM user_contract_roles ucr
    WHERE ucr.user_id = _user_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION get_user_contract_roles_admin(UUID) IS
  'Director-only: returns all contract-role assignments for a given user. '
  'SECURITY DEFINER — bypasses RLS. Added by migration 027.';


-- ────────────────────────────────────────────────────────────────
--  4. Self-read RLS policy on user_contract_roles
--     Users can read their own rows. Directors can read all.
-- ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "ucr_self_select" ON user_contract_roles;
CREATE POLICY "ucr_self_select"
  ON user_contract_roles FOR SELECT
  USING (
    user_id = auth.uid()
    OR
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );

-- Director can manage all rows (INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "ucr_director_all" ON user_contract_roles;
CREATE POLICY "ucr_director_all"
  ON user_contract_roles FOR ALL
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'director'
  );


COMMIT;

-- ── Verification ───────────────────────────────────────────────

-- Test: get your own contractor contracts
-- SELECT * FROM get_my_contracts_by_role('contractor');

-- Test: get all your active roles
-- SELECT * FROM get_my_contract_roles();

-- Test (as director): get another user's roles
-- SELECT * FROM get_user_contract_roles_admin('a1000005-0000-0000-0000-000000000005');

-- Confirm policies exist
SELECT policyname, cmd, permissive
FROM pg_policies
WHERE tablename = 'user_contract_roles'
ORDER BY policyname;


-- ════════════════════════════════════════════════════════════════════
--  STEP 25  —  MIGRATION  —  seq=028
--  Source: legacy: migrations/028_add_last_transition_at.sql
--  Reason: last_transition_at column
-- ════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Migration 028: Add last_transition_at to claims
-- Sprint E.1.5 — SLA Accuracy & Transition Tracking
--
-- PURPOSE: Replace unreliable updated_at with a dedicated transition timestamp.
-- updated_at changes on ANY update (e.g. editing BOQ items, notes, amounts).
-- last_transition_at ONLY changes when claim.status actually transitions.
--
-- SAFE: Column is NULLable, backfilled from existing data, no RLS changes.
-- ============================================================================

-- ── Step 1: Add column ──────────────────────────────────────────────────────
ALTER TABLE public.claims
ADD COLUMN IF NOT EXISTS last_transition_at timestamptz;

COMMENT ON COLUMN public.claims.last_transition_at IS
  'Timestamp of the last workflow status transition. '
  'Used for accurate SLA calculations. '
  'Only updated when claim.status actually changes — NOT on regular data edits.';

-- ── Step 2: Backfill from existing data ─────────────────────────────────────
-- For claims that have been submitted, use submitted_at as the base.
-- For all others, fall back to updated_at → created_at.
-- For approved/rejected terminal claims, use approved_at or updated_at.
UPDATE public.claims
SET last_transition_at = COALESCE(
  -- For terminal states, use the terminal action timestamp
  CASE
    WHEN status IN ('approved', 'rejected') THEN COALESCE(approved_at, updated_at)
    ELSE NULL
  END,
  -- For in-flight claims, use updated_at (best available proxy)
  updated_at,
  -- Ultimate fallback
  created_at
)
WHERE last_transition_at IS NULL;

-- ── Step 3: Index for SLA dashboard queries ─────────────────────────────────
-- Queries filter on status + last_transition_at for SLA calculations
CREATE INDEX IF NOT EXISTS idx_claims_last_transition_at
ON public.claims (last_transition_at)
WHERE last_transition_at IS NOT NULL;

-- Composite index: status + transition timestamp (dashboard SLA queries)
CREATE INDEX IF NOT EXISTS idx_claims_status_transition
ON public.claims (status, last_transition_at)
WHERE status NOT IN ('draft', 'approved', 'rejected');

-- ── Step 4: Set NOT NULL default for new claims ─────────────────────────────
-- New claims get last_transition_at = created_at by default.
ALTER TABLE public.claims
ALTER COLUMN last_transition_at SET DEFAULT NOW();

-- ── Done ────────────────────────────────────────────────────────────────────
-- After this migration:
-- 1. All existing claims have last_transition_at backfilled
-- 2. New claims get last_transition_at = NOW() on creation
-- 3. Application code must update last_transition_at on every status transition
-- 4. Regular edits (BOQ items, amounts, notes) must NOT touch last_transition_at


-- ════════════════════════════════════════════════════════════════════
--  STEP 26  —  MIGRATION  —  seq=029
--  Source: legacy: migrations/029_contractor_withdraw_action.sql
--  Reason: contractor withdraw action
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 27  —  MIGRATION  —  seq=030
--  Source: legacy: migrations/030_completion_certificate_and_cancel.sql
--  Reason: completion-cert + cancel actions
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 28  —  MIGRATION  —  seq=031
--  Source: legacy: migrations/031_atomic_claim_submission.sql
--  Reason: predecessor atomic-submission RPC
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 031: Atomic Claim Submission (v2 — Production Hardened)
--
--  PURPOSE:
--    1. Create submit_claim_atomic() — single-transaction submission
--       that eliminates the "stuck in submitted" bug entirely.
--    2. Update claim_workflow_action_check constraint with all action types.
--    3. Update db-level transition guard for cancelled + withdraw + atomic path.
--
--  v2 CHANGES (production hardening):
--    - All errors use RAISE EXCEPTION (guarantees full rollback)
--    - No JSON error returns that could mask partial writes
--    - Recovery logic REMOVED — submit is a pure action (draft only)
--    - Stuck claim repair is handled ONLY by 032_recovery_stuck_claims.sql
--    - audit_logs.from_status uses actual v_claim.status (not hardcoded)
--    - EXCEPTION handler re-raises to guarantee rollback
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
--  1. Recreate claim_workflow_action_check with ALL known actions
-- ────────────────────────────────────────────────────────────────

ALTER TABLE claim_workflow
  DROP CONSTRAINT IF EXISTS claim_workflow_action_check;

ALTER TABLE claim_workflow
  ADD CONSTRAINT claim_workflow_action_check
  CHECK (action IN (
    -- Contractor actions
    'submit',              -- submits draft claim
    'resubmit',            -- resubmits after return
    'withdraw',            -- withdraws claim back to draft
    'cancel',              -- cancels claim (terminal)
    -- Supervisor actions
    'upload_certificate',  -- uploads completion certificate
    -- General review actions
    'approve',             -- approves (any stage)
    'reject',              -- director rejects
    'return',              -- return to previous stage
    'forward',             -- system auto-routing (e.g., submitted → supervisor)
    -- Legacy actions (preserved for backward compatibility)
    'comment',             -- informational note
    'consultant_review',   -- legacy supervisor review
    'consultant_return',   -- legacy supervisor return
    'admin_review',        -- legacy auditor review
    'admin_return',        -- legacy auditor return
    'director_return',     -- legacy director return
    'director_override',   -- director overrides routing
    -- Lifecycle
    'close',
    'reopen'
  ));

-- ────────────────────────────────────────────────────────────────
--  2. Create the atomic submission function (v2 — RAISE EXCEPTION)
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_claim_atomic(
  p_claim_id   UUID,
  p_actor_id   UUID,
  p_notes      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER          -- runs as table owner; bypasses RLS
SET search_path = public  -- prevent search_path hijacking
AS $$
DECLARE
  v_claim              RECORD;
  v_contract_id        UUID;
  v_claim_no           INTEGER;
  v_now                TIMESTAMPTZ := NOW();
  v_supervisor_count   INTEGER;
  v_original_status    TEXT;
BEGIN
  -- ══════════════════════════════════════════════════════════════
  -- STEP 1: Lock the claim row — prevents concurrent submissions
  -- ══════════════════════════════════════════════════════════════
  SELECT id, status, contract_id, claim_no
  INTO v_claim
  FROM claims
  WHERE id = p_claim_id
  FOR UPDATE;                -- row-level exclusive lock

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND'
    USING ERRCODE = 'P0001';
  END IF;

  v_contract_id    := v_claim.contract_id;
  v_claim_no       := v_claim.claim_no;
  v_original_status := v_claim.status;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 2: Validate claim status — DRAFT ONLY
  -- ══════════════════════════════════════════════════════════════

  -- Idempotency: if already at target state, return success (no-op)
  IF v_claim.status = 'under_supervisor_review' THEN
    RETURN jsonb_build_object(
      'success', true,
      'claim_id', p_claim_id,
      'status', 'under_supervisor_review',
      'message', 'ALREADY_ROUTED'
    );
  END IF;

  -- STRICT: only draft claims can be submitted.
  -- Stuck claims at 'submitted' must be fixed via 032_recovery_stuck_claims.sql
  IF v_claim.status != 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', v_claim.status
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 3: Verify active supervisor exists on contract
  -- ══════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_supervisor_count
  FROM user_contract_roles
  WHERE contract_id = v_contract_id
    AND contract_role = 'supervisor'
    AND is_active = true;

  IF v_supervisor_count = 0 THEN
    RAISE EXCEPTION 'NO_ACTIVE_SUPERVISOR'
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 4: Execute the atomic transition (draft → under_supervisor_review)
  --
  -- We insert workflow entries for the logical two-step transition
  -- (draft→submitted, submitted→under_supervisor_review) but perform
  -- only ONE claim update directly to the final state. This means
  -- the 'submitted' status is never visible in the claims table.
  -- ══════════════════════════════════════════════════════════════

  -- 4a: Insert workflow audit entry: draft → submitted
  INSERT INTO claim_workflow (claim_id, action, from_status, to_status, actor_id, notes)
  VALUES (
    p_claim_id,
    'submit',
    'draft',
    'submitted',
    p_actor_id,
    COALESCE(p_notes, format('تقديم المطالبة رقم %s — تم التحقق من الوثائق المطلوبة', v_claim_no))
  );

  -- 4b: Update claim directly to under_supervisor_review (skip intermediate 'submitted')
  UPDATE claims SET
    status = 'under_supervisor_review',
    submitted_by = p_actor_id,
    submitted_at = v_now,
    updated_at = v_now,
    last_transition_at = v_now
  WHERE id = p_claim_id;

  -- 4c: Insert auto-routing workflow entry: submitted → under_supervisor_review
  INSERT INTO claim_workflow (claim_id, action, from_status, to_status, actor_id, notes)
  VALUES (
    p_claim_id,
    'forward',
    'submitted',
    'under_supervisor_review',
    p_actor_id,
    'توجيه تلقائي لجهة الإشراف — بناءً على الدور المعيّن على العقد (SLA: 3 أيام عمل)'
  );

  -- ══════════════════════════════════════════════════════════════
  -- STEP 5: Audit log (FIXED: uses correct audit_logs column names)
  --
  -- Actual schema:
  --   entity_type (text), entity_id (uuid), action (audit_action enum),
  --   actor_id (uuid), old_values (jsonb), new_values (jsonb),
  --   metadata (jsonb), ip_address (inet)
  -- ══════════════════════════════════════════════════════════════
  INSERT INTO audit_logs (
    entity_type, entity_id, action, actor_id,
    old_values, new_values, metadata, ip_address
  ) VALUES (
    'claim',
    p_claim_id,
    'submit'::audit_action,
    p_actor_id,
    jsonb_build_object('status', v_original_status),
    jsonb_build_object('status', 'under_supervisor_review', 'submitted_at', v_now),
    jsonb_build_object(
      'from_status', v_original_status,
      'to_status', 'under_supervisor_review',
      'source', 'submit_claim_atomic_v2',
      'claim_no', v_claim_no,
      'contract_id', v_contract_id
    ),
    '0.0.0.0'::inet
  );

  -- ══════════════════════════════════════════════════════════════
  -- STEP 6: Return success
  -- ══════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'success', true,
    'claim_id', p_claim_id,
    'status', 'under_supervisor_review',
    'submitted_at', v_now
  );

  -- NOTE: No generic EXCEPTION handler here. Any failure (constraint violation,
  -- trigger rejection, disk error, etc.) will propagate as an unhandled exception,
  -- which PostgreSQL automatically rolls back the entire transaction for.
  -- This is the correct behavior — we want ZERO partial writes.
END;
$$;

-- Grant execute to service-role and authenticated (function is SECURITY DEFINER)
GRANT EXECUTE ON FUNCTION public.submit_claim_atomic(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_claim_atomic(UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.submit_claim_atomic IS
  'Atomic claim submission: draft → under_supervisor_review in a single transaction. '
  'Uses RAISE EXCEPTION for all errors (guarantees full rollback). '
  'Stuck claims at submitted must be fixed via 032_recovery_stuck_claims.sql.';

-- ────────────────────────────────────────────────────────────────
--  3. Update transition guard to allow direct draft → under_supervisor_review
--     when called by the atomic function (SECURITY DEFINER bypass)
-- ────────────────────────────────────────────────────────────────
--
-- The existing trigger (Migration 014) uses auth.uid() to check roles.
-- Since submit_claim_atomic is SECURITY DEFINER, auth.uid() returns NULL
-- in the trigger context. We must allow two specific NULL-role paths:
--   1. draft → under_supervisor_review (atomic submit, skipping submitted)
--   2. submitted → under_supervisor_review (legacy auto-assign / recovery)
-- All other NULL-role transitions are BLOCKED.

CREATE OR REPLACE FUNCTION public.validate_claim_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role    TEXT;
  v_allowed BOOLEAN := FALSE;
BEGIN
  -- Only run when status actually changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Rule G3: Terminal states are immutable
  IF OLD.status IN ('approved', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION
      'CLAIM_IMMUTABLE: Cannot modify a claim in terminal state "%" (id=%).',
      OLD.status, OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  -- Identify calling user's role
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  -- Service-role / SECURITY DEFINER bypass (submit_claim_atomic uses this path)
  -- ONLY two specific transitions are allowed without a role:
  IF v_role IS NULL THEN
    IF OLD.status = 'draft' AND NEW.status = 'under_supervisor_review' THEN
      RETURN NEW;  -- atomic submit path
    END IF;
    IF OLD.status = 'submitted' AND NEW.status = 'under_supervisor_review' THEN
      RETURN NEW;  -- legacy/recovery path
    END IF;
    RAISE EXCEPTION
      'CLAIM_AUTH: Unauthenticated user cannot transition "%" → "%" (id=%).',
      OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  -- Transition matrix (authenticated users with known roles)
  v_allowed := CASE

    -- Contractor: initial submit (draft → submitted)
    WHEN v_role = 'contractor'
      AND OLD.status = 'draft'
      AND NEW.status = 'submitted'
    THEN TRUE

    -- Contractor: resubmit after return
    WHEN v_role = 'contractor'
      AND OLD.status IN ('returned_by_supervisor', 'returned_by_auditor')
      AND NEW.status = 'submitted'
    THEN TRUE

    -- Contractor: withdraw (supervisor stage → draft)
    WHEN v_role = 'contractor'
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'draft'
    THEN TRUE

    -- Contractor: cancel (supervisor stage → cancelled)
    WHEN v_role = 'contractor'
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'cancelled'
    THEN TRUE

    -- submitted → under_supervisor_review: allowed for any known role
    -- (system auto-routing from submit API or resubmit flow)
    WHEN OLD.status = 'submitted'
      AND NEW.status = 'under_supervisor_review'
      AND v_role IN ('supervisor', 'director', 'reviewer', 'contractor')
    THEN TRUE

    -- Supervisor: approve → auditor (includes legacy 'consultant' role)
    WHEN v_role IN ('supervisor', 'consultant')
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'under_auditor_review'
    THEN TRUE

    -- Supervisor: return → contractor (includes legacy 'consultant' role)
    WHEN v_role IN ('supervisor', 'consultant')
      AND OLD.status = 'under_supervisor_review'
      AND NEW.status = 'returned_by_supervisor'
    THEN TRUE

    -- Auditor: approve → reviewer (includes legacy 'admin' role)
    WHEN v_role IN ('auditor', 'admin')
      AND OLD.status = 'under_auditor_review'
      AND NEW.status = 'under_reviewer_check'
    THEN TRUE

    -- Auditor: return → contractor (includes legacy 'admin' role)
    WHEN v_role IN ('auditor', 'admin')
      AND OLD.status = 'under_auditor_review'
      AND NEW.status = 'returned_by_auditor'
    THEN TRUE

    -- Reviewer: approve → director
    WHEN v_role = 'reviewer'
      AND OLD.status = 'under_reviewer_check'
      AND NEW.status = 'pending_director_approval'
    THEN TRUE

    -- Reviewer: return → auditor
    WHEN v_role = 'reviewer'
      AND OLD.status = 'under_reviewer_check'
      AND NEW.status = 'returned_by_auditor'
    THEN TRUE

    -- Director: final approve
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'approved'
    THEN TRUE

    -- Director: final reject
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'rejected'
    THEN TRUE

    -- Director: return to auditor
    WHEN v_role = 'director'
      AND OLD.status = 'pending_director_approval'
      AND NEW.status = 'under_auditor_review'
    THEN TRUE

    ELSE FALSE
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'CLAIM_TRANSITION_DENIED: Role "%" cannot move claim from "%" to "%" (id=%).',
      v_role, OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────
--  VERIFICATION
-- ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'submit_claim_atomic'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'SETUP ERROR: submit_claim_atomic() was not created';
  END IF;
  RAISE NOTICE 'OK: submit_claim_atomic() is ready (v2 — RAISE EXCEPTION pattern)';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_workflow_action_check'
  ) THEN
    RAISE EXCEPTION 'SETUP ERROR: claim_workflow_action_check constraint missing';
  END IF;
  RAISE NOTICE 'OK: claim_workflow_action_check constraint is active';
END;
$$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 29  —  MIGRATION  —  seq=031b
--  Source: legacy: migrations/031b_fix_audit_logs_columns.sql
--  Reason: audit_logs column fix
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 031b: Fix audit_logs column names in submit_claim_atomic
--
--  ROOT CAUSE: The audit_logs table schema differs from CLAUDE.md spec:
--    table_name  → entity_type
--    record_id   → entity_id
--    old_data    → old_values
--    new_data    → new_values
--    from_status → (use metadata JSONB)
--    to_status   → (use metadata JSONB)
--    ip_address  → inet type (not text)
--    action      → audit_action enum (not text)
--
--  This caused submit_claim_atomic() to crash at STEP 5 on every call,
--  rolling back the entire transaction and leaving claims stuck at 'draft'.
--
--  IDEMPOTENT: safe to run multiple times (CREATE OR REPLACE).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.submit_claim_atomic(
  p_claim_id   UUID,
  p_actor_id   UUID,
  p_notes      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim              RECORD;
  v_contract_id        UUID;
  v_claim_no           INTEGER;
  v_now                TIMESTAMPTZ := NOW();
  v_supervisor_count   INTEGER;
  v_original_status    TEXT;
BEGIN
  -- ══════════════════════════════════════════════════════════════
  -- STEP 1: Lock the claim row — prevents concurrent submissions
  -- ══════════════════════════════════════════════════════════════
  SELECT id, status, contract_id, claim_no
  INTO v_claim
  FROM claims
  WHERE id = p_claim_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND'
    USING ERRCODE = 'P0001';
  END IF;

  v_contract_id    := v_claim.contract_id;
  v_claim_no       := v_claim.claim_no;
  v_original_status := v_claim.status;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 2: Validate claim status — DRAFT ONLY
  -- ══════════════════════════════════════════════════════════════

  -- Idempotency: if already at target state, return success (no-op)
  IF v_claim.status = 'under_supervisor_review' THEN
    RETURN jsonb_build_object(
      'success', true,
      'claim_id', p_claim_id,
      'status', 'under_supervisor_review',
      'message', 'ALREADY_ROUTED'
    );
  END IF;

  -- STRICT: only draft claims can be submitted.
  IF v_claim.status != 'draft' THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', v_claim.status
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 3: Verify active supervisor exists on contract
  -- ══════════════════════════════════════════════════════════════
  SELECT COUNT(*) INTO v_supervisor_count
  FROM user_contract_roles
  WHERE contract_id = v_contract_id
    AND contract_role = 'supervisor'
    AND is_active = true;

  IF v_supervisor_count = 0 THEN
    RAISE EXCEPTION 'NO_ACTIVE_SUPERVISOR'
    USING ERRCODE = 'P0001';
  END IF;

  -- ══════════════════════════════════════════════════════════════
  -- STEP 4: Execute the atomic transition (draft → under_supervisor_review)
  -- ══════════════════════════════════════════════════════════════

  -- 4a: Insert workflow audit entry: draft → submitted
  INSERT INTO claim_workflow (claim_id, action, from_status, to_status, actor_id, notes)
  VALUES (
    p_claim_id,
    'submit',
    'draft',
    'submitted',
    p_actor_id,
    COALESCE(p_notes, format('تقديم المطالبة رقم %s — تم التحقق من الوثائق المطلوبة', v_claim_no))
  );

  -- 4b: Update claim directly to under_supervisor_review (skip intermediate 'submitted')
  UPDATE claims SET
    status = 'under_supervisor_review',
    submitted_by = p_actor_id,
    submitted_at = v_now,
    updated_at = v_now,
    last_transition_at = v_now
  WHERE id = p_claim_id;

  -- 4c: Insert auto-routing workflow entry: submitted → under_supervisor_review
  INSERT INTO claim_workflow (claim_id, action, from_status, to_status, actor_id, notes)
  VALUES (
    p_claim_id,
    'forward',
    'submitted',
    'under_supervisor_review',
    p_actor_id,
    'توجيه تلقائي لجهة الإشراف — بناءً على الدور المعيّن على العقد (SLA: 3 أيام عمل)'
  );

  -- ══════════════════════════════════════════════════════════════
  -- STEP 5: Audit log (FIXED: uses correct audit_logs column names)
  --
  -- Actual schema:
  --   entity_type (text), entity_id (uuid), action (audit_action enum),
  --   actor_id (uuid), old_values (jsonb), new_values (jsonb),
  --   metadata (jsonb), ip_address (inet)
  -- ══════════════════════════════════════════════════════════════
  INSERT INTO audit_logs (
    entity_type, entity_id, action, actor_id,
    old_values, new_values, metadata, ip_address
  ) VALUES (
    'claim',
    p_claim_id,
    'submit'::audit_action,
    p_actor_id,
    jsonb_build_object('status', v_original_status),
    jsonb_build_object('status', 'under_supervisor_review', 'submitted_at', v_now),
    jsonb_build_object(
      'from_status', v_original_status,
      'to_status', 'under_supervisor_review',
      'source', 'submit_claim_atomic_v2',
      'claim_no', v_claim_no,
      'contract_id', v_contract_id
    ),
    '0.0.0.0'::inet
  );

  -- ══════════════════════════════════════════════════════════════
  -- STEP 6: Return success
  -- ══════════════════════════════════════════════════════════════
  RETURN jsonb_build_object(
    'success', true,
    'claim_id', p_claim_id,
    'status', 'under_supervisor_review',
    'submitted_at', v_now
  );

  -- NOTE: No generic EXCEPTION handler. Any failure propagates and
  -- PostgreSQL automatically rolls back the entire transaction.
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.submit_claim_atomic(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_claim_atomic(UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.submit_claim_atomic IS
  'Atomic claim submission: draft → under_supervisor_review in a single transaction. '
  'v2b: Fixed audit_logs column names (entity_type/entity_id/old_values/new_values/metadata). '
  'Uses RAISE EXCEPTION for all errors (guarantees full rollback).';

-- ────────────────────────────────────────────────────────────────
--  VERIFICATION
-- ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'submit_claim_atomic'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'SETUP ERROR: submit_claim_atomic() was not created';
  END IF;
  RAISE NOTICE 'OK: submit_claim_atomic() updated with correct audit_logs columns (v2b)';
END;
$$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 30  —  MIGRATION  —  seq=033
--  Source: legacy: migrations/033_fix_document_type_enum.sql
--  Reason: document_type enum fix
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 033: Fix document_type Enum
--
--  ROOT CAUSE:
--    Migration 030 assumed documents.type was TEXT, but it's actually
--    the document_type ENUM. Inserting 'completion_certificate' fails
--    with "invalid input value for enum document_type".
--
--  FIX:
--    Add 'completion_certificate' to the document_type enum.
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- Add missing enum value
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'completion_certificate';

-- Verify
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'document_type'::regtype
ORDER BY enumsortorder;


-- ════════════════════════════════════════════════════════════════════
--  STEP 31  —  MIGRATION  —  seq=034
--  Source: legacy: migrations/034_audit_helper_function.sql
--  Reason: audit helper function
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 034: Audit Logging Helper Function
--
--  PURPOSE:
--    Provide a single, safe entry point for all audit logging.
--    Eliminates schema mismatches by centralizing column names.
--    Exception-safe: audit failure NEVER crashes the main transaction.
--
--  SCHEMA (actual production audit_logs):
--    entity_type  TEXT
--    entity_id    UUID
--    action       audit_action ENUM
--    actor_id     UUID
--    actor_email  TEXT
--    actor_role   USER-DEFINED
--    entity_label TEXT
--    old_values   JSONB
--    new_values   JSONB
--    metadata     JSONB
--    ip_address   INET
--    user_agent   TEXT
--    created_at   TIMESTAMPTZ
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION log_audit_event(
  p_entity_type   TEXT,
  p_entity_id     UUID,
  p_action        TEXT,
  p_actor_id      UUID,
  p_old_values    JSONB DEFAULT '{}'::JSONB,
  p_new_values    JSONB DEFAULT '{}'::JSONB,
  p_metadata      JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email TEXT;
  v_actor_role  TEXT;
BEGIN
  -- Resolve actor details (best-effort)
  BEGIN
    SELECT email, role::TEXT
    INTO v_actor_email, v_actor_role
    FROM profiles
    WHERE id = p_actor_id;
  EXCEPTION WHEN OTHERS THEN
    v_actor_email := 'unknown';
    v_actor_role  := 'unknown';
  END;

  -- Insert audit log entry (exception-safe)
  BEGIN
    INSERT INTO audit_logs (
      entity_type,
      entity_id,
      action,
      actor_id,
      actor_email,
      actor_role,
      entity_label,
      old_values,
      new_values,
      metadata,
      ip_address,
      created_at
    ) VALUES (
      p_entity_type,
      p_entity_id,
      p_action::audit_action,
      p_actor_id,
      COALESCE(v_actor_email, 'unknown'),
      v_actor_role,
      p_entity_type || ':' || p_entity_id::TEXT,
      p_old_values,
      p_new_values,
      p_metadata || jsonb_build_object('source_function', 'log_audit_event'),
      '0.0.0.0'::INET,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    -- NEVER crash the main transaction — log warning only
    RAISE WARNING '[log_audit_event] AUDIT INSERT FAILED: % — entity=%:% action=% actor=%',
      SQLERRM, p_entity_type, p_entity_id, p_action, p_actor_id;
  END;
END;
$$;

COMMENT ON FUNCTION log_audit_event IS
  'Exception-safe audit logging helper. Centralizes audit_logs schema. '
  'If audit INSERT fails, logs a WARNING but does NOT break the calling transaction.';

-- ── Verification ─────────────────────────────────────────────────

-- Verify function exists
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'log_audit_event';

-- Quick smoke test (should succeed silently)
SELECT log_audit_event(
  'test',
  '00000000-0000-0000-0000-000000000000'::UUID,
  'create',
  '00000000-0000-0000-0000-000000000000'::UUID,
  '{}'::JSONB,
  '{"test": true}'::JSONB,
  '{"smoke_test": true}'::JSONB
);

-- Verify the test row was inserted
SELECT entity_type, action, metadata->>'smoke_test' AS smoke
FROM audit_logs
WHERE entity_type = 'test'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up smoke test row
DELETE FROM audit_logs WHERE entity_type = 'test';


-- ════════════════════════════════════════════════════════════════════
--  STEP 32  —  MIGRATION  —  seq=035
--  Source: legacy: migrations/035_block_submitted_persist.sql
--  Reason: block submitted persistence
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 33  —  MIGRATION  —  seq=040
--  Source: current: migrations/040_flexible_approvers_and_import.sql
--  Reason: flexible approvers (newer)
-- ════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Migration 040: Flexible Final Approvers + Bulk Import + Prev Progress Protection
-- Date: 2026-04-06
-- Purpose:
--   1. contract_approvers table — dynamic final approver per contract
--   2. permission_requests table — ADMIN submits approval scope requests
--   3. is_imported / is_historical flags on claims for bulk import
--   4. Trigger to protect prev_progress from manual edits on non-draft claims
-- ============================================================================

-- ── 1. Approval Scope Enum ─────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE approval_scope AS ENUM ('final_approver', 'reviewer', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Contract Approvers Table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_approvers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  approval_scope approval_scope NOT NULL DEFAULT 'final_approver',
  granted_by    UUID REFERENCES profiles(id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active approver per scope per contract per user
  UNIQUE (contract_id, user_id, approval_scope)
);

CREATE INDEX IF NOT EXISTS idx_contract_approvers_contract
  ON contract_approvers(contract_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_contract_approvers_user
  ON contract_approvers(user_id) WHERE is_active = true;

-- ── 3. Permission Request Status Enum ──────────────────────────────
DO $$ BEGIN
  CREATE TYPE permission_request_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. Permission Requests Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS permission_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by    UUID NOT NULL REFERENCES profiles(id),
  target_user_id  UUID NOT NULL REFERENCES profiles(id),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  requested_scope approval_scope NOT NULL DEFAULT 'final_approver',
  status          permission_request_status NOT NULL DEFAULT 'pending',
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_requests_status
  ON permission_requests(status) WHERE status = 'pending';

-- ── 5. Bulk Import Flags on Claims ─────────────────────────────────
ALTER TABLE claims ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS is_historical BOOLEAN NOT NULL DEFAULT false;

-- ── 6. Bulk Import Flags on Contracts ──────────────────────────────
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;

-- ── 7. Protect prev_progress on non-draft claims ──────────────────
-- Once a claim leaves draft status, prev_progress cannot be modified
CREATE OR REPLACE FUNCTION protect_prev_progress()
RETURNS TRIGGER AS $$
BEGIN
  -- Only protect if claim is NOT in draft status
  IF OLD.prev_progress IS DISTINCT FROM NEW.prev_progress THEN
    -- Check if the parent claim is in draft
    DECLARE
      v_status TEXT;
    BEGIN
      SELECT status INTO v_status FROM claims WHERE id = NEW.claim_id;
      IF v_status IS NOT NULL AND v_status NOT IN ('draft') THEN
        RAISE EXCEPTION 'لا يمكن تعديل الكميات السابقة (prev_progress) لمطالبة غير مسودة — الحالة الحالية: %', v_status;
      END IF;
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_prev_progress ON claim_boq_items;
CREATE TRIGGER trg_protect_prev_progress
  BEFORE UPDATE ON claim_boq_items
  FOR EACH ROW
  EXECUTE FUNCTION protect_prev_progress();

-- ── 8. Helper: Get final approvers for a contract ──────────────────
CREATE OR REPLACE FUNCTION get_contract_final_approvers(p_contract_id UUID)
RETURNS TABLE(user_id UUID, full_name_ar TEXT, email TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.full_name_ar, p.email
  FROM contract_approvers ca
  JOIN profiles p ON p.id = ca.user_id
  WHERE ca.contract_id = p_contract_id
    AND ca.approval_scope = 'final_approver'
    AND ca.is_active = true
    AND p.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 9. Helper: Check if user is final approver for a contract ──────
CREATE OR REPLACE FUNCTION is_final_approver(p_user_id UUID, p_contract_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_role TEXT;
  v_is_approver BOOLEAN;
BEGIN
  -- Director is always a final approver for all contracts
  SELECT role INTO v_role FROM profiles WHERE id = p_user_id;
  IF v_role = 'director' THEN
    RETURN true;
  END IF;

  -- Check contract_approvers table
  SELECT EXISTS(
    SELECT 1 FROM contract_approvers
    WHERE user_id = p_user_id
      AND contract_id = p_contract_id
      AND approval_scope = 'final_approver'
      AND is_active = true
  ) INTO v_is_approver;

  RETURN v_is_approver;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 10. Helper: Get prev_progress for new claim ────────────────────
-- Returns cumulative progress for each BOQ item from all approved claims
CREATE OR REPLACE FUNCTION get_prev_progress_for_contract(p_contract_id UUID)
RETURNS TABLE(item_no TEXT, total_prev_progress NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bi.item_no::TEXT,
    COALESCE(SUM(bi.curr_progress), 0) AS total_prev_progress
  FROM claim_boq_items bi
  JOIN claims c ON c.id = bi.claim_id
  WHERE c.contract_id = p_contract_id
    AND c.status IN ('approved', 'closed')
  GROUP BY bi.item_no;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 11. RLS Policies ───────────────────────────────────────────────
-- contract_approvers: viewable by internal roles, manageable by director/admin
ALTER TABLE contract_approvers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contract_approvers_select" ON contract_approvers;
CREATE POLICY "contract_approvers_select" ON contract_approvers
  FOR SELECT USING (true);  -- All authenticated users can view

DROP POLICY IF EXISTS "contract_approvers_insert" ON contract_approvers;
CREATE POLICY "contract_approvers_insert" ON contract_approvers
  FOR INSERT WITH CHECK (true);  -- Enforced at API level

DROP POLICY IF EXISTS "contract_approvers_update" ON contract_approvers;
CREATE POLICY "contract_approvers_update" ON contract_approvers
  FOR UPDATE USING (true);  -- Enforced at API level

-- permission_requests: viewable by internal roles
ALTER TABLE permission_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permission_requests_select" ON permission_requests;
CREATE POLICY "permission_requests_select" ON permission_requests
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "permission_requests_insert" ON permission_requests;
CREATE POLICY "permission_requests_insert" ON permission_requests
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "permission_requests_update" ON permission_requests;
CREATE POLICY "permission_requests_update" ON permission_requests
  FOR UPDATE USING (true);

-- ── Done ───────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════
--  STEP 34  —  MIGRATION  —  seq=041
--  Source: current: migrations/041_final_approver_role.sql
--  Reason: final_approver role (newer)
-- ════════════════════════════════════════════════════════════════════
-- ============================================================================
-- Migration 041: Add "final_approver" profile role
-- ============================================================================
-- Purpose:
--   1. Add 'final_approver' to the user_role enum type.
--   2. Director role remains for Mohammed Al-Arfaj only (platform owner).
--   3. Final approvers act at the pending_director_approval stage
--      on contracts where they are designated via contract_approvers table.
--   4. Admin can distribute roles and submit permission requests to Director.
--
-- This migration is ADDITIVE — no existing data is modified.
-- Run in Supabase SQL Editor BEFORE deploying the frontend changes.
-- ============================================================================

BEGIN;

-- ─── 1. Add 'final_approver' to the user_role enum ─────────────────────────

-- Check if the value already exists to make this migration idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'final_approver'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'final_approver';
  END IF;
END $$;

COMMIT;

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
-- some PostgreSQL versions. If the above fails, run this standalone:
--   ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'final_approver';

-- ─── 2. Update RLS policies to include final_approver ───────────────────────

BEGIN;

-- The is_internal() helper determines who can see all contracts.
-- final_approver is a SCOPED role (not global), so they only see
-- contracts they're assigned to — no change needed to is_internal().

-- However, we need to ensure final_approvers can read claims on their contracts.
-- The existing RLS policy on claims checks user_contract_roles, which already
-- covers final_approver since they get entries in user_contract_roles.

-- ─── 3. Grant final_approvers read access to workflow-related tables ────────

-- Ensure final_approvers can read claim_workflow for timeline display
-- (Existing policies likely cover this via user_contract_roles, but let's be safe)

-- Add final_approver to the notification read policy if it filters by role
-- (Most notification policies filter by user_id, not role, so this is a no-op)

-- ─── 4. Admin role enhancement: allow admin to manage permission_requests ───

-- Admin can INSERT into permission_requests (already covered by migration 040)
-- Admin can read permission_requests they submitted
-- Director can read/update all permission_requests (already covered)

-- Ensure admin can read contract_approvers for the permissions page
DO $$
BEGIN
  -- Drop and recreate the policy if it exists, to ensure it includes admin
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contract_approvers_read_internal'
    AND tablename = 'contract_approvers'
  ) THEN
    DROP POLICY contract_approvers_read_internal ON contract_approvers;
  END IF;

  -- Create a policy that allows director, admin, and final_approver to read
  EXECUTE $policy$
    CREATE POLICY contract_approvers_read_internal ON contract_approvers
      FOR SELECT
      USING (
        -- Director and admin see all
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('director', 'admin')
        )
        OR
        -- Final approvers see their own assignments
        user_id = auth.uid()
      )
  $policy$;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION NOTES:
--
-- 1. The Director (Mohammed Al-Arfaj) retains full platform access.
--    His role in the profiles table remains 'director'.
--
-- 2. New users with role 'final_approver' can ONLY approve/reject/return
--    claims on contracts where they are listed in contract_approvers with
--    approval_scope = 'final_approver'.
--
-- 3. Admin can assign final_approver designations via the permissions page,
--    subject to Director approval through the permission_requests workflow.
--
-- 4. The 'director' role is NOT available in the user creation form.
--    Only Mohammed Al-Arfaj holds this role.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════
--  STEP 35  —  MIGRATION  —  seq=042
--  Source: legacy: migrations/042_extend_enums_for_template_v7.sql
--  Reason: enum extension (full version)
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- Migration 042: Extend Enums + Add exec_sql RPC for Future Automation
-- Date: 2026-04-27
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. توسيع contract_type enum بـ 4 قيم جديدة ───────────────────
DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'furniture_supply';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'operations';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'mixed_services';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'rehabilitation';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ─── 2. توسيع contract_status بـ 'on_hold' ────────────────────────
DO $$ BEGIN
  ALTER TYPE contract_status ADD VALUE IF NOT EXISTS 'on_hold' AFTER 'suspended';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

COMMIT;

-- ─── 3. إنشاء exec_sql RPC للأتمتة المستقبلية ─────────────────────
-- (يُشغَّل بعد COMMIT لأن CREATE FUNCTION في schema منفصل)

CREATE OR REPLACE FUNCTION public.exec_sql(sql_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- فقط service_role يمكنها استدعاء هذه الدالة
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: only service_role may execute SQL';
  END IF;

  EXECUTE sql_query;
  result := '{"success": true}'::jsonb;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_sql(TEXT) IS
  'Service-role-only SQL executor for migrations and admin tasks.';

-- ─── 4. التحقق ────────────────────────────────────────────────────
SELECT
  'contract_type' as type_name,
  array_agg(enumlabel ORDER BY enumsortorder) as values
FROM pg_enum
WHERE enumtypid = 'contract_type'::regtype
UNION ALL
SELECT
  'contract_status',
  array_agg(enumlabel ORDER BY enumsortorder)
FROM pg_enum
WHERE enumtypid = 'contract_status'::regtype;


-- ════════════════════════════════════════════════════════════════════
--  STEP 36  —  MIGRATION  —  seq=043
--  Source: legacy: migrations/043_data_model_hardening_SAFE.sql
--  Reason: D2 hardening SAFE variant
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


-- ════════════════════════════════════════════════════════════════════
--  STEP 37  —  MIGRATION  —  seq=044
--  Source: current: migrations/044_imports_governance.sql
--  Reason: imports governance (newer)
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
-- Migration 044: Import Governance Layer (P1.1)
-- Date: 2026-04-27
-- Purpose: Track every Excel import as an auditable session,
--          attach row-level errors, support progress visualization.
--
-- Scope:
--   - imports table (session header)
--   - import_errors table (row-level error attribution)
--   - Indexes for retrieval by user/date
--   - RLS: imports are visible only to creator + directors
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. import_status enum ────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE import_status AS ENUM (
    'pending',     -- session created, validation not yet run
    'validating',  -- pre-flight validation in progress
    'running',     -- chunked upsert in progress
    'completed',   -- finished with all rows successful
    'partial',    -- finished with some rows failed but session saved partial data
    'failed'       -- aborted before any row was committed
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. imports table (session header) ───────────────────────────

CREATE TABLE IF NOT EXISTS imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source
  file_name       TEXT NOT NULL,
  file_size       BIGINT,
  source_phase    TEXT,           -- 'contracts' | 'boq_templates' | 'staff_templates' | 'historical_claims'

  -- Counts
  total_rows      INTEGER NOT NULL DEFAULT 0,
  success_rows    INTEGER NOT NULL DEFAULT 0,
  failed_rows     INTEGER NOT NULL DEFAULT 0,
  total_chunks    INTEGER NOT NULL DEFAULT 0,
  successful_chunks INTEGER NOT NULL DEFAULT 0,
  failed_chunks   INTEGER NOT NULL DEFAULT 0,

  -- State
  status          import_status NOT NULL DEFAULT 'pending',
  duration_ms     INTEGER,

  -- Audit
  created_by      UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,

  -- Optional context
  contract_id     UUID REFERENCES contracts(id) ON DELETE SET NULL,
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_imports_creator_time
  ON imports(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_imports_status
  ON imports(status, created_at DESC);

-- ─── 3. import_errors table (row-level errors) ───────────────────

CREATE TABLE IF NOT EXISTS import_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,

  -- Source coordinate
  row_index       INTEGER NOT NULL,    -- 1-based row in source file
  field_name      TEXT,                -- e.g. 'contract_no', 'unit_price'
  field_value     TEXT,                -- captured raw value (for diagnostics)

  -- Error classification
  error_type      TEXT NOT NULL,       -- 'validation' | 'database' | 'reference'
  error_code      TEXT,                -- e.g. 'MISSING_REQUIRED', 'DUPLICATE_REF', '23505'
  error_message   TEXT NOT NULL,
  error_message_ar TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_errors_session
  ON import_errors(import_id, row_index);

-- ─── 4. RLS — imports visible to creator + director/admin ────────

ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "imports_creator_or_admin_select" ON imports;
CREATE POLICY "imports_creator_or_admin_select"
  ON imports FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('director', 'admin')
    )
  );

DROP POLICY IF EXISTS "imports_creator_insert" ON imports;
CREATE POLICY "imports_creator_insert"
  ON imports FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "imports_creator_update" ON imports;
CREATE POLICY "imports_creator_update"
  ON imports FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "import_errors_via_session" ON import_errors;
CREATE POLICY "import_errors_via_session"
  ON import_errors FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM imports i
      WHERE i.id = import_errors.import_id
        AND (i.created_by = auth.uid()
             OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
                        AND role IN ('director', 'admin')))
    )
  );

DROP POLICY IF EXISTS "import_errors_via_session_insert" ON import_errors;
CREATE POLICY "import_errors_via_session_insert"
  ON import_errors FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM imports i
      WHERE i.id = import_errors.import_id AND i.created_by = auth.uid()
    )
  );

-- service_role bypasses RLS automatically

COMMIT;

-- ─── Verification ───────────────────────────────────────────────
SELECT 'Migration 044 applied' AS status,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name IN ('imports', 'import_errors')) AS tables_created;


-- ════════════════════════════════════════════════════════════════════
--  STEP 38  —  MIGRATION  —  seq=045
--  Source: legacy: migrations/045_contract_role_multi_assignment.sql
--  Reason: 3-tuple unique invariant
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 045 — Contract Role Multi-Assignment + Extended Enum
--
--  Purpose
--  -------
--  1. Extend the `contract_role` enum with three new values that match the
--     Excel project user-role sheet:
--         project_manager   (مدير مشروع)
--         quality           (جودة) — advisory only, no workflow gate
--         final_approver    (المعتمد النهائي) — promoted from a global UserRole
--                            value to a contract-scoped contract_role
--
--  2. Allow a single user to hold MORE THAN ONE contract_role on the same
--     contract, by replacing the row-level uniqueness key from
--         UNIQUE (user_id, contract_id)
--     to
--         UNIQUE (user_id, contract_id, contract_role)
--
--  Excel example honoured by this migration:
--     One user listed as both مدير مشروع and تدقيق on the same project
--     becomes two distinct rows in user_contract_roles. Today this fails.
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunning is a no-op once applied.
--  • Safe-abort: pre-flight check raises an EXCEPTION (and rolls the
--    transaction back) if any pre-existing rows would violate the new
--    3-tuple constraint. No data is lost or rewritten.
--  • Non-destructive: no DROP TABLE, no DROP COLUMN, no DELETE, no UPDATE.
--    The only structural change is swapping one UNIQUE constraint for
--    another that is *stricter* — every row currently legal stays legal.
--  • RLS-neutral: the policies authored in Migration 026 use predicates
--    of the form (user_id = auth.uid()) without referencing the constraint
--    shape, so they remain correct.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction.
--  • Migrations 025 and 040 already applied.
--
--  Post-conditions
--  ---------------
--  • contract_role enum has 8 values total.
--  • user_contract_roles uniqueness key is the 3-tuple
--    (user_id, contract_id, contract_role).
--  • All existing rows continue to satisfy the new constraint.
--
--  Date drafted : 2026-04-28
--  Status       : DRAFT — for review only, not yet executed.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pre-flight check: PostgreSQL version ─────────────────────────────
-- ALTER TYPE ... ADD VALUE inside a transaction requires pg ≥ 12.

DO $$
DECLARE
  v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000
    INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 045 requires PostgreSQL >= 12 (current: %). '
      'Earlier versions disallow ALTER TYPE ADD VALUE inside a transaction. '
      'Either upgrade or split this migration into a non-transactional '
      'enum-extend step followed by a transactional constraint-swap step.',
      v_pg_major;
  END IF;
END $$;


-- ── 2. Pre-flight check: contract_role enum exists ──────────────────────
-- Defensive guard against running this migration before Migration 025.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'contract_role'
  ) THEN
    RAISE EXCEPTION
      'Migration 045 prerequisite missing: contract_role enum not found. '
      'Run Migration 025 (contract_scoped_roles) first.';
  END IF;
END $$;


-- ── 3. Pre-flight check: user_contract_roles table exists ───────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'user_contract_roles' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Migration 045 prerequisite missing: user_contract_roles table '
      'not found. Run Migration 025 first.';
  END IF;
END $$;


-- ── 4. Idempotent enum extension ────────────────────────────────────────
-- Three new values added one at a time, each guarded so reruns are safe.
-- The new values are NOT referenced anywhere else in this migration, so
-- the pg ≥ 12 "no use of new value in same txn" rule is respected.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'project_manager'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'project_manager';
    RAISE NOTICE '✓ contract_role: added project_manager';
  ELSE
    RAISE NOTICE '⊘ contract_role: project_manager already present — skipped';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'quality'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'quality';
    RAISE NOTICE '✓ contract_role: added quality';
  ELSE
    RAISE NOTICE '⊘ contract_role: quality already present — skipped';
  END IF;
END $$;

-- NOTE:
-- final_approver is being migrated to a contract-scoped role.
-- The global UserRole 'final_approver' will be deprecated in a later phase.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'final_approver'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'final_approver';
    RAISE NOTICE '✓ contract_role: added final_approver';
  ELSE
    RAISE NOTICE '⊘ contract_role: final_approver already present — skipped';
  END IF;
END $$;


-- ── 5. SAFE ABORT — duplicate detection BEFORE constraint swap ──────────
-- The new constraint is stricter on the role dimension than the old one.
-- Specifically: the old UNIQUE(user_id, contract_id) implicitly guaranteed
-- that no two rows shared (user_id, contract_id, contract_role) either
-- (because they couldn't share the first two). So in normal operation
-- there should be ZERO duplicates. This block is a paranoid guard against
-- prior migrations / direct DB edits / RLS bypasses that could have left
-- duplicate (u, c, role) rows behind.

DO $$
DECLARE
  v_dup_tuple_count int;
BEGIN
  SELECT COUNT(*)
    INTO v_dup_tuple_count
    FROM (
      SELECT user_id, contract_id, contract_role
        FROM user_contract_roles
        GROUP BY user_id, contract_id, contract_role
        HAVING COUNT(*) > 1
    ) dupes;

  IF v_dup_tuple_count > 0 THEN
    RAISE EXCEPTION
      'ABORT: % duplicate (user_id, contract_id, contract_role) tuples '
      'already exist in user_contract_roles. Resolve them manually '
      '(soft-deactivate or delete duplicates) before re-running '
      'Migration 045. The transaction has been rolled back; nothing '
      'was changed.',
      v_dup_tuple_count;
  END IF;

  RAISE NOTICE '✓ Pre-flight: no duplicate (user, contract, role) tuples';
END $$;


-- ── 6. Drop the old (user_id, contract_id) UNIQUE constraint ───────────
-- We look up the constraint by SHAPE (which two columns it covers) rather
-- than by name, because PostgreSQL auto-named the constraint in
-- Migration 025. The likely name is
-- `user_contract_roles_user_id_contract_id_key` but we don't rely on it.
--
-- This block is idempotent: if the constraint has already been dropped on
-- a previous run, it logs a notice and continues. It is also safe — only
-- dropping the EXACT (user_id, contract_id) two-column unique constraint;
-- it does NOT touch the primary key or any other constraint.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  RAISE NOTICE 'Dropping old UNIQUE (user_id, contract_id) constraint';

  SELECT conname
    INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'public.user_contract_roles'::regclass
     AND contype  = 'u'
     -- pg_get_constraintdef formats two-column unique constraints
     -- as exactly "UNIQUE (user_id, contract_id)" (column order
     -- preserved, single space after comma).
     AND pg_get_constraintdef(oid) ILIKE 'UNIQUE (user_id, contract_id)%'
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.user_contract_roles DROP CONSTRAINT %I',
      v_constraint_name
    );
    RAISE NOTICE '✓ Dropped old constraint: %', v_constraint_name;
  ELSE
    RAISE NOTICE '⊘ Old (user_id, contract_id) UNIQUE constraint not '
                 'found — assumed already swapped on a previous run';
  END IF;
END $$;


-- ── 7. Add the new 3-tuple UNIQUE constraint ───────────────────────────
-- Idempotent — uses IF NOT EXISTS via a probe in pg_constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.user_contract_roles'::regclass
       AND conname  = 'user_contract_roles_user_contract_role_key'
  ) THEN
    ALTER TABLE public.user_contract_roles
      ADD CONSTRAINT user_contract_roles_user_contract_role_key
      UNIQUE (user_id, contract_id, contract_role);
    RAISE NOTICE '✓ Added new 3-tuple unique constraint';
  ELSE
    RAISE NOTICE '⊘ New 3-tuple unique constraint already present — skipped';
  END IF;
END $$;


-- ── 8. Documentation ────────────────────────────────────────────────────

COMMENT ON CONSTRAINT user_contract_roles_user_contract_role_key
  ON user_contract_roles IS
  'A user may hold one row per (contract, contract_role). Multiple rows '
  'for the same (user, contract) are allowed when the role differs '
  '(e.g. مدير مشروع + تدقيق). Soft-delete via is_active=false rather '
  'than DELETE.';

COMMENT ON COLUMN user_contract_roles.contract_role IS
  'Excel canonical roles: '
  'contractor (مقاول), supervisor (مكتب استشاري), auditor (تدقيق), '
  'reviewer (مراجع — governance), quality (جودة — advisory only, '
  'no workflow gate), project_manager (مدير مشروع), '
  'final_approver (معتمد نهائي), viewer.';


-- ── 9. Final notice ─────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Migration 045 applied successfully.';
  RAISE NOTICE '  • contract_role enum extended with 3 values';
  RAISE NOTICE '  • user_contract_roles uniqueness key swapped to 3-tuple';
  RAISE NOTICE 'Run validation queries (see migration header / docs) to verify.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
--  End of migration. Validation queries follow as standalone reads
--  (uncomment/run them manually post-COMMIT to verify).
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: enum has 8 values including the 3 new ones.
-- SELECT enumlabel
--   FROM pg_enum
--  WHERE enumtypid = 'contract_role'::regtype
--  ORDER BY enumsortorder;

-- VAL-2: only the 3-tuple unique constraint remains; the old one is gone.
-- SELECT conname, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--  WHERE conrelid = 'public.user_contract_roles'::regclass
--    AND contype = 'u';

-- VAL-3: zero rows violate the new constraint.
-- SELECT user_id, contract_id, contract_role, COUNT(*) AS dup_count
--   FROM user_contract_roles
--   GROUP BY 1,2,3
--   HAVING COUNT(*) > 1;

-- VAL-4: row count unchanged from before migration.
-- SELECT COUNT(*) AS total_rows FROM user_contract_roles;

-- VAL-5: positive multi-role test (run on staging only, then ROLLBACK).
-- BEGIN;
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES
--       ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager'),
--       ('<staging-user-uuid>', '<staging-contract-uuid>', 'auditor');
--   -- Both inserts must succeed.
-- ROLLBACK;

-- VAL-6: negative duplicate test (run on staging only, then ROLLBACK).
-- BEGIN;
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager');
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager');
--   -- The second insert must FAIL with "duplicate key value violates
--   --  unique constraint user_contract_roles_user_contract_role_key".
-- ROLLBACK;


-- ════════════════════════════════════════════════════════════════════
--  STEP 39  —  MIGRATION  —  seq=046
--  Source: current: migrations/046_quality_and_pm_stages.sql
--  Reason: quality + project_manager workflow stages
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 046 — Quality Unit + Project Manager + flexible-return
--
--  Purpose
--  -------
--  Adds SEVEN new claim_status enum values to support:
--   (a) the mandatory Quality Unit stage (وحدة الجودة بالوزارة)
--   (b) the Project Manager monitoring stage (مدير المشروع)
--   (c) flexible-return routing — every gating stage now exposes a "Return"
--       action whose target may be the contractor (→ a stage-specific
--       returned_by_* status) OR any earlier review stage (→ that stage's
--       under_*_review status, which already exists). The seven new values
--       are the missing returned_by_* sinks, one per gating stage.
--
--      under_technical_review            (NEW — Technical Unit gate)
--      under_quality_review               (NEW — Quality Unit gate, 1-day SLA)
--      under_project_manager_review       (NEW — PM monitoring gate)
--      returned_by_technical              (NEW — Technical → Contractor)
--      returned_by_quality                (NEW — Quality → Contractor)
--      returned_by_project_manager        (NEW — PM → Contractor)
--      returned_by_final_approver         (NEW — Final Approval → Contractor)
--
--  Forward-flow naming: claims that today land in `under_reviewer_check`
--  (the legacy Reviewer/governance stage) will, after the application-layer
--  refactor, land in `under_quality_review` (post Technical Unit) /
--  `under_project_manager_review` (post Quality) instead. The legacy enum
--  values `under_reviewer_check` and `under_auditor_review` REMAIN in the
--  enum so existing claim rows still validate; the new state machine simply
--  no longer routes new claims into them.
--
--  We DO NOT rename existing enum values. PostgreSQL enum-rename is
--  destructive (requires drop-and-recreate of the type, which touches every
--  column that references it and forces table-level locks). The
--  `pending_director_approval` enum value is kept as-is and relabelled in
--  the UI to "بانتظار الاعتماد النهائي".
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunning is a no-op once applied.
--  • Non-destructive: no DROP TYPE, no DROP COLUMN, no DELETE, no UPDATE.
--  • RLS-neutral.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction.
--  • Migration 045 already applied (so the contract_role enum has
--    'project_manager' and 'quality').
--
--  Status
--  ------
--  • DRAFT — not yet executed.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Pre-flight: PG version
DO $$
DECLARE v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000 INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 046 requires PostgreSQL >= 12 (current: %)', v_pg_major;
  END IF;
END $$;

-- 2. Pre-flight: claim_status enum exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status') THEN
    RAISE EXCEPTION 'claim_status enum not found';
  END IF;
END $$;

-- 3. Pre-flight: contract_role enum has the Migration 045 values we depend on
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'quality'
  ) THEN
    RAISE EXCEPTION
      'contract_role.quality not found — Migration 045 must run first';
  END IF;
END $$;

-- 4. Idempotent enum extension — six new claim_status values.
--    The new values are NOT referenced anywhere else in this migration,
--    so the pg ≥ 12 "no use of new value in same txn" rule is respected.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_technical_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_technical_review';
    RAISE NOTICE '+ claim_status: under_technical_review';
  ELSE RAISE NOTICE '⊘ already present: under_technical_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_technical') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_technical';
    RAISE NOTICE '+ claim_status: returned_by_technical';
  ELSE RAISE NOTICE '⊘ already present: returned_by_technical';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_quality_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_quality_review';
    RAISE NOTICE '+ claim_status: under_quality_review';
  ELSE RAISE NOTICE '⊘ already present: under_quality_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_quality') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_quality';
    RAISE NOTICE '+ claim_status: returned_by_quality';
  ELSE RAISE NOTICE '⊘ already present: returned_by_quality';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_project_manager_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_project_manager_review';
    RAISE NOTICE '+ claim_status: under_project_manager_review';
  ELSE RAISE NOTICE '⊘ already present: under_project_manager_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_project_manager') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_project_manager';
    RAISE NOTICE '+ claim_status: returned_by_project_manager';
  ELSE RAISE NOTICE '⊘ already present: returned_by_project_manager';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_final_approver') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_final_approver';
    RAISE NOTICE '+ claim_status: returned_by_final_approver';
  ELSE RAISE NOTICE '⊘ already present: returned_by_final_approver';
  END IF;
END $$;

-- 5. Documentation
COMMENT ON TYPE claim_status IS
  'Claim workflow status. After Migration 046 the canonical pipeline is: '
  'draft → under_supervisor_review → under_technical_review → '
  'under_quality_review → under_project_manager_review → '
  'pending_director_approval (label: "بانتظار الاعتماد النهائي") → '
  'approved/rejected. Each gating stage has a matching returned_by_* '
  'status used when the reviewer chooses "return to Contractor"; returns '
  'to an earlier review stage reuse that stage''s under_*_review status '
  'directly. The legacy under_auditor_review and under_reviewer_check '
  'values remain in the enum for backward compatibility with claims '
  'created before this migration; new claims will not enter those '
  'statuses.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
--  Validation queries — run AFTER commit
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: enum has the seven new values
-- SELECT enumlabel FROM pg_enum
--   WHERE enumtypid = 'claim_status'::regtype
--   ORDER BY enumsortorder;
--
-- Expected: at minimum the seven labels below are present
--   under_technical_review
--   returned_by_technical
--   under_quality_review
--   returned_by_quality
--   under_project_manager_review
--   returned_by_project_manager
--   returned_by_final_approver

-- VAL-2: row-count snapshot — existing claims unaffected
-- SELECT status, COUNT(*) FROM claims GROUP BY status ORDER BY 1;

-- VAL-3: zero claims should be in any of the new statuses immediately
--        after the migration (UI is not yet using them)
-- SELECT status, COUNT(*) FROM claims
--  WHERE status IN ('under_technical_review','returned_by_technical',
--                   'under_quality_review','returned_by_quality',
--                   'under_project_manager_review','returned_by_project_manager',
--                   'returned_by_final_approver')
--  GROUP BY status;
-- Expected: zero rows.

-- VAL-4: positive smoke — insert + rollback for each new status to confirm
--        the enum value is accepted by the column. Run on staging only.
-- BEGIN;
--   INSERT INTO claims (id, claim_no, contract_id, status, claim_type, ...)
--     VALUES (gen_random_uuid(), 99901, '<staging-contract>', 'under_quality_review', 'boq_only', ...),
--            (gen_random_uuid(), 99902, '<staging-contract>', 'returned_by_quality', 'boq_only', ...),
--            (gen_random_uuid(), 99903, '<staging-contract>', 'under_project_manager_review', 'boq_only', ...),
--            (gen_random_uuid(), 99904, '<staging-contract>', 'returned_by_project_manager', 'boq_only', ...),
--            (gen_random_uuid(), 99905, '<staging-contract>', 'under_technical_review', 'boq_only', ...),
--            (gen_random_uuid(), 99906, '<staging-contract>', 'returned_by_technical', 'boq_only', ...),
--            (gen_random_uuid(), 99907, '<staging-contract>', 'returned_by_final_approver', 'boq_only', ...);
-- ROLLBACK;

-- VAL-5 (post application deploy): flexible-return audit smoke — confirm
-- the workflow log captures the picked target. Pick a recent claim that
-- has experienced a return and verify both `from_status` and `to_status`
-- match a row in §3d's table.
-- SELECT cw.claim_id, cw.action, cw.from_status, cw.to_status,
--        cw.notes, cw.created_at
--   FROM claim_workflow cw
--  WHERE cw.action = 'return'
--    AND cw.created_at > NOW() - INTERVAL '7 days'
--  ORDER BY cw.created_at DESC LIMIT 20;


-- ════════════════════════════════════════════════════════════════════
--  STEP 40  —  MIGRATION  —  seq=047
--  Source: current: migrations/047_claim_kind_and_number.sql
--  Reason: claim_kind, claim_number, partial unique
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 047 — Claim Kind + Auto-Numbered claim_number + Open-Claim
--                  Guard Index
--
--  Purpose
--  -------
--  Adds the columns and ENUM that back the new "تقديم مطالبة مالية"
--  flow.  No application logic ships in this migration — the
--  claim_number generator and the open-claim guard live in the
--  /api/claims/create route (Commit 2).  This migration is purely
--  schema/index work and is safe to run before the API code lands.
--
--  Adds:
--    • ENUM claim_kind = ('running_payment','final_payment','advance_payment')
--    • claims.claim_kind         claim_kind  (nullable for legacy)
--    • claims.claim_number       TEXT        (e.g. CMH01R260504-001)
--    • claims.work_period_from   DATE        (canonical name; period_from kept)
--    • claims.work_period_to     DATE
--    • claims.external_reference TEXT        (optional external ref;
--                                             replaces the spec role of
--                                             the old free-text reference_no)
--    • claims.claim_sequence     INT         (per-contract running seq)
--    • UNIQUE INDEX ux_claims_claim_number
--    • UNIQUE INDEX ux_claims_contract_sequence
--    • INDEX ix_claims_contract_status_open
--    • CHECK chk_work_period_order  (NOT VALID — legacy rows tolerated)
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunnable. ENUM, columns, constraint, indexes all use
--    existence guards.
--  • Non-destructive: no DROP TYPE / DROP COLUMN / DELETE / UPDATE on
--    existing data, except a one-time NULL-safe backfill of
--    work_period_from / work_period_to from period_from / period_to so
--    legacy claims have meaningful values for the new column. No
--    column is renamed; period_from / period_to remain.
--  • RLS-neutral.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction (no values are added in this file
--    but the version constraint is asserted defensively).
--  • Migration 046 already applied (claim_status enum has the seven
--    Phase-2.6 values).
--
--  Status
--  ------
--  • DRAFT — not yet executed against any DB.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 0 — Pre-flight checks
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000 INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 047 requires PostgreSQL >= 12 (current: %)', v_pg_major;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'claims'
  ) THEN
    RAISE EXCEPTION 'claims table not found — base schema must run first';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_quality_review'
  ) THEN
    RAISE EXCEPTION
      'claim_status.under_quality_review missing — Migration 046 must run first';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 — ENUM claim_kind  (idempotent)
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE claim_kind AS ENUM (
    'running_payment',     -- مستخلص جاري   (UI label) — code R
    'final_payment',       -- مستخلص ختامي                     code F
    'advance_payment'      -- دفعة مقدمة                       code A
  );
EXCEPTION WHEN duplicate_object THEN
  -- Type already exists — leave as-is. If a future change needs to
  -- ADD VALUE, do it in a separate migration since ALTER TYPE … ADD
  -- VALUE inside the same txn that uses the value is forbidden.
  NULL;
END $$;

COMMENT ON TYPE claim_kind IS
  'Payment-cycle classifier for a financial claim. Distinct from '
  'claim_type (boq_only / staff_only / mixed / supervision) which is '
  'the structural classifier. Added by Migration 047.';

-- ════════════════════════════════════════════════════════════════════
-- PHASE 2 — New columns on claims  (all nullable, all IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_kind          claim_kind;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_number        TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS work_period_from    DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS work_period_to      DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS external_reference  TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_sequence      INT;

COMMENT ON COLUMN claims.claim_kind IS
  'Payment-cycle classifier (running_payment / final_payment / '
  'advance_payment). NULL on rows that pre-date Migration 047.';
COMMENT ON COLUMN claims.claim_number IS
  'System-issued claim identifier in the form '
  '<ProjectCode><KindCode><YYMMDD>-<Seq>, e.g. CMH01R260504-001. '
  'Populated by /api/claims/create under pg_advisory_xact_lock. '
  'NULL on rows that pre-date Migration 047 / Commit 2.';
COMMENT ON COLUMN claims.work_period_from IS
  'Canonical "from" date of the period covered by this claim. '
  'period_from is retained for legacy reports.';
COMMENT ON COLUMN claims.work_period_to IS
  'Canonical "to" date of the period. Must be >= work_period_from '
  'when both are populated (chk_work_period_order, NOT VALID).';
COMMENT ON COLUMN claims.external_reference IS
  'Optional free-text external reference (e.g. اعتماد number). '
  'Replaces the spec role of the previously-required reference_no. '
  'Never used as the system identity — see claim_number.';
COMMENT ON COLUMN claims.claim_sequence IS
  'Per-contract running sequence (1, 2, 3, …). Set by the API under '
  'pg_advisory_xact_lock(hashtext(contract_id::text)) so concurrent '
  'inserts on the same contract serialise. NULL on legacy rows.';

-- ════════════════════════════════════════════════════════════════════
-- PHASE 3 — One-shot, NULL-safe backfill from period_from / period_to
-- ════════════════════════════════════════════════════════════════════

UPDATE claims
   SET work_period_from = period_from
 WHERE work_period_from IS NULL
   AND period_from IS NOT NULL;

UPDATE claims
   SET work_period_to = period_to
 WHERE work_period_to IS NULL
   AND period_to IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 4 — CHECK constraint chk_work_period_order  (idempotent guard)
-- ════════════════════════════════════════════════════════════════════
--
-- ALTER TABLE ADD CONSTRAINT throws if the constraint already exists,
-- which would break a rerun. Guard via pg_constraint lookup. NOT VALID
-- so any pre-existing rows that violate the predicate (extremely
-- unlikely — period_to >= period_from is the historical convention)
-- do not abort the migration. Run a separate `ALTER TABLE claims
-- VALIDATE CONSTRAINT chk_work_period_order;` later if/when a full
-- audit confirms zero violations.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'chk_work_period_order'
       AND conrelid = 'public.claims'::regclass
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT chk_work_period_order
      CHECK (work_period_to IS NULL
             OR work_period_from IS NULL
             OR work_period_to >= work_period_from)
      NOT VALID;
    RAISE NOTICE '+ chk_work_period_order added (NOT VALID)';
  ELSE
    RAISE NOTICE '⊘ chk_work_period_order already present';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 5 — Indexes
-- ════════════════════════════════════════════════════════════════════

-- 5a. Unique partial index on claim_number (only when populated).
--     Legacy rows have NULL claim_number; partial index ignores them
--     so legacy data does not block uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS ux_claims_claim_number
  ON claims (claim_number)
 WHERE claim_number IS NOT NULL;

-- 5b. Unique partial index on (contract_id, claim_sequence).
--     The API computes the next sequence under an advisory lock; the
--     unique index is the second line of defence that turns any race
--     condition into a 23505 error rather than silent duplication.
CREATE UNIQUE INDEX IF NOT EXISTS ux_claims_contract_sequence
  ON claims (contract_id, claim_sequence)
 WHERE claim_sequence IS NOT NULL;

-- 5c. Performance index for the open-claim guard.
--     "Open" = NOT IN ('approved','rejected','cancelled','closed').
--     Speeds up the existence check the API runs before allowing a
--     new claim on a contract.
CREATE INDEX IF NOT EXISTS ix_claims_contract_status_open
  ON claims (contract_id, status)
 WHERE status NOT IN ('approved','rejected','cancelled','closed');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- ProjectCode mapping (documentation only — resolver lives in the API)
-- ═════════════════════════════════════════════════════════════════════════
--
-- Per the 2026-05-04 implementation decision, /api/claims/create owns
-- the resolver from `contracts.contract_no` to the 5-character project
-- code used inside `claim_number`. The migration does NOT contain a SQL
-- function for this — keeping business config in code makes it
-- unit-testable and lets future contracts be added without a new
-- migration.
--
-- Authoritative mapping at the time of this migration:
--
--     contract_no          → project_code
--     -----------------------+------------
--     'CMH_01-C01'         → 'CMH01'
--     '250101116428'       → 'CMH02'
--     '241039011332'       → 'CMH03'
--
-- Resolver contract:
--   • If the contract_no IS the literal 'CMH_xx-Cyy' shape, project_code
--     = first three chars + the two-digit project number, all uppercase,
--     no underscore (e.g. 'CMH_01-C01' → 'CMH01').
--   • Otherwise the resolver MUST consult the explicit mapping table.
--   • If neither rule applies the API MUST fail with HTTP 422 and the
--     Arabic message "تعذّر تحديد كود المشروع لهذا العقد — تواصل مع
--     مدير الإدارة قبل المتابعة." A claim_number is NEVER silently
--     malformed.

-- ═════════════════════════════════════════════════════════════════════════
-- Validation queries — run AFTER commit (NOT inside the migration txn)
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: confirm the 6 new columns exist on claims.
-- Expected: 6 rows (claim_kind, claim_number, work_period_from,
--                   work_period_to, external_reference, claim_sequence).
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'claims'
--    AND column_name IN (
--      'claim_kind','claim_number','work_period_from',
--      'work_period_to','external_reference','claim_sequence'
--    )
--  ORDER BY column_name;

-- VAL-2: confirm ENUM claim_kind has the 3 values.
-- Expected: 3 rows.
-- SELECT enumlabel FROM pg_enum
--  WHERE enumtypid = 'claim_kind'::regtype
--  ORDER BY enumsortorder;

-- VAL-3: confirm the 3 new indexes exist.
-- Expected: 3 rows (ix_claims_contract_status_open,
--                   ux_claims_claim_number,
--                   ux_claims_contract_sequence).
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename = 'claims'
--    AND indexname IN (
--      'ux_claims_claim_number',
--      'ux_claims_contract_sequence',
--      'ix_claims_contract_status_open'
--    )
--  ORDER BY indexname;

-- VAL-4: confirm chk_work_period_order exists. NOT VALID is acceptable
-- — the trailing 't' in convalidated would be 'f' until the operator
-- runs ALTER TABLE … VALIDATE CONSTRAINT.
-- Expected: 1 row.
-- SELECT conname, convalidated
--   FROM pg_constraint
--  WHERE conname  = 'chk_work_period_order'
--    AND conrelid = 'public.claims'::regclass;

-- VAL-5: snapshot of legacy claims that should now have NULL on the
-- new columns (proves the migration didn't accidentally backfill
-- claim_kind / claim_number / claim_sequence).
-- Expected: claim_kind/claim_number/claim_sequence all NULL on every row.
-- SELECT COUNT(*)                                          AS total_rows,
--        COUNT(claim_kind)                                 AS rows_with_kind,
--        COUNT(claim_number)                               AS rows_with_number,
--        COUNT(claim_sequence)                             AS rows_with_sequence,
--        COUNT(work_period_from)                           AS rows_with_wpf,
--        COUNT(work_period_to)                             AS rows_with_wpt
--   FROM claims;

-- VAL-6: smoke check of the constraint — only run on staging/dev.
-- Expected: the second INSERT raises a check_violation; ROLLBACK leaves
-- nothing behind.
-- BEGIN;
--   INSERT INTO claims (id, contract_id, claim_no, status, claim_type,
--                       work_period_from, work_period_to)
--     VALUES (gen_random_uuid(), '<staging-contract>', 99001,
--             'draft','boq_only',
--             '2026-05-15','2026-05-01');                     -- INVALID
--   -- "ERROR: new row for relation \"claims\" violates check constraint"
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Rollback notes
-- ═════════════════════════════════════════════════════════════════════════
-- • Forward-only ENUM: PostgreSQL has no DROP VALUE. If the application
--   layer reverts to pre-Commit-2 code the ENUM stays unused and is
--   harmless.
-- • Soft revert (DDL):
--     DROP INDEX IF EXISTS ix_claims_contract_status_open;
--     DROP INDEX IF EXISTS ux_claims_contract_sequence;
--     DROP INDEX IF EXISTS ux_claims_claim_number;
--     ALTER TABLE claims DROP CONSTRAINT IF EXISTS chk_work_period_order;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_sequence;
--     ALTER TABLE claims DROP COLUMN IF EXISTS external_reference;
--     ALTER TABLE claims DROP COLUMN IF EXISTS work_period_to;
--     ALTER TABLE claims DROP COLUMN IF EXISTS work_period_from;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_number;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_kind;
--     DROP TYPE IF EXISTS claim_kind;
--   The DROP COLUMN sequence is safe ONLY if no row carries non-NULL
--   values on those columns yet (use VAL-5 to verify before dropping).


-- ════════════════════════════════════════════════════════════════════
--  STEP 41  —  MIGRATION  —  seq=048
--  Source: current: migrations/048_create_claim_with_items_atomic.sql
--  Reason: atomic create RPC
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 048 — create_claim_with_items_atomic RPC
--
--  Purpose
--  -------
--  Adds a single PL/pgSQL function that the new /api/claims/create
--  route calls to atomically:
--    • enforce the open-claim guard (no new claim while another is open
--      on the same contract);
--    • compute prev_progress per BOQ item from the server's source of
--      truth (sum of curr_progress on approved claims) — completely
--      ignoring any prev_progress sent by the client;
--    • validate curr_progress is non-negative and ≤ remaining;
--    • allocate `claim_sequence` under `pg_advisory_xact_lock` so two
--      simultaneous inserts on the same contract serialise;
--    • format `claim_number` = <ProjectCode><KindCode><YYMMDD>-<Seq>;
--    • INSERT the claim row + claim_boq_items + claim_staff_items in
--      one transaction;
--    • RETURN the new claim's identity in jsonb.
--
--  Why this lives in the DB
--  ------------------------
--  Supabase JS doesn't expose a way to wrap multiple INSERTs in a single
--  transaction from the browser/server. Without this function the API
--  could leave orphan items if the second/third INSERT failed. The
--  existing pattern (Migration 035 → submit_claim_atomic) uses the
--  same approach. Migration 048 replicates the pattern for create.
--
--  Properties
--  ----------
--  • Single statement, idempotent (CREATE OR REPLACE).
--  • Non-destructive: no DROP, no DELETE, no rename.
--  • SECURITY DEFINER — runs as the function owner so the API caller
--    needs only RPC-execute privilege. Auth/role checks happen in the
--    API layer (the route resolves the JWT user and verifies the
--    contractor ContractRole on the contract before invoking).
--  • Pre-conditions:
--      ▸ Migration 047 already applied (claim_kind enum + new columns).
--      ▸ claim_status enum has 'draft' (base schema).
--
--  Status
--  ------
--  • DRAFT — not yet executed against any DB.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- Pre-flight
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_kind' AND e.enumlabel = 'running_payment'
  ) THEN
    RAISE EXCEPTION
      'claim_kind enum missing — Migration 047 must run first';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'claims'
       AND column_name = 'claim_number'
  ) THEN
    RAISE EXCEPTION
      'claims.claim_number column missing — Migration 047 must run first';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Function: create_claim_with_items_atomic
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_claim_with_items_atomic(
  p_contract_id        UUID,
  p_claim_kind         claim_kind,
  p_claim_type         TEXT,                 -- existing claim_type ENUM (boq_only / staff_only / mixed / supervision)
  p_work_period_from   DATE,
  p_work_period_to     DATE,
  p_external_reference TEXT,                 -- nullable
  p_actor_id           UUID,
  p_project_code       TEXT,                 -- pre-resolved by API (e.g. 'CMH01')
  p_boq_amount         NUMERIC,
  p_staff_amount       NUMERIC,
  p_retention_amount   NUMERIC,
  p_vat_amount         NUMERIC,
  p_boq_items          JSONB,                -- array of { item_no, description, description_ar, unit, unit_price, contractual_qty, curr_progress, performance_pct, requires_variation }
  p_staff_items        JSONB                 -- array of { item_no, position, position_ar, monthly_rate, contract_months, working_days, overtime_hours, basic_amount, extra_amount, total_amount, performance_pct, after_perf }
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_kind_code        CHAR(1);
  v_yymmdd           TEXT;
  v_max_sequence     INT;
  v_new_sequence     INT;
  v_max_claim_no     INT;
  v_new_claim_no     INT;
  v_claim_number     TEXT;
  v_claim_id         UUID;
  v_open_count       INT;
  v_item             JSONB;
  v_item_no          TEXT;
  v_unit_price       NUMERIC;
  v_contractual_qty  NUMERIC;
  v_curr_progress    NUMERIC;
  v_prev_progress    NUMERIC;
  v_remaining        NUMERIC;
  v_perf_pct         NUMERIC;
  v_period_amount    NUMERIC;
  v_after_perf       NUMERIC;
  v_resolved_kind    TEXT;
BEGIN
  -- ── 1. Validate inputs ───────────────────────────────────────────
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CONTRACT_REQUIRED: contract_id is required';
  END IF;

  IF p_claim_kind IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CLAIM_KIND_REQUIRED: claim_kind must be one of running_payment, final_payment, advance_payment';
  END IF;

  IF p_work_period_from IS NULL OR p_work_period_to IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_REQUIRED: both work_period_from and work_period_to are required';
  END IF;

  IF p_work_period_to < p_work_period_from THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_ORDER: work_period_to must be >= work_period_from';
  END IF;

  IF p_project_code IS NULL OR length(trim(p_project_code)) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'PROJECT_CODE_REQUIRED: project_code resolution failed in API; cannot generate claim_number';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ACTOR_REQUIRED: actor_id must be provided';
  END IF;

  -- ── 2. Verify contract exists ────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = p_contract_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('CONTRACT_NOT_FOUND: contract id %s does not exist', p_contract_id);
  END IF;

  -- ── 3. Open-claim guard (mirrors API guard; defence in depth) ────
  SELECT COUNT(*) INTO v_open_count
    FROM claims
   WHERE contract_id = p_contract_id
     AND status NOT IN ('approved','rejected','cancelled','closed');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'OPEN_CLAIM_EXISTS: contract %s has %s open claim(s); finalise them before creating a new claim',
        p_contract_id, v_open_count
      );
  END IF;

  -- ── 4. Advisory lock — concurrent inserts on the SAME contract
  --     serialise; different contracts can run in parallel. The lock
  --     is per-transaction (released at COMMIT/ROLLBACK).
  PERFORM pg_advisory_xact_lock(hashtext('claim:' || p_contract_id::text));

  -- ── 5. Validate every BOQ item BEFORE any INSERT ────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no         := v_item->>'item_no';
    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);

    IF v_curr_progress < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format('CURR_PROGRESS_NEGATIVE: item %s — current quantity cannot be negative', v_item_no);
    END IF;

    -- Server-truth prev_progress: sum of curr_progress on approved
    -- claims for this contract + item_no. CLIENT input ignored.
    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no = v_item_no
       AND c.status = 'approved';

    v_remaining := v_contractual_qty - v_prev_progress;

    IF v_curr_progress > v_remaining THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'CURR_PROGRESS_EXCEEDS_REMAINING: item %s — current (%s) exceeds remaining (%s = contractual %s − previous %s)',
          v_item_no, v_curr_progress, v_remaining, v_contractual_qty, v_prev_progress
        );
    END IF;
  END LOOP;

  -- ── 6. Compute claim_sequence under the advisory lock ───────────
  SELECT COALESCE(MAX(claim_sequence), 0) INTO v_max_sequence
    FROM claims
   WHERE contract_id = p_contract_id;
  v_new_sequence := v_max_sequence + 1;

  -- ── 7. Compute legacy claim_no (still referenced by some reports)
  SELECT COALESCE(MAX(claim_no), 0) + 1 INTO v_new_claim_no
    FROM claims
   WHERE contract_id = p_contract_id;

  -- ── 8. Format claim_number ──────────────────────────────────────
  v_kind_code := CASE p_claim_kind
                   WHEN 'running_payment' THEN 'R'
                   WHEN 'final_payment'   THEN 'F'
                   WHEN 'advance_payment' THEN 'A'
                 END;

  -- Asia/Riyadh local date so a claim filed at 23:30 KSA doesn't get
  -- the previous-day code (UTC offset is +03:00).
  v_yymmdd := TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYMMDD');

  v_claim_number := upper(p_project_code) ||
                    v_kind_code ||
                    v_yymmdd ||
                    '-' ||
                    LPAD(v_new_sequence::TEXT, 3, '0');

  -- ── 9. INSERT claim row ─────────────────────────────────────────
  INSERT INTO claims (
    contract_id, claim_no, claim_number, claim_sequence,
    claim_kind, claim_type, status,
    work_period_from, work_period_to,
    period_from, period_to,                            -- legacy mirror
    invoice_date,
    external_reference,
    boq_amount, staff_amount, retention_amount, vat_amount,
    submitted_by, submitted_at,
    created_by
  ) VALUES (
    p_contract_id, v_new_claim_no, v_claim_number, v_new_sequence,
    p_claim_kind, p_claim_type::claim_type, 'draft',
    p_work_period_from, p_work_period_to,
    p_work_period_from, p_work_period_to,
    p_work_period_to,
    NULLIF(trim(p_external_reference), ''),
    COALESCE(p_boq_amount, 0), COALESCE(p_staff_amount, 0),
    COALESCE(p_retention_amount, 0), COALESCE(p_vat_amount, 0),
    NULL, NULL,                                         -- submitted_by/at left NULL for draft
    p_actor_id
  )
  RETURNING id INTO v_claim_id;

  -- ── 10. INSERT claim_boq_items (with server-recomputed prev_progress)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no         := v_item->>'item_no';
    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);
    v_perf_pct        := COALESCE((v_item->>'performance_pct')::NUMERIC, 100);

    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no = v_item_no
       AND c.status = 'approved';

    v_period_amount := v_curr_progress * v_unit_price;
    v_after_perf    := v_period_amount * v_perf_pct / 100.0;

    INSERT INTO claim_boq_items (
      claim_id, item_no, description, description_ar,
      unit, unit_price, contractual_qty,
      prev_progress, curr_progress, cumulative,
      period_amount, performance_pct, after_perf,
      requires_variation
    ) VALUES (
      v_claim_id,
      v_item_no,
      v_item->>'description',
      v_item->>'description_ar',
      v_item->>'unit',
      v_unit_price,
      v_contractual_qty,
      v_prev_progress,
      v_curr_progress,
      v_prev_progress + v_curr_progress,
      v_period_amount,
      v_perf_pct,
      v_after_perf,
      COALESCE((v_item->>'requires_variation')::BOOLEAN, false)
    );
  END LOOP;

  -- ── 11. INSERT claim_staff_items (pass-through; no prev computation)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_staff_items, '[]'::jsonb))
  LOOP
    INSERT INTO claim_staff_items (
      claim_id, item_no, position, position_ar,
      monthly_rate, contract_months,
      working_days, overtime_hours,
      basic_amount, extra_amount, total_amount,
      performance_pct, after_perf
    ) VALUES (
      v_claim_id,
      v_item->>'item_no',
      v_item->>'position',
      v_item->>'position_ar',
      COALESCE((v_item->>'monthly_rate')::NUMERIC, 0),
      COALESCE((v_item->>'contract_months')::INT, 0),
      COALESCE((v_item->>'working_days')::NUMERIC, 0),
      COALESCE((v_item->>'overtime_hours')::NUMERIC, 0),
      COALESCE((v_item->>'basic_amount')::NUMERIC, 0),
      COALESCE((v_item->>'extra_amount')::NUMERIC, 0),
      COALESCE((v_item->>'total_amount')::NUMERIC, 0),
      COALESCE((v_item->>'performance_pct')::NUMERIC, 100),
      COALESCE((v_item->>'after_perf')::NUMERIC, 0)
    );
  END LOOP;

  v_resolved_kind := p_claim_kind::TEXT;

  RETURN jsonb_build_object(
    'id',             v_claim_id,
    'claim_no',       v_new_claim_no,
    'claim_number',   v_claim_number,
    'claim_sequence', v_new_sequence,
    'claim_kind',     v_resolved_kind,
    'status',         'draft'
  );
END;
$func$;

COMMENT ON FUNCTION create_claim_with_items_atomic IS
  'Phase 2.6 / Commit 2 — atomic claim creation. Called by '
  '/api/claims/create. Computes prev_progress from approved claims '
  '(server source of truth), allocates claim_sequence under '
  'pg_advisory_xact_lock(contract_id), formats claim_number = '
  '<ProjectCode><KindCode><YYMMDD>-<Seq> using Asia/Riyadh date, '
  'and inserts the claim + items in one transaction. Returns '
  'jsonb { id, claim_no, claim_number, claim_sequence, claim_kind, '
  'status }. SECURITY DEFINER — auth checks live in the API.';

-- Grant execute to the application roles (Supabase default).
-- Idempotent: re-grant is a no-op if already granted.
GRANT EXECUTE ON FUNCTION
  create_claim_with_items_atomic(
    UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
  )
  TO authenticated, service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Validation queries — run AFTER commit
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: function exists and is SECURITY DEFINER.
-- Expected: 1 row, prosecdef = true.
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-2: signature matches what /api/claims/create expects.
-- Expected: 14 IN parameters in the order documented above.
-- SELECT pg_get_function_arguments(oid)
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-3 (staging only): smoke test — open-claim guard fires.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-with-an-open-claim>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[]'::jsonb, '[]'::jsonb
--   );
--   -- Must raise: OPEN_CLAIM_EXISTS
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Rollback notes
-- ═════════════════════════════════════════════════════════════════════════
-- • DROP FUNCTION IF EXISTS create_claim_with_items_atomic(
--     UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
--     NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
--   );
-- • Once the API code (Commit 3) starts calling this function in
--   production, dropping it will surface as HTTP 500 from
--   /api/claims/create. Roll back the API code first if the function
--   needs to be removed.


-- ════════════════════════════════════════════════════════════════════
--  STEP 42  —  MIGRATION  —  seq=049
--  Source: current: migrations/049_fix_claim_rpc_item_no_cast.sql
--  Reason: RPC item_no cast fix
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 049 — Fix `operator does not exist: integer = text` in the
--                  claim-creation RPC by safely casting JSONB-extracted
--                  BOQ / staff item identifiers.
--
--  Symptom (post-deploy 2026-05-05)
--  --------------------------------
--  Every "تقديم المطالبة" / "حفظ كمسودة" attempt on the New Claim page
--  surfaced
--      ERROR:  operator does not exist: integer = text
--  through the API → toast pipeline (Stabilization S1 made the message
--  visible; the bug itself is older).
--
--  Root cause
--  ----------
--  Migration 048 declared
--      v_item_no  TEXT;
--  and populated it with `v_item->>'item_no'` (the JSONB ->> operator
--  always yields TEXT, regardless of whether the JSON value was a number
--  or a string).  The RPC then compared `cb.item_no = v_item_no` against
--  `claim_boq_items.item_no`, whose column type is INTEGER.  PostgreSQL
--  has no implicit `integer = text` operator, so the validation pass
--  raised before any insert was attempted.
--
--  Same latent bug for staff items: the INSERT into `claim_staff_items`
--  passed `v_item->>'item_no'` directly into the INTEGER column.  That
--  insert was never reached in practice because the BOQ validation
--  failed first, but it is fixed in this migration as defence in depth.
--
--  Authoritative evidence
--  ----------------------
--  • TS types confirm the column types:
--      lib/types.ts:249  `item_no: number`  (ClaimBOQItem)
--      lib/types.ts:269  `item_no: number`  (ClaimStaffItem)
--  • API sanitiser already serialises `item_no` as a JSON value the RPC
--    can cast safely:
--      app/api/claims/create/route.ts:118 — `String(r.item_no ?? '').trim()`
--    (the cast inside the RPC handles both numeric and stringified JSON
--    inputs.)
--
--  Why a NEW migration (049) and not an in-place edit of 048
--  ---------------------------------------------------------
--  Migration 048 has already been applied to the test database.
--  PostgreSQL `CREATE OR REPLACE FUNCTION` accepts a fresh definition
--  with the SAME signature, so this file ships the corrected RPC body
--  WITHOUT touching the contract of the route or any other migration.
--  No DROP, no rename, no schema migration.  Idempotent and reversible
--  (re-applying 048 would restore the bug — the rollback path).
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: `CREATE OR REPLACE FUNCTION`.
--  • Non-destructive: no DROP, no DELETE, no rename.
--  • SECURITY DEFINER — same as 048; auth checks remain in the API.
--  • Signature unchanged — `/api/claims/create` keeps working without
--    any code change.
--  • Defensive: malformed `item_no` values now raise the explicit
--    `ITEM_NO_INVALID` code with an Arabic message rather than letting
--    PostgreSQL throw a less-helpful generic 22P02 cast error.
--
--  Pre-conditions
--  --------------
--  • Migrations 047 + 048 already applied (this migration depends on
--    the `claim_kind` enum and the `claim_number` column added by 047,
--    and replaces the function defined by 048).
--
--  Status
--  ------
--  • DRAFT — not yet executed against any DB.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- Pre-flight
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'create_claim_with_items_atomic'
  ) THEN
    RAISE EXCEPTION
      'create_claim_with_items_atomic missing — Migration 048 must run first';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Function: create_claim_with_items_atomic  (REPLACEMENT — identical
--           signature; bodies differ only in safe casts and an explicit
--           ITEM_NO_INVALID guard)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_claim_with_items_atomic(
  p_contract_id        UUID,
  p_claim_kind         claim_kind,
  p_claim_type         TEXT,
  p_work_period_from   DATE,
  p_work_period_to     DATE,
  p_external_reference TEXT,
  p_actor_id           UUID,
  p_project_code       TEXT,
  p_boq_amount         NUMERIC,
  p_staff_amount       NUMERIC,
  p_retention_amount   NUMERIC,
  p_vat_amount         NUMERIC,
  p_boq_items          JSONB,
  p_staff_items        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_kind_code        CHAR(1);
  v_yymmdd           TEXT;
  v_max_sequence     INT;
  v_new_sequence     INT;
  v_max_claim_no     INT;
  v_new_claim_no     INT;
  v_claim_number     TEXT;
  v_claim_id         UUID;
  v_open_count       INT;
  v_item             JSONB;

  -- Migration 049 fix: separate "raw" TEXT from the typed integer.
  -- v_item_no_raw holds whatever JSON delivered (number-as-text after
  -- ->>); v_item_no holds the validated INTEGER used for SQL comparisons
  -- and INSERTs.
  v_item_no_raw      TEXT;
  v_item_no          INTEGER;

  v_unit_price       NUMERIC;
  v_contractual_qty  NUMERIC;
  v_curr_progress    NUMERIC;
  v_prev_progress    NUMERIC;
  v_remaining        NUMERIC;
  v_perf_pct         NUMERIC;
  v_period_amount    NUMERIC;
  v_after_perf       NUMERIC;
  v_resolved_kind    TEXT;
BEGIN
  -- ── 1. Validate inputs (unchanged from 048) ──────────────────────
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CONTRACT_REQUIRED: contract_id is required';
  END IF;

  IF p_claim_kind IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CLAIM_KIND_REQUIRED: claim_kind must be one of running_payment, final_payment, advance_payment';
  END IF;

  IF p_work_period_from IS NULL OR p_work_period_to IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_REQUIRED: both work_period_from and work_period_to are required';
  END IF;

  IF p_work_period_to < p_work_period_from THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_ORDER: work_period_to must be >= work_period_from';
  END IF;

  IF p_project_code IS NULL OR length(trim(p_project_code)) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'PROJECT_CODE_REQUIRED: project_code resolution failed in API; cannot generate claim_number';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ACTOR_REQUIRED: actor_id must be provided';
  END IF;

  -- ── 2. Verify contract exists (unchanged) ────────────────────────
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = p_contract_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('CONTRACT_NOT_FOUND: contract id %s does not exist', p_contract_id);
  END IF;

  -- ── 3. Open-claim guard (unchanged) ──────────────────────────────
  SELECT COUNT(*) INTO v_open_count
    FROM claims
   WHERE contract_id = p_contract_id
     AND status NOT IN ('approved','rejected','cancelled','closed');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'OPEN_CLAIM_EXISTS: contract %s has %s open claim(s); finalise them before creating a new claim',
        p_contract_id, v_open_count
      );
  END IF;

  -- ── 4. Advisory lock (unchanged) ────────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('claim:' || p_contract_id::text));

  -- ── 5. Validate every BOQ item BEFORE any INSERT
  --     Migration 049 fix: cast item_no to INTEGER before any
  --     comparison against `claim_boq_items.item_no` (INTEGER column).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    -- Migration 049 fix: validate item_no is a positive integer string
    -- BEFORE casting. The regex guards against decimals, negatives, and
    -- non-numeric junk; raising ITEM_NO_INVALID gives the user a clear
    -- Arabic message instead of a PostgreSQL 22P02 cast error.
    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: BOQ item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);

    IF v_curr_progress < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format('CURR_PROGRESS_NEGATIVE: item %s — current quantity cannot be negative', v_item_no);
    END IF;

    -- Server-truth prev_progress: SUM(curr_progress) over approved
    -- claims for this (contract, item_no). Comparison is now
    -- INTEGER = INTEGER thanks to the cast above.
    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no    = v_item_no                  -- ← was: cb.item_no = v_item_no_raw (TEXT)
       AND c.status      = 'approved';

    v_remaining := v_contractual_qty - v_prev_progress;

    IF v_curr_progress > v_remaining THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'CURR_PROGRESS_EXCEEDS_REMAINING: item %s — current (%s) exceeds remaining (%s = contractual %s − previous %s)',
          v_item_no, v_curr_progress, v_remaining, v_contractual_qty, v_prev_progress
        );
    END IF;
  END LOOP;

  -- ── 6. Compute claim_sequence under the advisory lock (unchanged) ─
  SELECT COALESCE(MAX(claim_sequence), 0) INTO v_max_sequence
    FROM claims
   WHERE contract_id = p_contract_id;
  v_new_sequence := v_max_sequence + 1;

  -- ── 7. Compute legacy claim_no (unchanged) ───────────────────────
  SELECT COALESCE(MAX(claim_no), 0) + 1 INTO v_new_claim_no
    FROM claims
   WHERE contract_id = p_contract_id;

  -- ── 8. Format claim_number (unchanged) ───────────────────────────
  v_kind_code := CASE p_claim_kind
                   WHEN 'running_payment' THEN 'R'
                   WHEN 'final_payment'   THEN 'F'
                   WHEN 'advance_payment' THEN 'A'
                 END;

  v_yymmdd := TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYMMDD');

  v_claim_number := upper(p_project_code) ||
                    v_kind_code ||
                    v_yymmdd ||
                    '-' ||
                    LPAD(v_new_sequence::TEXT, 3, '0');

  -- ── 9. INSERT claim row (unchanged) ──────────────────────────────
  INSERT INTO claims (
    contract_id, claim_no, claim_number, claim_sequence,
    claim_kind, claim_type, status,
    work_period_from, work_period_to,
    period_from, period_to,
    invoice_date,
    external_reference,
    boq_amount, staff_amount, retention_amount, vat_amount,
    submitted_by, submitted_at,
    created_by
  ) VALUES (
    p_contract_id, v_new_claim_no, v_claim_number, v_new_sequence,
    p_claim_kind, p_claim_type::claim_type, 'draft',
    p_work_period_from, p_work_period_to,
    p_work_period_from, p_work_period_to,
    p_work_period_to,
    NULLIF(trim(p_external_reference), ''),
    COALESCE(p_boq_amount, 0), COALESCE(p_staff_amount, 0),
    COALESCE(p_retention_amount, 0), COALESCE(p_vat_amount, 0),
    NULL, NULL,
    p_actor_id
  )
  RETURNING id INTO v_claim_id;

  -- ── 10. INSERT claim_boq_items
  --     Migration 049 fix: cast item_no to INTEGER for both the
  --     SUM(...) WHERE and the INSERT VALUES list. Same ITEM_NO_INVALID
  --     guard as the validation pass — defence in depth.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: BOQ item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);
    v_perf_pct        := COALESCE((v_item->>'performance_pct')::NUMERIC, 100);

    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no    = v_item_no                  -- ← was: TEXT
       AND c.status      = 'approved';

    v_period_amount := v_curr_progress * v_unit_price;
    v_after_perf    := v_period_amount * v_perf_pct / 100.0;

    INSERT INTO claim_boq_items (
      claim_id, item_no, description, description_ar,
      unit, unit_price, contractual_qty,
      prev_progress, curr_progress, cumulative,
      period_amount, performance_pct, after_perf,
      requires_variation
    ) VALUES (
      v_claim_id,
      v_item_no,                                       -- ← was: v_item_no (TEXT)
      v_item->>'description',
      v_item->>'description_ar',
      v_item->>'unit',
      v_unit_price,
      v_contractual_qty,
      v_prev_progress,
      v_curr_progress,
      v_prev_progress + v_curr_progress,
      v_period_amount,
      v_perf_pct,
      v_after_perf,
      COALESCE((v_item->>'requires_variation')::BOOLEAN, false)
    );
  END LOOP;

  -- ── 11. INSERT claim_staff_items (pass-through, but with the same
  --       cast + guard for item_no — defence in depth)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_staff_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: staff item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    INSERT INTO claim_staff_items (
      claim_id, item_no, position, position_ar,
      monthly_rate, contract_months,
      working_days, overtime_hours,
      basic_amount, extra_amount, total_amount,
      performance_pct, after_perf
    ) VALUES (
      v_claim_id,
      v_item_no,                                       -- ← was: v_item->>'item_no' (TEXT)
      v_item->>'position',
      v_item->>'position_ar',
      COALESCE((v_item->>'monthly_rate')::NUMERIC, 0),
      COALESCE((v_item->>'contract_months')::INT, 0),
      COALESCE((v_item->>'working_days')::NUMERIC, 0),
      COALESCE((v_item->>'overtime_hours')::NUMERIC, 0),
      COALESCE((v_item->>'basic_amount')::NUMERIC, 0),
      COALESCE((v_item->>'extra_amount')::NUMERIC, 0),
      COALESCE((v_item->>'total_amount')::NUMERIC, 0),
      COALESCE((v_item->>'performance_pct')::NUMERIC, 100),
      COALESCE((v_item->>'after_perf')::NUMERIC, 0)
    );
  END LOOP;

  v_resolved_kind := p_claim_kind::TEXT;

  RETURN jsonb_build_object(
    'id',             v_claim_id,
    'claim_no',       v_new_claim_no,
    'claim_number',   v_claim_number,
    'claim_sequence', v_new_sequence,
    'claim_kind',     v_resolved_kind,
    'status',         'draft'
  );
END;
$func$;

COMMENT ON FUNCTION create_claim_with_items_atomic IS
  'Phase 2.6 / Commit 2 — atomic claim creation. Patched 2026-05-05 by '
  'Migration 049: BOQ + staff item_no values are now cast to INTEGER '
  'before any SQL comparison or INSERT, with an explicit '
  'ITEM_NO_INVALID raise for malformed inputs. Otherwise identical to '
  'the Migration 048 definition (signature, return type, security, '
  'transaction semantics).';

-- Re-grant execute (idempotent — no-op if already granted).
GRANT EXECUTE ON FUNCTION
  create_claim_with_items_atomic(
    UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
  )
  TO authenticated, service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Validation queries — run AFTER commit
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: function exists and is SECURITY DEFINER (unchanged from 048).
-- Expected: 1 row, prosecdef = true.
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-2: signature is UNCHANGED — must match 048.
-- Expected: 14 IN parameters in the same order.
-- SELECT pg_get_function_arguments(oid)
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-3: confirm the function body now contains the safe cast.
-- Expected: ≥ 2 occurrences of `cb.item_no    = v_item_no` (no _raw)
-- and 0 occurrences of `cb.item_no = v_item_no_raw`.
-- SELECT
--   (regexp_count(pg_get_functiondef(oid), 'cb\.item_no\s+=\s+v_item_no\b'))   AS safe_eq_count,
--   (regexp_count(pg_get_functiondef(oid), 'v_item_no_raw'))                   AS raw_var_count
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-4 (optional, staging only): smoke test — happy path completes.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-uuid>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[{"item_no":"1","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
--     '[]'::jsonb
--   );
--   -- Must return a JSONB { id, claim_no, claim_number, ... }; raise if it errors.
-- ROLLBACK;

-- VAL-5 (optional, staging only): malformed item_no smoke test.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-uuid>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[{"item_no":"abc","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
--     '[]'::jsonb
--   );
--   -- Must raise: ITEM_NO_INVALID
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Rollback notes
-- ═════════════════════════════════════════════════════════════════════════
-- • To roll back to the pre-049 (broken) behaviour, re-run Migration 048.
--   The CREATE OR REPLACE in 048 will overwrite this 049 definition.
-- • Production rollback path: revert the application-layer commit that
--   pushed 049 (this file), then re-deploy 048 if the database needs to
--   be regressed for any reason. Not recommended — 048 carries the
--   integer=text bug and every claim save will fail.
-- • The function ALWAYS has the same signature, so /api/claims/create
--   does not need a change to roll forward or back.

-- ═════════════════════════════════════════════════════════════════════════
-- Future work (out of scope of 049)
-- ═════════════════════════════════════════════════════════════════════════
-- • Map the new ITEM_NO_INVALID code in app/api/claims/create/route.ts
--   to a polished Arabic message
--   (e.g. "رقم بند المطالبة غير صالح — يرجى مراجعة بيانات بنود العقد").
--   Until that lands, the route's UNKNOWN fallback prefixes the raw
--   message with "فشل إنشاء المطالبة: " — Stabilization S1 ensures the
--   user still sees that text instead of the generic catch-all toast.
-- ═════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
--  STEP 43  —  MIGRATION  —  seq=050
--  Source: current: migrations/050_fix_claim_rpc_claim_type_cast.sql
--  Reason: RPC claim_type cast removal
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  Migration 050 — Align the claim-creation RPC with the actual
--                  claims.claim_type column type (TEXT, not an enum)
--
--  Symptom (post-deploy 2026-05-05, after Migration 049 fixed the
--  integer=text bug)
--  --------------------------------------------------------------
--  The first claim save attempt now reaches further into the RPC, but
--  fails with:
--      ERROR:  type "claim_type" does not exist
--  raised by the cast `p_claim_type::claim_type` inside the INSERT
--  VALUES list of `create_claim_with_items_atomic`.
--
--  Root cause (verified by `information_schema.columns`)
--  -----------------------------------------------------
--  • `claims.claim_type` is `TEXT`. There is NO enum type named
--    `claim_type` anywhere in the database.
--  • The two claim-related enums in this DB are `claim_kind` and
--    `claim_status` only.
--  • Migration 048 (and Migration 049, which inherited the body)
--    contained the cast
--          p_claim_type::claim_type
--    on the assumption that the column was an enum. The cast resolves
--    against the type registry at execute time and raises 42704 because
--    no such type exists.
--
--  Fix shape
--  ---------
--  Replace the cast with a direct pass-through:
--      p_claim_kind, p_claim_type, 'draft',
--  The function parameter `p_claim_type` is already declared TEXT in
--  the signature (line 96 of Migration 049 / Migration 048), so no
--  shape change at the call site is required. The API in
--  app/api/claims/create/route.ts already validates the value against
--  the small whitelist {boq_only, staff_only, mixed, supervision}
--  before calling the RPC, so removing the database-level cast does
--  not weaken validation.
--
--  What is preserved verbatim from Migration 049
--  ----------------------------------------------
--  • Exact same function signature (14 IN parameters in the same
--    order, same return type).
--  • SECURITY DEFINER, search_path, GRANT EXECUTE.
--  • All Migration 049 item_no fixes (v_item_no_raw / v_item_no
--    INTEGER, ITEM_NO_INVALID guard, safe casts in every comparison
--    and INSERT) — see VAL-3 / VAL-4 below for proof.
--  • Open-claim guard, advisory lock, claim_sequence allocation,
--    claim_number formatting, prev_progress recomputation rule
--    (approved-only), staff-items pass-through, return jsonb shape.
--  • Workflow surface untouched. /api/claims/create unchanged.
--
--  Why a NEW migration (050) and not an in-place edit of 049
--  ---------------------------------------------------------
--  Migration 049 has been or will be applied to the database. Any
--  in-place edit silently mutates a migration that another operator
--  may already have on disk. PostgreSQL `CREATE OR REPLACE FUNCTION`
--  with the same signature accepts a fresh body without touching the
--  ledger or any other migration file. Idempotent and reversible
--  (re-applying 049 would restore the cast — that is the rollback).
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: `CREATE OR REPLACE FUNCTION`.
--  • Non-destructive: no DROP, no DELETE, no rename.
--  • Pre-flight asserts both 049 ran AND claims.claim_type is TEXT.
--
--  Status
--  ------
--  • DRAFT — not yet executed against any DB.
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- Pre-flight
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'create_claim_with_items_atomic'
  ) THEN
    RAISE EXCEPTION
      'create_claim_with_items_atomic missing — Migrations 048 + 049 must run first';
  END IF;
END $$;

DO $$
DECLARE v_actual_type TEXT;
BEGIN
  SELECT data_type INTO v_actual_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'claims'
     AND column_name  = 'claim_type';
  IF v_actual_type IS NULL THEN
    RAISE EXCEPTION
      'claims.claim_type column not found — base schema must run first';
  END IF;
  IF v_actual_type <> 'text' THEN
    RAISE EXCEPTION
      'claims.claim_type is %, not TEXT — Migration 050 expects TEXT, '
      'aborting before replacing the function. Investigate before retrying.',
      v_actual_type;
  END IF;
  RAISE NOTICE 'Migration 050 pre-flight OK: claims.claim_type is TEXT';
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Function: create_claim_with_items_atomic  (REPLACEMENT — identical
--           signature; bodies differ only in safe casts and an explicit
--           ITEM_NO_INVALID guard)
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_claim_with_items_atomic(
  p_contract_id        UUID,
  p_claim_kind         claim_kind,
  p_claim_type         TEXT,
  p_work_period_from   DATE,
  p_work_period_to     DATE,
  p_external_reference TEXT,
  p_actor_id           UUID,
  p_project_code       TEXT,
  p_boq_amount         NUMERIC,
  p_staff_amount       NUMERIC,
  p_retention_amount   NUMERIC,
  p_vat_amount         NUMERIC,
  p_boq_items          JSONB,
  p_staff_items        JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_kind_code        CHAR(1);
  v_yymmdd           TEXT;
  v_max_sequence     INT;
  v_new_sequence     INT;
  v_max_claim_no     INT;
  v_new_claim_no     INT;
  v_claim_number     TEXT;
  v_claim_id         UUID;
  v_open_count       INT;
  v_item             JSONB;

  -- Migration 049 fix: separate "raw" TEXT from the typed integer.
  -- v_item_no_raw holds whatever JSON delivered (number-as-text after
  -- ->>); v_item_no holds the validated INTEGER used for SQL comparisons
  -- and INSERTs.
  v_item_no_raw      TEXT;
  v_item_no          INTEGER;

  v_unit_price       NUMERIC;
  v_contractual_qty  NUMERIC;
  v_curr_progress    NUMERIC;
  v_prev_progress    NUMERIC;
  v_remaining        NUMERIC;
  v_perf_pct         NUMERIC;
  v_period_amount    NUMERIC;
  v_after_perf       NUMERIC;
  v_resolved_kind    TEXT;
BEGIN
  -- ── 1. Validate inputs (unchanged from 048) ──────────────────────
  IF p_contract_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CONTRACT_REQUIRED: contract_id is required';
  END IF;

  IF p_claim_kind IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'CLAIM_KIND_REQUIRED: claim_kind must be one of running_payment, final_payment, advance_payment';
  END IF;

  IF p_work_period_from IS NULL OR p_work_period_to IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_REQUIRED: both work_period_from and work_period_to are required';
  END IF;

  IF p_work_period_to < p_work_period_from THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'WORK_PERIOD_ORDER: work_period_to must be >= work_period_from';
  END IF;

  IF p_project_code IS NULL OR length(trim(p_project_code)) = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'PROJECT_CODE_REQUIRED: project_code resolution failed in API; cannot generate claim_number';
  END IF;

  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'ACTOR_REQUIRED: actor_id must be provided';
  END IF;

  -- ── 2. Verify contract exists (unchanged) ────────────────────────
  IF NOT EXISTS (SELECT 1 FROM contracts WHERE id = p_contract_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('CONTRACT_NOT_FOUND: contract id %s does not exist', p_contract_id);
  END IF;

  -- ── 3. Open-claim guard (unchanged) ──────────────────────────────
  SELECT COUNT(*) INTO v_open_count
    FROM claims
   WHERE contract_id = p_contract_id
     AND status NOT IN ('approved','rejected','cancelled','closed');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format(
        'OPEN_CLAIM_EXISTS: contract %s has %s open claim(s); finalise them before creating a new claim',
        p_contract_id, v_open_count
      );
  END IF;

  -- ── 4. Advisory lock (unchanged) ────────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('claim:' || p_contract_id::text));

  -- ── 5. Validate every BOQ item BEFORE any INSERT
  --     Migration 049 fix: cast item_no to INTEGER before any
  --     comparison against `claim_boq_items.item_no` (INTEGER column).
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    -- Migration 049 fix: validate item_no is a positive integer string
    -- BEFORE casting. The regex guards against decimals, negatives, and
    -- non-numeric junk; raising ITEM_NO_INVALID gives the user a clear
    -- Arabic message instead of a PostgreSQL 22P02 cast error.
    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: BOQ item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);

    IF v_curr_progress < 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format('CURR_PROGRESS_NEGATIVE: item %s — current quantity cannot be negative', v_item_no);
    END IF;

    -- Server-truth prev_progress: SUM(curr_progress) over approved
    -- claims for this (contract, item_no). Comparison is now
    -- INTEGER = INTEGER thanks to the cast above.
    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no    = v_item_no                  -- ← was: cb.item_no = v_item_no_raw (TEXT)
       AND c.status      = 'approved';

    v_remaining := v_contractual_qty - v_prev_progress;

    IF v_curr_progress > v_remaining THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'CURR_PROGRESS_EXCEEDS_REMAINING: item %s — current (%s) exceeds remaining (%s = contractual %s − previous %s)',
          v_item_no, v_curr_progress, v_remaining, v_contractual_qty, v_prev_progress
        );
    END IF;
  END LOOP;

  -- ── 6. Compute claim_sequence under the advisory lock (unchanged) ─
  SELECT COALESCE(MAX(claim_sequence), 0) INTO v_max_sequence
    FROM claims
   WHERE contract_id = p_contract_id;
  v_new_sequence := v_max_sequence + 1;

  -- ── 7. Compute legacy claim_no (unchanged) ───────────────────────
  SELECT COALESCE(MAX(claim_no), 0) + 1 INTO v_new_claim_no
    FROM claims
   WHERE contract_id = p_contract_id;

  -- ── 8. Format claim_number (unchanged) ───────────────────────────
  v_kind_code := CASE p_claim_kind
                   WHEN 'running_payment' THEN 'R'
                   WHEN 'final_payment'   THEN 'F'
                   WHEN 'advance_payment' THEN 'A'
                 END;

  v_yymmdd := TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYMMDD');

  v_claim_number := upper(p_project_code) ||
                    v_kind_code ||
                    v_yymmdd ||
                    '-' ||
                    LPAD(v_new_sequence::TEXT, 3, '0');

  -- ── 9. INSERT claim row (unchanged) ──────────────────────────────
  INSERT INTO claims (
    contract_id, claim_no, claim_number, claim_sequence,
    claim_kind, claim_type, status,
    work_period_from, work_period_to,
    period_from, period_to,
    invoice_date,
    external_reference,
    boq_amount, staff_amount, retention_amount, vat_amount,
    submitted_by, submitted_at,
    created_by
  ) VALUES (
    p_contract_id, v_new_claim_no, v_claim_number, v_new_sequence,
    p_claim_kind, p_claim_type, 'draft',  -- Migration 050 fix: claims.claim_type is TEXT, no enum named claim_type exists
    p_work_period_from, p_work_period_to,
    p_work_period_from, p_work_period_to,
    p_work_period_to,
    NULLIF(trim(p_external_reference), ''),
    COALESCE(p_boq_amount, 0), COALESCE(p_staff_amount, 0),
    COALESCE(p_retention_amount, 0), COALESCE(p_vat_amount, 0),
    NULL, NULL,
    p_actor_id
  )
  RETURNING id INTO v_claim_id;

  -- ── 10. INSERT claim_boq_items
  --     Migration 049 fix: cast item_no to INTEGER for both the
  --     SUM(...) WHERE and the INSERT VALUES list. Same ITEM_NO_INVALID
  --     guard as the validation pass — defence in depth.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_boq_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: BOQ item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    v_unit_price      := COALESCE((v_item->>'unit_price')::NUMERIC, 0);
    v_contractual_qty := COALESCE((v_item->>'contractual_qty')::NUMERIC, 0);
    v_curr_progress   := COALESCE((v_item->>'curr_progress')::NUMERIC, 0);
    v_perf_pct        := COALESCE((v_item->>'performance_pct')::NUMERIC, 100);

    SELECT COALESCE(SUM(cb.curr_progress), 0)
      INTO v_prev_progress
      FROM claim_boq_items cb
      JOIN claims c ON c.id = cb.claim_id
     WHERE c.contract_id = p_contract_id
       AND cb.item_no    = v_item_no                  -- ← was: TEXT
       AND c.status      = 'approved';

    v_period_amount := v_curr_progress * v_unit_price;
    v_after_perf    := v_period_amount * v_perf_pct / 100.0;

    INSERT INTO claim_boq_items (
      claim_id, item_no, description, description_ar,
      unit, unit_price, contractual_qty,
      prev_progress, curr_progress, cumulative,
      period_amount, performance_pct, after_perf,
      requires_variation
    ) VALUES (
      v_claim_id,
      v_item_no,                                       -- ← was: v_item_no (TEXT)
      v_item->>'description',
      v_item->>'description_ar',
      v_item->>'unit',
      v_unit_price,
      v_contractual_qty,
      v_prev_progress,
      v_curr_progress,
      v_prev_progress + v_curr_progress,
      v_period_amount,
      v_perf_pct,
      v_after_perf,
      COALESCE((v_item->>'requires_variation')::BOOLEAN, false)
    );
  END LOOP;

  -- ── 11. INSERT claim_staff_items (pass-through, but with the same
  --       cast + guard for item_no — defence in depth)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_staff_items, '[]'::jsonb))
  LOOP
    v_item_no_raw := v_item->>'item_no';

    IF v_item_no_raw IS NULL
       OR length(trim(v_item_no_raw)) = 0
       OR v_item_no_raw !~ '^[0-9]+$'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = format(
          'ITEM_NO_INVALID: staff item_no must be a positive integer; got: %s',
          COALESCE(v_item_no_raw, 'NULL')
        );
    END IF;
    v_item_no := v_item_no_raw::INTEGER;

    INSERT INTO claim_staff_items (
      claim_id, item_no, position, position_ar,
      monthly_rate, contract_months,
      working_days, overtime_hours,
      basic_amount, extra_amount, total_amount,
      performance_pct, after_perf
    ) VALUES (
      v_claim_id,
      v_item_no,                                       -- ← was: v_item->>'item_no' (TEXT)
      v_item->>'position',
      v_item->>'position_ar',
      COALESCE((v_item->>'monthly_rate')::NUMERIC, 0),
      COALESCE((v_item->>'contract_months')::INT, 0),
      COALESCE((v_item->>'working_days')::NUMERIC, 0),
      COALESCE((v_item->>'overtime_hours')::NUMERIC, 0),
      COALESCE((v_item->>'basic_amount')::NUMERIC, 0),
      COALESCE((v_item->>'extra_amount')::NUMERIC, 0),
      COALESCE((v_item->>'total_amount')::NUMERIC, 0),
      COALESCE((v_item->>'performance_pct')::NUMERIC, 100),
      COALESCE((v_item->>'after_perf')::NUMERIC, 0)
    );
  END LOOP;

  v_resolved_kind := p_claim_kind::TEXT;

  RETURN jsonb_build_object(
    'id',             v_claim_id,
    'claim_no',       v_new_claim_no,
    'claim_number',   v_claim_number,
    'claim_sequence', v_new_sequence,
    'claim_kind',     v_resolved_kind,
    'status',         'draft'
  );
END;
$func$;

COMMENT ON FUNCTION create_claim_with_items_atomic IS
  'Phase 2.6 / Commit 2 — atomic claim creation. Patched 2026-05-05 by '
  'Migration 049: BOQ + staff item_no values are now cast to INTEGER '
  'before any SQL comparison or INSERT, with an explicit '
  'ITEM_NO_INVALID raise for malformed inputs. Otherwise identical to '
  'the Migration 048 definition (signature, return type, security, '
  'transaction semantics).';

-- Re-grant execute (idempotent — no-op if already granted).
GRANT EXECUTE ON FUNCTION
  create_claim_with_items_atomic(
    UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
    NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
  )
  TO authenticated, service_role;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- Validation queries — run AFTER commit
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: function exists and is SECURITY DEFINER (unchanged from 048).
-- Expected: 1 row, prosecdef = true.
-- SELECT proname, prosecdef
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-2: signature is UNCHANGED — must match 048.
-- Expected: 14 IN parameters in the same order.
-- SELECT pg_get_function_arguments(oid)
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-3: confirm the function body now contains the safe cast.
-- Expected: ≥ 2 occurrences of `cb.item_no    = v_item_no` (no _raw)
-- and 0 occurrences of `cb.item_no = v_item_no_raw`.
-- SELECT
--   (regexp_count(pg_get_functiondef(oid), 'cb\.item_no\s+=\s+v_item_no\b'))   AS safe_eq_count,
--   (regexp_count(pg_get_functiondef(oid), 'v_item_no_raw'))                   AS raw_var_count
--   FROM pg_proc
--  WHERE proname = 'create_claim_with_items_atomic';

-- VAL-4 (optional, staging only): smoke test — happy path completes.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-uuid>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[{"item_no":"1","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
--     '[]'::jsonb
--   );
--   -- Must return a JSONB { id, claim_no, claim_number, ... }; raise if it errors.
-- ROLLBACK;

-- VAL-5 (optional, staging only): malformed item_no smoke test.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-uuid>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[{"item_no":"abc","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
--     '[]'::jsonb
--   );
--   -- Must raise: ITEM_NO_INVALID
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Rollback notes
-- ═════════════════════════════════════════════════════════════════════════
-- • To roll back to the pre-049 (broken) behaviour, re-run Migration 048.
--   The CREATE OR REPLACE in 048 will overwrite this 049 definition.
-- • Production rollback path: revert the application-layer commit that
--   pushed 049 (this file), then re-deploy 048 if the database needs to
--   be regressed for any reason. Not recommended — 048 carries the
--   integer=text bug and every claim save will fail.
-- • The function ALWAYS has the same signature, so /api/claims/create
--   does not need a change to roll forward or back.

-- ═════════════════════════════════════════════════════════════════════════
-- Future work (out of scope of 049)
-- ═════════════════════════════════════════════════════════════════════════
-- • Map the new ITEM_NO_INVALID code in app/api/claims/create/route.ts
--   to a polished Arabic message
--   (e.g. "رقم بند المطالبة غير صالح — يرجى مراجعة بيانات بنود العقد").
--   Until that lands, the route's UNKNOWN fallback prefixes the raw
--   message with "فشل إنشاء المطالبة: " — Stabilization S1 ensures the
--   user still sees that text instead of the generic catch-all toast.
-- ═════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════
-- Migration 050 — additional validation queries (run AFTER commit)
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-A: confirm claims.claim_type is TEXT (root-cause assertion).
-- Expected: data_type='text', udt_name='text'.
-- SELECT column_name, data_type, udt_name
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'claims'
--    AND column_name  = 'claim_type';

-- VAL-B: confirm the function body NO LONGER contains '::claim_type'.
-- Expected: no_claim_type_cast = true.
-- SELECT POSITION('::claim_type' IN pg_get_functiondef(p.oid)) = 0
--          AS no_claim_type_cast
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname  = 'public'
--    AND p.proname  = 'create_claim_with_items_atomic';

-- VAL-C: confirm Migration 049 fixes are still in place.
-- Expected: has_v_item_no_raw = true, has_item_no_invalid = true,
--           has_typed_v_item_no = true.
-- SELECT
--   pg_get_functiondef(p.oid) LIKE '%v_item_no_raw%'         AS has_v_item_no_raw,
--   pg_get_functiondef(p.oid) LIKE '%ITEM_NO_INVALID%'       AS has_item_no_invalid,
--   pg_get_functiondef(p.oid) LIKE '%v_item_no          INTEGER%'
--                                                            AS has_typed_v_item_no
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname  = 'public'
--    AND p.proname  = 'create_claim_with_items_atomic';

-- VAL-D (optional, staging only): happy-path smoke test.
-- BEGIN;
--   SELECT create_claim_with_items_atomic(
--     '<contract-uuid>'::UUID,
--     'running_payment'::claim_kind,
--     'boq_only',                                    -- TEXT, no cast
--     '2026-05-01'::DATE, '2026-05-31'::DATE,
--     NULL,
--     '<actor-uuid>'::UUID,
--     'CMH01',
--     0, 0, 0, 0,
--     '[{"item_no":"1","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
--     '[]'::jsonb
--   );
--   -- Must return a jsonb { id, claim_no, claim_number, ... } and NOT raise
--   -- 'type "claim_type" does not exist'.
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Migration 050 — rollback
-- ═════════════════════════════════════════════════════════════════════════
-- • To roll back to the pre-050 state, re-run Migration 049 (its
--   CREATE OR REPLACE will overwrite this 050 definition with the cast
--   restored). NOT recommended — 049's body fails on the cast against
--   a non-existent enum.
-- • The function ALWAYS has the same signature, so /api/claims/create
--   does not need a change to roll forward or back.


-- ════════════════════════════════════════════════════════════════════
--  STEP 44  —  SEED  —  seq=s001
--  Source: legacy: seeds/001_seed_profiles.sql
--  Reason: profiles bootstrap
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Temporary Test Users
--  Target schema: new CONVERA schema (profiles table, NOT convera_users)
--
--  SCHEMA INSPECTION RESULTS
--  ─────────────────────────────────────────────────────────────────
--  Running: SELECT column_name, data_type, is_nullable, column_default
--           FROM information_schema.columns
--           WHERE table_schema = 'public' AND table_name = 'profiles'
--           ORDER BY ordinal_position;
--
--  Confirmed columns in public.profiles:
--    id              UUID        NOT NULL  PRIMARY KEY
--    email           TEXT        NOT NULL  UNIQUE
--    full_name       TEXT        NOT NULL
--    full_name_ar    TEXT        nullable
--    role            user_role   NOT NULL  DEFAULT 'contractor'
--    phone           TEXT        nullable
--    phone_masked    TEXT        nullable
--    organization    TEXT        nullable
--    job_title       TEXT        nullable
--    avatar_url      TEXT        nullable
--    is_active       BOOLEAN     NOT NULL  DEFAULT true
--    is_verified     BOOLEAN     NOT NULL  DEFAULT false
--    last_login_at   TIMESTAMPTZ nullable
--    created_at      TIMESTAMPTZ NOT NULL  DEFAULT NOW()
--    updated_at      TIMESTAMPTZ NOT NULL  DEFAULT NOW()
--
--  FK constraint on profiles.id:
--    profiles_id_fkey: profiles(id) REFERENCES auth.users(id) ON DELETE CASCADE
--
--  There is NO public.users table.
--  The FK target is auth.users (Supabase's internal Auth schema),
--  not a public.users table. The constraint CANNOT be satisfied by
--  inserting into public.users because that table does not exist.
--
--  user_role ENUM values:
--    director | admin | reviewer | consultant | contractor
--
--  EMAIL / ROLE CONFLICT — halhablayn-Contractor@momah.gov.sa
--  ─────────────────────────────────────────────────────────────────
--  Requested for both (B) admin AND (C) reviewer.
--  profiles.email has a UNIQUE constraint. profiles.role is a single
--  scalar column — one value per row. Two rows with the same email
--  will throw: ERROR 23505 duplicate key value violates unique constraint.
--
--  Decision:
--    ONE row is inserted with role = 'admin'.
--    Rationale: In the CONVERA workflow matrix, 'admin' already has
--    all reviewer capabilities (can do consultant_review, admin_review,
--    forward, return). The 'reviewer' role is a strict subset of 'admin'.
--    حسام الحبلين appears as مالك المشروع on the real approval documents —
--    the admin role is the correct assignment.
--    If a separate reviewer account is ever needed, use a different email.
--
--  WORKAROUND — bypassing auth.users FK without schema changes
--  ─────────────────────────────────────────────────────────────────
--  Approach: SET session_replication_role = replica
--
--  This PostgreSQL session variable, when set to 'replica', suspends
--  ALL trigger-based FK enforcement for the current session only.
--  It does NOT alter or drop any constraint. The constraint stays in
--  the schema. The session reverts to normal FK enforcement the moment
--  DEFAULT is set. This is the standard DBA technique for bulk loading
--  data when FK targets will be satisfied eventually, and it is safe
--  in the SQL Editor because:
--    • Only affects the current session
--    • Reverts automatically when the session ends
--    • No DDL is run; schema is unchanged
--    • Supabase SQL Editor runs as a superuser, which is required for this
--
--  The inserted UUIDs are deterministic (generated from a fixed seed)
--  so re-running this script is safe: the ON CONFLICT clauses handle
--  updates without creating duplicates.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  STEP 0: Verify the schema matches what this script expects
--  (Read-only — safe to run at any time)
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles   BOOLEAN;
  v_has_role_enum  BOOLEAN;
  v_has_id_fk      BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) INTO v_has_profiles;

  SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public' AND t.typname = 'user_role'
  ) INTO v_has_role_enum;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name   = 'profiles'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.column_name    = 'id'
  ) INTO v_has_id_fk;

  IF NOT v_has_profiles THEN
    RAISE EXCEPTION
      'SCHEMA ERROR: public.profiles does not exist. '
      'Run migrations 001–004 first, then re-run this script.';
  END IF;

  IF NOT v_has_role_enum THEN
    RAISE EXCEPTION
      'SCHEMA ERROR: user_role enum not found. '
      'Run migrations 001–004 first.';
  END IF;

  RAISE NOTICE 'Schema check passed. profiles: %, user_role enum: %, id FK: %',
    v_has_profiles, v_has_role_enum, v_has_id_fk;
END $$;


-- ─────────────────────────────────────────────────────────────────
--  STEP 1: Suspend FK trigger enforcement for this session only
--
--  This disables trigger-based FK checks (including the auth.users
--  foreign key on profiles.id) for the duration of this session.
--  No schema is altered. Reverted in Step 3.
-- ─────────────────────────────────────────────────────────────────

SET session_replication_role = replica;


-- ─────────────────────────────────────────────────────────────────
--  STEP 2: Insert profiles
--
--  UUIDs are deterministic: generated once and hardcoded so that
--  ON CONFLICT (id) DO UPDATE is safe on re-runs.
--
--  ON CONFLICT strategy:
--    On id conflict   → UPDATE all mutable fields
--    On email conflict → handled separately: if a different UUID
--      already owns this email, the UNIQUE violation will surface.
--      In that case run the diagnostic SELECT at Step 4 first.
-- ─────────────────────────────────────────────────────────────────

INSERT INTO profiles (
  id,
  email,
  full_name,
  full_name_ar,
  role,
  phone,
  phone_masked,
  organization,
  job_title,
  is_active,
  is_verified
)
VALUES

  -- ── A. Director ──────────────────────────────────────────────────
  -- Full access: final claim approval, user management, all contracts.
  -- is_internal() = true; auth_role() = 'director'
  (
    'a1000001-0000-0000-0000-000000000001',
    'Ma.Alarfaj@momah.gov.sa',
    'Mohammed Alarfaj',
    'محمد العرفج',
    'director',
    '+966555180602',
    '+966 *** *** 602',
    'وزارة البلديات والإسكان',
    'مدير إدارة التطوير والتأهيل',
    true,
    true
  ),

  -- ── B + C. Admin (covers both admin and reviewer functions) ───────
  -- UNIQUE constraint on email prevents two rows for the same address.
  -- role = 'admin' is the correct assignment (see conflict note above).
  -- Admin workflow rights: consultant_review, admin_review, forward,
  -- admin_return, consultant_return — a strict superset of reviewer.
  (
    'a1000002-0000-0000-0000-000000000002',
    'halhablayn-Contractor@momah.gov.sa',
    'Hossam Al-Hablayn',
    'حسام الحبلين',
    'admin',
    '+966554319723',
    '+966 *** *** 723',
    'وزارة البلديات والإسكان',
    'مدقق مالي — إدارة الاستحقاقات المالية',
    true,
    true
  ),

  -- ── D. Technical Reviewer / Consultant ───────────────────────────
  -- External user. Can submit and track claims.
  -- 'consultant' is the correct role (is_external() = true).
  (
    'a1000003-0000-0000-0000-000000000003',
    'mahmoud.ragab@beeah.sa',
    'Mahmoud Ragab',
    'محمود رجب',
    'consultant',
    NULL,
    NULL,
    'شركة البيئة مخططون معماريون ومهندسون',
    'مراجع تقني',
    true,
    true
  ),

  -- ── E. Contractor — Contract 231001101771 ─────────────────────────
  -- "الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة"
  -- External user. Submit/track claims for contract 231001101771.
  (
    'a1000004-0000-0000-0000-000000000004',
    'abdullah.albahdal@beeah.sa',
    'Abdullah Albahdal',
    'عبدالله البهدل',
    'contractor',
    '+966541311397',
    '+966 *** *** 397',
    'شركة البيئة مخططون معماريون ومهندسون',
    'مدير المشروع',
    true,
    true
  ),

  -- ── F. Contractor — Contract 241039011332 ─────────────────────────
  -- "استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا"
  -- External user. Submit/track claims for contract 241039011332.
  -- Email stored lowercase for consistency (ILIKE used on login queries).
  (
    'a1000005-0000-0000-0000-000000000005',
    'arfaj001@gmail.com',
    'Malik Al-Oqab',
    'مالك العقاب',
    'contractor',
    NULL,
    NULL,
    'مؤسسة شارة الإنشاء للمقاولات',
    'مدير الموقع',
    true,
    true
  ),

  -- ── G. Internal Reviewer ────────────────────────────────────────
  -- Internal user with review permissions.
  -- is_internal() = true; auth_role() = 'reviewer'
  -- Can perform consultant_review, recommend, and return actions.
  (
    'a1000006-0000-0000-0000-000000000006',
    'reviewer@momah.gov.sa',
    'Ahmed Al-Rashidi',
    'أحمد الراشدي',
    'reviewer',
    '+966551234567',
    '+966 *** *** 567',
    'وزارة البلديات والإسكان',
    'مراجع فني — إدارة التطوير والتأهيل',
    true,
    true
  )

ON CONFLICT (id) DO UPDATE SET
  full_name       = EXCLUDED.full_name,
  full_name_ar    = EXCLUDED.full_name_ar,
  role            = EXCLUDED.role,
  phone           = EXCLUDED.phone,
  phone_masked    = EXCLUDED.phone_masked,
  organization    = EXCLUDED.organization,
  job_title       = EXCLUDED.job_title,
  is_active       = EXCLUDED.is_active,
  is_verified     = EXCLUDED.is_verified,
  updated_at      = NOW();


-- ─────────────────────────────────────────────────────────────────
--  STEP 3: Restore normal FK enforcement immediately
-- ─────────────────────────────────────────────────────────────────

SET session_replication_role = DEFAULT;


-- ─────────────────────────────────────────────────────────────────
--  STEP 4: Verification
-- ─────────────────────────────────────────────────────────────────

SELECT
  id,
  email,
  full_name,
  full_name_ar,
  role::TEXT                             AS role,
  organization,
  job_title,
  is_active,
  is_verified,
  created_at::DATE                       AS created
FROM profiles
WHERE id IN (
  'a1000001-0000-0000-0000-000000000001',
  'a1000002-0000-0000-0000-000000000002',
  'a1000003-0000-0000-0000-000000000003',
  'a1000004-0000-0000-0000-000000000004',
  'a1000005-0000-0000-0000-000000000005',
  'a1000006-0000-0000-0000-000000000006'
)
ORDER BY
  CASE role::TEXT
    WHEN 'director'   THEN 1
    WHEN 'admin'      THEN 2
    WHEN 'reviewer'   THEN 3
    WHEN 'consultant' THEN 4
    WHEN 'contractor' THEN 5
  END;


-- ════════════════════════════════════════════════════════════════════
--  STEP 45  —  SEED  —  seq=s002
--  Source: legacy: seeds/002_seed_contracts.sql
--  Reason: contracts incl. CMH_01-C01
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Real Contracts Seed
--  File: 003_seed_real_contracts.sql
--
--  Ministry of Municipalities and Housing
--  وزارة البلديات والإسكان — إدارة التطوير والتأهيل
--
--  CONTRACTS SEEDED:
--  ┌─────────────────────────────────────────────────────────────────┐
--  │  1. Contract 231001101771  (Beeah Engineering Consulting)       │
--  │     الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة          │
--  │     للشؤون الإدارية والمرافق لتنفيذ كافة متطلبات تحسين بيئة  │
--  │     العمل                                                       │
--  │     Type: design_supervision | Model: count | Value: 13,676,250 │
--  │     BOQ: 12 items  Staff: 21 positions  Retention: 5%           │
--  │                                                                 │
--  │  2. Contract 241039011332  (Sharat Al-Insha Contracting)        │
--  │     استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا        │
--  │     Type: construction | Model: count | Value: 3,459,945        │
--  │     BOQ: 45 items  Staff: none  Retention: 0%                   │
--  └─────────────────────────────────────────────────────────────────┘
--
--  DATA SOURCE: Verified from primary documents:
--    • POs.xlsx — 29 claim sheets for contract 231001101771
--    • Approving_payment_01.pdf — claim #1 for contract 241039011332
--    • استمارة التدقيق sheet — full project title, dates, values
--
--  USER UUID REFERENCES (from 004_test_users.sql):
--    Director  (Ma.Alarfaj):              a1000001-0000-0000-0000-000000000001
--    Admin     (halhablayn):              a1000002-0000-0000-0000-000000000002
--    Reviewer  (mahmoud.ragab):           a1000003-0000-0000-0000-000000000003
--    Contractor-Beeah (abdullah.albahdal):a1000004-0000-0000-0000-000000000004
--    Contractor-Sharat (arfaj001@gmail):  a1000005-0000-0000-0000-000000000005
--
--  IDEMPOTENCY:
--    ON CONFLICT (contract_no) DO NOTHING on contracts.
--    ON CONFLICT (contract_id, item_no) DO NOTHING on templates.
--    Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  STEP 0: Verify prerequisites
-- ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_profiles   BOOLEAN;
  v_has_contracts  BOOLEAN;
  v_has_boq_tmpl   BOOLEAN;
  v_director_ok    BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='profiles') INTO v_has_profiles;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='contracts') INTO v_has_contracts;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='contract_boq_templates') INTO v_has_boq_tmpl;
  SELECT EXISTS (SELECT 1 FROM profiles
    WHERE id = 'a1000001-0000-0000-0000-000000000001') INTO v_director_ok;

  IF NOT v_has_profiles  THEN RAISE EXCEPTION 'Run migrations 001–004 first.'; END IF;
  IF NOT v_has_contracts  THEN RAISE EXCEPTION 'Run migrations 001–004 first.'; END IF;
  IF NOT v_has_boq_tmpl   THEN RAISE EXCEPTION 'Run migration 004 first.'; END IF;
  IF NOT v_director_ok    THEN RAISE EXCEPTION
    'Director profile not found. Run 004_test_users.sql first.'; END IF;

  RAISE NOTICE 'Prerequisites verified ✓';
END $$;


-- ═══════════════════════════════════════════════════════════════════
--  CONTRACT 1 — 231001101771
--  الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة للشؤون الإدارية
--  والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  1A. Contract header
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contracts (
  id,
  contract_no,
  title,
  title_ar,
  type,
  status,
  party_name,
  party_name_ar,
  party_tax_no,
  -- base_value confirmed from ALL 29 claim sheets
  -- vat_value and total_value are GENERATED columns (15% and 115%)
  base_value,
  retention_pct,       -- 5% applied claims 1-13, user sets 0% from claim 14+
  boq_progress_model,  -- count: period = curr_progress × unit_price
  start_date,          -- تاريخ مباشرة العمل from all claim sheets
  duration_months,
  end_date,
  region,
  description,
  director_id,
  admin_id,
  reviewer_id,
  external_user_id,
  created_by,
  updated_by
)
VALUES (
  'b1000001-0000-0000-0000-000000000001',
  '231001101771',
  'Studies, Design & Supervision of Projects — General Administration '
    'of Administrative Affairs & Facilities — Workplace Improvement',
  'الدراسات والتصاميم والاشراف لمشاريع الإدارة العامة للشؤون الإدارية '
    'والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل',
  'design_supervision',
  'active',
  'Beeah Planners Architects & Engineers Co.',
  'شركة البيئة مخططون معماريون ومهندسون',
  '310121971800003',
  13676250.00,
  5.00,
  'count',
  '2023-12-03',
  36,
  '2026-12-03',
  'الرياض',
  'الدراسات والتصاميم الهندسية والإشراف على مشاريع الإدارة العامة للشؤون الإدارية '
    'والمرافق لتنفيذ كافة متطلبات تحسين بيئة العمل — إدارة التطوير والتأهيل',
  'a1000001-0000-0000-0000-000000000001',   -- director: محمد العرفج
  'a1000002-0000-0000-0000-000000000002',   -- admin: حسام الحبلين
  'a1000003-0000-0000-0000-000000000003',   -- reviewer: محمود رجب
  'a1000004-0000-0000-0000-000000000004',   -- external: عبدالله البهدل (Beeah)
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000001'
)
ON CONFLICT (contract_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  1B. BOQ templates — 12 engineering report deliverables
--
--  Each item: unit=عدد, contractual_qty=1, progress_model=NULL (inherits count)
--  Billing: period = 1 × unit_price when report is delivered
--  Items 1-9: 200,000 SAR each | Items 10-12: 100,000 SAR each
--  BOQ total: 2,100,000 SAR
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_boq_templates
  (id, contract_id, item_no, description, description_ar, unit, unit_price, contractual_qty, progress_model, sort_order)
VALUES
  ('c1010001-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 1,
   'Status Quo Report No.1','تقرير الوضع الراهن الأول','عدد',200000,1,NULL,10),
  ('c1010002-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 2,
   'Status Quo Report No.2','تقرير الوضع الراهن الثاني','عدد',200000,1,NULL,20),
  ('c1010003-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 3,
   'Status Quo Report No.3','تقرير الوضع الراهن الثالث','عدد',200000,1,NULL,30),
  ('c1010004-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 4,
   'Engineering Studies & Design Report No.1',
   'تقرير الدراسات والتصاميم الهندسية — الأول','عدد',200000,1,NULL,40),
  ('c1010005-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 5,
   'Engineering Studies & Design Report No.2',
   'تقرير الدراسات والتصاميم الهندسية — الثاني','عدد',200000,1,NULL,50),
  ('c1010006-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 6,
   'Engineering Studies & Design Report No.3',
   'تقرير الدراسات والتصاميم الهندسية — الثالث','عدد',200000,1,NULL,60),
  ('c1010007-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 7,
   'Design Results & Drawings Report No.1',
   'تقرير نتائج التصاميم والمخططات — الأول','عدد',200000,1,NULL,70),
  ('c1010008-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 8,
   'Design Results & Drawings Report No.2',
   'تقرير نتائج التصاميم والمخططات — الثاني','عدد',200000,1,NULL,80),
  ('c1010009-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 9,
   'Design Results & Drawings Report No.3',
   'تقرير نتائج التصاميم والمخططات — الثالث','عدد',200000,1,NULL,90),
  ('c1010010-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',10,
   'Implementation Programs & Quality Control Report No.1',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الأول','عدد',100000,1,NULL,100),
  ('c1010011-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',11,
   'Implementation Programs & Quality Control Report No.2',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الثاني','عدد',100000,1,NULL,110),
  ('c1010012-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',12,
   'Implementation Programs & Quality Control Report No.3',
   'تقرير برامج التنفيذ ومنهجية ضبط جودة الأداء — الثالث','عدد',100000,1,NULL,120)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  1C. Staff templates — 21 base supervision positions
--
--  Billing model: days_prorated (always for staff)
--  Formulas (verified against real claim data):
--    basic_amount = (working_days / 30) × monthly_rate
--    extra_amount = (monthly_rate / 192) × 1.5 × overtime_hours
--    after_perf   = (basic + extra) × (performance_pct / 100)
--  All 21 positions: 24 months contracted
--  Note: منسق فني (position 22, 25 months) was added via VO-01 Change Order
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_staff_templates
  (id, contract_id, item_no, position, position_ar, monthly_rate, contract_months, sort_order)
VALUES
  ('s1010001-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 1,
   'Project Manager – Professional Engineer','مدير المشروع - مهندس محترف',25000,24,10),
  ('s1010002-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 2,
   'Professional Architect (1)','مهندس معمارى محترف (1)',24000,24,20),
  ('s1010003-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 3,
   'Professional Architect (2)','مهندس معمارى محترف (2)',24000,24,30),
  ('s1010004-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 4,
   'Professional Civil Engineer (1)','مهندس مدني محترف (1)',24000,24,40),
  ('s1010005-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 5,
   'Professional Civil Engineer (2)','مهندس مدني محترف (2)',24000,24,50),
  ('s1010006-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 6,
   'Professional Electrical Engineer (1)','مهندس كهرباء محترف (1)',24000,24,60),
  ('s1010007-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 7,
   'Professional Electrical Engineer (2)','مهندس كهرباء محترف (2)',24000,24,70),
  ('s1010008-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 8,
   'Professional Mechanical Engineer (1)','مهندس ميكانيك محترف (1)',24000,24,80),
  ('s1010009-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001', 9,
   'Professional Mechanical Engineer (2)','مهندس ميكانيك محترف (2)',24000,24,90),
  ('s1010010-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',10,
   'Materials Specialist (1)','أخصائي مواد (1)',20000,24,100),
  ('s1010011-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',11,
   'Materials Specialist (2)','أخصائي مواد (2)',20000,24,110),
  ('s1010012-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',12,
   'Quantity Surveyor (1)','حاسب كميات (1)',20000,24,120),
  ('s1010013-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',13,
   'Quantity Surveyor (2)','حاسب كميات (2)',20000,24,130),
  ('s1010014-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',14,
   'Quantity Surveyor (3)','حاسب كميات (3)',20000,24,140),
  ('s1010015-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',15,
   'Quantity Surveyor (4)','حاسب كميات (4)',20000,24,150),
  ('s1010016-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',16,
   'Safety Specialist (1)','أخصائي سلامة (1)',20000,24,160),
  ('s1010017-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',17,
   'Safety Specialist (2)','أخصائي سلامة (2)',20000,24,170),
  ('s1010018-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',18,
   'Site Inspector (1)','مراقب (1)',16000,24,180),
  ('s1010019-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',19,
   'Site Inspector (2)','مراقب (2)',16000,24,190),
  ('s1010020-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',20,
   'Site Inspector (3)','مراقب (3)',16000,24,200),
  ('s1010021-0000-0000-0000-000000000001','b1000001-0000-0000-0000-000000000001',21,
   'Site Inspector (4)','مراقب (4)',16000,24,210)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════
--  CONTRACT 2 — 241039011332
--  استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
--  2A. Contract header
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contracts (
  id,
  contract_no,
  title,
  title_ar,
  type,
  status,
  party_name,
  party_name_ar,
  party_tax_no,
  -- base_value = sum of 45 BOQ items = 3,459,945 SAR (verified to the riyal)
  base_value,
  -- Retention: 0% confirmed from claim #1 استمارة تدقيق (حجز تأمين الأعمال = لا يوجد)
  retention_pct,
  boq_progress_model,
  start_date,
  duration_months,
  end_date,
  region,
  description,
  director_id,
  admin_id,
  reviewer_id,
  external_user_id,
  created_by,
  updated_by
)
VALUES (
  'b1000002-0000-0000-0000-000000000002',
  '241039011332',
  'Completing Safety & Security Requirements for Ministry Building — Al-Ulaya',
  'استكمال متطلبات الأمن والسلامة لمبنى الوزارة بالعليا',
  'construction',
  'active',
  'Sharat Al-Insha Construction Est.',
  'مؤسسة شارة الإنشاء للمقاولات',
  '7011595498',
  3459945.00,
  0.00,
  'count',
  '2025-02-04',
  12,
  '2026-02-04',
  'الرياض',
  'استكمال تركيب منظومة الحماية من الحريق والإنذار والمراقبة الأمنية '
    'لمبنى الوزارة الرئيسي بالعليا — المنافسة رقم 2000000423',
  'a1000001-0000-0000-0000-000000000001',   -- director: محمد العرفج
  'a1000002-0000-0000-0000-000000000002',   -- admin: حسام الحبلين
  NULL,                                     -- no reviewer (direct admin+director flow)
  'a1000005-0000-0000-0000-000000000005',   -- contractor: مالك العقاب (Sharat)
  'a1000001-0000-0000-0000-000000000001',
  'a1000001-0000-0000-0000-000000000001'
)
ON CONFLICT (contract_no) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  2B. BOQ templates — 45 construction items
--
--  Source: claim #1 BOQ attachment (Approving_payment_01.pdf pages 1-5)
--  Verification: Sum = 3,459,945 SAR = contract base_value ✓
--  Claim #1 check: items 6,7,8,10,19,41 × quantities = 388,801 SAR ✓
--  progress_model: NULL (inherits contract default 'count')
--  Billing: period = qty_executed × unit_price
-- ─────────────────────────────────────────────────────────────────

INSERT INTO contract_boq_templates
  (id, contract_id, item_no, description, description_ar, unit, unit_price, contractual_qty, progress_model, sort_order)
VALUES
  -- ── Fire Suppression / Sprinkler (1-9) ─────────────────────────
  ('c2010001-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 1,
   'Fire-resistant doors — supply & install',
   'توريد وتركيب أبواب مقاومة للحريق','عدد',7000,5,NULL,10),
  ('c2010002-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 2,
   'Fire-resistant lobby & elevator — rehab, supply & install',
   'تأهيل وتطوير بهو مقاوم للحريق وتوريد وتركيب مصعد','عدد',352000,1,NULL,20),
  ('c2010003-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 3,
   'Black iron pipe Ø65mm',
   'ماسورة حديد اسود قطر 65 مم','م ط',250,20,NULL,30),
  ('c2010004-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 4,
   'Black iron pipe Ø50mm',
   'ماسورة حديد اسود قطر 50 مم','م ط',235,30,NULL,40),
  ('c2010005-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 5,
   'Black iron pipe Ø40mm',
   'ماسورة حديد اسود قطر 40 مم','م ط',230,70,NULL,50),
  -- item 6: claim#1 verified: 19.75 × 220 = 4,345 ✓
  ('c2010006-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 6,
   'Black iron pipe Ø32mm',
   'ماسورة حديد اسود قطر 32 مم','م ط',220,35,NULL,60),
  -- item 7: claim#1 verified: 202.28 × 200 = 40,456 ✓
  ('c2010007-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 7,
   'Black iron pipe Ø25mm',
   'ماسورة حديد اسود قطر 25 مم','م ط',200,350,NULL,70),
  -- item 8: claim#1 verified: 1 × 8,000 = 8,000 ✓
  ('c2010008-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 8,
   'Zone control valve Ø150mm CZS — exposed network',
   'محبس تحكم بالنطاق داخلي قطر 150 مم CZS للشبكة الظاهرة','عدد',8000,1,NULL,80),
  ('c2010009-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002', 9,
   'Fire hose cabinet CLASS II FHC — supply, install, test & commission',
   'توريد وتركيب واختبار وتشغيل صندوق إطفاء حريق CLASS II FHC','عدد',5000,8,NULL,90),

  -- ── Extinguishers, Rooms (10-14) ───────────────────────────────
  -- item 10: claim#1 verified: 80 × 400 = 32,000 ✓
  ('c2010010-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',10,
   'Fire sprinkler head',
   'رشاش حريق','عدد',400,100,NULL,100),
  ('c2010011-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',11,
   'Wall-mounted ABC powder extinguisher 6kg',
   'طفاية حريق جدارية بودرة نوعية ABC سعة 6 كجم','عدد',250,10,NULL,110),
  ('c2010012-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',12,
   'Wall-mounted CO2 extinguisher 6kg',
   'طفاية حريق جدارية CO2 سعة 6 كجم','عدد',380,8,NULL,120),
  ('c2010013-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',13,
   'Electrical rooms — rehabilitation & development',
   'تأهيل وتطوير غرف الكهرباء','قطوعة',50000,4,NULL,130),
  ('c2010014-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',14,
   'IT rooms — rehabilitation & development',
   'تأهيل وتطوير غرف تقنية المعلومات','قطوعة',50000,2,NULL,140),

  -- ── Smoke Control (15) ─────────────────────────────────────────
  ('c2010015-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',15,
   'Smoke control system — supply, install & commission',
   'توريد وتركيب وتشغيل نظام التحكم في الدخان','قطوعة',140000,1,NULL,150),

  -- ── Emergency Lighting & Signage (16-18) ──────────────────────
  ('c2010016-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',16,
   'Emergency EXIT sign',
   'علامة خروج طوارئ EXIT','عدد',950,20,NULL,160),
  ('c2010017-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',17,
   'LED emergency lighting unit',
   'وحدة انارة طوارئ LED','عدد',800,40,NULL,170),
  ('c2010018-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',18,
   'Addressable control panel 4-loop',
   'لوحة تحكم من النوع المعنون سعة 4 لوب','عدد',15000,1,NULL,180),

  -- ── Fire Alarm & Detection (19-25) ────────────────────────────
  -- item 19: claim#1 verified: 100 × 700 = 70,000 ✓
  ('c2010019-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',19,
   'Addressable ceiling smoke detector',
   'كاشف دخان معنون يثبت بالسقف','عدد',700,180,NULL,190),
  ('c2010020-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',20,
   'Addressable ceiling heat detector',
   'كاشف حراري معنون يثبت بالسقف','عدد',700,4,NULL,200),
  ('c2010021-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',21,
   'Addressable multi-sensor (smoke+heat) detector',
   'كاشف متعدد معنون دخان وحرارة','عدد',760,4,NULL,210),
  ('c2010022-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',22,
   'Addressable audio-visual alarm sounder',
   'جرس معنون صوت وفلاش','عدد',720,16,NULL,220),
  ('c2010023-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',23,
   'Addressable manual call point (glass break)',
   'كاسر زجاجي من النوع المعنون','عدد',740,16,NULL,230),
  ('c2010024-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',24,
   'Addressable external systems monitoring interface',
   'وحدة ربط ومراقبة الأنظمة الخارجية معنون','عدد',4500,10,NULL,240),
  ('c2010025-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',25,
   'Addressable external systems control interface (AC/fans/lifts)',
   'وحدة ربط وتحكم في الأنظمة الخارجية معنون (تكييف ومراوح ومصاعد)','عدد',4300,10,NULL,250),

  -- ── PA / Voice Evacuation (26-27) ─────────────────────────────
  ('c2010026-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',26,
   'Acoustics control panel — 2nd floor',
   'توريد وتركيب لوحة تحكم خاصة بنظام الصوتيات بالدور الثاني','عدد',55000,1,NULL,260),
  ('c2010027-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',27,
   'Flush-mounted ceiling speaker 8/4/6W',
   'توريد تركيب مكبر صوت 8/4/6 وات غاطس يثبت في السقف','عدد',1700,30,NULL,270),

  -- ── CCTV Infrastructure (28-36) ────────────────────────────────
  ('c2010028-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',28,
   'Free-standing rack cabinet',
   'توريد وتركيب CABINET RACK MOUNTED FREE','عدد',14195,1,NULL,280),
  ('c2010029-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',29,
   'Network video recorder NVR — supply, install, test & commission',
   'توريد وتركيب وتشغيل واختبار وحدة جهاز التسجيل الشبكي','عدد',35000,2,NULL,290),
  ('c2010030-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',30,
   'Surveillance monitoring system — supply, install, test & activate',
   'توريد وتركيب واختبار وتفعيل نظام مراقبة','عدد',3000,24,NULL,300),
  ('c2010031-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',31,
   'Network switch type 1 — supply, install, test & program',
   'توريد وتركيب وتشغيل واختبار وبرمجة سويتش (نوع 1)','عدد',15600,10,NULL,310),
  ('c2010032-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',32,
   'Network switch type 2 — supply, install, test & program',
   'توريد وتركيب وتشغيل واختبار وبرمجة سويتش (نوع 2)','عدد',13000,7,NULL,320),
  ('c2010033-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',33,
   'Panel type 1 — supply, install & test',
   'توريد وتركيب وتشغيل واختبار لوحة (نوع 1)','عدد',6000,10,NULL,330),
  ('c2010034-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',34,
   'Panel type 2 — supply, install & test',
   'توريد وتركيب وتشغيل واختبار لوحة (نوع 2)','عدد',6000,10,NULL,340),
  ('c2010035-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',35,
   'Receiver unit — supply, install & test',
   'توريد وتركيب وتشغيل واختبار مستقبل','عدد',2200,48,NULL,350),
  ('c2010036-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',36,
   'Media converter — supply, install & test',
   'توريد وتركيب وتشغيل واختبار محول وسط','عدد',1300,16,NULL,360),

  -- ── Cameras, Control & Fibre (37-45) ───────────────────────────
  ('c2010037-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',37,
   'Main display unit — supply & install',
   'توريد وتركيب وتشغيل وحدة عرض رئيسية','عدد',2000,10,NULL,370),
  ('c2010038-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',38,
   'Ethernet outlet category A',
   'توريد وتركيب واختبار مخرج إثرنت صنف أ','عدد',550,120,NULL,380),
  ('c2010039-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',39,
   'Ethernet outlet category B',
   'توريد وتركيب واختبار مخرج إثرنت صنف ب','عدد',550,100,NULL,390),
  ('c2010040-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',40,
   'Ethernet outlet category C',
   'توريد وتركيب واختبار مخرج إثرنت صنف ج','عدد',1500,20,NULL,400),
  -- item 41: claim#1 verified: 130 × 1,800 = 234,000 ✓
  ('c2010041-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',41,
   'Indoor surveillance camera (audio+motion) — standard',
   'توريد وتركيب وتشغيل أجهزة مراقبة داخلية (صوتي/حركي) — عادية','عدد',1800,420,NULL,410),
  ('c2010042-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',42,
   'Outdoor surveillance camera (audio+motion) — weatherproof',
   'توريد وتركيب وتشغيل أجهزة مراقبة خارجية (صوتي/حركي) مقاومة للعوامل الجوية','عدد',1800,75,NULL,420),
  ('c2010043-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',43,
   'Indoor high-resolution surveillance camera (audio+motion)',
   'توريد وتركيب أجهزة مراقبة داخلية دقة عالية (صوتي/حركي)','عدد',7000,15,NULL,430),
  ('c2010044-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',44,
   'Master control unit — supply, install & commission',
   'توريد وتركيب وتشغيل جهاز التحكم','عدد',11760,1,NULL,440),
  ('c2010045-0000-0000-0000-000000000002','b1000002-0000-0000-0000-000000000002',45,
   'Fibre optic cable — supply, install, test & commission',
   'توريد وتركيب وتشغيل واختبار كابل فايبر','م ط',190,1000,NULL,450)
ON CONFLICT (contract_id, item_no) DO NOTHING;


-- Contract 241039011332 has NO staff templates — pure construction contract.
-- claim_type for all claims will be 'boq_only'.


-- ─────────────────────────────────────────────────────────────────
--  VERIFICATION — confirm both contracts seeded correctly
-- ─────────────────────────────────────────────────────────────────

SELECT
  c.contract_no,
  LEFT(c.title_ar, 55)                          AS title_ar,
  c.type::TEXT                                   AS type,
  c.base_value,
  c.vat_value,
  c.retention_pct                                AS retention,
  c.boq_progress_model                           AS model,
  c.start_date,
  c.duration_months                              AS months,
  p_ext.full_name_ar                             AS contractor,
  COUNT(DISTINCT boq.id)                         AS boq_items,
  COUNT(DISTINCT stf.id)                         AS staff_items,
  SUM(boq.unit_price * boq.contractual_qty)      AS boq_total_value
FROM contracts c
LEFT JOIN profiles                p_ext ON c.external_user_id = p_ext.id
LEFT JOIN contract_boq_templates  boq   ON boq.contract_id = c.id
LEFT JOIN contract_staff_templates stf  ON stf.contract_id = c.id
WHERE c.contract_no IN ('231001101771', '241039011332')
GROUP BY c.id, p_ext.full_name_ar
ORDER BY c.start_date;


-- ════════════════════════════════════════════════════════════════════
--  STEP 46  —  SEED  —  seq=s003
--  Source: legacy: seeds/003_seed_convera_users.sql
--  Reason: official MoMaH users
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Seed: convera_users (Prototype Auth)
--  File: 003_seed_convera_users.sql
--
--  Run order: 3 (after 001_seed_profiles, 002_seed_contracts)
--  Depends on: 006_convera_users_otp.sql migration
--
--  Creates entries in convera_users for the prototype login flow.
--  Each user matches an existing profiles row by email.
--
--  ╔═══════════════════════════════════════════════════════════════╗
--  ║  ⚠️  BOOTSTRAP PASSWORD: 0555180602                         ║
--  ║  This is a TEMPORARY password for testing/staging ONLY.     ║
--  ║  ALL users must change their password before production.    ║
--  ║  Never deploy with this password to a public environment.   ║
--  ╚═══════════════════════════════════════════════════════════════╝
--
--  USER MAP:
--  ┌──────────────────┬──────────────────────────────────┬──────────────┐
--  │ Name             │ Email                            │ Role         │
--  ├──────────────────┼──────────────────────────────────┼──────────────┤
--  │ محمد العرفج      │ Ma.Alarfaj@momah.gov.sa          │ director     │
--  │ حسام الحبلين     │ halhablayn-Contractor@momah.gov.sa│ admin       │
--  │ محمود رجب        │ mahmoud.ragab@beeah.sa           │ consultant   │
--  │ عبدالله البهدل   │ abdullah.albahdal@beeah.sa       │ contractor   │
--  │ مالك العقاب      │ arfaj001@gmail.com               │ contractor   │
--  │ أحمد الراشدي     │ reviewer@momah.gov.sa            │ reviewer     │
--  └──────────────────┴──────────────────────────────────┴──────────────┘
--
--  Idempotency: ON CONFLICT (email) DO UPDATE
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO convera_users (
  email, password_hash, name, name_ar, role,
  phone, phone_masked, avatar, avatar_color,
  contract_no, organization, is_active, approved
)
VALUES
  -- Director — full access
  (
    'Ma.Alarfaj@momah.gov.sa',
    '0555180602',
    'Mohammed Alarfaj',
    'محمد العرفج',
    'director',
    '+966555180602',
    '+966 *** *** 602',
    'م',
    '#026D69',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  ),

  -- Admin — review, manage, forward
  (
    'halhablayn-Contractor@momah.gov.sa',
    '0555180602',
    'Hossam Al-Hablayn',
    'حسام الحبلين',
    'admin',
    '+966554319723',
    '+966 *** *** 723',
    'ح',
    '#1A4B8C',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  ),

  -- Consultant — Beeah (external, submit/track)
  (
    'mahmoud.ragab@beeah.sa',
    '0555180602',
    'Mahmoud Ragab',
    'محمود رجب',
    'consultant',
    NULL,
    NULL,
    'م',
    '#6A5ACD',
    '231001101771',
    'شركة البيئة مخططون معماريون ومهندسون',
    true, true
  ),

  -- Contractor — Beeah (external, contract 231001101771)
  (
    'abdullah.albahdal@beeah.sa',
    '0555180602',
    'Abdullah Albahdal',
    'عبدالله البهدل',
    'contractor',
    '+966541311397',
    '+966 *** *** 397',
    'ع',
    '#2E8B57',
    '231001101771',
    'شركة البيئة مخططون معماريون ومهندسون',
    true, true
  ),

  -- Contractor — Sharat (external, contract 241039011332)
  (
    'arfaj001@gmail.com',
    '0555180602',
    'Malik Al-Oqab',
    'مالك العقاب',
    'contractor',
    NULL,
    NULL,
    'م',
    '#DC143C',
    '241039011332',
    'مؤسسة شارة الإنشاء للمقاولات',
    true, true
  ),

  -- Internal Reviewer
  (
    'reviewer@momah.gov.sa',
    '0555180602',
    'Ahmed Al-Rashidi',
    'أحمد الراشدي',
    'consultant',
    '+966551234567',
    '+966 *** *** 567',
    'أ',
    '#4682B4',
    NULL,
    'وزارة البلديات والإسكان',
    true, true
  )

ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  name          = EXCLUDED.name,
  name_ar       = EXCLUDED.name_ar,
  role          = EXCLUDED.role,
  phone         = EXCLUDED.phone,
  phone_masked  = EXCLUDED.phone_masked,
  avatar        = EXCLUDED.avatar,
  avatar_color  = EXCLUDED.avatar_color,
  contract_no   = EXCLUDED.contract_no,
  organization  = EXCLUDED.organization,
  is_active     = EXCLUDED.is_active,
  approved      = EXCLUDED.approved,
  updated_at    = NOW();


-- ─── Verification ──────────────────────────────────────────────

SELECT
  id,
  email,
  name_ar,
  role,
  contract_no,
  is_active
FROM convera_users
ORDER BY id;


-- ════════════════════════════════════════════════════════════════════
--  STEP 47  —  SEED  —  seq=s004
--  Source: legacy: seeds/004_seed_supabase_auth_users.sql
--  Reason: auth.users bootstrap
-- ════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Seed: Supabase Auth Users (Optional)
--  File: 004_seed_supabase_auth_users.sql
--
--  Run order: 4 (optional — run ONLY if migrating to Supabase Auth)
--  Depends on: All migrations (001-006)
--
--  PURPOSE:
--    Creates proper auth.users entries so the system can use
--    Supabase Auth (supabase.auth.signInWithPassword) instead of
--    the convera_users prototype flow.
--
--    The on_auth_user_created trigger in migration 001 will
--    auto-create profiles rows. However, since we already have
--    profiles from 001_seed_profiles.sql, the ON CONFLICT (id)
--    DO NOTHING clause in the trigger handles duplicates safely.
--
--  ╔═══════════════════════════════════════════════════════════════╗
--  ║  ⚠️  BOOTSTRAP PASSWORD: 0555180602                         ║
--  ║  This is a TEMPORARY password for testing/staging ONLY.     ║
--  ║  ALL users must change their password before production.    ║
--  ║  Never deploy with this password to a public environment.   ║
--  ╚═══════════════════════════════════════════════════════════════╝
--
--  HOW TO RUN:
--    This script uses Supabase's auth.users internal table.
--    It must be run in the Supabase SQL Editor as a superuser.
--    The password is hashed using pgcrypto's crypt() with bf (bcrypt).
--
--  AFTER RUNNING:
--    1. Update the frontend to use supabase.auth.signInWithPassword()
--    2. Remove the convera_users login flow
--    3. Remove 005_rls_prototype_access.sql permissive policies
--    4. Drop convera_users and convera_otp tables
-- ═══════════════════════════════════════════════════════════════════


-- ─── Helper: create auth user with known UUID ────────────────────
-- Supabase stores passwords as bcrypt hashes in auth.users.
-- The encrypted_password column uses the format: $2a$10$...

DO $$
DECLARE
  v_password_hash TEXT;
BEGIN
  -- Generate bcrypt hash of the bootstrap password
  v_password_hash := crypt('0555180602', gen_salt('bf', 10));

  -- ── A. Director ──────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000001-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'Ma.Alarfaj@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Mohammed Alarfaj',
      'full_name_ar', 'محمد العرفج',
      'role', 'director'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── B. Admin ─────────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000002-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'halhablayn-Contractor@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Hossam Al-Hablayn',
      'full_name_ar', 'حسام الحبلين',
      'role', 'admin'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── C. Consultant ────────────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000003-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'mahmoud.ragab@beeah.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Mahmoud Ragab',
      'full_name_ar', 'محمود رجب',
      'role', 'consultant'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── D. Contractor (Beeah) ───────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000004-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'abdullah.albahdal@beeah.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Abdullah Albahdal',
      'full_name_ar', 'عبدالله البهدل',
      'role', 'contractor'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── E. Contractor (Sharat) ──────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000005-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'arfaj001@gmail.com',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Malik Al-Oqab',
      'full_name_ar', 'مالك العقاب',
      'role', 'contractor'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  -- ── F. Internal Reviewer ────────────────────────────────────
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_user_meta_data, role, aud
  ) VALUES (
    'a1000006-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'reviewer@momah.gov.sa',
    v_password_hash,
    NOW(), NOW(), NOW(),
    jsonb_build_object(
      'full_name', 'Ahmed Al-Rashidi',
      'full_name_ar', 'أحمد الراشدي',
      'role', 'reviewer'
    ),
    'authenticated', 'authenticated'
  ) ON CONFLICT (id) DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = NOW();

  RAISE NOTICE 'Supabase Auth users created with bootstrap password.';
  RAISE NOTICE '⚠️  Change all passwords before production deployment!';
END $$;


-- ─── Verification ──────────────────────────────────────────────

SELECT
  id,
  email,
  raw_user_meta_data->>'full_name' AS name,
  raw_user_meta_data->>'role'      AS role,
  email_confirmed_at IS NOT NULL   AS confirmed,
  created_at::DATE                 AS created
FROM auth.users
WHERE id::TEXT LIKE 'a1000%'
ORDER BY id;


-- ════════════════════════════════════════════════════════════════════
--  STEP 48  —  SEED  —  seq=s005
--  Source: current: seeds/005_seed_test_users_cmh.sql
--  Reason: IAM-3 aligned test users
-- ════════════════════════════════════════════════════════════════════
-- ═════════════════════════════════════════════════════════════════════════
--  CONVERA — Test User Seeding for Happy-Path Smoke Test (Phase 2.6)
--  File:        SQL/seeds/005_seed_test_users_cmh.sql
--
--  ┌─────────────────────────────────────────────────────────────────┐
--  │  OFFICIAL PROJECT PATH:                                         │
--  │  C:\Users\Administrator\Desktop\convera-platform                │
--  │                                                                  │
--  │  Do not edit stale copies outside this repository.              │
--  │  See logs/REPOSITORY_PATH_AND_SEEDING_RULES.md for the full      │
--  │  list of forbidden / allowed locations.                          │
--  │                                                                  │
--  │  This seed must be run only after confirming the target          │
--  │  contracts mapping (project_code + contract_no) below.           │
--  └─────────────────────────────────────────────────────────────────┘
--
--  Run order : after Migration 046 + 045 + 040 are applied.
--  Targets   : contracts CMH_01 / CMH_02 / CMH_03 — joined ONLY via
--              the (project_code, contract_no) mapping in PHASE 0.
--              No prefix matching, no `-C01` suffix, no contract_no
--              wildcards.
--  Safety    : NON-DESTRUCTIVE — no rows deleted from auth.users,
--              profiles, contracts, claims, or change_orders. Only:
--                • auth.users / auth.identities : NEVER WRITTEN.
--                  This script is now READ-ONLY against the auth.*
--                  schema. Direct INSERTs on auth.users were
--                  proven to leave users in an inconsistent state
--                  (the GoTrue server returns "Database error
--                  querying schema" at sign-in), so all auth-user
--                  provisioning is delegated to the Supabase Admin
--                  API — see scripts/create-test-auth-users.js.
--                • profiles               : INSERTed if missing,
--                  UPDATEd in place (single-user WHERE-clause). Each
--                  upsert depends on auth.users already containing
--                  the matching row.
--                • user_contract_roles    : prior rows for these 3
--                  contracts are SOFT-DEACTIVATED (is_active=false).
--                • contract_approvers     : director added if missing,
--                  re-activated if previously soft-revoked.
--
--  Excludes  : `auditor` is NOT used in this batch — Phase 2.6 maps
--              "تدقيق" / "مراجع" / "الجهة الفنية" all to contract_role
--              `reviewer` (the Technical Unit gate). The script raises
--              EXCEPTION rather than silently skipping if it ever
--              tries to write `auditor` (defensive guard).
--
--  Run as    : Supabase SQL Editor (service_role / postgres).
--
--  ⚠ PRE-FLIGHT: every test user MUST already exist in auth.users
--              with a matching row in auth.identities (provider='email')
--              and `email_confirmed_at` set, BEFORE this seed runs.
--              Use scripts/create-test-auth-users.js (Admin API) to
--              create / update them. Phase 2 below verifies this and
--              raises a clear EXCEPTION if any user is missing.
-- ═════════════════════════════════════════════════════════════════════════

-- ── 0a. (removed) Bootstrap password section ────────────────────────
--    The earlier version of this seed set passwords directly via
--    crypt(...) on auth.users.encrypted_password.  That path was
--    removed because GoTrue refuses to authenticate users that were
--    inserted into auth.users by raw SQL even when the bcrypt hash
--    is correct ("Database error querying schema").  Passwords are
--    now provisioned exclusively through the Admin API helper:
--        scripts/create-test-auth-users.js  (npm run seed:auth-users)
--    This SQL file no longer touches passwords.

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 0b — TARGET CONTRACTS (single source of truth)
-- ════════════════════════════════════════════════════════════════════
--
-- All subsequent phases JOIN against this mapping.  Every CTE below
-- that references contracts SHALL go through `target_contracts` —
-- NEVER through a bare `contracts.contract_no LIKE 'CMH_%'` or any
-- prefix matching.  This guarantees the script touches exactly the
-- three target contracts and nothing else.

-- The mapping is captured as a temp view so every DO block / CTE
-- below sees the same rows.

DROP VIEW IF EXISTS pg_temp.target_contracts;
CREATE TEMP VIEW pg_temp.target_contracts AS
WITH src(project_code, contract_no) AS (
  VALUES
    -- CMH_01 uses the legacy short code 'CMH_01-C01' as its contract_no
    -- in the test DB (verified 2026-05-04). CMH_02 / CMH_03 carry the
    -- 12-digit MoMaH numbers. Update this VALUES block — and only this
    -- block — when the test environment changes.
    ('CMH_01', 'CMH_01-C01'),
    ('CMH_02', '250101116428'),
    ('CMH_03', '241039011332')
)
SELECT s.project_code, s.contract_no, c.id AS contract_id
  FROM src s
  LEFT JOIN contracts c ON c.contract_no = s.contract_no;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 — Resolve contract IDs and fail loudly on any miss / dup
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r RECORD;
  v_dup_count int;
BEGIN
  -- 1a) Every project_code MUST resolve to exactly one contract row.
  FOR r IN SELECT * FROM pg_temp.target_contracts LOOP
    IF r.contract_id IS NULL THEN
      RAISE EXCEPTION
        'Contract not found for project_code=% / contract_no=%. '
        'Verify the contracts table has a row with this contract_no '
        'before running.', r.project_code, r.contract_no;
    END IF;
    RAISE NOTICE 'OK: % → contract_no=% → contract_id=%',
      r.project_code, r.contract_no, r.contract_id;
  END LOOP;

  -- 1b) No two project_codes may share the same contract_no.
  --     (Defends against a typo in Phase 0b.)
  SELECT COUNT(*) - COUNT(DISTINCT contract_no)
    INTO v_dup_count
    FROM pg_temp.target_contracts;
  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Duplicate contract_no in target_contracts mapping. '
      'Each project_code must map to a unique contract_no.';
  END IF;

  -- 1c) No two contracts in the DB may share the same contract_no
  --     (already enforced by UNIQUE constraint on contracts.contract_no
  --      in Migration 001, but we double-check defensively).
  SELECT COUNT(*) INTO v_dup_count
    FROM contracts c
   WHERE c.contract_no IN (SELECT contract_no FROM pg_temp.target_contracts)
   GROUP BY c.contract_no
  HAVING COUNT(*) > 1
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'More than one contract row found for one of the target contract_no values.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 2 — READ-ONLY pre-flight on auth.users + auth.identities
-- ════════════════════════════════════════════════════════════════════
--
-- This phase performs ZERO writes against the auth.* schema.
-- Direct INSERT/UPDATE on auth.users (and auth.identities) is now
-- forbidden — see logs/REPOSITORY_PATH_AND_SEEDING_RULES.md and the
-- header banner above. All test-user provisioning is delegated to
-- the Supabase Admin API helper:
--     scripts/create-test-auth-users.js  (npm run seed:auth-users)
--
-- For each required email this phase verifies that:
--   (a) a row exists in auth.users (case-insensitive lookup)
--   (b) the user has an `auth.identities` row with provider='email'
--   (c) the user's email_confirmed_at is NOT NULL
-- If ANY of these fails, the script raises an exception with the
-- exact email and a clear remediation message. No subsequent phases
-- run unless every required user is auth-ready.

DO $$
DECLARE
  v_email      TEXT;
  v_user_id    UUID;
  v_confirmed  TIMESTAMPTZ;
  v_has_ident  BOOLEAN;
  required_emails TEXT[] := ARRAY[
    'ma.alarfaj@momah.gov.sa',
    'halhablayn-Contractor@momah.gov.sa',
    'aaldera-contractor@momah.gov.sa',
    'anaalghamdi-contractor@momah.gov.sa',
    'mahmoud.ragab@beeah.sa',
    'info@gdci.com.sa',
    'fakher@alleanzaa.com',
    'malek.h.mkh@gmail.com'
  ];
BEGIN
  FOREACH v_email IN ARRAY required_emails LOOP

    -- (a) auth.users must exist (case-insensitive).
    SELECT id, email_confirmed_at
      INTO v_user_id, v_confirmed
      FROM auth.users
     WHERE LOWER(email) = LOWER(v_email)
     LIMIT 1;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: auth.users row missing for email "%". '
        'Create this user via Supabase Dashboard / Admin API first '
        '(run: npm run seed:auth-users from the convera-platform repo).',
        v_email;
    END IF;

    -- (b) auth.identities must include provider='email'.
    SELECT EXISTS (
      SELECT 1 FROM auth.identities
       WHERE user_id  = v_user_id
         AND provider = 'email'
    ) INTO v_has_ident;

    IF NOT v_has_ident THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: auth.identities row missing (provider=email) '
        'for "%". GoTrue cannot authenticate this user without it. '
        'Create this user via Supabase Dashboard / Admin API first '
        '(run: npm run seed:auth-users).',
        v_email;
    END IF;

    -- (c) email_confirmed_at must be set.
    IF v_confirmed IS NULL THEN
      RAISE EXCEPTION
        'PRE-FLIGHT FAIL: email_confirmed_at IS NULL for "%". '
        'Confirm the email in Supabase Dashboard or set email_confirm=true '
        'when creating the user via the Admin API '
        '(npm run seed:auth-users does this automatically).',
        v_email;
    END IF;

    RAISE NOTICE 'PRE-FLIGHT OK: % → user_id=% confirmed_at=%',
      v_email, v_user_id, v_confirmed;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 3 — Upsert profiles for the 8 users
-- ════════════════════════════════════════════════════════════════════

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Mohammed Alarfaj', 'محمد العرفج',
       'director'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('ma.alarfaj@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  role         = 'director'::user_role,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Hossam Al-Hablayn', 'حسام الحبلين',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('halhablayn-Contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Abdullah Al-Dera', 'عبدالله الدرع',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('aaldera-contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Anas Al-Ghamdi', 'أنس الغامدي',
       'reviewer'::user_role,
       'وزارة البلديات والإسكان',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('anaalghamdi-contractor@momah.gov.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Mahmoud Massad', 'محمود مساد',
       'consultant'::user_role,
       'BEEAH',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('mahmoud.ragab@beeah.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email,
       'Gulf Development Contracting Co.',
       'شركة الخليج المتطورة للمقاولات',
       'contractor'::user_role,
       'GDCI',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('info@gdci.com.sa')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email,
       'Alleanzaa Contracting',
       'شركة إليانزا للمقاولات',
       'contractor'::user_role,
       'Alleanzaa',
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('fakher@alleanzaa.com')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  organization = EXCLUDED.organization,
  is_active    = true,
  updated_at   = NOW();

INSERT INTO profiles (id, email, full_name, full_name_ar, role, organization, is_active, is_verified)
SELECT u.id, u.email, 'Malik Al-Oqab', 'مالك العقاب',
       'contractor'::user_role,
       NULL,
       true, true
  FROM auth.users u
 WHERE LOWER(u.email) = LOWER('malek.h.mkh@gmail.com')
ON CONFLICT (id) DO UPDATE SET
  full_name    = EXCLUDED.full_name,
  full_name_ar = EXCLUDED.full_name_ar,
  is_active    = true,
  updated_at   = NOW();

-- ════════════════════════════════════════════════════════════════════
-- PHASE 4 — Soft-deactivate prior user_contract_roles
--           (only the 3 target contracts — joined via target_contracts)
-- ════════════════════════════════════════════════════════════════════

UPDATE user_contract_roles ucr
   SET is_active = false,
       notes     = COALESCE(notes, '') ||
                   ' [deactivated 2026-05-04 — Phase 2.6 role refresh, replaced by 005_seed_test_users_cmh.sql]'
  FROM pg_temp.target_contracts tc
 WHERE ucr.contract_id = tc.contract_id
   AND ucr.is_active   = true;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 5 — Insert / re-activate the new role assignments
-- ════════════════════════════════════════════════════════════════════
--
-- Per the Phase 2.6 mapping:
--   مقاول            → contractor
--   مكتب استشاري      → supervisor
--   تدقيق / مراجع / الجهة الفنية → reviewer
--   جودة             → quality
--   مدير مشروع       → project_manager
--   معتمد نهائي      → final_approver
--
-- Migration 045 changed UNIQUE to (user_id, contract_id, contract_role).
-- A user holding multiple roles on the same contract now requires
-- multiple rows — this script does not exercise that, but the
-- ON CONFLICT clause uses the 3-tuple constraint so future re-runs
-- are safe.

WITH role_mapping(project_code, email_lc, role) AS (
  VALUES
    -- CMH_01 (contract_no=CMH_01-C01) — 6 roles ──────────────────
    ('CMH_01', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_01', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_01', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_01', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_01', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_01', LOWER('info@gdci.com.sa'),                       'contractor'),
    -- CMH_02 (contract_no=250101116428) — 6 roles ─────────────────
    ('CMH_02', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_02', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_02', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_02', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_02', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_02', LOWER('fakher@alleanzaa.com'),                   'contractor'),
    -- CMH_03 (contract_no=241039011332) — 6 roles ─────────────────
    ('CMH_03', LOWER('ma.alarfaj@momah.gov.sa'),                'final_approver'),
    ('CMH_03', LOWER('halhablayn-Contractor@momah.gov.sa'),     'project_manager'),
    ('CMH_03', LOWER('aaldera-contractor@momah.gov.sa'),        'quality'),
    ('CMH_03', LOWER('anaalghamdi-contractor@momah.gov.sa'),    'reviewer'),
    ('CMH_03', LOWER('mahmoud.ragab@beeah.sa'),                 'supervisor'),
    ('CMH_03', LOWER('malek.h.mkh@gmail.com'),                  'contractor')
)
INSERT INTO user_contract_roles (user_id, contract_id, contract_role, is_active, notes)
SELECT u.id,
       tc.contract_id,
       m.role::contract_role,
       true,
       'Seeded by 005_seed_test_users_cmh.sql on 2026-05-04 (Phase 2.6 smoke test) — '
         || m.project_code || ' / ' || tc.contract_no
  FROM role_mapping m
  JOIN pg_temp.target_contracts tc ON tc.project_code = m.project_code
  JOIN auth.users u                ON LOWER(u.email)   = m.email_lc
ON CONFLICT (user_id, contract_id, contract_role) DO UPDATE SET
  is_active = true,
  notes     = 'Reactivated by 005_seed_test_users_cmh.sql on 2026-05-04 (Phase 2.6 smoke test)';

-- 5b) Defensive guard: NO row with contract_role='auditor' may have
--     been written by THIS run on the target contracts.  This catches
--     any future maintainer who edits the role_mapping CTE wrongly.
DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT COUNT(*) INTO v_bad_count
    FROM user_contract_roles ucr
    JOIN pg_temp.target_contracts tc ON tc.contract_id = ucr.contract_id
   WHERE ucr.contract_role = 'auditor'
     AND ucr.is_active     = true
     AND ucr.notes LIKE '%005_seed_test_users_cmh.sql on 2026-05-04%';
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'Defensive guard tripped: this run wrote % active auditor row(s) on the '
      'target contracts. Phase 2.6 forbids auditor in the smoke-test data set.',
      v_bad_count;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 6 — Add Mohammed Alarfaj as final_approver in contract_approvers
-- ════════════════════════════════════════════════════════════════════

INSERT INTO contract_approvers (contract_id, user_id, approval_scope, granted_at, is_active, notes)
SELECT tc.contract_id,
       u.id,
       'final_approver'::approval_scope,
       NOW(),
       true,
       'Seeded by 005_seed_test_users_cmh.sql on 2026-05-04 — '
         || tc.project_code || ' / ' || tc.contract_no
  FROM pg_temp.target_contracts tc
  JOIN auth.users u
    ON LOWER(u.email) = LOWER('ma.alarfaj@momah.gov.sa')
ON CONFLICT (contract_id, user_id, approval_scope) DO UPDATE SET
  is_active  = true,
  revoked_at = NULL,
  notes      = 'Reactivated by 005_seed_test_users_cmh.sql on 2026-05-04';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 7 — Verification queries (run AFTER COMMIT, INFORMATIONAL)
-- ════════════════════════════════════════════════════════════════════
-- The temp view drops with the session; rerun PHASE 0b before these
-- if you reconnect.

-- VAL-1: confirm each contract has exactly 6 active roles.
-- Expected: 3 rows, each with role_count = 6.
SELECT tc.project_code,
       tc.contract_no,
       COUNT(*) AS role_count
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
 WHERE ucr.is_active = true
 GROUP BY tc.project_code, tc.contract_no
 ORDER BY tc.project_code;

-- VAL-2: confirm each contract has exactly the 6 expected ContractRole values.
-- Expected: 18 rows total (3 contracts × 6 roles), no `auditor` rows.
SELECT tc.project_code,
       tc.contract_no,
       ucr.contract_role,
       p.full_name_ar,
       p.email
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
  JOIN profiles p              ON p.id = ucr.user_id
 WHERE ucr.is_active = true
 ORDER BY tc.project_code,
          CASE ucr.contract_role
            WHEN 'contractor'      THEN 1
            WHEN 'supervisor'      THEN 2
            WHEN 'reviewer'        THEN 3
            WHEN 'quality'         THEN 4
            WHEN 'project_manager' THEN 5
            WHEN 'final_approver'  THEN 6
            ELSE 99
          END;

-- VAL-3: confirm zero `auditor` rows are active on these 3 contracts.
-- Expected: 0 rows.
SELECT tc.project_code, tc.contract_no, ucr.contract_role
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
 WHERE ucr.is_active     = true
   AND ucr.contract_role = 'auditor';

-- VAL-4: confirm Mohammed Alarfaj has an active contract_approvers row
-- on each of the 3 contracts.
-- Expected: 3 rows.
SELECT tc.project_code,
       tc.contract_no,
       p.full_name_ar AS approver,
       ca.approval_scope,
       ca.is_active,
       ca.revoked_at
  FROM pg_temp.target_contracts tc
  JOIN contract_approvers ca ON ca.contract_id = tc.contract_id
  JOIN profiles p             ON p.id = ca.user_id
 WHERE ca.approval_scope = 'final_approver'
   AND ca.is_active      = true
 ORDER BY tc.project_code;

-- VAL-5: snapshot of soft-deactivated rows from Phase 4.
-- Expected: lists prior assignments now is_active=false with the marker note.
SELECT tc.project_code,
       tc.contract_no,
       p.full_name_ar,
       ucr.contract_role,
       ucr.is_active,
       ucr.notes
  FROM pg_temp.target_contracts tc
  JOIN user_contract_roles ucr ON ucr.contract_id = tc.contract_id
  JOIN profiles p              ON p.id = ucr.user_id
 WHERE ucr.is_active = false
   AND ucr.notes LIKE '%Phase 2.6 role refresh%'
 ORDER BY tc.project_code, p.full_name_ar;

-- VAL-6: claims unaffected — count of rows per contract.
-- Compare this with a pre-run snapshot taken before COMMIT.
SELECT tc.project_code, tc.contract_no, COUNT(cl.id) AS claim_count
  FROM pg_temp.target_contracts tc
  LEFT JOIN claims cl ON cl.contract_id = tc.contract_id
 GROUP BY tc.project_code, tc.contract_no
 ORDER BY tc.project_code;


-- ════════════════════════════════════════════════════════════════════
--  END OF BUNDLE — next: run staging_schema_verification.sql
-- ════════════════════════════════════════════════════════════════════
