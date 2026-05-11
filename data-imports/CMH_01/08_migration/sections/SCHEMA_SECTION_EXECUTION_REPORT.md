# CMH_01 Staging Schema Execution Report

> **Status:** STOPPED at Section 09 — section defect (PG `22P02`, invalid uuid syntax for empty string).
> **Sections committed to staging:** 00, 01, 02, 03, 04, 05, 06, 07, 08a, 08b (10 of 52).
> **Sections pending:** 09 → 48_s005, plus 99_staging_schema_verification.sql (42 of 52).
> **No production touched. No CMH_01 import run. No git push.**

---

## Target & safety

| | |
|---|---|
| **Target Supabase project ref** | `jrqkzwacerdudmeacvar` (CONVERA-STAGING) — **CONFIRMED** |
| **Forbidden ref (production)** | `ngwxlockzkjpmzuvgakx` — **NOT touched** |
| **Visual confirmation** | Studio breadcrumb showed `MOMAH > CONVERA-STAGING`; tab URL contained `jrqkzwacerdudmeacvar`; URL never contained `ngwxlockzkjpmzuvgakx`. |
| **Server-side confirmation** | `SELECT current_database()` returned `postgres` on the staging cluster; pre-check returned `public_table_count = 0`. |

## Execution method used

**Method 2 — Direct Studio request, via the existing authenticated browser session.**

Specifically, the orchestrator called Supabase Studio's internal `pg-meta/query` endpoint through a per-session-bound browser-side runner (`window.__runSql`). This is the same endpoint Studio's "Run" button calls. The runner:

- read the existing Studio session's Bearer + connection-encrypted headers from the page's authenticated context (no exfiltration to logs/chat);
- guarded each call with a string check rejecting any URL containing the production ref `ngwxlockzkjpmzuvgakx`;
- returned only structured `{status, ok, isErr, code, message, hint, rows, head}` summaries — never the raw response.

Method 1 (Monaco editor click-and-paste) was validated end-to-end on Section 00 first, but Method 2 was used for Sections 01-08b for speed and to avoid creating ~50 phantom auto-saved query entries in the user's sidebar. Method 3 (psql / Supabase CLI) was unavailable: neither was installed in the sandbox, and `.env.local` carries only the JWT publishable + service-role keys — no DATABASE_URL or DB password and no Supabase Personal Access Token. Method 4 (operator-run helper script) was therefore not generated; if you want one as a portable fallback, say the word and I will write `_TOOLS/apply_staging_sections.mjs`.

## Pre-check result

```
SELECT current_database(), current_user, inet_server_addr()::text,
       (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public');
→ db=postgres, user=postgres, public_table_count=0
```

Clean staging. No reset (no `DROP SCHEMA public CASCADE`) was performed because `public_table_count = 0` already.

## Per-file run log

| # | File | Status | Notes |
|---|---|---|---|
| 00 | `00_preflight_guard.sql` | ✅ success | Success. No rows returned. |
| 01 | `01_001_base_schema.sql` | ✅ success | Foundational schema (extensions, 7 enums, 11 core tables, RLS, views). |
| 02 | `02_002_step0_fixes.sql` | ✅ success | Step-0 fixes + Storage buckets. |
| 03 | `03_003_change_orders_and_hardening.sql` | ✅ success | `change_orders` family + workflow + RLS. |
| 04 | `04_004_contract_templates_and_progress_models.sql` | ✅ success | `contract_boq_templates`, `contract_staff_templates`, `boq_progress_model` enum. |
| 05 | `05_006_convera_users_otp.sql` | ✅ success | `convera_users` + OTP table. |
| 06 | `06_007_contract_amendments_enhancement.sql` | ✅ success | Amendments enhancement. |
| 07 | `07_008_invoice_attachment_governance.sql` | ✅ success | Invoice attachment governance. |
| 08a | `08a_009_enum_add_only.sql` | ✅ success | `ALTER TYPE … ADD VALUE` only — its own submission (avoids PG 55P04). |
| 08b | `08b_009_status_data_update.sql` | ✅ success | Guarded UPDATEs (no-ops on fresh staging — old labels never existed). |
| **09** | **`09_010b_user_contracts.sql`** | **❌ FAILED** | **PG `22P02` — see below.** |
| 10–48, 99 | (47 files) | ⏸ pending | Not attempted. |

## First (and only) error — Section 09

**File:** `09_010b_user_contracts.sql`
**Source migration:** `migrations/010_user_contracts.sql`
**Order in package:** STEP 9 of 48
**HTTP status from pg-meta:** `400`
**Postgres code:** `22P02` (invalid_text_representation)
**Postgres message:**

```
ERROR:  invalid input syntax for type uuid: ""
LINE 54:   AND external_user_id != ''::uuid
                                   ^
```

**Offending block** (lines 86–91 of the section file):

```sql
INSERT INTO user_contracts (user_id, contract_id)
SELECT external_user_id, id
FROM contracts
WHERE external_user_id IS NOT NULL
  AND external_user_id != ''::uuid              -- <<< parse-time error
ON CONFLICT (user_id, contract_id) DO NOTHING;
```

**Diagnosis.** The literal `''::uuid` is rejected by Postgres at parse time, regardless of whether any row would ever satisfy the predicate. `contracts.external_user_id` is typed `UUID` (defined in Section 01), so it can never hold an empty string anyway — the `!= ''::uuid` predicate is a legacy artefact from when the column was likely `TEXT`. Because Studio wraps each Run in a single transaction, the entire Section 09 (the `CREATE TABLE user_contracts`, indexes, RLS policies, view, function, **and** both data-migration `INSERT … SELECT` blocks) is rolled back together. No partial `user_contracts` table exists in staging.

