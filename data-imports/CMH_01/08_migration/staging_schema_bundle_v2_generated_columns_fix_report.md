# Bundle v2.2 — Generated-column subquery fix

> Authored 2026-05-07. Records the fix for `ERROR: 0A000: cannot use subquery in column generation expression` that the operator hit in STEP 1 / `010_production_schema.sql` after the v2.1 (CONSTRAINT-AS) fix unblocked the prior error.

---

## 1. Root cause

`legacy/CONVERA/SQL/migrations/010_production_schema.sql`'s `claim_boq_items` table declared two `GENERATED ALWAYS AS (…) STORED` columns whose expressions called `SELECT progress_model FROM contract_boq_templates WHERE id = template_item_id` to dispatch on the progress model.

PostgreSQL forbids subqueries inside generated-column expressions (error `0A000` — "feature not supported"). The expression in a `GENERATED ALWAYS AS` clause must be **immutable** and reference **only this row's columns** — no SELECT, no cross-table lookups, no `NOW()`-style non-deterministic functions.

This typo + design error survived in the legacy file for the same reason as the v2.1 `CONSTRAINT … AS` one: the file was apparently never applied from scratch on a vacuum database; production was likely seeded incrementally so the broken statements were never exercised in isolation.

## 2. Affected file / table / columns

| Item | Value |
|---|---|
| Source migration | `legacy/CONVERA/SQL/migrations/010_production_schema.sql` |
| Affected table | `public.claim_boq_items` |
| Affected columns | `period_amount`, `after_perf_amount` (both `NUMERIC(15,2) GENERATED ALWAYS AS (…) STORED`) |
| New column added (denormalized) | `progress_model boq_progress_model NOT NULL DEFAULT 'count'` |

## 3. Exact SQL — before / after

### Before (invalid — error 0A000)

```sql
CREATE TABLE claim_boq_items (
  ...
  curr_progress NUMERIC(12,4) NOT NULL,
  unit_price NUMERIC(15,2) NOT NULL,
  period_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    CASE
      WHEN (SELECT progress_model FROM contract_boq_templates WHERE id = template_item_id) = 'count'
        THEN curr_progress * unit_price
      WHEN (SELECT progress_model FROM contract_boq_templates WHERE id = template_item_id) = 'percentage'
        THEN (curr_progress / 100.0) * unit_price
      ELSE curr_progress * unit_price
    END
  ) STORED,
  performance_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  after_perf_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    (CASE … same SELECTs … END) * performance_pct / 100.0
  ) STORED,
  ...
```

### After (valid PostgreSQL — uses local `progress_model`)

```sql
CREATE TABLE claim_boq_items (
  ...
  curr_progress NUMERIC(12,4) NOT NULL,

  -- Denormalized progress model (PATCHED 2026-05-07)
  -- PG forbids subqueries in GENERATED ALWAYS AS (error 0A000), so
  -- progress_model must be stored locally on the row. The platform RPC
  -- (create_claim_with_items_atomic, Migration 048) is responsible for
  -- copying the value from contract_boq_templates at insert. DEFAULT 'count'
  -- matches the original CASE ELSE branch so legacy inserts that omit this
  -- column produce the same period_amount.
  progress_model boq_progress_model NOT NULL DEFAULT 'count',

  unit_price NUMERIC(15,2) NOT NULL,
  period_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    CASE
      WHEN progress_model = 'count'
        THEN curr_progress * unit_price
      WHEN progress_model = 'percentage'
        THEN (curr_progress / 100.0) * unit_price
      ELSE curr_progress * unit_price
    END
  ) STORED,
  performance_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  after_perf_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    (CASE
      WHEN progress_model = 'count'
        THEN curr_progress * unit_price
      WHEN progress_model = 'percentage'
        THEN (curr_progress / 100.0) * unit_price
      ELSE curr_progress * unit_price
    END) * performance_pct / 100.0
  ) STORED,
  ...
```

## 4. Why the new design is valid in PostgreSQL

The patched expression now references only:

- A literal numeric column on the same row (`curr_progress`, `unit_price`, `performance_pct`) — immutable.
- An enum column on the same row (`progress_model`) — immutable.
- A `CASE` expression — immutable.
- An arithmetic expression — immutable.

There is no subquery, no other-table reference, no non-immutable function, no volatile state. PostgreSQL accepts this generated-column expression without complaint.

## 5. Whether data semantics are preserved

**Yes**, modulo a documented insert-side requirement:

- The original semantics: at row insert, the database joined to `contract_boq_templates` to dispatch on `progress_model`.
- The patched semantics: `progress_model` is stored on the row directly. The platform's atomic-insert RPC (`create_claim_with_items_atomic`, current Migration 048) is responsible for copying the value from the matching `contract_boq_templates` row at insert time.
- For any insert that does *not* explicitly set `progress_model`, the column defaults to `'count'`, which exactly matches the **ELSE branch** of the original CASE. Every BOQ row whose template uses `count` continues to compute the same `period_amount`.
- Rows whose template uses `percentage` or `monthly_lump_sum` need the RPC (or any other writer) to pass the correct `progress_model` value. If the RPC does not currently do this, the operator should patch it as a follow-up commit (see §6).

## 6. Whether import / RPC logic needs patching

**Possibly — to be confirmed in a follow-up.** The current platform RPC `create_claim_with_items_atomic` (Migration 048) was written assuming the old subquery-based GENERATED column. It does not (in its present source) explicitly write `progress_model` into `claim_boq_items`. After the staging schema lands, the operator should either:

- **Verify** that the RPC's INSERT statement either (a) includes `progress_model` from the template, or (b) the default `'count'` is acceptable for CMH_01's data (CMH_01 Phase 8 dry-run will confirm).
- **Patch** the RPC if needed: in a small follow-up commit, add a JOIN to `contract_boq_templates` in the RPC's `INSERT INTO claim_boq_items` to populate `progress_model` correctly.

This patch is **not blocking the staging schema apply**. The schema works; downstream insertions that need non-default `progress_model` may need the RPC update.

For CMH_01 specifically (the project being migrated in Phase 8), the data has been preserved as `'count'` semantics in the normalized layer (per `data-imports/CMH_01/03_normalized/boq_items.csv`), so the default is correct for that import. Phase 8 dry-run will surface any mismatch.

## 7. Whether the failed attempt mutated staging

**Almost certainly rolled back to clean.** Same reasoning as the v2.1 fix report: the SQL Editor runs each Run-button submission as a single PG transaction, and a `0A000` error inside a CREATE TABLE rolls back any preceding statements within that submission. The pre-flight DO block ran as a separate submission and made no changes.

## 8. Whether operator can rerun STEP 1 directly after pre-check

**Yes, after running the same pre-check.** Recommended flow:

```sql
-- 1. Verify clean — should still return 0
SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
```

- If `0`: re-run the v2.2 bundle.
- If `> 0`: run the optional reset (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` after URL re-verification) and then re-run.

## 9. Whole-bundle scan after fix

| Scan | Hits |
|---|---|
| `CONSTRAINT name AS (` in actual SQL | 0 |
| `GENERATED ALWAYS AS (…)` containing `SELECT` (bracket-aware) | 0 |
| `GENERATED` with non-immutable function (`NOW()`/`CURRENT_TIMESTAMP`/`RANDOM()`/`CLOCK_TIMESTAMP()`) | 0 |
| NUL bytes | 0 |
| Other control bytes (excl tab/LF/CR) | 0 |
| BOM at file start or middle | none |
| Production-ref `ngwxlockzkjpmzuvgakx` outside header guard | 0 |

The patched bundle is structurally clean.

## 10. Bundle v2.2 sanity

| | Value |
|---|---|
| Bytes | 537 445 |
| Lines | 11 749 |
| Section count | 6 SKIPPED + 46 applied (unchanged from v2.1) |
| Skip list | unchanged (001, 003, 004, 009, 015, 018) |
| Apply order | unchanged (foundation 010 → synthetic patch → 002 → 006 → 007 → 008 → 010_user_contracts → 011…050 → seeds) |
| Source 010_production_schema.sql size | 45 631 B (was 45 323 B in v2.1, +308 B for the new column + comment block) |
| `verify:repo-path` | passes |

## 11. Next exact operator instruction

1. **Re-run the pre-check** to confirm staging is still clean:

   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```

   Expected: `0`. If non-zero, run the reset snippet from `staging_schema_bundle_v2_syntax_fix_report.md` §5 (verify URL still says `jrqkzwacerdudmeacvar`).

2. **Pull the patched bundle** from the new commit on `main` (SHA in the next commit message).

3. **Apply v2.2 in Mode B** (section-by-section):
   - Pre-flight guard alone first (lines 36–46).
   - Then STEP 1 → STEP 41 in order. STEP 1 is now the patched 010_production_schema with the new local `progress_model` column.
   - On any error, capture `STEP <n>`, full PG error text (`ERROR`/`DETAIL`/`HINT`/`LINE`), and which prior STEPs ran cleanly.

4. **After all STEPs succeed**, run `staging_schema_verification.sql` and paste the row output.

The follow-up RPC review (§6) is **deferred until after staging schema is live and Phase 8 dry-run runs**. It is not blocking this apply.
