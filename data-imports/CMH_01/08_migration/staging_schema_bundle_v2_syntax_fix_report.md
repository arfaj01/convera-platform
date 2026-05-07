# Bundle v2 Syntax Fix Report — `CONSTRAINT … AS (` typo

> Authored 2026-05-07. Documents the fix for `ERROR: 42601: syntax error at or near "AS"` reported by the operator's first apply attempt of bundle v2.

---

## 1. Root cause

`legacy/CONVERA/SQL/migrations/010_production_schema.sql` contained two invalid PostgreSQL constraint clauses:

| Source line | Original (invalid) | Patched (valid PostgreSQL) |
|---|---|---|
| 144 | `CONSTRAINT email_normalized AS (email = LOWER(TRIM(email))),` | `CONSTRAINT email_normalized CHECK (email = LOWER(TRIM(email))),` |
| 559 | `CONSTRAINT audit_logs_insert_only AS (true)` | `CONSTRAINT audit_logs_insert_only CHECK (true)` |

`CONSTRAINT name AS (expression)` is **not valid PostgreSQL syntax** in any context. Inside a `CREATE TABLE`, named constraints must be declared as `CONSTRAINT name <type> (…)` where `<type>` is `CHECK`, `UNIQUE`, `PRIMARY KEY`, `FOREIGN KEY`, or `EXCLUDE`. The author intended `CHECK` constraints; `AS` was a typo.

Both clauses survived in the legacy file because the schema was almost certainly *also* never applied to a fresh empty database from this file alone (production was likely seeded incrementally from 001–009 + later migrations, never replaying 010). Staging was the first environment to attempt running 010 cleanly from scratch — and surfaced the latent typo.

The second clause `CHECK (true)` is a tautology (always satisfied) — the original intent was likely to declare an "insert-only" marker, but a CHECK constraint cannot enforce that. The fix preserves the original intent at the syntax level; semantic insert-only enforcement (if needed) would have to come from a trigger or RLS, which sections 011+ already provide.

## 2. Affected file

- **Source migration (host filesystem):** `legacy/CONVERA/SQL/migrations/010_production_schema.sql` — patched in place per operator's directive ("patch the source migration too, not only the bundle, so future bundle rebuilds do not reintroduce it"). This is a **deliberate exception** to the standing read-only rule on the `CONVERA/` folder, narrowly scoped to a 2-character syntactic fix.
- **Bundle:** `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` — fully regenerated from the patched source. Now v2.1.

## 3. Affected bundle line

The operator-reported `LINE 231: CONSTRAINT email_normalized AS (...)` corresponds to the v2 bundle's profiles-table definition inside STEP 1. After the patch the same line reads `CONSTRAINT email_normalized CHECK (...)`.

## 4. Exact SQL before / after

```sql
--  Profiles table — line 144 of source / ~line 231 of bundle
-- BEFORE:
  CONSTRAINT email_normalized AS (email = LOWER(TRIM(email))),
  CONSTRAINT phone_format CHECK (phone ~ '^\+?[0-9\-\s]+$' OR phone IS NULL)

-- AFTER:
  CONSTRAINT email_normalized CHECK (email = LOWER(TRIM(email))),
  CONSTRAINT phone_format CHECK (phone ~ '^\+?[0-9\-\s]+$' OR phone IS NULL)
```

```sql
--  Audit logs table — line 559 of source
-- BEFORE:
  CONSTRAINT audit_logs_insert_only AS (true)

-- AFTER:
  CONSTRAINT audit_logs_insert_only CHECK (true)
```

## 5. Whether the failed attempt mutated staging

**Almost certainly rolled back to a clean slate.** Reasoning:

- The Supabase SQL Editor runs each Run-button submission as a single PostgreSQL transaction. A syntax error inside a `CREATE TABLE` aborts the whole submission, and PG rolls back any preceding statements within that submission.
- If the operator pasted only STEP 1 (the foundation), the rollback wipes any extensions / types / tables created earlier in STEP 1's text. Net change to staging: **zero**.
- If the operator pasted multiple STEPs together (or the whole bundle), the same single-transaction rollback applies. Net change: **zero**.
- The earlier pre-flight DO block ran cleanly on its own (a separate submission) — it made no database changes; it's an `EXCEPTION`-or-no-op guard. So the pre-flight's effect was zero by design.

The operator can verify by re-running the same pre-check query that confirmed clean staging earlier:

```sql
SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
-- Expected: 0
```

If the result is still `0`, no reset is needed. If for some reason rows or tables exist, a clean reset is recommended:

```sql
-- ⚠ DESTRUCTIVE — verify URL still says jrqkzwacerdudmeacvar before running.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
```

## 6. Whether operator can rerun the full v2 bundle or must reset first

| Pre-check `public_table_count` | Action |
|---|---|
| `0` | **Re-run the patched v2.1 bundle directly.** No reset needed. |
| `> 0` | **Reset first**, then re-run. The optional `DROP SCHEMA public CASCADE` snippet above does the reset. |

In all cases, the agent recommends running the pre-check first as a safety verification.

## 7. Whole-bundle scan — no other invalid patterns

Patterns specifically searched for:

| Pattern | Result |
|---|---|
| `CONSTRAINT … AS (` (in actual SQL, not header comment) | **0 in any source migration** (was 2 in 010_production_schema, now patched) |
| Malformed generated columns | None found |
| Table constraints using `AS` instead of `CHECK` / `UNIQUE` / `PRIMARY KEY` / `FOREIGN KEY` / `EXCLUDE` | None found |
| NUL bytes anywhere | 0 |
| Other control bytes (excl tab/LF/CR) | 0 |
| BOM at file start or middle | none |

The single remaining `CONSTRAINT name AS (expr)` substring in the bundle file is **inside the v2.1 header comment block** (a `-- ` line that documents the fix). PostgreSQL ignores it; no execution risk.

## 8. Bundle v2.1 sanity

| Check | Value |
|---|---|
| Bytes | 537 162 |
| Lines | 11 745 |
| NUL bytes | 0 |
| Control bytes (excl tab/LF/CR) | 0 |
| `verify:repo-path` | passes |
| Section count | 6 SKIPPED + 46 applied (unchanged from v2) |
| Skip list | unchanged from v2 |
| Apply order | unchanged from v2 |
| Section line ranges | shifted by ≤ 2 lines downstream of the patch (header comment grew by 2 lines documenting v2.1) |

## 9. Next exact operator instruction

1. **Verify staging is still clean:**
   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```
   Expected: `0`. If non-zero, run the `DROP SCHEMA public CASCADE; CREATE SCHEMA public; …` reset snippet from §5.

2. **Pull the patched bundle** from the new commit on `main` (SHA in the next commit message).

3. **Re-apply the bundle** using the same Mode B section-by-section approach you used before:
   - Start with the pre-flight guard (lines 36–46).
   - Then STEP 1 (010_production_schema, now with `CHECK` instead of `AS`).
   - Continue STEP 2 → STEP 41 in order.
   - On any error, capture and report.

4. **After success, run** `staging_schema_verification.sql`. Reply with the row output.

The patched `email_normalized` constraint is mathematically vacuous when applied to fresh data (because seeds will use already-normalized emails), and the `audit_logs_insert_only CHECK (true)` is a no-op. Both are safe additions that will not interfere with seed inserts or future application writes.
