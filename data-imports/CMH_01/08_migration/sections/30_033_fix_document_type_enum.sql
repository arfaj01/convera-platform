-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 30 — MIGRATION
--  Source seq      : 033
--  Source migration: migrations/033_fix_document_type_enum.sql
--  Purpose         : document_type enum fix
--  Run order       : STEP 30 of 48 (after STEP 29, before STEP 31).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 033: Fix document_type Enum
--
--  ROOT CAUSE:
--    Migration 030 assumed documents.type was TEXT, but it's actually
--    the document_type ENUM. Inserting 'completion_certificate' fails
--    with "invalid input value for enum document_type".
--
--  FIX:
--    Add 'completion_certificate' to the document_type enum.
--
--  IDEMPOTENT: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════

-- Add missing enum value
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'completion_certificate';

-- Verify
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'document_type'::regtype
ORDER BY enumsortorder;
