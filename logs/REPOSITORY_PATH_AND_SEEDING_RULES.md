# Repository Path & Seeding Rules — Permanent Reference

> Last updated: 2026-05-04
> Owner: CONVERA platform engineering
> Status: **MANDATORY — apply on every change.**

---

## 1. Official project path

```
C:\Users\Administrator\Desktop\convera-platform
```

This is the **only** path used for development, code edits, scripts, and SQL.

## 2. Forbidden path

```
C:\Users\Administrator\Desktop\CONVERA
```

Historical artefacts may live there (old reports, design docs, archived seeds).
**Do not** create, edit, run, or reference files under this path for any new work.
If you find yourself working in this folder, stop and switch.

The `npm run verify:repo-path` guard fails the build if any file under
`convera-platform` references the forbidden path verbatim.

## 3. SQL file management

| Type | Location | Notes |
|---|---|---|
| Schema migrations | `SQL/migrations/` | Numbered, idempotent, single-transaction. |
| Seed data | `SQL/seeds/` | Numbered, idempotent, single-transaction, **NEVER** runs DELETE on user data. |
| One-off operational scripts | NOT committed | Keep them in your local checkout / `.gitignore` only. Never under `Desktop\CONVERA`. |

**No executable SQL outside the repo.** If you need to run something, drop it into
`SQL/seeds/` (or `SQL/migrations/` if it changes schema), commit it, then run it
from there. Do not save throwaway SQL to Desktop or to the legacy CONVERA folder.

### 3a. Auth-user provisioning rule (Phase 2.6 mandate)

**SQL seeds MUST NOT write to `auth.users` or `auth.identities`.** The
GoTrue server refuses to authenticate users that were inserted into
`auth.users` by raw SQL — even when the bcrypt password hash and the
`auth.identities` row appear correct — and returns the misleading
error _"Database error querying schema"_ at sign-in. This was
confirmed in the 2026-05-04 staging session.

The official provisioning path:

| Step | Tool | Notes |
|---|---|---|
| 1. Create or refresh the auth users | `npm run seed:auth-users` (Node script using `supabase.auth.admin.createUser` / `updateUserById`) | Reads `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_USER_PASSWORD` from `.env.local`. Sets `email_confirm=true`. Idempotent: existing users get metadata refresh; pass `--reset-passwords` to also rewrite the password. |
| 2. Run the SQL seed | Supabase SQL Editor → `SQL/seeds/005_seed_test_users_cmh.sql` | The seed pre-flights every required user against `auth.users` + `auth.identities` (provider='email') + `email_confirmed_at`. RAISE EXCEPTION if any user is missing/incomplete with the message **"Create this user via Supabase Dashboard/Admin API first."** |
| 3. (optional) Manual single-user provisioning | Supabase Dashboard → Auth → Users → Invite / Edit | Equivalent to the Admin API, OK for ad-hoc additions. |

Forbidden:
- `INSERT INTO auth.users …`
- `UPDATE auth.users SET encrypted_password = crypt(…)`
- `INSERT INTO auth.identities …`
- Any direct touching of `auth.*` tables from SQL seeds or migrations.

## 4. Contract identification rule

Contracts are identified by **two keys jointly**:

| Field | Type | Source of truth |
|---|---|---|
| `project_code` | TEXT (e.g. `CMH_01`) | Operational reference used in conversations + folder names. |
| `contract_no` | TEXT (the actual MoMaH contract number) | The DB key. |

Mappings (Phase 2.6 smoke-test set):

| project_code | contract_no |
|---|---|
| `CMH_01` | `CMH_01-C01` |
| `CMH_02` | `250101116428` |
| `CMH_03` | `241039011332` |

**Rules:**
- Every script that touches contracts MUST resolve them via the `(project_code, contract_no)` pair.
- **Do not** match by `project_code` alone (no DB column with that value yet).
- **Do not** match by `contract_no LIKE 'CMH_%'` or any prefix wildcard.
- **Do not** use suffix variants like `CMH_01-C01` (these don't exist in the DB).
- The mapping above is the canonical truth. Update this table the moment a new
  CMH contract is added.

## 5. Role mapping rule (Phase 2.6)

### ContractRole values currently in active use

| Excel / verbal label | `contract_role` enum value |
|---|---|
| مقاول | `contractor` |
| مكتب استشاري | `supervisor` |
| تدقيق / مراجع / الجهة الفنية | `reviewer` ← **all three terms collapse here** |
| جودة | `quality` |
| مدير مشروع | `project_manager` |
| معتمد نهائي | `final_approver` |

### Roles intentionally excluded from Phase 2.6 test data

- `auditor` — kept in the enum for historical claims, but **NOT used** in
  any new INSERT/UPDATE on the CMH_01/02/03 test data set.
- `viewer` — only assigned manually for read-only stakeholders, never as
  part of the standard 6-role smoke-test seed.

### Why this matters

`contract_role = 'auditor'` would activate the legacy `under_auditor_review`
gating stage, which is **not** in the new pipeline. New claims must flow
through `under_supervisor_review → under_technical_review → under_quality_review
→ under_project_manager_review → pending_director_approval`. Mixing in
`auditor` rows would route a quality/PM user's claim through the wrong path.

## 6. Pre-flight checklist before running any seed

1. ☐ I am working under `C:\Users\Administrator\Desktop\convera-platform` (run `npm run verify:repo-path`).
2. ☐ I have pulled the latest `main` and there are no uncommitted changes.
3. ☐ `npx tsc --noEmit -p tsconfig.json` is clean.
4. ☐ `npm run build` succeeds (DYNAMIC_SERVER_USAGE warnings on auth-protected routes are acceptable; exit code must be 0).
5. ☐ I have replaced every `<PLACEHOLDER>` (passwords, ids, etc.) in the seed.
6. ☐ I have read the seed file end-to-end and confirmed:
   - it operates inside a single `BEGIN; … COMMIT;` transaction,
   - it has no `DELETE FROM auth.users` / `DELETE FROM profiles` / `DELETE FROM contracts` / `DELETE FROM claims`,
   - any `UPDATE`/`DELETE` it does run is scoped through the project's `target_contracts` mapping,
   - no `contract_role = 'auditor'` is written to the target contracts.
7. ☐ I have a recent DB backup or am on staging.
8. ☐ I have a rollback plan (for soft-deactivation seeds: a `ROLLBACK` of the transaction is enough; for migrations: documented in the migration footer).
9. ☐ I will run the seed via Supabase SQL Editor as `service_role` / `postgres`, not via the REST API.
10. ☐ After the seed runs, I run the seed's VAL queries and confirm each one returns the expected shape.

## 7. Reporting rule for old-path artefacts

If you find a file under `C:\Users\Administrator\Desktop\CONVERA\` that's
still being referenced by current operational instructions (not just legacy
reports), do this:

1. Copy it to the correct location under `convera-platform`.
2. Update the operational instruction to point at the new location.
3. Add a note to this file under section 8 below recording the move.
4. **Do not delete the old file.** It stays in `CONVERA\` as a historical
   artefact.

## 8. Move log

| Date | Old location | New location | Status |
|---|---|---|---|
| 2026-05-04 | `Desktop\CONVERA\SQL\seeds\005_seed_test_users_cmh.sql` | `Desktop\convera-platform\SQL\seeds\005_seed_test_users_cmh.sql` | Old copy ignored. Official copy is under convera-platform. The new copy uses the canonical `(project_code, contract_no)` mapping. |
