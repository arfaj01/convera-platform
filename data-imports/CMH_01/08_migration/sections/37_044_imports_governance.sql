-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 37 — MIGRATION
--  Source seq      : 044
--  Source migration: migrations/044_imports_governance.sql
--  Purpose         : imports governance (newer)
--  Run order       : STEP 37 of 48 (after STEP 36, before STEP 38).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
