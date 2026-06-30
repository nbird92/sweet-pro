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

import type { Order, OrderLineItem, Customer, SKU, QAProduct, Carrier, Invoice, Shipment, Transfer } from '../types';
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
  /** Split / sub-shipment number from the sheet (column R on LIQ/TOT/DRY) */
  splitNumber: string;
  /** Price per metric tonne (used when building Invoices). */
  pricePerMt: number;
  /** Bay / dock value (used when building Shipments). */
  bay: string;
  /** Appointment time slot (used when building Shipments). */
  appointmentTime: string;
  /** Origin location (used when building Transfers). */
  fromLocation: string;
  /** Destination location (used when building Transfers). */
  toLocation: string;
  /** Transfer number from the sheet (used when building Transfers). */
  transferNumber: string;
  /** Lot code (used when building Transfers). */
  lotCode: string;
  /** PAPS number — cross-border customs pre-arrival ref (orders + invoices). */
  papsNo: string;
  /** Customs entry number (orders + invoices). */
  customsEntryNo: string;
  /** Reversals — credit/reversal reference or amount (invoices). */
  reversals: string;
}

export interface OrderSyncResult {
  newOrders: Order[];
  /** Existing orders patched with previously-missing info (Price/MT, contract,
   *  carrier, dates, etc.) when a sheet row matches their BOL or PO. */
  updatedOrders?: Order[];
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
    const splitRaw = cell(row, 17);    // R = SPLIT
    const priceRaw = cell(row, 23);    // X = PRICE PER MT
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
      splitNumber: splitRaw,
      pricePerMt: (() => { const n = parseFloat(priceRaw); return Number.isFinite(n) ? n : 0; })(),
      bay: '',
      appointmentTime: '',
      fromLocation: '',
      toLocation: '',
      transferNumber: '',
      lotCode: '',
      papsNo: '',
      customsEntryNo: '',
      reversals: '',
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
      splitNumber: '', // Molasses tab has no split column
      pricePerMt: 0,
      bay: '',
      appointmentTime: '',
      fromLocation: '',
      toLocation: '',
      transferNumber: '',
      lotCode: lot, // Molasses lot # doubles as the transfer lot code
      papsNo: '',
      customsEntryNo: '',
      reversals: '',
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
 * Recursively remove keys whose value is `undefined`. Firestore writes
 * reject documents containing `undefined`; we run this on every imported
 * order as a defensive last line so a future conditional that happens to
 * leave an undefined field doesn't break the whole sync.
 *
 * Preserves arrays, primitives, and null. Empty strings, 0, false stay.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
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
 * and QA.productCode (normalized).
 *
 * Format hint semantics:
 *   - No hint: return the first match (legacy).
 *   - Hint given: STRICT. Only return a QA whose productFormat actually
 *     contains the hint substring (case-insensitive). If no QA has the
 *     expected format we return null so the caller treats the product as
 *     unmatched — silently returning a wrong-format variant (e.g. "20kg
 *     GC45" Bagged for a Bulk order) was the cause of B-prefix BOLs being
 *     imported as packaged products.
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
  if (!expectedFormat) return matches[0];
  const want = expectedFormat.toLowerCase();
  const preferred = matches.find(q => (q.productFormat || '').toLowerCase().includes(want));
  // Strict: never substitute a wrong-format variant when a format was asked
  // for. The caller will fall through to the SKU/raw-text path with the
  // unmatched flag visible in the preview.
  return preferred || null;
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

  // Helper: pick a QA child of a matched SKU. Strict on format hint —
  // returns null when none of the children match the requested format
  // (caller treats the product as unmatched rather than substituting a
  // wrong-format variant).
  const qaChildForSKU = (skuId: string): QAProduct | null => {
    const children = qaProducts.filter(q => q.skuId === skuId);
    if (children.length === 0) return null;
    if (!expectedFormat) return children[0];
    const want = expectedFormat.toLowerCase();
    return children.find(q => (q.productFormat || '').toLowerCase().includes(want)) || null;
  };

  // Helper: check a SKU's own productFormat against the hint (covers SKUs
  // that have no QA children).
  const skuMatchesFormat = (sku: SKU): boolean => {
    if (!expectedFormat) return true;
    const fmt = ((sku as any).productFormat || '').toString().toLowerCase();
    if (!fmt) return false;
    return fmt.includes(expectedFormat.toLowerCase());
  };

  // 1. Code-based candidates (covers "LC100X", "GC-100", "LC 170", etc).
  for (const cand of buildCodeCandidates(trimmed)) {
    const qa = findQAByCode(cand, qaProducts, expectedFormat);
    if (qa) {
      return { productName: qa.skuName, productDisplayName: qa.skuName, productKey: qa.id };
    }
    const sku = findSKUByCode(cand, skus);
    if (sku) {
      // Try a format-matching QA child first; if no child fits the format
      // and the SKU itself doesn't match the format, skip — the caller
      // continues with translation / substring / raw fallback.
      const qaChild = qaChildForSKU(sku.id);
      if (qaChild) {
        return { productName: qaChild.skuName, productDisplayName: qaChild.skuName, productKey: qaChild.id };
      }
      if (skuMatchesFormat(sku)) {
        return { productName: sku.name, productDisplayName: sku.name, productKey: sku.id };
      }
      // Wrong format — keep looking.
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
      if (qaChild) {
        return { productName: qaChild.skuName, productDisplayName: qaChild.skuName, productKey: qaChild.id };
      }
      if (skuMatchesFormat(sku)) {
        return { productName: sku.name, productDisplayName: sku.name, productKey: sku.id };
      }
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
      if (qaChild) {
        return { productName: qaChild.skuName, productDisplayName: qaChild.skuName, productKey: qaChild.id };
      }
      if (skuMatchesFormat(sku)) {
        return { productName: sku.name, productDisplayName: sku.name, productKey: sku.id };
      }
    }
  }

  // 3. Substring match (loose) — QA first. Only consider QAs matching the
  // expected format when a hint is set.
  const qaLoose = qaProducts.find(q => {
    const sn = (q.skuName || '').trim().toLowerCase();
    if (!sn || !(sn.includes(norm) || norm.includes(sn))) return false;
    if (!expectedFormat) return true;
    return (q.productFormat || '').toLowerCase().includes(expectedFormat.toLowerCase());
  });
  if (qaLoose) {
    return { productName: qaLoose.skuName, productDisplayName: qaLoose.skuName, productKey: qaLoose.id };
  }
  const skuLoose = skus.find(s => {
    const sn = (s.name || '').trim().toLowerCase();
    if (!sn || !(sn.includes(norm) || norm.includes(sn))) return false;
    return skuMatchesFormat(s);
  });
  if (skuLoose) {
    const qaChild = qaChildForSKU(skuLoose.id);
    if (qaChild) {
      return { productName: qaChild.skuName, productDisplayName: qaChild.skuName, productKey: qaChild.id };
    }
    return { productName: skuLoose.name, productDisplayName: skuLoose.name, productKey: skuLoose.id };
  }

  // 4. Fallback — keep raw, but normalized (strip dashes/spaces). So
  // "GC-45" surfaces in the preview as "GC45" rather than "GC-45".
  const cleaned = trimmed.replace(/-/g, '').replace(/\s+/g, ' ').trim();
  return { productName: cleaned };
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
      // BOL-prefix override (see parsedRowsToOrdersConfigured): B=Bulk,
      // P=Bagged. Prevents a Bulk-prefixed BOL from resolving to a
      // packaged QA variant when the catalog has both.
      const bolPrefix = (r.bolNumber || '').trim().charAt(0).toUpperCase();
      let expectedFormat = defaults.expectedFormat;
      if (bolPrefix === 'B') expectedFormat = 'Bulk';
      else if (bolPrefix === 'P') expectedFormat = 'Bagged';
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      // Build line item.
      //
      // Sheet column M is ORDERED QTY (MT). For tote orders each tote is
      // 1,000 kg = 1 MT, so the MT figure equals the number of totes; we
      // store qty as units (number of totes) and netWeightPerUnit = 1000.
      // For bulk / liquid / molasses tabs we have no fixed per-unit weight,
      // so qty stays in MT and netWeightPerUnit is 0 (legacy behaviour).
      // App convention: OrderLineItem.totalWeight is stored in MT, and every
      // display site multiplies by 1000 to render kg. Storing kg here was a
      // bug that surfaced as 1000x weights (e.g. 30,000,000 kg shown for a
      // 30 MT order). Keep MT here; downstream code does the conversion.
      const totalWeightMT = r.quantityMT;
      const totalWeightKg = totalWeightMT * 1000; // for the tote-qty division below
      const isTote = defaults.netWeightPerUnitKg > 0;
      const qty = isTote
        ? Math.round(totalWeightKg / defaults.netWeightPerUnitKg) // number of totes
        : totalWeightMT;                                          // MT for bulk/liquid

      const lineItem: OrderLineItem = {
        id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: productRefs.productName,
        qty,
        contractNumber: r.contractNumber || '',
        netWeightPerUnit: defaults.netWeightPerUnitKg,
        totalWeight: totalWeightMT,
        unitAmount: 0,
        mtAmount: 0,
        lineAmount: 0,
        // Optional fields — omit when missing so Firestore doesn't choke
        // on undefined values.
        ...(productRefs.productDisplayName ? { productDisplayName: productRefs.productDisplayName } : {}),
        ...(productRefs.productKey ? { productKey: productRefs.productKey } : {}),
      };

      // Build the order WITHOUT undefined-valued optional fields. Firestore
      // rejects writes containing `undefined`; conditional spread ensures
      // empty optionals are omitted from the object entirely instead of
      // landing as undefined values.
      const newOrder: Order = {
        id: `ORD-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        bolNumber: r.bolNumber,
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: r.poNumber,
        date: r.shipmentDate,
        shipmentDate: r.shipmentDate,
        deliveryDate: r.deliveryDate || '',
        status: 'Open',
        lineItems: [lineItem],
        amount: 0,
        ...(r.contractNumber ? { contractNumber: r.contractNumber } : {}),
        ...(r.splitNumber ? { splitNumber: r.splitNumber } : {}),
        ...(carrierCanonical ? { carrier: carrierCanonical } : {}),
      };

      result.newOrders.push(stripUndefined(newOrder));
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
  splitNumber?: number;
  /** Price per MT — used by the invoice-sync path; multiplied by quantityMT
   *  to produce Invoice.amount. */
  pricePerMt?: number;
  /** Bay / dock — used by the shipment-sync path; written to Shipment.bay. */
  bay?: number;
  /** Appointment time — used by the shipment-sync path; written to Shipment.time. */
  appointmentTime?: number;
  /** Origin location — used by the transfer-sync path; written to Transfer.from. */
  fromLocation?: number;
  /** Destination location — used by the transfer-sync path; written to Transfer.to. */
  toLocation?: number;
  /** Transfer number — used by the transfer-sync path; written to Transfer.transferNumber. */
  transferNumber?: number;
  /** Lot code — used by the transfer-sync path; written to Transfer.lotCode. */
  lotCode?: number;
  /** PAPS number — cross-border customs pre-arrival ref (orders + invoices). */
  papsNo?: number;
  /** Customs entry number (orders + invoices). */
  customsEntryNo?: number;
  /** Reversals — credit/reversal reference or amount for an invoice. */
  reversals?: number;
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
  /**
   * Shipping origin (Location.name) for orders imported from this tab.
   * Stamped on Order.location; chosen from the app's Locations table in
   * the configurator UI. Separate from the per-row Ship-To column, which
   * carries the destination customer site.
   */
  defaultLocation?: string;
}

export interface SheetImportConfig {
  /** Display name for the saved preset (e.g. "Sucro Shipment Log"). */
  name: string;
  /** Spreadsheet ID extracted from the URL. */
  sheetId: string;
  /** Tabs to import. */
  tabs: ConfiguredTab[];
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

/** Fetch a tab's CSV from an arbitrary sheet (no hardcoded ID).
 *
 *  Tries the SERVICE-ACCOUNT route first (`/api/sheet-tab`), so a PRIVATE sheet
 *  shared only with the service account imports without "Anyone with the link".
 *  Falls back to the public gviz CSV URL for sheets that are link-viewable. */
export async function fetchTabFromSheet(sheetId: string, tabName: string): Promise<string> {
  let saError: string | null = null;
  // 1. Service-account-backed server route (works on a privately-shared sheet).
  try {
    const params = new URLSearchParams({ sheetId, tab: tabName });
    const headers: Record<string, string> = {};
    const accessKey = (import.meta as any).env?.VITE_APP_ACCESS_KEY;
    if (accessKey) headers['x-access-key'] = accessKey;
    const res = await fetch(`/api/sheet-tab?${params.toString()}`, { headers });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim()) return text;
    } else {
      const body = await res.json().catch(() => null);
      saError = body?.error || `service-account import failed (HTTP ${res.status}).`;
    }
  } catch (e) {
    // Network / endpoint-missing (e.g. local dev) — fall through to the public URL.
    saError = e instanceof Error ? e.message : String(e);
  }

  // 2. Fallback: public gviz CSV (only works when the sheet is link-viewable; a
  //    private sheet redirects to an HTML login page, which we must NOT treat as data).
  try {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
    const res = await fetch(url, { method: 'GET' });
    const ct = res.headers.get('content-type') || '';
    const text = res.ok ? await res.text() : '';
    if (text && !/^\s*</.test(text) && !ct.includes('text/html')) return text;
  } catch { /* handled below */ }

  // Both routes failed. Prefer the service-account message (that's the path set up
  // for a private sheet) over the generic public-sharing one.
  throw new Error(
    saError
      ? `Couldn't import tab "${tabName}". ${saError}`
      : `Failed to fetch tab "${tabName}". Share it with the service account email, or set the sheet to "Anyone with the link can view".`,
  );
}


/** Fetch the header row + first 5 sample rows of a tab for the column-mapping UI.
 *  Auto-detects WHICH row is the header: sheets often have a title/blank row 1
 *  with the real headers in row 2. We pick the earliest of the first few rows
 *  with the most non-empty cells (a title/blank row has few; the header row is
 *  fully populated; data rows that follow can't win because ties keep the earlier
 *  row), so a sheet whose headers live in row 2 maps correctly. */
export async function fetchTabPreview(
  sheetId: string,
  tabName: string,
): Promise<{ headers: string[]; sampleRows: string[][] }> {
  const csv = await fetchTabFromSheet(sheetId, tabName);
  const rows = parseCSV(csv);
  const nonEmpty = (r: string[]) => (r || []).reduce((n, c) => n + ((c || '').trim() ? 1 : 0), 0);
  let headerIdx = 0;
  const scan = Math.min(rows.length, 4);
  for (let i = 1; i < scan; i++) {
    if (nonEmpty(rows[i]) > nonEmpty(rows[headerIdx])) headerIdx = i;
  }
  const headers = rows[headerIdx] || [];
  const sampleRows = rows.slice(headerIdx + 1, headerIdx + 6);
  return { headers, sampleRows };
}

/**
 * Best-effort column auto-detection from header text. Returns a ColumnMap
 * where each field points at the first column whose header matches a known
 * keyword pattern, or undefined if nothing matches.
 *
 * Accepts ONE OR MORE header rows: some sheets put a title/blank in row 1 and
 * the real headers in row 2, so each field is matched against every provided
 * row and resolves to the first column that matches in ANY of them.
 */
export function autoDetectColumns(...headerRows: string[][]): ColumnMap {
  const rows = headerRows.filter(r => Array.isArray(r) && r.length > 0);
  const lowerRows = (rows.length ? rows : [[]]).map(r => r.map(h => (h || '').trim().toLowerCase()));
  const width = lowerRows.reduce((w, r) => Math.max(w, r.length), 0);
  const find = (test: (h: string) => boolean): number | undefined => {
    for (let c = 0; c < width; c++) {
      if (lowerRows.some(lr => lr[c] !== undefined && test(lr[c]))) return c;
    }
    return undefined;
  };
  return {
    customer: find(h => /^customer$|^client$/.test(h) || h === 'customer name'),
    shipTo: find(h => /ship[- ]?to/.test(h) || h === 'location' || h === 'destination'),
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
    splitNumber: find(h => h === 'split' || h === 'split #' || h === 'split number' || h === 'split no'),
    pricePerMt: find(h => /^price\s*(per\s*)?mt$|^price\/mt$|^unit price$/.test(h)),
    bay: find(h => h === 'bay' || h === 'dock' || h === 'bay #' || h === 'dock #'),
    appointmentTime: find(h => h === 'time' || h === 'appointment' || h === 'appt time' || h === 'appointment time'),
    fromLocation: find(h => h === 'from' || h === 'origin' || h === 'from location' || /^transfer from$|^ship from$/.test(h)),
    toLocation: find(h => h === 'to' || h === 'destination' || h === 'to location' || /^transfer to$|^ship to$/.test(h)),
    transferNumber: find(h => h === 'transfer' || h === 'transfer #' || h === 'transfer no' || h === 'transfer number' || h === 'transfer no.'),
    lotCode: find(h => h === 'lot' || h === 'lot #' || h === 'lot code' || h === 'lot no' || h === 'lot#'),
    papsNo: find(h => h === 'paps' || h === 'paps #' || h === 'paps no' || h === 'paps no.' || h === 'paps number'),
    customsEntryNo: find(h => /customs entry|entry no|entry number|entry #/.test(h) || h === 'customs entry' || h === 'customs no'),
    reversals: find(h => /reversal/.test(h)),
  };
}

/** Parse a tab using a caller-supplied column map. */
export function parseConfiguredTab(
  rows: string[][],
  tab: ConfiguredTab,
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
    const splitRaw = cell(row, cm.splitNumber);
    const priceRawC = cell(row, cm.pricePerMt);
    const bayRaw = cell(row, cm.bay);
    const apptTimeRaw = cell(row, cm.appointmentTime);
    const fromRaw = cell(row, cm.fromLocation);
    const toRaw = cell(row, cm.toLocation);
    const transferNoRaw = cell(row, cm.transferNumber);
    const lotRaw = cell(row, cm.lotCode);
    const papsRaw = cell(row, cm.papsNo);
    const customsEntryRaw = cell(row, cm.customsEntryNo);
    const reversalsRaw = cell(row, cm.reversals);
    let status = cell(row, cm.status);

    // Empty / placeholder row — skip. Transfer rows may have no customer/BOL,
    // so from/to/transfer-number presence also counts as a non-empty row.
    if (!customer && !bol && !po && !product && !fromRaw && !toRaw && !transferNoRaw) continue;
    if (bol.toLowerCase() === 'bl number') continue;
    if (skipPrefixes.some(p => po.toUpperCase().startsWith(p))) continue;

    // Cancel signal: any cell in the row containing "cancel", "void", "cxl",
    // "dnl", or just "x". The mapped Status column is checked first by
    // virtue of being read into `status` above.
    if (!status && rowHasCancelKeyword(row)) {
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
      splitNumber: splitRaw,
      pricePerMt: (() => { const n = parseFloat(priceRawC); return Number.isFinite(n) ? n : 0; })(),
      bay: bayRaw,
      appointmentTime: apptTimeRaw,
      fromLocation: fromRaw,
      toLocation: toRaw,
      transferNumber: transferNoRaw,
      lotCode: lotRaw,
      papsNo: papsRaw,
      customsEntryNo: customsEntryRaw,
      reversals: reversalsRaw,
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
  existingInvoices: Invoice[] = [],
): OrderSyncResult {
  const tabByName = new Map<string, ConfiguredTab>();
  for (const t of configured) tabByName.set(t.tabName, t);
  // Monkey-patch resolveProduct + lineItem construction by re-implementing the
  // body of parsedRowsToOrders here so we can pick per-tab expectedFormat /
  // netWeightPerUnit. (Kept inline rather than refactoring the older function
  // to avoid disturbing the existing hardcoded sync.)
  const result: OrderSyncResult = { newOrders: [], updatedOrders: [], skipped: [], errors: [] };
  // Map existing orders by BOL and by PO so a matching row can UPDATE the order
  // (fill missing fields) instead of being skipped.
  const existingOrderByBol = new Map<string, Order>();
  const existingOrderByPo = new Map<string, Order>();
  for (const o of existingOrders) {
    const b = (o.bolNumber || '').trim().toUpperCase();
    const p = (o.po || '').trim().toUpperCase();
    if (b && !existingOrderByBol.has(b)) existingOrderByBol.set(b, o);
    if (p && !existingOrderByPo.has(p)) existingOrderByPo.set(p, o);
  }
  const addedBOLs = new Set<string>();
  const addedPOs = new Set<string>();
  const updatedIds = new Set<string>();

  // BOLs / POs that have already been invoiced (excluding Cancelled / Credit) —
  // an invoiced BOL or PO can no longer be an order, so skip those rows.
  const billedInvoices = existingInvoices.filter(i => i.status !== 'Cancelled' && i.status !== 'Credit');
  const invoicedBols = new Set(billedInvoices.map(i => (i.bolNumber || '').trim().toUpperCase()).filter(Boolean));
  const invoicedPos = new Set(billedInvoices.map(i => (i.po || '').trim().toUpperCase()).filter(Boolean));

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

      // Already invoiced? An invoiced BOL/PO can no longer be an order — skip
      // (otherwise an order sync would re-create the order an invoice import removed).
      if ((bolU && invoicedBols.has(bolU)) || (poU && invoicedPos.has(poU))) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'BOL/PO already invoiced — no longer an order' });
        continue;
      }

