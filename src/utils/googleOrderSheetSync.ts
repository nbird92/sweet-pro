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

/** Single-order cap. One truckload ≈ 100 MT / 100,000 kg; anything larger is
 *  almost certainly a unit mix-up in the sheet (e.g. kg pasted into the MT
 *  column) and gets surfaced in the preview's Skipped list. */
export const MAX_ORDER_MT = 100;

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
  /** Contract number from the sheet (column W on LIQ/TOT/DRY, N on Molasses) */
  contractNumber: string;
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

/**
 * True if ANY cell in the row contains text that signals cancellation.
 * Matches: "cancel" / "cancelled" / "cancellation", "void", "cxl", "DNL"
 * (do-not-load), or a cell that is exactly "x" / "X" (case-insensitive).
 * Used as the CSV-path fallback when we can't read cell formatting.
 */
function rowHasCancelKeyword(row: string[]): boolean {
  for (const cell of row) {
    if (!cell) continue;
    const s = cell.trim();
    if (!s) continue;
    if (/cancel/i.test(s)) return true;
    if (/\bvoid\b/i.test(s)) return true;
    if (/\bcxl\b/i.test(s)) return true;
    if (/\bdnl\b/i.test(s)) return true;
    if (/^x$/i.test(s)) return true;
  }
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
    const contractRaw = cell(row, 22); // W = CONTRACT
    const invoiceBV = cell(row, COL_BV_INDEX); // BV
    let status = statusCol >= 0 ? cell(row, statusCol) : '';

    // Empty / placeholder row — skip
    if (!customer && !bol && !po && !product) continue;
    // Sheet has many template rows with "BL Number" placeholder in column L.
    if (bol.toLowerCase() === 'bl number') continue;

    // Cancel-keyword anywhere in the row → mark status so isCancelledStatus()
    // skips the row downstream and the preview shows a clear reason.
    if (!status && rowHasCancelKeyword(row)) status = 'CANCELLED (keyword in row)';

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
      // NaN here when the cell was blank or non-numeric — the converter
      // skips those rows with a clear reason rather than importing qty 0.
      quantityMT: qty,
      invoiceNumber: invoiceBV,
      status,
      contractNumber: contractRaw,
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
    const contractRaw = cell(row, 13); // N P CONTRACT
    let status = statusCol >= 0 ? cell(row, statusCol) : '';

    if (!customer && !po && !bolDateRaw) continue;
    // User asked us to skip transfers in the shipment sheet — same call here:
    // anything tagged TRANSFER- in the PO column is an internal transfer.
    if (po.toUpperCase().startsWith('TRANSFER')) continue;

    if (!status && rowHasCancelKeyword(row)) status = 'CANCELLED (keyword in row)';

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
      // NaN here when the cell was blank or non-numeric — the converter
      // skips those rows with a clear reason rather than importing qty 0.
      quantityMT: qty,
      invoiceNumber: '', // Molasses tab has no BV invoice column
      status,
      contractNumber: contractRaw,
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
      // Require an explicit BOL number. Previously we accepted rows with
      // a PO but no BOL — those imported with bolNumber:'' and the app's
      // BOL backfill then assigned them sequential ids like P000019,
      // which surfaced as "phantom" orders the user couldn't find in the
      // source sheet. The BOL must come from the sheet.
      if (!r.bolNumber || !r.bolNumber.trim()) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'Row has no BOL number',
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
      // Need a real ordered quantity. Blank cells, text like "TBD", and any
      // value <= 0 are skipped — we should never create a 0-MT order.
      if (!Number.isFinite(r.quantityMT) || r.quantityMT <= 0) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: 'Quantity is blank or not a positive number',
        });
        continue;
      }
      // A single order can't be more than one full truckload (100 MT /
      // 100,000 kg). Larger values are almost always a unit mix-up in the
      // sheet (e.g. kg pasted into the MT column) and would import as
      // nonsensical multi-truckload orders.
      if (r.quantityMT > MAX_ORDER_MT) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: `Quantity ${r.quantityMT} MT exceeds the ${MAX_ORDER_MT} MT maximum per order`,
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
        contractNumber: r.contractNumber || '',
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
        contractNumber: r.contractNumber || undefined,
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

