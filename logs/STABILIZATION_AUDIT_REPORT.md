# CONVERA Stabilization Audit — Claims, Auth, and Operational Readiness

> **Date:** 2026-05-05
> **Repository (official):** `C:\Users\Administrator\Desktop\convera-platform`
> **Branch:** `main`
> **HEAD:** `77e2de5` *— equal to `origin/main` (0 ahead / 0 behind).*
> **Scope:** Read-only audit across 10 phases. **No code changes, no SQL, no commits, no pushes.**
> **Constraints honored:** the forbidden legacy path on `Desktop` was not touched; protected workflow files (`lib/workflow-engine.ts`, `lib/action-engine.ts`, `lib/notification-engine.ts`, `lib/sla-engine.ts`, `lib/sla-escalation.ts`, `app/api/claims/submit/route.ts`, `app/api/claims/transition/route.ts`) were read for cross-reference only and are not proposed for modification.

---

## 1. Executive summary

The **server side** of the Phase 2.6 + Gap-Review work is structurally correct: Migrations 047 + 048 are present, idempotent, additive, and the atomic RPC enforces every governance rule the spec requires. `/api/claims/create` correctly strips client-sent previous quantity, resolves the project code with no silent fallback, and emits Arabic error copy with a `error_code` discriminator. The four corrective UI commits (A–D) from yesterday are landed in `origin/main` and `tsc --noEmit` is clean.

**The runtime instability the team observed is concentrated in two places, not in the data path:**

1. **The new-claim page swallows the API's structured Arabic error message** and throws a generic `new Error('فشل في إنشاء المطالبة')` whenever `claim?.data?.id` is missing. That generic Error is then routed through `friendlyError()` which has no pattern for the Arabic phrase, so it falls through to the catch-all toast *حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.* The exact symptom the team reported. The fix is in *one* if-block on the page and *zero* changes to the API or RPC.

2. **Migration application status to the running database cannot be confirmed from this audit** (no DB read access from the sandbox). If Migrations 047/048 are not applied to the test database the symptom is identical — every save returns a generic 500 from the API because `supabase.rpc('create_claim_with_items_atomic')` errors with "function does not exist", which then routes through the same broken error pipeline above.

The audit also surfaces one **architectural** P1: the project-code resolver in `lib/claim-number.ts` is a frozen literal map of three contracts plus a `CMH_xx-Cyy` regex. The platform is targeting 5–10 contracts. Any new contract whose `contract_no` doesn't match the regex and isn't in the explicit map will hard-fail with `PROJECT_CODE_REQUIRED`. Recommendation: **add a `project_code` column to `contracts` (Migration 049, additive)** and resolve from the row.

**Recommendation:** **Fix forward.** Three small commits (described in §12) close the runtime symptom and make the platform diagnosable enough to run the smoke test. **Rollback is not recommended** — the underlying flow is structurally sound; only the error-surface layer is broken.

---

## 2. Current repo / deployment state

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `77e2de58057f70ff4e67111ffab71aba9803c2eb` |
| `git rev-parse origin/main` | `77e2de58057f70ff4e67111ffab71aba9803c2eb` |
| `git rev-list --left-right --count origin/main...HEAD` | `0   0` *— in sync, push complete since the previous session* |
| `git status --short` | Single pre-existing modified file: `M .env.local.example` *(not introduced by audit)* |
| `npm run verify:repo-path` | PASS — 0 errors / 0 warnings |
| `npx tsc --noEmit -p tsconfig.json` | CLEAN against source. The only diagnostics emitted are `TS1127: Invalid character` against stale `.next/types/*` artifacts that the sandbox cannot delete (read-only on unlink). Filtered out — no source-file errors. |
| `npm run build` | Times out at the **45-second sandbox limit** before Webpack starts compiling. Same documented constraint as the previous session. **Must be run on a developer machine (≥ 5-minute window) before any push.** |
| Last 6 commits | `77e2de5 chore(claims): document gap-review fixes…` → `b44a438` → `a0a5df2` → `c446300` → `f6b84d3 chore(env): fix test user password placeholder` → `7082a23 chore(claims): document auto-numbered claim submission flow` |

**Working-tree drift:** `.env.local.example` last byte sequence is `TEST_USER_PASSWORD=ض�` (one Arabic letter followed by the Unicode replacement character). Compare with the committed value `TEST_USER_PASSWORD=ضع_كلمة_المرور_الموحدة`. This is a local-only corruption with no production impact, but it noises every `git status`. P1 cleanup item.

**Deployment status of the latest pushed code:** unknown from the sandbox alone — depends on the user's deployment pipeline. The git ref state confirms the code is *pushable-equivalent-to-pushed* (all commits in origin/main).

---

## 3. Auth and seed health

### 3.1 Environment variables

`.env.local` is **not visible from the sandbox** (the FUSE mount does not surface it; it presumably exists only on the developer host). Audit therefore cannot confirm values. Required keys, per `scripts/create-test-auth-users.js:60-85`:

