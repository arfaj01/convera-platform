# Credential Rotation Execution Report

> **Status:** IN PROGRESS — paused after `--diagnose-auth` confirmed BOTH key formats fail Auth Admin. Now in diagnostic-plan phase.
> **Date:** 2026-05-10
> **Operator:** Mohammed Alarfaj
> **Orchestrator:** Claude (Cowork mode)
> **Target:** Production `ngwxlockzkjpmzuvgakx` (CONVERA / MOMAH / main · PRODUCTION)

This report tracks the production safety rotation workflow end-to-end. It records every action the orchestrator took or guided, every approval phrase received, every failure encountered, and every safety guard that fired. **No secret values appear in this document.**

---

## 1. Timeline (high-level)

| When | Stage | Result |
|---|---|---|
| 2026-05-10 — Sprint A (this conversation) | Part A — env-var inventory | ✓ identified app uses legacy var names with new key formats |
| 2026-05-10 | Part B — open Supabase Studio production API Keys | ✓ confirmed CONVERA · PRODUCTION |
| 2026-05-10 | Operator created new `<server-side secret key>*` in Supabase | ✓ "service_role_v2" (operator's choice) |
| 2026-05-10 | Operator pasted into Vercel `SUPABASE_SERVICE_ROLE_KEY` | ✓ Save succeeded; value masked |
| 2026-05-10 | Vercel redeploy `219u17mCV` | ✓ Ready · 52s build · Current |
| 2026-05-10 | Live-app smoke test (`/login`, `/إدارة المستخدمين`) | ✓ `LOGIN-OK` reported by operator |
| 2026-05-10 | Confirmed `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel is `<publishable key>*` | ✓ `PREFIX-PUBLISHABLE` |
| 2026-05-10 | Operator chose to defer disabling legacy JWT | `PAUSE-LEGACY-JWT` |
| 2026-05-10 | Part E — opened Supabase Auth Users page | ✓ 16 users listed by email |
| 2026-05-10 | Operator approved unique-password rotation | `APPROVE-UNIQUE-PASSWORD-ROTATION` |
| 2026-05-10 | Built `scripts/rotate-user-passwords.js` (dry-run-default, --env-file, CSV outside repo) | ✓ script + .gitignore + npm aliases committed-ready |
| 2026-05-10 | First sandbox dry-run vs `.env.local` (staging) | ✗ `Invalid API key` — expected; staging env stale |
| 2026-05-10 | Operator created `Desktop\prod-temp.env`, ran dry-run vs production | ✗ **`listUsers failed: Database error finding users`** — see §2 |

**No production data has been mutated.** No user password was changed. The dry-run halted before any `auth.admin.updateUserById()` call.

---

## 2. Failure: dry-run could not list users

### What the operator ran
```
node scripts/rotate-user-passwords.js --env-file="C:\Users\Administrator\Desktop\prod-temp.env"
```

### What the script reported
```
Supabase URL: https://ngwxlockzkjpmzuvgakx.supabase.co
Project ref:  ngwxlockzkjpmzuvgakx
Service-role key: present (length 41, prefix <server-side secret key>…)
Mode: DRY-RUN
…
listUsers failed: Database error finding users
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

### Root-cause hypothesis (ranked)

1. **Most likely — Auth-Admin scope/role mismatch on the new `<server-side secret key>*` key.**
   The same key has already been verified to work for `/rest/v1/profiles` (PostgREST) — the live app's `/إدارة المستخدمين` page renders correctly with this key in `SUPABASE_SERVICE_ROLE_KEY`. But that page reads `public.profiles` via PostgREST, **not** `auth.users` via the Auth Admin endpoint (`/auth/v1/admin/users`). These are two different services with potentially different authorization paths. The error message `"Database error finding users"` — note: NOT `"Invalid API key"` — suggests the request was *authenticated* but the Auth service hit a DB-permission error when reaching for `auth.users`. This pattern is consistent with a `<server-side secret key>*` key that lacks the elevated GoTrue admin scope on this particular project.

2. **Less likely — transient Supabase Auth service issue.**
   The "Database error finding users" wording is the GoTrue server-side fallback when its internal DB query fails. A retry might succeed. We have not retried because we want to preserve the diagnostic state.

3. **Unlikely — key truncation / corruption in `prod-temp.env`.**
   The script reports the key length as **41 characters** with prefix `<server-side secret key>`. That's plausible for a Supabase secret key (typical length 40–50 with the `<server-side secret key>` prefix accounting for 10). PostgREST works with this exact value, so it's not corrupted.

### Secondary issue: Windows libuv assertion crash

After the FATAL error, Node.js on Windows crashed with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`. This is a known interaction between `process.exit()` and the `@supabase/supabase-js` client's still-open fetch handles. The crash happens AFTER our own error handling, so no functional impact — but it makes diagnosis noisy. **Fixed in the latest version of the script:** the main flow now uses `process.exitCode = N; return;` instead of `process.exit(N)`, allowing Node to drain pending I/O before exit.

---

## 3. Can `<server-side secret key>*` be used for Auth Admin in this project?

**Unknown — to be determined by the new `--diagnose-auth` mode.** The diagnose mode runs four read-only probes:

| Probe | Tests | Distinguishes |
|---|---|---|
| 1 | `SELECT count from public.profiles` | Whether the key authenticates against PostgREST at all. Already known to PASS — verified by live-app behaviour. |
| 2 | `SELECT count from auth.users` | Whether PostgREST exposes the `auth` schema (usually it doesn't, even for service_role). Diagnostic baseline. |
| 3 | `auth.admin.listUsers()` via SDK | The exact failure case. Tells us the SDK error wording. |
| 4 | Raw `fetch()` to `/auth/v1/admin/users` with `Authorization: Bearer <key>` and `apikey: <key>` | Returns the raw HTTP status code and body. Differentiates 401 (auth rejected) from 500 (auth accepted, server error). |

**Decision rule built into the script's verdict:**

- Probe 1 PASS + Probe 3 PASS → key works for everything; proceed with `--execute`.
- Probe 1 PASS + Probe 3 FAIL → key works for PostgREST but Auth Admin requires legacy JWT or a wider-scoped <server-side secret key>* → **fallback to legacy JWT** for the rotation only.
- All probes FAIL → key value is wrong / expired / for a different project → re-check `prod-temp.env`.

---

## 4. Whether fallback to legacy `service_role` JWT is required

**To be determined.** The diagnose probes will answer this empirically. If the verdict says "Key works for PostgREST but FAILS for Auth Admin", the fallback procedure is:

1. In Supabase Studio (production tab still open) → Settings → API Keys → **Legacy anon, service_role API keys**
2. Find the `service_role` row → click **Reveal** → copy the value (a JWT starting with `eyJ`)
3. Edit `C:\Users\Administrator\Desktop\prod-temp.env` and **replace** the `SUPABASE_SERVICE_ROLE_KEY=` line so its value is the legacy JWT (instead of the `<server-side secret key>*` value)
4. Re-run the diagnose probe with the new env-file content
5. If probe 3 PASSES with the legacy JWT, proceed with `--execute` for the actual rotation
6. After rotation, **DELETE** `prod-temp.env` (it now contains the legacy JWT — sensitive)
7. The legacy JWT remains active in Supabase (not yet disabled per `PAUSE-LEGACY-JWT`); operator may disable it in a separate step once they confirm no other tooling depends on it

The legacy JWT is acceptable as a one-shot operational tool because:
- It already exists in production (we didn't create it)
- The operator chose `PAUSE-LEGACY-JWT` to keep it active for now
- It is NOT being committed anywhere — only loaded once by the script via `--env-file`
- The env-file lives outside the repo and gets deleted after use

---

## 5. Files touched in this report's scope

| File | Status | Note |
|---|---|---|
| `scripts/rotate-user-passwords.js` | **created**, 347 lines | Has `--diagnose-auth`, `--dry-run` (default), `--execute`, `--env-file`, `--csv-out`. CSV path verified outside repo. Forbidden values blocked. Libuv-assertion mitigated. |
| `.gitignore` | modified | Added `convera-temp-passwords-*.csv` and `*temp-password*.csv` patterns. |
| `package.json` | modified | Added `rotate-passwords:dry-run` and `rotate-passwords:execute` npm aliases. |
| `docs/credential_rotation_execution_report.md` | this file | Living document — updated as the rotation progresses. |

**Not touched:**
- `DEPLOYMENT.md` — still contains the bootstrap-password literal (will scrub in Part F after rotation).
- `data-imports/CMH_01/08_migration/sections/46_s003*.sql`, `47_s004*.sql`, `staging_schema_bundle.sql` — already parameterized in the prior sprint commit.
- Any `prod-temp.env` — operator's local file, never tracked, never read by the orchestrator.
- Any rotation CSV — does not exist yet.

---

## 6. Strict-rule confirmations (so far)

| Rule | Status |
|---|---|
| No production data mutated except approved credential rotation | ✓ — and even that has not happened yet (paused at dry-run) |
| No SQL mutation ran | ✓ |
| No push performed | ✓ |
| No keys rotated by orchestrator | ✓ — operator created the new `<server-side secret key>*` themselves; legacy JWT untouched |
| No CMH_01 import | ✓ |
| No Phase 8 | ✓ |
| No secret values printed in chat | ✓ |
| No secret values committed | ✓ |
| No secret values in screenshots | ✓ — Vercel field shown once was a known-orphaned value (no longer authenticates against Supabase) and we did not re-screenshot the new value |

---

## 7. Recommended next command for the operator

Run this in PowerShell (`C:\Users\Administrator\Desktop\convera-platform`):

```powershell
node scripts/rotate-user-passwords.js --diagnose-auth --env-file="C:\Users\Administrator\Desktop\prod-temp.env"
```

This is **read-only**. It will:
- Print the project ref so you can sanity-check before any mutation
- Run 4 probes to determine whether the new `<server-side secret key>*` works for Auth Admin
- Print a verdict at the end recommending either `--execute` or fallback-to-legacy-JWT
- Exit cleanly without crashing

**Paste the verdict block back to me** (and the 4 probe lines preceding it) and we proceed accordingly.

If you prefer, you can skip diagnosis and go directly to the legacy-JWT fallback now: replace the `SUPABASE_SERVICE_ROLE_KEY=` line in `prod-temp.env` with the legacy `service_role` JWT (revealed from Supabase Studio → API Keys → Legacy tab → service_role → Reveal), then re-run the diagnose. We'll see whether that path passes probe 3.

---

## 8. Final-stage placeholders (will be filled as the work continues)

- [ ] Number of users rotated: **TBD** (target: 16)
- [ ] Failed users: **TBD**
- [ ] Sessions revoked: **NO** (awaits `APPROVE-REVOKE-AUTH-SESSIONS` after rotation)
- [ ] DEPLOYMENT.md scrubbed: **NO** (Part F — runs after successful rotation)
- [ ] Repo safe to push: **NOT YET**

---

*Document continues below as the rotation progresses. Each new entry is appended; nothing is overwritten.*

---

## 9. Update — `--diagnose-auth` results (2026-05-10, after script v2 with diagnose mode)

The operator ran `node scripts/rotate-user-passwords.js --diagnose-auth --env-file=...` against production with **two different `SUPABASE_SERVICE_ROLE_KEY` values**:

### Run A — with the new `<server-side secret key>…` (created earlier in this sprint)

| Probe | Result |
|---|---|
| 1. PostgREST `SELECT count from public.profiles` | ✓ PASS |
| 2. PostgREST `SELECT count from auth.users` | (not reported — likely also blocks like always) |
| 3. SDK `auth.admin.listUsers()` | ✗ FAIL — `Database error finding users` |
| 4. Raw `fetch GET /auth/v1/admin/users?per_page=1` | ✗ HTTP **500** `unexpected_failure` |

### Run B — with the legacy `service_role` JWT (revealed from Studio's "Legacy anon, service_role API keys" tab and pasted into prod-temp.env, NOT into chat or any tracked file)

| Probe | Result |
|---|---|
| 1. PostgREST `SELECT count from public.profiles` | ✓ PASS |
| 3. SDK `auth.admin.listUsers()` | ✗ FAIL — same message |
| 4. Raw `fetch GET /auth/v1/admin/users?per_page=1` | ✗ HTTP 500 — same body |

### Verdict

Identical failure on identical endpoint with two structurally-different keys means the failure is **NOT** key-related. The **GoTrue Auth service itself fails server-side** when issuing its internal SQL against `auth.users`. The relevant `error_id` returned in the body is `019e1205-9498-72fe-a2a6-9b8049579e44` (timestamp-encoded; useful to give Supabase support).

This explains why:
- The live app's `/إدارة المستخدمين` works → it queries `public.profiles` via PostgREST, never touching GoTrue's listUsers
- Supabase Studio's "Authentication > Users" page works → it uses Studio's pg-meta path (raw SQL), not GoTrue
- External Auth Admin API fails → only that path goes through GoTrue's internal mapper

### What this means for password rotation

**Cannot use `auth.admin.updateUserById()` either** — same code path as listUsers. The rotation script's `--execute` mode would also fail (or worse, fail mid-iteration leaving the system in a half-rotated state).

**Forbidden alternatives** (per operator standing rules):
- ✗ Direct `UPDATE auth.users SET encrypted_password = crypt(...)` SQL — bypasses GoTrue policy validation, risky.
- ✗ Disabling triggers / mutating `auth.*` schema to "fix" — out of scope until diagnostics localize the cause.

**Permitted alternatives:**
- ✓ Studio Authentication > Users one-by-one (uses pg-meta which works) → see `auth_admin_failure_diagnostic_plan.md` §6 Option A
- ✓ Defer rotation until Auth Admin API is fixed (Option C) — acceptable because production is now using new keys; the leaked password's only remaining exposure is direct user-login attempts

### Out-of-scope leak now contained?

The leaked `<old bootstrap password redacted>` bootstrap password remains valid for the seeded users (a1000001..a1000006) until rotated. Mitigations already in place:
- Production app's `SUPABASE_SERVICE_ROLE_KEY` is a fresh `<server-side secret key>*` (operator created today; stored only in Vercel + their local prod-temp.env briefly)
- Production app's anon key is `<publishable key>*` (operator confirmed via `PREFIX-PUBLISHABLE`)
- The leaked password CANNOT be used to bypass the new keys; it can only be used as a user login at https://convera-platform.vercel.app
- Director-role login with the leaked password remains a real risk **until** rotated, however

### Next step (this point in time)

Run the SELECT-only probes in `docs/auth_admin_failure_diagnostic_plan.md` §2 and report results. Most-likely outcome from Q1+Q2: identification of a custom trigger on `auth.users` whose function body breaks on a renamed enum/column from the long migration history. Once identified, propose a fix, await operator approval to apply.

---

## 10. Confirmations (refreshed)

| Item | Status |
|---|---|
| Production data mutated | **NO** — diagnostics are SELECT-only; no auth.users changes; no other table changes |
| User passwords changed | **NO** — none |
| Sessions revoked | **NO** — awaits successful rotation first |
| DEPLOYMENT.md scrubbed | **NO** — Part F gated on rotation |
| Repo safe to commit | **PARTIAL** — diagnostic docs and the script are commit-safe; CSV does not exist; legacy JWT and `<server-side secret key>*` are not in any tracked file |
| Repo safe to push | **NO** — pending the Part F scrub of `DEPLOYMENT.md` (which itself is pending rotation) |
| Auth Admin issue is local or Supabase support | **Likely Supabase-side** — see §11 below |

---

## 11. Update — integrity probes (2026-05-10, after operator ran SELECT-only diagnostics in Studio)

| Check | Result |
|---|---|
| `auth.users` row count | 16 — clean |
| Null email / encrypted_password / app_meta / user_meta / aud / role / instance_id | **0** for all |
| `aud / role` distribution | 16/16 = `authenticated / authenticated` |
| `raw_user_meta_data.role` validity | All 16 are valid `user_role` enum values |
| `public.profiles` sync | **15 of 16 matched** — `fayez@gdc.com` is missing a `public.profiles` row |

### Interpretation

The integrity probes **eliminate** the "broken auth.users data" hypothesis. They eliminate the "bad column type" hypothesis. They eliminate the "invalid role enum value blocking row mapping" hypothesis.

The Fayez missing-profile finding is **a real app-data sync issue but is almost certainly NOT the cause of the GoTrue 500**: GoTrue's `listUsers` queries only the `auth.*` schema and never JOINs to `public.profiles`. A missing `public.profiles` row is invisible to GoTrue's listUsers code path.

Together with the prior finding that BOTH key formats (`<server-side secret key>*` AND legacy `service_role` JWT) fail identically with `error_id 019e1205-…`, the strongest remaining hypothesis is **Supabase-managed Auth service-side issue**.

Pending optional probes: Q1 (triggers on auth.users), Q2 (function bodies), Q9 (auth.* function ownership) — would conclusively rule in/out a custom-trigger cause. Operator may choose to run them or proceed directly to support ticket per §12.

### Two new artifacts (NOT applied, NOT committed)

- `docs/supabase_support_ticket_auth_admin_500.md` — copy-paste-ready support ticket draft.
- `docs/patches/backfill_fayez_profile.sql` — proposed SQL to backfill the missing `public.profiles` row for `fayez@gdc.com`. **Gated on `APPROVE-BACKFILL-FAYEZ-PROFILE` — operator must approve before any application.**

---

## 12. Confirmations (refreshed after integrity probes)

| Item | Status |
|---|---|
| Production data mutated | **NO** — diagnostics are SELECT-only |
| User passwords changed | **NO** — none |
| Sessions revoked | **NO** |
| DEPLOYMENT.md scrubbed | **NO** |
| `prod-temp.env` deleted | **operator-side** — not visible to orchestrator |
| Auth Admin issue: local or Supabase | **Most-likely Supabase-side**. Recommend filing ticket. Q1/Q2/Q9 still optional to rule in/out a custom-trigger cause definitively. |
| Repo safe to commit | The new docs (support ticket draft + backfill SQL) are commit-safe. Other safety changes from earlier are also commit-safe. |
| Repo safe to push | **NO** — pending Part F scrub of `DEPLOYMENT.md` (which is gated on completed user-password rotation). |

