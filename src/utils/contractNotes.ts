// Contract change log — every edit to a contract appends a dated, detailed
// note (newest first) listing exactly what changed, from → to. Used by the
// Edit Contract menu, Active/Inactive toggle, CSV import, invoice price
// backfill and automatic customer/ITAS fills. (Merge / Transfer / Inc-Dec
// write their own richer notes in ContractToolsModal.)

import type { Contract, ContractLine } from '../types';
import { isTempContractNumber } from './contractMatch';

type Kind = 'text' | 'mt' | 'money' | 'fx' | 'usdmt' | 'bool';
const FIELDS: Array<[keyof Contract, string, Kind]> = [
  ['contractNumber', 'Contract No.', 'text'],
  ['customerName', 'Customer', 'text'],
  ['customerNumber', 'Customer No.', 'text'],
  ['itasName', 'ITAS Name', 'text'],
  ['skuName', 'Product', 'text'],
  ['contractVolume', 'Contract Volume', 'mt'],
  ['finalPrice', 'Price/MT', 'money'],
  ['currency', 'Currency', 'text'],
  ['rawPriceUsdMt', 'Raw (USD/MT)', 'usdmt'],
  ['fxRate', 'FX', 'fx'],
  ['margin', 'Margin (CAD/MT)', 'money'],
  ['deliveredFreight', 'Delivered Freight (/MT)', 'money'],
  ['exportDuty', 'Export Duty (/MT)', 'money'],
  ['palletCharge', 'Pallet Charge (/MT)', 'money'],
  ['palletType', 'Pallet Type', 'text'],
  ['origin', 'Origin', 'text'],
  ['destination', 'Destination', 'text'],
  ['shippingTerms', 'Shipping Terms', 'text'],
  ['paymentTerms', 'Payment Terms', 'text'],
  ['startDate', 'Contract Start', 'text'],
  ['endDate', 'Contract End', 'text'],
  ['contractDate', 'Contract Date', 'text'],
  ['active', 'Status', 'bool'],
];

const blank = (v: unknown) => v === undefined || v === null || v === '';
const fmtVal = (v: unknown, kind: Kind, currency?: string): string => {
  if (kind === 'bool') return v === false ? 'Inactive' : 'Active';
  if (blank(v)) return '(blank)';
  const n = Number(v);
  switch (kind) {
    case 'mt': return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} MT`;
    case 'money': return `${currency ? currency + ' ' : ''}$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'usdmt': return `USD $${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'fx': return n.toFixed(4);
    default: return String(v);
  }
};
const same = (a: unknown, b: unknown, kind: Kind) => {
  if (kind === 'bool') return (a === false) === (b === false);
  if (blank(a) && blank(b)) return true;
  if (kind !== 'text' && !blank(a) && !blank(b)) return Math.abs(Number(a) - Number(b)) < 1e-9;
  return String(a ?? '').trim() === String(b ?? '').trim();
};

const lineKey = (l: ContractLine) => l.productKey || l.productName;
const lineName = (l: ContractLine) => l.productDisplayName || l.productName;

/** Human-readable list of what changed between two versions of a contract. */
export function contractChanges(before: Contract, after: Contract, customerName?: (id: string) => string): string[] {
  const out: string[] = [];
  for (const [key, label, kind] of FIELDS) {
    const a = before[key], b = after[key];
    if (same(a, b, kind)) continue;
    const money = kind === 'money' && (key === 'finalPrice') ? (after.currency || before.currency) : undefined;
    let txt = `${label}: ${fmtVal(a, kind, money)} → ${fmtVal(b, kind, money)}`;
    if (key === 'contractNumber' && isTempContractNumber(String(a || ''))) txt += ' (ITAS number assigned)';
    out.push(txt);
  }
  // Authorized customers
  const ac = new Set(before.allowedCustomerIds || []), bc = new Set(after.allowedCustomerIds || []);
  const added = [...bc].filter(x => !ac.has(x)), removed = [...ac].filter(x => !bc.has(x));
  const nm = (id: string) => (customerName ? customerName(id) : id) || id;
  if (added.length) out.push(`Authorized customers added: ${added.map(nm).join(', ')}`);
  if (removed.length) out.push(`Authorized customers removed: ${removed.map(nm).join(', ')}`);
  // Product lines (differentials)
  const bl = new Map((before.contractLines || []).map(l => [lineKey(l), l]));
  const al = new Map((after.contractLines || []).map(l => [lineKey(l), l]));
  const m = (v: number) => `$${(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const [k, l] of al) {
    const o = bl.get(k);
    if (!o) { out.push(`Product line added: ${lineName(l)} (differential ${m(l.differentialCadMt)}, price ${m(l.finalPriceMt)}/MT)`); continue; }
    const ch: string[] = [];
    if (Math.abs((o.differentialCadMt || 0) - (l.differentialCadMt || 0)) > 1e-9) ch.push(`differential ${m(o.differentialCadMt)} → ${m(l.differentialCadMt)}`);
    if (Math.abs((o.finalPriceMt || 0) - (l.finalPriceMt || 0)) > 1e-9) ch.push(`price ${m(o.finalPriceMt)} → ${m(l.finalPriceMt)}/MT`);
    if (ch.length) out.push(`Product line ${lineName(l)}: ${ch.join(', ')}`);
  }
  for (const [k, l] of bl) if (!al.has(k)) out.push(`Product line removed: ${lineName(l)}`);
  return out;
}

/** "[2026-11-23, 14:05 · Name]" */
export function noteStamp(who?: string): string {
  const when = new Date().toLocaleString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `[${when}${who ? ` · ${who}` : ''}]`;
}

/** Prepend a dated entry to a contract's notes (newest first). */
export function prependNote(notes: string | undefined, entry: string): string {
  return [entry, (notes || '').trim()].filter(Boolean).join('\n\n');
}

/** `after` with a dated change note added when anything changed. */
export function withChangeNote(before: Contract, after: Contract, action: string, who?: string, customerName?: (id: string) => string, extra?: string): Contract {
  const changes = contractChanges(before, after, customerName);
  if (!changes.length && !extra) return after;
  const entry = `${noteStamp(who)} ${action}: ${changes.join('; ')}${extra ? `${changes.length ? '. ' : ''}${extra}` : ''}.`;
  return { ...after, notes: prependNote(after.notes, entry) };
}
