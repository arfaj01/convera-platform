-- ════════════════════════════════════════════════════════════════════
--  CMH_01 STAGING — Section 12 — MIGRATION
--  Source seq      : 013
--  Source migration: migrations/013_fix_trigger_security_definer.sql
--  Purpose         : trigger SECURITY DEFINER fix
--  Run order       : STEP 12 of 48 (after STEP 11, before STEP 13).
--  Target           : STAGING ONLY  —  project ref jrqkzwacerdudmeacvar
--  FORBIDDEN        : production project ref ngwxlockzkjpmzuvgakx
--  Stop-on-error    : ABORT immediately on any PG error.
--  Expected result: "Success. No rows returned" unless this is a SEED (which inserts rows).
-- ════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
--  CONVERA — Migration 013: Fix Trigger SECURITY DEFINER
--  File: 013_fix_trigger_security_definer.sql
--
--  Problem: check_claim_within_contract_limit() trigger ran with the
--  calling user's RLS context. When supervisor/consultant updated a
--  claim, the trigger's SELECT on contracts was blocked by RLS
--  (consultant is external, contract not owned by them), returning
--  NULL → RAISE EXCEPTION 'العقد غير موجود'.
--
--  Fix 1: Recreate trigger function as SECURITY DEFINER so it always
--  reads contracts/claims with elevated privileges.
--
--  Fix 2: Add contracts_auth_read policy allowing all authenticated
--  users to SELECT contracts (needed for UI display).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_claim_within_contract_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_base            NUMERIC;
  v_amendment_count INTEGER;
  v_amendments_net  NUMERIC;
  v_ceiling         NUMERIC;
  v_others          NUMERIC;
  v_new_gross       NUMERIC;
BEGIN
  -- Draft claims always pass (no financial check)
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Get contract base_value (SECURITY DEFINER bypasses RLS)
  SELECT base_value INTO v_base
  FROM contracts
  WHERE id = NEW.contract_id;

  IF v_base IS NULL THEN
    RAISE EXCEPTION 'العقد غير موجود';
  END IF;

  -- Count and sum approved amendments
  SELECT COUNT(*), COALESCE(SUM(value_change), 0)
  INTO v_amendment_count, v_amendments_net
  FROM contract_amendments
  WHERE contract_id = NEW.contract_id
    AND status = 'approved';

  -- Two-tier ceiling calculation
  IF v_amendment_count > 0 THEN
    v_ceiling := v_base + v_amendments_net;
  ELSE
    v_ceiling := v_base * 1.10;
  END IF;

  -- Cumulative spend (excluding rejected and draft)
  SELECT COALESCE(SUM(boq_amount + staff_amount), 0)
  INTO v_others
  FROM claims
  WHERE contract_id = NEW.contract_id
    AND id != NEW.id
    AND status NOT IN ('rejected', 'draft');

  v_new_gross := COALESCE(NEW.boq_amount, 0) + COALESCE(NEW.staff_amount, 0);

  -- Enforce ceiling
  IF (v_others + v_new_gross) > v_ceiling THEN
    RAISE EXCEPTION
      'المبلغ الإجمالي للمستخلصات (% ريال) يتجاوز سقف العقد (% ريال)',
      ROUND(v_others + v_new_gross, 2),
      ROUND(v_ceiling, 2);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Allow all authenticated users to SELECT contracts (for UI and trigger context)
DROP POLICY IF EXISTS "contracts_auth_read" ON contracts;
CREATE POLICY "contracts_auth_read"
  ON contracts FOR SELECT
  USING (auth.uid() IS NOT NULL);

SELECT 'trigger_fixed' AS result;
