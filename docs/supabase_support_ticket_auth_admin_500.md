# Supabase Support Ticket — Auth Admin /admin/users returns 500

> **Audience:** the operator, to copy-paste into Supabase Support → New Ticket.
> **Date drafted:** 2026-05-10
> **Drafted by:** Claude (Cowork mode), based on diagnostics performed today.
> **Project:** CONVERA, ref `ngwxlockzkjpmzuvgakx`, Pro plan.
>
> **Tip:** before submitting, replace `<additional error_ids if any>` with any newer `error_id` you see when you reproduce the failure one last time. The `error_id` rotates per request; older ones may be expired in Supabase's logs.

---

## How to file

1. Go to https://supabase.com/dashboard/support/new
2. Pick category: **"Auth"** (or "API" if Auth is unavailable in the dropdown)
3. Severity: **"Production unable to perform admin operations"** (or High; pick the closest available)
4. Subject and Body: copy from below.

---

## Subject

```
Auth Admin /admin/users returns HTTP 500 unexpected_failure: "Database error finding users"
```

## Body

```
Hi Supabase team,

I'm hitting a reproducible HTTP 500 on the Auth Admin endpoint
/auth/v1/admin/users in our PRODUCTION project. The same key works
fine for PostgREST and the Studio Authentication UI displays all
users, so the failure is isolated to the GoTrue Auth Admin path.

# Environment

  Project ref:  ngwxlockzkjpmzuvgakx
  Project name: CONVERA
  Region:       (whatever Supabase has on file for this project)
  Plan:         Pro
  Library:      @supabase/supabase-js v2.49.1 (also reproduced via raw curl)

# Reproduction

Minimal:

  curl -sS \
    -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
    -H "apikey: <SUPABASE_SERVICE_ROLE_KEY>" \
    "https://ngwxlockzkjpmzuvgakx.supabase.co/auth/v1/admin/users?per_page=1"

Response: HTTP 500
Body:
  {"code":500,"error_id":"019e1205-9498-72fe-a2a6-9b8049579e44",
   "msg":"Database error finding users"}

# Reproduced with two different key types

  1. New "Publishable and secret API keys" → Secret key (<server-side secret key>*),
     created today (2026-05-10) under the new key system.
     Result: HTTP 500, same error_id pattern.

  2. Legacy "anon, service_role API keys" → service_role JWT (eyJ...),
     pre-existing.
     Result: HTTP 500, same error_id pattern.

Both keys authenticate fine for other endpoints (see "Working from
same keys" below), so this is not a key-validity issue.

# Additional error_ids observed

  019e1205-9498-72fe-a2a6-9b8049579e44
  <additional error_ids if any>

# Working from the same keys (so we know auth itself is fine)

  - GET /rest/v1/profiles?select=id&head → 200 OK with X-Total-Count
  - PostgREST queries from our Vercel-hosted Next.js app (server-side,
    using the new <server-side secret key>* key in SUPABASE_SERVICE_ROLE_KEY) → 200 OK
  - Supabase Studio Dashboard → Authentication → Users page renders all
    16 users without error (uses Studio's pg-meta path, not GoTrue)

# Diagnostic data we already collected (read-only SELECTs)

A) auth.users integrity (single SELECT in Studio SQL Editor):
   {
     users_count: 16,
     null_email: 0, null_encrypted_password: 0,
     null_app_meta: 0, null_user_meta: 0,
     null_aud: 0, null_role: 0, null_instance_id: 0
   }

B) aud / role distribution: 16/16 = ('authenticated','authenticated')

C) raw_user_meta_data.role values: all 16 are valid user_role enum
   members. No invalid metadata.

D) public.profiles sync: 15/16 matched. One missing profile for
   fayez@gdc.com — this is an app-data sync issue we are tracking
   separately. GoTrue should not depend on public.profiles, so this
   shouldn't affect /admin/users — flagging anyway in case it informs
   the diagnosis.

# What we have not yet checked but can run on request

  - Triggers on auth.users (custom + internal) and their function bodies
  - public views shadowing auth.users
  - Custom columns added to auth.users
  - Auth log entries for the error_id above

# What we need from you

1. Confirmation of the actual SQL/error string GoTrue's listUsers handler
   logged for the error_ids above (we can't see them from the dashboard
   Auth Logs at our plan tier — please pull from the server side).

2. Whether the new <server-side secret key>* keys require a specific scope/role grant
   for auth.admin endpoints on existing projects (we created the secret
   key with default settings).

3. Whether anything in our project's auth.* schema / triggers / functions
   needs to be repaired on the Supabase side, or whether this is a
   Supabase-internal fault we should wait out / be patched for.

4. Guidance on a safe path to mass-rotate user passwords while Auth Admin
   is unavailable. Our standing rules forbid direct UPDATE auth.users.
   Studio's per-user "Reset password" UI does work (uses pg-meta, not
   GoTrue), so we can fall back to that — please confirm this is the
   recommended workaround.

# Operational impact

Production app continues to serve users normally (login, dashboard,
RPCs all work). The only operation that's blocked is mass user
administration via the Admin API. We have a leaked bootstrap password
in our git history that we want to rotate ASAP, but we cannot do it
through admin.updateUserById() while listUsers is broken.

Thank you,
Mohammed Alarfaj
mohammed.alarfaj@momah.gov.sa  (or your preferred contact)
```

---

## What NOT to include in the ticket

- ❌ The actual key value (`<server-side secret key>…` or `eyJ…`) — Supabase doesn't need it; the project ref is enough for them to verify on their side.
- ❌ The bootstrap password literal — irrelevant to the Auth Admin issue.
- ❌ Real user emails beyond `fayez@gdc.com` (the Probe-3 finding above is the only user-specific data needed). Replace any other example with `<user-email-1@example.com>` if you choose to add more context.

---

## Expected response timeline

Pro plan typically gets a first response within 1–2 business days. If you have a Supabase Discord support channel, posting a brief link to the ticket there can sometimes accelerate triage.

---

## While you wait

- Continue with the safe alternatives in `docs/auth_admin_failure_diagnostic_plan.md` §6:
  - **Option A:** Studio per-user "Send password recovery" (16 clicks; needs SMTP) — the easiest mass action that does NOT use GoTrue's broken admin endpoint.
  - **Option B:** Studio per-user "Reset password" (you type each password from your password manager).
  - **Option C:** Defer rotation entirely — production is now using the new keys; the leaked password's only remaining attack surface is direct user-login attempts.
- Do **not** apply `docs/patches/backfill_fayez_profile.sql` until you've confirmed it does not somehow trigger the Auth Admin issue (unlikely, but the diagnostic context calls for caution). The patch is approval-gated on `APPROVE-BACKFILL-FAYEZ-PROFILE`.

---

*Companion documents: `docs/auth_admin_failure_diagnostic_plan.md`, `docs/credential_rotation_execution_report.md`, `docs/patches/backfill_fayez_profile.sql`.*
