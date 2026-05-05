-- ═════════════════════════════════════════════════════════════════════════
--  Migration 047 — Claim Kind + Auto-Numbered claim_number + Open-Claim
--                  Guard Index
--
--  Purpose
--  -------
--  Adds the columns and ENUM that back the new "تقديم مطالبة مالية"
--  flow.  No application logic ships in this migration — the
--  claim_number generator and the open-claim guard live in the
--  /api/claims/create route (Commit 2).  This migration is purely
--  schema/index work and is safe to run before the API code lands.
--
--  Adds:
--    • ENUM claim_kind = ('running_payment','final_payment','advance_payment')
--    • claims.claim_kind         claim_kind  (nullable for legacy)
--    • claims.claim_number       TEXT        (e.g. CMH01R260504-001)
--    • claims.work_period_from   DATE        (canonical name; period_from kept)
--    • claims.work_period_to     DATE
--    • claims.external_reference TEXT        (optional external ref;
--                                             replaces the spec role of
--                                             the old free-text reference_no)
--    • claims.claim_sequence     INT         (per-contract running seq)
--    • UNIQUE INDEX ux_claims_claim_number
--    • UNIQUE INDEX ux_claims_contract_sequence
--    • INDEX ix_claims_contract_status_open
--    • CHECK chk_work_period_order  (NOT VALID — legacy rows tolerated)
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunnable. ENUM, columns, constraint, indexes all use
--    existence guards.
--  • Non-destructive: no DROP TYPE / DROP COLUMN / DELETE / UPDATE on
--    existing data, except a one-time NULL-safe backfill of
--    work_period_from / work_period_to from period_from / period_to so
--    legacy claims have meaningful values for the new column. No
--    column is renamed; period_from / period_to remain.
--  • RLS-neutral.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction (no values are added in this file
--    but the version constraint is asserted defensively).
--  • Migration 046 already applied (claim_status enum has the seven
--    Phase-2.6 values).
--
--  Status
--  ------
--  • DRAFT — not yet executed against any DB.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 0 — Pre-flight checks
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000 INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 047 requires PostgreSQL >= 12 (current: %)', v_pg_major;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'claims'
  ) THEN
    RAISE EXCEPTION 'claims table not found — base schema must run first';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_quality_review'
  ) THEN
    RAISE EXCEPTION
      'claim_status.under_quality_review missing — Migration 046 must run first';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 1 — ENUM claim_kind  (idempotent)
-- ════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE claim_kind AS ENUM (
    'running_payment',     -- مستخلص جاري   (UI label) — code R
    'final_payment',       -- مستخلص ختامي                     code F
    'advance_payment'      -- دفعة مقدمة                       code A
  );
EXCEPTION WHEN duplicate_object THEN
  -- Type already exists — leave as-is. If a future change needs to
  -- ADD VALUE, do it in a separate migration since ALTER TYPE … ADD
  -- VALUE inside the same txn that uses the value is forbidden.
  NULL;
END $$;

COMMENT ON TYPE claim_kind IS
  'Payment-cycle classifier for a financial claim. Distinct from '
  'claim_type (boq_only / staff_only / mixed / supervision) which is '
  'the structural classifier. Added by Migration 047.';

