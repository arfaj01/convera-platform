-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 31 — MIGRATION
--  Source seq      : 034
--  Source migration: migrations/034_audit_helper_function.sql
--  Purpose         : audit helper function
--  Run order       : STEP 31 of 48 (after STEP 30, before STEP 32).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 034: Audit Logging Helper Function
--
--  PURPOSE:
--    Provide a single, safe entry point for all audit logging.
--    Eliminates schema mismatches by centralizing column names.
--    Exception-safe: audit failure NEVER crashes the main transaction.
--
--  SCHEMA (actual production audit_logs):
--    entity_type  TEXT
--    entity_id    UUID
--    action       audit_action ENUM
--    actor_id     UUID
--    actor_email  TEXT
--    actor_role   USER-DEFINED
--    entity_label TEXT
--    old_values   JSONB
--    new_values   JSONB
--    metadata     JSONB
--    ip_address   INET
--    user_agent   TEXT
--    created_at   TIMESTAMPTZ
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION log_audit_event(
  p_entity_type   TEXT,
  p_entity_id     UUID,
  p_action        TEXT,
  p_actor_id      UUID,
  p_old_values    JSONB DEFAULT '{}'::JSONB,
  p_new_values    JSONB DEFAULT '{}'::JSONB,
  p_metadata      JSONB DEFAULT '{}'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_email TEXT;
  v_actor_role  TEXT;
BEGIN
  -- Resolve actor details (best-effort)
  BEGIN
    SELECT email, role::TEXT
    INTO v_actor_email, v_actor_role
    FROM profiles
    WHERE id = p_actor_id;
  EXCEPTION WHEN OTHERS THEN
    v_actor_email := 'unknown';
    v_actor_role  := 'unknown';
  END;

  -- Insert audit log entry (exception-safe)
  BEGIN
    INSERT INTO audit_logs (
      entity_type,
      entity_id,
      action,
      actor_id,
      actor_email,
      actor_role,
      entity_label,
      old_values,
      new_values,
      metadata,
      ip_address,
      created_at
    ) VALUES (
      p_entity_type,
      p_entity_id,
      p_action::audit_action,
      p_actor_id,
      COALESCE(v_actor_email, 'unknown'),
      v_actor_role,
      p_entity_type || ':' || p_entity_id::TEXT,
      p_old_values,
      p_new_values,
      p_metadata || jsonb_build_object('source_function', 'log_audit_event'),
      '0.0.0.0'::INET,
      NOW()
    );
  EXCEPTION WHEN OTHERS THEN
    -- NEVER crash the main transaction — log warning only
    RAISE WARNING '[log_audit_event] AUDIT INSERT FAILED: % — entity=%:% action=% actor=%',
      SQLERRM, p_entity_type, p_entity_id, p_action, p_actor_id;
  END;
END;
$$;

COMMENT ON FUNCTION log_audit_event IS
  'Exception-safe audit logging helper. Centralizes audit_logs schema. '
  'If audit INSERT fails, logs a WARNING but does NOT break the calling transaction.';

-- ── Verification ─────────────────────────────────────────────────

-- Verify function exists
SELECT proname, prosecdef
FROM pg_proc
WHERE proname = 'log_audit_event';

-- Quick smoke test (should succeed silently)
SELECT log_audit_event(
  'test',
  '00000000-0000-0000-0000-000000000000'::UUID,
  'create',
  '00000000-0000-0000-0000-000000000000'::UUID,
  '{}'::JSONB,
  '{"test": true}'::JSONB,
  '{"smoke_test": true}'::JSONB
);

-- Verify the test row was inserted
SELECT entity_type, action, metadata->>'smoke_test' AS smoke
FROM audit_logs
WHERE entity_type = 'test'
ORDER BY created_at DESC
LIMIT 1;

-- Clean up smoke test row
DELETE FROM audit_logs WHERE entity_type = 'test';
