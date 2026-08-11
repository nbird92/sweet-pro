import React, { useState, useMemo, useCallback } from 'react';
import {
  Search,
  ArrowUpDown,
  X,
  Users,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Calendar,
  Clock,
  Mail,
} from 'lucide-react';
// Type-only: ExcelJS is dynamic-imported at each export handler below so it stays
// out of the main bundle (all ExcelJS.* uses here are erased type positions).
import type ExcelJS from 'exceljs';
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
  SKU,
  QAProduct,
  SugarType,
  ProductGroup,
  NamingFormula,
  Contract,
  DemurrageInvoice,
} from '../types';
import { resolveShortForm } from '../utils/namingFormulaResolver';
import { computeVolumeTaken } from '../utils/contractMatch';
import { sendEmail } from '../utils/sendEmail';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ReportsPageProps {
  invoices: Invoice[];
  orders: Order[];
  contracts: Contract[];
  customers: Customer[];
  customerForecasts: CustomerForecast[];
  fiscalYears: FiscalYear[];
  shipments: Shipment[];
  customerGroups: CustomerGroup[];
  skus: SKU[];
  qaProducts: QAProduct[];
  sugarTypes: SugarType[];
  productGroups: ProductGroup[];
  namingFormulas: NamingFormula[];
  demurrageInvoices: DemurrageInvoice[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNum(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReportsPage({
  invoices,
  orders,
  contracts,
  customers,
  customerForecasts,
  fiscalYears,
  shipments,
  customerGroups,
  skus,
  qaProducts,
  sugarTypes,
  productGroups,
  namingFormulas,
  demurrageInvoices,
}: ReportsPageProps) {
  // Resolve a free-text invoice product name to a SKU/QA pair from the
  // Products catalog. Tries exact match (case-insensitive), then a fuzzy
  // keyword match. Returns null when no current catalog entry matches.
  const resolveToCatalog = useCallback((rawProduct: string | undefined): { sku: SKU | null; qa: QAProduct | null } | null => {
    if (!rawProduct) return null;
    const trimmed = rawProduct.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();

    // 1. Exact SKU name match
    let sku = skus.find(s => s.name === trimmed) || null;
    let qa = sku
      ? qaProducts.find(q => q.skuId === sku!.id) || null
      : qaProducts.find(q => q.skuName === trimmed) || null;
    if (qa && !sku) sku = skus.find(s => s.id === qa.skuId) || null;
    if (sku || qa) return { sku, qa };

    // 2. Case-insensitive / trimmed match
    sku = skus.find(s => s.name?.trim().toLowerCase() === lower) || null;
    if (!sku) {
      qa = qaProducts.find(q => q.skuName?.trim().toLowerCase() === lower) || null;
      if (qa) sku = skus.find(s => s.id === qa!.skuId) || null;
    } else {
      qa = qaProducts.find(q => q.skuId === sku!.id) || null;
    }
    if (sku || qa) return { sku, qa };

    // 3. Fuzzy keyword match — detect sugar type, group, color, weight,
    //    category and score every SKU.
    let detectedSugar: string | undefined;
    if (lower.includes('molasses')) detectedSugar = 'Molasses';
    else if (lower.includes('granulated') || lower.includes('fine granulated')) detectedSugar = 'Granulated';
    else if (lower.includes('icing') || lower.includes('powdered')) detectedSugar = 'Icing';
    else if (lower.includes('brown')) detectedSugar = 'Brown';
    else if (lower.includes('yellow')) detectedSugar = 'Yellow';
    else if (lower.includes('liquid')) detectedSugar = 'Liquid';
    if (!detectedSugar) {
      for (const st of sugarTypes) {
        if (!st.abbreviation) continue;
        // Escape first — abbreviation is a free-text user field and could contain
        // regex metacharacters, which would throw on new RegExp.
        const esc = st.abbreviation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match BOTH the spaced token ("LC 60" -> \bLC\b) and the GLUED shortform
        // code ("LC60"). \bLC\b does NOT match "LC60" — C and 6 are both word
        // characters, so there is no boundary between them — which meant every
        // liquid shortform failed to resolve and its invoice was dropped entirely.
        if (new RegExp(`\\b${esc}(?:\\b|\\d)`, 'i').test(trimmed)) {
          detectedSugar = st.name;
          break;
        }
      }
    }

    let detectedGroup: string | undefined;
    if (lower.includes('bulk')) detectedGroup = 'Bulk';
    else if (lower.includes('tote')) detectedGroup = 'Tote';
    else if (lower.includes('bag')) detectedGroup = 'Bagged';
    else if (lower.includes('liquid')) detectedGroup = 'Liquid';

    const detectedCategory: 'Conventional' | 'Organic' = lower.includes('organic') ? 'Organic' : 'Conventional';
    const trailingColor = trimmed.match(/(\d{2,3})\s*$/);
    const anyColor = trimmed.match(/\b(\d{2,3})\b/);
    const detectedColor: number | undefined = trailingColor
      ? parseInt(trailingColor[1])
      : (anyColor ? parseInt(anyColor[1]) : undefined);
    const weightMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*kg\b/i);
    const detectedWeight: number | undefined = weightMatch ? parseFloat(weightMatch[1]) : undefined;

    let best: SKU | null = null;
    let bestScore = 0;
    for (const s of skus) {
      const q = qaProducts.find(p => p.skuId === s.id);
      const sugarT = q?.sugarType || s.sugarType;
      const groupT = q?.productGroup || s.productGroup;
      const catT = q?.category || s.category;
      const colorT = q?.maxColor ?? s.maxColor;
      const weightT = q?.netWeightKg ?? s.netWeightKg ?? s.netWeight;
      let score = 0;
      if (detectedSugar && sugarT === detectedSugar) score += 5;
      if (detectedGroup && groupT === detectedGroup) score += 4;
      if (catT === detectedCategory) score += 1;
      if (detectedColor !== undefined && colorT === detectedColor) score += 3;
      if (detectedWeight !== undefined && weightT === detectedWeight) score += 3;
      const skuLower = (s.name || '').trim().toLowerCase();
      if (skuLower && (lower.includes(skuLower) || skuLower.includes(lower))) score += 4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best && bestScore >= 5) {
      return { sku: best, qa: qaProducts.find(p => p.skuId === best!.id) || null };
    }
    return null;
  }, [skus, qaProducts, sugarTypes]);

  // Resolve any free-text invoice customer string to the CURRENT customer
  // record's name. Tolerant of case / whitespace / ITAS variants. Falls back
  // to the original string when no catalog customer can be matched.
  const resolveCustomerName = useCallback((rawCustomer: string | undefined): string => {
    if (!rawCustomer) return '';
    const normalize = (s: string | undefined | null) =>
      (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const target = normalize(rawCustomer);
    if (!target) return rawCustomer;
    // 1. Exact match
    let match = customers.find(c => c.name === rawCustomer);
    if (match) return match.name;
    // 2. Normalized name / itasCustomerName / customerNumber / id match
    match = customers.find(c =>
      normalize(c.name) === target
      || normalize(c.itasCustomerName) === target
      || normalize(c.customerNumber) === target
      || normalize(c.id) === target
    );
    if (match) return match.name;
    // 3. Substring overlap with a current customer name
    match = customers.find(c => {
      const n = normalize(c.name);
      return n && (target.includes(n) || n.includes(target));
    });
    if (match) return match.name;
    return rawCustomer;
  }, [customers]);

  // Resolve any free-text invoice product string to the CURRENT SKU's name.
  // Returns null when the product no longer exists in the catalog.
  const resolveProductName = useCallback((rawProduct: string | undefined): string | null => {
    const match = resolveToCatalog(rawProduct);
    if (!match || (!match.sku && !match.qa)) return null;
    return match.sku?.name || match.qa?.skuName || null;
  }, [resolveToCatalog]);

  // Resolve any free-text product name to the SKU's shortform. Returns null
  // when the product is no longer in the catalog so the report can skip it.
  const toShortform = useCallback((rawProduct: string | undefined): string | null => {
    const match = resolveToCatalog(rawProduct);
    if (!match || (!match.sku && !match.qa)) return null;
    const { sku, qa } = match;
    const product = {
      productFormat: qa?.productFormat || sku?.productFormat,
      productGroup: qa?.productGroup || sku?.productGroup,
      category: qa?.category || sku?.category,
      sugarType: qa?.sugarType || sku?.sugarType,
      location: qa?.location || sku?.location,
      netWeightKg: qa?.netWeightKg ?? sku?.netWeightKg ?? sku?.netWeight,
      grossWeightKg: qa?.grossWeightKg ?? sku?.grossWeightKg,
      maxColor: qa?.maxColor ?? sku?.maxColor,
    };
    const ruleResult = resolveShortForm(namingFormulas, product, { sugarTypes, productGroups });
    if (ruleResult && ruleResult.trim()) return ruleResult.trim();
    // Legacy fallback — fall back to the SKU's name if we can't render a shortform
    if (product.sugarType === 'Molasses') return 'MOL';
    const st = sugarTypes.find(t => t.name === product.sugarType);
    if (!st || !product.category || product.maxColor === undefined) {
      return sku?.name || qa?.skuName || null;
    }
    const co = product.category === 'Conventional' ? 'C' : 'B';
    if (product.productGroup === 'Bulk') return `${st.abbreviation}${co}${product.maxColor}`;
    const wt = product.netWeightKg ? `${product.netWeightKg}kg ` : '';
    return `${wt}${st.abbreviation}${co}${product.maxColor}`;
  }, [resolveToCatalog, sugarTypes, productGroups, namingFormulas]);
  // ── Sort/Search state per report ──────────────────────────────────────────
  const [trendYear, setTrendYear] = useState<string>('all');
  // Demurrage report: bucket carrier costs by ISO week or calendar month.
  const [demGranularity, setDemGranularity] = useState<'week' | 'month'>('month');
  const [topNSearch, setTopNSearch] = useState('');
  const [topNSort, setTopNSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  const [projFyId, setProjFyId] = useState<string>(fiscalYears.length > 0 ? fiscalYears[0].id : '');
  const [projSearch, setProjSearch] = useState('');
  const [projSort, setProjSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'projRevenue', dir: 'desc' });
  const [grpSearch, setGrpSearch] = useState('');
  const [grpSort, setGrpSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'totalMt', dir: 'desc' });
  // Customer report — dropdown to focus a single customer ('' = all).
  const [reportCustomerId, setReportCustomerId] = useState<string>('');
  // "Send to Customer" popout for the customer report.
  const [sendReportOpen, setSendReportOpen] = useState(false);
  const [sendReportTo, setSendReportTo] = useState('');
  const [sendReportSending, setSendReportSending] = useState(false);
  const [sendReportResult, setSendReportResult] = useState<{ ok: boolean; message: string } | null>(null);

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
  // REPORT 1: Sales by Customer Group (with expandable customer detail)
  // ═══════════════════════════════════════════════════════════════════════════
  // First aggregate invoices by customer (amalgamating ship-to and other variants)
  const customerSalesData = useMemo(() => {
    // Bucket by the CURRENT customer name resolved from the catalog so the
    // report reflects renames / ITAS name variants instead of the original
    // string stored at invoice time.
    const map = new Map<string, { customer: string; totalMt: number; totalRevenue: number; orderCount: number; avgPrice: number }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const key = resolveCustomerName(inv.customer);
      const existing = map.get(key);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.orderCount += 1;
      } else {
        map.set(key, {
          customer: key,
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
  }, [invoices, resolveCustomerName]);

  // Now roll customer totals up into customer groups
  interface CustomerGroupRow {
    groupKey: string;
    groupName: string;
    totalMt: number;
    totalRevenue: number;
    orderCount: number;
    avgPrice: number;
    pctOfTotal: number;
    customers: Array<{ customer: string; totalMt: number; totalRevenue: number; orderCount: number; avgPrice: number; pctOfGroup: number }>;
  }

  const customerGroupSalesData = useMemo<CustomerGroupRow[]>(() => {
    // Build a case-insensitive name -> groupId lookup so invoice
    // customer strings that differ slightly in case / whitespace still match
    // their underlying customer record's group. Also map by customer number
    // and id as fallbacks.
    const normalize = (s: string | undefined | null) =>
      (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const custLookupToGroupId = new Map<string, string>();
    for (const c of customers) {
      if (!c.customerGroupId) continue;
      if (c.name) custLookupToGroupId.set(`n:${normalize(c.name)}`, c.customerGroupId);
      if (c.itasCustomerName) custLookupToGroupId.set(`n:${normalize(c.itasCustomerName)}`, c.customerGroupId);
      if (c.customerNumber) custLookupToGroupId.set(`c:${normalize(c.customerNumber)}`, c.customerGroupId);
      if (c.id) custLookupToGroupId.set(`i:${normalize(c.id)}`, c.customerGroupId);
    }
    const groupById = new Map(customerGroups.map(g => [g.id, g] as const));

    const findGroupForInvoiceCustomer = (invoiceCustomer: string): string | null => {
      const key = `n:${normalize(invoiceCustomer)}`;
      const direct = custLookupToGroupId.get(key);
      if (direct) return direct;
      // Try resolving by customer number or id if the invoice ever stored those
      const byCust = custLookupToGroupId.get(`c:${normalize(invoiceCustomer)}`);
      if (byCust) return byCust;
      const byId = custLookupToGroupId.get(`i:${normalize(invoiceCustomer)}`);
      if (byId) return byId;
      // Last resort: substring overlap with any customer name
      const inv = normalize(invoiceCustomer);
      for (const c of customers) {
        if (!c.customerGroupId) continue;
        const n = normalize(c.name);
        if (n && (inv.includes(n) || n.includes(inv))) return c.customerGroupId;
      }
      return null;
    };

    // Bucket customers by group
    const groups = new Map<string, CustomerGroupRow>();
    for (const cs of customerSalesData) {
      const gid = findGroupForInvoiceCustomer(cs.customer) || '__UNGROUPED__';
      const gname = gid === '__UNGROUPED__' ? 'Ungrouped' : (groupById.get(gid)?.name || 'Ungrouped');
      let row = groups.get(gid);
      if (!row) {
        row = {
          groupKey: gid,
          groupName: gname,
          totalMt: 0,
          totalRevenue: 0,
          orderCount: 0,
          avgPrice: 0,
          pctOfTotal: 0,
          customers: [],
        };
        groups.set(gid, row);
      }
      row.totalMt += cs.totalMt;
      row.totalRevenue += cs.totalRevenue;
      row.orderCount += cs.orderCount;
      row.customers.push({
        customer: cs.customer,
        totalMt: cs.totalMt,
        totalRevenue: cs.totalRevenue,
        orderCount: cs.orderCount,
        avgPrice: cs.avgPrice,
        pctOfGroup: 0,
      });
    }
    const rows = Array.from(groups.values());
    const grandTotal = rows.reduce((s, r) => s + r.totalMt, 0);
    for (const r of rows) {
      r.avgPrice = r.totalMt > 0 ? r.totalRevenue / r.totalMt : 0;
      r.pctOfTotal = grandTotal > 0 ? (r.totalMt / grandTotal) * 100 : 0;
      for (const cust of r.customers) {
        cust.pctOfGroup = r.totalMt > 0 ? (cust.totalMt / r.totalMt) * 100 : 0;
      }
      r.customers.sort((a, b) => b.totalMt - a.totalMt);
    }
    return rows;
  }, [customerSalesData, customers, customerGroups]);

  // Grand total invoiced volume — still computed to feed the page-header
  // "Total Invoiced Volume" figure (the customer-group breakdown table itself
  // has been removed from the page).
  const customerGrandTotalMt = useMemo(() => customerGroupSalesData.reduce((s, r) => s + r.totalMt, 0), [customerGroupSalesData]);

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
    // Bucket by CURRENT customer name + CURRENT product name. Invoices
    // whose product no longer matches the catalog are skipped so historical
    // / discontinued products don't appear in this ranking.
    const map = new Map<string, { customer: string; product: string; totalMt: number; totalRevenue: number; invoiceCount: number }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.product) continue;
      const cust = resolveCustomerName(inv.customer);
      // Resolve to the catalog when possible, but never drop an unresolvable
      // product — that silently emptied the ranking.
      const prod = resolveProductName(inv.product) || inv.product.trim();
      if (!prod) continue;
      const key = `${cust}|||${prod}`;
      // qty is no longer a precondition, so coerce it — a missing qty must add 0,
      // not NaN (which would poison the total and the whole column).
      const qty = typeof inv.qty === 'number' && Number.isFinite(inv.qty) ? inv.qty : 0;
      const existing = map.get(key);
      if (existing) {
        existing.totalMt += qty;
        existing.totalRevenue += inv.amount || 0;
        existing.invoiceCount += 1;
      } else {
        map.set(key, {
          customer: cust,
          product: prod,
          totalMt: qty,
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
  }, [invoices, resolveCustomerName, resolveProductName]);

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

  // Compute avg $/MT per customer (CURRENT name) from all historical invoices
  const customerAvgPrice = useMemo(() => {
    const map = new Map<string, { totalRev: number; totalMt: number }>();
    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const key = resolveCustomerName(inv.customer);
      const e = map.get(key);
      if (e) { e.totalRev += inv.amount || 0; e.totalMt += inv.qty; }
      else map.set(key, { totalRev: inv.amount || 0, totalMt: inv.qty });
    }
    const result = new Map<string, number>();
    for (const [name, v] of map) {
      result.set(name, v.totalMt > 0 ? v.totalRev / v.totalMt : 0);
    }
    return result;
  }, [invoices, resolveCustomerName]);

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

    // Actuals per CURRENT customer name: { mt, rev }
    const custActuals = new Map<string, { mt: number; rev: number }>();
    for (const inv of invoices) {
      if (!inv.date || !inv.qty || !inv.customer) continue;
      if (inv.date < projFy.startDate || inv.date > projFy.endDate) continue;
      const pIdx = periodIndexForDate(inv.date, projFy.periods);
      if (pIdx < 0 || pIdx >= 12) continue;
      if (!isPeriodPast(projFy.periods[pIdx])) continue; // only count completed periods
      const key = resolveCustomerName(inv.customer);
      const e = custActuals.get(key);
      if (e) { e.mt += inv.qty; e.rev += inv.amount || 0; }
      else custActuals.set(key, { mt: inv.qty, rev: inv.amount || 0 });
    }

    // Forecast per CURRENT customer name (future periods only)
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
        const key = resolveCustomerName(cf.customerName);
        custForecast.set(key, (custForecast.get(key) ?? 0) + futureMt);
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
  }, [projFy, invoices, customerForecasts, periodIndexForDate, isPeriodPast, customerAvgPrice, globalAvgPrice, resolveCustomerName]);

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
    // Build a CURRENT-name -> customerGroupId lookup. We also support
    // resolving the invoice customer string via the same tolerant lookup
    // used elsewhere.
    const currentNameToGroupId = new Map<string, string | undefined>();
    for (const c of customers) {
      if (c.name) currentNameToGroupId.set(c.name, c.customerGroupId);
    }

    // Aggregate invoices by group
    const map = new Map<string, { groupId: string; groupCode: string; groupName: string; totalMt: number; totalRevenue: number; invoiceCount: number; customerNames: Set<string> }>();

    for (const inv of invoices) {
      if (!inv.customer || !inv.qty) continue;
      const currentCustomerName = resolveCustomerName(inv.customer);
      const groupId = currentNameToGroupId.get(currentCustomerName);
      if (!groupId) continue; // skip ungrouped customers
      const grp = customerGroups.find(g => g.id === groupId);
      if (!grp) continue; // skip if group no longer exists
      const key = groupId;

      const existing = map.get(key);
      if (existing) {
        existing.totalMt += inv.qty;
        existing.totalRevenue += inv.amount || 0;
        existing.invoiceCount += 1;
        existing.customerNames.add(currentCustomerName);
      } else {
        map.set(key, {
          groupId,
          groupCode: grp.groupCode,
          groupName: grp.name,
          totalMt: inv.qty,
          totalRevenue: inv.amount || 0,
          invoiceCount: 1,
          customerNames: new Set([currentCustomerName]),
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
  }, [invoices, customers, customerGroups, resolveCustomerName]);

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
      const currency = (inv.currency || '').trim().toUpperCase() || 'CAD';
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

  const exportAllReports = useCallback(async () => {
    const ExcelJSRuntime = (await import('exceljs')).default;
    const wb = new ExcelJSRuntime.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    buildProjectedSheet(wb);
    buildDemurrageSheet(wb);
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_Sales_Reports_${dateStr}.xlsx`);
  }, [buildProjectedSheet, buildDemurrageSheet]);

  // Customer sales volume broken out BY MONTH (invoiced MT bucketed on invoice
  // date). Declared here — ahead of the per-customer workbook builders below —
  // because those builders depend on it.
  const customerMonthlySales = useMemo(() => {
    const norm = (s?: string) => (s || '').trim().toLowerCase();
    const invMt = (inv: Invoice) => (inv.lineItems && inv.lineItems.length)
      ? inv.lineItems.reduce((s, li) => s + (li.totalWeight || 0), 0)
      : (inv.qty || 0);
    const monthKeys = new Set<string>();
    const rows = customers.map(cust => {
      const names = new Set([cust.name, cust.itasCustomerName].map(norm).filter(Boolean));
      const nameHit = (raw?: string) => names.has(norm(raw)) || names.has(norm(resolveCustomerName(raw || '')));
      const byMonth: Record<string, number> = {};
      let total = 0;
      invoices.filter(i => nameHit(i.customer)).forEach(i => {
        // total counts ALL matched invoices (matching the main report's Sales
        // Volume); only validly-dated ones are bucketed into a month column.
        const mt = invMt(i);
        total += mt;
        const mk = (i.date || '').slice(0, 7); // YYYY-MM
        if (!/^\d{4}-\d{2}$/.test(mk)) return;
        byMonth[mk] = (byMonth[mk] || 0) + mt;
        monthKeys.add(mk);
      });
      return { id: cust.id, customer: cust.name || '(unnamed)', byMonth, total };
    }).filter(r => r.total > 0);
    return { rows: rows.sort((a, b) => b.total - a.total), months: [...monthKeys].sort() };
  }, [customers, invoices, resolveCustomerName]);

  const monthLabel = (mk: string) => {
    const [y, m] = mk.split('-').map(Number);
    if (!y || !m) return mk;
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
  };

  // ── Customer report: per-customer workbook (all three sections) ──────────
  /** Populate a workbook with the selected customer's report — all three sections
   *  stacked on ONE worksheet, separated by a labelled band and a blank row.
   *  Shared by the Export to Excel button and Send to Customer so the emailed file
   *  is identical to the downloaded one. */
  const buildCustomerReportSheet = useCallback((
    wb: ExcelJS.Workbook,
    row: typeof customerReport[number],
  ) => {
    const dateStr = new Date().toLocaleDateString();
    const ws = wb.addWorksheet('Customer Report');
    const months = customerMonthlySales.months;
    const monthly = customerMonthlySales.rows.find(m => m.id === row.id);

    // Widest section decides the sheet's column widths: contracts needs 6, the
    // monthly matrix needs months + 2.
    const maxCols = Math.max(6, months.length + 2);

    addTitleRows(ws, `Customer Report — ${row.customer}`, `Generated ${dateStr}`);

    /** Dark band naming the section that follows. */
    const sectionBand = (label: string) => {
      const r = ws.addRow([label]);
      r.getCell(1).font = { bold: true, size: 11, color: { argb: 'FFE4E3E0' } };
      for (let i = 1; i <= maxCols; i++) {
        r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } };
      }
      return r;
    };
    const rightAlign = (r: ExcelJS.Row, from: number, to: number, fmt = NUMBER_FMT) => {
      for (let i = from; i <= to; i++) {
        r.getCell(i).numFmt = fmt;
        r.getCell(i).alignment = { horizontal: 'right' };
      }
    };

    // ── Section 1: summary ────────────────────────────────────────────────
    sectionBand('SUMMARY');
    {
      const h = ws.rowCount + 1;
      ws.addRow(['Customer', 'Sales Volume (MT)', 'Qty on Order (MT)', 'Contracts', 'Remaining Contract Balance (MT)']);
      applyHeaderRow(ws, h);
      for (let i = 2; i <= 5; i++) ws.getRow(h).getCell(i).alignment = { horizontal: 'right' };
      const r = ws.addRow([row.customer, row.salesMt, row.onOrderMt, row.contractCount, row.remainingTotal]);
      rightAlign(r, 2, 3);
      r.getCell(4).numFmt = INT_FMT;
      r.getCell(4).alignment = { horizontal: 'right' };
      rightAlign(r, 5, 5);
    }

    ws.addRow([]);

    // ── Section 2: sales volume by month ──────────────────────────────────
    sectionBand('SALES VOLUME BY MONTH (MT)');
    {
      const h = ws.rowCount + 1;
      ws.addRow(['Customer', ...months.map(monthLabel), 'Total']);
      applyHeaderRow(ws, h);
      for (let i = 2; i <= months.length + 2; i++) ws.getRow(h).getCell(i).alignment = { horizontal: 'right' };
      const r = ws.addRow([
        row.customer,
        ...months.map(mk => monthly?.byMonth[mk] ?? 0),
        monthly?.total ?? 0,
      ]);
      rightAlign(r, 2, months.length + 2);
      if (months.length === 0) ws.addRow(['No dated invoices for this customer.']);
    }

    ws.addRow([]);

    // ── Section 3: contracts ──────────────────────────────────────────────
    sectionBand('CONTRACTS');
    {
      const h = ws.rowCount + 1;
      ws.addRow(['Contract #', 'Product', 'Contract Vol (MT)', 'Volume Taken (MT)', 'Remaining Contract Balance (MT)', 'Qty on Order (MT)']);
      applyHeaderRow(ws, h);
      for (let i = 3; i <= 6; i++) ws.getRow(h).getCell(i).alignment = { horizontal: 'right' };
      row.contractRows.forEach((c, idx) => {
        const r = ws.addRow([c.contractNumber, c.product, c.contractVol, c.taken, c.remaining, c.qtyOnOrder]);
        rightAlign(r, 3, 6);
        if (idx % 2 === 1) {
          for (let i = 1; i <= 6; i++) {
            r.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
          }
        }
      });
      if (row.contractRows.length) {
        const totalRowNum = ws.rowCount + 1;
        const t = ws.addRow([
          '', 'Total',
          row.contractRows.reduce((s, c) => s + c.contractVol, 0),
          row.contractRows.reduce((s, c) => s + c.taken, 0),
          row.contractRows.reduce((s, c) => s + c.remaining, 0),
          row.contractRows.reduce((s, c) => s + c.qtyOnOrder, 0),
        ]);
        rightAlign(t, 3, 6);
        applyTotalRow(ws, totalRowNum);
      } else {
        ws.addRow(['No active contracts for this customer.']);
      }
    }

    ws.getColumn(1).width = 38;
    for (let i = 2; i <= maxCols; i++) ws.getColumn(i).width = 22;
  }, [customerMonthlySales]);

  /** The selected customer's report as an .xlsx Blob — one source for both the
   *  download and the email attachment. */
  const buildCustomerReportBlob = useCallback(async (row: typeof customerReport[number]) => {
    const ExcelJSRuntime = (await import('exceljs')).default;
    const wb = new ExcelJSRuntime.Workbook();
    buildCustomerReportSheet(wb, row);
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }, [buildCustomerReportSheet]);

  const customerReportFileName = (row: typeof customerReport[number]) =>
    `SweetPro_CustomerReport_${(row.customer || 'Customer').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  const exportCustomerReport = useCallback(async (row: typeof customerReport[number]) => {
    const blob = await buildCustomerReportBlob(row);
    saveAs(blob, customerReportFileName(row));
  }, [buildCustomerReportBlob]);

  /** The customer's SALES CONTACT email (Customer.salesContactEmail), used to
   *  pre-fill the Send to Customer box. Falls back to the generic contact email.
   *  NOTE: salespersonId is the internal Sucro rep, NOT the customer, so it is
   *  deliberately not used here. */
  const suggestedReportRecipient = useCallback((customerId: string): string => {
    const c = customers.find(x => x.id === customerId);
    return (c?.salesContactEmail || c?.contactEmail || '').trim();
  }, [customers]);

  const openSendReport = useCallback((row: typeof customerReport[number]) => {
    setSendReportTo(suggestedReportRecipient(row.id));
    setSendReportResult(null);
    setSendReportOpen(true);
  }, [suggestedReportRecipient]);

  const handleSendCustomerReport = useCallback(async (row: typeof customerReport[number]) => {
    const recipients = sendReportTo.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length) {
      setSendReportResult({ ok: false, message: 'Enter at least one email address.' });
      return;
    }
    setSendReportSending(true);
    setSendReportResult(null);
    try {
      const blob = await buildCustomerReportBlob(row);
      const res = await sendEmail({
        to: recipients,
        subject: `Customer Report — ${row.customer}`,
        html: `<p>Hello,</p>
<p>Please find attached the current customer report for <strong>${row.customer}</strong>, covering the summary, monthly sales volume and contract balances.</p>
<p>Regards,<br/>Sucro Canada</p>`,
        attachment: blob,
        attachmentFilename: customerReportFileName(row),
      });
      setSendReportResult(res.success
        ? { ok: true, message: `Sent to ${(res.actualTo || recipients).join(', ')}` }
        : { ok: false, message: res.error || 'Send failed.' });
    } catch (e: any) {
      setSendReportResult({ ok: false, message: e?.message || String(e) });
    } finally {
      setSendReportSending(false);
    }
  }, [sendReportTo, buildCustomerReportBlob]);

  const exportSingleReport = useCallback(async (sheetName: string) => {
    const ExcelJSRuntime = (await import('exceljs')).default;
    const wb = new ExcelJSRuntime.Workbook();
    wb.creator = 'Sweet Pro';
    wb.created = new Date();
    switch (sheetName) {
      case 'monthly': buildMonthlySheet(wb); break;
      case 'combinations': buildCombinationsSheet(wb); break;
      case 'projected': buildProjectedSheet(wb); break;
      case 'group': buildGroupSheet(wb); break;
      case 'demurrage': buildDemurrageSheet(wb); break;
    }
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().slice(0, 10);
    const names: Record<string, string> = { monthly: 'Monthly_Trend', combinations: 'Customer_Product_Combos', projected: 'Projected_Annual_Sales', group: 'Sales_by_Customer_Group', demurrage: 'Demurrage_by_Carrier' };
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `SweetPro_${names[sheetName] || 'Report'}_${dateStr}.xlsx`);
  }, [buildMonthlySheet, buildCombinationsSheet, buildProjectedSheet, buildGroupSheet, buildDemurrageSheet]);

  // ─── Render ───────────────────────────────────────────────────────────────

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT: Customer report — sales volume, qty on order, contracts & balances
  // ═══════════════════════════════════════════════════════════════════════════
  const customerReport = useMemo(() => {
    const norm = (s?: string) => (s || '').trim().toLowerCase();
    const invMt = (inv: Invoice) => (inv.lineItems && inv.lineItems.length)
      ? inv.lineItems.reduce((s, li) => s + (li.totalWeight || 0), 0)
      : (inv.qty || 0);
    const ordMt = (o: Order) => (o.lineItems && o.lineItems.length)
      ? o.lineItems.reduce((s, li) => s + (li.totalWeight || 0), 0)
      : 0;
    // "On order" = confirmed demand not yet invoiced (Open / Confirmed).
    const onOrder = (o: Order) => o.status === 'Open' || o.status === 'Confirmed';

    const rows = customers.map(cust => {
      const names = new Set([cust.name, cust.itasCustomerName].map(norm).filter(Boolean));
      const num = norm(cust.customerNumber);
      const nameHit = (raw?: string) => names.has(norm(raw)) || names.has(norm(resolveCustomerName(raw || '')));

      const salesMt = invoices.filter(i => nameHit(i.customer)).reduce((s, i) => s + invMt(i), 0);
      const custOrders = orders.filter(o => onOrder(o) && nameHit(o.customer));
      const onOrderMt = custOrders.reduce((s, o) => s + ordMt(o), 0);

      const custContracts = contracts.filter(ct => ct.active !== false
        && ((num && norm(ct.customerNumber) === num) || names.has(norm(ct.customerName))));
      const contractRows = custContracts.map(ct => {
        const cn = norm(ct.contractNumber);
        const qtyOnOrder = cn
          ? orders.filter(o => onOrder(o) && norm(o.contractNumber) === cn).reduce((s, o) => s + ordMt(o), 0)
          : 0;
        const contractVol = ct.contractVolume || 0;
        // Volume Taken must MATCH the Contracts table, which deliberately ignores
        // the persisted Contract.volumeTaken (it drifts when invoices are added or
        // removed without touching the contract row) and recomputes from invoices.
        // Shared implementation so the two can't diverge again.
        const taken = computeVolumeTaken(ct.contractNumber, invoices);
        // Outstanding follows the same rule as the Contracts table: always
        // Contract Volume − Volume Taken, never the persisted volumeOutstanding.
        const remaining = contractVol - taken;
        return { contractNumber: ct.contractNumber || '—', product: ct.skuName || '—', contractVol, taken, remaining, qtyOnOrder };
      }).sort((a, b) => b.remaining - a.remaining);
      const remainingTotal = contractRows.reduce((s, c) => s + c.remaining, 0);

      return { id: cust.id, customer: cust.name || '(unnamed)', salesMt, onOrderMt, contractCount: custContracts.length, remainingTotal, contractRows };
    }).filter(r => r.salesMt > 0 || r.onOrderMt > 0 || r.contractCount > 0);

    return rows.sort((a, b) => b.salesMt - a.salesMt);
  }, [customers, invoices, orders, contracts, resolveCustomerName]);

  const selectedCustomerRow = reportCustomerId ? customerReport.find(r => r.id === reportCustomerId) : null;
  const customerReportRows = selectedCustomerRow ? [selectedCustomerRow] : customerReport;

  // Customer sales volume broken out BY MONTH (invoiced MT bucketed on invoice
  // date). Columns are every YYYY-MM present in the data, ascending; each row is
  // a customer with a per-month map + total. Reuses the same customer name-match
  // as the Customer Report so the totals line up.
  const monthlySalesRows = selectedCustomerRow
    ? customerMonthlySales.rows.filter(r => r.id === reportCustomerId)
    : customerMonthlySales.rows;

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

      {/* ═══════════════ REPORT: Customer Report ═══════════════ */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Users size={14} />
            Customer Report
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest opacity-60">Customer</span>
            <select
              value={reportCustomerId}
              onChange={(e) => setReportCustomerId(e.target.value)}
              className="bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-xs px-3 py-1.5 outline-none"
            >
              <option value="">All Customers</option>
              {[...customerReport].sort((a, b) => a.customer.localeCompare(b.customer)).map(r => (
                <option key={r.id} value={r.id}>{r.customer}</option>
              ))}
            </select>
            {/* Per-customer actions — only meaningful once a single customer is
                picked, since both act on that one customer's three sections. */}
            {selectedCustomerRow && (
              <>
                <button
                  onClick={() => exportCustomerReport(selectedCustomerRow)}
                  title={`Export ${selectedCustomerRow.customer}'s report (all three sections) to Excel`}
                  className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors"
                >
                  <FileSpreadsheet size={12} /> Export to Excel
                </button>
                <button
                  onClick={() => openSendReport(selectedCustomerRow)}
                  title={`Email ${selectedCustomerRow.customer}'s report`}
                  className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors"
                >
                  <Mail size={12} /> Send to Customer
                </button>
              </>
            )}
          </div>
        </div>

        {/* Send to Customer popout */}
        {sendReportOpen && selectedCustomerRow && (
          <div className="fixed inset-0 z-[300] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
            <div
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Send Customer Report</h3>
                <button onClick={() => setSendReportOpen(false)} className="p-1 hover:bg-white/20 transition-all"><X size={16} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="text-xs">
                  Sending the report for <strong>{selectedCustomerRow.customer}</strong> as an Excel
                  attachment with all three sections (summary, monthly sales, contracts).
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">
                    To — separate multiple addresses with a comma
                  </label>
                  <input
                    type="text"
                    value={sendReportTo}
                    onChange={(e) => setSendReportTo(e.target.value)}
                    placeholder="name@customer.com"
                    className="w-full bg-[#F5F5F5] border border-[#141414] px-3 py-2 text-sm outline-none focus:bg-white"
                  />
                  {suggestedReportRecipient(selectedCustomerRow.id) ? (
                    <div className="text-[10px] opacity-60">
                      Suggested from the customer card&apos;s Sales Contact:{' '}
                      <button
                        onClick={() => setSendReportTo(suggestedReportRecipient(selectedCustomerRow.id))}
                        className="underline decoration-dotted hover:opacity-100"
                      >
                        {suggestedReportRecipient(selectedCustomerRow.id)}
                      </button>
                    </div>
                  ) : (
                    <div className="text-[10px] opacity-60">
                      No Sales Contact email on this customer&apos;s card — enter one manually.
                    </div>
                  )}
                </div>
                {sendReportResult && (
                  <div className={`text-xs border-l-2 pl-3 py-1 ${sendReportResult.ok ? 'border-emerald-600 text-emerald-700' : 'border-red-500 text-red-700'}`}>
                    {sendReportResult.message}
                  </div>
                )}
              </div>
              <div className="px-4 py-3 border-t border-[#141414]/10 bg-[#F5F5F5] flex justify-end gap-2">
                <button
                  onClick={() => setSendReportOpen(false)}
                  className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-white transition-all"
                >
                  Close
                </button>
                <button
                  onClick={() => handleSendCustomerReport(selectedCustomerRow)}
                  disabled={sendReportSending || !sendReportTo.trim()}
                  className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-40"
                >
                  <Mail size={14} /> {sendReportSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="border border-[#141414] border-t-0 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                <th className="p-3">Customer</th>
                <th className="p-3 text-right">Sales Volume (MT)</th>
                <th className="p-3 text-right">Qty on Order (MT)</th>
                <th className="p-3 text-right">Contracts</th>
                <th className="p-3 text-right">Remaining Contract Balance (MT)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {customerReportRows.map(r => (
                <tr key={r.id} className="hover:bg-[#F9F9F9]">
                  <td className="p-3 font-bold">{r.customer}</td>
                  <td className="p-3 text-right font-mono">{formatNum(r.salesMt)}</td>
                  <td className="p-3 text-right font-mono">{formatNum(r.onOrderMt)}</td>
                  <td className="p-3 text-right font-mono">{r.contractCount}</td>
                  <td className="p-3 text-right font-mono">{formatNum(r.remainingTotal)}</td>
                </tr>
              ))}
              {customerReportRows.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center opacity-50 italic">No customer activity.</td></tr>
              )}
              {customerReportRows.length > 1 && (
                <tr className="bg-[#141414] text-[#E4E3E0] font-black">
                  <td className="p-3 uppercase tracking-widest">Total</td>
                  <td className="p-3 text-right font-mono">{formatNum(customerReportRows.reduce((s, r) => s + r.salesMt, 0))}</td>
                  <td className="p-3 text-right font-mono">{formatNum(customerReportRows.reduce((s, r) => s + r.onOrderMt, 0))}</td>
                  <td className="p-3 text-right font-mono">{customerReportRows.reduce((s, r) => s + r.contractCount, 0)}</td>
                  <td className="p-3 text-right font-mono">{formatNum(customerReportRows.reduce((s, r) => s + r.remainingTotal, 0))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sales volume BY MONTH — customer × month invoiced-MT matrix. Follows
            the selected-customer filter (single row when one is chosen). */}
        <div className="border border-[#141414] border-t-0 overflow-x-auto">
          <div className="bg-[#2a2a2a] text-[#E4E3E0] px-4 py-2 text-[10px] font-bold uppercase tracking-widest">
            Sales Volume by Month (MT)
          </div>
          {customerMonthlySales.months.length === 0 ? (
            <div className="p-6 text-center text-xs opacity-50 italic">No invoiced volume with a valid date.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                  <th className="p-3 sticky left-0 bg-[#F5F5F5]">Customer</th>
                  {customerMonthlySales.months.map(mk => (
                    <th key={mk} className="p-3 text-right whitespace-nowrap">{monthLabel(mk)}</th>
                  ))}
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {monthlySalesRows.map(r => (
                  <tr key={r.id} className="hover:bg-[#F9F9F9]">
                    <td className="p-3 font-bold sticky left-0 bg-white">{r.customer}</td>
                    {customerMonthlySales.months.map(mk => (
                      <td key={mk} className="p-3 text-right font-mono">{r.byMonth[mk] ? formatNum(r.byMonth[mk]) : '—'}</td>
                    ))}
                    <td className="p-3 text-right font-mono font-bold">{formatNum(r.total)}</td>
                  </tr>
                ))}
                {monthlySalesRows.length === 0 && (
                  <tr><td colSpan={customerMonthlySales.months.length + 2} className="p-6 text-center opacity-50 italic">No invoiced volume.</td></tr>
                )}
                {monthlySalesRows.length > 1 && (
                  <tr className="bg-[#141414] text-[#E4E3E0] font-black">
                    <td className="p-3 uppercase tracking-widest sticky left-0 bg-[#141414]">Total</td>
                    {customerMonthlySales.months.map(mk => (
                      <td key={mk} className="p-3 text-right font-mono">{formatNum(monthlySalesRows.reduce((s, r) => s + (r.byMonth[mk] || 0), 0))}</td>
                    ))}
                    <td className="p-3 text-right font-mono">{formatNum(monthlySalesRows.reduce((s, r) => s + r.total, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Contract-level detail — shown when a single customer is selected. */}
        {selectedCustomerRow && (
          <div className="border border-[#141414] border-t-0 overflow-x-auto">
            <div className="bg-[#2a2a2a] text-[#E4E3E0] px-4 py-2 text-[10px] font-bold uppercase tracking-widest">
              Contracts — {selectedCustomerRow.customer}
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                  <th className="p-3">Contract #</th>
                  <th className="p-3">Product</th>
                  <th className="p-3 text-right">Contract Vol (MT)</th>
                  <th className="p-3 text-right">Volume Taken (MT)</th>
                  <th className="p-3 text-right">Remaining Contract Balance (MT)</th>
                  <th className="p-3 text-right">Qty on Order (MT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {selectedCustomerRow.contractRows.map((c, i) => (
                  <tr key={`${c.contractNumber}-${i}`} className="hover:bg-[#F9F9F9]">
                    <td className="p-3 font-mono font-bold">{c.contractNumber}</td>
                    <td className="p-3">{c.product}</td>
                    <td className="p-3 text-right font-mono">{formatNum(c.contractVol)}</td>
                    <td className="p-3 text-right font-mono">{formatNum(c.taken)}</td>
                    <td className="p-3 text-right font-mono">{formatNum(c.remaining)}</td>
                    <td className="p-3 text-right font-mono">{formatNum(c.qtyOnOrder)}</td>
                  </tr>
                ))}
                {selectedCustomerRow.contractRows.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center opacity-50 italic">No active contracts for this customer.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
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

      {/* ═══════════════ REPORT: Demurrage Cost by Carrier ═══════════════ */}
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
            <button onClick={() => exportSingleReport('demurrage')} className="flex items-center gap-1 px-2 py-1.5 bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#3a3a3a] transition-colors" title="Export to Excel">
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

    </div>
  );
}
