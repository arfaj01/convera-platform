# Schema Consolidation Report — Staging Setup Source-of-Truth

> Authored 2026-05-07. Companion to `legacy_vs_current_inventory.md`. Answers the operator's nine consolidation questions and ends with the recommended canonical bundle for staging Supabase setup. **No SQL was executed and no files were copied.**

---

## Q1. Are migrations 001–050 already present in the current repo?

**No.** The current `convera-platform/SQL/migrations/` directory contains **only 8 files**:

```
040_flexible_approvers_and_import.sql      (newer than legacy)
041_final_approver_role.sql                (newer than legacy)
044_imports_governance.sql                 (newer than legacy)
046_quality_and_pm_stages.sql              (only here)
047_claim_kind_and_number.sql              (only here)
048_create_claim_with_items_atomic.sql     (only here)
049_fix_claim_rpc_item_no_cast.sql         (only here)
050_fix_claim_rpc_claim_type_cast.sql      (only here)
```

Everything from migration `001` through `039` (plus `042`, `043`, `045`) is **absent** from the current repo. They live in legacy `CONVERA/SQL/migrations/`.

This means: **the current repo is a delta repo on top of legacy 001–045**, not a self-contained schema source. To stand up a fresh staging database from zero, the legacy migrations must be applied first.

## Q2. Are there additional legacy migrations missing from current repo?

**Yes — 39 files.** See `legacy_vs_current_inventory.md` §1 for the full enumerated list. Highlights:

- **Foundational**: `001_base_schema.sql` (45 KB), `010_production_schema.sql` (45 KB), `010_user_contracts.sql` (4 KB).
- **Core domain features**: `003_change_orders_and_hardening.sql`, `004_contract_templates_and_progress_models.sql`, `031_atomic_claim_submission.sql` (predecessor of 048), `030_completion_certificate_and_cancel.sql`.
- **Security / RLS**: `019_definitive_rls_scope_fix.sql`, `020_fix_internal_role_policies.sql`, `024_drop_contracts_auth_read_backdoor.sql`, `026_rls_contract_scoped_roles.sql` (54 KB).
- **Multi-role invariant**: `045_contract_role_multi_assignment.sql` — the (user_id, contract_id, contract_role) UNIQUE that the platform's IAM-3 + Phase-2.6 work depends on.

## Q3. Are any old migrations superseded by newer current migrations?

Only three numbers overlap (040, 041, 044). For all three the **current repo's copy is the newer and authoritative one** — confirmed by byte-size delta and authoring dates. No legacy migration is fully superseded by the 046–050 series; those add brand-new structures (claim_number, claim_kind, atomic RPC) that the legacy chain doesn't address.

There is one indirect supersession: `031_atomic_claim_submission.sql` (legacy) introduces the original atomic-claim RPC; `048_create_claim_with_items_atomic.sql` (current) replaces it with a Phase-2.6-aware version that also enforces `OPEN_CLAIM_GUARD`, `pg_advisory_xact_lock`, server-truth `prev_progress`, and project-code formatting. **Both must be applied** in order — 031 first to define the table contracts, then 048 to install the new RPC.

## Q4. Are enum changes for `contract_role` (`quality`, `project_manager`, `final_approver`) already implemented?

**Yes — split across two migrations**:

- `045_contract_role_multi_assignment.sql` (legacy) — extends the `contract_role` enum to include `viewer`, `project_manager`, `quality`, `final_approver` and changes `user_contract_roles` to `UNIQUE(user_id, contract_id, contract_role)`. Smoke matrix calls this the "Migration 045 invariant".
- `041_final_approver_role.sql` (current; newer than legacy) — adds the `final_approver` global UserRole + the `contract_approvers` table.

Combined effect: after applying `041` + `045`, all four enum values exist and the 3-tuple invariant holds.

