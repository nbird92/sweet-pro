import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JWT } from 'google-auth-library';
import { checkAuth, checkGoogleConfig } from './_sheets.js';

// Return a document TEMPLATE's first tab as a compact grid — column widths, row
// heights, merges, and every non-empty cell's text + formatting (background,
// borders, font, alignment, wrap) — so the app can DRAW the document itself,
// laid out like the template, without a slow render round trip. Read-only;
// the service account needs Viewer access to the sheet.
//
// Auth: optional shared secret APP_ACCESS_KEY (x-access-key header).

type Rgb = [number, number, number];
interface Border { s: string; w: number; c: Rgb }
export interface GridCell {
  r: number; c: number;
  t?: string;                 // formatted text
  n?: boolean;                // numeric value (default right-aligned)
  bg?: Rgb;                   // background (omitted when white)
  b?: { t?: Border; r?: Border; b?: Border; l?: Border };
  f?: { b?: boolean; i?: boolean; u?: boolean; s?: number; c?: Rgb; fam?: string };
  h?: string;                 // LEFT | CENTER | RIGHT
  v?: string;                 // TOP | MIDDLE | BOTTOM
  w?: string;                 // OVERFLOW_CELL | WRAP | CLIP
}

const rgb = (col: any): Rgb | undefined => {
  if (!col) return undefined;
  const c = col.rgbColor || col;
  const to255 = (x: unknown) => Math.round((typeof x === 'number' ? x : 0) * 255);
  if (c.red === undefined && c.green === undefined && c.blue === undefined) return [0, 0, 0];
  return [to255(c.red), to255(c.green), to255(c.blue)];
};
const isWhite = (c?: Rgb) => !c || (c[0] >= 254 && c[1] >= 254 && c[2] >= 254);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req.headers['x-access-key'])) return res.status(401).json({ error: 'Unauthorized' });
  const cfg = checkGoogleConfig();
  if (!cfg.hasEmail || !cfg.hasKey) {
    return res.status(500).json({ error: 'Service account not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).' });
  }
  const sheetId = String(req.query.sheetId || '').trim();
  if (!sheetId) return res.status(400).json({ error: 'sheetId is required.' });

  try {
    const jwt = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const meta: any = await jwt.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties(title)`,
    });
    const title: string = meta.data?.sheets?.[0]?.properties?.title || 'Sheet1';
    const fields = 'sheets(properties(title,gridProperties(rowCount,columnCount)),merges,data(startRow,startColumn,'
      + 'rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser),'
      + 'rowData(values(formattedValue,effectiveValue,effectiveFormat(backgroundColor,borders,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)))))';
    const resp: any = await jwt.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?includeGridData=true`
        + `&ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}&fields=${encodeURIComponent(fields)}`,
    });
    const sh = resp.data?.sheets?.[0] || {};
    const data = sh.data?.[0] || {};
    const rowMeta: any[] = data.rowMetadata || [];
    const colMeta: any[] = data.columnMetadata || [];
    const rowsData: any[] = data.rowData || [];

    const cells: GridCell[] = [];
    let maxR = -1, maxC = -1;
    for (let r = 0; r < rowsData.length; r++) {
      const vals: any[] = rowsData[r]?.values || [];
      for (let c = 0; c < vals.length; c++) {
        const v = vals[c] || {};
        const ef = v.effectiveFormat || {};
        const cell: GridCell = { r, c };
        const text = v.formattedValue;
        if (text !== undefined && text !== null && String(text) !== '') cell.t = String(text);
        if (v.effectiveValue && typeof v.effectiveValue.numberValue === 'number') cell.n = true;
        const bg = rgb(ef.backgroundColor);
        if (bg && !isWhite(bg)) cell.bg = bg;
        const bd = ef.borders || {};
        const mk = (x: any): Border | undefined => (x && x.style && x.style !== 'NONE')
          ? { s: x.style, w: x.width || 1, c: rgb(x.colorStyle?.rgbColor || x.color) || [0, 0, 0] } : undefined;
        const b = { t: mk(bd.top), r: mk(bd.right), b: mk(bd.bottom), l: mk(bd.left) };
        if (b.t || b.r || b.b || b.l) cell.b = b;
        const tf = ef.textFormat || {};
        const f: GridCell['f'] = {};
        if (tf.bold) f.b = true;
        if (tf.italic) f.i = true;
        if (tf.underline) f.u = true;
        if (tf.fontSize) f.s = tf.fontSize;
        const fc = rgb(tf.foregroundColorStyle?.rgbColor || tf.foregroundColor);
        if (fc && (fc[0] || fc[1] || fc[2])) f.c = fc;
        if (tf.fontFamily) f.fam = tf.fontFamily;
        if (Object.keys(f).length) cell.f = f;
        if (ef.horizontalAlignment) cell.h = ef.horizontalAlignment;
        if (ef.verticalAlignment) cell.v = ef.verticalAlignment;
        if (ef.wrapStrategy) cell.w = ef.wrapStrategy;
        const meaningful = cell.t !== undefined || cell.bg || cell.b;
        if (meaningful) { maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
        if (!meaningful) continue;
        if (cell.t === undefined) { delete cell.f; delete cell.h; delete cell.v; delete cell.w; delete cell.n; }
        cells.push(cell);
      }
    }
    const merges = (sh.merges || []).map((m: any) => ({
      r0: m.startRowIndex || 0, r1: m.endRowIndex || 0, c0: m.startColumnIndex || 0, c1: m.endColumnIndex || 0,
    }));
    for (const m of merges) {
      // A merge that holds text/borders extends the used area to its far edge.
      if (cells.some(x => x.r === m.r0 && x.c === m.c0 && (x.t !== undefined || x.bg || x.b))) {
        maxR = Math.max(maxR, m.r1 - 1); maxC = Math.max(maxC, m.c1 - 1);
      }
    }
    const rowCount = maxR + 1, colCount = maxC + 1;
    const px = (m: any, dflt: number) => (m?.hiddenByUser ? 0 : (m?.pixelSize || dflt));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      title,
      rows: Array.from({ length: rowCount }, (_, i) => px(rowMeta[i], 21)),
      cols: Array.from({ length: colCount }, (_, i) => px(colMeta[i], 100)),
      merges: merges.filter((m: any) => m.r0 < rowCount && m.c0 < colCount),
      cells: cells.filter(x => x.r < rowCount && x.c < colCount),
    });
  } catch (e: any) {
    const msg = String(e?.response?.data?.error?.message || e?.message || e);
    if (/permission|not have access|forbidden|the caller does not have/i.test(msg)) {
      return res.status(403).json({ error: `The service account can't open this template. Share it with the service account email as a Viewer. (${msg})` });
    }
    return res.status(500).json({ error: msg });
  }
}
