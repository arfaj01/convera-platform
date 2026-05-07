-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 14 — MIGRATION
--  Source seq      : 016
--  Source migration: migrations/016_update_contract_types.sql
--  Purpose         : contract_type enum updates
--  Run order       : STEP 14 of 48 (after STEP 13, before STEP 15).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- Migration 016: Update contract types to match department standards
-- وزارة البلديات والإسكان — إدارة التطوير والتأهيل
--
-- Adds 'supply' (توريد مواد) to the contract_type enum
-- Updates contract 231001101771 type: supervision → consultancy
-- Updates Arabic labels (frontend-only, no DB change needed for labels)
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Add 'supply' to the contract_type enum
-- PostgreSQL does not allow removing enum values, only adding new ones
ALTER TYPE contract_type ADD VALUE IF NOT EXISTS 'supply';

-- Step 2: Update contract 231001101771
-- Current type: supervision (إشراف هندسي)
-- Correct type:  consultancy (استشارات هندسية)
UPDATE contracts
SET type = 'consultancy'
WHERE contract_no = '231001101771'
  AND type = 'supervision';

-- Verify
SELECT contract_no, type, title
FROM contracts
WHERE contract_no IN ('231001101771', '241039011332')
ORDER BY contract_no;
