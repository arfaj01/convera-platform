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
