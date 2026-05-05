# Auto-numbered Claim Submission — Phase 2.6 Runbook

> **Status:** shipped 2026-05-04 across Migrations 047 + 048 and code commits feat(db)…feat(claims)…feat(ui)…
> **Audience:** Engineering, Auditors, Reviewers, Final Approver, Director.
> **Scope:** the new-claim flow on the contractor side. The Phase 2.6 workflow engine (supervisor → reviewer → quality → PM → final approver) is unchanged.

---

## 1. What changed for end users

The new-claim form (`/claims/new`) now:

1. Shows a **نوع المطالبة** dropdown above the period inputs — three options:
   - مستخلص جاري — running payment (default).
   - مستخلص ختامي — final payment.
   - دفعة مقدمة — advance payment.
2. Renames the period inputs to **فترة تنفيذ الأعمال — من / إلى** (matches the Migration 047 column names `work_period_from` / `work_period_to`).
3. Auto-fills the **الكميات المنفذة** column on every BOQ row from approved claims and locks it with a padlock badge — the user can no longer edit the prev quantity.
4. Surfaces the server-issued **رقم المطالبة** (e.g. `CMH01R260504-001`) in the success toast and the claim detail page header, replacing the local `#<claim_no>` integer.
5. Blocks creating a new claim while a previous claim on the same contract is still open (anything other than approved / rejected / cancelled / closed).

---

## 2. Anatomy of `claim_number`

Format: `<ProjectCode><KindCode><YYMMDD>-<Sequence>`

| Segment | Width | Source |
| ------- | ----- | ------ |
| ProjectCode | 5 chars | `lib/claim-number.ts::resolveProjectCode(contracts.contract_no)` |
| KindCode    | 1 char  | `R` running, `F` final, `A` advance |
| YYMMDD      | 6 chars | server clock, `Asia/Riyadh` timezone |
| `-`         | 1 char  | literal separator |
| Sequence    | 3+ chars | per-contract running counter, zero-padded to width 3 |

Example breakdown of `CMH01R260504-001`:
- `CMH01` — project code resolved from contract `CMH_01-C01`.
- `R` — running payment.
- `260504` — 4 May 2026, Riyadh local date.
- `001` — first claim ever issued on this contract.

**Project-code resolution is strict.** The map is explicit (see `lib/claim-number.ts`). There is **no silent fallback**. If a future contract is created and the resolver returns `null`, the API responds 422 with `PROJECT_CODE_REQUIRED` and the Arabic copy *تعذّر تحديد كود المشروع لهذا العقد — تواصل مع مدير الإدارة قبل المتابعة.* Adding a new contract therefore requires updating both `EXPLICIT_PROJECT_CODE_MAP` in code and the corresponding row in `logs/REPOSITORY_PATH_AND_SEEDING_RULES.md` §4.

---

## 3. Server-side guarantees (Migrations 047 + 048)

The RPC `create_claim_with_items_atomic` is the only path that inserts into `claims` for new drafts. It is `SECURITY DEFINER` and granted to `authenticated` and `service_role`.

In one transaction it:

1. Validates inputs (`p_contract_id`, `p_claim_kind`, `p_work_period_from <= p_work_period_to`, `p_actor_id`, `p_project_code`).
2. Verifies the contract exists.
3. **Open-claim guard.** Counts claims on this contract whose status is *not* in (`approved`, `rejected`, `cancelled`, `closed`). If ≥ 1 → raises `OPEN_CLAIM_EXISTS`.
4. **Advisory lock.** Acquires `pg_advisory_xact_lock(hashtext(contract_id::text))` so two contractors cannot allocate the same `claim_sequence` simultaneously.
5. Allocates `claim_sequence = COALESCE(MAX(claim_sequence), 0) + 1` per contract.
6. Formats `claim_number` using `to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYMMDD')` and `lpad(claim_sequence::text, 3, '0')`.
7. Iterates `p_boq_items`:
   - Recomputes `prev_progress` per BOQ item from `SUM(curr_progress)` over the contract's approved / closed claims. Any client-supplied `prev_progress` is ignored.
   - Validates `curr_progress >= 0` and `curr_progress + prev_progress <= contractual_qty`. Raises `CURR_PROGRESS_NEGATIVE` or `CURR_PROGRESS_EXCEEDS_REMAINING` on violation.
8. Inserts the `claims` row plus `claim_boq_items` and `claim_staff_items` rows.
9. Returns `{id, claim_no, claim_number, claim_sequence, claim_kind, status: 'draft'}`.

Any `RAISE EXCEPTION` aborts the whole transaction — there is no partial state to clean up.

---

## 4. Client wiring (commit map)

