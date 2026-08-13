// Lot-code string helpers shared across the app.
//
// Structured Hamilton lot codes look like "HS-L00C26222-S3" and never contain
// internal spaces. Imported Google-Sheet cells sometimes carry one, though
// (e.g. "HS-L00C26222- S3"), and that stray space both looks wrong AND breaks
// exact-string lookups that resolve a shipment/invoice lot back to its lot-code
// record. These helpers canonicalise the HS- family and compare lot numbers
// whitespace-insensitively so a cleaned code still matches a legacy spaced copy.

/** The canonical structured lot-code shape: HS-{sugar}{pg2}{cat}{yy}{jjj}-{silo}{load}. */
const CANONICAL_LOT = /^HS-[RLMIBY]\d{2}[BC]\d{2}\d{3}-?[EWNS]?\d*$/i;

/** Strip ALL internal whitespace from a structured (HS-…) lot code so it is in
 *  canonical form — but ONLY when the stripped result is a valid lot code. That
 *  guard matters because these fields are free text: "HS-…-S3 HS-…-S4" (two lots
 *  separated by a space) or "HS-…-S3 (partial)" must NOT be welded into one
 *  token. Anything that doesn't clean up to a canonical code is only trimmed. */
export function cleanLotCode(lot?: string): string {
  const t = (lot || '').trim();
  if (!/^HS-/i.test(t)) return t;
  const stripped = t.replace(/\s+/g, '');
  return CANONICAL_LOT.test(stripped) ? stripped : t;
}

/** Whitespace-insensitive lot-number equality — both sides have ALL whitespace
 *  removed before comparison. Empty/blank never matches. Case-sensitive, matching
 *  the exact-equality it replaces (lot codes are upper-case by convention). */
export function sameLotCode(a?: string, b?: string): boolean {
  const na = (a || '').replace(/\s+/g, '');
  const nb = (b || '').replace(/\s+/g, '');
  return na !== '' && na === nb;
}

/** Canonical hash key for a lot number — whitespace-stripped and upper-cased.
 *  Use on BOTH sides of any Map/Set keyed on a lot string (sameLotCode can't be
 *  used there, since a hash lookup isn't a pairwise compare). */
export function lotKey(lot?: string): string {
  return (lot || '').replace(/\s+/g, '').toUpperCase();
}

/** Clean every lot number in a comma/semicolon-separated list, preserving the
 *  ", " joined shape used across invoices/orders/shipments. Cleaning can make two
 *  entries identical (a legacy spaced copy alongside its clean twin), so the list
 *  is deduped by canonical key — keeping the first occurrence's spelling. */
export function cleanLotCodeList(lots?: string): string {
  return dedupeLotCodes((lots || '').split(/[,;]+/).map(s => cleanLotCode(s))).join(', ');
}

/** Drop duplicate lot numbers (by canonical key) and blanks, preserving order. */
export function dedupeLotCodes(lots: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lots) {
    if (!l) continue;
    const k = lotKey(l);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}
