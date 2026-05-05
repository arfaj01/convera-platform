# CONVERA — Platform Smoke-Test Matrix

> Companion to `logs/FINANCIAL_CLAIM_E2E_SUCCESS_BASELINE.md`. Every commit landed on or after the baseline must keep this matrix GREEN before being declared shippable.

## How to read this matrix

| Symbol | Meaning |
|---|---|
| ✅ | Confirmed working at baseline (2026-05-05). |
| 🟡 | Working under the documented constraint; no regression. |
| ⏳ | Deferred / out of scope for this sprint. |
| ❌ | Currently broken — DO NOT release until a row's verdict is at least 🟡. |

Run as `cmh01.contractor@convera.test` / `mahmoud.ragab@beeah.sa` / `aaldera-contractor@momah.gov.sa` / `Ma.Alarfaj@momah.gov.sa` etc. as the role calls for. The 8-user roster is documented in `scripts/create-test-auth-users.js`.

Pre-flight before running any block: run **D1–D6** in `SQL/diagnostics/iam_user_health.sql` and capture results.

---

## A. Auth tests

| ID | Step | Expected | Verdict @ baseline |
|---|---|---|---|
| A1 | Sign in as a healthy user with the bootstrap password | Lands on `/dashboard`; no console errors | ✅ |
| A2 | Sign in with a wrong password | Toast: "البريد الإلكتروني أو كلمة المرور غير صحيحة" | ✅ |
| A3 | Sign in as a user marked `is_active=false` | Toast: "الحساب موقوف — تواصل مع مدير النظام لإعادة التفعيل" | ✅ |
| A4 | Use the password-reset flow (if exposed) | Email link issued; new password works | 🟡 (depends on Supabase email setup) |
| A5 | Run `npm run seed:auth-users` from a host with `.env.local` populated | Exit 0; "All 8 users present and healthy" | ✅ |
| A6 | Run `D1`/`D2`/`D3` from `SQL/diagnostics/iam_user_health.sql` | D1: 8 rows email_confirmed=true; D2: 0 rows; D3: 0 rows | ✅ |

---

## B. User management tests (Director-only)

| ID | Step | Expected | Verdict @ baseline |
|---|---|---|---|
| B1 | Open `/users` as a non-director | Redirects to `/dashboard` | ✅ |
| B2 | Open `/users` as Director | Lists all users with role badges | ✅ |
| B3 | Click "Add New User", create a basic single-role contractor | Modal closes; toast success; user appears in list; D4 shows the new contract role | ✅ |
| B4 | Create a multi-role user (`reviewer + quality` on CMH_02) | Same as B3; D5 lists the new (user, contract) pair with `role_count = 2` | ✅ (post IAM-3) |
| B5 | Create a user with a duplicate email | Modal stays open; Arabic toast surfaces the API's specific message | ✅ (post IAM-2) |
| B6 | Create a user with an invalid `contract_role` (e.g. `'foobar'`) | 400 with Arabic message naming the bad role; no auth user left behind | ✅ (post IAM-3) |
| B7 | Edit a user, change ONLY their `contract_roles` | Success toast (previously returned `لا توجد تغييرات`) | ✅ (post IAM-3) |
| B8 | Edit a user where the role-sync fails (e.g. unknown contract_id) | 422 with Arabic message; modal stays open | ✅ (post IAM-2 + IAM-3) |
| B9 | Toggle a user active → inactive → active | Toast success on each step; user can't sign in while inactive (A3) | ✅ |
| B10 | Reset a user's password from the row menu | Email link issued; toast success | 🟡 (depends on Supabase email) |

---

## C. Claim creation tests

> Run as a `contractor`-role user on CMH_02.

| ID | Step | Expected | Verdict @ baseline |
|---|---|---|---|
| C1 | Open `/claims/new`. Try to save with no `claim_kind` | Form requires it (default `running_payment` selected) | ✅ |
| C2 | Try to save without work-period dates | Arabic toast: "فترة تنفيذ الأعمال (من / إلى) إلزامية" | ✅ |
| C3 | Save a draft with empty `external_reference` | 200 success toast — field is now optional | ✅ |
| C4 | Save a draft with `external_reference = 'AC-12345'` | 200 success; value persisted as `external_reference` | ✅ |
| C5 | Confirm the auto-number banner is visible above the period inputs and includes example `CMH01R260504-001` | Banner present | ✅ |
| C6 | Confirm BOQ headers read: `الكمية السابقة` / `الكمية الحالية` / `قيمة المستخلص الحالي` / `القيمة التراكمية` | Exact strings | ✅ |
| C7 | Confirm `الكمية السابقة` is locked (padlock + tooltip) on every row, even on a fresh contract (value 0) | Locked unconditionally | ✅ |
| C8 | Enter a `curr_progress` value, save draft | Toast: "تم حفظ مسودة المطالبة CMH02R…-NNN بنجاح" | ✅ |
| C9 | Try saving a second draft on the same contract while the first is open | 422 + Arabic toast: "لا يمكن إنشاء مطالبة جديدة لوجود مطالبة مفتوحة …" | ✅ (post 0f6ca80 / S1) |
| C10 | Submit a claim (with invoice attached) | Status moves to `under_supervisor_review`; toast success | ✅ |
| C11 | Submit a claim that exceeds the contractual remaining quantity | 422: "الكمية الحالية تتجاوز الكمية المتبقية …" | ✅ |
| C12 | Submit a claim with `curr_progress = -5` | 422: "الكمية الحالية لا يمكن أن تكون سالبة" | ✅ |
| C13 | (CLM-1, deferred) Enter current quantity by progress percentage instead of units | Progress percent → quantity conversion; backend still receives `curr_progress` | ⏳ P2 — design pending |