/* ====================================================================== */
/* Configurable importer — any sheet, any tab, any column layout          */
/* ====================================================================== */
/*
 * The functions above sync from a hardcoded sheet + tab list. The block
 * below makes the importer generic: callers supply a SheetImportConfig
 * describing which sheet to pull, which tabs to read, and how each tab's
 * columns map onto the canonical order fields. The matching/dedupe logic
 * (resolveCustomer / resolveProduct / resolveCarrier / parsedRowsToOrders)
 * is reused verbatim.
 *
 * The default Sucro Shipment-Log preset is exported as
 * DEFAULT_ORDER_IMPORT_CONFIG so callers can fall back to it.
 */

/** Per-field column index mapping. All fields except customer + bolNumber
 *  + quantityMT are optional; missing fields are treated as empty cells. */
export interface ColumnMap {
  customer?: number;
  shipTo?: number;
  poNumber?: number;
  product?: number;
  carrier?: number;
  bolNumber?: number;
  shipmentDate?: number;
  deliveryDate?: number;
  quantityMT?: number;
  invoiceNumber?: number;
  status?: number;
  contractNumber?: number;
}

export interface ConfiguredTab {
  tabName: string;
  columns: ColumnMap;
  /** Hint for QA-format disambiguation (Tote, Bulk, Liquid, Molasses, ...). */
  expectedFormat?: string;
  /** Per-unit weight in kg; tab default for tote rows. 0 leaves qty in MT. */
  netWeightPerUnitKg?: number;
  /** If a product cell is blank, use this string instead (e.g. "Molasses"). */
  productFallback?: string;
  /** PO prefixes to skip (e.g. "TRANSFER" for the Molasses tab). */
  skipPoPrefixes?: string[];
}

export interface SheetImportConfig {
  /** Display name for the saved preset (e.g. "Sucro Shipment Log"). */
  name: string;
  /** Spreadsheet ID extracted from the URL. */
  sheetId: string;
  /** Tabs to import. */
  tabs: ConfiguredTab[];
  /**
   * Optional Google Sheets API v4 key. When provided, the importer fetches
   * tab data via the Sheets API with includeGridData=true so it can read
   * cell formatting (background colour, strikethrough). Without a key the
   * importer falls back to the public CSV endpoint, which strips formatting.
   */
  apiKey?: string;
}

/** "0 → A, 1 → B, ..., 25 → Z, 26 → AA, 27 → AB, ..." */
export function columnLetter(idx: number): string {
  if (idx < 0) return '';
  let n = idx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/** Extract the spreadsheet ID from any Google Sheets URL form. */
export function extractSheetId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // Already an ID
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Fetch a tab's CSV from an arbitrary sheet (no hardcoded ID). */
export async function fetchTabFromSheet(sheetId: string, tabName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch tab "${tabName}": HTTP ${res.status}. The sheet must be shared "Anyone with the link can view".`,
    );
  }
  return await res.text();
}

/* ------------------------------------------------------------------ */
/* Sheets API v4 fetcher (with formatting)                              */
/* ------------------------------------------------------------------ */

/** Returned by the API-aware fetcher: CSV-equivalent values, plus a set of
 *  row indices (0-based against `values`, header at index 0) where the row
 *  was flagged as cancelled via cell formatting (strikethrough OR red fill).
 */
export interface FetchedTabWithFormat {
  values: string[][];
  cancelledRowIndices: Set<number>;
}

/** Crude "is this red?" check on a Sheets API color object. The API returns
 *  RGB values in [0,1]. We treat anything with strong red dominance over
 *  green + blue as "red fill" — same heuristic the user described
 *  ("highlighted red"). */
function isRedColor(color: { red?: number; green?: number; blue?: number } | undefined): boolean {
  if (!color) return false;
  const r = color.red ?? 0;
  const g = color.green ?? 0;
  const b = color.blue ?? 0;
  return r >= 0.7 && g <= 0.5 && b <= 0.5;
}

/**
 * Fetch a tab via Sheets API v4 with grid data so we can detect
 * strikethrough + red background formatting. Requires the caller-supplied
 * apiKey to have Sheets API enabled. Throws with a helpful message on
 * 403 (key restriction, API not enabled, sheet not public).
 */
export async function fetchTabFromSheetsAPI(
  sheetId: string,
  tabName: string,
  apiKey: string,
): Promise<FetchedTabWithFormat> {
  const range = encodeURIComponent(tabName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=${range}&includeGridData=true&fields=sheets(properties(title),data(rowData(values(formattedValue,effectiveFormat(textFormat(strikethrough),backgroundColor)))))&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Sheets API request for tab "${tabName}" failed: HTTP ${res.status}. ${text || ''}\nCheck: (1) the API key is valid and has the Google Sheets API enabled, (2) the sheet is shared "Anyone with the link can view", (3) the tab name matches exactly.`,
    );
  }
  const json = await res.json();
  const sheet = json.sheets?.[0];
  if (!sheet) throw new Error(`Sheets API returned no sheet data for "${tabName}".`);
  const rowData = sheet.data?.[0]?.rowData || [];
  const values: string[][] = [];
  const cancelledRowIndices = new Set<number>();
  for (let i = 0; i < rowData.length; i++) {
    const cells = rowData[i].values || [];
    const rowValues: string[] = [];
    let rowCancelled = false;
    for (const cell of cells) {
      rowValues.push(cell.formattedValue ?? '');
      const fmt = cell.effectiveFormat;
      if (fmt?.textFormat?.strikethrough === true) rowCancelled = true;
      if (isRedColor(fmt?.backgroundColor)) rowCancelled = true;
    }
    values.push(rowValues);
    if (rowCancelled && i > 0) cancelledRowIndices.add(i); // skip header row
  }
  return { values, cancelledRowIndices };
}

