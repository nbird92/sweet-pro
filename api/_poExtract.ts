// Shared PO extraction core used by both the manual upload endpoint
// (api/extract-po.ts) and the automated Gmail inbox scan (api/scan-po-inbox.ts).
//
// Calls Google Gemini (via @google/genai) with a JSON response schema so the
// model returns a single structured purchase-order object. PDFs and images are
// sent natively as inline data; Excel is flattened to text via exceljs; csv/txt
// are sent as text.

import { GoogleGenAI, Type } from '@google/genai';
import ExcelJS from 'exceljs';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Call Gemini with retry + exponential backoff on TRANSIENT errors (rate limit
 *  429 / RESOURCE_EXHAUSTED, 503 overloaded, transient network). A burst of scans
 *  — e.g. re-importing 200 emails at once — easily exceeds the per-minute quota;
 *  backing off lets the batch recover instead of failing every call. Permanent
 *  errors (bad key, invalid request) are thrown immediately. */
async function generateWithRetry(ai: GoogleGenAI, req: any, maxRetries = 4): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(req);
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      const msg = String(e?.message || e);
      const transient = status === 429 || status === 503 ||
        /\b429\b|\b503\b|rate|quota|resource[_\s-]*exhausted|overloaded|unavailable|try again|deadline/i.test(msg);
      if (!transient || attempt >= maxRetries) throw e;
      const waitMs = Math.min(20000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 600);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

export interface UploadFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ExtractHints {
  customers?: string[];
  products?: string[];
  contracts?: string[];
  carriers?: string[];
  /** Email domains of known freight carriers (from the carriers table) — used to
   *  recognise a sender as logistics, not a customer. */
  carrierDomains?: string[];
  learned?: Array<{ field: string; from: string; to: string }>;
}

// Gemini structured-output schema (Type-based). Mirrors the fields the app maps.
const PO_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    poNumber: { type: Type.STRING, description: 'The purchase order number exactly as printed.' },
    customerName: { type: Type.STRING, description: 'The BUYER that issued the PO (never Sucro Can).' },
    customerNumber: { type: Type.STRING, description: 'Customer/account number if present.' },
    customerDomain: { type: Type.STRING, description: "The customer's email domain from the participants, lowercase (e.g. ca.nestle.com). Empty if not derivable." },
    shipToName: { type: Type.STRING },
    shipToAddress: { type: Type.STRING },
    orderDate: { type: Type.STRING, description: 'ISO YYYY-MM-DD' },
    shipmentDate: { type: Type.STRING, description: 'Requested ship/pickup date, ISO YYYY-MM-DD' },
    pickupTime: { type: Type.STRING, description: 'Requested pick-up / load time at the origin, 24h HH:MM if given (e.g. "03:00" from "LOAD 0300").' },
    deliveryDate: { type: Type.STRING, description: 'Requested delivery/receipt date, ISO YYYY-MM-DD' },
    currency: { type: Type.STRING, description: 'ISO currency code, e.g. CAD or USD.' },
    paymentTerms: { type: Type.STRING },
    shippingTerms: { type: Type.STRING, description: 'Incoterms / FOB / EXW / DAP / DDP / FCA, etc.' },
    carrier: { type: Type.STRING, description: 'Freight carrier company (e.g. "Contrans", "Pick Up", "Prepaid").' },
    carrierDomain: { type: Type.STRING, description: "The carrier's email domain, lowercase (e.g. contrans.ca). Empty if not derivable." },
    contractNumber: { type: Type.STRING, description: 'Contract / agreement number if referenced.' },
    splitNumber: { type: Type.STRING, description: 'Split / shipment-split number (e.g. on an internal "Stock Request" note) to be attached to an existing PO or invoice. Capture exactly as printed.' },
    totalAmount: { type: Type.NUMBER },
    notes: { type: Type.STRING, description: 'Any special instructions worth surfacing.' },
    confidence: { type: Type.NUMBER, description: 'Overall extraction confidence 0..1.' },
    documentType: {
      type: Type.STRING,
      format: 'enum',
      enum: ['new_order', 'amendment', 'cancellation', 'other'],
      description: "Classify the input: 'new_order' (a new purchase order), 'amendment' (changes an existing order's ship date or quantity), 'cancellation' (cancels an existing order), or 'other' (unrelated mail).",
    },
    amendsPoNumber: { type: Type.STRING, description: 'For amendment/cancellation: the PO number of the EXISTING order being changed.' },
    amendment: {
      type: Type.OBJECT,
      description: 'For amendment/cancellation only — the requested change (set only the fields that change).',
      properties: {
        newShipmentDate: { type: Type.STRING, description: 'New requested ship/pickup date, ISO YYYY-MM-DD.' },
        newDeliveryDate: { type: Type.STRING, description: 'New requested delivery date, ISO YYYY-MM-DD.' },
        newQuantityMt: { type: Type.NUMBER, description: 'New TOTAL order quantity in metric tonnes.' },
        newSplitNumber: { type: Type.STRING, description: 'A split / shipment-split number to add to the existing PO or invoice (common on internal "Stock Request" notes).' },
        cancel: { type: Type.BOOLEAN, description: 'True when the order is being cancelled.' },
        summary: { type: Type.STRING, description: 'One-line plain-English summary of the requested change.' },
      },
    },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: 'Product description as written on the PO.' },
          itemNumber: { type: Type.STRING, description: "The buyer's code for this product on this line — a \"Vendor Item #\", \"Material #\", \"Customer Part #\" or similar. Capture it exactly as printed (e.g. LC325X)." },
          quantity: { type: Type.NUMBER, description: 'Quantity in the document unit.' },
          unit: { type: Type.STRING, description: 'Unit of measure (kg, lb, MT, each, ...).' },
          quantityMt: { type: Type.NUMBER, description: 'Quantity converted to metric tonnes.' },
          unitPrice: { type: Type.NUMBER, description: 'Raw unit price number.' },
          priceBasis: { type: Type.STRING, description: 'What the unit price is per (e.g. "per 100 lb").' },
          pricePerMt: { type: Type.NUMBER, description: 'Price normalized to $/MT when derivable.' },
          amount: { type: Type.NUMBER, description: 'Line extended/total price.' },
          deliveryDate: { type: Type.STRING, description: 'Per-line delivery date, ISO YYYY-MM-DD' },
        },
        required: ['description', 'quantity'],
      },
    },
  },
  required: ['documentType'],
};

