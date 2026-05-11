# Legacy CONVERA vs Current convera-platform — Inventory Comparison

> Authored 2026-05-07. Read-only audit of `the legacy CONVERA folder on the operator host` versus `the current convera-platform repo on the operator host`.
> No file in the legacy folder was modified, copied, or executed during this audit. Production credentials and project refs were detected by filename/structure only — values were not read.

## Top-level structure

| Folder | Legacy `CONVERA` | Current `convera-platform` |
|---|---|---|
| Top-level size | ~2.7 GB total (mostly `PROJECTS/` and `FRONTEND/node_modules`) | small (engineering repo only) |
| Front-end app | `FRONTEND/app/` (21 routes) | `app/` (22 routes) — same layout |
| SQL migrations | `SQL/migrations/` — **44 files** numbered 001–045 (with gaps + duplicates) | `SQL/migrations/` — **8 files**: 040, 041, 044, 046–050 |
| SQL seeds | `SQL/seeds/` — 5 files (001–005) | `SQL/seeds/` — 1 file (005 only) |
| SQL one-shot bundles | `SQL/bootstrap_all.sql`, `SQL/seed_templates.sql`, `SQL/scripts/`, `SQL/monitoring/`, `SQL/hotfixes/` | `SQL/diagnostics/iam_user_health.sql` (read-only IAM checks) |
| Per-project ETL | `PROJECTS/<code>/_ETL/{migrate.py, .env.example}` × 15 projects | not present |
| Cross-project tools | `_TOOLS/{migrate.py, mappings.py, bootstrap_project.py, …}` | not present |
| Docs | `CLAUDE.md`, `AGENTS.md`, `docs/`, `CONVERA.pdf`, `*.docx`, `*.pptx` | `CLAUDE.md`, `data-imports/CMH_01/05_import_plan/*.md`, `data-imports/CMH_01/08_migration/*.md`, `logs/*.md` |
| Front-end env | `FRONTEND/.env.local` (**production keys** — see §5) | `.env.local` (currently staging keys) |

## 1. SQL migrations — file-by-file presence

### Only in legacy (39 files — foundational + intermediate hardening)

```
001_base_schema.sql                              (45 KB) — entire base schema
002_step0_fixes.sql                              (8 KB)
003_change_orders_and_hardening.sql              (28 KB)
004_contract_templates_and_progress_models.sql   (22 KB)
006_convera_users_otp.sql                        (6 KB)
007_contract_amendments_enhancement.sql          (10 KB)
008_invoice_attachment_governance.sql            (3 KB)
009_rename_claim_statuses.sql                    (5 KB)
010_production_schema.sql                        (45 KB)  ⚠ DUPLICATE NUMBER — see §3
010_user_contracts.sql                           (4 KB)   ⚠ DUPLICATE NUMBER
011_fix_rls_returned_statuses.sql                (1 KB)
012_fix_rls_workflow_roles.sql                   (4 KB)
013_fix_trigger_security_definer.sql             (3 KB)
014_db_level_transition_guard.sql                (8 KB)
015_fix_contract_231001101771_templates.sql      (11 KB)  ⚠ contract-specific data fix
016_update_contract_types.sql                    (1 KB)
017_fix_contracts_rls_user_contracts.sql         (5 KB)
018_revert_staff_grade3_rows.sql                 (3 KB)   ⚠ data revert (production-targeted)
019_definitive_rls_scope_fix.sql                 (15 KB)
020_fix_internal_role_policies.sql               (10 KB)
021_sync_auth_bans_and_verify.sql                (7 KB)
022_fix_profiles_recursion.sql                   (1 KB)
023_fix_contract_scoping_leaks.sql               (14 KB)
024_drop_contracts_auth_read_backdoor.sql        (7 KB)
025_contract_scoped_roles.sql                    (22 KB)  ★ introduces user_contract_roles
026_rls_contract_scoped_roles.sql                (54 KB)  ★ RLS for contract-scoped roles
027_contract_role_browser_helpers.sql            (7 KB)
028_add_last_transition_at.sql                   (3 KB)
029_contractor_withdraw_action.sql               (3 KB)
030_completion_certificate_and_cancel.sql        (6 KB)
031_atomic_claim_submission.sql                  (17 KB)  ★ predecessor to 048
031b_fix_audit_logs_columns.sql                  (8 KB)
033_fix_document_type_enum.sql                   (1 KB)
034_audit_helper_function.sql                    (4 KB)
035_block_submitted_persist.sql                  (4 KB)
042_QUICK_RUN.sql                                (0.5 KB) ⚠ 5-second variant — see §3
042_extend_enums_for_template_v7.sql             (3 KB)
043_data_model_hardening.sql                     (3 KB)   ⚠ has SAFE variant — see §3
043_data_model_hardening_SAFE.sql                (2 KB)
045_contract_role_multi_assignment.sql           (14 KB)  ★ MIGRATION 045 INVARIANT
```

