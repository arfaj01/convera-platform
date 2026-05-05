# CONVERA — IAM / RBAC Diagnostic Playbook

> **Audience:** operator + on-call DBA.
> **Companion file:** `SQL/diagnostics/iam_user_health.sql` — six SELECT-only diagnostics, IDs D1 → D6.
> **Authored:** 2026-05-05 (Commit IAM-1, see `logs/IAM_RBAC_STABILIZATION_AUDIT.md`).
> **Updates:** any change to the SQL file must be mirrored here.

---

## When to run this

Run the full diagnostic batch:

- Before declaring a smoke-test environment "ready" for a business-team test pass.
- Whenever a user reports "I cannot log in" and the message is not the standard "البريد الإلكتروني أو كلمة المرور غير صحيحة" (which is a wrong-password — not in scope here).
- After running `npm run seed:auth-users -- --reset-passwords` to confirm the post-state is healthy.
- After deploying any migration that touches `auth.*`, `profiles`, `user_contract_roles`, or `contract_approvers`.

The queries are **read-only**, idempotent, and never expose passwords or other secrets. Safe to run as often as needed.

---

## How to run it

1. Open the Supabase SQL Editor as `service_role` / `postgres`.
2. Paste the full content of `SQL/diagnostics/iam_user_health.sql`, or run blocks D1 → D6 individually.
3. Compare the output of each block against the "Expected" comment immediately above the SQL.
4. Capture the output (CSV / screenshot) and attach to the audit ticket.

Do **not** edit the SQL file in-place to "fix" data — repairs go through one of two sanctioned channels:

- **Auth side** (auth.users / auth.identities / passwords): `scripts/create-test-auth-users.js` via `npm run seed:auth-users`.
- **Profile + role side**: `/api/admin/users/*` from the `/users` page in the application. The API audit-logs every change.

Direct SQL writes against `auth.*` are **forbidden** and will leave GoTrue in a state where it returns "Database error querying schema" at sign-in. Direct SQL against `profiles` / `user_contract_roles` is technically possible for an emergency hotfix but bypasses audit logging — escalate before considering it.

---

## D1 — Auth users that should exist (8 test users)

### What it checks

Presence + email-confirmed status + banned/active state + last sign-in for the 8 Phase-2.6 test users. Joins `auth.identities` to count the email-provider rows.

### Expected pattern

8 rows. On every row:

- `email_confirmed = true`
- `banned_until` is `NULL` (or a past timestamp)
- `email_identities = 1`

### What to do if it's wrong

| Symptom | Cause | Repair |
|---|---|---|
| Fewer than 8 rows | Missing auth user | `npm run seed:auth-users` recreates missing users via Admin API |
| `email_confirmed = false` | User created via Admin API but `email_confirm: false` flag was passed | `npm run seed:auth-users -- --reset-passwords` re-runs with the correct flag |
| `banned_until` in the future | User was deactivated via the `/users` page (PATCH sets `ban_duration='87600h'`) | Re-activate from `/users` (the toggle Active button) |
| `email_identities = 0` | Identity row missing — happens after a manual `auth.identities` deletion | `npm run seed:auth-users` re-creates the identity |
| `email_identities > 1` | Duplicate identities (rare; usually from a botched manual repair) | Run D2 to confirm; escalate to on-call DBA. Removing the extra identity by hand is destructive — do not do it without a backup. |

---

## D2 — Auth identity drift

### What it checks

Any `(user_id, provider='email')` pair whose row count is not exactly 1. GoTrue assumes exactly one email identity per user.

### Expected pattern

Zero rows.

### What to do if it's wrong

Any row is an integrity issue. The user will hit "Database error querying schema" at sign-in even with the correct password. **Do not delete identities by hand.** Capture the row, escalate, and recreate the user via the Admin API after confirming with the team.

---

## D3 — Profile drift (auth ↔ profiles 1:1)

### What it checks

Auth users without a `profiles` row, or `profiles` rows without a matching auth user.

### Expected pattern

Zero rows.

### What to do if it's wrong

| Issue label | Symptom | Repair |
|---|---|---|
| `auth_user_no_profile` | User can sign in but the app shows "Profile not found" / cannot resolve role | Insert a `profiles` row via `/users` (Director recreates them) |
| `profile_no_auth_user` | Sign-in fails with the GoTrue schema error | Either delete the orphan profile (only if it was a test fixture) or recreate the auth user via `npm run seed:auth-users` |