---

## D. Workflow tests

> Run as the role calls for. Multi-role users select the role via the chip strip on `/claims/[id]` or the deterministic stage-default on `/workflow`.

| ID | Stage | Actor role | Expected | Verdict @ baseline |
|---|---|---|---|---|
| D1 | `under_supervisor_review` | supervisor | Approve → `under_technical_review` | ✅ |
| D2 | `under_technical_review` | reviewer | Approve → `under_quality_review` | ✅ |
| D3 | `under_quality_review` | quality | Approve → `under_project_manager_review` | ✅ |
| D4 | `under_project_manager_review` | project_manager | Approve → `pending_director_approval` | ✅ |
| D5 | `pending_director_approval` | final_approver / director | Approve → `approved` | ✅ |
| D6 | Any stage | wrong role | 403 / 422 with the stage's allowed-roles message | ✅ |
| D7 | `under_quality_review` | reviewer+quality user from `/claims/[id]` (chip = quality) | Approve succeeds | ✅ (post 0f6ca80) |
| D8 | `under_quality_review` | reviewer+quality user from `/claims/[id]` (chip = reviewer) | 403 with allowed-roles message — proves chip is honored | ✅ |
| D9 | `under_quality_review` | reviewer+quality user from `/workflow` | Approve succeeds; network tab shows `actor_role: 'quality'` | ✅ (post IAM-4) |
| D10 | Any stage | single-role user | Acts as before; no `actor_role` impact | ✅ |
| D11 | Any non-final stage | any actor | Return with reason ≥ 20 chars → status `returned_by_*`; contractor sees the return reason | ✅ |
| D12 | `pending_director_approval` | final_approver | Reject with reason ≥ 20 chars → status `rejected` | ✅ |

---

## E. Certificate tests

| ID | Step | Expected | Verdict @ baseline |
|---|---|---|---|
| E1 | Approved claim, contractor user, claim detail page | Header carries 🖨 شهادة الإنجاز button + a card prompting view | ✅ (post CERT-1) |
| E2 | Click the button | Opens `/print/certificate/[id]` in a new tab | ✅ |
| E3 | Approved claim with no certificate file generated | Card shows: "لا توجد شهادة إنجاز مرتبطة بهذه المطالبة حتى الآن" | ✅ (post CERT-1) |
| E4 | Non-approved claim (e.g. `under_quality_review`) | Certificate card hidden / replaced with "بعد الاعتماد النهائي" notice | ✅ |
| E5 | Authorized roles open `/print/certificate/[id]` | Page renders | ✅ |
| E6 | Unauthorized user opens `/print/certificate/[id]` | RLS / route guard blocks; redirected or 403 | 🟡 (RLS-dependent) |

---

## F. Regression tests

| ID | Step | Expected | Verdict @ baseline |
|---|---|---|---|
| F1 | `/dashboard` loads with KPI cards | No console errors; data from real contracts | ✅ |
| F2 | `/contracts` loads filtered list | Loads | ✅ |
| F3 | `/claims` loads with status filters | Loads | ✅ |
| F4 | `/workflow` loads as a multi-role user | Shows pending claims; chips resolved | ✅ |
| F5 | `/action-center` loads | Action buttons render; clicking navigates to claim detail | ✅ |
| F6 | `/users` loads as Director | Loads; "Add New User" works | ✅ |
| F7 | `/settings` loads | Loads | ✅ |
| F8 | Sign out from any page | Redirects to `/login`; session cleared | ✅ |

---

## G. SQL & migration health

| ID | Diagnostic | Expected | Notes |
|---|---|---|---|
| G1 | `D6` from iam_user_health.sql | UNIQUE def references `(user_id, contract_id, contract_role)` | Migration 045 invariant |
| G2 | `pg_get_functiondef(create_claim_with_items_atomic)` contains `v_item_no_raw` | Yes | Migration 049 invariant |
| G3 | Same function: NO `::claim_type` cast | Yes | Migration 050 invariant |
| G4 | `claim_number` column exists, partial unique index `ux_claims_claim_number` exists | Yes | Migration 047 invariant |
| G5 | `chk_work_period_order` constraint exists (NOT VALID is acceptable) | Yes | Migration 047 invariant |

---

## How to use this matrix in a release window

1. **Tag the baseline** — `git tag -a v-baseline-claim-e2e-2026-05-05 f1ce509` (see baseline doc).
2. **Run the matrix end-to-end** before merging any new commit into `main`. Walk A → B → C → D → E → F → G.
3. **Capture results** — copy this file into the release ticket; mark each row ✅/🟡/❌ for the new commit.
4. **Fail closed** — any ❌ blocks the release. Repair forward; do not paper over.
5. **Update the matrix** — when a new feature lands, add a row for its smoke step and document the expected outcome.

A green run on this matrix is the operational definition of "the platform is shippable."
