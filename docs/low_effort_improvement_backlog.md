# CONVERA — Low-Effort Improvement Backlog

> **Date:** 2026-05-10 (revised after Production Stabilization Sprint P4)
> **Source:** read-only assessment + sprint findings
> **Filter:** every item is reachable in **≤ 1 day of focused work**, requires **no production downtime**, has **risk ≤ Medium**, and includes a **clear DB-migration yes/no** flag.
> **New columns since v1:** `When` (Today / This week / Later) and `DB migration?` (yes / no).

---

## How to read the table

- **When** — recommended horizon. *Today* = ship within 24h, blockers for safe push. *This week* = within 5 working days. *Later* = next sprint or as scheduled.
- **Effort** — engineering hours. **Low** = ≤ 2 h. **Medium** = ½–1 day.
- **Impact** — operational benefit. **High** = removes recurring incident class. **Medium** = improves daily UX or dev ergonomics. **Low** = polish.
- **Risk** — chance of breaking something live. **Low** = additive/reversible. **Medium** = touches one live surface, easy rollback.
- **DB migration?** — *yes* = a SQL file must be authored and applied. *no* = code-only or repo-only.
- **Production downtime?** — uniformly *no* across this list.

---

## Today (within 24 hours, before any push)

These five items remove the credential-leak and prod-mutation risks. **Do not `git push` until #5 below is verified clean.**

| # | Item | Description | Effort | Impact | Risk | DB migration? | Owner |
|---|---|---|---|---|---|---|---|
| **A1** | **Resolve outstanding-invoices billing alert** | Open Supabase → Project → Settings → Billing. Pay the outstanding amount. Reload Studio; the red banner should disappear. | Low | High | Low | **No** | account owner |
| **A2** | **Rotate `SUPABASE_SERVICE_ROLE_KEY`** | Per `secret_rotation_runbook.md` §2. Roll the key in Supabase, paste new value into local `.env.local`, update Vercel env var, trigger redeploy. | Low | High | Low | **No** | dev lead |
| **A3a** | **Bootstrap-password rotation (production users)** | Per `secret_rotation_runbook.md` §3. Send password-reset emails to every user listed in `DEPLOYMENT.md`; revoke all `auth.refresh_tokens`. Until done, anyone with GitHub read can log into the live app. | Medium | High | Medium | **Yes** (one `UPDATE auth.refresh_tokens SET revoked = true`) | dev lead + comms |
| **A3b** | **Decide seed-SQL fate (Option A or B)** | Per `secret_rotation_runbook.md` §4 / `platform_safety_findings.md` §4. Either parameterize the password (Option A) or hard-redact + redirect to script (Option B). Required before push. | Medium | High | Low | **No** | dev lead |
| **P5-CHECK** | **Pre-commit secret scan + then push the cleaned 30 commits** | Run the 2-line guard from `platform_safety_findings.md` §11. Confirm zero matches. Then `git push origin main`. | Low | High | Low | **No** | dev lead |

---

## This week (within 5 working days, after Today is green)

These items remove latent bugs surfaced by the assessment.

