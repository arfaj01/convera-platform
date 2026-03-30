/**
 * CONVERA Financial Calculation Engine
 * BOQ + Staff claim calculations with performance % application
 *
 * Retention & VAT:
 * - Retention: Applied per contract, calculated as percentage of gross amount
 * - VAT: Default 15%, applied to net amount (after retention)
 *
 * Performance %:
 * - Default: 100% (no deduction)
 * - Modified by: Supervisor only
 * - Applied to: All BOQ and staff amounts
 */

import type { BOQFormItem, StaffFormItem, BoqProgressModel, ClaimBOQItem, ClaimStaffItem } from './types';

// ─── Type Definitions ────────────────────────────────────────────

/**
 * BOQ line calculation result
 */
export interface BOQLineResult {
  itemId: number;
  prevQty: number;
  currQty: number;
  cumulativeQty: number;
  periodAmount: number;
  performanceApplied: number;
  afterPerf: number;
}

/**
 * Staff line calculation result
 */
export interface StaffLineResult {
  itemId: number;
  workingDays: number;
  overtimeHours: number;
  basicAmount: number;
  extraAmount: number;
  totalAmount: number;
  performanceApplied: number;
  afterPerf: number;
}

/**
 * Complete claim financial summary
 */
export interface ClaimFinancialSummary {
  boqTotal: number;
  staffTotal: number;
  grossAmount: number;
  retentionAmount: number;
  netAmount: number;
  vatAmount: number;
  totalAmount: number;
}

/**
 * BOQ progress validation result
 */
export interface BOQProgressValidation {
  valid: boolean;
  message?: string;
  exceedsContractualQty?: boolean;
  currentCumulative?: number;
  contractualQty?: number;
}

/**
 * Change order limit validation result
 */
export interface ChangeOrderLimitValidation {
  allowed: boolean;
  currentUtilization: number;
  projectedUtilization: number;
  message?: string;
  breachesLimit: boolean;
  approachingWarningLimit: boolean;
}

// ─── BOQ Calculations ────────────────────────────────────────────

/**
 * Calculate a single BOQ line item amount
 *
 * @param item - BOQ form item
 * @param prevQty - Previous cumulative quantity (from prior claims)
 * @param currQty - Current period quantity
 * @param performancePct - Performance percentage (100 = no deduction)
 * @returns Calculated BOQ line result
 */
export function calculateBoqLineAmount(
  item: BOQFormItem,
  prevQty: number,
  currQty: number,
  performancePct: number = 100,
): BOQLineResult {
  // Current period amount = current quantity × unit price
  const periodAmount = currQty * item.price;

  // Cumulative total including previous periods
  const cumulativeQty = prevQty + currQty;

  // Performance adjustment (percentage applied as multiplier)
  const performanceMultiplier = performancePct / 100;
  const performanceApplied = periodAmount * performanceMultiplier;

  // After performance: use cumulative for total amount
  const afterPerf = cumulativeQty * item.price * performanceMultiplier;

  return {
    itemId: item.id,
    prevQty,
    currQty,
    cumulativeQty,
    periodAmount,
    performanceApplied,
    afterPerf,
  };
}

/**
 * Calculate BOQ item using progress model
 *
 * Supports three progress models:
 * - count: Quantity-based (items billed by unit)
 * - percentage: Percentage-based (0-100% billing)
 * - monthly_lump_sum: Fixed monthly billing
 *
 * @param item - BOQ claim item from database
 * @param model - Progress model type
 * @param performancePct - Performance percentage applied
 * @returns Calculated period amount
 */
export function calculateBoqItemByModel(
  item: ClaimBOQItem,
  model: BoqProgressModel,
  performancePct: number = 100,
): number {
  let periodAmount = 0;

  switch (model) {
    case 'count':
      // Quantity-based: current_progress × unit_price
      periodAmount = item.curr_progress * item.unit_price;
      break;

    case 'percentage':
      // Percentage-based: (current_progress / 100) × unit_price × contractual_qty
      const percentageOfTotal = (item.curr_progress / 100) * item.contractual_qty * item.unit_price;
      periodAmount = percentageOfTotal;
      break;

    case 'monthly_lump_sum':
      // Monthly lump sum: fixed amount × months
      periodAmount = item.curr_progress * item.unit_price;
      break;

    default:
      periodAmount = 0;
  }

  // Apply performance percentage
  return periodAmount * (performancePct / 100);
}

