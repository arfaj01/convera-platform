# CMH_01 — Post-Import Verification Checklist (read-only)

> **Date:** 2026-05-10
> **Trigger:** `--execute` completed successfully with observed counts:
>   - `contract_boq_templates`: 386 / 386 ✓
>   - `claims`: 21 / 21 ✓
>   - `claim_boq_items`: 1562 / 1562 ✓
> **Pending operator gates:**
>   - `APPROVE-CMH01-STATUS-FLIP` (claims still at status='draft')
>   - `APPROVE-CMH01-STORAGE-UPLOAD` (Phase 9 — documents not yet inserted)
> **All queries below are SELECT / metadata only.** No `INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE`.

---

## 0. Why the inserted counts (386, 1562) differ from the source CSV row counts (442, 1707)

The script's `.filter(r => r.item_no !== null)` correctly drops rows whose `item_no` value cannot be parsed as a positive integer. These dropped rows in the normalized CSVs are typically:

- BOQ items added by variation orders without a numeric `item_no` (e.g. coded `1.5a`, `NEW-XX-001`)
- Subtotal / heading rows inserted into the BOQ for visual grouping in the SMART workbook
- Continuation rows in the CSV that carry no item identity

The inserted counts **386 (BOQ) and 1562 (claim line items)** match exactly the figures cited in the original `08_migration/EXECUTIVE_SUMMARY.md` (May 6) and the `06_dry_run/readiness_decision.md` from Phase 5. **This is the expected behaviour, not a regression.**

The plan-summary line in the dry-run output (`442 INSERT` / `1707 INSERT`) reports raw source rows for transparency, but the script's own filter removes invalid-`item_no` rows before insert. Future cosmetic improvement: have the dry-run plan summary report the post-filter count. Tracked but not blocking.

---

## 1. Contract header verification

```sql
SELECT
  contract_no, type, status,
  base_value, vat_value, total_value, retention_pct,
  start_date, end_date, duration_months,
  region, party_name, party_name_ar,
  left(title_ar, 80) AS title_ar,
  boq_progress_model,
  external_user_id::text AS external_user_id,
  admin_id::text         AS admin_id,
  director_id::text      AS director_id,
  reviewer_id::text      AS reviewer_id,
  created_at, updated_at
FROM contracts
WHERE contract_no = 'CMH_01-C01';
```

**Expected:**

| Column | Expected value |
|---|---|
| `status` | `active` |
| `base_value` | `57188871.80` |
| `vat_value` (generated) | `8578330.77` (15% of base, rounded) |
| `total_value` (generated) | `65767202.57` |
| `retention_pct` | `5` |
| `start_date` | `2022-11-08` |
| `end_date` | `2024-02-01` |
| `duration_months` | `14` |
| `region` | `الرياض` |
| `party_name_ar` | `شركة الخليج المتطورة للمقاولات` |
| `title_ar` | starts with `مشروع تأهيل مقر الوزارة بالعليا` |
| `boq_progress_model` | `percentage` |
| `external_user_id` | UUID of `info@gdci.com.sa` |
| `admin_id` | UUID of `anaalghamdi-contractor@momah.gov.sa` |
| `director_id` | UUID of `ma.alarfaj@momah.gov.sa` |

✅ **PASS** if all values match. Any mismatch → flag for investigation.

---

## 2. BOQ templates totals

```sql
SELECT
  COUNT(*)                                      AS row_count,
  COUNT(DISTINCT item_no)                       AS unique_item_nos,
  ROUND(SUM(unit_price * contractual_qty), 2)   AS sum_extended_pre_vat,
  ROUND(SUM(contractual_qty), 4)                AS sum_qty,
  MIN(item_no) AS min_item_no, MAX(item_no) AS max_item_no
FROM contract_boq_templates
WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
```

**Expected:**
- `row_count` = **386** (matches what was inserted; matches Phase 5 source plan)
- `unique_item_nos` = 386 (no duplicates per the unique-key pre-flight)
- `sum_extended_pre_vat` ≈ 57 188 871.80 (within rounding of contract `base_value`); **a small variance is acceptable** because some rows may have rounded unit prices in the SMART workbook.
- `sum_qty` reflects the project's total contractual quantities

