# Staging Schema Bundle — Fix Report

> Authored 2026-05-07. Documents the syntax-error investigation triggered by the operator's first apply attempt on CONVERA-STAGING (project `jrqkzwacerdudmeacvar`) and the resulting bundle patch. **No SQL was executed against any database during this fix. No production was touched.**

---

## 1. Root cause

Two issues, **one confirmed fix and one suspected paste-side cause**:

### A. Confirmed corruption (fixed)

`convera-platform/SQL/migrations/044_imports_governance.sql` ended with **36 trailing NUL bytes (`\x00`)** in the repo. When the staging bundle was assembled, those NUL bytes were inherited verbatim and landed at **bundle line 9778**, between section 40 (Migration 044) and section 41 (Migration 045).

PostgreSQL refuses to parse a multi-statement query that contains NUL bytes; this would have surfaced as a syntax error around the section 40/41 boundary if the operator's paste had reached that far.

The corruption pattern matches the `.env.local` NUL-tail incident from earlier this session (Notepad / Windows save flow leaving NUL padding on a UTF-8 file). Comparison evidence:

| File | Bytes (before) | NUL bytes | Actual SQL bytes |
|---|---|---|---|
| `current/SQL/migrations/044_imports_governance.sql` | 5 710 | 36 | 5 674 |
| `legacy/CONVERA/SQL/migrations/044_imports_governance.sql` | 5 674 | 0 | 5 674 |

Stripping the NUL tail makes the two files **byte-identical**. The "current is newer than legacy" claim from `legacy_vs_current_inventory.md` was only true because of NUL pollution, not because of any real SQL change.

### B. Suspected cause of the operator's reported "CR at LINE 3075"

The operator reported:
```
ERROR: 42601: syntax error at or near "CR"
LINE 3075: CR
This appears to be inside: Section 9 / Seq 010a (bundle lines 3061-4310)
```

After investigation, **bundle line 3075 is verbatim `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` — valid SQL.** No standalone `CR` token, no NUL byte, no embedded carriage return, no BOM, no unbalanced dollar quote, no missing semicolon, and no other artifact exists at or before that line. The full investigation:

| Check | Result |
|---|---|
| Standalone `CR` / `LF` / `EOF` / `BOM` token (any line) | None found |
| Embedded `\r` (CR byte 0x0D) anywhere in bundle | 0 occurrences |
| BOM byte sequence anywhere (start or middle of file) | 0 occurrences |
| Other control bytes (excluding tab/LF/CR) up to L3075 | 0 |
| Dollar-quote tokens up to L3075 (must be even) | 26 — balanced |
| Unbalanced single quotes up to L3075 | 0 |
| Last non-comment line before L3075 | `SELECT status, COUNT(*) FROM change_orders GROUP BY status ORDER BY status;` — terminated cleanly |

The most plausible cause is a **paste-buffer truncation in the Supabase SQL Editor**. Pasting all 636 KB / 14 042 lines of the bundle into a single editor textarea can hit text-area or clipboard limits and silently truncate or split a token. The operator's PG error format `LINE 3075: CR` matches exactly the symptom of `CREATE EXTENSION...` getting truncated to `CR` mid-token by the paste buffer.

**This is not a bundle defect.** The fix here is not in the bundle — it's in the apply flow. See §5 for the recommended apply method.

---

## 2. Exact affected line(s)

| File | Line | Before | After |
|---|---|---|---|
| `convera-platform/SQL/migrations/044_imports_governance.sql` | trailing 36 bytes | NUL × 36 | (removed; ends with `tables_created;\n`) |
| `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` | L9778 (was) | NUL × 36 (whole-line) | (removed) |

Net effect on the bundle:
- Total NUL bytes: **36 → 0**
- Total bytes: 636 128 → 636 091 (-37 = 36 NULs + 1 newline byte)
- Total lines: 14 043 → 14 042 (one line removed)
- All section headers from L9780 onwards shifted by **-1** (sections 41–51 and the END-OF-BUNDLE footer now sit one line earlier than the previously-published section index)

Section 9 (line 3075 → unchanged) was not modified.

---

## 3. File / section affected

| Section in bundle | Source file | Status |
|---|---|---|
| Section 40 (Migration 044, current) | `convera-platform/SQL/migrations/044_imports_governance.sql` | Fixed (NUL tail removed). Same SQL content as before — only the trailing garbage is gone. |
| Sections 41–51 | All other migrations + seeds | Unchanged content; their bundle line numbers shift by -1. |
| Section 9 (Migration 010a, legacy) | `legacy/CONVERA/SQL/migrations/010_production_schema.sql` | **Unchanged.** No defect found at bundle L3075. |

---

## 4. Fix applied

1. Stripped the 36 trailing NUL bytes from `convera-platform/SQL/migrations/044_imports_governance.sql` (now 5 674 bytes, identical to legacy).
2. Removed line 9778 (the NUL-only line) from `staging_schema_bundle.sql` (now 14 042 lines, 0 NULs).
3. Verified post-fix bundle has **zero non-printable control bytes** (no NULs, no embedded CRs, no BOMs).
4. Verified all section headers still parse correctly; section 41 (Migration 045) header is now at L9780 (was L9781).

The bundle's pre-flight production-ref guard, all migrations, and all seeds are unchanged in content.

---

## 5. Whether previous successful sections need rollback

**No rollback needed.** The bundle's migrations are designed to be **idempotent on a fresh staging instance**:

- Most use `CREATE TABLE`, `CREATE TYPE`, `CREATE FUNCTION`, etc. — these would error with "already exists" if re-run, but if the operator's apply failed at section 9 (their reported error), nothing was committed past section 8 because PG transactions roll back on syntax errors within a multi-statement script.
- Even if some of sections 1–8 *did* commit (some migrations have explicit `BEGIN/COMMIT` blocks per file), re-running them against a staging DB with those objects already created will simply error with `relation already exists` on the first conflicting statement. That's recoverable: skip to the failed section.

The two operationally safe interpretations:

| Operator's recall | Recommended action |
|---|---|
| "Apply errored at section 9 — sections 1–8 ran cleanly before that" | Re-apply sections 9–51 in **Mode B (section-by-section)**. Sections 1–8 are already in place. |
| "Apply errored — I don't know what was committed" | Drop the staging schema (it's a fresh staging project), then re-apply the entire bundle in Mode B. The current `public` schema state can be inspected with `staging_schema_verification.sql` — every check returning `FAIL` means clean slate. |
| "I haven't applied anything yet" | Apply the entire bundle in Mode B. |

---

## 6. Exact next operator instruction

### Recommended path — Mode B (section-by-section paste)

This avoids the paste-buffer-truncation issue entirely (each section is small enough to paste cleanly) and gives per-section error attribution.

1. **Pull the patched bundle.** The fix is committed at SHA `<this-commit>` on `main` (local). The bundle file `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` is now 14 042 lines, 0 NULs.
2. **Confirm the staging tab.** Tab title must say `... | CONVERA-STAGING | MOMAH | Supabase`. URL must contain `jrqkzwacerdudmeacvar`. Production ref `ngwxlockzkjpmzuvgakx` must NOT be visible in the URL.
3. **Run the pre-flight guard alone first** (lines 36–46 of the patched bundle). Expect `Success. No rows returned`. Already proved on this session — running again is a fast sanity check.
4. **Then apply sections 1–51** by copying line ranges from the patched bundle into the SQL Editor, one section at a time, running each, and waiting for success before moving to the next. Section line ranges in the **patched** bundle (post-fix, sections 41+ shifted -1):

   | # | Seq | Source | Lines (post-fix) |
   |--:|--|--|--:|
   | 1–40 | unchanged | unchanged | same as published earlier this session — sections 1–40 line ranges are NOT affected by the fix |
   | 41 | 045 | legacy | **9780–10113** (was 9781–10114) |
   | 42 | 046 | current | **10115–10343** (was 10116–10344) |
   | 43 | 047 | current | **10345–10684** (was 10346–10685) |
   | 44 | 048 | current | **10686–11110** (was 10687–11111) |
   | 45 | 049 | current | **11112–11645** (was 11113–11646) |
   | 46 | 050 | current | **11647–12262** (was 11648–12263) |
   | 47 | s001 | legacy | **12264–12592** (was 12265–12593) |
   | 48 | s002 | legacy | **12594–13112** (was 12595–13113) |
   | 49 | s003 | legacy | **13114–13280** (was 13115–13281) |
   | 50 | s004 | legacy | **13282–13484** (was 13283–13485) |
   | 51 | s005 | current | **13486–14036** (was 13487–14037) |

5. **After section 51 succeeds**, run `staging_schema_verification.sql` and paste the output.

### Alternative — drop and reapply (if uncertain about partial state)

If the operator is unsure whether sections 1–8 committed:

```sql
-- READ-ONLY first — confirm staging public schema state:
-- (paste into the staging SQL Editor — DO NOT run on production)
SELECT COUNT(*) AS table_count
FROM pg_tables WHERE schemaname = 'public';
```

- Result `0` (or only Supabase's bookkeeping tables): clean slate. Apply the patched bundle from §6 step 1.
- Result `>0` with CONVERA tables present: partial state. Either accept the partial state and resume from the next section, or drop the public schema and reapply (operator's call):

```sql
-- ⚠ DESTRUCTIVE — wipes the staging public schema only. Verify URL still says
-- jrqkzwacerdudmeacvar (NOT ngwxlockzkjpmzuvgakx) before running.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, anon, authenticated, service_role;
```

After that, reapply the patched bundle in Mode B from §6 step 1.

---

## 7. Other artifacts checked (none found)

| Artifact | Bundle scan result |
|---|---|
| Standalone `CR` / `LF` / `EOF` / `BOM` literal tokens | 0 |
| Embedded `\r` (carriage return byte 0x0D) | 0 |
| BOM at start of file | absent |
| BOM in middle of file | 0 |
| Other control bytes (excluding tab/LF/CR) | 0 (after fix) |
| Files with NUL bytes anywhere (53 sources scanned: 47 legacy + 6 current SQL) | **only `current/044_imports_governance.sql` (now fixed)** |
| Suspicious short tokens on their own line | 55, all valid SQL keywords (`ELSE`, `CASE`, `END`, `OR`, `THEN`, `LOOP`) or column identifiers |

The patched bundle is **structurally clean**. No further bundle defects found.

---

## 8. Confirmations

- **No SQL was executed** by the agent during this fix.
- **No DB was mutated** by the agent.
- **No production was touched** (production ref `ngwxlockzkjpmzuvgakx` was never used as a target). The legacy 044 file (which lives in the read-only `CONVERA/` folder) was **not** modified — only the current `convera-platform/SQL/migrations/044_imports_governance.sql` was patched.
- **No `git push`** — the fix commit is local.
- **No Phase 8 import** was run.
- **No secrets exposed.**
