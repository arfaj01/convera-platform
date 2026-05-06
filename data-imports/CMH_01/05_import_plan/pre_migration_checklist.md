# CMH_01 — Pre-Migration Checklist

> Operator confirms each item before the controlled migration runs. Any unchecked item blocks Phase 8.

## Database state
- [ ] Migrations 045 + 046 + 047 + 048 + 049 + 050 confirmed applied (run VAL-1 of each).
- [ ] `pg_get_functiondef('public.create_claim_with_items_atomic')` contains `v_item_no_raw` (Migration 049 invariant).
- [ ] `pg_get_functiondef('public.create_claim_with_items_atomic')` does NOT contain `::claim_type` (Migration 050 invariant).
- [ ] `user_contract_roles` UNIQUE constraint references the 3-tuple (user_id, contract_id, contract_role).
- [ ] `lib/claim-number.ts::resolveProjectCode('CMH_01-C01')` returns `'CMH01'`.

## Application state
- [ ] Application bundle built from `≥ HEAD-after-Phase-7-commits`.
- [ ] IAM-1 + IAM-2 + IAM-3 + IAM-4 deployed (multi-role + admin-API + workflow-page fixes).
- [ ] S1 deployed (UI surfaces API errors).

## Backups (Phase 7 of operator brief — required before Phase 8 writes)
- [ ] Snapshot of `contracts` table for CMH_01-C01.
- [ ] Snapshot of `claims` table for contract_id=CMH_01.
- [ ] Snapshot of `documents` table for any pre-existing CMH_01 attachments.
- [ ] Snapshot of `user_contract_roles` for the 6 stakeholders.

## Identity
- [ ] All 6 stakeholders have valid auth.users + auth.identities + email_confirmed_at (run D1/D2/D3 from `iam_user_health.sql`).
- [ ] Each stakeholder's profile.role and contract_role match the values in normalized users.csv + user_contract_roles.csv.

## Data review
- [ ] `validation_summary.md` shows zero P0 blockers.
- [ ] `attachment_existence_report.md` reviewed; numeric-token match strategy approved.
- [ ] Any P1 finding has a documented mitigation or operator acceptance.

## Approvals
- [ ] Operator has signed `phase8_approval_gate.md` with the exact approval statement.
- [ ] Push to staging is approved.
- [ ] DB write window is reserved.
