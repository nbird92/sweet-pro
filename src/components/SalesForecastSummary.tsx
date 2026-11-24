import React, { useMemo } from 'react';
import type { Customer, CustomerForecast, FiscalYear, Invoice } from '../types';

/* Dashboard: Sales vs Forecast & Budget for the current fiscal period and year.
 *
 *  Sales    = invoiced MT (the invoice quantity, the same figure the Weekly
 *             Completed Totals use) from billed invoices dated in the period.
 *  Forecast = the customer forecasts for the fiscal year (Sales Forecast page).
 *  Budget   = the customer budgets for the fiscal year.
 *  "To date" plan = full past periods + the elapsed share of the current one. */

const SERIES = {
  sales: { label: 'Sales', color: '#2a78d6' },
  forecast: { label: 'Forecast', color: '#eb6834' },
  budget: { label: 'Budget', color: '#1baf7a' },
} as const;
type SeriesKey = keyof typeof SERIES;

export interface SalesForecastMonth {
  name: string;
  label: string;
  start: string;
  end: string;
  sales: number;
  forecast: number;
  budget: number;
}

export interface SalesForecastSummaryData {
  fy: FiscalYear;
  months: SalesForecastMonth[];
  /** Current period index, or -1 when today is outside the fiscal year. */
  curIdx: number;
  /** Share of the current period elapsed (today counts as elapsed). */
  periodElapsed: number;
  periodDaysLeft: number;
  periodDays: number;
  yearElapsed: number;
  salesYtd: number;
  forecastYear: number;
  budgetYear: number;
  forecastToDate: number;
  budgetToDate: number;
  hasForecast: boolean;
  hasBudget: boolean;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const isoFromDay = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (iso: string) => `${MONTH_ABBR[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const fmtMt = (v: number) => `${Math.round(v).toLocaleString()} MT`;
const pctOf = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

/** Same rule as the Sales Forecast page: cancelled / credit / void / draft /
 *  proforma / refund / return invoices are not sales. */
const isCountableInvoice = (inv: Invoice) => {
  const s = (inv.status || '').trim().toLowerCase();
  if (s === 'x' || s === 'cxl' || s === 'dnl') return false;
  return !/cancel|credit|void|draft|proforma|refund|return/.test(s);
};
const invoiceMt = (inv: Invoice) => {
  if (typeof inv.qty === 'number' && inv.qty > 0) return inv.qty;
  return (inv.lineItems || []).reduce((s, li) => s + (li.totalWeight > 0 ? li.totalWeight : 0), 0);
};

export function computeSalesForecastSummary(
  invoices: Invoice[],
  customerForecasts: CustomerForecast[],
  fiscalYears: FiscalYear[],
  customers: Customer[],
  today: string = localToday(),
): SalesForecastSummaryData | null {
  if (!fiscalYears.length) return null;
  const fy = fiscalYears.find((f) => today >= f.startDate && today <= f.endDate)
    || [...fiscalYears].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
  const periods = fy?.periods || [];
  if (!fy || !periods.length) return null;
  const idxFor = (iso: string) => periods.findIndex((p) => iso >= p.startDate && iso <= p.endDate);

  const months: SalesForecastMonth[] = periods.map((p) => {
    const mid = isoFromDay(Math.round((dayNum(p.startDate) + dayNum(p.endDate)) / 2));
    return { name: p.name, label: MONTH_ABBR[+mid.slice(5, 7) - 1], start: p.startDate, end: p.endDate, sales: 0, forecast: 0, budget: 0 };
  });

  for (const inv of invoices) {
    if (!isCountableInvoice(inv)) continue;
    const d = (inv.date || '').slice(0, 10);
    if (!d || d < fy.startDate || d > fy.endDate) continue;
    const i = idxFor(d);
    if (i >= 0) months[i].sales += invoiceMt(inv);
  }

  // One forecast and one budget per customer — the first record, exactly like
  // the Sales Forecast page — and only for customers that still exist.
  const custIds = new Set(customers.map((c) => c.id));
  const seen = new Set<string>();
  for (const cf of customerForecasts) {
    if (cf.fiscalYearId !== fy.id || !custIds.has(cf.customerId)) continue;
    const k = `${cf.customerId}|${cf.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const field = cf.type === 'Budget' ? 'budget' : 'forecast';
    const weekly = cf.viewMode === 'Weekly';
    for (const line of cf.lines || []) {
      for (const e of line.entries || []) {
        if (!e.value) continue;
        const i = weekly ? idxFor(isoFromDay(dayNum(fy.startDate) + e.periodIndex * 7)) : e.periodIndex;
        if (i >= 0 && i < months.length) months[i][field] += e.value;
      }
    }
  }

