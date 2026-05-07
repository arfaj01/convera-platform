# Bundle v2.3 — Path A Reversal & Synthetic-Patch Removal

> Authored 2026-05-07. Records the reversal from Path B back to Path A after the operator's STEP 2 apply surfaced a `42703 column ct.external_user_id does not exist` error that exposed a deeper misreading of `010_production_schema.sql`'s role.

---

## 1. Root cause

The synthetic STEP 2 patch in v2.2 referenced `ct.external_user_id` to scope external-user policies on `change_order_staff_items`. The patched 010 foundation does not create `external_user_id` on `contracts` — it uses an entirely different access model (`director_id` + `contract_assignments` table). So the policy creation failed.

But the **deeper finding** is that this isn't a synthetic-patch bug — it's a Path B foundation mistake:

- A repo-wide grep shows **9 legacy migrations and seed 002** all reference `contracts.external_user_id` extensively: `001_base_schema.sql` (23 refs, defines the column), `002_step0_fixes.sql` (1), `003_change_orders_and_hardening.sql` (20), `004_contract_templates_and_progress_models.sql` (2), `010_user_contracts.sql` (4), `019_definitive_rls_scope_fix.sql` (7), `023_fix_contract_scoping_leaks.sql` (9), `024_drop_contracts_auth_read_backdoor.sql` (3), `025_contract_scoped_roles.sql` (4), `026_rls_contract_scoped_roles.sql` (30), `seeds/002_seed_contracts.sql` (3).
- The entire migration evolution chain (sections 001 → 035) was authored against the **001 baseline**, not the 010 v2.0 snapshot.
- `010_production_schema.sql` was a **parallel-universe rewrite** that the team apparently experimented with but never adopted; the rest of the migrations did not migrate to its `director_id`/`contract_assignments` access model.

Path B (skip 1–8, use 010 as foundation) was therefore based on a misread. Even after fixing the 010 file's two pre-existing bugs (CONSTRAINT-AS, GENERATED-SELECT), the chain 010_user_contracts → 019 → 023 → 024 → 025 → 026 → seed 002 would **all** continue to fail with the same `column ct.external_user_id does not exist` error, because they reference a column 010 never created.

## 2. Affected section / artifacts

- **Bundle:** v2.2's STEP 1 (010_production_schema as foundation) and STEP 2 (synthetic change_order_staff_items patch with `ct.external_user_id` references) — both replaced.
- **Source patches to 010_production_schema.sql** (v2.1 CONSTRAINT-AS + v2.2 GENERATED-SELECT) — left in place; they remain real fixes for that file should anyone use it again, but the file is now **skipped** from the bundle.

## 3. Exact SQL — before / after

### Before (v2.2 — STEP 2 synthetic patch, line ~1367 of bundle)

```sql
CREATE POLICY "co_staff_external_select"
  ON change_order_staff_items FOR SELECT
  USING (change_order_id IN (
    SELECT co.id FROM change_orders co
    JOIN contracts ct ON co.contract_id = ct.id
    WHERE ct.external_user_id = auth.uid()    -- ← column does not exist in 010
  ));
```

### After (v2.3)

The synthetic patch is **removed entirely**. `change_order_staff_items` is now created by section 003 (`003_change_orders_and_hardening.sql`), which the v2.3 bundle includes as STEP 3. Section 003's RLS policies for that table use the same `external_user_id`-based scoping as the rest of the migration chain — and the column exists because section 001 (STEP 1 in v2.3) creates it.

## 4. Whether change_order_staff_items was created before the error

In v2.2's STEP 2 the table was created (the `CREATE TABLE IF NOT EXISTS` ran first), then the index, then `ENABLE ROW LEVEL SECURITY` succeeded, then the `co_staff_internal_all` policy succeeded — but the next policy (`co_staff_external_select`) errored on `ct.external_user_id`. Because the SQL Editor runs each Run-button submission as a single PG transaction, the error rolls back **everything** in that submission, including the new table. So `change_order_staff_items` is **not** present after the failure.

## 5. Whether staging needs reset or can continue

