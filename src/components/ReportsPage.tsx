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
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type {
  Invoice,
  Order,
  Customer,
  CustomerForecast,
  FiscalYear,
  Shipment,
} from '../types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReportsPageProps {
  invoices: Invoice[];
  orders: Order[];
  customers: Customer[];
  customerForecasts: CustomerForecast[];
  fiscalYears: FiscalYear[];
  shipments: Shipment[];
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
}: ReportsPageProps) {
  // ── Sort/Search state per report ──────────────────────────────────────────
  const [custSearch, setCustSearch] = useState('');
  const [custSort, setCustSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [prodSearch, setProdSearch] = useState('');
  const [prodSort, setProdSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [trendYear, setTrendYear] = useState<string>('all');
  const [topNSearch, setTopNSearch] = useState('');
  const [topNSort, setTopNSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });

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

  const exportAllReports = useCallback(async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    buildCustomerSheet(wb);
    buildProductSheet(wb);
    buildMonthlySheet(wb);
    buildCombinationsSheet(wb);
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_Sales_Reports_${dateStr}.xlsx`);
  }, [buildCustomerSheet, buildProductSheet, buildMonthlySheet, buildCombinationsSheet]);

  const exportSingleReport = useCallback(async (sheetName: string) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    switch (sheetName) {
      case 'customer': buildCustomerSheet(wb); break;
      case 'product': buildProductSheet(wb); break;
      case 'monthly': buildMonthlySheet(wb); break;
      case 'combinations': buildCombinationsSheet(wb); break;
    }
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const names: Record<string, string> = { customer: 'Sales_by_Customer', product: 'Sales_by_Product', monthly: 'Monthly_Trend', combinations: 'Customer_Product_Combos' };
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_${names[sheetName] || 'Report'}_${dateStr}.xlsx`);
  }, [buildCustomerSheet, buildProductSheet, buildMonthlySheet, buildCombinationsSheet]);

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
    </div>
  );
}