// A single file/email can hold SEVERAL purchase orders (e.g. a multi-page PDF
// with one PO per page). The model returns them all under `documents`.
const PO_BATCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documents: {
      type: Type.ARRAY,
      description: 'One entry per DISTINCT purchase order / amendment / cancellation found in the input. A multi-page PDF frequently holds one PO per page — return each separately.',
      items: PO_SCHEMA,
    },
  },
  required: ['documents'],
};

export const SYSTEM_PROMPT = `You read a customer email or attached document received by Sucro Can, a sugar manufacturer and supplier, and extract structured data from it.

A single file or email may contain MULTIPLE purchase orders — e.g. a multi-page PDF with a separate PO on each page, several POs concatenated together, OR a WEEKLY SCHEDULE / calendar table that lists many POs at once (rows or columns of Date, Load/Pick-up Time, PO #, Quantity). Return EVERY distinct purchase order, amendment, or cancellation you find as its own entry in the \`documents\` array — one entry PER PO NUMBER. If the input holds only one, return an array with a single entry. Never merge two different POs (different PO numbers) into one entry, and never split a single PO across multiple entries.

Read the WHOLE email thread, including quoted/forwarded earlier messages and any later confirmation tables — an order is frequently stated in an earlier message in the thread or restated in a logistics confirmation. A PO number may appear inside a longer composite reference (e.g. "9200195450_010_4581845008_020_01"); return the customer's actual PO number (the recognizable order number, e.g. 4581845008). Capture each PO's quantity, requested ship/pick-up date, and delivery date when the schedule provides them.

Document classification (set documentType):
- 'new_order' — a new purchase order (usually an attached PO document).
- 'amendment' — a request to CHANGE an existing order, e.g. "change the ship date on PO 12345 to Jun 25", "increase PO 12345 to 40 MT", "move delivery to next week". Set amendsPoNumber to the referenced existing PO number and fill the amendment object with only the fields that change. lineItems may be empty.
- 'cancellation' — a request to cancel an existing order, e.g. "please cancel PO 12345". Set amendsPoNumber and amendment.cancel = true.
- 'other' — anything unrelated (newsletters, replies with no order content, signatures). Leave the order fields empty.

INTERNAL emails are NOT new orders:
- An email written BY internal Sucro staff — a personal address at sucro.ca / sucrocan.ca / sucrocan.com / sucro.us / surco.ca (or a sucro/sucrocan subdomain) — is an INTERNAL message, not a customer purchase order. IMPORTANT exception: a customer's PO that is merely FORWARDED through a shared Sucro order-desk group (e.g. "via Order Desk SucroCan <Orderdesk@sucro.ca>") is still that customer's NEW order — tell them apart by whether an EXTERNAL buyer is identifiable (from the thread, Reply-To, signature, or an attached PO document). If an external buyer/customer is identifiable, classify 'new_order' with that customer. If it is Sucro staff passing along an internal update (a split number, a quantity or ship-date change) with NO external buyer, classify it 'amendment' (set amendsPoNumber to the existing PO it refers to) or 'other' — never 'new_order'.
- An email whose SUBJECT contains "Stock Request" is ALWAYS an INTERNAL note that supplies a SPLIT NUMBER for an existing PO or invoice — it is NEVER a new order, regardless of sender. Classify it 'amendment', set amendsPoNumber to the referenced PO/invoice number, and put the split number in amendment.newSplitNumber AND the top-level splitNumber field.

CRITICAL — who is the customer:
- Sucro Can (any "Sucro" / "Sucro Can" / "Sucro Canada" / "Sucro Can Sourcing LLC" entity, or an address at 550 Sherman Ave N / 560 Ferguson Ave N, Hamilton ON, or an email at sucro.ca / sucrocan.ca / sucrocan.com / sucro.us) is ALWAYS the vendor/supplier — NEVER the customer. This holds EVEN when the email was sent "via Order Desk SucroCan Canada <Orderdesk@sucro.ca>": that is just a shared group the order was forwarded through, not the buyer.
- The CUSTOMER is the EXTERNAL company that placed the order (the buyer). The input may include the email's From / Reply-To / To / Cc / Subject headers, signatures, and a multi-message thread — USE THEM. Identify the customer from the participant email DOMAINS and signatures: a participant at, e.g., @ca.nestle.com identifies the customer as "Nestle". Prefer the company behind the Reply-To / external sender / signature over a group address. Normalize to the known customers list when there's an obvious match; otherwise return the company's plain name.
- Freight carriers / dispatchers (e.g. Contrans / "Contrans Tank Group", emails at contrans.ca, Denali, "CTT Burford Dispatch", a "Dispatcher" signature) are the CARRIER, never the customer. Put the carrier company in the carrier field.
- A freight carrier / dispatcher email that merely references or confirms an EXISTING PO (a pickup or dispatch confirmation, "BOL/PO #…", trailer or load details) is NOT a new order. Classify it 'amendment' (or 'other' if there is no actionable change), set amendsPoNumber to the referenced PO number, and ALWAYS fill carrier + carrierDomain — the app uses these to attach the carrier to that PO automatically.
- Also set customerDomain to the customer's email domain (e.g. ca.nestle.com) and carrierDomain to the carrier's email domain (e.g. contrans.ca), taken from the participant addresses. These let the app remember "this domain = this customer/carrier" for next time.
- In a thread, a LATER message that changes an already-stated order (e.g. "PO 4581816652 for 0600 on June 30", "move to 1400", "please cancel PO ...") is an amendment/cancellation of that PO — return it as a separate documents[] entry with documentType amendment/cancellation and amendsPoNumber set.

Extraction rules:
- Ship-to: shipToName / shipToAddress must be the DELIVERY / ship-to location where the goods are physically received (often labelled "Ship To", "Deliver To", "Delivery Address"). Do NOT use the bill-to, sold-to, invoice/remit-to, or company head-office address for ship-to — those are frequently different from the delivery site. Capture the ship-to city/province/postal as printed.
- Vendor item code: each line's itemNumber is the BUYER's code for our product (a "Vendor Item #", "Material #", "Customer Part #", e.g. LC325X). Always capture it when present — it is the most reliable key for matching our catalog product.
- Quantities: report quantity as the raw number and unit EXACTLY as printed (lb, lbs, kg, MT, cwt, short ton, ...). Provide quantityMt when you can, but the app recomputes MT in code, so a faithful quantity + unit matters most.
- Pricing: report unitPrice as the RAW unit price exactly as printed, and priceBasis as the unit it is per (e.g. "per lb", "per 100 lb", "per cwt", "per kg", "per MT"). DO NOT pre-convert the price. The app converts unitPrice → $/MT in code (lb → kg → MT), so faithful unitPrice + priceBasis matter more than pricePerMt; still fill pricePerMt when obvious. When the PO gives NO clear per-unit price but DOES state a total/extended price for the line or order, leave unitPrice empty and instead capture that total in the line's amount (and the order total in totalAmount) — the app derives $/MT by dividing the total by the quantity. Never fabricate a per-unit price from a total yourself.
- Dates must be ISO YYYY-MM-DD.
- Pick-up / appointment time: search the WHOLE email (subject, body, every quoted/forwarded message) AND the attachments for the requested pick-up, load or appointment time, and return it in pickupTime as 24h HH:MM (e.g. "LOAD 0300" -> "03:00", "pickup 2pm" -> "14:00", "appt 0600" -> "06:00"). The shipment/pick-up DATE is the requested ship/pick-up date — return it in shipmentDate; the appointment date equals the pick-up date.
- Normalize customer / product / contract names to the provided known lists ONLY when there is an obvious match; otherwise return the document's text verbatim.
- Contract number: Sucro contract numbers follow the format S######.### (the letter S, six digits, a period, then three digits — e.g. S123456.001). If any value matching that pattern appears ANYWHERE on the PO (header, notes, line items, references), return it as contractNumber.
- Omit (leave empty) any field you cannot find. Never invent values. Set confidence to reflect how clean the document was.`;