  const inYear = today >= fy.startDate && today <= fy.endDate;
  const curIdx = inYear ? idxFor(today) : -1;
  const cur = curIdx >= 0 ? months[curIdx] : null;
  const periodDays = cur ? dayNum(cur.end) - dayNum(cur.start) + 1 : 0;
  const periodElapsed = cur ? Math.min(1, (dayNum(today) - dayNum(cur.start) + 1) / periodDays) : 0;
  const periodDaysLeft = cur ? Math.max(0, dayNum(cur.end) - dayNum(today)) : 0;
  const yearDays = dayNum(fy.endDate) - dayNum(fy.startDate) + 1;
  const yearElapsed = today > fy.endDate ? 1 : today < fy.startDate ? 0 : (dayNum(today) - dayNum(fy.startDate) + 1) / yearDays;

  const sum = (k: SeriesKey) => months.reduce((s, m) => s + m[k], 0);
  const toDate = (k: 'forecast' | 'budget') => {
    if (today > fy.endDate) return sum(k);
    if (curIdx < 0) return 0;
    return months.slice(0, curIdx).reduce((s, m) => s + m[k], 0) + months[curIdx][k] * periodElapsed;
  };
  const forecastYear = sum('forecast');
  const budgetYear = sum('budget');
  return {
    fy, months, curIdx, periodElapsed, periodDaysLeft, periodDays, yearElapsed,
    salesYtd: sum('sales'), forecastYear, budgetYear,
    forecastToDate: toDate('forecast'), budgetToDate: toDate('budget'),
    hasForecast: forecastYear > 0, hasBudget: budgetYear > 0,
  };
}

/** Rows for the dashboard Excel export. */
export function salesForecastExportRows(d: SalesForecastSummaryData) {
  return d.months.map((m) => ({
    period: m.name,
    dates: `${m.start} to ${m.end}`,
    sales: Math.round(m.sales * 10) / 10,
    forecast: Math.round(m.forecast * 10) / 10,
    budget: Math.round(m.budget * 10) / 10,
    pctForecast: m.forecast > 0 ? Math.round((m.sales / m.forecast) * 1000) / 10 : null,
    pctBudget: m.budget > 0 ? Math.round((m.sales / m.budget) * 1000) / 10 : null,
  }));
}

