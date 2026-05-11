# Migration 049 — Production Apply Note

> **Status:** DRAFT — awaiting operator approval. **NOT YET APPLIED.**
> **Target:** Supabase production (`ngwxlockzkjpmzuvgakx`) only.
> **Author of this note:** Claude (Cowork mode), 2026-05-10.
> **Source migration:** `SQL/migrations/049_fix_claim_rpc_item_no_cast.sql` (529 lines, single transaction).

---

## TL;DR

Migration 049 replaces the body of `create_claim_with_items_atomic` so that BOQ and staff `item_no` values extracted from JSONB are cast to `INTEGER` before being compared against (or inserted into) the `INTEGER`-typed `item_no` columns. Without it, calls to the RPC raise `operator does not exist: integer = text` and the New-Claim form cannot save. The fix is **idempotent**, **single-transaction**, **signature-preserving**, and **rollback-by-reapply-048**. Risk to production is LOW. Apply only after the operator types the approval phrase at the bottom of this note.

---

## 1. Why it is needed

### Symptom
Every "تقديم المطالبة" / "حفظ كمسودة" attempt that goes through `create_claim_with_items_atomic` (the RPC introduced by Migration 048) raises:

```
ERROR:  operator does not exist: integer = text
```

…surfaced through the API → toast pipeline.

### Root cause
Migration 048 declared `v_item_no TEXT` and populated it via `v_item->>'item_no'`. The `->>` JSONB operator always returns `TEXT`, regardless of whether the JSON value was a number or a string. The RPC then compared `cb.item_no = v_item_no` where `claim_boq_items.item_no` is `INTEGER`. PostgreSQL has no implicit `integer = text` operator → the validation pass raises before any insert.

The same latent bug exists for `claim_staff_items.item_no` (also `INTEGER`); 049 fixes both.

### Production state today (read-only probe, 2026-05-10)

```sql
SELECT
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_claim_with_items_atomic') AS has_rpc,
  EXISTS(SELECT 1 FROM pg_proc WHERE proname='create_claim_with_items_atomic'
                              AND prosrc ILIKE '%(item->''item_no'')::int%')   AS has_049_fix;
-- Result observed:
-- has_rpc       = true
-- has_049_fix   = false
```

→ Production has Migration 048's RPC but not 049's fix. The RPC will fail on every call. The 17 claims currently in production were likely created via an older code path (`submit_claim_atomic`) before Phase 2.6 wired the New-Claim form to the new RPC. Confirm with the team whether the live app still calls the new RPC or has fallen back to the old one — that determines how urgent this apply is.

---

## 2. Exact SQL file

**Path:** `SQL/migrations/049_fix_claim_rpc_item_no_cast.sql`
**Size:** 529 lines (the meaningful body is one `CREATE OR REPLACE FUNCTION` inside `BEGIN; … COMMIT;`).
**Contents at a glance:**

```
BEGIN;

-- Pre-flight: verify Migration 048 has been applied (raises if not).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='create_claim_with_items_atomic') THEN
    RAISE EXCEPTION 'create_claim_with_items_atomic missing — Migration 048 must run first';
  END IF;
END $$;

-- Replacement function (same signature, fixed body).
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
  -- … 280 lines of body — see file for full text …
$func$;

COMMENT ON FUNCTION create_claim_with_items_atomic IS '… 049 patch note …';

GRANT EXECUTE ON FUNCTION create_claim_with_items_atomic(
  UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
) TO authenticated, service_role;

COMMIT;
```

The body changes are purely:
- Add `v_item_no_raw TEXT` and `v_item_no INTEGER` locals (was: only `v_item_no TEXT`).
- Validate `v_item_no_raw ~ '^[0-9]+$'` and raise `ITEM_NO_INVALID` (new explicit Arabic-message error code) if it doesn't match.
- Cast `v_item_no := v_item_no_raw::INTEGER` once, then use `v_item_no` (INTEGER) in every comparison and INSERT.
- Same fix applied in three loops: BOQ-validation, BOQ-insert, staff-insert.

No other change. Same signature, same security, same RETURNS shape, same transaction boundary.

---

## 3. Idempotency analysis