      // Per-tab defaults: explicit overrides from config > built-in tabDefaults
      const explicit = tabByName.get(r.tab);
      const builtIn = tabDefaults(r.tab);
      const tabFormat = explicit?.expectedFormat ?? builtIn.expectedFormat;
      // BOL-prefix override: per the user's numbering scheme, a BOL that
      // starts with "B" is a Bulk order and "P" is Packaged (bagged). When
      // the prefix is one of those, force the format hint to the right
      // value so a Bulk BOL can never silently resolve to a packaged QA
      // (the GC45 / 20kg GC45 bug). The prefix takes precedence over the
      // tab-level hint when they disagree.
      const bolPrefix = (r.bolNumber || '').trim().charAt(0).toUpperCase();
      let expectedFormat = tabFormat;
      if (bolPrefix === 'B') expectedFormat = 'Bulk';
      else if (bolPrefix === 'P') expectedFormat = 'Bagged';
      const netWeightPerUnitKg = explicit?.netWeightPerUnitKg ?? builtIn.netWeightPerUnitKg;

      const customerCanonical = resolveCustomer(r.customerName, customers);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      // totalWeight is stored in MT (the app's display convention multiplies
      // by 1000 to render kg). See the comment in parsedRowsToOrders.
      const totalWeightMT = r.quantityMT;
      const totalWeightKg = totalWeightMT * 1000; // for the tote-qty division
      const isTote = netWeightPerUnitKg > 0;
      const qty = isTote
        ? Math.round(totalWeightKg / netWeightPerUnitKg)
        : totalWeightMT;

