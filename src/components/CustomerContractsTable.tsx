import { ExternalLink } from 'lucide-react';
import type { Contract } from '../types';

// The customer contracts table — shared by the customer card's Contracts tab and
// the Sales Reports customer view so both render exactly the same table.

export interface CustomerContractRow {
  contract: Contract;
  taken: number;
  onOrder: number;
  outstanding: number;
}

const fmt = (v: number, d = 1) => v ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Active = not switched off and not past its end date. */
export const isContractActive = (c: Contract, today = new Date().toISOString().slice(0, 10)) =>
  c.active !== false && (!c.endDate || c.endDate >= today);

export default function CustomerContractsTable({ rows, label, onOpenContract, emptyMessage = 'No contracts for this customer.' }: {
  rows: CustomerContractRow[];
  /** Product short-form resolver (falls back to the raw name). */
  label: (name?: string) => string;
  /** Row click — opens the contract. Omit for a read-only table. */
  onOpenContract?: (c: Contract) => void;
  emptyMessage?: string;
}) {
  return (
    <div className="bg-white border border-[#141414] overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
            {['Contract #', 'Status', 'Product', 'Origin', 'Term', 'Price', 'Volume (MT)', 'Taken', 'On Order', 'Balance', 'Progress'].map(h => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ contract: c, taken, onOrder, outstanding }) => {
            const act = isContractActive(c);
            const pct = c.contractVolume ? Math.min(100, (taken / c.contractVolume) * 100) : 0;
            const pctOrd = c.contractVolume ? Math.min(100 - pct, (onOrder / c.contractVolume) * 100) : 0;
            return (
              <tr
                key={c.id}
                onClick={onOpenContract ? () => onOpenContract(c) : undefined}
                title={onOpenContract ? 'Open this contract on the Contracts page' : undefined}
                className={`border-b border-gray-200 hover:bg-amber-50 group ${onOpenContract ? 'cursor-pointer' : ''} ${act ? '' : 'opacity-50'}`}
              >
                <td className={`p-2 font-mono font-bold whitespace-nowrap ${onOpenContract ? 'text-blue-700 underline decoration-dotted underline-offset-2 group-hover:decoration-solid' : ''}`}>
                  {c.contractNumber || '(no number)'} {onOpenContract && <ExternalLink size={10} className="inline opacity-50" />}
                </td>
                <td className="p-2"><span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${act ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>{act ? 'Active' : 'Closed'}</span></td>
                <td className="p-2">{(c.contractLines?.length ? c.contractLines.map(l => label(l.productName)) : [label(c.skuName)]).join(', ')}</td>
                <td className="p-2">{c.origin || '—'}</td>
                <td className="p-2 whitespace-nowrap">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                <td className="p-2 font-mono whitespace-nowrap">{c.finalPrice ? `${c.currency || ''} ${c.finalPrice.toFixed(2)}` : '—'}</td>
                <td className="p-2 font-mono text-right">{fmt(c.contractVolume || 0)}</td>
                <td className="p-2 font-mono text-right">{fmt(taken)}</td>
                <td className="p-2 font-mono text-right">{fmt(onOrder)}</td>
                <td className="p-2 font-mono text-right font-bold">{fmt(outstanding)}</td>
                <td className="p-2 min-w-[120px]">
                  <div className="h-2 bg-gray-200 flex"><div className="bg-[#141414]" style={{ width: `${pct}%` }} /><div className="bg-amber-400" style={{ width: `${pctOrd}%` }} /></div>
                  <div className="text-[9px] opacity-50 mt-0.5">{Math.round(pct)}% taken</div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-gray-400">{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
