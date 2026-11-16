/** Display formatting for numbers: thousands separators + fixed decimals,
 *  e.g. fmtN(25445.4) → "25,445.40", fmtN(24500, 0) → "24,500".
 *  Drop-in for `.toFixed(d)` in anything a person reads (screens, PDFs,
 *  emails). null / undefined → '' (so `x?.toFixed()` call sites keep working).
 *  Never use it for values that are parsed back (inputs, CSV, stored data). */
export function fmtN(v: unknown, d = 2): string {
  if (v === null || v === undefined) return '';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
