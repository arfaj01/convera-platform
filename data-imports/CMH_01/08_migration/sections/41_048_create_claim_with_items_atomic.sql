-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 41 — MIGRATION
--  Source seq      : 048
--  Source migration: migrations/048_create_claim_with_items_atomic.sql
--  Purpose         : atomic create RPC
--  Run order       : STEP 41 of 48 (after STEP 40, before STEP 42).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
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
