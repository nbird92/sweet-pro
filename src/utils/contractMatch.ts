// Contract ↔ invoice/order matching, and the derived contract volumes.
//
// These live here rather than inside App.tsx so the Contracts table and the
// Reports page compute Volume Taken from ONE implementation. They used to
// disagree: the Contracts table recomputed the figure from invoices while the
// customer report read the persisted Contract.volumeTaken field, which drifts
// whenever invoices are added or removed without touching the contract row.

import type { Invoice, Order } from '../types';

/** Strip the trailing numeric suffix from a split number to get its parent
 *  contract number. "S03399.B29" → "S03399.B", "S04280.G01" → "S04280.G".
 *  Input with no trailing digits is returned unchanged. */
export function contractNumberFromSplit(split: string | undefined | null): string {
  if (!split) return '';
  return String(split).replace(/\d+$/, '');
}

/** True when a record's own contractNumber, or its split's parent contract,
 *  is the given contract. (Callers may layer line-item matches on top.) */
export function matchesContractByNumberOrSplit(
  target: string | undefined,
  split: string | undefined,
  contractNumber: string,
): boolean {
  if (!contractNumber) return false;
  if (target && target === contractNumber) return true;
  if (split && contractNumberFromSplit(split) === contractNumber) return true;
  return false;
}

/** Decide whether an invoice belongs to a contract. Invoices reference the
 *  contract three ways, any of which counts:
 *    1. contractNumber — may be a comma-joined list ("A, B"), so split it,
 *    2. splitNo whose contract prefix (digits stripped) is the contract number,
 *    3. a line item's contractNumber (also possibly comma-joined). */
export function invoiceMatchesContract(inv: Invoice, contractNumber: string): boolean {
  if (!contractNumber) return false;
  const parts = (s: string | undefined) => (s || '').split(',').map(x => x.trim()).filter(Boolean);
  if (parts(inv.contractNumber).includes(contractNumber)) return true;
  if (inv.splitNo && contractNumberFromSplit(inv.splitNo) === contractNumber) return true;
  if ((inv.lineItems || []).some(li => parts(li.contractNumber).includes(contractNumber))) return true;
  return false;
}

/** Volume Taken (MT) for a contract — computed from INVOICES, never from the
 *  persisted Contract.volumeTaken. Summing invoices means a billed split that
 *  carries only a splitNo (e.g. "S03399.B29") still counts against its parent
 *  contract. Cancelled invoices are excluded. */
export function computeVolumeTaken(contractNumber: string, invoices: Invoice[]): number {
  if (!contractNumber) return 0;
  return invoices
    .filter(inv => inv.status !== 'Cancelled' && invoiceMatchesContract(inv, contractNumber))
    .reduce((sum, inv) => sum + (inv.qty || 0), 0);
}

/** Volume on Order (MT): orders matching the contract that are not yet
 *  invoiced. Prefers the line items naming this contract, falling back to the
 *  whole order when the match came from the order's own number/split. */
export function computeVolumeOnOrder(
  contractNumber: string,
  orders: Order[],
  invoices: Invoice[],
): number {
  if (!contractNumber) return 0;
  const invoicedBols = new Set(invoices.filter(inv => inv.bolNumber).map(inv => inv.bolNumber));
  const ordersOnContract = orders.filter(o => {
    if (o.status === 'Cancelled') return false;
    if (matchesContractByNumberOrSplit(o.contractNumber, o.splitNumber, contractNumber)) return true;
    if ((o.lineItems || []).some(li => li.contractNumber === contractNumber)) return true;
    return false;
  });
  const sumOrderWeight = (o: Order) => {
    const matchingLines = (o.lineItems || []).filter(li => li.contractNumber === contractNumber);
    if (matchingLines.length > 0) {
      return matchingLines.reduce((s, li) => s + (li.totalWeight || 0), 0);
    }
    return (o.lineItems || []).reduce((s, li) => s + (li.totalWeight || 0), 0);
  };
  return ordersOnContract
    .filter(o => !(o.bolNumber && invoicedBols.has(o.bolNumber)))
    .reduce((sum, o) => sum + sumOrderWeight(o), 0);
}