| Key | Required by | Status from sandbox |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + admin scripts | unverifiable from sandbox |
| `SUPABASE_SERVICE_ROLE_KEY` | admin scripts only | unverifiable from sandbox |
| `TEST_USER_PASSWORD` | `seed:auth-users` only | unverifiable from sandbox |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client (browser Supabase client) | referenced in `lib/supabase.ts`, `middleware.ts`, `app/api/admin/users/route.ts` — **not declared in `.env.local.example`** |

**Finding:** `.env.local.example` is missing the `NEXT_PUBLIC_SUPABASE_ANON_KEY` entry. New developers onboarding the project will hit a runtime error in the browser client unless they know to look at `lib/supabase.ts`. P1 documentation gap.

### 3.2 Seeding pipeline

| Question | Answer |
|---|---|
| Does `SQL/seeds/005_seed_test_users_cmh.sql` write to `auth.users` or `auth.identities`? | **NO.** `grep -E "INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\."` returns zero matches. The file's header documents this contract explicitly (lines 22-31). |
| Does Phase 2 of the seed pre-flight-check the auth side? | YES. The script raises a clear `EXCEPTION` if any of the 8 users is missing from `auth.users` / `auth.identities` (`provider='email'`) or if `email_confirmed_at IS NULL`. |
| Is `scripts/create-test-auth-users.js` idempotent? | YES. `findExistingUser()` lookups by email; create-on-miss / metadata-update on existence. `--reset-passwords` is opt-in. |
| Does the script print the password? | NO. Script comment (line 27) commits to never logging it; verified — no `console.log(... TEST_USER_PASSWORD ...)` exists. |
| Exit codes | `0` = all 8 healthy, `1` = ≥1 provision failure, `2` = env misconfigured. |

### 3.3 Eight-user diagnostic checklist

For each of the 8 users, an operator can verify the following six gates **before** running the SQL seed:

| User (email) | Role expected | Auth gate | Profile gate | Role gate | Login |
|---|---|---|---|---|---|
| Ma.Alarfaj@momah.gov.sa | director | □ auth.users □ auth.identities (email) □ email_confirmed_at | □ profiles row □ active=true | □ contract_approvers (final_approver) □ is_active | □ |
| halhablayn-Contractor@momah.gov.sa | reviewer | □ □ □ | □ □ | □ user_contract_roles (project_manager) □ is_active | □ |
| aaldera-contractor@momah.gov.sa | reviewer | □ □ □ | □ □ | □ user_contract_roles (quality) □ is_active | □ |
| anaalghamdi-contractor@momah.gov.sa | reviewer | □ □ □ | □ □ | □ user_contract_roles (reviewer) □ is_active | □ |
| mahmoud.ragab@beeah.sa | consultant | □ □ □ | □ □ | □ user_contract_roles (supervisor/consultant) □ is_active | □ |
| info@gdci.com.sa | contractor | □ □ □ | □ □ | □ user_contract_roles (contractor) □ is_active | □ |
| fakher@alleanzaa.com | contractor | □ □ □ | □ □ | □ user_contract_roles (contractor) □ is_active | □ |
| malek.h.mkh@gmail.com | contractor | □ □ □ | □ □ | □ user_contract_roles (contractor) □ is_active | □ |

SQL queries for the checklist:

```sql
-- Auth gate (run as service_role)
SELECT u.email,
       u.email_confirmed_at IS NOT NULL AS email_confirmed,
       i.provider AS identity_provider,
       u.banned_until,
       u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN auth.identities i
    ON i.user_id = u.id AND i.provider = 'email'
 WHERE lower(u.email) IN (
    'ma.alarfaj@momah.gov.sa',
    'halhablayn-contractor@momah.gov.sa',
    'aaldera-contractor@momah.gov.sa',
    'anaalghamdi-contractor@momah.gov.sa',
    'mahmoud.ragab@beeah.sa',
    'info@gdci.com.sa',
    'fakher@alleanzaa.com',
    'malek.h.mkh@gmail.com'
 )
 ORDER BY u.email;

-- Profile gate
SELECT id, email, role, full_name_ar, is_active
  FROM profiles
 WHERE lower(email) IN ( ...same 8 emails... )
 ORDER BY email;

-- Contract role gate
SELECT p.email, ucr.contract_role, ucr.is_active, c.contract_no
  FROM user_contract_roles ucr
  JOIN profiles p ON p.id = ucr.user_id
  JOIN contracts c ON c.id = ucr.contract_id
 WHERE lower(p.email) IN ( ...same 8 emails... )
 ORDER BY p.email, c.contract_no;
```

**Operator flow** (only if asked to repair auth users):

```bash
# In the project root, with .env.local populated:
npm run seed:auth-users                  # idempotent: creates missing, refreshes metadata
# OR if a password rotation is required:
npm run seed:auth-users -- --reset-passwords
```

**Audit did NOT run any of the above** per the operating directive.

---

## 4. Database migration health

### 4.1 Migration 047 — `claim_kind_and_number.sql`

**Status:** present in repo, BEGIN/COMMIT-wrapped, idempotent throughout. **Application status to the live test DB is unverified from the sandbox.**

