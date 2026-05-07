# Split Package Report — CMH_01 staging schema sections

> Authored 2026-05-07. Records the conversion of the monolithic
> `staging_schema_bundle.sql` v2.4 into a folder of per-section files
> for safer, traceable manual application against
> CONVERA-STAGING (`jrqkzwacerdudmeacvar`).

---

## 1. Source bundle

| Field | Value |
|---|---|
| Source file | `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` |
| Bundle version | **v2.4** (enum transaction-safety fix) |
| Bundle commit | `ce5251e169f1ac2123e8ce6b8876f2d417b73fd9` (`ce5251e`) — this branch, not pushed |
| Bundle bytes / lines | 587,441 / 12,719 |
| Manifest used | `data-imports/CMH_01/08_migration/staging_schema_bundle_manifest.csv` |

## 2. Output

| Item | Count |
|---|---|
| Folder | `data-imports/CMH_01/08_migration/sections/` |
| Executable `.sql` files (incl. preflight + verification) | **51** |
|   ↳ `00_preflight_guard.sql` | 1 |
|   ↳ ordinary STEP files (1–48 with STEP 8 split) | 49 |
|   ↳ `99_staging_schema_verification.sql` | 1 |
| `SKIPPED_*.md` notes | 3 |
| Operator guides | 3 (`README_EXECUTION.md`, `execution_checklist.csv`, this report) |
| **Total entries in folder** | **57** |

## 3. Whether the enum issue was fixed

**Yes — fixed in two layers.**

- **Bundle layer (v2.4, commit `ce5251e`):** section 009's data UPDATE
  statements were stripped, leaving only `ALTER TYPE ADD VALUE IF NOT
  EXISTS` statements. This eliminated PG `55P04` (unsafe use of
  freshly-added enum value) and PG `22P02` (invalid enum literal for
  `change_order_status`).
- **Split layer (this package):** section 8 is further split into:
  - **`08a_009_enum_add_only.sql`** — the 8 ALTER TYPE statements.
  - **`08b_009_status_data_update.sql`** — the original UPDATE
    statements wrapped in `DO $$ … $$;` blocks where each branch is
    gated by a `pg_enum`-lookup `IF EXISTS` guard. On fresh staging
    the guards are all false and every UPDATE is skipped without
    parsing the enum literal (so `22P02` cannot fire). On a
    production-like database that still has the old labels, the
    UPDATEs run normally.

**08a and 08b MUST be run in two separate Run-button submissions** —
running them together would re-introduce the same-transaction `55P04`
error.

## 4. Sections split into multiple files

| Original step | Split into | Rationale |
|---|---|---|
| **STEP 8 (seq 009)** | `08a_009_enum_add_only.sql` + `08b_009_status_data_update.sql` | PG forbids `ALTER TYPE ADD VALUE` and use of that value in the same transaction. |

No other sections required splitting. Sections 045 (`contract_role`
extension) and 046 (`claim_status` 7-value extension) were re-audited
during the v2.4 build — every post-`ADD VALUE` reference is inside a
`pg_enum`-lookup `WHERE t.typname = … AND e.enumlabel = …` (string
comparison, never an enum cast), so they are safe to keep as single
files.

## 5. Validation checks performed

All checks passed (`PASS`). Run by an in-place Python script over the
section folder:

| Check | Result |
|---|---|
| No bare `STEP <n>` lines as executable SQL (only as `--` comments) | PASS |
| No NUL or control bytes (excl. tab/LF/CR) in any file | PASS |
| No production project ref `ngwxlockzkjpmzuvgakx` leaked outside comments / pre-flight string | PASS |
| No file targets the production project | PASS |
| No file contains `ALTER TYPE ADD VALUE` followed by an enum-literal `UPDATE` in the same transaction | PASS |
| Every expected order slot covered (`00`, `01`–`48` minus `08`, `08a`, `08b`, `99`) — no duplicates, no gaps | PASS |
| `99_staging_schema_verification.sql` exists | PASS |
| All three SKIPPED markdown notes present | PASS |
| `README_EXECUTION.md` present | PASS |
| `execution_checklist.csv` present | PASS |
| `npm run verify:repo-path` | PASS (errors=0, warnings=0) |

## 6. File listing (top-level sort)

```
00_preflight_guard.sql
01_001_base_schema.sql
02_002_step0_fixes.sql
03_003_change_orders_and_hardening.sql
04_004_contract_templates_and_progress_models.sql
05_006_convera_users_otp.sql
06_007_contract_amendments_enhancement.sql
07_008_invoice_attachment_governance.sql
08a_009_enum_add_only.sql
08b_009_status_data_update.sql
09_010b_user_contracts.sql
10_011_fix_rls_returned_statuses.sql
…
44_s001_seed_profiles.sql
45_s002_seed_contracts.sql
46_s003_seed_convera_users.sql
47_s004_seed_supabase_auth_users.sql
48_s005_seed_test_users_cmh.sql
99_staging_schema_verification.sql

SKIPPED_010_production_schema.md
SKIPPED_015_fix_contract_231001101771_templates.md
SKIPPED_018_revert_staff_grade3_rows.md

README_EXECUTION.md
SPLIT_PACKAGE_REPORT.md   ← this file
execution_checklist.csv
```

## 7. Exact next operator instruction

1. **Verify URL.** Open the Supabase SQL Editor on
   `jrqkzwacerdudmeacvar` (CONVERA-STAGING). The address bar must
   contain that ref. If it contains `ngwxlockzkjpmzuvgakx`, close the
   tab and switch projects.
2. **Pre-check.** Run:
   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```
3. Decide entry point:
   - `0` → start at `00_preflight_guard.sql`.
   - `≥ 25` (your earlier v2.3 attempt committed STEPs 1–7 cleanly)
     → resume at `08a_009_enum_add_only.sql`.
   - Anything else → run the reset snippet in `README_EXECUTION.md`
     (DROP SCHEMA + GRANT) and start at `00_preflight_guard.sql`.
4. **Apply files in order**, one Run-button submission at a time. Stop
   on the first error and report it back. Do not re-paste files that
   already succeeded.
5. **After file 48 succeeds**, run
   `99_staging_schema_verification.sql` and paste the row output back.
   Phase 8 (the CMH_01 data import) does **not** start until that
   output is confirmed clean.
