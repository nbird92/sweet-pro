import React, { useState, useMemo, useCallback } from 'react';
import { Invoice, Order, Customer, Contract, SKU } from '../types';
import { X, ChevronDown, ChevronUp, Download, Plus, Trash2, GripVertical } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SalesStatsPageProps {
  invoices: Invoice[];
  orders: Order[];
  customers: Customer[];
  contracts: Contract[];
  skus: SKU[];
}

interface FieldDef {
  key: string;
  label: string;
  source: string;
  type: 'string' | 'number' | 'date';
}

type AggFn = 'sum' | 'count' | 'average' | 'min' | 'max' | 'countDistinct';

interface ValueField {
  fieldKey: string;
  aggFn: AggFn;
}

interface FilterRule {
  fieldKey: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan';
  value: string;
}

// ─── Available fields (deduplicated across sources) ──────────────────────────

const AVAILABLE_FIELDS: FieldDef[] = [
  // Customer fields
  { key: 'customerName', label: 'Customer Name', source: 'Customer', type: 'string' },
  { key: 'customerNumber', label: 'Customer No.', source: 'Customer', type: 'string' },
  { key: 'itasCustomerName', label: 'ITAS Customer Name', source: 'Customer', type: 'string' },
  { key: 'customerLocation', label: 'Customer Location', source: 'Customer', type: 'string' },
  { key: 'customerProvince', label: 'Province', source: 'Customer', type: 'string' },
  { key: 'customerCity', label: 'City', source: 'Customer', type: 'string' },
  { key: 'salesperson', label: 'Salesperson', source: 'Customer', type: 'string' },
  { key: 'paymentTerms', label: 'Payment Terms', source: 'Customer', type: 'string' },
  { key: 'defaultCarrierCode', label: 'Default Carrier', source: 'Customer', type: 'string' },

  // Contract fields
  { key: 'contractNumber', label: 'Contract No.', source: 'Contract', type: 'string' },
  { key: 'contractVolume', label: 'Contract Volume (MT)', source: 'Contract', type: 'number' },
  { key: 'volumeTaken', label: 'Volume Taken (MT)', source: 'Contract', type: 'number' },
  { key: 'volumeOutstanding', label: 'Volume Outstanding (MT)', source: 'Contract', type: 'number' },
  { key: 'contractStartDate', label: 'Contract Start', source: 'Contract', type: 'date' },
  { key: 'contractEndDate', label: 'Contract End', source: 'Contract', type: 'date' },
  { key: 'contractOrigin', label: 'Origin', source: 'Contract', type: 'string' },
  { key: 'contractDestination', label: 'Destination', source: 'Contract', type: 'string' },
  { key: 'finalPrice', label: 'Final Price', source: 'Contract', type: 'number' },
  { key: 'contractCurrency', label: 'Currency', source: 'Contract', type: 'string' },
  { key: 'shippingTerms', label: 'Shipping Terms', source: 'Contract', type: 'string' },
  { key: 'contractMargin', label: 'Margin (CAD/MT)', source: 'Contract', type: 'number' },
  { key: 'contractActive', label: 'Contract Status', source: 'Contract', type: 'string' },

  // Product fields
  { key: 'productName', label: 'Product (SKU)', source: 'Product', type: 'string' },
  { key: 'productGroup', label: 'Product Group', source: 'Product', type: 'string' },
  { key: 'productCategory', label: 'Category', source: 'Product', type: 'string' },
  { key: 'productLocation', label: 'Product Location', source: 'Product', type: 'string' },

  // Order fields
  { key: 'orderBol', label: 'BOL Number', source: 'Order', type: 'string' },
  { key: 'orderPo', label: 'PO Number', source: 'Order', type: 'string' },
  { key: 'orderDate', label: 'Order Date', source: 'Order', type: 'date' },
  { key: 'orderShipmentDate', label: 'Shipment Date', source: 'Order', type: 'date' },
  { key: 'orderDeliveryDate', label: 'Delivery Date', source: 'Order', type: 'date' },
  { key: 'orderStatus', label: 'Order Status', source: 'Order', type: 'string' },
  { key: 'orderAmount', label: 'Order Amount ($)', source: 'Order', type: 'number' },
  { key: 'orderQty', label: 'Order Qty (MT)', source: 'Order', type: 'number' },
  { key: 'orderCarrier', label: 'Carrier', source: 'Order', type: 'string' },
  { key: 'orderLocation', label: 'Order Location', source: 'Order', type: 'string' },

  // Invoice fields
  { key: 'invoiceNumber', label: 'Invoice No.', source: 'Invoice', type: 'string' },
  { key: 'invoiceDate', label: 'Invoice Date', source: 'Invoice', type: 'date' },
  { key: 'invoiceDueDate', label: 'Due Date', source: 'Invoice', type: 'date' },
  { key: 'invoiceQty', label: 'Invoice Qty (MT)', source: 'Invoice', type: 'number' },
  { key: 'invoiceAmount', label: 'Invoice Amount ($)', source: 'Invoice', type: 'number' },
  { key: 'invoiceStatus', label: 'Invoice Status', source: 'Invoice', type: 'string' },
  { key: 'invoiceLocation', label: 'Invoice Location', source: 'Invoice', type: 'string' },

  // Derived / date parts
  { key: 'invoiceMonth', label: 'Invoice Month', source: 'Derived', type: 'string' },
  { key: 'invoiceYear', label: 'Invoice Year', source: 'Derived', type: 'string' },
  { key: 'orderMonth', label: 'Order Month', source: 'Derived', type: 'string' },
  { key: 'orderYear', label: 'Order Year', source: 'Derived', type: 'string' },
];

