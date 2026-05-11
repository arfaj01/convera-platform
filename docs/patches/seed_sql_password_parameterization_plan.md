# Seed-SQL Bootstrap-Password Parameterization Plan

> **Date:** 2026-05-10
> **Status:** PLAN ONLY — no SQL files modified by this step.
> **Scope:** the 3 tracked SQL files that embed the literal bootstrap password.
> **Goal:** allow the seeds to be run without committing the literal password to git, while preserving 100 % of seed functionality.
> **Trigger to apply:** only after `secret_rotation_runbook.md` §3 is complete (real user passwords already rotated in production).

---

## 1. Files in scope

| File | Lines | Literal occurrences | Mechanism |
|---|---|---|---|
| `data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql` | 174 | 7 | `INSERT INTO convera_users (… password_hash …) VALUES (…, '<old bootstrap password redacted>', …)` × 6 + 1 header comment |
| `data-imports/CMH_01/08_migration/sections/47_s004_seed_supabase_auth_users.sql` | 210 | 2 | `v_password_hash := crypt('<old bootstrap password redacted>', gen_salt('bf', 10));` × 1 + 1 header comment |
| `data-imports/CMH_01/08_migration/staging_schema_bundle.sql` | 12 719 | 9 | bundled snapshot — same patterns as the two section files above, concatenated |

Total: **18 literal occurrences** across **3 files**.

---

## 2. Why parameterize and not delete

`46_s003` populates `convera_users.password_hash` (a custom application-level column — see also Finding 4 in `platform_safety_findings.md` about plaintext storage in this column). `47_s004` calls Supabase's pgcrypto `crypt()` to bcrypt-hash the literal before writing to `auth.users.encrypted_password` (the proper auth path).

If we just delete the literal, two things break:

1. The seeds become non-runnable (NULL violates the `NOT NULL` constraint on `password_hash`).
2. The auth-users seed in 47_s004 produces a deterministic hash that the app's `signInWithPassword('Ma.Alarfaj@momah.gov.sa', '<old bootstrap password redacted>')` flow relied on for first-login bootstrap.

So we replace the literal with a runtime parameter that the operator passes in at seed time. The seeds remain runnable; the password value never lives in git.

---

## 3. Chosen mechanism: PostgreSQL `current_setting()` with a guarded preamble

**Rationale.** `current_setting('custom.x', true)` works in **any** Postgres client (psql, Studio SQL editor, JDBC, etc.) without depending on psql-specific `:'VAR'` interpolation. The operator runs one `SET LOCAL` first; then the rest of the seed reads the value back via `current_setting()`.

### Preamble to add at the top of each seed file (just below the existing header)

```sql
-- ── Required runtime parameter ──────────────────────────────────────
-- Set the bootstrap password before running this seed. Example:
--   psql -v ON_ERROR_STOP=1 -c "SET LOCAL custom.bootstrap_password = '<your-pwd>';" -f 46_s003_seed_convera_users.sql
-- Or, if running via Studio's SQL editor, prepend two lines to your paste:
--   SET LOCAL custom.bootstrap_password = '<your-pwd>';
--   <existing seed body follows>
DO $$
BEGIN
  IF current_setting('custom.bootstrap_password', true) IS NULL
     OR length(trim(current_setting('custom.bootstrap_password', true))) < 8
  THEN
    RAISE EXCEPTION
      'BOOTSTRAP_PASSWORD_NOT_SET — run: SET LOCAL custom.bootstrap_password = ''<at-least-8-chars>''; before this seed';
  END IF;
END $$;
```

The guard rejects empty/short values so a reviewer who runs the seed without the SET will see a clear error instead of getting NULL hashes.

### Replacement pattern

| Original | Replacement |
|---|---|
| `'<old bootstrap password redacted>'` (when used as a column value, e.g. `password_hash`) | `current_setting('custom.bootstrap_password')` |
| `crypt('<old bootstrap password redacted>', gen_salt('bf', 10))` | `crypt(current_setting('custom.bootstrap_password'), gen_salt('bf', 10))` |
| `BOOTSTRAP PASSWORD: <old bootstrap password redacted>` (in comment headers) | `BOOTSTRAP PASSWORD: <set via SET LOCAL custom.bootstrap_password — see preamble>` |

---

## 4. Per-file change list

### 4.1 `data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql`

- **Add preamble** (the §3 block) at line ~25, just after the existing `-- ═══════════════` header.
- **Replace** the comment-header literal at line 25 (`BOOTSTRAP PASSWORD: <old bootstrap password redacted>`) with the placeholder text in §3.
- **Replace** the 6 inline `'<old bootstrap password redacted>'` literals at the column-value position with `current_setting('custom.bootstrap_password')`. Approximate line numbers based on inspection: 55, 71, 87, 103, plus 2 more (likely lines 119 and 135 — the Reviewer and Auditor user records that I did not page through).

Estimated diff size: ~10 added lines (preamble) + 7 changed lines = **~17 lines diff**.

### 4.2 `data-imports/CMH_01/08_migration/sections/47_s004_seed_supabase_auth_users.sql`

