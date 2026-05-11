# Tracked-Secret Scrub Event — 2026-05-11

> **Mode:** read-only on production; file-system edits limited to scrubbing values in three repo files. No DB change, no Auth Admin call, no push.

## 1. Trigger

Post-push secret scan flagged three TRACKED files on `origin/main` as containing real-secret patterns:

| File | Patterns reported by external scan |
|---|---|
| `.env.example` | LEGACY_SECRET_ENV, REAL_SB_SECRET |
| `.env.local.example` | LEGACY_SECRET_ENV, REAL_SB_SECRET |
| `DEPLOYMENT.md` | OLD_BOOTSTRAP_PASSWORD |

## 2. Classification (no value print)

Performed structural inspection on disk. Confirmed real-secret content:

| File | Line | Key | Pattern | Outcome |
|---|---|---|---|---|
| `.env.example` | 11 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_<your-anon-key>` | already placeholder — left as-is |
| `.env.example` | 14 | `# SUPABASE_SERVICE_ROLE_KEY` (commented) | `sb_secret_` real-looking | **SCRUBBED** |
| `.env.local.example` | 16,17 | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` | placeholder `YOUR_PROJECT_REF` | already placeholder — left as-is |
| `.env.local.example` | 21 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_PLACEHOLDER` (11-char literal) | placeholder — left as-is |
| `.env.local.example` | 25 | `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_` real-looking | **SCRUBBED** |
| `.env.local.example` | 29 | `PLATFORM_BASE_URL` | example.com placeholder | already placeholder — left as-is |
| `DEPLOYMENT.md` | 105 | bootstrap-pwd checklist | 10-digit literal | **SCRUBBED** |
| `DEPLOYMENT.md` | 118–123 | user table (×6 rows) | 10-digit literal | **SCRUBBED ×6** |

Both real `sb_secret_…` values in the two env-example files were the **same** literal value. One single secret was therefore exposed in two places.

## 3. Scrub actions applied

Two `sed -i` passes plus a third for the bootstrap password:

```bash
# All real sb_secret values → placeholder
sed -i 's|sb_secret_[A-Za-z0-9_-]\{8,\}|sb_secret_<rotated-see-docs/secret_rotation_runbook.md>|g' .env.example .env.local.example

# Defence-in-depth on real sb_publishable values (only matches 16+ char real keys; placeholders like sb_publishable_PLACEHOLDER are 11 chars and unaffected)
sed -i 's|sb_publishable_[A-Za-z0-9_-]\{16,\}|sb_publishable_<rotated-see-docs/secret_rotation_runbook.md>|g' .env.example .env.local.example

# Bootstrap-password literal (10-digit in backticks) → placeholder
sed -i 's|`[0-9]\{10\}`|`<rotated / do not use — see secret_rotation_runbook.md>`|g' DEPLOYMENT.md
```

`.env.local` (gitignored at `.gitignore:12 — .env*.local`) was **NOT touched** — operator's local-only file, per scope rules.

## 4. Post-scrub verification

Direct grep against four hit patterns on the three scrubbed files:

| Pattern | `.env.example` | `.env.local.example` | `DEPLOYMENT.md` |
|---|---:|---:|---:|
| `sb_secret_[A-Za-z0-9_-]{16,}` (real key) | 0 | 0 | 0 |
| `sb_publishable_[A-Za-z0-9]{20,}` (real key) | 0 | 0 | 0 |
| `eyJ…\.…\.…` (legacy JWT) | 0 | 0 | 0 |
| `[0-9]{10}` (10-digit run anywhere) | 0 | 0 | 0 |

The repo's own scanner cannot enumerate via `--all` in this sandbox (git index is corrupt on the FUSE-mounted Windows path), but the direct grep above is reliable per-file.

## 5. Files staged for commit

```
.env.example
.env.local.example
DEPLOYMENT.md
docs/secret_scrub_2026-05-11.md
```

No other files staged. `.env.local`, `prod-temp.env.txt`, any temporary password CSVs are excluded by `.gitignore` and would not be candidates anyway.

## 6. Commit message

```
chore(security): scrub exposed env examples and bootstrap password references
```

## 7. Host-side commit commands (sandbox cannot acquire git index)

```powershell
cd C:\Users\Administrator\Desktop\convera-platform

git reset HEAD -- .
git add -- .env.example .env.local.example DEPLOYMENT.md docs/secret_scrub_2026-05-11.md

git diff --cached --name-only
# Should print exactly:
#   .env.example
#   .env.local.example
#   DEPLOYMENT.md
#   docs/secret_scrub_2026-05-11.md

git commit -m "chore(security): scrub exposed env examples and bootstrap password references"

# DO NOT push yet — wait for explicit operator approval after key rotation.
```

