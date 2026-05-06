# CMH_01 — Phase 3 Extraction Notes

> **Date:** 2026-05-05
> **Source workbook:** `data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx`
> **Output:** ten `raw_*.json` files in this folder, each carrying a provenance envelope.

---

## 1. Provenance contract

Every `raw_*.json` file carries the same envelope structure:

```json
{
  "_extracted_at":     "<ISO timestamp>",
  "_source_workbook":  "data-imports/CMH_01/00_inventory/source-snapshot/CMH_01_SMART.xlsx",
  "_source_sheet":     "<Arabic sheet name>",
  "_header_row":       <int>,
  "_record_count":     <int>,
  "_filter":           null | "<predicate description>",
  "records":           [ … ]
}
```

Each record carries `_src_row` and `_src_sheet` so every value can be traced back to the SMART workbook cell that produced it.

---

## 2. Files produced

| File | Source sheet | Header row | Records | Notes |
|---|---|---:|---:|---|
| `raw_contracts.json` | `العقد` | 1 | 1 | Filtered to `كود العقد == 'CMH_01-C01'` (only one contract row in the workbook anyway). |
| `raw_boq_items.json` | `بنود العقد` | 1 | 387 | Filtered to BOQ items whose `كود البند (تلقائي)` starts with `CMH_01-` OR whose code is empty (template rows where the smart formula didn't fire). Includes 1 sample row at item_no=1 (`توريد وتركيب نظام إنذار حريق — مثال`) — flag during normalization. |
| `raw_claims.json` | `المطالبات` | 1 | 36 | Filtered to `كود العقد == 'CMH_01-C01'`. Some rows are sample/template; flag during normalization based on amount/period validity. |
| `raw_claim_items.json` | `بنود المطالبات` | 1 | 1804 | Per-claim per-BOQ-item progress. The single sheet covers all claims for CMH_01. |
| `raw_change_orders.json` | `أوامر التغيير` | auto-detected | 10 | The 10% governance panel occupies the top rows; header row was auto-detected. Contains 5 real VOs + 1 sample + 4 blanks. Filter zero/blank rows during normalization. |
| `raw_change_order_items.json` | `بنود أوامر التغيير` | 1 | 724 | All change-order line items. |
| `raw_stakeholders.json` | `المستخدمون` | 1 | 6 | Maps cleanly to the 6 known CMH_01 users (final_approver / project_manager / quality / auditor / consultant / contractor). |
| `raw_workflow_log.json` | `سجل الحركة` | auto-detected (likely 2) | 201 | Workflow movement log — actor / from-status / to-status / reason / timestamps. |
| `raw_attachments.json` | `سجل المرفقات` | auto-detected | 230 | Attachment log — pairs each PDF in `04_PAYMENTS/`, `05_APPROVALS/`, `06_CERTIFICATES/` to its claim record. |
| `raw_cumulative_summary.json` | `الملخص التراكمي` | 1 | 387 | Per-BOQ-item cumulative totals across all approved claims — useful for Phase-5 reconciliation. |

---

## 3. Sample-row flags to apply during Phase 4 normalization

The SMART workbook is an authoring template; some sheets carry sample rows that must NOT be migrated to the platform. Flag and exclude:

- `بنود العقد` row 2: item 1 with description containing the literal `— مثال` (sample token).
- `المطالبات` row 2: claim with `كود العقد == 'CMH_03-C01'` and amount 850000 (test fixture — already filtered out by the contract filter).
- `أوامر التغيير` row at index 0 (post-header): `مبرر` containing `— مثال`.

Phase 4 normalization will apply these filters consistently and document each excluded row in `data_mapping_report.md`.

---

## 4. Cross-validation sources (NOT extracted to raw JSON)

Per the operator directive 2026-05-05, these sources are **cross-validation only** and are not extracted to the raw layer:

- `02_BOQ/BOQ.xlsx` — Sheet "BOQ" (1419 rows). Used in Phase 5 to validate the SMART workbook's BOQ unit prices and item descriptions where the SMART value is empty.
- `09_REPORTS_OUT/.../نسب الانجاز.xlsx` — schedule-progress percentages. Used in Phase 5 to cross-check claim-line cumulative percentages.

---

## 5. What is NOT in this extraction

- **PDF content from `04_PAYMENTS/`, `05_APPROVALS/`, `06_CERTIFICATES/`** — these are evidence/attachments. Phase 4 will produce a `documents.normalized.json` that links each PDF to its claim record via the `سجل المرفقات` sheet's `اسم الملف` column.
- **Daily reports under `09_REPORTS_OUT/تقارير الاستشاري/التقارير اليومية/`** — auto-generated derivatives, not project data.
- **Templates under `08_TEMPLATES/`** — project-internal, not project data.
- **`_ETL/migrate.py`** — legacy ETL toolkit, forbidden per F1 resolution.

---

## 6. Phase 4 readiness

| Gate | Status |
|---|---|
| All priority sheets extracted with provenance envelope | ✅ |
| Sample/template rows identified for filtering | ✅ |
| Cross-validation sources logged but not consumed yet | ✅ |
| No source folder modification | ✅ |
| No DB writes / SQL execution | ✅ |
| F1 resolved (canonical workbook is primary) | ✅ |

**Phase 4 (normalization) unblocked.** Begin schema mapping to the current platform (post-Migration 050) — refreshed status/role maps, multi-role-aware contract roles, claim_kind enum, work_period_from/to, claim_number generation deferred to platform RPC at import time.
