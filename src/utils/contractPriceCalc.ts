// Contract price from the contract's OWN pricing fields — never live market
// data. Same formula as the Customer Quote (App.tsx `calculations`), so a
// contract re-prices exactly the way it was quoted:
//
//   Bulk Base  = ((Raws USD/MT + Ocean Freight) × Yield × FX + Margin CAD)
//                × (1 + Sugar Loss %)  + Supply Chain
//   Final      = Bulk Base + Delivered Freight + Export Duty + Pallet Charge,
//                × 1.02 when Payment Terms are "2% / Net 15"
//
// Everything is worked in CAD/MT and shown in the contract currency. Delivered
// freight, export duty, pallet charge and supply chain are stored in the
// contract currency (as the quote saves them).

import type { Contract } from '../types';

export const DEFAULT_YIELD_LOSS = 1.08; // the Customer Quote's default

export interface ContractPriceCalc {
  /** True when every required input is filled in. */
  complete: boolean;
  /** Labels of the required inputs that are blank. */
  missing: string[];
  /** Per MT, contract currency, rounded to cents. Undefined when incomplete. */
  bulkBase?: number;
  final?: number;
  yieldUsed: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const isSet = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

export function calcContractPrice(c: Partial<Contract>): ContractPriceCalc {
  const yieldUsed = isSet(c.yieldLossMultiplier) && (c.yieldLossMultiplier as number) > 0 ? (c.yieldLossMultiplier as number) : DEFAULT_YIELD_LOSS;
  const missing: string[] = [];
  if (!(isSet(c.rawPriceUsdMt) && (c.rawPriceUsdMt as number) > 0)) missing.push('Raws (USD/cwt)');
  if (!(isSet(c.fxRate) && (c.fxRate as number) > 0)) missing.push('FX Rate');
  // Blank ≠ 0 here: older contracts never stored these, and treating blank as 0
  // would silently re-price them ~CAD 200/MT lower on the next save.
  if (!isSet(c.oceanFreightUsdMt)) missing.push('Ocean Freight (USD/MT)');
  if (!isSet(c.margin)) missing.push('Margin (CAD/MT)');
  if (missing.length) return { complete: false, missing, yieldUsed };

  const fx = c.fxRate as number;
  const isUsd = (c.currency || '').toUpperCase() === 'USD';
  const toCad = (v?: number) => (isSet(v) ? (isUsd ? (v as number) * fx : (v as number)) : 0);
  const fromCad = (v: number) => (isUsd ? v / fx : v);

  const refinedCad = ((c.rawPriceUsdMt as number) + (c.oceanFreightUsdMt as number)) * yieldUsed * fx + (c.margin as number);
  const bulkBaseCad = refinedCad * (1 + (c.sugarLossPct || 0) / 100) + toCad(c.supplyChainCostMt);
  let finalCad = bulkBaseCad + toCad(c.deliveredFreight) + toCad(c.exportDuty) + toCad(c.palletCharge);
  if ((c.paymentTerms || '').trim() === '2% / Net 15') finalCad *= 1.02;
  return { complete: true, missing: [], bulkBase: r2(fromCad(bulkBaseCad)), final: r2(fromCad(finalCad)), yieldUsed };
}