| Validation | Query (run after applying) |
|---|---|
| Six new columns exist | `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='claims' AND column_name IN ('claim_kind','claim_number','work_period_from','work_period_to','external_reference','claim_sequence') ORDER BY column_name;` (expect 6 rows, all `is_nullable='YES'`) |
| `claim_kind` enum has 3 values | `SELECT enumlabel FROM pg_enum WHERE enumtypid='claim_kind'::regtype ORDER BY enumsortorder;` (expect: running_payment, final_payment, advance_payment) |
| Three indexes exist | `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='claims' AND indexname IN ('ux_claims_claim_number','ux_claims_contract_sequence','ix_claims_contract_status_open') ORDER BY indexname;` (expect 3 rows) |
| `chk_work_period_order` exists | `SELECT conname, convalidated FROM pg_constraint WHERE conname='chk_work_period_order' AND conrelid='public.claims'::regclass;` (expect 1 row; `convalidated` may be `f` until manually `VALIDATE`d, that is acceptable) |
| Legacy claims unaffected | `SELECT COUNT(*) AS total, COUNT(claim_kind) AS with_kind, COUNT(claim_number) AS with_number FROM claims;` (expect `with_kind = with_number = 0` immediately after Migration 047 applies) |

### 4.2 Migration 048 — `create_claim_with_items_atomic.sql`

**Status:** present, idempotent (`CREATE OR REPLACE FUNCTION`), `SECURITY DEFINER`, granted to `authenticated, service_role`. Pre-flight inside Migration 048 raises a clear EXCEPTION if Migration 047 did not run first. **Application status unverified from the sandbox.**

| Validation | Query |
|---|---|
| Function exists, SECURITY DEFINER | `SELECT proname, prosecdef FROM pg_proc WHERE proname='create_claim_with_items_atomic';` (expect `prosecdef = true`) |
| Signature has 14 IN parameters in the documented order | `SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname='create_claim_with_items_atomic';` (expect: `p_contract_id uuid, p_claim_kind claim_kind, p_claim_type text, p_work_period_from date, p_work_period_to date, p_external_reference text, p_actor_id uuid, p_project_code text, p_boq_amount numeric, p_staff_amount numeric, p_retention_amount numeric, p_vat_amount numeric, p_boq_items jsonb, p_staff_items jsonb`) |
| Return type | `RETURNS jsonb` (per definition lines 93) |
| Open-claim guard fires | Smoke test in 048 lines 393-407 — wrap a call in `BEGIN ... ROLLBACK` for safety |
| Project-code-required path raises `PROJECT_CODE_REQUIRED` | Pass `NULL` or empty `p_project_code` and confirm 22023 raise (lines 145-149) |
| Previous-quantity calc filters approved-only | Lines 200-206 and 282-288 both use `c.status = 'approved'` |

### 4.3 Code dependence on migration application

The TS/TSX surface has **66 call-sites** referencing the new schema columns or RPC. If Migration 047 is not applied: the `/api/claims/create` route returns 500 because PostgREST cannot serialise an `INSERT` referencing nonexistent columns. If Migration 048 is not applied but 047 is: the route returns 500 because `supabase.rpc('create_claim_with_items_atomic', …)` errors with `Could not find the function`. **In either case the symptom presents to the user as the generic toast described in §6 — the audit cannot distinguish "RPC missing" from "page swallows error" without DB access.**

**P0 prerequisite for any smoke test:** confirm both validation queries above against the live test DB before clicking anything in the UI.

---

## 5. Claim creation flow map

### 5.1 Text-form flow diagram

