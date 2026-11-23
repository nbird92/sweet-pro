// Contract tools — Merge, Transfer and Increase / Decrease, each with a
// preview of the resulting contracts that can be edited before applying.
//
//  • Merge:     two contracts → ONE new contract (new number). Volumes add up;
//               Price/MT is the volume-weighted average; the two originals go
//               inactive. The merged contract keeps counting the originals'
//               invoices / orders (mergedFrom), so taken / on order carry over.
//  • Transfer:  move volume from contract A to contract B.
//  • Inc / Dec: raise or lower one contract's volume (an increase can carry its
//               own price, re-weighting the contract price).
// Every change appends a dated record to the notes of each contract touched.

import React, { useMemo, useState } from 'react';
import { X, GitMerge, ArrowRightLeft, PlusCircle, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react';
import type { Contract, ContractLine, Customer } from '../types';
import { nextTempContractNumber } from '../utils/contractMatch';

export type ContractToolMode = 'merge' | 'transfer' | 'adjust' | 'roll';
type Stats = Map<string, { taken: number; onOrder: number; outstanding: number }>;

interface Props {
  mode: ContractToolMode;
  contracts: Contract[];
  customers: Customer[];
  stats: Stats;
  userName: string;
  /** Upsert these contracts (new + changed). */
  onApply: (upserts: Contract[], summary: string) => void;
  onClose: () => void;
  /** Contract Start / End month options — the same list as the Customer Quote
   *  page's dropdowns ("Nov 2026", labelled with the futures terminal). */
  monthOptions: Array<{ value: string; label: string }>;
  /** Average #11 raw (USD/cwt) over market months from..to ("Mon YYYY"). */
  rawForPeriod: (fromMonth: string, toMonth: string) => { avg: number; months: string[] } | null;
  /** Quote tool yield-loss multiplier (raw → refined). */
  yieldMultiplier: number;
  /** FX used when a contract has none stored. */
  defaultFx: number;
}
const MT_TO_CWT = 22.0462;

// Contract dates are "Mon YYYY" (quote tool) or ISO dates (imports).
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Month ordinal for either format (NaN when unreadable). */
const monthKey = (v?: string): number => {
  const t = (v || '').trim();
  const iso = /^(\d{4})-(\d{2})/.exec(t);
  if (iso) return Number(iso[1]) * 12 + Number(iso[2]) - 1;
  const mi = MO.findIndex(m => t.toLowerCase().startsWith(m.toLowerCase()));
  const y = parseInt(t.split(/\s+/).pop() || '', 10);
  return mi >= 0 && y ? y * 12 + mi : NaN;
};
/** Any contract date as "Mon YYYY" (the quote dropdown value). */
const toMonthValue = (v?: string): string => {
  const k = monthKey(v);
  return Number.isFinite(k) ? `${MO[k % 12]} ${Math.floor(k / 12)}` : (v || '');
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n: number, d = 1) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n: number, cur?: string) => `${cur ? cur + ' ' : ''}$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const stamp = () => new Date().toLocaleString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const appendNote = (prev: string | undefined, entry: string) => [entry, (prev || '').trim()].filter(Boolean).join('\n\n');
const inputCls = 'w-full bg-white border border-[#141414] px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[#141414]/20';
const lbl = 'block text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1';

const TITLES: Record<ContractToolMode, { title: string; icon: React.ReactNode; apply: string }> = {
  merge: { title: 'Merge Contracts', icon: <GitMerge size={16} />, apply: 'Merge Contracts' },
  transfer: { title: 'Transfer Volume', icon: <ArrowRightLeft size={16} />, apply: 'Transfer Volume' },
  adjust: { title: 'Increase / Decrease Contract', icon: <PlusCircle size={16} />, apply: 'Apply Change' },
  roll: { title: 'Roll Contract', icon: <CalendarClock size={16} />, apply: 'Roll Contract' },
};

export default function ContractToolsModal({ mode, contracts, customers, stats, userName, onApply, onClose, monthOptions, rawForPeriod, yieldMultiplier, defaultFx }: Props) {
  /** Month dropdown — same options as the Customer Quote page; a contract's
   *  current month is added when it falls outside the market list. */
  const monthSelect = (value: string, onChange: (v: string) => void, extra: Array<string | undefined> = [], range?: { min: number; max: number } | null) => {
    let opts = [...monthOptions];
    for (const x of [value, ...extra].map(toMonthValue).filter(Boolean)) {
      if (!opts.some(o => o.value === x)) opts.push({ value: x, label: x });
    }
    if (range) {
      // Limited window: offer EVERY month in it (past months included), with
      // the quote page's terminal label where the market list has one.
      const inRange: Array<{ value: string; label: string }> = [];
      for (let k = range.min; k <= range.max; k++) {
        const v = `${MO[k % 12]} ${Math.floor(k / 12)}`;
        inRange.push(monthOptions.find(o => o.value === v) || { value: v, label: v });
      }
      opts = inRange;
    }
    opts.sort((a, b) => (monthKey(a.value) || 0) - (monthKey(b.value) || 0));
    return (
      <select value={toMonthValue(value)} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="">Select Month</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  };
  const statOf = (c?: Contract) => {
    if (!c) return { volume: 0, taken: 0, onOrder: 0, outstanding: 0, available: 0 };
    const s = stats.get(c.id);
    const taken = s?.taken ?? c.volumeTaken ?? 0;
    const onOrder = s?.onOrder ?? 0;
    const outstanding = (c.contractVolume || 0) - taken;
    return { volume: c.contractVolume || 0, taken, onOrder, outstanding, available: outstanding - onOrder };
  };

  // Customers that hold contracts (match by id, number or name).
  const custOf = (c: Contract) => customers.find(cu => cu.id === c.customerNumber || (cu.customerNumber && cu.customerNumber === c.customerNumber) || cu.name === c.customerName);
  const contractCustomers = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contracts) {
      if (c.active === false) continue;
      const cu = custOf(c);
      m.set(cu?.id || `name:${c.customerName}`, cu?.name || c.customerName || '(no customer)');
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, customers]);
  const contractsFor = (custKey: string) => contracts
    .filter(c => c.active !== false && c.contractNumber)
    .filter(c => { const cu = custOf(c); return (cu?.id || `name:${c.customerName}`) === custKey; })
    .sort((a, b) => a.contractNumber.localeCompare(b.contractNumber));

  const [custA, setCustA] = useState('');
  const [idA, setIdA] = useState('');
  const [custB, setCustB] = useState('');
  const [idB, setIdB] = useState('');
  const A = contracts.find(c => c.id === idA);
  const B = contracts.find(c => c.id === idB);
  const sA = statOf(A), sB = statOf(B);
  const [comment, setComment] = useState('');

  // ── Merge draft ──
  // New merged contract gets a temporary number until the ITAS one is typed in.
  const [mNumber, setMNumber] = useState(() => nextTempContractNumber(contracts.map(c => c.contractNumber)));
  // Merged contract number: keep A's, keep B's, or a brand-new number.
  const [mNumMode, setMNumMode] = useState<'new' | 'keepA' | 'keepB'>('new');
  const [mPrice, setMPrice] = useState<string>('');
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd] = useState('');
  // ── Transfer draft ──
  const [tAmount, setTAmount] = useState<string>('');
  const [tReweight, setTReweight] = useState(false);
  const [tPriceB, setTPriceB] = useState<string>('');
  // Transfer destination: an existing contract, or a brand-new contract that
  // copies every pricing component of contract A.
  const [tTarget, setTTarget] = useState<'existing' | 'new'>('existing');
  const [tNewCust, setTNewCust] = useState('');
  const [tNewNumber, setTNewNumber] = useState(() => nextTempContractNumber(contracts.map(c => c.contractNumber)));
  const [tBStart, setTBStart] = useState('');
  const [tBEnd, setTBEnd] = useState('');
  // Increase / decrease: contract period (e.g. extend the end with more volume).
  const [aStart, setAStart] = useState('');
  const [aEnd, setAEnd] = useState('');
  // ── Roll draft ──
  const [rEnd, setREnd] = useState('');
  const [rOldRaw, setROldRaw] = useState<string>('');
  const [rNewRaw, setRNewRaw] = useState<string>('');
  const [rPrice, setRPrice] = useState<string>('');
  // ── Adjust draft ──
  const [aDir, setADir] = useState<'increase' | 'decrease'>('increase');
  const [aAmount, setAAmount] = useState<string>('');
  const [aAddPrice, setAAddPrice] = useState<string>('');
  const [aPrice, setAPrice] = useState<string>('');

  const weighted = (v1: number, p1: number, v2: number, p2: number) => (v1 + v2 > 0 ? (v1 * p1 + v2 * p2) / (v1 + v2) : (p1 || p2));

  // Merge — computed defaults (editable overrides above).
  const mergeCalc = useMemo(() => {
    if (!A || !B) return null;
    const volume = (A.contractVolume || 0) + (B.contractVolume || 0);
    const price = r2(weighted(A.contractVolume || 0, A.finalPrice || 0, B.contractVolume || 0, B.finalPrice || 0));
    const byMonth = (xs: Array<string | undefined>) => xs.filter(x => Number.isFinite(monthKey(x))).sort((a, b) => monthKey(a) - monthKey(b)) as string[];
    const start = toMonthValue(byMonth([A.startDate, B.startDate])[0]);
    const end = toMonthValue(byMonth([A.endDate, B.endDate]).slice(-1)[0]);
    // Contract lines: union by product; a product on both is volume-weighted.
    const lines = new Map<string, ContractLine>();
    const keyOf = (l: ContractLine) => l.productKey || l.productName;
    for (const l of A.contractLines || []) lines.set(keyOf(l), { ...l });
    for (const l of B.contractLines || []) {
      const ex = lines.get(keyOf(l));
      if (!ex) { lines.set(keyOf(l), { ...l, id: `${l.id}-m` }); continue; }
      lines.set(keyOf(l), {
        ...ex,
        finalPriceMt: r2(weighted(A.contractVolume || 0, ex.finalPriceMt || 0, B.contractVolume || 0, l.finalPriceMt || 0)),
        differentialCadMt: r2(weighted(A.contractVolume || 0, ex.differentialCadMt || 0, B.contractVolume || 0, l.differentialCadMt || 0)),
      });
    }
    return { volume, price, start, end, lines: [...lines.values()] };
  }, [A, B]);

  const warnings: string[] = [];
  let preview: React.ReactNode = null;
  let canApply = false;
  let build: (() => { upserts: Contract[]; summary: string }) | null = null;
  const who = userName ? ` · ${userName}` : '';

  if (mode === 'merge' && A && B && mergeCalc) {
    if (A.id === B.id) warnings.push('Pick two different contracts.');
    if ((A.currency || 'CAD') !== (B.currency || 'CAD')) warnings.push(`Currencies differ (${A.currency} vs ${B.currency}) — the weighted price mixes currencies.`);
    if ((A.skuName || '') !== (B.skuName || '')) warnings.push(`Products differ (${A.skuName || '—'} vs ${B.skuName || '—'}); the merged contract keeps contract A's product and combines the product lines.`);
    // The contract that carries on: A (new number or keep A) or B (keep B).
    const base = mNumMode === 'keepB' ? B : A;
    const other = mNumMode === 'keepB' ? A : B;
    if (custA !== custB) warnings.push(`The contracts belong to different customers; the merged contract belongs to ${base.customerName} (contract ${mNumMode === 'keepB' ? 'B' : 'A'}).`);
    const number = mNumMode === 'keepA' ? A.contractNumber : mNumMode === 'keepB' ? B.contractNumber : mNumber.trim();
    const dup = mNumMode === 'new' && !!number && contracts.some(c => c.contractNumber.trim().toLowerCase() === number.toLowerCase());
    if (!number) warnings.push('Enter the new contract number for the merged contract.');
    if (dup) warnings.push(`Contract number ${number} already exists.`);
    // All or nothing: the merged contract holds the FULL volume of both contracts.
    const volume = mergeCalc.volume;
    const price = mPrice === '' ? mergeCalc.price : r2(Number(mPrice));
    const start = mStart || mergeCalc.start, end = mEnd || mergeCalc.end;
    // The merged period can't reach past the originals: earliest original
    // start … latest original end.
    const origKeys = [A.startDate, B.startDate, A.endDate, B.endDate].map(monthKey).filter(Number.isFinite);
    const mergeRange = origKeys.length ? { min: Math.min(...origKeys), max: Math.max(...origKeys) } : null;
    if (Number.isFinite(monthKey(start)) && Number.isFinite(monthKey(end)) && monthKey(start) > monthKey(end)) warnings.push('Contract Start is after Contract End.');
    const taken = sA.taken + sB.taken, onOrder = sA.onOrder + sB.onOrder;
    const periodOk = !(Number.isFinite(monthKey(start)) && Number.isFinite(monthKey(end)) && monthKey(start) > monthKey(end));
    canApply = !!number && !dup && A.id !== B.id && periodOk;
    const row = (label: string, a: React.ReactNode, b: React.ReactNode, m: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{a}</td><td className="p-2 font-mono">{b}</td><td className="p-2 font-mono font-bold bg-emerald-50">{m}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">Contract A</th><th className="p-2 text-left">Contract B</th><th className="p-2 text-left bg-emerald-100">Merged {mNumMode === 'new' ? '(new contract)' : `(keeps ${number})`}</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, B.contractNumber, mNumMode === 'new'
            ? <div><input value={mNumber} onChange={e => setMNumber(e.target.value)} placeholder="New contract no." className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">Temporary number — type the ITAS number here or later in Edit Contract</div></div>
            : number)}
          {row('Customer', A.customerName, B.customerName, base.customerName)}
          {row('Product', A.skuName || '—', B.skuName || '—', base.skuName || '—')}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(sB.volume), <span title="A merge combines the full volume of both contracts">{fmt(volume)} <span className="font-normal text-[9px] opacity-60">(A + B — full volume)</span></span>)}
          {row('Volume Taken (MT)', fmt(sA.taken), fmt(sB.taken), fmt(taken))}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sB.onOrder), fmt(onOrder))}
          {row('Volume Outstanding (MT)', fmt(sA.outstanding), fmt(sB.outstanding), fmt(volume - taken))}
          {row('Price / MT', money(A.finalPrice, A.currency), money(B.finalPrice, B.currency), <div><input type="number" step="0.01" value={mPrice === '' ? mergeCalc.price : mPrice} onChange={e => setMPrice(e.target.value)} className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">volume-weighted: {money(mergeCalc.price)}</div></div>)}
          {row('Contract Start', toMonthValue(A.startDate) || '—', toMonthValue(B.startDate) || '—', monthSelect(start, setMStart, [A.startDate, B.startDate], mergeRange))}
          {row('Contract End', toMonthValue(A.endDate) || '—', toMonthValue(B.endDate) || '—', monthSelect(end, setMEnd, [A.endDate, B.endDate], mergeRange))}
          {row('Status after merge', mNumMode === 'keepA' ? 'Active (merged)' : 'Inactive', mNumMode === 'keepB' ? 'Active (merged)' : 'Inactive', 'Active')}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const record = `[${when}${who}] MERGED: ${A.contractNumber} (${fmt(sA.volume)} MT @ ${money(A.finalPrice, A.currency)}; taken ${fmt(sA.taken)}, on order ${fmt(sA.onOrder)}) + ${B.contractNumber} (${fmt(sB.volume)} MT @ ${money(B.finalPrice, B.currency)}; taken ${fmt(sB.taken)}, on order ${fmt(sB.onOrder)}) → ${number}${mNumMode === 'new' ? ' (new contract)' : ' (kept number)'}: ${fmt(volume)} MT @ ${money(price, A.currency)} (taken ${fmt(taken)}, on order ${fmt(onOrder)}, outstanding ${fmt(volume - taken)}).${comment.trim() ? ` Note: ${comment.trim()}` : ''}`;
      const kept = mNumMode !== 'new';
      // Keeping a number: that contract carries on (its notes stay first, the
      // other's are appended). New number: both originals' notes are carried over.
      const prevNotes = kept
        ? [(base.notes || '').trim(), other.notes ? `— Notes from ${other.contractNumber} —\n${other.notes.trim()}` : ''].filter(Boolean).join('\n\n')
        : [A.notes ? `— Notes from ${A.contractNumber} —\n${A.notes.trim()}` : '', B.notes ? `— Notes from ${B.contractNumber} —\n${B.notes.trim()}` : ''].filter(Boolean).join('\n\n');
      const merged: Contract = {
        ...base,
        id: kept ? base.id : `CON-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contractNumber: number,
        contractVolume: volume,
        volumeTaken: taken,
        volumeOutstanding: volume - taken,
        finalPrice: price,
        startDate: start,
        endDate: end,
        contractLines: mergeCalc.lines,
        allowedCustomerIds: Array.from(new Set([...(A.allowedCustomerIds || []), ...(B.allowedCustomerIds || [])])),
        mergedFrom: Array.from(new Set([A.contractNumber, B.contractNumber, ...(A.mergedFrom || []), ...(B.mergedFrom || [])])).filter(cn => cn !== number),
        active: true,
        contractDate: kept ? base.contractDate : new Date().toISOString().slice(0, 10),
        notes: appendNote(prevNotes, record),
      };
      const closeOut = (c: Contract, s: typeof sA) => ({
        ...c, active: false, volumeTaken: s.taken, volumeOutstanding: s.outstanding,
        notes: appendNote(c.notes, `[${when}${who}] MERGED into ${number}${kept ? '' : ` together with ${c.id === A.id ? B.contractNumber : A.contractNumber}`}. This contract is now inactive; its invoices and orders count toward ${number}.${comment.trim() ? ` Note: ${comment.trim()}` : ''}`),
      });
      if (kept) {
        const otherStats = other.id === A.id ? sA : sB;
        return { upserts: [merged, closeOut(other, otherStats)], summary: `Merged ${other.contractNumber} into ${number} (kept contract number ${number}): ${fmt(volume)} MT @ ${money(price, base.currency)}. ${other.contractNumber} is now inactive.` };
      }
      return { upserts: [merged, closeOut(A, sA), closeOut(B, sB)], summary: `Merged ${A.contractNumber} + ${B.contractNumber} into new contract ${number}: ${fmt(volume)} MT @ ${money(price, A.currency)}.` };
    };
  }

  const newCustomer = customers.find(c => c.id === (tNewCust || (A ? custOf(A)?.id : '') || ''));
  if (mode === 'transfer' && A && tTarget === 'new') {
    const amt = Number(tAmount) || 0;
    const number = tNewNumber.trim();
    const dup = !!number && contracts.some(c => c.contractNumber.trim().toLowerCase() === number.toLowerCase());
    if (amt <= 0) warnings.push('Enter the volume to transfer.');
    if (amt > sA.available) warnings.push(`That's more than contract A has available (${fmt(sA.available)} MT = outstanding ${fmt(sA.outstanding)} − on order ${fmt(sA.onOrder)}).`);
    if (!newCustomer) warnings.push('Pick the customer for the new contract.');
    if (!number) warnings.push('Enter a contract number for the new contract.');
    if (dup) warnings.push(`Contract number ${number} already exists.`);
    const priceNew = tPriceB === '' ? r2(A.finalPrice || 0) : r2(Number(tPriceB));
    // The new contract always takes contract A's period — not editable.
    const start = A.startDate || '', end = A.endDate || '';
    canApply = amt > 0 && !!newCustomer && !!number && !dup;
    const row = (label: string, a1: React.ReactNode, a2: React.ReactNode, b2: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{a1}</td><td className="p-2 font-mono font-bold bg-red-50">{a2}</td><td className="p-2 font-mono font-bold bg-emerald-50">{b2}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">A — now</th><th className="p-2 text-left bg-red-100">A — after</th><th className="p-2 text-left bg-emerald-100">New contract</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, A.contractNumber, <div><input value={tNewNumber} onChange={e => setTNewNumber(e.target.value)} className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">Temporary number — type the ITAS number here or later in Edit Contract</div></div>)}
          {row('Customer', A.customerName, A.customerName, newCustomer?.name || '—')}
          {row('Product', A.skuName || '—', A.skuName || '—', A.skuName || '—')}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(sA.volume - amt), fmt(amt))}
          {row('Volume Taken (MT)', fmt(sA.taken), fmt(sA.taken), fmt(0))}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sA.onOrder), fmt(0))}
          {row('Volume Outstanding (MT)', fmt(sA.outstanding), fmt(sA.outstanding - amt), fmt(amt))}
          {row('Price / MT', money(A.finalPrice, A.currency), money(A.finalPrice, A.currency), <div><input type="number" step="0.01" value={tPriceB === '' ? priceNew : tPriceB} onChange={e => setTPriceB(e.target.value)} className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">copied from {A.contractNumber}</div></div>)}
          {row('Raw / FX / Margin', `${A.rawPriceUsdMt != null ? `USD ${fmt(A.rawPriceUsdMt, 2)}/MT` : '—'} · ${A.fxRate ?? '—'} · ${A.margin != null ? money(A.margin) : '—'}`, '', 'same as A')}
          {row('Freight / Duty / Pallet', `${A.deliveredFreight != null ? money(A.deliveredFreight) : '—'} · ${A.exportDuty != null ? money(A.exportDuty) : '—'} · ${A.palletCharge != null ? money(A.palletCharge) : '—'}`, '', 'same as A')}
          {row('Terms', [A.shippingTerms, A.paymentTerms, A.palletType].filter(Boolean).join(' · ') || '—', '', 'same as A')}
          {row('Product lines', `${(A.contractLines || []).length}`, '', `${(A.contractLines || []).length} (copied)`)}
          {row('Contract Start', toMonthValue(A.startDate) || '—', toMonthValue(A.startDate) || '—', <span title="Same as the original contract">{toMonthValue(start) || '—'} <span className="font-normal text-[9px] opacity-60">(from {A.contractNumber})</span></span>)}
          {row('Contract End', toMonthValue(A.endDate) || '—', toMonthValue(A.endDate) || '—', <span title="Same as the original contract">{toMonthValue(end) || '—'} <span className="font-normal text-[9px] opacity-60">(from {A.contractNumber})</span></span>)}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const tail = comment.trim() ? ` Note: ${comment.trim()}` : '';
      const cust = newCustomer!;
      const sameCustomer = custOf(A)?.id === cust.id;
      const created: Contract = {
        ...A, // every pricing component: price, raw, FX, freight, duty, pallet, margin, terms, product lines…
        id: `CON-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contractNumber: number,
        customerNumber: cust.id,
        customerName: cust.name,
        itasName: cust.itasCustomerName || (sameCustomer ? A.itasName : undefined),
        allowedCustomerIds: sameCustomer ? (A.allowedCustomerIds || []) : [],
        contractVolume: amt,
        volumeTaken: 0,
        volumeOutstanding: amt,
        finalPrice: priceNew,
        contractLines: (A.contractLines || []).map((l, i) => ({ ...l, id: `CL-${Date.now()}-${i}` })),
        startDate: start,
        endDate: end,
        mergedFrom: [],
        active: true,
        contractDate: new Date().toISOString().slice(0, 10),
        notes: `[${when}${who}] CREATED BY TRANSFER: ${fmt(amt)} MT from ${A.contractNumber} (${A.customerName}). Pricing components copied from ${A.contractNumber}${priceNew !== r2(A.finalPrice) ? `; price set to ${money(priceNew, A.currency)} (A: ${money(A.finalPrice, A.currency)})` : ` at ${money(priceNew, A.currency)}`}.${tail}`,
      };
      const newA: Contract = { ...A, contractVolume: sA.volume - amt, volumeOutstanding: sA.outstanding - amt,
        notes: appendNote(A.notes, `[${when}${who}] TRANSFER OUT: ${fmt(amt)} MT to new contract ${number} (${cust.name}). Volume ${fmt(sA.volume)} → ${fmt(sA.volume - amt)} MT.${tail}`) };
      return { upserts: [newA, created], summary: `Transferred ${fmt(amt)} MT from ${A.contractNumber} to new contract ${number} (${cust.name}) at ${money(priceNew, A.currency)}/MT.\n\n${A.contractNumber} now has ${fmt(sA.volume - amt)} MT.` };
    };
  }

  if (mode === 'transfer' && A && B && tTarget === 'existing') {
    const amt = Number(tAmount) || 0;
    if (A.id === B.id) warnings.push('Pick two different contracts.');
    if (amt <= 0) warnings.push('Enter the volume to transfer.');
    if (amt > sA.available) warnings.push(`That's more than contract A has available (${fmt(sA.available)} MT = outstanding ${fmt(sA.outstanding)} − on order ${fmt(sA.onOrder)}).`);
    if ((A.currency || 'CAD') !== (B.currency || 'CAD')) warnings.push(`Currencies differ (${A.currency} vs ${B.currency}).`);
    const autoPriceB = tReweight ? r2(weighted(B.contractVolume || 0, B.finalPrice || 0, amt, A.finalPrice || 0)) : r2(B.finalPrice || 0);
    const priceB = tPriceB === '' ? autoPriceB : r2(Number(tPriceB));
    canApply = amt > 0 && A.id !== B.id;
    const row = (label: string, a1: React.ReactNode, a2: React.ReactNode, b1: React.ReactNode, b2: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{a1}</td><td className="p-2 font-mono font-bold bg-red-50">{a2}</td><td className="p-2 font-mono">{b1}</td><td className="p-2 font-mono font-bold bg-emerald-50">{b2}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">A — now</th><th className="p-2 text-left bg-red-100">A — after</th><th className="p-2 text-left">B — now</th><th className="p-2 text-left bg-emerald-100">B — after</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, A.contractNumber, B.contractNumber, B.contractNumber)}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(sA.volume - amt), fmt(sB.volume), fmt(sB.volume + amt))}
          {row('Volume Taken (MT)', fmt(sA.taken), fmt(sA.taken), fmt(sB.taken), fmt(sB.taken))}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sA.onOrder), fmt(sB.onOrder), fmt(sB.onOrder))}
          {row('Volume Outstanding (MT)', fmt(sA.outstanding), fmt(sA.outstanding - amt), fmt(sB.outstanding), fmt(sB.outstanding + amt))}
          {row('Price / MT', money(A.finalPrice, A.currency), money(A.finalPrice, A.currency), money(B.finalPrice, B.currency),
            <input type="number" step="0.01" value={tPriceB === '' ? autoPriceB : tPriceB} onChange={e => setTPriceB(e.target.value)} className={inputCls} />)}
          {row('Contract Start', toMonthValue(A.startDate) || '—', toMonthValue(A.startDate) || '—', toMonthValue(B.startDate) || '—', monthSelect(tBStart || toMonthValue(B.startDate), setTBStart, [B.startDate]))}
          {row('Contract End', toMonthValue(A.endDate) || '—', toMonthValue(A.endDate) || '—', toMonthValue(B.endDate) || '—', monthSelect(tBEnd || toMonthValue(B.endDate), setTBEnd, [B.endDate]))}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const tail = comment.trim() ? ` Note: ${comment.trim()}` : '';
      const newA: Contract = { ...A, contractVolume: sA.volume - amt, volumeOutstanding: sA.outstanding - amt,
        notes: appendNote(A.notes, `[${when}${who}] TRANSFER OUT: ${fmt(amt)} MT to ${B.contractNumber} (${B.customerName}). Volume ${fmt(sA.volume)} → ${fmt(sA.volume - amt)} MT.${tail}`) };
      const bStart = tBStart || B.startDate, bEnd = tBEnd || B.endDate;
      const datesTxt = (bStart !== B.startDate || bEnd !== B.endDate) ? `; period ${toMonthValue(B.startDate) || '—'}–${toMonthValue(B.endDate) || '—'} → ${toMonthValue(bStart) || '—'}–${toMonthValue(bEnd) || '—'}` : '';
      const newB: Contract = { ...B, contractVolume: sB.volume + amt, volumeOutstanding: sB.outstanding + amt, finalPrice: priceB, startDate: bStart, endDate: bEnd,
        notes: appendNote(B.notes, `[${when}${who}] TRANSFER IN: ${fmt(amt)} MT from ${A.contractNumber} (${A.customerName}) at ${money(A.finalPrice, A.currency)}. Volume ${fmt(sB.volume)} → ${fmt(sB.volume + amt)} MT${priceB !== r2(B.finalPrice) ? `; price ${money(B.finalPrice, B.currency)} → ${money(priceB, B.currency)}` : ''}${datesTxt}.${tail}`) };
      return { upserts: [newA, newB], summary: `Transferred ${fmt(amt)} MT from ${A.contractNumber} to ${B.contractNumber}.\n\n${A.contractNumber} now has ${fmt(sA.volume - amt)} MT; ${B.contractNumber} has ${fmt(sB.volume + amt)} MT.` };
    };
  }

  if (mode === 'adjust' && A) {
    const amt = Number(aAmount) || 0;
    const delta = aDir === 'increase' ? amt : -amt;
    const newVol = sA.volume + delta;
    if (amt <= 0) warnings.push('Enter the volume to add or remove.');
    if (aDir === 'decrease' && newVol < sA.taken + sA.onOrder) warnings.push(`That leaves ${fmt(newVol)} MT — less than taken + on order (${fmt(sA.taken + sA.onOrder)} MT).`);
    const addPrice = aAddPrice === '' ? (A.finalPrice || 0) : Number(aAddPrice) || 0;
    const autoPrice = aDir === 'increase' ? r2(weighted(sA.volume, A.finalPrice || 0, amt, addPrice)) : r2(A.finalPrice || 0);
    const price = aPrice === '' ? autoPrice : r2(Number(aPrice));
    canApply = amt > 0 && newVol >= 0;
    const row = (label: string, now: React.ReactNode, after: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{now}</td><td className="p-2 font-mono font-bold bg-emerald-50">{after}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">Now</th><th className="p-2 text-left bg-emerald-100">After</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, A.contractNumber)}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(newVol))}
          {row('Volume Taken (MT)', fmt(sA.taken), fmt(sA.taken))}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sA.onOrder))}
          {row('Volume Outstanding (MT)', fmt(sA.outstanding), fmt(sA.outstanding + delta))}
          {row('Price / MT', money(A.finalPrice, A.currency), <input type="number" step="0.01" value={aPrice === '' ? autoPrice : aPrice} onChange={e => setAPrice(e.target.value)} className={inputCls} />)}
          {row('Contract Start', toMonthValue(A.startDate) || '—', monthSelect(aStart || toMonthValue(A.startDate), setAStart, [A.startDate]))}
          {row('Contract End', toMonthValue(A.endDate) || '—', monthSelect(aEnd || toMonthValue(A.endDate), setAEnd, [A.endDate]))}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const nStart = aStart || A.startDate, nEnd = aEnd || A.endDate;
      const periodTxt = (nStart !== A.startDate || nEnd !== A.endDate) ? `; period ${toMonthValue(A.startDate) || '—'}–${toMonthValue(A.endDate) || '—'} → ${toMonthValue(nStart) || '—'}–${toMonthValue(nEnd) || '—'}` : '';
      const updated: Contract = { ...A, contractVolume: newVol, volumeOutstanding: sA.outstanding + delta, finalPrice: price, startDate: nStart, endDate: nEnd,
        notes: appendNote(A.notes, `[${when}${who}] ${aDir === 'increase' ? 'INCREASE' : 'DECREASE'}: ${aDir === 'increase' ? '+' : '−'}${fmt(amt)} MT${aDir === 'increase' && addPrice !== A.finalPrice ? ` at ${money(addPrice, A.currency)}` : ''}. Volume ${fmt(sA.volume)} → ${fmt(newVol)} MT${price !== r2(A.finalPrice) ? `; price ${money(A.finalPrice, A.currency)} → ${money(price, A.currency)}` : ''}${periodTxt}.${comment.trim() ? ` Reason: ${comment.trim()}` : ''}`) };
      return { upserts: [updated], summary: `${aDir === 'increase' ? 'Increased' : 'Decreased'} ${A.contractNumber} by ${fmt(amt)} MT.` };
    };
  }

  // ── Roll: extend the end date; the ENTIRE outstanding volume rolls and is
  // repriced on the #11 average of the extension months. ──
  const marketKeys = monthOptions.map(o => monthKey(o.value)).filter(Number.isFinite);
  const firstMarket = marketKeys.length ? Math.min(...marketKeys) : NaN;
  const lastMarket = marketKeys.length ? Math.max(...marketKeys) : NaN;
  const keyLabel = (k: number) => `${MO[k % 12]} ${Math.floor(k / 12)}`;
  let rollRange: { min: number; max: number } | null = null;
  if (mode === 'roll' && A) {
    const oldEndK = monthKey(A.endDate);
    const min = Math.max(Number.isFinite(oldEndK) ? oldEndK + 1 : firstMarket, firstMarket);
    rollRange = Number.isFinite(min) && Number.isFinite(lastMarket) && min <= lastMarket ? { min, max: lastMarket } : null;
    const outstanding = sA.outstanding;
    const newEndK = monthKey(rEnd);
    if (!Number.isFinite(monthKey(A.endDate))) warnings.push('This contract has no Contract End — the roll prices from the first market month.');
    if (!rollRange) warnings.push('No later market months are available to roll into.');
    if (outstanding <= 0) warnings.push('Nothing to roll — this contract has no outstanding volume.');
    if (!rEnd) warnings.push('Select the new Contract End.');
    // Extension period: the month after the old end (or the first market month) → new end.
    const fromLabel = rollRange ? keyLabel(rollRange.min) : '';
    const market = rEnd && fromLabel ? rawForPeriod(fromLabel, rEnd) : null;
    if (rEnd && !market) warnings.push('No #11 market price for the new period — enter the new raw price.');
    const oldRawDefault = A.rawPriceUsdMt ? r2(A.rawPriceUsdMt / MT_TO_CWT)
      : (rawForPeriod(toMonthValue(A.startDate), toMonthValue(A.endDate))?.avg ?? NaN);
    const oldRaw = rOldRaw === '' ? oldRawDefault : Number(rOldRaw);
    const newRaw = rNewRaw === '' ? (market?.avg ?? NaN) : Number(rNewRaw);
    if (!Number.isFinite(oldRaw)) warnings.push("The contract's original raw price isn't stored — enter it (USD/cwt).");
    const isCad = (A.currency || 'CAD') !== 'USD';
    const fx = A.fxRate || defaultFx || 1;
    const twoPct = A.paymentTerms === '2% / Net 15' ? 1.02 : 1;
    const delta = Number.isFinite(oldRaw) && Number.isFinite(newRaw) ? (newRaw - oldRaw) * MT_TO_CWT * (yieldMultiplier || 1) * (isCad ? fx : 1) * twoPct : 0;
    const autoPrice = r2((A.finalPrice || 0) + delta);
    const price = rPrice === '' ? autoPrice : r2(Number(rPrice));
    canApply = outstanding > 0 && !!rEnd && Number.isFinite(newEndK) && (!Number.isFinite(monthKey(A.endDate)) || newEndK > monthKey(A.endDate)) && Number.isFinite(oldRaw) && Number.isFinite(newRaw) && price > 0;
    const row = (label: string, now: React.ReactNode, after: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{now}</td><td className="p-2 font-mono font-bold bg-emerald-50">{after}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">Now</th><th className="p-2 text-left bg-emerald-100">After roll</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, A.contractNumber)}
          {row('Contract End', toMonthValue(A.endDate) || '—', rEnd || '—')}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(sA.volume))}
          {row('Volume Taken (MT)', fmt(sA.taken), <span>{fmt(sA.taken)} <span className="font-normal text-[9px] opacity-60">(stays at invoiced prices)</span></span>)}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sA.onOrder))}
          {row('Rolled Volume (MT)', '—', <span>{fmt(outstanding)} <span className="font-normal text-[9px] opacity-60">(all outstanding — all or nothing)</span></span>)}
          {row('#11 Raw (USD/cwt)',
            <input type="number" step="0.01" value={rOldRaw === '' ? (Number.isFinite(oldRawDefault) ? oldRawDefault : '') : rOldRaw} onChange={e => setROldRaw(e.target.value)} className={inputCls} title="The contract's original raw price" />,
            <div><input type="number" step="0.01" value={rNewRaw === '' ? (market ? market.avg : '') : rNewRaw} onChange={e => setRNewRaw(e.target.value)} className={inputCls} />
              <div className="text-[9px] font-normal opacity-60 mt-0.5">{market ? `#11 average of ${market.months.join(', ')}` : 'enter the new raw price'}</div></div>)}
          {row('Price / MT', money(A.finalPrice, A.currency),
            <div><input type="number" step="0.01" value={rPrice === '' ? autoPrice : rPrice} onChange={e => setRPrice(e.target.value)} className={inputCls} />
              <div className="text-[9px] font-normal opacity-60 mt-0.5">{delta >= 0 ? '+' : '−'}{money(Math.abs(delta), A.currency)} = Δraw × {MT_TO_CWT} × yield {yieldMultiplier}{isCad ? ` × FX ${fx}` : ''}{twoPct !== 1 ? ' × 1.02' : ''}</div></div>)}
          {(A.contractLines || []).length > 0 && row('Product lines', `${(A.contractLines || []).length}`, `each re-priced ${delta >= 0 ? '+' : '−'}${money(Math.abs(price - (A.finalPrice || 0)), A.currency)}/MT`)}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const shift = price - (A.finalPrice || 0);
      const updated: Contract = {
        ...A,
        endDate: rEnd,
        finalPrice: price,
        rawPriceUsdMt: r2(newRaw * MT_TO_CWT),
        contractLines: (A.contractLines || []).map(l => ({ ...l, finalPriceMt: r2((l.finalPriceMt || 0) + shift) })),
        notes: appendNote(A.notes, `[${when}${who}] ROLLED: all ${fmt(outstanding)} MT outstanding rolled — Contract End ${toMonthValue(A.endDate) || '—'} → ${rEnd}. #11 raw ${fmt(oldRaw, 2)} → ${fmt(newRaw, 2)} USD/cwt${market && rNewRaw === '' ? ` (average of ${market.months.join(', ')})` : ''}; Price/MT ${money(A.finalPrice, A.currency)} → ${money(price, A.currency)} (${shift >= 0 ? '+' : '−'}${money(Math.abs(shift), A.currency)}). ${fmt(sA.taken)} MT already taken stays at its invoiced prices.${comment.trim() ? ` Note: ${comment.trim()}` : ''}`),
      };
      return { upserts: [updated], summary: `Rolled ${A.contractNumber}: ${fmt(outstanding)} MT now runs to ${rEnd} at ${money(price, A.currency)}/MT (${shift >= 0 ? '+' : '−'}${money(Math.abs(shift), A.currency)} on the #11 roll).` };
    };
  }

  const picker = (label: string, cust: string, setCust: (v: string) => void, id: string, setId: (v: string) => void, exclude?: string) => {
    const c = contracts.find(x => x.id === id);
    const s = statOf(c);
    return (
      <div className="bg-white border border-[#141414] p-3 space-y-2">
        <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-1">{label}</div>
        <div><label className={lbl}>Customer</label>
          <select value={cust} onChange={e => { setCust(e.target.value); setId(''); }} className={inputCls}>
            <option value="">Select customer…</option>
            {contractCustomers.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select></div>
        <div><label className={lbl}>Contract No.</label>
          <select value={id} onChange={e => setId(e.target.value)} disabled={!cust} className={`${inputCls} disabled:opacity-50`}>
            <option value="">{cust ? 'Select contract…' : 'Select a customer first'}</option>
            {cust && contractsFor(cust).filter(x => x.id !== exclude).map(x => (
              <option key={x.id} value={x.id}>{x.contractNumber} — {x.skuName || 'product'} — {fmt(statOf(x).outstanding, 0)} MT outstanding</option>
            ))}
          </select></div>
        {c && (
          <div className="grid grid-cols-3 gap-2 text-[11px] pt-1">
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Volume</div><div className="font-mono font-bold">{fmt(s.volume)} MT</div></div>
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Taken</div><div className="font-mono">{fmt(s.taken)}</div></div>
            <div><div className="opacity-50 text-[9px] uppercase font-bold">On order</div><div className="font-mono">{fmt(s.onOrder)}</div></div>
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Outstanding</div><div className="font-mono">{fmt(s.outstanding)}</div></div>
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Price / MT</div><div className="font-mono">{money(c.finalPrice, c.currency)}</div></div>
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Dates</div><div className="font-mono text-[10px]">{toMonthValue(c.startDate) || '—'} → {toMonthValue(c.endDate) || '—'}</div></div>
          </div>
        )}
      </div>
    );
  };

  const t = TITLES[mode];
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-md">
      <div className="bg-[#E4E3E0] border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] w-full max-w-5xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-[#141414] text-[#E4E3E0] px-5 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">{t.icon}{t.title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/20" title="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-5 space-y-4">
          <div className={`grid gap-4 ${mode === 'adjust' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
            {picker(mode === 'merge' ? 'Contract A' : mode === 'transfer' ? 'From — Contract A' : 'Contract', custA, (v) => { setCustA(v); if (mode === 'merge' && !custB) setCustB(v); }, idA, setIdA)}
            {mode === 'merge' && picker('Contract B', custB, setCustB, idB, setIdB, idA)}
            {mode === 'transfer' && (
              <div className="space-y-2">
                <div className="flex border border-[#141414] w-fit bg-white">
                  {([['existing', 'To an existing contract'], ['new', 'To a new contract']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => { setTTarget(k); setTPriceB(''); }} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${tTarget === k ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white hover:bg-[#F5F5F5]'}`}>{l}</button>
                  ))}
                </div>
                {tTarget === 'existing' ? picker('To — Contract B', custB, setCustB, idB, setIdB, idA) : (
                  <div className="bg-white border border-[#141414] p-3 space-y-2">
                    <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-1">To — New Contract</div>
                    <div><label className={lbl}>Customer</label>
                      <select value={newCustomer?.id || ''} onChange={e => setTNewCust(e.target.value)} className={inputCls}>
                        <option value="">Select customer…</option>
                        {[...customers].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select></div>
                    <div><label className={lbl}>Contract No.</label>
                      <input value={tNewNumber} onChange={e => setTNewNumber(e.target.value)} className={inputCls} /></div>
                    <p className="text-[10px] opacity-60">The new contract copies every pricing component of contract A — price, raw, FX, freight, duty, pallet charge, margin, terms and product lines — and its Contract Start / End, with the transferred volume.</p>
                  </div>
                )}
              </div>
            )}
            {mode === 'roll' && (
              <div className="bg-white border border-[#141414] p-3 space-y-2">
                <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-1">Roll to</div>
                <div><label className={lbl}>New Contract End</label>
                  {A ? (rollRange ? monthSelect(rEnd, (v) => { setREnd(v); setRNewRaw(''); setRPrice(''); }, [], rollRange) : <div className="text-xs opacity-60 italic">No later market months available.</div>)
                    : <div className="text-xs opacity-60 italic">Select a contract first.</div>}</div>
                <p className="text-[10px] opacity-60">The entire outstanding volume rolls (all or nothing). It's repriced on the #11 market — the average raw price of the months after the current end through the new end — and the contract price and product lines move by the difference.</p>
              </div>
            )}
            {mode === 'adjust' && (
              <div className="bg-white border border-[#141414] p-3 space-y-2">
                <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-1">Change</div>
                <div className="flex border border-[#141414] w-fit">
                  {(['increase', 'decrease'] as const).map(d => (
                    <button key={d} onClick={() => setADir(d)} className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${aDir === d ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white'}`}>{d}</button>
                  ))}
                </div>
                <div><label className={lbl}>Volume to {aDir === 'increase' ? 'add' : 'remove'} (MT)</label>
                  <input type="number" min={0} value={aAmount} onChange={e => setAAmount(e.target.value)} className={inputCls} /></div>
                {aDir === 'increase' && (
                  <div><label className={lbl}>Price / MT for the added volume</label>
                    <input type="number" step="0.01" value={aAddPrice} placeholder={A ? String(A.finalPrice) : ''} onChange={e => setAAddPrice(e.target.value)} className={inputCls} />
                    <p className="text-[10px] opacity-50 mt-1">Blank = the contract's current price. The contract price is re-weighted by volume.</p></div>
                )}
              </div>
            )}
          </div>

          {mode === 'merge' && A && B && A.id !== B.id && (
            <div className="bg-white border border-[#141414] p-3 space-y-2">
              <div className="text-[11px] uppercase font-bold tracking-widest">Merged contract number</div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['keepA', `Keep ${A.contractNumber} (A)`],
                  ['keepB', `Keep ${B.contractNumber} (B)`],
                  ['new', 'New contract number'],
                ] as const).map(([k, l]) => (
                  <label key={k} className={`flex items-center gap-2 px-3 py-2 border cursor-pointer text-xs font-bold ${mNumMode === k ? 'border-[#141414] bg-[#141414] text-[#E4E3E0]' : 'border-[#141414]/30 hover:border-[#141414]'}`}>
                    <input type="radio" name="mnum" checked={mNumMode === k} onChange={() => setMNumMode(k)} className="accent-emerald-500" />{l}
                  </label>
                ))}
              </div>
              <p className="text-[10px] opacity-60">{mNumMode === 'new'
                ? 'Both contracts go inactive and a new contract holds the combined volume.'
                : `${mNumMode === 'keepA' ? A.contractNumber : B.contractNumber} stays active and absorbs ${mNumMode === 'keepA' ? B.contractNumber : A.contractNumber}, which goes inactive. Orders and invoices on either number keep counting.`}</p>
            </div>
          )}

          {mode === 'transfer' && A && (tTarget === 'new' || B) && (
            <div className="bg-white border border-[#141414] p-3 flex flex-wrap items-end gap-4">
              <div className="w-48"><label className={lbl}>Volume to transfer (MT)</label>
                <input type="number" min={0} value={tAmount} onChange={e => setTAmount(e.target.value)} className={inputCls} /></div>
              <button onClick={() => setTAmount(String(Math.max(0, r2(sA.available))))} className="px-3 py-2 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">All available ({fmt(sA.available)} MT)</button>
              {tTarget === 'existing' && (
                <label className="flex items-center gap-2 text-xs cursor-pointer pb-2">
                  <input type="checkbox" checked={tReweight} onChange={e => { setTReweight(e.target.checked); setTPriceB(''); }} className="w-4 h-4 accent-[#141414]" />
                  Re-weight B's price with the transferred volume at A's price
                </label>
              )}
            </div>
          )}

          {preview ? (
            <div className="bg-white border border-[#141414] p-3 space-y-2">
              <div className="text-[11px] uppercase font-bold tracking-widest">Preview — edit any highlighted value before applying</div>
              {preview}
            </div>
          ) : (
            <div className="text-xs opacity-60 italic">Select the contract{mode === 'adjust' ? '' : 's'} to see a preview.</div>
          )}

          {warnings.length > 0 && preview && (
            <div className="bg-amber-50 border border-amber-400 p-3 text-xs space-y-1">
              {warnings.map((w, i) => <div key={i} className="flex gap-1.5"><AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />{w}</div>)}
            </div>
          )}

          <div className="bg-white border border-[#141414] p-3">
            <label className={lbl}>{mode === 'adjust' ? 'Reason / note' : 'Note'} (added to the contract notes with today's date)</label>
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} className={inputCls} placeholder="e.g. Customer requested consolidation of Q1 and Q2 volumes" />
          </div>
        </div>
        <div className="shrink-0 border-t border-[#141414] bg-white px-5 py-3 flex gap-3">
          <button disabled={!canApply || !build}
            onClick={() => { if (!build) return; const { upserts, summary } = build(); onApply(upserts, summary); }}
            className="flex-1 py-2.5 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-opacity-80 disabled:opacity-40">
            <CheckCircle2 size={16} /> {t.apply}
          </button>
          <button onClick={onClose} className="px-8 py-2.5 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5]">Cancel</button>
        </div>
      </div>
    </div>
  );
}
