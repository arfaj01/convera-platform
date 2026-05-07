-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 29 — MIGRATION
--  Source seq      : 031b
--  Source migration: migrations/031b_fix_audit_logs_columns.sql
--  Purpose         : audit_logs column fix
--  Run order       : STEP 29 of 48 (after STEP 28, before STEP 30).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