| Property | Verdict | Reason |
|---|---|---|
| Re-runnable | ✅ Yes | `CREATE OR REPLACE FUNCTION` overwrites the existing definition. Re-running 049 produces the same end state. |
| Order-independent | ⚠ Depends on 048 | Pre-flight raises if 048's function is missing. So 049 must run AFTER 048. Production has 048, so this condition is satisfied. |
| Side-effect free on data | ✅ Yes | The migration only redefines a function; no `INSERT`/`UPDATE`/`DELETE`/`ALTER TABLE`/`DROP`. |
| Schema-additive | ✅ Yes | No columns added, no enums extended, no constraints added. |
| Function signature preserved | ✅ Yes | Same 14 `IN` parameters, same name, same return type. Application code does not need to change. |
| GRANTs preserved | ✅ Yes | Re-grants `EXECUTE` to `authenticated` and `service_role`. No-op if already granted. |

---

## 4. Expected risk

**Overall risk: LOW.**

| Risk dimension | Level | Note |
|---|---|---|
| Data loss | None | No data is touched. |
| Downtime | None | The transaction is short (sub-second). The function is locked exclusively during `CREATE OR REPLACE`; concurrent calls during the apply will queue briefly. |
| Behaviour change for existing claims | None | The fix only affects future invocations. Existing rows are untouched. |
| Behaviour change for new claim creation | **Bug-fix change** | The RPC will go from "every call raises integer = text" to "calls succeed when item_no is a positive integer; raise `ITEM_NO_INVALID` when it isn't". If the live app was relying on the broken state and routing around it, applying 049 will start passing through the correct path. Confirm with the team that the New-Claim form is wired to the new RPC. |
| RLS impact | None | Function is `SECURITY DEFINER` in both 048 and 049. Auth checks remain in the API layer, unchanged. |
| GRANT impact | None | Idempotent re-grant. |
| Breaking change for callers | None | Signature unchanged. |
| New error code surfaced | Minor | `ITEM_NO_INVALID` (Arabic message) replaces the cryptic `22P02` cast error for malformed `item_no` values. The route's UNKNOWN-error fallback already prefixes with "فشل إنشاء المطالبة:" so the user sees a sentence either way; but mapping `ITEM_NO_INVALID` to a polished Arabic message in the route is a follow-up (out of 049's scope). |

---

## 5. Rollback considerations

The migration is fully reversible by re-applying Migration 048 (which is unchanged in the repo at `SQL/migrations/048_create_claim_with_items_atomic.sql`). The procedure is symmetric to apply: open Studio's SQL editor in production, paste 048's contents, run.

**Caveat:** rolling back to 048 reintroduces the `integer = text` bug. Only do this if 049's apply caused an unexpected production-breaking behaviour change AND 048 + the broken claim-creation path are preferable to the new behaviour for the moment. In practice, this should never be necessary — 049 strictly fixes a bug.

If a worse situation occurs (e.g. apply somehow corrupts the function definition in a way neither 048 nor 049 expected), the recovery is:

```sql
-- Last-resort: drop and reapply both 048 and 049 from clean repo source.
DROP FUNCTION IF EXISTS create_claim_with_items_atomic(
  UUID, claim_kind, TEXT, DATE, DATE, TEXT, UUID, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB
);
-- Then paste 048 contents, then paste 049 contents, in that order.
```

---

## 6. Verification queries (run AFTER commit)

The migration file ships VAL-1 through VAL-5 inline as commented-out `SELECT`s. The recommended set to run in production after apply:

### VAL-1 — function exists and is SECURITY DEFINER
```sql
SELECT proname, prosecdef
  FROM pg_proc
 WHERE proname = 'create_claim_with_items_atomic';
-- Expected: 1 row, prosecdef = true
```

### VAL-2 — signature unchanged
```sql
SELECT pg_get_function_arguments(oid)
  FROM pg_proc
 WHERE proname = 'create_claim_with_items_atomic';
-- Expected: 14 IN parameters in original 048 order
-- (p_contract_id uuid, p_claim_kind claim_kind, p_claim_type text,
--  p_work_period_from date, p_work_period_to date, p_external_reference text,
--  p_actor_id uuid, p_project_code text,
--  p_boq_amount numeric, p_staff_amount numeric, p_retention_amount numeric,
--  p_vat_amount numeric, p_boq_items jsonb, p_staff_items jsonb)
```

### VAL-3 — confirm safe-cast is present
```sql
SELECT
  regexp_count(pg_get_functiondef(oid), 'cb\.item_no\s+=\s+v_item_no\b')   AS safe_eq_count,
  regexp_count(pg_get_functiondef(oid), 'v_item_no_raw')                   AS raw_var_count
  FROM pg_proc
 WHERE proname = 'create_claim_with_items_atomic';
-- Expected: safe_eq_count >= 2, raw_var_count >= 1
-- If safe_eq_count = 0, the apply did not take effect — investigate.
```

