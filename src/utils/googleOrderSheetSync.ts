// Google Sheets order sync utility
// Pulls orders from the LIQ, TOT, DRY and Molasses tabs of the configured
// orders spreadsheet and produces ready-to-insert Order records.
//
// Skip rules (per requirements):
//   1. Row is cancelled — detected via a "STATUS" / "CANCELLED" column on the
//      row whose value contains "cancel", or equals "x" / "cxl" / "void".
//      (The user's sheet uses red-fill + strikethrough to mark cancellations,
//      but CSV export strips that formatting. The agreed workaround is to add
//      a Status column we can read in plain CSV.)
//   2. Row is invoiced — column BV ("INVOICE #") contains a non-empty
//      invoice number. Invoiced orders live in the Invoice table, not Orders.
//   3. BOL number already exists in the orders table.
//   4. PO number already exists in the orders table.
//
// Endpoints used:
//   https://docs.google.com/spreadsheets/d/{ORDER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet={NAME}
// The sheet must be either "Anyone with link can view" or published to the
// web — the endpoint above honours the former for CORS-friendly fetches.

import type { Order, OrderLineItem, Customer, SKU, QAProduct, Carrier } from '../types';
import { parseCSV } from './googleSheetsSync';

// Workbook containing the order tabs to import.
export const ORDER_SHEET_ID = '1prdn1bw4roP-JamzaAhIVtZ7irw9ABWkjm2y0bm_NtM';

// Tabs to read. Molasses uses a different column layout than LIQ/TOT/DRY.
export const ORDER_TABS = ['LIQ', 'TOT', 'DRY', 'Molasses'] as const;
type OrderTab = typeof ORDER_TABS[number];

// LIQ / TOT / DRY share the same A-T column layout (0-indexed):
//   A=0 WEEK, B=1 LOADING DATE, C=2 LOADING DAY, D=3 DELIVERY DATE,
//   E=4 DELIVERY DAY, F=5 CUSTOMER, G=6 LOCATION (ship-to),
//   H=7 PURCHASE ORDER, I=8 PRODUCT, J=9 CARRIER, K=10 TRAILER,
//   L=11 BILL OF LADING, M=12 ORDERED QTY (MT), N=13 SCALED QTY (DRY/WET, MT),
//   ..., S=18 INVOICE (sales-invoice id, always populated upstream)
// BV is the 74th column (0-indexed 73). It carries the "INVOICE #" set when
// the order has been invoiced — that's our "invoiced" marker, not column S.
const COL_BV_INDEX = 73;

// Molasses tab column layout (0-indexed):
//   A=0 WEEK, B=1 BOL DATE, C=2 DAY, D=3 CLIENT, E=4 PO NUMBER,
//   F=5 Litres, G=6 QTY Shipped (MT), H=7 BRIX, I=8 QUANTITY (DRY BASIS),
//   J=9 Lot#, K=10 TRUCKING COMPANY, L=11 PAPS, M=12 TRAILER

export interface ParsedOrderRow {
  tab: string;
  rowIdx: number; // 1-based
  bolNumber: string;
  poNumber: string;
  customerName: string;
  shipToName: string;
  productRaw: string;
  carrierName: string;
  shipmentDate: string; // ISO YYYY-MM-DD
  deliveryDate: string; // ISO YYYY-MM-DD
  /** Ordered quantity in metric tonnes */
  quantityMT: number;
  invoiceNumber: string;
  status: string;
}

export interface OrderSyncResult {
  newOrders: Order[];
  skipped: Array<{ tab: string; bolNumber: string; poNumber: string; reason: string }>;
  errors: Array<{ tab: string; rowIdx: number; message: string }>;
}

/* ------------------------------------------------------------------ */
/* Sheet fetching                                                      */
/* ------------------------------------------------------------------ */

