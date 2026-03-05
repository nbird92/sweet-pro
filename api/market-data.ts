import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getMarketDoc, checkAuth } from './_sheets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }

  const hasEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const hasKey = !!process.env.GOOGLE_PRIVATE_KEY;

  if (!hasEmail || !hasKey) {
    return res.status(500).json({ error: "Server authentication not configured" });
  }

  try {
    const marketDoc = getMarketDoc();
    await marketDoc.loadInfo();
    const sheet = marketDoc.sheetsByTitle['Data Summary'];
    if (!sheet) {
      return res.status(404).json({ error: "Sheet 'Data Summary' not found in market spreadsheet" });
    }

    const rows = await sheet.getRows();
    res.json({
      data: rows.map(r => r.toObject()),
      lastUpdated: new Date().toISOString()
    });
  } catch (e) {
    console.error("Market Data Fetch Error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
}
