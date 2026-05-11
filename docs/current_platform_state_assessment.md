# CONVERA Platform — Current State Assessment

> **Date:** 2026-05-10
> **Operator:** Claude (Cowork mode), read-only assessment
> **Repos inspected:** `convera-platform/` (active), `CONVERA/` (legacy, read-only reference)
> **Production:** NOT mutated. Only `SELECT`/metadata queries executed against Supabase prod.

---

## 1. Executive summary

CONVERA production is **live, healthy, and in real operational use**. The Vercel deployment at `https://convera-platform.vercel.app` is wired to Supabase prod (`ngwxlockzkjpmzuvgakx`) and serves the MoMaH Development & Rehabilitation department with 17 contracts (2 active, 17.1 M SAR portfolio under management) and 17 financial claims at various workflow stages. The 5-stage approval pipeline including the new Quality, Project-Manager, and Final-Approver stages is in active use. The single most operationally-significant signal in the Supabase dashboard right now is a **billing risk banner** ("Outstanding invoices — Please pay your invoices to avoid service disruption"), which trumps every code/UX issue surfaced below.

The assessment also surfaced four structural concerns that the team should address before the next push: (1) **30 unpushed local commits** in the active repo containing the entire CMH_01 data-import scaffolding, (2) **a real-looking SUPABASE_SERVICE_ROLE_KEY committed in `.env.local.example`** plus uncommitted changes to that file that introduce additional real-looking keys, (3) **Migration 049 is in the repo but not applied to production**, and (4) **schema/code drift around `final_approver`** — production carries the value in `contract_role` only, not in `user_role`, so any TypeScript types or RLS policies that reference `final_approver` as a `user_role` will fail at runtime.

The good news is that almost every fix on the prioritized backlog is low-risk, low-effort, and can be done without production downtime.

## 2. Current live architecture

```
                ┌────────────────────────────────────┐
                │  https://convera-platform.vercel.app│
                │  (deployment alias:                │
                │   convera-platform-ctalpk59z       │
                │   -arfaj001-5512s-projects.vercel) │
                └────────────────┬───────────────────┘
                                 │  Next.js 14.2 (App Router) ·
                                 │  React 18 · @supabase/ssr 0.5 ·
                                 │  @supabase/supabase-js 2.49
                                 ▼
                ┌────────────────────────────────────┐
                │  Supabase project ngwxlockzkjpmzuvgakx│
                │  (production · "MOMAH/CONVERA/main")│
                │  · Postgres 15 · 25 public tables   │
                │  · 13 enums · 31 RPC functions       │
                │  · RLS on all public tables         │
                └────────────────────────────────────┘
                                 │
                ┌────────────────┴───────────────────┐
                │  Supabase Auth (gotrue-js)         │
                │  · email + password                │
                │  · 15 profiles · 5 convera_users   │
                └────────────────────────────────────┘
```

Active client repository: `C:\Users\Administrator\Desktop\convera-platform` — Next.js 14 standalone build, deployed via Vercel and configured for Netlify (`netlify.toml` present). The `CONVERA` folder on Desktop is the legacy reference codebase that carries the full migration history (001-045).

## 3. Production Supabase status (read-only review)

**Project:** `ngwxlockzkjpmzuvgakx` ("CONVERA / MOMAH / main · PRODUCTION")
**Tier:** Pro
**Region:** Visible regions in maintenance notice: `ap-southeast-1`, `sa-east-1` (planned shared-pooler maintenance May 13-14)

### Schema inventory

- **Tables (25):** `audit_logs`, `change_order_*` (4 tables), `change_orders`, `claim_*` (3 tables), `claims`, `contract_amendments`, `contract_approvers`, `contract_boq_templates`, `contract_staff_templates`, `contracts`, `convera_otp`, `convera_users`, `documents`, `import_errors`, `imports`, `kpi_snapshots`, `notifications`, `permission_requests`, `profiles`, `user_contract_roles`, `user_contracts`.
- **Enums (13):** `approval_scope`, `audit_action`, `change_order_status`, `claim_kind`, `claim_status`, `contract_role`, `contract_status`, `contract_type`, `document_type`, `import_status`, `notification_type`, `permission_request_status`, `user_role`.
- **RPC/functions (31):** notable ones include `create_claim_with_items_atomic`, `submit_claim_atomic`, `validate_claim_status_transition`, `auto_claim_number`, `get_contract_final_approvers`, `get_contract_role`, `get_my_contract_roles`, `is_final_approver`, `is_internal`, `log_audit_event`, `protect_prev_progress`, `block_submitted_persist`, `enforce_invoice_before_submission`, `check_claim_within_contract_limit`, `fn_block_approval_if_variation_unresolved`.
- **Row counts (live data):** `contracts=17` (2 active), `claims=17`, `profiles=15`, `convera_users=5`, `user_contracts=10`, `user_contract_roles=31`, `change_orders=0`, `documents=10`.

