-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 35 — MIGRATION
--  Source seq      : 042
--  Source migration: migrations/042_extend_enums_for_template_v7.sql
--  Purpose         : enum extension (full version)
--  Run order       : STEP 35 of 48 (after STEP 34, before STEP 36).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- Migration 042: Extend Enums + Add exec_sql RPC for Future Automation
-- Date: 2026-04-27
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. توسيع contract_type enum بـ 4 قيم جديدة ───────────────────
DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'furniture_supply';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'operations';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'mixed_services';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'rehabilitation';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ─── 2. توسيع contract_status بـ 'on_hold' ────────────────────────
DO $$ BEGIN
  ALTER TYPE contract_status ADD VALUE IF NOT EXISTS 'on_hold' AFTER 'suspended';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

COMMIT;

-- ─── 3. إنشاء exec_sql RPC للأتمتة المستقبلية ─────────────────────
-- (يُشغَّل بعد COMMIT لأن CREATE FUNCTION في schema منفصل)

CREATE OR REPLACE FUNCTION public.exec_sql(sql_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  -- فقط service_role يمكنها استدعاء هذه الدالة
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: only service_role may execute SQL';
  END IF;

  EXECUTE sql_query;
  result := '{"success": true}'::jsonb;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'state', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.exec_sql(TEXT) IS
  'Service-role-only SQL executor for migrations and admin tasks.';

-- ─── 4. التحقق ────────────────────────────────────────────────────
SELECT
  'contract_type' as type_name,
  array_agg(enumlabel ORDER BY enumsortorder) as values
FROM pg_enum
WHERE enumtypid = 'contract_type'::regtype
UNION ALL
SELECT
  'contract_status',
  array_agg(enumlabel ORDER BY enumsortorder)
FROM pg_enum
WHERE enumtypid = 'contract_status'::regtype;
