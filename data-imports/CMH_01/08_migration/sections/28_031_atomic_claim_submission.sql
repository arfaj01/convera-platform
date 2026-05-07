-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 28 — MIGRATION
--  Source seq      : 031
--  Source migration: migrations/031_atomic_claim_submission.sql
--  Purpose         : predecessor atomic-submission RPC
--  Run order       : STEP 28 of 48 (after STEP 27, before STEP 29).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
