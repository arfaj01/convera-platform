# CONVERA — Secret Rotation Runbook

> **Audience:** the operator who owns the Supabase production project (`ngwxlockzkjpmzuvgakx`) and the GitHub repo (`github.com/arfaj01/convera-platform`).
> **When to use:** triggered by Findings 1, 2, or 3 in `platform_safety_findings.md`. Use whenever a real Supabase key, a real user password, or any other production credential has been (or might have been) exposed in a tracked file, log, screenshot, console output, or shared chat transcript.
> **Estimated time:** 15–25 minutes for the full sequence.
> **Prerequisites:** Supabase Studio admin access (the account currently logged in as `محمد العرفج · مدير الإدارة` in the production project), local shell, your editor of choice.
> **Blast radius:** Steps 2 and 4 cause every running service that holds the old key to lose authentication briefly. Steps 3 logs out every existing user session and forces a one-time re-login. Plan accordingly.

---

## When NOT to use this runbook

- If you are debugging a production issue and need to keep credentials stable, **do not rotate during the incident**. Rotate after.
- If you cannot coordinate with anyone else who has the credentials, do not rotate yet — they will be locked out.
- If the only "leaked" credential is a placeholder string (e.g. `<server-side secret key>`), **do not rotate** — there is nothing to rotate.

---

## §1 — Pre-rotation checklist

Before touching any secret, take 5 minutes to:

- [ ] **Confirm the leak is real.** Open the file or commit cited in `platform_safety_findings.md`. If the value matches `^sb_(secret|publishable)_[A-Za-z0-9_-]{20,}$` or `^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$`, it is a real key. If it is `<your-key-here>` or similar template text, it is a placeholder — stop here.
- [ ] **Confirm the project ref.** The Supabase URL must contain `ngwxlockzkjpmzuvgakx` (production) or `jrqkzwacerdudmeacvar` (staging). Rotate in the project that was leaked, not the wrong one.
- [ ] **Note the current build's deployment.** Open the Vercel dashboard for `convera-platform-ctalpk59z-arfaj001-5512s-projects.vercel.app`. After rotating you will need to update env vars there and trigger a redeploy or wait for the next push.
- [ ] **Notify any other engineer with prod access** that you are rotating.
- [ ] **Have your local `.env.local` open** — you will need to paste new values into it.

---

## §2 — Rotate `SUPABASE_SERVICE_ROLE_KEY`

> Trigger: any indication that the service-role key was exposed (committed in plain text, screenshotted, shared in chat, or even just copied to local disk in a tracked file).
> Production impact: any background process or server action that uses this key fails until rotated; usually negligible because Next.js server actions re-fetch on each request.

1. **Open Supabase Studio for the leaked project.**
   - Production: https://supabase.com/dashboard/project/ngwxlockzkjpmzuvgakx/settings/api
   - Staging: https://supabase.com/dashboard/project/jrqkzwacerdudmeacvar/settings/api