-- ════════════════════════════════════════════════════════════════════
-- PHASE 2 — New columns on claims  (all nullable, all IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_kind          claim_kind;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_number        TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS work_period_from    DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS work_period_to      DATE;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS external_reference  TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_sequence      INT;

COMMENT ON COLUMN claims.claim_kind IS
  'Payment-cycle classifier (running_payment / final_payment / '
  'advance_payment). NULL on rows that pre-date Migration 047.';
COMMENT ON COLUMN claims.claim_number IS
  'System-issued claim identifier in the form '
  '<ProjectCode><KindCode><YYMMDD>-<Seq>, e.g. CMH01R260504-001. '
  'Populated by /api/claims/create under pg_advisory_xact_lock. '
  'NULL on rows that pre-date Migration 047 / Commit 2.';
COMMENT ON COLUMN claims.work_period_from IS
  'Canonical "from" date of the period covered by this claim. '
  'period_from is retained for legacy reports.';
COMMENT ON COLUMN claims.work_period_to IS
  'Canonical "to" date of the period. Must be >= work_period_from '
  'when both are populated (chk_work_period_order, NOT VALID).';
COMMENT ON COLUMN claims.external_reference IS
  'Optional free-text external reference (e.g. اعتماد number). '
  'Replaces the spec role of the previously-required reference_no. '
  'Never used as the system identity — see claim_number.';
COMMENT ON COLUMN claims.claim_sequence IS
  'Per-contract running sequence (1, 2, 3, …). Set by the API under '
  'pg_advisory_xact_lock(hashtext(contract_id::text)) so concurrent '
  'inserts on the same contract serialise. NULL on legacy rows.';

-- ════════════════════════════════════════════════════════════════════
-- PHASE 3 — One-shot, NULL-safe backfill from period_from / period_to
-- ════════════════════════════════════════════════════════════════════

UPDATE claims
   SET work_period_from = period_from
 WHERE work_period_from IS NULL
   AND period_from IS NOT NULL;

UPDATE claims
   SET work_period_to = period_to
 WHERE work_period_to IS NULL
   AND period_to IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 4 — CHECK constraint chk_work_period_order  (idempotent guard)
-- ════════════════════════════════════════════════════════════════════
--
-- ALTER TABLE ADD CONSTRAINT throws if the constraint already exists,
-- which would break a rerun. Guard via pg_constraint lookup. NOT VALID
-- so any pre-existing rows that violate the predicate (extremely
-- unlikely — period_to >= period_from is the historical convention)
-- do not abort the migration. Run a separate `ALTER TABLE claims
-- VALIDATE CONSTRAINT chk_work_period_order;` later if/when a full
-- audit confirms zero violations.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname  = 'chk_work_period_order'
       AND conrelid = 'public.claims'::regclass
  ) THEN
    ALTER TABLE claims
      ADD CONSTRAINT chk_work_period_order
      CHECK (work_period_to IS NULL
             OR work_period_from IS NULL
             OR work_period_to >= work_period_from)
      NOT VALID;
    RAISE NOTICE '+ chk_work_period_order added (NOT VALID)';
  ELSE
    RAISE NOTICE '⊘ chk_work_period_order already present';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- PHASE 5 — Indexes
-- ════════════════════════════════════════════════════════════════════

-- 5a. Unique partial index on claim_number (only when populated).
--     Legacy rows have NULL claim_number; partial index ignores them
--     so legacy data does not block uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS ux_claims_claim_number
  ON claims (claim_number)
 WHERE claim_number IS NOT NULL;

-- 5b. Unique partial index on (contract_id, claim_sequence).
--     The API computes the next sequence under an advisory lock; the
--     unique index is the second line of defence that turns any race
--     condition into a 23505 error rather than silent duplication.
CREATE UNIQUE INDEX IF NOT EXISTS ux_claims_contract_sequence
  ON claims (contract_id, claim_sequence)
 WHERE claim_sequence IS NOT NULL;

-- 5c. Performance index for the open-claim guard.
--     "Open" = NOT IN ('approved','rejected','cancelled','closed').
--     Speeds up the existence check the API runs before allowing a
--     new claim on a contract.
CREATE INDEX IF NOT EXISTS ix_claims_contract_status_open
  ON claims (contract_id, status)
 WHERE status NOT IN ('approved','rejected','cancelled','closed');

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- ProjectCode mapping (documentation only — resolver lives in the API)
-- ═════════════════════════════════════════════════════════════════════════
--
-- Per the 2026-05-04 implementation decision, /api/claims/create owns
-- the resolver from `contracts.contract_no` to the 5-character project
-- code used inside `claim_number`. The migration does NOT contain a SQL
-- function for this — keeping business config in code makes it
-- unit-testable and lets future contracts be added without a new
-- migration.
--
-- Authoritative mapping at the time of this migration:
--
--     contract_no          → project_code
--     -----------------------+------------
--     'CMH_01-C01'         → 'CMH01'
--     '250101116428'       → 'CMH02'
--     '241039011332'       → 'CMH03'
--
-- Resolver contract:
--   • If the contract_no IS the literal 'CMH_xx-Cyy' shape, project_code
--     = first three chars + the two-digit project number, all uppercase,
--     no underscore (e.g. 'CMH_01-C01' → 'CMH01').
--   • Otherwise the resolver MUST consult the explicit mapping table.
--   • If neither rule applies the API MUST fail with HTTP 422 and the
--     Arabic message "تعذّر تحديد كود المشروع لهذا العقد — تواصل مع
--     مدير الإدارة قبل المتابعة." A claim_number is NEVER silently
--     malformed.

