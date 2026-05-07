-- ════════════════════════════════════════════════════════════════════
--  CMH_01 — STAGING Schema Verification
--  Authored 2026-05-07
--
--  Purpose: confirm that staging_schema_bundle.sql ran successfully
--           and the schema is healthy enough for Phase-8 execution.
--
--  How to use:
--    1. Confirm the Supabase SQL Editor is open on the STAGING project
--       (URL contains 'jrqkzwacerdudmeacvar', NOT 'ngwxlockzkjpmzuvgakx').
--    2. Paste this entire file and click Run.
--    3. The result is one row per check with columns: check_name, status,
--       details. Every row's status must be 'PASS' before Phase 8 is run.
--    4. Any 'FAIL' row blocks Phase 8 — capture and consult the runbook.
--
--  Read-only: this script issues no INSERT/UPDATE/DELETE/DDL.
-- ════════════════════════════════════════════════════════════════════

-- Pre-flight: refuse to run if the production project ref appears in
-- pg_settings. Same belt-and-braces guard as the schema bundle.
DO $$
DECLARE prod_marker TEXT := 'ngwxlockzkjpmzuvgakx';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_settings
    WHERE setting LIKE '%' || prod_marker || '%'
       OR name    LIKE '%' || prod_marker || '%'
  ) THEN
    RAISE EXCEPTION 'ABORT — verification must NEVER run on production project ref %', prod_marker;
  END IF;
END $$;

-- ─── Helpers ───────────────────────────────────────────────────────
-- We assemble the result set with UNION ALL so the editor returns one
-- row per check.

WITH checks AS (
  -- ── Core tables ──
  SELECT 'public.contracts exists'                AS check_name,
         CASE WHEN to_regclass('public.contracts')           IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN to_regclass('public.contracts')           IS NOT NULL THEN ''     ELSE 'missing'  END AS details
  UNION ALL
  SELECT 'public.claims exists',
         CASE WHEN to_regclass('public.claims')              IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.claims')              IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.profiles exists',
         CASE WHEN to_regclass('public.profiles')            IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.profiles')            IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.user_contract_roles exists',
         CASE WHEN to_regclass('public.user_contract_roles') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.user_contract_roles') IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.user_contracts exists',
         CASE WHEN to_regclass('public.user_contracts')      IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.user_contracts')      IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.claim_workflow exists',
         CASE WHEN to_regclass('public.claim_workflow')      IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.claim_workflow')      IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.audit_logs exists',
         CASE WHEN to_regclass('public.audit_logs')          IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.audit_logs')          IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.documents exists',
         CASE WHEN to_regclass('public.documents')           IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.documents')           IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.notifications exists',
         CASE WHEN to_regclass('public.notifications')       IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.notifications')       IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.contract_boq_templates exists',
         CASE WHEN to_regclass('public.contract_boq_templates')   IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.contract_boq_templates')   IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.contract_staff_templates exists',
         CASE WHEN to_regclass('public.contract_staff_templates') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.contract_staff_templates') IS NOT NULL THEN ''     ELSE 'missing'  END
  UNION ALL
  SELECT 'public.contract_approvers exists',
         CASE WHEN to_regclass('public.contract_approvers')  IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN to_regclass('public.contract_approvers')  IS NOT NULL THEN ''     ELSE 'missing'  END

  -- ── Required enums exist ──
  UNION ALL
  SELECT 'enum user_role exists',
         CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname='user_role'    AND typtype='e') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'enum contract_role exists',
         CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname='contract_role' AND typtype='e') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'enum claim_status exists',
         CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname='claim_status'  AND typtype='e') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'enum contract_type exists',
         CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname='contract_type' AND typtype='e') THEN 'PASS' ELSE 'FAIL' END, ''

  -- ── contract_role values: quality, project_manager, final_approver ──
  UNION ALL
  SELECT 'contract_role enum has "quality"',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'contract_role' AND e.enumlabel = 'quality'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'contract_role enum has "project_manager"',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'contract_role' AND e.enumlabel = 'project_manager'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'contract_role enum has "final_approver"',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'contract_role' AND e.enumlabel = 'final_approver'
         ) THEN 'PASS' ELSE 'FAIL' END, ''

  -- ── claim_status values: under_quality_review + under_project_manager_review ──
  UNION ALL
  SELECT 'claim_status enum has "under_quality_review"',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_quality_review'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'claim_status enum has "under_project_manager_review"',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = 'claim_status' AND e.enumlabel = 'under_project_manager_review'
         ) THEN 'PASS' ELSE 'FAIL' END, ''

  -- ── Claim numbering / atomic RPC ──
  UNION ALL
  SELECT 'function create_claim_with_items_atomic exists',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'create_claim_with_items_atomic' AND n.nspname = 'public'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'function submit_claim_atomic exists',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.proname = 'submit_claim_atomic' AND n.nspname = 'public'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'claims.claim_number column exists',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'claims' AND column_name = 'claim_number'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'claims.claim_kind column exists',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'claims' AND column_name = 'claim_kind'
         ) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'partial unique index ux_claims_claim_number exists',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = 'ux_claims_claim_number'
         ) THEN 'PASS' ELSE 'FAIL' END, ''

  -- ── 3-tuple unique on user_contract_roles (Migration 045 invariant) ──
  UNION ALL
  SELECT '3-tuple UNIQUE on user_contract_roles(user_id,contract_id,contract_role)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'user_contract_roles'
              AND c.contype = 'u'
              AND (
                SELECT array_agg(att.attname ORDER BY att.attnum)
                  FROM unnest(c.conkey) AS k
                  JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = k
              ) @> ARRAY['user_id','contract_id','contract_role']::text[]
         ) THEN 'PASS' ELSE 'FAIL' END, ''

  -- ── Seed sanity ──
  UNION ALL
  SELECT 'profiles seeded (≥ 6 rows)',
         CASE WHEN (SELECT COUNT(*) FROM public.profiles) >= 6 THEN 'PASS' ELSE 'FAIL' END,
         'count = ' || (SELECT COUNT(*)::text FROM public.profiles)
  UNION ALL
  SELECT 'CMH_01-C01 contract present',
         CASE WHEN EXISTS (SELECT 1 FROM public.contracts WHERE contract_no = 'CMH_01-C01')
              THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL
  SELECT 'auth users seeded (≥ 6 rows)',
         CASE WHEN (SELECT COUNT(*) FROM auth.users) >= 6 THEN 'PASS' ELSE 'FAIL' END,
         'count = ' || (SELECT COUNT(*)::text FROM auth.users)
)
SELECT check_name, status, details
FROM checks
ORDER BY
  CASE status WHEN 'FAIL' THEN 0 WHEN 'PASS' THEN 1 ELSE 2 END,
  check_name;
