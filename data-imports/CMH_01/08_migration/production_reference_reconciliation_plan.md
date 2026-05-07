# Production Reference Reconciliation Plan (Read-Only)

> Authored 2026-05-07. Methodology + checklist for using the live `CONVERA / main / PRODUCTION` Supabase project (ref `ngwxlockzkjpmzuvgakx`) as a **read-only reference** to validate that `staging_schema_bundle.sql` accurately represents the production schema before applying it to staging.
>
> **Hard constraint: production is reference-only. No DDL, no DML, no migrations are applied or executed against it as part of this work.**

---

## 1. What production appears to contain

Based on operator-reported observations (the project name is visible in Supabase Studio as `CONVERA / main / PRODUCTION`, with many saved private SQL queries) plus the legacy `CONVERA/SQL/` repo evidence:

- A live Supabase Postgres instance with the application schema (profiles, contracts, claims, claim_workflow, user_contract_roles, etc.).
- An `auth.users` table populated with the operational user roster.
- `claims` rows representing real CMH/PMH/SDM/SMH/TCM/CAR project history (the CMH_01 import target is one of these).
- A SQL Editor sidebar containing **saved private queries** — some of these are likely diagnostic SELECTs, others may be operational hotfix scripts that were applied directly via the editor and never committed back to the migrations folder.
- The auto-memory entry `project_migration_041_not_applied.md` records that **`final_approver` is NOT in the production user_role enum** — meaning at least one Phase 2.6 / commit-41 schema delta has *not* been applied to production. This is the most concrete known divergence between repo state and production state.

The agent has **not** navigated to the production Supabase Studio for this reconciliation. All claims here are derived from the repo and from the prior-conversation memory entry.

---

## 2. Saved SQL queries — relevance triage by name pattern

When the operator opens the production SQL Editor sidebar, the following name patterns are the ones to look for. They map onto the engineering work that *might* have been applied directly:

### Likely-relevant (review carefully)

| Name pattern | What it would mean if present |
|---|---|
| `*RBAC*`, `*IAM*`, `*role*` | A direct fix to user_role / contract_role enums or to user_contract_roles policies — possibly applied before migration 045 was authored. |
| `*create_claim_with_items_atomic*`, `*claim*RPC*`, `*atomic*` | A previous version of the claim-create RPC. Compare against current 048 + 049 + 050. |
| `*claim_type*cast*`, `*item_no*cast*` | The 049/050 RPC bug-fix pair. If present in the editor and the RPC is post-fix, prod is current; if absent and the prod RPC errors with `integer = text`, prod is on an older version. |
| `*user_contract_roles*`, `*multi_role*`, `*3-tuple*` | The Migration 045 invariant work. |
| `*quality*`, `*project_manager*`, `*workflow*stages*`, `*46*` | Migration 046 (Phase 2.6 new gating stages). |
| `*claim_kind*`, `*claim_number*`, `*47*` | Migration 047 deltas. |
| `*final_approver*`, `*041*`, `*40*` | Migrations 040 / 041 (final_approver role + contract_approvers table). |
| `*health*`, `*diagnostic*`, `*D1*`, `*D2*`, `*D3*`, `*D4*`, `*D5*`, `*D6*` | Read-only IAM diagnostics — same shape as `SQL/diagnostics/iam_user_health.sql`. Safe to read. |

### Probably-not-needed-on-staging (skip)

| Name pattern | Why |
|---|---|
| `fix_auth_*`, `repair_auth*`, `fix_instance*` | One-time auth.users data cleanup applied to the production roster. Fresh staging does not need this — auth seeds (001–004) generate clean rows. |
| `fix_users_*`, `fix_user_meta*` | Production-user data fixes. Staging gets users from seeds. |
| `fix_contract_values*`, `fix_contract_<contract_no>_*` | Per-contract data corrections (like the deliberately-skipped Migration 015). Not portable. |
| `recovery_stuck_claims*`, `032_recovery*` | Only meaningful when claims got stuck *before* Migration 031 was deployed. Staging applies 031 from-scratch — no stuck claims to recover. |
| `monitoring_*`, `stuck_claims_monitor*` | Operational dashboards (SELECT-only, safe to read but not relevant for staging apply). |

