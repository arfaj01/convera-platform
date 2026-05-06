# CMH_01 — Controlled Migration Runbook (operator-driven; Phase 8)

> Each step is an operator action. The migration script automates each step but pauses for ENTER between every claim.

## Pre-flight (operator host)
1. `cd C:\Users\Administrator\Desktop\convera-platform`
2. `git pull` (ensure HEAD includes the Phases 1-7 commits + IAM-1..IAM-4).
3. `npm run verify:repo-path && npx tsc --noEmit && npm run build` — all green.
4. `node scripts/iam-diagnostics-d1-d6.js` (or paste `SQL/diagnostics/iam_user_health.sql` into Supabase SQL Editor) — all checks pass.
5. Confirm `.env.local` has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + auth credentials for the operator user.
6. Take backups (per pre_migration_checklist.md).

## Run
1. `node scripts/import-cmh01-controlled.js --dry-run` — verify Phase 7 dry-run is clean.
2. `node scripts/import-cmh01-controlled.js --confirm "PROCEED CMH_01"` — runs each step with operator confirmation.

## Per-claim transition flow

For each claim seq 1 … 21:

1. **POST /api/claims/create** with the payload from `dry_run_payloads.json`.
2. Capture the returned `claim_id` + `claim_number`.
3. Walk the workflow:
   - **POST /api/claims/transition** action=submit (or skip if already in `under_supervisor_review`).
   - **POST /api/claims/transition** action=approve, actor_role=supervisor → `under_technical_review`.
   - … action=approve, actor_role=reviewer → `under_quality_review`.
   - … action=approve, actor_role=quality → `under_project_manager_review`.
   - … action=approve, actor_role=project_manager → `pending_director_approval`.
   - … action=approve, actor_role=final_approver → `approved`.
4. Upload attachments via `POST /api/documents` for the claim_seq:
   - `04_PAYMENTS/المستخلص NN.pdf` (invoice)
   - `05_APPROVALS/شهادة اعتماد-NN.pdf` (approval)
   - `06_CERTIFICATES/شهادة انجاز-NN.pdf` (completion certificate)
5. Verify the claim is in `approved` status.
6. Run `GET /api/claims/[id]` and assert claim_number, claim_kind, work_period_*, total_amount match the normalized layer.

If any step fails, STOP and consult the rollback strategy.

## Post-flight
1. Run `validation_summary.md` checks against the live DB.
2. Compare claim totals: `SUM(total_amount) FROM claims WHERE contract_id=CMH_01` vs `SUM(claims.total_amount) FROM normalized claims.csv`. Δ < 0.01 SAR.
3. UI smoke test: `/contracts/CMH_01-C01`, `/claims`, `/workflow`, `/dashboard/executive`.
4. Generate the operational report.

## What NOT to do
- Do **not** invoke `_ETL/migrate.py` (legacy schema mapping).
- Do **not** write directly to `claims` / `claim_boq_items` from any script — always go through `/api/claims/create` (atomic RPC).
- Do **not** push the migration script's logs (they may contain claim_number values that are fine but better kept internal).