function mediaTypeFor(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'application/pdf';
  if (m.includes('png')) return 'image/png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'image/jpeg';
  if (m.includes('gif')) return 'image/gif';
  if (m.includes('webp')) return 'image/webp';
  return m;
}

async function xlsxToText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet(sheet => {
    out.push(`# Sheet: ${sheet.name}`);
    sheet.eachRow(row => {
      const vals = (row.values as unknown[]).slice(1).map(v => {
        if (v == null) return '';
        if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text);
        if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result);
        return String(v);
      });
      out.push(vals.join('\t'));
    });
  });
  return out.join('\n');
}

/** Build the Gemini content parts for one uploaded file. */
async function partsForFile(file: UploadFile): Promise<any[]> {
  const mime = mediaTypeFor(file.mimeType);
  const label = { text: `--- Document: ${file.name} ---` };
  if (mime === 'application/pdf' || mime.startsWith('image/')) {
    return [label, { inlineData: { mimeType: mime, data: file.dataBase64 } }];
  }
  const buf = Buffer.from(file.dataBase64, 'base64');
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) {
    const text = await xlsxToText(buf);
    return [label, { text: `Spreadsheet contents (tab-separated):\n${text}` }];
  }
  return [label, { text: `File contents:\n${buf.toString('utf8')}` }];
}

