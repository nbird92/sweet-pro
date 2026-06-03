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
 * Strip dashes and spaces; upper-case. "GC-100" → "GC100", "LC 170" → "LC170".
 */
function normCode(s: string): string {
  return (s || '').replace(/[-\s]/g, '').toUpperCase();
}

/**
 * Strip trailing X (and any preceding dash/space) from a normalized code.
 * "LC100X" → "LC100", "LC170X" → "LC170", "GC100" → "GC100" (unchanged).
 * Only strips a SINGLE trailing X when the rest of the code still has digits,
 * so we never turn "X" or "AX" into a code that won't resolve sensibly.
 */
function stripTrailingX(code: string): string {
  const m = code.match(/^([A-Z]{2,3}\d+)X$/);
  return m ? m[1] : code;
}

/**
 * Build the list of candidate normalized codes to try, in priority order.
 *   "LC100X"  → ["LC100X", "LC100"]
 *   "GC-100"  → ["GC100"]
 *   "LC-170X" → ["LC170X", "LC170"]
 */
function buildCodeCandidates(raw: string): string[] {
  const c0 = normCode(raw);
  if (!c0) return [];
  const c1 = stripTrailingX(c0);
  return c1 !== c0 ? [c0, c1] : [c0];
}

/**
 * Lookup a QA product by candidate code. Matches QA.skuName (normalized)
 * and QA.productCode (normalized). When multiple QA variants share a code
 * (e.g. one "Tote" + one "Bulk" of GC100), prefers the one whose
 * productFormat matches the expectedFormat hint. Returns null if no match.
 */
function findQAByCode(
  code: string,
  qaProducts: QAProduct[],
  expectedFormat?: string,
): QAProduct | null {
  const matches: QAProduct[] = [];
  for (const q of qaProducts) {
    if (normCode(q.skuName) === code) matches.push(q);
    else if (q.productCode && normCode(q.productCode) === code) matches.push(q);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1 || !expectedFormat) return matches[0];
  const want = expectedFormat.toLowerCase();
  const preferred = matches.find(q => (q.productFormat || '').toLowerCase().includes(want));
  return preferred || matches[0];
}

/**
 * Lookup a SKU by candidate code. Matches SKU.name (normalized).
 */
function findSKUByCode(code: string, skus: SKU[]): SKU | null {
  for (const s of skus) {
    if (normCode(s.name) === code) return s;
  }
  return null;
}

/**
 * Resolve a raw product string from the sheet into a QA product (preferred)
 * or SKU. QA is the source of truth for the product catalog; we fall back to
 * SKU only when no QA variant exists.
 *
 * Resolution order:
 *   1. Build code candidates from the raw text (e.g. "LC100X" → ["LC100X", "LC100"]).
 *      For each candidate, try QA.skuName / QA.productCode match, then SKU.name match.
 *   2. Translation rules from user spec:
 *        "Totes <n>" / "Bulk <n>" → GC<n>      (e.g. "Totes 100" → "GC100")
 *        "Liquid <n>"             → LC<n>      (e.g. "Liquid 350" → "LC350")
 *        "Molasses"               → "Molasses" (if catalog has it)
 *      Each translated candidate is checked against QA first, then SKU.
 *   3. Substring match against QA.skuName, then SKU.name (last resort).
 *   4. Fallback: keep raw text (caller treats as "unmatched").
 */
