# Auth Admin Failure — Diagnostic Plan

> **Date:** 2026-05-10
> **Symptom:** `GET /auth/v1/admin/users?per_page=1` → **HTTP 500** with body `{"error":"unexpected_failure","msg":"Database error finding users"}` (error_id `019e1205-9498-72fe-a2a6-9b8049579e44`)
> **Reproduced with:** new `<server-side secret key>*` AND legacy `service_role` JWT — same failure for both.
> **Working with same keys:** PostgREST `SELECT` against `public.profiles` and Studio's own user list (which uses pg-meta, not GoTrue).
> **All queries below are READ-ONLY.** No `INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/GRANT`.

---

## 1. Why this is a server-side issue, not a key issue

The two key formats authenticate via different code paths in Supabase:
- New `<server-side secret key>*` keys are validated against the new `auth.api_keys` table (or equivalent project metadata).
- Legacy `service_role` JWT is validated by signature against the project's JWT secret.

If both keys reach the same `Database error finding users` (HTTP 500 from GoTrue), the failure is in GoTrue's **own SQL query** against `auth.users`, not in the auth-decision layer. Something on the database side is breaking GoTrue's query.

The most-likely culprits, ranked:
1. A **custom trigger** on `auth.users` that throws on the path GoTrue's listUsers takes (a `SELECT` inside a `BEFORE/AFTER` trigger function — yes, triggers can be invoked indirectly via cascading subqueries).
2. A **custom function** called by a trigger or by `auth.uid()`/`auth.role()` that errors.
3. A **view** in `public` (e.g. `public.users`) shadowing the native `auth.users` and breaking GoTrue's internal joins.
4. A **column added to `auth.users`** by an old migration that GoTrue's row-mapper can't deserialize.
5. A **broken RLS policy** on `auth.users` (less likely — service-role bypasses RLS by default).
6. A **Supabase Auth service-internal issue** independent of project state (rare but possible).

---

## 2. Diagnostic queries — paste into Supabase Studio SQL Editor (production)

⚠ Confirm the editor breadcrumb shows **MOMAH > CONVERA > main · PRODUCTION** before running any of these. They are all `SELECT` / metadata. None mutate.

### Q1 — Triggers on `auth.users` (custom + internal)

```sql
SELECT
  t.tgname                  AS trigger_name,
  CASE t.tgenabled
    WHEN 'O' THEN 'enabled'
    WHEN 'D' THEN 'DISABLED'
    WHEN 'R' THEN 'replica'
    WHEN 'A' THEN 'always'
  END                       AS status,
  t.tgisinternal            AS is_internal,
  n.nspname || '.' || p.proname AS function_called,
  pg_get_triggerdef(t.oid)  AS trigger_def
FROM pg_trigger t
JOIN pg_class     c  ON c.oid = t.tgrelid
JOIN pg_namespace cn ON cn.oid = c.relnamespace
JOIN pg_proc      p  ON p.oid = t.tgfoid
JOIN pg_namespace n  ON n.oid = p.pronamespace
WHERE cn.nspname = 'auth' AND c.relname = 'users'
ORDER BY t.tgisinternal, t.tgname;
```

**What to look for:**
- Any trigger with `is_internal = false` is custom (added by your migrations). Note its `function_called`.
- Any trigger with `status = DISABLED` is fine — disabled triggers don't fire.
- The standard Supabase setup has internal triggers `tr_check_filters`, `pgsodium_…` etc. — those are normal.
- The CONVERA setup likely has a custom `on_auth_user_created` (from migration 001) that calls `handle_new_user()` — note its function name for Q2.

### Q2 — Source code of every function referenced by Q1

```sql
SELECT
  n.nspname || '.' || p.proname AS function,
  pg_get_function_arguments(p.oid) AS args,
  l.lanname AS language,
  p.prosecdef AS security_definer,
  pg_get_functiondef(p.oid) AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l  ON l.oid = p.prolang
WHERE (n.nspname, p.proname) IN (
  SELECT n2.nspname, p2.proname
  FROM pg_trigger t
  JOIN pg_class     c2  ON c2.oid = t.tgrelid
  JOIN pg_namespace cn2 ON cn2.oid = c2.relnamespace
  JOIN pg_proc      p2  ON p2.oid = t.tgfoid
  JOIN pg_namespace n2  ON n2.oid = p2.pronamespace
  WHERE cn2.nspname = 'auth' AND c2.relname = 'users'
)
ORDER BY n.nspname, p.proname;
```

**What to look for:**
- The `body` column shows the function source. Look for:
  - References to `auth.users`, `auth.identities`, or any other `auth.*` table that might error
  - References to `public.profiles` columns that may have been dropped/renamed
  - References to enums that were renamed (e.g. legacy `consultant`/`admin` → `supervisor`/`auditor`)
  - Hard-coded UUIDs that no longer exist
