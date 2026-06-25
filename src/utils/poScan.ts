// Client helper for the "Scan Purchase Order" feature.
//
// Reads uploaded PO files, calls the /api/extract-po endpoint (Gemini-backed),
// and provides best-effort matching of the extracted text to the app's
// catalog (customers / products / contracts). User corrections are remembered
// in localStorage and fed back to the extractor as "learned" hints so repeat
// POs from the same customer map themselves over time.

import type { Customer, Contract, ShipToLocation } from '../types';

export interface ExtractedLineItem {
  description: string;
  itemNumber?: string;
  quantity: number;
  unit?: string;
  quantityMt?: number;
  unitPrice?: number;
  priceBasis?: string;
  pricePerMt?: number;
  amount?: number;
  deliveryDate?: string;
}

export interface ExtractedPO {
  sourceFile?: string;
  poNumber: string;
  customerName: string;
  customerNumber?: string;
  customerDomain?: string;
  shipToName?: string;
  shipToAddress?: string;
  orderDate?: string;
  shipmentDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  currency?: string;
  paymentTerms?: string;
  shippingTerms?: string;
  carrier?: string;
  carrierDomain?: string;
  contractNumber?: string;
  /** Split / shipment-split number to attach to an existing PO or invoice
   *  (e.g. supplied by an internal "Stock Request" email). */
  splitNumber?: string;
  totalAmount?: number;
  notes?: string;
  confidence?: number;
  lineItems: ExtractedLineItem[];
  /** Classification of the email/document. Absent => treat as a new order. */
  documentType?: 'new_order' | 'amendment' | 'cancellation' | 'other';
  /** For amendment/cancellation: the PO number of the existing order to change. */
  amendsPoNumber?: string;
  amendment?: {
    newShipmentDate?: string;
    newDeliveryDate?: string;
    newQuantityMt?: number;
    newSplitNumber?: string;
    cancel?: boolean;
    summary?: string;
  };
}

export interface ExtractResponse {
  extractions: ExtractedPO[];
  errors?: Array<{ file: string; message: string }>;
}

export interface UploadFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/** Read a File into the { name, mimeType, dataBase64 } shape the API expects. */
export function fileToUpload(file: File): Promise<UploadFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      const dataBase64 = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({
        name: file.name,
        mimeType: file.type || guessMime(file.name),
        dataBase64,
      });
    };
    reader.readAsDataURL(file);
  });
}

