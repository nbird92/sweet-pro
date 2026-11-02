// Hamilton (Sherman) shipment-schedule sync.
//
// The Sherman dock schedule ("2026 SHIPMENT SCHEDULE" workbook, SHERMAN tab) is a
// WIDE grid, not a table:
//   • Row 1 holds the BAY names, each merged horizontally across its columns
//     ("Liquid/Bulk Scale 1 (North)", "Liquid/Bulk Scale 2 (South)",
//     "BAY 3 - MOLASSES", "DRY DOCKS"), followed by summary blocks (QUANTITY
//     ORDERED, PRODUCTION RATE, ESTIMATED INVENTORY) that are not bays.
//   • Row 2 holds the field headers. Every bay has its own WEEK/DATE/DAY/TIME
//     block, and that block sits to the LEFT of the bay's merged name — i.e. in
//     the gap after the previous bay. Carrying a bay name forward across blanks
//     (what a CSV export forces on us) therefore hands each slot block to the
//     WRONG bay. Instead we scan the header row left→right: a slot block opens a
//     "pending" slot that the next bay name to its right claims.
//   • Every row below is one 90-min appointment slot; a bay is booked in that
//     slot when its CUSTOMER/CLIENT cell is filled.
//
// The parse is pure (grid → rows). Classification against the live schedule
// (new / update / unchanged / conflict) is a separate pure step so the modal can
// re-classify instantly as the user remaps bays or changes the date window.

import type { Customer, SKU, QAProduct, Carrier, Shipment } from '../types';
import { resolveCustomer, resolveCarrier, resolveProduct, stripUndefined } from './googleOrderSheetSync';

export const HAMILTON_SCHEDULE_SHEET_ID = '1pu359fHqjTzG8r8iBUv8zuroyOEZw_XxwWO-VsZtLRc';
export const HAMILTON_SCHEDULE_TAB = 'SHERMAN';
export const HAMILTON_SCHEDULE_LOCATION = 'Hamilton (Sherman)';

type SlotField = 'week' | 'date' | 'day' | 'time';
type DataField = 'customer' | 'product' | 'po' | 'bol' | 'qty' | 'carrier' | 'arrive' | 'start' | 'out';

/** One bay panel detected in the sheet, with the column index of each field. */
export interface SheetBay {
  name: string;
  cols: Partial<Record<SlotField | DataField, number>>;
}

/** One booked bay-slot read from the sheet (no app-side resolution of the bay yet). */
export interface ScheduleRow {
  key: string;          // stable id within one read: `${bay}|${sheetRow}`
  sheetRow: number;     // 1-based sheet row, for reference back to the sheet
  sheetBay: string;
  date: string;         // ISO YYYY-MM-DD
  time: string;         // HH:MM (24h, zero-padded — matches the app's slot labels)
  customerRaw: string;
  customer: string;     // resolved to the catalog name when possible
  productRaw: string;
  product: string;
  po: string;
  bol: string;
  qty: number;
  carrier: string;
  arrive: string;
  start: string;
  out: string;
}

export interface ScheduleParseResult {
  bays: SheetBay[];
  rows: ScheduleRow[];
  /** Booked cells that couldn't be read (bad date etc.). */
  problems: Array<{ sheetRow: number; sheetBay: string; message: string }>;
}

const FIELD_ALIASES: Record<string, SlotField | DataField> = {
  week: 'week', date: 'date', day: 'day', time: 'time',
  customer: 'customer', client: 'customer',
  product: 'product', po: 'po', 'po #': 'po', 'po#': 'po',
  'bol #': 'bol', 'bol#': 'bol', bol: 'bol', 'bol number': 'bol',
  qty: 'qty', quantity: 'qty',
  carrier: 'carrier', arrive: 'arrive', arrived: 'arrive', start: 'start', out: 'out',
};
const SLOT_FIELDS = new Set<string>(['week', 'date', 'day', 'time']);