function hintsText(hints?: ExtractHints): string {
  if (!hints) return '';
  const parts: string[] = [];
  if (hints.customers?.length) parts.push(`Known customers (normalize to these when matched):\n${hints.customers.slice(0, 400).join(', ')}`);
  if (hints.products?.length) parts.push(`Known products:\n${hints.products.slice(0, 400).join(', ')}`);
  if (hints.contracts?.length) parts.push(`Known contract numbers:\n${hints.contracts.slice(0, 400).join(', ')}`);
  if (hints.carriers?.length) parts.push(`Known freight carriers (normalize the carrier to these when matched):\n${hints.carriers.slice(0, 200).join(', ')}`);
  if (hints.learned?.length) {
    const lines = hints.learned.slice(0, 200).map(l => `- ${l.field}: when the document says "${l.from}", use "${l.to}"`).join('\n');
    parts.push(`Learned corrections from past reviews (apply when the source text matches):\n${lines}`);
  }
  return parts.join('\n\n');
}

/** Returns true when an attachment is a file type we can extract from. */
export function isSupportedAttachment(filename: string, mimeType: string): boolean {
  const n = (filename || '').toLowerCase();
  const m = (mimeType || '').toLowerCase();
  return (
    n.endsWith('.pdf') || m.includes('pdf') ||
    n.endsWith('.xlsx') || n.endsWith('.xls') || m.includes('spreadsheet') || m.includes('excel') ||
    n.endsWith('.csv') || m.includes('csv') ||
    n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || m.startsWith('image/')
  );
}