| Commit | Layer | Purpose |
| ------ | ----- | ------- |
| `feat(db): claim kind and auto-number columns` | DB | Migration 047 — enum, columns, idempotent constraint, indexes. |
| `feat(db): atomic claim creation RPC` | DB | Migration 048 — the RPC described above. |
| `feat(api): create claims with server-issued claim numbers` | API | `/api/claims/create` route + `lib/claim-number.ts` + `services/claims.ts::createClaim` refactor. Browser no longer inserts directly. |
| `feat(claims): enforce server-computed previous quantities` | UI display | `services/claims.ts::fetchPreviousQuantitiesForContract` + `BOQTable.prevProgressValues` wired in the new-claim page. |
| `feat(ui): add claim kind dropdown and auto-number claim form` | UI input | Dropdown, period relabel, success-toast displays `claim_number`. |
| `chore(claims): document auto-numbered claim submission flow` | UI display + docs | Detail page surfaces `claim_number` + `claim_kind` + canonical period names; this runbook. |

---

## 5. Operator runbook

### 5.1 Add a new test contract (CMH04, CMH05, …)

1. Decide on the canonical 5-character project code.
2. Add it to `EXPLICIT_PROJECT_CODE_MAP` in `lib/claim-number.ts`. Keep the keys sorted by project code.
3. Append a row to the table in `logs/REPOSITORY_PATH_AND_SEEDING_RULES.md` §4.
4. Re-seed (`scripts/create-test-auth-users.js` + `SQL/seeds/005_seed_test_users_cmh.sql` — see §3a of the seeding rules).
5. Run `npx tsc --noEmit` — there are no schema changes so a migration is not required.

### 5.2 Diagnose `OPEN_CLAIM_EXISTS` in production

1. Find the offending contract: the API response body's `error_code` is `OPEN_CLAIM_EXISTS`.
2. Query `claims` for the contract:
   ```sql
   SELECT id, claim_no, claim_number, status
   FROM claims
   WHERE contract_id = :contract_id
     AND status NOT IN ('approved','rejected','cancelled','closed')
   ORDER BY claim_no DESC;
   ```
3. Either drive the open claim through the workflow to a terminal status, cancel it (Director only), or — if the row is genuine corruption — escalate to the on-call DBA. Do not delete claim rows.

### 5.3 Diagnose `CURR_PROGRESS_EXCEEDS_REMAINING`

The user has entered a `curr_progress` value that, plus the server-truth previous cumulative, would exceed `contractual_qty`. The new-claim form should now warn before submit, but if the API still rejects:

1. Check the BOQ template:
   ```sql
   SELECT item_no, contractual_qty FROM contract_boq_templates WHERE contract_id = :contract_id ORDER BY item_no;
   ```
2. Compute the cumulative manually:
   ```sql
   SELECT i.item_no, SUM(i.curr_progress) AS cumulative
   FROM claim_boq_items i
   JOIN claims c ON c.id = i.claim_id
   WHERE c.contract_id = :contract_id
     AND c.status IN ('approved','closed')
   GROUP BY i.item_no;
   ```
3. The shortfall is `contractual_qty - cumulative`. If the user is legitimately trying to claim more than the contract allows, a change order under the 10% governance rule is the correct path — not a workaround at claim level.

### 5.4 Roll back

The migrations are additive — Migration 047 adds nullable columns; Migration 048 adds a function. To roll back:

```sql
DROP FUNCTION IF EXISTS create_claim_with_items_atomic(...);  -- (signature in 048)
DROP INDEX IF EXISTS ix_claims_contract_status_open;
DROP INDEX IF EXISTS ux_claims_contract_sequence;
DROP INDEX IF EXISTS ux_claims_claim_number;
ALTER TABLE claims DROP CONSTRAINT IF EXISTS chk_work_period_order;
ALTER TABLE claims
  DROP COLUMN IF EXISTS claim_kind,
  DROP COLUMN IF EXISTS claim_number,
  DROP COLUMN IF EXISTS claim_sequence,
  DROP COLUMN IF EXISTS work_period_from,
  DROP COLUMN IF EXISTS work_period_to,
  DROP COLUMN IF EXISTS external_reference;
DROP TYPE IF EXISTS claim_kind;
```

Code commits revert in reverse order: ui → claims → api → db. The UI code tolerates legacy rows (it falls back to `period_from` / `period_to` and `reference_no` when the canonical fields are null), so partial rollbacks are safe.

---

## 6. Smoke test (manual, pre-staging)

Run as the contractor user `cmh01.contractor@convera.test` on test database:

1. Sign in and navigate to `/claims/new`.
2. Confirm contract `CMH_01-C01` is auto-selected.
3. Confirm the new dropdown labelled **نوع المطالبة** is present above the period inputs and defaults to **مستخلص جاري**.
4. Confirm the BOQ rows show **الكميات المنفذة** with values from prior approved claims and a padlock badge — the field cannot be edited.
5. Pick **مستخلص جاري**, fill the period dates, enter a curr-progress value, and save as draft.
6. Expect success toast **`تم حفظ مسودة المطالبة CMH01R260504-001 بنجاح`** (date will vary).
7. Navigate to the claim detail page and confirm the header reads **`مطالبة CMH01R260504-001`**, the **بيانات المطالبة** card shows **رقم المطالبة**, **نوع المطالبة = مستخلص جاري**, and **فترة التنفيذ — من / إلى** is populated.
8. Without submitting, return to `/claims/new` and try to create a second claim on the same contract — expect 422 Arabic error citing the open claim.
