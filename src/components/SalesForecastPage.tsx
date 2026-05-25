import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  Edit2,
  Trash2,
  Plus,
  ChevronDown,
  Save,
  Lock,
  Eye,
  BarChart3,
  Search,
  ArrowUpDown,
  TrendingUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageBanner from './PageBanner';
import type { SheetSpec } from '../utils/exportExcel';
import type {
  FiscalYear,
  FiscalPeriod,
  Customer,
  CustomerForecast,
  CustomerForecastLine,
  ForecastEntry,
  QAProduct,
  SKU,
  Location,
  Invoice,
  Order,
  Shipment,
} from '../types';

// ─── Props ──────────────────────────────────────────────────────────────────

interface SalesForecastPageProps {
  fiscalYears: FiscalYear[];
  customers: Customer[];
  customerForecasts: CustomerForecast[];
  onUpdateCustomerForecasts: (forecasts: CustomerForecast[]) => void;
  qaProducts: QAProduct[];
  skus: SKU[];
  locations: Location[];
  invoices: Invoice[];
  orders: Order[];
  shipments: Shipment[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WEEK_LABELS = Array.from({ length: 52 }, (_, i) => `Wk ${i + 1}`);

const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString().slice(0, 10);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Return the fiscal period index (0-11) that contains a given date string (YYYY-MM-DD). */
function periodIndexForDate(dateStr: string, periods: FiscalPeriod[]): number {
  for (const p of periods) {
    if (dateStr >= p.startDate && dateStr <= p.endDate) {
      return p.periodNumber - 1;
    }
  }
  return -1;
}

/** Return the week index (0-51) of a date within a fiscal year. */
function weekIndexForDate(dateStr: string, fyStart: string): number {
  const d = new Date(dateStr);
  const start = new Date(fyStart);
  const diff = d.getTime() - start.getTime();
  const week = Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(51, week));
}

/** Check whether a fiscal period has ended (i.e. its endDate is before today). */
function isPeriodPast(period: FiscalPeriod): boolean {
  return period.endDate < TODAY_ISO;
}

/** Check whether a week (by index) has passed within a fiscal year. */
function isWeekPast(weekIndex: number, fyStart: string): boolean {
  const start = new Date(fyStart);
  const weekEnd = new Date(start.getTime() + (weekIndex + 1) * 7 * 24 * 60 * 60 * 1000);
  return weekEnd < TODAY;
}

/** Determine if budget is locked for an entire fiscal year. */
function isBudgetLockedForYear(fy: FiscalYear): boolean {
  return fy.budgetLockDate <= TODAY_ISO;
}

/** Determine if budget is locked for a specific period (checks quarter-level lock). */
function isBudgetLockedForPeriod(periodIndex: number, fy: FiscalYear): boolean {
  if (isBudgetLockedForYear(fy)) return true;
  // Determine which quarter this period belongs to
  const period = fy.periods[periodIndex];
  if (!period) return false;
  for (const q of fy.quarters) {
    if (period.startDate >= q.startDate && period.endDate <= q.endDate) {
      return q.budgetLockDate <= TODAY_ISO;
    }
  }
  return false;
}

/** Determine if budget is locked for a specific week index. */
function isBudgetLockedForWeek(weekIndex: number, fy: FiscalYear): boolean {
  if (isBudgetLockedForYear(fy)) return true;
  const start = new Date(fy.startDate);
  const weekStart = new Date(start.getTime() + weekIndex * 7 * 24 * 60 * 60 * 1000);
  const weekStartISO = weekStart.toISOString().slice(0, 10);
  for (const q of fy.quarters) {
    if (weekStartISO >= q.startDate && weekStartISO <= q.endDate) {
      return q.budgetLockDate <= TODAY_ISO;
    }
  }
  return false;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function SalesForecastPage({
  fiscalYears,
  customers,
  customerForecasts,
  onUpdateCustomerForecasts,
  qaProducts,
  skus,
  locations,
  invoices,
  orders,
  shipments,
}: SalesForecastPageProps) {
  // ── Top Controls ────────────────────────────────────────────────────────
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string>(
    fiscalYears.length > 0 ? fiscalYears[0].id : ''
  );
  const [forecastType, setForecastType] = useState<'Forecast' | 'Budget'>('Forecast');

  // ── Search & Sort ───────────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerSort, setCustomerSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'asc' });
  const [productSearch, setProductSearch] = useState('');
  const [productSort, setProductSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: '', dir: 'asc' });

  const toggleCustomerSort = (key: string) => {
    setCustomerSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const toggleProductSort = (key: string) => {
    setProductSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  // ── Modals ──────────────────────────────────────────────────────────────
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [productViewModalOpen, setProductViewModalOpen] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<{ productName: string; location: string } | null>(null);
  const [productViewMode, setProductViewMode] = useState<'Monthly' | 'Weekly'>('Monthly');

  // ── Modal state for customer forecast editing ───────────────────────────
  const [modalViewMode, setModalViewMode] = useState<'Monthly' | 'Weekly'>('Monthly');
  const [modalLines, setModalLines] = useState<CustomerForecastLine[]>([]);
  const [addProductDropdownOpen, setAddProductDropdownOpen] = useState(false);
  const [addProductSearch, setAddProductSearch] = useState('');
  const [addProductLocation, setAddProductLocation] = useState('');

  // ── Period aggregation view state ────────────────────────────────────────
  const [periodAggregateMode, setPeriodAggregateMode] = useState<'Customer' | 'Product'>('Customer');
  const [periodViewMode, setPeriodViewMode] = useState<'Monthly' | 'Weekly'>('Monthly');

  const selectedFY = useMemo(
    () => fiscalYears.find((fy) => fy.id === selectedFiscalYearId) ?? null,
    [fiscalYears, selectedFiscalYearId]
  );

  const typeLabel = forecastType === 'Forecast' ? 'Forecast' : 'Budget';

  // ── Build forecasts for all customers (merging existing + empty) ────────
  const mergedForecasts = useMemo(() => {
    if (!selectedFY) return [];
    return customers.map((cust) => {
      const existing = customerForecasts.find(
        (cf) =>
          cf.customerId === cust.id &&
          cf.fiscalYearId === selectedFY.id &&
          cf.type === forecastType
      );
      if (existing) return existing;
      // Create empty placeholder
      return {
        id: generateId('CF'),
        customerId: cust.id,
        customerNumber: cust.customerNumber ?? '',
        customerName: cust.name,
        location: cust.defaultLocation,
        fiscalYearId: selectedFY.id,
        type: forecastType,
        viewMode: 'Monthly' as const,
        lines: [] as CustomerForecastLine[],
        annualForecast: 0,
      } satisfies CustomerForecast;
    });
  }, [customers, customerForecasts, selectedFY, forecastType]);

  // ── Actuals computation ─────────────────────────────────────────────────

  /** Build a map: `${customerName}|${productName}|${periodIndex}` -> actual MT from invoices */
  const actualsMap = useMemo(() => {
    if (!selectedFY) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const inv of invoices) {
      const invDate = inv.date;
      if (!invDate) continue;
      if (invDate < selectedFY.startDate || invDate > selectedFY.endDate) continue;
      const pIdx = periodIndexForDate(invDate, selectedFY.periods);
      if (pIdx < 0) continue;
      const key = `${inv.customer}|${inv.product}|${pIdx}`;
      map.set(key, (map.get(key) ?? 0) + inv.qty);
    }
    return map;
  }, [invoices, selectedFY]);

  /** Same for weekly */
  const weeklyActualsMap = useMemo(() => {
    if (!selectedFY) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const inv of invoices) {
      const invDate = inv.date;
      if (!invDate) continue;
      if (invDate < selectedFY.startDate || invDate > selectedFY.endDate) continue;
      const wIdx = weekIndexForDate(invDate, selectedFY.startDate);
      const key = `${inv.customer}|${inv.product}|${wIdx}`;
      map.set(key, (map.get(key) ?? 0) + inv.qty);
    }
    return map;
  }, [invoices, selectedFY]);

  // ── Product Forecast Table data ─────────────────────────────────────────
  const productForecastRows = useMemo(() => {
    const skuNames = new Set(skus.map(s => s.name));
    const map = new Map<string, { productName: string; location: string; annual: number }>();
    for (const cf of mergedForecasts) {
      for (const line of cf.lines) {
        // Only include products that exist in the SKU catalog
        if (!skuNames.has(line.productName)) continue;
        const key = `${line.productName}|${line.location}`;
        const existing = map.get(key);
        const lineTotal = line.entries.reduce((s, e) => s + e.value, 0);
        if (existing) {
          existing.annual += lineTotal;
        } else {
          map.set(key, { productName: line.productName, location: line.location, annual: lineTotal });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [mergedForecasts, skus]);

  // ── Product view modal data ─────────────────────────────────────────────
  const productViewData = useMemo(() => {
    if (!viewingProduct || !selectedFY) return [] as { customerName: string; values: number[] }[];
    const count = productViewMode === 'Monthly' ? 12 : 52;
    const rows: { customerName: string; values: number[] }[] = [];
    for (const cf of mergedForecasts) {
      for (const line of cf.lines) {
        if (line.productName === viewingProduct.productName && line.location === viewingProduct.location) {
          const values = new Array(count).fill(0) as number[];
          for (const e of line.entries) {
            if (e.periodIndex >= 0 && e.periodIndex < count) {
              values[e.periodIndex] += e.value;
            }
          }
          rows.push({ customerName: cf.customerName, values });
        }
      }
    }
    return rows;
  }, [viewingProduct, mergedForecasts, selectedFY, productViewMode]);

  // ── Period aggregation view data ────────────────────────────────────────
  const periodAggregateData = useMemo(() => {
    if (!selectedFY) return [];
    const count = periodViewMode === 'Monthly' ? 12 : 52;

    if (periodAggregateMode === 'Customer') {
      // Aggregate by customer: sum all their product lines per period
      return mergedForecasts.map(cf => {
        const values = new Array(count).fill(0) as number[];
        for (const line of cf.lines) {
          for (const entry of line.entries) {
            if (entry.periodIndex >= 0 && entry.periodIndex < count) {
              values[entry.periodIndex] += entry.value;
            }
          }
        }
        const total = values.reduce((s, v) => s + v, 0);
        return { name: cf.customerName, values, total };
      });
    } else {
      // Aggregate by product: sum across all customers for each product
      const skuNames = new Set(skus.map(s => s.name));
      const productMap = new Map<string, number[]>();

      for (const sku of skus) {
        if (!productMap.has(sku.name)) {
          productMap.set(sku.name, new Array(count).fill(0) as number[]);
        }
      }

      for (const cf of mergedForecasts) {
        for (const line of cf.lines) {
          if (!skuNames.has(line.productName)) continue;
          const values = productMap.get(line.productName);
          if (!values) continue;
          for (const entry of line.entries) {
            if (entry.periodIndex >= 0 && entry.periodIndex < count) {
              values[entry.periodIndex] += entry.value;
            }
          }
        }
      }

      return Array.from(productMap.entries())
        .map(([name, values]) => ({
          name,
          values,
          total: values.reduce((s, v) => s + v, 0)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [mergedForecasts, periodAggregateMode, periodViewMode, selectedFY, skus]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const openCustomerModal = useCallback(
    (customerId: string) => {
      const cf = mergedForecasts.find((f) => f.customerId === customerId);
      if (!cf) return;
      setEditingCustomerId(customerId);
      setModalViewMode(cf.viewMode || 'Monthly');
      setModalLines(cf.lines.map((l) => ({ ...l, entries: l.entries.map((e) => ({ ...e })) })));
      setCustomerModalOpen(true);
    },
    [mergedForecasts]
  );

  const handleDeleteForecast = useCallback(
    (customerId: string) => {
      if (!confirm(`Delete all ${typeLabel.toLowerCase()} data for this customer?`)) return;
      const updated = customerForecasts.filter(
        (cf) =>
          !(cf.customerId === customerId && cf.fiscalYearId === selectedFiscalYearId && cf.type === forecastType)
      );
      onUpdateCustomerForecasts(updated);
    },
    [customerForecasts, selectedFiscalYearId, forecastType, typeLabel, onUpdateCustomerForecasts]
  );

  const handleSaveCustomerForecast = useCallback(() => {
    if (!editingCustomerId || !selectedFY) return;
    const cust = customers.find((c) => c.id === editingCustomerId);
    if (!cust) return;

    const annualForecast = modalLines.reduce(
      (sum, line) => sum + line.entries.reduce((s, e) => s + e.value, 0),
      0
    );

    const newForecast: CustomerForecast = {
      id: customerForecasts.find(
        (cf) =>
          cf.customerId === editingCustomerId &&
          cf.fiscalYearId === selectedFY.id &&
          cf.type === forecastType
      )?.id ?? generateId('CF'),
      customerId: editingCustomerId,
      customerNumber: cust.customerNumber ?? '',
      customerName: cust.name,
      location: cust.defaultLocation,
      fiscalYearId: selectedFY.id,
      type: forecastType,
      viewMode: modalViewMode,
      lines: modalLines,
      annualForecast,
    };

    // Replace or add
    const idx = customerForecasts.findIndex(
      (cf) =>
        cf.customerId === editingCustomerId &&
        cf.fiscalYearId === selectedFY.id &&
        cf.type === forecastType
    );
    const updated = [...customerForecasts];
    if (idx >= 0) {
      updated[idx] = newForecast;
    } else {
      updated.push(newForecast);
    }
    onUpdateCustomerForecasts(updated);
    setCustomerModalOpen(false);
    setEditingCustomerId(null);
  }, [
    editingCustomerId,
    selectedFY,
    customers,
    customerForecasts,
    forecastType,
    modalViewMode,
    modalLines,
    onUpdateCustomerForecasts,
  ]);

  const handleAddProductLine = useCallback(
    (productName: string, location: string) => {
      const newLine: CustomerForecastLine = {
        id: generateId('CFL'),
        productName,
        location,
        entries: [],
      };
      setModalLines((prev) => [...prev, newLine]);
      setAddProductDropdownOpen(false);
      setAddProductSearch('');
      setAddProductLocation('');
    },
    []
  );

  const handleRemoveProductLine = useCallback((lineId: string) => {
    setModalLines((prev) => prev.filter((l) => l.id !== lineId));
  }, []);

  const handleCellChange = useCallback(
    (lineId: string, periodIndex: number, value: number) => {
      setModalLines((prev) =>
        prev.map((line) => {
          if (line.id !== lineId) return line;
          const existing = line.entries.find((e) => e.periodIndex === periodIndex);
          let newEntries: ForecastEntry[];
          if (existing) {
            newEntries = line.entries.map((e) =>
              e.periodIndex === periodIndex ? { ...e, value } : e
            );
          } else {
            newEntries = [...line.entries, { periodIndex, value }];
          }
          return { ...line, entries: newEntries };
        })
      );
    },
    []
  );

  // ── Auto-populate forecasts from invoices, orders, and shipments ────────

  const handleAutoPopulate = useCallback(() => {
    if (!selectedFY) return;

    // Build a map: customerName -> productName -> total MT from all sources
    const salesMap = new Map<string, Map<string, number>>();
    // Track the distinct months we have data for, to compute a proper average
    const monthsWithData = new Set<string>();

    const addToMap = (customerName: string, productName: string, qty: number, dateStr: string) => {
      if (!customerName || !productName || !qty || !dateStr) return;
      if (!salesMap.has(customerName)) salesMap.set(customerName, new Map());
      const prodMap = salesMap.get(customerName)!;
      prodMap.set(productName, (prodMap.get(productName) ?? 0) + qty);
      monthsWithData.add(dateStr.slice(0, 7)); // YYYY-MM
    };

    // 1. Invoices — most reliable source (actual billed)
    for (const inv of invoices) {
      if (inv.qty && inv.customer && inv.product && inv.date) {
        addToMap(inv.customer, inv.product, inv.qty, inv.date);
      }
    }

    // 2. Orders — completed/confirmed orders with line items
    for (const ord of orders) {
      if (ord.status === 'Cancelled') continue;
      // Skip if already captured via invoices (avoid double-counting)
      // Orders with status Completed likely have invoices already,
      // but include Confirmed/Open orders as pipeline
      for (const li of ord.lineItems) {
        if (li.productName && li.totalWeight && ord.date) {
          addToMap(ord.customer, li.productName, li.totalWeight, ord.date);
        }
      }
    }

    // 3. Shipments — for additional volume data
    for (const s of shipments) {
      if (s.qty && s.customer && s.product && s.date) {
        // Only add if we don't already have heavy invoice/order data for this customer+product
        const custMap = salesMap.get(s.customer);
        const existing = custMap?.get(s.product) ?? 0;
        // Only add shipment data if no existing data from invoices/orders
        if (existing === 0) {
          addToMap(s.customer, s.product, s.qty, s.date);
        }
      }
    }

    // Calculate monthly average: total / number of distinct months with data
    const numMonths = Math.max(1, monthsWithData.size);

    // Build forecast entries for each customer
    const updatedForecasts = [...customerForecasts];

    for (const cust of customers) {
      const prodMap = salesMap.get(cust.name);
      if (!prodMap || prodMap.size === 0) continue;

      // Check if this customer already has a forecast for this FY + type
      const existingIdx = updatedForecasts.findIndex(
        (cf) => cf.customerId === cust.id && cf.fiscalYearId === selectedFY.id && cf.type === forecastType
      );

      const lines: CustomerForecastLine[] = [];
      let annualTotal = 0;

      for (const [productName, totalQty] of prodMap) {
        const monthlyAvg = totalQty / numMonths;
        // Fill all 12 months with the monthly average
        const entries: ForecastEntry[] = [];
        for (let m = 0; m < 12; m++) {
          entries.push({ periodIndex: m, value: Math.round(monthlyAvg * 10) / 10 });
        }
        const lineAnnual = monthlyAvg * 12;
        annualTotal += lineAnnual;

        // Determine location from product data
        const qaProd = qaProducts.find((p) => p.skuName === productName);
        const skuProd = skus.find((s) => s.name === productName);
        const prodLocation = qaProd?.location || skuProd?.location || cust.defaultLocation;

        lines.push({
          id: generateId('CFL'),
          productName,
          location: prodLocation,
          entries,
        });
      }

      const forecast: CustomerForecast = {
        id: existingIdx >= 0 ? updatedForecasts[existingIdx].id : generateId('CF'),
        customerId: cust.id,
        customerNumber: cust.customerNumber ?? '',
        customerName: cust.name,
        location: cust.defaultLocation,
        fiscalYearId: selectedFY.id,
        type: forecastType,
        viewMode: 'Monthly',
        lines,
        annualForecast: Math.round(annualTotal * 10) / 10,
      };

      if (existingIdx >= 0) {
        updatedForecasts[existingIdx] = forecast;
      } else {
        updatedForecasts.push(forecast);
      }
    }

    onUpdateCustomerForecasts(updatedForecasts);
  }, [selectedFY, customers, customerForecasts, forecastType, invoices, orders, shipments, qaProducts, skus, onUpdateCustomerForecasts]);

  // ── Available products for adding ───────────────────────────────────────
  const availableProducts = useMemo(() => {
    const prods: { name: string; location: string }[] = [];
    for (const qp of qaProducts) {
      prods.push({ name: qp.skuName, location: qp.location });
    }
    for (const s of skus) {
      if (!prods.some((p) => p.name === s.name && p.location === s.location)) {
        prods.push({ name: s.name, location: s.location });
      }
    }
    return prods;
  }, [qaProducts, skus]);

  const filteredAvailableProducts = useMemo(() => {
    let filtered = availableProducts;
    if (addProductSearch) {
      const q = addProductSearch.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (addProductLocation) {
      filtered = filtered.filter((p) => p.location === addProductLocation);
    }
    return filtered;
  }, [availableProducts, addProductSearch, addProductLocation]);

  // ── Check budget lock for entire view ───────────────────────────────────
  const isBudgetFullyLocked = forecastType === 'Budget' && selectedFY ? isBudgetLockedForYear(selectedFY) : false;

  // ── Determine if a cell is editable ─────────────────────────────────────
  const isCellEditable = useCallback(
    (periodIndex: number, isWeekly: boolean): boolean => {
      if (!selectedFY) return false;
      // Past periods -> actuals, not editable
      if (isWeekly) {
        if (isWeekPast(periodIndex, selectedFY.startDate)) return false;
      } else {
        const period = selectedFY.periods[periodIndex];
        if (period && isPeriodPast(period)) return false;
      }
      // Budget lock check
      if (forecastType === 'Budget') {
        if (isWeekly) {
          if (isBudgetLockedForWeek(periodIndex, selectedFY)) return false;
        } else {
          if (isBudgetLockedForPeriod(periodIndex, selectedFY)) return false;
        }
      }
      return true;
    },
    [selectedFY, forecastType]
  );

  // ── Get actual or forecast value for a cell ─────────────────────────────
  const getCellValue = useCallback(
    (
      customerName: string,
      productName: string,
      periodIndex: number,
      isWeekly: boolean,
      forecastValue: number
    ): { value: number; isActual: boolean } => {
      if (!selectedFY) return { value: forecastValue, isActual: false };
      const isPast = isWeekly
        ? isWeekPast(periodIndex, selectedFY.startDate)
        : selectedFY.periods[periodIndex]
        ? isPeriodPast(selectedFY.periods[periodIndex])
        : false;

      if (isPast) {
        const map = isWeekly ? weeklyActualsMap : actualsMap;
        const key = `${customerName}|${productName}|${periodIndex}`;
        const actual = map.get(key) ?? 0;
        return { value: actual, isActual: true };
      }
      return { value: forecastValue, isActual: false };
    },
    [selectedFY, actualsMap, weeklyActualsMap]
  );

  // ── Location name lookup ────────────────────────────────────────────────
  const locationName = useCallback(
    (loc: string) => {
      const found = locations.find((l) => l.name === loc || l.id === loc);
      return found?.name ?? loc;
    },
    [locations]
  );

  // ── Annual forecast with actuals incorporated ───────────────────────────
  const getAnnualWithActuals = useCallback(
    (cf: CustomerForecast): number => {
      if (!selectedFY) return cf.annualForecast;
      let total = 0;
      for (const line of cf.lines) {
        const count = cf.viewMode === 'Weekly' ? 52 : 12;
        for (let i = 0; i < count; i++) {
          const entry = line.entries.find((e) => e.periodIndex === i);
          const forecastVal = entry?.value ?? 0;
          const { value } = getCellValue(cf.customerName, line.productName, i, cf.viewMode === 'Weekly', forecastVal);
          total += value;
        }
      }
      return total;
    },
    [selectedFY, getCellValue]
  );

  // ── Sorted & filtered customer forecasts ────────────────────────────────
  const sortedCustomerForecasts = useMemo(() => {
    let list = mergedForecasts;
    // Search filter
    if (customerSearch.trim()) {
      const q = customerSearch.toLowerCase();
      list = list.filter(cf =>
        (cf.customerNumber || '').toLowerCase().includes(q) ||
        cf.customerName.toLowerCase().includes(q) ||
        cf.location.toLowerCase().includes(q)
      );
    }
    // Sort
    if (customerSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (customerSort.key) {
          case 'customerNumber': va = a.customerNumber || ''; vb = b.customerNumber || ''; break;
          case 'customerName': va = a.customerName; vb = b.customerName; break;
          case 'location': va = a.location; vb = b.location; break;
          case 'annual': va = getAnnualWithActuals(a); vb = getAnnualWithActuals(b); break;
        }
        if (typeof va === 'number' && typeof vb === 'number') {
          return customerSort.dir === 'asc' ? va - vb : vb - va;
        }
        const cmp = String(va).localeCompare(String(vb));
        return customerSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [mergedForecasts, customerSearch, customerSort, getAnnualWithActuals]);

  // ── Sorted & filtered product forecasts ────────────────────────────────
  const sortedProductForecasts = useMemo(() => {
    let list = productForecastRows;
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      list = list.filter(r =>
        r.productName.toLowerCase().includes(q) ||
        r.location.toLowerCase().includes(q)
      );
    }
    if (productSort.key) {
      list = [...list].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        switch (productSort.key) {
          case 'productName': va = a.productName; vb = b.productName; break;
          case 'location': va = a.location; vb = b.location; break;
          case 'annual': va = a.annual; vb = b.annual; break;
        }
        if (typeof va === 'number' && typeof vb === 'number') {
          return productSort.dir === 'asc' ? va - vb : vb - va;
        }
        const cmp = String(va).localeCompare(String(vb));
        return productSort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [productForecastRows, productSearch, productSort]);

  // ── Sort indicator helper ──────────────────────────────────────────────
  const SortHeader = ({ label, sortKey, current, onToggle }: { label: string; sortKey: string; current: { key: string; dir: 'asc' | 'desc' }; onToggle: (k: string) => void }) => (
    <button onClick={() => onToggle(sortKey)} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
      <span>{label}</span>
      <ArrowUpDown size={10} className={current.key === sortKey ? 'opacity-100' : 'opacity-30'} />
      {current.key === sortKey && <span className="text-[8px]">{current.dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  // ─── Render ───────────────────────────────────────────────────────────

  if (fiscalYears.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        No fiscal years configured. Please add a fiscal year in settings to use the Sales {typeLabel} page.
      </div>
    );
  }

  const editingCf = editingCustomerId
    ? mergedForecasts.find((f) => f.customerId === editingCustomerId)
    : null;

  const modalColumnCount = modalViewMode === 'Monthly' ? 12 : 52;
  const modalHeaders = modalViewMode === 'Monthly' ? MONTH_NAMES : WEEK_LABELS;

  const forecastExportSheets = (): SheetSpec[] => [
    {
      sheetName: 'Customer Forecasts',
      title: `Customer Forecasts — ${selectedFY?.name || ''} (${forecastType})`,
      subtitle: `Generated ${new Date().toLocaleDateString()} | ${mergedForecasts.length} customers`,
      columns: [
        { header: 'Customer', key: 'customerName' },
        { header: 'View Mode', key: 'viewMode' },
        { header: '# Product Lines', key: 'lineCount', format: 'integer' },
        { header: 'Annual Total (MT)', key: 'annual', format: 'number' },
      ],
      rows: mergedForecasts.map(cf => ({
        customerName: cf.customerName,
        viewMode: cf.viewMode || 'Monthly',
        lineCount: cf.lines.length,
        annual: cf.lines.reduce((s, l) => s + l.entries.reduce((s2, e) => s2 + e.value, 0), 0),
      })),
    },
    {
      sheetName: 'Product Forecasts',
      title: `Product Forecasts — ${selectedFY?.name || ''} (${forecastType})`,
      subtitle: `${productForecastRows.length} product/location combinations`,
      columns: [
        { header: 'Product', key: 'productName' },
        { header: 'Location', key: 'location' },
        { header: 'Annual Total (MT)', key: 'annual', format: 'number' },
      ],
      rows: productForecastRows,
    },
  ];
  return (
    <div>
      <PageBanner
        icon={<TrendingUp size={18} />}
        title="Sales Forecast & Budget"
        count={mergedForecasts.length}
        exportSheets={forecastExportSheets}
        exportFileName="Sales_Forecast"
      />
    <div className="p-6 space-y-6">
      {/* ── Top Controls ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Fiscal Year */}
        <div className="relative">
          <label className="text-[10px] uppercase font-bold tracking-widest opacity-60 block mb-1">
            Fiscal Year
          </label>
          <div className="relative">
            <select
              value={selectedFiscalYearId}
              onChange={(e) => setSelectedFiscalYearId(e.target.value)}
              className="appearance-none w-48 px-3 py-2 pr-8 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
            >
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Type Toggle */}
        <div className="relative">
          <label className="text-[10px] uppercase font-bold tracking-widest opacity-60 block mb-1">
            Type
          </label>
          <div className="relative">
            <select
              value={forecastType}
              onChange={(e) => setForecastType(e.target.value as 'Forecast' | 'Budget')}
              className="appearance-none w-40 px-3 py-2 pr-8 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
            >
              <option value="Forecast">Forecast</option>
              <option value="Budget">Budget</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {isBudgetFullyLocked && (
          <div className="flex items-center gap-1 text-xs text-red-600 mt-5">
            <Lock size={14} />
            <span className="uppercase tracking-widest font-bold">Budget Locked</span>
          </div>
        )}

        {/* Auto-Populate Button */}
        <div className="mt-5 ml-auto">
          <button
            onClick={handleAutoPopulate}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase tracking-widest hover:bg-[#2a2a2a] transition-colors shadow-[2px_2px_0px_0px_rgba(20,20,20,0.3)]"
            title="Auto-populate forecast from current invoices, orders, and shipments using monthly averages × 12"
          >
            <BarChart3 size={14} />
            Auto-Populate {typeLabel}
          </button>
        </div>
      </div>

      {/* ── Customer Forecast Table ───────────────────────────────────────── */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest">
            Customer {typeLabel}
          </h2>
          <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
            <Search size={12} className="opacity-50" />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Search customers..."
              className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-48 placeholder:text-[#E4E3E0]/40"
            />
            {customerSearch && <button onClick={() => setCustomerSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Customer No." sortKey="customerNumber" current={customerSort} onToggle={toggleCustomerSort} />
                </th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Customer Name" sortKey="customerName" current={customerSort} onToggle={toggleCustomerSort} />
                </th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Location" sortKey="location" current={customerSort} onToggle={toggleCustomerSort} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label={`Annual ${typeLabel} (MT)`} sortKey="annual" current={customerSort} onToggle={toggleCustomerSort} /></div>
                </th>
                <th className="text-center px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomerForecasts.map((cf) => {
                const annual = getAnnualWithActuals(cf);
                return (
                  <tr
                    key={cf.customerId}
                    className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => openCustomerModal(cf.customerId)}
                  >
                    <td className="px-4 py-2 font-mono">{cf.customerNumber || '—'}</td>
                    <td className="px-4 py-2 font-medium">{cf.customerName}</td>
                    <td className="px-4 py-2">{locationName(cf.location)}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {annual.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openCustomerModal(cf.customerId);
                          }}
                          className="p-1 hover:bg-gray-200 transition-all"
                          title={`Edit ${typeLabel}`}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteForecast(cf.customerId);
                          }}
                          className="p-1 hover:bg-red-100 text-red-600 transition-all"
                          title={`Delete ${typeLabel}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedCustomerForecasts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No customers found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Product Forecast Table ────────────────────────────────────────── */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest">
            Product {typeLabel}
          </h2>
          <div className="flex items-center gap-2 bg-[#2a2a2a] border border-[#E4E3E0]/20 px-3 py-1.5">
            <Search size={12} className="opacity-50" />
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products..."
              className="bg-transparent text-[#E4E3E0] text-xs focus:outline-none w-48 placeholder:text-[#E4E3E0]/40"
            />
            {productSearch && <button onClick={() => setProductSearch('')} className="opacity-50 hover:opacity-100"><X size={12} /></button>}
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Product Name" sortKey="productName" current={productSort} onToggle={toggleProductSort} />
                </th>
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <SortHeader label="Location" sortKey="location" current={productSort} onToggle={toggleProductSort} />
                </th>
                <th className="text-right px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60">
                  <div className="flex justify-end"><SortHeader label={`Annual ${typeLabel} (MT)`} sortKey="annual" current={productSort} onToggle={toggleProductSort} /></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedProductForecasts.map((row) => (
                <tr
                  key={`${row.productName}|${row.location}`}
                  className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => {
                    setViewingProduct({ productName: row.productName, location: row.location });
                    setProductViewMode('Monthly');
                    setProductViewModalOpen(true);
                  }}
                >
                  <td className="px-4 py-2 font-medium">{row.productName}</td>
                  <td className="px-4 py-2">{locationName(row.location)}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {row.annual.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </td>
                </tr>
              ))}
              {sortedProductForecasts.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-gray-400">
                    No product {typeLabel.toLowerCase()} data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Forecast by Period View ───────────────────────────────────────── */}
      <div>
        <div className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest">
            {typeLabel} by Period
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase font-bold opacity-60">Aggregate by:</label>
              <select
                value={periodAggregateMode}
                onChange={(e) => setPeriodAggregateMode(e.target.value as 'Customer' | 'Product')}
                className="bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-xs px-2 py-1 focus:outline-none"
              >
                <option value="Customer">Customer</option>
                <option value="Product">Product</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase font-bold opacity-60">View:</label>
              <select
                value={periodViewMode}
                onChange={(e) => setPeriodViewMode(e.target.value as 'Monthly' | 'Weekly')}
                className="bg-[#2a2a2a] border border-[#E4E3E0]/20 text-[#E4E3E0] text-xs px-2 py-1 focus:outline-none"
              >
                <option value="Monthly">Monthly</option>
                <option value="Weekly">Weekly</option>
              </select>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto border border-[#141414] border-t-0 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-[#141414]">
                <th className="text-left px-4 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 min-w-[150px]">
                  {periodAggregateMode}
                </th>
                {(periodViewMode === 'Monthly' ? MONTH_NAMES : WEEK_LABELS).map((label, idx) => {
                  const isPast = periodViewMode === 'Monthly'
                    ? selectedFY && idx < selectedFY.periods.length && isPeriodPast(selectedFY.periods[idx])
                    : selectedFY && isWeekPast(idx, selectedFY.startDate);
                  return (
                    <th
                      key={idx}
                      className={`text-right px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 min-w-[70px] ${
                        isPast ? 'bg-gray-100' : ''
                      }`}
                    >
                      {label}
                    </th>
                  );
                })}
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 min-w-[80px]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {periodAggregateData.map((row) => {
                const periodTotals = new Array(periodViewMode === 'Monthly' ? 12 : 52).fill(0) as number[];
                return (
                  <tr key={row.name} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2 font-medium">{row.name}</td>
                    {row.values.map((value, idx) => {
                      const isPast = periodViewMode === 'Monthly'
                        ? selectedFY && idx < selectedFY.periods.length && isPeriodPast(selectedFY.periods[idx])
                        : selectedFY && isWeekPast(idx, selectedFY.startDate);
                      periodTotals[idx] += value;
                      return (
                        <td
                          key={idx}
                          className={`text-right px-3 py-2 font-mono text-[11px] ${
                            isPast ? 'bg-gray-100 text-gray-500' : ''
                          }`}
                        >
                          {value > 0 ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono font-bold text-[11px]">
                      {row.total.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                    </td>
                  </tr>
                );
              })}
              {periodAggregateData.length === 0 && (
                <tr>
                  <td colSpan={periodViewMode === 'Monthly' ? 13 : 53} className="px-4 py-8 text-center text-gray-400">
                    No {periodAggregateMode.toLowerCase()} {typeLabel.toLowerCase()} data yet.
                  </td>
                </tr>
              )}
              {/* Totals row */}
              {periodAggregateData.length > 0 && (
                <tr className="bg-gray-50 border-t-2 border-[#141414] font-bold">
                  <td className="px-4 py-2">Totals</td>
                  {(() => {
                    const totals = new Array(periodViewMode === 'Monthly' ? 12 : 52).fill(0) as number[];
                    for (const row of periodAggregateData) {
                      row.values.forEach((v, i) => {
                        totals[i] += v;
                      });
                    }
                    return totals.map((total, idx) => {
                      const isPast = periodViewMode === 'Monthly'
                        ? selectedFY && idx < selectedFY.periods.length && isPeriodPast(selectedFY.periods[idx])
                        : selectedFY && isWeekPast(idx, selectedFY.startDate);
                      return (
                        <td
                          key={idx}
                          className={`text-right px-3 py-2 font-mono text-[11px] ${
                            isPast ? 'bg-gray-100 text-gray-500' : ''
                          }`}
                        >
                          {total > 0 ? total.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
                        </td>
                      );
                    });
                  })()}
                  <td className="px-3 py-2 text-right font-mono text-[11px]">
                    {periodAggregateData.reduce((s, r) => s + r.total, 0).toLocaleString(undefined, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1
                    })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Customer Forecast Modal ───────────────────────────────────────── */}
      <AnimatePresence>
        {customerModalOpen && editingCf && selectedFY && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-md overflow-y-auto"
            onClick={() => {
              setCustomerModalOpen(false);
              setEditingCustomerId(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] w-full max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center shrink-0">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  {editingCf.lines.length > 0 ? 'Edit' : 'Add'} Customer {typeLabel} &mdash;{' '}
                  {editingCf.customerName}
                </h3>
                <button
                  onClick={() => {
                    setCustomerModalOpen(false);
                    setEditingCustomerId(null);
                  }}
                  className="p-1 hover:bg-white/20 transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Toolbar */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-gray-200 shrink-0">
                {/* View Mode Toggle */}
                <div className="flex items-center gap-2">
                  <label className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                    View
                  </label>
                  <div className="relative">
                    <select
                      value={modalViewMode}
                      onChange={(e) => setModalViewMode(e.target.value as 'Monthly' | 'Weekly')}
                      className="appearance-none px-3 py-1.5 pr-7 border border-[#141414] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    >
                      <option value="Monthly">Monthly</option>
                      <option value="Weekly">Weekly</option>
                    </select>
                    <ChevronDown
                      size={12}
                      className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                    />
                  </div>
                </div>

                {/* Budget lock indicator */}
                {forecastType === 'Budget' && isBudgetLockedForYear(selectedFY) && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <Lock size={12} />
                    <span className="uppercase tracking-widest font-bold text-[10px]">Locked</span>
                  </div>
                )}

                {/* Add Product */}
                <div className="relative ml-auto">
                  <button
                    onClick={() => setAddProductDropdownOpen(!addProductDropdownOpen)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase tracking-widest hover:bg-[#2a2a2a] transition-colors"
                  >
                    <Plus size={12} />
                    Add Product
                  </button>

                  {addProductDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] w-72">
                      <div className="p-3 space-y-2">
                        <input
                          type="text"
                          value={addProductSearch}
                          onChange={(e) => setAddProductSearch(e.target.value)}
                          placeholder="Search products..."
                          className="w-full px-3 py-1.5 border border-[#141414] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#141414]"
                        />
                        <div className="relative">
                          <select
                            value={addProductLocation}
                            onChange={(e) => setAddProductLocation(e.target.value)}
                            className="appearance-none w-full px-3 py-1.5 pr-7 border border-[#141414] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#141414]"
                          >
                            <option value="">All Locations</option>
                            {locations.map((loc) => (
                              <option key={loc.id} value={loc.name}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={12}
                            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                          />
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto border-t border-gray-200">
                        {filteredAvailableProducts.length === 0 && (
                          <div className="px-3 py-4 text-center text-xs text-gray-400">
                            No products found.
                          </div>
                        )}
                        {filteredAvailableProducts.map((p) => (
                          <button
                            key={`${p.name}|${p.location}`}
                            onClick={() => handleAddProductLine(p.name, p.location)}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-b border-gray-100 transition-colors"
                          >
                            <span className="font-medium">{p.name}</span>
                            <span className="ml-2 text-gray-400">{p.location}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Table */}
              <div className="flex-1 overflow-auto p-4">
                {modalLines.length === 0 ? (
                  <div className="text-center py-12 text-sm text-gray-400">
                    No products added yet. Click &quot;Add Product&quot; to begin.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[180px]">
                            Product
                          </th>
                          {modalHeaders.map((h, i) => {
                            const editable = isCellEditable(i, modalViewMode === 'Weekly');
                            const locked =
                              forecastType === 'Budget' &&
                              (modalViewMode === 'Weekly'
                                ? isBudgetLockedForWeek(i, selectedFY)
                                : isBudgetLockedForPeriod(i, selectedFY));
                            return (
                              <th
                                key={i}
                                className={`text-center px-2 py-2 text-[10px] uppercase tracking-widest font-bold border border-gray-200 min-w-[72px] ${
                                  !editable ? 'bg-gray-100 text-gray-500' : 'opacity-60'
                                }`}
                              >
                                <div className="flex items-center justify-center gap-0.5">
                                  {h}
                                  {locked && <Lock size={8} className="text-red-500" />}
                                </div>
                              </th>
                            );
                          })}
                          <th className="text-center px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[80px]">
                            Total
                          </th>
                          <th className="text-center px-2 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 w-10">
                            {/* Delete column */}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {modalLines.map((line) => {
                          const lineTotal = (() => {
                            let sum = 0;
                            for (let i = 0; i < modalColumnCount; i++) {
                              const entry = line.entries.find((e) => e.periodIndex === i);
                              const fv = entry?.value ?? 0;
                              const { value } = getCellValue(
                                editingCf.customerName,
                                line.productName,
                                i,
                                modalViewMode === 'Weekly',
                                fv
                              );
                              sum += value;
                            }
                            return sum;
                          })();

                          return (
                            <tr key={line.id} className="border-b border-gray-200">
                              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium border border-gray-200">
                                <div>{line.productName}</div>
                                <div className="text-[10px] text-gray-400">{line.location}</div>
                              </td>
                              {Array.from({ length: modalColumnCount }, (_, i) => {
                                const entry = line.entries.find((e) => e.periodIndex === i);
                                const forecastVal = entry?.value ?? 0;
                                const { value: cellVal, isActual } = getCellValue(
                                  editingCf.customerName,
                                  line.productName,
                                  i,
                                  modalViewMode === 'Weekly',
                                  forecastVal
                                );
                                const editable = isCellEditable(i, modalViewMode === 'Weekly');

                                return (
                                  <td
                                    key={i}
                                    className={`px-1 py-1 border border-gray-200 text-center ${
                                      isActual || !editable
                                        ? 'bg-gray-100 text-gray-500'
                                        : ''
                                    }`}
                                  >
                                    {editable && !isActual ? (
                                      <input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        value={forecastVal || ''}
                                        onChange={(e) =>
                                          handleCellChange(
                                            line.id,
                                            i,
                                            parseFloat(e.target.value) || 0
                                          )
                                        }
                                        className="w-full px-1 py-0.5 text-center text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-[#141414]"
                                      />
                                    ) : (
                                      <span className="text-xs">
                                        {cellVal > 0
                                          ? cellVal.toLocaleString(undefined, {
                                              minimumFractionDigits: 1,
                                              maximumFractionDigits: 1,
                                            })
                                          : '—'}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-1.5 text-center font-mono font-bold border border-gray-200">
                                {lineTotal.toLocaleString(undefined, {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}
                              </td>
                              <td className="px-2 py-1.5 text-center border border-gray-200">
                                <button
                                  onClick={() => handleRemoveProductLine(line.id)}
                                  className="p-0.5 hover:bg-red-100 text-red-500 transition-all"
                                  title="Remove product"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-gray-50 shrink-0">
                <div className="text-xs">
                  <span className="text-[10px] uppercase tracking-widest font-bold opacity-60 mr-2">
                    Annual {typeLabel}:
                  </span>
                  <span className="font-mono font-bold">
                    {modalLines
                      .reduce((sum, line) => {
                        let lineSum = 0;
                        for (let i = 0; i < modalColumnCount; i++) {
                          const entry = line.entries.find((e) => e.periodIndex === i);
                          const fv = entry?.value ?? 0;
                          const { value } = getCellValue(
                            editingCf.customerName,
                            line.productName,
                            i,
                            modalViewMode === 'Weekly',
                            fv
                          );
                          lineSum += value;
                        }
                        return sum + lineSum;
                      }, 0)
                      .toLocaleString(undefined, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                    MT
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setCustomerModalOpen(false);
                      setEditingCustomerId(null);
                    }}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase tracking-widest hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCustomerForecast}
                    className="flex items-center gap-1 px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase tracking-widest hover:bg-[#2a2a2a] transition-colors"
                  >
                    <Save size={12} />
                    Save
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Product View Modal (read-only) ────────────────────────────────── */}
      <AnimatePresence>
        {productViewModalOpen && viewingProduct && selectedFY && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-md overflow-y-auto"
            onClick={() => {
              setProductViewModalOpen(false);
              setViewingProduct(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] w-full max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center shrink-0">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  <Eye size={14} className="inline mr-2" />
                  Product {typeLabel} &mdash; {viewingProduct.productName} ({viewingProduct.location})
                </h3>
                <button
                  onClick={() => {
                    setProductViewModalOpen(false);
                    setViewingProduct(null);
                  }}
                  className="p-1 hover:bg-white/20 transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-200 shrink-0">
                <label className="text-[10px] uppercase font-bold tracking-widest opacity-60">
                  View
                </label>
                <div className="relative">
                  <select
                    value={productViewMode}
                    onChange={(e) => setProductViewMode(e.target.value as 'Monthly' | 'Weekly')}
                    className="appearance-none px-3 py-1.5 pr-7 border border-[#141414] bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Weekly">Weekly</option>
                  </select>
                  <ChevronDown
                    size={12}
                    className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-auto p-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="sticky left-0 z-10 bg-gray-50 text-left px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[180px]">
                          Customer
                        </th>
                        {(productViewMode === 'Monthly' ? MONTH_NAMES : WEEK_LABELS).map(
                          (h, i) => {
                            const isPast =
                              productViewMode === 'Weekly'
                                ? isWeekPast(i, selectedFY.startDate)
                                : selectedFY.periods[i]
                                ? isPeriodPast(selectedFY.periods[i])
                                : false;
                            return (
                              <th
                                key={i}
                                className={`text-center px-2 py-2 text-[10px] uppercase tracking-widest font-bold border border-gray-200 min-w-[72px] ${
                                  isPast ? 'bg-gray-100 text-gray-500' : 'opacity-60'
                                }`}
                              >
                                {h}
                              </th>
                            );
                          }
                        )}
                        <th className="text-center px-3 py-2 text-[10px] uppercase tracking-widest font-bold opacity-60 border border-gray-200 min-w-[80px]">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {productViewData.map((row, idx) => {
                        const total = row.values.reduce((s, v) => s + v, 0);
                        return (
                          <tr key={idx} className="border-b border-gray-200">
                            <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium border border-gray-200">
                              {row.customerName}
                            </td>
                            {row.values.map((v, i) => {
                              const isPast =
                                productViewMode === 'Weekly'
                                  ? isWeekPast(i, selectedFY.startDate)
                                  : selectedFY.periods[i]
                                  ? isPeriodPast(selectedFY.periods[i])
                                  : false;
                              return (
                                <td
                                  key={i}
                                  className={`px-2 py-1.5 text-center border border-gray-200 ${
                                    isPast ? 'bg-gray-100 text-gray-500' : ''
                                  }`}
                                >
                                  {v > 0
                                    ? v.toLocaleString(undefined, {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })
                                    : '—'}
                                </td>
                              );
                            })}
                            <td className="px-3 py-1.5 text-center font-mono font-bold border border-gray-200">
                              {total.toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}
                            </td>
                          </tr>
                        );
                      })}
                      {productViewData.length === 0 && (
                        <tr>
                          <td
                            colSpan={(productViewMode === 'Monthly' ? 12 : 52) + 2}
                            className="px-4 py-8 text-center text-gray-400"
                          >
                            No {typeLabel.toLowerCase()} data for this product.
                          </td>
                        </tr>
                      )}
                      {/* Totals Row */}
                      {productViewData.length > 0 && (
                        <tr className="bg-gray-50 font-bold">
                          <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 border border-gray-200 text-[10px] uppercase tracking-widest">
                            Total
                          </td>
                          {Array.from(
                            { length: productViewMode === 'Monthly' ? 12 : 52 },
                            (_, i) => {
                              const colTotal = productViewData.reduce(
                                (s, row) => s + row.values[i],
                                0
                              );
                              return (
                                <td
                                  key={i}
                                  className="px-2 py-2 text-center border border-gray-200 font-mono"
                                >
                                  {colTotal > 0
                                    ? colTotal.toLocaleString(undefined, {
                                        minimumFractionDigits: 1,
                                        maximumFractionDigits: 1,
                                      })
                                    : '—'}
                                </td>
                              );
                            }
                          )}
                          <td className="px-3 py-2 text-center border border-gray-200 font-mono">
                            {productViewData
                              .reduce(
                                (s, row) => s + row.values.reduce((a, v) => a + v, 0),
                                0
                              )
                              .toLocaleString(undefined, {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
