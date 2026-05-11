# CMH_01 Production Controlled Import — Runbook

> **Date:** 2026-05-10
> **Script:** `scripts/import-cmh01-production-controlled.js`
> **Mode:** dry-run by default; `--execute` is gated by `--confirm` phrase + production-ref enforcement
> **Status:** dry-run logic complete; the actual mutation pipeline is intentionally a stub pending operator approval phrase. Mutation must NOT be implemented unilaterally — operator may approve a follow-up phase to fill in the mutation block once they've reviewed this runbook end-to-end.

---

## 1. Prerequisites

- ✅ Operator has read `data-imports/CMH_01/05_import_plan/CMH_01_production_import_plan.md` end-to-end.
- ✅ Operator has read `data-imports/CMH_01/06_dry_run/CMH_01_production_dry_run_report.md` and accepts the verdict + the three D1/D2/D3 decisions.
- ✅ Operator has a working `prod-temp.env` file at `C:\Users\Administrator\Desktop\prod-temp.env` (OUTSIDE the repo) with:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://ngwxlockzkjpmzuvgakx.supabase.co
  SUPABASE_URL=https://ngwxlockzkjpmzuvgakx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<a valid <server-side secret key>* OR legacy service_role JWT for production>
  ```
- ✅ Production database is healthy (no maintenance window in progress).
- ✅ A pre-import database backup has been taken (Supabase dashboard → Database → Backups → "Take a manual backup"). Note the backup ID.

## 2. Env requirements (the script's pre-flight)

| Var | Required? | Validation |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL` | ✓ | must include `ngwxlockzkjpmzuvgakx`; must NOT include `jrqkzwacerdudmeacvar` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | length ≥ 20; not placeholder |

If `--env-file=PATH` is passed, the file at PATH is loaded FIRST (overrides `.env.local`). The path must resolve OUTSIDE the repo or the script aborts.

## 3. Dry-run command (always run this first)

```powershell
cd C:\Users\Administrator\Desktop\convera-platform
node scripts/import-cmh01-production-controlled.js `
  --dry-run `
  --env-file="C:\Users\Administrator\Desktop\prod-temp.env"
```

Expected output (final lines):
```
[1/8] Loading source data …  (counts shown)
[2/8] Resolving 6 stakeholder profile IDs …  (6 ✓ lines)
[3/8] Pre-flight: CMH_01-C01 placeholder presence …  (✓ found)
[4/8] Pre-flight: confirm zero existing CMH_01 children …  (3 × ✓ rows: 0)
[5/8] Plan summary  (counts to be inserted)
[6/8] DRY-RUN — no rows written.
[7/8] Verdict: PASS (dry-run)
```

**If any pre-flight FAILS, STOP**. Do not retry without diagnosing.

## 4. Execute command (only after operator approval)

⚠ Do NOT run this until the operator types `APPROVE-IMPORT-CMH01-PRODUCTION` in chat.

```powershell
node scripts/import-cmh01-production-controlled.js `
  --execute `
  --confirm "IMPORT CMH_01 TO PRODUCTION" `
  --env-file="C:\Users\Administrator\Desktop\prod-temp.env"
```

The script enforces:
- Exact `--confirm` phrase (case-sensitive, exact spaces).
- `SUPABASE_URL` MUST contain `ngwxlockzkjpmzuvgakx`.
- `SUPABASE_URL` MUST NOT contain `jrqkzwacerdudmeacvar`.

## 5. Approval phrase

Operator MUST type the EXACT phrase below in chat to authorize the `--execute`:

> **`APPROVE-IMPORT-CMH01-PRODUCTION`**

Anything else is treated as not-approved.

## 6. Rollback plan (post-COMMIT manual undo, last resort only)

⚠ Apply only with operator approval after a failure that left production in an inconsistent state.

```sql
BEGIN;
DELETE FROM claim_workflow      WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
DELETE FROM documents           WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01') OR claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
DELETE FROM claim_boq_items     WHERE claim_id IN (SELECT id FROM claims WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
DELETE FROM claims              WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
DELETE FROM change_order_boq_items WHERE change_order_id IN (SELECT id FROM change_orders WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01'));
DELETE FROM change_orders       WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
DELETE FROM contract_boq_templates WHERE contract_id=(SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
UPDATE contracts SET base_value=0, total_value=0, status='draft', start_date=NULL, end_date=NULL,
       party_name='', title_ar='', boq_progress_model='count'
 WHERE contract_no='CMH_01-C01';
-- user_contract_roles intentionally untouched (they pre-existed).
COMMIT;
```

## 7. Validation queries — run after `--execute` succeeds

(See `data-imports/CMH_01/05_import_plan/CMH_01_production_import_plan.md` §10 for the exact queries: Q-VAL-1 through Q-VAL-4.)

Quick smoke check:
```sql
SELECT contract_no, status, base_value, total_value,
       (SELECT COUNT(*) FROM claims WHERE contract_id = c.id) AS claims_count,
       (SELECT COUNT(*) FROM contract_boq_templates WHERE contract_id = c.id) AS boq_count
FROM contracts c WHERE contract_no='CMH_01-C01';
```
Expected: `status` = active or closed; `base_value` = 57188871.80; `claims_count` = 21; `boq_count` = 442.

## 8. Stop conditions

| # | Stop trigger | Required action |
|---|---|---|
| S1 | Pre-flight `BLOCKED_USER_MAPPING` (one of the 6 emails missing from profiles) | abort; do NOT proceed without operator decision |
| S2 | `CMH_01-C01` placeholder not found | abort; operator must seed the placeholder first |
| S3 | Any CMH_01 child already has rows (BOQ / claims / change_orders) | abort; operator must reconcile the existing rows |
| S4 | `--confirm` phrase wrong | abort |
| S5 | `SUPABASE_URL` does NOT contain `ngwxlockzkjpmzuvgakx` | abort |
| S6 | `SUPABASE_URL` contains `jrqkzwacerdudmeacvar` | abort |
| S7 | Mid-transaction error (any insert/update fails) | ROLLBACK + alert |
| S8 | Post-COMMIT validation row counts mismatch | DO NOT auto-rollback; alert operator immediately |

## 9. Known gaps in the current script (intentional)

The script is a **dry-run-complete skeleton**. The actual mutation block (steps 4-13 in the import plan §3) is NOT implemented in this commit. It is intentionally left as a stub that exits with `setExit(2)` if `--execute` is requested. Reasons:

- Operator-side review of the runbook + import plan must come first.
- Once approved, a follow-up phase implements the SQL-or-supabase-js mutation pipeline within a single transaction with `SET LOCAL session_replication_role = 'replica'`.
- That implementation phase is itself approval-gated by the same `APPROVE-IMPORT-CMH01-PRODUCTION` phrase.

## 10. Confirmations

- ✅ Script never queries `auth.users`, never calls Auth Admin API, never creates auth users.
- ✅ Script refuses any project ref except production.
- ✅ Script refuses `--execute` without exact `--confirm` phrase.
- ✅ Default mode is dry-run; mutation requires explicit flags.
- ✅ Script never prints secret values.

---

*Companion docs: Phase 4 import plan, Phase 5 dry-run report, Phase 7 final readiness report.*
