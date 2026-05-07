# CMH_01 Staging Schema — Execution Report (BLOCKED at bundle defect)

> Authored 2026-05-07. **Updates and supersedes the earlier version of this report (commit `b8fe413`)** with the findings of the latest agent autonomous apply attempt against CONVERA-STAGING.

---

## Summary

| Item | Value |
|---|---|
| Target project ref | `jrqkzwacerdudmeacvar` (CONVERA-STAGING) |
| Forbidden production ref | `ngwxlockzkjpmzuvgakx` — never used |
| Execution method attempted | Browser-driven UI Run automation via Cowork Chrome MCP |
| Pre-check result | **public_table_count = 0** — staging confirmed clean |
| Pre-flight guard | **PASS** — `Success. No rows returned` |
| Bundle commit applied from | `cbfd660` (NUL-fix patch) |
| **Sections 1–51 applied** | **NO — stopped before section 1** |
| **Reason** | **Bundle defect identified**: sections 1 and 9 are redundant schema definitions; applying both in sequence will error |
| Staging schema state after this turn | **Unchanged from clean (0 public tables)** |
| Production touched | No |
| CMH_01 data import run | No |
| Push performed | No |

---

## 1. Target verification (3 channels)

1. URL: `https://supabase.com/dashboard/project/jrqkzwacerdudmeacvar/...` ✓
2. Tab title: `... | CONVERA-STAGING | MOMAH | Supabase` ✓
3. Top breadcrumb: `MOMAH PRO / CONVERA-STAGING / main PRODUCTION` ✓ (the trailing `PRODUCTION` is the per-project default-branch label, not the production project)

Production ref `ngwxlockzkjpmzuvgakx` was never on screen, never in the URL, never in any agent fetch.

---

## 2. Pre-check result (operator-supplied earlier this session)

```
public_table_count       = 0
has_profiles             = false
has_contracts            = false
has_claims               = false
has_user_contracts       = false
has_user_contract_roles  = false
has_contract_approvers   = false
has_claim_workflow       = false
has_audit_logs           = false
has_user_role_enum       = false
has_claim_status_enum    = false
has_final_approver_role  = false
has_under_quality_review = false
has_atomic_create_rpc    = false
```

Clean slate. Apply must start from section 1 (or whichever section is chosen as base — see §4).

---

## 3. Pre-flight guard (re-run this turn)

```
DO $$ DECLARE prod_marker TEXT := 'ngwxlockzkjpmzuvgakx'; ... END $$;
-> Success. No rows returned
```

Confirms again: staging Supabase project is **not** the production project ref.

---

## 4. Bundle defect found — sections 1 and 9 overlap

### Evidence

`legacy/CONVERA/SQL/migrations/001_base_schema.sql` (45 KB, March 16) creates these TYPES and TABLES (subset shown):

```
CREATE TYPE user_role AS ENUM ( … );
CREATE TYPE contract_status AS ENUM ( … );
CREATE TYPE contract_type AS ENUM ( … );
CREATE TYPE claim_status AS ENUM ( … );
CREATE TYPE document_type AS ENUM ( … );
CREATE TYPE notification_type AS ENUM ( … );
CREATE TABLE profiles ( … );
CREATE TABLE contracts ( … );
CREATE TABLE claims ( … );
CREATE TABLE claim_boq_items ( … );
CREATE TABLE claim_staff_items ( … );
CREATE TABLE claim_workflow ( … );
CREATE TABLE documents ( … );
CREATE TABLE audit_logs ( … );
CREATE TABLE notifications ( … );
CREATE TABLE kpi_snapshots ( … );
… plus contract_amendments, audit_action enum
```

`legacy/CONVERA/SQL/migrations/010_production_schema.sql` (45 KB, March 19) header says:

> -- CONVERA — Production PostgreSQL Schema
> -- Generated: 2026-03-19
> -- Version: 2.0 (Production-Grade with Full RLS, Triggers, and Audit Trail)

…and creates the **same** types and tables, **plus** several new ones (`boq_progress_model`, `claim_type`, `change_order_*`, `certificate_type`, `contract_assignments`, `contract_boq_templates`, `contract_staff_templates`, `change_orders`, `change_order_boq_items`, `change_order_workflow`, `generated_certificates`):

```
CREATE TYPE user_role AS ENUM ( … );          ← same name as 001
CREATE TYPE contract_status AS ENUM ( … );    ← same name as 001
CREATE TABLE profiles ( … );                   ← same name as 001
CREATE TABLE claims ( … );                     ← same name as 001
… etc.
```