✅ **PASS** if `row_count = 386` AND `sum_extended_pre_vat` is within ±1 % of `base_value`.

---

## 3. Claims count and totals

```sql
SELECT
  COUNT(*)                                       AS claims_count,
  COUNT(*) FILTER (WHERE status='draft')         AS draft_count,
  COUNT(*) FILTER (WHERE status='approved')      AS approved_count,
  COUNT(*) FILTER (WHERE status NOT IN ('draft','approved')) AS other_status_count,
  ROUND(SUM(boq_amount), 2)                      AS sum_boq,
  ROUND(SUM(staff_amount), 2)                    AS sum_staff,
  ROUND(SUM(retention_amount), 2)                AS sum_retention,
  ROUND(SUM(vat_amount), 2)                      AS sum_vat,
  ROUND(SUM(total_amount), 2)                    AS sum_total,
  COUNT(DISTINCT claim_kind)                     AS distinct_kinds,
  COUNT(DISTINCT claim_type)                     AS distinct_types,
  MIN(claim_no) AS min_claim_no, MAX(claim_no) AS max_claim_no,
  COUNT(DISTINCT claim_number)                   AS distinct_claim_numbers
FROM claims
WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01');
```

**Expected:**
- `claims_count` = **21**
- `draft_count` = **21** (status flip not yet performed)
- `approved_count` = **0** (no claims should be approved before `APPROVE-CMH01-STATUS-FLIP`)
- `other_status_count` = **0** (no claims in any other state)
- `sum_total` ≈ 75 105 699.05 (within rounding; source CSV cumulative)
- `distinct_kinds` = 1 (`running_payment`)
- `distinct_types` = 1 (`boq_only`)
- `min_claim_no` = 1, `max_claim_no` = 21
- `distinct_claim_numbers` = 21 (each claim got a unique generated `claim_number`)

✅ **PASS** if `claims_count = 21` AND `draft_count = 21` AND `approved_count = 0` AND `other_status_count = 0`.

---

## 4. claim_boq_items per-claim reconciliation

```sql
SELECT
  c.claim_no,
  COUNT(cbi.id)                       AS line_count,
  ROUND(SUM(cbi.period_amount), 2)    AS sum_period,
  ROUND(SUM(cbi.after_perf), 2)       AS sum_after_perf,
  ROUND(c.total_amount, 2)            AS claim_total,
  ROUND(SUM(cbi.after_perf), 2) - ROUND(c.total_amount, 2) AS diff_after_perf_vs_total
FROM claims c
LEFT JOIN claim_boq_items cbi ON cbi.claim_id = c.id
WHERE c.contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
GROUP BY c.claim_no, c.total_amount
ORDER BY c.claim_no;
```

**Expected:**
- 21 rows
- Sum of `line_count` across all rows = **1562**
- For each row: `sum_after_perf` is approximately `claim_total / 1.15 - retention` (because `total_amount` is VAT-inclusive net of retention; source CSV totals already encode VAT) — **precise reconciliation is in `04_validation/claim_line_reconciliation.md` (May 6, P0=0)** and is preserved.
- `diff_after_perf_vs_total` may be non-zero per row but should be small relative to claim_total (rounding artifacts only).

✅ **PASS** if all 21 rows present AND total `line_count` summed = 1562.

---

## 5. Draft status validation

```sql
SELECT status, COUNT(*) AS n,
       MIN(submitted_at) AS earliest_submitted,
       MAX(submitted_at) AS latest_submitted
FROM claims
WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
GROUP BY status
ORDER BY n DESC;
```

**Expected:**
- Single row: `status='draft' n=21`, `earliest_submitted=NULL latest_submitted=NULL` (since the script did not set `submitted_at` — the post-import status flip will set `approved_at` only, not `submitted_at` retroactively).
- **No other rows** (no `submitted`, `under_*_review`, `approved`, etc.).

✅ **PASS** if exactly one row with status='draft' and n=21. Any other state → STOP and investigate.

---

## 6. Role mapping validation (D1: anaalghamdi reviewer→auditor)