| # | Item | Description | Effort | Impact | Risk | DB migration? | Owner |
|---|---|---|---|---|---|---|---|
| **A4** | **Pre-commit secret scanner (permanent)** | Husky `pre-commit` hook running the 2-line guard so `sb_(secret\|publishable)_*` and `<old bootstrap password redacted>` patterns can never be committed again. | Low | High | Low | **No** | dev lead |
| **C1** | **Apply Migration 049 to production** | Per `migration_049_production_apply_note.md`. Single transaction, idempotent, signature-preserving. Awaits approval phrase `APPROVE-049-PROD`. | Low | High | Low | **Yes** (049) | dev lead |
| **C2** | **Resolve `final_approver` role drift (Path A or B)** | Per `final_approver_role_drift_review.md`. Trim `UserRole` union to 5 production values OR apply Migration 041 to production. Awaits approval phrase `APPROVE-DRIFT-PATH-A` (or -B / -RUNTIME-GUARD-ONLY). | Medium | High | Low | depends on path | frontend (Path A) or dev lead (Path B) |
| **C5a** | **Add prod-ref refusal guards to all Supabase-touching scripts** | One-shot helper `scripts/_guards/refuse-prod-ref.js` imported by `scripts/import-cmh01-controlled.js`, `scripts/create-test-auth-users.js`, `scripts/check-cmh01-env.js`. Refuse if URL contains `ngwxlockzkjpmzuvgakx`. | Low | High | Low | **No** | dev lead |
| **C5b** | **Investigate SLA-breach automation gap** | Per `current_platform_state_assessment.md` §11. Claims #9 (33 days) and #10 (27 days) on supervisor stage suggest the auto-alert/escalation isn't firing. Walk the code path; confirm scheduler exists. | Medium | High | Low | (maybe — if a scheduled function is missing) | backend |
| **B1** | **Quiet the `gotrue-js` auth-token lock warning** | Either disable React Strict Mode in production builds or migrate to `@supabase/ssr` cookie sessions per Supabase's current guidance. Cleaner console for incident triage. | Medium | Medium | Low | **No** | frontend |
| **B2** | **Make SLA-breach KPI tile clickable** | Dashboard's "8 SLA breaches" / "4 المطالبات المتأخرة عن SLA" tiles → `/claims?status=overdue`. | Low | Medium | Low | **No** | frontend |
| **B5** | **Show SLA clock on each open claim row** | Surface "27 days on supervisor stage" prominently in the claim list, not buried in the dashboard alert panel. | Low | Medium | Low | **No** | frontend |
| **D1** | **"Claims by stage" donut on dashboard** | Visual breakdown of where the 17 claims sit. Trivial with existing data. | Low | Medium | Low | **No** | frontend |
| **D2** | **Average days-per-stage panel** | Already shows aggregate "متوسط 38.3 يوم بالمرحلة" — split by stage to reveal slowest. | Low | Medium | Low | **No** | frontend |
| **D4** | **Excel export for claims list** | Use existing `xlsx@0.18.5` dep; add "تنزيل Excel" button to `/claims`. | Low | Medium | Low | **No** | frontend |
| **E3** | **Clean up CMH_01 working artifacts** | Delete or `.gitignore` `data-imports/CMH_01/08_migration/_chunks_1500/`, `_chunks_2k/`, `_chunks_5k/`, `_runtime_b64/`, `_runtime_test.txt`. ~1.9 MB of subagent scratch. | Low | Low | Low | **No** | dev lead |
| **F1** | **Fix the staging schema bundle defect at section 09** | `09_010b_user_contracts.sql` line 90 — drop `AND external_user_id != ''::uuid`. Patch source `migrations/010_user_contracts.sql`, regenerate split package. Full diagnosis in `data-imports/CMH_01/08_migration/sections/SCHEMA_SECTION_EXECUTION_REPORT.md`. | Low | High | Low | **No** (just patches a SQL source file) | data-import owner |

---

## Later (next sprint or as scheduled)

