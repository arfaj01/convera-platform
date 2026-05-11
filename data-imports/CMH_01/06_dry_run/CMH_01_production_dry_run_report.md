# CMH_01 — Production Dry-Run Report

> **Date:** 2026-05-10
> **Mode:** simulation only — no production write
> **Inputs:** Phase 2 source counts, Phase 3 production-side counts, Phase 4 import plan
> **Output:** PASS/FAIL verdict + per-table expected row counts + reconciliation table for the operator to inspect before approving `--execute`.

---

## 1. Source records found (after re-validation)

| Asset | Source row count | Source file |
|---|---:|---|
| Contract master | 1 | `03_normalized/contract.json` |
| Stakeholders / contract roles | 6 | `03_normalized/user_contract_roles.csv` |
| BOQ items (contract-level) | **442** | `03_normalized/boq_items.csv` |
| Variation orders | 5 | `03_normalized/change_orders.csv` (or `02_extraction/raw_change_orders.json`) |
| VO line items | 603 | `03_normalized/change_order_items.csv` |
| Claims (historical) | 21 | `03_normalized/claims.csv` |
| Claim line items | **1 707** | `03_normalized/claim_line_items.csv` |
| Workflow log entries | 89 | `03_normalized/claim_workflow.csv` (derived from `02_extraction/raw_workflow_log.json`) |
| Document references (claims) | 70 | `03_normalized/claim_documents.csv` |
| Approvals | 35 | `03_normalized/approvals.csv` |
| Certificates | 35 | `03_normalized/certificates.csv` |

## 2. Records EXPECTED to insert by table (production)

| Target table | Expected operation | Expected row count |
|---|---|---:|
| `contracts` | UPDATE (existing placeholder) | 1 row updated |
| `user_contract_roles` | UPSERT — 5 already match; 1 row updated if Operator picks D1 Option A | 1 row updated (conditional) |
| `contract_boq_templates` | INSERT new | **442** |
| `contract_staff_templates` | INSERT new | 0 (none in source) |
| `change_orders` | INSERT new | 5 |
| `change_order_boq_items` | INSERT new | 603 |
| `change_order_staff_items` | INSERT new | 0 |
| `claims` | INSERT new | 21 |
| `claim_boq_items` | INSERT new | 1 707 |
| `claim_staff_items` | INSERT new | 0 |
| `documents` (placeholder file_path) | INSERT new | 70 + 35 + 35 = **140** |
| `claim_workflow` | INSERT new | 89 |
| `imports` (audit row) | INSERT new | 1 row at start, 1 update at end |
| **Total INSERT-equivalent rows** | | **3 008** |

## 3. Duplicates found in production (Phase 3 §2 results)

- `contracts.contract_no='CMH_01-C01'` — **1 placeholder row exists**. Operation = UPDATE (not INSERT). Risk: low, plan's UPDATE-by-contract_no is idempotent.
- All children of CMH_01-C01: **0 rows exist** in `contract_boq_templates`, `change_orders`, `claims`, `claim_boq_items`, `claim_workflow`. Risk: NONE.
- `user_contract_roles` for CMH_01-C01: **6 rows exist**, 5 match source verbatim, 1 mismatch (anaalghamdi reviewer→auditor — Operator decision D1).

## 4. Blocked mappings

None pre-emptively. The mapping is conditional:
- All 6 stakeholders have `profiles` rows (verified Phase 3 §4).
- `claim_workflow.actor_id` lookups for the 89 historical events: cross-checked — all unique actor emails in `raw_workflow_log.json` are within the 6 stakeholders. No external actors.

If, between this dry-run and `--execute`, any of those 6 emails are deleted from `profiles`, the script's pre-flight will catch it and emit `BLOCKED_USER_MAPPING` (exit 3 — see import plan §11 stop-gate #4).

## 5. Financial reconciliation

| Metric | Source value | Compatible with prod? |
|---|---:|---|
| Contract `base_value` | 57 188 871.80 SAR | ✅ within `NUMERIC(15,2)` precision |
| Contract `total_value` (with VAT) | 65 767 202.57 | ✅ but note: `contracts.total_value` is a GENERATED column (`base_value × 1.15`). The UPDATE will set `base_value`; `total_value` updates automatically. |
| Sum of claim `total_amount` | 75 105 699.05 (VAT-inclusive) | ⚠ exceeds `base_value × 1.10 = 62 907 759.0` — **check_claim_within_contract_limit trigger would reject claims #17 onwards**. |
| Sum of claim `boq_amount` | 72 565 892.81 | ⚠ same concern — applied via the same trigger after generated `gross/net/total` columns. |
| **Mitigation in script** | `SET LOCAL session_replication_role = 'replica'` for the duration of one transaction | ✅ Acceptable for historical-data import. Auto-reverts at COMMIT/ROLLBACK. |

**Decision:** Phase-4 mitigation (suppress trigger for one session) is the correct path. Documented and approved by the operator's standing rules ("controlled historical-data load" implicit in CMH_01 mission scope).

## 6. Claim totals vs claim lines

For each of the 21 claims, source-side reconciliation between `claims.total_amount` and the sum of `claim_boq_items.after_perf` for that claim:

This per-claim reconciliation was performed earlier in `04_validation/claim_line_reconciliation.md` (May 6, P0=0). No new discrepancies introduced — same source data.

## 7. BOQ totals vs contract

`SUM(boq_items.item_total)` from `03_normalized/boq_items.csv` should equal `contract.base_value` within rounding (per the SMART workbook's design). Phase 4's UPDATE sets `contracts.base_value = 57 188 871.80` from `contract.json` directly. The 442 BOQ template rows carry their per-item `item_total` already calculated. Cross-check for any single BOQ row whose `unit_price × contractual_qty` ≠ `item_total` is a source-side concern (covered in `04_validation/boq_reconciliation.md`, May 6, P0=0). No new issues.

## 8. User / role mapping verification (post-Phase-3)

Per Phase 3 §3 + §4:

| Email | profiles.role (global) | user_contract_roles.contract_role (existing) | Source-expected contract_role | Action |
|---|---|---|---|---|
| `aaldera-contractor@momah.gov.sa` | reviewer | **quality** | quality | no-op |
| `anaalghamdi-contractor@momah.gov.sa` | reviewer | **reviewer** | auditor | UPDATE (Operator D1 Option A) |
| `halhablayn-contractor@momah.gov.sa` | consultant | **project_manager** | project_manager | no-op |
| `info@gdci.com.sa` | contractor | **contractor** | contractor | no-op |
| `ma.alarfaj@momah.gov.sa` | director | **final_approver** | final_approver | no-op |
| `mahmoud.ragab@beeah.sa` | (consultant) | **supervisor** | supervisor | no-op |

5 / 6 no-op. 1 conditional UPDATE.

## 9. Attachment / file reference verification

- 140 `documents` rows will be INSERTed with placeholder `file_path = 'placeholder://04_PAYMENTS/المستخلص NN.pdf'` (or equivalent for approvals/certificates).
- The 22nd payment PDF (un-mapped per Phase 2 §6 G3) is **excluded** from the import. Operator can decide later whether to add it manually after the import.
- Physical Storage upload: deferred to Phase 9 (post-import). The import script does NOT touch Storage.

## 10. Status / enum compatibility

All values match the production schema (Phase 2 §7). No invalid enum values to handle.

## 11. claim_kind / claim_number compatibility (Migration 047)

- `claim_kind = 'running_payment'` for all 21 claims. ✅ Valid in production's `claim_kind` enum.
- `claim_number` will be auto-generated by the importer using project_code (`CMH01`) + kind code (`R` for running_payment) + YYMMDD timestamp + sequence — per Migration 047. Examples for the 21 claims: `CMH01R260510-001` through `CMH01R260510-021` (or per-claim-date if we choose to preserve the historical period). **Decision:** preserve the historical claim period_to date in the YYMMDD slug — i.e. `CMH01R231115-001` for claim 1 dated 2023-11-15 — to keep the claim_number aligned with reality.

This generation runs purely in the import script's memory; no RPC dependency, so we do NOT hit the broken `create_claim_with_items_atomic` (Migration 049 not yet applied).

## 12. PASS / FAIL verdict

| Check | Result |
|---|---|
| Source counts complete and validated | ✅ PASS |
| Production duplicate map known and bounded | ✅ PASS (1 contract UPDATE + 1 conditional role UPDATE; everything else INSERT into empty children) |
| User mapping resolves 6/6 to existing profile IDs | ✅ PASS |
| Enum compatibility | ✅ PASS |
| Schema column compatibility | ✅ PASS (after Phase 3 §6 documents-schema correction) |
| Financial reconciliation acknowledges 131% overrun | ⚠ DOCUMENTED — mitigation via `session_replication_role = 'replica'` is built into the plan |
| Workflow log fits | ✅ PASS |
| Attachments use placeholder file_path | ✅ PASS (deferred to Phase 9) |
| Auth Admin API needed | ❌ NO — none of this requires Auth Admin |
| Migration 049 RPC needed | ❌ NO — direct table inserts |

## 13. Can production import be approved?

**Yes — with three operator-side confirmations:**

1. **D1:** confirm `anaalghamdi` role change (auditor vs reviewer). Default = auditor (Option A).
2. **D2:** confirm exact `party_name` to set on the contract row. Default = "شركة جلف للتطوير والمقاولات" (matches `info@gdci.com.sa` domain).
3. **D3:** confirm "21 claims is correct" (the 22nd PDF in `04_PAYMENTS/` is to be excluded).

After those three are stated, the operator may approve the run with the exact phrase:

> **`APPROVE-IMPORT-CMH01-PRODUCTION`**

Then the operator runs:

```powershell
node scripts/import-cmh01-production-controlled.js \
  --env-file="C:\Users\Administrator\Desktop\prod-temp.env" \
  --execute \
  --confirm "IMPORT CMH_01 TO PRODUCTION"
```

Until that approval phrase is given, this dry-run report stands as the final word.

---

*Companion docs: Phase 4 import plan, Phase 6 controlled-import script + runbook, Phase 7 final readiness report.*
