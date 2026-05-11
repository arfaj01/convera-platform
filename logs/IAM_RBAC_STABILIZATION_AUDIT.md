# CONVERA — IAM / RBAC Stabilization Audit

> **Date:** 2026-05-05
> **Repository (official):** the official `convera-platform` workspace
> **Branch:** `main`
> **HEAD:** `0f6ca80 fix(claims): respect selected contract role in approval actions` *(in sync with `origin/main`, ahead 0 / behind 0)*
> **Scope:** Read-only IAM/RBAC audit across 10 phases. **No code changes, no SQL execution, no commits, no pushes.**
> **Constraints honoured:** the forbidden legacy path on `Desktop` was not touched; the protected files (`lib/workflow-engine.ts`, `lib/action-engine.ts`, `lib/notification-engine.ts`, `lib/sla-engine.ts`, `lib/sla-escalation.ts`) were read for cross-reference only and are not proposed for modification.

---

## 1. Executive summary

The platform's identity surface is split across three layers. **The model is correct; the implementations between layers have drifted.**

1. **Supabase Auth (GoTrue)** is correctly used for authentication only. SQL seeds never write to `auth.users` / `auth.identities`. Test-user provisioning runs through the Admin API helper `scripts/create-test-auth-users.js`, which is idempotent, never logs the password, and exits with deterministic codes. **Auth-side health is OK** — diagnostic SQL is provided in §2 to audit the live test database without any destructive operation.

2. **Operational roles** live in three public-schema surfaces:
   - `profiles.role` (a coarse global role: `director / reviewer / auditor / supervisor / contractor`, with legacy DB enum aliases `admin → auditor`, `consultant → supervisor`).
   - `user_contract_roles` (the source of truth for contract-scoped authorization, post Migration 025 / 045: `contractor / supervisor / auditor / reviewer / viewer / project_manager / quality / final_approver`).
   - `contract_approvers` (the final-approver designation per contract; orthogonal to `user_contract_roles`).

   Migration 045 widened `user_contract_roles`'s unique key from `(user_id, contract_id)` to `(user_id, contract_id, contract_role)`, so a single user can hold multiple roles on the same contract. **The schema supports multi-role; the application code does not consistently honour it.**

3. **The instability the team is observing is concentrated in three places, not in the data model:**

   - **`POST /api/admin/users` still uses a 2-tuple `onConflict: 'user_id,contract_id'`** for new-user contract-role creation (line 251). This collides with Migration 045's 3-tuple unique key, raises Postgres `42P10`, and is then **silently swallowed** by a `console.error`-only `.then()` handler. Roles attached to a brand-new multi-role user are simply dropped. This is the most likely cause of "we created a user with multiple roles and the roles vanished".

   - **`app/(app)/users/page.tsx::handleFormConfirm` has no `try/catch`.** When an admin save fails (whether at Supabase Auth, profiles upsert, role sync, or API-level validation), the rejection propagates unhandled. The modal's `setSaving(false)` runs (in `finally`) — so the spinner stops — but the modal does NOT close, no toast is shown, and the user list does NOT refresh. This is the "modal hangs" symptom.

   - **The workflow queue page (`app/(app)/workflow/page.tsx`) has its own `execute()` that calls `services/workflow.ts::performClaimAction(...)`**, a separate code path from the claim detail page. The multi-role fix shipped in `0f6ca80` only flows through the claim detail page → `WorkflowActions` → `/api/claims/transition`. The workflow queue page does NOT pass `actor_role`, so multi-role users acting from `/workflow` still hit the legacy single-role fallback in `resolveContractRole()`.

The audit also surfaces three secondary findings — error-shape inconsistency, wide-blast-radius role replace, and `hasContractChanges` ignoring `contract_roles` in PATCH — documented in detail in §§4–7.

**Recommendation:** **Fix forward in seven small commits** (described in §10). **No DB migration is required for any of them.** The schema is fine — the fixes are application-layer.

---

## 2. Current auth health findings

### 2.1 Provisioning pipeline

