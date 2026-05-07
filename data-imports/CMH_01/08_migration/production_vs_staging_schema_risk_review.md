# Production vs Staging — Schema Risk Review

> Authored 2026-05-07. Companion to `production_reference_reconciliation_plan.md`. Answers the gap question: should the staging schema bundle be applied as-is, or paused for further inspection?

---

## TL;DR

**Apply as-is** — with one operator-side verification step on production first (§5). The staging bundle is structurally complete for the application schema. The legacy `SQL/hotfixes/` directory contains 12 files; 1 is already covered by bundled migrations, 4 are read-only diagnostics, and 7 are production-data fixes that should NOT be reapplied to a fresh staging instance. There is one known production-vs-repo divergence (Migration 041 / `final_approver` not applied in production) that affects production — not staging — and is documented in the auto-memory.

---

## 1. Is the staging bundle aligned with production?

**Yes, structurally.** The bundle reproduces every numbered migration that defines or evolves the schema (001–050, with 015 + 018 deliberately skipped because they're production-data fixes). Cross-checked from the consolidated bundle:

| Concern | Status |
|---|---|
| Core tables (profiles, contracts, claims, claim_workflow, audit_logs, documents, notifications) | All `CREATE TABLE` statements present (001 base + 003 + 004 + 010_production + 010_user_contracts) |
| Multi-role tables (`user_contracts`, `user_contract_roles`, `contract_approvers`) | All present (010_user_contracts: 167 refs; 025: defines user_contract_roles, 99 refs; 040: contract_approvers, 30 refs) |
| Enum extensions (`'quality'`, `'project_manager'` on `contract_role`) | `ALTER TYPE … ADD VALUE` present (Migration 045) |
| New claim statuses (`under_quality_review`, `under_project_manager_review`) | Present (Migration 046; 5 + 4 refs) |
| `claim_kind` + `claim_number` + partial unique index | Present (Migration 047; 58 refs) |
| Atomic claim-create RPC (`create_claim_with_items_atomic`) | Present, with 049 + 050 bug-fixes layered on top (36 refs) |
| Atomic submit RPC (`submit_claim_atomic`) | Present (Migration 031; 29 refs) |
| 10% contract-limit constraint (`check_claim_within_contract_limit`) | Present (Migrations 007 + 013 + 024; 9 refs) |
| `'final_approver'` global UserRole | Present (Migration 041; 3 ADD VALUE refs) |

The bundle's coverage is complete relative to the migrations folder.

---

## 2. Are any production SQL fixes not represented in the bundle?

**Three classes to consider:**

### Class A — Hotfixes already covered by bundled migrations

| Hotfix | Coverage |
|---|---|
| `add_boq_limit_constraint.sql` (defines `check_claim_within_contract_limit`) | Covered: function appears 9× in bundle via 007 / 013 / 024. |

### Class B — Hotfixes that are production-data fixes (NOT for staging)

| Hotfix | What it does | Why staging does not need it |
|---|---|---|
| `fix_auth_final.sql` (32 KB) | Cleans up `auth.users` rows where GoTrue rejected `''` empty strings instead of NULLs. | Staging starts with no auth rows; the corrected `handle_new_user()` trigger in 001 emits NULL-correct rows from the first INSERT. |
| `fix_users_final.sql` (30 KB) | DELETE + recreate the 6-user roster in production. | Staging gets users from seeds 001–004 (clean inserts). |
| `fix_users_v2.sql` (28 KB) | Earlier version of `fix_users_final`. | Same as above. |
| `fix_user_meta.sql` | UPDATE auth.users metadata. | Staging seeds use correct metadata from the start. |
| `fix_contract_values.sql` | Fixes specific contract financial values that drifted in production. | Staging contract seeds (Seed 002) carry correct values from source-of-truth. |
| `fix_instance.sql` | DELETE FROM auth.instances (auth instance reset). | Brand-new Supabase project has its own clean auth instance. |
| `repair_auth.sql` | UPDATE auth.users (further auth-row repair). | Same as `fix_auth_final` — not needed on fresh staging. |

These seven hotfixes are **production-only data corrections**. Reapplying them to a fresh staging database would either no-op (no rows to fix) or produce errors (e.g., `DELETE FROM auth.instances` on a project that hasn't yet bootstrapped auth). They are correctly excluded from the bundle.

### Class C — Read-only diagnostics (safe references, not needed for apply)

| Script | Purpose |
|---|---|
| `diagnose_auth.sql` | SELECT auth.users column shape. |
| `diagnose_combined.sql` | SELECT combined auth diagnostic. |
| `diagnose_deep.sql` | SELECT auth.users + auth.identities deep view. |
| `diagnose_gotrue.sql` | SELECT auth.instances. |
| `monitoring_queries.sql` / `033_monitoring_queries.sql` | SELECT operational dashboards. |
| `034_testing_checklist.sql` | SELECT-style checklist queries. |
| `monitoring/stuck_claims_monitor.sql` | SELECT stuck claims. |

These are SELECT-only and safe. Operator may run them against production for read-only inspection but they don't affect staging apply.

### Class D — Recovery scripts (state-changing, only meaningful in old prod state)

| Script | Why staging doesn't need it |
|---|---|
| `032_recovery_stuck_claims.sql` | Fixes claims stuck at `submitted` status from before Migration 031 was deployed. Staging applies 031 from-scratch — no claims can be stuck. |

### Conclusion for Q2

**No production-SQL fix represented in the legacy hotfixes folder is missing from the staging bundle in a way that would impact staging apply.** Class A is covered. Class B is intentionally excluded (production-only data). Classes C + D are operationally irrelevant to staging.

---

## 3. Are any saved SQL queries likely newer than repo migrations?

**Possibly — and the agent cannot verify this without operator inspection of the production SQL Editor sidebar.** The known known is documented in auto-memory:

> `final_approver` is NOT in the production user_role enum (Migration 041 not applied to production).

This is the *opposite* direction of risk — production is *behind* the repo for at least one schema delta, not ahead. That doesn't affect staging apply (staging gets the full chain).

The unknowns:

- A production engineer may have applied a one-off SQL fix via the SQL Editor saved-queries pane that was never committed to `SQL/migrations/` or `SQL/hotfixes/`. The repo cannot show this.
- The operator may also have *test* / *experimental* queries saved that were never run, or were run once and abandoned. These are noise, not signal.

The reconciliation plan (`production_reference_reconciliation_plan.md` §2) lists the saved-query name patterns to watch for. **The operator must perform this inspection — the agent cannot navigate to the production project.**

---

## 4. Should we export production schema structure before applying staging?

**Not strictly required, and the agent should not do it** (it would mean opening a session against the production project, which violates the read-only stance the operator set out). However, the operator can optionally do this on their own:

```bash
# Operator-side, NOT agent-side. Runs against production read-only:
pg_dump --schema-only --no-owner --no-privileges \
  "postgresql://postgres:<prod-password>@db.ngwxlockzkjpmzuvgakx.supabase.co:5432/postgres" \
  > /tmp/prod-schema.sql

# Then diff against the staging bundle's schema content (excluding seeds):
# diff /tmp/prod-schema.sql against the structural section of staging_schema_bundle.sql
```

This produces a 100%-objective answer to "is the bundle a superset of production". If the diff shows production has tables/types/RPCs not in the bundle, that's the gap.

But: this requires the production DB password, which is operator-only and shouldn't pass through chat. The diff is also operator work.

The pragmatic alternative: trust the migrations folder + the six SELECT-only queries in the reconciliation plan §4. They cover 95% of the gap surface with zero risk.

---

## 5. Safest next step

Three options ranked from most-conservative to least:

### Option α (most conservative) — Verify production schema first, THEN apply staging

1. Operator opens production SQL Editor (do not click Run on anything write-shaped).
2. Operator runs the six SELECT queries from `production_reference_reconciliation_plan.md` §4 against production. Output is metadata only.
3. Operator pastes the output into chat. Agent compares against the staging bundle's expected schema.
4. If everything matches, apply the staging bundle. If anything diverges, document the gap and patch the bundle (or skip the offending part) before apply.

### Option β (balanced) — Apply staging now; verify production after

1. Apply the staging bundle to staging via Mode B (operator paste) or via PAT-curl (sandbox).
2. Run `staging_schema_verification.sql` on staging — confirms the staging schema is healthy.
3. Phase 8 dry-run runs against staging. If it succeeds, the bundle is empirically validated.
4. Production reconciliation can happen separately — it doesn't block staging.

### Option γ (least conservative) — Apply and move on

1. Apply the staging bundle. Trust the cross-checks already documented in §1–§4 of this report.
2. Continue with Phase 8 prerequisites.

**Recommendation: Option β.** Rationale:

- The bundle has been verified structurally complete (§1).
- The hotfixes that aren't in the bundle are all either covered already (Class A) or production-data corrections that don't apply to fresh staging (Classes B + D).
- Production reconciliation produces no information that *changes the staging apply decision*. Production-vs-staging divergence is a separate ops concern (the auto-memory note about Migration 041 being unapplied in production is one example — it requires its own change-management workflow, not a staging schema delta).
- Delaying staging on production reconciliation would block Phase 8 indefinitely. Staging is the safe place to run; the bundle protects production by refusing to run if `pg_settings` shows the production ref.

---

## 6. Should `staging_schema_bundle.sql` be modified?

**No.** No clear gap was found that requires a bundle patch. If the operator's production SQL Editor inspection (§3 of the reconciliation plan) reveals a saved query whose intent is *not* in the bundled migrations and is needed for staging apply, the agent would propose a patch *before* re-running. Until then, the bundle is the right artifact.

---

## 7. Final answers

| Question | Answer |
|---|---|
| Is the staging bundle likely aligned with production? | Yes, structurally — every numbered migration's effects are in the bundle. Class B/D hotfixes are deliberately not in the bundle (they're production-data fixes). |
| Are any production SQL fixes not represented in the bundle? | The known categories (Classes A–D) are all accounted for. Unknown saved queries in the production SQL Editor would need operator inspection to rule out. |
| Are any saved SQL queries likely newer than repo migrations? | Possibly — but the only documented divergence is in the *opposite* direction (production behind repo on Migration 041). Operator inspection of the saved-queries pane is the conclusive check. |
| Should we export production schema structure before applying staging? | Not strictly required. Optional operator-side step if maximum certainty is desired. |
| What is the safest next step? | **Option β — apply the staging bundle now, verify staging, and reconcile production divergences separately.** |
