import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAuth } from './_sheets.js';

// Live ICE Sugar #11 (SB) futures board via Barchart OnDemand getQuote.
// SB*1..SB*8 are Barchart's nearby-contract aliases (front month → 8th month),
// resolved server-side to real contract symbols (e.g. SBH27). ^USDCAD rides
// along for a live FX reference. Requires BARCHART_API_KEY in the Vercel env.
//
// Responses are cached ~10 min per serverless instance (plus CDN s-maxage) so
// the free-tier daily query allowance is never a concern.

let cache: { at: number; payload: unknown } | null = null;
const CACHE_MS = 10 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  const apikey = process.env.BARCHART_API_KEY;
  if (!apikey) {
    return res.status(500).json({ error: 'BARCHART_API_KEY is not configured on the server (Vercel → Settings → Environment Variables).' });
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.json({ ...(cache.payload as object), cached: true });
  }
  try {
    const symbols = ['SB*1', 'SB*2', 'SB*3', 'SB*4', 'SB*5', 'SB*6', 'SB*7', 'SB*8', '^USDCAD'].join(',');
    const url = `https://ondemand.websol.barchart.com/getQuote.json?apikey=${encodeURIComponent(apikey)}&symbols=${encodeURIComponent(symbols)}&fields=${encodeURIComponent('previousClose,openInterest,volume')}`;
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(502).json({ error: `Barchart HTTP ${r.status}` });
    }
    const j: any = await r.json();
    if (!j || (j.status && j.status.code !== 200)) {
      return res.status(502).json({ error: `Barchart: ${j?.status?.message || 'unexpected response'}` });
    }
    const results: any[] = Array.isArray(j.results) ? j.results : [];
    const fx = results.find(q => /USDCAD/i.test(String(q.symbol || ''))) || null;
    const contracts = results.filter(q => q !== fx && /^SB/i.test(String(q.symbol || '')));
    const payload = { contracts, fx, lastUpdated: new Date().toISOString() };
    cache = { at: Date.now(), payload };
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.json(payload);
  } catch (e) {
    console.error('Sugar #11 fetch error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}