**Note on prod-vs-staging:** the auto-memory entry `project_migration_041_not_applied.md` records that **`final_approver` is NOT in the production user_role enum** — meaning RLS policies in production must avoid that value. For staging, the safest plan is to **apply 041** and use `final_approver` end-to-end (matching the current RLS policy design).

## Q5. Are workflow status changes (`under_quality_review`, `under_project_manager_review`) already implemented?

**Yes — only in current `046_quality_and_pm_stages.sql`.** This file is the **only** source for the two new gating stages. Without applying it, the platform's transition route (`app/api/claims/transition/route.ts`) would fail at runtime when it tries to dispatch on these statuses (`isTransitionAllowed` would not find a matching transition for them).

Order matters: **046 must be applied AFTER 045** because the new transitions reference the `quality` and `project_manager` ContractRole values added by 045.

## Q6. Are claim RPCs and advisory-lock logic already implemented?

**Yes — the chain is**:

| Migration | What it does |
|---|---|
| `031_atomic_claim_submission.sql` (legacy) | Original atomic-submit RPC: `submit_claim_atomic()`. Establishes the table-write contract for `claims`, `claim_workflow`, `audit_logs`. |
| `048_create_claim_with_items_atomic.sql` (current) | New: `create_claim_with_items_atomic()` — atomic create + items + sequence + claim_number, with `OPEN_CLAIM_EXISTS` guard, `pg_advisory_xact_lock`, server-truth `prev_progress`, project-code resolver. |
| `049_fix_claim_rpc_item_no_cast.sql` (current) | Bug fix: replaces the implicit `integer = text` comparison on `cb.item_no` with a `v_item_no INTEGER` variable + `ITEM_NO_INVALID` regex guard. |
| `050_fix_claim_rpc_claim_type_cast.sql` (current) | Bug fix: removes a `::claim_type` cast that referenced an enum that doesn't exist (column is plain TEXT). |

The advisory-lock logic lives inside `48`'s `create_claim_with_items_atomic()`. It is **only present in the current repo** and is required for the 21-claim CMH_01 import to be safe under concurrent writers.

## Q7. Are there seed files for users, roles, contracts, or claims?

**Partial.** Five seeds total across both folders:

| Seed | Where | Recommended |
|---|---|---|
| `001_seed_profiles.sql` | legacy only | **Apply** — profiles for the 6-user roster |
| `002_seed_contracts.sql` | legacy only | **Apply** — includes the CMH_01-C01 contract row plus BOQ/staff templates. This is the canonical contract seed (Phase 8 expects `contract_no=CMH_01-C01` to exist before run). |
| `003_seed_convera_users.sql` | legacy only | **Apply** — official MoMaH user records |
| `004_seed_supabase_auth_users.sql` | legacy only | **Apply** — `auth.users` bootstrap (paste-into-SQL-editor variant of `npm run seed:auth-users`) |
| `005_seed_test_users_cmh.sql` | both — current is newer (26 098 B vs 33 804 B) | **Apply current** — aligned with IAM-3 hardening (no `'auditor'` role, etc.) |

There is **no claim seed** in either repo — and that's correct. Claims are loaded by Phase 8 (this migration project), not by SQL seed.

## Q8. Is there any existing staging setup script or bundle that should be reused?

| Candidate | Where | Reuse decision |
|---|---|---|
| `SQL/bootstrap_all.sql` | legacy | **Reference only — do NOT paste blindly.** It bundles the trigger fix + 6 auth users + profiles + 2 contracts + verify, but it predates Migration 045 so its enum/role values may not match the current schema. The pieces it contains (auth users, profiles, contracts) are better applied as the individual seeds 001–004. |
| `SQL/seed_templates.sql` | legacy | Conditional — paste-friendly BOQ/Staff template seed. Schema dependencies: requires `004_contract_templates_and_progress_models.sql` (which IS in legacy). For staging it may help, but verify against the current 044+045+046 schema before pasting. |
| `SQL/scripts/032_recovery_stuck_claims.sql` | legacy | **Operational only** — recovery helper for production. Not needed for fresh staging. |
| `SQL/diagnostics/iam_user_health.sql` | current | **Use** — read-only IAM checks (D1–D6). Already part of the IAM-1 playbook. |
| `_TOOLS/migrate.py`, `PROJECTS/<n>/_ETL/migrate.py` | legacy | **Forbidden** (production credentials, bypasses platform governance). |

