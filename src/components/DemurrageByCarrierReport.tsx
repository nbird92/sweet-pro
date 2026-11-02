import React, { useState, useMemo, useCallback } from 'react';
import { Clock, Download } from 'lucide-react';
// Type-only: ExcelJS is dynamic-imported in the export handler so it stays out
// of the main bundle.
import type ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { DemurrageInvoice } from '../types';

// Demurrage Cost by Carrier — carrier demurrage / wait-time invoices bucketed by
// week or month, one block per currency. Shown on the Supply Chain page under
// the Demurrage table (moved from the Reports page).

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNum(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Parse a demurrage date string into a local Date, or null when unparseable.
// Handles the ISO 'YYYY-MM-DD' the modal date-picker and scanner emit, plus the
// carrier-invoice formats the scanner sometimes passes through verbatim
// ('Aug-06-2026', 'Aug 6, 2026', '2026/08/06').
function parseDemDate(s?: string): Date | null {
  if (!s) return null;
  const str = s.trim();
  if (!str) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(str);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  // Fall back to the Date parser. Swap dashes for spaces so 'Aug-06-2026' parses
  // (native Date rejects that dash form) without touching the ISO branch above.
  const d = new Date(str.replace(/-/g, ' '));
  return isNaN(d.getTime()) ? null : d;
}

// Monday-anchored start of the week containing d (used for weekly bucketing).
function weekStartOf(d: Date): Date {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = dt.getDay(); // 0 Sun .. 6 Sat
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
  return dt;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFE4E3E0' }, size: 10 };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10 };
const CURRENCY_FMT = '$#,##0.00';
const INT_FMT = '#,##0';

const applyHeaderRow = (ws: ExcelJS.Worksheet, rowNum: number) => {
  const row = ws.getRow(rowNum);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: cell.alignment?.horizontal || 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF141414' } } };
  });
  row.height = 24;
};
const applyTotalRow = (ws: ExcelJS.Worksheet, rowNum: number) => {
  const row = ws.getRow(rowNum);
  row.eachCell((cell) => {
    cell.fill = TOTAL_FILL;
    cell.font = TOTAL_FONT;
    cell.border = { top: { style: 'medium', color: { argb: 'FF141414' } } };
  });
  row.height = 22;
};
const addTitleRows = (ws: ExcelJS.Worksheet, title: string, subtitle: string): number => {
  const titleRow = ws.addRow([title]);
  titleRow.getCell(1).font = { bold: true, size: 14 };
  titleRow.height = 24;
  const subRow = ws.addRow([subtitle]);
  subRow.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF666666' } };
  subRow.height = 18;
  ws.addRow([]);
  return ws.rowCount;
};

