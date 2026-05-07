# Staging Schema Bundle v2 — Build & Validation Report

> Authored 2026-05-07. Records the v2 bundle rebuild after the operator approved Path B (use 010_production_schema.sql as the consolidated foundation, skip the redundant pre-010 chain).

---

## 1. Why sections 1, 3, 4, 9 were skipped

| Skipped section | File | Reason |
|---|---|---|
| #1 | `001_base_schema.sql` | Defines the same 6 enum types (`user_role`, `contract_status`, `contract_type`, `claim_status`, `document_type`, `notification_type`) and 11 tables (`profiles`, `contracts`, `claims`, `claim_boq_items`, `claim_staff_items`, `claim_workflow`, `documents`, `audit_logs`, `notifications`, `kpi_snapshots`, `contract_amendments`) that 010 also creates. Conflict-fatal: 010 uses unconditional `CREATE TYPE/TABLE` (no `IF NOT EXISTS`). |
| #3 | `003_change_orders_and_hardening.sql` | 010 already creates `change_order_status` enum + `change_orders`, `change_order_boq_items`, `change_order_workflow` tables. Section 3 redoes those with unconditional CREATEs → conflict-fatal. The only piece 010 misses (`change_order_staff_items`) is replayed as a synthetic patch (see §3). |
| #4 | `004_contract_templates_and_progress_models.sql` | Redundant — 010 already creates both `contract_boq_templates` and `contract_staff_templates`. |
| #9 (orig) — file 009 | `009_rename_claim_statuses.sql` | Redundant — 010's `claim_status` enum already uses the renamed values; the rename script becomes a no-op. |

Two production-only data fixes (`015_fix_contract_231001101771_templates.sql` and `018_revert_staff_grade3_rows.sql`) remain skipped from v1 — they are intentionally not applied to staging.

**Total skipped:** 6 sections (4 newly skipped + 2 carried over from v1).

## 2. Why section 9 (010_production_schema.sql) is now the foundation

