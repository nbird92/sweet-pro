import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAuth } from './_sheets.js';

// Live(ish) ICE Sugar #11 (SB) futures board via Yahoo Finance's public chart
// API (no key; quotes are ~10-15 min delayed). Sugar #11 trades four contract
// months — Mar (H), May (K), Jul (N), Oct (V) — so the board lists the next
// several of those, e.g. SBH27.NYB. USD/CAD (CAD=X) rides along as a live FX
// reference. Responses cache ~10 min per instance + CDN s-maxage.

let cache: { at: number; payload: unknown } | null = null;
const CACHE_MS = 10 * 60 * 1000;

const MONTH_CODES: Array<{ code: string; month: number; label: string }> = [
  { code: 'H', month: 2, label: 'Mar' },   // March (0-based month index)
  { code: 'K', month: 4, label: 'May' },
  { code: 'N', month: 6, label: 'Jul' },
  { code: 'V', month: 9, label: 'Oct' },
];

/** The next `count` SB contract symbols from today, in expiry order. */
function nextContracts(count: number): Array<{ symbol: string; name: string }> {
  const out: Array<{ symbol: string; name: string }> = [];
  const now = new Date();
  let year = now.getUTCFullYear();
  // Walk month codes forward from the first contract whose month is >= now.
  let idx = MONTH_CODES.findIndex(m => m.month >= now.getUTCMonth());
  if (idx < 0) { idx = 0; year++; }
  while (out.length < count) {
    const m = MONTH_CODES[idx];
    const yy = String(year % 100).padStart(2, '0');
    out.push({ symbol: `SB${m.code}${yy}.NYB`, name: `Sugar #11 ${m.label} '${yy}` });
    idx++;
    if (idx >= MONTH_CODES.length) { idx = 0; year++; }
  }
  return out;
}

const lastOf = (arr: unknown): number | null => {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && isFinite(v)) return v;
  }
  return null;
};

/** One Yahoo v8 chart fetch → normalized quote (null when unavailable). */
async function yahooQuote(symbol: string): Promise<any | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SweetPro/1.0)' } });
  if (!r.ok) return null;
  const j: any = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const q = result.indicators?.quote?.[0] || {};
  const last = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : lastOf(q.close);
  const prev = typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose
    : (typeof meta.previousClose === 'number' ? meta.previousClose : null);
  if (last == null) return null;
  const chg = prev != null ? last - prev : null;
  return {
    symbol: meta.symbol || symbol,
    lastPrice: last,
    previousClose: prev,
    netChange: chg,
    percentChange: chg != null && prev ? (chg / prev) * 100 : null,
    open: lastOf(q.open),
    high: lastOf(q.high),
    low: lastOf(q.low),
    tradeTimestamp: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.json({ ...(cache.payload as object), cached: true });
  }
  try {
    const wanted = nextContracts(8);
    const [fxQuote, ...contractQuotes] = await Promise.all([
      yahooQuote('CAD=X'),
      ...wanted.map(w => yahooQuote(w.symbol)),
    ]);
    const contracts = contractQuotes
      .map((q, i) => (q ? { ...q, name: wanted[i].name } : null))
      .filter(Boolean);
    if (contracts.length === 0) {
      return res.status(502).json({ error: 'Yahoo Finance returned no Sugar #11 contract quotes (source may be temporarily unavailable).' });
    }
    const payload = { contracts, fx: fxQuote, lastUpdated: new Date().toISOString(), source: 'Yahoo Finance (delayed)' };
    cache = { at: Date.now(), payload };
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=300');
    return res.json(payload);
  } catch (e) {
    console.error('Sugar #11 fetch error:', e);
    return res.status(500).json({ error: (e as Error).message });
  }
}
