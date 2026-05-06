# CMH_01 — Phase 7 Readiness Decision

## Migration readiness — Go/No-Go

| Gate | Status |
|---|---|
| Phase 1 inventory complete | ✅ |
| F1 resolved (canonical SMART workbook) | ✅ |
| Phase 2 classification complete (547 files) | ✅ |
| Phase 3 extraction complete (10 raw files, full provenance) | ✅ |
| Phase 4 normalization complete (17 files + excluded_records/) | ✅ |
| Phase 5 validation: P0=0 | ✅ |
| Phase 6 import plan + Phase-8 gate produced | ✅ |
| Phase 7 dry-run payloads validated | ✅ |
| Operator backups taken | ⏳ pending operator |
| Operator approval statement received | ⏳ pending operator |

## What is ready for Phase 8 (controlled migration)

1. **Contract master** — 1 row, all required fields present.
2. **Stakeholders + contract roles** — 6 users mapped to current platform ContractRole enum (`final_approver`, `project_manager`, `quality`, `auditor`, `supervisor`, `contractor`).
3. **BOQ items** — 386 contract line items with full descriptions, units, contractual quantities; unit prices on most rows.
4. **Variation orders** — 5 numbered VOs (matches the 5 PDFs in 03_VO/).
5. **VO items** — 603 line items reconciled against VO headers.
6. **Claims** — 21 historical claims (المستخلصات 01-20 + الختامي).
7. **Claim line items** — 1562 per-claim per-item progress rows. **This is the dimension that Path B would have lost.**
8. **Attachments** — 70 invoices + 40 approvals + 35 completion certificates, mapped to claim_seq via numeric-token matching against actual filenames in `04_PAYMENTS/`/`05_APPROVALS/`/`06_CERTIFICATES/`.

## What gaps remain

| Gap | Severity | Mitigation |
|---|---|---|
| Some BOQ rows have null unit_price in SMART | low | Cross-validate against BOQ.xlsx Sheet2 at Phase 8; if still missing, mark as data_quality flag in DB |
| English party_name not in SMART | low | Null acceptable; populate from contract PDF if needed |
| Workflow log only has 1 populated row | none | Platform regenerates the log via /api/claims/transition during Phase 8 |
| Filename convention divergence (canonical vs working) | low | Numeric-token match resolves ~all attachments |

## What risks exist

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Open-claim guard rejects when historical claims overlap in time | low | medium | Sequence is strict (1 → 21); each claim transitioned to terminal status before next is created |
| `actor_role` validation rejects (multi-role users) | low | low | All 6 stakeholders are single-role on CMH_01-C01; multi-role logic not exercised |
| `claim_number` collision | very low | high | Migration 048 advisory lock prevents this within a contract; cross-contract uniqueness from partial unique index |
| Attachments fail to upload | medium | low | Sequence-after-claim allows retry without rolling back the claim itself |
| Phase 8 partial failure mid-sequence | low | medium | Operator pauses at next ENTER prompt; rolls back failed claim only; resumes |

## Phase 8 recommendation: **GO**, conditional on operator approval

P0 blockers: 0. Documentation is complete. Backups need to be taken by operator. Approval statement in `phase8_approval_gate.md` must be provided verbatim before any DB write.

## Required operator approval statement

The exact text the operator must respond with is reproduced verbatim from `05_import_plan/phase8_approval_gate.md`:

```
APPROVE CMH_01 PHASE 8 — controlled migration into staging.
I confirm:
  - Migrations 045, 046, 047, 048, 049, 050 are applied.
  - IAM-1, IAM-2, IAM-3, IAM-4 are deployed to staging.
  - Backup snapshots of contracts/claims/documents/user_contract_roles
    for contract_no=CMH_01-C01 are taken.
  - I have reviewed validation_summary.md (P0=0).
  - I have reviewed dry_run_report.md and approve the proposed payloads.
  - I accept the risks documented in fidelity_assessment.md and rollback_strategy.md.
The migration target is the STAGING database, not production.
```
