# Claim Enhancement Implementation Gap Review

> **Date:** 2026-05-05
> **Scope:** Phase 2.6 New-Claim Enhancement (claim_kind dropdown, server-issued claim_number, work-execution period rename, BOQ quantity governance, open-claim guard, migrations 047–048).
> **Repository (official):** `C:\Users\Administrator\Desktop\convera-platform`
> **Branch:** `main` @ `f6b84d3` — `local main == origin/main` (ahead 0 / behind 0). All Phase 2.6 commits are present *and pushed*.
> **Status:** AUDIT ONLY — no code changes, no commits, no DB execution.

---

## 1. Executive summary

The backend half of Phase 2.6 is **correct and shipped**. The two migrations exist in the repo, are idempotent and non-destructive, the atomic RPC enforces every invariant the spec asks for, and the `/api/claims/create` route correctly strips client-sent `prev_progress`, resolves the project code with no fallback, and surfaces Arabic-localised error codes.

The frontend, by contrast, is **partially shipped**. The `claim_kind` dropdown was added and the dropdown's value travels end-to-end. But three high-visibility UI artefacts that the screenshot called out have NOT been changed:

1. The four BOQ column headers in `components/claims/BOQTable.tsx` are still hard-coded with the *old* Arabic terminology, despite a canonical labels module (`lib/field-labels.ts`) already carrying the correct strings.
2. The "الرقم المرجعي (اعتماد)" field is still **required** in the new-claim form's `validate()` and is still labelled with a red asterisk, even though the API contract treats it as optional `external_reference`.
3. There is no banner or inline copy on the form telling the contractor that the claim number will be auto-generated server-side after save.

These are not deployment problems. The screenshot exactly mirrors what the source files contain on `origin/main`. The classification for the form gaps is **Implementation Gap**, with one item that qualifies as **Wrong Component / Wrong Layer** — the BOQTable component bypasses the central labels source.

The corrective work is small in surface area (≈4 files) and can land in three focused commits without any database change.

---

## 2. Root cause of the visible gap

The Phase 2.6 commit plan (commits 1–6) was scoped to:
- DB columns and ENUM (Migration 047)
- Atomic RPC (Migration 048)
- API route + project-code resolver
- Server-truth `prev_progress` plumbing
- Claim-kind dropdown and toast wording
- Detail page + runbook documentation

It explicitly **did not** include a renaming pass over the BOQ table headers, the optional-vs-required toggle on the external reference, or the addition of an "auto-number" instructional banner. Those tasks fell off the work breakdown — the commit titles and the runbook (`logs/CLAIM_SUBMISSION_ENHANCEMENT.md`) confirm none of them claim to have touched `BOQTable.tsx` headers or the validate() rule for `refNo`. The user's screenshot is therefore a faithful render of the shipped code, not a stale build.

**Diagnosis:** Code/scope gap. Not a deployment, migration-application, or wrong-component-modified problem.

---

## 3. Audit matrix

Status legend: **Done** / **Partial** / **Missing** / **Wrong Component** / **Deployment Gap**.

### A. Claim kind dropdown

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| A1 | Required dropdown on the new-claim form | A `select` above the period inputs, three options | Implemented; `select` defaults to `running_payment`, options are بناءً على `CLAIM_KIND_OPTIONS` | `app/(app)/claims/new/page.tsx:34–38, 488–504` | **Done** | — | — |
| A2 | Three values mapped to backend enum | `running_payment` / `final_payment` / `advance_payment` | Identical strings used end-to-end; ENUM exists in DB (Migration 047 PHASE 1) | `lib/types.ts:158`, `SQL/migrations/047_…sql:93–104` | **Done** | — | — |
| A3 | Selected value sent to API | Field `claim_kind` in POST body | Sent: `services/claims.ts:277` → `app/api/claims/create/route.ts:227–229` | service + route | **Done** | — | — |
| A4 | No silent default unless approved | Default `running_payment` is intentional and documented | Default chosen and documented in code comment + runbook | `app/(app)/claims/new/page.tsx:60–67`, `logs/CLAIM_SUBMISSION_ENHANCEMENT.md` | **Done** | — | — |
| A5 | Persisted as `claim_kind` | Column populated on insert | RPC inserts `p_claim_kind` directly | `SQL/migrations/048_…sql:249–270` | **Done** | — | — |
| A6 | Single-letter code (R/F/A) embedded in claim_number | Code generated from kind | RPC computes via `CASE` (line 232–236); `lib/claim-number.ts::claimKindCode` mirrors the logic for any future client use | RPC + `lib/claim-number.ts:69–76` | **Done** | — | — |