### VAL-4 — happy-path smoke test (OPTIONAL, ROLLBACK at the end)
```sql
BEGIN;
  SELECT create_claim_with_items_atomic(
    '<pick-a-real-contract-uuid>'::UUID,
    'running_payment'::claim_kind,
    'boq_only',
    '2026-05-01'::DATE, '2026-05-31'::DATE,
    NULL,
    '<your-director-uuid>'::UUID,
    'CMH01',
    0, 0, 0, 0,
    '[{"item_no":"1","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
    '[]'::jsonb
  );
ROLLBACK;
-- Expected: returns a JSONB object with id, claim_no, claim_number, etc.
-- Then ROLLBACK so no real claim is persisted.
```

### VAL-5 — malformed item_no raises ITEM_NO_INVALID (OPTIONAL, ROLLBACK at the end)
```sql
BEGIN;
  SELECT create_claim_with_items_atomic(
    '<contract-uuid>'::UUID,
    'running_payment'::claim_kind,
    'boq_only',
    '2026-05-01'::DATE, '2026-05-31'::DATE,
    NULL,
    '<actor-uuid>'::UUID,
    'CMH01',
    0, 0, 0, 0,
    '[{"item_no":"abc","unit_price":100,"contractual_qty":10,"curr_progress":1}]'::jsonb,
    '[]'::jsonb
  );
ROLLBACK;
-- Expected: ERROR: ITEM_NO_INVALID: BOQ item_no must be a positive integer; got: abc
```

---

## 7. Apply procedure (when approved)

1. **Pre-flight (one-minute sanity check):**
   - Confirm Studio breadcrumb shows `MOMAH > CONVERA > main · PRODUCTION`.
   - Confirm URL contains `ngwxlockzkjpmzuvgakx`. STOP if it contains `jrqkzwacerdudmeacvar` (that would target staging — different procedure).
   - Run a 5-second readiness check: are there any open claims being created RIGHT NOW? Look at `/المطالبات/جديدة` traffic in the Vercel analytics if available. If yes, wait until idle.
2. **Open a NEW SQL editor query** in Supabase Studio (don't overwrite a saved query).
3. **Paste the entire contents of `SQL/migrations/049_fix_claim_rpc_item_no_cast.sql`** into the editor.
4. **Run** (Ctrl+Enter). Expected: `Success. No rows returned`. The transaction completes in under a second.
5. **Run VAL-1 → VAL-3** in the same SQL editor to confirm the apply took effect. All three should return the expected values.
6. **(Optional)** Run VAL-4 and VAL-5 with a real contract UUID and your director UUID; remember to `ROLLBACK`.
7. **Smoke-test the live app:** open `/claims/new` on https://convera-platform.vercel.app, fill the minimum required fields against an empty (no open claim) contract, click "حفظ كمسودة" → expect success toast (not the `integer = text` error).

If anything in steps 4-7 fails, do NOT troubleshoot live — execute the rollback in §5.

---

## 8. After-apply housekeeping

- Update `data-imports/CMH_01/08_migration/sections/execution_checklist.csv` only if 049 was applied to STAGING (this note is for production; staging has its own checklist row marked `pending`).
- Update `docs/low_effort_improvement_backlog.md` to move the C1 item from "Today" to "Done — applied 2026-05-10" (or whenever).
- Consider scheduling a follow-up to map `ITEM_NO_INVALID` to a polished Arabic message in `app/api/claims/create/route.ts` (out of 049's scope).
- Apply the same migration to the staging project (`jrqkzwacerdudmeacvar`) once staging is unblocked from the section-09 defect.

---

## 9. Approval phrase

To proceed with applying Migration 049 to **production** (`ngwxlockzkjpmzuvgakx`), reply with the exact phrase:

> **APPROVE-049-PROD**

Anything else — including "yes", "go ahead", "approved", or any rephrasing — will be treated as not-approved and the orchestrator will not run the apply. The phrase is intentionally specific to make the production action unambiguous.

If you want to apply 049 to STAGING first (recommended once staging is unblocked), reply with:

> **APPROVE-049-STAGING**

If you want me to write an automated apply script (Node + `pg` over a `STAGING_DB_URL` env, with prod-ref refusal) instead of driving Studio manually, reply:

> **WRITE-049-APPLY-SCRIPT**

---

*See also: `platform_safety_findings.md` for the broader safety context, `low_effort_improvement_backlog.md` item C1 for the backlog reference, and `final_approver_role_drift_review.md` for the related schema-drift work.*