### Only in current (5 files — Phase 2.6 / claim numbering / RPC fixes)

```
046_quality_and_pm_stages.sql              ★ adds under_quality_review + under_project_manager_review
047_claim_kind_and_number.sql              ★ adds claim_kind, claim_number, partial unique index
048_create_claim_with_items_atomic.sql     ★ atomic RPC w/ open-claim guard
049_fix_claim_rpc_item_no_cast.sql         ★ fixes integer=text cast in RPC
050_fix_claim_rpc_claim_type_cast.sql      ★ removes ::claim_type cast
```

### In both — all DIFFERENT (current is newer)

| File | Legacy | Current | Verdict |
|---|---|---|---|
| `040_flexible_approvers_and_import.sql` | 8 489 B | 8 677 B | **Use current** (newer; +188 B) |
| `041_final_approver_role.sql` | 4 475 B | 4 585 B | **Use current** (newer; +110 B) |
| `044_imports_governance.sql` | 5 674 B | 5 710 B | **Use current** (newer; +36 B) |

Implication: the current repo carries the **latest** versions of 040, 041, 044, plus the **only** copies of 046–050. Everything before 040 lives **only** in legacy.

## 2. SQL seeds — file-by-file presence

### Only in legacy (4 files)

```
001_seed_profiles.sql                 (14 KB)  ★ profiles bootstrap
002_seed_contracts.sql                (33 KB)  ★ contract seeds (CMH_01-C01 et al.)
003_seed_convera_users.sql            (6 KB)   ★ official MoMaH users
004_seed_supabase_auth_users.sql      (8 KB)   ★ auth.users bootstrap (paste-into-SQL-editor)
```

### In both — DIFFERENT

| File | Legacy | Current | Verdict |
|---|---|---|---|
| `005_seed_test_users_cmh.sql` | 33 804 B (May 4 10:47) | 26 098 B (May 4 12:51) | **Use current** (newer; trimmed; matches the IAM-3 / `verify:repo-path` whitelist that bans `'auditor'` role) |

## 3. Duplicates inside legacy that need operator review

| Pair | Likely interpretation | Recommended action |
|---|---|---|
| `010_production_schema.sql` (45 KB) vs `010_user_contracts.sql` (4 KB) | **Two different migrations both numbered 010**. The first is the production-schema bootstrap; the second adds `user_contracts` (many-to-many) and explicitly says "Run this AFTER migration 005" in its header. They were authored at different dates (Mar 19 vs Mar 21) and the renumbering was never reconciled. | Apply BOTH, ordering: `010_production_schema.sql` first (foundational), then `010_user_contracts.sql` (additive). Rename one to `010b_user_contracts.sql` in any consolidated bundle to avoid filename collision. |
| `042_QUICK_RUN.sql` (553 B) vs `042_extend_enums_for_template_v7.sql` (3 KB) | The QUICK_RUN is a **paste-friendly stripped variant** ("Arabic comment: copy + paste this — 5 seconds runtime"). The full file has the proper header + scaffolding. | Use the **full** `042_extend_enums_for_template_v7.sql`. Skip QUICK_RUN. |
| `043_data_model_hardening.sql` (3 KB) vs `043_data_model_hardening_SAFE.sql` (2 KB) | Header of `_SAFE` says "Only operations verified against actual production schema". The full version was the original D2 plan; SAFE is the trimmed prod-safe subset. | For staging, either works. Use `_SAFE` to be conservative. |

## 4. Application code parity (sanity check)

The two front-end trees are **the same shape**:

| | Legacy `CONVERA/FRONTEND/app/` | Current `convera-platform/app/` |
|---|---|---|
| Top-level dirs | `(app)/`, `(print)/`, `api/`, `forgot-password/`, `globals.css`, `layout.tsx`, `login/`, `page.tsx`, `reset-password/` | identical layout |
| `app/api/*/route.ts` count | 21 | 22 (+1) |

Differential: current has one more API route. Routes already inspected during the Phase-8 alignment (`/api/contracts`, `/api/claims/create`, `/api/claims/transition`, `/api/admin/users[/[id]]`, `/api/claims/upload-certificate`, etc.) all exist in `convera-platform/app/api/`. The current repo is the **operational source of truth** for application code.

## 5. Production-credential / forbidden assets in legacy

The following files in the legacy folder reference the production project ref `ngwxlockzkjpmzuvgakx` or contain real production credentials. They are **forbidden** under your active rules. They were detected by filename / structure only — values were not read, copied, or used.