---

## D4 — Per-test-user role health

### What it checks

One row per test user. Shows the coarse `profile.role`, the active per-contract role set (post Migration 045), the active contract numbers, and the count of `contract_approvers` rows scoped to `final_approver`.

### Expected pattern (informative — depends on the test fixtures)

For the reference 8-user roster:

| User | profile_role | contract_roles_active subset must contain | final_approver_count |
|---|---|---|---|
| Ma.Alarfaj@momah.gov.sa | director | (NULL — director is global) | ≥1 (designated final approver on every CMH contract) |
| halhablayn-Contractor@momah.gov.sa | reviewer | `{project_manager}` | 0 |
| aaldera-contractor@momah.gov.sa | reviewer | `{quality}` | 0 |
| anaalghamdi-contractor@momah.gov.sa | reviewer | `{reviewer}` | 0 |
| mahmoud.ragab@beeah.sa | consultant | `{supervisor}` | 0 |
| info@gdci.com.sa | contractor | `{contractor}` | 0 |
| fakher@alleanzaa.com | contractor | `{contractor}` | 0 |
| malek.h.mkh@gmail.com | contractor | `{contractor}` | 0 |

A user holding `{reviewer, quality}` on the same contract is **legal** post Mig 045 and is what the multi-role test cases exercise.

### What to do if it's wrong

`contract_roles_active = NULL` for a non-director user means the user has no contract assignments. Repair via `/users → Edit` (the modal will surface the API's Arabic error if anything fails after IAM-2 lands).

---

## D5 — Multi-role cross-check

### What it checks

Lists every (user, contract) pair that holds more than one active role. Migration 045 widened the unique key to allow this; the presence of rows is **expected** for any user that intentionally holds multiple roles.

### Expected pattern

Whatever the team has assigned. The query is a snapshot, not a check.

### Useful for

- Confirming the `/users` modal actually wrote the rows the director selected (after IAM-2 + IAM-3 land).
- Confirming the claim detail page chip strip is rendering the right set for a multi-role user.
- Confirming the `/workflow` page activeRole picker (post IAM-4) is initialising correctly for a multi-role caller.

If a user expected to be multi-role does NOT appear here, the most likely cause today is the POST `onConflict` mismatch documented in IAM-3 — silently dropped on creation.

---

## D6 — user_contract_roles UNIQUE constraint shape

### What it checks

The current shape of the UNIQUE key on `user_contract_roles`. Confirms Migration 045 was applied correctly.

### Expected pattern

One row. `pg_get_constraintdef(oid)` contains all three column names: `(user_id, contract_id, contract_role)` (the order may vary by Postgres version; what matters is that all three appear).

### What to do if it's wrong

If the constraint is the legacy 2-tuple `(user_id, contract_id)`:

- Migration 045 has not been applied or was rolled back.
- Every multi-role POST from the API will fail silently with Postgres `42P10`.
- The fix is to apply Migration 045. Do **not** edit /api/admin/users to use a 2-tuple onConflict — the application code post-IAM-3 assumes the 3-tuple key.

---

## Reading the output as a triage matrix

Use this short cheat-sheet when running the batch end-to-end:

```
D6 → if FAIL: schema is the wrong shape, stop here. Fix Migration 045.
D2 → if any row: GoTrue integrity issue. Do not deploy. Escalate.
D3 → if any row: identity ↔ profile drift. Repair before user testing.
D1 → if any row missing or banned/unconfirmed: re-run seed:auth-users.
D4 → cross-check against the §3.3 roster table.
D5 → confirm multi-role assignments match the test plan.
```

Capture results in the same order; attach to the audit ticket.

---

## Out of scope for this playbook

- **Password rotation / reset.** Use `/users → Reset Password` or, for bulk resets, `npm run seed:auth-users -- --reset-passwords`. Both go through the Admin API.
- **Role mutation.** Use `/users → Edit`. Direct SQL on `user_contract_roles` bypasses the audit log.
- **Contract creation.** Use `/contracts → New`. The seeding rules document is the source of truth for the legal `contract_no` patterns.

For deeper architectural context see `logs/IAM_RBAC_STABILIZATION_AUDIT.md` (the parent audit that produced this playbook).
