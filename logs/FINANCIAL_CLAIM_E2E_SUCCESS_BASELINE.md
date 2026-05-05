# Financial Claim E2E Success — Baseline Snapshot

> **This document defines the protected baseline.** Every commit landed after this point must preserve the end-to-end financial-claim success cycle described below. If a change risks regressing this baseline, stop and ask before proceeding.

---

## Snapshot identity

| Field | Value |
|---|---|
| Date / time recorded | 2026-05-05 |
| HEAD commit at recording | `f1ce509 feat(workflow-page): wire activeRole through performClaimAction` |
| Branch | `main` (in sync with `origin/main` at recording time, ahead 0 / behind 0) |
| Tag recommended | `v-baseline-claim-e2e-2026-05-05` (annotated tag, see §Rollback) |

## What "successful E2E" means here

The full happy path for a financial claim now runs end-to-end:

1. **Contractor creates** a financial claim from `/claims/new`.
   - `claim_kind` dropdown forces an explicit choice.
   - The system issues `claim_number` server-side under advisory lock.
   - Open-claim guard prevents two drafts on the same contract.
   - `prev_progress` is computed from approved claims only (server-side).
2. **Contractor submits** → status moves to `under_supervisor_review`.
3. **Supervisor reviews** → approves → `under_technical_review`.
4. **Technical / reviewer stage** approves → `under_quality_review`.
5. **Quality stage** approves → `under_project_manager_review`.
6. **Project manager** approves → `pending_director_approval`.
7. **Final approver** approves → `approved`.
   - Completion certificate becomes available on the claim detail page (`/print/certificate/[id]`).

A multi-role actor (e.g. `reviewer + quality` on the same contract) can pick the right role via the role-chip strip on the claim detail page or via the `/workflow` queue page; the request carries `actor_role`, the server validates against `user_contract_roles`, and the transition succeeds.

## Test fixtures used to validate the baseline

