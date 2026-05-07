-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 38 — MIGRATION
--  Source seq      : 045
--  Source migration: migrations/045_contract_role_multi_assignment.sql
--  Purpose         : 3-tuple unique invariant
--  Run order       : STEP 38 of 48 (after STEP 37, before STEP 39).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════
--  Migration 045 — Contract Role Multi-Assignment + Extended Enum
--
--  Purpose
--  -------
--  1. Extend the `contract_role` enum with three new values that match the
--     Excel project user-role sheet:
--         project_manager   (مدير مشروع)
--         quality           (جودة) — advisory only, no workflow gate
--         final_approver    (المعتمد النهائي) — promoted from a global UserRole
--                            value to a contract-scoped contract_role
--
--  2. Allow a single user to hold MORE THAN ONE contract_role on the same
--     contract, by replacing the row-level uniqueness key from
--         UNIQUE (user_id, contract_id)
--     to
--         UNIQUE (user_id, contract_id, contract_role)
--
--  Excel example honoured by this migration:
--     One user listed as both مدير مشروع and تدقيق on the same project
--     becomes two distinct rows in user_contract_roles. Today this fails.
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunning is a no-op once applied.
--  • Safe-abort: pre-flight check raises an EXCEPTION (and rolls the
--    transaction back) if any pre-existing rows would violate the new
--    3-tuple constraint. No data is lost or rewritten.
--  • Non-destructive: no DROP TABLE, no DROP COLUMN, no DELETE, no UPDATE.
--    The only structural change is swapping one UNIQUE constraint for
--    another that is *stricter* — every row currently legal stays legal.
--  • RLS-neutral: the policies authored in Migration 026 use predicates
--    of the form (user_id = auth.uid()) without referencing the constraint
--    shape, so they remain correct.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction.
--  • Migrations 025 and 040 already applied.
--
--  Post-conditions
--  ---------------
--  • contract_role enum has 8 values total.
--  • user_contract_roles uniqueness key is the 3-tuple
--    (user_id, contract_id, contract_role).
--  • All existing rows continue to satisfy the new constraint.
--
--  Date drafted : 2026-04-28
--  Status       : DRAFT — for review only, not yet executed.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pre-flight check: PostgreSQL version ─────────────────────────────
-- ALTER TYPE ... ADD VALUE inside a transaction requires pg ≥ 12.

DO $$
DECLARE
  v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000
    INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 045 requires PostgreSQL >= 12 (current: %). '
      'Earlier versions disallow ALTER TYPE ADD VALUE inside a transaction. '
      'Either upgrade or split this migration into a non-transactional '
      'enum-extend step followed by a transactional constraint-swap step.',
      v_pg_major;
  END IF;
END $$;


-- ── 2. Pre-flight check: contract_role enum exists ──────────────────────
-- Defensive guard against running this migration before Migration 025.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'contract_role'
  ) THEN
    RAISE EXCEPTION
      'Migration 045 prerequisite missing: contract_role enum not found. '
      'Run Migration 025 (contract_scoped_roles) first.';
  END IF;
END $$;


-- ── 3. Pre-flight check: user_contract_roles table exists ───────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'user_contract_roles' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Migration 045 prerequisite missing: user_contract_roles table '
      'not found. Run Migration 025 first.';
  END IF;
END $$;


-- ── 4. Idempotent enum extension ────────────────────────────────────────
-- Three new values added one at a time, each guarded so reruns are safe.
-- The new values are NOT referenced anywhere else in this migration, so
-- the pg ≥ 12 "no use of new value in same txn" rule is respected.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'project_manager'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'project_manager';
    RAISE NOTICE '✓ contract_role: added project_manager';
  ELSE
    RAISE NOTICE '⊘ contract_role: project_manager already present — skipped';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'quality'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'quality';
    RAISE NOTICE '✓ contract_role: added quality';
  ELSE
    RAISE NOTICE '⊘ contract_role: quality already present — skipped';
  END IF;
END $$;

-- NOTE:
-- final_approver is being migrated to a contract-scoped role.
-- The global UserRole 'final_approver' will be deprecated in a later phase.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'final_approver'
  ) THEN
    ALTER TYPE contract_role ADD VALUE 'final_approver';
    RAISE NOTICE '✓ contract_role: added final_approver';
  ELSE
    RAISE NOTICE '⊘ contract_role: final_approver already present — skipped';
  END IF;
END $$;