/** Three bars on ONE scale (Sales, Forecast, Budget) with the value beside each. */
function CompareBars({ rows }: { rows: { key: SeriesKey; label: string; value: number; missing?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[112px_1fr_92px] items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest font-bold opacity-70 flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SERIES[r.key].color }} />
            {r.label}
          </span>
          <div className="h-4 bg-[#141414]/[0.05] relative">
            {r.missing ? (
              <span className="absolute inset-0 flex items-center px-2 text-[10px] italic opacity-50">{r.missing}</span>
            ) : r.value > 0 ? (
              <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max((r.value / max) * 100, 0.75)}%`, background: SERIES[r.key].color }} />
            ) : null}
          </div>
          <span className="font-mono text-xs font-bold text-right">{r.missing ? '—' : fmtMt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function SalesForecastSummary({
  invoices, customerForecasts, fiscalYears, customers,
}: {
  invoices: Invoice[];
  customerForecasts: CustomerForecast[];
  fiscalYears: FiscalYear[];
  customers: Customer[];
}) {
  const data = useMemo(
    () => computeSalesForecastSummary(invoices, customerForecasts, fiscalYears, customers),
    [invoices, customerForecasts, fiscalYears, customers],
  );

  const card = 'bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]';
  if (!data) {
    return (
      <div className={card}>
        <div className="bg-[#141414] text-[#E4E3E0] p-4"><h3 className="text-xs font-bold uppercase tracking-widest">Sales vs Forecast &amp; Budget</h3></div>
        <p className="p-6 text-xs opacity-60 italic">No fiscal year is set up yet. Add one on the Sales Forecast page to see sales against forecast and budget.</p>
      </div>
    );
  }

  const { fy, months, curIdx } = data;
  const cur = curIdx >= 0 ? months[curIdx] : null;
  const noBudget = `No budget entered for ${fy.name}`;
  const noForecast = `No forecast entered for ${fy.name}`;

  return (
    <div className={card}>
      <div className="bg-[#141414] text-[#E4E3E0] p-4 flex flex-wrap justify-between items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest">Sales vs Forecast &amp; Budget — {fy.name}</h3>
        <span className="text-[10px] opacity-80">Sales = invoiced MT · Forecast &amp; Budget from the Sales Forecast page</span>
      </div>

      {/* ── Period and year summaries ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="p-5 lg:border-r border-[#141414]/10">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h4 className="text-[11px] font-black uppercase tracking-widest">This Period{cur ? ` — ${cur.name}` : ''}</h4>
            {cur && <span className="text-[10px] opacity-60">{fmtDate(cur.start)} – {fmtDate(cur.end)} · {data.periodDaysLeft} of {data.periodDays} days left</span>}
          </div>
          {cur ? (
            <>
              <CompareBars rows={[
                { key: 'sales', label: 'Sales MTD', value: cur.sales },
                { key: 'forecast', label: 'Forecast', value: cur.forecast, missing: cur.forecast > 0 ? undefined : noForecast },
                { key: 'budget', label: 'Budget', value: cur.budget, missing: cur.budget > 0 ? undefined : noBudget },
              ]} />
              <p className="text-[11px] mt-3 opacity-80">
                Sales are at <strong>{pctOf(cur.sales, cur.forecast)}</strong> of forecast and <strong>{pctOf(cur.sales, cur.budget)}</strong> of budget,
                with {Math.round(data.periodElapsed * 100)}% of the period gone.
              </p>
            </>
          ) : (
            <p className="text-xs opacity-60 italic">Today is outside {fy.name}.</p>
          )}
        </div>
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h4 className="text-[11px] font-black uppercase tracking-widest">Year to Date — {fy.name}</h4>
            <span className="text-[10px] opacity-60">{fmtDate(fy.startDate)} – {fmtDate(fy.endDate)} · {Math.round(data.yearElapsed * 100)}% of the year gone</span>
          </div>
          <CompareBars rows={[
            { key: 'sales', label: 'Sales YTD', value: data.salesYtd },
            { key: 'forecast', label: 'Forecast (year)', value: data.forecastYear, missing: data.hasForecast ? undefined : noForecast },
            { key: 'budget', label: 'Budget (year)', value: data.budgetYear, missing: data.hasBudget ? undefined : noBudget },
          ]} />
          <p className="text-[11px] mt-3 opacity-80">
            Sales YTD are <strong>{pctOf(data.salesYtd, data.forecastToDate)}</strong> of forecast to date
            {data.hasForecast ? ` (${fmtMt(data.forecastToDate)})` : ''} and <strong>{pctOf(data.salesYtd, data.budgetToDate)}</strong> of budget to date
            {data.hasBudget ? ` (${fmtMt(data.budgetToDate)})` : ''}.
          </p>
        </div>
      </div>

    </div>
  );
}
