-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 05 — MIGRATION
--  Source seq      : 006
--  Source migration: migrations/006_convera_users_otp.sql
--  Purpose         : CONVERA_USERS + OTP
--  Run order       : STEP 5 of 48 (after STEP 4, before STEP 6).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Prototype Auth Tables (convera_users + convera_otp)
--  File:    006_convera_users_otp.sql
--
--  Run order: 6 (after 005_rls_prototype_access.sql)
--  Depends on: 001_base_schema.sql (profiles table, user_role enum)
--
--  Purpose:
--    The vanilla-JS frontend prototype uses a custom auth flow:
--      1. Login via convera_users (email + password)
--      2. OTP verification via convera_otp
--      3. Bridge to profiles table for FK references
--
--    These tables are NOT part of the core CONVERA domain model.
--    They exist solely to support the prototype's auth mechanism.
--
--  PRODUCTION PATH:
--    When migrating to Supabase Auth (recommended for production):
--      1. Create auth.users entries for each user
--      2. The on_auth_user_created trigger auto-creates profiles rows
--      3. Use supabase.auth.signInWithPassword() in the frontend
--      4. Remove convera_users and convera_otp tables
--      5. Remove 005_rls_prototype_access.sql permissive policies
--
--  SECURITY NOTE:
--    convera_users.password_hash stores PLAIN TEXT passwords.
--    This is acceptable ONLY for the prototype/internal testing phase.
--    Never use this pattern in production.
--
--  Idempotency: CREATE TABLE IF NOT EXISTS + ON CONFLICT on inserts.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. convera_users — Prototype authentication table
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS convera_users (
  id             BIGSERIAL    PRIMARY KEY,
  email          TEXT         NOT NULL UNIQUE,
  password_hash  TEXT         NOT NULL,         -- PLAIN TEXT (prototype only!)
  name           TEXT         NOT NULL,
  name_ar        TEXT,
  role           TEXT         NOT NULL DEFAULT 'subuser'
    CONSTRAINT convera_users_role_check
    CHECK (role IN ('director', 'auditor', 'admin', 'consultant', 'contractor', 'subuser')),
  phone          TEXT,
  phone_masked   TEXT,
  avatar         TEXT,                          -- single character for avatar circle
  avatar_color   TEXT         DEFAULT '#026D69',
  contract_no    TEXT,                          -- links user to a contract
  organization   TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  approved       BOOLEAN      NOT NULL DEFAULT true,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE convera_users IS
  'Prototype-only authentication table. NOT for production use. '
  'Production should use Supabase Auth (auth.users) with proper hashing. '
  'Bridges to profiles table via email match for UUID-based FK references.';


-- ─────────────────────────────────────────────────────────────────
--  B. convera_otp — One-time password verification
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS convera_otp (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     BIGINT       NOT NULL REFERENCES convera_users(id) ON DELETE CASCADE,
  code        TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used        BOOLEAN      NOT NULL DEFAULT false,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_convera_otp_user   ON convera_otp(user_id, used);
CREATE INDEX IF NOT EXISTS idx_convera_otp_expire ON convera_otp(expires_at);

COMMENT ON TABLE convera_otp IS
  'OTP codes for convera_users login flow. '
  'In prototype: OTP is displayed on-screen (no SMS). '
  'Production: use Supabase Auth MFA or Twilio integration.';


-- ─────────────────────────────────────────────────────────────────
--  C. RLS — Open access for prototype (matches 005 pattern)
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE convera_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE convera_otp   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_all_convera_users" ON convera_users;
CREATE POLICY "public_all_convera_users"
  ON convera_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_all_convera_otp" ON convera_otp;
CREATE POLICY "public_all_convera_otp"
  ON convera_otp FOR ALL USING (true) WITH CHECK (true);

-- Grant anon access (Supabase anon key)
GRANT SELECT, INSERT, UPDATE, DELETE ON convera_users TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON convera_otp   TO anon;
GRANT USAGE ON SEQUENCE convera_users_id_seq TO anon;
GRANT USAGE ON SEQUENCE convera_otp_id_seq   TO anon;


-- ─────────────────────────────────────────────────────────────────
--  D. updated_at trigger
-- ─────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_convera_users_updated_at
  BEFORE UPDATE ON convera_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