-- ── 5. SAFE ABORT — duplicate detection BEFORE constraint swap ──────────
-- The new constraint is stricter on the role dimension than the old one.
-- Specifically: the old UNIQUE(user_id, contract_id) implicitly guaranteed
-- that no two rows shared (user_id, contract_id, contract_role) either
-- (because they couldn't share the first two). So in normal operation
-- there should be ZERO duplicates. This block is a paranoid guard against
-- prior migrations / direct DB edits / RLS bypasses that could have left
-- duplicate (u, c, role) rows behind.

DO $$
DECLARE
  v_dup_tuple_count int;
BEGIN
  SELECT COUNT(*)
    INTO v_dup_tuple_count
    FROM (
      SELECT user_id, contract_id, contract_role
        FROM user_contract_roles
        GROUP BY user_id, contract_id, contract_role
        HAVING COUNT(*) > 1
    ) dupes;

  IF v_dup_tuple_count > 0 THEN
    RAISE EXCEPTION
      'ABORT: % duplicate (user_id, contract_id, contract_role) tuples '
      'already exist in user_contract_roles. Resolve them manually '
      '(soft-deactivate or delete duplicates) before re-running '
      'Migration 045. The transaction has been rolled back; nothing '
      'was changed.',
      v_dup_tuple_count;
  END IF;

  RAISE NOTICE '✓ Pre-flight: no duplicate (user, contract, role) tuples';
END $$;


-- ── 6. Drop the old (user_id, contract_id) UNIQUE constraint ───────────
-- We look up the constraint by SHAPE (which two columns it covers) rather
-- than by name, because PostgreSQL auto-named the constraint in
-- Migration 025. The likely name is
-- `user_contract_roles_user_id_contract_id_key` but we don't rely on it.
--
-- This block is idempotent: if the constraint has already been dropped on
-- a previous run, it logs a notice and continues. It is also safe — only
-- dropping the EXACT (user_id, contract_id) two-column unique constraint;
-- it does NOT touch the primary key or any other constraint.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  RAISE NOTICE 'Dropping old UNIQUE (user_id, contract_id) constraint';

  SELECT conname
    INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'public.user_contract_roles'::regclass
     AND contype  = 'u'
     -- pg_get_constraintdef formats two-column unique constraints
     -- as exactly "UNIQUE (user_id, contract_id)" (column order
     -- preserved, single space after comma).
     AND pg_get_constraintdef(oid) ILIKE 'UNIQUE (user_id, contract_id)%'
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.user_contract_roles DROP CONSTRAINT %I',
      v_constraint_name
    );
    RAISE NOTICE '✓ Dropped old constraint: %', v_constraint_name;
  ELSE
    RAISE NOTICE '⊘ Old (user_id, contract_id) UNIQUE constraint not '
                 'found — assumed already swapped on a previous run';
  END IF;
END $$;


-- ── 7. Add the new 3-tuple UNIQUE constraint ───────────────────────────
-- Idempotent — uses IF NOT EXISTS via a probe in pg_constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.user_contract_roles'::regclass
       AND conname  = 'user_contract_roles_user_contract_role_key'
  ) THEN
    ALTER TABLE public.user_contract_roles
      ADD CONSTRAINT user_contract_roles_user_contract_role_key
      UNIQUE (user_id, contract_id, contract_role);
    RAISE NOTICE '✓ Added new 3-tuple unique constraint';
  ELSE
    RAISE NOTICE '⊘ New 3-tuple unique constraint already present — skipped';
  END IF;
END $$;


-- ── 8. Documentation ────────────────────────────────────────────────────

COMMENT ON CONSTRAINT user_contract_roles_user_contract_role_key
  ON user_contract_roles IS
  'A user may hold one row per (contract, contract_role). Multiple rows '
  'for the same (user, contract) are allowed when the role differs '
  '(e.g. مدير مشروع + تدقيق). Soft-delete via is_active=false rather '
  'than DELETE.';

COMMENT ON COLUMN user_contract_roles.contract_role IS
  'Excel canonical roles: '
  'contractor (مقاول), supervisor (مكتب استشاري), auditor (تدقيق), '
  'reviewer (مراجع — governance), quality (جودة — advisory only, '
  'no workflow gate), project_manager (مدير مشروع), '
  'final_approver (معتمد نهائي), viewer.';


-- ── 9. Final notice ─────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE 'Migration 045 applied successfully.';
  RAISE NOTICE '  • contract_role enum extended with 3 values';
  RAISE NOTICE '  • user_contract_roles uniqueness key swapped to 3-tuple';
  RAISE NOTICE 'Run validation queries (see migration header / docs) to verify.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
--  End of migration. Validation queries follow as standalone reads
--  (uncomment/run them manually post-COMMIT to verify).
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: enum has 8 values including the 3 new ones.
-- SELECT enumlabel
--   FROM pg_enum
--  WHERE enumtypid = 'contract_role'::regtype
--  ORDER BY enumsortorder;

-- VAL-2: only the 3-tuple unique constraint remains; the old one is gone.
-- SELECT conname, pg_get_constraintdef(oid) AS definition
--   FROM pg_constraint
--  WHERE conrelid = 'public.user_contract_roles'::regclass
--    AND contype = 'u';

-- VAL-3: zero rows violate the new constraint.
-- SELECT user_id, contract_id, contract_role, COUNT(*) AS dup_count
--   FROM user_contract_roles
--   GROUP BY 1,2,3
--   HAVING COUNT(*) > 1;

-- VAL-4: row count unchanged from before migration.
-- SELECT COUNT(*) AS total_rows FROM user_contract_roles;

-- VAL-5: positive multi-role test (run on staging only, then ROLLBACK).
-- BEGIN;
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES
--       ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager'),
--       ('<staging-user-uuid>', '<staging-contract-uuid>', 'auditor');
--   -- Both inserts must succeed.
-- ROLLBACK;

-- VAL-6: negative duplicate test (run on staging only, then ROLLBACK).
-- BEGIN;
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager');
--   INSERT INTO user_contract_roles (user_id, contract_id, contract_role)
--     VALUES ('<staging-user-uuid>', '<staging-contract-uuid>', 'project_manager');
--   -- The second insert must FAIL with "duplicate key value violates
--   --  unique constraint user_contract_roles_user_contract_role_key".
-- ROLLBACK;