/** Locate the field-header row (has CUSTOMER/CLIENT + PRODUCT) and the bays above it. */
export function detectScheduleBays(grid: string[][]): { fieldRowIdx: number; bays: SheetBay[] } {
  const norm = (s: string) => (s || '').trim().toLowerCase();
  let fieldRowIdx = -1;
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const row = (grid[r] || []).map(norm);
    if (row.some(c => c === 'customer' || c === 'client') && row.includes('product')) { fieldRowIdx = r; break; }
  }
  if (fieldRowIdx < 1) return { fieldRowIdx, bays: [] };

  const fieldRow = grid[fieldRowIdx] || [];
  const groupRow = grid[fieldRowIdx - 1] || [];
  const width = Math.max(fieldRow.length, groupRow.length);

  const bays: SheetBay[] = [];
  let current: SheetBay | null = null;
  let pendingSlot: SheetBay['cols'] = {};
  const close = () => { if (current) bays.push(current); current = null; };

  for (let c = 0; c < width; c++) {
    const g = (groupRow[c] || '').trim();
    const f = FIELD_ALIASES[norm(fieldRow[c])];
    if (g) {
      // A bay name starts here — it claims the slot block waiting to its left.
      close();
      current = { name: g.replace(/\s+/g, ' '), cols: { ...pendingSlot } };
      pendingSlot = {};
    }
    if (!f) continue;
    if (SLOT_FIELDS.has(f)) {
      const cur = current as SheetBay | null;
      if (cur && cur.cols.customer === undefined) {
        // Bay name merged over its own slot block — keep it with that bay.
        if (cur.cols[f] === undefined) cur.cols[f] = c;
      } else {
        // Slot block after a bay's data columns → belongs to the NEXT bay.
        close();
        if (pendingSlot[f] === undefined) pendingSlot[f] = c;
      }
      continue;
    }
    const cur = current as SheetBay | null;
    if (cur && cur.cols[f] === undefined) cur.cols[f] = c;
  }
  close();

  // Summary blocks (QUANTITY ORDERED, ESTIMATED INVENTORY…) have no customer column.
  return { fieldRowIdx, bays: bays.filter(b => b.cols.customer !== undefined) };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) =>
  (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';

/** Schedule date cell → ISO. The sheet shows "Jan 1" (no year), so `year` fills it in. */
export function parseScheduleDateCell(raw: string, year: number): string {
  const s = (raw || '').trim();
  if (!s) return '';
  let m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi < 0 ? '' : iso(m[3] ? parseInt(m[3], 10) : year, mi + 1, parseInt(m[2], 10));
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})(?:[-\s](\d{2,4}))?$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    let y = m[3] ? parseInt(m[3], 10) : year;
    if (y < 100) y += 2000;
    return mi < 0 ? '' : iso(y, mi + 1, parseInt(m[1], 10));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? parseInt(m[3], 10) : year;
    if (y < 100) y += 2000;
    return iso(y, parseInt(m[1], 10), parseInt(m[2], 10));
  }
  // Raw serial date (an unformatted cell): days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(s)) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return '';
}

