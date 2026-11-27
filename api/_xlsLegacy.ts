// Legacy Excel (.xls) → text, for the PO extractor.
//
// ExcelJS only reads .xlsx (an OOXML zip), so an Excel 97-2003 attachment failed
// with "Can't find end of central directory : is this a zip file ?". A .xls is a
// BIFF workbook stream inside an OLE compound file: `cfb` opens the container and
// the reader below walks the BIFF records for cell values — shared strings,
// numbers, RK / MULRK, formula results, booleans and errors — formatting dates
// (from each cell's number format) as YYYY-MM-DD. Excel 97-2003 (BIFF8) and
// Excel 5/95 (BIFF5) workbooks are read; password-protected ones are refused.
//
// Many systems also "export to Excel" by writing an HTML table, SpreadsheetML
// XML or CSV under a .xls name — spreadsheetBytesKind() tells them apart and
// markupTableToText() flattens the markup ones.

import CFB from 'cfb';

export type SpreadsheetKind = 'zip' | 'ole' | 'text' | 'binary';

/** What a spreadsheet attachment actually is, from its leading bytes (the
 *  filename/MIME type often lie: .xls exports are frequently HTML or CSV). */
export function spreadsheetBytesKind(buf: Uint8Array): SpreadsheetKind {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buf.length >= 8 && OLE.every((b, i) => buf[i] === b)) return 'ole';
  // UTF-16 text (BOM) or mostly printable bytes → text; else unknown binary.
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return 'text';
  const head = buf.subarray(0, Math.min(buf.length, 1024));
  let ctrl = 0;
  for (const b of head) if (b < 9 || (b > 13 && b < 32)) ctrl++;
  return ctrl > head.length * 0.02 ? 'binary' : 'text';
}

/** Decode text bytes (UTF-8, or UTF-16 with a BOM). */
export function decodeTextBytes(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
}

/** Flatten an HTML table / SpreadsheetML export to tab-separated rows; plain
 *  text (CSV / TSV) passes through unchanged. */
export function markupTableToText(text: string): string {
  if (!/<\s*(table|tr|td|th|row|cell|workbook|html)\b/i.test(text)) return text;
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|head)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/\s*(td|th|cell)\s*>/gi, '\t')
    .replace(/<\s*(\/\s*(tr|row|p|div|table|worksheet)|br\s*\/?)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .split('\n')
    .map(l => l.replace(/[  ]+/g, ' ').replace(/\t+$/, '').trim())
    .filter(l => l.replace(/\t/g, '').trim())
    .join('\n');
}

// ---------------------------------------------------------------------------
// BIFF reader

const R = {
  FORMULA: 0x0006, EOF: 0x000a, FILEPASS: 0x002f, CONTINUE: 0x003c, DATEMODE: 0x0022, CODEPAGE: 0x0042,
  BOUNDSHEET: 0x0085, MULRK: 0x00bd, RSTRING: 0x00d6, XF: 0x00e0, SST: 0x00fc, LABELSST: 0x00fd,
  NUMBER: 0x0203, LABEL: 0x0204, BOOLERR: 0x0205, STRING: 0x0207, RK: 0x027e, FORMAT: 0x041e,
  BOF2: 0x0009, BOF3: 0x0209, BOF4: 0x0409, BOF: 0x0809,
} as const;
const isBof = (t: number) => t === R.BOF || t === R.BOF2 || t === R.BOF3 || t === R.BOF4;

interface BiffRecord { type: number; offset: number; data: Uint8Array; cont: Uint8Array[] }

/** All records from `start`; CONTINUE records are attached to the record they
 *  extend (SST and long strings span several). */
function readRecords(stream: Uint8Array, start = 0): BiffRecord[] {
  const out: BiffRecord[] = [];
  let p = start;
  while (p + 4 <= stream.length) {
    const type = stream[p] | (stream[p + 1] << 8);
    const len = stream[p + 2] | (stream[p + 3] << 8);
    const data = stream.subarray(p + 4, Math.min(stream.length, p + 4 + len));
    if (type === R.CONTINUE && out.length) out[out.length - 1].cont.push(data);
    else out.push({ type, offset: p, data, cont: [] });
    p += 4 + len;
  }
  return out;
}