### Enum values that confirm migration coverage

- `claim_status` (23 values) includes the legacy 4-stage labels **and** the new 5-stage workflow labels: `under_supervisor_review`, `returned_by_supervisor`, `under_auditor_review`, `returned_by_auditor`, `under_reviewer_check`, plus the post-046 stages: `under_quality_review`, `returned_by_quality`, `under_project_manager_review`, `returned_by_project_manager`, `returned_by_final_approver`, `under_technical_review`, `returned_by_technical`, plus terminal states `approved`, `rejected`, `cancelled`, `closed`. This is a wide enum — the legacy 4-stage labels are kept around for backward compatibility but should eventually be retired.
- `contract_role` (8 values): `contractor`, `supervisor`, `auditor`, `reviewer`, `viewer`, `project_manager`, `quality`, `final_approver`. This is the canonical place for the new role taxonomy.
- `user_role` (5 values, unchanged from base schema): `director`, `admin`, `reviewer`, `consultant`, `contractor`. **Does NOT contain `final_approver`** — the per-user global role is still the original 5; the new fine-grained roles live in `contract_role` (per-user-per-contract) via `user_contract_roles`.
- `claim_kind` (3): `running_payment`, `final_payment`, `advance_payment`.

### Migration coverage in production

| Migration | Title | In production? |
|---|---|---|
| 040 | flexible_approvers_and_import | ✅ |
| 041 | final_approver_role | ⚠️ partially — `final_approver` value present in `contract_role` only, not in `user_role` |
| 042 | extend_enums_for_template_v7 | ✅ (under_technical_review/returned_by_technical present) |
| 043 | data_model_hardening (SAFE) | ✅ |
| 044 | imports_governance | ✅ (`imports`, `import_errors`, `permission_requests` tables present) |
| 045 | contract_role_multi_assignment | ✅ (`user_contract_roles` table present, 31 rows) |
| 046 | quality_and_pm_stages | ✅ (under_quality_review + under_project_manager_review present) |
| 047 | claim_kind_and_number | ✅ (`claim_kind` enum + `claim_number` column present) |
| 048 | create_claim_with_items_atomic | ✅ (RPC exists) |
| **049** | **fix_claim_rpc_item_no_cast** | ❌ **NOT applied** — production RPC source does not contain `(item->'item_no')::int` |
| 050 | fix_claim_rpc_claim_type_cast | ✅ (no `::claim_type` cast in current RPC source) |

### Operational signals from the Supabase dashboard

- 🚨 **Outstanding invoices** banner — "Please pay your invoices to avoid service disruption" (visible on every Studio page).
- ⚠️ **Upcoming maintenance** — Shared pooler maintenance in `ap-southeast-1` and `sa-east-1` on **May 13-14** (3-4 days from this assessment date 2026-05-10).
- 122 saved SQL queries in PRIVATE — the project has been heavily diagnosed manually. Notable saved queries include `IAM/RBAC User Health Drift Diagnostics`, `Upsert Quality Role for User-Contract`, `Retrieve User Contract Role Details`, `Fix create_claim_with_items signature`. This footprint suggests the team has been firefighting role/RPC drift one query at a time.

## 4. Vercel / deployment status

- **Public alias:** `https://convera-platform.vercel.app`
- **Deployment URL:** `convera-platform-ctalpk59z-arfaj001-5512s-projects.vercel.app`
- **Health:** `/login`, `/dashboard`, `/contracts`, `/claims` all rendered cleanly with no client-side errors observed.
- **Auth:** Supabase email + password; the test session in the user's browser was already authenticated as `محمد العرفج · مدير الإدارة` (Director).
- **Console signal:** one repeating warning from `@supabase/gotrue-js` — `Lock "lock:sb-ngwxlockzkjpmzuvgakx-auth-token" was not released within 5000ms. This may indicate an orphaned lock from a component unmount (e.g., React Strict Mode). Forcefully acquiring the lock to recover.` This is a known React Strict Mode + gotrue-js artifact and is non-fatal, but it makes the auth log noisy and can mask real issues.
- **Build identity:** chunked bundle visible in the wild (e.g. `_next/static/chunks/53-8b6749345b3ba44a.js`); could not access Vercel build dashboard from this assessment but the deployment is clearly live.