```
        user clicks  حفظ كمسودة          user clicks  تقديم المطالبة
              │                              │
              ▼                              ▼
   handleSave(asDraft=true)          handleSave(asDraft=false)
   app/(app)/claims/new/page.tsx:280
              │                              │
              │   validate() — UI guards (lines 207-228):
              │     • contract chosen
              │     • work_period_from / work_period_to set + ordered
              │     • current quantity set on ≥1 BOQ row
              │     • boqHasErrors === false
              │     • (asDraft=false only) invoiceFile attached
              │
              ▼
   buildPayload() — assembles boqRows + staffRows + claimType
   (services/claims.ts::createClaim signature)
              │
              ▼
   ┌───────────────────────────────────────────────────────────┐
   │ services/claims.ts::createClaim                            │
   │   POST /api/claims/create                                  │
   │   body: { contract_id, claim_kind, claim_type,             │
   │           work_period_from, work_period_to,                │
   │           external_reference,                              │
   │           boq_amount, staff_amount,                        │
   │           retention_amount, vat_amount,                    │
   │           boq_items[*], staff_items[*] }                   │
   │   on response: returns { data, error, success } (ApiResp)  │
   └───────────────────────────────────────────────────────────┘
              │
              ▼
   ┌───────────────────────────────────────────────────────────┐
   │ app/api/claims/create/route.ts (POST)                      │
   │  1. Auth via JWT (Authorization header or cookie)          │
   │  2. Body parse + minimal shape validation                  │
   │     • claim_kind ∈ {running, final, advance}               │
   │     • claim_type ∈ {boq_only, staff_only, mixed,           │
   │                     supervision}                           │
   │     • work_period_to >= work_period_from                   │
   │  3. Resolve contract.contract_no → projectCode             │
   │     via lib/claim-number.ts::resolveProjectCode            │
   │     → fail 422 PROJECT_CODE_REQUIRED if null               │
   │  4. AuthZ: caller is contractor on this contract OR        │
   │     a global director                                      │
   │  5. sanitiseBoqItems — STRIPS prev_progress,               │
   │     previous_quantity, cumulative, period_amount,          │
   │     after_perf from every row                              │
   │  6. RPC call:                                              │
   │     adminClient.rpc('create_claim_with_items_atomic', …)   │
   └───────────────────────────────────────────────────────────┘
              │
              ▼
   ┌───────────────────────────────────────────────────────────┐
   │ Migration 048: create_claim_with_items_atomic              │
   │   (SECURITY DEFINER; one transaction; no partial state)    │
   │   1. Validate inputs                                       │
   │   2. Confirm contract row exists                           │
   │   3. Open-claim guard:                                     │
   │      COUNT(claims WHERE contract_id=:c AND status NOT IN   │
   │       ('approved','rejected','cancelled','closed')) > 0    │
   │      ⇒ raise OPEN_CLAIM_EXISTS                             │
   │   4. pg_advisory_xact_lock(hashtext('claim:'||contract_id))│
   │   5. For each BOQ item:                                    │
   │      v_prev := SUM(curr_progress) over approved claims     │
   │                  for this (contract, item_no)              │
   │      validate curr >= 0  → CURR_PROGRESS_NEGATIVE          │
   │      validate curr <= contractual − v_prev                 │
   │                  → CURR_PROGRESS_EXCEEDS_REMAINING         │
   │   6. v_new_sequence := MAX(claim_sequence)+1 per contract  │
   │   7. v_claim_number := <ProjCode><R/F/A><YYMMDD>-<NNN>     │
   │      (NOW() AT TIME ZONE 'Asia/Riyadh')                    │
   │   8. INSERT INTO claims (status='draft', …)                │
   │   9. INSERT INTO claim_boq_items (with server prev_progress)│
   │  10. INSERT INTO claim_staff_items (pass-through)          │
   │  11. RETURN jsonb { id, claim_no, claim_number,            │
   │                     claim_sequence, claim_kind,            │
   │                     status:'draft' }                       │
   └───────────────────────────────────────────────────────────┘
              │
              ▼
   page.tsx handleSave continues:
   const claimId = claim?.data?.id;
   if (!claimId) throw new Error('فشل في إنشاء المطالبة');     ← ⚠ point of failure (§6)
              │
              ├─ if invoiceFile present:
              │     uploadClaimDocument(claimId, invoiceFile, …)
              │
              ├─ if asDraft: toast success + redirect
              │
              └─ else: submitClaim(claimId)
                       │
                       ▼
                /api/claims/submit (PROTECTED — not audited deeply)
                → submit_claim_atomic RPC
                draft → under_supervisor_review (atomic)
                       │
                       ▼
                toast success + redirect
```

### 5.2 Single-button-or-two-buttons?

Two distinct API endpoints (`/api/claims/create` and `/api/claims/submit`) are called in sequence by `handleSave(false)`. The "تقديم المطالبة" button performs **create-then-submit** atomically from the user's POV but at *two* network round-trips. Either one can fail; both surface their errors via the broken pipeline in §6.

The "حفظ كمسودة" button calls only `/api/claims/create` and stops there.

### 5.3 Locations where the generic toast is generated

1. **Page catch (the one that fires):** `app/(app)/claims/new/page.tsx:362` — `showToast(friendlyError(e), 'error');` after `try { … }`. `friendlyError(e)` falls through to the generic when `e.message === 'فشل في إنشاء المطالبة'` (no pattern match in the map).
2. **`lib/errors.ts:96`** — `FALLBACK_MESSAGE` literal. This is the source of the exact Arabic copy the user reported.
3. **API → service:** if `response.ok === false`, `services/claims.ts:293` returns the API's own error. That error (in Arabic) is *available* but never reaches the user because of #1.

---

## 6. Error-handling findings

### 6.1 Symptom

Toast: *حدث خطأ غير متوقع، يرجى المحاولة مرة أخرى أو التواصل مع الدعم الفني.*

### 6.2 Root cause (verified by code read)

`app/(app)/claims/new/page.tsx:296-324` reads:

```tsx
const claim = await createClaim({...});
const claimId = claim?.data?.id;
if (!claimId) throw new Error('فشل في إنشاء المطالبة');
```

When the API returns an error (e.g. `OPEN_CLAIM_EXISTS`, `CURR_PROGRESS_EXCEEDS_REMAINING`, `PROJECT_CODE_REQUIRED`), `services/claims.ts::createClaim` (line 291-294) parses the JSON response and returns:

```ts
{ data: undefined, error: '<arabic message from API>', success: false }
```

The page reads `claim?.data?.id` (which is `undefined`), enters the `if (!claimId)` branch, and **throws a brand-new `Error('فشل في إنشاء المطالبة')`** — discarding `claim.error` entirely. That Error then propagates to the outer `catch (e)` which calls `friendlyError(e)`. `friendlyError` matches `e.message` against a pattern map (`lib/errors.ts:5-94`); the literal `'فشل في إنشاء المطالبة'` matches none of the patterns; the fallback returns the generic Arabic message. The user sees that.

### 6.3 What the API actually returns

`/api/claims/create` (route.ts:152-197) maps RPC exceptions to localized Arabic via `mapRpcExceptionToResponse`. Codes mapped: `OPEN_CLAIM_EXISTS`, `CONTRACT_NOT_FOUND`, `CURR_PROGRESS_NEGATIVE`, `CURR_PROGRESS_EXCEEDS_REMAINING`, `WORK_PERIOD_ORDER`, `WORK_PERIOD_REQUIRED`, `CLAIM_KIND_REQUIRED`, `PROJECT_CODE_REQUIRED`, `ACTOR_REQUIRED`, `CONTRACT_REQUIRED`. All have user-grade Arabic copy. Response shape:

```json
{ "error": "<arabic message>", "error_code": "<code>" }
```

### 6.4 Recommended structured contract

Standardise on the shape the user requested in the audit:

```ts
interface ApiErrorBody {
  code:      string;          // machine-readable (e.g. "OPEN_CLAIM_EXISTS")
  messageAr: string;          // user-facing Arabic copy
  details?:  Record<string, unknown>;   // optional, never includes secrets
}
```

The smallest disruptive change is to add `messageAr` and `code` while keeping `error`/`error_code` as deprecated aliases for one release window, so any other consumers that depend on the old keys keep working. The `lib/errors.ts::friendlyError` function should consult `result.code` first, fall back to `result.messageAr`, and only invoke pattern matching when neither is present.

### 6.5 Console logging hygiene

`lib/errors.ts:102` already logs via `console.error('[CONVERA Error]', raw, error)`. No secret material is included (raw is the Supabase error message body — does not echo headers or env vars). Acceptable.

### 6.6 Production exposure of raw DB errors

Currently the route's fallback handler (route.ts:196) emits `فشل إنشاء المطالبة: <raw rpc error message>` for unmapped codes. The raw RPC message can include the offending contract UUID and item_no values — *informational, not secret*. This is acceptable but should be gated by `process.env.NODE_ENV === 'development'` if the deployment is ever public-facing. In the current ministry-internal deployment there is no exfiltration risk.

---

## 7. Project-code resolver findings

### 7.1 Current state (`lib/claim-number.ts`)

```ts
const EXPLICIT_PROJECT_CODE_MAP = Object.freeze({
  'CMH_01-C01':   'CMH01',
  '250101116428': 'CMH02',
  '241039011332': 'CMH03',
});
const CMH_SHORT_CODE_RE = /^CMH_(\d{2})-C\d+$/;
```

- The regex catches *any* future contract whose `contract_no` is `CMH_NN-CMM`. So onboarding a new "CMH-style" contract is mapping-free.
- Anything that does **not** match the regex (notably the 12-digit MoMaH contract numbers) **must** be added to `EXPLICIT_PROJECT_CODE_MAP` *and* deployed before the contract can be used.
- On miss, the resolver returns `null`. The API correctly maps that to a 422 with Arabic copy `تعذّر تحديد كود المشروع لهذا العقد — تواصل مع مدير الإدارة قبل المتابعة.` There is **no silent first-8-digits fallback**. ✓

### 7.2 Risk classification

**HIGH** — at current 5–10 contract scope, the resolver works only for the three already-onboarded contracts. The next contract added in production will hard-fail every claim attempt until a developer edits `lib/claim-number.ts` and ships a deploy. The failure copy is Arabic and clear, but the operational latency (developer turnaround) is unacceptable for a governance platform.

### 7.3 Recommended permanent design

**Option B — `project_code` column on `contracts` (recommended).**

Add `project_code TEXT` to `contracts` via Migration 049 (additive, nullable initially). Backfill the three existing rows. Replace the `lib/claim-number.ts::resolveProjectCode` body with a single `SELECT project_code FROM contracts WHERE id = :contract_id`. The route already fetches the contract row for `contract_no` (route.ts:241-249) — extend the SELECT to include `project_code`.

| Aspect | Result |
|---|---|
| New contracts onboarded | A SQL row insert sets `project_code`; no code deploy needed. |
| Resolver complexity | One SQL SELECT replaces the JS map + regex + comments. |
| Auditability | Project-code history lives next to contract history; one source of truth. |
| Rollback | Drop column or set NULL — the API can fall back to the existing JS resolver if `project_code IS NULL` for a transition window. |
| Migration shape | Additive ALTER + backfill UPDATE for three rows + future NOT NULL pass once all rows have a value. |

