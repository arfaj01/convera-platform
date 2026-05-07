# CMH_01 Phase-8 — API Compatibility Matrix

> Authored 2026-05-07 alongside the migration-driver alignment commit.
> One row per endpoint the migration script previously called or now calls.
> "Script before" = `import-cmh01-controlled.js` as committed at `0650de2`.
> "Platform actual" = source of truth in `app/api/**/route.ts` on `main`.
> "Script after" = the realigned driver landed in this commit.

## Legend

| Badge | Meaning |
|---|---|
| ✅ | Script and platform agree; call is compatible. |
| ⚠️ | Script call works but is suboptimal; switched to a better path. |
| ❌ | Script call was broken — endpoint or method does not exist. |
| 🟡 | Endpoint requires user-JWT auth; service-role Bearer is rejected. |
| 📁 | Read-only PostgREST replacement (service-role permitted). |

## Endpoints called by the migration driver

| # | Purpose | Script before (method, path) | Platform actual | Script after | Verdict |
|---|---|---|---|---|---|
| 1 | Lookup contract by `contract_no` | `GET /api/contracts?contract_no=…` (Bearer = service-role) | **Only POST exists** (`app/api/contracts/route.ts` exports `POST` with `withAuth({roles:['director','admin']})`). GET → HTTP 405. | `GET ${SUPABASE_URL}/rest/v1/contracts?contract_no=eq.<n>&select=id,contract_no,title_ar,base_value` (apikey + Bearer = service-role) | ❌ → 📁 |
| 2 | Create contract (fallback if missing) | `POST /api/contracts` (Bearer = service-role) | POST exists, but auth is user-JWT director/admin (`withAuth`). Service-role Bearer would 401. | **Removed.** Script now hard-fails with operator-actionable instructions if contract is missing. Contract creation belongs in seed/UI flow, not in Phase 8 migration. | 🟡 → removed |
| 3 | Lookup user/profile by email | `GET /api/admin/users?email=<e>` (Bearer = service-role) | The route exists as `GET /api/admin/users` but returns ALL profiles (no filtering by email) and requires director cookie/JWT auth. | `GET ${SUPABASE_URL}/rest/v1/profiles?email=eq.<e>&select=id,email` (apikey + Bearer = service-role) | ❌ → 📁 |
| 4 | Update a user's contract roles | `PATCH /api/admin/users/<id>` (Bearer = service-role) | Route exists. Auth: `requireDirector` calls `auth.getUser()` → must be director user JWT. Service-role Bearer → 401. | Same path, but Bearer is now `MIGRATION_USER_JWT` (a real user JWT). Dry-run logs as `[DRY-WRITE]`. | 🟡 → ✅ (with user-JWT) |
| 5 | Create draft claim | `POST /api/claims/create` (Bearer = service-role) | Route exists. Auth: `auth.getUser()` + role check (must be `contractor` on contract OR director). Service-role Bearer → 401. | Same path, Bearer = `MIGRATION_USER_JWT`. The bot user must hold `contractor` role on the staging contract. | 🟡 → ✅ (with user-JWT) |
| 6 | Workflow transition (approve/return/reject) | `POST /api/claims/transition` (Bearer = service-role) | Route exists. Auth: `auth.getUser()`. The route validates `actor_role` against `user_contract_roles` for the user. Service-role Bearer → 401. | Same path, Bearer = `MIGRATION_USER_JWT`. The bot user must hold ALL six contract roles (contractor, supervisor, reviewer, quality, project_manager, final_approver) on the staging contract. | 🟡 → ✅ (with user-JWT) |
| 7 | Upload claim attachments (invoice/approval/completion-cert) | `POST /api/documents` (Bearer = service-role) | **Route does not exist.** Only `GET /api/documents/[id]/download` exists. There is also `POST /api/claims/upload-certificate` for completion certificates only (multipart, supervisor-scoped). | **Removed live call.** Script now logs `attachment.intent` per file. Operator uploads via the platform UI post-migration (or the operator can run a dedicated certificate-only upload pass via `/api/claims/upload-certificate`). | ❌ → intent-log |
| 8 | Create variation order | (intent-only, no real call) | **Route does not exist** for creation. Only `POST /api/change-orders/approve` for approvals. | Unchanged: script logs `vo.intent` only. Operator creates VOs via the change-order admin UI. | (no change) |

## Read-only endpoints used (PostgREST direct)

| Table | Purpose | Query | Auth | Dry-run behavior |
|---|---|---|---|---|
| `contracts` | Lookup contract by `contract_no` | `?contract_no=eq.<n>&select=id,contract_no,title_ar,base_value` | service-role | always issued (read-only diagnostic) |
| `profiles` | Lookup auth user by email | `?email=eq.<e>&select=id,email` | service-role | always issued (read-only diagnostic) |

PostgREST direct is **read-only** in this script. No `INSERT`/`UPDATE`/`DELETE`/`PATCH` is ever issued via the REST endpoint — every mutation goes through the official platform API with a real user JWT.

## Auth-model summary

The previous driver's working assumption was:
> Bearer = `SUPABASE_SERVICE_ROLE_KEY` gives global write access through the platform API.

This is wrong. The platform's API routes call `supabase.auth.getUser()` against the Bearer token, which:
- For a **user access_token** (a real signed-in user) → returns that user; the route applies role checks.
- For the **service-role key** → returns null/error; the route returns 401 `UNAUTHENTICATED`.

The realigned driver therefore separates concerns:

| Concern | Auth | Where used |
|---|---|---|
| Read-only lookup of staging metadata | Service-role key (apikey + Bearer on PostgREST) | Step 1 (contract), Step 2 (profile-by-email) |
| All platform API writes | User JWT (`MIGRATION_USER_JWT`) | Step 2 PATCH, Step 5 claim create + transitions |
| Dry-run | No HTTP at all on writes; PostgREST reads only | Every step |

The dry-run path is now consistent: **no platform API HTTP call is issued in dry-run mode**, regardless of method. Only PostgREST reads are made (and only against staging — production guard refuses the production project ref outright).

## Endpoints not used by the script

For completeness — present in `app/api/**` but not called by Phase 8:
`/api/action-center`, `/api/admin/create-auth-user`, `/api/admin/sync-suspensions`, `/api/admin/users/[id]/contract-roles`, `/api/admin/users/reset-password`, `/api/analytics`, `/api/audit`, `/api/auth/signout`, `/api/change-orders/approve`, `/api/claims/submit`, `/api/claims/upload-certificate`, `/api/documents/[id]/download`, `/api/executive/*`, `/api/notifications/*`.

`/api/claims/submit` is intentionally bypassed: the realigned driver uses `/api/claims/transition` with `action='submit'`, which is the documented portable submission action and matches the multi-role JWT model.