/**
 * Calculate total BOQ amount from line results
 */
export function calculateBoqTotal(results: BOQLineResult[]): number {
  return results.reduce((sum, r) => sum + r.periodAmount, 0);
}

/**
 * Validate BOQ progress doesn't exceed contractual quantity
 */
export function validateBoqProgress(
  currProgress: number,
  prevCumulative: number,
  contractualQty: number,
  model: BoqProgressModel,
): BOQProgressValidation {
  let currentCumulative = currProgress;

  if (model === 'count') {
    currentCumulative = prevCumulative + currProgress;
    if (currentCumulative > contractualQty) {
      return {
        valid: false,
        exceedsContractualQty: true,
        currentCumulative,
        contractualQty,
        message: `الكميات التراكمية (${currentCumulative}) تتجاوز الكميات المتعاقد عليها (${contractualQty})`,
      };
    }
  }

  if (model === 'percentage') {
    if (currProgress < 0 || currProgress > 100) {
      return {
        valid: false,
        message: 'نسبة التقدم يجب أن تكون بين 0 و 100%',
      };
    }
  }

  return { valid: true };
}

// ─── Staff Calculations ──────────────────────────────────────────

/**
 * Calculate a single staff line item amount
 *
 * Calculation:
 * - Basic amount = (working_days / 30) × monthly_rate
 * - Extra amount = (monthly_rate / 192) × 1.5 × overtime_hours
 * - Total = basic + extra
 * - After performance = total × (performance_pct / 100)
 *
 * @param item - Staff form item
 * @param workingDays - Days worked in period
 * @param overtimeHours - Overtime hours
 * @param performancePct - Performance percentage
 * @returns Calculated staff line result
 */
export function calculateStaffLineAmount(
  item: StaffFormItem,
  workingDays: number,
  overtimeHours: number = 0,
  performancePct: number = 100,
): StaffLineResult {
  // Basic amount = (working days / 30) × monthly rate
  const basicAmount = (workingDays / 30) * item.price;

  // Extra amount (overtime) = (rate / 192 hours) × 1.5 multiplier × overtime hours
  const overtimeRate = item.price / 192;
  const extraAmount = overtimeRate * 1.5 * overtimeHours;

  // Total before performance adjustment
  const totalAmount = basicAmount + extraAmount;

  // Performance adjustment
  const performanceMultiplier = performancePct / 100;
  const performanceApplied = totalAmount * performanceMultiplier;
  const afterPerf = performanceApplied;

  return {
    itemId: item.id,
    workingDays,
    overtimeHours,
    basicAmount,
    extraAmount,
    totalAmount,
    performanceApplied,
    afterPerf,
  };
}

/**
 * Calculate staff item from claim database record
 */
export function calculateStaffItemFromClaim(
  item: ClaimStaffItem,
  performancePct: number = 100,
): number {
  const basicAmount = (item.working_days / 30) * item.monthly_rate;
  const extraAmount = (item.monthly_rate / 192) * 1.5 * item.overtime_hours;
  const totalAmount = basicAmount + extraAmount;

  return totalAmount * (performancePct / 100);
}

/**
 * Calculate total staff amount from line results
 */
export function calculateStaffTotal(results: StaffLineResult[]): number {
  return results.reduce((sum, r) => sum + r.afterPerf, 0);
}

// ─── Claim Summary Calculations ──────────────────────────────────

/**
 * Calculate complete claim financial summary
 *
 * Formula:
 * - Gross = BOQ total + Staff total
 * - Retention = Gross × (retention_pct / 100)
 * - Net = Gross - Retention
 * - VAT = Net × vat_rate (default 15%)
 * - Total = Net + VAT
 *
 * @param boqTotal - Total BOQ amount
 * @param staffTotal - Total staff amount
 * @param retentionPct - Retention percentage per contract
 * @param vatRate - VAT rate (default 0.15)
 * @returns Complete financial summary
 */
export function calculateClaimSummary(
  boqTotal: number,
  staffTotal: number,
  retentionPct: number = 0,
  vatRate: number = 0.15,
): ClaimFinancialSummary {
  const grossAmount = boqTotal + staffTotal;
  const retentionAmount = grossAmount * (retentionPct / 100);
  const netAmount = grossAmount - retentionAmount;
  const vatAmount = netAmount * vatRate;
  const totalAmount = netAmount + vatAmount;

  return {
    boqTotal,
    staffTotal,
    grossAmount,
    retentionAmount,
    netAmount,
    vatAmount,
    totalAmount,
  };
}

