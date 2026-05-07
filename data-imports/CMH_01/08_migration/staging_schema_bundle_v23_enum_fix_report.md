# Bundle v2.4 — Enum Transaction-Safety Fix

> Authored 2026-05-07. Records the fix for the two enum-related errors the operator hit while applying v2.3's STEP 8 (`009_rename_claim_statuses.sql`): `55P04: unsafe use of new value` and `22P02: invalid input value for enum change_order_status: "under_consultant_review"`.

---

## 1. Failed section

| Field | Value |
|---|---|
| Bundle version | v2.3 (commit `fe05a19`) |
| Failing STEP | **STEP 8 — seq `009`** (`legacy/SQL/migrations/009_rename_claim_statuses.sql`) |
| First error reported | `ERROR: 55P04: unsafe use of new value "under_supervisor_review" of enum type claim_status` |
| Second error (after Run-restart) | `ERROR: 22P02: invalid input value for enum change_order_status: "under_consultant_review"` at LINE 77 of the section |

## 2. Root cause

Section 009's design assumed each statement runs in its own implicit transaction. That assumption is wrong for the Supabase SQL Editor — a Run-button submission is wrapped in **one transaction**. Two PG safety rules then bite:

### Rule A — `55P04` (unsafe use of new enum value in same transaction)

PostgreSQL forbids using a freshly-added enum value in the same transaction it was added. Section 009 does:

```sql
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' …;
…
UPDATE claims SET status = 'under_supervisor_review' WHERE status = 'under_consultant_review';
```

Inside a single transaction, this is exactly the case PG refuses with `55P04`.

### Rule B — `22P02` (invalid input value for enum)

`change_order_status` (defined in section 003) has values `{draft, submitted, under_admin_review, pending_director_approval, approved, rejected}`. Section 009's UPDATE statement compares it against a value `change_order_status` never had:

```sql
UPDATE change_orders SET status = 'under_supervisor_review'
  WHERE status = 'under_consultant_review';   -- ← not in change_order_status
```

Even with zero rows in `change_orders` on fresh staging, PG validates the right-hand-side enum literal at parse time → `22P02`.

## 3. Exact unsafe SQL — before / after

### Before (section 009 verbatim from legacy)

```sql
-- Step 1: ADD enum values (claim_status)
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
… (4 more ADD VALUE)

-- Step 2: UPDATE claims using new value (55P04 in same transaction)
UPDATE claims SET status = 'under_supervisor_review' WHERE status = 'under_consultant_review';
… (3 more UPDATEs)

-- Step 3: UPDATE claim_workflow (same 55P04 pattern)
…

-- Step 4: ADD enum values (change_order_status) + UPDATE (55P04 + 22P02)
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
…
UPDATE change_orders SET status = 'under_supervisor_review' WHERE status = 'under_consultant_review';   -- 22P02 here
UPDATE change_orders SET status = 'under_auditor_review'    WHERE status = 'under_admin_review';        -- safe label-wise but still 55P04
```

### After (bundle-patched STEP 8 — enum-only)

```sql
-- ALTER TYPE ADD VALUE statements only — no UPDATEs.
-- On fresh staging there are no claims/claim_workflow/change_orders rows
-- yet, so the legacy data UPDATEs would be no-ops — but they trigger
-- 55P04 + 22P02 errors anyway. Stripped from the staging bundle.

ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_supervisor'  AFTER 'under_supervisor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'returned_by_supervisor';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_auditor'     AFTER 'under_auditor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'returned_by_auditor';

ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'under_supervisor_review';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'under_auditor_review';
```

## 4. How enum-add and data-update steps are split

Strictly speaking we don't *split* the migration — we *strip* the data UPDATEs entirely:

| Step | Original 009 | Patched STEP 8 |
|---|---|---|
| ADD VALUE on `claim_status` | yes | **yes** |
| ADD VALUE on `change_order_status` | yes | **yes** |
| UPDATE `claims` | yes | **stripped (no rows on fresh staging)** |
| UPDATE `claim_workflow` | yes | **stripped (no rows on fresh staging)** |
| UPDATE `change_orders` | yes (also stale labels) | **stripped (no rows on fresh staging + invalid enum literals)** |

