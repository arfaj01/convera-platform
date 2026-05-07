-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 13 — MIGRATION
--  Source seq      : 014
--  Source migration: migrations/014_db_level_transition_guard.sql
--  Purpose         : DB-level transition guard
--  Run order       : STEP 13 of 48 (after STEP 12, before STEP 14).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
