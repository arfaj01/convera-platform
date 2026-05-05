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