- **Add preamble** at line ~32, just after the existing header.
- **Replace** the comment-header literal at line 32 with the placeholder text.
- **Replace** the single inline literal at line 60:
  ```sql
  -- BEFORE:
  v_password_hash := crypt('<old bootstrap password redacted>', gen_salt('bf', 10));
  -- AFTER:
  v_password_hash := crypt(current_setting('custom.bootstrap_password'), gen_salt('bf', 10));
  ```

Estimated diff size: ~10 added + 2 changed = **~12 lines diff**.

### 4.3 `data-imports/CMH_01/08_migration/staging_schema_bundle.sql`

The bundle is a snapshot generated by concatenating the section files. Two acceptable strategies:

**Strategy A (preferred): regenerate the bundle from the patched section files.**

After 4.1 and 4.2 are done, run whichever script regenerates the bundle (look for a builder script under `data-imports/CMH_01/08_migration/_TOOLS/` or similar — if none exists, simply `cat 0*.sql 1*.sql … 99*.sql > staging_schema_bundle.sql` in section-order). The patched preamble appears once in the section file but **multiple times** in the bundle (once per included section). That's fine — the guard is idempotent (the second `IF` raises only if not set; if set, it's a no-op).

**Strategy B (if regeneration is not feasible right now): patch the bundle directly with the same substitutions.**

Apply the same find-and-replace pattern to the bundle — the 9 literal occurrences need the same treatment. Add ONE copy of the preamble near the top of the bundle (line ~30, after the bundle's header banner).

Estimated diff size: ~10 added + 9 changed = **~19 lines diff**.

---

## 5. How to verify the patch is functional

After applying, on **staging only**:

```bash
# 1. Set the bootstrap password ONCE in the session
psql "$STAGING_DB_URL" <<SQL
  SET LOCAL custom.bootstrap_password = 'a-strong-test-value';
  \i data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql
SQL
```

Expected: `INSERT 0 N` for each user, no errors. If the SET LOCAL is forgotten:

```bash
psql "$STAGING_DB_URL" -f data-imports/CMH_01/08_migration/sections/46_s003_seed_convera_users.sql
```

Expected: `ERROR: BOOTSTRAP_PASSWORD_NOT_SET — run: SET LOCAL custom.bootstrap_password = '<at-least-8-chars>'; before this seed`. The guard fires; nothing is inserted.

Studio SQL Editor users prepend two lines:

```sql
SET LOCAL custom.bootstrap_password = 'a-strong-test-value';
-- paste the rest of the seed here
```

---

## 6. Coordination with the existing JS seeder

`scripts/create-test-auth-users.js` already reads `process.env.TEST_USER_PASSWORD`. After this patch, the SQL and JS paths are aligned: both are env-driven, neither carries the literal. Recommend:

- Rename the env var to a single name for both paths: `BOOTSTRAP_PASSWORD` (drop the JS-specific `TEST_USER_`). Document in `.env.local.example` (the template — already a placeholder).
- Update `scripts/create-test-auth-users.js` to read `BOOTSTRAP_PASSWORD` (with `TEST_USER_PASSWORD` fallback for one release for backward compat).
- Add the same name to the SQL preamble examples.

---

## 7. Why not delete the SQL files entirely and rely only on `scripts/create-test-auth-users.js`

Tempting because the JS seeder is already env-driven. But:

1. The convera_users plaintext-`password_hash` column path (46_s003) is NOT what the JS seeder writes. Deleting 46_s003 leaves the application column unpopulated until someone refactors `convera_users` to drop it (a separate piece of work tracked in §8).
2. The CMH_01 staging bundle assumes the SQL seeds run as part of the bundle apply. Deleting them strands the staging-bundle workflow.
3. Operators who can't or shouldn't install Node prefer pure-SQL seeding.

Better: keep both paths; align them on the same env var.

---

## 8. Out of scope (separate items)

- **Deprecate `convera_users.password_hash`** — the column stores plaintext, which is dangerous. Either drop it (the app authenticates via Supabase Auth, so this column may already be unused) or hash it via `crypt()` like 47_s004 does. File: TODO new ticket.
- **Add the bootstrap password to `secret_rotation_runbook.md` §4 Option A** as the canonical instruction the operator should follow. Already documented but should reference this plan by name.
- **Decide whether the bundle file should be tracked at all.** If it's regenerable, gitignore it. File: TODO new ticket.

---

## 9. Apply order (when approved)

1. **Wait** until `secret_rotation_runbook.md` §3 is done (real production passwords rotated).
2. Patch 46_s003 per §4.1.
3. Patch 47_s004 per §4.2.
4. Patch the bundle per §4.3 (Strategy A preferred).
5. Run §5 verification on staging.
6. Update `scripts/create-test-auth-users.js` per §6.
7. Run the secret-scan from `scripts/secret-scan.sh` to confirm zero remaining occurrences.
8. Commit as a single PR titled e.g. `chore(seed): parameterize bootstrap password`.

This sprint stops at step 0 (preparing this plan). Steps 1-8 await operator action.

---

## 10. Approval phrase

To proceed with steps 2-8 above (the SQL patching), reply with:

> **APPROVE-SEED-PARAMETERIZE**

Anything else will be treated as "wait, more discussion needed".

---

*Companion documents: `secret_rotation_runbook.md`, `platform_safety_findings.md`, `low_effort_improvement_backlog.md` item A3b.*
