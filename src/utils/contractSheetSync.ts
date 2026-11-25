// Contract sheet sync (Contracts page → Sync Contracts, and Sync All).
//
// Reads the ITAS contract list from a Google Sheet through the same configurable
// importer as Orders / Invoices (preset = sheet + tab + column map) and turns
// each row into a Contract:
//   CUSTOMER (ITAS code, e.g. "CHAPMAN.P") → itasName + linked app customer
//   CONTRACT ("S04239.A00")                → contractNumber (the match key)
//   PRICE                                  → finalPrice
//   ORIGINAL / ADJUSTED QUANTITY           → contractVolume (adjusted wins)
//   CURRENCY / SHIPPING TERMS / PAYMENT TERMS
//   CHANGE 1..n (DATE / ADJUSTMENT / DESCRIPTION) → dated lines in the notes
//
// Existing contracts (same contract number) are UPDATED — price, volume,
// currency and shipping terms follow the sheet (ITAS is the system of record);
// payment terms and the customer link are only FILLED when blank. Contracts that
// aren't on the sheet are never touched. Every change is written to the
// contract's notes, like any other contract edit.

import type { Contract, Customer } from '../types';
import { fetchTabFromSheet, type ColumnMap, type SheetImportConfig, type ConfiguredTab } from './googleOrderSheetSync';
import { parseCSV } from './googleSheetsSync';
import { withChangeNote, prependNote, noteStamp } from './contractNotes';

export const CONTRACT_SHEET_ID = '1VRBPkAG0zn3eJdPbkhuck3o1d0k054_NjOzuU3Krsq4';

/** Column-mapping fields shown in the configurator for contracts. */
export const CONTRACT_FIELDS: Array<{ key: keyof ColumnMap; label: string; required?: boolean }> = [
  { key: 'contractNumber', label: 'Contract #', required: true },
  { key: 'customer', label: 'ITAS Customer', required: true },
  { key: 'pricePerMt', label: 'Price / MT' },
  { key: 'originalQty', label: 'Original Quantity (MT)' },
  { key: 'adjustedQty', label: 'Adjusted Quantity (MT)' },
  { key: 'currency', label: 'Currency' },
  { key: 'shippingTerms', label: 'Shipping Terms' },
  { key: 'paymentTerms', label: 'Payment Terms' },
];

/** Built-in preset for the Sucro contract list (row 1 = titles, row 2 = the
 *  CHANGE sub-titles, data from row 3). */
export const DEFAULT_CONTRACT_IMPORT_CONFIG: SheetImportConfig = {
  name: 'ITAS Contract List',
  sheetId: CONTRACT_SHEET_ID,
  tabs: [{
    tabName: 'Contract List',
    headerRow: 1,
    columns: {
      customer: 0, contractNumber: 1, pricePerMt: 2, originalQty: 3, adjustedQty: 4,
      currency: 5, shippingTerms: 6, paymentTerms: 7,
    },
  }],
};

