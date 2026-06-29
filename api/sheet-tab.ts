import type { VercelRequest, VercelResponse } from '@vercel/node';
import { JWT } from 'google-auth-library';
import { checkAuth, checkGoogleConfig } from './_sheets.js';

// Read a single tab from ANY Google Sheet via the SERVICE ACCOUNT and return it
// as CSV. This lets the app import from a PRIVATE sheet shared only with the
// service account — no "Anyone with the link" needed.
//
// Uses the Sheets `values` API to return the RAW grid exactly as-is (every row,
// including row 1) — it does NOT assume row 1 is the header, so sheets whose real
// headers sit in row 2 (under a title/blank row) come through intact and the
// client can auto-detect headers from either row.
//
// Auth: optional shared secret (APP_ACCESS_KEY). When set, the caller must send
// the same value in x-access-key; when unset the endpoint is open (the service
// account can still only read sheets explicitly shared with it). Read-only.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req.headers['x-access-key'])) return res.status(401).json({ error: 'Unauthorized' });

  const cfg = checkGoogleConfig();
  if (!cfg.hasEmail || !cfg.hasKey) {
    return res.status(500).json({ error: 'Service account not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).' });
  }

  const sheetId = String(req.query.sheetId || '').trim();
  const tab = String(req.query.tab || '').trim();
  if (!sheetId || !tab) return res.status(400).json({ error: 'sheetId and tab are required.' });

  try {
    const jwt = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    // Range = the whole tab. UNFORMATTED so dates/numbers come through as values.
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`
      + `/values/${encodeURIComponent(tab)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
    const resp: any = await jwt.request({ url });
    const values: unknown[][] = (resp.data && resp.data.values) || [];

    const maxCols = values.reduce((m, r) => Math.max(m, r.length), 0);
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = values.map(r => {
      const row = r.slice();
      while (row.length < maxCols) row.push('');
      return row.map(esc).join(',');
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(lines.join('\n'));
  } catch (e: any) {
    const msg = String(e?.response?.data?.error?.message || e?.message || e);
    // The Google Sheets API isn't enabled in the service account's GCP project.
    if (/has not been used|is disabled|service[_\s-]*disabled|accessnotconfigured|sheets\.googleapis\.com/i.test(msg)) {
      return res.status(403).json({ error: `The Google Sheets API is not enabled for the service account's Google Cloud project. Enable it (APIs & Services → Library → "Google Sheets API"), wait a couple of minutes, then retry. (${msg})` });
    }
    // The sheet isn't shared with the service account.
    if (/permission|not have access|forbidden|the caller does not have/i.test(msg)) {
      return res.status(403).json({ error: `The service account can't open this sheet. Share it with the service account email (GOOGLE_SERVICE_ACCOUNT_EMAIL) as a Viewer or Editor. (${msg})` });
    }
    // Bad range usually means the tab name doesn't match.
    if (/unable to parse range|range/i.test(msg)) {
      return res.status(404).json({ error: `Tab "${tab}" not found in the sheet (check the exact tab name). (${msg})` });
    }
    return res.status(500).json({ error: msg });
  }
}
