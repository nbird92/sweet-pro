import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';

/**
 * PO extraction endpoint.
 *
 * Accepts one or more uploaded customer Purchase Order documents (PDF, Excel,
 * CSV, image) and uses Anthropic Claude to extract structured order fields so
 * the Orders page can pre-fill a new order. The same endpoint backs the manual
 * "Scan PO" modal and the automated Gmail inbox scan.
 *
 * Request (POST JSON):
 *   {
 *     files: [{ name, mimeType, dataBase64 }],
 *     hints?: { customers?: string[], products?: string[], contracts?: string[],
 *               learned?: [{ field, from, to }] }
 *   }
 * Response: { extractions: ExtractedPO[] }
 *
 * Env:
 *   ANTHROPIC_API_KEY      (required)
 *   PO_EXTRACT_MODEL       (optional, default claude-sonnet-4-6)
 *   EXTRACT_SHARED_SECRET  (optional — when set, require Authorization: Bearer)
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

interface UploadFile {
  name: string;
  mimeType: string;
  dataBase64: string;
}

const PO_TOOL = {
  name: 'record_purchase_order',
  description: 'Record the structured fields extracted from a customer purchase order.',
  input_schema: {
    type: 'object',
    properties: {
      poNumber: { type: 'string', description: 'The purchase order number exactly as printed.' },
      customerName: { type: 'string', description: 'The BUYER that issued the PO (never Sucro Can).' },
      customerNumber: { type: 'string', description: 'Customer/account number if present.' },
      shipToName: { type: 'string' },
      shipToAddress: { type: 'string' },
      orderDate: { type: 'string', description: 'ISO YYYY-MM-DD' },
      shipmentDate: { type: 'string', description: 'Requested ship/pickup date, ISO YYYY-MM-DD' },
      deliveryDate: { type: 'string', description: 'Requested delivery/receipt date, ISO YYYY-MM-DD' },
      currency: { type: 'string', description: 'ISO currency code, e.g. CAD or USD.' },
      paymentTerms: { type: 'string' },
      shippingTerms: { type: 'string', description: 'Incoterms / FOB / EXW / DAP / DDP / FCA, etc.' },
      carrier: { type: 'string', description: 'Carrier or ship method (e.g. "Pick Up", "Prepaid").' },
      contractNumber: { type: 'string', description: 'Contract / agreement number if referenced.' },
      totalAmount: { type: 'number' },
      notes: { type: 'string', description: 'Any special instructions worth surfacing.' },
      confidence: { type: 'number', description: 'Overall extraction confidence 0..1.' },
      lineItems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Product description as written on the PO.' },
            itemNumber: { type: 'string' },
            quantity: { type: 'number', description: 'Quantity in the document unit.' },
            unit: { type: 'string', description: 'Unit of measure (kg, lb, MT, each, ...).' },
            quantityMt: { type: 'number', description: 'Quantity converted to metric tonnes.' },
            unitPrice: { type: 'number', description: 'Raw unit price number.' },
            priceBasis: { type: 'string', description: 'What the unit price is per (e.g. "per 100 lb").' },
            pricePerMt: { type: 'number', description: 'Price normalized to $/MT when derivable.' },
            amount: { type: 'number', description: 'Line extended/total price.' },
            deliveryDate: { type: 'string', description: 'Per-line delivery date, ISO YYYY-MM-DD' },
          },
          required: ['description', 'quantity'],
        },
      },
    },
    required: ['poNumber', 'customerName', 'lineItems'],
  },
} as const;

const SYSTEM_PROMPT = `You extract structured data from a customer Purchase Order (PO) received by Sucro Can, a sugar manufacturer and supplier.

CRITICAL — who is the customer:
- Sucro Can (including "Sucro Can Canada Inc", "Sucro Can Sourcing LLC", or any "Sucro" entity at 550 Sherman Ave N / North, Hamilton ON) is ALWAYS the vendor/supplier on these POs — NEVER the customer.
- The CUSTOMER is the company that ISSUED the purchase order (the buyer): the letterhead / bill-from / "buy-from vendor is Sucro, so the issuer is the buyer" company. Return that company as customerName.

Extraction rules:
- Quantities: also provide quantityMt (metric tonnes). 1 kg = 0.001 MT; 1 lb = 0.00045359237 MT; 1 short ton = 0.90718474 MT; 1 cwt (US, 100 lb) = 0.045359237 MT.
- Pricing: provide pricePerMt whenever derivable. Bases vary: "per 100 lb", "per cwt", "per kg", "per lb", "per MT". unitPrice is the raw number; priceBasis is its unit. Convert to $/MT in pricePerMt.
- Dates must be ISO YYYY-MM-DD.
- Normalize customer / product / contract names to the provided known lists ONLY when there is an obvious match; otherwise return the document's text verbatim.
- Omit any field you cannot find. Never invent values. Set confidence to reflect how clean the document was.`;

function mediaTypeFor(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'application/pdf';
  if (m.includes('png')) return 'image/png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'image/jpeg';
  if (m.includes('gif')) return 'image/gif';
  if (m.includes('webp')) return 'image/webp';
  return m;
}

/** Convert an uploaded xlsx/xls buffer to a readable plain-text table dump. */
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