**Almost certainly clean — rerun without reset.** Same reasoning as the previous fix reports: each Run submission is one PG transaction; a syntax/column error rolls it back fully. The pre-flight DO block is a separate submission with no side effects.

Confirm before the next attempt:

```sql
SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
-- Expected: 0
```

If `> 0`, run the optional reset (`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL …`) from `staging_schema_bundle_v2_syntax_fix_report.md` §5 (verify staging URL first).

## 6. Path A vs Path B summary

| | Path B (v2 / v2.1 / v2.2 — wrong) | **Path A (v2.3 — correct)** |
|---|---|---|
| Foundation | 010_production_schema.sql | **001_base_schema.sql** |
| Sections 001–008 | SKIPPED | **APPLIED (001 → 002 → 003 → 004 → 006 → 007 → 008 → 009)** |
| 010_production_schema.sql | applied as foundation | **SKIPPED — parallel universe** |
| Synthetic change_order_staff_items patch | needed (010 didn't create it) | **removed (003 creates it)** |
| Reordering of 002/006/007/008 | required (had to come AFTER 010) | **none — original numeric order** |
| Total skipped | 6 (001, 003, 004, 009, 015, 018) | **3 (010_production_schema, 015, 018)** |
| Total applied | 46 (incl. synthetic) | **48** |
| Bundle bytes | 537 445 (v2.2) | **590 705** |

The v2.3 bundle is 53 KB larger because it reinstates the full 001 + 002 + 003 + 004 + 009 evolution chain. It runs migrations in their original numeric order — the way they were actually authored.

## 7. Confirmations on the v2.3 bundle

| Check | Result |
|---|---|
| Bytes / lines | 590 705 / 12 785 |
| NUL bytes | 0 |
| Control bytes (excl tab/LF/CR) | 0 |
| `CONSTRAINT name AS (` in actual SQL | 0 |
| `GENERATED ALWAYS AS (…)` containing `SELECT` (bracket-aware) | 0 |
| Skipped sections | 3 (010_production_schema, 015, 018) |
| Applied sections | 48 |
| Production-ref leaks outside header guard | 0 |
| `verify:repo-path` | passes |

## 8. Next exact operator instruction

1. **Pre-check** (verify staging is still clean):
   ```sql
   SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname = 'public';
   ```
   Expected: `0`. If non-zero, run the reset snippet (and re-verify URL).

2. **Pull v2.3 bundle** from the new commit on `main`.

3. **Run pre-flight guard alone** (lines 36–46 of v2.3). Expect `Success. No rows returned`.

4. **Apply STEP 1 → STEP 48 in order** (Mode B section-by-section). The sequence is now:
   - STEP 1: 001_base_schema (foundational — establishes the chain)
   - STEP 2: 002_step0_fixes (storage buckets + policy fixes)
   - STEP 3: 003_change_orders (creates change_orders + change_order_boq_items + change_order_staff_items + workflow + RLS)
   - STEP 4: 004_contract_templates (contract_boq_templates + contract_staff_templates + boq_progress_model)
   - STEP 5: 006_convera_users_otp
   - STEP 6: 007_amendments
   - STEP 7: 008_invoice_governance
   - STEP 8: 009_rename_claim_statuses
   - STEP 9: 010_user_contracts
   - STEPs 10–47: 011 → 050 (the existing chain, unchanged)
   - STEP 48: seeds 001–005 in order

   The skipped sections (010_production_schema, 015, 018) appear as `SKIPPED — comment-only` blocks; they emit no SQL and can be safely scrolled past.

5. **After all STEPs succeed**, run `staging_schema_verification.sql` and paste row output.

## 9. Why this attempt is more likely to succeed

Path A reuses the same migration chain that, on the operator's auto-memory entry, **production has been running on for months**. The only documented production-vs-repo divergence is that production is one migration behind (Migration 041 not applied). Every other migration in the v2.3 bundle has effectively been battle-tested on a real production database that holds the live operational data. There are no unknown semantic risks.

The risk that *did* exist with Path B (parallel-universe foundation) is now eliminated.
