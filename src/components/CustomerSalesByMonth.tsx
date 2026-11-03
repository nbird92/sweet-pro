import { useMemo } from 'react';
import type { Customer, Invoice } from '../types';

// "Invoiced Sales by Product (MT)" — product × month matrix for one customer and
// one calendar year. Shared by the customer card's Sales tab and the Sales
// Reports customer view so both render exactly the same table.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v: number, d = 1) => v ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const norm = (s?: string) => (s || '').trim().toLowerCase();
/** Normalized names (name + ITAS name) of one customer or several. */
const namesOf = (c: Customer | Customer[]) =>
  new Set((Array.isArray(c) ? c : [c]).flatMap(x => [norm(x.name), norm(x.itasCustomerName)]).filter(Boolean));

/** Product × month matrix with row and column totals. */
export const MonthMatrix = ({ rows, months, empty, shade }: { rows: { name: string; values: number[] }[]; months: string[]; empty: string; shade?: (i: number) => boolean }) => {
  const colTotals = months.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[140px]">Product</th>
            {months.map((m, i) => <th key={i} className={`text-center px-2 py-2 text-[10px] uppercase tracking-widest font-bold border border-gray-200 min-w-[64px] ${shade?.(i) ? 'bg-gray-100 text-gray-500' : 'opacity-60'}`}>{m}{shade && <div className="text-[8px] font-normal normal-case tracking-normal">{shade(i) ? 'actual' : 'forecast'}</div>}</th>)}
            <th className="text-center px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[80px]">Total (MT)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-b border-gray-200 hover:bg-gray-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium border border-gray-200">{r.name}</td>
              {r.values.map((v, i) => <td key={i} className={`px-2 py-1.5 text-center border border-gray-200 font-mono ${shade?.(i) ? 'bg-gray-100 text-gray-600' : ''}`}>{fmt(v)}</td>)}
              <td className="px-3 py-1.5 text-center font-mono font-bold border border-gray-200">{fmt(r.values.reduce((a, b) => a + b, 0))}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={months.length + 2} className="px-4 py-8 text-center text-gray-400">{empty}</td></tr>}
          {rows.length > 0 && (
            <tr className="bg-gray-50 font-bold">
              <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 border border-gray-200 text-[10px] uppercase tracking-widest">Total</td>
              {colTotals.map((v, i) => <td key={i} className="px-2 py-2 text-center border border-gray-200 font-mono">{fmt(v)}</td>)}
              <td className="px-3 py-2 text-center border border-gray-200 font-mono">{fmt(grand)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

/** Calendar years with invoiced sales for the customer, newest first (always
 *  includes the current year). */
export function customerSalesYears(customer: Customer | Customer[], invoices: Invoice[]): number[] {
  const names = namesOf(customer);
  const ys = new Set<number>();
  for (const i of invoices) {
    if (i.status === 'Cancelled' || !names.has(norm(i.customer))) continue;
    const y = parseInt((i.date || '').slice(0, 4)); if (y > 1990) ys.add(y);
  }
  ys.add(new Date().getFullYear());
  return Array.from(ys).sort((a, b) => b - a);
}

/** Product × month rows (12 values, MT) for one customer and calendar year —
 *  the data behind the table. Exported so the PDF report prints the same numbers. */
export function customerSalesRows(customer: Customer | Customer[], invoices: Invoice[], label: (name?: string) => string, year: number): { name: string; values: number[] }[] {
  const names = namesOf(customer);
  // Split an invoice's MT across its line items (by weight) so mixed loads land on the right product.
  const invoiceProductMt = (inv: Invoice): { product: string; mt: number }[] => {
    const lines = (inv.lineItems || []).filter(li => (li as any).productDisplayName || li.productName);
    const totalW = lines.reduce((s, li) => s + (Number((li as any).totalWeight) || 0), 0);
    if (lines.length > 1 && totalW > 0) {
      return lines.map(li => ({ product: label((li as any).productDisplayName || li.productName), mt: (inv.qty || 0) * (Number((li as any).totalWeight) || 0) / totalW }));
    }
    const li = lines[0] as any;
    return [{ product: label(li?.productDisplayName || inv.product || li?.productName), mt: inv.qty || 0 }];
  };
  const m = new Map<string, number[]>();
  for (const inv of invoices) {
    if (inv.status === 'Cancelled' || !names.has(norm(inv.customer))) continue;
    if (parseInt((inv.date || '').slice(0, 4)) !== year) continue;
    const mo = parseInt((inv.date || '').slice(5, 7)) - 1;
    if (mo < 0 || mo > 11) continue;
    for (const { product, mt } of invoiceProductMt(inv)) {
      const v = m.get(product) || new Array(12).fill(0);
      v[mo] += mt; m.set(product, v);
    }
  }
  return Array.from(m.entries()).map(([name, values]) => ({ name, values })).sort((a, b) => a.name.localeCompare(b.name));
}

export default function CustomerSalesByMonth({ customer, invoices, label, year, years, onYearChange }: {
  /** One customer, or every member of a customer group. */
  customer: Customer | Customer[];
  invoices: Invoice[];
  /** Product short-form resolver. */
  label: (name?: string) => string;
  year: number;
  /** Year options; defaults to the years this customer has sales in. */
  years?: number[];
  onYearChange: (y: number) => void;
}) {
  const yearOptions = useMemo(() => {
    const ys = new Set(years && years.length ? years : customerSalesYears(customer, invoices));
    ys.add(year);
    return Array.from(ys).sort((a, b) => b - a);
  }, [years, customer, invoices, year]);

  const rows = useMemo(() => customerSalesRows(customer, invoices, label, year), [customer, invoices, label, year]);

  return (
    <div className="bg-white border border-[#141414] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] uppercase font-bold tracking-widest">Invoiced Sales by Product (MT)</div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase font-bold tracking-widest opacity-60">Year</label>
          <select value={year} onChange={e => onYearChange(parseInt(e.target.value))} className="px-3 py-1.5 border border-[#141414] bg-white text-xs focus:outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <MonthMatrix rows={rows} months={MONTHS} empty={`No invoiced sales in ${year}.`} />
    </div>
  );
}
