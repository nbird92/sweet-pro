// Google Sheets sync utility
// Pulls appointment data from FERGUSON and SHERMAN tabs of the configured
// shipment schedule spreadsheet, normalises rows into ParsedAppointment
// records, and converts them into Order + Shipment objects for one-click
// import into the app.
//
// Endpoints used:
//   https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={NAME}
// The sheet must be either "Anyone with link can view" or published to the
// web — the endpoint above honours the former for CORS-friendly fetches.

import type { Order, OrderLineItem, Shipment, Customer, SKU, QAProduct } from '../types';

// Workbook containing the shipment schedule tabs the user wants imported.
// Tabs of interest: FERGUSON (Hamilton (Ferguson)) and SHERMAN (Hamilton (Sherman)).
export const SHEET_ID = '1cmkhVfuD7ZtdS268dCfUgarGy7gmY40XGg_js47RiB0';

// Tab-name → app location-name mapping. BAY 3 (Molasses transfers) on both
// tabs is intentionally skipped per requirements.
export const SHEET_TAB_TO_LOCATION: Record<string, string> = {
  FERGUSON: 'Hamilton (Ferguson)',
  SHERMAN: 'Hamilton (Sherman)',
};

// The shipment schedule sheet has four side-by-side panels per row. Each
// panel represents a "bay" with the same 13 columns: WEEK, DATE, DAY, TIME,
// CUSTOMER (or CLIENT), PRODUCT, PO, BOL #, QTY, CARRIER, ARRIVE, START, OUT.
// Panel 3 has no WEEK column (its column is blank), so it shifts left by one.
// Skipping bay 3 (Molasses transfers) means we only parse panels 1, 2, and 4.
const BAY_COLUMN_RANGES = [
  { startCol: 0, includeWeek: true },   // Bay 1 (cols 0..12)
  { startCol: 13, includeWeek: true },  // Bay 2 (cols 13..25)
  // { startCol: 26, includeWeek: false }, // Bay 3 — SKIPPED (Molasses transfers)
  { startCol: 39, includeWeek: true },  // Bay 4 (cols 39..51)
];

// Year to assume when parsing "Jan 1", "Mar 1" etc.
// Set to the active calendar year per user requirements.
const IMPORT_YEAR = 2026;

export interface ParsedAppointment {
  /** Row index in the source CSV (for error reporting) */
  rowIdx: number;
  /** ISO date string YYYY-MM-DD */
  date: string;
  /** Day of week e.g. "Mon" */
  day: string;
  /** Appointment time slot e.g. "8:00" or "8:00 AM" */
  time: string;
  /** Week label e.g. "Week 22" */
  week: string;
  /** Customer free-text from sheet */
  customer: string;
  /** Product free-text from sheet (e.g. "LIQUID 100", "TOTES 100") */
  product: string;
  po: string;
  bolNumber: string;
  /** Quantity (units / loads, not MT — sheet stores load count) */
  qty: number;
  carrier: string;
  arrive: string;
  start: string;
  out: string;
  /** Bay name pulled from the panel's column header */
  bay: string;
  /** App location name (e.g. "Hamilton (Ferguson)") */
  location: string;
}

export interface SyncResult {
  /** Orders to be created (new BOLs that don't exist in app) */
  newOrders: Order[];
  /** Shipments to be created, linked to newOrders or existing orders by BOL */
  newShipments: Shipment[];
  /** BOLs that were skipped because they already exist in the app */
  skipped: Array<{ bolNumber: string; reason: string }>;
  /** Rows that couldn't be parsed for any reason */
  errors: Array<{ rowIdx: number; bay: string; message: string }>;
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Minimal RFC 4180 CSV parser — handles double-quoted fields with embedded
 * commas, escaped quotes ("") and newlines inside quoted fields. Returns
 * a 2D array of strings; outer array is rows, inner is cells.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n') {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = '';
    } else if (c === '\r') {
      // skip — line ending handled by \n
    } else {
      field += c;
    }
  }
  // Flush trailing field/row
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Sheet fetching                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fetches one tab of the configured spreadsheet as a CSV string.
 * Uses Google's gviz endpoint which honours the sheet's public-view
 * permission and supports cross-origin requests.
 */