/** Fetch the header row + first 5 sample rows of a tab for the column-mapping UI. */
export async function fetchTabPreview(
  sheetId: string,
  tabName: string,
): Promise<{ headers: string[]; sampleRows: string[][] }> {
  const csv = await fetchTabFromSheet(sheetId, tabName);
  const rows = parseCSV(csv);
  const headers = rows[0] || [];
  const sampleRows = rows.slice(1, 6);
  return { headers, sampleRows };
}

/**
 * Best-effort column auto-detection from header text. Returns a ColumnMap
 * where each field points at the first header matching a known keyword
 * pattern, or undefined if nothing matches.
 */
export function autoDetectColumns(headers: string[]): ColumnMap {
  const lower = headers.map(h => (h || '').trim().toLowerCase());
  const find = (test: (h: string) => boolean): number | undefined => {
    const idx = lower.findIndex(test);
    return idx >= 0 ? idx : undefined;
  };
  return {
    customer: find(h => /^customer$|^client$/.test(h) || h === 'customer name'),
    shipTo: find(h => /^location$|ship[- ]?to/.test(h)),
    poNumber: find(h => h === 'po' || h === 'po #' || h === 'po number' || /purchase order/.test(h)),
    product: find(h => h === 'product' || h === 'sku' || h === 'item'),
    carrier: find(h => /carrier|trucking/.test(h)),
    bolNumber: find(h => h === 'bol' || h === 'bol #' || h === 'bol number' || /bill of lading/.test(h) || /^bol date$/.test(h)),
    shipmentDate: find(h => /^load(?:ing)? date$|^ship(?:ment)? date$|^bol date$/.test(h)),
    deliveryDate: find(h => /^deliver(?:y)? date$/.test(h)),
    quantityMT: find(h => /^qty|quantity|^ordered qty|qty shipped/.test(h)),
    invoiceNumber: find(h => h === 'invoice #' || h === 'invoice no' || h === 'invoice number'),
    status: find(h => h === 'status' || /cancel/.test(h)),
    contractNumber: find(h => h === 'contract' || h === 'contract #' || h === 'contract number' || h === 'p contract'),
  };
}

/** Parse a tab using a caller-supplied column map. When formattingCancelled
 *  is supplied (from the Sheets API path), any row whose 0-based index is in
 *  the set is flagged as cancelled via cell formatting, regardless of its
 *  text content. */
