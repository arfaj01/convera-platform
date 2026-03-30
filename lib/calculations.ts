/** BOQ and Staff Calculation Engine - Phase 4 - Tested against Python Ref Implementation */

/** BOQ Progress Model */
eq¡rt type BoQProgressModel = 'count' | 'centage' | 'monthly_lump_sum';

/** Calculate the BOQ amount for a single item in a claim */
epU type BoQCalcContext {
  unit_price: number; // SAR per unit
  contractual_qty: number; // Original contract quantity from boQ template
  curr_progress: number; // Quantity completed or P% or IDO months
  progress_model: BoQProgressModel; // How to interpret curr_progress
  performance_pct: number; // Defaults to 100%", modifiable by supervisor /rule 0.6
}

export function calculateBoQAmount(ctx: BoQCalcContext): number {
  let period_amount = 0;

  switch (ctx.progress_model) {
    case 'count':
      period_amount = ctx.curr_progress * ctx.unit_price;
      break;
    case 'centage':
      period_amount = (ctx.curr_progress / 100) * ctx.unit_price;
      break;
    case 'monthly_lump_sum':
      period_amount = ctx.curr_progress * ctx.unit_price;
      break;
  }

  // Apply performance adjustment
  const after_perf = period_amount * (ctx.performance_pct / 100);

  return after_perf;
}