export async function fetchTabCSV(tabName: string): Promise<string> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Failed to fetch tab "${tabName}": HTTP ${res.status}. The sheet may not be publicly viewable — set sharing to "Anyone with the link can view" or publish to web.`);
  }
  return await res.text();
}

/* ------------------------------------------------------------------ */
/* Date / number normalisation                                         */
/* ------------------------------------------------------------------ */

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Converts a "Jan 1" / "May 24" style string into an ISO YYYY-MM-DD date
 * using the configured IMPORT_YEAR. Returns null when unparsable.
 */
function monthDayToISO(monthDay: string): string | null {
  if (!monthDay) return null;
  const m = monthDay.trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  if (Number.isNaN(day)) return null;
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${IMPORT_YEAR}-${mm}-${dd}`;
}

/**
 * Returns the ISO 8601 week number for a given YYYY-MM-DD date.
 * Used to populate Shipment.week when the row doesn't supply one.
 */
function isoWeek(dateISO: string): number {
  const d = new Date(dateISO + 'T00:00:00Z');
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

/* ------------------------------------------------------------------ */
/* Tab parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parses a FERGUSON / SHERMAN tab's CSV rows into normalised
 * ParsedAppointment records. Bay 3 (the Molasses transfer panel) is
 * skipped entirely; empty cells (no customer + no BOL) are skipped.
 */
export function parseShipmentScheduleTab(
  csvRows: string[][],
  locationName: string,
): ParsedAppointment[] {
  if (csvRows.length === 0) return [];
  const headerRow = csvRows[0];
  const out: ParsedAppointment[] = [];

  for (let rowIdx = 1; rowIdx < csvRows.length; rowIdx++) {
    const row = csvRows[rowIdx];
    for (const { startCol, includeWeek } of BAY_COLUMN_RANGES) {
      // Column layout within a panel, accounting for whether the panel
      // owns a WEEK column (Bay 3 omits it — but we skip Bay 3 anyway,
      // so all surviving panels include WEEK).
      const baseOffset = includeWeek ? 0 : -1;
      const colWeek = startCol + 0;
      const colDate = startCol + 1 + baseOffset;
      const colDay = startCol + 2 + baseOffset;
      const colTime = startCol + 3 + baseOffset;
      const colCustomer = startCol + 4 + baseOffset;
      const colProduct = startCol + 5 + baseOffset;
      const colPO = startCol + 6 + baseOffset;
      const colBOL = startCol + 7 + baseOffset;
      const colQty = startCol + 8 + baseOffset;
      const colCarrier = startCol + 9 + baseOffset;
      const colArrive = startCol + 10 + baseOffset;
      const colStart = startCol + 11 + baseOffset;
      const colOut = startCol + 12 + baseOffset;

      const cell = (idx: number) => (row[idx] ?? '').trim();

      const customer = cell(colCustomer);
      const bolNumber = cell(colBOL);
      const po = cell(colPO);
      const product = cell(colProduct);

      // Skip empty panel cells (no real data)
      if (!customer && !bolNumber && !po && !product) continue;

      // Skip rows without a BOL number per requirements (internal transfers,
      // unconfirmed appointments etc.)
      if (!bolNumber) continue;

      const dateRaw = cell(colDate);
      const dateISO = monthDayToISO(dateRaw);
      if (!dateISO) continue; // Need a usable date to create order/shipment

      // Bay name comes from the panel's header cell at the customer/client
      // column — this is where the sheet labels the panel.
      const bayHeader = (headerRow[colCustomer] ?? '').trim();
      const bay = bayHeader || `Bay ${startCol}`;

      const weekFromSheet = cell(colWeek);
      const weekLabel = weekFromSheet
        ? `Week ${weekFromSheet}`
        : `Week ${isoWeek(dateISO)}`;

      const qtyParsed = parseFloat(cell(colQty));
      const qty = Number.isFinite(qtyParsed) ? qtyParsed : 0;

      out.push({
        rowIdx: rowIdx + 1, // 1-based for human readability
        date: dateISO,
        day: cell(colDay),
        time: cell(colTime),
        week: weekLabel,
        customer,
        product,
        po,
        bolNumber,
        qty,
        carrier: cell(colCarrier),
        arrive: cell(colArrive),
        start: cell(colStart),
        out: cell(colOut),
        bay,
        location: locationName,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Appointment → Order/Shipment mapping                                */
/* ------------------------------------------------------------------ */

/**
 * Resolves a free-text customer string from the sheet against the app's
 * Customer catalog. Tries exact match (case-insensitive), then prefix /
 * contains match. Returns the canonical Customer.name when found, else
 * the original string.
 */
function resolveCustomerName(raw: string, customers: Customer[]): string {
  if (!raw) return raw;
  const norm = raw.trim().toLowerCase();
  let match = customers.find(c => c.name?.trim().toLowerCase() === norm);
  if (match) return match.name;
  match = customers.find(c => c.name?.trim().toLowerCase().startsWith(norm)
    || norm.startsWith(c.name?.trim().toLowerCase() || ''));
  if (match) return match.name;
  match = customers.find(c => {
    const cn = c.name?.trim().toLowerCase() || '';
    return cn.includes(norm) || norm.includes(cn);
  });
  return match ? match.name : raw;
}

/**
 * Resolves a free-text product string against SKU + QA catalog. Tries
 * exact match on SKU.name / QA.skuName (case-insensitive), then SKU
 * shortform pattern matches. Returns:
 *   { productName, productDisplayName, productKey } when matched, or
 *   { productName: raw } when not matched (keeps raw text — same as
 *   legacy orders flagged as "unmatched product" by the app).
 */
function resolveProductReferences(
  raw: string,
  skus: SKU[],
  qaProducts: QAProduct[],
): { productName: string; productDisplayName?: string; productKey?: string } {
  if (!raw) return { productName: raw };
  const norm = raw.trim().toLowerCase();
  // Try exact match on SKU.name
  const exactSku = skus.find(s => s.name?.trim().toLowerCase() === norm);
  if (exactSku) {
    const qa = qaProducts.find(q => q.skuId === exactSku.id) || null;
    return {
      productName: exactSku.name,
      productKey: qa?.id || exactSku.id,
    };
  }
  // Try QA.skuName
  const qaByName = qaProducts.find(q => q.skuName?.trim().toLowerCase() === norm);
  if (qaByName) {
    return {
      productName: qaByName.skuName || raw,
      productKey: qaByName.id,
    };
  }
  // Substring / loose match (e.g. "LIQUID 100" → SKU containing "Liquid")
  const looseSku = skus.find(s => {
    const sn = s.name?.trim().toLowerCase() || '';
    return sn && (sn.includes(norm) || norm.includes(sn));
  });
  if (looseSku) {
    const qa = qaProducts.find(q => q.skuId === looseSku.id) || null;
    return {
      productName: looseSku.name,
      productKey: qa?.id || looseSku.id,
    };
  }
  // Unmatched — keep raw
  return { productName: raw };
}

/**
 * Resolves a free-text carrier string against the app's Carrier list.
 * Caller passes the carrier list; we return the canonical name when found,
 * otherwise the raw text (handled by the app's free-text carrier path).
 */
function resolveCarrierName(raw: string, carriers: Array<{ name: string }>): string {
  if (!raw) return raw;
  const norm = raw.trim().toLowerCase();
  const exact = carriers.find(c => c.name.trim().toLowerCase() === norm);
  if (exact) return exact.name;
  const loose = carriers.find(c => {
    const n = c.name.trim().toLowerCase();
    return n.includes(norm) || norm.includes(n);
  });
  return loose ? loose.name : raw;
}

/**
 * Converts a list of parsed appointments into Order + Shipment records
 * ready for state insertion. Existing orders matching by BOL are recorded
 * in `skipped` (per "Skip duplicates" requirement); existing shipments
 * matching by BOL+date+time+bay are also skipped.
 */
export function appointmentsToOrdersAndShipments(
  appointments: ParsedAppointment[],
  existingOrders: Order[],
  existingShipments: Shipment[],
  customers: Customer[],
  skus: SKU[],
  qaProducts: QAProduct[],
  carriers: Array<{ name: string }>,
): SyncResult {
  const result: SyncResult = {
    newOrders: [],
    newShipments: [],
    skipped: [],
    errors: [],
  };

  const existingBOLs = new Set(
    existingOrders.map(o => (o.bolNumber || '').trim().toUpperCase()).filter(Boolean),
  );
  // Track BOLs we're adding in this batch so two rows with the same BOL
  // (e.g. one for the order, one for a shipment-only re-import) don't
  // both create orders.
  const addedBOLs = new Set<string>();

  const shipmentKey = (s: { bol?: string; date?: string; time?: string; bay?: string }) =>
    `${(s.bol || '').trim().toUpperCase()}|${s.date || ''}|${s.time || ''}|${s.bay || ''}`;
  const existingShipmentKeys = new Set(existingShipments.map(s => shipmentKey(s)));

  for (const appt of appointments) {
    try {
      const bolUpper = appt.bolNumber.trim().toUpperCase();
      const customerCanonical = resolveCustomerName(appt.customer, customers);
      const productRefs = resolveProductReferences(appt.product, skus, qaProducts);
      const carrierCanonical = resolveCarrierName(appt.carrier, carriers);

      // 1. Order — only create if BOL is new
      const orderExists = existingBOLs.has(bolUpper) || addedBOLs.has(bolUpper);
      let bolForLink = appt.bolNumber;
      if (orderExists) {
        result.skipped.push({
          bolNumber: appt.bolNumber,
          reason: 'Order with this BOL already exists',
        });
      } else {
        const lineItem: OrderLineItem = {
          id: `LI-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          productName: productRefs.productName,
          productDisplayName: productRefs.productDisplayName,
          productKey: productRefs.productKey,
          qty: appt.qty,
          contractNumber: '',
          netWeightPerUnit: 0,
          totalWeight: 0,
          unitAmount: 0,
          mtAmount: 0,
          lineAmount: 0,
        };
        const newOrder: Order = {
          id: `ORD-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          bolNumber: appt.bolNumber,
          customer: customerCanonical,
          product: productRefs.productDisplayName || productRefs.productName,
          po: appt.po,
          date: appt.date,
          shipmentDate: appt.date,
          status: 'Open',
          lineItems: [lineItem],
          amount: 0,
          carrier: carrierCanonical || undefined,
          location: appt.location,
        };
        result.newOrders.push(newOrder);
        addedBOLs.add(bolUpper);
        bolForLink = newOrder.bolNumber;
      }

      // 2. Shipment — only create if (BOL, date, time, bay) is new
      const shipKey = shipmentKey({
        bol: bolForLink, date: appt.date, time: appt.time, bay: appt.bay,
      });
      if (existingShipmentKeys.has(shipKey)) {
        result.skipped.push({
          bolNumber: appt.bolNumber,
          reason: 'Shipment already scheduled for this BOL/date/time/bay',
        });
        continue;
      }
      const newShipment: Shipment = {
        id: `SHIP-IMPORT-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        week: appt.week,
        date: appt.date,
        day: appt.day,
        time: appt.time,
        bay: appt.bay,
        customer: customerCanonical,
        product: productRefs.productDisplayName || productRefs.productName,
        po: appt.po,
        bol: bolForLink,
        qty: appt.qty,
        carrier: carrierCanonical,
        arrive: appt.arrive,
        start: appt.start,
        out: appt.out,
        status: 'Scheduled',
        location: appt.location,
      };
      result.newShipments.push(newShipment);
      existingShipmentKeys.add(shipKey);
    } catch (err) {
      result.errors.push({
        rowIdx: appt.rowIdx,
        bay: appt.bay,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Top-level sync orchestrator                                         */
/* ------------------------------------------------------------------ */

/**
 * Fetches FERGUSON + SHERMAN tabs, parses each, and produces a unified
 * SyncResult. Errors fetching any individual tab are surfaced via the
 * errors[] array rather than throwing — the caller can show whichever
 * tabs succeeded.
 */
export async function syncShipmentScheduleSheet(opts: {
  existingOrders: Order[];
  existingShipments: Shipment[];
  customers: Customer[];
  skus: SKU[];
  qaProducts: QAProduct[];
  carriers: Array<{ name: string }>;
}): Promise<SyncResult> {
  const tabs = Object.entries(SHEET_TAB_TO_LOCATION);
  const allAppointments: ParsedAppointment[] = [];
  const fetchErrors: SyncResult['errors'] = [];

  for (const [tabName, locationName] of tabs) {
    try {
      const csv = await fetchTabCSV(tabName);
      const rows = parseCSV(csv);
      const appts = parseShipmentScheduleTab(rows, locationName);
      allAppointments.push(...appts);
    } catch (err) {
      fetchErrors.push({
        rowIdx: 0,
        bay: tabName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const result = appointmentsToOrdersAndShipments(
    allAppointments,
    opts.existingOrders,
    opts.existingShipments,
    opts.customers,
    opts.skus,
    opts.qaProducts,
    opts.carriers,
  );
  result.errors.unshift(...fetchErrors);
  return result;
}