export async function fetchOrderTabCSV(tabName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${ORDER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch tab "${tabName}": HTTP ${res.status}. The sheet may not be publicly viewable — set sharing to "Anyone with the link can view".`,
    );
  }
  return await res.text();
}

/* ------------------------------------------------------------------ */
/* Date normalisation — handles "Jan 1, 2026" and "Dec 30, 1899"      */
/* ------------------------------------------------------------------ */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse "Jan 1, 2026" / "January 1, 2026" → "2026-01-01". Returns '' on failure. */
function parseSheetDate(s: string): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return '';
  const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return '';
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return '';
  // "Dec 30, 1899" is the Sheets-engine date epoch — treat as no date.
  if (year < 1900) return '';
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/* ------------------------------------------------------------------ */
/* Status + invoice helpers                                            */
/* ------------------------------------------------------------------ */

/** Find the index of a header cell whose label matches /status|cancel/i. */
function findStatusColumn(header: string[]): number {
  for (let i = 0; i < header.length; i++) {
    const h = (header[i] || '').trim().toLowerCase();
    if (!h) continue;
    if (h === 'status' || h === 'cancelled' || h === 'cancel' || h.includes('cancel')) return i;
  }
  return -1;
}

function isCancelledStatus(status: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase().trim();
  if (!s) return false;
  if (s === 'x' || s === 'cxl' || s === 'void') return true;
  if (s.includes('cancel')) return true;
  return false;
}

/** Is the BV value a real invoice id (e.g. "SI2600051")? Empty strings, "N/A", placeholder dashes don't count. */
function isInvoicedValue(bv: string): boolean {
  if (!bv) return false;
  const s = bv.trim();
  if (!s) return false;
  if (s === '-' || s.toUpperCase() === 'N/A' || s === '#N/A') return false;
  // Anything non-trivial in BV counts as invoiced.
  return s.length > 0;
}

/* ------------------------------------------------------------------ */
/* Tab parsing                                                         */
/* ------------------------------------------------------------------ */

function parseStandardOrderTab(rows: string[][], tab: string): ParsedOrderRow[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const statusCol = findStatusColumn(header);
  const cell = (row: string[], idx: number) => (row[idx] ?? '').trim();

  const out: ParsedOrderRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const customer = cell(row, 5);   // F
    const shipTo = cell(row, 6);     // G
    const po = cell(row, 7);         // H
    const product = cell(row, 8);    // I
    const carrier = cell(row, 9);    // J
    const bol = cell(row, 11);       // L
    const qtyRaw = cell(row, 12);    // M (ordered MT)
    const shipDateRaw = cell(row, 1); // B
    const delivDateRaw = cell(row, 3); // D
    const invoiceBV = cell(row, COL_BV_INDEX); // BV
    const status = statusCol >= 0 ? cell(row, statusCol) : '';

    // Empty / placeholder row — skip
    if (!customer && !bol && !po && !product) continue;
    // Sheet has many template rows with "BL Number" placeholder in column L.
    if (bol.toLowerCase() === 'bl number') continue;

    const shipmentDate = parseSheetDate(shipDateRaw);
    const deliveryDate = parseSheetDate(delivDateRaw) || shipmentDate;
    const qty = parseFloat(qtyRaw);

    out.push({
      tab,
      rowIdx: i + 1,
      bolNumber: bol,
      poNumber: po,
      customerName: customer,
      shipToName: shipTo,
      productRaw: product,
      carrierName: carrier,
      shipmentDate,
      deliveryDate,
      quantityMT: Number.isFinite(qty) ? qty : 0,
      invoiceNumber: invoiceBV,
      status,
    });
  }
  return out;
}

function parseMolassesTab(rows: string[][]): ParsedOrderRow[] {
  if (rows.length < 2) return [];
  const header = rows[0];
  const statusCol = findStatusColumn(header);
  const cell = (row: string[], idx: number) => (row[idx] ?? '').trim();

  const out: ParsedOrderRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const bolDateRaw = cell(row, 1);  // B BOL DATE
    const customer = cell(row, 3);    // D CLIENT
    const po = cell(row, 4);          // E PO NUMBER
    const qtyRaw = cell(row, 6);      // G QTY Shipped (MT)
    const lot = cell(row, 9);         // J Lot# — used as BOL when present
    const carrier = cell(row, 10);    // K Trucking Company
    const status = statusCol >= 0 ? cell(row, statusCol) : '';

    if (!customer && !po && !bolDateRaw) continue;
    // User asked us to skip transfers in the shipment sheet — same call here:
    // anything tagged TRANSFER- in the PO column is an internal transfer.
    if (po.toUpperCase().startsWith('TRANSFER')) continue;

    const shipmentDate = parseSheetDate(bolDateRaw);
    const qty = parseFloat(qtyRaw);

    out.push({
      tab: 'Molasses',
      rowIdx: i + 1,
      bolNumber: lot, // Use lot # as BOL surrogate
      poNumber: po,
      customerName: customer,
      shipToName: '',
      productRaw: 'Molasses',
      carrierName: carrier,
      shipmentDate,
      deliveryDate: shipmentDate,
      quantityMT: Number.isFinite(qty) ? qty : 0,
      invoiceNumber: '', // Molasses tab has no BV invoice column
      status,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Catalog resolution                                                  */
/* ------------------------------------------------------------------ */

function resolveCustomer(raw: string, customers: Customer[]): string {
  if (!raw) return raw;
  const norm = raw.trim().toLowerCase();
  let m = customers.find(c => (c.name || '').trim().toLowerCase() === norm);
  if (m) return m.name;
  m = customers.find(c => {
    const cn = (c.name || '').trim().toLowerCase();
    return cn && (cn.startsWith(norm) || norm.startsWith(cn));
  });
  if (m) return m.name;
  m = customers.find(c => {
    const cn = (c.name || '').trim().toLowerCase();
    return cn && (cn.includes(norm) || norm.includes(cn));
  });
  return m ? m.name : raw;
}

function resolveCarrier(raw: string, carriers: Carrier[]): string {
  if (!raw) return raw;
  const norm = raw.trim().toLowerCase();
  const exact = carriers.find(c => (c.name || '').trim().toLowerCase() === norm);
  if (exact) return exact.name;
  const loose = carriers.find(c => {
    const n = (c.name || '').trim().toLowerCase();
    return n && (n.includes(norm) || norm.includes(n));
  });
  return loose ? loose.name : raw;
}

/**
 * Resolve a raw product string from the sheet into a catalog product.
 *
 * Resolution order:
 *   1. Exact case-insensitive SKU.name match.
 *   2. QA.skuName match.
 *   3. Normalized-code match (strips dashes, spaces, trailing "X" suffix —
 *      so "GC-100" → "GC100", "LC100X" → "LC100" when no exact LC100X SKU).
 *   4. Translation rules from user spec:
 *        "Totes <n>" / "Bulk <n>" → "GC<n>"
 *        "Liquid <n>"             → "LC<n>"
 *        "Molasses"               → "Molasses" (if catalog has it)
 *   5. Substring match.
 *   6. Fallback: keep raw text.
 */
function resolveProduct(
  raw: string,
  skus: SKU[],
  qaProducts: QAProduct[],
): { productName: string; productDisplayName?: string; productKey?: string } {
  if (!raw) return { productName: raw };
  const trimmed = raw.trim();
  const norm = trimmed.toLowerCase();

  // 1. Exact SKU.name match
  const exactSku = skus.find(s => (s.name || '').trim().toLowerCase() === norm);
  if (exactSku) {
    const qa = qaProducts.find(q => q.skuId === exactSku.id) || null;
    return { productName: exactSku.name, productKey: qa?.id || exactSku.id };
  }

  // 2. QA skuName match
  const qaByName = qaProducts.find(q => (q.skuName || '').trim().toLowerCase() === norm);
  if (qaByName) {
    return { productName: qaByName.skuName || trimmed, productKey: qaByName.id };
  }

  // 3. Normalized-code match (strip dashes/spaces; also try without trailing X)
  const stripped = trimmed.replace(/[-\s]/g, '').toUpperCase();
  const candidates = [stripped, stripped.replace(/X$/, '')];
  for (const cand of candidates) {
    const m = skus.find(s => (s.name || '').replace(/[-\s]/g, '').toUpperCase() === cand);
    if (m) {
      const qa = qaProducts.find(q => q.skuId === m.id) || null;
      return { productName: m.name, productKey: qa?.id || m.id };
    }
  }

  // 4. Translation rules
  const totesBulk = /^(?:totes?|bulk)\s*(\d+)/i.exec(trimmed);
  if (totesBulk) {
    const candidate = `GC${totesBulk[1]}`;
    const m = skus.find(s => (s.name || '').replace(/[-\s]/g, '').toUpperCase() === candidate);
    if (m) {
      const qa = qaProducts.find(q => q.skuId === m.id) || null;
      return { productName: m.name, productKey: qa?.id || m.id };
    }
  }
  const liquid = /^liquid\s*(\d+)/i.exec(trimmed);
  if (liquid) {
    const candidate = `LC${liquid[1]}`;
    const m = skus.find(s => (s.name || '').replace(/[-\s]/g, '').toUpperCase() === candidate);
    if (m) {
      const qa = qaProducts.find(q => q.skuId === m.id) || null;
      return { productName: m.name, productKey: qa?.id || m.id };
    }
  }
  if (norm === 'molasses') {
    const m = skus.find(s => (s.name || '').trim().toLowerCase() === 'molasses');
    if (m) {
      const qa = qaProducts.find(q => q.skuId === m.id) || null;
      return { productName: m.name, productKey: qa?.id || m.id };
    }
  }

  // 5. Substring match (loose)
  const loose = skus.find(s => {
    const sn = (s.name || '').trim().toLowerCase();
    return sn && (sn.includes(norm) || norm.includes(sn));
  });
  if (loose) {
    const qa = qaProducts.find(q => q.skuId === loose.id) || null;
    return { productName: loose.name, productKey: qa?.id || loose.id };
  }

  // 6. Fallback — keep raw
  return { productName: trimmed };
}

/* ------------------------------------------------------------------ */
/* Row → Order conversion + dedupe                                     */
/* ------------------------------------------------------------------ */

export function parsedRowsToOrders(
  parsed: ParsedOrderRow[],
  existingOrders: Order[],
  customers: Customer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Carrier[],
): OrderSyncResult {
  const result: OrderSyncResult = { newOrders: [], skipped: [], errors: [] };

  const existingBOLs = new Set(
    existingOrders.map(o => (o.bolNumber || '').trim().toUpperCase()).filter(Boolean),
  );
  const existingPOs = new Set(
    existingOrders.map(o => (o.po || '').trim().toUpperCase()).filter(Boolean),
  );
  const addedBOLs = new Set<string>();
  const addedPOs = new Set<string>();

  for (const r of parsed) {
    try {
      // Skip cancelled
      if (isCancelledStatus(r.status)) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'Row marked cancelled (Status column)',
        });
        continue;
      }
      // Skip invoiced — only if BV column carries an invoice id
      if (isInvoicedValue(r.invoiceNumber)) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: `Already invoiced (${r.invoiceNumber.trim()})`,
        });
        continue;
      }
      // Need at least one of BOL or PO to identify the order
      if (!r.bolNumber && !r.poNumber) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'Row has no BOL or PO',
        });
        continue;
      }
      // Need a usable date — otherwise the row is just a template stub
      if (!r.shipmentDate) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'Row has no shipment date',
        });
        continue;
      }

      const bolU = r.bolNumber.trim().toUpperCase();
      const poU = r.poNumber.trim().toUpperCase();

      // Dedup against existing + in-batch additions
      if (bolU && (existingBOLs.has(bolU) || addedBOLs.has(bolU))) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'BOL already exists in orders table',
        });
        continue;
      }
      if (poU && (existingPOs.has(poU) || addedPOs.has(poU))) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'PO already exists in orders table',
        });
        continue;
      }

      // Resolve catalog refs
      const customerCanonical = resolveCustomer(r.customerName, customers);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      // Build line item — qty in MT in the sheet, stored as MT in the line.
      const lineItem: OrderLineItem = {
        id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: productRefs.productName,
        productDisplayName: productRefs.productDisplayName,
        productKey: productRefs.productKey,
        qty: r.quantityMT,
        contractNumber: '',
        netWeightPerUnit: 0,
        totalWeight: r.quantityMT * 1000, // MT → KG for totalWeight
        unitAmount: 0,
        mtAmount: 0,
        lineAmount: 0,
      };

      const newOrder: Order = {
        id: `ORD-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        bolNumber: r.bolNumber,
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: r.poNumber,
        date: r.shipmentDate,
        shipmentDate: r.shipmentDate,
        deliveryDate: r.deliveryDate,
        status: 'Open',
        lineItems: [lineItem],
        amount: 0,
        carrier: carrierCanonical || undefined,
      };

      result.newOrders.push(newOrder);
      if (bolU) addedBOLs.add(bolU);
      if (poU) addedPOs.add(poU);
    } catch (err) {
      result.errors.push({
        tab: r.tab,
        rowIdx: r.rowIdx,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Top-level sync orchestrator                                         */
/* ------------------------------------------------------------------ */

export async function syncOrdersSheet(opts: {
  existingOrders: Order[];
  customers: Customer[];
  skus: SKU[];
  qaProducts: QAProduct[];
  carriers: Carrier[];
}): Promise<OrderSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: OrderSyncResult['errors'] = [];

  for (const tab of ORDER_TABS) {
    try {
      const csv = await fetchOrderTabCSV(tab);
      const rows = parseCSV(csv);
      const parsed = tab === 'Molasses' ? parseMolassesTab(rows) : parseStandardOrderTab(rows, tab);
      allParsed.push(...parsed);
    } catch (err) {
      fetchErrors.push({
        tab,
        rowIdx: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = parsedRowsToOrders(
    allParsed,
    opts.existingOrders,
    opts.customers,
    opts.skus,
    opts.qaProducts,
    opts.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}
