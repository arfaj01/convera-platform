-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 08a — Enum ADD VALUE only (split from 009)
--  Source seq      : 009
--  Source migration: migrations/009_rename_claim_statuses.sql  [PATCHED v2.4]
--  Purpose         : ALTER TYPE ADD VALUE statements ONLY for claim_status + change_order_status. No data UPDATEs (those live in 08b and are deferred to a separate transaction to avoid PG 55P04).
--  Run order       : After 07_008_invoice_attachment_governance.sql; BEFORE 08b.
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned".
--  PG safety: ALTER TYPE ADD VALUE IF NOT EXISTS is idempotent.
--  On error: STOP. Re-check pre-conditions (claim_status + change_order_status enums exist from STEP 1/3).
--  08b MUST run in its own subsequent Run-button submission.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- Migration 009 — claim_status / change_order_status enum extension
-- BUNDLE-PATCHED 2026-05-07 for safe fresh-staging apply.
--
-- Original file (CONVERA/SQL/migrations/009_rename_claim_statuses.sql) also
-- runs UPDATE statements that map old workflow status values to new ones.
-- Two reasons those UPDATEs are stripped from the staging bundle:
--   • PG 55P04: a freshly-added enum value cannot be used in the same
--     transaction. Supabase SQL Editor wraps a Run-button submission in
--     one transaction, so ALTER TYPE ADD VALUE + UPDATE-using-new-value
--     fails on the UPDATE.
--   • PG 22P02: the legacy file references stale labels
--     (under_consultant_review, returned_by_consultant, under_admin_review,
--     returned_by_admin) that were never added to change_order_status —
--     so even comparing change_orders.status against those literals fails
--     parse-time, regardless of whether any rows match.
-- On fresh staging there are no claims / claim_workflow / change_orders
-- rows yet, so the data UPDATEs are no-ops anyway. Production already ran
-- the full migration months ago against real data.
-- ════════════════════════════════════════════════════════════════════

ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_supervisor'  AFTER 'under_supervisor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'returned_by_supervisor';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'returned_by_auditor'     AFTER 'under_auditor_review';
ALTER TYPE claim_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'returned_by_auditor';

ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_supervisor_review' AFTER 'submitted';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_auditor_review'    AFTER 'under_supervisor_review';
ALTER TYPE change_order_status ADD VALUE IF NOT EXISTS 'under_reviewer_check'    AFTER 'under_auditor_review';
