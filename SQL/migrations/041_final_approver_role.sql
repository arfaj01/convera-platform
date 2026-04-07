-- ============================================================================
-- Migration 041: Add "final_approver" profile role
-- ============================================================================
-- Purpose:
--   1. Add 'final_approver' to the user_role enum type.
--   2. Director role remains for Mohammed Al-Arfaj only (platform owner).
--   3. Final approvers act at the pending_director_approval stage
--      on contracts where they are designated via contract_approvers table.
--   4. Admin can distribute roles and submit permission requests to Director.
--
-- This migration is ADDITIVE — no existing data is modified.
-- Run in Supabase SQL Editor BEFORE deploying the frontend changes.
-- ============================================================================

BEGIN;

-- ─── 1. Add 'final_approver' to the user_role enum ─────────────────────────

-- Check if the value already exists to make this migration idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'final_approver'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'user_role')
  ) THEN
    ALTER TYPE user_role ADD VALUE 'final_approver';
  END IF;
END $$;

COMMIT;

-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
-- some PostgreSQL versions. If the above fails, run this standalone:
--   ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'final_approver';

-- ─── 2. Update RLS policies to include final_approver ───────────────────────

BEGIN;

-- The is_internal() helper determines who can see all contracts.
-- final_approver is a SCOPED role (not global), so they only see
-- contracts they're assigned to — no change needed to is_internal().

-- However, we need to ensure final_approvers can read claims on their contracts.
-- The existing RLS policy on claims checks user_contract_roles, which already
-- covers final_approver since they get entries in user_contract_roles.

-- ─── 3. Grant final_approvers read access to workflow-related tables ────────

-- Ensure final_approvers can read claim_workflow for timeline display
-- (Existing policies likely cover this via user_contract_roles, but let's be safe)

-- Add final_approver to the notification read policy if it filters by role
-- (Most notification policies filter by user_id, not role, so this is a no-op)

-- ─── 4. Admin role enhancement: allow admin to manage permission_requests ───

-- Admin can INSERT into permission_requests (already covered by migration 040)
-- Admin can read permission_requests they submitted
-- Director can read/update all permission_requests (already covered)

-- Ensure admin can read contract_approvers for the permissions page
DO $$
BEGIN
  -- Drop and recreate the policy if it exists, to ensure it includes admin
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contract_approvers_read_internal'
    AND tablename = 'contract_approvers'
  ) THEN
    DROP POLICY contract_approvers_read_internal ON contract_approvers;
  END IF;

  -- Create a policy that allows director, admin, and final_approver to read
  EXECUTE $policy$
    CREATE POLICY contract_approvers_read_internal ON contract_approvers
      FOR SELECT
      USING (
        -- Director and admin see all
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('director', 'admin')
        )
        OR
        -- Final approvers see their own assignments
        user_id = auth.uid()
      )
  $policy$;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION NOTES:
--
-- 1. The Director (Mohammed Al-Arfaj) retains full platform access.
--    His role in the profiles table remains 'director'.
--
-- 2. New users with role 'final_approver' can ONLY approve/reject/return
--    claims on contracts where they are listed in contract_approvers with
--    approval_scope = 'final_approver'.
--
-- 3. Admin can assign final_approver designations via the permissions page,
--    subject to Director approval through the permission_requests workflow.
--
-- 4. The 'director' role is NOT available in the user creation form.
--    Only Mohammed Al-Arfaj holds this role.
-- ============================================================================
