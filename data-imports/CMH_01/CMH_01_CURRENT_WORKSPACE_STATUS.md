# CMH_01 — Current Workspace Status

> **Date:** 2026-05-10
> **Refresh after:** prior phases complete (May 5–7), Auth Admin support issue open (today), staging schema apply paused at section 09.
> **Source folder (READ-ONLY):** `C:\Users\Administrator\Desktop\CONVERA\PROJECTS\CMH_01`
> **Working folder (writable):** `C:\Users\Administrator\Desktop\convera-platform\data-imports\CMH_01`
> **Target production database:** Supabase project ref `ngwxlockzkjpmzuvgakx` (CONVERA / main · PRODUCTION)

---

## 1. Source folder inventory (read-only, not modified)

### Top-level structure
```
CMH_01/
├── 01_CONTRACT/          ← contract docs + bid documents (PDFs)
├── 02_BOQ/               ← Bill of Quantities (BOQ.xlsx + PDFs)
├── 03_VO/                ← 5 Variation Orders (PDFs + numbered VO_REHQ files)
├── 04_PAYMENTS/          ← 22 payment claims (المستخلصات 01–22)
├── 05_APPROVALS/         ← disbursement approvals
├── 06_CERTIFICATES/      ← completion certificates (auto-generated)
├── 07_CORRESPONDENCE/    ← memos and meeting minutes
├── 08_TEMPLATES/         ← project-specific templates
├── 09_REPORTS_OUT/       ← exported reports
├── _ETL/                 ← project-side Python migrate/validate scripts
├── CMH_01_SMART.xlsx     ⭐ 842 KB master workbook (v5)
└── README.md
```

### Counts
- **243 PDFs** (contract, VO, payments, approvals, certificates, correspondence)
- **213 XLSX** (BOQ, SMART, templates, snapshots, reports)
- **45 DOCX** + 20 PPTX + 11 MD + 5 PY + 4 DB + 1 JSON
- **Total size:** ~1.8 GB on disk
- **22 claim PDFs** under `04_PAYMENTS/المستخلص NN.pdf` (NN = 01..22)

### SMART workbook header (from `README.md`)
- **Auto-generated item codes** in the form `CMH_01-{discipline}-{seq}` (e.g. `CMH_01-FF-001`)
- **12 disciplines:** Architecture (A/C), Mechanical (ME/HV/PL), Electrical (EE/LV), Safety (FF), other (FUN/LS/SUP/OT)
- **6-stage workflow:** المقاول ← المكتب الاستشاري ← التدقيق ← الجودة ← مدير المشروع ← المعتمد النهائي. **Matches** production's current `claim_status` enum (under_supervisor_review → under_auditor_review → under_quality_review → under_project_manager_review → pending_director_approval / under final approver) — see also production schema findings 2026-05-10.
- **10% governance limit** computed from VAT-inclusive total
- **Movement log** tracking every stage transition
- **External identifiers** for safe platform import

### Source folder NOT modified by this assessment
Confirmed via `stat -c '%y'` on top-level directories — all folder mtimes are May 4–10 (pre-existing). No write was performed by the orchestrator.

---

## 2. Prepared workspace inventory (`convera-platform/data-imports/CMH_01/`)

| Phase folder | Status | Files of note |
|---|---|---|
| `00_inventory/` | ✓ complete | F1 recovery checklist + report, file_inventory.csv (548 rows) |
| `01_classification/` | ✓ complete | document_classification.csv (548 rows) |
| `02_extraction/` | ✓ complete | 10 raw_*.json files — see counts table below |
| `03_normalized/` | ✓ complete | 17 CSV/JSON files: contract.json, boq_items.csv, claims.csv, claim_line_items.csv, claim_documents.csv, approvals.csv, certificates.csv, cumulative_item_progress.csv |
| `04_validation/` | ✓ complete | 10 reconciliation reports incl. attachment_existence_report.md, claims_reconciliation.md, BOQ reconciliation, fidelity_assessment.md, claim_15 investigation |
| `05_import_plan/` | ✓ complete | api_payload_examples.json, controlled_migration_runbook.md, entity_mapping.md, import_sequence.md, phase8_approval_gate.md, pre_migration_checklist.md, rollback_strategy.md |
| `06_dry_run/` | ✓ complete | dry_run_payloads.json (full payload), dry_run_errors.json, dry_run_validation_matrix.csv, dry_run_report.md, readiness_decision.md |
| `07_backup/` | empty | reserved for operator-side production backups before --execute |
| `08_migration/` | ✓ complete | EXECUTIVE_SUMMARY.md, OPERATOR_HANDOVER.md, STAGING_SETUP_REQUIRED.md, api_compatibility_matrix.md, legacy_vs_current_inventory.md, migration_log.md, plus the staging-bundle subfolder + scratch dirs |
| `09_ui_verification/` | empty | reserved for post-import UI smoke screenshots |

### Extracted record counts (from raw_*.json files)
| Asset | Records | Source |
|---|---:|---|
| Contract masters | **1** | SMART workbook (raw_contracts.json) |
| Stakeholders / users | **6** | raw_stakeholders.json |
| BOQ items | **386** | raw_boq_items.json |
| Variation orders | **5** | raw_change_orders.json (matches 5 VO PDFs) |
| VO line items | **603** | raw_change_order_items.json |
| Claims | **21** | raw_claims.json (20 monthly + 1 final) |
| Claim line items | **1 562** | raw_claim_items.json |
| Attachments | 70 invoices + 40 approvals + 35 certificates | raw_attachments.json |
| Workflow log entries | **89** | raw_workflow_log.json |