export function parseConfiguredTab(
  rows: string[][],
  tab: ConfiguredTab,
  formattingCancelled?: Set<number>,
): ParsedOrderRow[] {
  if (rows.length < 2) return [];
  const cm = tab.columns;
  const cell = (row: string[], idx: number | undefined): string =>
    idx === undefined || idx < 0 ? '' : (row[idx] ?? '').trim();

  const skipPrefixes = (tab.skipPoPrefixes || []).map(p => p.toUpperCase());

  const out: ParsedOrderRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const customer = cell(row, cm.customer);
    const shipTo = cell(row, cm.shipTo);
    const po = cell(row, cm.poNumber);
    let product = cell(row, cm.product);
    const carrier = cell(row, cm.carrier);
    const bol = cell(row, cm.bolNumber);
    const qtyRaw = cell(row, cm.quantityMT);
    const shipDateRaw = cell(row, cm.shipmentDate);
    const delivDateRaw = cell(row, cm.deliveryDate);
    const invoiceVal = cell(row, cm.invoiceNumber);
    const contractRaw = cell(row, cm.contractNumber);
    let status = cell(row, cm.status);

    // Empty / placeholder row — skip
    if (!customer && !bol && !po && !product) continue;
    if (bol.toLowerCase() === 'bl number') continue;
    if (skipPrefixes.some(p => po.toUpperCase().startsWith(p))) continue;

    // Cancel signals — in priority order:
    //  1. The Sheets API saw red-fill or strikethrough on any cell in this row
    //  2. The text "cancel" appears anywhere in the row
    //  3. The mapped Status column itself contains a cancel marker
    if (!status && formattingCancelled?.has(i)) {
      status = 'CANCELLED (red fill or strikethrough in sheet)';
    } else if (!status && rowHasCancelKeyword(row)) {
      status = 'CANCELLED (keyword in row)';
    }

    if (!product && tab.productFallback) product = tab.productFallback;

    const shipmentDate = parseSheetDate(shipDateRaw);
    const deliveryDate = parseSheetDate(delivDateRaw) || shipmentDate;
    const qty = parseFloat(qtyRaw);

    out.push({
      tab: tab.tabName,
      rowIdx: i + 1,
      bolNumber: bol,
      poNumber: po,
      customerName: customer,
      shipToName: shipTo,
      productRaw: product,
      carrierName: carrier,
      shipmentDate,
      deliveryDate,
      // NaN here when the cell was blank or non-numeric — the converter
      // skips those rows with a clear reason rather than importing qty 0.
      quantityMT: qty,
      invoiceNumber: invoiceVal,
      status,
      contractNumber: contractRaw,
    });
  }
  return out;
}

/**
 * Like parsedRowsToOrders but lets each ParsedOrderRow carry the tab's
 * expectedFormat + netWeightPerUnitKg override (looked up via tab name).
 * Falls back to tabDefaults() when the configured tab has no override —
 * preserves the LIQ/TOT/DRY/Molasses behaviour when those names are used.
 */