## 8. Key rotation — REQUIRED (sb_secret was pushed to origin/main)

The `sb_secret` value that was in `.env.local.example` and `.env.example` has been committed to GitHub history. Even after the scrub commit, the historical value remains queryable via `git log -p` or `git show <past-sha>`. **Treat the old key as compromised and rotate.**

### Steps (operator, in Supabase Studio + Vercel):

1. **Generate a new Supabase secret key.** Studio → project `ngwxlockzkjpmzuvgakx` (CONVERA / main · PRODUCTION) → **Project Settings → API → Secret keys** → **+ Generate new secret key**. Copy the new value securely (1Password / your vault). Do **not** paste it anywhere committable.
2. **Update Vercel.** Vercel project (convera-platform) → **Settings → Environment Variables** → `SUPABASE_SERVICE_ROLE_KEY` → **Edit** → paste the new value → save (Production scope at minimum; Preview / Development if those scopes use it). Other env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) do **not** change.
3. **Redeploy.** Vercel → **Deployments** → latest → ⋯ → **Redeploy**. Wait for Ready.
4. **Smoke-test post-redeploy.**
   - `/login` — sign in with a known user; expect dashboard load (anon-key path).
   - `/dashboard` — KPI cards load (anon-key path + RLS).
   - At least one **server-side path** that uses the service-role key — e.g. a workflow transition, a privileged report, or an admin-style read that goes through a `/api/*` Next.js route. Confirm 200 and no auth errors in the Vercel runtime logs.
5. **Revoke the old secret key.** Back in Supabase Studio → **Project Settings → API → Secret keys** → the OLD key → **Disable / Delete**. This invalidates any traffic still using the historical value.
6. **Keep legacy JWT unchanged** (`service_role` legacy JWT) — Auth Admin endpoints are still under support investigation (see `docs/supabase_support_ticket_auth_admin_500.md`). Rolling the legacy JWT before that ticket resolves would add a second moving variable.

> When rotation is done, push the cleanup commit (step §7) — the GitHub history will still contain the old key, but that key is now disabled at Supabase and no longer usable.

## 9. User-password rotation — still pending, DO NOT use Auth Admin

The bootstrap password (`<BOOTSTRAP-PWD-LITERAL — see secret_rotation_runbook.md>`) is in GitHub history for 6 user rows in `DEPLOYMENT.md`. Even after the scrub commit, the history is permanent. Plan:

- **Auth Admin script (`scripts/rotate-user-passwords.js`)** — still blocked by the open Supabase Auth Admin HTTP 500 issue. Do **not** run.
- **Recommended path (when ready):**
  1. **Studio password-recovery emails.** Studio → Authentication → Users → for each of the 6 users → ⋯ → **Send password recovery email**. User clicks the link → sets a new password → bootstrap value becomes inert for them.
  2. **OR: wait for Supabase Support** to resolve the Auth Admin 500 → then run the existing rotation script with `BOOTSTRAP_PASSWORD` env-injection.
  3. **OR: manual reset in Studio** — Authentication → Users → ⋯ → **Reset password** (if the UI offers it for the current Supabase version).

The cleanup commit is **not blocked** on password rotation — the password is already exposed; further exposure is what the scrub prevents.

## 10. Confirmations

| Item | Status |
|---|---|
| Production database mutated? | ❌ No. |
| CMH_01 status flip run? | ❌ No. |
| Phase 9 (documents) run? | ❌ No. |
| Imports run? | ❌ No. |
| `auth.users` touched? | ❌ No. |
| Passwords rotated? | ❌ No (Auth Admin still under investigation; recommended path documented in §9). |
| Supabase keys rotated? | ❌ Not yet — operator action required per §8. |
| Push performed? | ❌ No. |
| Files staged for cleanup commit | `.env.example`, `.env.local.example`, `DEPLOYMENT.md`, `docs/secret_scrub_2026-05-11.md` |
| Real-secret content in 3 scrubbed files | **zero** (verified by direct grep). |

## 11. Out-of-scope but noted (no action this commit)

The literal `<BOOTSTRAP-PWD-LITERAL — see secret_rotation_runbook.md>` also appears in 7 untracked/working-only files:
- `docs/credential_rotation_execution_report.md`
- `docs/low_effort_improvement_backlog.md`
- `docs/patches/seed_sql_password_parameterization_plan.md`
- `docs/platform_safety_findings.md`
- `docs/secret_rotation_runbook.md`
- `docs/setup-precommit.md` (also contains an `sb_secret_` real-looking literal)
- `scripts/rotate-user-passwords.js` (intentional FORBIDDEN-set entry)

Per operator scope, those are deferred — not the immediate post-push emergency. A future commit can scrub them with the same `sed` pattern. None of those files are being staged in this cleanup commit.
