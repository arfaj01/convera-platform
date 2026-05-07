-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 25 — MIGRATION
--  Source seq      : 028
--  Source migration: migrations/028_add_last_transition_at.sql
--  Purpose         : last_transition_at column
--  Run order       : STEP 25 of 48 (after STEP 24, before STEP 26).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