export function parsedRowsToOrdersConfigured(
  parsed: ParsedOrderRow[],
  configured: ConfiguredTab[],
  existingOrders: Order[],
  customers: Customer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Carrier[],
): OrderSyncResult {
  const tabByName = new Map<string, ConfiguredTab>();
  for (const t of configured) tabByName.set(t.tabName, t);
  // Monkey-patch resolveProduct + lineItem construction by re-implementing the
  // body of parsedRowsToOrders here so we can pick per-tab expectedFormat /
  // netWeightPerUnit. (Kept inline rather than refactoring the older function
  // to avoid disturbing the existing hardcoded sync.)
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
      if (isCancelledStatus(r.status)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Row marked cancelled (Status column)' });
        continue;
      }
      if (isInvoicedValue(r.invoiceNumber)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: `Already invoiced (${r.invoiceNumber.trim()})` });
        continue;
      }
      // Require an explicit BOL — see comment in parsedRowsToOrders. Empty
      // BOLs caused the app's backfill to assign phantom P0000XX numbers.
      if (!r.bolNumber || !r.bolNumber.trim()) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Row has no BOL number' });
        continue;
      }
      if (!r.shipmentDate) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Row has no shipment date' });
        continue;
      }
      // Skip blank / non-numeric / zero quantities — see parsedRowsToOrders.
      if (!Number.isFinite(r.quantityMT) || r.quantityMT <= 0) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Quantity is blank or not a positive number' });
        continue;
      }
      // One-truckload cap — see parsedRowsToOrders for rationale.
      if (r.quantityMT > MAX_ORDER_MT) {
        result.skipped.push({
          tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber,
          reason: `Quantity ${r.quantityMT} MT exceeds the ${MAX_ORDER_MT} MT maximum per order`,
        });
        continue;
      }
      const bolU = r.bolNumber.trim().toUpperCase();
      const poU = r.poNumber.trim().toUpperCase();
      if (bolU && (existingBOLs.has(bolU) || addedBOLs.has(bolU))) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'BOL already exists in orders table' });
        continue;
      }
      if (poU && (existingPOs.has(poU) || addedPOs.has(poU))) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'PO already exists in orders table' });
        continue;
      }

      // Per-tab defaults: explicit overrides from config > built-in tabDefaults
      const explicit = tabByName.get(r.tab);
      const builtIn = tabDefaults(r.tab);
      const expectedFormat = explicit?.expectedFormat ?? builtIn.expectedFormat;
      const netWeightPerUnitKg = explicit?.netWeightPerUnitKg ?? builtIn.netWeightPerUnitKg;

      const customerCanonical = resolveCustomer(r.customerName, customers);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      const totalWeightKg = r.quantityMT * 1000;
      const isTote = netWeightPerUnitKg > 0;
      const qty = isTote ? Math.round(totalWeightKg / netWeightPerUnitKg) : r.quantityMT;

      const lineItem: OrderLineItem = {
        id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: productRefs.productName,
        productDisplayName: productRefs.productDisplayName,
        productKey: productRefs.productKey,
        qty,
        contractNumber: r.contractNumber || '',
        netWeightPerUnit: netWeightPerUnitKg,
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
        contractNumber: r.contractNumber || undefined,
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
      result.errors.push({ tab: r.tab, rowIdx: r.rowIdx, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/**
 * Run a sync against an arbitrary sheet/config. Errors fetching individual
 * tabs are surfaced via the errors array — successful tabs still import.
 */
export async function syncOrdersFromConfig(
  config: SheetImportConfig,
  ctx: {
    existingOrders: Order[];
    customers: Customer[];
    skus: SKU[];
    qaProducts: QAProduct[];
    carriers: Carrier[];
  },
): Promise<OrderSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: OrderSyncResult['errors'] = [];
  const useApi = !!(config.apiKey && config.apiKey.trim());

  for (const tab of config.tabs) {
    try {
      if (useApi) {
        // Sheets API path — gets values AND formatting; can detect red fill
        // and strikethrough that the CSV endpoint silently strips.
        const { values, cancelledRowIndices } = await fetchTabFromSheetsAPI(
          config.sheetId, tab.tabName, config.apiKey!,
        );
        allParsed.push(...parseConfiguredTab(values, tab, cancelledRowIndices));
      } else {
        // CSV fallback — no formatting, keyword-only cancel detection.
        const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
        const rows = parseCSV(csv);
        allParsed.push(...parseConfiguredTab(rows, tab));
      }
    } catch (err) {
      fetchErrors.push({
        tab: tab.tabName,
        rowIdx: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = parsedRowsToOrdersConfigured(
    allParsed,
    config.tabs,
    ctx.existingOrders,
    ctx.customers,
    ctx.skus,
    ctx.qaProducts,
    ctx.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}

/**
 * Default preset that reproduces the original hardcoded behaviour — same
 * sheet, same four tabs, same column indices. Saved as the built-in
 * preset so users can start from this and tweak.
 */
export const DEFAULT_ORDER_IMPORT_CONFIG: SheetImportConfig = {
  name: 'Sucro Shipment Log (default)',
  sheetId: ORDER_SHEET_ID,
  tabs: [
    {
      tabName: 'LIQ',
      expectedFormat: 'Liquid',
      netWeightPerUnitKg: 0,
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, invoiceNumber: COL_BV_INDEX },
    },
    {
      tabName: 'TOT',
      expectedFormat: 'Tote',
      netWeightPerUnitKg: 1000,
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, invoiceNumber: COL_BV_INDEX },
    },
    {
      tabName: 'DRY',
      expectedFormat: 'Bulk',
      netWeightPerUnitKg: 0,
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, invoiceNumber: COL_BV_INDEX },
    },
    {
      tabName: 'Molasses',
      expectedFormat: 'Liquid',
      netWeightPerUnitKg: 0,
      productFallback: 'Molasses',
      skipPoPrefixes: ['TRANSFER'],
      columns: { customer: 3, poNumber: 4, carrier: 10, bolNumber: 9, quantityMT: 6, shipmentDate: 1, contractNumber: 13 },
    },
  ],
};

/** Canonical field list for the column-mapping UI (label + key). */
export const ORDER_FIELDS: Array<{ key: keyof ColumnMap; label: string; required?: boolean }> = [
  { key: 'customer', label: 'Customer', required: true },
  { key: 'shipTo', label: 'Ship To / Location' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'product', label: 'Product' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'bolNumber', label: 'BOL Number', required: true },
  { key: 'shipmentDate', label: 'Shipment Date', required: true },
  { key: 'deliveryDate', label: 'Delivery Date' },
  { key: 'quantityMT', label: 'Quantity (MT)', required: true },
  { key: 'contractNumber', label: 'Contract Number' },
  { key: 'invoiceNumber', label: 'Invoice # (skip if filled)' },
  { key: 'status', label: 'Status / Cancellation' },
];