const AGG_OPTIONS: { value: AggFn; label: string }[] = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
  { value: 'countDistinct', label: 'Count Distinct' },
];

const OPERATOR_OPTIONS = [
  { value: 'equals' as const, label: '=' },
  { value: 'notEquals' as const, label: '!=' },
  { value: 'contains' as const, label: 'Contains' },
  { value: 'greaterThan' as const, label: '>' },
  { value: 'lessThan' as const, label: '<' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthFromDate(d: string | undefined): string {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length < 2) return '—';
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10);
  return monthNames[m - 1] || '—';
}

function yearFromDate(d: string | undefined): string {
  if (!d) return '—';
  return d.split('-')[0] || '—';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SalesStatsPage({ invoices, orders, customers, contracts, skus }: SalesStatsPageProps) {

  // Pivot config state
  const [rowFields, setRowFields] = useState<string[]>(['customerName']);
  const [colFields, setColFields] = useState<string[]>([]);
  const [valueFields, setValueFields] = useState<ValueField[]>([{ fieldKey: 'invoiceAmount', aggFn: 'sum' }]);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [configOpen, setConfigOpen] = useState(true);

  // Build customer / contract / product lookup maps
  const customerMap = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach(c => {
      m.set(c.name.toLowerCase(), c);
      if (c.id) m.set(c.id, c);
    });
    return m;
  }, [customers]);

  const contractMap = useMemo(() => {
    const m = new Map<string, Contract>();
    contracts.forEach(c => m.set(c.contractNumber, c));
    return m;
  }, [contracts]);

  const skuMap = useMemo(() => {
    const m = new Map<string, SKU>();
    skus.forEach(s => m.set(s.name.toLowerCase(), s));
    return m;
  }, [skus]);

  // ─── Build flat joined dataset ──────────────────────────────────────────

  const dataset = useMemo(() => {
    const rows: Record<string, any>[] = [];
    const seenKeys = new Set<string>();

    // Start from invoices as the primary fact table
    invoices.forEach(inv => {
      const cust = customerMap.get(inv.customer?.toLowerCase() || '') || customerMap.get(inv.shipmentId || '');
      const contract = inv.contractNumber ? contractMap.get(inv.contractNumber) : undefined;
      const sku = skuMap.get((inv.product || '').toLowerCase());

      // Try to find matching order
      const order = orders.find(o => o.bolNumber === inv.bolNumber);

      const key = `inv-${inv.id}`;
      seenKeys.add(key);

      rows.push(buildRow(inv, order, cust, contract, sku));
    });

    // Add orders without invoices
    orders.forEach(ord => {
      const hasInvoice = invoices.some(i => i.bolNumber === ord.bolNumber);
      if (hasInvoice) return;

      const cust = customerMap.get(ord.customer?.toLowerCase() || '');
      const contractNum = ord.contractNumber || ord.lineItems?.[0]?.contractNumber;
      const contract = contractNum ? contractMap.get(contractNum) : undefined;
      const sku = skuMap.get((ord.product || '').toLowerCase());

      rows.push(buildRow(undefined, ord, cust, contract, sku));
    });

    return rows;
  }, [invoices, orders, customers, contracts, skus, customerMap, contractMap, skuMap]);

  function buildRow(
    inv: Invoice | undefined,
    ord: Order | undefined,
    cust: Customer | undefined,
    contract: Contract | undefined,
    sku: SKU | undefined,
  ): Record<string, any> {
    const contractNum = inv?.contractNumber || ord?.contractNumber || ord?.lineItems?.[0]?.contractNumber || '';
    const resolvedContract = contract || (contractNum ? contractMap.get(contractNum) : undefined);

    return {
      // Customer
      customerName: cust?.name || inv?.customer || ord?.customer || '—',
      customerNumber: cust?.customerNumber || '—',
      itasCustomerName: cust?.itasCustomerName || '—',
      customerLocation: cust?.defaultLocation || '—',
      customerProvince: cust?.province || '—',
      customerCity: cust?.city || '—',
      salesperson: cust?.salespersonId || '—',
      paymentTerms: cust?.defaultPaymentTerms || resolvedContract?.paymentTerms || '—',
      defaultCarrierCode: cust?.defaultCarrierCode || '—',

      // Contract
      contractNumber: resolvedContract?.contractNumber || contractNum || '—',
      contractVolume: resolvedContract?.contractVolume || 0,
      volumeTaken: resolvedContract?.volumeTaken || 0,
      volumeOutstanding: resolvedContract?.volumeOutstanding || 0,
      contractStartDate: resolvedContract?.startDate || '—',
      contractEndDate: resolvedContract?.endDate || '—',
      contractOrigin: resolvedContract?.origin || '—',
      contractDestination: resolvedContract?.destination || '—',
      finalPrice: resolvedContract?.finalPrice || 0,
      contractCurrency: resolvedContract?.currency || '—',
      shippingTerms: inv?.shippingTerms || ord?.shippingTerms || resolvedContract?.shippingTerms || '—',
      contractMargin: resolvedContract?.margin || 0,
      contractActive: resolvedContract ? (resolvedContract.active !== false ? 'Active' : 'Inactive') : '—',

      // Product
      productName: inv?.product || ord?.product || sku?.name || '—',
      productGroup: sku?.productGroup || '—',
      productCategory: sku?.category || '—',
      productLocation: sku?.location || '—',

      // Order
      orderBol: ord?.bolNumber || inv?.bolNumber || '—',
      orderPo: ord?.po || inv?.po || '—',
      orderDate: ord?.date || '—',
      orderShipmentDate: ord?.shipmentDate || '—',
      orderDeliveryDate: ord?.deliveryDate || '—',
      orderStatus: ord?.status || '—',
      orderAmount: ord?.amount || 0,
      orderQty: ord ? ord.lineItems.reduce((s, li) => s + li.qty, 0) : 0,
      orderCarrier: ord?.carrier || inv?.carrier || '—',
      orderLocation: ord?.location || '—',

      // Invoice
      invoiceNumber: inv?.invoiceNumber || '—',
      invoiceDate: inv?.date || '—',
      invoiceDueDate: inv?.dueDate || '—',
      invoiceQty: inv?.qty || 0,
      invoiceAmount: inv?.amount || 0,
      invoiceStatus: inv?.status || '—',
      invoiceLocation: inv?.location || '—',

      // Derived
      invoiceMonth: monthFromDate(inv?.date),
      invoiceYear: yearFromDate(inv?.date),
      orderMonth: monthFromDate(ord?.date),
      orderYear: yearFromDate(ord?.date),
    };
  }

  // ─── Apply filters ───────────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    if (filters.length === 0) return dataset;
    return dataset.filter(row => {
      return filters.every(f => {
        const val = String(row[f.fieldKey] ?? '');
        switch (f.operator) {
          case 'equals': return val.toLowerCase() === f.value.toLowerCase();
          case 'notEquals': return val.toLowerCase() !== f.value.toLowerCase();
          case 'contains': return val.toLowerCase().includes(f.value.toLowerCase());
          case 'greaterThan': return parseFloat(val) > parseFloat(f.value);
          case 'lessThan': return parseFloat(val) < parseFloat(f.value);
          default: return true;
        }
      });
    });
  }, [dataset, filters]);

  // ─── Pivot computation ────────────────────────────────────────────────────

  const pivotResult = useMemo(() => {
    if (rowFields.length === 0 && colFields.length === 0) {
      // Grand total only
      const aggs = valueFields.map(vf => aggregate(filteredData.map(r => r[vf.fieldKey]), vf.aggFn));
      return { type: 'grand' as const, aggs, count: filteredData.length };
    }

    // Build row keys
    const rowKeyFn = (r: Record<string, any>) => rowFields.map(f => String(r[f] ?? '—')).join(' | ');
    const colKeyFn = (r: Record<string, any>) => colFields.map(f => String(r[f] ?? '—')).join(' | ');

    const rowKeysSet = new Set<string>();
    const colKeysSet = new Set<string>();
    const buckets = new Map<string, Record<string, any>[]>();

    filteredData.forEach(r => {
      const rk = rowKeyFn(r);
      const ck = colFields.length > 0 ? colKeyFn(r) : '__total__';
      rowKeysSet.add(rk);
      colKeysSet.add(ck);
      const bk = `${rk}|||${ck}`;
      if (!buckets.has(bk)) buckets.set(bk, []);
      buckets.get(bk)!.push(r);
    });

    const rowKeys = [...rowKeysSet].sort();
    const colKeys = [...colKeysSet].sort();

    return { type: 'pivot' as const, rowKeys, colKeys, buckets };
  }, [filteredData, rowFields, colFields, valueFields]);

  function aggregate(values: any[], fn: AggFn): number | string {
    const nums = values.map(v => parseFloat(v)).filter(n => !isNaN(n));
    switch (fn) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'count': return values.length;
      case 'average': return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      case 'min': return nums.length > 0 ? Math.min(...nums) : 0;
      case 'max': return nums.length > 0 ? Math.max(...nums) : 0;
      case 'countDistinct': return new Set(values.map(v => String(v))).size;
      default: return 0;
    }
  }

  function formatAgg(val: number | string, fn: AggFn): string {
    if (typeof val === 'string') return val;
    if (fn === 'count' || fn === 'countDistinct') return val.toLocaleString();
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  // ─── Field pickers ────────────────────────────────────────────────────────

  const fieldLabel = useCallback((key: string) => {
    return AVAILABLE_FIELDS.find(f => f.key === key)?.label || key;
  }, []);

  const addRowField = (key: string) => {
    if (!rowFields.includes(key) && !colFields.includes(key)) setRowFields([...rowFields, key]);
  };
  const removeRowField = (key: string) => setRowFields(rowFields.filter(f => f !== key));
  const addColField = (key: string) => {
    if (!colFields.includes(key) && !rowFields.includes(key)) setColFields([...colFields, key]);
  };
  const removeColField = (key: string) => setColFields(colFields.filter(f => f !== key));
  const addValueField = () => setValueFields([...valueFields, { fieldKey: 'invoiceQty', aggFn: 'sum' }]);
  const removeValueField = (idx: number) => setValueFields(valueFields.filter((_, i) => i !== idx));
  const updateValueField = (idx: number, patch: Partial<ValueField>) => setValueFields(valueFields.map((v, i) => i === idx ? { ...v, ...patch } : v));
  const addFilter = () => setFilters([...filters, { fieldKey: 'customerName', operator: 'equals', value: '' }]);
  const removeFilter = (idx: number) => setFilters(filters.filter((_, i) => i !== idx));
  const updateFilter = (idx: number, patch: Partial<FilterRule>) => setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f));

  // ─── Export ────────────────────────────────────────────────────────────────

  const exportPivot = useCallback(() => {
    if (pivotResult.type === 'grand') return;
    const { rowKeys, colKeys, buckets } = pivotResult;

    const headerRow = [...rowFields.map(fieldLabel)];
    if (colKeys[0] === '__total__') {
      valueFields.forEach(vf => headerRow.push(`${fieldLabel(vf.fieldKey)} (${vf.aggFn})`));
    } else {
      colKeys.forEach(ck => {
        valueFields.forEach(vf => headerRow.push(`${ck} - ${fieldLabel(vf.fieldKey)} (${vf.aggFn})`));
      });
    }

    const escape = (val: any) => {
      if (val == null) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const csvLines = [headerRow.map(escape).join(',')];
    rowKeys.forEach(rk => {
      const parts = rk.split(' | ');
      const row = [...parts];
      colKeys.forEach(ck => {
        const bucket = buckets.get(`${rk}|||${ck}`) || [];
        valueFields.forEach(vf => {
          const val = aggregate(bucket.map(r => r[vf.fieldKey]), vf.aggFn);
          row.push(String(typeof val === 'number' ? Math.round(val * 100) / 100 : val));
        });
      });
      csvLines.push(row.map(escape).join(','));
    });

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'sales_stats_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [pivotResult, rowFields, colFields, valueFields, fieldLabel]);

  // ─── Unique values for filter dropdowns ────────────────────────────────────

  const uniqueValuesForField = useCallback((key: string) => {
    const vals = new Set<string>();
    dataset.forEach(r => {
      const v = String(r[key] ?? '');
      if (v && v !== '—' && v !== '0') vals.add(v);
    });
    return [...vals].sort();
  }, [dataset]);

  // Group available fields by source for the selector
  const fieldsBySource = useMemo(() => {
    const map = new Map<string, FieldDef[]>();
    AVAILABLE_FIELDS.forEach(f => {
      if (!map.has(f.source)) map.set(f.source, []);
      map.get(f.source)!.push(f);
    });
    return map;
  }, []);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-tighter">Sales Stats</h2>
          <p className="text-xs opacity-60 mt-1">{filteredData.length.toLocaleString()} records from {invoices.length} invoices &amp; {orders.length} orders</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setConfigOpen(!configOpen)}
            className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-[#F5F5F5] transition-all">
            <Settings size={12} /> {configOpen ? 'Hide Config' : 'Show Config'}
          </button>
          <button onClick={exportPivot}
            className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-[#F5F5F5] transition-all">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Configuration Panel */}
      {configOpen && (
        <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
          <div className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center">
            <h3 className="text-[10px] font-bold uppercase tracking-widest">Pivot Table Configuration</h3>
          </div>
          <div className="p-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">

            {/* Row Fields */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider opacity-60">Row Fields</label>
              <div className="space-y-1">
                {rowFields.map(f => (
                  <div key={f} className="flex items-center gap-1 bg-blue-50 border border-blue-200 px-2 py-1 text-xs">
                    <GripVertical size={10} className="opacity-30" />
                    <span className="flex-1 font-bold">{fieldLabel(f)}</span>
                    <button onClick={() => removeRowField(f)} className="hover:text-red-600"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <select
                className="w-full border border-[#141414] p-1.5 text-xs bg-[#F5F5F5] outline-none"
                value=""
                onChange={e => { if (e.target.value) addRowField(e.target.value); }}
              >
                <option value="">+ Add row field...</option>
                {[...fieldsBySource.entries()].map(([source, fields]) => (
                  <optgroup key={source} label={source}>
                    {fields.filter(f => !rowFields.includes(f.key) && !colFields.includes(f.key)).map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Column Fields */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider opacity-60">Column Fields</label>
              <div className="space-y-1">
                {colFields.map(f => (
                  <div key={f} className="flex items-center gap-1 bg-green-50 border border-green-200 px-2 py-1 text-xs">
                    <GripVertical size={10} className="opacity-30" />
                    <span className="flex-1 font-bold">{fieldLabel(f)}</span>
                    <button onClick={() => removeColField(f)} className="hover:text-red-600"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <select
                className="w-full border border-[#141414] p-1.5 text-xs bg-[#F5F5F5] outline-none"
                value=""
                onChange={e => { if (e.target.value) addColField(e.target.value); }}
              >
                <option value="">+ Add column field...</option>
                {[...fieldsBySource.entries()].map(([source, fields]) => (
                  <optgroup key={source} label={source}>
                    {fields.filter(f => !rowFields.includes(f.key) && !colFields.includes(f.key)).map(f => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Value Fields */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider opacity-60">Values</label>
              <div className="space-y-1">
                {valueFields.map((vf, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1">
                    <select
                      className="flex-1 text-xs bg-transparent outline-none font-bold"
                      value={vf.fieldKey}
                      onChange={e => updateValueField(idx, { fieldKey: e.target.value })}
                    >
                      {[...fieldsBySource.entries()].map(([source, fields]) => (
                        <optgroup key={source} label={source}>
                          {fields.map(f => (
                            <option key={f.key} value={f.key}>{f.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select
                      className="text-[10px] bg-transparent outline-none border-l border-amber-300 pl-1"
                      value={vf.aggFn}
                      onChange={e => updateValueField(idx, { aggFn: e.target.value as AggFn })}
                    >
                      {AGG_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button onClick={() => removeValueField(idx)} className="hover:text-red-600"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <button onClick={addValueField} className="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Plus size={10} /> Add Value
              </button>
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider opacity-60">Filters</label>
              <div className="space-y-1">
                {filters.map((f, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-red-50 border border-red-200 px-2 py-1">
                    <select
                      className="text-xs bg-transparent outline-none font-bold flex-1"
                      value={f.fieldKey}
                      onChange={e => updateFilter(idx, { fieldKey: e.target.value })}
                    >
                      {[...fieldsBySource.entries()].map(([source, fields]) => (
                        <optgroup key={source} label={source}>
                          {fields.map(fd => (
                            <option key={fd.key} value={fd.key}>{fd.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <select
                      className="text-[10px] bg-transparent outline-none border-l border-red-300 pl-1"
                      value={f.operator}
                      onChange={e => updateFilter(idx, { operator: e.target.value as FilterRule['operator'] })}
                    >
                      {OPERATOR_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="text-xs bg-transparent outline-none border-l border-red-300 pl-1 w-20"
                      value={f.value}
                      onChange={e => updateFilter(idx, { value: e.target.value })}
                      placeholder="value"
                      list={`filter-vals-${idx}`}
                    />
                    <datalist id={`filter-vals-${idx}`}>
                      {uniqueValuesForField(f.fieldKey).slice(0, 50).map(v => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                    <button onClick={() => removeFilter(idx)} className="hover:text-red-600"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <button onClick={addFilter} className="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Plus size={10} /> Add Filter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pivot Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
        {pivotResult.type === 'grand' ? (
          <div className="p-6 text-center">
            <div className="text-xs opacity-50 uppercase mb-4">Grand Total ({filteredData.length} records)</div>
            <div className="flex justify-center gap-6">
              {valueFields.map((vf, i) => (
                <div key={i} className="text-center">
                  <div className="text-[10px] uppercase opacity-50">{fieldLabel(vf.fieldKey)} ({vf.aggFn})</div>
                  <div className="text-2xl font-bold">{formatAgg(pivotResult.aggs[i], vf.aggFn)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                {rowFields.map(f => (
                  <th key={f} className="p-3 border-r border-white/10 whitespace-nowrap">{fieldLabel(f)}</th>
                ))}
                {pivotResult.colKeys[0] === '__total__' ? (
                  valueFields.map((vf, i) => (
                    <th key={i} className="p-3 border-r border-white/10 whitespace-nowrap text-right">
                      {fieldLabel(vf.fieldKey)} ({vf.aggFn})
                    </th>
                  ))
                ) : (
                  pivotResult.colKeys.map(ck => (
                    valueFields.map((vf, vi) => (
                      <th key={`${ck}-${vi}`} className="p-3 border-r border-white/10 whitespace-nowrap text-right">
                        {ck}{valueFields.length > 1 ? ` - ${fieldLabel(vf.fieldKey)} (${vf.aggFn})` : ''}
                      </th>
                    ))
                  ))
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {/* Grand total row */}
              <tr className="bg-[#F5F5F5] font-bold">
                <td className="p-3 text-xs uppercase tracking-wider border-r border-[#141414]/10" colSpan={rowFields.length}>
                  Grand Total
                </td>
                {(pivotResult.colKeys[0] === '__total__' ? ['__total__'] : pivotResult.colKeys).map(ck => (
                  valueFields.map((vf, vi) => {
                    const allBucketsForCol = pivotResult.rowKeys.flatMap(rk => pivotResult.buckets.get(`${rk}|||${ck}`) || []);
                    const val = aggregate(allBucketsForCol.map(r => r[vf.fieldKey]), vf.aggFn);
                    return (
                      <td key={`gt-${ck}-${vi}`} className="p-3 text-xs font-bold text-right border-r border-[#141414]/10">
                        {formatAgg(val, vf.aggFn)}
                      </td>
                    );
                  })
                ))}
              </tr>
              {/* Data rows */}
              {pivotResult.rowKeys.map(rk => {
                const parts = rk.split(' | ');
                return (
                  <tr key={rk} className="hover:bg-[#F9F9F9] transition-colors">
                    {parts.map((p, i) => (
                      <td key={i} className="p-3 text-xs border-r border-[#141414]/10 whitespace-nowrap">{p}</td>
                    ))}
                    {(pivotResult.colKeys[0] === '__total__' ? ['__total__'] : pivotResult.colKeys).map(ck => (
                      valueFields.map((vf, vi) => {
                        const bucket = pivotResult.buckets.get(`${rk}|||${ck}`) || [];
                        const val = aggregate(bucket.map(r => r[vf.fieldKey]), vf.aggFn);
                        return (
                          <td key={`${ck}-${vi}`} className="p-3 text-xs text-right border-r border-[#141414]/10 font-mono">
                            {formatAgg(val, vf.aggFn)}
                          </td>
                        );
                      })
                    ))}
                  </tr>
                );
              })}
              {pivotResult.rowKeys.length === 0 && (
                <tr>
                  <td colSpan={100} className="p-6 text-center text-xs opacity-50 italic">
                    No data matches the current configuration. Try adjusting filters or adding row/column fields.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Need Settings icon — imported from lucide but also used inline
function Settings({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}