/* --- Deterministic unit math --------------------------------------------- *
 * LLMs are unreliable at multi-digit arithmetic, so we never trust the model
 * to convert prices/quantities. The model returns the RAW unitPrice and the
 * printed unit/basis; the helpers below convert to $/MT and MT in code:
 *   price "$P per <unit>"  ->  $/MT = P / (MT per unit)
 *   quantity "Q <unit>"    ->  MT   = Q * (MT per unit)
 * Every factor below is "metric tonnes per 1 of that unit" (lb -> kg -> MT). */
const LB_TO_MT = 0.45359237 / 1000; // 1 lb = 0.45359237 kg = 0.00045359237 MT
const BASE_MT_PER_UNIT: Record<string, number> = {
  lb: LB_TO_MT, pound: LB_TO_MT,
  cwt: LB_TO_MT * 100,            // US hundredweight = 100 lb
  kg: 0.001, kilogram: 0.001,
  g: 0.000001, gram: 0.000001,
  mt: 1, tonne: 1,               // metric tonne
  ton: 0.90718474, shortton: 0.90718474, // US short ton = 2000 lb
};

/** Metric tonnes represented by a unit/basis string ("lb", "per 100 lb",
 *  "cwt", "$/kg", "per MT", "short ton"). Returns null when unrecognized so
 *  the caller can fall back to the model's value. */
function mtPerBasis(text: string | undefined): number | null {
  if (!text) return null;
  const s = String(text).toLowerCase()
    .replace(/metric\s*tonn?es?|metric\s*tons?/g, ' mt ')
    .replace(/short\s*tons?/g, ' shortton ')
    .replace(/[(),$]/g, ' ');
  // Optional leading count then a whole-word unit, e.g. "per 100 lb" = 100 x lb.
  // The leading (^|[\s/]) boundary stops "bag" from matching the "g" in gram.
  const m = s.match(/(?:^|[\s/])(?:(\d+(?:\.\d+)?)\s*)?(cwt|kilograms?|pounds?|tonnes?|grams?|shortton|lbs?|kgs?|tons?|mt|g)\b/);
  if (!m) return null;
  const count = m[1] ? parseFloat(m[1]) : 1;
  const unit = m[2].replace(/s$/, ''); // lbs->lb, kgs->kg, tons->ton, grams->gram
  const base = BASE_MT_PER_UNIT[unit];
  if (base == null || !(count > 0)) return null;
  return count * base;
}

/** Recompute quantityMt and pricePerMt for one line item from its raw fields,
 *  overriding the model's arithmetic whenever the unit/basis is recognized.
 *
 *  Pricing priority:
 *   1. A CLEAR per-unit price (unitPrice + a recognized $/MT, $/kg, $/lb, ... basis)
 *      is converted to $/MT and used as-is.
 *   2. Otherwise, if the line carries an extended/total amount, derive
 *      $/MT = line amount ÷ line quantity (in MT). */
function deriveLineMetrics(li: any): void {
  if (!li || typeof li !== 'object') return;
  const qtyMt = typeof li.quantity === 'number' ? li.quantity * (mtPerBasis(li.unit) ?? NaN) : NaN;
  if (Number.isFinite(qtyMt) && qtyMt > 0) li.quantityMt = Math.round(qtyMt * 1000) / 1000;
  // 1. Clear per-unit price.
  const basisMt = mtPerBasis(li.priceBasis) ?? mtPerBasis(li.unit);
  if (typeof li.unitPrice === 'number' && li.unitPrice > 0 && basisMt != null && basisMt > 0) {
    const perMt = li.unitPrice / basisMt;
    if (Number.isFinite(perMt) && perMt > 0) li.pricePerMt = Math.round(perMt * 100) / 100;
  }
  // 2. No clear per-unit price — derive it from the line total ÷ line quantity(MT).
  if (!(typeof li.pricePerMt === 'number' && li.pricePerMt > 0)) {
    const lineQtyMt = typeof li.quantityMt === 'number' && li.quantityMt > 0 ? li.quantityMt : NaN;
    if (typeof li.amount === 'number' && li.amount > 0 && Number.isFinite(lineQtyMt)) {
      const perMt = li.amount / lineQtyMt;
      if (Number.isFinite(perMt) && perMt > 0) li.pricePerMt = Math.round(perMt * 100) / 100;
    }
  }
}

