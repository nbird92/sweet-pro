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

export interface UploadFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export interface ExtractHints {
  customers?: string[];
  products?: string[];
  contracts?: string[];
  learned?: Array<{ field: string; from: string; to: string }>;
}

// Gemini structured-output schema (Type-based). Mirrors the fields the app maps.
const PO_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    poNumber: { type: Type.STRING, description: 'The purchase order number exactly as printed.' },
    customerName: { type: Type.STRING, description: 'The BUYER that issued the PO (never Sucro Can).' },
    customerNumber: { type: Type.STRING, description: 'Customer/account number if present.' },
    shipToName: { type: Type.STRING },
    shipToAddress: { type: Type.STRING },
    orderDate: { type: Type.STRING, description: 'ISO YYYY-MM-DD' },
    shipmentDate: { type: Type.STRING, description: 'Requested ship/pickup date, ISO YYYY-MM-DD' },
    deliveryDate: { type: Type.STRING, description: 'Requested delivery/receipt date, ISO YYYY-MM-DD' },
    currency: { type: Type.STRING, description: 'ISO currency code, e.g. CAD or USD.' },
    paymentTerms: { type: Type.STRING },
    shippingTerms: { type: Type.STRING, description: 'Incoterms / FOB / EXW / DAP / DDP / FCA, etc.' },
    carrier: { type: Type.STRING, description: 'Carrier or ship method (e.g. "Pick Up", "Prepaid").' },
    contractNumber: { type: Type.STRING, description: 'Contract / agreement number if referenced.' },
    totalAmount: { type: Type.NUMBER },
    notes: { type: Type.STRING, description: 'Any special instructions worth surfacing.' },
    confidence: { type: Type.NUMBER, description: 'Overall extraction confidence 0..1.' },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          description: { type: Type.STRING, description: 'Product description as written on the PO.' },
          itemNumber: { type: Type.STRING },
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
  required: ['poNumber', 'customerName', 'lineItems'],
};

export const SYSTEM_PROMPT = `You extract structured data from a customer Purchase Order (PO) received by Sucro Can, a sugar manufacturer and supplier.

CRITICAL — who is the customer:
- Sucro Can (including "Sucro Can Canada Inc", "Sucro Can Sourcing LLC", or any "Sucro" entity at 550 Sherman Ave N / North, Hamilton ON) is ALWAYS the vendor/supplier on these POs — NEVER the customer.
- The CUSTOMER is the company that ISSUED the purchase order (the buyer): the letterhead / bill-from / issuing company. Return that company as customerName.

Extraction rules:
- Quantities: also provide quantityMt (metric tonnes). 1 kg = 0.001 MT; 1 lb = 0.00045359237 MT; 1 short ton = 0.90718474 MT; 1 cwt (US, 100 lb) = 0.045359237 MT.
- Pricing: provide pricePerMt whenever derivable. Bases vary: "per 100 lb", "per cwt", "per kg", "per lb", "per MT". unitPrice is the raw number; priceBasis is its unit. Convert to $/MT in pricePerMt.
- Dates must be ISO YYYY-MM-DD.
- Normalize customer / product / contract names to the provided known lists ONLY when there is an obvious match; otherwise return the document's text verbatim.
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

/** Extract one PO document via Gemini. Returns the parsed object (with sourceFile). */
export async function extractPO(
  file: UploadFile,
  hints: ExtractHints | undefined,
  opts: { apiKey: string; model?: string },
): Promise<any> {
  const parts = await partsForFile(file);
  const ht = hintsText(hints);
  if (ht) parts.push({ text: `\nReference data:\n${ht}` });
  parts.push({ text: 'Extract this purchase order into the required JSON schema.' });

  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const response = await ai.models.generateContent({
    model: opts.model || DEFAULT_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: PO_SCHEMA,
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
  return { sourceFile: file.name, ...parsed };
}