function resolveProduct(
  raw: string,
  skus: SKU[],
  qaProducts: QAProduct[],
  expectedFormat?: string,
): { productName: string; productDisplayName?: string; productKey?: string } {
  if (!raw) return { productName: raw };
  const trimmed = raw.trim();
  const norm = trimmed.toLowerCase();

  // Helper: prefer a QA child of a matched SKU that fits expectedFormat.
  const qaChildForSKU = (skuId: string): QAProduct | null => {
    const children = qaProducts.filter(q => q.skuId === skuId);
    if (children.length === 0) return null;
    if (!expectedFormat || children.length === 1) return children[0];
    const want = expectedFormat.toLowerCase();
    return children.find(q => (q.productFormat || '').toLowerCase().includes(want)) || children[0];
  };

  // 1. Code-based candidates (covers "LC100X", "GC-100", "LC 170", etc).
  for (const cand of buildCodeCandidates(trimmed)) {
    const qa = findQAByCode(cand, qaProducts, expectedFormat);
    if (qa) {
      return { productName: qa.skuName, productDisplayName: qa.skuName, productKey: qa.id };
    }
    const sku = findSKUByCode(cand, skus);
    if (sku) {
      const qaChild = qaChildForSKU(sku.id);
      return {
        productName: qaChild?.skuName || sku.name,
        productDisplayName: qaChild?.skuName || sku.name,
        productKey: qaChild?.id || sku.id,
      };
    }
  }

  // 2. Translation rules
  const translated: string[] = [];
  const totesBulk = /^(?:totes?|bulk)\s*(\d+)/i.exec(trimmed);
  if (totesBulk) translated.push(`GC${totesBulk[1]}`);
  const liquid = /^liquid\s*(\d+)/i.exec(trimmed);
  if (liquid) translated.push(`LC${liquid[1]}`);
  if (norm === 'molasses') translated.push('MOLASSES');

  for (const cand of translated) {
    const qa = findQAByCode(cand, qaProducts, expectedFormat);
    if (qa) {
      return { productName: qa.skuName, productDisplayName: qa.skuName, productKey: qa.id };
    }
    const sku = findSKUByCode(cand, skus);
    if (sku) {
      const qaChild = qaChildForSKU(sku.id);
      return {
        productName: qaChild?.skuName || sku.name,
        productDisplayName: qaChild?.skuName || sku.name,
        productKey: qaChild?.id || sku.id,
      };
    }
  }
  // Molasses special case — match by name when no normalized code hit
  if (norm === 'molasses') {
    const qa = qaProducts.find(q => (q.skuName || '').trim().toLowerCase() === 'molasses');
    if (qa) {
      return { productName: qa.skuName, productDisplayName: qa.skuName, productKey: qa.id };
    }
    const sku = skus.find(s => (s.name || '').trim().toLowerCase() === 'molasses');
    if (sku) {
      const qaChild = qaChildForSKU(sku.id);
      return {
        productName: qaChild?.skuName || sku.name,
        productDisplayName: qaChild?.skuName || sku.name,
        productKey: qaChild?.id || sku.id,
      };
    }
  }

  // 3. Substring match (loose) — QA first
  const qaLoose = qaProducts.find(q => {
    const sn = (q.skuName || '').trim().toLowerCase();
    return sn && (sn.includes(norm) || norm.includes(sn));
  });
  if (qaLoose) {
    return { productName: qaLoose.skuName, productDisplayName: qaLoose.skuName, productKey: qaLoose.id };
  }
  const skuLoose = skus.find(s => {
    const sn = (s.name || '').trim().toLowerCase();
    return sn && (sn.includes(norm) || norm.includes(sn));
  });
  if (skuLoose) {
    const qaChild = qaChildForSKU(skuLoose.id);
    return {
      productName: qaChild?.skuName || skuLoose.name,
      productDisplayName: qaChild?.skuName || skuLoose.name,
      productKey: qaChild?.id || skuLoose.id,
    };
  }

  // 4. Fallback — keep raw (will show as unmatched in the preview)
  return { productName: trimmed };
}

/**
 * Per-tab defaults: expected QA productFormat (used to disambiguate when
 * multiple QA variants share a code) and the per-unit weight in kg
 * (Totes are 1000 kg each by user spec; everything else is bulk/loose).
 */
function tabDefaults(tab: string): { expectedFormat?: string; netWeightPerUnitKg: number } {
  const t = (tab || '').toUpperCase();
  if (t === 'TOT') return { expectedFormat: 'Tote', netWeightPerUnitKg: 1000 };
  if (t === 'DRY') return { expectedFormat: 'Bulk', netWeightPerUnitKg: 0 };
  if (t === 'LIQ') return { expectedFormat: 'Liquid', netWeightPerUnitKg: 0 };
  if (t === 'MOLASSES') return { expectedFormat: 'Liquid', netWeightPerUnitKg: 0 };
  return { netWeightPerUnitKg: 0 };
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
      const defaults = tabDefaults(r.tab);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, defaults.expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      // Build line item.
      //
      // Sheet column M is ORDERED QTY (MT). For tote orders each tote is
      // 1,000 kg = 1 MT, so the MT figure equals the number of totes; we
      // store qty as units (number of totes) and netWeightPerUnit = 1000.
      // For bulk / liquid / molasses tabs we have no fixed per-unit weight,
      // so qty stays in MT and netWeightPerUnit is 0 (legacy behaviour).
      const totalWeightKg = r.quantityMT * 1000;
      const isTote = defaults.netWeightPerUnitKg > 0;
      const qty = isTote
        ? Math.round(totalWeightKg / defaults.netWeightPerUnitKg) // number of totes
        : r.quantityMT;

      const lineItem: OrderLineItem = {
        id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: productRefs.productName,
        productDisplayName: productRefs.productDisplayName,
        productKey: productRefs.productKey,
        qty,
        contractNumber: '',
        netWeightPerUnit: defaults.netWeightPerUnitKg,
        totalWeight: totalWeightKg,
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
