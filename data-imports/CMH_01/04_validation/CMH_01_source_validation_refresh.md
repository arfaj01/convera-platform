# CMH_01 — Source Validation Refresh (production-targeted)

> **Date:** 2026-05-10
> **Inputs:** read-only source folder + previously normalized CSV/JSON layer
> **Output of this phase:** an authoritative set of counts and reconciliation findings that the import plan (Phase 4) and dry-run (Phase 5) build on.

This refresh re-verifies the pre-existing normalized data against the source folder and documents any discrepancies that must be resolved before production import.

---

## 1. Contract master (1 row)

| Field | Value | Source |
|---|---|---|
| `contract_no` | `CMH_01-C01` | normalized; matches SMART workbook ContractCode |
| `project_code` | `CMH01` | normalized; used for claim_number prefix per Migration 047 |
| `title_ar` | "مشروع تأهيل مقر الوزارة بالعليا" | normalized |
| `type` | `construction` | matches `contract_type` enum |
| `base_value` (pre-VAT) | **57,188,871.80** SAR | normalized |
| `vat_value` (computed) | 8,578,330.77 (15 %) | derived |
| `total_value` (with VAT) | **65,767,202.57** SAR | normalized + matches `base*1.15` within rounding |
| `retention_pct` | (not yet set in normalized — defaults to `5.00`) | — |
| `start_date` | 2022-11-08 | normalized |
| `end_date` | 2024-02-01 | normalized |
| `duration_months` | 14 | normalized |
| `region` | not set in normalized (`undefined`) | **GAP** — see §6 |
| `boq_progress_model` | `percentage` | normalized |
| `party_name` | **NULL** | **GAP** — see §6 |

---

## 2. Stakeholders (6 users, all 6 already exist in production `auth.users`)

| Email | Contract role | Source row |
|---|---|---|
| `ma.alarfaj@momah.gov.sa` | `final_approver` | المستخدمون · row 2 |
| `halhablayn-contractor@momah.gov.sa` | `project_manager` | row 3 |
| `aaldera-contractor@momah.gov.sa` | `quality` | row 4 |
| `anaalghamdi-contractor@momah.gov.sa` | `auditor` | row 5 |
| `mahmoud.ragab@beeah.sa` | `supervisor` | row 6 |
| `info@gdci.com.sa` | `contractor` | row 7 |

All six values are valid `contract_role` enum members in production (production has 8: `contractor, supervisor, auditor, reviewer, viewer, project_manager, quality, final_approver`). All six emails were observed in production's `auth.users` list earlier today. **Phase 3 will confirm `public.profiles` matches.**

---

## 3. BOQ items

`03_normalized/boq_items.csv` → **442 contract line items** (header + 442 data rows = 443 file lines).

Discrepancy with prior `08_migration/EXECUTIVE_SUMMARY.md` (May 6) which stated 386: the normalized CSV has been refined since the executive summary was written — likely additional rows reclassified during validation. The CSV count is authoritative.

**Notable columns:** `contract_no, item_no, description_ar, description, discipline, unit, unit_price, contractual_qty, item_total, progress_model, progress_model_source_ar, item_code, discipline_code, item_kind, source_sheet, source_row, source_file, extraction_method, confidence_level, data_quality_notes`.

`item_code` follows the `CMH_01-{discipline}-{seq}` convention (e.g. `CMH_01-FF-001` for fire-fighting items). `item_no` is the integer column referenced by `claim_boq_items.item_no` (INTEGER) per Migration 047.

---

## 4. Claims (21 historical claims, all approved)

`03_normalized/claims.csv` → **21 claims** (header + 21 data rows). All carry the same status set:

| Field | Distinct values |
|---|---|
| `claim_kind` | `running_payment` (all 21) |
| `claim_type` | `boq_only` (all 21) |
| `status` | `approved` (all 21) |
| `staff_amount` | `0` for all (this contract has no staff line items — pure BOQ) |

### Per-claim totals (VAT-inclusive)

| seq | total (SAR) | seq | total (SAR) |
|---:|---:|---:|---:|
| 1 | 665,742.87 | 12 | 1,633,056.72 |
| 2 | 574,479.28 | 13 | 1,691,416.23 |
| 3 | 1,376,633.35 | 14 | 5,616,376.95 |
| 4 | 784,876.73 | 15 | 10,000,000.00 |
| 5 | 3,167,178.78 | 16 | 4,900,286.16 |
| 6 | 1,579,125.39 | 17 | 11,183,486.68 |
| 7 | 3,006,494.68 | 18 | 8,625,172.21 |
| 8 | 4,232,574.19 | 19 | 3,794,851.82 |
| 9 | 1,959,968.73 | 20 | 3,719,834.12 |
| 10 | 1,771,238.93 | 21 | 714,288.44 |
| 11 | 4,108,616.79 | | |

**Sum of all claim total_amount = 75,105,699.05 SAR** (VAT-inclusive)
**Sum of all claim boq_amount = 72,565,892.81 SAR** (VAT-inclusive net of retention etc.)

### 🚨 Financial reconciliation finding — claims exceed 10 % governance limit

| Metric | Value |
|---:|---:|
| Contract `base_value` (pre-VAT) | 57,188,871.80 |
| Contract `total_value` (with VAT) | 65,767,202.57 |
| 10 % governance ceiling on `base_value` | 62,907,759.0 |
| Sum of approved claim `total_amount` (with VAT) | **75,105,699.05** |
| Coverage as % of `base_value` | **131.33 %** |
| Coverage as % of `total_value` (with VAT) | **114.20 %** |

