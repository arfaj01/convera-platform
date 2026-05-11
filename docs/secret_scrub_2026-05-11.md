# Tracked-Secret Scrub Event — 2026-05-11

> **Mode:** read-only on production; file-system edits limited to scrubbing values in three repo files plus this report. No DB change, no Auth Admin call, no push.

## 1. Trigger

Post-push secret scan flagged three TRACKED files on `origin/main` as containing real-secret patterns:

- `.env.example`
- `.env.local.example`
- `DEPLOYMENT.md`

Each was reported as containing one or more of: a real server-side secret key value, a real publishable/anon key value, and the old bootstrap-password literal.

## 2. Classification (no value print)

Structural inspection on disk confirmed the following exposure categories (file / line / category — no values shown):

| File | Line | Key | Category | Outcome |
|---|---|---|---|---|
| `.env.example` | 11 | anon key | `<publishable-or-anon-key-placeholder>` style placeholder needed | rewritten |
| `.env.example` | 14 | service role (commented) | real-looking secret string | rewritten to `<server-side-secret-placeholder>` |
| `.env.local.example` | 16,17 | project URL | real project URL | rewritten to `<project-ref>` placeholder |
| `.env.local.example` | 21 | anon key | placeholder containing the publishable-prefix substring | rewritten to `<publishable-or-anon-key-placeholder>` |
| `.env.local.example` | 25 | service role | real-looking secret string | rewritten to `<server-side-secret-placeholder>` |
| `.env.local.example` | 29 | platform URL | placeholder safe; left as-is |
| `DEPLOYMENT.md` | 69 | example env-table row | literal prefix substring | rewritten to `<publishable-or-anon-key-placeholder>` |
| `DEPLOYMENT.md` | 105 | bootstrap-password checklist | <old bootstrap password redacted> | rewritten to `<rotated / do not use — see docs/secret_rotation_runbook.md>` |
| `DEPLOYMENT.md` | 118–123 | user table (×6 rows) | <old bootstrap password redacted> | rewritten to `<rotated / do not use — see docs/secret_rotation_runbook.md>` (×6) |

The two real server-side secret values in the env-example files were the **same** literal. One single value was therefore exposed in two places.

## 3. Scrub method

Surgical text replacement via the host-aware Edit tool, using placeholder strings that contain **no** prefix substrings the scanner targets:

- `<publishable-or-anon-key-placeholder>` for any publishable / anon-key field
- `<server-side-secret-placeholder>` for any service-role field
- `<project-ref>` inside the URL host
- `<rotated / do not use — see docs/secret_rotation_runbook.md>` for the old bootstrap-password literal in DEPLOYMENT.md

`.env.local` (gitignored at `.gitignore:12 — .env*.local`) was **NOT** touched — operator-local-only file.

## 4. Post-scrub verification

Direct grep against six scanner literals on the four files (file / pattern / count):

| Pattern (substring) | `.env.example` | `.env.local.example` | `DEPLOYMENT.md` | `docs/secret_scrub_2026-05-11.md` |
|---|---:|---:|---:|---:|
| <publishable-prefix substring> | 0 | 0 | 0 | 0 |
| <secret-prefix substring> | 0 | 0 | 0 | 0 |
| service-role = <legacy JWT prefix> | 0 | 0 | 0 | 0 |
| service-role = <secret-prefix substring> | 0 | 0 | 0 | 0 |
| <old bootstrap password> | 0 | 0 | 0 | 0 |
| <old bootstrap password + extra digit> | 0 | 0 | 0 | 0 |

The repo's own scanner cannot enumerate via git in this sandbox (FUSE-mounted Windows path → corrupt git index). The per-file grep above is the reliable check; the operator's Windows `findstr` command should now return no output.

## 5. Files staged for commit

```
.env.example
.env.local.example
DEPLOYMENT.md
docs/secret_scrub_2026-05-11.md
```

`.env.local`, `prod-temp.env.txt`, any temporary password CSVs are excluded by `.gitignore` and would not be candidates.

## 6. Commit message

```
chore(security): scrub exposed env examples and bootstrap password references
```

## 7. Host-side commit commands

Sandbox cannot acquire `.git/index.lock` and cannot rebuild the corrupt index. The operator runs these in PowerShell on the host:

```powershell
cd C:\Users\Administrator\Desktop\convera-platform

git reset HEAD -- .
git add -- .env.example .env.local.example DEPLOYMENT.md docs/secret_scrub_2026-05-11.md

git diff --cached --name-only
# Expect:
#   .env.example
#   .env.local.example
#   DEPLOYMENT.md
#   docs/secret_scrub_2026-05-11.md

git commit -m "chore(security): scrub exposed env examples and bootstrap password references"

# DO NOT push yet — wait for explicit operator approval after key rotation.
```