- If the body references a column or value that doesn't exist, the trigger fires on every `auth.users` operation and breaks GoTrue's downstream SELECT cascades.

### Q3 — Views referencing `auth.users`

```sql
SELECT
  schemaname,
  viewname,
  definition
FROM pg_views
WHERE definition ILIKE '%auth.users%'
   OR definition ILIKE '%auth.identities%'
ORDER BY schemaname, viewname;
```

**What to look for:**
- A view named `public.users` shadowing `auth.users` is an immediate culprit.
- Views in `public` that JOIN to `auth.users` and reference dropped columns will break.

### Q4 — Custom columns on `auth.users` (anything beyond Supabase-native)

```sql
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'auth'
  AND table_name = 'users'
ORDER BY ordinal_position;
```

**What to look for:**
- Supabase's stock `auth.users` columns are: `instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, confirmed_at, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous`.
- Any column NOT in that list was added by a migration. If GoTrue's listUsers SELECT is `SELECT *` and tries to map to a Go struct, an unexpected column type can blow up the row mapper.

### Q5 — Privileges on `auth.users` (RLS / GRANT)

```sql
SELECT
  grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'auth' AND table_name = 'users'
ORDER BY grantee, privilege_type;
```

```sql
SELECT
  schemaname, tablename, rowsecurity, hasindexes, hasrules, hastriggers
FROM pg_tables
WHERE schemaname = 'auth' AND tablename = 'users';
```

```sql
SELECT
  policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'auth' AND tablename = 'users';
```

**What to look for:**
- `service_role` and `supabase_auth_admin` should have full access. Missing `SELECT` for either is a red flag.
- An RLS policy on `auth.users` is unusual — Supabase usually leaves `auth.users` with RLS off (service-role bypasses RLS regardless).

### Q6 — Recent failed migrations / pg_settings hints

```sql
SELECT name, setting, source
FROM pg_settings
WHERE name IN (
  'log_min_messages', 'log_statement', 'log_min_error_statement',
  'session_replication_role', 'default_transaction_read_only'
);
```

**What to look for:**
- `session_replication_role` should be `origin` (default). If it's `replica`, triggers don't fire on the GoTrue side and weird mismatches happen.
- `default_transaction_read_only` should be `off` for Auth operations.

### Q7 — Smoke: try the SAME row from PostgREST

```sql
-- This is the kind of SELECT GoTrue runs internally for listUsers.
-- If THIS errors in Studio (which uses pg-meta), we have a smoking gun.
SELECT id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 1;
```

If Q7 returns a row cleanly in Studio, we've narrowed the failure to a code path GoTrue uses but Studio's pg-meta does not (probably an additional JOIN to `auth.identities` or to a function call). Proceed to Q8.

### Q8 — The full GoTrue listUsers join (best approximation)

```sql
SELECT
  u.id, u.email, u.aud, u.role,
  u.email_confirmed_at, u.invited_at, u.confirmation_sent_at,
  u.recovery_sent_at, u.email_change_sent_at, u.last_sign_in_at,
  u.raw_app_meta_data, u.raw_user_meta_data,
  u.created_at, u.updated_at, u.phone, u.phone_confirmed_at,
  u.phone_change, u.phone_change_token, u.phone_change_sent_at,
  u.confirmed_at, u.email_change_confirm_status, u.banned_until,
  u.reauthentication_sent_at, u.is_sso_user, u.deleted_at, u.is_anonymous,
  COALESCE(
    (SELECT json_agg(json_build_object(
       'identity_id', i.id, 'user_id', i.user_id,
       'identity_data', i.identity_data, 'provider', i.provider,
       'last_sign_in_at', i.last_sign_in_at, 'created_at', i.created_at, 'updated_at', i.updated_at
     ))
     FROM auth.identities i WHERE i.user_id = u.id),
    '[]'::json
  ) AS identities
FROM auth.users u
ORDER BY u.created_at DESC
LIMIT 1;
```

**What to look for:**
- If Q7 succeeds but Q8 errors, the failure is in the JOIN to `auth.identities` or in a column type mismatch.
- If Q8 succeeds but the GoTrue API still fails, the failure is in something GoTrue does AFTER the SQL (e.g. parsing user_metadata into a Go struct that has stricter typing than Postgres).

### Q9 — Auth schema search_path / function ownership

```sql
SELECT proname, proowner::regrole AS owner, prokind, prolang::regtype, prosecdef
FROM pg_proc
WHERE pronamespace = 'auth'::regnamespace
  AND proname IN ('uid', 'role', 'jwt', 'email')
ORDER BY proname;
```

