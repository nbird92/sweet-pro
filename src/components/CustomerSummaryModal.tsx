import React, { useMemo, useState } from 'react';
import { X, Pencil, Building2, FileText, BarChart3, TrendingUp, Receipt, ExternalLink, Trash2 } from 'lucide-react';
import { Customer, Contract, Invoice, Order, CustomerForecast, FiscalYear, Person, CustomerGroup } from '../types';

type Tab = 'details' | 'contracts' | 'sales' | 'forecast' | 'quotes';

interface Props {
  customer: Customer;
  contracts: Contract[];
  invoices: Invoice[];
  orders: Order[];
  customerForecasts: CustomerForecast[];
  fiscalYears: FiscalYear[];
  people: Person[];
  customerGroups: CustomerGroup[];
  contractStats: Map<string, { taken: number; onOrder: number; outstanding: number }>;
  toShortform: (name: string | undefined) => string;
  onEdit: () => void;
  onOpenContract: (c: Contract) => void;
  onDeleteQuote: (quoteId: string) => void;
  onClose: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (v: number, d = 1) => v ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const norm = (s?: string) => (s || '').trim().toLowerCase();
const fmtDate = (s?: string) => {
  if (!s) return '—';
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest font-bold opacity-50 mb-0.5">{label}</div>
    <div className="text-sm">{value || <span className="opacity-40">—</span>}</div>
  </div>
);

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border border-[#141414] bg-white p-3">
    <div className="text-[10px] uppercase tracking-widest font-bold opacity-50">{label}</div>
    <div className="text-xl font-bold font-mono mt-1">{value}</div>
    {sub && <div className="text-[10px] opacity-50 mt-0.5">{sub}</div>}
  </div>
);

/** Product × month matrix with row and column totals. */
const MonthMatrix = ({ rows, months, empty, shade }: { rows: { name: string; values: number[] }[]; months: string[]; empty: string; shade?: (i: number) => boolean }) => {
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

export default function CustomerSummaryModal({ customer, contracts, invoices, orders, customerForecasts, fiscalYears, people, customerGroups, contractStats, toShortform, onEdit, onOpenContract, onDeleteQuote, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('details');
  const names = useMemo(() => new Set([norm(customer.name), norm(customer.itasCustomerName)].filter(Boolean)), [customer]);
  const label = (n?: string) => (toShortform(n) || n || '(unknown)').trim();

  // ── Invoices for this customer (non-cancelled) ──
  const custInvoices = useMemo(() => invoices.filter(i => i.status !== 'Cancelled' && names.has(norm(i.customer))), [invoices, names]);

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

  // ── Sales tab ──
  const salesYears = useMemo(() => {
    const ys = new Set<number>();
    for (const i of custInvoices) { const y = parseInt((i.date || '').slice(0, 4)); if (y > 1990) ys.add(y); }
    ys.add(new Date().getFullYear());
    return Array.from(ys).sort((a, b) => b - a);
  }, [custInvoices]);
  const [salesYear, setSalesYear] = useState<number>(new Date().getFullYear());
  const salesRows = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const inv of custInvoices) {
      if (parseInt((inv.date || '').slice(0, 4)) !== salesYear) continue;
      const mo = parseInt((inv.date || '').slice(5, 7)) - 1;
      if (mo < 0 || mo > 11) continue;
      for (const { product, mt } of invoiceProductMt(inv)) {
        const v = m.get(product) || new Array(12).fill(0);
        v[mo] += mt; m.set(product, v);
      }
    }
    return Array.from(m.entries()).map(([name, values]) => ({ name, values })).sort((a, b) => a.name.localeCompare(b.name));
  }, [custInvoices, salesYear]);

