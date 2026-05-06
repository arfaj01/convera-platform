# CMH_01 — Phase 5 Reconciliation Report (Umbrella)

> Generated 2026-05-05. Cross-references the 13 specialised reports in this folder.

## Specialised reports
- `contract_value_reconciliation.md`
- `boq_reconciliation.md`
- `claims_reconciliation.md`
- `claim_line_reconciliation.md`
- `vo_reconciliation.md`
- `workflow_reconciliation.md`
- `attachment_existence_report.md`
- `duplicate_detection_report.md`
- `missing_fields_report.md`
- `fidelity_assessment.md`
- `readiness_scorecard.md`
- `validation_findings.csv` (machine-readable)

## Counts at a glance

| Entity | Normalized count | Reconciliation result |
|---|---:|---|
| Contract master | 1 | ✅ values reconcile |
| Parties | 3 | ✅ |
| Users | 6 | ✅ |
| User-contract roles | 6 | ✅ all roles in canonical enum |
| BOQ items | 386 | ✅ |
| Claims | 21 | ✅ |
| Claim line items | 1562 | aggregated |
| Variation orders | 5 | aggregated |
| VO items | 603 | aggregated |
| Workflow log | 1 | sparse (expected) |
| Claim documents (invoices) | 70 | 67/145 matched in source folders |
| Approvals | 40 | included in attachment match |
| Completion certificates | 35 | included in attachment match |
| Cumulative item progress | 386 | aggregated |

## Findings summary
- P0: 0
- P1: 2
- P2: 1

## Verdict: ✅ READY for Phase 6 + 7 + 8 approval workflow