The Vercel deployment dashboard itself was not opened (would require additional tabs and a separate auth scope); recommend the operator check it directly at https://vercel.com/dashboard for build logs, env-variable parity, and recent deploy diff.

## 5. App functional smoke-test observations

| Page | Result |
|---|---|
| `/login` | Loads. RTL Arabic, MoMaH branding. Email pre-filled (saved session). Bilingual toggle present. |
| `/dashboard` | Loads. Renders KPI cards: total portfolio 20.1 M SAR, active value 17.1 M SAR, approved disbursement 2.4 M SAR (13.8 %), pending director-approval 51,100 SAR. Risk panel calls out 6 critical + 10 high-priority items, 2 specific claims (#10 — 27 days SLA, #9 — 33 days SLA) on the supervisor stage. |
| `/contracts` | Loads. 17 contracts listed; 2 active (231001101771: 13.6 M SAR, 241039011332: 3.5 M SAR), 1 suspended (250101116428: 2.99 M SAR), and several drafts including `CMH_04-C01`, `CMH_05-C01`, `PMH_01-C01`, `PMH_02-C01` (placeholders, 0 value). |
| `/claims` | Loads. 17 claims with mixed statuses including `مراجعة وحدة الجودة بالوزارة` (Quality unit review — confirms migration 046 in active use), `مراجعة المكتب الهندسي` (Supervisor stage), `بانتظار الاعتماد النهائي` (pending final approval), `معتمدة` (approved), `ملغاة` (cancelled), `مراجعة المدقق` (auditor review). |

**Pages NOT tested (out of scope or required form submissions):** `/claims/new` (would risk creating a record), `/workflow`, `/reports`, `/الأداء التنفيذي`, `/مركز الإجراءات`, `/إدارة الصلاحيات`, `/الاستيراد الجماعي`, `/إدارة المستخدمين`, `/settings`. All visible in the sidebar and presumed to load (sidebar links don't 404), but were not navigated to as part of the read-only assessment.

## 6. Schema/code drift findings

- **Drift A — Migration 049 is in repo but not in production.** Production's `create_claim_with_items_atomic` source does not contain the `(item->'item_no')::int` cast that 049 introduces. This means new claim creation through the RPC may silently rely on the older cast behaviour. Apply 049 to production after a one-line review.
- **Drift B — Migration 045 is in legacy CONVERA repo but not in active convera-platform/SQL/migrations/.** The production `user_contract_roles` table evidently came from 045, but a developer cloning only `convera-platform` will not see the source. Either copy 045 into the active repo's `SQL/migrations/`, or add a `SQL/migrations/README.md` that explains "001–045 live in the legacy CONVERA repo; this folder only carries 040+ that this team owns".
- **Drift C — `final_approver` in `contract_role` only, not in `user_role`.** Migration 041's net effect in production was to add `final_approver` to `contract_role` (per-contract scope), not to `user_role` (global scope). Any TypeScript union type that lists `final_approver` as a `user_role` will fail when round-tripped through a typed Supabase client. Audit `lib/types`, `services/users.ts`, and any role-comparing UI.
- **Drift D — Repo carries 30 unpushed commits.** All recent CMH_01 data-import work, plus the `chore: finalize auth diagnostics and env example cleanup` commit that introduced the `.env.local.example` issue (see safety findings doc).
- **Drift E — Wide `claim_status` enum.** 23 values, including both the legacy 4-stage and the new 5-stage labels. Any code that does an exhaustive `switch` on `claim_status` will be incomplete. Consider a code audit + a migration that retires `under_consultant_review`, `returned_by_consultant`, `under_admin_review`, `returned_by_admin` once the data is fully migrated.

## 7. Key risks (ranked)

1. **Outstanding-invoices billing alert** — service disruption risk, completely outside the codebase. Confirm payment status with whoever owns the Anthropic-org-style billing.
2. **Real-looking secrets in `.env.local.example`** — both committed (the `SUPABASE_SERVICE_ROLE_KEY=ضع_هنا_service_role_key` placeholder is harmless, but `NEXT_PUBLIC_SUPABASE_URL=https://ngwxlockzkjpmzuvgakx.supabase.co` exposes the production project ref) and uncommitted (working-tree edits add real publishable + service-role keys). See `platform_safety_findings.md`.
3. **Migration drift 049** — production claim-creation RPC missing the item_no cast fix; risk depends on how the front-end now serializes BOQ items.
4. **`final_approver` enum drift** — silent runtime errors in role-aware UI surfaces.
5. **30 unpushed local commits** — single-machine bus-factor; if this laptop dies, the CMH_01 data-import scaffolding is lost.
6. **Heavy SLA breach load** — 8 SLA-breached claims, 6 critical / 10 high-priority items per dashboard alert. Operational, not technical, but worth flagging to the director.
7. **Wide `claim_status` enum** — code paths that don't handle all 23 values.

## 8. Low-effort improvement roadmap

(Full prioritized backlog in `low_effort_improvement_backlog.md`.)

- **Immediate safety:** rotate the leaked `SUPABASE_SERVICE_ROLE_KEY`; replace `.env.local.example` body with placeholders; revert uncommitted edits to it; add `.env.local.example` to a CI secret-scanner to prevent reintroduction.
- **UX:** suppress the `gotrue-js` lock warning by aligning with `@supabase/ssr` recommended cookie-based session model (or just disable React Strict Mode in production) → cleaner console and fewer false alarms during incident triage.
- **Workflow reliability:** apply Migration 049 to production; audit role-aware UI for `final_approver` drift; add a TS exhaustiveness check on `claim_status`.
- **Reporting:** the dashboard already has rich KPI cards but the SLA-breach drill-down isn't easy from the home page; one click target on "8 SLA breaches" → `/claims?status=overdue` would help.
- **Tech debt:** copy migration 045 into `convera-platform/SQL/migrations/`; add a brief `SQL/migrations/README.md` explaining the 040+ scoping; clean up `data-imports/CMH_01/08_migration/_chunks_*` and `_runtime_b64/` working artifacts; commit or delete the IAM RBAC stabilization audit reports in `logs/`.
- **Staging/testing:** finish the CMH_01 staging schema apply (currently blocked at section 09 by a `''::uuid` source defect — fix migrations/010_user_contracts.sql).

## 9. Recommended next 5 actions (in this exact order)

1. **(today)** Resolve the outstanding-invoices billing notice with whoever owns the Supabase Pro account. Without this, every other fix is moot.
2. **(today)** Rotate `SUPABASE_SERVICE_ROLE_KEY` in Supabase, replace the value in `.env.local.example` with a placeholder string, and discard the uncommitted working-tree edits that introduce new real-looking keys. (Do this manually — don't `git add` the modified file.)
3. **(this week)** Push the 30 unpushed commits on `main` to `origin/main` after a quick review. Single-machine state is a bus-factor risk.
4. **(this week)** Apply Migration 049 to production through Studio (single-file, idempotent). Then apply it to the staging environment too.
5. **(this week)** Audit TypeScript/UI surfaces for `final_approver` references against `user_role` (should be `contract_role`); fix any mismatches.

## 10. What was NOT inspected

- Vercel build dashboard (env-variable parity, recent deploy diff, build-log errors).
- Supabase RLS policies in detail (only confirmed RLS is enabled by table count and role inventory; per-policy review not done).
- TypeScript typecheck (`npx tsc --noEmit`) — not run.
- Production performance / response-time metrics.
- Supabase Storage bucket inventory and per-bucket size.
- Edge functions or any Supabase-hosted serverless code (none observed in dashboard).
- The 122 saved Studio SQL queries — only their titles were observed.
- `/claims/new`, `/workflow`, `/reports`, `/الأداء التنفيذي`, and 4 other pages (would have required form/action interactions).
- Authentication flows other than the existing session.
- API route inventory (no `app/api/` listing performed).

## 11. Confirmation: scope discipline

- ✅ No production data was mutated. All Supabase queries were `SELECT` / metadata only.
- ✅ No CMH_01 import, Phase 8 driver, or staging schema bundle was executed.
- ✅ No git push was performed.
- ✅ No secret values were echoed in chat output (the `.env.local.example` redacted finding was described, not quoted).
- ✅ No forms submitted on the live site.

---

*See companion documents `low_effort_improvement_backlog.md` and `platform_safety_findings.md` for the full prioritized backlog and the detailed security/safety remediation plan.*
