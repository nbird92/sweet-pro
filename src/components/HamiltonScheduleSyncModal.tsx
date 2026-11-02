import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Calendar, X, RefreshCw, AlertTriangle, ArrowRight } from 'lucide-react';
import type { Customer, SKU, QAProduct, Carrier, Shipment, Location, Invoice } from '../types';
import { fetchTabFromSheet, extractSheetId } from '../utils/googleOrderSheetSync';
import { parseCSV } from '../utils/googleSheetsSync';
import {
  HAMILTON_SCHEDULE_SHEET_ID, HAMILTON_SCHEDULE_TAB, HAMILTON_SCHEDULE_LOCATION,
  parseHamiltonSchedule, classifyScheduleRows, guessAppBay, normalizeScheduleTime,
  loadHamiltonBayMap, saveHamiltonBayMap, loadHamiltonSource, saveHamiltonSource,
  type ScheduleParseResult, type ScheduleRowKind, type ClassifiedScheduleRow,
} from '../utils/hamiltonScheduleSync';

// Sync modal for the Hamilton (Sherman) dock schedule sheet. Unlike the generic
// sheet importers this one knows the sheet's wide bay-panel layout, so there are
// no columns to map — only which sheet bay feeds which app bay. Flow:
//   1. Read Sheet  → parse every booked bay-slot (pure, once).
//   2. Map bays + pick a date window → rows re-classify live against the
//      current schedule (new / update / unchanged / conflict).
//   3. Tick what to apply → onApply(new shipments, id-targeted patches).

const PREVIEW_LIMIT = 400;

interface Props {
  onClose: () => void;
  existingShipments: Shipment[];
  /** Invoice table — source of each BOL's scaled (invoiced) Qty (MT). */
  invoices: Invoice[];
  locations: Location[];
  customers: Customer[];
  skus: SKU[];
  qaProducts: QAProduct[];
  carriers: Carrier[];
  /** Appointment slot labels ("HH:MM") the Sherman grid renders — used to flag off-grid times. */
  slotTimes: string[];
  onApply: (newShipments: Shipment[], updates: Array<{ id: string; patch: Partial<Shipment> }>) => void;
}

const mondayOfThisWeek = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const KIND_STYLE: Record<ScheduleRowKind, { label: string; badge: string; tile: string }> = {
  new: { label: 'New', badge: 'bg-emerald-100 text-emerald-800', tile: 'border-emerald-500/40 bg-emerald-50' },
  update: { label: 'Update', badge: 'bg-blue-100 text-blue-800', tile: 'border-blue-500/40 bg-blue-50' },
  conflict: { label: 'Conflict', badge: 'bg-amber-100 text-amber-800', tile: 'border-amber-500/40 bg-amber-50' },
  unchanged: { label: 'Unchanged', badge: 'bg-[#141414]/5 text-[#141414]/60', tile: 'border-[#141414]/20 bg-[#F5F5F5]' },
};