      // Pricing from the sheet's Price/MT column. mtAmount is $/MT; lineAmount =
      // weight(MT) × $/MT; unitAmount = $/MT × per-unit weight(MT). When the
      // column is blank these stay 0 (so the orders table shows no price).
      const pricePerMt = Number.isFinite(r.pricePerMt) && r.pricePerMt > 0 ? r.pricePerMt : 0;
      const mtAmount = pricePerMt;
      const unitAmount = Math.round(mtAmount * (netWeightPerUnitKg / 1000) * 100) / 100;
      const lineAmount = Math.round(totalWeightMT * mtAmount * 100) / 100;

      // Resolve the sheet's ship-to text against this customer's saved
      // shipToLocations. Match on name (case-insensitive). When unmatched,
      // leave shipToLocationId blank — the orders table will show "—".
      const customerRec = customers.find(c => c.name === customerCanonical);
      let shipToLocationId: string | undefined;
      if (r.shipToName && customerRec?.shipToLocations?.length) {
        const want = r.shipToName.trim().toLowerCase();
        const match = customerRec.shipToLocations.find(l => (l.name || '').trim().toLowerCase() === want)
          || customerRec.shipToLocations.find(l => {
            const ln = (l.name || '').trim().toLowerCase();
            return ln && (ln.includes(want) || want.includes(ln));
          });
        if (match) shipToLocationId = match.id;
      }