2. Find the row labelled **"service_role"** under "Project API keys" (or "secret" under the new key naming).
3. Click the **"Roll"** (or "Regenerate") button. Confirm.
4. Copy the new value to your clipboard. **Do not paste it into chat, a Slack channel, a doc, or any tracked file.**
5. Update **`.env.local`** in your local checkout of `convera-platform`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=<paste new value here>
   ```
   `.env.local` is gitignored — confirm with `git check-ignore .env.local` (expected output: `.env.local`).
6. Update the **Vercel project's environment variable**:
   - https://vercel.com/dashboard → `convera-platform` → Settings → Environment Variables.
   - Find `SUPABASE_SERVICE_ROLE_KEY` (Production scope). Click "Edit", paste the new value, save.
7. Trigger a redeploy (Vercel → Deployments → top deployment → "Redeploy") OR wait for the next git push to trigger one.
8. Verify the new key works: log into the production app at https://convera-platform.vercel.app — server actions that use the service-role key (e.g. admin user list at `/إدارة المستخدمين`) should still respond.
9. Document the rotation in your team's incident channel: time, project ref, reason. **Do not include the value.**

---

## §3 — Rotate every real user password (because the bootstrap password is in pushed git)

> Trigger: the literal `<old bootstrap password redacted>` (or any other shared bootstrap password) appears in `DEPLOYMENT.md`, in any tracked file already pushed to `origin/main`, or in any other location reachable by anyone outside the trusted operator group.
> Production impact: every user is logged out and must reset their password. Coordinate with the team before doing this.

This is the most-disruptive of the three rotations because it forces every real user to log in again. Plan for it.

### Option A — Force every user to reset via email (recommended for production)

1. Open the production project's Auth dashboard:
   https://supabase.com/dashboard/project/ngwxlockzkjpmzuvgakx/auth/users
2. For each user that uses the leaked password (start with `Ma.Alarfaj@momah.gov.sa` and any other listed in `DEPLOYMENT.md`):
   - Click the user → "Send password reset email" (Supabase will send a one-time link).
   - The user receives an email and chooses a new password through the existing `/reset-password` page on the production app.
3. While you wait for users to reset, you can also **invalidate every existing session** with one SQL statement (run in Studio's SQL editor on the production project):
   ```sql
   -- Logs out every user. They will need to log in again with their (new) password.
   UPDATE auth.refresh_tokens SET revoked = true WHERE revoked = false;
   ```
   This is read-only-equivalent in the sense that it cannot corrupt data, but it does require operator approval — log it in the incident channel.
4. Once everyone has confirmed they reset their password, scrub `DEPLOYMENT.md` (and the seed SQL files — see §4 below) so the same literal cannot be re-introduced.

### Option B — Set new passwords directly via the admin API (if you cannot reach users)

This is faster but bypasses the user's choice; suitable only for test users or in an emergency.

1. Generate a new random password for each affected user. Use a password manager — never copy-paste from chat output.
2. Run `scripts/create-test-auth-users.js` with `RESET_PASSWORDS=1` and `TEST_USER_PASSWORD=<new-value>` env vars set. This script already calls Supabase admin API to update passwords.
3. Hand each user their new password through a side channel (Signal, encrypted email, in-person — never plain email or Slack).
4. Tell each user to log in and immediately change their password through the app's settings.

### Verification

- New login at https://convera-platform.vercel.app with the old `<old bootstrap password redacted>` password should fail.
- New login with the rotated value should succeed.
- `auth.refresh_tokens` should have `revoked = true` for all rows that existed before the rotation.

---

## §4 — Scrub the bootstrap password from the unpushed seed SQL

> Trigger: confirmation from §3 that all real users have rotated their passwords AND the operator has decided whether to (a) parameterize via env or (b) replace with a placeholder and stop using the SQL for seeding.

> ⚠ Do not execute §4 until §3 is complete. Otherwise the seed SQL files will desync from the production users' actual passwords and the next person to read them will be confused.

### Option A — Parameterize (preserves seedability)

1. In `data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql`:
   - Replace each occurrence of `'<old bootstrap password redacted>'` with `current_setting('custom.bootstrap_password')`.
   - At the top of the file, add: `-- Run with: psql -v custom.bootstrap_password='YOUR_VALUE' -f 46_s003_seed_convera_users.sql`.
2. Same edit in `data-imports/CMH_01/08_migration/sections/47_s004_seed_supabase_auth_users.sql`.
3. Same edit in `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` (9 occurrences).
4. Update the orchestrator (`scripts/import-cmh01-controlled.js` if it sources these) to set `SET LOCAL custom.bootstrap_password = '...';` from a `BOOTSTRAP_PASSWORD` env var before running the seed.

### Option B — Hard-redact + redirect to script (lowest-effort, breaks SQL-only seeding)

1. Replace each `<old bootstrap password redacted>` literal in the three SQL files with `'<rotate via scripts/create-test-auth-users.js — see secret_rotation_runbook.md §3>'`.
2. The seed will fail when run as raw SQL — that is intentional. The replacement comment forces the operator to use the env-driven script.

### Either way

- After modifying the files, run the pre-commit guard from `platform_safety_findings.md` §11 to confirm no occurrences remain.
- Do NOT push until the guard passes.

---

## §5 — Scrub `DEPLOYMENT.md` (already pushed)

> Trigger: §3 is complete (real passwords rotated). Until rotation is done, scrubbing the doc only obfuscates and does not protect users.

1. Open `DEPLOYMENT.md`.
2. Replace each occurrence of `<old bootstrap password redacted>` with `<rotated 2026-05-10 — see secret_rotation_runbook.md §3>` (use the actual rotation date).
3. Add a note at the top of the affected section: "All bootstrap passwords listed previously in this file have been rotated. The history of this file in git contains the old value; do NOT use it."
4. Commit (`docs: scrub rotated bootstrap password from DEPLOYMENT.md`) and push.
5. **Optional but recommended:** rewrite git history to remove the password from past commits.
   - Tools: `git filter-repo --replace-text replacements.txt` (where `replacements.txt` contains `<old bootstrap password redacted>==><redacted>`).
   - This is destructive — every collaborator must re-clone or re-fetch with `--all`. Coordinate.
   - Force-push with `git push --force-with-lease origin main`.
   - GitHub does not delete old commits from cache immediately; assume the password is on a third-party copy somewhere indefinitely. The rotation in §3 is what actually protects you.

---

## §6 — Optional: rotate the anon (publishable) key

> Severity: low — anon keys are by design exposed to every browser. But if your team's policy is to rotate alongside the service-role key, do so.

1. Same dashboard as §2.
2. Roll the **`anon` / `publishable`** key.
3. Update **two** env vars wherever they appear: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (in `.env.local` and Vercel) — note the `NEXT_PUBLIC_` prefix means this value is baked into the client bundle, so a redeploy is required for the change to actually reach browsers.
4. Trigger a redeploy.

---

## §7 — Post-rotation verification checklist

- [ ] New service-role key works: log in to admin functions on the live app.
- [ ] Old service-role key fails: try a `curl -H "Authorization: Bearer <OLD>" https://ngwxlockzkjpmzuvgakx.supabase.co/rest/v1/profiles?select=*` and confirm 401.
- [ ] Old user passwords no longer work: try logging in with `Ma.Alarfaj@momah.gov.sa` / `<old bootstrap password redacted>` on https://convera-platform.vercel.app — must fail.
- [ ] No tracked or untracked file in the repo contains the rotated value (re-run §11 guard from `platform_safety_findings.md`).
- [ ] Vercel deployment status is "Ready" with the new env values.
- [ ] Incident logged in your team channel (without values).

---

## §8 — When this runbook should be updated

- Whenever a new Supabase project is added (e.g. a third "QA" environment).
- Whenever Supabase changes its key naming convention again.
- After any actual rotation incident, add a brief "what surprised us" note at the bottom of this file.

---

## §9 — One-screen TL;DR

```
1. Rotate SUPABASE_SERVICE_ROLE_KEY in Supabase Studio → Settings → API → Roll.
2. Update local .env.local + Vercel env vars + redeploy.
3. For every user listed in DEPLOYMENT.md: send password-reset email (Auth → Users → ⋮ → Reset).
4. Run UPDATE auth.refresh_tokens SET revoked = true; in Studio SQL editor (logs everyone out).
5. Decide: parameterize seed SQL (Option A) or hard-redact + redirect to script (Option B).
6. Re-run the pre-commit guard. Confirm zero matches.
7. Scrub DEPLOYMENT.md AFTER §3-§4 are done. Push the scrubbing commit.
8. (Optional) Rewrite git history with git filter-repo.
9. Verify: old key fails, old password fails, new key works, new password works.
```

---

*See also: `platform_safety_findings.md` (what was found, what is still open), `low_effort_improvement_backlog.md` (where this rotation fits in the broader sprint).*