**What to look for:**
- `auth.uid()`, `auth.role()`, `auth.jwt()`, `auth.email()` should be owned by `supabase_auth_admin`. If owned by `postgres` or another role, that's a sign of a bad migration.

---

## 3. Server-side log retrieval

Paste-friendly approach:
1. Open https://supabase.com/dashboard/project/ngwxlockzkjpmzuvgakx/logs/auth-logs (in the same browser session).
2. Set timeframe to "Last 1 hour".
3. Look for entries with `error_id = 019e1205-9498-72fe-a2a6-9b8049579e44`.
4. The Auth log entry typically includes the full SQL that was attempted plus the database error message. **Paste the relevant log line(s) back to me — but redact any PII.**

If logs are not accessible from the dashboard (some Supabase tiers), skip and proceed to §5.

---

## 4. Decision tree based on probe results

| Q1 finding | Q2 finding | Q3 finding | Conclusion |
|---|---|---|---|
| Custom enabled trigger present | Function body references a non-existent column / dropped enum / dead UUID | (any) | **Trigger is the culprit.** Propose a fix; do not apply without operator approval. |
| Custom DISABLED trigger only | (any) | (any) | Trigger isn't running; look elsewhere. |
| No custom triggers, only Supabase internal | (any) | View `public.users` shadowing `auth.users` exists | View is the culprit. |
| No triggers, no shadowing views | (any) | (any) | Likely Supabase service-side. Open support ticket. |

| Q7 result | Q8 result | Conclusion |
|---|---|---|
| Errors | — | A SELECT against the bare table fails. The data or a column-type is broken. Proceed to fix candidates. |
| OK | Errors | The JOIN to `auth.identities` is broken. Identities table or its column types are corrupted. |
| OK | OK | Database is fine; failure is in GoTrue's Go-side mapping. **Open Supabase support ticket.** |

---

## 5. If diagnostics do NOT reveal a local cause

Open a **Supabase Support ticket** with the following payload (copy-paste ready):

```
Subject: Auth Admin /admin/users 500 unexpected_failure: "Database error finding users"

Project ref: ngwxlockzkjpmzuvgakx
Project name: CONVERA
Plan: Pro

Symptom:
  GET /auth/v1/admin/users?per_page=1 returns HTTP 500
  Body: {"error":"unexpected_failure","msg":"Database error finding users"}
  error_id: 019e1205-9498-72fe-a2a6-9b8049579e44

Reproduced with:
  - new <server-side secret key>* key (created 2026-05-10)
  - legacy service_role JWT
  Both fail identically.

Working from same keys:
  - PostgREST SELECT from public.profiles → 200 OK
  - Live app server-side admin queries via @supabase/supabase-js → 200 OK
  - Studio Authentication > Users page → renders all 16 users

What we tried:
  - Confirmed all 16 auth.users rows are well-formed (email + encrypted_password present, no banned/deleted)
  - [Attached diagnostic SELECT outputs — Q1..Q8 from our internal diagnostic plan]
  - No custom RLS policies on auth.users
  - No custom views shadowing auth.users in public schema  [if confirmed]

Asks:
  1. Confirm whether listUsers requires a specific role/scope on the new <server-side secret key>* key
  2. Provide GoTrue's actual SQL/error from your server logs for error_id above
  3. Advise safe path to mass-rotate user passwords (we cannot use admin API)
```

---

## 6. Alternative password-rotation paths

| Option | Path | Suitable when |
|---|---|---|
| **A** | Supabase Studio Authentication > Users > click user > "Send password recovery email" (one-by-one, 16 clicks) | SMTP is configured AND Studio's pg-meta path works (it does — we confirmed). Slow but safe. |
| **B** | Studio > Authentication > Users > click user > "Reset password" with a value YOU type (16 times, 16 unique passwords from your password manager) | SMTP is NOT configured. Slow. |
| **C** | Defer rotation entirely until Auth Admin API is fixed | Acceptable temporary stance because the production app currently uses the new keys; the leaked password is the only remaining risk and it is bounded to login attempts |
| **D** | **NOT PERMITTED** — direct SQL `UPDATE auth.users SET encrypted_password = crypt(...)` | Operator's standing rules forbid this. Even if technically possible, bypassing GoTrue's password policy is unsafe. |

**Recommendation if support ticket is filed:** combine **A** (or **B** if SMTP is unconfirmed) + **C** for the urgent users, defer the rest until Auth Admin API is fixed.

---

## 7. Strict no-mutation contract

- All queries here use only `SELECT`, `pg_get_*` (introspection functions), and `information_schema` (read-only views).
- No `INSERT/UPDATE/DELETE/MERGE/TRUNCATE`.
- No `CREATE/ALTER/DROP/GRANT/REVOKE`.
- No `pg_terminate_backend` / `pg_cancel_backend`.
- Operator may stop at any probe; nothing requires running the full set.
- If any probe returns an unexpected error, **stop and report** — do not "fix forward".