**Option A — `contract_project_codes` mapping table.** Heavier; useful only if you anticipate multiple project codes per contract over time (e.g. legal restructure). Not justified at this scope.

**Option C — Config file (e.g. `config/project-codes.json`).** Lighter than Option B but still requires a deploy to take effect. Equivalent operational pain.

**Recommendation:** schedule Option B as Migration 049 + a 5-line code change. P1 — desirable before any new contract is onboarded.

---

## 8. BOQ quantity governance findings

| Layer | Field | Contract | Verified | Evidence |
|---|---|---|---|---|
| UI | `prev_progress` editable? | NO — always read-only with padlock | YES | `BOQTable.tsx` has no `<input>` bound to `prev`; only the curr input remains. |
| UI | `curr_progress` editable? | YES | YES | `BOQTable.tsx:135-145` |
| UI | label for `prev_progress` | الكمية السابقة | YES | `BOQTable.tsx:81` |
| UI | label for `curr_progress` | الكمية الحالية | YES | `BOQTable.tsx:82` |
| Service | prev aggregation | `WHERE status = 'approved'` (approved-only) | YES | `services/claims.ts:401` (post-Commit C) |
| API | strips client-sent prev | `sanitiseBoqItems` rebuilds a whitelist that omits `prev_progress` | YES | `route.ts:115-128` |
| RPC | recomputes prev | `SUM(curr_progress) WHERE status='approved'` for the contract+item | YES | Migration 048 lines 200-206 (validation pass) and 282-288 (insert pass) — same query, twice |
| RPC | curr ≥ 0 | raises `CURR_PROGRESS_NEGATIVE` (errcode 22023) | YES | Migration 048 lines 192-196 |
| RPC | curr ≤ remaining | raises `CURR_PROGRESS_EXCEEDS_REMAINING` | YES | Migration 048 lines 208-217 |
| RPC | cumulative | `cumulative = v_prev_progress + v_curr_progress` (qty) | YES | Migration 048 lines 296, 309 |
| RPC | period_amount | `curr_progress × unit_price`, then `× perf_pct/100` for `after_perf` | YES | Migration 048 lines 290-291 |
| RPC | staff items | Pass-through, no prev computation, no validation | YES | Migration 048 lines 317-341 |
| Open-claim guard | active | `status NOT IN ('approved','rejected','cancelled','closed')` | YES | Migration 048 lines 165-177; index `ix_claims_contract_status_open` matches the same set (Migration 047 lines 212-214) |

**No mismatch detected** between UI / service / API / RPC for BOQ governance after Commits A–D. The only minor cosmetic relic is a stale comment string `الكميات المنفذة` in `app/(app)/claims/new/page.tsx:77` (in a JSDoc block, not user-visible) — flagged P2.

**Cumulative *amount* column:** `claim_boq_items.cumulative` carries the cumulative quantity. The cumulative monetary amount is reproducible as `cumulative * unit_price` but is not stored as its own column. Reports that need the value as a single SELECT can compute it inline. Optional follow-up flagged in `logs/CLAIM_SUBMISSION_ENHANCEMENT.md` §7.

---

## 9. UI consistency findings

### 9.1 Required strings — present in source?

| Required Arabic text | Source-tree count | Notes |
|---|---|---|
| نوع المطالبة | 2 | dropdown label + helper |
| فترة تنفيذ الأعمال | 2 | from + to labels |
| الرقم المرجعي الخارجي | 2 | label + comment |
| سيتم توليد رقم المطالبة | 1 | banner copy |
| الكمية السابقة | 3 | header + locked-cell display + JSDoc |
| الكمية الحالية | 4 | header + cell + comments + helper |
| قيمة المستخلص الحالي | 2 | header + footer |
| القيمة التراكمية | 1 | header |
| محسوب تلقائياً من المطالبات المعتمدة | 2 | padlock title + tooltip text |

### 9.2 Old strings — fully removed?

| Legacy text | Source-tree count | Status |
|---|---|---|
| الكميات المنفذة | **1** | leftover in code comment `app/(app)/claims/new/page.tsx:77` (not user-visible) |
| الكميات الحالية (جاري) | 0 | clean |
| المستحق الجاري | 0 | clean |
| المبلغ الإجمالي | 0 | clean |
| إجمالي تكلفة الفاتورة | 0 | clean |

### 9.3 Classification of any UI-vs-screenshot gap

**The source matches the gap-review spec.** Therefore any gap the team observes between the screenshot and the source file falls into one of:

| Possibility | How to confirm |
|---|---|
| **Browser cache** | Hard refresh (Cmd+Shift+R / Ctrl+F5) and re-open `/claims/new`. |
| **Deployment lag** | Confirm the host is running the build that includes commits `c446300` … `77e2de5`. Check `git rev-parse HEAD` on the deployment server vs `origin/main`. |
| **Wrong component** | Unlikely — the new-claim page imports exactly `@/components/claims/BOQTable` (`page.tsx:9`) and renders it inside the "بنود العقد" card (`page.tsx:572-577`). |
| **Incomplete implementation** | Already audited in §8 + §9.1/9.2 — no gap in the source. |