      // Duplicate of a row we already imported as new in this same run → skip.
      if ((bolU && addedBOLs.has(bolU)) || (poU && addedPOs.has(poU))) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Duplicate of an order already imported in this run' });
        continue;
      }

      const blank = (v: unknown) => v === undefined || v === null || v === '';
      // Shared "fill in only the blank fields" patch — never overwrites a value.
      const fillBlanks = (o: Order): Partial<Order> => {
        const p: Partial<Order> = {};
        if (blank(o.contractNumber) && r.contractNumber) p.contractNumber = r.contractNumber;
        if (blank(o.carrier) && carrierCanonical) p.carrier = carrierCanonical;
        if (blank(o.shipmentDate) && r.shipmentDate) p.shipmentDate = r.shipmentDate;
        if (blank(o.deliveryDate) && r.deliveryDate) p.deliveryDate = r.deliveryDate;
        if (blank(o.location) && explicit?.defaultLocation) p.location = explicit.defaultLocation;
        if (blank(o.splitNumber) && r.splitNumber) p.splitNumber = r.splitNumber;
        if (blank(o.papsNo) && r.papsNo) p.papsNo = r.papsNo;
        if (blank(o.customsEntryNo) && r.customsEntryNo) p.customsEntryNo = r.customsEntryNo;
        if (blank(o.shipToLocationId) && shipToLocationId) p.shipToLocationId = shipToLocationId;
        return p;
      };
      // Price/MT backfill: when the order carries no amount yet, set each unpriced
      // line's $/MT from the sheet and recompute the order total.
      const addPriceBackfill = (o: Order, patch: Partial<Order>) => {
        if (pricePerMt > 0 && (!o.amount || o.amount === 0)) {
          let lineChanged = false;
          const newLineItems = (o.lineItems || []).map(li => {
            if (li.mtAmount && li.mtAmount > 0) return li; // already priced — leave it
            lineChanged = true;
            const tw = li.totalWeight || 0;
            return { ...li, mtAmount: pricePerMt, lineAmount: Math.round(tw * pricePerMt * 100) / 100 };
          });
          if (lineChanged) {
            patch.lineItems = newLineItems;
            patch.amount = Math.round(newLineItems.reduce((s, li) => s + (li.lineAmount || 0), 0) * 100) / 100;
          }
        }
      };

      const orderByBol = bolU ? (existingOrderByBol.get(bolU) || null) : null;
      const orderByPo = poU ? (existingOrderByPo.get(poU) || null) : null;

      // PO match drives the BOL: the customer PO is the stable reference and the
      // imported sheet is authoritative for BOL numbers, so when this PO already
      // belongs to an order, REPLACE that order's BOL with the imported one and
      // fill any blanks. Defer to an exact-BOL match only when the imported BOL
      // already identifies a DIFFERENT order (so a PO spanning several BOLs isn't
      // mis-assigned to the wrong shipment).
      if (orderByPo && (!orderByBol || orderByBol.id === orderByPo.id)) {
        if (updatedIds.has(orderByPo.id)) {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Existing order already updated earlier in this run' });
          continue;
        }
        const patch = fillBlanks(orderByPo);
        if (bolU && (orderByPo.bolNumber || '').trim().toUpperCase() !== bolU) patch.bolNumber = r.bolNumber.trim();
        addPriceBackfill(orderByPo, patch);
        if (Object.keys(patch).length > 0) {
          const updated = stripUndefined({ ...orderByPo, ...patch });
          result.updatedOrders!.push(updated);
          updatedIds.add(orderByPo.id);
          if (bolU) existingOrderByBol.set(bolU, updated); // keep map consistent for later rows
        } else {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Existing order already has all the available info' });
        }
        continue;
      }

      // Exact BOL match (a different order than the PO match, or no PO match) —
      // the unique shipment identifier; fill in only its blank fields.
      if (orderByBol) {
        if (updatedIds.has(orderByBol.id)) {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Existing order already updated earlier in this run' });
          continue;
        }
        const patch = fillBlanks(orderByBol);
        addPriceBackfill(orderByBol, patch);
        if (Object.keys(patch).length > 0) {
          result.updatedOrders!.push(stripUndefined({ ...orderByBol, ...patch }));
          updatedIds.add(orderByBol.id);
        } else {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, poNumber: r.poNumber, reason: 'Existing order already has all the available info' });
        }
        continue;
      }

      const lineItem: OrderLineItem = {
        id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        productName: productRefs.productName,
        qty,
        contractNumber: r.contractNumber || '',
        netWeightPerUnit: netWeightPerUnitKg,
        totalWeight: totalWeightMT,
        unitAmount,
        mtAmount,
        lineAmount,
        // Optional fields — omit when missing so Firestore doesn't choke
        // on undefined values.
        ...(productRefs.productDisplayName ? { productDisplayName: productRefs.productDisplayName } : {}),
        ...(productRefs.productKey ? { productKey: productRefs.productKey } : {}),
      };

      // Build the order WITHOUT undefined-valued optional fields. Firestore
      // rejects writes containing `undefined`; conditional spread keeps
      // empty optionals out of the document entirely.
      const newOrder: Order = {
        id: `ORD-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        bolNumber: r.bolNumber,
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: r.poNumber,
        date: r.shipmentDate,
        shipmentDate: r.shipmentDate,
        deliveryDate: r.deliveryDate || '',
        status: 'Open',
        lineItems: [lineItem],
        amount: lineAmount,
        ...(r.contractNumber ? { contractNumber: r.contractNumber } : {}),
        ...(r.splitNumber ? { splitNumber: r.splitNumber } : {}),
        ...(carrierCanonical ? { carrier: carrierCanonical } : {}),
        ...(explicit?.defaultLocation ? { location: explicit.defaultLocation } : {}),
        ...(shipToLocationId ? { shipToLocationId } : {}),
        ...(r.papsNo ? { papsNo: r.papsNo } : {}),
        ...(r.customsEntryNo ? { customsEntryNo: r.customsEntryNo } : {}),
      };
      result.newOrders.push(stripUndefined(newOrder));
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
    existingInvoices?: Invoice[];
  },
): Promise<OrderSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: OrderSyncResult['errors'] = [];

  for (const tab of config.tabs) {
    try {
      const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
      const rows = parseCSV(csv);
      allParsed.push(...parseConfiguredTab(rows, tab));
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
    ctx.existingInvoices || [],
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
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, splitNumber: 17, pricePerMt: 23, invoiceNumber: COL_BV_INDEX },
    },
    {
      tabName: 'TOT',
      expectedFormat: 'Tote',
      netWeightPerUnitKg: 1000,
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, splitNumber: 17, pricePerMt: 23, invoiceNumber: COL_BV_INDEX },
    },
    {
      tabName: 'DRY',
      expectedFormat: 'Bulk',
      netWeightPerUnitKg: 0,
      columns: { customer: 5, shipTo: 6, poNumber: 7, product: 8, carrier: 9, bolNumber: 11, quantityMT: 12, shipmentDate: 1, deliveryDate: 3, contractNumber: 22, splitNumber: 17, pricePerMt: 23, invoiceNumber: COL_BV_INDEX },
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
  { key: 'shipTo', label: 'Ship To (customer site)' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'product', label: 'Product' },
  { key: 'carrier', label: 'Carrier' },
  { key: 'bolNumber', label: 'BOL Number', required: true },
  { key: 'shipmentDate', label: 'Shipment Date', required: true },
  { key: 'deliveryDate', label: 'Delivery Date' },
  { key: 'quantityMT', label: 'Quantity (MT)', required: true },
  { key: 'contractNumber', label: 'Contract Number' },
  { key: 'splitNumber', label: 'Split Number' },
  { key: 'pricePerMt', label: 'Price / MT (invoices)' },
  { key: 'reversals', label: 'Reversals (invoices)' },
  { key: 'bay', label: 'Bay / Dock (shipments)' },
  { key: 'appointmentTime', label: 'Appointment Time (shipments)' },
  { key: 'invoiceNumber', label: 'Invoice Number' },
  { key: 'papsNo', label: 'PAPS No.' },
  { key: 'customsEntryNo', label: 'Customs Entry No.' },
  { key: 'status', label: 'Status / Cancellation' },
];

/* ====================================================================== */
/* Invoice sync — reuses the orders fetch + parse pipeline, builds Invoice */
/* records instead of Order records. Inverse rule: invoiced rows are the   */
/* IMPORTS here (orders sync skips them). Dedup is by invoiceNumber and    */
/* BOL. Imports DO link to an existing order by BOL when one exists, so    */
/* invoice line items inherit from the matching order.                    */
/* ====================================================================== */

export interface InvoiceSyncResult {
  newInvoices: Invoice[];
  /** Existing invoices that had missing fields backfilled from the sheet. */
  updatedInvoices: Invoice[];
  skipped: Array<{ tab: string; bolNumber: string; invoiceNumber: string; reason: string }>;
  errors: Array<{ tab: string; rowIdx: number; message: string }>;
}

export function parsedRowsToInvoicesConfigured(
  parsed: ParsedOrderRow[],
  configured: ConfiguredTab[],
  existingInvoices: Invoice[],
  existingOrders: Order[],
  customers: Customer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Carrier[],
): InvoiceSyncResult {
  const tabByName = new Map<string, ConfiguredTab>();
  for (const t of configured) tabByName.set(t.tabName, t);

  const result: InvoiceSyncResult = { newInvoices: [], updatedInvoices: [], skipped: [], errors: [] };

  // Invoice NUMBER is the unique key — BOL numbers are intentionally shared
  // across multiple invoices (and orders), so we do NOT dedup on BOL. A row
  // whose invoice number matches an existing invoice backfills its blank fields;
  // otherwise it's a new invoice (even when the BOL is already in use).
  const existingInvoiceByNumber = new Map<string, Invoice>();
  for (const i of existingInvoices) {
    const n = (i.invoiceNumber || '').trim().toUpperCase();
    if (n && !existingInvoiceByNumber.has(n)) existingInvoiceByNumber.set(n, i);
  }
  const updatedInvoiceIds = new Set<string>(); // each existing invoice touched at most once per run
  const addedInvoiceNumbers = new Set<string>();

  // BOL → Order lookup for line-item inheritance
  const ordersByBol = new Map<string, Order>();
  for (const o of existingOrders) {
    if (o.bolNumber) ordersByBol.set(o.bolNumber.trim().toUpperCase(), o);
  }

  for (const r of parsed) {
    try {
      // 1. Cancelled row — skip
      if (isCancelledStatus(r.status)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Row marked cancelled' });
        continue;
      }
      // 2. NOT invoiced — skip (this is the inverse of the orders sync).
      //    Invoices REQUIRE an invoice number to exist in this row.
      if (!isInvoicedValue(r.invoiceNumber)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Row has no invoice number (not yet billed)' });
        continue;
      }
      // 3. Require BOL — invoices have to link back to a shipment
      if (!r.bolNumber || !r.bolNumber.trim()) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Row has no BOL number' });
        continue;
      }
      // 4. Need a usable date
      if (!r.shipmentDate) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Row has no shipment date' });
        continue;
      }
      // 5. Quantity sanity
      if (!Number.isFinite(r.quantityMT) || r.quantityMT <= 0) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Quantity is blank or not a positive number' });
        continue;
      }
      if (r.quantityMT > MAX_ORDER_MT) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: `Quantity ${r.quantityMT} MT exceeds the ${MAX_ORDER_MT} MT maximum` });
        continue;
      }

      const invU = r.invoiceNumber.trim().toUpperCase();
      const bolU = r.bolNumber.trim().toUpperCase();

      // Resolve catalog refs (same path as orders, so display matches). Computed
      // up-front because both the new-invoice and the backfill paths need them.
      const explicit = tabByName.get(r.tab);
      const builtIn = tabDefaults(r.tab);
      const tabFormat = explicit?.expectedFormat ?? builtIn.expectedFormat;
      const bolPrefix = r.bolNumber.trim().charAt(0).toUpperCase();
      let expectedFormat = tabFormat;
      if (bolPrefix === 'B') expectedFormat = 'Bulk';
      else if (bolPrefix === 'P') expectedFormat = 'Bagged';

      const customerCanonical = resolveCustomer(r.customerName, customers);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      // Pricing: amount = pricePerMt × quantityMT (qty is MT for bulk/liquid;
      // for totes the parsed quantityMT is the truckload size in MT, so the
      // same multiplication is correct).
      const pricePerMt = Number.isFinite(r.pricePerMt) ? r.pricePerMt : 0;
      const amount = Math.round(pricePerMt * r.quantityMT * 100) / 100;

      // Try to inherit line items from a matching order (by BOL).
      const linkedOrder = ordersByBol.get(bolU);
      const lineItems = linkedOrder ? linkedOrder.lineItems : undefined;

      // 6. Existing invoice (matched by invoice NUMBER only)? Backfill its BLANK
      //    fields from the sheet — never overwrite a value already present.
      const existingInv = existingInvoiceByNumber.get(invU) || null;
      if (existingInv) {
        if (updatedInvoiceIds.has(existingInv.id)) {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Existing invoice already updated earlier in this run' });
          continue;
        }
        const blank = (v: unknown) => v === undefined || v === null || v === '';
        const patch: Partial<Invoice> = {};
        if (blank(existingInv.po) && r.poNumber) patch.po = r.poNumber;
        if (blank(existingInv.invoiceNumber) && r.invoiceNumber) patch.invoiceNumber = r.invoiceNumber;
        if (blank(existingInv.contractNumber) && r.contractNumber) patch.contractNumber = r.contractNumber;
        if (blank(existingInv.splitNo) && r.splitNumber) patch.splitNo = r.splitNumber;
        if (blank(existingInv.carrier) && carrierCanonical) patch.carrier = carrierCanonical;
        if (blank(existingInv.location) && explicit?.defaultLocation) patch.location = explicit.defaultLocation;
        if (blank(existingInv.papsNo) && r.papsNo) patch.papsNo = r.papsNo;
        if (blank(existingInv.customsEntryNo) && r.customsEntryNo) patch.customsEntryNo = r.customsEntryNo;
        if (blank(existingInv.reversals) && r.reversals) patch.reversals = r.reversals;
        // Pricing backfill — price and amount filled independently, each only
        // when the existing invoice is missing it (never overwrites a value).
        if (pricePerMt > 0 && blank(existingInv.pricePerMt)) patch.pricePerMt = pricePerMt;
        if (!existingInv.amount || existingInv.amount === 0) {
          // Use the invoice's own $/MT when it has one, else the sheet's; × its qty.
          const effPpm = (existingInv.pricePerMt && existingInv.pricePerMt > 0) ? existingInv.pricePerMt : pricePerMt;
          const effQty = existingInv.qty || r.quantityMT;
          const computed = Math.round(effPpm * effQty * 100) / 100;
          if (computed > 0) patch.amount = computed;
        }
        // Line-item backfill from a matching order when the invoice has none.
        if ((!existingInv.lineItems || existingInv.lineItems.length === 0) && lineItems && lineItems.length) {
          patch.lineItems = lineItems;
        }
        if (Object.keys(patch).length > 0) {
          result.updatedInvoices.push(stripUndefined({ ...existingInv, ...patch }));
          updatedInvoiceIds.add(existingInv.id);
        } else {
          result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Existing invoice already has all the available info' });
        }
        continue;
      }

      // 7. In-run dedup for NEW invoices — by invoice NUMBER only (BOLs may
      //    legitimately repeat across rows).
      if (addedInvoiceNumbers.has(invU)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, invoiceNumber: r.invoiceNumber, reason: 'Invoice number already imported earlier in this run' });
        continue;
      }

      const newInvoice: Invoice = {
        id: `INV-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        invoiceNumber: r.invoiceNumber,
        bolNumber: r.bolNumber,
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: r.poNumber,
        qty: r.quantityMT,
        carrier: carrierCanonical || '',
        amount,
        shipmentId: linkedOrder?.id || '',
        date: r.shipmentDate,
        status: 'Open',
        ...(pricePerMt > 0 ? { pricePerMt } : {}),
        ...(r.splitNumber ? { splitNo: r.splitNumber } : {}),
        ...(r.contractNumber ? { contractNumber: r.contractNumber } : {}),
        ...(explicit?.defaultLocation ? { location: explicit.defaultLocation } : {}),
        ...(lineItems ? { lineItems } : {}),
        ...(r.papsNo ? { papsNo: r.papsNo } : {}),
        ...(r.customsEntryNo ? { customsEntryNo: r.customsEntryNo } : {}),
        ...(r.reversals ? { reversals: r.reversals } : {}),
      };

      result.newInvoices.push(stripUndefined(newInvoice));
      addedInvoiceNumbers.add(invU);
    } catch (err) {
      result.errors.push({ tab: r.tab, rowIdx: r.rowIdx, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Run an invoice sync against any sheet/config. Same fetch + parse path as
 *  orders; the difference is the row-to-record conversion. */
export async function syncInvoicesFromConfig(
  config: SheetImportConfig,
  ctx: {
    existingInvoices: Invoice[];
    existingOrders: Order[];
    customers: Customer[];
    skus: SKU[];
    qaProducts: QAProduct[];
    carriers: Carrier[];
  },
): Promise<InvoiceSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: InvoiceSyncResult['errors'] = [];

  for (const tab of config.tabs) {
    try {
      const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
      const rows = parseCSV(csv);
      allParsed.push(...parseConfiguredTab(rows, tab));
    } catch (err) {
      fetchErrors.push({
        tab: tab.tabName,
        rowIdx: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = parsedRowsToInvoicesConfigured(
    allParsed, config.tabs,
    ctx.existingInvoices, ctx.existingOrders, ctx.customers, ctx.skus, ctx.qaProducts, ctx.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}

/** Default preset for the invoice importer — same sheet/tabs as the orders
 *  default, but kept as a separate config so users can save invoice-specific
 *  presets independently of order-import presets. */
export const DEFAULT_INVOICE_IMPORT_CONFIG: SheetImportConfig = {
  ...DEFAULT_ORDER_IMPORT_CONFIG,
  name: 'Sucro Invoices (default)',
};

/* ====================================================================== */
/* Shipment sync — same fetch + parse pipeline, builds Shipment records   */
/* instead of Order / Invoice. Tabular sheet layout: one shipment per row. */
/* ====================================================================== */

export interface ShipmentSyncResult {
  newShipments: Shipment[];
  skipped: Array<{ tab: string; bolNumber: string; reason: string }>;
  errors: Array<{ tab: string; rowIdx: number; message: string }>;
}

/** ISO week number from a YYYY-MM-DD string. */
function isoWeekFromDate(dateISO: string): number {
  const d = new Date(dateISO + 'T00:00:00Z');
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parsedRowsToShipmentsConfigured(
  parsed: ParsedOrderRow[],
  configured: ConfiguredTab[],
  existingShipments: Shipment[],
  customers: Customer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Carrier[],
): ShipmentSyncResult {
  const tabByName = new Map<string, ConfiguredTab>();
  for (const t of configured) tabByName.set(t.tabName, t);

  const result: ShipmentSyncResult = { newShipments: [], skipped: [], errors: [] };

  // Dedup: shipments are keyed on (bol + date + time + bay) so the same BOL
  // can have multiple appointments at different docks/times without collision.
  const shipmentKey = (s: { bol?: string; date?: string; time?: string; bay?: string }) =>
    `${(s.bol || '').trim().toUpperCase()}|${s.date || ''}|${s.time || ''}|${s.bay || ''}`;
  const existingKeys = new Set(existingShipments.map(s => shipmentKey(s)));
  const addedKeys = new Set<string>();

  for (const r of parsed) {
    try {
      if (isCancelledStatus(r.status)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, reason: 'Row marked cancelled' });
        continue;
      }
      if (!r.bolNumber || !r.bolNumber.trim()) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, reason: 'Row has no BOL number' });
        continue;
      }
      if (!r.shipmentDate) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, reason: 'Row has no shipment date' });
        continue;
      }

      const explicit = tabByName.get(r.tab);
      const tabFormat = explicit?.expectedFormat;
      const bolPrefix = r.bolNumber.trim().charAt(0).toUpperCase();
      let expectedFormat = tabFormat;
      if (bolPrefix === 'B') expectedFormat = 'Bulk';
      else if (bolPrefix === 'P') expectedFormat = 'Bagged';

      const customerCanonical = resolveCustomer(r.customerName, customers);
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      const dateISO = r.shipmentDate;
      const week = `Week ${isoWeekFromDate(dateISO)}`;
      const d = new Date(dateISO + 'T00:00:00Z');
      const day = SHORT_DAY[d.getUTCDay()];

      const candidateKey = shipmentKey({
        bol: r.bolNumber, date: dateISO, time: r.appointmentTime, bay: r.bay,
      });
      if (existingKeys.has(candidateKey) || addedKeys.has(candidateKey)) {
        result.skipped.push({ tab: r.tab, bolNumber: r.bolNumber, reason: 'Shipment already scheduled for this BOL/date/time/bay' });
        continue;
      }

      const newShipment: Shipment = {
        id: `SHIP-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        week,
        date: dateISO,
        day,
        time: r.appointmentTime || '',
        bay: r.bay || '',
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: r.poNumber,
        bol: r.bolNumber,
        qty: r.quantityMT,
        carrier: carrierCanonical || '',
        arrive: '',
        start: '',
        out: '',
        status: 'Scheduled',
        ...(r.contractNumber ? { contractNumber: r.contractNumber } : {}),
        ...(explicit?.defaultLocation ? { location: explicit.defaultLocation } : {}),
      } as Shipment;

      result.newShipments.push(stripUndefined(newShipment));
      addedKeys.add(candidateKey);
    } catch (err) {
      result.errors.push({ tab: r.tab, rowIdx: r.rowIdx, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Run a shipment sync against any sheet/config. Same fetch + parse path as
 *  orders + invoices; the difference is the row-to-record conversion. */
export async function syncShipmentsFromConfig(
  config: SheetImportConfig,
  ctx: {
    existingShipments: Shipment[];
    customers: Customer[];
    skus: SKU[];
    qaProducts: QAProduct[];
    carriers: Carrier[];
  },
): Promise<ShipmentSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: ShipmentSyncResult['errors'] = [];

  for (const tab of config.tabs) {
    try {
      const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
      const rows = parseCSV(csv);
      allParsed.push(...parseConfiguredTab(rows, tab));
    } catch (err) {
      fetchErrors.push({
        tab: tab.tabName,
        rowIdx: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = parsedRowsToShipmentsConfigured(
    allParsed, config.tabs,
    ctx.existingShipments, ctx.customers, ctx.skus, ctx.qaProducts, ctx.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}

/** Default shipment-sync preset — tabular layout starter. Users can clone,
 *  point at their sheet, save their own preset under a different name. */
export const DEFAULT_SHIPMENT_IMPORT_CONFIG: SheetImportConfig = {
  name: 'Shipments (tabular template)',
  sheetId: '',
  tabs: [
    {
      tabName: 'Sheet1',
      columns: {
        // Indices left blank — click "Fetch Headers" then "Auto-detect Columns"
        // in the modal to populate them from a real sheet.
      },
    },
  ],
};

/* ====================================================================== */
/* Shipment SCHEDULE grid sync — a WIDE "schedule" sheet, different shape  */
/* from the one-row-per-shipment sync above:                              */
/*   • Row 1 holds BAY names, merged across each bay's column span.        */
/*   • Row 2 holds the per-bay field headers (CUSTOMER/CLIENT, PRODUCT,    */
/*     PO, BOL #, QTY, CARRIER, ARRIVE, START, OUT, + the bay's own        */
/*     WEEK/DATE/DAY/TIME).                                                */
/*   • The leftmost WEEK/DATE/DAY/TIME are the row's slot (used as a       */
/*     fallback when a bay has no date of its own, e.g. DRY DOCKS).        */
/*   • Each sheet TAB is a location.                                       */
/* One shipment is produced per (row × bay that has a customer). Dates have */
/* no year in the sheet, so the caller supplies one.                       */
/* ====================================================================== */

export interface ShipmentScheduleTab {
  tabName: string;   // sheet tab to import
  location: string;  // target location label stamped on every shipment from this tab
}
export interface ShipmentScheduleConfig {
  name: string;
  sheetId: string;
  year: number;      // calendar year stamped on the sheet's month/day dates
  tabs: ShipmentScheduleTab[];
}

const SCHED_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse a "MMM D" / "MMM DD" schedule date (no year) into ISO using `year`. */
function parseScheduleDate(raw: string, year: number): string {
  const s = (raw || '').trim();
  const m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (!m) return '';
  const mi = SCHED_MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = parseInt(m[2], 10);
  if (mi < 0 || !day || day > 31) return '';
  return `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Carry the previous non-empty value forward across blanks — expands the
 *  merged-cell bay names (the value lands only in the merge's top-left cell). */
function carryForward(row: string[]): string[] {
  const out: string[] = [];
  let last = '';
  for (let c = 0; c < row.length; c++) {
    const v = (row[c] || '').trim();
    if (v) last = v;
    out[c] = last;
  }
  return out;
}

/** Parse one schedule-grid tab into Shipment records. */
export function parseShipmentScheduleGrid(
  grid: string[][],
  opts: { tabName: string; location: string; year: number },
  ctx: { existingShipments: Shipment[]; customers: Customer[]; skus: SKU[]; qaProducts: QAProduct[]; carriers: Carrier[] },
): ShipmentSyncResult {
  const result: ShipmentSyncResult = { newShipments: [], skipped: [], errors: [] };
  if (!grid || grid.length < 3) return result;

  const isField = (cell: string, ...names: string[]) => {
    const h = (cell || '').trim().toLowerCase();
    return names.includes(h);
  };
  // Field-header row = first of the top 4 rows that has a customer + a product
  // column. The bay/group names live in the row directly above it.
  let fieldRowIdx = -1;
  for (let r = 0; r < Math.min(grid.length, 4); r++) {
    const row = grid[r] || [];
    if (row.some(c => isField(c, 'customer', 'client')) && row.some(c => isField(c, 'product'))) { fieldRowIdx = r; break; }
  }
  if (fieldRowIdx < 1) {
    result.errors.push({ tab: opts.tabName, rowIdx: 0, message: 'Could not find the field-header row (expected CUSTOMER/CLIENT + PRODUCT in row 2, with bays in row 1).' });
    return result;
  }
  const fieldRow = (grid[fieldRowIdx] || []).map(c => (c || '').trim());
  const groupRow = carryForward(grid[fieldRowIdx - 1] || []);
  const width = Math.max(fieldRow.length, groupRow.length);

  // group name -> { lowercased field name -> column index }
  const groups = new Map<string, Record<string, number>>();
  for (let c = 0; c < width; c++) {
    const g = (groupRow[c] || '').trim();
    const f = (fieldRow[c] || '').trim().toLowerCase();
    if (!g || !f) continue;
    if (!groups.has(g)) groups.set(g, {});
    const map = groups.get(g)!;
    if (!(f in map)) map[f] = c; // first occurrence wins
  }

  type Bay = { name: string; cust: number; bol: number; product?: number; po?: number; qty?: number; carrier?: number; arrive?: number; start?: number; out?: number; date?: number; time?: number };
  const bays: Bay[] = [];
  for (const [name, map] of groups) {
    const cust = map['customer'] ?? map['client'];
    const bol = map['bol #'] ?? map['bol'] ?? map['bol number'];
    if (cust === undefined || bol === undefined) continue; // summary group, not a bay
    bays.push({
      name, cust, bol,
      product: map['product'], po: map['po'], qty: map['qty'], carrier: map['carrier'],
      arrive: map['arrive'], start: map['start'], out: map['out'],
      date: map['date'], time: map['time'],
    });
  }
  if (bays.length === 0) {
    result.errors.push({ tab: opts.tabName, rowIdx: 0, message: 'No shipment bays found — a bay needs CUSTOMER/CLIENT and BOL columns.' });
    return result;
  }

  // Leftmost row-slot DATE/TIME (no group above them) — fallback for bays
  // (e.g. DRY DOCKS) that don't carry their own date/time.
  let rowDateCol: number | undefined, rowTimeCol: number | undefined;
  for (let c = 0; c < width; c++) {
    if ((groupRow[c] || '').trim()) continue;
    const f = (fieldRow[c] || '').trim().toLowerCase();
    if (f === 'date' && rowDateCol === undefined) rowDateCol = c;
    else if (f === 'time' && rowTimeCol === undefined) rowTimeCol = c;
  }

  const cell = (row: string[], idx: number | undefined) => idx === undefined ? '' : (row[idx] ?? '').trim();
  const key = (s: { bol?: string; date?: string; time?: string; bay?: string; location?: string; customer?: string; po?: string }) =>
    `${(s.location || '').toUpperCase()}|${(s.bay || '').toUpperCase()}|${s.date || ''}|${s.time || ''}|${(s.bol || '').toUpperCase()}|${(s.customer || '').toUpperCase()}|${(s.po || '').toUpperCase()}`;
  const existingKeys = new Set(ctx.existingShipments.map(s => key(s as any)));
  const addedKeys = new Set<string>();

  for (let r = fieldRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (row.length === 0) continue;
    for (const bay of bays) {
      try {
        const customerRaw = cell(row, bay.cust);
        if (!customerRaw) continue; // bay empty this slot
        // Repeated header row (printable schedules repeat the header block) —
        // skip silently so the preview isn't flooded with bogus "bad date" skips.
        const cl = customerRaw.toLowerCase();
        if (cl === 'customer' || cl === 'client' || cl === 'product') continue;
        const rawDate = cell(row, bay.date) || cell(row, rowDateCol);
        const dateISO = parseScheduleDate(rawDate, opts.year);
        if (!dateISO) {
          result.skipped.push({ tab: opts.tabName, bolNumber: cell(row, bay.bol), reason: `Unparseable date "${rawDate}" — ${customerRaw} @ ${bay.name}` });
          continue;
        }
        const time = cell(row, bay.time) || cell(row, rowTimeCol);
        const bol = cell(row, bay.bol);
        const po = cell(row, bay.po);
        const customer = resolveCustomer(customerRaw, ctx.customers) || customerRaw;
        const productRaw = cell(row, bay.product);
        const productRefs = resolveProduct(productRaw, ctx.skus, ctx.qaProducts, undefined);
        const carrier = resolveCarrier(cell(row, bay.carrier), ctx.carriers) || cell(row, bay.carrier);
        const dObj = new Date(dateISO + 'T00:00:00Z');

        const k = key({ bol, date: dateISO, time, bay: bay.name, location: opts.location, customer, po });
        if (existingKeys.has(k) || addedKeys.has(k)) {
          result.skipped.push({ tab: opts.tabName, bolNumber: bol, reason: `Already scheduled — ${bay.name} ${dateISO} ${time}` });
          continue;
        }

        const newShipment: Shipment = stripUndefined({
          id: `SHIP-SCHED-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          week: `Week ${isoWeekFromDate(dateISO)}`,
          date: dateISO,
          day: SHORT_DAY[dObj.getUTCDay()],
          time: time || '',
          bay: bay.name,
          customer,
          product: productRefs.productDisplayName || productRefs.productName || productRaw,
          po,
          bol,
          qty: parseFloat(cell(row, bay.qty)) || 0,
          carrier: carrier || '',
          arrive: cell(row, bay.arrive),
          start: cell(row, bay.start),
          out: cell(row, bay.out),
          status: 'Scheduled',
          location: opts.location,
        } as Shipment);
        result.newShipments.push(newShipment);
        addedKeys.add(k);
      } catch (err) {
        result.errors.push({ tab: opts.tabName, rowIdx: r + 1, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return result;
}

/** Run a schedule-grid sync: fetch each tab's raw grid, parse, accumulate.
 *  Later tabs dedup against shipments produced by earlier tabs in the run. */
export async function syncShipmentScheduleFromConfig(
  config: ShipmentScheduleConfig,
  ctx: { existingShipments: Shipment[]; customers: Customer[]; skus: SKU[]; qaProducts: QAProduct[]; carriers: Carrier[] },
): Promise<ShipmentSyncResult> {
  const result: ShipmentSyncResult = { newShipments: [], skipped: [], errors: [] };
  let runningExisting = [...ctx.existingShipments];
  for (const tab of config.tabs) {
    if (!tab.tabName.trim()) continue;
    try {
      const grid = parseCSV(await fetchTabFromSheet(config.sheetId, tab.tabName));
      const r = parseShipmentScheduleGrid(
        grid,
        { tabName: tab.tabName, location: (tab.location || tab.tabName).trim(), year: config.year },
        { ...ctx, existingShipments: runningExisting },
      );
      result.newShipments.push(...r.newShipments);
      result.skipped.push(...r.skipped);
      result.errors.push(...r.errors);
      runningExisting = runningExisting.concat(r.newShipments);
    } catch (err) {
      result.errors.push({ tab: tab.tabName, rowIdx: 0, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

export const DEFAULT_SHIPMENT_SCHEDULE_CONFIG: ShipmentScheduleConfig = {
  name: 'Shipment Schedule', sheetId: '', year: 0, tabs: [{ tabName: '', location: '' }],
};

/* ====================================================================== */
/* Transfer sync — same fetch + parse pipeline, builds Transfer records.  */
/* Tabular sheet layout: one inventory transfer per row. Unlike orders,   */
/* transfers move between two of OUR locations (from → to) rather than to */
/* a customer, so the column map uses From/To instead of Customer/Ship-To.*/
/* ====================================================================== */

export interface TransferSyncResult {
  newTransfers: Transfer[];
  skipped: Array<{ tab: string; transferNumber: string; reason: string }>;
  errors: Array<{ tab: string; rowIdx: number; message: string }>;
}

export function parsedRowsToTransfersConfigured(
  parsed: ParsedOrderRow[],
  configured: ConfiguredTab[],
  existingTransfers: Transfer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Carrier[],
): TransferSyncResult {
  const tabByName = new Map<string, ConfiguredTab>();
  for (const t of configured) tabByName.set(t.tabName, t);

  const result: TransferSyncResult = { newTransfers: [], skipped: [], errors: [] };

  // Dedup: rows that carry a transfer number are keyed on it; rows without one
  // fall back to a composite of from|to|product|date|po so re-running the sync
  // doesn't duplicate the same movement.
  const existingNums = new Set(
    existingTransfers.map(t => (t.transferNumber || '').trim().toUpperCase()).filter(Boolean),
  );
  const addedNums = new Set<string>();
  const compositeKey = (t: { from: string; to: string; product: string; date: string; po: string }) =>
    `${t.from.toUpperCase()}|${t.to.toUpperCase()}|${t.product.toUpperCase()}|${t.date}|${t.po.toUpperCase()}`;
  const existingComposites = new Set(
    existingTransfers.map(t => compositeKey({
      from: t.from || '', to: t.to || '', product: t.product || '', date: t.shipmentDate || '', po: t.po || '',
    })),
  );
  const addedComposites = new Set<string>();

  // Sequential fallback number for rows that don't supply one. Continues past
  // the existing transfer count so generated numbers don't collide.
  let genSeq = existingTransfers.length + 1;
  const year = new Date().getFullYear();

  for (const r of parsed) {
    try {
      if (isCancelledStatus(r.status)) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'Row marked cancelled' });
        continue;
      }
      const from = (r.fromLocation || '').trim();
      const to = (r.toLocation || '').trim();
      if (!from || !to) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'Row is missing a From or To location' });
        continue;
      }
      if (!r.shipmentDate) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'Row has no shipment date' });
        continue;
      }
      if (!Number.isFinite(r.quantityMT) || r.quantityMT <= 0) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'Amount is blank or not a positive number' });
        continue;
      }
      if (r.quantityMT > MAX_ORDER_MT) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: `Amount ${r.quantityMT} MT exceeds the ${MAX_ORDER_MT} MT maximum` });
        continue;
      }

      const numU = (r.transferNumber || '').trim().toUpperCase();
      if (numU && (existingNums.has(numU) || addedNums.has(numU))) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'Transfer number already exists' });
        continue;
      }

      const explicit = tabByName.get(r.tab);
      const expectedFormat = explicit?.expectedFormat;
      const productRefs = resolveProduct(r.productRaw, skus, qaProducts, expectedFormat);
      const carrierCanonical = resolveCarrier(r.carrierName, carriers);

      const comp = compositeKey({ from, to, product: productRefs.productName, date: r.shipmentDate, po: r.poNumber });
      if (!numU && (existingComposites.has(comp) || addedComposites.has(comp))) {
        result.skipped.push({ tab: r.tab, transferNumber: r.transferNumber, reason: 'An identical transfer already exists (same from/to/product/date/PO)' });
        continue;
      }

      const transferNumber = numU
        ? r.transferNumber.trim()
        : `TRF-${year}-${String(genSeq++).padStart(3, '0')}`;

      const newTransfer: Transfer = {
        id: `TRF-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        transferNumber,
        from,
        to,
        shipmentDate: r.shipmentDate,
        arrivalDate: r.deliveryDate || r.shipmentDate,
        carrier: carrierCanonical || '',
        product: productRefs.productDisplayName || productRefs.productName,
        amount: r.quantityMT,
        status: 'Pending',
        ...(r.poNumber ? { po: r.poNumber } : {}),
        ...(r.lotCode ? { lotCode: r.lotCode } : {}),
      };

      result.newTransfers.push(stripUndefined(newTransfer));
      if (numU) addedNums.add(numU);
      addedComposites.add(comp);
    } catch (err) {
      result.errors.push({ tab: r.tab, rowIdx: r.rowIdx, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Run a transfer sync against any sheet/config. Same fetch + parse path as
 *  orders / invoices / shipments; the difference is the row-to-record build. */
export async function syncTransfersFromConfig(
  config: SheetImportConfig,
  ctx: {
    existingTransfers: Transfer[];
    skus: SKU[];
    qaProducts: QAProduct[];
    carriers: Carrier[];
  },
): Promise<TransferSyncResult> {
  const allParsed: ParsedOrderRow[] = [];
  const fetchErrors: TransferSyncResult['errors'] = [];

  for (const tab of config.tabs) {
    try {
      const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
      const rows = parseCSV(csv);
      allParsed.push(...parseConfiguredTab(rows, tab));
    } catch (err) {
      fetchErrors.push({
        tab: tab.tabName,
        rowIdx: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = parsedRowsToTransfersConfigured(
    allParsed, config.tabs,
    ctx.existingTransfers, ctx.skus, ctx.qaProducts, ctx.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}

/** Default transfer-sync preset — tabular layout starter. Users clone it,
 *  point at their sheet, then "Fetch Headers" + "Auto-detect Columns". */
export const DEFAULT_TRANSFER_IMPORT_CONFIG: SheetImportConfig = {
  name: 'Transfers (tabular template)',
  sheetId: '',
  tabs: [
    {
      tabName: 'Sheet1',
      columns: {
        // Indices left blank — map them in the configurator from a real sheet.
      },
    },
  ],
};

/** Canonical field list for the transfer column-mapping UI (label + key).
 *  Reuses generic ColumnMap keys (product, carrier, quantityMT, etc.) plus the
 *  transfer-specific fromLocation / toLocation / transferNumber / lotCode. */
export const TRANSFER_FIELDS: Array<{ key: keyof ColumnMap; label: string; required?: boolean }> = [
  { key: 'transferNumber', label: 'Transfer Number' },
  { key: 'fromLocation', label: 'From (origin)', required: true },
  { key: 'toLocation', label: 'To (destination)', required: true },
  { key: 'product', label: 'Product' },
  { key: 'quantityMT', label: 'Amount (MT)', required: true },
  { key: 'carrier', label: 'Carrier' },
  { key: 'shipmentDate', label: 'Shipment Date', required: true },
  { key: 'deliveryDate', label: 'Arrival Date' },
  { key: 'poNumber', label: 'PO Number' },
  { key: 'lotCode', label: 'Lot Code' },
  { key: 'status', label: 'Status / Cancellation' },
];
