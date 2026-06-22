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
  shipToName?: string;
  shipToAddress?: string;
  orderDate?: string;
  shipmentDate?: string;
  deliveryDate?: string;
  currency?: string;
  paymentTerms?: string;
  shippingTerms?: string;
  carrier?: string;
  contractNumber?: string;
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

/** Best product-option match for a free-text description, honouring learned aliases. */
export function matchProduct(
  raw: string,
  options: ProductOption[],
  learned: LearnedMapping[],
): ProductOption | null {
  if (!raw) return null;
  const learnedTo = findLearned(learned, 'product', raw);
  if (learnedTo) {
    const byLearned = options.find(o => o.value === learnedTo);
    if (byLearned) return byLearned;
  }
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

/* ------------------------------------------------------------------ */
/* Learning store (localStorage)                                       */
/* ------------------------------------------------------------------ */

export type LearnedField = 'customer' | 'product' | 'contract';
export interface LearnedMapping { field: LearnedField; from: string; to: string; }

const LEARN_KEY = 'poFieldMappings';

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

/** Remember a correction (raw source text → chosen canonical value). De-dupes by field+from. */
export function recordLearned(field: LearnedField, from: string, to: string): LearnedMapping[] {
  const fromTrim = (from || '').trim();
  const toTrim = (to || '').trim();
  if (!fromTrim || !toTrim) return loadLearned();
  const current = loadLearned();
  const key = normalize(fromTrim);
  const next = current.filter(l => !(l.field === field && normalize(l.from) === key));
  next.push({ field, from: fromTrim, to: toTrim });
  try { localStorage.setItem(LEARN_KEY, JSON.stringify(next)); } catch {}
  return next;
}