export default function HamiltonScheduleSyncModal({ onClose, existingShipments, invoices, locations, customers, skus, qaProducts, carriers, slotTimes, onApply }: Props) {
  const [sheetUrl, setSheetUrl] = useState(() => `https://docs.google.com/spreadsheets/d/${loadHamiltonSource().sheetId}/`);
  const [tabName, setTabName] = useState(() => loadHamiltonSource().tab);
  const [year, setYear] = useState(new Date().getFullYear());
  const [fromDate, setFromDate] = useState(mondayOfThisWeek());
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ScheduleParseResult | null>(null);
  const [bayMap, setBayMap] = useState<Record<string, string>>(loadHamiltonBayMap);
  const [kindFilter, setKindFilter] = useState<ScheduleRowKind | 'all'>('all');
  const [search, setSearch] = useState('');
  // Per-row include overrides; rows without one follow the default (new + update on).
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());

  const shermanLoc = useMemo(
    () => locations.find(l => l.name === HAMILTON_SCHEDULE_LOCATION) || locations.find(l => l.name.toLowerCase().includes('sherman')),
    [locations],
  );
  const appBays = useMemo(() => shermanLoc?.bays || [], [shermanLoc]);
  const locationName = shermanLoc?.name || HAMILTON_SCHEDULE_LOCATION;
  const slotSet = useMemo(() => new Set(slotTimes), [slotTimes]);

  const updateBayMap = (sheetBay: string, appBay: string) => {
    setBayMap(prev => {
      const next = { ...prev, [sheetBay]: appBay };
      saveHamiltonBayMap(next);
      return next;
    });
  };

  const readSheet = async () => {
    const sheetId = extractSheetId(sheetUrl) || HAMILTON_SCHEDULE_SHEET_ID;
    setLoading(true);
    setError(null);
    try {
      const grid = parseCSV(await fetchTabFromSheet(sheetId, tabName.trim() || HAMILTON_SCHEDULE_TAB));
      const result = parseHamiltonSchedule(grid, { year }, { customers, skus, qaProducts, carriers });
      if (result.bays.length === 0) {
        setError('No bays found. Expected bay names merged across row 1 and CUSTOMER/CLIENT + PRODUCT headers in row 2.');
        return;
      }
      // Seed a mapping for any bay not mapped before (saved choices win).
      setBayMap(prev => {
        const next = { ...prev };
        for (const b of result.bays) if (!(b.name in next)) next[b.name] = guessAppBay(b.name, appBays);
        saveHamiltonBayMap(next);
        return next;
      });
      // Remember the source so Sync All reads the same sheet/tab unattended.
      saveHamiltonSource({ sheetId, tab: tabName.trim() || HAMILTON_SCHEDULE_TAB });
      setOverrides(new Map());
      setParsed(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const classified = useMemo(() => {
    if (!parsed) return null;
    return classifyScheduleRows(parsed.rows, {
      bayMap, from: fromDate || undefined, to: toDate || undefined,
      location: locationName, existing: existingShipments, appBays, invoices,
    });
  }, [parsed, bayMap, fromDate, toDate, locationName, existingShipments, appBays, invoices]);

  const isIncluded = (r: ClassifiedScheduleRow) =>
    r.kind !== 'unchanged' && (overrides.has(r.key) ? overrides.get(r.key)! : (r.kind === 'new' || r.kind === 'update'));
  const toggle = (r: ClassifiedScheduleRow) => setOverrides(prev => new Map(prev).set(r.key, !isIncluded(r)));

  const counts = useMemo(() => {
    const c: Record<ScheduleRowKind, number> = { new: 0, update: 0, conflict: 0, unchanged: 0 };
    classified?.rows.forEach(r => { c[r.kind]++; });
    return c;
  }, [classified]);
  const rowsPerBay = useMemo(() => {
    const m = new Map<string, number>();
    parsed?.rows.forEach(r => m.set(r.sheetBay, (m.get(r.sheetBay) || 0) + 1));
    return m;
  }, [parsed]);

  const visible = useMemo(() => {
    if (!classified) return [];
    const q = search.trim().toLowerCase();
    return classified.rows.filter(r => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (!q) return true;
      return [r.customerRaw, r.customer, r.productRaw, r.po, r.bol, r.carrier, r.sheetBay, r.date]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [classified, kindFilter, search]);

  const selected = classified ? classified.rows.filter(isIncluded) : [];
  const selNew = selected.filter(r => r.kind === 'new' || r.kind === 'conflict');
  const selUpd = selected.filter(r => r.kind === 'update');

  const setVisible = (on: boolean) => setOverrides(prev => {
    const next = new Map(prev);
    visible.forEach(r => { if (r.kind !== 'unchanged') next.set(r.key, on); });
    return next;
  });

  const apply = () => {
    onApply(
      selNew.map(r => r.shipment!).filter(Boolean),
      selUpd.map(r => ({ id: r.existing!.id, patch: r.patch! })),
    );
  };

  return (
    <div className="fixed inset-0 z-[510] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="bg-white border border-[#141414] shadow-[24px_24px_0px_0px_rgba(20,20,20,1)] max-w-6xl w-full overflow-hidden my-8"
      >
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Calendar size={14} /> Sync Hamilton (Sherman) Schedule</h3>
          <button onClick={onClose} className="hover:opacity-70"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          <p className="text-[11px] opacity-60">
            Reads the Sherman dock schedule — bays merged across <b>row 1</b>, each with its own WEEK / DATE / DAY / TIME block and
            CUSTOMER … OUT columns in <b>row 2</b>. Every booked bay slot becomes a shipment on <b>{locationName}</b>; slots already
            on the schedule are matched by BOL, then PO + date, then slot + customer, and updated instead of duplicated.
          </p>

          {/* Source */}
          <div className="grid grid-cols-[1fr_8rem_6rem_9rem_9rem_auto] gap-2 items-end">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold opacity-50">Google Sheet link</label>
              <input type="text" value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs font-mono outline-none focus:bg-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold opacity-50">Tab</label>
              <input type="text" value={tabName} onChange={e => setTabName(e.target.value)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none focus:bg-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold opacity-50">Year</label>
              <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value) || new Date().getFullYear())} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs font-mono outline-none focus:bg-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold opacity-50">From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none focus:bg-white" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold opacity-50">To (optional)</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none focus:bg-white" />
            </div>
            <button onClick={readSheet} disabled={loading} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-[11px] font-bold uppercase hover:opacity-80 disabled:opacity-40 flex items-center gap-2 whitespace-nowrap">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Reading…' : parsed ? 'Re-read Sheet' : 'Read Sheet'}
            </button>
          </div>
          {!shermanLoc && (
            <div className="border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 flex gap-2"><AlertTriangle size={14} className="shrink-0" /> No “{HAMILTON_SCHEDULE_LOCATION}” location found — add it (with its bays) under Locations so rows can be mapped to bays.</div>
          )}
          {error && <div className="border border-red-300 bg-red-50 p-2 text-xs text-red-700">{error}</div>}

          {parsed && classified && (
            <>
              {/* Bay mapping */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold opacity-50">Sheet bay → schedule bay</label>
                <div className="grid grid-cols-2 gap-2">
                  {parsed.bays.map(b => (
                    <div key={b.name} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center border border-[#141414]/10 p-2">
                      <div className="text-xs font-bold truncate" title={b.name}>{b.name} <span className="font-normal opacity-50">({rowsPerBay.get(b.name) || 0})</span></div>
                      <ArrowRight size={12} className="opacity-40" />
                      <select value={bayMap[b.name] ?? ''} onChange={e => updateBayMap(b.name, e.target.value)} className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-xs outline-none focus:bg-white">
                        <option value="">— Skip this bay —</option>
                        {appBays.map(ab => <option key={ab} value={ab}>{ab}</option>)}
                        {bayMap[b.name] && !appBays.includes(bayMap[b.name]) && <option value={bayMap[b.name]}>{bayMap[b.name]} (not a bay)</option>}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-5 gap-3">
                {(['new', 'update', 'conflict', 'unchanged'] as ScheduleRowKind[]).map(k => (
                  <button key={k} onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
                    className={`border p-3 text-left ${KIND_STYLE[k].tile} ${kindFilter === k ? 'ring-2 ring-[#141414]' : ''}`}>
                    <div className="text-[10px] uppercase opacity-60">{KIND_STYLE[k].label}</div>
                    <div className="text-2xl font-bold">{counts[k]}</div>
                  </button>
                ))}
                <div className="border border-[#141414]/20 p-3">
                  <div className="text-[10px] uppercase opacity-60">Outside window / skipped bay</div>
                  <div className="text-2xl font-bold">{classified.excluded}</div>
                </div>
              </div>

              {parsed.problems.length > 0 && (
                <details className="border border-red-300 bg-red-50 p-2 text-xs">
                  <summary className="cursor-pointer text-red-700 font-bold">{parsed.problems.length} unreadable row{parsed.problems.length === 1 ? '' : 's'}</summary>
                  {parsed.problems.slice(0, 50).map((p, i) => <div key={i} className="py-0.5">Row {p.sheetRow} · {p.sheetBay} — {p.message}</div>)}
                </details>
              )}

              {/* Rows */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter customer, product, PO, BOL, carrier…" className="flex-1 bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none focus:bg-white" />
                  <button onClick={() => setVisible(true)} className="px-3 py-2 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">Select shown</button>
                  <button onClick={() => setVisible(false)} className="px-3 py-2 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">Clear shown</button>
                </div>
                <div className="border border-[#141414]/10 max-h-[45vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#F5F5F5] border-b border-[#141414]/10 sticky top-0">
                      <tr>
                        <th className="p-2 w-6"></th>
                        <th className="p-2 text-left font-bold">Status</th>
                        <th className="p-2 text-left font-bold">Date</th>
                        <th className="p-2 text-left font-bold">Time</th>
                        <th className="p-2 text-left font-bold">Bay</th>
                        <th className="p-2 text-left font-bold">Customer</th>
                        <th className="p-2 text-left font-bold">Product</th>
                        <th className="p-2 text-left font-bold">PO</th>
                        <th className="p-2 text-left font-bold">BOL</th>
                        <th className="p-2 text-right font-bold">Qty</th>
                        <th className="p-2 text-right font-bold" title="Scaled Qty (MT) from the invoice table">Scaled</th>
                        <th className="p-2 text-left font-bold">Carrier</th>
                        <th className="p-2 text-left font-bold">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.slice(0, PREVIEW_LIMIT).map(r => {
                        const offGrid = r.time && slotSet.size > 0 && !slotSet.has(normalizeScheduleTime(r.time));
                        return (
                          <tr key={r.key} className={`border-b border-[#141414]/5 ${isIncluded(r) ? '' : 'opacity-50'}`}>
                            <td className="p-2"><input type="checkbox" checked={isIncluded(r)} disabled={r.kind === 'unchanged'} onChange={() => toggle(r)} /></td>
                            <td className="p-2"><span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase ${KIND_STYLE[r.kind].badge}`}>{KIND_STYLE[r.kind].label}</span></td>
                            <td className="p-2 font-mono whitespace-nowrap">{r.date}</td>
                            <td className="p-2 font-mono">{r.time || '—'}</td>
                            <td className="p-2 whitespace-nowrap" title={`Sheet: ${r.sheetBay} (row ${r.sheetRow})`}>{r.appBay}</td>
                            <td className="p-2" title={r.customer !== r.customerRaw ? `Sheet: ${r.customerRaw}` : undefined}>{r.customer}</td>
                            <td className="p-2" title={r.product !== r.productRaw ? `Sheet: ${r.productRaw}` : undefined}>{r.product || '—'}</td>
                            <td className="p-2 font-mono">{r.po || '—'}</td>
                            <td className="p-2 font-mono">{r.bol || '—'}</td>
                            <td className="p-2 text-right font-mono">{r.qty || '—'}</td>
                            <td className="p-2 text-right font-mono">{(r.shipment?.scaledQty ?? r.patch?.scaledQty ?? r.existing?.scaledQty) || '—'}</td>
                            <td className="p-2">{r.carrier || '—'}</td>
                            <td className="p-2 text-[11px]">
                              {r.changes.map(c => (
                                <div key={c.field as string} className="whitespace-nowrap"><span className="opacity-50">{c.field as string}:</span> {c.from || '∅'} → <b>{c.to}</b></div>
                              ))}
                              {r.note && <div className="text-amber-700">{r.note}</div>}
                              {offGrid && <div className="text-amber-700">{r.time} isn’t a slot on the grid — won’t display until moved</div>}
                            </td>
                          </tr>
                        );
                      })}
                      {visible.length === 0 && (
                        <tr><td colSpan={13} className="p-6 text-center opacity-50 italic">No rows match.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {visible.length > PREVIEW_LIMIT && <div className="text-[10px] opacity-50">Showing the first {PREVIEW_LIMIT} of {visible.length} rows — selection still covers every row.</div>}
              </div>
            </>
          )}
        </div>

        <div className="bg-[#F5F5F5] border-t border-[#141414] px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-[11px] font-bold uppercase hover:bg-white">Cancel</button>
          <button onClick={apply} disabled={selected.length === 0} className="px-4 py-2 bg-emerald-700 text-white text-[11px] font-bold uppercase hover:bg-emerald-800 disabled:opacity-40">
            Import {selNew.length} new · Update {selUpd.length}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