Operator action: rebuild the staging frontend bundle and re-test.

---

## 10. Blocking issues

The following must be resolved before resuming any business testing:

| # | Class | Blocker | Why |
|---|---|---|---|
| **B1** | Verification | Confirm Migrations 047 + 048 are applied to the live test DB (run §4.1 / §4.2 validation queries). | Without this, every claim save returns the generic toast and the team will continue chasing a phantom UI bug. |
| **B2** | Verification | Confirm the build that's serving production includes `77e2de5`. | A stale build masks the gap-review fixes regardless of git state. |
| **B3** | Bug | New-claim page swallows the API's Arabic error message (§6.2). | The single most-reported runtime symptom. Trivial fix; high impact. |

Everything else is a non-blocking improvement.

---

## 11. Rollback option assessment

**Recommendation: do NOT roll back. Fix forward.**

| Rollback target | Impact | Verdict |
|---|---|---|
| Revert Commits A–D (gap review) | Restores the old required-`refNo` validation, old BOQ headers, old approved-only/closed mismatch. **Does not fix the generic-toast bug** — that bug is older than Commit A. | Not useful. |
| Revert to `f6b84d3 chore(env): fix test user password placeholder` | Same as above — generic-toast bug pre-dates Phase 2.6 / Commit 5 (`lib/errors.ts` and the `if (!claimId)` pattern have been in place for several earlier commits). | Not useful. |
| Revert to before `feat(api): create claims with server-issued claim numbers` (`abe3b0d`) | Restores the browser-direct INSERT path. Loses every governance guarantee added in Phase 2.6: open-claim guard, server-truth prev, atomic insert, claim_number generation, project-code validation. Recreates the original Excel-style claim-numbering chaos. | **Strongly disrecommended.** |

**Rollback is not justified.** The audited backend is correct; the audited UI is correct; only the error pipeline is broken, and the fix is one if-block. Roll forward.

---

## 12. Proposed fix commits (NOT yet implemented)

Three small, focused commits — all UI/library — close the runtime instability. Each requires explicit approval before implementation per the operating directive.

### Commit S1 — `fix(claims-ui): surface API Arabic error in toast and treat structured errors as first-class`

**Files:**
- `app/(app)/claims/new/page.tsx`
- `services/claims.ts` *(optional — only if we add the new-shape pass-through helper)*

**Change shape (illustrative, not yet applied):**

```tsx
// Replace lines ~317-318 of app/(app)/claims/new/page.tsx
const claim = await createClaim({...});

if (!claim.success || !claim.data?.id) {
  // Prefer the API's localized message (services/claims.ts already
  // populates `claim.error` with whatever /api/claims/create returned).
  // Only fall back to friendlyError() when no Arabic message is available.
  const message = claim.error || friendlyError(new Error('NO_DATA'));
  showToast(message, 'error');
  setSubmitting(false);
  return;
}

const claimId = claim.data.id;
```

Apply the same pattern to the `submitClaim(claimId)` branch (line ~341) so submission errors also surface the API's Arabic copy.

**Validation:**
- `npm run verify:repo-path`
- `npx tsc --noEmit -p tsconfig.json`
- `npm run build` (locally)
- Manual: trigger an `OPEN_CLAIM_EXISTS` (try creating a second draft) — toast must show the Arabic copy from the API, not the generic fallback.
- Manual: trigger `CURR_PROGRESS_EXCEEDS_REMAINING` — same expectation.

**Risk:** very low. The change is one early-return; it cannot make any currently-working code path fail.

**Rollback:** `git revert <sha>`.

### Commit S2 — `feat(api): adopt {code, messageAr, details?} error contract and update consumers`

**Files:**
- `app/api/claims/create/route.ts` (response shape: emit `code` + `messageAr` *and* keep `error_code` + `error` for one release window)
- `app/api/claims/submit/route.ts` *(this is a PROTECTED file — DO NOT TOUCH WITHOUT EXPLICIT APPROVAL)*. **Skip this file unless the team approves; the create-route change is independently useful.**
- `services/claims.ts` (read both old and new keys)
- `lib/errors.ts` (consult `code` first, then `messageAr`, then pattern match — three-tier)

**Validation:** as for S1 plus a unit-style assertion that the API still returns `error_code` for one release window.

**Risk:** medium — touching `lib/errors.ts` ripples across the whole app's error toasts. Worth it for diagnosability.

**Rollback:** `git revert <sha>`.

### Commit S3 — `chore(env): unbreak .env.local.example and document NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Files:**
- `.env.local.example`

**Change:** restore `TEST_USER_PASSWORD=ضع_كلمة_المرور_الموحدة` (the byte sequence currently committed in HEAD), add a `NEXT_PUBLIC_SUPABASE_ANON_KEY=…` line with placeholder, ensure trailing newline.

**Validation:** `git diff` shows three benign lines changed.

**Risk:** none.

**Rollback:** `git revert <sha>`.

### (Optional, P1 architecture) Commit S4 — `feat(db): contracts.project_code column + Migration 049`