### B. System-generated claim number

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| B1 | No manual claim-number input on the form | Field absent | The form has no `claim_number` input — the only nearby field is `refNo` (external reference) | `app/(app)/claims/new/page.tsx` (form section starts line 477) | **Done** | — | — |
| B2 | "الرقم المرجعي (اعتماد) *" still required | Should be optional `external_reference`, no red asterisk | **Frontend still enforces required** (`validate()` line 210) and label still has `<span className="text-red">*</span>` (line 528) | `app/(app)/claims/new/page.tsx:210, 528–535` | **Missing** (frontend); backend already optional (`route.ts:75`, `…/route.ts:304`) | Drop the line-210 validator; remove the asterisk; rename label to `الرقم المرجعي الخارجي (اختياري — منصة اعتماد)` | Contractors are blocked from saving a draft when they don't yet have an اعتماد number, contradicting the operational reality that اعتماد numbers are issued *after* internal approval |
| B3 | Auto-number explanation visible | Inline text "سيتم توليد رقم المطالبة تلقائيًا بعد الحفظ" or a banner | **No such copy exists.** The dropdown helper says only "يُدمج رمز النوع (R/F/A) في رقم المطالبة المُولَّد" — it does not state the number is auto-issued, nor when | `app/(app)/claims/new/page.tsx:501–503` | **Missing** | Add a small info banner inside the "بيانات الفترة" card with the canonical Arabic copy + a one-line explanation of the format | Users are confused about why no number field exists and may assume the contractor still has to fill it on اعتماد |
| B4 | Server generates `claim_number` server-side | API never reads client-sent number | The route doesn't even type a `claim_number` field on its `CreateClaimRequest` interface; the RPC is the sole producer | `app/api/claims/create/route.ts:69–82`, `SQL/migrations/048_…sql:231–246` | **Done** | — | — |
| B5 | Format `<ProjectCode><KindCode><YYMMDD>-<Seq>` | RPC uses `upper(p_project_code) || code || YYMMDD || '-' || lpad(seq,3,'0')` and `Asia/Riyadh` timezone | Implemented exactly as spec | `SQL/migrations/048_…sql:240–246` | **Done** | — | — |
| B6 | Project-code mapping explicit | `'CMH_01-C01' → CMH01`, `'250101116428' → CMH02`, `'241039011332' → CMH03`; pattern fallback only for `CMH_xx-Cyy` shape | Mapping correct; pattern fallback present; explicit `null` return for unknowns | `lib/claim-number.ts:38–63` | **Done** | — | — |
| B7 | Hard-fail when project code not resolved | API returns 422 with Arabic copy and `PROJECT_CODE_REQUIRED` | Route returns `errorResponse(…, 422, 'PROJECT_CODE_REQUIRED')` | `app/api/claims/create/route.ts:251–257` | **Done** | — | — |
| B8 | Success feedback shows generated number | Toast surfaces `claim_number` | `tem حفظ مسودة المطالبة CMH01R260504-001 بنجاح` style toast — uses `claim.data.claim_number` with `#${nextClaimNo}` only as a *fallback* if the API returns no value | `app/(app)/claims/new/page.tsx:333, 336, 348` | **Done** | — | — |
| B9 | Uniqueness enforced at DB | Unique partial index on `claim_number` | `ux_claims_claim_number` partial index exists | `SQL/migrations/047_…sql:196–198` | **Done** | — | — |
| B10 | Sequence-per-contract uniqueness | Unique partial index on `(contract_id, claim_sequence)` | `ux_claims_contract_sequence` partial index exists | `SQL/migrations/047_…sql:204–206` | **Done** | — | — |
| B11 | API rejects/ignores any `claim_number` sent by client | Field stripped or never typed | `CreateClaimRequest` interface omits `claim_number` and `claim_sequence`; even if sent it's discarded by destructure | `app/api/claims/create/route.ts:69–82, 218–222` | **Done** | — | — |