Note: `raw_*.json` files report **7 records** each on `Object.keys(d).length` — that count reflects the wrapper object's top-level keys (e.g. `metadata`, `summary`, `items`, etc.), not the inner record count. Inner record counts above are from `08_migration/EXECUTIVE_SUMMARY.md` §1.

### Latest known prior decisions / blockers

From `06_dry_run/readiness_decision.md` (May 6) and `08_migration/EXECUTIVE_SUMMARY.md` (May 6):

- All 7 prior phases **PASSED**: inventory, classification, extraction, normalization, validation (P0=0), import plan, dry-run.
- Migration was **paused at the staging-first gate** by policy: "Phase 8 must run against staging first, never directly against production."
- That policy gate was based on the staging environment plan that has since been blocked at section 09 of the staging-schema-bundle (defect: `''::uuid` predicate in `migrations/010_user_contracts.sql` — see `data-imports/CMH_01/08_migration/sections/SCHEMA_SECTION_EXECUTION_REPORT.md`).
- Operator's instruction (today, 2026-05-10): proceed with **production migration preparation directly**, no staging needed.

### Existing controlled importer

`scripts/import-cmh01-controlled.js` exists in the active repo (referenced in `data-imports/CMH_01/08_migration/phase8_script_alignment_report.md`). It has:
- env validation
- secret masking for logs
- support for <server-side secret key>*/<publishable key>* AND legacy JWT
- per-stage transaction safety
- but is configured against `STAGING_DB_URL`, not production

A new script `scripts/import-cmh01-production-controlled.js` will be created in Phase 6 specifically targeting production with hard guards.

---

## 3. Cross-cutting blockers (today's environment)

| Blocker | Impact on this migration | Workaround |
|---|---|---|
| **Auth Admin /admin/users HTTP 500** (open Supabase support ticket — `error_id 019e1205-…`) | The CMH_01 stakeholders (6 users) need to map to existing platform users. **We do NOT need to create any auth.users — only map.** Cross-check against production's `profiles` and `convera_users` tables (read-only) is sufficient. | If a CMH_01 stakeholder has no matching `profiles` row → mark as `BLOCKED_USER_MAPPING`, do NOT create. Operator decides whether to skip that contract role assignment or pause the import. |
| **Staging schema apply paused at section 09** (`''::uuid` defect) | Staging would have been the rehearsal target. With operator approval to skip staging, this no longer blocks but is documented for completeness. | N/A for this migration. Address staging defect as separate work. |
| **Migration 049 not yet applied to production** | Production's `create_claim_with_items_atomic` RPC has the integer-vs-text cast bug. **The CMH_01 importer can avoid the RPC entirely by inserting via the table-level API.** | Use direct INSERT into `claims` + `claim_boq_items` + `claim_staff_items` instead of the broken RPC. Document in import plan §5. |
| **`final_approver` enum drift (TS code vs prod enum)** | The CMH_01 stakeholder mapping uses ContractRole values — production's `contract_role` enum has `final_approver` correctly. Code-side TS drift does not block SQL inserts. | No-op for this migration. |
| **`fayez@gdc.com` missing `public.profiles` row** | This user exists in `auth.users` but not `profiles`. **Not in the CMH_01 stakeholder list per `raw_stakeholders.json`** — should not block CMH_01 import. | No action needed for CMH_01. Separate backfill SQL prepared at `docs/patches/backfill_fayez_profile.sql` (gated). |

---

## 4. Is the project ready for dry-run?

**Yes — for production-targeted dry-run.** All inputs exist, all prior validations passed, no new gating defect was introduced.

- ✅ Source validated end-to-end (Phase 5 fidelity check: P0=0)
- ✅ Normalized data complete (all 9 entity types extracted)
- ✅ Dry-run payloads generated previously (`06_dry_run/dry_run_payloads.json`)
- ⚠ Need to **refresh** the dry-run against the current production schema (which has changed since May 6: `claim_kind` + `claim_number` columns are present, `contract_role` enum has the 8 values, `user_contract_roles` table exists)
- ⚠ Need to **refresh user mapping** against current `profiles` table content (today)

**For production --execute:** still NO. Production-side dry-run + duplicate-check + operator approval phrase still required. See `CMH_01_PRODUCTION_MIGRATION_READINESS_REPORT.md` (Phase 7 output).

---

## 5. Confirmations

- ✅ **No source files modified.** The CMH_01 source folder under `CONVERA\PROJECTS\CMH_01` is treated read-only.
- ✅ **No production data mutated.** No INSERTs, UPDATEs, DELETEs, ALTERs, DROPs, TRUNCATEs run by this assessment.
- ✅ **Auth.users not touched.**
- ✅ **No git push** by orchestrator.
- ✅ **No secrets exposed** in this report.

---

*Companion docs: `04_validation/CMH_01_source_validation_refresh.md` (Phase 2), `04_validation/CMH_01_production_duplicate_check.md` (Phase 3), `05_import_plan/CMH_01_production_import_plan.md` (Phase 4), `06_dry_run/CMH_01_production_dry_run_report.md` (Phase 5), `08_migration/CMH_01_production_controlled_import_runbook.md` (Phase 6), `CMH_01_PRODUCTION_MIGRATION_READINESS_REPORT.md` (Phase 7 — final).*
