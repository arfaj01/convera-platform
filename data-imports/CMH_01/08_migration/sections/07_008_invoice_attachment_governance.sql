-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 07 — MIGRATION
--  Source seq      : 008
--  Source migration: migrations/008_invoice_attachment_governance.sql
--  Purpose         : invoice attachment governance
--  Run order       : STEP 7 of 48 (after STEP 6, before STEP 8).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 008: Invoice Attachment Governance
--
--  Business Rule: A financial claim CANNOT transition to 'submitted'
--  unless an approved invoice document (type='invoice') is attached.
--
--  Enforcement layers:
--  1. Database trigger: blocks UPDATE to status='submitted' if no invoice
--  2. RLS: prototype access for documents table
--  3. Application: validate() checks on frontend
--
--  Run order: 8 (after 007)
--  Safe to run multiple times (all operations are idempotent)
-- ═══════════════════════════════════════════════════════════════════


-- ─── 1. Database trigger: enforce invoice before submission ─────

CREATE OR REPLACE FUNCTION enforce_invoice_before_submission()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_count INT;
BEGIN
  -- Only enforce when transitioning TO 'submitted'
  IF NEW.status = 'submitted' AND (OLD.status IS DISTINCT FROM 'submitted') THEN
    SELECT COUNT(*) INTO v_invoice_count
    FROM documents
    WHERE claim_id = NEW.id
      AND type = 'invoice';

    IF v_invoice_count = 0 THEN
      RAISE EXCEPTION 'لا يمكن تقديم المطالبة المالية بدون إرفاق الفاتورة المعتمدة'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists then recreate
DROP TRIGGER IF EXISTS trg_enforce_invoice_before_submission ON claims;
CREATE TRIGGER trg_enforce_invoice_before_submission
  BEFORE UPDATE ON claims
  FOR EACH ROW
  EXECUTE FUNCTION enforce_invoice_before_submission();


-- ─── 2. RLS for documents table (prototype access) ─────────────

-- Allow full access for prototype (same as other tables in 005)
DROP POLICY IF EXISTS "public_all_documents" ON documents;
CREATE POLICY "public_all_documents"
  ON documents FOR ALL USING (true) WITH CHECK (true);

-- Grant access to anon role
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON documents TO authenticated;


-- ─── 3. Verification ───────────────────────────────────────────

-- Verify trigger exists
SELECT tgname, tgtype, tgenabled
FROM pg_trigger
WHERE tgrelid = 'claims'::regclass
  AND tgname = 'trg_enforce_invoice_before_submission';

-- Verify documents RLS
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'documents'
  AND schemaname = 'public';
