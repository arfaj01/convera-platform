-- ═════════════════════════════════════════════════════════════════════════
--  CONVERA — IAM / RBAC User Health Diagnostic
--  File:        SQL/diagnostics/iam_user_health.sql
--
--  Purpose
--  -------
--  Read-only diagnostic queries that surface drift across the three
--  identity surfaces:
--
--    1. Supabase Auth (auth.users + auth.identities)  — sign-in only
--    2. profiles                                      — coarse global role
--    3. user_contract_roles + contract_approvers      — contract-scoped
--
--  Origin
--  ------
--  Authored 2026-05-05 as part of the IAM/RBAC stabilization audit
--  (logs/IAM_RBAC_STABILIZATION_AUDIT.md §2.2). The queries below are
--  the same six diagnostics referenced by IDs D1 … D6 in that report.
--
--  Properties
--  ----------
--  • READ-ONLY. No INSERT, UPDATE, DELETE, ALTER, DROP, GRANT, or
--    auth-schema mutation anywhere in this file. Verified by the
--    accompanying playbook in logs/IAM_DIAGNOSTIC_PLAYBOOK.md.
--  • Idempotent and safe to re-run as often as needed.
--  • Does NOT print or expose any secret material (no password
--    columns, no JWT, no service-role key, no encrypted_password
--    selection).
--
--  Audience
--  --------
--  Operator + on-call DBA, running through Supabase SQL Editor as
--  service_role / postgres.
--
--  How to use
--  ----------
--  Run each block individually and capture the output. Compare
--  results against the "Expected" comment under each block. Any
--  unexpected row pattern is a finding to flag.
--
--  These queries do NOT repair anything. Repairs go through:
--     scripts/create-test-auth-users.js   (Supabase Admin API only)
--   and
--     /api/admin/users/*                  (server-side, audit-logged)
-- ═════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
--  D1 — Auth users that should exist (8 test users)
-- ════════════════════════════════════════════════════════════════════
--
--  Confirms presence, email-confirmed, banned/active status and
--  last sign-in time for the 8 Phase-2.6 smoke-test users. Joins
--  auth.identities to count the email-provider rows (must be exactly
--  one per user).
--
--  Expected:
--    8 rows;
--    email_confirmed = true on every row;
--    banned_until    IS NULL or in the past on every row;
--    email_identities = 1 on every row.
--
--  Anything else: re-run scripts/create-test-auth-users.js (Admin API)
--  to repair, then re-run this query.

SELECT u.email,
       u.id                                     AS auth_user_id,
       u.email_confirmed_at IS NOT NULL          AS email_confirmed,
       u.banned_until,
       u.last_sign_in_at,
       (SELECT count(*) FROM auth.identities i
         WHERE i.user_id = u.id AND i.provider = 'email')
                                                AS email_identities
  FROM auth.users u
 WHERE lower(u.email) IN (
   'ma.alarfaj@momah.gov.sa',
   'halhablayn-contractor@momah.gov.sa',
   'aaldera-contractor@momah.gov.sa',
   'anaalghamdi-contractor@momah.gov.sa',
   'mahmoud.ragab@beeah.sa',
   'info@gdci.com.sa',
   'fakher@alleanzaa.com',
   'malek.h.mkh@gmail.com'
 )
 ORDER BY u.email;

-- ════════════════════════════════════════════════════════════════════
--  D2 — Auth identity drift
-- ════════════════════════════════════════════════════════════════════
--
--  Finds any (user_id, provider='email') with a row count != 1.
--  GoTrue assumes exactly one email identity per user; deviations
--  produce hard-to-diagnose 'Database error querying schema' errors
--  at sign-in.
--
--  Expected: ZERO rows.
--  Any row → escalate. Repair via scripts/create-test-auth-users.js
--  (the Admin API path is the only sanctioned way to reconcile).

SELECT i.user_id,
       u.email,
       count(*)            AS identity_rows,
       array_agg(i.id)     AS identity_ids
  FROM auth.identities i
  JOIN auth.users u ON u.id = i.user_id
 WHERE i.provider = 'email'
 GROUP BY i.user_id, u.email
HAVING count(*) <> 1
 ORDER BY count(*) DESC;

-- ════════════════════════════════════════════════════════════════════
--  D3 — Profile drift  (auth ↔ profiles 1:1 invariant)
-- ════════════════════════════════════════════════════════════════════
--
--  An auth.users row without a matching profiles row, or vice-versa,
--  breaks the application's identity assumption. The most common
--  cause is a manual profile insert / a deleted auth user / a stale
--  test fixture.
--
--  Expected: ZERO rows.
--  - 'auth_user_no_profile' → user can sign in but the app cannot
--    look up their role; UI will show 'Profile not found'.
--  - 'profile_no_auth_user' → orphan profile; sign-in fails with
--    'Database error querying schema'.

SELECT 'auth_user_no_profile' AS issue, u.email, u.id AS subject_id
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
 WHERE p.id IS NULL
UNION ALL
SELECT 'profile_no_auth_user' AS issue, p.email, p.id AS subject_id
  FROM profiles p
  LEFT JOIN auth.users u ON u.id = p.id
 WHERE u.id IS NULL
 ORDER BY issue;

-- ════════════════════════════════════════════════════════════════════
--  D4 — Per-test-user role health
-- ════════════════════════════════════════════════════════════════════
--
--  One row per test user. Shows:
--    - profile_role       (the coarse global role)
--    - profile_active     (false → user is suspended)
--    - contract_roles_active  (the per-contract role set, post Mig 045)
--    - contract_nos_active    (the contracts the user is scoped to)
--    - final_approver_count   (active rows in contract_approvers)
--
--  Expected: every test user that should be operational has a non-NULL
--  profile_role, profile_active=true, and the contract_roles_active
--  set documented in §3.3 of the seeding rules.

SELECT p.email,
       p.role                                       AS profile_role,
       p.is_active                                  AS profile_active,
       array_agg(DISTINCT ucr.contract_role)
         FILTER (WHERE ucr.is_active)               AS contract_roles_active,
       array_agg(DISTINCT c.contract_no)
         FILTER (WHERE ucr.is_active)               AS contract_nos_active,
       (SELECT count(*) FROM contract_approvers a
         WHERE a.user_id = p.id
           AND a.approval_scope = 'final_approver'
           AND a.is_active)                         AS final_approver_count
  FROM profiles p
  LEFT JOIN user_contract_roles ucr
    ON ucr.user_id = p.id
  LEFT JOIN contracts c
    ON c.id = ucr.contract_id
 WHERE lower(p.email) IN (
   'ma.alarfaj@momah.gov.sa',
   'halhablayn-contractor@momah.gov.sa',
   'aaldera-contractor@momah.gov.sa',
   'anaalghamdi-contractor@momah.gov.sa',
   'mahmoud.ragab@beeah.sa',
   'info@gdci.com.sa',
   'fakher@alleanzaa.com',
   'malek.h.mkh@gmail.com'
 )
 GROUP BY p.id, p.email, p.role, p.is_active
 ORDER BY p.email;

-- ════════════════════════════════════════════════════════════════════
--  D5 — Multi-role cross-check (LEGAL post Migration 045)
-- ════════════════════════════════════════════════════════════════════
--
--  Lists every (user, contract) pair that holds more than one active
--  role. Migration 045 widened user_contract_roles's UNIQUE key from
--  (user_id, contract_id) to (user_id, contract_id, contract_role) to
--  allow this. The query is a SNAPSHOT — the presence of multi-role
--  pairs is itself NOT an error; it is the expected state for the
--  reviewer+quality / project_manager+reviewer / etc. test users.
--
--  Useful for: confirming the modal save actually wrote the rows the
--  director assigned, and confirming the workflow queue page exposes
--  the right chip set for those users.

SELECT ucr.user_id, p.email,
       ucr.contract_id, c.contract_no,
       array_agg(ucr.contract_role ORDER BY ucr.contract_role) AS roles,
       count(*)                                                 AS role_count
  FROM user_contract_roles ucr
  JOIN profiles  p ON p.id = ucr.user_id
  JOIN contracts c ON c.id = ucr.contract_id
 WHERE ucr.is_active
 GROUP BY ucr.user_id, p.email, ucr.contract_id, c.contract_no
HAVING count(*) > 1
 ORDER BY p.email, c.contract_no;

-- ════════════════════════════════════════════════════════════════════
--  D6 — user_contract_roles UNIQUE constraint shape
-- ════════════════════════════════════════════════════════════════════
--
--  Confirms the UNIQUE key matches Migration 045's expectation:
--  (user_id, contract_id, contract_role). If this returns the OLD
--  2-tuple key, every multi-role insert/upsert from /api/admin/users
--  POST will silently fail with Postgres 42P10 ('no unique or
--  exclusion constraint matching the ON CONFLICT specification').
--
--  Expected:
--    1 row;
--    pg_get_constraintdef contains the substring
--      '(user_id, contract_id, contract_role)'
--    (column order may vary; presence of all three is what matters).

SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.user_contract_roles'::regclass
   AND contype  = 'u';

-- ═════════════════════════════════════════════════════════════════════════
--  End of read-only diagnostic.  No mutation SQL exists in this file.
-- ═════════════════════════════════════════════════════════════════════════
