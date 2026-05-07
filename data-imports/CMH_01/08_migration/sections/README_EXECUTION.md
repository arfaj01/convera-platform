# CMH_01 — Staging Schema Execution Package

> **Authored 2026-05-07.** Per-section split of `staging_schema_bundle.sql`
> v2.4 (commit `ce5251e`). Designed for the operator to apply each
> section in its own SQL Editor "Run" submission, in order, stopping
> immediately on the first error.

---

## ⚠ TARGET — STAGING ONLY

| | |
|---|---|
| **ALLOWED target** | Supabase project ref `jrqkzwacerdudmeacvar` (CONVERA-STAGING) |
| **FORBIDDEN target** | Supabase project ref `ngwxlockzkjpmzuvgakx` (CONVERA-PROD) |

Before pasting any file into the SQL Editor, **verify the URL bar of
your browser tab contains `jrqkzwacerdudmeacvar`**. If it contains
`ngwxlockzkjpmzuvgakx`, close the tab and switch projects. Section
`00_preflight_guard.sql` exists as a second line of defence — it raises
an exception if Postgres reports any production marker — but it is a
backup, not a substitute for visually checking the URL.

---

## How to use this folder

1. **Pre-check** — open the SQL Editor on the STAGING project and run:
   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```
   - If `0` → start with `00_preflight_guard.sql`.
   - If you previously applied STEPs 1–7 from the v2.3 attempt and the
     count is `≥ 25` → resume at `08a_009_enum_add_only.sql`. Do NOT
     re-paste the earlier sections; their `CREATE TABLE` statements
     lack `IF NOT EXISTS` and would fail.
   - Anything in between → run the optional reset (see "Reset" at the
     bottom of this README) and start fresh from `00`.
2. **Open one file at a time.** For each row in the table below, in
   order, paste the file's contents into the SQL Editor and press Run.
3. **Stop on error.** If any section fails, capture the full
   `ERROR / DETAIL / HINT / LINE` text and the section file name. Do
   NOT skip ahead. Do NOT continue to the next section.
4. **Mark progress.** Tick the row in `execution_checklist.csv` (or
   keep your own log) so we can resume safely after any pause.
5. **Run verification last.** After every section through `48` runs
   cleanly, run `99_staging_schema_verification.sql` and paste the
   row output back so we can confirm the schema is healthy before
   Phase 8 is unlocked.

---

## Execution order

| # | File | Source seq | Purpose | Row output? | Stop-on-error |
|---|---|---|---|---|---|
| 00 | `00_preflight_guard.sql` | preflight | Reject production project ref. | No | YES |
| 01 | `01_001_base_schema.sql` | 001 | Foundational base schema (extensions, 7 enums, 11 core tables, RLS, views). | No | YES |
| 02 | `02_002_step0_fixes.sql` | 002 | Step-0 fixes + Storage buckets. | No | YES |
| 03 | `03_003_change_orders_and_hardening.sql` | 003 | `change_orders`, `change_order_boq_items`, `change_order_staff_items`, workflow + RLS. | No | YES |
| 04 | `04_004_contract_templates_and_progress_models.sql` | 004 | `contract_boq_templates`, `contract_staff_templates`, `boq_progress_model` enum. | No | YES |
| 05 | `05_006_convera_users_otp.sql` | 006 | `convera_users` + OTP table. | No | YES |
| 06 | `06_007_contract_amendments_enhancement.sql` | 007 | Amendments enhancement. | No | YES |
| 07 | `07_008_invoice_attachment_governance.sql` | 008 | Invoice attachment governance. | No | YES |
| 08a | `08a_009_enum_add_only.sql` | 009 | **ENUM-ADD ONLY.** ALTER TYPE ADD VALUE for claim_status + change_order_status. Run alone. | No | YES |
| 08b | `08b_009_status_data_update.sql` | 009 | **GUARDED data UPDATEs.** Must run in a SEPARATE Run-button submission AFTER 08a (avoids PG 55P04). On fresh staging every block is a no-op. | No | YES |
| 09 | `09_010b_user_contracts.sql` | 010b | `user_contracts` (m2m). | No | YES |
| 10 | `10_011_fix_rls_returned_statuses.sql` | 011 | RLS fix for returned statuses. | No | YES |
| 11 | `11_012_fix_rls_workflow_roles.sql` | 012 | RLS fix for workflow roles. | No | YES |
| 12 | `12_013_fix_trigger_security_definer.sql` | 013 | Trigger SECURITY DEFINER fix. | No | YES |
| 13 | `13_014_db_level_transition_guard.sql` | 014 | DB-level transition guard. | No | YES |
| 14 | `14_016_update_contract_types.sql` | 016 | `contract_type` enum updates. | No | YES |
| 15 | `15_017_fix_contracts_rls_user_contracts.sql` | 017 | RLS fix for contracts/user_contracts join. | No | YES |
| 16 | `16_019_definitive_rls_scope_fix.sql` | 019 | Definitive RLS scoping. | No | YES |
| 17 | `17_020_fix_internal_role_policies.sql` | 020 | Internal-role policy fixes. | No | YES |
| 18 | `18_021_sync_auth_bans_and_verify.sql` | 021 | Auth bans sync. | No | YES |
| 19 | `19_022_fix_profiles_recursion.sql` | 022 | Profiles RLS recursion fix. | No | YES |
| 20 | `20_023_fix_contract_scoping_leaks.sql` | 023 | Plug contract-scoping leaks. | No | YES |
| 21 | `21_024_drop_contracts_auth_read_backdoor.sql` | 024 | Remove auth-read backdoor on contracts. | No | YES |
| 22 | `22_025_contract_scoped_roles.sql` | 025 | Introduce `user_contract_roles`. | No | YES |
| 23 | `23_026_rls_contract_scoped_roles.sql` | 026 | RLS for contract-scoped roles. | No | YES |
| 24 | `24_027_contract_role_browser_helpers.sql` | 027 | Browser helpers for contract roles. | No | YES |
| 25 | `25_028_add_last_transition_at.sql` | 028 | `last_transition_at` column. | No | YES |
| 26 | `26_029_contractor_withdraw_action.sql` | 029 | Contractor withdraw action. | No | YES |
| 27 | `27_030_completion_certificate_and_cancel.sql` | 030 | Completion-cert + cancel actions. | No | YES |
| 28 | `28_031_atomic_claim_submission.sql` | 031 | Predecessor atomic-submission RPC. | No | YES |
| 29 | `29_031b_fix_audit_logs_columns.sql` | 031b | `audit_logs` column fix. | No | YES |
| 30 | `30_033_fix_document_type_enum.sql` | 033 | `document_type` enum fix. | No | YES |
| 31 | `31_034_audit_helper_function.sql` | 034 | Audit helper function. | No | YES |
| 32 | `32_035_block_submitted_persist.sql` | 035 | Block submitted persistence. | No | YES |
| 33 | `33_040_flexible_approvers_and_import.sql` | 040 | Flexible approvers. | No | YES |
| 34 | `34_041_final_approver_role.sql` | 041 | `final_approver` role. | No | YES |
| 35 | `35_042_extend_enums_for_template_v7.sql` | 042 | Enum extension (full version). | No | YES |
| 36 | `36_043_data_model_hardening_SAFE.sql` | 043 | D2 hardening SAFE variant. | No | YES |
| 37 | `37_044_imports_governance.sql` | 044 | Imports governance. | No | YES |
| 38 | `38_045_contract_role_multi_assignment.sql` | 045 | 3-tuple unique invariant. | No | YES |
| 39 | `39_046_quality_and_pm_stages.sql` | 046 | Quality + project_manager workflow stages. | No | YES |
| 40 | `40_047_claim_kind_and_number.sql` | 047 | claim_kind, claim_number, partial unique. | No | YES |
| 41 | `41_048_create_claim_with_items_atomic.sql` | 048 | Atomic create RPC. | No | YES |
| 42 | `42_049_fix_claim_rpc_item_no_cast.sql` | 049 | RPC item_no cast fix. | No | YES |
| 43 | `43_050_fix_claim_rpc_claim_type_cast.sql` | 050 | RPC claim_type cast removal. | No | YES |
| 44 | `44_s001_seed_profiles.sql` | s001 | SEED — profiles bootstrap. | INSERT count expected | YES |
| 45 | `45_s002_seed_contracts.sql` | s002 | SEED — contracts incl. CMH_01-C01. | INSERT count expected | YES |
| 46 | `46_s003_seed_convera_users.sql` | s003 | SEED — official MoMaH users. | INSERT count expected | YES |
| 47 | `47_s004_seed_supabase_auth_users.sql` | s004 | SEED — auth.users bootstrap. | INSERT count expected | YES |
| 48 | `48_s005_seed_test_users_cmh.sql` | s005 | SEED — IAM-3 aligned test users. | INSERT count expected | YES |
| 99 | `99_staging_schema_verification.sql` | verification | Health check; multiple SELECTs return rows. | **Yes** — paste back | If FAIL, stop |

The three "skipped" markdown notes (`SKIPPED_010_production_schema.md`,
`SKIPPED_015_fix_contract_231001101771_templates.md`,
`SKIPPED_018_revert_staff_grade3_rows.md`) document migrations that are
intentionally **not** applied on staging. There is nothing to run for
those — read the note if you want to know why.

---

## On error

1. **Stop immediately** — do not run any subsequent file.
2. Capture: file name, full PG error text (`ERROR`, `DETAIL`, `HINT`, `LINE`).
3. Annotate `execution_checklist.csv` with `failed` for the failing
   row and `pending` for everything after it.
4. Send the captured error back so a fix bundle can be issued. **Do
   not modify the SQL file yourself** — fixes are applied at the
   bundle/source level so they survive future rebuilds.

---

## On the enum split (08a / 08b)

The legacy migration `009_rename_claim_statuses.sql` does two distinct
things that PostgreSQL refuses to combine in one transaction:

1. `ALTER TYPE … ADD VALUE` (creates new enum labels).
2. `UPDATE … SET status = 'new_label'` (uses a label added in step 1).

PG error `55P04` blocks step 2 from seeing the value created in step 1
inside the same transaction. The Supabase SQL Editor wraps each Run in
one transaction, so the file would always fail on a fresh database.

The split:

- **`08a_009_enum_add_only.sql`** — only the `ADD VALUE` statements.
  Idempotent (`IF NOT EXISTS`), safe to re-run.
- **`08b_009_status_data_update.sql`** — the UPDATEs, each wrapped in
  `IF EXISTS (… pg_enum lookup …)` guards. On fresh staging the old
  labels (`under_consultant_review`, etc.) never existed in
  `change_order_status`, so the guard returns `false` and the UPDATE
  is never even parsed → no `22P02` error. On a database that still
  has the old labels (production-like), the UPDATEs run normally.

**Run them in order, in two separate Run-button submissions.**

---

## Reset (only if `public_table_count > 0` and you didn't apply STEPs 1–7 cleanly)

```sql
-- ⚠ DESTRUCTIVE — verify URL still contains `jrqkzwacerdudmeacvar` first.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
```

After reset, re-run `00_preflight_guard.sql` first.

---

## Phase 8 gate

Phase 8 (CMH_01 data import) **does not start** until
`99_staging_schema_verification.sql` returns clean output. Do not run
the import driver, do not seed CMH_01 BOQ data, do not push any of
this to git from your machine until that gate is cleared. The
operator-side instructions for the import are in
`data-imports/CMH_01/08_migration/migration_log.md`.