---

## 8. Glossary for the report's audience

- **GoTrue** — Supabase's Auth microservice. Implements `/auth/v1/*` endpoints. Reads/writes `auth.*` schema directly.
- **PostgREST** — Supabase's REST API for app-defined tables. Implements `/rest/v1/*`. Different code path from GoTrue.
- **pg-meta** — Supabase Studio's internal SQL execution layer. Used by Studio's UI for everything from "Users" page to "SQL Editor". Different from GoTrue.
- **service_role** — A Postgres role that bypasses RLS. Both new `<server-side secret key>*` keys and legacy `service_role` JWTs authenticate as this Postgres role server-side.

---

*Companion documents: `docs/credential_rotation_execution_report.md` (the full rotation timeline including this failure), `docs/secret_rotation_runbook.md` (general rotation procedure).*

---

## 9. Update — actual probe results (2026-05-10, after operator ran SELECT-only diagnostics in Studio)

### Probe 1 — `auth.users` integrity: **CLEAN**

| Metric | Value |
|---|---|
| `users_count` | 16 |
| `null_email` | 0 |
| `null_encrypted_password` | 0 |
| `null_app_meta` | 0 |
| `null_user_meta` | 0 |
| `null_aud` | 0 |
| `null_role` | 0 |
| `null_instance_id` | 0 |

### Probe 2 — `aud` / `role` distribution: **uniform**

| `aud` | `role` | count |
|---|---|---|
| `authenticated` | `authenticated` | 16 |

All 16 rows match Supabase's expected default. No mis-aud'd or mis-role'd users.

### Probe 3 — `public.profiles` sync: **15 of 16 matched**

| Metric | Value |
|---|---|
| `auth_users` | 16 |
| `matched_profiles` | 15 |
| `missing_profiles` | **1** |

**The missing profile:** `fayez@gdc.com` (display name "Fayez", a non-seeded user with random UUID `7acfb002-…`).
- `raw_user_meta_data.role` = `contractor` (a valid `user_role` value).
- No row exists in `public.profiles` with this `email` or matching `id`.
- This means the standard Supabase `on_auth_user_created` trigger (which inserts into `public.profiles` after every `auth.users` INSERT) didn't fire — or fired and silently no-op'd via `ON CONFLICT … DO NOTHING` against a stale matching key — when Fayez was added.

### Probe 4 — `raw_user_meta_data.role` validity: **all valid**

All 16 rows' `role` metadata maps to a valid `user_role` enum value. No invalid metadata that would trip GoTrue's row-mapper.

---

## 10. Updated root-cause hypothesis

The Probe 1+2+4 results **rule out** all the "data is broken" hypotheses (#1 — bad column value; #4 — column type mismatch). The Probe 3 result identifies a real but **separate** app-data sync gap (Fayez's missing profile) that is **almost certainly NOT the cause** of the GoTrue 500: GoTrue's `listUsers` reads only from `auth.*` schema and does not JOIN to `public.profiles`. A missing `public.profiles` row would be invisible to GoTrue.

**That leaves two viable hypotheses:**

1. **Custom trigger on `auth.users` whose function body errors when invoked indirectly.** Triggers don't fire on plain `SELECT`, but GoTrue's listUsers internally calls helper functions like `auth.uid()` or accesses session-level state via `auth.role()` — if any of those reach a custom function that errors, the request fails. Probes Q1+Q2 of this plan are still required to rule this out.

2. **Supabase-managed Auth service-side issue.** GoTrue itself, the database connection it uses, or a recently-rolled-out internal change (Supabase deployed something that interacts badly with this project's specific schema). The `error_id` in the response (`019e1205-…`) is server-generated — Supabase support can resolve it on their side.

If Q1+Q2 (still pending) come back clean (no custom trigger or only DISABLED ones), hypothesis #2 wins and the path is the support ticket in §5.

---

## 11. Pending probes (still recommended)

- **Q1** — triggers on `auth.users` (custom + internal)
- **Q2** — function source for any custom trigger
- **Q9** — ownership of `auth.uid()` / `auth.role()` / `auth.jwt()` / `auth.email()`
- **Auth logs** — search Supabase dashboard Auth Logs for the `error_id` to see GoTrue's actual SQL/error string

If you'd rather skip Q1/Q2/Q9 and go straight to support, that's also fine — the integrity probes already rule out the cheap-to-fix data-corruption hypotheses, and Probe 3's Fayez gap is a separate app-data sync issue (handled via the `docs/patches/backfill_fayez_profile.sql` patch — approval-gated, NOT applied).
