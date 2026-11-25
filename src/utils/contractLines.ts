// Contract-line differentials are ALWAYS entered and stored in CAD/MT
// (ContractLine.differentialCadMt). A line's price is the contract's Final
// Price plus that differential in the CONTRACT's currency — so on a USD
// contract the CAD differential is divided by the contract's FX rate.

import type { Contract } from '../types';

type Fx = Pick<Contract, 'currency' | 'fxRate'>;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fxOf = (c: Fx) => (Number(c.fxRate) > 0 ? Number(c.fxRate) : 0);
export const isUsdContract = (c: Fx) => (c.currency || '').trim().toUpperCase() === 'USD';

/** A CAD differential in both currencies (USD via the contract's FX; null when
 *  the contract has no FX rate). */
export function lineDifferentials(c: Fx, cad: number): { cad: number; usd: number | null } {
  const fx = fxOf(c);
  return { cad: Number(cad) || 0, usd: fx ? (Number(cad) || 0) / fx : null };
}

/** The differential in the contract's own currency — null for a USD contract
 *  without an FX rate (it can't be converted). */
export function differentialInContractCurrency(c: Fx, cad: number): number | null {
  if (!isUsdContract(c)) return Number(cad) || 0;
  const fx = fxOf(c);
  return fx ? (Number(cad) || 0) / fx : null;
}

/** Line price = contract Final Price + the differential in the contract's
 *  currency, rounded to cents. null when it can't be converted. */
export function contractLinePrice(c: Fx, finalPrice: number, cad: number): number | null {
  const d = differentialInContractCurrency(c, cad);
  return d === null ? null : r2((Number(finalPrice) || 0) + d);
}
