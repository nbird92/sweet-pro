import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAuth } from './_sheets.js';

// USD/CAD forward rates via FXEmpire's public JSON endpoint (the same data
// their /currencies/usd-cad/forward-rates page renders): tenors Overnight →
// FiveYear, each with Bid/Mid/Ask/SpotRate/Points. Cached ~30 min.

let cache: { at: number; payload: unknown } | null = null;
const CACHE_MS = 30 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return res.json({ ...(cache.payload as object), cached: true });
  }
  try {
    const r = await fetch('https://www.fxempire.com/api/v1/en/currencies/usd-cad/forward-rates', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SweetPro/1.0)', Accept: 'application/json' },
    });
    if (!r.ok) {
      return res.status(502).json({ error: `FXEmpire HTTP ${r.status}` });
    }
    const j: any = await r.json();
    const forwardRates = j?.forwardRates || j?.data?.forwardRates;
    if (!forwardRates || typeof forwardRates !== 'object') {
      return res.status(502).json({ error: 'FXEmpire returned no forward rates (source format may have changed).' });
    }
    const payload = { forwardRates, date: j?.date || j?.data?.date || null, lastUpdated: new Date().toISOString(), source: 'FXEmpire' };
    cache = { at: Date.now(), payload };
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return res.json(payload);
  } catch (e) {
    console.error('FX forwards fetch error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}