| Fixture | Value |
|---|---|
| Contract tested | `CMH_02` (`contract_no = '250101116428'`) |
| Project code | `CMH02` (resolved by `lib/claim-number.ts`) |
| Claim kind | `running_payment` (most-common case) |
| Claim number generated | `CMH02R260505-002` (example shape — actual sequence depends on the contract's claim history) |
| Claim status reached | `approved` |
| User roles exercised | `contractor`, `supervisor`, `reviewer`, `quality`, `project_manager`, `final_approver`, `director` |
| Multi-role users exercised | reviewer + quality on the same contract; supervisor + reviewer on a separate contract |

## Migrations required to reproduce the baseline

Apply in numerical order. All are additive and idempotent.

| Migration | Purpose | Status |
|---|---|---|
| `040_flexible_approvers_and_import.sql` | Final-approver designation + import scaffolding | applied |
| `041_final_approver_role.sql` | Adds the final-approver workflow role | applied |
| `044_imports_governance.sql` | Import path governance | applied |
| `046_quality_and_pm_stages.sql` | Adds the `under_quality_review` and `under_project_manager_review` stages | applied |
| `047_claim_kind_and_number.sql` | `claim_kind` enum, `claim_number`, `work_period_*`, `external_reference`, `claim_sequence`, partial-unique indexes | applied |
| `048_create_claim_with_items_atomic.sql` | Atomic-create RPC with open-claim guard + advisory lock | applied |
| `049_fix_claim_rpc_item_no_cast.sql` | Cast BOQ `item_no` JSONB → INTEGER + `ITEM_NO_INVALID` guard | applied |
| `050_fix_claim_rpc_claim_type_cast.sql` | Drop the `::claim_type` enum cast (column is `TEXT`) | applied |

Migration 045 (the unique-key relax for `user_contract_roles`) was applied earlier and is also a hard pre-condition. Verify with diagnostic **D6** in `SQL/diagnostics/iam_user_health.sql`.

## Application code that landed alongside

| Commit | Purpose |
|---|---|
| `c446300` | Optional external reference + auto-number banner on new-claim form |
| `a0a5df2` | BOQ headers renamed; previous quantity locked unconditionally |
| `b44a438` | UI previous-quantity aggregation aligned with RPC (approved-only) |
| `77e2de5` | Gap-review runbook + smoke checklist |
| `61c05b9` | New-claim page surfaces the API's structured Arabic error |
| `0f6ca80` | Multi-role active role on the claim detail page |
| `196fceb` | User-management modal try/catch + Arabic error toast |
| `713e315` | Admin users API onConflict = 3-tuple + no swallowed errors |
| `f1ce509` | `/workflow` page wires `activeRole` through `performClaimAction` |

## Known remaining issues (do NOT regress; safe to defer)

| ID | Item | Risk | Class |
|---|---|---|---|
| K1 | `lib/claim-number.ts` is a frozen 3-contract map + `CMH_xx-Cyy` regex. Adding a fourth contract requires a code change. | Operational only; the API fails clearly with `PROJECT_CODE_REQUIRED` when a contract isn't mapped. | P1 — schedule before onboarding contract #4. |
| K2 | `lib/contract-permissions.ts::resolveContractRole` uses `.maybeSingle()` and cannot represent multi-role users in the resolver itself. The route's `actor_role` override compensates; refactoring the resolver to return `ContractRole[]` was deferred (proposed as IAM-5 in the prior audit). | Defensive backstop only — the override is the primary path. | P2 — schedule when there is a release window. |
| K3 | Smart BOQ entry by current-quantity OR current-progress-percent (CLM-1) is not implemented. Today users must enter quantity. | UX gap. The data model is unchanged; both inputs reduce to the same `curr_progress` value before submit. | P2 — design first, then a focused commit. |
| K4 | `.env.local.example` working-tree drift (`TEST_USER_PASSWORD=ض�` corruption). | Cosmetic only. | P1 — trivial revert. |
| K5 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` is referenced by the browser client but not declared in `.env.local.example`. | Onboarding doc gap only. | P1. |
| K6 | Build cannot complete inside the sandbox's 45s budget; relies on local pre-push verification. | Pipeline only. | accepted. |
| K7 | API error shape varies (`{error}` / `{error, error_code}` / `{success, message}`). The proposed `{ code, messageAr, details? }` contract (IAM-6) is not yet adopted. | Diagnosability only. | P2. |

## Rollback / tag recommendation

**Recommended:** create an annotated tag now so any future regression has a known-good return point.

```bash
# Run on a developer host (NOT in the sandbox — push not authorized here):
git fetch origin
git tag -a v-baseline-claim-e2e-2026-05-05 \
  f1ce509 \
  -m "Financial claim E2E success baseline (2026-05-05)
Recorded by: logs/FINANCIAL_CLAIM_E2E_SUCCESS_BASELINE.md
Migrations 040 + 041 + 044 + 045 + 046 + 047 + 048 + 049 + 050."
git push origin v-baseline-claim-e2e-2026-05-05
```

If a future stabilization or feature commit regresses the E2E flow:

1. Capture which test step in `logs/PLATFORM_SMOKE_TEST_MATRIX.md` regressed.
2. `git bisect start HEAD v-baseline-claim-e2e-2026-05-05` to identify the first bad commit.
3. Either `git revert <bad-sha>` or roll forward with a targeted fix; do **not** force-rewrite history past the baseline tag.

## Protected files (untouched at baseline; treat as such going forward)

- `lib/workflow-engine.ts`
- `lib/action-engine.ts`
- `lib/notification-engine.ts`
- `lib/sla-engine.ts`
- `lib/sla-escalation.ts`
- `app/api/claims/submit/route.ts`
- `app/api/claims/transition/route.ts` (modified at the baseline by `0f6ca80` to accept `actor_role`; further changes require explicit approval per the IAM/RBAC sprint rules)

## What changes are safe under this baseline

- Documentation (`logs/*.md`).
- Read-only diagnostic SQL (`SQL/diagnostics/*.sql`).
- UI-only additions to `/claims/new`, `/claims/[id]`, `/workflow`, `/users` that do not change the request shape or the workflow-engine's allow-list.
- Pure helper modules (`lib/active-role.ts`, `lib/calculations.ts`, etc.) provided their public API is preserved.

## What requires a fresh design + explicit approval

- Any change to `lib/workflow-engine.ts`, `lib/action-engine.ts`, or other protected files.
- Any new DB migration (Migration 051+).
- Any change to the `claim_number` resolver shape.
- Any wide blast-radius refactor (more than ~5 files).

---

This baseline is the lower bound for "production-grade-stable enough to keep iterating".