Per §7.3 Option B. Migration 049 is additive (`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS project_code TEXT`) + UPDATE backfill of three known rows + a future Migration 050 to set NOT NULL once all rows have values. Code change in `lib/claim-number.ts::resolveProjectCode` to consult the contracts row instead of the frozen map. **Defer until after the smoke test passes** — it is an architectural improvement, not a stability fix.

---

## 13. Manual smoke-test checklist (to run AFTER S1 lands)

> **Pre-conditions:** B1 + B2 cleared. Migrations 047 + 048 are applied. The deployed bundle is built from `≥ 77e2de5` (or whatever HEAD is after S1 lands).

Run as `cmh01.contractor@convera.test` (or any user with the `contractor` role on `CMH_01-C01`).

1. Sign in. Land on the dashboard. Confirm no console errors.
2. Open `/claims/new`. Confirm the contract is auto-selected.
3. Confirm the "بيانات الفترة" card shows: dropdown نوع المطالبة (default مستخلص جاري), من / إلى dates, the optional الرقم المرجعي الخارجي field with no red asterisk.
4. Confirm the auto-number banner is visible and includes example `CMH01R260504-001`.
5. Confirm the BOQ table headers read: `# / البند / سعر الوحدة / الكمية التعاقدية / الكمية السابقة / الكمية الحالية / نسبة الإنجاز / قيمة المستخلص الحالي / القيمة التراكمية`.
6. Confirm the الكمية السابقة column is non-interactive on every row, displays the padlock badge, and shows `0` (or the cumulative value if prior approved claims exist).
7. Enter a curr-progress on at least one row, fill from/to dates, leave external reference empty.
8. Click حفظ كمسودة. Expect: success toast `تم حفظ مسودة المطالبة CMH01R…-001 بنجاح`.
9. Open the claim from `/claims`. Confirm header shows the auto-issued number and the detail page shows نوع المطالبة + فترة التنفيذ.
10. Without submitting, return to `/claims/new`. Try to create a second draft on the same contract. Expect: an Arabic error toast that says *لا يمكن إنشاء مطالبة جديدة لوجود مطالبة مفتوحة على نفس العقد* — not the generic "حدث خطأ غير متوقع". *(This is the canary for S1 having shipped.)*
11. From the open draft, click تقديم المطالبة without an invoice attached. Expect: Arabic error toast about the missing invoice, sourced from `/api/claims/submit`.
12. Attach an invoice PDF and click تقديم المطالبة again. Expect: success toast and redirect to `/claims`.
13. As a different role (the supervisor on this contract), open the claim and exercise the workflow. *(Out of scope for this audit — verify only that the create/submit transition succeeded.)*
14. Spot-check `claims.claim_number` is populated and unique:
    ```sql
    SELECT id, claim_no, claim_number, claim_kind, status
      FROM claims WHERE contract_id = :cmh01_id ORDER BY claim_sequence DESC LIMIT 5;
    ```
    Confirm one row per claim, `claim_number` follows the format, no duplicates.

If steps 10 and 11 still produce the generic toast, S1 did not ship — investigate the deployment.

---

## 14. Go / No-Go recommendation

| Question | Verdict |
|---|---|
| Is the data path (UI → service → API → RPC → DB) structurally correct after the gap-review? | **YES.** No mismatch found between any layer for the new-claim flow. |
| Is the error path correct? | **NO.** Single page-level if-block discards the API's localized Arabic message. Trivial fix. |
| Are the migrations safe and idempotent? | **YES.** Both 047 and 048 are additive, BEGIN/COMMIT-wrapped, with explicit guards. |
| Are the migrations confirmed applied to the running DB? | **UNKNOWN** from this audit. Operator must verify. |
| Is the project-code resolver sustainable? | **NOT FOR > 3 contracts.** Recommend Option B from §7.3. |
| Is the auth seed pipeline safe? | **YES.** SQL seed is auth-read-only; Admin API script is idempotent and never logs the password. |
| Is the platform safe to push? | **NO** until S1 ships. **YES** after S1 lands and a green smoke test. |

**RECOMMENDATION: NO-GO until the three blockers in §10 clear.**

The path forward, in order:

1. Verify B1 (migration application).
2. Verify B2 (deployment build).
3. Approve and ship Commit **S1** (3-line UI fix to surface API Arabic errors).
4. Run the §13 smoke test.
5. Approve and ship Commit **S3** (env example cleanup) at the team's convenience.
6. Schedule Commit **S2** (full structured-error contract) for the next release window.
7. Schedule Commit **S4** (project_code column) before onboarding the fourth contract.

After the smoke test passes, the platform is ready to resume business testing.

---

## Audit completion checks

```
$ npm run verify:repo-path
  ✓ verify:repo-path passed (0 errors / 0 warnings)

$ npx --package typescript tsc --noEmit -p tsconfig.json
  (no source-file errors; only stale .next/types diagnostics filtered)

$ npm run build
  Exceeds the 45-second sandbox limit. Run locally before push.
```

**No commits, no pushes, no SQL executed during this audit.**