const clean = (h: string) => (h || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Auto-detect the contract columns from one or more header rows. */
export function autoDetectContractColumns(...headerRows: string[][]): ColumnMap {
  const rows = headerRows.filter(r => Array.isArray(r) && r.length).map(r => r.map(clean));
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const find = (test: (h: string) => boolean): number | undefined => {
    for (let c = 0; c < width; c++) if (rows.some(r => r[c] !== undefined && r[c] !== '' && test(r[c]))) return c;
    return undefined;
  };
  return {
    customer: find(h => /^(itas )?customer( name)?$|^client$/.test(h)),
    contractNumber: find(h => /^contract( #| no\.?| number)?$/.test(h)),
    pricePerMt: find(h => /^price( ?\/ ?mt| per mt)?$|^unit price$/.test(h)),
    originalQty: find(h => /^original( quantity| qty| volume)?$/.test(h)),
    adjustedQty: find(h => /^adjusted( quantity| qty| volume)?$|^(contract )?(quantity|volume)$/.test(h)),
    currency: find(h => /^currency$|^curr\.?$/.test(h)),
    shippingTerms: find(h => /^shipping terms?$|^incoterms?$/.test(h)),
    paymentTerms: find(h => /^payment terms?$|^terms$/.test(h)),
  };
}

export interface ParsedContractRow {
  tab: string;
  rowIdx: number;
  contractNumber: string;
  itasCustomer: string;
  price?: number;
  originalQty?: number;
  adjustedQty?: number;
  currency?: string;
  shippingTerms?: string;
  paymentTerms?: string;
  changes: Array<{ n: number; date: string; adjustment?: number; description: string }>;
}

const num = (s: string | undefined): number | undefined => {
  const t = (s || '').replace(/[$,\s]/g, '');
  if (!t) return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : undefined;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');
/** "November 13, 2025" / "Nov 10, 2025" / 2025-11-10 / 11/10/2025 / a sheet
 *  serial number (45944) → ISO date; anything else → the text as-is. */
export function contractSheetDate(raw: string | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`;
  }
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${pad(+us[1])}-${pad(+us[2])}`;
  return s;
}

/** Find the CHANGE n blocks: a "CHANGE n" title (any header row) over
 *  DATE / ADJUSTMENT / DESCRIPTION sub-titles (the row below it). */
function detectChangeBlocks(headerRows: string[][]): Array<{ n: number; date?: number; adj?: number; desc?: number }> {
  const rows = headerRows.map(r => (r || []).map(clean));
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const blocks: Array<{ n: number; date?: number; adj?: number; desc?: number }> = [];
  let current: { n: number; date?: number; adj?: number; desc?: number } | null = null;
  for (let c = 0; c < width; c++) {
    const title = rows.map(r => r[c] || '').find(h => /^change\s*\d+$/.test(h));
    if (title) {
      current = { n: parseInt(title.replace(/\D/g, ''), 10) };
      blocks.push(current);
    }
    if (!current) continue;
    const sub = rows.map(r => r[c] || '').find(h => /^(date|adjustment|description)$/.test(h));
    if (sub === 'date' && current.date === undefined) current.date = c;
    else if (sub === 'adjustment' && current.adj === undefined) current.adj = c;
    else if (sub === 'description' && current.desc === undefined) current.desc = c;
    else if (!sub && current.desc === undefined && current.adj !== undefined && c === current.adj + 1) current.desc = c; // untitled description column
  }
  return blocks.filter(b => b.date !== undefined || b.adj !== undefined);
}

export function parseContractRows(rows: string[][], tab: ConfiguredTab): ParsedContractRow[] {
  const headerIdx = Math.max(0, Math.floor(tab.headerRow || 1) - 1);
  const cm = tab.columns;
  const cell = (row: string[], idx: number | undefined) => (idx === undefined || idx < 0 ? '' : String(row[idx] ?? '').trim());
  // The titles row plus the row under it (the CHANGE sub-titles live there).
  const blocks = detectChangeBlocks(rows.slice(0, headerIdx + 2));
  const out: ParsedContractRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const contractNumber = cell(row, cm.contractNumber).toUpperCase();
    // Sub-title rows, blank rows and totals carry no contract number.
    if (!contractNumber || /^(date|contract|total)/i.test(contractNumber)) continue;
    const changes: ParsedContractRow['changes'] = [];
    for (const b of blocks) {
      const date = contractSheetDate(cell(row, b.date));
      const adjustment = num(cell(row, b.adj));
      const description = cell(row, b.desc);
      if (date || adjustment !== undefined) changes.push({ n: b.n, date, adjustment, description });
    }
    out.push({
      tab: tab.tabName,
      rowIdx: i + 1,
      contractNumber,
      itasCustomer: cell(row, cm.customer),
      price: num(cell(row, cm.pricePerMt)),
      originalQty: num(cell(row, cm.originalQty)),
      adjustedQty: num(cell(row, cm.adjustedQty)),
      currency: cell(row, cm.currency),
      shippingTerms: cell(row, cm.shippingTerms),
      paymentTerms: cell(row, cm.paymentTerms),
      changes,
    });
  }
  return out;
}

export interface ContractSyncResult {
  newContracts: Contract[];
  /** Full merged records of existing contracts the sheet changed. */
  updatedContracts: Contract[];
  /** What changed on each updated contract (for the preview). */
  updateSummaries: Array<{ contractNumber: string; customer: string; changes: string[] }>;
  /** ITAS customer codes no app customer could be matched to. */
  unmatchedCustomers: Array<{ itas: string; contracts: string[] }>;
  unchanged: number;
  skipped: Array<{ tab: string; contractNumber: string; reason: string }>;
  errors: Array<{ tab: string; rowIdx: number; message: string }>;
}

const normCurrency = (raw?: string): string => {
  const s = (raw || '').toUpperCase();
  if (s.includes('USD')) return 'USD';
  if (s.includes('CAD')) return 'CAD';
  return '';
};

const changeLine = (cn: string, c: ParsedContractRow['changes'][number]) => {
  const adj = c.adjustment !== undefined ? `${c.adjustment >= 0 ? '+' : ''}${c.adjustment.toLocaleString(undefined, { maximumFractionDigits: 3 })} MT` : '';
  return `ITAS change ${c.n} on ${cn}${c.date ? ` (${c.date})` : ''}: ${[adj, c.description].filter(Boolean).join(' — ') || 'recorded'}`;
};

export function parsedRowsToContracts(
  parsed: ParsedContractRow[],
  ctx: { existingContracts: Contract[]; customers: Customer[]; who?: string; customerNameById?: (id: string) => string },
): ContractSyncResult {
  const result: ContractSyncResult = { newContracts: [], updatedContracts: [], updateSummaries: [], unmatchedCustomers: [], unchanged: 0, skipped: [], errors: [] };
  const key = (s?: string) => (s || '').trim().toUpperCase();
  const norm = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  // One row per contract number — a repeated row keeps the LAST occurrence.
  const byNumber = new Map<string, ParsedContractRow>();
  for (const r of parsed) {
    if (byNumber.has(r.contractNumber)) result.skipped.push({ tab: r.tab, contractNumber: r.contractNumber, reason: `listed again on row ${r.rowIdx} — the later row is used` });
    byNumber.set(r.contractNumber, r);
  }

  // ITAS code → customer. Learned links (an existing contract already tied to a
  // customer under this ITAS code) first, then the customer's ITAS name, then
  // the code without its ".P" suffix as the customer name, then a UNIQUE
  // name-prefix match. Ambiguous codes stay unmatched rather than guessed.
  const learned = new Map<string, Customer>();
  for (const c of ctx.existingContracts) {
    if (!c.itasName || !c.customerName) continue;
    const cust = ctx.customers.find(x => x.name === c.customerName || x.id === c.customerNumber || (x.customerNumber && x.customerNumber === c.customerNumber));
    if (cust && !learned.has(norm(c.itasName))) learned.set(norm(c.itasName), cust);
  }
  const customerFor = (itas: string): Customer | null => {
    const n = norm(itas);
    if (!n) return null;
    const hit = ctx.customers.find(c => norm(c.itasCustomerName) === n) || learned.get(n);
    if (hit) return hit;
    const base = norm(itas.replace(/\.[A-Za-z]{1,4}$/, ''));
    if (!base) return null;
    const byName = ctx.customers.find(c => norm(c.name) === base || norm(c.itasCustomerName) === base);
    if (byName) return byName;
    if (base.length >= 4) {
      const pre = ctx.customers.filter(c => { const cn = norm(c.name); return cn.length >= 4 && (cn.startsWith(base) || base.startsWith(cn)); });
      if (pre.length === 1) return pre[0];
    }
    return null;
  };

  const existingByNumber = new Map(ctx.existingContracts.map(c => [key(c.contractNumber), c] as const));
  const unmatched = new Map<string, string[]>();

  for (const r of byNumber.values()) {
    try {
      const cust = customerFor(r.itasCustomer);
      if (!cust && r.itasCustomer) unmatched.set(r.itasCustomer, [...(unmatched.get(r.itasCustomer) || []), r.contractNumber]);
      const volume = r.adjustedQty ?? r.originalQty;
      const currency = normCurrency(r.currency);
      const changeLines = r.changes.map(c => changeLine(r.contractNumber, c));
      const existing = existingByNumber.get(r.contractNumber);

      if (existing) {
        const after: Contract = { ...existing };
        if (r.price !== undefined && r.price > 0 && Math.abs((existing.finalPrice || 0) - r.price) > 0.0001) after.finalPrice = r.price;
        if (volume !== undefined && volume > 0 && Math.abs((existing.contractVolume || 0) - volume) > 0.0001) {
          after.contractVolume = volume;
          after.volumeOutstanding = Math.round((volume - (existing.volumeTaken || 0)) * 1000) / 1000;
        }
        if (currency && currency !== (existing.currency || '').toUpperCase()) after.currency = currency;
        if (r.shippingTerms && r.shippingTerms !== (existing.shippingTerms || '')) after.shippingTerms = r.shippingTerms;
        if (r.paymentTerms && !(existing.paymentTerms || '').trim()) after.paymentTerms = r.paymentTerms;
        if (r.itasCustomer && !(existing.itasName || '').trim()) after.itasName = r.itasCustomer;
        if (cust && !(existing.customerName || '').trim()) {
          after.customerName = cust.name;
          if (!(existing.customerNumber || '').trim()) after.customerNumber = cust.customerNumber || cust.id;
        }
        const newLines = changeLines.filter(l => !(existing.notes || '').includes(l));
        let merged = withChangeNote(existing, after, 'CONTRACT SHEET SYNC', ctx.who, ctx.customerNameById);
        if (newLines.length) merged = { ...merged, notes: prependNote(merged.notes, `${noteStamp(ctx.who)} ${newLines.join('. ')}.`) };
        if (merged === existing || JSON.stringify(merged) === JSON.stringify(existing)) { result.unchanged++; continue; }
        const fieldChanges: string[] = [];
        if (after.finalPrice !== existing.finalPrice) fieldChanges.push(`Price ${existing.finalPrice ?? '—'} → ${after.finalPrice}`);
        if (after.contractVolume !== existing.contractVolume) fieldChanges.push(`Volume ${existing.contractVolume ?? '—'} → ${after.contractVolume} MT`);
        if (after.currency !== existing.currency) fieldChanges.push(`Currency ${existing.currency || '—'} → ${after.currency}`);
        if (after.shippingTerms !== existing.shippingTerms) fieldChanges.push(`Shipping terms ${existing.shippingTerms || '—'} → ${after.shippingTerms}`);
        if (after.paymentTerms !== existing.paymentTerms) fieldChanges.push(`Payment terms → ${after.paymentTerms}`);
        if (after.itasName !== existing.itasName) fieldChanges.push(`ITAS name → ${after.itasName}`);
        if (after.customerName !== existing.customerName) fieldChanges.push(`Customer → ${after.customerName}`);
        if (newLines.length) fieldChanges.push(`${newLines.length} ITAS change${newLines.length === 1 ? '' : 's'} added to notes`);
        result.updatedContracts.push(merged);
        result.updateSummaries.push({ contractNumber: r.contractNumber, customer: merged.customerName || r.itasCustomer, changes: fieldChanges });
        continue;
      }

      if (volume === undefined && r.price === undefined) {
        result.skipped.push({ tab: r.tab, contractNumber: r.contractNumber, reason: 'no price or quantity on the sheet' });
        continue;
      }
      const vol = volume ?? 0;
      const created = [
        `${noteStamp(ctx.who)} CREATED by contract sheet sync (ITAS ${r.itasCustomer || 'customer ?'}).`,
        r.originalQty !== undefined ? `Original quantity ${r.originalQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} MT${r.adjustedQty !== undefined && r.adjustedQty !== r.originalQty ? `, adjusted ${r.adjustedQty.toLocaleString(undefined, { maximumFractionDigits: 3 })} MT` : ''}.` : '',
        changeLines.length ? `${changeLines.join('. ')}.` : '',
      ].filter(Boolean).join(' ');
      const contract: Contract = {
        id: `CON-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        contractNumber: r.contractNumber,
        customerNumber: cust ? (cust.customerNumber || cust.id) : '',
        customerName: cust ? cust.name : '',
        contractVolume: vol,
        volumeTaken: 0,
        volumeOutstanding: vol,
        startDate: '',
        endDate: '',
        skuName: '',
        origin: '',
        destination: '',
        finalPrice: r.price ?? 0,
        currency: currency || ((cust?.defaultCurrency || '').toUpperCase() === 'USD' ? 'USD' : 'CAD'),
        notes: created,
        active: true,
        ...(r.shippingTerms ? { shippingTerms: r.shippingTerms } : {}),
        ...(r.paymentTerms ? { paymentTerms: r.paymentTerms } : {}),
        ...(r.itasCustomer ? { itasName: r.itasCustomer } : {}),
      };
      result.newContracts.push(contract);
    } catch (e) {
      result.errors.push({ tab: r.tab, rowIdx: r.rowIdx, message: e instanceof Error ? e.message : String(e) });
    }
  }
  result.unmatchedCustomers = [...unmatched.entries()].map(([itas, contracts]) => ({ itas, contracts })).sort((a, b) => a.itas.localeCompare(b.itas));
  return result;
}

/** Fetch every configured tab and build the contract changes (preview only —
 *  nothing is saved here). */
export async function syncContractsFromConfig(
  config: SheetImportConfig,
  ctx: { existingContracts: Contract[]; customers: Customer[]; who?: string; customerNameById?: (id: string) => string },
): Promise<ContractSyncResult> {
  const parsed: ParsedContractRow[] = [];
  const fetchErrors: ContractSyncResult['errors'] = [];
  for (const tab of config.tabs) {
    try {
      const csv = await fetchTabFromSheet(config.sheetId, tab.tabName);
      parsed.push(...parseContractRows(parseCSV(csv), tab));
    } catch (err) {
      fetchErrors.push({ tab: tab.tabName, rowIdx: 0, message: err instanceof Error ? err.message : String(err) });
    }
  }
  const result = parsedRowsToContracts(parsed, ctx);
  result.errors.unshift(...fetchErrors);
  return result;
}