| # | Item | Description | Effort | Impact | Risk | DB migration? | Owner |
|---|---|---|---|---|---|---|---|
| **C3** | **Add exhaustive `claim_status` switch test** | TS test asserting every enum value is handled in any switch with a `never`-typed default. Wide enum (23 values) → silent misroute risk. | Low | Medium | Low | **No** | frontend |
| **C4** | **Plan retirement of legacy claim_status labels** | `under_consultant_review`, `returned_by_consultant`, `under_admin_review`, `returned_by_admin` are back-compat-only. Confirm `SELECT status, COUNT(*) FROM claims GROUP BY status` returns 0 for these, then schedule a migration to drop them. | Medium | Medium | Low | (future) | dev lead |
| **B3** | **Surface Vercel build identity in footer** | Add `NEXT_PUBLIC_BUILD_SHA` + `NEXT_PUBLIC_BUILD_TIME` to the Settings/About surface. Dramatically speeds up "is this user on the latest build?" debugging. | Low | Medium | Low | **No** | frontend |
| **B4** | **Empty-state copy for `/contracts` Drafts** | The 4 placeholder drafts (`CMH_04-C01`, `CMH_05-C01`, `PMH_01-C01`, `PMH_02-C01`) look like rendering errors. Either hide from default view or stamp with "قالب — لم يبدأ" badge. | Low | Medium | Low | **No** | frontend |
| **D3** | **Contract-utilization gauge** | Visual % spent vs. base value per contract (data already in `claims.total_amount`). | Low | Medium | Low | **No** | frontend |
| **D5** | **Per-contract change-order utilisation card** | Show `cumulative_change_value / base_value × 100%` against the 10% governance limit. Currently 0 change orders; preventive UX. | Low | Medium | Low | **No** | frontend |
| **E1** | **Copy migration 045 into convera-platform/SQL/migrations/** | 045 is in legacy `CONVERA` repo, deployed in production, but missing from active `convera-platform`. Copy so repo represents reality. | Low | Medium | Low | **No** | dev lead |
| **E2** | **Add `SQL/migrations/README.md`** | One-paragraph note: "Migrations 001–039 live in legacy CONVERA repo; this folder carries 040+. Full historical bundle in `data-imports/CMH_01/08_migration/sections/`." | Low | Low | Low | **No** | dev lead |
| **E4** | **Resolve untracked `logs/IAM_RBAC_STABILIZATION_AUDIT.md` etc.** | Decide whether to commit the 2 RBAC audits under `logs/` or move to `docs/audits/` and gitignore `logs/`. | Low | Low | Low | **No** | dev lead |
| **E5** | **Resolve `tsconfig.cmh01-check.json` untracked** | Either commit, rename, or delete. | Low | Low | Low | **No** | dev lead |
| **E6** | **Add `* text=auto eol=lf` to `.gitattributes`** | Stop Windows machines renormalising every file (recurring CRLF warnings noisy in `git diff`). | Low | Low | Low | **No** | dev lead |
| **F2** | **Resume staging schema apply from section 09** | Once F1 is shipped, re-run from section 09 onward. Sections 01-08b already in staging. | Low | High | Low | (staging only) | data-import owner |
| **F3** | **Author Method-4 helper script `_TOOLS/apply_staging_sections.mjs`** | Node + `pg` over `STAGING_DB_URL`, prod-ref refusal hard-wired, iterates section files in order, stops on first error. Removes browser-driven Studio dependency. | Medium | Medium | Low | **No** | data-import owner |
| **F4** | **CI smoke test on every PR** | Playwright (or `curl`) hits each public route on the deployed Vercel preview. Catches obvious regressions before merge. | Medium | Medium | Low | **No** | dev lead |
| **F5** | **Document staging gap in `docs/staging.md`** | "What's deployed where" matrix so the team knows. | Low | Medium | Low | **No** | dev lead |

---

## Done (since the previous version of this backlog)

These were completed during the Production Stabilization Sprint P1-P3:

- ✅ **A2 setup** — `.env.local.example` redacted on disk (real keys removed). Awaiting operator to actually rotate `SUPABASE_SERVICE_ROLE_KEY` per `secret_rotation_runbook.md` §2.
- ✅ **Inventory** — full grep of tracked + untracked files for `sb_(secret\|publishable)_*` and bootstrap-password literals; results in `platform_safety_findings.md` §2-§5.
- ✅ **Doc** — `docs/secret_rotation_runbook.md` authored.
- ✅ **Doc** — `docs/migration_049_production_apply_note.md` authored.
- ✅ **Doc** — `docs/final_approver_role_drift_review.md` authored (review only — no code changed).

---

## Suggested execution order

```
TODAY      A1 → A2 → A3a → A3b → P5-CHECK → push.
THIS WEEK  A4 → C1 → C2 → C5a → C5b → B1 → B2/B5 → D1/D2/D4 → E3 → F1.
LATER      C3 → C4 → B3/B4 → D3/D5 → E1/E2/E4/E5/E6 → F2/F3/F4/F5.
```

---

## Approval phrases recap (one place)

| To do this | Type this |
|---|---|
| Apply Migration 049 to **production** | `APPROVE-049-PROD` |
| Apply Migration 049 to **staging** (after F1) | `APPROVE-049-STAGING` |
| Have me write the Method-4 049 apply script | `WRITE-049-APPLY-SCRIPT` |
| Take Path A on `final_approver` drift (recommended) | `APPROVE-DRIFT-PATH-A` |
| Take Path B on `final_approver` drift (DDL on prod) | `APPROVE-DRIFT-PATH-B` |
| Just add the runtime guard from §6 of the drift doc | `APPROVE-DRIFT-RUNTIME-GUARD-ONLY` |

For all other backlog items, no approval phrase is needed — they are operator-side or self-evident code work.

---

*Companion documents: `current_platform_state_assessment.md`, `platform_safety_findings.md`, `secret_rotation_runbook.md`, `migration_049_production_apply_note.md`, `final_approver_role_drift_review.md`.*