There is no pre-built "staging schema bundle". The staging setup must be assembled from the migrations + seeds enumerated below.

## Q9. What is the safest source of truth for staging schema setup?

**A two-source canonical bundle**, applied in numeric order, picking the right copy at each number. Operator must paste each block into the staging Supabase SQL editor (or apply via Supabase CLI) and verify success between blocks.

### A. Migrations (apply in this order)

| # | Source | File | Notes |
|---|---|---|---|
| 001 | legacy | `001_base_schema.sql` | foundational |
| 002 | legacy | `002_step0_fixes.sql` | |
| 003 | legacy | `003_change_orders_and_hardening.sql` | |
| 004 | legacy | `004_contract_templates_and_progress_models.sql` | |
| 006 | legacy | `006_convera_users_otp.sql` | (no 005 in either repo — gap is intentional) |
| 007 | legacy | `007_contract_amendments_enhancement.sql` | |
| 008 | legacy | `008_invoice_attachment_governance.sql` | |
| 009 | legacy | `009_rename_claim_statuses.sql` | |
| 010a | legacy | `010_production_schema.sql` | |
| 010b | legacy | `010_user_contracts.sql` | apply AFTER 010a |
| 011 | legacy | `011_fix_rls_returned_statuses.sql` | |
| 012 | legacy | `012_fix_rls_workflow_roles.sql` | |
| 013 | legacy | `013_fix_trigger_security_definer.sql` | |
| 014 | legacy | `014_db_level_transition_guard.sql` | |
| 015 | legacy | `015_fix_contract_231001101771_templates.sql` | **SKIP** — production-specific data fix; not needed for staging |
| 016 | legacy | `016_update_contract_types.sql` | |
| 017 | legacy | `017_fix_contracts_rls_user_contracts.sql` | |
| 018 | legacy | `018_revert_staff_grade3_rows.sql` | **SKIP** — production data revert |
| 019 | legacy | `019_definitive_rls_scope_fix.sql` | |
| 020 | legacy | `020_fix_internal_role_policies.sql` | |
| 021 | legacy | `021_sync_auth_bans_and_verify.sql` | safe but no effect on fresh staging |
| 022 | legacy | `022_fix_profiles_recursion.sql` | |
| 023 | legacy | `023_fix_contract_scoping_leaks.sql` | |
| 024 | legacy | `024_drop_contracts_auth_read_backdoor.sql` | |
| 025 | legacy | `025_contract_scoped_roles.sql` | introduces user_contract_roles |
| 026 | legacy | `026_rls_contract_scoped_roles.sql` | RLS for contract-scoped roles |
| 027 | legacy | `027_contract_role_browser_helpers.sql` | |
| 028 | legacy | `028_add_last_transition_at.sql` | |
| 029 | legacy | `029_contractor_withdraw_action.sql` | |
| 030 | legacy | `030_completion_certificate_and_cancel.sql` | |
| 031 | legacy | `031_atomic_claim_submission.sql` | predecessor of 048 |
| 031b | legacy | `031b_fix_audit_logs_columns.sql` | |
| 033 | legacy | `033_fix_document_type_enum.sql` | (032 is in `SQL/scripts/`, not migrations — operational helper, not applied) |
| 034 | legacy | `034_audit_helper_function.sql` | |
| 035 | legacy | `035_block_submitted_persist.sql` | |
| 040 | **current** | `040_flexible_approvers_and_import.sql` | newer than legacy |
| 041 | **current** | `041_final_approver_role.sql` | newer than legacy |
| 042 | legacy | `042_extend_enums_for_template_v7.sql` | use the FULL version, not QUICK_RUN |
| 043 | legacy | `043_data_model_hardening_SAFE.sql` | use the SAFE variant |
| 044 | **current** | `044_imports_governance.sql` | newer than legacy |
| 045 | legacy | `045_contract_role_multi_assignment.sql` | mandatory — Migration 045 invariant |
| 046 | **current** | `046_quality_and_pm_stages.sql` | new gating stages |
| 047 | **current** | `047_claim_kind_and_number.sql` | claim_kind + claim_number + partial unique |
| 048 | **current** | `048_create_claim_with_items_atomic.sql` | atomic RPC |
| 049 | **current** | `049_fix_claim_rpc_item_no_cast.sql` | RPC fix |
| 050 | **current** | `050_fix_claim_rpc_claim_type_cast.sql` | RPC fix |