- File header explicitly self-describes as `v2.0 (Production-Grade with Full RLS, Triggers, and Audit Trail)` `Generated: 2026-03-19` — i.e., it is a *consolidated snapshot* dated *after* 001–009.
- It creates 11 enums + 17 tables (more than 001's 7+11) and is the only section that defines the change_order tables, contract_boq_templates, contract_staff_templates, change_orders, change_order_boq_items, change_order_workflow, generated_certificates.
- Sections 011–035 (legacy) and 040+ (current) all reference table names that 010 introduces (`contract_boq_templates`, `contract_assignments`, `change_orders`, etc.) — proving they were authored against the 010 schema.
- Production also runs on the 010-derived schema (per the legacy migrations folder timeline).

## 3. Synthetic patch — change_order_staff_items

A small surgical extraction from legacy 003 — only the table 010 doesn't create plus its index + RLS policies. Inline in the bundle as STEP 2 (right after the 010 foundation). Source-of-truth: `legacy/CONVERA/SQL/migrations/003_change_orders_and_hardening.sql` (B3 section). Uses `CREATE TABLE IF NOT EXISTS` for idempotency. Necessary because section 026 (RLS for contract-scoped roles) references `change_order_staff_items`.

## 4. Duplicate objects avoided (had v1 been applied as-is)

| Object class | v1 conflict count | v2 conflict count |
|---|---|---|
| Enum types in both 001 and 010 | 6 (user_role, contract_status, contract_type, claim_status, document_type, notification_type) | 0 |
| Tables in both 001 and 010 | 10 (profiles, contracts, claims, claim_boq_items, claim_staff_items, claim_workflow, documents, audit_logs, notifications, kpi_snapshots) | 0 |
| Enum types in both 003 and 010 | 1 (change_order_status) | 0 |
| Tables in both 003 and 010 | 3 (change_orders, change_order_boq_items, change_order_workflow) | 0 |
| Tables in both 004 and 010 | 2 (contract_boq_templates, contract_staff_templates) | 0 |
| **Total avoided conflicts** | **22** | **0** |

## 5. Scan of sections 10+ for similar conflicts

`grep -E '^CREATE (TYPE|TABLE)'` audit on every kept section:

- All `CREATE TABLE` statements in sections 10+ use `CREATE TABLE IF NOT EXISTS` (safe). No additional skips needed.
- No `CREATE TYPE` statements in any section 10+ (enum extensions use `ALTER TYPE … ADD VALUE`, which is idempotent).
- Sections 11–035 contain only `ALTER TABLE`, `CREATE POLICY`, `CREATE INDEX IF NOT EXISTS`, `CREATE FUNCTION`, etc. — all additive.
- Sections 040–050 use `CREATE TABLE IF NOT EXISTS` everywhere.

**Conclusion:** v2's skip list is complete; no other sections need to be skipped or reordered.

## 6. Updated section map

Numbering changed because v2 reorders the bundle. STEP numbers below correspond to the order in which sections are applied; SOURCE refers to the original file.

```
STEP  KIND        SEQ       SOURCE
────  ──────────  ────────  ─────────────────────────────────────────────────
0     PREFLIGHT   guard     bundle lines 36–46 (DO $$ … END $$;)
1     MIGRATION   foundation legacy/SQL/migrations/010_production_schema.sql
2     PATCH       synthetic  change_order_staff_items + RLS (extract from 003)
3     MIGRATION   002        legacy/SQL/migrations/002_step0_fixes.sql
4     MIGRATION   006        legacy/SQL/migrations/006_convera_users_otp.sql
5     MIGRATION   007        legacy/SQL/migrations/007_contract_amendments_enhancement.sql
6     MIGRATION   008        legacy/SQL/migrations/008_invoice_attachment_governance.sql
7     MIGRATION   010b       legacy/SQL/migrations/010_user_contracts.sql
8–11  MIGRATION   011, 012, 013, 014   legacy/...
      (skipped: 015 production-only)
12–13 MIGRATION   016, 017   legacy/...
      (skipped: 018 production-only)
14–25 MIGRATION   019–031b, 033, 034, 035   legacy/...
26    MIGRATION   040        current/SQL/migrations/040_flexible_approvers_and_import.sql
27    MIGRATION   041        current/SQL/migrations/041_final_approver_role.sql
28    MIGRATION   042        legacy (full version)
29    MIGRATION   043        legacy (SAFE variant)
30    MIGRATION   044        current
31    MIGRATION   045        legacy (3-tuple invariant)
32–36 MIGRATION   046–050    current
37    SEED        s001       legacy seeds/001_seed_profiles.sql
38    SEED        s002       legacy seeds/002_seed_contracts.sql
39    SEED        s003       legacy seeds/003_seed_convera_users.sql
40    SEED        s004       legacy seeds/004_seed_supabase_auth_users.sql
41    SEED        s005       current seeds/005_seed_test_users_cmh.sql
END   FOOTER      —          bundle final divider
```

Per-step exact line ranges are available in the regenerated `staging_schema_bundle_manifest.csv` (each row carries step, sequence, source, kind, status, reason).

## 7. Updated operator execution approach

Same as v1 — only the section list and order differ. Mode B (section-by-section paste) is recommended; whole-bundle paste also works on the smaller v2 bundle (538 KB vs v1's 636 KB).

## 8. Bundle sanity checks (post-build)

| Check | Result |
|---|---|
| Total bytes | 538 928 |
| Total lines | 11 777 |
| NUL bytes anywhere | **0** |
| Other control bytes (excl tab/LF/CR) | **0** |
| BOM at start or middle | **none** |
| Production-ref `ngwxlockzkjpmzuvgakx` occurrences | 3 — all in the header guard, none in source content |
| Sections covered by skip-or-include | 6 + 46 = 52 (51 original ranges + 1 synthetic patch) |
| Source files in bundle | each appears at most once |
| `verify:repo-path` | passes (post-commit) |

## 9. Verification steps

`staging_schema_verification.sql` is unchanged — its checks (tables, enums, RPCs, partial unique index, 3-tuple constraint, seed counts, CMH_01-C01 contract present) all map to objects that v2 still creates via 010 + the additive sections + sections 040–050.

## 10. Is the bundle safe to apply on clean staging?

**Yes.** The 22 duplicate-object conflicts that would have killed v1 are gone. Sections 10+ were re-audited and contain no further snapshots. The synthetic patch fills the only gap created by skipping section 3. Bundle has no NULs, no BOM, no production-ref leaks.

The remaining risk is **operational, not structural**:

- The whole-bundle paste against the SQL Editor textarea may still hit text-area truncation limits. **Mode B (section-by-section) is the recommended apply method.**
- For autonomous agent application, the same tool-I/O scale issue from v1 still applies. The agent can apply STEP 0 (pre-flight) and STEP 1 (010 foundation) reliably, but completing all 41 STEPs autonomously remains constrained by per-call payload limits.

The recommended path: operator pastes section-by-section using the manifest. After all sections succeed, run the verification SQL.