Of all `CREATE …` statements in `010_production_schema.sql`, only **2** use `IF NOT EXISTS` (both extensions). All TYPE/TABLE creations are unconditional.

### Implication

If section 1 is applied first, all the shared TYPE/TABLE definitions exist. When section 9 runs, the very first conflicting `CREATE TYPE user_role …` (or `CREATE TABLE profiles …`) errors with PostgreSQL code `42710` `type "user_role" already exists` (or `42P07` `relation "profiles" already exists`) — and the multi-statement query fails there.

### What this likely means for the operator's earlier failure

The operator reported `ERROR 42601 syntax error at or near "CR" LINE 3075`. PG error code `42601` is `syntax_error`, not `42710`/`42P07`. So the duplicate-object hypothesis doesn't directly match the error code. **However**:

- If the operator's paste was via the SQL Editor textarea and the textarea truncated mid-`CREATE`, the parser would see `CR` (or another partial token) and emit `42601`. That's the original explanation.
- It's also possible the operator's recall of the error code was approximate; the actual operator-side error message may have included both `42601` (for one statement) and `42710` (for a later statement) in successive runs.

**Either way, the redundancy issue is real and needs to be fixed before re-apply, regardless of what triggered the first run's failure.**

---

## 5. Recommended bundle revision

Two viable paths. **Path B is recommended.**

### Path A — Use 001 as foundation (skip 010_production_schema.sql)

- Keep sections 1–8 (legacy 001–009) as the foundation.
- **Skip section 9** (`010_production_schema.sql`). This loses the v2.0 schema additions (`change_orders`, `contract_boq_templates`, etc. that 010 introduces).
- Continue with section 10 (`010_user_contracts.sql`) onward.

**Risk:** Sections 11–35 may have been authored *against* the 010 v2.0 schema. They may reference tables (like `contract_boq_templates`) that 001 doesn't create. In that case, this path will fail later in the chain.

### Path B — Use 010_production_schema.sql as foundation (skip sections 1–8) ✅ RECOMMENDED

- **Skip sections 1–8** (legacy 001–009). The v2.0 snapshot in 010 already represents the consolidated schema after those evolutions.
- **Apply section 9** (`010_production_schema.sql`) as the base.
- Continue with section 10 onward (`010_user_contracts.sql` — additive, safe).

**Why this is safer:**
- Section 9 declares itself a v2.0 production-grade snapshot dated *after* 001–009 — it explicitly supersedes them.
- Sections 11–35 were authored on top of (or alongside) the 010 v2.0 schema, so they reference the table names 010 introduces (`contract_boq_templates`, `contract_assignments`, `change_orders`, etc.).
- Migration `040+` is current-repo work that already assumes the 010 v2.0 schema.

### Bundle action

Mark sections 1, 2, 3, 4, 5 (006), 6 (007), 7 (008), 8 (009) — i.e., the legacy `001`–`009` chain — as **SKIPPED** in a new bundle revision. The bundle assembly script will need a small update to support this; the manifest CSV will be regenerated.

**The agent should NOT make this change without operator approval** because it materially changes the schema-application strategy and could affect post-Phase-8 compatibility with production (which is *also* on the same 010-derived schema, per the legacy migrations folder timeline). The operator should confirm:

1. Path B is acceptable.
2. Whether the agent should regenerate the bundle, or whether the operator wants to apply manually skipping sections 1–8.

---

## 6. Why this turn did NOT autonomously apply sections 1–51

Two compounding reasons:

1. **Bundle defect (now visible):** even if the agent had successfully driven UI Run for sections 1, 2, 3, … the apply would have failed at section 9 with a duplicate-object error. Driving 8 sections to a guaranteed failure would have wasted ~30 tool calls and left the staging schema partially populated.
2. **Tool I/O scale:** 49 SQL sections × 2–3 round-trips per section = ~100–200+ tool calls. Each section's SQL must be embedded in a `javascript_tool` call (UI `setValue` requires the SQL in the JS payload). Cumulative tool input size for the full 600 KB bundle exceeds practical context budgets in a single agent session, and per-section bash output limits force chunking for the 4 largest sections.

Both constraints are real, but the bundle defect is the proximate blocker. Fixing it would still leave the I/O-scale challenge — but with a smaller bundle (sections 1–8 stripped saves ~75 KB), and with confidence that what remains will run cleanly.

---

## 7. Verification status

Verification SQL (`staging_schema_verification.sql`) was **not run** because the schema was not applied. Runnin