/** Sequential reader over a record + its CONTINUE segments. String character
 *  data that crosses into a CONTINUE restarts with a 1-byte high-byte flag. */
class SegReader {
  private seg = 0;
  private pos = 0;
  constructor(private segs: Uint8Array[], private biff8: boolean, private decode8: TextDecoder) {}
  private ensure(): boolean {
    while (this.seg < this.segs.length && this.pos >= this.segs[this.seg].length) { this.seg++; this.pos = 0; }
    return this.seg < this.segs.length;
  }
  get done(): boolean { return !this.ensure(); }
  u8(): number { if (!this.ensure()) throw new Error('BIFF record truncated'); return this.segs[this.seg][this.pos++]; }
  u16(): number { const a = this.u8(); return a | (this.u8() << 8); }
  u32(): number { const a = this.u16(); return (a | (this.u16() << 16)) >>> 0; }
  skip(n: number) { for (let i = 0; i < n; i++) this.u8(); }
  /** `cch` characters; BIFF8 strings carry a high-byte flag per segment. */
  chars(cch: number, highByte: boolean): string {
    if (!this.biff8) {
      const bytes = new Uint8Array(cch);
      for (let i = 0; i < cch; i++) bytes[i] = this.u8();
      return this.decode8.decode(bytes);
    }
    let s = '';
    let left = cch;
    while (left > 0) {
      const cur = this.segs[this.seg];
      if (!cur || this.pos >= cur.length) {
        // Character data continues in the next CONTINUE: it begins with the flag.
        this.seg++; this.pos = 0;
        const next = this.segs[this.seg];
        if (!next || !next.length) throw new Error('BIFF string truncated');
        highByte = (next[this.pos++] & 1) === 1;
        continue;
      }
      const before = left;
      if (highByte) {
        while (left > 0 && this.pos + 1 < cur.length) { s += String.fromCharCode(cur[this.pos] | (cur[this.pos + 1] << 8)); this.pos += 2; left--; }
      } else {
        while (left > 0 && this.pos < cur.length) { s += String.fromCharCode(cur[this.pos]); this.pos++; left--; }
      }
      if (left === before) throw new Error('BIFF string misaligned'); // never spin on a malformed file
    }
    return s;
  }
  /** XLUnicodeRichExtendedString (SST entries, LABEL, STRING in BIFF8);
   *  BIFF5: a u8/u16 length + 8-bit codepage text. */
  str(lenBytes: 1 | 2 = 2): string {
    const cch = lenBytes === 1 ? this.u8() : this.u16();
    if (!this.biff8) return this.chars(cch, false);
    const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const s = this.chars(cch, (flags & 1) === 1);
    if (runs) this.skip(runs * 4);
    if (ext) this.skip(ext);
    return s;
  }
}

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const f64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);
function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) v = (rk | 0) >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, rk & 0xfffffffc, true);
    v = dv.getFloat64(0, true);
  }
  return rk & 1 ? v / 100 : v;
}

