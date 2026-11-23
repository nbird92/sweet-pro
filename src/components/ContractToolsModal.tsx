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
import { X, GitMerge, ArrowRightLeft, PlusCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { Contract, ContractLine, Customer } from '../types';
import { nextTempContractNumber } from '../utils/contractMatch';

export type ContractToolMode = 'merge' | 'transfer' | 'adjust';
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
}

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
};

export default function ContractToolsModal({ mode, contracts, customers, stats, userName, onApply, onClose }: Props) {
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
  const [mVolume, setMVolume] = useState<string>('');
  const [mPrice, setMPrice] = useState<string>('');
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd] = useState('');
  // ── Transfer draft ──
  const [tAmount, setTAmount] = useState<string>('');
  const [tReweight, setTReweight] = useState(false);
  const [tPriceB, setTPriceB] = useState<string>('');
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
    const start = [A.startDate, B.startDate].filter(Boolean).sort()[0] || '';
    const end = [A.endDate, B.endDate].filter(Boolean).sort().slice(-1)[0] || '';
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
    if (custA !== custB) warnings.push('The contracts belong to different customers; the merged contract belongs to contract A\'s customer.');
    const number = mNumber.trim();
    const dup = number && contracts.some(c => c.contractNumber.trim().toLowerCase() === number.toLowerCase());
    if (!number) warnings.push('Enter the new contract number for the merged contract.');
    if (dup) warnings.push(`Contract number ${number} already exists.`);
    const volume = mVolume === '' ? mergeCalc.volume : Number(mVolume) || 0;
    const price = mPrice === '' ? mergeCalc.price : r2(Number(mPrice));
    const start = mStart || mergeCalc.start, end = mEnd || mergeCalc.end;
    const taken = sA.taken + sB.taken, onOrder = sA.onOrder + sB.onOrder;
    canApply = !!number && !dup && A.id !== B.id;
    const row = (label: string, a: React.ReactNode, b: React.ReactNode, m: React.ReactNode) => (
      <tr className="border-b border-[#141414]/10"><td className="p-2 text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</td><td className="p-2 font-mono">{a}</td><td className="p-2 font-mono">{b}</td><td className="p-2 font-mono font-bold bg-emerald-50">{m}</td></tr>
    );
    preview = (
      <table className="w-full text-xs border border-[#141414]">
        <thead><tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest"><th className="p-2 text-left" /><th className="p-2 text-left">Contract A</th><th className="p-2 text-left">Contract B</th><th className="p-2 text-left bg-emerald-100">Merged (new)</th></tr></thead>
        <tbody>
          {row('Contract No.', A.contractNumber, B.contractNumber, <div><input value={mNumber} onChange={e => setMNumber(e.target.value)} placeholder="New contract no." className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">Temporary number — type the ITAS number here or later in Edit Contract</div></div>)}
          {row('Customer', A.customerName, B.customerName, A.customerName)}
          {row('Product', A.skuName || '—', B.skuName || '—', A.skuName || '—')}
          {row('Contract Volume (MT)', fmt(sA.volume), fmt(sB.volume), <input type="number" value={mVolume === '' ? mergeCalc.volume : mVolume} onChange={e => setMVolume(e.target.value)} className={inputCls} />)}
          {row('Volume Taken (MT)', fmt(sA.taken), fmt(sB.taken), fmt(taken))}
          {row('Volume on Order (MT)', fmt(sA.onOrder), fmt(sB.onOrder), fmt(onOrder))}
          {row('Volume Outstanding (MT)', fmt(sA.outstanding), fmt(sB.outstanding), fmt(volume - taken))}
          {row('Price / MT', money(A.finalPrice, A.currency), money(B.finalPrice, B.currency), <div><input type="number" step="0.01" value={mPrice === '' ? mergeCalc.price : mPrice} onChange={e => setMPrice(e.target.value)} className={inputCls} /><div className="text-[9px] font-normal opacity-60 mt-0.5">volume-weighted: {money(mergeCalc.price)}</div></div>)}
          {row('Start Date', A.startDate || '—', B.startDate || '—', <input type="date" value={start} onChange={e => setMStart(e.target.value)} className={inputCls} />)}
          {row('End Date', A.endDate || '—', B.endDate || '—', <input type="date" value={end} onChange={e => setMEnd(e.target.value)} className={inputCls} />)}
          {row('Status after merge', 'Inactive', 'Inactive', 'Active')}
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const record = `[${when}${who}] MERGED: ${A.contractNumber} (${fmt(sA.volume)} MT @ ${money(A.finalPrice, A.currency)}; taken ${fmt(sA.taken)}, on order ${fmt(sA.onOrder)}) + ${B.contractNumber} (${fmt(sB.volume)} MT @ ${money(B.finalPrice, B.currency)}; taken ${fmt(sB.taken)}, on order ${fmt(sB.onOrder)}) → ${number}: ${fmt(volume)} MT @ ${money(price, A.currency)} (taken ${fmt(taken)}, on order ${fmt(onOrder)}, outstanding ${fmt(volume - taken)}).${comment.trim() ? ` Note: ${comment.trim()}` : ''}`;
      const prevNotes = [A.notes ? `— Notes from ${A.contractNumber} —\n${A.notes.trim()}` : '', B.notes ? `— Notes from ${B.contractNumber} —\n${B.notes.trim()}` : ''].filter(Boolean).join('\n\n');
      const merged: Contract = {
        ...A,
        id: `CON-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contractNumber: number,
        contractVolume: volume,
        volumeTaken: taken,
        volumeOutstanding: volume - taken,
        finalPrice: price,
        startDate: start,
        endDate: end,
        contractLines: mergeCalc.lines,
        allowedCustomerIds: Array.from(new Set([...(A.allowedCustomerIds || []), ...(B.allowedCustomerIds || [])])),
        mergedFrom: Array.from(new Set([A.contractNumber, B.contractNumber, ...(A.mergedFrom || []), ...(B.mergedFrom || [])])),
        active: true,
        contractDate: new Date().toISOString().slice(0, 10),
        notes: appendNote(prevNotes, record),
      };
      const closeOut = (c: Contract, s: typeof sA) => ({
        ...c, active: false, volumeTaken: s.taken, volumeOutstanding: s.outstanding,
        notes: appendNote(c.notes, `[${when}${who}] MERGED into ${number} together with ${c.id === A.id ? B.contractNumber : A.contractNumber}. This contract is now inactive; its invoices and orders count toward ${number}.${comment.trim() ? ` Note: ${comment.trim()}` : ''}`),
      });
      return { upserts: [merged, closeOut(A, sA), closeOut(B, sB)], summary: `Merged ${A.contractNumber} + ${B.contractNumber} into ${number}.` };
    };
  }

  if (mode === 'transfer' && A && B) {
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
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const tail = comment.trim() ? ` Note: ${comment.trim()}` : '';
      const newA: Contract = { ...A, contractVolume: sA.volume - amt, volumeOutstanding: sA.outstanding - amt,
        notes: appendNote(A.notes, `[${when}${who}] TRANSFER OUT: ${fmt(amt)} MT to ${B.contractNumber} (${B.customerName}). Volume ${fmt(sA.volume)} → ${fmt(sA.volume - amt)} MT.${tail}`) };
      const newB: Contract = { ...B, contractVolume: sB.volume + amt, volumeOutstanding: sB.outstanding + amt, finalPrice: priceB,
        notes: appendNote(B.notes, `[${when}${who}] TRANSFER IN: ${fmt(amt)} MT from ${A.contractNumber} (${A.customerName}) at ${money(A.finalPrice, A.currency)}. Volume ${fmt(sB.volume)} → ${fmt(sB.volume + amt)} MT${priceB !== r2(B.finalPrice) ? `; price ${money(B.finalPrice, B.currency)} → ${money(priceB, B.currency)}` : ''}.${tail}`) };
      return { upserts: [newA, newB], summary: `Transferred ${fmt(amt)} MT from ${A.contractNumber} to ${B.contractNumber}.` };
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
        </tbody>
      </table>
    );
    build = () => {
      const when = stamp();
      const updated: Contract = { ...A, contractVolume: newVol, volumeOutstanding: sA.outstanding + delta, finalPrice: price,
        notes: appendNote(A.notes, `[${when}${who}] ${aDir === 'increase' ? 'INCREASE' : 'DECREASE'}: ${aDir === 'increase' ? '+' : '−'}${fmt(amt)} MT${aDir === 'increase' && addPrice !== A.finalPrice ? ` at ${money(addPrice, A.currency)}` : ''}. Volume ${fmt(sA.volume)} → ${fmt(newVol)} MT${price !== r2(A.finalPrice) ? `; price ${money(A.finalPrice, A.currency)} → ${money(price, A.currency)}` : ''}.${comment.trim() ? ` Reason: ${comment.trim()}` : ''}`) };
      return { upserts: [updated], summary: `${aDir === 'increase' ? 'Increased' : 'Decreased'} ${A.contractNumber} by ${fmt(amt)} MT.` };
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
            <div><div className="opacity-50 text-[9px] uppercase font-bold">Dates</div><div className="font-mono text-[10px]">{c.startDate || '—'} → {c.endDate || '—'}</div></div>
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
            {mode !== 'adjust' && picker(mode === 'merge' ? 'Contract B' : 'To — Contract B', custB, setCustB, idB, setIdB, idA)}
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

          {mode === 'transfer' && A && B && (
            <div className="bg-white border border-[#141414] p-3 flex flex-wrap items-end gap-4">
              <div className="w-48"><label className={lbl}>Volume to transfer (MT)</label>
                <input type="number" min={0} value={tAmount} onChange={e => setTAmount(e.target.value)} className={inputCls} /></div>
              <button onClick={() => setTAmount(String(Math.max(0, r2(sA.available))))} className="px-3 py-2 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">All available ({fmt(sA.available)} MT)</button>
              <label className="flex items-center gap-2 text-xs cursor-pointer pb-2">
                <input type="checkbox" checked={tReweight} onChange={e => { setTReweight(e.target.checked); setTPriceB(''); }} className="w-4 h-4 accent-[#141414]" />
                Re-weight B's price with the transferred volume at A's price
              </label>
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
