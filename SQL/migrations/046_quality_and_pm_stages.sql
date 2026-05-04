-- ═════════════════════════════════════════════════════════════════════════
--  Migration 046 — Quality Unit + Project Manager + flexible-return
--
--  Purpose
--  -------
--  Adds SEVEN new claim_status enum values to support:
--   (a) the mandatory Quality Unit stage (وحدة الجودة بالوزارة)
--   (b) the Project Manager monitoring stage (مدير المشروع)
--   (c) flexible-return routing — every gating stage now exposes a "Return"
--       action whose target may be the contractor (→ a stage-specific
--       returned_by_* status) OR any earlier review stage (→ that stage's
--       under_*_review status, which already exists). The seven new values
--       are the missing returned_by_* sinks, one per gating stage.
--
--      under_technical_review            (NEW — Technical Unit gate)
--      under_quality_review               (NEW — Quality Unit gate, 1-day SLA)
--      under_project_manager_review       (NEW — PM monitoring gate)
--      returned_by_technical              (NEW — Technical → Contractor)
--      returned_by_quality                (NEW — Quality → Contractor)
--      returned_by_project_manager        (NEW — PM → Contractor)
--      returned_by_final_approver         (NEW — Final Approval → Contractor)
--
--  Forward-flow naming: claims that today land in `under_reviewer_check`
--  (the legacy Reviewer/governance stage) will, after the application-layer
--  refactor, land in `under_quality_review` (post Technical Unit) /
--  `under_project_manager_review` (post Quality) instead. The legacy enum
--  values `under_reviewer_check` and `under_auditor_review` REMAIN in the
--  enum so existing claim rows still validate; the new state machine simply
--  no longer routes new claims into them.
--
--  We DO NOT rename existing enum values. PostgreSQL enum-rename is
--  destructive (requires drop-and-recreate of the type, which touches every
--  column that references it and forces table-level locks). The
--  `pending_director_approval` enum value is kept as-is and relabelled in
--  the UI to "بانتظار الاعتماد النهائي".
--
--  Properties
--  ----------
--  • Single transaction (BEGIN / COMMIT).
--  • Idempotent: rerunning is a no-op once applied.
--  • Non-destructive: no DROP TYPE, no DROP COLUMN, no DELETE, no UPDATE.
--  • RLS-neutral.
--
--  Pre-conditions
--  --------------
--  • PostgreSQL ≥ 12 (Supabase ships pg 15) — required for ALTER TYPE
--    ADD VALUE inside a transaction.
--  • Migration 045 already applied (so the contract_role enum has
--    'project_manager' and 'quality').
--
--  Status
--  ------
--  • DRAFT — not yet executed.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Pre-flight: PG version
DO $$
DECLARE v_pg_major int;
BEGIN
  SELECT current_setting('server_version_num')::int / 10000 INTO v_pg_major;
  IF v_pg_major < 12 THEN
    RAISE EXCEPTION
      'Migration 046 requires PostgreSQL >= 12 (current: %)', v_pg_major;
  END IF;
END $$;

-- 2. Pre-flight: claim_status enum exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'claim_status') THEN
    RAISE EXCEPTION 'claim_status enum not found';
  END IF;
END $$;

-- 3. Pre-flight: contract_role enum has the Migration 045 values we depend on
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'contract_role' AND e.enumlabel = 'quality'
  ) THEN
    RAISE EXCEPTION
      'contract_role.quality not found — Migration 045 must run first';
  END IF;
END $$;

-- 4. Idempotent enum extension — six new claim_status values.
--    The new values are NOT referenced anywhere else in this migration,
--    so the pg ≥ 12 "no use of new value in same txn" rule is respected.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_technical_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_technical_review';
    RAISE NOTICE '+ claim_status: under_technical_review';
  ELSE RAISE NOTICE '⊘ already present: under_technical_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_technical') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_technical';
    RAISE NOTICE '+ claim_status: returned_by_technical';
  ELSE RAISE NOTICE '⊘ already present: returned_by_technical';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_quality_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_quality_review';
    RAISE NOTICE '+ claim_status: under_quality_review';
  ELSE RAISE NOTICE '⊘ already present: under_quality_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_quality') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_quality';
    RAISE NOTICE '+ claim_status: returned_by_quality';
  ELSE RAISE NOTICE '⊘ already present: returned_by_quality';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_project_manager_review') THEN
    ALTER TYPE claim_status ADD VALUE 'under_project_manager_review';
    RAISE NOTICE '+ claim_status: under_project_manager_review';
  ELSE RAISE NOTICE '⊘ already present: under_project_manager_review';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_project_manager') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_project_manager';
    RAISE NOTICE '+ claim_status: returned_by_project_manager';
  ELSE RAISE NOTICE '⊘ already present: returned_by_project_manager';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'claim_status' AND e.enumlabel = 'returned_by_final_approver') THEN
    ALTER TYPE claim_status ADD VALUE 'returned_by_final_approver';
    RAISE NOTICE '+ claim_status: returned_by_final_approver';
  ELSE RAISE NOTICE '⊘ already present: returned_by_final_approver';
  END IF;
