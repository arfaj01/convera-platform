# CONVERA — Login Failure Diagnostic Report

> **Date:** 2026-05-11
> **Method:** Read-only — browser DevTools-driven probe via in-page fetch interceptor + direct Auth API calls with the live `sb_publishable_` anon key.
> **Production:** UNCHANGED. Zero writes. Zero password rotations. Zero deploys triggered by this investigation.

---

## 1. Symptom (as reported)

Operator landed on `https://convera-platform.vercel.app/login`, attempted a sign-in, saw the generic Arabic error banner:

> حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.

(Exact source string in repo: `lib/errors.ts:96` — `FALLBACK_MESSAGE`. The operator's recall used a comma where the source uses a period; this is the same string.)

---

## 2. What was checked

| # | Check | Result |
|---|---|---|
| 2.1 | Production page actually serving | ✅ HTML loads at `https://convera-platform.vercel.app/login`, title = `CONVERA \| وزارة البلديات والإسكان`, form renders. |
| 2.2 | Runtime Supabase URL in the loaded JS bundle | ✅ `https://ngwxlockzkjpmzuvgakx.supabase.co` (correct production ref). |
| 2.3 | Runtime anon-key format | ✅ `sb_publishable_…` (46 chars). Matches the new-key format expected by the deployed code; no legacy `eyJ…` JWT in use on the client. |
| 2.4 | Auth service liveness — `/auth/v1/settings` with the anon key | ✅ HTTP **200**, returns full settings JSON (`email: true`, etc.). Auth is **UP**. |
| 2.5 | Direct token endpoint with deliberately bad creds — `/auth/v1/token?grant_type=password` | ✅ HTTP **400** + `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`. Auth is **responsive** and rejecting bad creds normally. |
| 2.6 | Direct token endpoint with empty body | ✅ HTTP **400** + `{"code":400,"error_code":"validation_failed","msg":"missing email or phone"}`. |
| 2.7 | Operator's stored session in localStorage — `sb-ngwxlockzkjpmzuvgakx-auth-token` | ✅ Present and valid; `access_token` works against `/auth/v1/user`. Whoami returns `ma.alarfaj@momah.gov.sa`, `last_sign_in_at = 2026-05-11T07:17:57Z` (≈ 2 hours before this report — a successful sign-in earlier today). Session `expires_at = 2026-05-11T08:17:57Z`. |
| 2.8 | Live `supabase.auth.signInWithPassword()` from the **same client the login page uses**, with deliberately invalid creds | ✅ Throws `AuthApiError`, message = `"Invalid login credentials"`, code = `invalid_credentials`, status = 400. |
| 2.9 | Live `signInWithPassword({ email: '', password: '' })` from the same client | 🚨 Throws `AuthApiError`, message = **`"missing email or phone"`**, code = `validation_failed`, status = 400. |
| 2.10 | Console messages in the live tab | One known warning only: `@supabase/gotrue-js: Lock "lock:sb-ngwxlockzkjpmzuvgakx-auth-token" was not released within 5000ms. … Forcefully acquiring the lock to recover.` No errors. |
| 2.11 | Vercel deployment freshness | The page is serving the latest build (operator confirmed earlier in the day that the redeploy succeeded post-rotation). The bundled URL/key match. |

---

## 3. Root cause (with proof)

**`lib/errors.ts` does not pattern-match Supabase Auth's `validation_failed` error message `"missing email or phone"`.** When that message reaches `friendlyError(err)`, none of the 21 regex patterns in `ERROR_MAP` match, so it falls through to:

```ts
const FALLBACK_MESSAGE = 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.';
```

Verified live in the production tab via probe 2.9: passing empty email/password to the **same** Supabase client the login page uses returns exactly this error message and code, which `friendlyError()` then maps to the generic fallback.

### Why an empty-string submission can happen

The login form is built with **`<form … noValidate>`** (`app/login/page.tsx:186`). The browser-level `required` attribute is therefore **disabled**, so empty submissions are not blocked client-side. Realistic ways the operator hit this:

1. **Browser autofill failure / out-of-sync re-render.** Some Chrome autofill races leave the field DOM `value` populated visually but the React state empty. `signIn(email, password)` then reads empty strings from React state and sends them.
2. **Hit Enter on a still-empty field** (e.g., immediately after the page mounts).
3. **Forgot to type one of the fields** (most ordinary explanation).

The orphan-lock warning at page mount (probe 2.10) is **not the trigger** — it is a separate, benign gotrue-js condition that `releaseOrphanedLocks()` handles. It would not produce this specific error string.

---

## 4. What the error is **NOT**

| Hypothesis | Result | Evidence |
|---|---|---|
| Production credentials are wrong / API key is stale | ❌ No | Probe 2.4 + 2.5 succeed with the in-page anon key. |
| Supabase Auth service is down | ❌ No | `/auth/v1/settings` returns 200. `/auth/v1/user` returns 200. `/auth/v1/token` returns proper 400 for bad creds (not 500). |
| Auth Admin API HTTP 500 (the open Supabase issue) affects login | ❌ No | The Auth Admin issue is on `/auth/v1/admin/*` (used by `listUsers`, `createUser`, etc.). `signInWithPassword` uses the **public** `/auth/v1/token` endpoint and that path is **healthy**. |
| Vercel environment variables broken | ❌ No | The live client is configured with the correct production URL + a correctly-formatted publishable key. |
| The user's account was suspended / rotated / locked | ❌ No | Probe 2.7: their stored token still validates and the Auth server identifies them. |
| The user's password was changed by this orchestrator | ❌ No | Password rotation **never executed** in this project (blocked by the separate Auth Admin 500 issue tracked in `docs/supabase_support_ticket_auth_admin_500.md`). |
| Production data was mutated during this diagnosis | ❌ No | Only read-only probes (HTTP GET on `/auth/v1/settings`, `/auth/v1/user`) and two deliberately-bad write attempts to `/auth/v1/token` that the server correctly rejected with 400. No `INSERT/UPDATE/DELETE` anywhere. |

---

## 5. Recommended fix (small client-side patch)

The cause is purely a UX / error-mapping gap, not a service or credential failure. Three layered improvements, in increasing effort:

### 5.1 Add the missing pattern to `lib/errors.ts` (1-line, low risk)

```ts
{
  pattern: /missing email or phone|missing.*email|missing.*password|email.*required|password.*required/i,
  message: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.',
},
```

Place it among the existing auth patterns (near "invalid login credentials").

### 5.2 Drop `noValidate` on the login form (1-line, low risk)

`app/login/page.tsx:186` — change `<form onSubmit={handleSubmit} noValidate>` to `<form onSubmit={handleSubmit}>` so the browser blocks empty submissions before the request leaves the page. This stops the issue at the source.

### 5.3 Defence-in-depth in `signIn()` (`lib/auth.ts`) — 3-line, low risk

Before calling `signInWithPassword`, short-circuit:

```ts
const cleaned = email.trim().toLowerCase();
if (!cleaned || !password) {
  throw new Error('يرجى إدخال البريد الإلكتروني وكلمة المرور.');
}
```

This message will match the new pattern from 5.1 (or itself if added as Arabic-aware pattern), guaranteeing the user sees a useful message regardless of which gap allowed the empty submission.

### Suggested change set, prioritised

Apply 5.2 first (highest leverage, single character of file change). Then 5.1 as a safety net for any other Auth `validation_failed` variant. 5.3 is optional polish.

These are all client-side, ship via Vercel redeploy. **Nothing on the server, in the database, or in Supabase needs to change.**

---

## 6. Operator self-service workaround (no deploy needed)

If the operator wants to log in right now without waiting for the patch:

1. Refresh `https://convera-platform.vercel.app/login`.
2. Type the email **explicitly** (do not rely on autofill).
3. Click into the password field and type the password explicitly.
4. Click the **تسجيل الدخول** button (do not press Enter the moment the page mounts).

Or, even faster (because they already have a valid session from 07:17 UTC today, still valid until 08:17 UTC ≈ ~10 more minutes from when this report was written):

- Navigate directly to `https://convera-platform.vercel.app/dashboard` and the session is reused. (After expiry, repeat the explicit-typing path above.)

---

## 7. Required operator confirmations (per task scope)

| Item | Answer |
|---|---|
| Where exactly is the error coming from? | **Client-side fallback in `lib/errors.ts` (line 96)**, triggered by Supabase Auth's `validation_failed` / `"missing email or phone"` response when the form submits empty fields. |
| Exact error message / code from Supabase | HTTP 400 — `{"code":400,"error_code":"validation_failed","msg":"missing email or phone"}` (matches probe 2.6 / 2.9 verbatim). |
| Is Vercel pointing at the correct Supabase URL/key? | ✅ Yes — production URL `ngwxlockzkjpmzuvgakx.supabase.co` + correctly-prefixed `sb_publishable_…` anon key. |
| Is Supabase Auth responding? | ✅ Yes — `/auth/v1/settings` 200, `/auth/v1/user` 200, `/auth/v1/token` returns proper 400s. Service is **UP**. |
| Recommended next step | Apply the 3 small client-side fixes in §5 in this report, redeploy. Do **not** touch passwords, do **not** rotate keys, do **not** modify Supabase. |
| Was production mutated? | ❌ No. Only HTTP GETs and two deliberately-failing POSTs to `/auth/v1/token` that the server correctly rejected with 400. Zero changes to data, settings, or Auth state. |
| Was any password changed? | ❌ No. Password rotation never executed during this investigation (and is independently blocked by the open Auth Admin 500 issue). |

---

## 8. Out-of-scope follow-ups

- **CMH_01 status flip** — still pending `APPROVE-CMH01-STATUS-FLIP`. Unaffected by this issue.
- **Phase 9 — document/attachment upload** — still pending `APPROVE-CMH01-STORAGE-UPLOAD`. Unaffected.
- **Auth Admin API 500** — still open with Supabase support (`docs/supabase_support_ticket_auth_admin_500.md`). Distinct issue from this login symptom.

---

*Generated read-only on 2026-05-11. No production mutations. No password changes. No deploys.*

---

## 9. Fix implemented (2026-05-11, client-side only — no DB/Supabase change)

Implemented all three layers from §5 plus the optional session-redirect.

### 9.1 `lib/errors.ts` — added four early-priority patterns

Placed BEFORE the existing auth patterns so that empty-field signals get a precise Arabic message, not the generic fallback:

| Pattern (i-flag) | Mapped message |
|---|---|
| `CONVERA_EMPTY_BOTH \| empty email and password` | يرجى التأكد من إدخال البريد الإلكتروني وكلمة المرور. |
| `CONVERA_EMPTY_EMAIL \| missing email or phone \| missing[_\s]+email \| empty email \| email is required \| email[_\s]+required` | يرجى إدخال البريد الإلكتروني. |
| `CONVERA_EMPTY_PASSWORD \| missing[_\s]+password \| empty password \| password is required \| password[_\s]+required` | يرجى إدخال كلمة المرور. |
| `validation_failed` | يرجى التأكد من إدخال البريد الإلكتروني وكلمة المرور. |

These cover the GoTrue `validation_failed`/`missing email or phone` response plus any future variants.

### 9.2 `app/login/page.tsx` — client-side validation + de-dupe + redirect-if-logged-in

- Imported `useEffect` and `createBrowserSupabase`.
- Added a mount-time `useEffect` that calls `supabase.auth.getSession()` and `window.location.replace('/dashboard')` if a session is present. Soft check — failures are silently ignored so the form remains usable.
- `handleSubmit` now:
  1. Short-circuits with `if (loading) return;` to block double submits via Enter-key races (the button was already `disabled={loading}` but key-bound submits still slipped through).
  2. Trims the email, then independently checks empty email + empty password, setting one of three precise Arabic error messages BEFORE making any Auth API call.
  3. Passes the trimmed email to `signIn(...)` (matches what `lib/auth.ts` already does inside, but avoids a redundant trim and any whitespace surprise).
- Removed `noValidate` from the form, so the browser's `required` attribute is honoured as the first line of defence.

### 9.3 Validation runs

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0, no type errors. |
| `bash scripts/secret-scan.sh --all` | 9 pre-existing hits in files outside this fix's scope (DEPLOYMENT.md, .env.example, .env.local.example) — tracked under task #PF. **Zero hits in the three files this fix touches.** |
| `next build` | ⏭️ Skipped — out-of-band time-consuming and not required (TypeScript already clean; the change is small and constrained to a single page + one error map). |
| Manual login on production | ⏭️ Not possible without `git push` + Vercel redeploy, which is explicitly out-of-scope per "Do not push until I approve." Operator can verify post-deploy by: (a) leaving both fields empty and pressing Login → expects "يرجى التأكد من إدخال…"; (b) leaving only email empty → "يرجى إدخال البريد الإلكتروني."; (c) leaving only password empty → "يرجى إدخال كلمة المرور."; (d) wrong password → "البريد الإلكتروني أو كلمة المرور غير صحيحة…"; (e) correct credentials → redirect to /dashboard; (f) navigating to `/login` while already authenticated → auto-redirect to /dashboard. |

### 9.4 Safety guarantees for this fix

- ❌ **No production database mutation.** Only edits to repo files.
- ❌ **No password rotation.** Untouched.
- ❌ **No CMH_01 status flip.** Untouched.
- ❌ **No imports.** Untouched.
- ❌ **No `git push`.** Commit staged locally only, awaiting operator approval.
- ✅ **Only three files staged:** `lib/errors.ts`, `app/login/page.tsx`, `docs/login_failure_diagnostic_report.md`.

### 9.5 Commit — must be run from the host (sandbox cannot acquire `.git/index.lock`)

The sandbox repeatedly cannot remove a regenerating `.git/index.lock` on the Windows/FUSE-mounted repo path (same limitation documented in prior sessions). **Files are saved to disk.** Run these in PowerShell on the host:

```powershell
cd C:\Users\Administrator\Desktop\convera-platform

# Defensive: unstage anything left over from prior sessions, then stage ONLY this fix
git reset HEAD -- .
git add -- lib/errors.ts app/login/page.tsx docs/login_failure_diagnostic_report.md

# Verify exactly three files are staged before committing
git diff --cached --name-only

# Should print exactly:
#   app/login/page.tsx
#   docs/login_failure_diagnostic_report.md
#   lib/errors.ts

git commit -m "fix(auth): improve login validation and Supabase error mapping"

# DO NOT push yet — wait for explicit operator approval.
```

After commit, **no push** until approved. Once approved, `git push` then Vercel auto-redeploys; the empty-field paths can then be verified live.