/** Time cell → "HH:MM" 24h. Accepts "0:00", "13:30", "1:30 PM", "11.05AM", or a day fraction. */
export function normalizeScheduleTime(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^0?\.\d+$/.test(s)) {
    const mins = Math.round(parseFloat(s) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Catalog SKU/QA names are often format-only ("Bulk") and the Molasses SKU is
// literally named "Bulk" — a resolver hit on a bare format word is not a real
// product match, so keep the sheet's own text ("BULK 100") instead.
const GENERIC_PRODUCT = /^(bulk|bag|bags|tote|totes|liquid|granulated)$/i;

/** Parse the whole SHERMAN grid into booked bay-slots. */
export function parseHamiltonSchedule(
  grid: string[][],
  opts: { year: number },
  ctx: { customers: Customer[]; skus: SKU[]; qaProducts: QAProduct[]; carriers: Carrier[] },
): ScheduleParseResult {
  const { fieldRowIdx, bays } = detectScheduleBays(grid);
  const result: ScheduleParseResult = { bays, rows: [], problems: [] };
  if (fieldRowIdx < 0 || bays.length === 0) return result;

  // Fallback slot columns (the first bay's block) for a bay without its own.
  const rowSlot = bays.find(b => b.cols.date !== undefined)?.cols || {};
  const cell = (row: string[], idx: number | undefined) => (idx === undefined ? '' : (row[idx] ?? '').toString().trim());
  const custCache = new Map<string, string>();
  const prodCache = new Map<string, string>();
  const carrCache = new Map<string, string>();
  const memo = (cache: Map<string, string>, k: string, fn: () => string) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k)!;
  };

  for (let r = fieldRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    for (const bay of bays) {
      const customerRaw = cell(row, bay.cols.customer);
      if (!customerRaw) continue;
      const cl = customerRaw.toLowerCase();
      if (cl === 'customer' || cl === 'client') continue; // repeated header block

      const rawDate = cell(row, bay.cols.date ?? rowSlot.date);
      const date = parseScheduleDateCell(rawDate, opts.year);
      if (!date) {
        result.problems.push({ sheetRow: r + 1, sheetBay: bay.name, message: `Unreadable date "${rawDate}" for ${customerRaw}` });
        continue;
      }
      const productRaw = cell(row, bay.cols.product);
      const carrierRaw = cell(row, bay.cols.carrier);
      result.rows.push({
        key: `${bay.name}|${r + 1}`,
        sheetRow: r + 1,
        sheetBay: bay.name,
        date,
        time: normalizeScheduleTime(cell(row, bay.cols.time ?? rowSlot.time)),
        customerRaw,
        customer: memo(custCache, customerRaw, () => resolveCustomer(customerRaw, ctx.customers) || customerRaw),
        productRaw,
        product: memo(prodCache, productRaw, () => {
          if (!productRaw) return '';
          const p = resolveProduct(productRaw, ctx.skus, ctx.qaProducts);
          const name = p.productDisplayName || '';
          return name && !GENERIC_PRODUCT.test(name.trim()) ? name : productRaw;
        }),
        po: cell(row, bay.cols.po),
        bol: cell(row, bay.cols.bol),
        qty: parseFloat(cell(row, bay.cols.qty).replace(/,/g, '')) || 0,
        carrier: memo(carrCache, carrierRaw, () => resolveCarrier(carrierRaw, ctx.carriers) || carrierRaw),
        arrive: cell(row, bay.cols.arrive),
        start: cell(row, bay.cols.start),
        out: cell(row, bay.cols.out),
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Classification against the live schedule                            */
/* ------------------------------------------------------------------ */

export type ScheduleRowKind = 'new' | 'update' | 'unchanged' | 'conflict';

export interface ClassifiedScheduleRow extends ScheduleRow {
  kind: ScheduleRowKind;
  appBay: string;
  /** Existing shipment this row matched (update / unchanged) or collides with (conflict). */
  existing?: Shipment;
  /** Field-level changes an update would apply. */
  changes: Array<{ field: keyof Shipment; from: string; to: string }>;
  patch?: Partial<Shipment>;
  /** Ready-to-insert record for a new row. */
  shipment?: Shipment;
  note?: string;
}

const LONG_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** ISO-8601 week number — identical to App.tsx getWeekNumber so rows land in the right grid week. */
export function isoWeekNumber(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const target = new Date(date.valueOf());
  const dayNum = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const week1Monday = new Date(jan4.valueOf());
  week1Monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - week1Monday.getTime()) / (7 * 86400000));
}
const weekdayOf = (dateISO: string) => LONG_DAY[new Date(dateISO + 'T12:00:00').getDay()] || '';

/** Status implied by the sheet's ARRIVE / START / OUT stamps. */
function sheetStatus(r: ScheduleRow): string {
  if (r.out) return 'Completed';
  if (r.arrive || r.start) return 'In Progress';
  return 'Confirmed';
}
const STATUS_RANK: Record<string, number> = { '': 0, scheduled: 1, confirmed: 1, 'in progress': 2, completed: 3 };

const normKey = (s: string | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sameCustomer = (a: string, b: string) => {
  const x = normKey(a), y = normKey(b);
  return !!x && !!y && (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))));
};

/**
 * Classify parsed rows against existing Sherman shipments.
 *  • bayMap: sheet bay name → app bay name ('' = skip that bay).
 *  • Rows outside [from, to] or on a skipped bay are dropped (counted in `excluded`).
 * Matching (first hit wins, each existing shipment matched at most once):
 *   1. same BOL;  2. same PO on the same date;  3. same slot (date+time+bay) and customer.
 */
export function classifyScheduleRows(
  rows: ScheduleRow[],
  opts: { bayMap: Record<string, string>; from?: string; to?: string; location: string; existing: Shipment[]; appBays: string[] },
): { rows: ClassifiedScheduleRow[]; excluded: number } {
  const appBaySet = new Set(opts.appBays);
  const pool = opts.existing.filter(s => {
    const loc = (s.location || '').toLowerCase();
    if (loc.includes('sherman')) return true;
    if (loc.includes('ferguson') || loc.includes('vancouver')) return false;
    return appBaySet.has(s.bay);
  });
  const slotKey = (date: string, time: string, bay: string) => `${date}|${normalizeScheduleTime(time) || time}|${bay}`;
  const byBol = new Map<string, Shipment[]>();
  const byPoDate = new Map<string, Shipment[]>();
  const bySlot = new Map<string, Shipment>();
  const push = (m: Map<string, Shipment[]>, k: string, s: Shipment) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); };
  for (const s of pool) {
    if (normKey(s.bol)) push(byBol, normKey(s.bol), s);
    if (normKey(s.po) && s.date) push(byPoDate, `${normKey(s.po)}|${s.date}`, s);
    if (s.date && s.bay) bySlot.set(slotKey(s.date, s.time, s.bay), s);
  }

  const used = new Set<string>();
  const takenSlots = new Map<string, string>(); // slot → who holds it in this import
  const out: ClassifiedScheduleRow[] = [];
  let excluded = 0;

  for (const r of rows) {
    const appBay = opts.bayMap[r.sheetBay] || '';
    if (!appBay || (opts.from && r.date < opts.from) || (opts.to && r.date > opts.to)) { excluded++; continue; }

    const free = (list?: Shipment[]) => (list || []).filter(s => !used.has(s.id));
    let match: Shipment | undefined;
    if (normKey(r.bol)) {
      const hits = free(byBol.get(normKey(r.bol)));
      match = hits.find(s => s.date === r.date) || hits[0];
    }
    if (!match && normKey(r.po)) {
      const hits = free(byPoDate.get(`${normKey(r.po)}|${r.date}`));
      match = hits.find(s => normalizeScheduleTime(s.time) === r.time) || hits[0];
    }
    const slot = slotKey(r.date, r.time, appBay);
    const occupant = bySlot.get(slot);
    if (!match && occupant && !used.has(occupant.id) && sameCustomer(occupant.customer, r.customer)) match = occupant;

    const status = sheetStatus(r);
    if (match) {
      used.add(match.id);
      const changes: ClassifiedScheduleRow['changes'] = [];
      const patch: Partial<Shipment> = {};
      const set = (field: keyof Shipment, to: string | number, from: string | number) => {
        changes.push({ field, from: String(from ?? ''), to: String(to) });
        (patch as any)[field] = to;
      };
      // Slot fields: the sheet is the dock's source of truth.
      if (r.date !== match.date) { set('date', r.date, match.date); patch.week = `Week ${isoWeekNumber(r.date)}`; patch.day = weekdayOf(r.date); }
      if (r.time && r.time !== normalizeScheduleTime(match.time)) set('time', r.time, match.time);
      if (appBay !== match.bay) set('bay', appBay, match.bay);
      if (r.carrier && r.carrier !== match.carrier) set('carrier', r.carrier, match.carrier);
      if (r.arrive && r.arrive !== match.arrive) set('arrive', r.arrive, match.arrive);
      if (r.start && r.start !== match.start) set('start', r.start, match.start);
      if (r.out && r.out !== match.out) set('out', r.out, match.out);
      // Identity / quantity: fill blanks only — never overwrite what the app holds.
      if (r.po && !(match.po || '').trim()) set('po', r.po, '');
      if (r.bol && !(match.bol || '').trim()) set('bol', r.bol, '');
      if (r.qty > 0 && !(match.qty > 0)) set('qty', r.qty, match.qty);
      if (!(match.location || '').trim()) set('location', opts.location, '');
      const cur = (match.status || '').toLowerCase();
      if (cur !== 'cancelled' && (STATUS_RANK[status.toLowerCase()] ?? 0) > (STATUS_RANK[cur] ?? 0)) set('status', status, match.status);

      const moved = patch.date !== undefined || patch.time !== undefined || patch.bay !== undefined;
      const target = slotKey(r.date, r.time || match.time, appBay);
      const blocker = moved ? bySlot.get(target) : undefined;
      takenSlots.set(target, match.id);
      out.push({
        ...r, appBay, existing: match, changes,
        kind: changes.length ? 'update' : 'unchanged',
        patch: changes.length ? stripUndefined(patch) : undefined,
        note: blocker && blocker.id !== match.id ? `Moves into a slot held by ${blocker.customer || 'another shipment'}` : undefined,
      });
      continue;
    }

    const blocker = (occupant && !used.has(occupant.id)) ? occupant : undefined;
    const heldByImport = takenSlots.get(slot);
    const shipment: Shipment = stripUndefined({
      id: `SHIP-SHER-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      week: `Week ${isoWeekNumber(r.date)}`,
      date: r.date,
      day: weekdayOf(r.date),
      time: r.time,
      bay: appBay,
      customer: r.customer,
      product: r.product,
      po: r.po,
      bol: r.bol,
      qty: r.qty,
      carrier: r.carrier,
      arrive: r.arrive,
      start: r.start,
      out: r.out,
      status,
      notes: '',
      location: opts.location,
    } as Shipment);
    if (blocker || heldByImport) {
      out.push({
        ...r, appBay, kind: 'conflict', changes: [], shipment, existing: blocker,
        note: blocker
          ? `Slot already holds ${blocker.customer || 'a shipment'}${blocker.bol ? ` (BOL ${blocker.bol})` : ''}`
          : 'Another sheet row maps to the same slot',
      });
    } else {
      takenSlots.set(slot, shipment.id);
      out.push({ ...r, appBay, kind: 'new', changes: [], shipment });
    }
  }
  return { rows: out, excluded };
}

/** Best-guess app bay for a sheet bay name ('' = skip). Molasses transfers default to skip. */
export function guessAppBay(sheetBay: string, appBays: string[]): string {
  const n = sheetBay.toLowerCase();
  const exact = appBays.find(b => b.trim().toLowerCase() === n.trim());
  if (exact) return exact;
  const tokens = (s: string) => {
    const t = s.toLowerCase();
    const out: string[] = [];
    if (/molasses|\bmol\b/.test(t)) out.push('molasses');
    if (/dry|tote|bag/.test(t)) out.push('dry');
    if (/north|scale\s*1|bay\s*1\b|\b1\b/.test(t)) out.push('1');
    if (/south|scale\s*2|bay\s*2\b|\b2\b/.test(t)) out.push('2');
    if (/bay\s*3|\b3\b/.test(t)) out.push('3');
    if (/liquid|bulk|scale/.test(t)) out.push('liquid');
    return out;
  };
  const want = tokens(sheetBay);
  let best = '', bestScore = 0;
  for (const b of appBays) {
    const have = tokens(b);
    const score = want.filter(t => have.includes(t)).length * 2 - have.filter(t => !want.includes(t)).length;
    if (score > bestScore) { best = b; bestScore = score; }
  }
  if (!best && want.includes('molasses')) return '';
  return best;
}

/* ------------------------------------------------------------------ */
/* Saved settings — shared by the modal and the unattended Sync All    */
/* ------------------------------------------------------------------ */

export const HAMILTON_BAY_MAP_KEY = 'hamiltonScheduleBayMap';
const HAMILTON_SOURCE_KEY = 'hamiltonScheduleSource';

export function loadHamiltonBayMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(HAMILTON_BAY_MAP_KEY) || '{}'); } catch { return {}; }
}
export function saveHamiltonBayMap(map: Record<string, string>) {
  try { localStorage.setItem(HAMILTON_BAY_MAP_KEY, JSON.stringify(map)); } catch {}
}
/** Sheet + tab last read successfully in the modal (defaults to the Sherman workbook). */
export function loadHamiltonSource(): { sheetId: string; tab: string } {
  try {
    const s = JSON.parse(localStorage.getItem(HAMILTON_SOURCE_KEY) || '{}');
    return { sheetId: s.sheetId || HAMILTON_SCHEDULE_SHEET_ID, tab: s.tab || HAMILTON_SCHEDULE_TAB };
  } catch { return { sheetId: HAMILTON_SCHEDULE_SHEET_ID, tab: HAMILTON_SCHEDULE_TAB }; }
}
export function saveHamiltonSource(src: { sheetId: string; tab: string }) {
  try { localStorage.setItem(HAMILTON_SOURCE_KEY, JSON.stringify(src)); } catch {}
}