**Verification of clean rollback:**

```
table_count        = 19   (≥ 11 from §01 + 1 (change_orders) + 1 (contract_amendments)
                            + 2 (contract_*_templates from §04) + 1 (convera_users from §05)
                            + 1 (otp_codes from §05) + storage internals etc. = 19)
has_user_contracts = false
has_contracts      = true
has_change_orders  = true
has_convera_users  = true
enum_count         = 8    (from §01 7 enums + §04 boq_progress_model = 8)
```

**Recommended fix (bundle-source, NOT in the section file).** Either:

1. **Drop the predicate.** `external_user_id` is UUID-typed; `IS NOT NULL` is sufficient. Source-side patch in `migrations/010_user_contracts.sql`:

   ```diff
   - WHERE external_user_id IS NOT NULL
   -   AND external_user_id != ''::uuid
   + WHERE external_user_id IS NOT NULL
   ```

2. Or, if you want belt-and-braces in case any downstream UUID column was ever defined permissively:

   ```diff
   -   AND external_user_id != ''::uuid
   +   AND external_user_id::text <> ''
   ```

   …but this is also unnecessary on a clean schema and noisy. Option 1 is preferred.

After the source patch, **re-generate the split package** so `09_010b_user_contracts.sql` carries the fix (per README: "fixes are applied at the bundle/source level so they survive future rebuilds"), then resume execution from Section 09.

In line with strict rule 9 ("Do not modify SQL section files unless a SQL error proves a section defect") **and** the README direction not to in-place patch the section, **no SQL file in this package was modified by the orchestrator.**

## CSV / report state

- `execution_checklist.csv` — rows 00–08b flipped to `success` with operator timestamps; row 09 flipped to `failed` with a one-line failure reason; rows 10–99 remain `pending`.
- `SCHEMA_SECTION_EXECUTION_REPORT.md` — this file.

## Strict-rule confirmations

| Rule | Confirmation |
|---|---|
| 1. Did not touch production | ✅ All calls bound to ref `jrqkzwacerdudmeacvar`; runner explicitly aborts on any URL containing `ngwxlockzkjpmzuvgakx`. |
| 2. Did not use `ngwxlockzkjpmzuvgakx` | ✅ Verified by URL check before every `__runSql` call. |
| 3. Did not run Phase 8 data import | ✅ |
| 4. Did not import CMH_01 claims | ✅ |
| 5. Did not run `import-cmh01-controlled.js` | ✅ |
| 6. Did not expose secrets | ⚠ See "Out-of-band finding" below — orchestrator did NOT echo the runtime Bearer / `x-connection-encrypted` headers used by `__runSql`. |
| 7. Did not push | ✅ No `git push`. |
| 8. Stopped on first real SQL error | ✅ Stopped at Section 09. |
| 9. Did not modify SQL section files | ✅ All 51 section files are untouched. The CSV and this report are the only files written. |
| 10. Recorded everything in this report | ✅ |

## Out-of-band finding (security)

While inspecting `.env.local.example` to determine whether a DATABASE_URL was available for Method 3, the orchestrator observed that the file (which **is** tracked in git, last touched in commit `854c7d3` titled "chore: finalize auth diagnostics and env example cleanup") contains what appears to be a **real** `SUPABASE_SERVICE_ROLE_KEY` value (`<server-side secret key>`) instead of a placeholder. Recommendation: rotate the service-role key in Supabase, replace the value in `.env.local.example` with a placeholder string, and verify the publishable key in the same file is intentional. This is not blocking the schema migration; flagged for awareness.

## What's next

You decide:

- **(a)** Patch `migrations/010_user_contracts.sql` source (option 1 above), regenerate the split package so `09_010b_user_contracts.sql` carries the fix, and re-invoke the orchestrator to resume from Section 09.
- **(b)** Have me write a portable Method-4 helper script (`_TOOLS/apply_staging_sections.mjs`) that an operator can run locally with a `STAGING_DB_URL` env, with prod-ref refusal hard-wired.
- **(c)** Both (a) and (b).

## Phase 8 readiness

**Not ready.** `99_staging_schema_verification.sql` was not run (it cannot pass while `user_contracts` and 39 subsequent migrations are missing). Phase 8 dry-run is **blocked** until Section 09 onwards complete cleanly.

---

## Commit status

The orchestrator attempted to commit (`data-import: record CMH_01 split schema execution`) but was blocked by stale `.git/index.lock` and `.git/HEAD.lock` files dated 2026-05-07 13:19 that the sandbox could not clear (FUSE / Windows file-handle restriction — `mv` succeeded once, but the lock kept regenerating because something on the host has the handle open). The two deliverable files are saved to disk in their final form; please commit them yourself locally with:

```bash
cd C:\Users\Administrator\Desktop\convera-platform
git add data-imports/CMH_01/08_migration/sections/SCHEMA_SECTION_EXECUTION_REPORT.md \
        data-imports/CMH_01/08_migration/sections/execution_checklist.csv
git commit -m "data-import: record CMH_01 split schema execution"
```

(Do NOT add `.env.local.example` to that commit — it has working-tree modifications that contain real-looking keys; address those separately per the security note above.)

---

*Report written 2026-05-08. Operator: Claude (Cowork mode). Branch: `main` (no commits made by orchestrator).*