// Built-in date/time number formats (ECMA-376 18.8.30 + the CJK date ids).
const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const BUILTIN_PCT = new Set([9, 10]);
type NumKind = 'date' | 'datetime' | 'time' | 'pct' | 'num';
function classifyFormat(id: number, code: string | undefined): NumKind {
  if (code === undefined) {
    if (BUILTIN_PCT.has(id)) return 'pct';
    if (!BUILTIN_DATE.has(id)) return 'num';
    if (id === 22) return 'datetime';
    if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return 'time';
    return 'date';
  }
  // Ignore quoted text, [..] sections (colour, locale, elapsed), escapes, padding.
  const bare = code.split(';')[0].replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\.|_.|\*./g, '');
  if (/%/.test(bare)) return 'pct';
  const date = /[dy]/i.test(bare) || /m{3,}/i.test(bare);
  const time = /[hs]/i.test(bare);
  if (date && time) return 'datetime';
  if (date || (/m/i.test(bare) && !time && !/[0#?]/.test(bare))) return 'date';
  if (time) return 'time';
  return 'num';
}
const pad = (n: number) => String(n).padStart(2, '0');
function formatNumber(v: number, kind: NumKind, date1904: boolean): string {
  if (!Number.isFinite(v)) return String(v);
  if (kind === 'pct') return `${+(v * 100).toPrecision(12)}%`;
  if (kind === 'date' || kind === 'datetime' || kind === 'time') {
    const serial = v + (date1904 ? 1462 : 0);
    const d = new Date(Math.round((serial - 25569) * 86400000));
    if (!Number.isNaN(d.getTime()) && serial > -1) {
      const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const tm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      if (kind === 'time') return serial < 1 ? tm : `${day} ${tm}`;
      if (kind === 'datetime') return `${day} ${tm}`;
      return day;
    }
  }
  return String(+v.toPrecision(15));
}
const BIFF_ERRORS: Record<number, string> = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0f: '#VALUE!', 0x17: '#REF!', 0x1d: '#NAME?', 0x24: '#NUM!', 0x2a: '#N/A' };

/** Text for one legacy .xls workbook: "# Sheet: name" then tab-separated rows
 *  (the same shape the .xlsx path produces). */
export function xlsToText(buf: Uint8Array): string {
  const container = CFB.read(buf, { type: 'buffer' });
  const entry = CFB.find(container, 'Workbook') || CFB.find(container, 'Book');
  if (!entry || !entry.content) throw new Error('This .xls has no Excel workbook stream (not an Excel 5.0–2003 file).');
  const stream = entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content as ArrayLike<number>);
  const globals = readRecords(stream);
  if (!globals.length || !isBof(globals[0].type)) throw new Error('This .xls workbook stream is not a BIFF workbook.');
  const version = u16(globals[0].data, 0);
  const biff8 = version === 0x0600;
  if (!biff8 && version !== 0x0500) throw new Error(`Unsupported Excel version in this .xls (BIFF 0x${version.toString(16)}) — re-save it as .xlsx.`);

  let codepage = 1252;
  let date1904 = false;
  let sst: string[] = [];
  const formats = new Map<number, string>();
  const xfFormat: number[] = [];
  const sheets: Array<{ name: string; pos: number }> = [];
  for (const rec of globals) {
    if (rec.type === R.EOF) break;
    const d = rec.data;
    if (rec.type === R.FILEPASS) throw new Error('This .xls is password-protected and can\'t be read — send an unprotected copy.');
    else if (rec.type === R.CODEPAGE) codepage = u16(d, 0);
    else if (rec.type === R.DATEMODE) date1904 = u16(d, 0) === 1;
    else if (rec.type === R.XF) xfFormat.push(u16(d, 2));
    else if (rec.type === R.FORMAT) {
      const r = new SegReader([d.subarray(2), ...rec.cont], biff8, decoderFor(codepage));
      try { formats.set(u16(d, 0), r.str(biff8 ? 2 : 1)); } catch { /* malformed format: ignore */ }
    } else if (rec.type === R.BOUNDSHEET) {
      // dt: 0 = worksheet (charts / macro / VB sheets have no cells to read).
      if (d[5] !== 0) continue;
      const r = new SegReader([d.subarray(6)], biff8, decoderFor(codepage));
      sheets.push({ pos: u32(d, 0), name: r.str(1) });
    } else if (rec.type === R.SST) {
      const r = new SegReader([d.subarray(8), ...rec.cont], true, decoderFor(codepage));
      const n = u32(d, 4);
      sst = [];
      try { for (let i = 0; i < n && !r.done; i++) sst.push(r.str(2)); } catch { /* keep what was read */ }
    }
  }
  const dec8 = decoderFor(codepage);
  const kindOfXf = (ixfe: number): NumKind => {
    const id = xfFormat[ixfe];
    return id === undefined ? 'num' : classifyFormat(id, formats.get(id));
  };

  const out: string[] = [];
  for (const sheet of sheets) {
    if (sheet.pos <= 0 || sheet.pos >= stream.length) continue;
    const rows = new Map<number, Map<number, string>>();
    const put = (rw: number, col: number, v: string) => {
      if (v === '') return;
      let row = rows.get(rw);
      if (!row) rows.set(rw, (row = new Map()));
      row.set(col, v);
    };
    let depth = 0;
    let pendingString: { rw: number; col: number } | null = null;
    for (const rec of readRecords(stream, sheet.pos)) {
      if (isBof(rec.type)) { depth++; continue; }
      if (rec.type === R.EOF) { if (--depth <= 0) break; continue; }
      if (depth !== 1) continue; // embedded chart substreams
      const d = rec.data;
      try {
        switch (rec.type) {
          case R.LABELSST: put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? ''); break;
          case R.LABEL: case R.RSTRING:
            put(u16(d, 0), u16(d, 2), new SegReader([d.subarray(6), ...rec.cont], biff8, dec8).str(2)); break;
          case R.NUMBER: put(u16(d, 0), u16(d, 2), formatNumber(f64(d, 6), kindOfXf(u16(d, 4)), date1904)); break;
          case R.RK: put(u16(d, 0), u16(d, 2), formatNumber(rkValue(u32(d, 6)), kindOfXf(u16(d, 4)), date1904)); break;
          case R.MULRK: {
            const rw = u16(d, 0);
            const first = u16(d, 2);
            const n = Math.floor((d.length - 6) / 6);
            for (let i = 0; i < n; i++) {
              const o = 4 + i * 6;
              put(rw, first + i, formatNumber(rkValue(u32(d, o + 2)), kindOfXf(u16(d, o)), date1904));
            }
            break;
          }
          case R.BOOLERR:
            put(u16(d, 0), u16(d, 2), d[7] ? (BIFF_ERRORS[d[6]] ?? '#ERR') : (d[6] ? 'TRUE' : 'FALSE')); break;
          case R.FORMULA: {
            const rw = u16(d, 0), col = u16(d, 2);
            if (u16(d, 12) === 0xffff) {
              const t = d[6];
              if (t === 0) pendingString = { rw, col };       // value follows in a STRING record
              else if (t === 1) put(rw, col, d[8] ? 'TRUE' : 'FALSE');
              else if (t === 2) put(rw, col, BIFF_ERRORS[d[8]] ?? '#ERR');
            } else {
              put(rw, col, formatNumber(f64(d, 6), kindOfXf(u16(d, 4)), date1904));
            }
            break;
          }
          case R.STRING:
            if (pendingString) put(pendingString.rw, pendingString.col, new SegReader([d, ...rec.cont], biff8, dec8).str(2));
            pendingString = null;
            break;
        }
      } catch { /* one malformed cell must not lose the sheet */ }
    }
    out.push(`# Sheet: ${sheet.name}`);
    for (const rw of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(rw)!;
      const max = Math.max(...row.keys());
      const vals: string[] = [];
      for (let c = 0; c <= max; c++) vals.push((row.get(c) ?? '').replace(/[\t\r\n]+/g, ' '));
      out.push(vals.join('\t'));
    }
  }
  return out.join('\n');
}

function decoderFor(codepage: number): TextDecoder {
  // BIFF5 8-bit text uses the workbook codepage (1200 = UTF-16 is BIFF8-only).
  const label = codepage === 1252 || codepage === 0x8001 || codepage === 0x8000 ? 'windows-1252'
    : codepage === 65001 ? 'utf-8'
    : codepage >= 874 && codepage <= 1258 ? `windows-${codepage}`
    : codepage === 10000 ? 'macintosh'
    : 'windows-1252';
  try { return new TextDecoder(label); } catch { return new TextDecoder('windows-1252'); }
}
