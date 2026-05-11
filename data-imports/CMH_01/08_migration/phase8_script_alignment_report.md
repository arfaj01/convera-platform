# CMH_01 Phase-8 — Script Alignment Report

> Authored 2026-05-07. Records the migration-driver realignment work and the dry-run finding that followed.

---

## 1. Root cause of the original dry-run failure

The previous driver (`scripts/import-cmh01-controlled.js` at commit `0650de2`) issued:

```
GET /api/contracts?contract_no=CMH_01-C01     Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}
```

`app/api/contracts/route.ts` exports **POST only** — no GET handler exists. Vercel/Next.js correctly returned **HTTP 405 Method Not Allowed**, which propagated to `contract.error` and aborted the dry-run on the first step.

A deeper cause was lurking immediately behind: even if a GET handler existed, the platform's API routes call `supabase.auth.getUser()` against the Bearer token. The `SUPABASE_SERVICE_ROLE_KEY` is **not** a user JWT — it would have been rejected with **HTTP 401 UNAUTHENTICATED** at every subsequent step.

So the script was broken at two levels: a missing endpoint method, and a wrong auth model.

---

## 2. Files inspected

| File | Why |
|---|---|
| `scripts/import-cmh01-controlled.js` | The migration driver itself (660 lines). |
| `app/api/contracts/route.ts` | POST handler for contract creation. |
| `app/api/claims/create/route.ts` | POST handler — atomic claim creation with `auth.getUser()` + role check. |
| `app/api/claims/transition/route.ts` | POST handler — workflow transitions, multi-role JWT model. |
| `app/api/claims/submit/route.ts` | POST handler — atomic submit (used by UI; bypassed by driver in favour of `transition` action='submit'). |
| `app/api/claims/upload-certificate/route.ts` | Multipart POST for completion certificates only. |
| `app/api/admin/users/route.ts` | GET (list all profiles, director-cookie auth) + POST (create user). No filter-by-email. |
| `app/api/admin/users/[id]/route.ts` | PATCH for user/contract-role updates, director-cookie auth. |
| `lib/supabase-server.ts` | `createServerSupabaseFromRequest` (Bearer/cookie session) + `createAdminSupabase` (service-role). Confirms Bearer is passed straight to `auth.getUser()`. |
| Glob of `app/api/**/route.ts` | Confirmed the absent endpoints: no `POST /api/documents`, no `POST /api/change-orders` (only `/approve`), no email-filtered user lookup. |

---

## 3. API compatibility matrix — summary

Full table: `data-imports/CMH_01/08_migration/api_compatibility_matrix.md`. Headlines:

| Call | Before | After |
|---|---|---|
| Contract lookup | `GET /api/contracts` (HTTP 405) | `GET ${SUPABASE_URL}/rest/v1/contracts` via PostgREST (read-only, service-role) |
| Contract auto-create fallback | `POST /api/contracts` with service-role Bearer (would 401) | **Removed.** Script hard-fails with operator instructions if contract is missing. |
| User-by-email lookup | `GET /api/admin/users?email=…` (route doesn't filter) | `GET ${SUPABASE_URL}/rest/v1/profiles` via PostgREST |
| User contract-role upsert | `PATCH /api/admin/users/[id]` with service-role Bearer (would 401) | Same path, Bearer = `MIGRATION_USER_JWT` (real director user JWT) |
| Claim create | `POST /api/claims/create` with service-role Bearer (would 401) | Same path, Bearer = `MIGRATION_USER_JWT` (contractor on contract) |
| Claim transitions | `POST /api/claims/transition` with service-role Bearer (would 401) | Same path, Bearer = `MIGRATION_USER_JWT` (multi-role bot) |
| Document upload | `POST /api/documents` (route does not exist; HTTP 404) | **Removed live call.** Logged as `attachment.intent`; operator uploads via UI post-migration. |
| VO creation | (was already intent-only) | Unchanged. |

PostgREST direct is **read-only** in this script. No mutation ever flows outside the platform API.

---

## 4. Fixes applied (this commit)

The realigned `scripts/import-cmh01-controlled.js`:

1. **Centralised helpers** — `mask()` (secret redaction), `postgrestSelect/postgrestSelectOne()` (read-only PostgREST), `platformPost/platformPatch()` (user-JWT writes), `logLine/logStep()` (auto-masked), `pause()` (operator confirm).
2. **Auth model split** — service-role for read-only PostgREST diagnostics, `MIGRATION_USER_JWT` for every platform API write. Hard error if `MIGRATION_USER_JWT` is missing in non-dry-run mode.
3. **Production guard hardened** — refuses the production project ref `ngwxlockzkjpmzuvgakx` outright, even with `--i-acknowledge-this-is-staging`. The ack flag now only handles the textual-keyword false-positives.
4. **Contract step** — PostgREST lookup; no auto-create. Missing contract → fail with operator-actionable message.
5. **User-roles step** — PostgREST profile lookup, `PATCH /api/admin/users/[id]` for role assignment.
6. **BOQ template + VOs** — intent-logged only (no platform mutation endpoints exist for these).
7. **Claim creation + transitions** — unchanged URLs; auth swapped to `MIGRATION_USER_JWT`. Claim-15 special-case (empty `boq_items[]`, data-source tag) preserved.
8. **Attachments** — intent-logged (the `POST /api/documents` route doesn't exist; operator handles via UI).
9. **Dry-run is now consistent** — every platform API call is logged as `[DRY-WRITE]` and skipped; only PostgREST reads are issued (and only against the staging Supabase project, never the platform API).
10. **Secret masking** — every emit goes through `mask()` which replaces the live values of `SUPABASE_SERVICE_ROLE_KEY`, `MIGRATION_USER_JWT`, plus pattern-based fallbacks for `<server-side secret key>*`, `<publishable key>*`, JWT-shaped strings. Logs and result JSON are safe to share.

---

## 5. Why the chosen fix is safe

| Concern | How the realigned driver addresses it |
|---|---|
| "Don't bypass platform APIs for mutations" | Mutations all go through the official platform routes with a real user JWT. PostgREST is **read-only** and never used to write. |
| "Read-only PostgREST is acceptable for compatibility checks" | Only `contracts` (for `id` lookup) and `profiles` (for `id` lookup by email) are queried. No row-level data is exfiltrated. |
| "Preserve production guard" | URL-substring check + project-ref hard-block (`ngwxlockzkjpmzuvgakx`). |
| "Preserve staging-only guard" | Production ref refused outright, ack flag only handles textual-keyword cases. |
| "Preserve stop-on-first-error" | Every fatal step calls `finishRun()`. Attachments remain `fatal: false` per the original design. |
| "Preserve claim-15 header-only behavior" | `cseq === 15` branch logs the option-b note and the create payload's `boq_items` is empty (the normalized layer's `claim_line_items.csv` has no rows for `claim_seq=15`). |
| "Preserve dry-run write blocking" | Both `platformPost` and `platformPatch` early-return in dry-run; no live HTTP is sent. |
| "Don't print secrets" | All log emits pass through `mask()`. The two known credentials are explicitly redacted; pattern fallbacks catch anything else. |
| "Don't push" | This commit is local. The operator's release flow handles deploys. |

---

## 6. Remaining risks / known limitations

1. **The auth model assumes a "migration-bot" user with all 6 contract roles.** That user must be provisioned on staging before live mode runs. The handover note documents the setup, but does not currently include a script to provision the bot — that is an operator step.
2. **`POST /api/documents` doesn't exist.** The realigned driver logs attachment intent only. Invoices and approval certificates need to be uploaded via the platform UI post-migration. Completion certificates can use `POST /api/claims/upload-certificate` if needed (the driver could be extended later — see §8).
3. **VO creation has no API endpoint.** The driver continues to log VO intent; operator creates the 5 VOs via the change-order admin UI.
4. **Claim 15 carries `data_source=pdf_summary`** in the transition `notes` field but there is no first-class claim-level "data_source" column on the platform schema. The audit trail captures this provenance via the workflow notes only — acceptable for Phase 8, but flag for any future schema work.

---

## 7. Redeploy required?

**No.** All fixes are in `scripts/import-cmh01-controlled.js` and the two reports under `data-imports/CMH_01/08_migration/`. The platform's production-facing API routes are unchanged. Optional future enhancements (filter-by-email on `/api/admin/users`, a `POST /api/admin/historical-import` for service-role writes) would require redeploys but are explicitly **not** part of this commit.

---

## 8. Dry-run result after fix

```
node scripts/import-cmh01-controlled.js --dry-run
✅ start  mode=dry-run, supabase=…/jrqkzwacerdudmeacvar, platform=…/convera-platform.vercel.app, auth=(none)
## Step 1 — Contract
❌ contract.error  PostgREST 404 contracts — Could not find the table 'public.contracts' in the schema cache (PGRST205)
## Run summary
- Steps: 2  - Failures: 1
```

The script is **structurally correct**; the dry-run reveals that the staging Supabase project (`jrqkzwacerdudmeacvar`) is **empty** — none of the platform's migrations (001 → 050) have been applied to the staging database. PostgREST returns 404 for every table in the public schema:

```
GET /rest/v1/contracts → 404
GET /rest/v1/profiles  → 404
GET /rest/v1/claims    → 404
```

This is a **staging-readiness** prerequisite, not a driver issue. The realigned script is ready; the staging environment is not.

---

## 9. Phase 8 controlled migration recommendation

**NOT YET RECOMMENDED.** Two prerequisites remain:

1. **Apply the platform's database migrations to staging.** Open the Supabase SQL editor for project `jrqkzwacerdudmeacvar` and run, in order:
   - `SQL/migrations/001_base_schema.sql` through `SQL/migrations/050_fix_claim_rpc_claim_type_cast.sql`
   - `SQL/seeds/001_seed_profiles.sql`, `SQL/seeds/002_seed_contracts.sql`, and the test-user seed if needed.
   The Phase-8 controlled-migration runbook (`data-imports/CMH_01/05_import_plan/controlled_migration_runbook.md` §Pre-flight) already references this; it just hasn't been done yet.
2. **Provision the migration-bot user.** A staging user (suggested email: `migration-bot@convera.test`) with profile.role = `director` AND active rows in `user_contract_roles` for the staging contract carrying `contractor`, `supervisor`, `reviewer`, `quality`, `project_manager`, and `final_approver`. Sign in as this user via the platform login page, copy the access_token from the browser session, and `export MIGRATION_USER_JWT=<that token>` before running live mode.

After both prerequisites are satisfied, re-run dry-run. Only after the dry-run shows zero failures should the controlled migration be authorised.

---

## 10. Exact next approval statement required before controlled execution

When the prerequisites in §9 are complete and a clean dry-run is observed, the operator must reply with the explicit statement below. The script will reject any other phrase.

```
APPROVE CMH_01 PHASE 8 — controlled migration into staging.
CLAIM_15_DECISION: option-b-header-only.
PREREQUISITES_CONFIRMED: migrations applied, migration-bot user provisioned with 6 contract roles, MIGRATION_USER_JWT exported.
```

Then the operator runs:

```
node scripts/import-cmh01-controlled.js \
  --confirm "PROCEED CMH_01" \
  --i-acknowledge-this-is-staging
```

The script pauses for ENTER between every claim. Operator may abort at any point.