The legacy source file is **not** modified — production already ran the full migration months ago against real data; modifying it would not help that history. Only the bundle's representation of section 009 is patched.

## 5. Sections 045 and 046 — re-audited

The earlier scan flagged 045 (`project_manager` use) and 046 (7 new claim_status values used) as "risky." A bracket-aware re-scan that excludes `pg_enum`-lookup contexts found:

- **045**: 0 actual same-transaction uses. The `project_manager` references after the ADD VALUE are inside `WHERE t.typname = 'contract_role' AND e.enumlabel = 'project_manager'` lookups — string comparisons against `pg_enum.enumlabel`, no enum cast.
- **046**: 0 actual same-transaction uses. Every reference to a new value after ADD VALUE is inside a `pg_enum`-lookup IF-NOT-EXISTS guard.

Both sections are safe as-is. Only 009 needed patching.

## 6. Whole-bundle scan after fix

| Pattern | Result |
|---|---|
| `CONSTRAINT name AS (` in actual SQL | 0 |
| `GENERATED ALWAYS AS (…)` containing `SELECT` (bracket-aware) | 0 |
| `UPDATE change_orders` referencing legacy claim_status labels (`under_consultant_review`, `returned_by_consultant`, `under_admin_review`, `returned_by_admin`) | **0** (was 4 in v2.3 → removed in v2.4) |
| `ALTER TYPE … ADD VALUE` followed by SAME-transaction enum cast in UPDATE/INSERT | **0** in code (the in-comment occurrences explaining the patch don't execute) |
| NUL bytes / control bytes / BOM | 0 / 0 / none |
| Production-ref leaks outside header guard | 0 |

## 7. Whether current staging must be reset

**Almost certainly clean — no reset needed.** v2.3's STEP 8 failure rolled back the entire submission (single-transaction semantics). The enum values that section 009 added (`under_supervisor_review`, etc.) are also rolled back. Confirm before continuing:

```sql
SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
-- Expected: 0 (the prior 7 STEPs that DID succeed — STEP 1 through STEP 7 — were
-- in their own Run submissions and should have committed; their tables WILL show
-- here. Treat values >0 as evidence of partial success, not corruption.)
```

Wait — re-read: STEPs 1–7 ran cleanly in their own submissions (each Run is one transaction). They committed. So `public_table_count` will be **non-zero** (likely 25+ tables already present from STEPs 1–7).

**Decision tree:**

| Pre-check returns | Recommended action |
|---|---|
| 25+ tables, no errors visible in editor | Sections 1–7 already applied. **Resume from STEP 8** (paste the patched 009 from v2.4). Do NOT re-paste 1–7 — the unsafe `CREATE TABLE` statements without `IF NOT EXISTS` would fail. |
| `0` (operator did a fresh reset between submissions) | Apply v2.4 from STEP 1. |
| Unclear or partial | Run optional `DROP SCHEMA public CASCADE; CREATE SCHEMA public; …` reset (verify URL still says `jrqkzwacerdudmeacvar`) and reapply v2.4 from STEP 1. |

## 8. Exact next operator instruction

1. **Pre-check:**
   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```

2. **Pull v2.4 bundle** from the new commit on `main`.

3. Based on pre-check:

   - **If `public_table_count` ≥ 25:** STEPs 1–7 are committed. Resume by pasting **only the patched STEP 8** from the v2.4 bundle (the section labelled `STEP 8 — MIGRATION — seq=009 — [PATCHED]`). Then continue STEP 9 → STEP 48 in order. The skipped sections (010_production_schema, 015, 018) appear as comment-only blocks and emit no SQL.
   - **If `public_table_count = 0`:** Pre-flight guard alone first, then STEP 1 → STEP 48 in order.
   - **If unclear:** Reset via `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL …` (verify URL first) and apply v2.4 from STEP 1.

4. **After all STEPs succeed**, run `staging_schema_verification.sql` and paste row output.

The patched STEP 8 is now small (~10 ALTER statements) and runs cleanly as a single Run submission. Sections 045 + 046 (the other potentially-risky enum extensions) were re-audited and confirmed safe — their post-ADD-VALUE references are all `pg_enum`-lookup string comparisons, not enum casts.