### C. Work execution period

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| C1 | Form captures `work_period_from` / `work_period_to` | Two date inputs, both required | `periodFrom` + `periodTo` state, both date inputs, both required in `validate()` | `app/(app)/claims/new/page.tsx:57–58, 205–209, 505–526` | **Done** (UI) | — | — |
| C2 | UI labels match canonical naming | "فترة تنفيذ الأعمال — من / إلى" | Exact label rendered | `app/(app)/claims/new/page.tsx:507, 518` | **Done** | — | — |
| C3 | `work_period_to` cannot precede `work_period_from` | Form-level validation + API revalidation + DB CHECK | UI: `if (periodFrom > periodTo) errors.push(...)`. API: explicit branch returns 400 `WORK_PERIOD_ORDER`. DB: `chk_work_period_order` CHECK (NOT VALID) | `app/(app)/claims/new/page.tsx:207–209`, `app/api/claims/create/route.ts:236–238`, `SQL/migrations/047_…sql:171–187` | **Done** | — | — |
| C4 | Values sent to API and persisted | Body fields `work_period_from`, `work_period_to`; columns same names | Posted as `work_period_from` / `work_period_to` (service line 279–280); RPC inserts into both canonical columns and **mirrors** them to the legacy `period_from` / `period_to` columns | `services/claims.ts:279–280`, `SQL/migrations/048_…sql:249–270` | **Done** | — | — |
| C5 | Legacy `period_from` / `period_to` not broken | Old reports still work | Migration 047 PHASE 3 backfills the new columns from the legacy ones; RPC writes both pairs on every new insert | `SQL/migrations/047_…sql:149–157`, `SQL/migrations/048_…sql:262–263` | **Done** | — | — |