| Question | Answer |
|---|---|
| Does any SQL seed write to `auth.users` or `auth.identities`? | **NO.** `grep -E "INSERT INTO auth\.|UPDATE auth\.|DELETE FROM auth\."` against `SQL/seeds/005_seed_test_users_cmh.sql` returns zero matches. The file's header (lines 22-31) explicitly forbids it. |
| Are auth users provisioned via Supabase Admin API only? | **YES.** `scripts/create-test-auth-users.js` calls `admin.auth.admin.createUser` / `updateUserById` only. Nowhere does any in-tree script bypass this with raw SQL on the auth schema. |
| Is the script idempotent? | **YES.** `findExistingUser()` lookups by email; create-on-miss / metadata-update on existence. `--reset-passwords` is opt-in. |
| Does the script print the password? | **NO.** Verified — no `console.log(... TEST_USER_PASSWORD ...)` in scripts/* or anywhere else. |
| Exit codes | `0` = all 8 healthy, `1` = ≥1 provision failure, `2` = env misconfigured. |
| Is `.env.local` available in the sandbox? | **NO** — the FUSE mount does not surface it. Required keys (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TEST_USER_PASSWORD`) cannot be verified from this audit. The previous Stabilization Audit also flagged that `NEXT_PUBLIC_SUPABASE_ANON_KEY` is referenced by the browser client (`lib/supabase.ts`) but not declared in `.env.local.example`. P1 doc gap. |

### 2.2 Diagnostic SQL (read-only, run as service_role / postgres)

```sql
-- D1: Auth users that should exist (8 test users) — confirm presence,
-- email-confirmed, banned/active, last sign-in. NEVER prints password.
SELECT u.email,
       u.id                     AS auth_user_id,
       u.email_confirmed_at IS NOT NULL  AS email_confirmed,
       u.banned_until,
       u.last_sign_in_at,
       (SELECT count(*) FROM auth.identities i
         WHERE i.user_id = u.id AND i.provider = 'email')  AS email_identities
  FROM auth.users u
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
-- Expected: 8 rows, email_confirmed=true, banned_until is NULL, email_identities=1.
```

```sql
-- D2: Auth identity drift — find any (user_id, provider='email') with
-- duplicate or missing rows. Must be exactly one per active user.
SELECT i.user_id,
       u.email,
       count(*)            AS identity_rows,
       array_agg(i.id)     AS identity_ids
  FROM auth.identities i
  JOIN auth.users u ON u.id = i.user_id
 WHERE i.provider = 'email'
 GROUP BY i.user_id, u.email
 HAVING count(*) <> 1
 ORDER BY count(*) DESC;
-- Expected: zero rows. Any row indicates an integrity issue that
-- scripts/create-test-auth-users.js should be re-run to fix.
```

```sql
-- D3: Profile drift — auth users without a profiles row, or profiles
-- rows without a matching auth user.
SELECT 'auth_user_no_profile'  AS issue, u.email, u.id AS subject_id
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
 WHERE p.id IS NULL
UNION ALL
SELECT 'profile_no_auth_user'  AS issue, p.email, p.id AS subject_id
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
 WHERE u.id IS NULL
 ORDER BY issue;
-- Expected: zero rows. Any profile_no_auth_user is the textbook
-- "Database error querying schema" signature — fix by removing the
-- orphan profile or recreating the auth user via the Admin API.
```

```sql
-- D4: Role health per test user — show profile role + every active
-- contract role + final_approver designation.
SELECT p.email,
       p.role                                       AS profile_role,
       p.is_active                                  AS profile_active,
       array_agg(DISTINCT ucr.contract_role)
         FILTER (WHERE ucr.is_active)               AS contract_roles_active,
       array_agg(DISTINCT c.contract_no)
         FILTER (WHERE ucr.is_active)               AS contract_nos_active,
       (SELECT count(*) FROM contract_approvers a
         WHERE a.user_id = p.id
           AND a.approval_scope = 'final_approver'
           AND a.is_active)                         AS final_approver_count
  FROM profiles p
  LEFT JOIN user_contract_roles ucr
    ON ucr.user_id = p.id
  LEFT JOIN contracts c
    ON c.id = ucr.contract_id
 WHERE lower(p.email) IN ( ...same 8 emails... )
 GROUP BY p.id, p.email, p.role, p.is_active
 ORDER BY p.email;
```

```sql
-- D5: Multi-role cross-check — flag (user, contract) pairs that hold
-- more than one role row (this is now LEGAL after Migration 045 but
-- still useful as a snapshot).
SELECT ucr.user_id, p.email,
       ucr.contract_id, c.contract_no,
       array_agg(ucr.contract_role ORDER BY ucr.contract_role) AS roles,
       count(*)                                                 AS role_count
  FROM user_contract_roles ucr
  JOIN profiles  p ON p.id = ucr.user_id
  JOIN contracts c ON c.id = ucr.contract_id
 WHERE ucr.is_active
 GROUP BY ucr.user_id, p.email, ucr.contract_id, c.contract_no
HAVING count(*) > 1
 ORDER BY p.email, c.contract_no;
```

```sql
-- D6: Confirm the unique constraint matches Migration 045's expectation.
-- If this returns the OLD 2-tuple key, every multi-role insert/upsert
-- will return Postgres 42P10 from the API (see §4 finding F4-1).
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.user_contract_roles'::regclass
   AND contype  = 'u';
-- Expected: one constraint definition that references all THREE
-- columns: (user_id, contract_id, contract_role).
```

None of these queries mutate state. Run them through Supabase SQL Editor (service_role); export results to share with the audit team.

---

## 3. RBAC model findings

### 3.1 Current model (as derived from code)

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1 — Authentication (Supabase Auth, GoTrue)                 │
│   auth.users    — 1 row per real user                            │
│   auth.identities (provider='email') — 1 row per (user, email)   │
│ Authoritative for: SIGN-IN ONLY                                  │
└──────────────────────────────────────────────────────────────────┘
                          │ user.id (UUID)
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2 — Coarse global identity (profiles)                      │
│   profiles.id      = auth.users.id  (1:1)                        │
│   profiles.role    UserRole enum                                 │
│                    'director' | 'reviewer' | 'auditor'           │
│                    | 'supervisor' | 'contractor'                 │
│                    + legacy DB aliases 'admin' (=auditor)        │
│                    , 'consultant' (=supervisor)                  │
│   profiles.is_active                                             │
│ Authoritative for: GLOBAL access (director bypass)               │
│                    + LEGACY single-role fallback                 │
└──────────────────────────────────────────────────────────────────┘
                          │ user_id
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3 — Contract-scoped authorization                          │
│                                                                  │
│   user_contract_roles  (Migration 025 + relaxed by 045)          │
│     UNIQUE (user_id, contract_id, contract_role)                 │
│     contract_role ContractRole enum                              │
│       'contractor' | 'supervisor' | 'auditor' | 'reviewer'       │
│       | 'viewer' | 'project_manager' | 'quality'                 │
│       | 'final_approver'                                         │
│     is_active, assigned_by, notes                                │
│                                                                  │
│   contract_approvers   (Migration 040)                           │
│     approval_scope IN ('final_approver', …)                      │
│     used ONLY by `pending_director_approval` stage               │
│                                                                  │
│ Authoritative for: WORKFLOW transitions, dashboard scoping,      │
│                    notification routing                          │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Mismatches identified

| Symbol | Profile role meaning | Contract role meaning | Workflow role meaning | Risk |
|---|---|---|---|---|
| `reviewer` | "Pre-final reviewer" — gates `under_admin_review` in 4-stage | "الوحدة الفنية" (Technical Unit) — gates `under_reviewer_check` AND `under_technical_review` post-Phase-2.6 | Same enum value, different stages | Low — the workflow engine routes by stage, not by enum identity |
| `supervisor` | DB stores as `'consultant'`; UI shows `'supervisor'`; the API has bidirectional `roleToDb()` / `roleFromDb()` mappers | `'supervisor'` directly | `'supervisor'` | Medium — every read path must go through the mapper. Anywhere a bare `profile.role === 'supervisor'` check exists is wrong (would return false for users whose DB row is `'consultant'`). |
| `auditor` | DB stores as `'admin'`; UI shows `'auditor'` | `'auditor'` directly | `'auditor'` | Medium — same risk class as `supervisor`. |
| `quality` | **Does not exist** as a profile role | `'quality'` — gates `under_quality_review` | `'quality'` | Low — confined to contract layer. |
| `project_manager` | **Does not exist** as a profile role | `'project_manager'` — gates `under_project_manager_review` | `'project_manager'` | Low — confined to contract layer. |
| `final_approver` | Profile role exists | Contract role exists in `user_contract_roles` AND as `approval_scope` in `contract_approvers` | Workflow role exists | **HIGH** — three places to fall out of sync. The `pending_director_approval` branch in `app/api/claims/transition/route.ts:410-456` carries explicit logic to reconcile them. |

### 3.3 Canonical model (proposed wording for documentation)

| Symbol | Meaning | Source | Used by |
|---|---|---|---|
| `GlobalRole` | Coarse, user-wide identity. Can grant a director-level bypass. | `profiles.role` | `lib/contract-scope.ts::isGlobalRole()`, the `pending_director_approval` branch of the transition route. |
| `ContractRole` | Per-(user, contract) authorization grant. Source of truth for workflow transitions. | `user_contract_roles.contract_role` (1..N rows per (user, contract)) | Action engine, claim detail page chip strip, transition route after the 0f6ca80 fix. |
| `ApprovalScope` | Per-(user, contract) designation for the final-approval stage only. | `contract_approvers.approval_scope` | The `pending_director_approval` branch only. |
| `ActiveRole` | The `ContractRole` the user has selected on the claim detail page for the current action. Forwarded as `actor_role` in the transition request. **Server-validated**, never trusted. | React state in `app/(app)/claims/[id]/page.tsx` (post-0f6ca80) | Sent to `/api/claims/transition`; validated against `user_contract_roles` before use. |

The `ActiveRole` concept exists today only on the claim detail page. It must be promoted to a shared utility so the workflow queue page can use the same vocabulary (P5 finding).

---

## 4. User management save issue (the modal hang)

### 4.1 Symptom

User opens "إدارة المستخدمين" (`/users`), clicks ✏️ on a row, edits roles in the modal, clicks "حفظ التغييرات". The button briefly shows "جاري الحفظ..." then returns to "حفظ التغييرات". **Modal stays open. No toast. No refresh. No console error visible to the operator.**

### 4.2 Root cause

`app/(app)/users/page.tsx:119-144` defines `handleFormConfirm` without a `try/catch`:

```ts
async function handleFormConfirm(data: CreateUserInput | UpdateUserInput) {
  const linkedContractIds: string[] = (data as any).linked_contract_ids || [];

  if (modal.type === 'create') {
    // …
    await adminCreateUser({ … });
    showToast('تم إنشاء المستخدم بنجاح …', 'ok');
  } else if (modal.type === 'edit') {
    // …
    await adminUpdateUser(modal.user.id, { … });
    showToast('تم تحديث بيانات المستخدم بنجاح', 'ok');
  }
  setModal({ type: 'closed' });
  await loadUsers();
}
```

`UserFormModal::handleSubmit` at `components/users/UserFormModal.tsx:158-205` only has `try/finally`:

```ts
const handleSubmit = async () => {
  if (!validate()) return;
  setSaving(true);
  try {
    // … build payload …
    if (isCreate) {
      await onConfirm({ … } as CreateUserInput);
    } else {
      await onConfirm({ … } as UpdateUserInput);
    }
  } finally {
    setSaving(false);
  }
};
```

When `adminCreateUser` / `adminUpdateUser` rejects:

1. The `await` in `handleFormConfirm` throws.
2. **Nothing in `handleFormConfirm` catches it** — the success toast, `setModal({ closed })`, and `loadUsers()` never fire.
3. The rejection propagates back into `handleSubmit`'s `await onConfirm(…)`.
4. `handleSubmit`'s `finally` runs `setSaving(false)`. Spinner stops.
5. **`handleSubmit` has no `catch` either** — the rejection propagates out.
6. The outermost caller is the `<Button onClick={handleSubmit}>` JSX, which doesn't await its handler. React swallows the unhandled promise rejection — **no UI feedback, no toast, no console.error visible to the operator**.

### 4.3 Why "hang" feels right

- Spinner is visible during the await, then disappears.
- Modal stays mounted because `setModal({ type: 'closed' })` only runs on success.
- The user reasonably interprets the unchanging modal as "still working" or "stuck", clicks again, repeats.

### 4.4 Likely failure modes that this swallow exposes

| Failure | Origin | What the user sees today | What the user should see |
|---|---|---|---|
| `42P10` from `POST /api/admin/users` (multi-role onConflict bug — see §5) | Migration 045 vs API mismatch | nothing | **"تعذّر تعيين أدوار المستخدم على العقود — سجل تقني: ON CONFLICT mismatch"** |
| `Auth: Email already registered` | Supabase Admin API | nothing | **"البريد الإلكتروني مستخدَم مسبقاً"** |
| `Profile creation failed` | profiles upsert error | nothing | **"فشل إنشاء الملف الشخصي: <db msg>"** |
| `Network` / fetch failure | Browser offline / CORS | nothing | **"فشل الاتصال بالخادم — تحقق من الإنترنت"** |
| `Validation: missing field` | API 400 | nothing | **"حقول مطلوبة: …"** |

All five exist as Arabic strings somewhere in the API responses but never reach the user.

### 4.5 Fix (P3 — IAM-2)

Add `try/catch` around the entire `handleFormConfirm` body. Show a toast with the API's structured error message (preferring `result.error || result.messageAr || result.message || 'فشل الحفظ'`). Leave the modal open so the user can correct and retry. Only close on success. **This change is fully contained in `app/(app)/users/page.tsx` — does not touch the modal component or the API.**

---

## 5. Multi-role user handling

### 5.1 Schema (correct since Migration 045)

```sql
-- Migration 045 relaxed the unique key:
ALTER TABLE user_contract_roles
  DROP CONSTRAINT IF EXISTS user_contract_roles_user_id_contract_id_key;
CREATE UNIQUE INDEX user_contract_roles_user_contract_role_key
  ON user_contract_roles (user_id, contract_id, contract_role);
```

A user may now hold multiple roles on the same contract.

### 5.2 Application alignment status

| Surface | Multi-role aware? | Evidence |
|---|---|---|
| `components/users/UserFormModal.tsx` | YES | Per-contract role-set as `Map<contract_id, ContractRole[]>` (line 110-136). Per-role checkboxes (lines 446-479). |
| `PATCH /api/admin/users/[id]` | YES | `onConflict: 'user_id,contract_id,contract_role'` (line 178) — matches Migration 045 ✓ |
| **`POST /api/admin/users`** | **NO — BUG** | line 251 still uses `onConflict: 'user_id,contract_id'`. The unique index this targeted no longer exists. Postgres returns 42P10 ("no unique or exclusion constraint matching the ON CONFLICT specification"). The error is **silently swallowed** by the `.then(({error}) => { if (error && error.code !== '42P01' && error.code !== '23505') console.error(...) })`. **Roles attached at user-creation time are lost.** Patching after creation works (PATCH route is correct). |
| `app/(app)/claims/[id]/page.tsx` | YES (post-0f6ca80) | Renders multi-role chip strip; tracks `activeRole`; forwards `actor_role`. |
| `components/claims/WorkflowActions.tsx` | YES (post-0f6ca80) | Accepts `activeRole` prop; includes it in transition body. |
| `app/api/claims/transition/route.ts` | YES (post-0f6ca80) | Validates `actor_role` against `user_contract_roles` before honouring it. |
| **`app/(app)/workflow/page.tsx`** | **NO — GAP** | Has its own `execute()` (line ~170) that calls `services/workflow.ts::performClaimAction(claimId, action, actorId, ...)`. Does NOT pass `actor_role`. Multi-role users acting from the workflow queue still hit the legacy `resolveContractRole()` fallback. |
| **`services/workflow.ts::performClaimAction`** | **NO — GAP** | Line 166-171 builds the body with `claimId, action, actorId, notes` only. Forwards `pickedTarget` for return; does NOT forward an `actor_role`. |
| `app/(app)/action-center/page.tsx` | INHERITED | Action buttons just navigate to the claim's `quickActionUrl`; no direct transition. The claim detail page handles execution → 0f6ca80 fix applies. |
| `lib/contract-permissions.ts::resolveContractRole` | NO | `.maybeSingle()` cannot return more than one role. For multi-role users it errors or arbitrarily picks one. Currently the API works around this via the `actor_role` override added in 0f6ca80 — but only when the override is sent. |

### 5.3 Concrete impact of the two GAPs

- **POST /users gap (F5-POST):** A director creates a user with two contract roles in the modal. The auth user is created, the profile is created, the `linked_contract_ids` are inserted. The contract_roles upsert fails with 42P10. The director sees no error (modal-hang bug). The new user logs in but has zero contract roles. Director suspects the modal is broken; in reality the API silently dropped the most important data.

- **Workflow queue gap (F5-WF):** A reviewer + quality user opens `/workflow`, sees a claim in `under_quality_review`, clicks "موافقة". The request goes to `/api/claims/transition` without `actor_role`. The route falls back to `resolveContractRole()`, which `.maybeSingle()`s — for a multi-role user this either errors and returns `null` (legacy fallback uses `LEGACY_ROLE_MAP[profile.role]`) or returns one row. The chosen role is unlikely to be `quality`. The transition is rejected with the literal `الأدوار المسموحة: quality` toast. The fix applied to the claim detail page does not flow through this path.

### 5.4 Fix targets (P5 — IAM-4)

1. Refactor `services/workflow.ts::performClaimAction` to accept an optional `actorRole?: ContractRole` parameter and forward it as `actor_role`.
2. Update `app/(app)/workflow/page.tsx::execute()` to compute the active role using the same `STAGE_DEFAULT_ROLE` map introduced in `0f6ca80` and forward it.
3. (Optional, future) Promote `STAGE_DEFAULT_ROLE` and `pickActiveRole()` into a shared helper module so any future entry point can reuse them.

---

## 6. Workflow transition role resolution

### 6.1 Where role resolution happens today

The transition route uses a **two-tier** dispatch (post-0f6ca80):

```
1. Try the multi-role override
   IF body.actor_role is supplied AND user is NOT a global role:
     SELECT count(*) FROM user_contract_roles
       WHERE user_id = caller AND contract_id = claim.contract_id
         AND contract_role = body.actor_role AND is_active = true;
     IF count = 0 → 403 "الدور المُحدَّد غير مُفعَّل …"
     ELSE → contractRole := body.actor_role; roleSource := 'new_table'

2. Else fall back to resolveContractRole()
   - .maybeSingle() against user_contract_roles
   - or LEGACY_ROLE_MAP[profile.role]

3. Stage dispatch
   - pending_director_approval ⇒ check contract_approvers separately
   - else if contractRole && roleSource !== 'global_role':
       isTransitionAllowed(currentStatus, action, workflowRole)
   - else: legacy global-role check
```

### 6.2 Where the resolver still leaks single-role assumptions

| Surface | Leaks? | Notes |
|---|---|---|
| Tier 1 (override) | NO | Validates per-row exact match. Multi-role-safe. |
| Tier 2 (`resolveContractRole`) | YES | `.maybeSingle()` cannot represent multi-role. Currently irrelevant when Tier 1 always supplies the role; becomes the only path when callers do NOT send `actor_role` (the workflow page is one such caller). |
| `LEGACY_ROLE_MAP` | YES | `consultant → supervisor`, `admin → auditor`. Hardcoded. Acceptable for legacy single-role users; broken for multi-role users that the legacy table didn't anticipate. |
| Notification routing (`getNotificationRecipients`) | NO | Queries `user_contract_roles` filtered by the destination stage's role — does not depend on the actor. ✓ |
| Final-approver branch (lines 410-456) | NO | Three explicit branches: `director / final_approver / other`. Each consults `contract_approvers`. ✓ |

### 6.3 Fix (P6 — IAM-5)

Two changes, both contained in the API and library layers:

1. **Refactor `lib/contract-permissions.ts::resolveContractRole` to return `ContractRole[]`** instead of `ContractRole | null`. The function should query `user_contract_roles` without `.maybeSingle()` and return all active rows. Callers that still expect a single value can read `roles[0] ?? null` (preserves backward compatibility).

2. **Tighten the override branch in the transition route**: when `actor_role` is supplied AND validated, set `contractRole = body.actor_role`. When it is NOT supplied AND the user has more than one active role on the contract, return 422 with a clear Arabic message: *"يحمل المستخدم أكثر من دور على هذا العقد — يجب اختيار دور التنفيذ قبل المتابعة"*. This forces the UI to send `actor_role` for multi-role users — preventing future code paths from falling into the broken fallback by accident.

---

## 7. API authorization findings

### 7.1 Inconsistent error shapes across the API surface

| Endpoint | Shape | Notes |
|---|---|---|
| `/api/claims/create` | `{ error, error_code }` | Maps RPC `RAISE EXCEPTION` to localised Arabic. Consumers must read `error_code` for machine-readable handling. |
| `/api/claims/submit` | `{ error, error_code }` | Same as above. |
| `/api/claims/transition` | `{ error }` | No `error_code` discriminator. UI shows the message verbatim. |
| `/api/admin/users` (POST) | `{ error }` | Bare error string. |
| `/api/admin/users/[id]` (PATCH) | `{ error }` or `{ success: true, message: ... }` | Inconsistent — sometimes returns `success/message`, sometimes nothing on partial failure (errors swallowed). |
| `/api/admin/users/[id]/contract-roles` (GET) | `{ error }` or `{ contract_roles: [] }` | OK shape but no machine code. |

### 7.2 Recommended structured contract

```ts
interface ApiErrorBody {
  /**
   * Machine-readable. Stable across releases.
   * Examples: 'OPEN_CLAIM_EXISTS', 'ITEM_NO_INVALID',
   *           'AUTH_REQUIRED', 'NOT_DIRECTOR',
   *           'ROLE_NOT_ACTIVE_ON_CONTRACT'.
   */
  code: string;

  /**
   * User-grade Arabic copy. Fully localised, never echoes a raw DB error.
   */
  messageAr: string;

  /**
   * Optional, never includes secrets. Useful keys:
   *   contract_id, claim_id, user_id, requested_role, actual_roles[].
   */
  details?: Record<string, unknown>;
}
```

### 7.3 Migration plan

Add `code` and `messageAr` keys to every API response body that today returns `error` or `error_code`. Keep the legacy keys as aliases for one release window. Update `lib/errors.ts::friendlyError()` to consult `code` first, then `messageAr`, and only fall through to pattern matching when neither is present (today the pattern matcher catches every Arabic message — but only because some literals are coincidentally regex-matchable).

### 7.4 Specific patches needed for IAM scope

- `/api/admin/users` (POST): adopt the structured shape. Fail loudly when role assignment fails (do not return 201 if any partial step errored).
- `/api/admin/users/[id]` (PATCH): same. Today errors in `syncContractRoles` / `syncLinkedContracts` are caught and logged; return the failure to the caller via the structured shape.

---

## 8. User-modal save flow — exact root cause + fix shape (consolidated)

| Item | Detail |
|---|---|
| Root cause | `handleFormConfirm` in `app/(app)/users/page.tsx:119-144` has no `try/catch`; rejections propagate unhandled. `UserFormModal::handleSubmit` only has `try/finally` and likewise propagates. Result: spinner stops, modal stays open, no toast. |
| Files to change | `app/(app)/users/page.tsx` only. |
| Outline | Wrap the body of `handleFormConfirm` in try/catch. On error: show toast with the API's structured Arabic message (preferring `result.error || result.messageAr || result.message`). Do NOT close the modal so the user can correct. On success: existing flow (toast → close → reload). |
| Risk | Trivial; UI-only; reverts cleanly with `git revert`. |
| Test case | (a) try to create a user with a duplicate email — toast shows the API message, modal stays open. (b) create a fresh user — toast shows success, modal closes, list refreshes. |

---

## 9. Required migrations, if any

**None.** Every IAM/RBAC issue in this audit is application-layer. The schema (post Migration 045) already supports multi-role correctly. Specifically:

- `user_contract_roles` unique key is the 3-tuple. ✓
- `contract_approvers` is correctly modelled. ✓
- `profiles` is correctly modelled. ✓
- `claim_kind`, `claim_number`, `work_period_*`, `external_reference`, `claim_sequence` columns exist (Migration 047) and the atomic RPC `create_claim_with_items_atomic` is available (Migration 048 + 049 + 050). Touched only by §11's smoke test, not part of IAM.

---

## 10. Proposed implementation plan

Seven small, focused commits. **None implemented in this audit.** Every commit can be approved or rejected independently.

> **Each commit must keep `npm run verify:repo-path` and `npx tsc --noEmit -p tsconfig.json` clean. `npm run build` must be run on a developer machine before push (sandbox times out at 45 s).**

### Commit IAM-1 — `chore(auth): add SQL diagnostic script for user/auth/role health`

| Field | Detail |
|---|---|
| Files | New: `SQL/diagnostics/iam_user_health.sql` (read-only — six SELECTs from §2.2). New: `logs/IAM_DIAGNOSTIC_PLAYBOOK.md` (operator runbook). |
| Intent | Give operators a one-shot SQL checkout of auth + profile + role health for the 8 test users and any future user list. **Read-only**, never writes anywhere. |
| Risk | Zero. Pure SELECTs. |
| Validation | `npm run verify:repo-path`, `tsc --noEmit`. The SQL file is not compiled by tsc but is included in the repo so it travels with the schema. |
| Rollback | `git revert <sha>` — pure docs. |

### Commit IAM-2 — `fix(users-modal): show API errors and only close modal on success`

| Field | Detail |
|---|---|
| Files | `app/(app)/users/page.tsx` only. |
| Intent | Wrap `handleFormConfirm` in `try/catch`; on error show toast with the API's structured Arabic message (`result.error || result.messageAr || result.message || 'فشل الحفظ'`); leave the modal open. On success, existing close + reload flow runs unchanged. |
| Risk | Low — UI-only. The modal will now correctly stay open on failure (was effectively the same behaviour, but now with a visible error). |
| Validation | `tsc --noEmit`; manual: try saving a user with a duplicate email — confirm Arabic toast with the API message; try saving a valid edit — confirm success toast + close + refresh. |
| Rollback | `git revert <sha>`. |

### Commit IAM-3 — `fix(api/admin/users): align onConflict with Migration 045 + return failures to caller`

| Field | Detail |
|---|---|
| Files | `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`. |
| Intent | (a) POST: change `onConflict: 'user_id,contract_id'` → `'user_id,contract_id,contract_role'` to match Migration 045. (b) Both routes: surface role-sync failures in the response (no more silent swallow). (c) PATCH: include `contract_roles` in the `hasContractChanges` check. (d) Validate `contract_role` enum values against the canonical `ContractRole` whitelist before forwarding to upsert. |
| Risk | Medium — the no-longer-swallowed errors will surface as visible failures for the first time. Some callers may have been relying on the silent behaviour to "succeed despite role drift" — those callers are bugs that this commit makes visible. |
| Validation | `tsc --noEmit`; manual: create a new multi-role user — confirm `user_contract_roles` rows are inserted (D5 query); pass an invalid contract_role — confirm 400 + Arabic message. |
| Rollback | `git revert <sha>`. |

### Commit IAM-4 — `feat(workflow-page): wire activeRole through performClaimAction`

| Field | Detail |
|---|---|
| Files | `services/workflow.ts`, `app/(app)/workflow/page.tsx`, **possibly** a new shared helper at `lib/active-role.ts` (extracts `STAGE_DEFAULT_ROLE` + `pickActiveRole(roles, status)` from the claim detail page). |
| Intent | Make the workflow queue page send `actor_role` so multi-role users acting from `/workflow` get the same authorisation path as the claim detail page. |
| Risk | Low — `services/workflow.ts::performClaimAction` only gains a new optional parameter; existing single-role callers ignore it. |
| Validation | `tsc --noEmit`; manual: as a reviewer + quality user open `/workflow`, click موافقة on a claim in `under_quality_review`. Today this rejects with `الأدوار المسموحة: quality`. After the fix it must succeed. |
| Rollback | `git revert <sha>`. |

### Commit IAM-5 — `harden(transition): require actor_role for multi-role users + return ContractRole[] from resolver`

| Field | Detail |
|---|---|
| Files | `lib/contract-permissions.ts` (refactor signature), `app/api/claims/transition/route.ts` (consume the new shape), all call-sites of `resolveContractRole` (read-only — most read `roles[0] ?? null`). |
| Intent | (a) Refactor `resolveContractRole(...)` to return `{ roles: ContractRole[]; source }` instead of `{ role; source }` — eliminating the `.maybeSingle()` foot-gun. (b) In the transition route, when the user has > 1 role on the contract AND `actor_role` was not supplied, return 422 with *"يحمل المستخدم أكثر من دور على هذا العقد — يجب اختيار دور التنفيذ قبل المتابعة"*. This is a defensive backstop — once IAM-4 lands, the workflow page also sends `actor_role` and this 422 is unreachable in normal flows. |
| Risk | **Higher** — touches `lib/contract-permissions.ts` which is consumed by ~10 other files. Each call-site needs a one-line change to read `roles[0] ?? null` for backward compatibility. **The protected files (`lib/workflow-engine.ts`, `lib/action-engine.ts`) do not import `resolveContractRole`** — verified via grep. **Approval requested before implementing.** |
| Validation | `tsc --noEmit`, full smoke matrix from §11. |
| Rollback | `git revert <sha>`. |

### Commit IAM-6 — `feat(api): adopt {code, messageAr, details?} structured-error contract`

| Field | Detail |
|---|---|
| Files | All `/api/admin/*` routes; `lib/errors.ts`; `services/admin-users.ts` (consume the new shape). Optional in scope: `/api/claims/create`, `/api/claims/transition` already emit `error_code` — extend with `code` + `messageAr` keys, keep legacy `error` for one release window. |
| Intent | Single contract for every API failure. UI displays `messageAr`; engineers grep on `code`; `details` carries non-secret context. |
| Risk | Medium — consumer changes ripple. Worth deferring to a release window if IAM-2 / IAM-3 ship first. |
| Validation | `tsc --noEmit`; smoke matrix (§11). |
| Rollback | `git revert <sha>`. |

### Commit IAM-7 — `docs: IAM/RBAC stabilization runbook + smoke matrix`

| Field | Detail |
|---|---|
| Files | `logs/IAM_RBAC_RUNBOOK.md` (new). Updates to `logs/STABILIZATION_AUDIT_REPORT.md` and `logs/CLAIM_SUBMISSION_ENHANCEMENT.md` cross-linking IAM-1…IAM-6. |
| Intent | Single source of truth for ops + onboarding. Documents the auth health checks, role assignment flow, the multi-role contract, and the §11 smoke matrix. |
| Risk | Zero — docs only. |
| Validation | `verify:repo-path`. |
| Rollback | `git revert <sha>`. |

---

## 11. Manual smoke-test matrix

> **Pre-conditions:** Migrations 047 + 048 + 049 + 050 are applied to the test DB (run VAL-1 of each). Bundle is built from `≥ 0f6ca80` plus whichever IAM commits have shipped.

### 11.1 Auth + provisioning

| ID | Step | Expected |
|---|---|---|
| A1 | Run `npm run seed:auth-users` from a host with `.env.local` populated | Exit 0; "All 8 users present and healthy" |
| A2 | Run `D1` from §2.2 | 8 rows, `email_confirmed=true`, `banned_until` NULL |
| A3 | Run `D2` from §2.2 | 0 rows |
| A4 | Run `D3` from §2.2 | 0 rows |

### 11.2 Admin user editing (IAM-2 + IAM-3 canaries)

| ID | Step | Expected (today) | Expected (post-IAM-2 + IAM-3) |
|---|---|---|---|
| U1 | Edit a user, change phone, save | Modal closes, toast success | Same |
| U2 | Edit a user, add a duplicate role on the same contract (only legal post Mig 045), save | **TODAY: modal hangs (no error toast)** | **Modal closes, toast success, role visible in D4 / D5** |
| U3 | Create a brand-new contractor with TWO contract roles | **TODAY: user is created, contracts linked, but user_contract_roles is empty (silent 42P10)** | **All N role rows appear in D5; toast success** |
| U4 | Edit a user, send an invalid contract_role (`'foobar'`) | **TODAY: silent — API returns 200 but the bad row was never inserted** | **400 with Arabic message naming the invalid role** |
| U5 | Try to save with no changes at all | "لا توجد تغييرات للحفظ" | Same |

### 11.3 Multi-role workflow execution (post-0f6ca80 + IAM-4)

| ID | Step | Expected on `/claims/[id]` (today) | Expected on `/workflow` (today) |
|---|---|---|---|
| W1 | reviewer+quality user; claim in `under_quality_review`; click موافقة (default chip = `quality`) | Succeeds → moves to `under_project_manager_review` | **TODAY: rejected with `الأدوار المسموحة: quality`** |
| W2 | Same user; switch chip to `الوحدة الفنية` (reviewer); approve | Rejected with `الأدوار المسموحة: quality` (correct — the chip is wrong for this stage) | **TODAY: rejected (route never sees the chip)** |
| W3 | reviewer+quality user; claim in `under_technical_review`; click موافقة (default chip = `reviewer`) | Succeeds → moves to next stage | **TODAY: depends on `resolveContractRole` ordering — flaky** |
| W4 | After IAM-4: same as W1 from `/workflow` | n/a | Succeeds — same as claim detail |

### 11.4 Server authorisation (post-IAM-5)

| ID | Step | Expected (today) | Expected (post-IAM-5) |
|---|---|---|---|
| S1 | curl `/api/claims/transition` with valid `actor_role` | 200 | 200 |
| S2 | curl with `actor_role` the user does NOT hold on the contract | **403 + Arabic "الدور المُحدَّد غير مُفعَّل لك على هذا العقد"** ✓ | Same |
| S3 | curl WITHOUT `actor_role` for a user with 2 contract roles | **flaky — `.maybeSingle` errors or picks one** | **422 + Arabic "يحمل المستخدم أكثر من دور على هذا العقد — يجب اختيار دور التنفيذ"** |
| S4 | curl WITHOUT `actor_role` for a user with 1 contract role | 200 (legacy fallback) | 200 (legacy fallback preserved) |

### 11.5 Error contract (post-IAM-6)

| ID | Step | Expected (today) | Expected (post-IAM-6) |
|---|---|---|---|
| E1 | Trigger any 4xx from `/api/admin/users` | `{error: "<msg>"}` | `{code, messageAr, details?}` plus legacy `error` for one release window |
| E2 | Trigger 4xx from `/api/claims/transition` | `{error: "<msg>"}` | `{code, messageAr, details?}` plus legacy `error` |
| E3 | UI: `friendlyError(...)` consults `code` first | n/a | Yes |

---

## 12. Go / No-Go recommendation

| Question | Verdict |
|---|---|
| Is the auth side healthy? | **YES**, conditional on D1/D2/D3 returning expected results against the test DB. The provisioning pipeline itself is sound. |
| Is the schema multi-role-ready? | **YES.** Migration 045 already widened the unique key. No DB migration is required for any IAM fix in this audit. |
| Is the user-management UI safe to use today? | **NO.** The modal silently swallows save errors. Any failure leaves the user-management workflow without feedback. **Block business use of `/users` until IAM-2 ships.** |
| Are multi-role users safe to act on the platform today? | **PARTIAL.** Claim detail page works (post-0f6ca80). The workflow queue page does not. **Block business use of `/workflow` for multi-role users until IAM-4 ships.** Single-role users are unaffected. |
| Is auth role assignment safe today? | **NO** for create-flows (POST silently drops contract_roles). **YES** for edit-flows (PATCH is correct, but errors are swallowed). **Block creation of multi-role users via `/users` until IAM-3 ships.** |

### Recommendation

**NO-GO for IAM-touching business workflows until IAM-2 + IAM-3 + IAM-4 ship.** The remaining IAM-5 / IAM-6 / IAM-7 are quality-of-life and observability improvements that can land in a subsequent release window.

The order of approval and implementation matters:

1. **IAM-1** (diagnostic SQL — zero risk, run today against the live DB to surface anything else this audit missed).
2. **IAM-2** (modal hang — unblocks `/users` end-to-end).
3. **IAM-3** (admin API hardening — restores create-flow integrity).
4. **IAM-4** (workflow page wiring — closes the remaining multi-role gap on `/workflow`).
5. **IAM-5** (resolver refactor — defensive backstop; touches `lib/contract-permissions.ts` widely; **request approval before starting**).
6. **IAM-6** (error contract — quality-of-life; can wait).
7. **IAM-7** (docs — last).

After IAM-2 + IAM-3 + IAM-4 the `/users`, `/claims/[id]`, and `/workflow` flows are coherent. Re-run the §11 smoke matrix; if every row is GREEN, the platform can resume business testing.

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