The historical claims **legitimately exceed** the platform's `check_claim_within_contract_limit` trigger (Migration 001) which rejects any approved claim whose cumulative total exceeds `base_value × 1.10`. This is normal for a real-world construction project that ran 14 months with 5 approved variation orders — but **the trigger will reject ~claim 17 onwards** during a naive import.

**Mitigation in import plan (Phase 4 §5):**
- Either suppress the trigger for the import session (`SET LOCAL session_replication_role = 'replica';` requires service_role; ONE session, ONE transaction, restored to `'origin'` at end).
- OR import all claims at `status = 'closed'` with the trigger's WHERE-clause carefully read: production trigger inspects `status IN ('approved','closed')` so this does not help unless the trigger predicate is itself reviewed.
- **Decision (recommended):** import historical claims using `session_replication_role = 'replica'` for the duration of one transaction, with explicit logging that the trigger was suppressed. Trigger restoration is automatic at COMMIT/ROLLBACK because `SET LOCAL` is transaction-scoped.

---

## 5. Claim line items (1 707 rows)

`03_normalized/claim_line_items.csv` → 1 707 data rows.

Discrepancy with prior `EXECUTIVE_SUMMARY.md` ("1 562"): same explanation as BOQ — the normalized CSV was refined.

Average lines per claim: 1 707 / 21 ≈ **81 line items per claim**, consistent with a 442-line BOQ where most items carry progress in most claims.

---

## 6. Identified gaps and open questions

| # | Gap | Severity | Resolution before Phase 5 dry-run |
|---|---|---|---|
| G1 | `contracts.party_name` is NULL in normalized data | Medium | Confirm with operator: should be the contractor company name, e.g. "شركة جلف للتطوير والمقاولات" (matching `info@gdci.com.sa`). Backfill in Phase 4 import payload from `convera_users` lookup if available. |
| G2 | `contracts.region` is undefined | Low | Derive from contract docs or default to `'الرياض'` (project is "بالعليا" — Riyadh). Confirm with operator. |
| G3 | 22 payment PDFs in `04_PAYMENTS/` but only 21 claims in `claims.csv` | Medium | One PDF is likely a supplementary document (revised invoice, withdrawal, or final-claim duplicate). Operator to identify; do NOT auto-import. |
| G4 | Claim totals (75.1 M) exceed 10 % governance limit (62.9 M) | High | Resolved in §4 — import via `session_replication_role = 'replica'` for the session. |
| G5 | BOQ count (442) differs from EXECUTIVE_SUMMARY (386) | Low | The CSV count is authoritative; old summary outdated. Note in readiness report. |
| G6 | claim_line_items count (1 707) differs from EXECUTIVE_SUMMARY (1 562) | Low | Same as G5. |
| G7 | `retention_pct` not populated in normalized contract.json | Medium | Defaults to `5.00` per platform convention. Confirm operator wants 5 % (KSA standard) or 0 % (some MoMaH contracts waive retention). |
| G8 | None of the claims show `retention_amount` separately in normalized CSV summary | Low | Normalized data carries `total_amount` (with VAT). Per-claim retention is implicit; can be reconstructed from `boq_amount × retention_pct / 100`. Decision in Phase 4. |

---

## 7. Status / enum compatibility (production)

| Source value | Production enum | Compatible? |
|---|---|---|
| `claim_kind = 'running_payment'` | `claim_kind` enum (`running_payment, final_payment, advance_payment`) | ✅ |
| `claim_type = 'boq_only'` | `claim_type` (`boq_only, staff_only, mixed, supervision`) | ✅ |
| `status = 'approved'` | `claim_status` enum | ✅ |
| `contract_type = 'construction'` | `contract_type` enum (`design, supervision, design_supervision, construction, consultancy, maintenance`) | ✅ |
| `boq_progress_model = 'percentage'` | `boq_progress_model` enum (`count, percentage, monthly_lump_sum`) | ✅ |
| stakeholder `contract_role` (6 distinct) | `contract_role` enum (8 values) | ✅ — all 6 source values are subset of prod enum |

No enum mismatches. No source value lacks a production target.

---

## 8. Attachment / file reference validation

`03_normalized/claim_documents.csv` → **70 rows** (header + 70).
The `04_validation/attachment_existence_report.md` (May 6) reports the matching against actual files in `04_PAYMENTS/`, `05_APPROVALS/`, `06_CERTIFICATES/`. That report should be re-read by the operator for spot-checks; this refresh assumes it remains valid (no source files modified since May 6).

For production import, attachment file uploads to Supabase Storage are out of scope of this phase. The plan in Phase 4 will note: import claim records with `documents` rows pointing to **placeholder** `file_path` values; physical files will be uploaded in a separate Phase 9 ("Storage upload").

---

## 9. Confirmations

- ✅ Source folder `CONVERA\PROJECTS\CMH_01` was inspected READ-ONLY.
- ✅ No production data accessed in this phase (only the normalized CSV/JSON layer — Phase 3 handles production-side checks).
- ✅ All counts and totals computed from existing normalized files; no data re-extracted from source.
- ✅ No INSERT/UPDATE/DELETE/etc. of any kind anywhere.

---

*Companion docs: `04_validation/CMH_01_production_duplicate_check.md` (Phase 3 — production-side checks), `05_import_plan/CMH_01_production_import_plan.md` (Phase 4 — uses these counts as inputs).*
