-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 00 — Pre-flight guard
--  Source seq      : preflight
--  Source migration: (synthetic — embedded in bundle header)
--  Purpose         : Refuse to run on production project ref. Always run FIRST.
--  Run order       : Before any other section
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" (no row output expected).
--  On error: STOP. Verify Supabase URL contains jrqkzwacerdudmeacvar.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE prod_marker TEXT := 'ngwxlockzkjpmzuvgakx';
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_settings
    WHERE setting LIKE '%' || prod_marker || '%'
       OR name    LIKE '%' || prod_marker || '%'
  ) THEN
    RAISE EXCEPTION 'ABORT — staging bundle must NEVER be applied on production project ref %', prod_marker;
  END IF;
END $$;
