# CMH_01 Staging Schema Bundle — Operator Runbook

> Companion to `staging_schema_bundle.sql`, `staging_schema_bundle_manifest.csv`, and `staging_schema_verification.sql` in this directory. Authored 2026-05-07.
>
> **This bundle is for CONVERA-STAGING only.** Target Supabase project ref: `jrqkzwacerdudmeacvar`. Production project ref `ngwxlockzkjpmzuvgakx` is **forbidden** and the bundle will refuse to run on it.

---

## 1. Hard pre-conditions

Do not start until **all** of the following are true:

- The Supabase SQL Editor browser tab is open on the **staging** project. The URL must contain `jrqkzwacerdudmeacvar`. If it contains `ngwxlockzkjpmzuvgakx`, **stop** and switch projects.
- The staging project has **no existing CONVERA tables**. The bundle assumes a clean Postgres schema (no `public.contracts`, no `public.profiles`, etc.). If the staging project has been partially seeded, abort and ask for a clean reset before proceeding.
- The operator has **director-level access** to the staging project (Supabase project owner / SQL editor write privilege).
- The bundle file `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` is current — its commit SHA matches the latest `data-import: prepare CMH_01 staging schema bundle` commit on `main`.

---

## 2. What the bundle does

It applies, in order:

1. A **pre-flight guard** that aborts if the production project ref appears in `pg_settings`.
2. **44 migrations** — combinations of legacy `CONVERA/SQL/migrations/` (foundational + intermediate hardening) and current `convera-platform/SQL/migrations/` (Phase 2.6 + claim numbering + atomic RPC + bug fixes).
3. **2 explicit `SKIPPED` blocks** for migrations 015 and 018 — production-data-specific. Both files exist in legacy but are intentionally **not applied** to staging.
4. **5 seeds** — profiles, contracts (incl. CMH_01-C01), CONVERA users, auth users, and the IAM-3-aligned test users.

Total payload: **~636 KB**. Composition is byte-for-byte the original SQL from each source file, separated by header comments only — no SQL was edited.

---

## 3. How to run the bundle

You have two execution modes. **Mode B is recommended for the first apply** because it isolates failure to one section.

### Mode A — paste the entire bundle in one go

1. Open the staging Supabase SQL Editor.
2. Open `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` in a text editor that handles 636 KB without truncating (VS Code, Sublime, Notepad++).
3. Select all → copy → paste into a **new** SQL Editor tab.
4. Click **Run**.
5. Wait for the editor to report success. Expect **a few seconds to a few minutes** depending on Supabase region.

### Mode B — section-by-section (recommended)

The bundle is partitioned by `═══` divider lines. Each `MIGRATION` and `SEED` block is a self-contained unit you can run individually. To do so:

1. Open the bundle file.
2. Find the **pre-flight guard** at the top (the `DO $$ ... END $$;` block). Run it first.
3. Scroll to the next `MIGRATION 001 (legacy)` divider. Copy from the next non-comment line down to the next `═══` divider. Paste and run.
4. Repeat for every section in order.
5. **If a section fails:** stop. Do not run subsequent sections. See §5.

The `SKIPPED` sections contain no SQL — they're explanatory comments only. Skip past them.

### Mode C — Supabase CLI (advanced)

If your environment is set up for it, you can also run the bundle via:

```bash
supabase db execute --project-ref jrqkzwacerdudmeacvar < staging_schema_bundle.sql
```

This requires the operator's CLI auth token to be set, the `supabase` binary installed, and the project linked. **Do not use the production project ref.**

---

## 4. How to verify successful schema setup

After the bundle finishes:

1. Open `data-imports/CMH_01/08_migration/staging_schema_verification.sql`.
2. Paste it into the SQL Editor on the **staging** project.
3. Click **Run**.
4. The query returns one row per check with columns `check_name`, `status`, `details`. Every `status` should be `PASS`. Any `FAIL` row blocks Phase 8.

The verification covers:

- Core tables exist (`contracts`, `claims`, `profiles`, `user_contract_roles`, `claim_workflow`, `audit_logs`, `documents`, `notifications`).
- Required enums exist (`user_role`, `contract_role`, `claim_status`, `claim_kind`, `contract_type`).
- `contract_role` enum includes `quality`, `project_manager`, `final_approver`.
- `claim_status` enum includes `under_quality_review` and `under_project_manager_review`.
- `create_claim_with_items_atomic` RPC exists.
- `submit_claim_atomic` RPC exists.
- `claim_number` column exists with the partial unique index `ux_claims_claim_number`.
- `claims.claim_kind` column exists (text, default 'running_payment').
- 3-tuple unique constraint on `user_contract_roles(user_id, contract_id, contract_role)` exists.
- IAM seeds were applied: count of `profiles` ≥ 6, count of `contracts` ≥ 1 (CMH_01-C01 present).

---

## 5. What to do if any migration fails

1. **Stop running further sections immediately.**
2. Capture the full SQL Editor error message (PG error code + message + line number).
3. Identify which migration the failure belongs to (the section header right before it tells you which `seq` / source file).
4. Decide:
   - **If the error is "object already exists":** the migration was already applied (perhaps you re-ran). Safe to skip that one section and proceed to the next.
   - **If the error is "object not found / does not exist":** a prerequisite migration was skipped. Go back and apply it.
   - **If the error is a permission / RLS issue:** check that you're running as the project owner (service-role context in the SQL Editor).
   - **Anything else:** stop, paste the error in chat with the affected section number. Do **not** paper over it by editing the bundle and re-running.

---

## 6. When to stop

Stop and report (to chat) in any of these cases:

- The pre-flight guard raises an exception (production-ref detected).
- Any verification query returns `FAIL`.
- A migration section fails and you can't classify it under §5.
- The seeds error out with constraint violations (likely indicates a partial pre-existing state).
- The bundle exceeds 30 minutes of total runtime (an indication of network/region issues, not a script bug).

In all cases, **do not** modify the bundle, do not run individual hand-written SQL fixes, and do not push commits — capture and ask.

---

## 7. Confirmation required after successful execution

After the bundle and verification both succeed, reply in chat with **exactly**:

```
staging schema applied.
verification: all checks PASS.
target project: jrqkzwacerdudmeacvar (staging).
no production touched.
```

When that confirmation arrives, the next step (per `phase8_script_alignment_report.md` §9) is:

1. Provision the migration-bot user with the six contract roles on the staging contract (`CMH_01-C01`).
2. Sign in as that user, copy the access token, export as `MIGRATION_USER_JWT`.
3. Re-run the Phase-8 dry-run against the now-populated staging.
4. Only after a clean dry-run, issue the explicit Phase-8 approval phrase.

---

## 8. Hard rules — recap

- **Staging only.** Never run this bundle on the production project (`ngwxlockzkjpmzuvgakx`).
- **No ad-hoc SQL.** All schema changes go through this bundle's source files. Don't hand-edit migrations between paste and run.
- **No bundle modifications without re-build.** If the bundle needs to change, the operator should not edit it directly; instead, update the source files in their respective folders and ask the agent to rebuild + recommit.
- **No `git push`.** Local commits only.
- **No production credentials.** The bundle does not require any user JWT — it runs as the SQL Editor's project owner. The Phase-8 driver's `MIGRATION_USER_JWT` is a separate concern handled later.