END $$;

-- 5. Documentation
COMMENT ON TYPE claim_status IS
  'Claim workflow status. After Migration 046 the canonical pipeline is: '
  'draft → under_supervisor_review → under_technical_review → '
  'under_quality_review → under_project_manager_review → '
  'pending_director_approval (label: "بانتظار الاعتماد النهائي") → '
  'approved/rejected. Each gating stage has a matching returned_by_* '
  'status used when the reviewer chooses "return to Contractor"; returns '
  'to an earlier review stage reuse that stage''s under_*_review status '
  'directly. The legacy under_auditor_review and under_reviewer_check '
  'values remain in the enum for backward compatibility with claims '
  'created before this migration; new claims will not enter those '
  'statuses.';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
--  Validation queries — run AFTER commit
-- ═════════════════════════════════════════════════════════════════════════

-- VAL-1: enum has the seven new values
-- SELECT enumlabel FROM pg_enum
--   WHERE enumtypid = 'claim_status'::regtype
--   ORDER BY enumsortorder;
--
-- Expected: at minimum the seven labels below are present
--   under_technical_review
--   returned_by_technical
--   under_quality_review
--   returned_by_quality
--   under_project_manager_review
--   returned_by_project_manager
--   returned_by_final_approver

-- VAL-2: row-count snapshot — existing claims unaffected
-- SELECT status, COUNT(*) FROM claims GROUP BY status ORDER BY 1;

-- VAL-3: zero claims should be in any of the new statuses immediately
--        after the migration (UI is not yet using them)
-- SELECT status, COUNT(*) FROM claims
--  WHERE status IN ('under_technical_review','returned_by_technical',
--                   'under_quality_review','returned_by_quality',
--                   'under_project_manager_review','returned_by_project_manager',
--                   'returned_by_final_approver')
--  GROUP BY status;
-- Expected: zero rows.

-- VAL-4: positive smoke — insert + rollback for each new status to confirm
--        the enum value is accepted by the column. Run on staging only.
-- BEGIN;
--   INSERT INTO claims (id, claim_no, contract_id, status, claim_type, ...)
--     VALUES (gen_random_uuid(), 99901, '<staging-contract>', 'under_quality_review', 'boq_only', ...),
--            (gen_random_uuid(), 99902, '<staging-contract>', 'returned_by_quality', 'boq_only', ...),
--            (gen_random_uuid(), 99903, '<staging-contract>', 'under_project_manager_review', 'boq_only', ...),
--            (gen_random_uuid(), 99904, '<staging-contract>', 'returned_by_project_manager', 'boq_only', ...),
--            (gen_random_uuid(), 99905, '<staging-contract>', 'under_technical_review', 'boq_only', ...),
--            (gen_random_uuid(), 99906, '<staging-contract>', 'returned_by_technical', 'boq_only', ...),
--            (gen_random_uuid(), 99907, '<staging-contract>', 'returned_by_final_approver', 'boq_only', ...);
-- ROLLBACK;

-- VAL-5 (post application deploy): flexible-return audit smoke — confirm
-- the workflow log captures the picked target. Pick a recent claim that
-- has experienced a return and verify both `from_status` and `to_status`
-- match a row in §3d's table.
-- SELECT cw.claim_id, cw.action, cw.from_status, cw.to_status,
--        cw.notes, cw.created_at
--   FROM claim_workflow cw
--  WHERE cw.action = 'return'
--    AND cw.created_at > NOW() - INTERVAL '7 days'
--  ORDER BY cw.created_at DESC LIMIT 20;
