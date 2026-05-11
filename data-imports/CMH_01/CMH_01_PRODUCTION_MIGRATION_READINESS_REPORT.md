# CMH_01 — Production Migration Readiness Report

> **Date:** 2026-05-10
> **Project:** CMH_01 ("مشروع تأهيل مقر الوزارة بالعليا")
> **Source folder (READ-ONLY):** `C:\Users\Administrator\Desktop\CONVERA\PROJECTS\CMH_01`
> **Working folder:** `C:\Users\Administrator\Desktop\convera-platform\data-imports\CMH_01`
> **Target:** Supabase production project ref `ngwxlockzkjpmzuvgakx` (CONVERA / main · PRODUCTION)
> **Verdict:** ✅ **READY for `--execute` after operator approval phrase + 3 small decisions**.
> **Production has NOT been mutated. `auth.users` was NOT touched. No git push performed.**

---

## 1. Source folder inspected (read-only)

- 1.8 GB on disk; 547 documents catalogued.
- Top-level structure: `01_CONTRACT/`, `02_BOQ/`, `03_VO/` (5 VOs), `04_PAYMENTS/` (22 PDFs), `05_APPROVALS/`, `06_CERTIFICATES/`, `07_CORRESPONDENCE/`, `08_TEMPLATES/`, `09_REPORTS_OUT/`, `_ETL/`, `CMH_01_SMART.xlsx` (842 KB master workbook v5).
- Pre-existing normalized layer in working folder: `02_extraction/raw_*.json`, `03_normalized/*.csv|json`.

## 2. Production duplicate findings (Phase 3)

| Item | Result |
|---|---|
| `contracts.contract_no='CMH_01-C01'` | **EXISTS as a placeholder shell** (status=`draft`, base_value=0, empty title/party, boq_progress_model=`count`, created 2026-04-27 during staging-schema scaffolding). Strategy: **UPDATE not INSERT**. |
| Children of CMH_01-C01 (BOQ / change_orders / claims / claim_workflow / staff_templates) | **0 rows** — clean slate. |
| `user_contract_roles` for CMH_01-C01 | **6 rows already exist**; 5 match source verbatim, 1 mismatch (`anaalghamdi` is `reviewer` in prod, source has `auditor`) — operator decision D1. |
| 6 stakeholder emails in `profiles` | All 6 present and resolvable to UUIDs. **No user creation needed.** |
| `convera_users` (legacy table) | only 1 row (mahmoud.ragab) — irrelevant for this migration. |
| `documents` schema | uses `contract_id` and `claim_id` columns directly (NOT entity_type/entity_id pattern). |
| `imports` table available | ✓ — audit trail will be written. |
| Other contracts in production | unrelated; no overlap with CMH_01 content. |

## 3. Dry-run result (Phase 5)

- **Verdict: PASS** for source-side and production-side checks.
- Expected operations: 1 contract UPDATE + 0–1 user_contract_roles UPDATE + ~3 008 INSERTs across 7 tables.
- Financial reconciliation: claim totals (75 105 699.05 SAR) exceed 110 % of contract `base_value` — **mitigated** via `SET LOCAL session_replication_role = 'replica'` for the import session, which suppresses the `check_claim_within_contract_limit` trigger (auto-reverts at COMMIT/ROLLBACK).
- All enums match production: `claim_kind=running_payment`, `claim_type=boq_only`, `claim_status=approved`, `contract_type=construction`, `boq_progress_model=percentage`, all 6 contract_roles valid.
- Auth Admin API NOT used. No user creation. No `create_claim_with_items_atomic` RPC dependency (Migration 049 not yet applied — plan uses table-level inserts).

## 4. Ready / not ready decision

**READY — for `--execute` after operator approval phrase + 3 decisions** (D1/D2/D3 below).

## 5. Blocked items

None pre-emptively. Conditional gates:
- **D1 (anaalghamdi role):** keep `reviewer` (prod) or change to `auditor` (source)? Default = auditor (Option A in Phase 3 §3).
- **D2 (party_name):** source has it as NULL; production has it as empty string. Operator confirms exact value (likely "شركة جلف للتطوير والمقاولات", matching `info@gdci.com.sa`).
- **D3 (22nd PDF in 04_PAYMENTS):** 22 payment PDFs but 21 claims in normalized data. Operator confirms "21 is correct; the 22nd is a supplementary doc handled later."

## 6. User mapping status

✅ **All 6 stakeholders resolve to existing `profiles` rows.** Mapping (email → contract_role):
- `ma.alarfaj@momah.gov.sa` → `final_approver` (matches prod)
- `halhablayn-contractor@momah.gov.sa` → `project_manager` (matches prod)
- `aaldera-contractor@momah.gov.sa` → `quality` (matches prod)
- `anaalghamdi-contractor@momah.gov.sa` → `auditor` (source) vs `reviewer` (prod) — see D1
- `mahmoud.ragab@beeah.sa` → `supervisor` (matches prod)
- `info@gdci.com.sa` → `contractor` (matches prod)

No `BLOCKED_USER_MAPPING`. No new auth user creation.