## 8. Server-side key rotation — REQUIRED (the old secret value was pushed to origin/main)

The old service-role value was committed to GitHub history. Even after the scrub commit, the historical value remains retrievable via `git log -p` or `git show <past-sha>`. **Treat that old value as compromised and rotate it.**

### Steps (operator, in Supabase Studio + Vercel)

1. **Generate a new server-side secret in Supabase.** Studio → project `ngwxlockzkjpmzuvgakx` (CONVERA / main · PRODUCTION) → **Project Settings → API → Secret keys** → **+ Generate new secret key**. Copy the new value into a vault (1Password / similar). Do **not** paste it anywhere committable.
2. **Update Vercel.** Vercel project (convera-platform) → **Settings → Environment Variables** → `SUPABASE_SERVICE_ROLE_KEY` → **Edit** → paste the new value → save (Production scope at minimum; Preview / Development if those scopes use it). Other env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) do **not** change.
3. **Redeploy.** Vercel → **Deployments** → latest → ⋯ → **Redeploy**. Wait for Ready.
4. **Smoke-test post-redeploy.**
   - `/login` — sign in with a known user; expect dashboard load (anon-key path).
   - `/dashboard` — KPI cards load (anon-key path + RLS).
   - One **server-side path** that uses the service-role key — for example a workflow transition, a privileged report, or an admin-style read served by a `/api/*` Next.js route. Confirm 200 and no auth errors in the Vercel runtime logs.
5. **Revoke the old key.** Studio → **Project Settings → API → Secret keys** → the OLD key → **Disable / Delete**. This invalidates any traffic still using the historical value.
6. **Keep the legacy JWT unchanged.** Auth Admin endpoints are still under support investigation (see `docs/supabase_support_ticket_auth_admin_500.md`). Rolling the legacy JWT before that ticket resolves would add a second moving variable.

> When rotation is done, push the cleanup commit (step §7). The GitHub history will still contain the old key, but with the key disabled at Supabase it is no longer usable.

## 9. User-password rotation — still pending; do NOT use Auth Admin

The <old bootstrap password redacted> value is in GitHub history for 6 user rows in `DEPLOYMENT.md`. Even after the scrub commit, that history is permanent.

- **Auth Admin script (`scripts/rotate-user-passwords.js`)** — still blocked by the open Supabase Auth Admin HTTP 500 issue. Do **not** run.
- **Recommended paths (when ready):**
  1. **Studio password-recovery emails.** Studio → Authentication → Users → for each of the 6 users → ⋯ → **Send password recovery email**. User clicks the link → sets a new password → the old value becomes inert for them.
  2. **OR: wait for Supabase Support** to resolve the Auth Admin 500 → then run the existing rotation script with `BOOTSTRAP_PASSWORD` env-injection.
  3. **OR: manual reset in Studio** — Authentication → Users → ⋯ → **Reset password** (if the UI offers it for the current Supabase version).

The cleanup commit is **not** blocked on password rotation — the literal is already exposed; further exposure is what the scrub prevents going forward.

## 10. Confirmations

| Item | Status |
|---|---|
| Production database mutated? | ❌ No. |
| CMH_01 status flip run? | ❌ No. |
| Phase 9 (documents) run? | ❌ No. |
| Imports run? | ❌ No. |
| `auth.users` touched? | ❌ No. |
| Passwords rotated? | ❌ No (Auth Admin still under investigation). |
| Supabase keys rotated? | ❌ Not yet — operator action required per §8. |
| Push performed? | ❌ No. |
| Files staged for cleanup commit | `.env.example`, `.env.local.example`, `DEPLOYMENT.md`, `docs/secret_scrub_2026-05-11.md` |
| Real-secret content in 4 scrubbed files | **zero** (verified by direct grep against all six scanner literals). |

## 11. Out-of-scope but noted (no action this commit)

The <old bootstrap password redacted> also appears in 7 working-tree-only files:

- `docs/credential_rotation_execution_report.md`
- `docs/low_effort_improvement_backlog.md`
- `docs/patches/seed_sql_password_parameterization_plan.md`
- `docs/platform_safety_findings.md`
- `docs/secret_rotation_runbook.md`
- `docs/setup-precommit.md` (also contains a real-looking secret-key literal)
- `scripts/rotate-user-passwords.js` (intentional FORBIDDEN-set entry — protects rotation script from accepting the old value as a new password)

Per operator scope, those are deferred — not the immediate post-push emergency. A future commit can scrub them with the same approach. None of those files are being staged in this cleanup commit.