-- ═════════════════════════════════════════════════════════════════════════
-- Validation queries — run AFTER commit (NOT inside the migration txn)
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: confirm the 6 new columns exist on claims.
-- Expected: 6 rows (claim_kind, claim_number, work_period_from,
--                   work_period_to, external_reference, claim_sequence).
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'claims'
--    AND column_name IN (
--      'claim_kind','claim_number','work_period_from',
--      'work_period_to','external_reference','claim_sequence'
--    )
--  ORDER BY column_name;

-- VAL-2: confirm ENUM claim_kind has the 3 values.
-- Expected: 3 rows.
-- SELECT enumlabel FROM pg_enum
--  WHERE enumtypid = 'claim_kind'::regtype
--  ORDER BY enumsortorder;

-- VAL-3: confirm the 3 new indexes exist.
-- Expected: 3 rows (ix_claims_contract_status_open,
--                   ux_claims_claim_number,
--                   ux_claims_contract_sequence).
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname = 'public' AND tablename = 'claims'
--    AND indexname IN (
--      'ux_claims_claim_number',
--      'ux_claims_contract_sequence',
--      'ix_claims_contract_status_open'
--    )
--  ORDER BY indexname;

-- VAL-4: confirm chk_work_period_order exists. NOT VALID is acceptable
-- — the trailing 't' in convalidated would be 'f' until the operator
-- runs ALTER TABLE … VALIDATE CONSTRAINT.
-- Expected: 1 row.
-- SELECT conname, convalidated
--   FROM pg_constraint
--  WHERE conname  = 'chk_work_period_order'
--    AND conrelid = 'public.claims'::regclass;

-- VAL-5: snapshot of legacy claims that should now have NULL on the
-- new columns (proves the migration didn't accidentally backfill
-- claim_kind / claim_number / claim_sequence).
-- Expected: claim_kind/claim_number/claim_sequence all NULL on every row.
-- SELECT COUNT(*)                                          AS total_rows,
--        COUNT(claim_kind)                                 AS rows_with_kind,
--        COUNT(claim_number)                               AS rows_with_number,
--        COUNT(claim_sequence)                             AS rows_with_sequence,
--        COUNT(work_period_from)                           AS rows_with_wpf,
--        COUNT(work_period_to)                             AS rows_with_wpt
--   FROM claims;

-- VAL-6: smoke check of the constraint — only run on staging/dev.
-- Expected: the second INSERT raises a check_violation; ROLLBACK leaves
-- nothing behind.
-- BEGIN;
--   INSERT INTO claims (id, contract_id, claim_no, status, claim_type,
--                       work_period_from, work_period_to)
--     VALUES (gen_random_uuid(), '<staging-contract>', 99001,
--             'draft','boq_only',
--             '2026-05-15','2026-05-01');                     -- INVALID
--   -- "ERROR: new row for relation \"claims\" violates check constraint"
-- ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- Rollback notes
-- ═════════════════════════════════════════════════════════════════════════
-- • Forward-only ENUM: PostgreSQL has no DROP VALUE. If the application
--   layer reverts to pre-Commit-2 code the ENUM stays unused and is
--   harmless.
-- • Soft revert (DDL):
--     DROP INDEX IF EXISTS ix_claims_contract_status_open;
--     DROP INDEX IF EXISTS ux_claims_contract_sequence;
--     DROP INDEX IF EXISTS ux_claims_claim_number;
--     ALTER TABLE claims DROP CONSTRAINT IF EXISTS chk_work_period_order;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_sequence;
--     ALTER TABLE claims DROP COLUMN IF EXISTS external_reference;
--     ALTER TABLE claims DROP COLUMN IF EXISTS work_period_to;
--     ALTER TABLE claims DROP COLUMN IF EXISTS work_period_from;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_number;
--     ALTER TABLE claims DROP COLUMN IF EXISTS claim_kind;
--     DROP TYPE IF EXISTS claim_kind;
--   The DROP COLUMN sequence is safe ONLY if no row carries non-NULL
--   values on those columns yet (use VAL-5 to verify before dropping).