### Dangerous to execute (read-only inspection only — DO NOT click Run)

Anything beginning with `DELETE FROM`, `DROP TABLE`, `TRUNCATE`, `ALTER TABLE … DROP`, `UPDATE auth.users`, `INSERT INTO auth.users`, or `INSERT INTO storage.objects`. These mutate state. The operator may **read** them in the editor (click the saved query to load it) but **must not** click Run on them.

---

## 3. Authoritative repo references (already cross-checked)

The following files are the authoritative source-of-truth for what *should* exist in production. They are all already inside `staging_schema_bundle.sql`:

| Object | Migration that defines it | Bundle ref count |
|---|---|---|
| `profiles` table | 001 (legacy) | 2 `CREATE TABLE` |
| `contracts` table | 001 (legacy) | 2 `CREATE TABLE` |
| `claims` table | 001 (legacy) | 2 `CREATE TABLE` |
| `claim_workflow` table | 001 (legacy) | 2 `CREATE TABLE` |
| `user_contracts` (m2m) | 010_user_contracts (legacy) | 167 occurrences |
| `user_contract_roles` (3-tuple) | 025 (legacy) + 045 invariant | 99 occurrences |
| `contract_approvers` | 040 (current) | 30 occurrences |
| `claim_kind` + `claim_number` | 047 (current) | 58 + 1 |
| `create_claim_with_items_atomic` | 048 (current) | 36 occurrences |
| `submit_claim_atomic` | 031 (legacy) | 29 occurrences |
| `check_claim_within_contract_limit` | 007/013/024 (legacy) | 9 occurrences |
| `'quality'`, `'project_manager'` enum values | 045 (legacy) + 046 (current) | 1 + 1 ADD VALUE |
| `'final_approver'` enum value | 041 (current) + 045 (legacy) | 3 ADD VALUE |
| `'under_quality_review'`, `'under_project_manager_review'` claim_status | 046 (current) | 5 + 4 |

The staging bundle contains **all** of the above. It is structurally complete for the schema as represented in the migrations folders.

---

## 4. Comparison checks the operator may perform on production (READ-ONLY)

The following are SELECT-only queries the operator may run **manually** in the production SQL Editor to compare against `staging_schema_verification.sql`. Each returns metadata only — no rows are modified, inserted, or deleted.

```sql
-- A. Public tables present
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- B. Enum types and their values
SELECT t.typname, e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('user_role','contract_role','claim_status','claim_kind','contract_type')
ORDER BY t.typname, e.enumsortorder;

-- C. RPCs in the public schema
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'create_claim_with_items_atomic',
    'submit_claim_atomic',
    'check_claim_within_contract_limit',
    'auto_claim_number',
    'handle_new_user'
  )
ORDER BY p.proname;

-- D. Indexes that gate the claim_number invariant
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (indexname LIKE 'ux_claims_%' OR indexname LIKE 'idx_claims_%')
ORDER BY indexname;

-- E. Constraint defining the user_contract_roles 3-tuple unique
SELECT con.conname, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
WHERE t.relname = 'user_contract_roles' AND con.contype = 'u';

-- F. Recent claim shape (head row only — no PII printed)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'claims'
ORDER BY ordinal_position;
```

These six queries are equivalent in spirit to `staging_schema_verification.sql` and produce no side effects. The agent has not run them; the operator may run any or all of them on the production project to cross-check what staging will contain after applying the bundle.

---

## 5. Things the agent will NOT do during this reconciliation

- Navigate to the production Supabase Studio.
- Issue any `pg-meta` calls against project ref `ngwxlockzkjpmzuvgakx`.
- Click Run on any production SQL Editor saved query.
- Modify `staging_schema_bundle.sql`, `staging_schema_bundle_manifest.csv`, or any other artifact in this commit window.
- Push commits.
- Ask the operator for a Personal Access Token, service-role key, or any production credential.

The operator's authority remains the only path that can alter production. This document is a **read-only inspection guide**.

---

## 6. Companion deliverable

A risk review with the actual gap conclusions is in `production_vs_staging_schema_risk_review.md`. Read it next for the apply-as-is vs paused decision.
