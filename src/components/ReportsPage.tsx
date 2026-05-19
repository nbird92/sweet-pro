import React, { useState, useMemo, useCallback } from 'react';
import {
  Search,
  ArrowUpDown,
  X,
  TrendingUp,
  Users,
  Package,
  BarChart3,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type {
  Invoice,
  Order,
  Customer,
  CustomerForecast,
  FiscalYear,
  FiscalPeriod,
  Shipment,
  CustomerGroup,
} from '../types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReportsPageProps {
  invoices: Invoice[];
  orders: Order[];
  customers: Customer[];
  customerForecasts: CustomerForecast[];
  fiscalYears: FiscalYear[];
  shipments: Shipment[];
  customerGroups: CustomerGroup[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNum(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReportsPage({
  invoices,
  orders,
  customers,
  customerForecasts,
  fiscalYears,
  shipments,
  customerGroups,
}: ReportsPageProps) {
  // ── Sort/Search state per report ──────────────────────────────────────────
  const [custSearch, setCustSearch] = useState('');
  const [custSort, setCustSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [prodSearch, setProdSearch] = useState('');
  const [prodSort, setProdSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [trendYear, setTrendYear] = useState<string>('all');
  const [topNSearch, setTopNSearch] = useState('');
  const [topNSort, setTopNSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [projFyId, setProjFyId] = useState<string>(fiscalYears.length > 0 ? fiscalYears[0].id : '');
  const [projSearch, setProjSearch] = useState('');
  const [projSort, setProjSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'projRevenue', dir: 'desc' });
  const [grpSearch, setGrpSearch] = useState('');
  const [grpSort, setGrpSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });

  const toggleSort = (setter: React.Dispatch<React.SetStateAction<{ key: string; dir: 'asc' | 'desc' }>>) => (key: string) => {
    setter(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  };

  // ── SortHeader ────────────────────────────────────────────────────────────
  const SortHeader = ({ label, sortKey, current, onToggle }: { label: string; sortKey: string; current: { key: string; dir: 'asc' | 'desc' }; onToggle: (k: string) => void }) => (
    <button onClick={() => onToggle(sortKey)} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
      <span>{label}</span>
      <ArrowUpDown size={10} className={current.key === sortKey ? 'opacity-100' : 'opacity-30'} />
      {current.key === sortKey && <span className="text-[8px]">{current.dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 1: Sales by Customer (ranked by volume)
  // ═══════════════════════════════════════════════════════════════════════════
  const customerSalesData = useMemo(() => {
    const map = new Map<string, { customer: string; totalMt: number; totalRevenue: number; orderCount: number; avgPrice: number }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const existing = map.get(inv.customer);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.orderCount += 1;
      } else {
        map.set(inv.customer, {
          customer: inv.customer,
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          orderCount: 1,
          avgPrice: 0,
        });
      }
    }

    const rows = Array.from(map.values());
    const grandTotal = rows.reduce((s, r) => s + r.totalMt, 0);
    return rows.map(r => ({
      ...r,
      avgPrice: r.totalMt > 0 ? r.totalRevenue / r.totalMt : 0,
      pctOfTotal: grandTotal > 0 ? (r.totalMt / grandTotal) * 100 : 0,
    }));
  }, [invoices]);

  const sortedCustomerSales = useMemo(() => {
    let list = customerSalesData;
    if (custSearch.trim()) {
      const q = custSearch.toLowerCase();
      list = list.filter(r => r.customer.toLowerCase().includes(q));
    }
    if (custSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (custSort.key) {
          case 'customer': va = a.customer; vb = b.customer; break;
          case 'totalMt': va = a.totalMt; vb = b.totalMt; break;
          case 'totalRevenue': va = a.totalRevenue; vb = b.totalRevenue; break;
          case 'orderCount': va = a.orderCount; vb = b.orderCount; break;
          case 'avgPrice': va = a.avgPrice; vb = b.avgPrice; break;
          case 'pctOfTotal': va = a.pctOfTotal; vb = b.pctOfTotal; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') return custSort.dir === 'asc' ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return custSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [customerSalesData, custSearch, custSort]);

  const customerGrandTotalMt = useMemo(() => customerSalesData.reduce((s, r) => s + r.totalMt, 0), [customerSalesData]);
  const customerGrandTotalRev = useMemo(() => customerSalesData.reduce((s, r) => s + r.totalRevenue, 0), [customerSalesData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 2: Sales by Product (ranked by volume)
  // ═══════════════════════════════════════════════════════════════════════════
  const productSalesData = useMemo(() => {
    const map = new Map<string, { product: string; totalMt: number; totalRevenue: number; customerCount: number; avgPrice: number }>();
    const productCustomers = new Map<string, Set<string>>();

    for (const inv of invoices) {
      if (!inv.product || !inv.qty) continue;
      const existing = map.get(inv.product);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
      } else {
        map.set(inv.product, {
          product: inv.product,
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          customerCount: 0,
          avgPrice: 0,
        });
      }
      if (!productCustomers.has(inv.product)) productCustomers.set(inv.product, new Set());
      if (inv.customer) productCustomers.get(inv.product)!.add(inv.customer);
    }

    const rows = Array.from(map.values());
    const grandTotal = rows.reduce((s, r) => s + r.totalMt, 0);
    return rows.map(r => ({
      ...r,
      customerCount: productCustomers.get(r.product)?.size ?? 0,
      avgPrice: r.totalMt > 0 ? r.totalRevenue / r.totalMt : 0,
      pctOfTotal: grandTotal > 0 ? (r.totalMt / grandTotal) * 100 : 0,
    }));
  }, [invoices]);

  const sortedProductSales = useMemo(() => {
    let list = productSalesData;
    if (prodSearch.trim()) {
      const q = prodSearch.toLowerCase();
      list = list.filter(r => r.product.toLowerCase().includes(q));
    }
    if (prodSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (prodSort.key) {
          case 'product': va = a.product; vb = b.product; break;
          case 'totalMt': va = a.totalMt; vb = b.totalMt; break;
          case 'totalRevenue': va = a.totalRevenue; vb = b.totalRevenue; break;
          case 'customerCount': va = a.customerCount; vb = b.customerCount; break;
          case 'avgPrice': va = a.avgPrice; vb = b.avgPrice; break;
          case 'pctOfTotal': va = a.pctOfTotal; vb = b.pctOfTotal; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') return prodSort.dir === 'asc' ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return prodSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [productSalesData, prodSearch, prodSort]);

  const productGrandTotalMt = useMemo(() => productSalesData.reduce((s, r) => s + r.totalMt, 0), [productSalesData]);
  const productGrandTotalRev = useMemo(() => productSalesData.reduce((s, r) => s + r.totalRevenue, 0), [productSalesData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 3: Monthly Sales Trend
  // ═══════════════════════════════════════════════════════════════════════════
  const monthlySalesData = useMemo(() => {
    const map = new Map<string, { yearMonth: string; year: string; month: number; totalMt: number; totalRevenue: number; invoiceCount: number }>();

    for (const inv of invoices) {
      if (!inv.date || !inv.qty) continue;
      const ym = inv.date.slice(0, 7); // YYYY-MM
      const existing = map.get(ym);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.invoiceCount += 1;
      } else {
        map.set(ym, {
          yearMonth: ym,
          year: ym.slice(0, 4),
          month: parseInt(ym.slice(5, 7), 10),
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          invoiceCount: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
  }, [invoices]);

  const availableYears = useMemo(() => {
    const years = new Set(monthlySalesData.map(d => d.year));
    return Array.from(years).sort();
  }, [monthlySalesData]);

  const filteredMonthlyData = useMemo(() => {
    if (trendYear === 'all') return monthlySalesData;
    return monthlySalesData.filter(d => d.year === trendYear);
  }, [monthlySalesData, trendYear]);

  const maxMonthlyMt = useMemo(() => Math.max(...filteredMonthlyData.map(d => d.totalMt), 1), [filteredMonthlyData]);
  const monthlyGrandMt = useMemo(() => filteredMonthlyData.reduce((s, d) => s + d.totalMt, 0), [filteredMonthlyData]);
  const monthlyGrandRev = useMemo(() => filteredMonthlyData.reduce((s, d) => s + d.totalRevenue, 0), [filteredMonthlyData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 4: Top Customer-Product Combinations
  // ═══════════════════════════════════════════════════════════════════════════
  const topCombinations = useMemo(() => {
    const map = new Map<string, { customer: string; product: string; totalMt: number; totalRevenue: number; invoiceCount: number }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.product || !inv.qty) continue;
      const key = `${inv.customer}|||${inv.product}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.invoiceCount += 1;
      } else {
        map.set(key, {
          customer: inv.customer,
          product: inv.product,
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          invoiceCount: 1,
        });
      }
    }

    const rows = Array.from(map.values());
    const grandTotal = rows.reduce((s, r) => s + r.totalMt, 0);
    return rows.map(r => ({
      ...r,
      avgPrice: r.totalMt > 0 ? r.totalRevenue / r.totalMt : 0,
      pctOfTotal: grandTotal > 0 ? (r.totalMt / grandTotal) * 100 : 0,
    }));
  }, [invoices]);

  const sortedTopCombinations = useMemo(() => {
    let list = topCombinations;
    if (topNSearch.trim()) {
      const q = topNSearch.toLowerCase();
      list = list.filter(r => r.customer.toLowerCase().includes(q) || r.product.toLowerCase().includes(q));
    }
    if (topNSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (topNSort.key) {
          case 'customer': va = a.customer; vb = b.customer; break;
          case 'product': va = a.product; vb = b.product; break;
          case 'totalMt': va = a.totalMt; vb = b.totalMt; break;
          case 'totalRevenue': va = a.totalRevenue; vb = b.totalRevenue; break;
          case 'invoiceCount': va = a.invoiceCount; vb = b.invoiceCount; break;
          case 'avgPrice': va = a.avgPrice; vb = b.avgPrice; break;
          case 'pctOfTotal': va = a.pctOfTotal; vb = b.pctOfTotal; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') return topNSort.dir === 'asc' ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return topNSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [topCombinations, topNSearch, topNSort]);

  const comboGrandMt = useMemo(() => topCombinations.reduce((s, r) => s + r.totalMt, 0), [topCombinations]);
  const comboGrandRev = useMemo(() => topCombinations.reduce((s, r) => s + r.totalRevenue, 0), [topCombinations]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 5: Projected Annual Sales
  // ═══════════════════════════════════════════════════════════════════════════

  const projFy = useMemo(() => fiscalYears.find(fy => fy.id === projFyId) ?? null, [fiscalYears, projFyId]);

  const TODAY_ISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  /** Check if a fiscal period has ended */
  const isPeriodPast = useCallback((period: FiscalPeriod) => period.endDate < TODAY_ISO, [TODAY_ISO]);

  /** Period index for a date within the selected FY's periods */
  const periodIndexForDate = useCallback((dateStr: string, periods: FiscalPeriod[]): number => {
    for (const p of periods) {
      if (dateStr >= p.startDate && dateStr <= p.endDate) return p.periodNumber - 1;
    }
    return -1;
  }, []);

  // Compute avg $/MT per customer from all historical invoices (not FY-bounded)
  const customerAvgPrice = useMemo(() => {
    const map = new Map<string, { totalRev: number; totalMt: number }>();
    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const e = map.get(inv.customer);
      if (e) { e.totalRev += inv.amount || 0; e.totalMt += inv.qty; }
      else map.set(inv.customer, { totalRev: inv.amount || 0, totalMt: inv.qty });
    }
    const result = new Map<string, number>();
    for (const [name, v] of map) {
      result.set(name, v.totalMt > 0 ? v.totalRev / v.totalMt : 0);
    }
    return result;
  }, [invoices]);

  // Global avg $/MT fallback
  const globalAvgPrice = useMemo(() => {
    const totalRev = invoices.reduce((s, inv) => s + (inv.amount || 0), 0);
    const totalMt = invoices.reduce((s, inv) => s + (inv.qty || 0), 0);
    return totalMt > 0 ? totalRev / totalMt : 0;
  }, [invoices]);

  // Monthly summary: 12 rows, one per period
  const projectedMonthlySummary = useMemo(() => {
    if (!projFy || projFy.periods.length === 0) return [];

    // Actuals per period from invoices within FY
    const actualsByPeriod = new Array(12).fill(null).map(() => ({ mt: 0, rev: 0 }));
    for (const inv of invoices) {
      if (!inv.date || !inv.qty) continue;
      if (inv.date < projFy.startDate || inv.date > projFy.endDate) continue;
      const pIdx = periodIndexForDate(inv.date, projFy.periods);
      if (pIdx >= 0 && pIdx < 12) {
        actualsByPeriod[pIdx].mt += inv.qty;
        actualsByPeriod[pIdx].rev += inv.amount || 0;
      }
    }

    // Forecast per period from customer forecasts
    const forecastByPeriod = new Array(12).fill(0) as number[];
    const forecasts = customerForecasts.filter(
      cf => cf.fiscalYearId === projFy.id && cf.type === 'Forecast'
    );
    for (const cf of forecasts) {
      for (const line of cf.lines) {
        for (const entry of line.entries) {
          if (entry.periodIndex >= 0 && entry.periodIndex < 12) {
            forecastByPeriod[entry.periodIndex] += entry.value;
          }
        }
      }
    }

    return projFy.periods.slice(0, 12).map((period, idx) => {
      const past = isPeriodPast(period);
      const actualMt = actualsByPeriod[idx].mt;
      const actualRev = actualsByPeriod[idx].rev;
      const forecastMt = forecastByPeriod[idx];

      if (past) {
        // Use actuals
        return {
          periodName: period.name || MONTH_NAMES[idx] || `P${idx + 1}`,
          source: 'Actual' as const,
          volumeMt: actualMt,
          avgPriceMt: actualMt > 0 ? actualRev / actualMt : 0,
          projRevenue: actualRev,
        };
      } else {
        // Use forecast volume × avg $/MT
        const avgPrice = globalAvgPrice;
        return {
          periodName: period.name || MONTH_NAMES[idx] || `P${idx + 1}`,
          source: 'Forecast' as const,
          volumeMt: forecastMt,
          avgPriceMt: avgPrice,
          projRevenue: forecastMt * avgPrice,
        };
      }
    });
  }, [projFy, invoices, customerForecasts, periodIndexForDate, isPeriodPast, globalAvgPrice]);

  const projGrandMt = useMemo(() => projectedMonthlySummary.reduce((s, r) => s + r.volumeMt, 0), [projectedMonthlySummary]);
  const projGrandRev = useMemo(() => projectedMonthlySummary.reduce((s, r) => s + r.projRevenue, 0), [projectedMonthlySummary]);
  const projActualMt = useMemo(() => projectedMonthlySummary.filter(r => r.source === 'Actual').reduce((s, r) => s + r.volumeMt, 0), [projectedMonthlySummary]);
  const projActualRev = useMemo(() => projectedMonthlySummary.filter(r => r.source === 'Actual').reduce((s, r) => s + r.projRevenue, 0), [projectedMonthlySummary]);
  const projForecastMt = useMemo(() => projectedMonthlySummary.filter(r => r.source === 'Forecast').reduce((s, r) => s + r.volumeMt, 0), [projectedMonthlySummary]);
  const projForecastRev = useMemo(() => projectedMonthlySummary.filter(r => r.source === 'Forecast').reduce((s, r) => s + r.projRevenue, 0), [projectedMonthlySummary]);

  // Customer-level breakdown for projected annual sales
  const projectedCustomerData = useMemo(() => {
    if (!projFy || projFy.periods.length === 0) return [];

    // Actuals per customer: { mt, rev }
    const custActuals = new Map<string, { mt: number; rev: number }>();
    for (const inv of invoices) {
      if (!inv.date || !inv.qty || !inv.customer) continue;
      if (inv.date < projFy.startDate || inv.date > projFy.endDate) continue;
      const pIdx = periodIndexForDate(inv.date, projFy.periods);
      if (pIdx < 0 || pIdx >= 12) continue;
      if (!isPeriodPast(projFy.periods[pIdx])) continue; // only count completed periods
      const e = custActuals.get(inv.customer);
      if (e) { e.mt += inv.qty; e.rev += inv.amount || 0; }
      else custActuals.set(inv.customer, { mt: inv.qty, rev: inv.amount || 0 });
    }

    // Forecast per customer (future periods only)
    const custForecast = new Map<string, number>();
    const forecasts = customerForecasts.filter(
      cf => cf.fiscalYearId === projFy.id && cf.type === 'Forecast'
    );
    for (const cf of forecasts) {
      let futureMt = 0;
      for (const line of cf.lines) {
        for (const entry of line.entries) {
          if (entry.periodIndex >= 0 && entry.periodIndex < 12) {
            if (!isPeriodPast(projFy.periods[entry.periodIndex])) {
              futureMt += entry.value;
            }
          }
        }
      }
      if (futureMt > 0) {
        custForecast.set(cf.customerName, (custForecast.get(cf.customerName) ?? 0) + futureMt);
      }
    }

    // Merge all customer names
    const allNames = new Set<string>();
    for (const k of custActuals.keys()) allNames.add(k);
    for (const k of custForecast.keys()) allNames.add(k);

    return Array.from(allNames).map(name => {
      const actual = custActuals.get(name) ?? { mt: 0, rev: 0 };
      const forecastMt = custForecast.get(name) ?? 0;
      const avgPrice = customerAvgPrice.get(name) ?? globalAvgPrice;
      const forecastRev = forecastMt * avgPrice;
      const totalMt = actual.mt + forecastMt;
      const totalRev = actual.rev + forecastRev;

      return {
        customer: name,
        actualMt: actual.mt,
        actualRev: actual.rev,
        forecastMt,
        forecastRev,
        avgPriceMt: avgPrice,
        totalMt,
        projRevenue: totalRev,
      };
    });
  }, [projFy, invoices, customerForecasts, periodIndexForDate, isPeriodPast, customerAvgPrice, globalAvgPrice]);

  const sortedProjectedCustomers = useMemo(() => {
    let list = projectedCustomerData;
    if (projSearch.trim()) {
      const q = projSearch.toLowerCase();
      list = list.filter(r => r.customer.toLowerCase().includes(q));
    }
    if (projSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (projSort.key) {
          case 'customer': va = a.customer; vb = b.customer; break;
          case 'actualMt': va = a.actualMt; vb = b.actualMt; break;
          case 'actualRev': va = a.actualRev; vb = b.actualRev; break;
          case 'forecastMt': va = a.forecastMt; vb = b.forecastMt; break;
          case 'forecastRev': va = a.forecastRev; vb = b.forecastRev; break;
          case 'avgPriceMt': va = a.avgPriceMt; vb = b.avgPriceMt; break;
          case 'totalMt': va = a.totalMt; vb = b.totalMt; break;
          case 'projRevenue': va = a.projRevenue; vb = b.projRevenue; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') return projSort.dir === 'asc' ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return projSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [projectedCustomerData, projSearch, projSort]);

  const projCustGrandMt = useMemo(() => projectedCustomerData.reduce((s, r) => s + r.totalMt, 0), [projectedCustomerData]);
  const projCustGrandRev = useMemo(() => projectedCustomerData.reduce((s, r) => s + r.projRevenue, 0), [projectedCustomerData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT 6: Sales Volume by Customer Group
  // ═══════════════════════════════════════════════════════════════════════════

  const groupSalesData = useMemo(() => {
    // Build a map of customer name → customerGroupId
    const custGroupMap = new Map<string, string | undefined>();
    for (const c of customers) {
      if (c.name) custGroupMap.set(c.name, c.customerGroupId);
    }

    // Aggregate invoices by group
    const map = new Map<string, { groupId: string; groupCode: string; groupName: string; totalMt: number; totalRevenue: number; invoiceCount: number; customerNames: Set<string> }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const groupId = custGroupMap.get(inv.customer);
      if (!groupId) continue; // skip ungrouped customers
      const grp = customerGroups.find(g => g.id === groupId);
      if (!grp) continue; // skip if group no longer exists
      const key = groupId;

      const existing = map.get(key);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.invoiceCount += 1;
        if (inv.customer) existing.customerNames.add(inv.customer);
      } else {
        map.set(key, {
          groupId,
          groupCode: grp.groupCode,
          groupName: grp.name,
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          invoiceCount: 1,
          customerNames: new Set(inv.customer ? [inv.customer] : []),
        });
      }
    }

    const rows = Array.from(map.values());
    const grandTotal = rows.reduce((s, r) => s + r.totalMt, 0);
    return rows.map(r => ({
      groupId: r.groupId,
      groupCode: r.groupCode,
      groupName: r.groupName,
      totalMt: r.totalMt,
      totalRevenue: r.totalRevenue,
      invoiceCount: r.invoiceCount,
      memberCount: r.customerNames.size,
      avgPrice: r.totalMt > 0 ? r.totalRevenue / r.totalMt : 0,
      pctOfTotal: grandTotal > 0 ? (r.totalMt / grandTotal) * 100 : 0,
    }));
  }, [invoices, customers, customerGroups]);

  const sortedGroupSales = useMemo(() => {
    let list = groupSalesData;
    if (grpSearch.trim()) {
      const q = grpSearch.toLowerCase();
      list = list.filter(r => r.groupName.toLowerCase().includes(q) || r.groupCode.toLowerCase().includes(q));
    }
    if (grpSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (grpSort.key) {
          case 'groupCode': va = a.groupCode; vb = b.groupCode; break;
          case 'groupName': va = a.groupName; vb = b.groupName; break;
          case 'memberCount': va = a.memberCount; vb = b.memberCount; break;
          case 'totalMt': va = a.totalMt; vb = b.totalMt; break;
          case 'totalRevenue': va = a.totalRevenue; vb = b.totalRevenue; break;
          case 'invoiceCount': va = a.invoiceCount; vb = b.invoiceCount; break;
          case 'avgPrice': va = a.avgPrice; vb = b.avgPrice; break;
          case 'pctOfTotal': va = a.pctOfTotal; vb = b.pctOfTotal; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') return grpSort.dir === 'asc' ? va - vb : vb - va;
        const cmp = String(va).localeCompare(String(vb));
        return grpSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [groupSalesData, grpSearch, grpSort]);

  const groupGrandTotalMt = useMemo(() => groupSalesData.reduce((s, r) => s + r.totalMt, 0), [groupSalesData]);
  const groupGrandTotalRev = useMemo(() => groupSalesData.reduce((s, r) => s + r.totalRevenue, 0), [groupSalesData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCEL EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } };
  const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFE4E3E0' }, size: 10 };
  const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  const TOTAL_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10 };
  const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14 };
  const SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: 'FF666666' } };
  const CURRENCY_FMT = '$#,##0.00';
  const NUMBER_FMT = '#,##0.0';
  const PCT_FMT = '0.0%';
  const INT_FMT = '#,##0';

  const applyHeaderRow = (ws: ExcelJS.Worksheet, rowNum: number) => {
    const row = ws.getRow(rowNum);
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: 'middle', horizontal: cell.alignment?.horizontal || 'left' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF141414' } },
      };
    });
    row.height = 24;
  };

  const applyTotalRow = (ws: ExcelJS.Worksheet, rowNum: number) => {
    const row = ws.getRow(rowNum);
    row.eachCell((cell) => {
      cell.fill = TOTAL_FILL;
      cell.font = TOTAL_FONT;
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF141414' } },
      };
    });
    row.height = 22;
  };

  const addTitleRows = (ws: ExcelJS.Worksheet, title: string, subtitle: string): number => {
    const titleRow = ws.addRow([title]);
    titleRow.getCell(1).font = TITLE_FONT;
    titleRow.height = 24;
    const subRow = ws.addRow([subtitle]);
    subRow.getCell(1).font = SUBTITLE_FONT;
    subRow.height = 18;
    ws.addRow([]); // blank row
    return ws.rowCount;
  };

  const buildCustomerSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Sales by Customer');
    const dateStr = new Date().toLocaleDateString();
    addTitleRows(ws, 'Sales Volume by Customer', `Generated ${dateStr} | ${customerSalesData.length} customers | ${formatNum(customerGrandTotalMt)} MT total`);

    // Headers
    const headerRowNum = ws.rowCount + 1;
    ws.addRow(['#', 'Customer', 'Total (MT)', 'Revenue', 'Invoices', 'Avg $/MT', '% of Total']);
    applyHeaderRow(ws, headerRowNum);
    ws.getRow(headerRowNum).getCell(3).alignment = { horizontal: 'right' };
    ws.getRow(headerRowNum).getCell(4).alignment = { horizontal: 'right' };
    ws.getRow(headerRowNum).getCell(5).alignment = { horizontal: 'right' };
    ws.getRow(headerRowNum).getCell(6).alignment = { horizontal: 'right' };
    ws.getRow(headerRowNum).getCell(7).alignment = { horizontal: 'right' };

    // Data rows
    sortedCustomerSales.forEach((row, idx) => {
      const r = ws.addRow([idx + 1, row.customer, row.totalMt, row.totalRevenue, row.orderCount, row.avgPrice, row.pctOfTotal / 100]);
      r.getCell(3).numFmt = NUMBER_FMT;
      r.getCell(4).numFmt = CURRENCY_FMT;
      r.getCell(5).numFmt = INT_FMT;
      r.getCell(6).numFmt = CURRENCY_FMT;
      r.getCell(7).numFmt = PCT_FMT;
      r.getCell(3).alignment = { horizontal: 'right' };
      r.getCell(4).alignment = { horizontal: 'right' };
      r.getCell(5).alignment = { horizontal: 'right' };
      r.getCell(6).alignment = { horizontal: 'right' };
      r.getCell(7).alignment = { horizontal: 'right' };
      // Alternate row shading
      if (idx % 2 === 1) {
        r.eachCell((cell) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        });
      }
    });

    // Total row
    const totalRowNum = ws.rowCount + 1;
    const totalInvoices = customerSalesData.reduce((s, r) => s + r.orderCount, 0);
    const avgAll = customerGrandTotalMt > 0 ? customerGrandTotalRev / customerGrandTotalMt : 0;
    const r = ws.addRow(['', `Total (${customerSalesData.length} customers)`, customerGrandTotalMt, customerGrandTotalRev, totalInvoices, avgAll, 1]);
    r.getCell(3).numFmt = NUMBER_FMT;
    r.getCell(4).numFmt = CURRENCY_FMT;
    r.getCell(5).numFmt = INT_FMT;
    r.getCell(6).numFmt = CURRENCY_FMT;
    r.getCell(7).numFmt = PCT_FMT;
    r.getCell(3).alignment = { horizontal: 'right' };
    r.getCell(4).alignment = { horizontal: 'right' };
    r.getCell(5).alignment = { horizontal: 'right' };
    r.getCell(6).alignment = { horizontal: 'right' };
    r.getCell(7).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalRowNum);

    // Column widths
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 35;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 18;
    ws.getColumn(5).width = 12;
    ws.getColumn(6).width = 16;
    ws.getColumn(7).width = 14;

    // Freeze header
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 0 }];
  }, [sortedCustomerSales, customerSalesData, customerGrandTotalMt, customerGrandTotalRev]);

  const buildProductSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Sales by Product');
    const dateStr = new Date().toLocaleDateString();
    addTitleRows(ws, 'Sales Volume by Product', `Generated ${dateStr} | ${productSalesData.length} products | ${formatNum(productGrandTotalMt)} MT total`);

    const headerRowNum = ws.rowCount + 1;
    ws.addRow(['#', 'Product', 'Total (MT)', 'Revenue', 'Customers', 'Avg $/MT', '% of Total']);
    applyHeaderRow(ws, headerRowNum);
    for (let i = 3; i <= 7; i++) ws.getRow(headerRowNum).getCell(i).alignment = { horizontal: 'right' };

    sortedProductSales.forEach((row, idx) => {
      const r = ws.addRow([idx + 1, row.product, row.totalMt, row.totalRevenue, row.customerCount, row.avgPrice, row.pctOfTotal / 100]);
      r.getCell(3).numFmt = NUMBER_FMT;
      r.getCell(4).numFmt = CURRENCY_FMT;
      r.getCell(5).numFmt = INT_FMT;
      r.getCell(6).numFmt = CURRENCY_FMT;
      r.getCell(7).numFmt = PCT_FMT;
      for (let i = 3; i <= 7; i++) r.getCell(i).alignment = { horizontal: 'right' };
      if (idx % 2 === 1) {
        r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }
    });

    const totalRowNum = ws.rowCount + 1;
    const avgAll = productGrandTotalMt > 0 ? productGrandTotalRev / productGrandTotalMt : 0;
    const r = ws.addRow(['', `Total (${productSalesData.length} products)`, productGrandTotalMt, productGrandTotalRev, '', avgAll, 1]);
    r.getCell(3).numFmt = NUMBER_FMT;
    r.getCell(4).numFmt = CURRENCY_FMT;
    r.getCell(6).numFmt = CURRENCY_FMT;
    r.getCell(7).numFmt = PCT_FMT;
    for (let i = 3; i <= 7; i++) r.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalRowNum);

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 35;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 18;
    ws.getColumn(5).width = 14;
    ws.getColumn(6).width = 16;
    ws.getColumn(7).width = 14;
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 0 }];
  }, [sortedProductSales, productSalesData, productGrandTotalMt, productGrandTotalRev]);

  const buildMonthlySheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Monthly Trend');
    const dateStr = new Date().toLocaleDateString();
    const yearLabel = trendYear === 'all' ? 'All Years' : trendYear;
    addTitleRows(ws, 'Monthly Sales Trend', `Generated ${dateStr} | ${yearLabel} | ${filteredMonthlyData.length} months | ${formatNum(monthlyGrandMt)} MT total`);

    const headerRowNum = ws.rowCount + 1;
    ws.addRow(['Month', 'Volume (MT)', 'Revenue', 'Invoices', 'Avg $/MT']);
    applyHeaderRow(ws, headerRowNum);
    for (let i = 2; i <= 5; i++) ws.getRow(headerRowNum).getCell(i).alignment = { horizontal: 'right' };

    filteredMonthlyData.forEach((d, idx) => {
      const avg = d.totalMt > 0 ? d.totalRevenue / d.totalMt : 0;
      const r = ws.addRow([`${MONTH_NAMES[d.month - 1]} ${d.year}`, d.totalMt, d.totalRevenue, d.invoiceCount, avg]);
      r.getCell(2).numFmt = NUMBER_FMT;
      r.getCell(3).numFmt = CURRENCY_FMT;
      r.getCell(4).numFmt = INT_FMT;
      r.getCell(5).numFmt = CURRENCY_FMT;
      for (let i = 2; i <= 5; i++) r.getCell(i).alignment = { horizontal: 'right' };
      if (idx % 2 === 1) {
        r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }
    });

    const totalRowNum = ws.rowCount + 1;
    const totalInv = filteredMonthlyData.reduce((s, d) => s + d.invoiceCount, 0);
    const avgAll = monthlyGrandMt > 0 ? monthlyGrandRev / monthlyGrandMt : 0;
    const r = ws.addRow([`Total (${filteredMonthlyData.length} months)`, monthlyGrandMt, monthlyGrandRev, totalInv, avgAll]);
    r.getCell(2).numFmt = NUMBER_FMT;
    r.getCell(3).numFmt = CURRENCY_FMT;
    r.getCell(4).numFmt = INT_FMT;
    r.getCell(5).numFmt = CURRENCY_FMT;
    for (let i = 2; i <= 5; i++) r.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalRowNum);

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 18;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 16;
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 0 }];
  }, [filteredMonthlyData, monthlyGrandMt, monthlyGrandRev, trendYear]);

  const buildCombinationsSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Customer-Product Combos');
    const dateStr = new Date().toLocaleDateString();
    addTitleRows(ws, 'Top Customer-Product Combinations', `Generated ${dateStr} | ${topCombinations.length} combinations | ${formatNum(comboGrandMt)} MT total`);

    const headerRowNum = ws.rowCount + 1;
    ws.addRow(['#', 'Customer', 'Product', 'Total (MT)', 'Revenue', 'Invoices', 'Avg $/MT', '% of Total']);
    applyHeaderRow(ws, headerRowNum);
    for (let i = 4; i <= 8; i++) ws.getRow(headerRowNum).getCell(i).alignment = { horizontal: 'right' };

    sortedTopCombinations.forEach((row, idx) => {
      const r = ws.addRow([idx + 1, row.customer, row.product, row.totalMt, row.totalRevenue, row.invoiceCount, row.avgPrice, row.pctOfTotal / 100]);
      r.getCell(4).numFmt = NUMBER_FMT;
      r.getCell(5).numFmt = CURRENCY_FMT;
      r.getCell(6).numFmt = INT_FMT;
      r.getCell(7).numFmt = CURRENCY_FMT;
      r.getCell(8).numFmt = PCT_FMT;
      for (let i = 4; i <= 8; i++) r.getCell(i).alignment = { horizontal: 'right' };
      if (idx % 2 === 1) {
        r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }
    });

    const totalRowNum = ws.rowCount + 1;
    const totalInv = topCombinations.reduce((s, r) => s + r.invoiceCount, 0);
    const avgAll = comboGrandMt > 0 ? comboGrandRev / comboGrandMt : 0;
    const r = ws.addRow(['', `Total (${topCombinations.length} combos)`, '', comboGrandMt, comboGrandRev, totalInv, avgAll, 1]);
    r.getCell(4).numFmt = NUMBER_FMT;
    r.getCell(5).numFmt = CURRENCY_FMT;
    r.getCell(6).numFmt = INT_FMT;
    r.getCell(7).numFmt = CURRENCY_FMT;
    r.getCell(8).numFmt = PCT_FMT;
    for (let i = 4; i <= 8; i++) r.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalRowNum);

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 18;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 16;
    ws.getColumn(8).width = 14;
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 0 }];
  }, [sortedTopCombinations, topCombinations, comboGrandMt, comboGrandRev]);

  const ACTUAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  const FORECAST_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };

  const buildProjectedSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Projected Annual Sales');
    const dateStr = new Date().toLocaleDateString();
    const fyName = projFy?.name ?? 'N/A';
    addTitleRows(ws, 'Projected Annual Sales', `Generated ${dateStr} | ${fyName} | Actuals YTD + Forecast | ${formatNum(projGrandMt)} MT projected`);

    // ── Monthly Summary Section ──
    const secRow = ws.addRow(['MONTHLY SUMMARY']);
    secRow.getCell(1).font = { bold: true, size: 11 };
    secRow.height = 20;

    const hdr1 = ws.rowCount + 1;
    ws.addRow(['Period', 'Source', 'Volume (MT)', 'Avg $/MT', 'Projected Revenue']);
    applyHeaderRow(ws, hdr1);
    for (let i = 3; i <= 5; i++) ws.getRow(hdr1).getCell(i).alignment = { horizontal: 'right' };

    projectedMonthlySummary.forEach((row, idx) => {
      const r = ws.addRow([row.periodName, row.source, row.volumeMt, row.avgPriceMt, row.projRevenue]);
      r.getCell(3).numFmt = NUMBER_FMT;
      r.getCell(4).numFmt = CURRENCY_FMT;
      r.getCell(5).numFmt = CURRENCY_FMT;
      for (let i = 3; i <= 5; i++) r.getCell(i).alignment = { horizontal: 'right' };
      // Green tint for actuals, yellow for forecast
      const fill = row.source === 'Actual' ? ACTUAL_FILL : FORECAST_FILL;
      r.eachCell((cell) => { cell.fill = fill; });
      if (idx % 2 === 1) {
        // Slightly darker alternate
        r.getCell(1).fill = fill;
      }
    });

    // Subtotal rows
    const subActual = ws.rowCount + 1;
    const r1 = ws.addRow(['YTD Actual', '', projActualMt, projActualMt > 0 ? projActualRev / projActualMt : 0, projActualRev]);
    r1.getCell(3).numFmt = NUMBER_FMT; r1.getCell(4).numFmt = CURRENCY_FMT; r1.getCell(5).numFmt = CURRENCY_FMT;
    for (let i = 3; i <= 5; i++) r1.getCell(i).alignment = { horizontal: 'right' };
    r1.eachCell(cell => { cell.fill = ACTUAL_FILL; cell.font = { bold: true, size: 10 }; });

    const r2 = ws.addRow(['Remaining Forecast', '', projForecastMt, projForecastMt > 0 ? projForecastRev / projForecastMt : 0, projForecastRev]);
    r2.getCell(3).numFmt = NUMBER_FMT; r2.getCell(4).numFmt = CURRENCY_FMT; r2.getCell(5).numFmt = CURRENCY_FMT;
    for (let i = 3; i <= 5; i++) r2.getCell(i).alignment = { horizontal: 'right' };
    r2.eachCell(cell => { cell.fill = FORECAST_FILL; cell.font = { bold: true, size: 10 }; });

    const totalR = ws.rowCount + 1;
    const r3 = ws.addRow(['PROJECTED ANNUAL TOTAL', '', projGrandMt, projGrandMt > 0 ? projGrandRev / projGrandMt : 0, projGrandRev]);
    r3.getCell(3).numFmt = NUMBER_FMT; r3.getCell(4).numFmt = CURRENCY_FMT; r3.getCell(5).numFmt = CURRENCY_FMT;
    for (let i = 3; i <= 5; i++) r3.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalR);

    // ── Blank row ──
    ws.addRow([]);
    ws.addRow([]);

    // ── Customer Breakdown Section ──
    const sec2 = ws.addRow(['CUSTOMER BREAKDOWN']);
    sec2.getCell(1).font = { bold: true, size: 11 };
    sec2.height = 20;

    const hdr2 = ws.rowCount + 1;
    ws.addRow(['#', 'Customer', 'Actual YTD (MT)', 'Actual YTD Rev', 'Forecast (MT)', 'Forecast Rev', 'Avg $/MT', 'Total (MT)', 'Projected Revenue']);
    applyHeaderRow(ws, hdr2);
    for (let i = 3; i <= 9; i++) ws.getRow(hdr2).getCell(i).alignment = { horizontal: 'right' };

    sortedProjectedCustomers.forEach((row, idx) => {
      const r = ws.addRow([idx + 1, row.customer, row.actualMt, row.actualRev, row.forecastMt, row.forecastRev, row.avgPriceMt, row.totalMt, row.projRevenue]);
      r.getCell(3).numFmt = NUMBER_FMT; r.getCell(4).numFmt = CURRENCY_FMT;
      r.getCell(5).numFmt = NUMBER_FMT; r.getCell(6).numFmt = CURRENCY_FMT;
      r.getCell(7).numFmt = CURRENCY_FMT;
      r.getCell(8).numFmt = NUMBER_FMT; r.getCell(9).numFmt = CURRENCY_FMT;
      for (let i = 3; i <= 9; i++) r.getCell(i).alignment = { horizontal: 'right' };
      if (idx % 2 === 1) {
        r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }
    });

    const custTotal = ws.rowCount + 1;
    const cActMt = projectedCustomerData.reduce((s, r) => s + r.actualMt, 0);
    const cActRev = projectedCustomerData.reduce((s, r) => s + r.actualRev, 0);
    const cFcMt = projectedCustomerData.reduce((s, r) => s + r.forecastMt, 0);
    const cFcRev = projectedCustomerData.reduce((s, r) => s + r.forecastRev, 0);
    const avgAll = projCustGrandMt > 0 ? projCustGrandRev / projCustGrandMt : 0;
    const rr = ws.addRow(['', `Total (${projectedCustomerData.length} customers)`, cActMt, cActRev, cFcMt, cFcRev, avgAll, projCustGrandMt, projCustGrandRev]);
    rr.getCell(3).numFmt = NUMBER_FMT; rr.getCell(4).numFmt = CURRENCY_FMT;
    rr.getCell(5).numFmt = NUMBER_FMT; rr.getCell(6).numFmt = CURRENCY_FMT;
    rr.getCell(7).numFmt = CURRENCY_FMT;
    rr.getCell(8).numFmt = NUMBER_FMT; rr.getCell(9).numFmt = CURRENCY_FMT;
    for (let i = 3; i <= 9; i++) rr.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, custTotal);

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 32;
    ws.getColumn(3).width = 18;
    ws.getColumn(4).width = 18;
    ws.getColumn(5).width = 18;
    ws.getColumn(6).width = 18;
    ws.getColumn(7).width = 16;
    ws.getColumn(8).width = 16;
    ws.getColumn(9).width = 20;
    ws.views = [{ state: 'frozen', ySplit: hdr1, xSplit: 0 }];
  }, [projFy, projectedMonthlySummary, projActualMt, projActualRev, projForecastMt, projForecastRev, projGrandMt, projGrandRev, sortedProjectedCustomers, projectedCustomerData, projCustGrandMt, projCustGrandRev]);

  const buildGroupSheet = useCallback((wb: ExcelJS.Workbook) => {
    const ws = wb.addWorksheet('Sales by Customer Group');
    const dateStr = new Date().toLocaleDateString();
    addTitleRows(ws, 'Sales Volume by Customer Group', `Generated ${dateStr} | ${groupSalesData.length} groups | ${formatNum(groupGrandTotalMt)} MT total`);

    const headerRowNum = ws.rowCount + 1;
    ws.addRow(['#', 'Group Code', 'Group Name', 'Members', 'Total (MT)', 'Revenue', 'Invoices', 'Avg $/MT', '% of Total']);
    applyHeaderRow(ws, headerRowNum);
    for (let i = 4; i <= 9; i++) ws.getRow(headerRowNum).getCell(i).alignment = { horizontal: 'right' };

    sortedGroupSales.forEach((row, idx) => {
      const r = ws.addRow([idx + 1, row.groupCode, row.groupName, row.memberCount, row.totalMt, row.totalRevenue, row.invoiceCount, row.avgPrice, row.pctOfTotal / 100]);
      r.getCell(4).numFmt = INT_FMT;
      r.getCell(5).numFmt = NUMBER_FMT;
      r.getCell(6).numFmt = CURRENCY_FMT;
      r.getCell(7).numFmt = INT_FMT;
      r.getCell(8).numFmt = CURRENCY_FMT;
      r.getCell(9).numFmt = PCT_FMT;
      for (let i = 4; i <= 9; i++) r.getCell(i).alignment = { horizontal: 'right' };
      if (idx % 2 === 1) {
        r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
      }
    });

    const totalRowNum = ws.rowCount + 1;
    const totalInvoices = groupSalesData.reduce((s, r) => s + r.invoiceCount, 0);
    const totalMembers = groupSalesData.reduce((s, r) => s + r.memberCount, 0);
    const avgAll = groupGrandTotalMt > 0 ? groupGrandTotalRev / groupGrandTotalMt : 0;
    const r = ws.addRow(['', '', `Total (${groupSalesData.length} groups)`, totalMembers, groupGrandTotalMt, groupGrandTotalRev, totalInvoices, avgAll, 1]);
    r.getCell(4).numFmt = INT_FMT;
    r.getCell(5).numFmt = NUMBER_FMT;
    r.getCell(6).numFmt = CURRENCY_FMT;
    r.getCell(7).numFmt = INT_FMT;
    r.getCell(8).numFmt = CURRENCY_FMT;
    r.getCell(9).numFmt = PCT_FMT;
    for (let i = 4; i <= 9; i++) r.getCell(i).alignment = { horizontal: 'right' };
    applyTotalRow(ws, totalRowNum);

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 30;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 16;
    ws.getColumn(6).width = 18;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 16;
    ws.getColumn(9).width = 14;
    ws.views = [{ state: 'frozen', ySplit: headerRowNum, xSplit: 0 }];
  }, [sortedGroupSales, groupSalesData, groupGrandTotalMt, groupGrandTotalRev]);

  const exportAllReports = useCallback(async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    buildCustomerSheet(wb);
    buildProductSheet(wb);
    buildMonthlySheet(wb);
    buildCombinationsSheet(wb);
    buildProjectedSheet(wb);
    buildGroupSheet(wb);
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_Sales_Reports_${dateStr}.xlsx`);
  }, [buildCustomerSheet, buildProductSheet, buildMonthlySheet, buildCombinationsSheet, buildProjectedSheet, buildGroupSheet]);

  const exportSingleReport = useCallback(async (sheetName: string) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    switch (sheetName) {
      case 'customer': buildCustomerSheet(wb); break;
      case 'product': buildProductSheet(wb); break;
      case 'monthly': buildMonthlySheet(wb); break;
      case 'combinations': buildCombinationsSheet(wb); break;
      case 'projected': buildProjectedSheet(wb); break;
      case 'group': buildGroupSheet(wb); break;
    }
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const names: Record<string, string> = { customer: 'Sales_by_Customer', product: 'Sales_by_Product', monthly: 'Monthly_Trend', combinations: 'Customer_Product_Combos', projected: 'Projected_Annual_Sales', group: 'Sales_by_Customer_Group' };
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_${names[sheetName] || 'Report'}_${dateStr}.xlsx`);
  }, [buildCustomerSheet, buildProductSheet, buildMonthlySheet, buildCombinationsSheet, buildProjectedSheet, buildGroupSheet]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold uppercase tracking-tighter">Reports</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">
              Total Invoiced Volume
            </span>
            <span className="font-mono font-bold text-sm">
              {formatNum(customerGrandTotalMt)} MT
            </span>
          </div>
          <button
            onClick={exportAllReports}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase tracking-widest hover:bg-[#2a2a2a] transition-colors shadow-[2px_2px_0px_0px_rgba(20,20,20,0.3)]"
            title="Export all reports to a single Excel workbook"
          >
            <FileSpreadsheet size={14} />
            Export All to Excel
          </button>
        </div>
      </div>

      {/* ═══════════════ REPORT 1: Sales by Customer ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Users size={14} />
            Sales Volume by Customer
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
              <Search size={12} className="opacity-50" />
              <input
                type="text"
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                placeholder="Search customers..."
                className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-48 placeholder:text-[#E4E3E0]/40"
              />
              {custSearch && <button onClick={() => setCustSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
            </div>
            <button onClick={() => exportSingleReport('customer')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 w-8">#</th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Customer" sortKey="customer" current={custSort} onToggle={toggleSort(setCustSort)} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Total (MT)" sortKey="totalMt" current={custSort} onToggle={toggleSort(setCustSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Revenue" sortKey="totalRevenue" current={custSort} onToggle={toggleSort(setCustSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Invoices" sortKey="orderCount" current={custSort} onToggle={toggleSort(setCustSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Avg $/MT" sortKey="avgPrice" current={custSort} onToggle={toggleSort(setCustSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="% of Total" sortKey="pctOfTotal" current={custSort} onToggle={toggleSort(setCustSort)} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomerSales.map((row, idx) => (
                <tr key={row.customer} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium">{row.customer}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(row.totalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.orderCount}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.avgPrice)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-gray-200 overflow-hidden">
                        <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, row.pctOfTotal)}%` }} />
                      </div>
                      <span className="font-mono w-12 text-right">{row.pctOfTotal.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedCustomerSales.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No invoice data available.</td></tr>
              )}
            </tbody>
            {sortedCustomerSales.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({customerSalesData.length} customers)</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(customerGrandTotalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(customerGrandTotalRev)}</td>
                  <td className="px-4 py-2 text-right font-mono">{customerSalesData.reduce((s, r) => s + r.orderCount, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono">{customerGrandTotalMt > 0 ? formatCurrency(customerGrandTotalRev / customerGrandTotalMt) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">100.0%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ═══════════════ REPORT 2: Sales by Product ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Package size={14} />
            Sales Volume by Product
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
              <Search size={12} className="opacity-50" />
              <input
                type="text"
                value={prodSearch}
                onChange={(e) => setProdSearch(e.target.value)}
                placeholder="Search products..."
                className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-48 placeholder:text-[#E4E3E0]/40"
              />
              {prodSearch && <button onClick={() => setProdSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
            </div>
            <button onClick={() => exportSingleReport('product')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 w-8">#</th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Product" sortKey="product" current={prodSort} onToggle={toggleSort(setProdSort)} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Total (MT)" sortKey="totalMt" current={prodSort} onToggle={toggleSort(setProdSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Revenue" sortKey="totalRevenue" current={prodSort} onToggle={toggleSort(setProdSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Customers" sortKey="customerCount" current={prodSort} onToggle={toggleSort(setProdSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Avg $/MT" sortKey="avgPrice" current={prodSort} onToggle={toggleSort(setProdSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="% of Total" sortKey="pctOfTotal" current={prodSort} onToggle={toggleSort(setProdSort)} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProductSales.map((row, idx) => (
                <tr key={row.product} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium">{row.product}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(row.totalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.customerCount}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.avgPrice)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-gray-200 overflow-hidden">
                        <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, row.pctOfTotal)}%` }} />
                      </div>
                      <span className="font-mono w-12 text-right">{row.pctOfTotal.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedProductSales.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No invoice data available.</td></tr>
              )}
            </tbody>
            {sortedProductSales.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({productSalesData.length} products)</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(productGrandTotalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(productGrandTotalRev)}</td>
                  <td className="px-4 py-2 text-right font-mono">—</td>
                  <td className="px-4 py-2 text-right font-mono">{productGrandTotalMt > 0 ? formatCurrency(productGrandTotalRev / productGrandTotalMt) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">100.0%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ═══════════════ REPORT 3: Monthly Sales Trend ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <TrendingUp size={14} />
            Monthly Sales Trend
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest opacity-60">Year</span>
              <div className="relative">
                <select
                  value={trendYear}
                  onChange={(e) => setTrendYear(e.target.value)}
                  className="appearance-none bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-xs px-3 py-1.5 pr-7 focus:outline-none"
                >
                  <option value="all">All Years</option>
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[#E4E3E0]/50" />
              </div>
            </div>
            <button onClick={() => exportSingleReport('monthly')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>
        <div className="border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          {filteredMonthlyData.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs">No monthly data available.</div>
          ) : (
            <>
              {/* Bar Chart Visualization */}
              <div className="p-4 pb-0">
                <div className="flex items-end gap-1 h-40">
                  {filteredMonthlyData.map((d) => (
                    <div key={d.yearMonth} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="absolute bottom-full mb-1 hidden group-hover:block bg-[#141414] text-[#E4E3E0] text-[10px] px-2 py-1 whitespace-nowrap z-10">
                        {MONTH_NAMES[d.month - 1]} {d.year}: {formatNum(d.totalMt)} MT
                      </div>
                      <div
                        className="w-full bg-[#141414] hover:bg-[#2a2a2a] transition-colors min-h-[2px]"
                        style={{ height: `${(d.totalMt / maxMonthlyMt) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 mt-1">
                  {filteredMonthlyData.map((d) => (
                    <div key={d.yearMonth} className="flex-1 text-center text-[8px] text-gray-400 truncate">
                      {MONTH_NAMES[d.month - 1]}{trendYear === 'all' ? ` '${d.year.slice(2)}` : ''}
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Data Table */}
              <div className="overflow-x-auto mt-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-y border-[#141414]">
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Month</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Volume (MT)</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Revenue</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Invoices</th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Avg $/MT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMonthlyData.map((d) => (
                      <tr key={d.yearMonth} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 font-medium">{MONTH_NAMES[d.month - 1]} {d.year}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatNum(d.totalMt)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(d.totalRevenue)}</td>
                        <td className="px-4 py-2 text-right font-mono">{d.invoiceCount}</td>
                        <td className="px-4 py-2 text-right font-mono">{d.totalMt > 0 ? formatCurrency(d.totalRevenue / d.totalMt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                      <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({filteredMonthlyData.length} months)</td>
                      <td className="px-4 py-2 text-right font-mono">{formatNum(monthlyGrandMt)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatCurrency(monthlyGrandRev)}</td>
                      <td className="px-4 py-2 text-right font-mono">{filteredMonthlyData.reduce((s, d) => s + d.invoiceCount, 0)}</td>
                      <td className="px-4 py-2 text-right font-mono">{monthlyGrandMt > 0 ? formatCurrency(monthlyGrandRev / monthlyGrandMt) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══════════════ REPORT 4: Top Customer-Product Combinations ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <BarChart3 size={14} />
            Top Customer-Product Combinations
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
              <Search size={12} className="opacity-50" />
              <input
                type="text"
                value={topNSearch}
                onChange={(e) => setTopNSearch(e.target.value)}
                placeholder="Search customer or product..."
                className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-56 placeholder:text-[#E4E3E0]/40"
              />
              {topNSearch && <button onClick={() => setTopNSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
            </div>
            <button onClick={() => exportSingleReport('combinations')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 w-8">#</th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Customer" sortKey="customer" current={topNSort} onToggle={toggleSort(setTopNSort)} />
                </th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Product" sortKey="product" current={topNSort} onToggle={toggleSort(setTopNSort)} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Total (MT)" sortKey="totalMt" current={topNSort} onToggle={toggleSort(setTopNSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Revenue" sortKey="totalRevenue" current={topNSort} onToggle={toggleSort(setTopNSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Invoices" sortKey="invoiceCount" current={topNSort} onToggle={toggleSort(setTopNSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Avg $/MT" sortKey="avgPrice" current={topNSort} onToggle={toggleSort(setTopNSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="% of Total" sortKey="pctOfTotal" current={topNSort} onToggle={toggleSort(setTopNSort)} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTopCombinations.map((row, idx) => (
                <tr key={`${row.customer}|${row.product}`} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-2 font-medium">{row.customer}</td>
                  <td className="px-4 py-2">{row.product}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(row.totalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.invoiceCount}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.avgPrice)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-gray-200 overflow-hidden">
                        <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, row.pctOfTotal)}%` }} />
                      </div>
                      <span className="font-mono w-12 text-right">{row.pctOfTotal.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedTopCombinations.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No invoice data available.</td></tr>
              )}
            </tbody>
            {sortedTopCombinations.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                  <td className="px-4 py-2"></td>
                  <td colSpan={2} className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({topCombinations.length} combinations)</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(comboGrandMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(comboGrandRev)}</td>
                  <td className="px-4 py-2 text-right font-mono">{topCombinations.reduce((s, r) => s + r.invoiceCount, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono">{comboGrandMt > 0 ? formatCurrency(comboGrandRev / comboGrandMt) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">100.0%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ═══════════════ REPORT 5: Projected Annual Sales ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Calendar size={14} />
            Projected Annual Sales
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest opacity-60">Fiscal Year</span>
              <div className="relative">
                <select
                  value={projFyId}
                  onChange={(e) => setProjFyId(e.target.value)}
                  className="appearance-none bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-xs px-3 py-1.5 pr-7 focus:outline-none"
                >
                  {fiscalYears.map(fy => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[#E4E3E0]/50" />
              </div>
            </div>
            <button onClick={() => exportSingleReport('projected')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>

        {!projFy || projFy.periods.length === 0 ? (
          <div className="border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] p-8 text-center text-gray-400 text-xs">
            {fiscalYears.length === 0 ? 'No fiscal years configured. Add one in the Finance page.' : 'Selected fiscal year has no periods configured.'}
          </div>
        ) : (
          <div className="border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-0 border-b border-[#141414]">
              <div className="p-4 border-r border-gray-200 bg-green-50">
                <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">YTD Actual</div>
                <div className="font-mono font-bold text-lg">{formatNum(projActualMt)} <span className="text-xs font-normal opacity-60">MT</span></div>
                <div className="font-mono text-sm text-green-700">{formatCurrency(projActualRev)}</div>
              </div>
              <div className="p-4 border-r border-gray-200 bg-amber-50">
                <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Remaining Forecast</div>
                <div className="font-mono font-bold text-lg">{formatNum(projForecastMt)} <span className="text-xs font-normal opacity-60">MT</span></div>
                <div className="font-mono text-sm text-amber-700">{formatCurrency(projForecastRev)}</div>
              </div>
              <div className="p-4 bg-gray-50">
                <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">Projected Annual Total</div>
                <div className="font-mono font-bold text-lg">{formatNum(projGrandMt)} <span className="text-xs font-normal opacity-60">MT</span></div>
                <div className="font-mono text-sm font-bold">{formatCurrency(projGrandRev)}</div>
              </div>
            </div>

            {/* Monthly Breakdown Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-[#141414]">
                    <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Period</th>
                    <th className="text-center px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Source</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Volume (MT)</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Avg $/MT</th>
                    <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">Projected Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {projectedMonthlySummary.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-gray-200 transition-colors ${
                        row.source === 'Actual' ? 'bg-green-50/50 hover:bg-green-50' : 'bg-amber-50/30 hover:bg-amber-50/60'
                      }`}
                    >
                      <td className="px-4 py-2 font-medium">{row.periodName}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest font-bold ${
                          row.source === 'Actual'
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-amber-100 text-amber-800 border border-amber-300'
                        }`}>
                          {row.source}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{formatNum(row.volumeMt)}</td>
                      <td className="px-4 py-2 text-right font-mono">{row.avgPriceMt > 0 ? formatCurrency(row.avgPriceMt) : '—'}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold">{formatCurrency(row.projRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                    <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Projected Total</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right font-mono">{formatNum(projGrandMt)}</td>
                    <td className="px-4 py-2 text-right font-mono">{projGrandMt > 0 ? formatCurrency(projGrandRev / projGrandMt) : '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{formatCurrency(projGrandRev)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Customer Breakdown */}
            <div className="border-t border-[#141414]">
              <div className="bg-[#141414] text-[#E4E3E0] px-4 py-2.5 flex items-center justify-between">
                <h4 className="text-[10px] font-bold uppercase tracking-widest">Customer Breakdown</h4>
                <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1">
                  <Search size={11} className="opacity-50" />
                  <input
                    type="text"
                    value={projSearch}
                    onChange={(e) => setProjSearch(e.target.value)}
                    placeholder="Search customers..."
                    className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-44 placeholder:text-[#E4E3E0]/40"
                  />
                  {projSearch && <button onClick={() => setProjSearch('')} className="opacity-50 hover:opacity-100"><X size={11} /></button>}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-[#141414]">
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 w-8">#</th>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <SortHeader label="Customer" sortKey="customer" current={projSort} onToggle={toggleSort(setProjSort)} />
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Actual YTD (MT)" sortKey="actualMt" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Actual Rev" sortKey="actualRev" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Forecast (MT)" sortKey="forecastMt" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Forecast Rev" sortKey="forecastRev" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Avg $/MT" sortKey="avgPriceMt" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Total (MT)" sortKey="totalMt" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                      <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                        <div className="flex justify-end"><SortHeader label="Projected Rev" sortKey="projRevenue" current={projSort} onToggle={toggleSort(setProjSort)} /></div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProjectedCustomers.map((row, idx) => (
                      <tr key={row.customer} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2 text-gray-400 font-mono">{idx + 1}</td>
                        <td className="px-4 py-2 font-medium">{row.customer}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{formatNum(row.actualMt)}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{formatCurrency(row.actualRev)}</td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">{formatNum(row.forecastMt)}</td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(row.forecastRev)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.avgPriceMt)}</td>
                        <td className="px-4 py-2 text-right font-mono font-bold">{formatNum(row.totalMt)}</td>
                        <td className="px-4 py-2 text-right font-mono font-bold">{formatCurrency(row.projRevenue)}</td>
                      </tr>
                    ))}
                    {sortedProjectedCustomers.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No sales or forecast data available for this fiscal year.</td></tr>
                    )}
                  </tbody>
                  {sortedProjectedCustomers.length > 0 && (
                    <tfoot>
                      <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                        <td className="px-4 py-2"></td>
                        <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({projectedCustomerData.length} customers)</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{formatNum(projectedCustomerData.reduce((s, r) => s + r.actualMt, 0))}</td>
                        <td className="px-4 py-2 text-right font-mono text-green-700">{formatCurrency(projectedCustomerData.reduce((s, r) => s + r.actualRev, 0))}</td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">{formatNum(projectedCustomerData.reduce((s, r) => s + r.forecastMt, 0))}</td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700">{formatCurrency(projectedCustomerData.reduce((s, r) => s + r.forecastRev, 0))}</td>
                        <td className="px-4 py-2 text-right font-mono">{projCustGrandMt > 0 ? formatCurrency(projCustGrandRev / projCustGrandMt) : '—'}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatNum(projCustGrandMt)}</td>
                        <td className="px-4 py-2 text-right font-mono">{formatCurrency(projCustGrandRev)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════ REPORT 6: Sales by Customer Group ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Users size={14} />
            Sales Volume by Customer Group
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
              <Search size={12} className="opacity-50" />
              <input
                type="text"
                value={grpSearch}
                onChange={(e) => setGrpSearch(e.target.value)}
                placeholder="Search groups..."
                className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-48 placeholder:text-[#E4E3E0]/40"
              />
              {grpSearch && <button onClick={() => setGrpSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
            </div>
            <button onClick={() => exportSingleReport('group')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
              <Download size={11} /> Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 w-8">#</th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Group Code" sortKey="groupCode" current={grpSort} onToggle={toggleSort(setGrpSort)} />
                </th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Group Name" sortKey="groupName" current={grpSort} onToggle={toggleSort(setGrpSort)} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Members" sortKey="memberCount" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Total (MT)" sortKey="totalMt" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Revenue" sortKey="totalRevenue" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Invoices" sortKey="invoiceCount" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="Avg $/MT" sortKey="avgPrice" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label="% of Total" sortKey="pctOfTotal" current={grpSort} onToggle={toggleSort(setGrpSort)} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedGroupSales.map((row, idx) => (
                <tr key={row.groupId} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2 text-gray-400 font-mono">{idx + 1}</td>
                  <td className="px-4 py-2 font-mono font-bold">{row.groupCode}</td>
                  <td className="px-4 py-2 font-medium">{row.groupName}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-full">{row.memberCount}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(row.totalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.totalRevenue)}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.invoiceCount}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(row.avgPrice)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-2 bg-gray-200 overflow-hidden">
                        <div className="h-full bg-[#141414]" style={{ width: `${Math.min(100, row.pctOfTotal)}%` }} />
                      </div>
                      <span className="font-mono w-12 text-right">{row.pctOfTotal.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedGroupSales.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No invoice data available.</td></tr>
              )}
            </tbody>
            {sortedGroupSales.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-[#141414]">
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-[10px] uppercase tracking-widest">Total ({groupSalesData.length} groups)</td>
                  <td className="px-4 py-2 text-right font-mono">{groupSalesData.reduce((s, r) => s + r.memberCount, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatNum(groupGrandTotalMt)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatCurrency(groupGrandTotalRev)}</td>
                  <td className="px-4 py-2 text-right font-mono">{groupSalesData.reduce((s, r) => s + r.invoiceCount, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono">{groupGrandTotalMt > 0 ? formatCurrency(groupGrandTotalRev / groupGrandTotalMt) : '—'}</td>
                  <td className="px-4 py-2 text-right font-mono">100.0%</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
