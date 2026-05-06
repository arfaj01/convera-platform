# CMH_01 Phase 8 — STAGING SETUP REQUIRED (BLOCKER)

> Authored 2026-05-06. Documents why CMH_01 Phase 8 (controlled migration) is **not running**, what is missing, and the exact (non-secret) information the operator must provide before any database write can occur.

---

## 1. Status: BLOCKED at the staging-environment gate

Phase 8 is **fully prepared** on the engineering side:

- Phases 1–7 have been completed and committed: file inventory, classification, structured extraction from `CMH_01_SMART.xlsx`, normalization to platform schema, validation reports, import plan, and a clean dry-run.
- The driver script `scripts/import-cmh01-controlled.js` exists and is operator-driven (per-claim ENTER pause, advisory-lock-friendly, only writes via official platform APIs — never raw SQL, never legacy `_ETL/migrate.py`).
- The Phase-8 approval gate has been satisfied (`CLAIM_15_DECISION: option-b-header-only`).

**However**, no run can be initiated, because there is no confirmed **staging** environment configured. The repository's `.env.local` currently reflects production. Phase 8's mission rule is unambiguous: **STAGING ONLY, never production.**

---

## 2. Exact reasons execution is refused

### 2.1 The configured Supabase URL is the production project

`.env.local` currently contains:

```
NEXT_PUBLIC_SUPABASE_URL = https://ngwxlockzkjpmzuvgakx.supabase.co
```

This is the same URL that `CLAUDE.md §15` documents as the platform's primary Supabase instance — i.e. the production project. The Phase-8 driver explicitly refuses production-looking URLs unless an explicit `--i-acknowledge-this-is-staging` flag is set, and even with that flag the operator policy in this repository is **never run Phase 8 against production**.

### 2.2 The service-role key is a placeholder

`.env.local` currently contains:

```
SUPABASE_SERVICE_ROLE_KEY = ضع_هنا_service_role_key
```

This Arabic placeholder ("put service_role_key here") is not a real key. The script will not run a non-dry-run without this populated.

### 2.3 `PLATFORM_BASE_URL` is absent

The driver expects a base URL to call into (`http://localhost:3000` for a local instance, or the staging app's domain). It is missing from `.env.local`.

### 2.4 No staging Supabase project is identified anywhere in the repo

Searches across `.env*`, `scripts/`, `SQL/`, `data-imports/`, and `logs/` find **no** alternative Supabase URL such as `*-staging.supabase.co` or a separate project ref. There is no stored evidence that a staging project exists.

---

## 3. What the operator must provide (non-secret fields only)

To unblock Phase 8 execution, the operator must populate `.env.local` with values that satisfy **all** of:

1. `NEXT_PUBLIC_SUPABASE_URL` (and/or `SUPABASE_URL`) → the URL of a Supabase project that the operator has **explicitly confirmed in writing** is staging. It must NOT be `ngwxlockzkjpmzuvgakx.supabase.co`. See the template at `data-imports/CMH_01/08_migration/staging_env_template.txt`.
2. `SUPABASE_SERVICE_ROLE_KEY` → a real service-role key issued by that staging project. (Never paste into chat. Paste into `.env.local` only.)
3. `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the staging project's anon key (only required if the dev server will be started; not required for the import script itself).
4. `PLATFORM_BASE_URL` → typically `http://localhost:3000` once the dev server is running locally against the staging DB, or the deployed staging app's URL.
5. `TEST_USER_PASSWORD` → the bootstrap password expected by `scripts/create-test-auth-users.js` (only required for the optional auth-user seed step).

**The operator must paste these values themselves.** The agent will not retrieve service-role keys, log into the Supabase dashboard, or otherwise extract credentials from the user's account.

---

## 4. Acceptance gate before any DB write

The helper script `scripts/check-cmh01-env.js` is the single source of truth for "is the environment safe to run Phase 8 against?". It is fast, read-only, and prints **only masked status** (never the secret values themselves).

**No Phase-8 execution is permitted unless `node scripts/check-cmh01-env.js` exits 0.**

The check enforces:

- Required variables are present (`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PLATFORM_BASE_URL`).
- None of those variables is a known placeholder (Arabic `ضع_هنا_*`, English `<replace-me>`, `your_*`, `xxxxxx`, etc.).
- The Supabase URL is **not** the known production project ref `ngwxlockzkjpmzuvgakx`.
- The Supabase URL ends with `.supabase.co` and parses as a valid `https://...` URL.
- The service-role key looks like a JWT (three dot-separated base64url segments) without printing it.

The check is expected to **fail on a fresh repo** until the operator populates real staging values; that is the documented safe state.

---

## 5. What is NOT being done while Phase 8 is blocked

To make the blocker contract explicit:

- No DB write of any kind has been performed.
- No SQL has been executed (no migrations applied, no manual `INSERT`, no diagnostic queries).
- No `git push` has been performed; commits are local-only.
- No production Supabase URL has been contacted.
- No service-role key has been retrieved, displayed, or transmitted.
- No browser automation has been used to harvest credentials from the operator's Supabase dashboard.
- The legacy `_ETL/migrate.py` toolkit remains untouched (and is excluded by Phase-4's normalization design — see `data-imports/CMH_01/00_inventory/F1_RECOVERY_CHECKLIST.md` §5).

---

## 6. How to unblock (operator runbook)

1. Open or create a **staging** Supabase project (separate from `ngwxlockzkjpmzuvgakx`).
2. Apply the platform's migrations to that staging DB (003 → 050 in `SQL/migrations/`), then the seeds in `SQL/seeds/`. *(That work is out of scope for the agent and not done in this package.)*
3. Open `data-imports/CMH_01/08_migration/staging_env_template.txt`. Paste each placeholder value into `.env.local` with the staging project's real values.
4. Run `node scripts/check-cmh01-env.js`. Expect exit 0 and `OK` for every line. If any line reports `MISSING` or `PLACEHOLDER` or `PROD-LOOKING`, fix it before continuing.
5. Start the platform locally: `npx next dev --port 3000`. Wait for it to compile and serve.
6. Run `node scripts/import-cmh01-controlled.js --dry-run`. Expect a clean, no-error report.
7. Only after all of the above are green, run the controlled migration:
   ```
   node scripts/import-cmh01-controlled.js \
     --confirm "PROCEED CMH_01" \
     --i-acknowledge-this-is-staging
   ```
8. The script will pause for ENTER between every claim. The operator may abort at any point.

---

## 7. Files in this readiness package

- `data-imports/CMH_01/08_migration/STAGING_SETUP_REQUIRED.md` — this document.
- `data-imports/CMH_01/08_migration/staging_env_template.txt` — placeholder env template, paste-ready.
- `scripts/check-cmh01-env.js` — staging-environment safety gate. Required to pass before Phase 8.
- Updated `data-imports/CMH_01/05_import_plan/controlled_migration_runbook.md` — Pre-flight step now references `check-cmh01-env.js` as a hard gate.

This package contains **only documentation and helper scripts**. No DB writes, no SQL, no production calls, no `git push`.