**Total to apply: 41 migrations.** Two skipped (015, 018) on purpose. Two duplicate-numbered legacy files (010a, 010b) applied sequentially.

### B. Seeds (apply after migrations, in this order)

| # | Source | File | Apply? |
|---|---|---|---|
| 001 | legacy | `001_seed_profiles.sql` | **Yes** |
| 002 | legacy | `002_seed_contracts.sql` | **Yes** — includes CMH_01-C01 + BOQ/staff templates |
| 003 | legacy | `003_seed_convera_users.sql` | **Yes** |
| 004 | legacy | `004_seed_supabase_auth_users.sql` | **Yes** — paste-into-SQL-editor variant |
| 005 | **current** | `005_seed_test_users_cmh.sql` | **Yes** — current/newer version (IAM-3 aligned) |

### C. Phase-8 prerequisite (post-seed)

After A + B are complete, the operator must provision the **migration-bot user** for Phase 8:

- A staging user (e.g. `migration-bot@convera.test`) with `profile.role = 'director'`.
- Six active rows in `user_contract_roles` for the staging CMH_01-C01 contract carrying: `contractor`, `supervisor`, `reviewer`, `quality`, `project_manager`, `final_approver`.
- Sign in as that user via the staging app, copy the access_token, export as `MIGRATION_USER_JWT`.

This is documented in `phase8_script_alignment_report.md` §9.

## Selective adoption list (legacy → operator action)

The operator must paste each of these from legacy into the staging Supabase SQL editor. **No automatic copy is recommended in this commit.** This list is for operator review.

