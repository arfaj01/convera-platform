# CONVERA — Platform Safety Findings

> **Date:** 2026-05-10 (revised after Production Stabilization Sprint P1)
> **Operator:** Claude (Cowork mode), read-only assessment
> **Scope:** active repo `convera-platform/` + Supabase production (`ngwxlockzkjpmzuvgakx`) + Vercel deployment.
> **No production was mutated. No secret values are reproduced in this document.**
> **Sprint actions taken so far:** `.env.local.example` redacted on disk (NOT committed); full inventory of secrets in tracked + untracked files; rotation runbook authored.

---

## 1. Executive summary

Three credential-exposure vectors were found, in increasing order of severity:

1. ✅ **`.env.local.example` working-tree edits introduced real `<publishable key>*` and `<server-side secret key>*` values** — REDACTED on disk by this sprint (not yet committed). Service-role key still must be rotated because it was exposed to anyone with file-system access in the interim.
2. 🚨 **`DEPLOYMENT.md` is already pushed to `origin/main` and pairs real user emails with the shared bootstrap password `<old bootstrap password redacted>`** — this is the most-severe finding because it is **already public** to whoever has access to the GitHub repo (`github.com/arfaj01/convera-platform`).
3. 🚨 **The shared bootstrap password `<old bootstrap password redacted>` is also embedded in three unpushed seed SQL files** (`46_s003_seed_convera_users.sql`, `47_s004_seed_supabase_auth_users.sql`, `staging_schema_bundle.sql`). These are in the 30 commits ahead of `origin/main`. Pushing them would re-emit the password to GitHub even if `DEPLOYMENT.md` gets scrubbed.

Plus three operational/governance items inherited from the read-only assessment that remain open: outstanding-invoices billing banner; Migration 049 not applied to production; `final_approver` enum drift between `user_role` and `contract_role`.

The remainder of this document explains each finding, the current state of mitigation, and the exact remediation steps. The companion `secret_rotation_runbook.md` carries the click-by-click rotation procedure.

---

## 2. Finding 1 — `.env.local.example` real-looking keys (RESOLVED on disk)

### What was found

Working-tree modifications to `.env.local.example` (uncommitted at the time of discovery) had introduced real-looking values for `NEXT_PUBLIC_SUPABASE_ANON_KEY` (an `<publishable key>*` key) and `SUPABASE_SERVICE_ROLE_KEY` (an `<server-side secret key>*` key), pointing at the staging project (`jrqkzwacerdudmeacvar`).

Severity if pushed: **HIGH** — service-role keys bypass RLS.

### What was done by this sprint

- Replaced the file body with a clean placeholder template (no real values). The new file is on disk only and **not staged for commit**. Verified: a re-grep across all tracked and untracked files for `sb_(secret|publishable)_[A-Za-z0-9_-]{20,}` returns ZERO hits.
- Committed values at `HEAD` (file before the working-tree edits) used Arabic placeholders (`ضع_هنا_service_role_key` etc.) and a production-URL example — the URL is non-secret but the pattern is a foot-gun. The new placeholder version uses `YOUR_PROJECT_REF`.

### What still must be done by the operator

- **Rotate `SUPABASE_SERVICE_ROLE_KEY`** in Supabase Studio → Settings → API. Even though the key is no longer in any tracked file, it was on the local disk and may have been observed by anyone with shell access. Treat as compromised. Procedure: see `secret_rotation_runbook.md` §2.
- After rotation, replace the value in your local `.env.local` (which is and always has been gitignored).
- Optionally rotate `NEXT_PUBLIC_SUPABASE_ANON_KEY` too — it is categorically a public key, but if your team's policy is to rotate alongside the service-role key, do so.

---

## 3. Finding 2 — Shared bootstrap password committed in `DEPLOYMENT.md` (PUSHED)

### What was found

`DEPLOYMENT.md` (file is on `origin/main` since at least commit `f6b84d3`) contains 7 occurrences of the literal string `<old bootstrap password redacted>`. The relevant lines pair user emails (e.g. `Ma.Alarfaj@momah.gov.sa`, `halhablayn-Contractor@momah.gov.sa`) with that password as the seed-default for production user accounts.

Severity: **HIGH and ALREADY PUBLIC** to anyone with read access to the GitHub repository at `github.com/arfaj01/convera-platform`. Severity escalates further because the password is also a personal mobile-number-shaped value (Saudi mobile prefix `05`), increasing guessability and potential reuse risk.

### What this sprint did NOT do

- **Did not modify `DEPLOYMENT.md`.** Modifying it now to redact the password would NOT undo the GitHub leak (git history retains it forever unless force-rewritten), and a casual diff observer could compare HEAD vs. previous commits to find the password regardless.
- **Did not modify the production user passwords.** That is a production mutation and requires explicit approval per the sprint's safety rules.

### What must be done by the operator (in this exact order)