function guessMime(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (n.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (n.endsWith('.csv')) return 'text/csv';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export interface ExtractHints {
  customers?: string[];
  products?: string[];
  contracts?: string[];
  learned?: LearnedMapping[];
}

/** POST files to the extraction endpoint and return parsed POs. */
export async function extractPOs(files: UploadFile[], hints: ExtractHints): Promise<ExtractResponse> {
  const sharedSecret = (import.meta as any).env?.VITE_EXTRACT_SHARED_SECRET as string | undefined;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sharedSecret) headers['Authorization'] = `Bearer ${sharedSecret}`;

  const res = await fetch('/api/extract-po', {
    method: 'POST',
    headers,
    body: JSON.stringify({ files, hints }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Extraction failed (HTTP ${res.status}).`);
  }
  return body as ExtractResponse;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export function normalize(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Token-overlap score in [0,1] between two strings. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set((a.toLowerCase().match(/[a-z0-9]+/g) || []));
  const tb = new Set((b.toLowerCase().match(/[a-z0-9]+/g) || []));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach(t => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

/** Best customer match by name / customer number, honouring learned aliases. */
export function matchCustomer(
  raw: string,
  customerNumber: string | undefined,
  customers: Customer[],
  learned: LearnedMapping[],
): Customer | null {
  if (!raw && !customerNumber) return null;
  const learnedTo = findLearned(learned, 'customer', raw);
  if (learnedTo) {
    const byLearned = customers.find(c => c.id === learnedTo || c.name === learnedTo);
    if (byLearned) return byLearned;
  }
  if (customerNumber) {
    const byNum = customers.find(c => (c.customerNumber || '').trim() && normalize(c.customerNumber) === normalize(customerNumber));
    if (byNum) return byNum;
  }
  let best: Customer | null = null;
  let bestScore = 0.45; // threshold
  for (const c of customers) {
    const score = similarity(raw, c.name);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

export interface ProductOption { value: string; label: string; key: string; location: string; }

/** Best product-option match for a line, honouring learned aliases. Tries the
 *  vendor item code first (the most stable signal — it survives wording changes
 *  in the description), then the description text, then fuzzy similarity. */
export function matchProduct(
  raw: string,
  options: ProductOption[],
  learned: LearnedMapping[],
  itemCode?: string,
): ProductOption | null {
  // 1) Learned by the buyer's vendor item code (e.g. LC325X -> our SKU).
  if (itemCode && itemCode.trim()) {
    const byCode = findLearned(learned, 'product', itemCode);
    if (byCode) {
      const o = options.find(x => x.value === byCode);
      if (o) return o;
    }
  }
  if (!raw) return null;
  // 2) Learned by the description text.
  const learnedTo = findLearned(learned, 'product', raw);
  if (learnedTo) {
    const byLearned = options.find(o => o.value === learnedTo);
    if (byLearned) return byLearned;
  }
  // 3) Fuzzy similarity against the option label / value.
  let best: ProductOption | null = null;
  let bestScore = 0.34;
  for (const o of options) {
    const score = Math.max(similarity(raw, o.label), similarity(raw, o.value));
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/** Best contract match by number, honouring learned aliases. */
export function matchContract(
  raw: string | undefined,
  contracts: Contract[],
  learned: LearnedMapping[],
): Contract | null {
  if (!raw) return null;
  const learnedTo = findLearned(learned, 'contract', raw);
  if (learnedTo) {
    const byLearned = contracts.find(c => c.contractNumber === learnedTo);
    if (byLearned) return byLearned;
  }
  const exact = contracts.find(c => normalize(c.contractNumber) === normalize(raw));
  return exact || null;
}

/** Best ship-to match within a customer's ship-to locations, comparing the PO's
 *  extracted ship-to name + address against each location's name/address. */
export function matchShipToLocation(
  rawName: string | undefined,
  rawAddress: string | undefined,
  locations: ShipToLocation[] | undefined,
): ShipToLocation | null {
  if (!locations || locations.length === 0) return null;
  const hay = `${rawName || ''} ${rawAddress || ''}`.trim();
  if (!hay) return null;
  let best: ShipToLocation | null = null;
  // Match the customer matcher's threshold so a couple of shared generic
  // address tokens (e.g. "Toronto ON") can't trip a wrong default.
  let bestScore = 0.45;
  for (const loc of locations) {
    const locStr = [loc.name, loc.addressLine1, loc.addressLine2, loc.city, loc.province, loc.postalCode]
      .filter(Boolean).join(' ');
    const score = Math.max(
      similarity(hay, locStr),
      similarity(rawName || '', loc.name),
      similarity(rawAddress || '', locStr),
    );
    if (score > bestScore) { bestScore = score; best = loc; }
  }
  return best;
}

/** Best-effort parse of a one-line North American address into structured fields
 *  so a scanned ship-to populates the proper columns (street / city / province /
 *  postal / country) instead of dumping everything into addressLine1. Anything it
 *  can't classify stays in addressLine1. */
export function parseAddress(raw: string): {
  addressLine1: string; city: string; province: string; postalCode: string; country: string;
} {
  let s = (raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { addressLine1: '', city: '', province: '', postalCode: '', country: '' };
  let country = '';
  const cm = s.match(/,?\s*(CANADA|UNITED STATES|U\.?S\.?A\.?)\s*$/i);
  if (cm && cm.index != null) { country = /can/i.test(cm[1]) ? 'Canada' : 'USA'; s = s.slice(0, cm.index).replace(/,\s*$/, '').trim(); }
  const cut = (m: RegExpMatchArray) => (s.slice(0, m.index) + s.slice((m.index || 0) + m[0].length)).replace(/\s+/g, ' ').replace(/\s,/g, ',').trim();
  let postalCode = '';
  const ca = s.match(/\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b/);
  const us = s.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (ca) { postalCode = `${ca[1].toUpperCase()} ${ca[2].toUpperCase()}`; s = cut(ca); if (!country) country = 'Canada'; }
  else if (us) { postalCode = us[1]; s = cut(us); if (!country) country = 'USA'; }
  let province = '';
  const provs: Record<string, string> = {
    'ONTARIO': 'ON', 'QUEBEC': 'QC', 'QUÉBEC': 'QC', 'BRITISH COLUMBIA': 'BC', 'ALBERTA': 'AB',
    'MANITOBA': 'MB', 'SASKATCHEWAN': 'SK', 'NOVA SCOTIA': 'NS', 'NEW BRUNSWICK': 'NB',
    'NEWFOUNDLAND AND LABRADOR': 'NL', 'NEWFOUNDLAND': 'NL', 'PRINCE EDWARD ISLAND': 'PE',
  };
  // Normalize any full province name to its 2-letter code in place.
  for (const [full, abbr] of Object.entries(provs)) s = s.replace(new RegExp(`\\b${full}\\b`, 'ig'), abbr);
  // Take a trailing 2-letter code, but ONLY a real province/state, so a street
  // suffix like "St" / "Rd" isn't mistaken for a province.
  const CODES = new Set('ON QC BC AB MB SK NS NB NL PE NT YT NU AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
  const pm = s.match(/(?:^|[,\s])([A-Za-z]{2})\s*,?\s*$/);
  if (pm && pm.index != null && CODES.has(pm[1].toUpperCase())) {
    province = pm[1].toUpperCase();
    s = s.slice(0, pm.index).replace(/[,\s]+$/, '').trim();
  }
  s = s.replace(/[,\s]+$/, '').replace(/^[,\s]+/, '').trim();
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  let city = '', addressLine1 = '';
  if (parts.length >= 2) { city = parts[parts.length - 1]; addressLine1 = parts.slice(0, -1).join(', '); }
  else { addressLine1 = parts[0] || ''; }
  return { addressLine1, city, province, postalCode, country };
}

/* ------------------------------------------------------------------ */
/* Learning store (localStorage)                                       */
/* ------------------------------------------------------------------ */

export type LearnedField = 'customer' | 'product' | 'contract' | 'carrier';
export interface LearnedMapping { field: LearnedField; from: string; to: string; recordedAt?: string; }

const LEARN_KEY = 'poFieldMappings';

/** Learned corrections expire this many days after they were last recorded
 *  (re-recording the same correction refreshes the window). */
export const LEARNED_TTL_DAYS = 30;

/** Drop mappings older than the TTL. Undated (legacy) entries are stamped with
 *  the current time and kept, so they expire 30 days from now rather than
 *  living forever. Returns a new, cleaned array. */
export function pruneExpired(mappings: LearnedMapping[], nowMs = Date.now()): LearnedMapping[] {
  const ttlMs = LEARNED_TTL_DAYS * 24 * 60 * 60 * 1000;
  const stamp = new Date(nowMs).toISOString();
  const out: LearnedMapping[] = [];
  for (const l of mappings || []) {
    if (!l?.field || !l?.from || !l?.to) continue;
    const at = l.recordedAt ? Date.parse(l.recordedAt) : NaN;
    if (Number.isNaN(at)) { out.push({ ...l, recordedAt: stamp }); continue; }
    if (nowMs - at <= ttlMs) out.push(l);
  }
  return out;
}

export function loadLearned(): LearnedMapping[] {
  try {
    const raw = localStorage.getItem(LEARN_KEY);
    return raw ? (JSON.parse(raw) as LearnedMapping[]) : [];
  } catch { return []; }
}

export function findLearned(learned: LearnedMapping[], field: LearnedField, from: string): string | null {
  const key = normalize(from);
  if (!key) return null;
  const hit = learned.find(l => l.field === field && normalize(l.from) === key);
  return hit ? hit.to : null;
}

/** Stable document id for a learned mapping, for syncing to Firestore. */
export function learnedId(l: LearnedMapping): string {
  return `${l.field}__${normalize(l.from)}`;
}

/** Overwrite the whole localStorage learned store (used after a remote merge). */
export function saveLearned(mappings: LearnedMapping[]): void {
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(mappings)); } catch {}
}

/** Merge two learned lists, de-duping by field + normalized `from`. Entries from
 *  `extra` win over `base` on conflict (pass local edits as `extra` so a fresh
 *  local correction overrides a stale synced value). */
export function mergeLearned(base: LearnedMapping[], extra: LearnedMapping[]): LearnedMapping[] {
  const byKey = new Map<string, LearnedMapping>();
  for (const l of [...(base || []), ...(extra || [])]) {
    if (!l?.field || !l?.from || !l?.to) continue;
    const k = `${l.field}__${normalize(l.from)}`;
    const cand: LearnedMapping = { field: l.field, from: l.from, to: l.to, recordedAt: l.recordedAt };
    const prev = byKey.get(k);
    // Most-recently-recorded entry wins (keeps the freshest correction + TTL).
    const pa = prev?.recordedAt ? Date.parse(prev.recordedAt) : 0;
    const ca = cand.recordedAt ? Date.parse(cand.recordedAt) : 0;
    if (!prev || ca >= pa) byKey.set(k, cand);
  }
  return Array.from(byKey.values());
}

/** Remember a correction (raw source text → chosen canonical value). De-dupes by field+from. */
export function recordLearned(field: LearnedField, from: string, to: string): LearnedMapping[] {
  const fromTrim = (from || '').trim();
  const toTrim = (to || '').trim();
  if (!fromTrim || !toTrim) return loadLearned();
  const current = loadLearned();
  const key = normalize(fromTrim);
  const next = current.filter(l => !(l.field === field && normalize(l.from) === key));
  next.push({ field, from: fromTrim, to: toTrim, recordedAt: new Date().toISOString() });
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(next)); } catch {}
  return next;
}