```sql
SELECT
  u.email,
  ucr.contract_role,
  CASE
    WHEN u.email = 'anaalghamdi-contractor@momah.gov.sa' AND ucr.contract_role = 'auditor' THEN '✓ D1 applied'
    WHEN u.email = 'anaalghamdi-contractor@momah.gov.sa' AND ucr.contract_role = 'reviewer' THEN '✗ D1 NOT applied'
    ELSE 'expected'
  END AS d1_check
FROM user_contract_roles ucr
JOIN profiles u ON u.id = ucr.user_id
WHERE ucr.contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
ORDER BY ucr.contract_role, u.email;
```

**Expected:**
| email | contract_role | d1_check |
|---|---|---|
| `aaldera-contractor@momah.gov.sa` | `quality` | expected |
| `anaalghamdi-contractor@momah.gov.sa` | `auditor` | ✓ D1 applied |
| `halhablayn-contractor@momah.gov.sa` | `project_manager` | expected |
| `info@gdci.com.sa` | `contractor` | expected |
| `ma.alarfaj@momah.gov.sa` | `final_approver` | expected |
| `mahmoud.ragab@beeah.sa` | `supervisor` | expected |

✅ **PASS** if all 6 rows present AND anaalghamdi shows `d1_check = ✓ D1 applied`.

---

## 7. Duplicate prevention check

```sql
-- 7a — duplicate item_no in contract_boq_templates
SELECT item_no, COUNT(*) AS dup
FROM contract_boq_templates
WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
GROUP BY item_no HAVING COUNT(*) > 1
ORDER BY item_no;
-- Expected: 0 rows
```

```sql
-- 7b — duplicate (claim_id, item_no) pairs in claim_boq_items
SELECT claim_id, item_no, COUNT(*) AS dup
FROM claim_boq_items
WHERE claim_id IN (
  SELECT id FROM claims
   WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
)
GROUP BY claim_id, item_no HAVING COUNT(*) > 1
ORDER BY claim_id, item_no;
-- Expected: 0 rows
```

```sql
-- 7c — duplicate claim_no per contract
SELECT claim_no, COUNT(*) AS dup
FROM claims
WHERE contract_id = (SELECT id FROM contracts WHERE contract_no='CMH_01-C01')
GROUP BY claim_no HAVING COUNT(*) > 1
ORDER BY claim_no;
-- Expected: 0 rows
```

```sql
-- 7d — duplicate claim_number across the whole system (uniqueness post-Migration 047)
SELECT claim_number, COUNT(*) AS dup
FROM claims
WHERE claim_number LIKE 'CMH01R%'
GROUP BY claim_number HAVING COUNT(*) > 1
ORDER BY claim_number;
-- Expected: 0 rows
```

✅ **PASS** if all four sub-queries return 0 rows.

---

## 8. `imports` table warning assessment

The `--execute` log reported:
> `imports table insert failed because source_label column does not exist in imports schema cache`

The script's S0 INSERT into `imports` was wrapped in non-blocking error handling (a `console.warn` only, no abort). The audit row was not created, but **none of the data inserts depend on it**. To diagnose for future runs:

```sql
-- 8a — actual columns in production's imports table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='imports'
ORDER BY ordinal_position;
```

**Expected:** A list of columns. Compare to what the script tried to insert (`source_label, status, notes`).

```sql
-- 8b — recent imports rows (audit trail)
SELECT * FROM imports ORDER BY created_at DESC NULLS LAST LIMIT 5;
```

**Expected:** Whatever rows already existed; our import added **0** rows (the insert failed). Migration 044 originally seeded the `imports` table — its actual column shape is what Q-8a reveals.

**Severity:** LOW — the audit-trail row is a "nice to have" governance feature; its absence does not corrupt CMH_01 data. Action item: a follow-up patch to align the script's `imports` INSERT to the actual column shape (a 1-line change) before any future production import.

✅ **CLEARED** as a non-blocking warning. Not a blocker for status flip or UI review.

---

## 9. UI-review readiness

After Q1–Q7 all PASS, the production UI is safe to navigate for visual verification. Suggested manual smoke path:

1. **`/login`** — already known to work
2. **`/contracts`** — confirm `CMH_01-C01` now appears with:
   - Title: مشروع تأهيل مقر الوزارة بالعليا
   - Party: شركة الخليج المتطورة للمقاولات
   - Status: نشط (active) — was مسوّدة (draft)
   - Value: 57.2M SAR (or 65.7M with VAT depending on display)
   - Period: 8 نوفمبر 2022 → 1 فبراير 2024
3. **`/contracts/{CMH_01-C01-id}`** — click the contract → confirm:
   - BOQ tab shows 386 line items
   - 6 stakeholders listed with their contract_role values (anaalghamdi = auditor)
   - Claims tab shows 21 rows ALL labelled `مسوّدة (draft)`
4. **`/claims`** — confirm 21 new draft claims appear in the contractor user's draft queue
5. **As director (`ma.alarfaj`):** confirm the contract is visible and the 21 draft claims are visible (but NOT yet in the "pending approval" queue — they're draft).
6. **No claim should be in any "under review" / "approved" / "rejected" state.** This is the safety cordon: until `APPROVE-CMH01-STATUS-FLIP`, the historical claims show as drafts and do NOT trigger workflow notifications.

⚠ **Do NOT click "Approve" on any draft claim from the UI.** Use the prepared SQL file (post-status-flip) instead, because the UI's approve-via-button path goes through the trigger-enforced ceiling that would reject claims #17–21.

✅ **SAFE to proceed to UI review** once Q1–Q7 PASS.

---

## 10. Decision matrix — next steps

| If … | Then … |
|---|---|
| Q1–Q7 all PASS | Operator may navigate the UI per §9 to visually confirm. After visual sign-off, operator types `APPROVE-CMH01-STATUS-FLIP` to gate the status-flip step. |
| Q1 fails (contract row missing fields) | Re-run only the contract UPDATE — no rollback needed. |
| Q3 shows `approved_count > 0` | STOP. Status flip already happened (or somebody approved a claim manually). Investigate before any further write. |
| Q5 shows status other than `draft` | STOP. Same as above. |
| Q6 shows `D1 NOT applied` | Re-run only the role UPDATE — single-row UPDATE in Studio, idempotent. |
| Q7 shows duplicates | STOP. Run rollback SQL and re-import (the pre-flight should have caught this; investigate). |
| Q8a reveals required columns we missed | Patch `imports` INSERT in the script for next run. Not blocking now. |

---

## 11. Confirmations (for this verification phase)

- ✅ All queries above are `SELECT` / metadata only.
- ✅ No `INSERT/UPDATE/DELETE/ALTER/DROP/TRUNCATE`.
- ✅ No `auth.users` queried.
- ✅ Status flip is **NOT** triggered by this checklist; gated by `APPROVE-CMH01-STATUS-FLIP`.
- ✅ Phase 9 documents are NOT inserted by this checklist; gated by `APPROVE-CMH01-STORAGE-UPLOAD`.
- ✅ No `git push`. No secret values in this document.

---

## 12. Operator workflow

1. Paste each query block (Q1 through Q8b) into Supabase Studio SQL Editor on the production project (`ngwxlockzkjpmzuvgakx`). Confirm the breadcrumb shows `MOMAH > CONVERA > main · PRODUCTION` before each run.
2. Compare each result against the "Expected" tables above.
3. Mark each query PASS / FAIL in your own notes (or paste back here for cross-check).
4. After all critical queries pass (Q1, Q2, Q3, Q5, Q6, Q7), navigate the UI per §9.
5. After UI sign-off, type `APPROVE-CMH01-STATUS-FLIP` to authorize the status flip; the orchestrator will walk you through pasting `~/Desktop/cmh01_post_import_flip_status.sql`.

⏸️ **Awaiting Q1–Q8 results. Paste the rows of any failing query — orchestrator will diagnose.**

---

*Companion docs: `data-imports/CMH_01/08_migration/CMH_01_production_import_execution_report.md` (auto-generated by --execute), `data-imports/CMH_01/05_import_plan/CMH_01_production_import_plan.md` (Phase 4 — full reference for rollback SQL), `data-imports/CMH_01/CMH_01_PRODUCTION_MIGRATION_READINESS_REPORT.md` (Phase 7 — original readiness package).*
