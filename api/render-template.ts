import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JWT } from 'google-auth-library';
import { checkAuth, checkGoogleConfig } from './_sheets.js';

// Render a Google Sheet TEMPLATE to PDF via the service account, with the order's
// values filled in. The template uses plain text tokens:
//   - Scalar:    {{po}}, {{customer_name}}, {{bol}}, … (replaced everywhere)
//   - Line item: one row whose cells hold {{item_description}}, {{item_contract}},
//                {{item_units}}, … — that row is written once per line item.
// Flow: COPY the template (Drive) -> write line items + find/replace scalars
// (Sheets) -> EXPORT the copy to PDF (Drive) -> DELETE the copy. Read-only to the
// original template (it's never modified). Needs the Sheets AND Drive APIs.
//
// Auth: optional shared secret APP_ACCESS_KEY (x-access-key header).

function colLetter(idx0: number): string {
  let n = idx0 + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req.headers['x-access-key'])) return res.status(401).json({ error: 'Unauthorized' });
  const cfg = checkGoogleConfig();
  if (!cfg.hasEmail || !cfg.hasKey) {
    return res.status(500).json({ error: 'Service account not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).' });
  }

  const body: any = (req.body && typeof req.body === 'object') ? req.body : {};
  const sheetId = String(body.sheetId || '').trim();
  const tokens: Record<string, string> = (body.tokens && typeof body.tokens === 'object') ? body.tokens : {};
  const lineItems: Array<Record<string, string>> = Array.isArray(body.lineItems) ? body.lineItems : [];
  // Optional: which item fields / scalar tokens are numeric, so their cells get
  // right-aligned in the output (text written via the API / find-replace would
  // otherwise inherit the template's default left alignment).
  const numericFields: string[] = Array.isArray(body.numericFields) ? body.numericFields.map(String) : [];
  const numericTokens: string[] = Array.isArray(body.numericTokens) ? body.numericTokens.map(String) : [];
  if (!sheetId) return res.status(400).json({ error: 'sheetId is required.' });

  const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });

  let copyId = '';
  try {
    // 1. Copy the template so we never modify the original.
    const copyResp: any = await jwt.request({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheetId)}/copy?fields=id&supportsAllDrives=true`,
      method: 'POST',
      data: { name: `__order_confirmation_render_${Date.now()}` },
    });
    copyId = copyResp.data?.id;
    if (!copyId) throw new Error('Could not copy the template sheet.');

    // 2. First tab's gid + title.
    const metaResp: any = await jwt.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${copyId}?fields=sheets.properties(sheetId,title)`,
    });
    const firstProps = metaResp.data?.sheets?.[0]?.properties || {};
    const gid: number = firstProps.sheetId ?? 0;
    const tabTitle: string = firstProps.title || 'Sheet1';

    // 3. Read the grid to find the line-item template row + which column holds which field.
    const valuesResp: any = await jwt.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${copyId}/values/${encodeURIComponent(tabTitle)}?valueRenderOption=FORMATTED_VALUE`,
    });
    const grid: string[][] = valuesResp.data?.values || [];
    let itemRow = -1;
    const itemColField = new Map<number, string>(); // 0-based column -> item field name
    for (let r = 0; r < grid.length && itemRow < 0; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const m = String(row[c] ?? '').match(/\{\{\s*item_(\w+)\s*\}\}/);
        if (m) { if (itemRow < 0) itemRow = r; itemColField.set(c, m[1]); }
      }
    }

    // 0-based (row, col) cells to right-align after the content is written.
    const alignRightCells: Array<{ r: number; c: number }> = [];
    // Whole-cell scalar tokens flagged numeric (e.g. {{total_net}}) — full scan,
    // since totals usually sit below the line-item row. Coordinates stay valid
    // through find-replace (it rewrites cell content, never moves cells).
    if (numericTokens.length) {
      const numericSet = new Set(numericTokens);
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        for (let c = 0; c < row.length; c++) {
          const m = String(row[c] ?? '').match(/^\s*\{\{\s*(\w+)\s*\}\}\s*$/);
          if (m && numericSet.has(m[1])) alignRightCells.push({ r, c });
        }
      }
    }

    // 4. Write each line item into a row (starting at the template row). The
    //    template row is overwritten by item 1; later items go in the rows below.
    //    When there are no items, the template row's tokens are cleared.
    const valueData: Array<{ range: string; values: string[][] }> = [];
    if (itemRow >= 0 && itemColField.size > 0) {
      const cols = Array.from(itemColField.keys());
      const numericFieldSet = new Set(numericFields);
      const rowsToWrite = Math.max(lineItems.length, 1);
      for (let i = 0; i < rowsToWrite; i++) {
        const item = lineItems[i];
        for (const c of cols) {
          const field = itemColField.get(c)!;
          const val = item ? String(item[field] ?? '') : '';
          valueData.push({ range: `${tabTitle}!${colLetter(c)}${itemRow + 1 + i}`, values: [[val]] });
          if (numericFieldSet.has(field)) alignRightCells.push({ r: itemRow + i, c });
        }
      }
    }
    if (valueData.length) {
      await jwt.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${copyId}/values:batchUpdate`,
        method: 'POST',
        data: { valueInputOption: 'RAW', data: valueData },
      });
    }

    // 5. Replace scalar tokens everywhere, then right-align the numeric cells.
    const requests: any[] = Object.entries(tokens).map(([k, v]) => ({
      findReplace: { find: `{{${k}}}`, replacement: String(v ?? ''), matchCase: false, allSheets: true },
    }));
    for (const { r, c } of alignRightCells) {
      requests.push({
        repeatCell: {
          range: { sheetId: gid, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
          cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
          fields: 'userEnteredFormat.horizontalAlignment',
        },
      });
    }
    if (requests.length) {
      await jwt.request({
        url: `https://sheets.googleapis.com/v4/spreadsheets/${copyId}:batchUpdate`,
        method: 'POST',
        data: { requests },
      });
    }

    // 6. Export the filled copy to PDF (the sheet's own print layout, portrait,
    //    fit to width, no gridlines).
    const params = new URLSearchParams({
      format: 'pdf', gid: String(gid), portrait: 'true', fitw: 'true',
      gridlines: 'false', printtitle: 'false', sheetnames: 'false', pagenumbers: 'false',
      top_margin: '0.5', bottom_margin: '0.5', left_margin: '0.5', right_margin: '0.5',
    });
    const pdfResp: any = await jwt.request({
      url: `https://docs.google.com/spreadsheets/d/${copyId}/export?${params.toString()}`,
      responseType: 'arraybuffer',
    });
    const pdfBuffer = Buffer.from(pdfResp.data);

    // 7. Delete the working copy.
    await jwt.request({ url: `https://www.googleapis.com/drive/v3/files/${copyId}?supportsAllDrives=true`, method: 'DELETE' }).catch(() => {});
    copyId = '';

    res.setHeader('Content-Type', 'application/pdf');
    return res.status(200).send(pdfBuffer);
  } catch (e: any) {
    if (copyId) { try { await jwt.request({ url: `https://www.googleapis.com/drive/v3/files/${copyId}?supportsAllDrives=true`, method: 'DELETE' }); } catch { /* ignore */ } }
    const msg = String(e?.response?.data?.error?.message || e?.message || e);
    if (/has not been used|is disabled|service[_\s-]*disabled|accessnotconfigured/i.test(msg)) {
      return res.status(403).json({ error: `Enable the Google Sheets API AND the Google Drive API for the service account's project, then retry. (${msg})` });
    }
    if (/permission|not have access|forbidden|the caller does not have/i.test(msg)) {
      return res.status(403).json({ error: `The service account can't access the template sheet. Share it with the service account email (GOOGLE_SERVICE_ACCOUNT_EMAIL) as a Viewer or Editor. (${msg})` });
    }
    return res.status(500).json({ error: msg });
  }
}
