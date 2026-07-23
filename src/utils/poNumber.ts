// PO-number matching by NUMERIC VALUE only.
//
// Orders and invoices reference the same purchase order with different wrapping:
// "PO10115420", "10115420" and "10652310-OP" are all meant to be the same PO.
// Comparing the raw strings treated them as different, so an order and its invoice
// failed to link and showed up as two separate records. Every PO comparison /
// dedup key across the app funnels through poKey so they agree.

/** Canonical comparison key for a PO number: its DIGITS only, with LEADING ZEROS
 *  dropped — so any prefix or suffix ("PO", "-OP", spaces, dashes) is ignored AND
 *  "069000" == "69000". Falls back to the trimmed, lower-cased string when the
 *  reference has no digits at all (so a purely alphabetic reference still compares
 *  sanely instead of collapsing to ""), and to the raw digits when they are all
 *  zeros. */
export function poKey(po: string | undefined | null): string {
  const digits = (po || '').replace(/\D/g, '');
  const noLeadingZeros = digits.replace(/^0+/, '');
  return noLeadingZeros || digits || (po || '').trim().toLowerCase();
}

/** True when two PO references denote the same purchase order by numeric value.
 *  Empty vs empty is NOT a match (a blank PO links to nothing). */
export function samePoNumber(a: string | undefined | null, b: string | undefined | null): boolean {
  const ka = poKey(a);
  const kb = poKey(b);
  return !!ka && ka === kb;
}
