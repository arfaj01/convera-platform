-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 09 — MIGRATION
--  Source seq      : 010b
--  Source migration: migrations/010_user_contracts.sql
--  Purpose         : user_contracts (m2m)
--  Run order       : STEP 9 of 48 (after STEP 8, before STEP 10).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