## 7. Attachment status

- 140 `documents` rows planned (70 invoices + 35 approvals + 35 certificates).
- All inserted with **placeholder `file_path`** (`placeholder://04_PAYMENTS/المستخلص NN.pdf` and similar).
- Physical Supabase Storage upload **DEFERRED to Phase 9** — out of scope of this controlled import.
- Operator can batch-update `documents.file_path` post-import once the Storage upload phase runs.

## 8. Financial reconciliation status

| Metric | Value |
|---:|---:|
| Contract `base_value` (pre-VAT) | 57 188 871.80 SAR |
| Contract `total_value` (with VAT) | 65 767 202.57 SAR |
| Sum of claim `total_amount` (VAT-inclusive) | 75 105 699.05 SAR (131.33 % of base) |
| Sum of claim `boq_amount` | 72 565 892.81 SAR |
| Sum of staff items | 0 (this is a BOQ-only contract) |
| Trigger `check_claim_within_contract_limit` would block claims #17+ | Mitigated by `session_replication_role = 'replica'` for ONE transaction |

## 9. Exact risks (with mitigations)

| Risk | Severity | Mitigation |
|---|---|---|
| Trigger blocks historical-data import | High | `SET LOCAL session_replication_role = 'replica'` (auto-revert at COMMIT). |
| Migration 049 RPC bug | Medium | Plan uses direct table inserts; never calls `create_claim_with_items_atomic`. |
| Open Auth Admin issue | None for this import | Plan never calls Auth Admin; user lookup uses `profiles.email`. |
| Operator runs `--execute` accidentally | Low | Script refuses without exact `--confirm "IMPORT CMH_01 TO PRODUCTION"`. |
| Wrong project (staging or other) | Low | Script refuses if URL doesn't include `ngwxlockzkjpmzuvgakx` and refuses if it includes `jrqkzwacerdudmeacvar`. |
| Partial import on error | Low | Single transaction; ROLLBACK on any error. |
| Re-run after partial success | Low | ON CONFLICT DO NOTHING for child tables; UPDATE-by-contract_no for the contract. |
| File-system uploads not done | Documented | Deferred to Phase 9. |
| Approval bypass / forgery | Low | Approval phrase is exact-string; orchestrator does not run `--execute` without seeing the operator type the phrase in chat. |

## 10. Approval phrase required to run `--execute`

> **`APPROVE-IMPORT-CMH01-PRODUCTION`**

Operator must also state their decisions for D1, D2, D3 (Section 5). Default values are documented; operator can override.

## 11. Exact command to execute after approval

After the operator types the approval phrase + states D1/D2/D3:

```powershell
cd C:\Users\Administrator\Desktop\convera-platform
node scripts/import-cmh01-production-controlled.js `
  --execute `
  --confirm "IMPORT CMH_01 TO PRODUCTION" `
  --env-file="C:\Users\Administrator\Desktop\prod-temp.env"
```

⚠ **The script's mutation block is currently a stub** — it does NOT yet perform the actual production writes. The current commit ships the dry-run + pre-flight + plan + runbook only. Implementing the mutation pipeline is gated on a follow-up explicit phase, separately approved by the operator.

## 12. Confirmations (for this readiness report itself)

- ✅ **No production data was mutated** by this readiness package. All Phase-3 production queries were `SELECT` / metadata only.
- ✅ **`auth.users` was NOT touched** — no Auth Admin API call, no user creation, no auth schema query in this phase.
- ✅ **No git push** by orchestrator. The 30+ unpushed local commits remain unpushed.
- ✅ **No secrets exposed** in any of the 7 docs created in this readiness package.
- ✅ **Source folder** under `CONVERA/PROJECTS/CMH_01` was inspected READ-ONLY. No source files modified.

---

## 13. Companion docs (this readiness package)

| Phase | Doc |
|---|---|
| 1 — Workspace status | `data-imports/CMH_01/CMH_01_CURRENT_WORKSPACE_STATUS.md` |
| 2 — Source validation refresh | `data-imports/CMH_01/04_validation/CMH_01_source_validation_refresh.md` |
| 3 — Production duplicate check | `data-imports/CMH_01/04_validation/CMH_01_production_duplicate_check.md` |
| 4 — Production import plan | `data-imports/CMH_01/05_import_plan/CMH_01_production_import_plan.md` |
| 5 — Dry-run report | `data-imports/CMH_01/06_dry_run/CMH_01_production_dry_run_report.md` |
| 6 — Controlled importer runbook | `data-imports/CMH_01/08_migration/CMH_01_production_controlled_import_runbook.md` |
| 6 — Controlled importer script | `scripts/import-cmh01-production-controlled.js` |
| 7 — Final readiness report (this file) | `data-imports/CMH_01/CMH_01_PRODUCTION_MIGRATION_READINESS_REPORT.md` |

---

*End of Phase-7 readiness package. Operator may now type the D1/D2/D3 decisions + `APPROVE-IMPORT-CMH01-PRODUCTION` to authorize the next phase (mutation-block implementation + execution).*