| Path | Why forbidden |
|---|---|
| `CONVERA/FRONTEND/.env.local` | Real production `<publishable key>*` + `<server-side secret key>*` keys (confirmed in earlier session — production project ref `ngwxlockzkjpmzuvgakx`). **Do not read, copy, or reuse.** |
| `CONVERA/FRONTEND/.env.local.example` | Same production project ref. |
| `CONVERA/PROJECTS/<CODE>/_ETL/.env.example` × 15 projects | Per-project env templates pointing at the production ref. Per `CMH_01/00_inventory/F1_RECOVERY_CHECKLIST.md` §5, these are preserved as forensic evidence only. |
| `CONVERA/PROJECTS/<CODE>/_ETL/migrate.py` × 15 projects | Legacy migration script that writes via service-role to whatever URL is in `.env`. Documented as "will not be used as-is" in F1 §5 because it bypasses the platform's governance pipeline. |
| `CONVERA/_TOOLS/migrate.py` | Cross-project legacy migration; same risk profile. |
| `CONVERA/SQL/migrations/015_fix_contract_231001101771_templates.sql` | Contains a contract-specific data correction tied to a real production contract number. Skip for staging. |
| `CONVERA/SQL/migrations/018_revert_staff_grade3_rows.sql` | Production-data revert. Skip for staging. |
| `CONVERA/SQL/migrations/021_sync_auth_bans_and_verify.sql` | Reads `auth.users.banned_until` — only meaningful when production users exist. Safe to apply but produces no useful effect on a fresh staging DB. |

These files are **read-only forensic evidence** in legacy and must remain there. None are copied or referenced from the staging schema bundle (when one is built later).

## 6. Reusable assets potentially useful for staging setup

| Asset | Where | Reuse? | Notes |
|---|---|---|---|
| `SQL/migrations/001…035` (foundational) | legacy | **Yes** — apply to staging in order | Source of truth; missing entirely from current repo. |
| `SQL/migrations/040, 041, 044` | **current** | **Yes** — current versions | Both folders carry these but current is newer. |
| `SQL/migrations/042_extend_enums_for_template_v7.sql` | legacy | **Yes** | Use the full version, not QUICK_RUN. |
| `SQL/migrations/043_data_model_hardening_SAFE.sql` | legacy | **Yes** (SAFE variant) | More conservative. |
| `SQL/migrations/045_contract_role_multi_assignment.sql` | legacy | **Yes** | Mandatory: enforces the (user, contract, role) 3-tuple referenced by Migration 045 invariant. |
| `SQL/migrations/046–050` | **current** | **Yes** | Phase 2.6 + claim-RPC fixes; only place these exist. |
| `SQL/seeds/001–004` | legacy | **Conditional** | Profiles + contracts + auth-users seeds. Useful for staging IF the operator wants the same baseline as production. The contracts seed includes the real CMH_01 contract data — appropriate for replay-into-staging. Verify with operator before applying. |
| `SQL/seeds/005_seed_test_users_cmh.sql` | **current** | **Yes** — current version | Aligned with IAM-3 hardening. |
| `SQL/bootstrap_all.sql` | legacy | **Reference only** | A paste-friendly "trigger fix + 6 auth users + profiles + 2 contracts + verify" bundle. Predates Migration 045 schema — do NOT paste blindly. |
| `SQL/seed_templates.sql` | legacy | **Conditional** | BOQ + Staff template seeds — useful only after the contract seeds run. Verify against current 044+045+046 schema before applying. |
| `SQL/scripts/032_recovery_stuck_claims.sql` | legacy | Operational; not needed for fresh staging | Recovery helper for claims stuck in transition. Keep as reference. |
| `SQL/diagnostics/iam_user_health.sql` | **current** | **Yes** — read-only diagnostics | Already used by IAM-1 playbook. Safe to run against staging. |
| `data-imports/CMH_01/03_normalized/*` | **current** | **Yes** | Phase-7 dry-run artifacts; canonical Phase-8 input. |

## 7. Files that must NOT be used (summary)

- Anything containing `ngwxlockzkjpmzuvgakx` — production project ref. Hard-blocked by the `import-cmh01-controlled.js` and `check-cmh01-env.js` guards.
- All `.env.local` / `.env` files in the legacy `CONVERA/` tree.
- `legacy CONVERA/PROJECTS/<CODE>/_ETL/migrate.py` for any project — bypasses platform governance.
- `CONVERA/_TOOLS/migrate.py` — cross-project legacy migration.
- `CONVERA/SQL/migrations/015_fix_contract_231001101771_templates.sql` — production-specific data fix.
- `CONVERA/SQL/migrations/018_revert_staff_grade3_rows.sql` — production data revert.

## 8. Headline finding

The current `convera-platform` repo carries **only the recent (post-Migration 040) schema deltas plus the 046–050 Phase 2.6 work**. The **foundational schema and ~30 hardening migrations live only in legacy**. The current repo cannot stand up a database from scratch on its own — it needs the legacy 001–039 chain to come first. See the companion `schema_consolidation_report.md` for the recommended canonical bundle and ordering.
