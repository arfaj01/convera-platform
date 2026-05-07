-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 19 — MIGRATION
--  Source seq      : 022
--  Source migration: migrations/022_fix_profiles_recursion.sql
--  Purpose         : profiles RLS recursion fix
--  Run order       : STEP 19 of 48 (after STEP 18, before STEP 20).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Migration 022: Fix profiles_internal_select infinite recursion
--
--  BUG: Migration 020 created profiles_internal_select with a sub-query
--       that reads FROM profiles — but the sub-query itself is subject
--       to RLS on profiles, causing PostgreSQL error 42P17:
--       "infinite recursion detected in policy for relation profiles"
--
--  FIX: Use is_internal() which is a SECURITY DEFINER function.
--       SECURITY DEFINER functions execute with the privileges of the
--       function owner (postgres) and bypass RLS. This breaks the
--       recursion cycle while still enforcing the correct role check.
--
--  CRITICAL: Run immediately — the platform is completely down.
-- ═══════════════════════════════════════════════════════════════════════

-- Drop the broken policy
DROP POLICY IF EXISTS "profiles_internal_select" ON profiles;

-- Recreate using is_internal() — no recursion because SECURITY DEFINER
-- bypasses RLS when querying profiles inside the function body.
CREATE POLICY "profiles_internal_select"
  ON profiles FOR SELECT
  USING (is_internal());
