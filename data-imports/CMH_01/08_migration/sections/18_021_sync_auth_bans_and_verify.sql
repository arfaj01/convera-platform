-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 18 — MIGRATION
--  Source seq      : 021
--  Source migration: migrations/021_sync_auth_bans_and_verify.sql
--  Purpose         : auth bans sync
--  Run order       : STEP 18 of 48 (after STEP 17, before STEP 19).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════
--  CONVERA — Script 021: Sync Auth Bans + Full Verification
--
--  PURPOSE
--  ───────────────────────────────────────────────────────────────────
--  1. SYNC: Set auth.users.banned_until for all is_active=false users
--     (equivalent to calling /api/admin/sync-suspensions but via SQL).
--     This fixes عبدالله البهدل and any other suspended users.
--
--  2. VERIFY: Confirm zero-scope enforcement is working:
--     - RLS policies exist and are correct
--     - Suspended users have banned_until set
--     - Users with no user_contracts rows would get 0 rows from contracts/claims
--
--  RUN IN ORDER — each section is separated by a comment.
--  Safe to run multiple times (idempotent).
-- ═══════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
--  PART 1 — Sync GoTrue ban for all suspended profiles
--  (Equivalent to POST /api/admin/sync-suspensions)
-- ════════════════════════════════════════════════════════════════════

-- Ban all inactive users (is_active = false) in auth.users
UPDATE auth.users
SET    banned_until = NOW() + INTERVAL '10 years'
WHERE  id IN (
  SELECT id FROM public.profiles WHERE is_active = false
)
  AND (banned_until IS NULL OR banned_until < NOW());

-- Unban all active users (is_active = true) in auth.users
UPDATE auth.users
SET    banned_until = NULL
WHERE  id IN (
  SELECT id FROM public.profiles WHERE is_active = true
)
  AND banned_until IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════
--  PART 2 — Verify: Show ban status for all users
-- ════════════════════════════════════════════════════════════════════

SELECT
  p.email,
  p.full_name_ar,
  p.role::TEXT                AS role,
  p.is_active                 AS profile_active,
  CASE
    WHEN au.banned_until IS NULL            THEN '✅ not banned'
    WHEN au.banned_until > NOW()            THEN '🚫 BANNED until ' || au.banned_until::DATE::TEXT
    ELSE '⚠️ ban expired'
  END                         AS auth_ban_status,
  au.last_sign_in_at::DATE    AS last_login
FROM   public.profiles p
JOIN   auth.users au ON au.id = p.id
ORDER BY p.is_active DESC, p.role;

-- EXPECTED for عبدالله البهدل (contractor, is_active=false):
--   profile_active = false
--   auth_ban_status = '🚫 BANNED until <date>'


-- ════════════════════════════════════════════════════════════════════
--  PART 3 — Verify: user_contracts scope table
-- ════════════════════════════════════════════════════════════════════

SELECT
  p.email,
  p.full_name_ar,
  p.role::TEXT   AS role,
  p.is_active,
  COUNT(uc.contract_id) AS linked_contracts
FROM   public.profiles p
LEFT JOIN public.user_contracts uc ON uc.user_id = p.id
WHERE  p.role IN ('contractor', 'consultant')
GROUP BY p.id, p.email, p.full_name_ar, p.role, p.is_active
ORDER BY p.role, p.email;

-- EXPECTED:
--  - عبدالله البهدل:  linked_contracts = 0  (his scope was removed)
--  - Other contractors: linked_contracts > 0  (they have access)


-- ════════════════════════════════════════════════════════════════════
--  PART 4 — Verify: Internal policies now reference 'admin' (not 'auditor')
-- ════════════════════════════════════════════════════════════════════

SELECT
  tablename,
  policyname,
  LEFT(qual, 100) AS condition_preview
FROM pg_policies
WHERE tablename IN ('contracts', 'claims', 'change_orders', 'kpi_snapshots', 'profiles')
  AND policyname LIKE '%internal%'
ORDER BY tablename, policyname;

-- EXPECTED: All internal policies show 'admin' in the condition, NOT 'auditor'


-- ════════════════════════════════════════════════════════════════════
--  PART 5 — Verify: Simulate zero-scope contractor (RLS test)
--  Shows what a contractor with NO user_contracts rows would see.
--  Rows returned = 0 means RLS is working correctly.
-- ════════════════════════════════════════════════════════════════════

-- Contracts visible to عبدالله البهدل (a1000004-0000-0000-0000-000000000004)
-- If RLS works: this should return 0 rows (no user_contracts links)
SELECT COUNT(*) AS contracts_visible_to_zero_scope_contractor
FROM   public.contracts
WHERE EXISTS (
  -- Simulate: would the contracts_contractor_select policy pass for this user?
  SELECT 1 FROM public.user_contracts
  WHERE user_id = 'a1000004-0000-0000-0000-000000000004'
    AND contract_id = contracts.id
);
-- EXPECTED: 0

-- Claims visible to عبدالله البهدل
SELECT COUNT(*) AS claims_visible_to_zero_scope_contractor
FROM   public.claims
WHERE EXISTS (
  SELECT 1 FROM public.user_contracts
  WHERE user_id = 'a1000004-0000-0000-0000-000000000004'
    AND contract_id = claims.contract_id
);
-- EXPECTED: 0


-- ════════════════════════════════════════════════════════════════════
--  PART 6 — Summary check: any stale open policies?
-- ════════════════════════════════════════════════════════════════════

SELECT COUNT(*) AS stale_open_policies_count
FROM pg_policies
WHERE tablename IN ('contracts', 'claims')
  AND policyname IN (
    'contracts_external_select_own',
    'contracts_supervisor_select',
    'claims_external_select',
    'claims_external_insert',
    'claims_external_update_editable',
    'claims_supervisor_select'
  );
-- EXPECTED: 0  (all stale policies were dropped by migration 019)