/**
 * Recalculate claim summary from database records
 */
export function recalculateClaimSummary(
  boqItems: ClaimBOQItem[],
  staffItems: ClaimStaffItem[],
  performancePct: number = 100,
  retentionPct: number = 0,
  vatRate: number = 0.15,
): ClaimFinancialSummary {
  // Sum all BOQ items
  const boqTotal = boqItems.reduce((sum, item) => {
    return sum + item.period_amount;
  }, 0);

  // Sum all staff items
  const staffTotal = staffItems.reduce((sum, item) => {
    return sum + calculateStaffItemFromClaim(item, performancePct);
  }, 0);

  return calculateClaimSummary(boqTotal, staffTotal, retentionPct, vatRate);
}

// ─── Change Order Calculations ──────────────────────────────────

/**
 * Validate change order against 10% limit
 *
 * Governance Rule (MANDATORY):
 * - Maximum change order value = base_contract_value × 1.10
 * - Cumulative changes cannot exceed 10% of base value
 * - Warning trigger: 90% of limit reached
 *
 * @param contractBaseValue - Contract base value
 * @param existingApprovedChanges - Sum of already-approved change orders
 * @param newChangeValue - Value of new change order
 * @returns Validation result with current and projected utilization
 */
export function validateChangeOrderLimit(
  contractBaseValue: number,
  existingApprovedChanges: number,
  newChangeValue: number,
): ChangeOrderLimitValidation {
  const maxAllowedValue = contractBaseValue * 0.10; // 10% limit
  const projectedTotal = existingApprovedChanges + newChangeValue;
  const currentUtilization = (existingApprovedChanges / contractBaseValue) * 100;
  const projectedUtilization = (projectedTotal / contractBaseValue) * 100;
  const warningThreshold = 9; // 90% of 10%

  const breachesLimit = projectedTotal > maxAllowedValue;
  const approachingWarningLimit = projectedUtilization >= warningThreshold && !breachesLimit;

  let message: string | undefined;
  if (breachesLimit) {
    message = `المبلغ الإجمالي للتغييرات (${projectedTotal.toFixed(2)}) يتجاوز الحد الأقصى (${maxAllowedValue.toFixed(2)})`;
  } else if (approachingWarningLimit) {
    message = `التغييرات الجارية تقترب من الحد الأقصى المسموح به (${projectedUtilization.toFixed(2)}%)`;
  }

  return {
    allowed: !breachesLimit,
    currentUtilization,
    projectedUtilization,
    breachesLimit,
    approachingWarningLimit,
    message,
  };
}

/**
 * Calculate contract financial ceiling
 */
export function calculateContractCeiling(
  baseValue: number,
  approvedClaimsTotal: number,
  approvedChangeOrdersTotal: number,
): {
  maxAllowed: number;
  totalCommitted: number;
  remaining: number;
  percentageUtilized: number;
  hasHeadroom: boolean;
} {
  const maxAllowed = baseValue * 1.10; // 10% tolerance
  const totalCommitted = approvedClaimsTotal + approvedChangeOrdersTotal;
  const remaining = maxAllowed - totalCommitted;
  const percentageUtilized = (totalCommitted / baseValue) * 100;

  return {
    maxAllowed,
    totalCommitted,
    remaining,
    percentageUtilized,
    hasHeadroom: remaining > 0,
  };
}

// ─── Utility Functions ───────────────────────────────────────────

/**
 * Format currency amount
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Safe division with zero check
 */
export function safeDivide(numerator: number, denominator: number, defaultValue: number = 0): number {
  return denominator === 0 ? defaultValue : numerator / denominator;
}

// ─── Compatibility Aliases ────────────────────────────────────────
// Short aliases for use in UI components

/** @alias calculateBoqLineAmount */
export const calcBOQLine = calculateBoqLineAmount;

/** @alias calculateStaffLineAmount */
export const calcStaffLine = calculateStaffLineAmount;

/** @alias calculateClaimSummary */
export const calcClaimSummary = calculateClaimSummary;

/** Type alias for ClaimFinancialSummary */
export type ClaimSummary = ClaimFinancialSummary;
