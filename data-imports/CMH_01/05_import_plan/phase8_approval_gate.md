# CMH_01 — Phase 8 Approval Gate

> Phase 8 (controlled migration with database writes) is gated. Until the operator provides the **exact approval statement** below, no scripts run, no API calls, no SQL.

## Required operator approval statement

To authorize Phase 8 of the CMH_01 data migration, the operator must respond with the following EXACT text (copy verbatim):

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

## Until approval is received

| Action | Status |
|---|---|
| Database writes | 🚫 BLOCKED |
| `_ETL/migrate.py` invocation | 🚫 FORBIDDEN |
| Direct SQL on auth.* schema | 🚫 FORBIDDEN |
| Push to origin/main | 🚫 BLOCKED |
| Phase 7 dry-run (read-only) | ✅ ALLOWED |
| Documentation updates | ✅ ALLOWED |

## Once approval is received

The operator runs:
```
node scripts/import-cmh01-controlled.js --confirm "PROCEED CMH_01"
```

The script logs every action to `data-imports/CMH_01/08_migration/migration_log.md` and writes a per-claim result to `migration_results.json`. After completion, Phase 9 (platform UI verification) and Phase 10 (final report) follow per the original brief.

## Rollback if approval is received but migration fails

See `rollback_strategy.md`. The decision tree:
1. Capture exact error + claim_seq + step.
2. Pause migration script (ENTER prompt between claims allows safe stop).
3. Roll back the failed claim's row only (via PATCH or compensating transition); leave previously-imported claims intact.
4. Investigate. Resume only after the cause is fixed and validated against this checklist again.