/** Build the Claude content blocks for one uploaded file. */
async function contentForFile(file: UploadFile): Promise<any[]> {
  const mime = mediaTypeFor(file.mimeType);
  const label = { type: 'text', text: `--- Document: ${file.name} ---` };

  if (mime === 'application/pdf') {
    return [label, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.dataBase64 } }];
  }
  if (mime.startsWith('image/')) {
    return [label, { type: 'image', source: { type: 'base64', media_type: mime, data: file.dataBase64 } }];
  }
  const buf = Buffer.from(file.dataBase64, 'base64');
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || mime.includes('spreadsheet') || mime.includes('excel')) {
    const text = await xlsxToText(buf);
    return [label, { type: 'text', text: `Spreadsheet contents (tab-separated):\n${text}` }];
  }
  // csv / txt / anything else decodable as text
  return [label, { type: 'text', text: `File contents:\n${buf.toString('utf8')}` }];
}

function hintsText(hints: any): string {
  if (!hints) return '';
  const parts: string[] = [];
  if (Array.isArray(hints.customers) && hints.customers.length) {
    parts.push(`Known customers (normalize to these when matched):\n${hints.customers.slice(0, 400).join(', ')}`);
  }
  if (Array.isArray(hints.products) && hints.products.length) {
    parts.push(`Known products:\n${hints.products.slice(0, 400).join(', ')}`);
  }
  if (Array.isArray(hints.contracts) && hints.contracts.length) {
    parts.push(`Known contract numbers:\n${hints.contracts.slice(0, 400).join(', ')}`);
  }
  if (Array.isArray(hints.learned) && hints.learned.length) {
    const lines = hints.learned
      .slice(0, 200)
      .map((l: any) => `- ${l.field}: when the document says "${l.from}", use "${l.to}"`)
      .join('\n');
    parts.push(`Learned corrections from past reviews (apply when the source text matches):\n${lines}`);
  }
  return parts.join('\n\n');
}

async function extractOne(file: UploadFile, hints: any, apiKey: string, model: string): Promise<any> {
  const content = await contentForFile(file);
  const ht = hintsText(hints);
  if (ht) content.push({ type: 'text', text: `\nReference data:\n${ht}` });
  content.push({ type: 'text', text: 'Extract this purchase order using the record_purchase_order tool.' });

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [PO_TOOL],
      tool_choice: { type: 'tool', name: PO_TOOL.name },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 500)}`);
  }
  const json = await res.json();
  const toolUse = (json.content || []).find((b: any) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured PO data.');
  return { sourceFile: file.name, ...toolUse.input };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional shared-secret gate (mirrors send-email).
  const sharedSecret = process.env.EXTRACT_SHARED_SECRET;
  if (sharedSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${sharedSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }
  const model = process.env.PO_EXTRACT_MODEL || DEFAULT_MODEL;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const files: UploadFile[] = Array.isArray(body?.files) ? body.files : [];
    const hints = body?.hints;
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }
    if (files.length > 10) {
      return res.status(400).json({ error: 'Too many files (max 10 per request).' });
    }

    const extractions: any[] = [];
    const errors: Array<{ file: string; message: string }> = [];
    for (const file of files) {
      try {
        extractions.push(await extractOne(file, hints, apiKey, model));
      } catch (e) {
        errors.push({ file: file.name, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return res.status(200).json({ extractions, errors });
  } catch (e) {
    console.error('PO extraction error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
