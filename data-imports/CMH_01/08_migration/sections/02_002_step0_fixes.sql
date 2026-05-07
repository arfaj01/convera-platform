-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 02 — MIGRATION
--  Source seq      : 002
--  Source migration: migrations/002_step0_fixes.sql
--  Purpose         : step 0 fixes + storage buckets
--  Run order       : STEP 2 of 48 (after STEP 1, before STEP 3).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Step 0 Fixes & Storage Setup
--  File:    002_step0_fixes.sql
--
--  Run order: 2 of 4 (bootstrap sequence)
--  Depends on: 001_base_schema.sql
--
--  Bootstrap safe: all DROP IF EXISTS, INSERT ON CONFLICT DO NOTHING.
--  Safe to run multiple times.
--
--  Contents:
--    A. Fix: claims_external_update_editable
--         — Policy in 001 already includes the correct fix.
--           This section documents the intent and adds a belt-and-suspenders
--           guard in case the 001 policy text diverges.
--    B. Fix: workflow_external_insert (already correct in 001)
--    C. Storage buckets — documents and avatars
--    D. Storage RLS policies
--
--  Note on idempotency:
--    DROP POLICY IF EXISTS before CREATE handles re-runs safely.
--    INSERT INTO storage.buckets uses ON CONFLICT DO NOTHING.
--    Storage policies use DROP/CREATE for clean re-execution.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  A. CLAIM EXTERNAL UPDATE POLICY
--
--  Confirmed correct in 001_base_schema.sql as
--  "claims_external_update_editable". Documented here for traceability.
--
--  Rule summary:
--    USING:      (created_by = me OR submitted_by = me)
--                AND status IN (draft | returned_by_consultant | returned_by_admin)
--    WITH CHECK: same user condition
--                AND status IN (draft | returned_by_consultant | returned_by_admin | submitted)
--
--  The WITH CHECK allows the transition draft→submitted (the submit action),
--  but not draft→approved or any other escalation (those use service role).
-- ─────────────────────────────────────────────────────────────────

-- Idempotent re-assert (drop and recreate to ensure canonical state)
DROP POLICY IF EXISTS "claims_external_update_editable" ON claims;
DROP POLICY IF EXISTS "claims_external_update_draft"    ON claims;  -- legacy name

CREATE POLICY "claims_external_update_editable"
  ON claims FOR UPDATE
  USING (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin')
  )
  WITH CHECK (
    (created_by = auth.uid() OR submitted_by = auth.uid())
    AND status IN ('draft', 'returned_by_consultant', 'returned_by_admin', 'submitted')
  );


-- ─────────────────────────────────────────────────────────────────
--  B. WORKFLOW EXTERNAL INSERT POLICY
--
--  Confirmed correct in 001_base_schema.sql as "workflow_external_insert".
--  Canonical state: external users may INSERT only submit/resubmit/comment
--  entries for claims on their own contracts.
--  Internal workflow entries (review, forward, approve, reject) are written
--  via the Supabase service role client in server actions, bypassing RLS.
-- ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "workflow_external_insert" ON claim_workflow;

CREATE POLICY "workflow_external_insert"
  ON claim_workflow FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND action IN ('submit', 'resubmit', 'comment')
    AND claim_id IN (
      SELECT c.id
      FROM   claims c
      JOIN   contracts ct ON c.contract_id = ct.id
      WHERE  ct.external_user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────
--  C. STORAGE BUCKETS
--
--  documents: private bucket for claim attachments (PDFs, invoices, etc.)
--  avatars:   public bucket for profile pictures
--
--  Limits:
--    documents: 50 MB per file, restricted MIME types
--    avatars:   5 MB per file, images only
-- ─────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,         -- 50 MB per file
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
),
(
  'avatars',
  'avatars',
  true,
  5242880,          -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────
--  D. STORAGE RLS POLICIES
--
--  documents bucket:
--    - Any authenticated user can upload (server action enforces contract linkage)
--    - Any authenticated user can read (RLS on the documents table controls visibility)
--    - Only the uploader or an internal admin/director can delete
--
--  avatars bucket:
--    - Public read (avatars are public images)
--    - Any authenticated user can upload to their own folder ({uid}/*)
-- ─────────────────────────────────────────────────────────────────

-- Drop existing storage policies before recreating (idempotent)
DROP POLICY IF EXISTS "storage_documents_upload"        ON storage.objects;
DROP POLICY IF EXISTS "storage_documents_select"        ON storage.objects;
DROP POLICY IF EXISTS "storage_documents_delete"        ON storage.objects;
DROP POLICY IF EXISTS "storage_avatars_public_read"     ON storage.objects;
DROP POLICY IF EXISTS "storage_avatars_upload_own"      ON storage.objects;


CREATE POLICY "storage_documents_upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "storage_documents_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "storage_documents_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND (
      -- The uploader can delete their own files
      owner = auth.uid()
      -- Internal admins can delete any document
      OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('director', 'admin')
    )
  );

CREATE POLICY "storage_avatars_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "storage_avatars_upload_own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid() IS NOT NULL
    -- File must be in the authenticated user's own folder
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
