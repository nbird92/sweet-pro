// A customer can trade under SEVERAL ITAS accounts (e.g. SBF.P and SBFLEC.P).
// `itasCustomerName` stays the PRIMARY name (exports, contract auto-fill);
// `itasCustomerNames` holds the extra ones. Every place that matches records to
// a customer by ITAS name goes through itasNamesOf() so all names count —
// invoices, orders, contracts, sales stats, reports and forecasts.

import type { Customer } from '../types';

type HasItas = { itasCustomerName?: string; itasCustomerNames?: string[] };

/** All of a customer's ITAS names — primary first — trimmed, blanks dropped,
 *  case-insensitive duplicates removed. */
export function itasNamesOf(c?: HasItas | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [c.itasCustomerName, ...(c.itasCustomerNames || [])]) {
    const n = (raw || '').trim();
    const k = n.toLowerCase();
    if (!n || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** Split a cell like "CHAPMAN.P; CHAPMANUS.P" (also "|" or newlines) into names. */
export function splitItasNames(raw?: string): string[] {
  return (raw || '').split(/[;|\n]+/).map(s => s.trim()).filter(Boolean);
}

/** Store a list of ITAS names on a customer: the first becomes the primary,
 *  the rest the extras (the extras key is removed when there are none). */
export function withItasNames<T extends HasItas>(c: T, names: string[]): T {
  const clean = itasNamesOf({ itasCustomerNames: names });
  const { itasCustomerNames: _old, ...rest } = c;
  const next = { ...rest, itasCustomerName: clean[0] || undefined } as T;
  if (clean.length > 1) next.itasCustomerNames = clean.slice(1);
  if (!next.itasCustomerName) delete next.itasCustomerName;
  return next;
}

/** Display form: "CHAPMAN.P, CHAPMANUS.P". */
export function itasNamesLabel(c?: HasItas | null): string {
  return itasNamesOf(c).join(', ');
}

export type { Customer };