/** Recompute every line's metrics, then apply a document-level total-price
 *  fallback: when a line still has no derivable per-unit price but the PO states
 *  a single total order price (totalAmount) and exactly one line is unpriced,
 *  derive that line's $/MT = total order price ÷ order quantity (in MT). */
function deriveDocMetrics(doc: any): void {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.lineItems)) return;
  const lines = doc.lineItems;
  lines.forEach(deriveLineMetrics);
  const hasPerMt = (li: any) => typeof li?.pricePerMt === 'number' && li.pricePerMt > 0;
  const unpriced = lines.filter((li: any) => !hasPerMt(li) && typeof li?.quantityMt === 'number' && li.quantityMt > 0);
  const total = typeof doc.totalAmount === 'number' && doc.totalAmount > 0 ? doc.totalAmount : NaN;
  // Only safe to attribute a single header total to a single unpriced line.
  if (unpriced.length === 1 && Number.isFinite(total)) {
    const li = unpriced[0];
    // Subtract any sibling lines that already carry their own extended amount, so
    // the header total isn't double-counted across a mixed PO.
    const pricedAmt = lines.reduce((s: number, x: any) => s + (x !== li && typeof x?.amount === 'number' && x.amount > 0 ? x.amount : 0), 0);
    const portion = total - pricedAmt > 0 ? total - pricedAmt : total;
    const perMt = portion / li.quantityMt;
    if (Number.isFinite(perMt) && perMt > 0) {
      li.pricePerMt = Math.round(perMt * 100) / 100;
      if (!(typeof li.amount === 'number' && li.amount > 0)) li.amount = Math.round(portion * 100) / 100;
    }
  }
}

/** Extract ALL purchase orders found in one uploaded file via Gemini. A single
 *  file can hold several POs (e.g. one per page of a multi-page PDF), so this
 *  returns an ARRAY — one parsed object per PO, each tagged with sourceFile.
 *  Returns [] when no order content is present (e.g. unrelated mail). */
export async function extractPO(
  file: UploadFile,
  hints: ExtractHints | undefined,
  opts: { apiKey: string; model?: string },
): Promise<any[]> {
  const parts = await partsForFile(file);
  const ht = hintsText(hints);
  if (ht) parts.push({ text: `\nReference data:\n${ht}` });
  parts.push({ text: 'Extract this purchase order into the required JSON schema.' });

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const response = await generateWithRetry(ai, {
    model: opts.model || DEFAULT_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: PO_BATCH_SCHEMA,
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text || !text.trim()) {
    const blocked = response.promptFeedback?.blockReason;
    throw new Error(blocked ? `Gemini blocked the request (${blocked}).` : 'Gemini returned no structured PO data.');
  }
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini did not return valid JSON: ${text.slice(0, 300)}`);
  }
  // Tolerate either the batch shape ({ documents: [...] }) or a bare object
  // (older single-PO shape) so a schema hiccup never drops the extraction.
  const docs: any[] = Array.isArray(parsed?.documents)
    ? parsed.documents
    : (parsed && typeof parsed === 'object' ? [parsed] : []);
  return docs
    .filter(d => d && typeof d === 'object')
    .map(d => {
      const doc = { sourceFile: file.name, ...d };
      // Recompute MT quantities and $/MT prices in code (never trust the LLM's
      // arithmetic) so e.g. $0.31034/lb becomes $684.18/MT reliably, and derive
      // $/MT from a total order price ÷ quantity when no per-unit price is given.
      deriveDocMetrics(doc);
      return doc;
    });
}
