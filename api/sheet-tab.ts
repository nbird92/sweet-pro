import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDoc, checkAuth, checkGoogleConfig } from './_sheets.js';

// Read a single tab from ANY Google Sheet via the SERVICE ACCOUNT and return it
// as CSV (header row + data rows). This lets the app import from a PRIVATE sheet
// that is shared only with the service account — no "Anyone with the link" needed.
//
// Auth: optional shared secret (APP_ACCESS_KEY). When that env var is set, the
// caller must send the same value in the x-access-key header; when it's unset the
// endpoint is open (the service account can still only read sheets explicitly
// shared with it). Read-only: it never creates or modifies the sheet.
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
    const doc = getDoc(sheetId);
    await doc.loadInfo(); // throws 403 if the service account doesn't have access
    const sheet = doc.sheetsByTitle[tab];
    if (!sheet) {
      return res.status(404).json({ error: `Tab "${tab}" not found. Tabs: ${Object.keys(doc.sheetsByTitle).join(', ')}` });
    }
    await sheet.loadHeaderRow().catch(() => {});
    const headers = (sheet.headerValues || []).filter(h => h !== '');
    if (headers.length === 0) return res.status(200).send('');
    const rows = await sheet.getRows();
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(esc).join(',')];
    for (const r of rows) lines.push(headers.map(h => esc(r.get(h))).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(lines.join('\n'));
  } catch (e: any) {
    const msg = String(e?.message || e);
    // Surface the common case clearly: the sheet isn't shared with the SA.
    if (/permission|403|not have access|forbidden/i.test(msg)) {
      return res.status(403).json({ error: `The service account can't open this sheet. Share it with the service account email (GOOGLE_SERVICE_ACCOUNT_EMAIL) as a Viewer or Editor. (${msg})` });
    }
    return res.status(500).json({ error: msg });
  }
}