export default function DemurrageByCarrierReport({ demurrageInvoices }: { demurrageInvoices: DemurrageInvoice[] }) {
  // Bucket carrier costs by ISO week or calendar month.
  const [demGranularity, setDemGranularity] = useState<'week' | 'month'>('month');

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT: Demurrage cost by carrier (weekly / monthly)
  // Buckets carrier demurrage/wait-time invoices (Supply Chain page) by ISO week
  // or calendar month, on the shipment date (falling back to the invoice date).
  // ═══════════════════════════════════════════════════════════════════════════
  const demStats = useMemo(() => {
    const periodOf = (d: Date): { key: string; label: string } => {
      if (demGranularity === 'month') {
        return { key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}` };
      }
      const ws = weekStartOf(d);
      return { key: `${ws.getFullYear()}-${pad2(ws.getMonth() + 1)}-${pad2(ws.getDate())}`, label: `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}` };
    };
    const UNDATED = '￿'; // sorts after every real YYYY-… key
    const periodLabels = new Map<string, string>();
    // Bucket by CURRENCY first, then carrier — amounts in different currencies
    // are never summed together (no FX conversion), so each currency reports its
    // own carrier matrix + totals. Blank/unknown currency defaults to CAD (these
    // are Canadian carrier invoices; the entry modal also defaults to CAD).
    type Row = { carrier: string; total: number; count: number; byPeriod: Map<string, number> };
    const byCurrency = new Map<string, Map<string, Row>>();
    for (const inv of demurrageInvoices) {
      const carrier = (inv.carrier || '').trim() || '—';
      // Normalize free-text currency spellings ("CDN$", "CDN", "USD$", "US") so
      // each doesn't report as its own currency group.
      const curRaw = (inv.currency || '').toUpperCase().replace(/[^A-Z]/g, '');
      const currency = ['CDN', 'CND', 'CA'].includes(curRaw) || curRaw.startsWith('CANADIAN') ? 'CAD'
        : (['US', 'USA'].includes(curRaw) || curRaw.startsWith('USFUND') ? 'USD' : curRaw || 'CAD');
      const amt = typeof inv.amount === 'number' && Number.isFinite(inv.amount) ? inv.amount : 0;
      const dt = parseDemDate(inv.shipmentDate) || parseDemDate(inv.invoiceDate);
      const p = dt ? periodOf(dt) : { key: UNDATED, label: 'Undated' };
      periodLabels.set(p.key, p.label);
      let cg = byCurrency.get(currency);
      if (!cg) { cg = new Map(); byCurrency.set(currency, cg); }
      let c = cg.get(carrier);
      if (!c) { c = { carrier, total: 0, count: 0, byPeriod: new Map() }; cg.set(carrier, c); }
      c.total += amt;
      c.count += 1;
      c.byPeriod.set(p.key, (c.byPeriod.get(p.key) || 0) + amt);
    }
    const periodKeys = [...periodLabels.keys()].sort(); // UNDATED sorts last
    const periods = periodKeys.map(k => ({ key: k, label: periodLabels.get(k) || k }));
    const groups = [...byCurrency.entries()].map(([currency, cg]) => {
      const carriers = [...cg.values()].sort((a, b) => b.total - a.total);
      const grand = carriers.reduce((s, c) => s + c.total, 0);
      const count = carriers.reduce((s, c) => s + c.count, 0);
      const periodTotals = new Map<string, number>();
      for (const k of periodKeys) periodTotals.set(k, carriers.reduce((s, c) => s + (c.byPeriod.get(k) || 0), 0));
      return { currency, carriers, grand, count, periodTotals };
    }).sort((a, b) => b.grand - a.grand);
    const distinctCarriers = new Set<string>();
    for (const cg of byCurrency.values()) for (const k of cg.keys()) distinctCarriers.add(k);
    return { periods, groups, count: demurrageInvoices.length, carrierCount: distinctCarriers.size, multiCurrency: groups.length > 1 };
  }, [demurrageInvoices, demGranularity]);

  const demMoney = useCallback(
    (n: number, currency: string) => `${currency ? currency + ' ' : '$'}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [],
  );

  const buildDemurrageSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Demurrage by Carrier');
    const dateStr = new Date().toLocaleDateString();
    const gran = demGranularity === 'week' ? 'Weekly' : 'Monthly';
    const totalsLine = demStats.groups.map(g => `${formatNum(g.grand, 2)} ${g.currency}`).join(' · ') || '0.00';
    addTitleRows(ws, `Demurrage Cost by Carrier (${gran})`, `Generated ${dateStr} | ${demStats.carrierCount} carriers | ${demStats.count} invoices | ${totalsLine} total`);

    const header = ['Carrier', ...demStats.periods.map(p => p.label), 'Total', 'Invoices'];
    const headerRowNum = ws.rowCount + 1;
    ws.addRow(header);
    applyHeaderRow(ws, headerRowNum);
    for (let i = 2; i <= header.length; i++) ws.getRow(headerRowNum).getCell(i).alignment = { horizontal: 'right' };

    // One block per currency (amounts never summed across currencies).
    demStats.groups.forEach((g) => {
      if (demStats.multiCurrency) {
        const br = ws.addRow([`${g.currency} — ${formatNum(g.grand, 2)} total`]);
        br.font = { bold: true, italic: true };
      }
      g.carriers.forEach((c) => {
        const r = ws.addRow([c.carrier, ...demStats.periods.map(p => c.byPeriod.get(p.key) || 0), c.total, c.count]);
        for (let i = 2; i <= header.length - 1; i++) { r.getCell(i).numFmt = CURRENCY_FMT; r.getCell(i).alignment = { horizontal: 'right' }; }
        r.getCell(header.length).numFmt = INT_FMT;
        r.getCell(header.length).alignment = { horizontal: 'right' };
      });
      const totalRowNum = ws.rowCount + 1;
      const tr = ws.addRow([`Total (${g.currency})`, ...demStats.periods.map(p => g.periodTotals.get(p.key) || 0), g.grand, g.count]);
      for (let i = 2; i <= header.length - 1; i++) { tr.getCell(i).numFmt = CURRENCY_FMT; tr.getCell(i).alignment = { horizontal: 'right' }; }
      tr.getCell(header.length).numFmt = INT_FMT;
      tr.getCell(header.length).alignment = { horizontal: 'right' };
      applyTotalRow(ws, totalRowNum);
    });

    ws.getColumn(1).width = 26;
    for (let i = 2; i <= header.length; i++) ws.getColumn(i).width = 14;
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 1 }];
  }, [demStats, demGranularity]);


  const exportDemurrage = useCallback(async () => {
    const ExcelJSRuntime = (await import('exceljs')).default;
    const wb = new ExcelJSRuntime.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    buildDemurrageSheet(wb);
    const buf = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_Demurrage_by_Carrier_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [buildDemurrageSheet]);

  return (
    <div>
      <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
          <Clock size={14} />
          Demurrage Cost by Carrier
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center border border-[#E4E3E0]/20">
            {(['week', 'month'] as const).map(g => (
              <button
                key={g}
                onClick={() => setDemGranularity(g)}
                className={`px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold transition-colors ${demGranularity === g ? 'bg-[#E4E3E0] text-[#141414]' : 'bg-[#2a2a2a] text-[#E4E3E0] hover:bg-[#3a3a3a]'}`}
              >
                {g === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
          <button onClick={exportDemurrage} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
            <Download size={11} /> Excel
          </button>
        </div>
      </div>
      <div className="border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
        <div className="grid grid-cols-3 gap-0 border-b border-[#141414]">
          <div className="p-4 border-r border-gray-200 bg-gray-50">
            <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Total Demurrage</div>
            {demStats.groups.length === 0 ? (
              <div className="font-mono font-bold text-lg">{demMoney(0, 'CAD')}</div>
            ) : (
              demStats.groups.map(g => (
                <div key={g.currency} className="font-mono font-bold text-lg leading-tight">{demMoney(g.grand, g.currency)}</div>
              ))
            )}
          </div>
          <div className="p-4 border-r border-gray-200">
            <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Carriers</div>
            <div className="font-mono font-bold text-lg">{demStats.carrierCount}</div>
          </div>
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Invoices</div>
            <div className="font-mono font-bold text-lg">{demStats.count}</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 sticky left-0 bg-gray-50 z-10">Carrier</th>
                {demStats.periods.map(p => (
                  <th key={p.key} className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 whitespace-nowrap">{p.label}</th>
                ))}
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Total</th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Inv.</th>
              </tr>
            </thead>
            {demStats.groups.map(g => (
              <tbody key={g.currency} className="border-t border-[#141414]/20">
                {demStats.multiCurrency && (
                  <tr className="bg-[#141414]/5">
                    <td colSpan={demStats.periods.length + 3} className="px-4 py-1.5 text-[10px] uppercase tracking-widest font-bold sticky left-0 bg-[#f3f3f2] z-10">{g.currency}</td>
                  </tr>
                )}
                {g.carriers.map(c => (
                  <tr key={c.carrier} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 font-bold sticky left-0 bg-white z-10">{c.carrier}</td>
                    {demStats.periods.map(p => {
                      const v = c.byPeriod.get(p.key) || 0;
                      return <td key={p.key} className="px-4 py-2 text-right font-mono whitespace-nowrap">{v ? demMoney(v, g.currency) : <span className="opacity-30">—</span>}</td>;
                    })}
                    <td className="px-4 py-2 text-right font-mono font-bold whitespace-nowrap">{demMoney(c.total, g.currency)}</td>
                    <td className="px-4 py-2 text-right font-mono opacity-70">{c.count}</td>
                  </tr>
                ))}
                <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                  <td className="px-4 py-2 text-[10px] uppercase tracking-widest sticky left-0 bg-gray-50 z-10 whitespace-nowrap">Total{demStats.multiCurrency ? ` (${g.currency})` : ` (${g.carriers.length} carrier${g.carriers.length === 1 ? '' : 's'})`}</td>
                  {demStats.periods.map(p => (
                    <td key={p.key} className="px-4 py-2 text-right font-mono whitespace-nowrap">{demMoney(g.periodTotals.get(p.key) || 0, g.currency)}</td>
                  ))}
                  <td className="px-4 py-2 text-right font-mono whitespace-nowrap">{demMoney(g.grand, g.currency)}</td>
                  <td className="px-4 py-2 text-right font-mono">{g.count}</td>
                </tr>
              </tbody>
            ))}
            {demStats.groups.length === 0 && (
              <tbody>
                <tr><td colSpan={demStats.periods.length + 3} className="px-4 py-8 text-center text-gray-400">No demurrage invoices yet. Carrier demurrage / wait-time invoices recorded on the Supply Chain page appear here.</td></tr>
              </tbody>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