  // ── Contracts tab ──
  const custContracts = useMemo(() => contracts
    .filter(c => c.customerNumber === customer.id || (customer.customerNumber && c.customerNumber === customer.customerNumber) || names.has(norm(c.customerName)) || (c.allowedCustomerIds || []).includes(customer.id))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')), [contracts, customer, names]);
  const today = new Date().toISOString().slice(0, 10);
  const isActive = (c: Contract) => c.active !== false && (!c.endDate || c.endDate >= today);
  const statOf = (c: Contract) => {
    const s = contractStats.get(c.id);
    const taken = s?.taken ?? c.volumeTaken ?? 0;
    const onOrder = s?.onOrder ?? 0;
    return { taken, onOrder, outstanding: s?.outstanding ?? Math.max(0, (c.contractVolume || 0) - taken - onOrder) };
  };
  const contractSummary = useMemo(() => {
    const active = custContracts.filter(isActive);
    const sum = (f: (c: Contract) => number) => active.reduce((s, c) => s + f(c), 0);
    const yr = new Date().getFullYear();
    const ytd = custInvoices.filter(i => (i.date || '').startsWith(String(yr))).reduce((s, i) => s + (i.qty || 0), 0);
    const lastYr = custInvoices.filter(i => (i.date || '').startsWith(String(yr - 1))).reduce((s, i) => s + (i.qty || 0), 0);
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
    const ttm = custInvoices.filter(i => i.date && new Date(i.date) >= cutoff).reduce((s, i) => s + (i.qty || 0), 0);
    const openOrders = orders.filter(o => names.has(norm(o.customer)) && o.status !== 'Cancelled' && o.status !== 'Completed');
    return {
      activeCount: active.length, volume: sum(c => c.contractVolume || 0), taken: sum(c => statOf(c).taken),
      onOrder: sum(c => statOf(c).onOrder), outstanding: sum(c => statOf(c).outstanding), ytd, lastYr, ttm, yr,
      openOrderMt: openOrders.reduce((s, o) => s + (o.lineItems || []).reduce((a, li) => a + (Number(li.totalWeight) || 0), 0), 0), openOrderCount: openOrders.length,
    };
  }, [custContracts, custInvoices, orders, names, contractStats]);

  // ── Forecast tab ──
  const custForecasts = useMemo(() => customerForecasts.filter(f => f.type !== 'Budget' && (f.customerId === customer.id || names.has(norm(f.customerName)))), [customerForecasts, customer, names]);
  const forecastYears = useMemo(() => fiscalYears
    .filter(fy => (fy.endDate || '') >= today || custForecasts.some(f => f.fiscalYearId === fy.id && fy.endDate >= today))
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || '')), [fiscalYears, custForecasts, today]);
  const [fyId, setFyId] = useState<string>('');
  const fy = forecastYears.find(f => f.id === fyId) || forecastYears[0];
  const fyMonths = useMemo(() => {
    if (!fy) return MONTHS;
    if (fy.periods?.length === 12) return fy.periods.map(p => { const d = new Date(`${p.startDate}T12:00:00`); return isNaN(d.getTime()) ? p.name : `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; });
    const start = new Date(`${fy.startDate}T12:00:00`);
    return MONTHS.map((_, i) => MONTHS[(start.getMonth() + i) % 12]);
  }, [fy]);
  const forecastRows = useMemo(() => {
    if (!fy) return [];
    const m = new Map<string, number[]>();
    // Past fiscal months show ACTUAL invoiced sales; current/future months show forecast.
    const periodBounds = (fy.periods || []).slice(0, 12).map(p => ({ start: p.startDate, end: p.endDate }));
    const isPast = (i: number) => !!periodBounds[i] && periodBounds[i].end < today;
    const periodOf = (d: string) => periodBounds.findIndex(b => d >= b.start && d <= b.end);
    for (const inv of custInvoices) {
      const d = (inv.date || '').slice(0, 10);
      const idx = periodOf(d);
      if (idx < 0 || !isPast(idx)) continue;
      const loc = inv.location || customer.defaultLocation || '';
      for (const { product, mt } of invoiceProductMt(inv)) {
        const name = `${product}${loc ? ` · ${loc}` : ''}`;
        const v = m.get(name) || new Array(12).fill(0);
        v[idx] += mt; m.set(name, v);
      }
    }
    for (const f of custForecasts.filter(x => x.fiscalYearId === fy.id)) {
      const weekly = f.viewMode === 'Weekly';
      for (const line of f.lines || []) {
        const name = `${label(line.productName)}${line.location ? ` · ${line.location}` : ''}`;
        const v = m.get(name) || new Array(12).fill(0);
        for (const e of line.entries || []) {
          const idx = weekly ? Math.min(11, Math.floor(e.periodIndex * 12 / 52)) : e.periodIndex;
          if (idx >= 0 && idx < 12 && !isPast(idx)) v[idx] += e.value || 0;
        }
        m.set(name, v);
      }
    }
    return Array.from(m.entries()).filter(([, v]) => v.some(x => x)).map(([name, values]) => ({ name, values })).sort((a, b) => a.name.localeCompare(b.name));
  }, [custForecasts, custInvoices, fy, today, customer]);

  const salesperson = people.find(p => p.id === customer.salespersonId);
  const group = customerGroups.find(g => g.id === customer.customerGroupId);
  const corpAddress = [customer.address, [customer.city, customer.province].filter(Boolean).join(', '), customer.postalCode].filter(Boolean);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'details', label: 'Customer Details', icon: <Building2 size={13} /> },
    { id: 'contracts', label: `Contracts (${custContracts.length})`, icon: <FileText size={13} /> },
    { id: 'sales', label: 'Sales Data', icon: <BarChart3 size={13} /> },
    { id: 'forecast', label: 'Forecast', icon: <TrendingUp size={13} /> },
    { id: 'quotes', label: `Quotes (${customer.savedQuotes?.length || 0})`, icon: <Receipt size={13} /> },
  ];
  const selectCls = 'px-3 py-1.5 border border-[#141414] bg-white text-xs focus:outline-none';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-md" onClick={onClose}>
      <div className="bg-[#E4E3E0] border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] w-full max-w-[95vw] xl:max-w-7xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-[#141414] text-[#E4E3E0] px-5 py-4 flex justify-between items-start shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest opacity-60">Customer Summary · {customer.customerNumber || customer.id}</div>
            <h3 className="text-lg font-bold mt-0.5">{customer.name}</h3>
            <div className="text-[11px] opacity-60 mt-0.5">{[customer.defaultLocation, salesperson?.name, group?.name].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E4E3E0]/40 text-[10px] uppercase font-bold tracking-widest hover:bg-white/10"><Pencil size={12} /> Edit Customer</button>
            <button onClick={onClose} className="p-1 hover:bg-white/20" title="Close"><X size={18} /></button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-[#141414] bg-white shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-5 py-3 text-[11px] uppercase font-bold tracking-widest border-r border-[#141414]/20 whitespace-nowrap transition-colors ${tab === t.id ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-gray-100 opacity-70'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {tab === 'details' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-white border border-[#141414] p-4 space-y-3">
                  <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2">General</div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Customer Name" value={customer.name} />
                    <Field label="Customer #" value={customer.customerNumber} />
                    <Field label="ITAS Name" value={customer.itasCustomerName} />
                    <Field label="Customer Group" value={group?.name} />
                    <Field label="Default Location" value={customer.defaultLocation} />
                    <Field label="Salesperson" value={salesperson ? <>{salesperson.name}{salesperson.email && <div className="text-[11px] opacity-60">{salesperson.email}</div>}</> : undefined} />
                    <Field label="Default Margin" value={customer.defaultMargin ? `${customer.defaultMargin} CAD/MT` : undefined} />
                    <Field label="Payment Terms" value={customer.defaultPaymentTerms} />
                    <Field label="Default Currency" value={customer.defaultCurrency} />
                    <Field label="Default Carrier" value={customer.defaultCarrierCode} />
                    <Field label="CHEP Account #" value={customer.chepAccountNumber} />
                  </div>
                </div>
                <div className="space-y-5">
                  <div className="bg-white border border-[#141414] p-4 space-y-3">
                    <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2">Corporate Address</div>
                    {corpAddress.length ? <div className="text-sm leading-relaxed">{corpAddress.map((l, i) => <div key={i}>{l}</div>)}</div> : <div className="text-xs opacity-40 italic">No address on file.</div>}
                  </div>
                  <div className="bg-white border border-[#141414] p-4 space-y-3">
                    <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2">Contacts</div>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Contact Email" value={customer.contactEmail} />
                      <Field label="Phone" value={customer.contactPhone} />
                      <Field label="Sales Contact" value={customer.salesContactEmail} />
                      <Field label="Customer Service" value={customer.customerServiceEmail} />
                      <Field label="QA / COA" value={customer.qaContractEmail} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-white border border-[#141414] p-4">
                <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2 mb-3">Ship-To Locations ({customer.shipToLocations?.length || 0})</div>
                {customer.shipToLocations?.length ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {customer.shipToLocations.map(l => (
                      <div key={l.id} className="border border-[#141414]/20 p-3 bg-[#F9F9F8]">
                        <div className="flex justify-between items-start gap-2">
                          <div className="font-bold text-sm">{l.name}</div>
                          {l.locationCode && <span className="text-[9px] font-mono px-1.5 py-0.5 border border-[#141414]/30">{l.locationCode}</span>}
                        </div>
                        <div className="text-xs opacity-70 mt-1 leading-relaxed">
                          {[l.addressLine1, l.addressLine2, [l.city, l.province].filter(Boolean).join(', '), [l.postalCode, l.country].filter(Boolean).join(' ')].filter(Boolean).map((x, i) => <div key={i}>{x}</div>)}
                        </div>
                        {(l.phone || l.customerServiceEmail || l.coaEmail) && (
                          <div className="text-[11px] opacity-60 mt-2 space-y-0.5">
                            {l.phone && <div>☎ {l.phone}</div>}
                            {l.customerServiceEmail && <div>CS: {l.customerServiceEmail}</div>}
                            {l.coaEmail && <div>COA: {l.coaEmail}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <div className="text-xs opacity-40 italic">No ship-to locations.</div>}
              </div>
              {customer.notes && (
                <div className="bg-white border border-[#141414] p-4">
                  <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2 mb-2">Notes</div>
                  <div className="text-sm whitespace-pre-wrap">{customer.notes}</div>
                </div>
              )}
            </>
          )}

          {tab === 'contracts' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Active Contracts" value={String(contractSummary.activeCount)} sub={`${custContracts.length} total on file`} />
                <Stat label="Contracted Volume" value={`${fmt(contractSummary.volume)} MT`} sub="active contracts" />
                <Stat label="Volume Taken" value={`${fmt(contractSummary.taken)} MT`} sub={contractSummary.volume ? `${Math.round(contractSummary.taken / contractSummary.volume * 100)}% of contracted` : undefined} />
                <Stat label="Contract Balance" value={`${fmt(contractSummary.outstanding)} MT`} sub={`${fmt(contractSummary.onOrder)} MT on order`} />
                <Stat label={`${contractSummary.yr} Sales YTD`} value={`${fmt(contractSummary.ytd)} MT`} />
                <Stat label={`${contractSummary.yr - 1} Sales`} value={`${fmt(contractSummary.lastYr)} MT`} />
                <Stat label="Trailing 12 Months" value={`${fmt(contractSummary.ttm)} MT`} />
                <Stat label="Open Orders" value={String(contractSummary.openOrderCount)} sub={`${fmt(contractSummary.openOrderMt)} MT not yet billed`} />
              </div>
              <div className="bg-white border border-[#141414] overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                      {['Contract #', 'Status', 'Product', 'Origin', 'Term', 'Price', 'Volume (MT)', 'Taken', 'On Order', 'Balance', 'Progress'].map(h => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {custContracts.map(c => {
                      const s = statOf(c); const act = isActive(c);
                      const pct = c.contractVolume ? Math.min(100, (s.taken / c.contractVolume) * 100) : 0;
                      const pctOrd = c.contractVolume ? Math.min(100 - pct, (s.onOrder / c.contractVolume) * 100) : 0;
                      return (
                        <tr key={c.id} onClick={() => onOpenContract(c)} title="Open this contract on the Contracts page" className={`border-b border-gray-200 hover:bg-amber-50 cursor-pointer group ${act ? '' : 'opacity-50'}`}>
                          <td className="p-2 font-mono font-bold text-blue-700 underline decoration-dotted underline-offset-2 group-hover:decoration-solid whitespace-nowrap">{c.contractNumber || '(no number)'} <ExternalLink size={10} className="inline opacity-50" /></td>
                          <td className="p-2"><span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${act ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>{act ? 'Active' : 'Closed'}</span></td>
                          <td className="p-2">{(c.contractLines?.length ? c.contractLines.map(l => label(l.productName)) : [label(c.skuName)]).join(', ')}</td>
                          <td className="p-2">{c.origin || '—'}</td>
                          <td className="p-2 whitespace-nowrap">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                          <td className="p-2 font-mono whitespace-nowrap">{c.finalPrice ? `${c.currency || ''} ${c.finalPrice.toFixed(2)}` : '—'}</td>
                          <td className="p-2 font-mono text-right">{fmt(c.contractVolume || 0)}</td>
                          <td className="p-2 font-mono text-right">{fmt(s.taken)}</td>
                          <td className="p-2 font-mono text-right">{fmt(s.onOrder)}</td>
                          <td className="p-2 font-mono text-right font-bold">{fmt(s.outstanding)}</td>
                          <td className="p-2 min-w-[120px]">
                            <div className="h-2 bg-gray-200 flex"><div className="bg-[#141414]" style={{ width: `${pct}%` }} /><div className="bg-amber-400" style={{ width: `${pctOrd}%` }} /></div>
                            <div className="text-[9px] opacity-50 mt-0.5">{Math.round(pct)}% taken</div>
                          </td>
                        </tr>
                      );
                    })}
                    {custContracts.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-gray-400">No contracts for this customer.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'sales' && (
            <div className="bg-white border border-[#141414] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] uppercase font-bold tracking-widest">Invoiced Sales by Product (MT)</div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-60">Year</label>
                  <select value={salesYear} onChange={e => setSalesYear(parseInt(e.target.value))} className={selectCls}>
                    {salesYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <MonthMatrix rows={salesRows} months={MONTHS} empty={`No invoiced sales in ${salesYear}.`} />
            </div>
          )}

          {tab === 'quotes' && (
            <div className="bg-white border border-[#141414] overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    {['Saved', 'By', 'Product', 'Origin', 'Destination / Terms', 'Volume (MT)', 'Raw (USD/CWT)', 'FX', 'Margin (CAD/MT)', 'Price / MT', 'Total Value', 'Period', ''].map(h => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(customer.savedQuotes || []).map(q => (
                    <tr key={q.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-2 whitespace-nowrap">{fmtDate(q.savedAt)}<div className="text-[9px] opacity-50">{new Date(q.savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div></td>
                      <td className="p-2">{q.savedBy || '—'}</td>
                      <td className="p-2 font-bold">{q.product}</td>
                      <td className="p-2">{q.origin || '—'}</td>
                      <td className="p-2">{q.isDelivered ? (q.destination || 'Delivered') : 'FCA'}{q.shippingTerms && <div className="text-[9px] opacity-50">{q.shippingTerms}</div>}</td>
                      <td className="p-2 font-mono text-right">{fmt(q.volumeMt || 0)}</td>
                      <td className="p-2 font-mono text-right">{q.rawPriceUsdCwt != null ? q.rawPriceUsdCwt.toFixed(2) : '—'}</td>
                      <td className="p-2 font-mono text-right">{q.fxRate != null ? q.fxRate.toFixed(4) : '—'}</td>
                      <td className="p-2 font-mono text-right">{q.marginCadMt != null ? q.marginCadMt.toFixed(2) : '—'}</td>
                      <td className="p-2 font-mono text-right font-bold whitespace-nowrap">{q.currency} {(q.finalPriceMt || 0).toFixed(2)}</td>
                      <td className="p-2 font-mono text-right whitespace-nowrap">{q.currency} {(q.totalValue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="p-2 whitespace-nowrap">{q.startDate || q.endDate ? `${fmtDate(q.startDate)} – ${fmtDate(q.endDate)}` : '—'}</td>
                      <td className="p-2"><button onClick={() => { if (window.confirm('Delete this saved quote?')) onDeleteQuote(q.id); }} className="p-1 hover:bg-red-500 hover:text-white" title="Delete quote"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  {!(customer.savedQuotes || []).length && <tr><td colSpan={13} className="p-8 text-center text-gray-400">No saved quotes. Use Save Quote on the Customer Quote page to add one.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'forecast' && (
            <div className="bg-white border border-[#141414] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] uppercase font-bold tracking-widest">Sales + Forecast by Product (MT)</div>
                <div className="text-[10px] opacity-50 w-full -mt-2 order-last">Past months show actual invoiced sales (shaded); current and future months show forecast.</div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-60">Fiscal Year</label>
                  <select value={fy?.id || ''} onChange={e => setFyId(e.target.value)} className={selectCls}>
                    {forecastYears.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    {forecastYears.length === 0 && <option value="">No current fiscal years</option>}
                  </select>
                </div>
              </div>
              <MonthMatrix rows={forecastRows} months={fyMonths} shade={(i) => !!fy?.periods?.[i] && fy.periods[i].endDate < today} empty={fy ? `No forecast entered for ${fy.name}.` : 'No current or future fiscal years set up.'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