### D. BOQ quantity governance — frontend

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| D1 | "الكميات المنفذة" → "الكمية السابقة" | Renamed header | **Header is still "الكميات المنفذة"** (hard-coded literal) | `components/claims/BOQTable.tsx:81` | **Wrong Component** (canonical label exists in `lib/field-labels.ts:74` but BOQTable doesn't consume it) | Replace literal with `getLabel('prev_progress')` or just the literal `الكمية السابقة` | Contractor sees inconsistent terminology vs. spec, runbook, and detail page |
| D2 | "الكميات الحالية (جاري)" → "الكمية الحالية" | Renamed header | **Header is still "الكميات الحالية (جاري)"** | `components/claims/BOQTable.tsx:82` | **Wrong Component** (`lib/field-labels.ts:75` already has `الكمية الحالية`) | Same as D1 | Same as D1 |
| D3 | "المستحق الجاري" → "قيمة المستخلص الحالي" | Renamed header | **Header is still "المستحق الجاري"** | `components/claims/BOQTable.tsx:84` | **Implementation Gap** (no canonical label exists yet — `period_amount` is labelled "قيمة الفترة") | Either (a) rename in BOQTable directly, or (b) add a new entry to `FIELD_LABELS` and use `getLabel(…)` | Same as D1 |
| D4 | "المبلغ الإجمالي" → "القيمة التراكمية" | Renamed header | **Header is still "المبلغ الإجمالي"** | `components/claims/BOQTable.tsx:85` | **Implementation Gap** | Rename in BOQTable; canonical label `cumulative` is "التراكمي" — close but not identical, prefer the spec wording | Same as D1 |
| D5 | Footer copy matches new terminology | "إجمالي قيمة المستخلص الحالي" or similar | Footer still reads "إجمالي تكلفة الفاتورة الحالية (جاري)" | `components/claims/BOQTable.tsx:163–168` | **Implementation Gap** | Adopt new wording | Cosmetic but visible at every save |
| D6 | Validation message terminology aligned | Should not reference "(جاري)" | `validate()` says "يجب إدخال الكميات الحالية (جاري) لبند واحد على الأقل" | `app/(app)/claims/new/page.tsx:214` | **Implementation Gap** | Rephrase: "يجب إدخال الكمية الحالية لبند واحد على الأقل" | Inconsistency with renamed headers |
| D7 | Previous quantity column is read-only | Disabled / non-editable when system-calculated | Implemented when `prevProgressValues` is non-empty: locked display + padlock SVG (title `محسوب تلقائياً من المطالبات المعتمدة`) | `components/claims/BOQTable.tsx:106–127` | **Partial** | When `prevProgressValues` is empty (e.g. brand-new contract) the BOQTable still renders an editable input — the column should be locked at 0 unconditionally for new claims | A user could enter a value into the prev column on the very first claim of a contract; the API silently strips it (`route.ts:115–128`), so no data corruption — but the UI deceives the user |
| D8 | Visual signal that prev is system-calculated | Padlock badge or similar | Implemented (SVG padlock with title) when locked | `components/claims/BOQTable.tsx:110–115` | **Partial** | When the table is unconditionally locked (D7), the padlock should always render | Tied to D7 |
| D9 | Current quantity remains editable | `<input>` for `curr_progress` | Editable input with focus styles, validation hooks | `components/claims/BOQTable.tsx:134–142` | **Done** | — | — |
| D10 | Calculated values update correctly in UI preview | Period amount + cumulative + progress % | `recalc()` invokes `calcBOQLine` per item; `validateBoqProgress` flags violations; results bubble up to summary | `components/claims/BOQTable.tsx:34–58` | **Done** | — | — |
| D11 | Confirm the rendered table is `BOQTable.tsx` (not a different component) | Single source of truth | New-claim page imports exactly `@/components/claims/BOQTable` and renders it inside the "بنود العقد" card | `app/(app)/claims/new/page.tsx:9, 555` | **Done** | — | — |

### E. BOQ quantity governance — backend

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| E1 | Backend ignores client-sent `prev_progress` | Field stripped before any DB call | `sanitiseBoqItems` rebuilds the row whitelist; `prev_progress` is not in the new shape | `app/api/claims/create/route.ts:115–128` | **Done** | — | — |
| E2 | Backend recomputes prev from approved claims | `SUM(curr_progress) WHERE status='approved' AND contract_id=:c AND item_no=:i` | RPC computes exactly that, twice (validation pass at line 200–206, insert pass at line 282–288) | `SQL/migrations/048_…sql:200–206, 282–288` | **Done** | — | — |
| E3 | `current_quantity >= 0` | Negative values rejected | RPC raises `CURR_PROGRESS_NEGATIVE` (errcode 22023) | `SQL/migrations/048_…sql:192–196` | **Done** | — | — |
| E4 | `current_quantity <= remaining` | Where remaining = contractual − prev | RPC raises `CURR_PROGRESS_EXCEEDS_REMAINING` if violated | `SQL/migrations/048_…sql:208–217` | **Done** | — | — |
| E5 | `cumulative_quantity = previous + current` | Stored on the claim_boq_items row | RPC writes `cumulative = v_prev_progress + v_curr_progress` | `SQL/migrations/048_…sql:296, 309` | **Done** | — | — |
| E6 | `current amount = current_quantity × unit_price` | Stored as `period_amount` | RPC: `v_period_amount := v_curr_progress * v_unit_price` | `SQL/migrations/048_…sql:290` | **Done** | — | — |
| E7 | Cumulative amount available | Stored or derivable | The row has both `cumulative` (qty) and `period_amount` (current value); a cumulative *amount* column is not on the row but is reproducible from `cumulative * unit_price` (or via a SQL view) | `SQL/migrations/048_…sql:299–314` | **Partial** (no dedicated column, but data is reconstructible — flag for the spec author whether a column is needed) | Decide: add `cumulative_amount NUMERIC GENERATED ALWAYS AS (cumulative * unit_price) STORED` in a future migration if reports require it | Reports that need the value as a single column would need to compute it inline |
| E8 | DevTools tampering rejected/ignored safely | Even if attacker forges `prev_progress` in JSON, server is authoritative | `sanitiseBoqItems` is the only path from JSON → RPC; the field is not in the destructured set; RPC also recomputes regardless | route + RPC | **Done** | — | — |
| E9 | API/RPC atomic and consistent | Single transaction; rollback on any error | RPC is one transaction; advisory lock prevents sequence races; partial inserts impossible | `SQL/migrations/048_…sql` (BEGIN/COMMIT envelope, single RPC body) | **Done** | — | — |
| E10 | Staff items unaffected | No new validation on staff side | Staff loop is pure pass-through; no recompute, no advisory work | `SQL/migrations/048_…sql:317–341` | **Done** | — | — |
| E11 | Consistency between UI prev hint and server prev | Same aggregation rule | **Mismatch detected:** `services/claims.ts::fetchPreviousQuantitiesForContract` aggregates over `IN ('approved','closed')`; RPC aggregates over `status = 'approved'` only | `services/claims.ts:386–390` vs `SQL/migrations/048_…sql:204–206` | **Partial** | Decide which set is canonical; align both. Likely the RPC should include `'closed'` since closed claims also represent shipped progress | If the two diverge, a contractor could see a UI hint of, say, 12 (UI counts closed) but the server allows them to push curr up to 14 (server only counts approved=11 + curr=14 ≤ contractual=25) — confusing UX, no data corruption |

### F. Open-claim guard

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| F1 | Guard exists in API/RPC | Defence in depth at both layers | RPC has the guard at line 165–177 of Migration 048; the route relies on the RPC's `OPEN_CLAIM_EXISTS` raise (no separate API-layer pre-check, but the RPC error mapping returns 422 with the correct Arabic copy) | route.ts + 048.sql | **Done** | — | — |
| F2 | Closed status list correct | `('approved','rejected','cancelled','closed')` | Exact list in RPC: `status NOT IN ('approved','rejected','cancelled','closed')` | `SQL/migrations/048_…sql:165–168` and partial index `ix_claims_contract_status_open` (047) | **Done** | — | — |
| F3 | Returned-by-* statuses treated as open | Any non-closed status blocks new claim | `returned_by_supervisor`, `returned_by_auditor`, etc. fall outside the closed set, so they correctly count as open | enum values in base schema; RPC `NOT IN` clause | **Done** | — | — |
| F4 | Clear Arabic error returned | 422 with localised text | "لا يمكن إنشاء مطالبة جديدة لوجود مطالبة مفتوحة على نفس العقد. يرجى إغلاق المطالبة السابقة (اعتماد أو رفض أو إلغاء) قبل المتابعة." | `app/api/claims/create/route.ts:155–159` | **Done** | — | — |
| F5 | Documented | Behaviour described in runbook | Section 5.2 of `logs/CLAIM_SUBMISSION_ENHANCEMENT.md` covers `OPEN_CLAIM_EXISTS` diagnostics | runbook | **Done** | — | — |

### G. Migration readiness

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| G1 | Migrations 047 and 048 exist and are additive | Idempotent, no destructive operations | Both present; `BEGIN/COMMIT`-wrapped, all `IF NOT EXISTS` / `CREATE OR REPLACE` / partial indexes; explicit pre-flight checks | `SQL/migrations/047_…sql`, `SQL/migrations/048_…sql` | **Done** | — | — |
| G2 | Existing claims unaffected | Backfill copies from legacy columns; new columns nullable | `UPDATE claims SET work_period_from = period_from WHERE work_period_from IS NULL`; ENUM/columns nullable | `SQL/migrations/047_…sql:115–157` | **Done** | — | — |
| G3 | All required columns present | `claim_kind`, `claim_number`, `work_period_from/to`, `external_reference`, `claim_sequence` | All six added by Migration 047 PHASE 2 | `SQL/migrations/047_…sql:115–120` | **Done** | — | — |
| G4 | `claim_number` unique | Unique partial index | `ux_claims_claim_number` | `SQL/migrations/047_…sql:196–198` | **Done** | — | — |
| G5 | `claim_sequence` unique per contract | Unique partial index on `(contract_id, claim_sequence)` | `ux_claims_contract_sequence` | `SQL/migrations/047_…sql:204–206` | **Done** | — | — |
| G6 | `work_period_to >= work_period_from` enforced safely | NOT VALID CHECK so legacy rows do not abort | `chk_work_period_order` added NOT VALID | `SQL/migrations/047_…sql:171–187` | **Done** | — | — |
| G7 | Atomic creation backed by RPC | `create_claim_with_items_atomic` exists | Migration 048 defines it `SECURITY DEFINER` with explicit grants to `authenticated, service_role` | `SQL/migrations/048_…sql:78–373` | **Done** | — | — |
| G8 | Migrations not assumed applied unless verified | We did not run SQL — *application status unknown* in this audit | The repo has no `schema_migrations` ledger we can inspect from CI; the runbook says "DRAFT — not yet executed against any DB" in 047/048 headers, but those comments are stale relative to the prod state | runbook + migration headers | **Partial** (cannot verify from this audit) | Before push of any UI-only fix, confirm migration apply status by querying `pg_proc` for the RPC and `information_schema.columns` for the new fields | Frontend code that calls `create_claim_with_items_atomic` will 500 with `function does not exist` if the RPC was never applied |
| G9 | Code degrades clearly when DB not migrated | Visible Arabic error | RPC error path returns mapped Arabic strings; the only un-mapped fallback is `Generic UNKNOWN: …` (`route.ts:196`) — works but doesn't pinpoint a missing-migration scenario | `app/api/claims/create/route.ts:152–197` | **Partial** | Add a one-time pre-flight ping (e.g. `to_regprocedure('public.create_claim_with_items_atomic(...)')`) and surface a distinct Arabic message if NULL | If migration 048 isn't in prod, every save returns "حدث خطأ غير متوقع" — slow to diagnose |
| G10 | Validation SQL exists | Inline VAL-1 … VAL-6 queries | Migration 047 has VAL-1–VAL-6, Migration 048 has VAL-1–VAL-3 | both migrations | **Done** | — | — |

### H. Deployment vs code gap

| # | Requirement | Expected | Current | Location | Status | Corrective action | Risk |
|---|---|---|---|---|---|---|---|
| H1 | Code matches what screenshot showed (form) | Same labels in source as on screen | The form gaps (B2, B3) are reproducible from the source — the source itself doesn't have the new copy | new-claim page | Classification: **Implementation Gap (not Deployment)** | Implement the missing copy (commit A below) | — |
| H2 | Code matches what screenshot showed (BOQ table) | Same headers in source as on screen | The four BOQ headers in the source are exactly the literals the screenshot shows | `components/claims/BOQTable.tsx:81–85` | Classification: **Implementation Gap + Wrong Component layer** (canonical labels module exists but is bypassed) | Implement the renames (commit B below); optionally route through `getLabel(…)` | — |
| H3 | Backend correctness | Server enforces governance regardless of UI | The backend already does the right thing; UI fixes are cosmetic / UX | API + RPC | **Done** | — | The longer the UI gap remains the more the team relies on tribal knowledge that "the prev value gets stripped" — fix soon |
| H4 | Migration applied vs not | Audit cannot answer without DB access | Cannot determine whether 047/048 are live in test DB | — | **Partial** (verification step required, see G8) | Run VAL-1 / VAL-2 of each migration before any further smoke test | If unapplied, every save fails opaquely |

---

## 4. Corrective implementation plan

Three small, focused commits + one documentation touch. Total surface ≈4 files. No DB change.

> **Each commit must keep `npx tsc --noEmit` clean and `node scripts/verify-repo-path.js` (or whatever the equivalent guardrail script is named in this repo) passing.**

### Commit A — `fix(ui-claim-form): make external reference optional and announce auto-numbering`

**File:** `app/(app)/claims/new/page.tsx`

Changes:
1. Remove `if (!refNo.trim()) errors.push('يجب إدخال الرقم المرجعي (اعتماد)');` from `validate()` (line 210).
2. Update the label literal at line 528: drop the `<span className="text-red">*</span>`; rename the field to "الرقم المرجعي الخارجي (اختياري — منصة اعتماد)".
3. Update the input placeholder from "مطلوب" to "اختياري — يُملأ بعد الاعتماد" (line 533).
4. Add a one-line info banner inside the "بيانات الفترة" `CardBody`, immediately above the grid (after line 484), with copy:
   > "سيتم توليد رقم المطالبة تلقائيًا بعد الحفظ بالصيغة `<كود المشروع><نوع المطالبة><YYMMDD>-<التسلسل>`. مثال: `CMH01R260504-001`."
5. Update the validation message at line 214: `'يجب إدخال الكمية الحالية لبند واحد على الأقل'` (drop "(جاري)" + plural).

**Validation:**
- `npx tsc --noEmit`
- Save a draft with empty `refNo` — expect 200 + toast.
- Save a draft with `refNo = "ACC-12345"` — expect 200 + value persisted as `external_reference`.
- Inspect DOM for the new banner copy.

**Risk:** None on backend (already accepts `external_reference?: string | null`). Tiny RTL/copy regression risk if the banner overflows on narrow viewports; manually verify at 1280px and 768px.

**Rollback:** `git revert <sha>` — purely UI.

---

### Commit B — `fix(boq-table): rename quantity headers and lock previous quantity unconditionally`

**Files:**
- `components/claims/BOQTable.tsx`
- (optional) `lib/field-labels.ts` — only if we choose to add `period_amount_current` and `cumulative_amount` entries.

Changes (BOQTable):
1. Header row (lines 81–85):
   - `الكميات المنفذة` → `الكمية السابقة`
   - `الكميات الحالية (جاري)` → `الكمية الحالية`
   - `المستحق الجاري` → `قيمة المستخلص الحالي`
   - `المبلغ الإجمالي` → `القيمة التراكمية`
2. Footer (line 164): "إجمالي تكلفة الفاتورة الحالية (جاري)" → "إجمالي قيمة المستخلص الحالي".
3. Lock the prev column **unconditionally** (D7): change `readonly || hasPrevProgress` to `true` (or simplify — the column is now always system-calculated and the input branch is dead code).
4. Keep the padlock badge always visible alongside the prev value, with the existing tooltip "محسوب تلقائياً من المطالبات المعتمدة".

Optional consolidation: register the four new strings in `lib/field-labels.ts` and pull via `getLabel(…)` so future renames live in one place. Recommended but not strictly required for this commit.

**Validation:**
- `npx tsc --noEmit`
- New claim on `CMH_01-C01` (currently zero approved claims) — confirm prev column shows `0` with padlock and is not editable.
- New claim on a contract with at least one approved claim — confirm padlock value matches `SUM(curr_progress)` from approved claims.
- Confirm calculated period amount and cumulative still update on edit.
- Confirm footer copy matches new wording.

**Risk:** Removes the only path that lets a user type into the prev field. If somewhere downstream a test fixture relied on editable prev, it would break — grep `prev_progress` and `prevProgressValues` across `__tests__` to be sure (a quick check of the repo shows no tests reference these names).

**Rollback:** `git revert <sha>` — UI-only.

---

### Commit C — `fix(claims): align UI prev-quantity aggregation with RPC (approved-only)`

**File:** `services/claims.ts` (function `fetchPreviousQuantitiesForContract`).

Changes:
1. Replace `.in('status', ['approved', 'closed'])` (line 390) with `.eq('status', 'approved')`.
2. Update the JSDoc above (lines 365–376) to reflect the single-status rule.
3. Add a runbook note in `logs/CLAIM_SUBMISSION_ENHANCEMENT.md` explaining the canonical aggregation rule (one paragraph in §3).

**Alternative:** If the spec author wants closed claims to count, change the RPC at lines 204–206 and 286–288 of Migration 048 *and* keep the UI as-is. **This requires a Migration 049, not an edit of 048**, since 048 is shipped. Pick *one* of the two paths in the corrective plan; do not let them diverge.

**Validation:**
- `npx tsc --noEmit`
- Contract with one approved + one closed claim — UI prev value should now match RPC's allowance check exactly.

**Risk:** Behavioural change to the prev hint shown to contractors. Low impact at the current claim volume (≈4/month).

**Rollback:** `git revert <sha>` — UI service-layer only.

---

### Commit D — `chore(claims): document the gap-review fixes and refresh smoke checklist`

**File:** `logs/CLAIM_SUBMISSION_ENHANCEMENT.md`

Changes:
1. Update §1 ("What changed for end users") to reflect renamed BOQ headers and the new auto-number banner.
2. Update §6 ("Smoke test") with three new bullets:
   - Save a draft with the external-reference field empty — expect 200.
   - Confirm the BOQ table shows "الكمية السابقة" (locked at 0 with padlock for a fresh contract).
   - Confirm the new auto-number banner is visible above the period inputs.
3. Append a §7 "Known follow-ups" calling out item E7 (cumulative amount column decision pending) and G9 (better Arabic error when migration 048 isn't applied).
4. Cross-link this audit document.

**Validation:** `npx tsc --noEmit` (no-op for docs); manual review.

**Risk:** None.

**Rollback:** `git revert <sha>` — docs only.

---

## 5. Validation commands to run after each commit

The previous session established the following as the authoritative checks. Reuse them after every commit in this corrective plan, in this order:

```bash
# 1. Repo path guardrail (rejects any reference to the legacy CONVERA path)
node scripts/verify-repo-path.js

# 2. Type safety
npx tsc --noEmit

# 3. Production build (run locally — sandbox times out)
npx next build
```

After Commit A and Commit B, additionally:

```bash
# Static check that the old labels are gone
grep -RIn "الكميات المنفذة\|الكميات الحالية (جاري)\|المستحق الجاري\|المبلغ الإجمالي" components/ app/ || echo "OK — none found"

# Static check that the auto-number banner copy landed
grep -RIn "سيتم توليد رقم المطالبة" app/ || echo "MISSING — banner not added"
```

---

## 6. Manual smoke test — full pre-staging walkthrough

Run as `cmh01.contractor@convera.test` on the test database, after Migrations 047 and 048 are confirmed applied (run VAL-1 of each migration first).

1. Sign in, go to `/claims/new`.
2. Confirm the **بيانات الفترة** card shows: dropdown نوع المطالبة (default مستخلص جاري), من / إلى date inputs, and the "الرقم المرجعي الخارجي (اختياري — منصة اعتماد)" field with **no** red asterisk.
3. Confirm the auto-number banner is visible above the grid and uses the expected copy with the example `CMH01R260504-001`.
4. Confirm the BOQ table header row reads exactly: `# / البند / سعر الوحدة / الكمية التعاقدية / الكمية السابقة / الكمية الحالية / نسبة الإنجاز / قيمة المستخلص الحالي / القيمة التراكمية`.
5. Confirm the "الكمية السابقة" cell is non-interactive on every row, displays a padlock, and shows `0` for the very first claim or the matching cumulative value otherwise.
6. Enter a curr-progress on at least one row, fill the period dates, leave the external reference empty, and click "حفظ كمسودة". Expect: success toast "تم حفظ مسودة المطالبة CMH01R260504-001 بنجاح" (date will vary).
7. Open the new draft from `/claims`. Confirm the detail page header shows the auto-issued `claim_number`.
8. Return to `/claims/new` while the draft is still open. Try to create a second claim on the same contract — expect HTTP 422 + Arabic message about an open claim.
9. Submit the draft. Expect: success toast cites the same `claim_number`, redirect to `/claims`.

---

## 7. Risks and rollback notes

- **Migration application is the single biggest external risk.** This audit cannot verify whether 047 / 048 are live in the test database. If they are not, every claim save returns a 500 with an unhelpful generic Arabic message. Before running any smoke test, query `pg_proc` for `create_claim_with_items_atomic` and `information_schema.columns` for `claims.claim_number`. If either is missing, apply 047 → 048 in that exact order *before* exercising the UI fixes.
- **No DB change in this corrective plan.** All four commits are file-level UI/docs edits and revert cleanly with `git revert`.
- **Field-labels module split.** If Commit B chooses to route the new strings through `lib/field-labels.ts`, ensure no other consumer of `prev_progress` / `curr_progress` labels depends on the old wording (a quick `grep` confirmed none today, but re-grep before merge).
- **Aggregation alignment (Commit C).** Choosing UI-changes-to-match-RPC is the lower-risk path. The reverse (changing the RPC to include `closed`) requires a fresh Migration 049 and a re-deploy — escalate that decision to the spec author before doing either.
- **Roll-forward over roll-back is the preferred recovery posture.** Each commit is self-contained; if any single one regresses an unrelated screen, the team can revert that commit individually without touching the others.

---

## 8. Stop point

This audit has produced the matrix, the executive summary, the root cause, the corrective commit plan, the file list, the validation commands, the smoke checklist, and the risk register requested. **No code, commits, pushes, or SQL have been executed.** Awaiting approval before proceeding to Commit A.