| Source path (legacy) | Target | Reason | Risk | Manual review needed? |
|---|---|---|---|---|
| `CONVERA/SQL/migrations/001_base_schema.sql` | staging Supabase | foundational schema | low — no production data references | No (operator pastes into SQL editor) |
| `CONVERA/SQL/migrations/002_step0_fixes.sql` | staging Supabase | post-001 fixes | low | No |
| `CONVERA/SQL/migrations/003_change_orders_and_hardening.sql` | staging Supabase | change-order tables | low | No |
| `CONVERA/SQL/migrations/004_contract_templates_and_progress_models.sql` | staging Supabase | BOQ + staff template tables | low | No |
| `CONVERA/SQL/migrations/006_convera_users_otp.sql` | staging Supabase | CONVERA_USERS table for OTP | low | No |
| `CONVERA/SQL/migrations/007_contract_amendments_enhancement.sql` | staging Supabase | contract amendments | low | No |
| `CONVERA/SQL/migrations/008_invoice_attachment_governance.sql` | staging Supabase | invoice attachment rules | low | No |
| `CONVERA/SQL/migrations/009_rename_claim_statuses.sql` | staging Supabase | rename old → new claim status enums | low | No |
| `CONVERA/SQL/migrations/010_production_schema.sql` | staging Supabase | production schema bootstrap | medium — large file (45 KB) | **Yes** — review before paste; verify enum values match 045 |
| `CONVERA/SQL/migrations/010_user_contracts.sql` | staging Supabase | user_contracts (m2m) | low | No |
| `CONVERA/SQL/migrations/011-014, 016-017, 019-027, 028-031, 031b, 033-035` | staging Supabase | hardening + RLS + workflow | low–medium each | No |
| `CONVERA/SQL/migrations/015_fix_contract_231001101771_templates.sql` | **DO NOT APPLY** | production-specific contract data fix | high — references real production contract | **SKIP** |
| `CONVERA/SQL/migrations/018_revert_staff_grade3_rows.sql` | **DO NOT APPLY** | production data revert | high | **SKIP** |
| `CONVERA/SQL/migrations/042_extend_enums_for_template_v7.sql` | staging Supabase | enum extension | low | No |
| `CONVERA/SQL/migrations/043_data_model_hardening_SAFE.sql` | staging Supabase | conservative D2 hardening | low | No |
| `CONVERA/SQL/migrations/045_contract_role_multi_assignment.sql` | staging Supabase | 3-tuple unique + extended enum | low | No |
| `CONVERA/SQL/seeds/001_seed_profiles.sql` | staging Supabase | profiles | low | No |
| `CONVERA/SQL/seeds/002_seed_contracts.sql` | staging Supabase | contracts (incl. CMH_01-C01) | low — no live keys | No |
| `CONVERA/SQL/seeds/003_seed_convera_users.sql` | staging Supabase | MoMaH users | low | No |
| `CONVERA/SQL/seeds/004_seed_supabase_auth_users.sql` | staging Supabase | auth.users bootstrap | medium — sets bootstrap passwords | **Yes** — operator may prefer `npm run seed:auth-users` for traceability |

## Forbidden assets in legacy (recap)

These must **not** be copied, read, or referenced when assembling the staging schema bundle:

- `CONVERA/FRONTEND/.env.local` — production credentials
- `CONVERA/FRONTEND/.env.local.example` — production project ref
- `CONVERA/PROJECTS/<CODE>/_ETL/.env.example` × 15
- `CONVERA/PROJECTS/<CODE>/_ETL/migrate.py` × 15
- `CONVERA/_TOOLS/migrate.py`
- `CONVERA/SQL/migrations/015_fix_contract_231001101771_templates.sql` (production-specific data)
- `CONVERA/SQL/migrations/018_revert_staff_grade3_rows.sql` (production data revert)

## Recommendation

1. **Use the legacy folder as the source of truth for migrations 001–035, 042, 043, 045, and seeds 001–004.** These do not exist anywhere else.
2. **Use the current `convera-platform` folder as the source of truth for migrations 040, 041, 044, 046–050, and seed 005.** These are newer or only-here.
3. **Do not generate any new SQL.** The schema is fully defined across these two folders.
4. **Do not auto-copy.** The operator should paste each migration / seed into the staging Supabase SQL editor in the order specified in §A and §B above, with the two SKIP entries respected.
5. **After schema + seeds are in place**, return to the Phase-8 alignment report (`phase8_script_alignment_report.md`) for the migration-bot user setup, then run the realigned dry-run, and only then run the controlled migration.

## Exact next step before staging schema setup

The operator should:

1. **Confirm in writing** that the canonical bundle above is acceptable (or specify deviations).
2. **Open the Supabase SQL editor** for the staging project `jrqkzwacerdudmeacvar`.
3. **Apply the 41 migrations** from §A in order (legacy paths for 001–035, 042 (full), 043 (SAFE), 045; current paths for 040, 041, 044, 046–050; skip 015 and 018).
4. **Apply the 5 seeds** from §B in order.
5. **Verify** by running `SQL/diagnostics/iam_user_health.sql` D1–D6 — all checks should pass.
6. **Reply `staging schema applied`** so Phase 8 dry-run can be re-run against a populated database.

This is operator work; the agent will not paste SQL or run migrations.