1. **Rotate every real user password in production immediately.** Procedure in `secret_rotation_runbook.md` §3. Until this is done, anyone who has read the public DEPLOYMENT.md can attempt to log into the live app as `Ma.Alarfaj` and execute director-level actions.
2. After all real passwords are rotated, scrub `DEPLOYMENT.md` so the next push doesn't re-emit the literal. Replace each occurrence with `<rotated — see secret_rotation_runbook.md>`.
3. (Optional but recommended) Use `git filter-repo` to scrub the password from git history on `origin/main`. This is destructive — coordinate with anyone who has cloned the repo.

---

## 4. Finding 3 — Bootstrap password embedded in unpushed seed SQL

### What was found

The same literal `<old bootstrap password redacted>` appears in:

| File | Hits | On `origin/main`? |
|---|---|---|
| `data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql` | 7 | ❌ NO (in unpushed commits) |
| `data-imports/CMH_01/08_migration/sections/47_s004_seed_supabase_auth_users.sql` | 2 | ❌ NO |
| `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` | 9 | ❌ NO |

Severity: **HIGH if pushed**; currently contained on the operator's local laptop. Pushing the 30 unpushed commits without remediation would publish 18 new occurrences of the password to GitHub.

### What this sprint did NOT do

- **Did not modify any of the three seed SQL files.** The password value is also functionally embedded — the seed creates `auth.users` rows whose `encrypted_password` derives from this literal. Replacing it with a placeholder would either (a) break seed functionality, or (b) silently set users' passwords to the literal string `PLACEHOLDER`.
- The right refactor is to parameterize the seed: read `process.env.TEST_USER_PASSWORD` and template it in via a wrapper script, OR move the seeding to the Supabase admin API (`scripts/create-test-auth-users.js` already does this). That refactor is out of scope for this sprint's safety pass.

### What must be done by the operator (in this exact order)

1. **Do NOT `git push origin main` until the seed-SQL password is parameterized.** This is the single most important safety hold from this sprint.
2. Either:
   - **Option A (lowest-effort):** Use `scripts/create-test-auth-users.js` (which already reads `TEST_USER_PASSWORD` from env) for all future user bootstrap, and then replace the literal in the SQL files with a placeholder. Add a comment pointing to the script. Re-run the seed via the script after rotation.
   - **Option B (more rigorous):** Refactor the SQL to accept a parameter via `psql -v PASSWORD=...` or via a `DO` block that reads `current_setting('custom.test_password')`, then replace the literal.
3. Audit `data-imports/CMH_01/08_migration/_runtime_b64/` (untracked, ~1.9 MB of base64-encoded SQL files) — if any of those base64 blobs decode back to the seed files, they too contain the password. Recommend deleting the entire `_runtime_b64/` directory; it is leftover scratch from a chunking experiment.

---

## 5. Finding 4 — Other inspected files (CLEAN)

| File | Pattern grep | Verdict |
|---|---|---|
| `.env.example` | `<publishable key>` | clean placeholder |
| `DEPLOYMENT.md` (key fields, separate from the password issue above) | `<publishable key>` (with `...` suffix) | clean documentation example |
| `data-imports/CMH_01/08_migration/legacy_vs_current_inventory.md` | mentions secrets exist in legacy `.env.local`, no values | clean documentation |
| `data-imports/CMH_01/08_migration/phase8_script_alignment_report.md` | describes the redaction code | clean documentation |
| `data-imports/CMH_01/08_migration/sections/SCHEMA_SECTION_EXECUTION_REPORT.md` | references the leak structurally | clean (own report) |
| `scripts/check-cmh01-env.js` | regex prefixes `<server-side secret key>*` / `<publishable key>*` | clean (validator code) |
| `scripts/import-cmh01-controlled.js` | redaction patterns for log output | clean (already self-redacts) |
| `app/**/*.ts`, `lib/**/*.ts` | TypeScript `password: string` parameter declarations | false-positive grep hits |

---

## 6. Production-mutation risks observed (open from prior assessment)

The active repo contains scripts that, if pointed at the wrong env, could write to production:

| Script | Risk | Mitigation status |
|---|---|---|
| `scripts/import-cmh01-controlled.js` | Could insert real CMH_01 claims into whichever Supabase project the env points at. | Per-instruction **forbidden to run** in this sprint. Script owns its own env validation but was not audited end-to-end. **Add a `if (SUPABASE_URL.includes('ngwxlockzkjpmzuvgakx')) { throw }` guard at line 1 to refuse production unconditionally.** |
| `scripts/create-test-auth-users.js` (`npm run seed:auth-users`) | Creates Supabase auth users via the admin API. Could create test users in prod if pointed there. | Same recommendation: prod-ref refusal guard. |
| Any `npm run` script touching Supabase | Same. | Same. |

Recommended quick-win helper to import at the top of every Supabase-touching script:

```js
// scripts/_guards/refuse-prod-ref.js
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
if (url.includes('ngwxlockzkjpmzuvgakx')) {
  console.error('[GUARD] Refusing to run against production project ref.');
  process.exit(2);
}
```

---

## 7. Staging gaps (open)

| | |
|---|---|
| **Staging project ref** | `jrqkzwacerdudmeacvar` (CONVERA-STAGING) |
| **Schema state on assessment date** | 19 public tables, 8 enums — equivalent to production through migration 008 (post-section-08b) |
| **Sections committed to staging** | `00, 01, 02, 03, 04, 05, 06, 07, 08a, 08b` |
| **Stopped at** | `09_010b_user_contracts.sql` — defect: `AND external_user_id != ''::uuid` rejected with PG `22P02` |
| **Phase 8 dry-run readiness** | **Not ready**. Verification cannot pass while migrations 09–48 are missing. |
| **Recommended fix** | Drop the `''::uuid` predicate from `migrations/010_user_contracts.sql` source; regenerate the split package; resume from section 09. Full diagnosis in `data-imports/CMH_01/08_migration/sections/SCHEMA_SECTION_EXECUTION_REPORT.md`. |

This sprint did not touch staging.

---

## 8. Deployment / build gaps (open)

- The repo is configured for **both Netlify** (`netlify.toml`) **and Vercel** (`https://convera-platform.vercel.app` is live). Confirm only one is the source of truth.
- `vercel.json` not inspected. Recommend confirming the production env-variable set in Vercel's dashboard matches the new `.env.local.example` placeholder shape.
- CI configuration not inspected. Recommend a `npx tsc --noEmit` step on every PR; the `final_approver` enum drift will surface as a TypeScript error if types are kept current.

---

## 9. Auth / session gaps (open)

- Console warning on every page load: `@supabase/gotrue-js: Lock "lock:sb-ngwxlockzkjpmzuvgakx-auth-token" was not released within 5000ms. … Forcefully acquiring the lock to recover.` Non-fatal but noisy.
- Recommend separate-browser-profile or incognito session for production access during local debugging.

---

## 10. Remediation priority

The bootstrap-password leak (Findings 2 + 3) is the most operationally urgent because it is the only issue that exposes write-equivalent access to anyone with read access to the GitHub repo. Order of operations:

1. **Today (within hours).** Rotate every real user password in production using the procedure in `secret_rotation_runbook.md` §3. Until this is done, anyone with GitHub read can log into the live app.
2. **Today.** Rotate `SUPABASE_SERVICE_ROLE_KEY` (`secret_rotation_runbook.md` §2). Update local `.env.local` only; do NOT commit anything yet.
3. **Today/Tomorrow.** Decide on Option A or B from Finding 4 §4 to handle the seed SQL. Until decided, **do not push** the 30 unpushed commits.
4. **Today.** Resolve the outstanding-invoices billing banner.
5. **This week.** Add the prod-ref-refusal guard to `scripts/import-cmh01-controlled.js`, `scripts/create-test-auth-users.js`, and any other Supabase-touching script.
6. **This week.** After the seed-SQL question is resolved (step 3), perform the secret-safety pre-commit check from §11 below; only then push.
7. **This sprint.** Apply Migration 049 to production after operator review (see `migration_049_production_apply_note.md`).
8. **This sprint.** Fix the `final_approver` enum drift in TS/UI per `final_approver_role_drift_review.md`.
9. **This sprint.** Address staging schema defect at section 09 and resume staging apply.

---

## 11. Pre-commit secret-safety check

Before any future `git add` / `git commit` of the changes from this sprint, run this guard locally:

```bash
# 1. Check that no real-looking Supabase key is staged or in the working tree
git ls-files | xargs grep -lE 'sb_(secret|publishable)_[A-Za-z0-9_-]{20,}' 2>/dev/null
# Expected output: empty

# 2. Check that the bootstrap password literal is not in any newly-staged file
git diff --cached -G '<old bootstrap password redacted>' --name-only
# Expected output: empty (only flags real password leaks; if any file matches, abort)
```

Recommended permanent defense: add a Husky `pre-commit` hook with the same checks (see `low_effort_improvement_backlog.md` item A4).

---

## 12. Confirmation: scope discipline (this sprint)

- ✅ No production data was mutated in any way.
- ✅ No production user passwords were changed by the orchestrator.
- ✅ No CMH_01 import, no Phase 8, no staging-schema bundle execution.
- ✅ No `git push` was performed.
- ✅ No `git commit` was performed in this sprint.
- ✅ No secret VALUES were reproduced in any document. Findings describe structure, location, and severity.
- ✅ The `.env.local.example` redaction modified the file ON DISK ONLY; the change is unstaged and uncommitted.
- ✅ No live forms submitted on the production app.

---

*Companion documents: `current_platform_state_assessment.md`, `low_effort_improvement_backlog.md`, `secret_rotation_runbook.md`, `migration_049_production_apply_note.md`, `final_approver_role_drift_review.md`.*
