// Contract date helpers.
//
// The Customer Quote page picks contract months as "Mon YYYY" ("Dec 2027"); a
// contract's End Date is the LAST day of its end month (Dec 2027 → 2027-12-31)
// and its Start Date stays as entered. Imports and the Edit Contract date picker
// give ISO dates, which are kept as-is.

const MO = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "Mon YYYY" / "Month YYYY" / "YYYY-MM" → { y, m (1-12) }, or null. */
function parseMonth(v?: string | null): { y: number; m: number } | null {
  const t = String(v ?? '').trim();
  let r = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (r) return { y: +r[1], m: +r[2] };
  r = /^([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t);
  if (r) {
    const mi = MO.indexOf(r[1].slice(0, 3).toLowerCase());
    return mi >= 0 ? { y: +r[2], m: mi + 1 } : null;
  }
  return null;
}

/** ISO date of the last day of a month. */
export function lastDayOfMonthIso(y: number, m: number): string {
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** A contract End Date as stored: a month value becomes that month's last day;
 *  a full ISO date is kept; anything else is returned unchanged. */
export function contractEndDate(v?: string | null): string {
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const pm = parseMonth(t);
  return pm ? lastDayOfMonthIso(pm.y, pm.m) : t;
}

/** Local-calendar ISO date for a timestamp. */
const isoLocal = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The date a contract was created: its stored Contract Date, else the
 *  timestamp in its CON-<ms> id, else the oldest dated entry in its notes
 *  ("[2026-11-23, 10:30 a.m. · …]"). '' when none is known. */
export function contractCreatedDate(c: { id?: string; contractDate?: string; notes?: string }): string {
  const cd = String(c.contractDate ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(cd)) return cd.slice(0, 10);
  const idTs = /^CON-(\d{13})/.exec(c.id || '');
  if (idTs) return isoLocal(Number(idTs[1]));
  const stamps = (c.notes || '').match(/\[(\d{4}-\d{2}-\d{2})/g) || [];
  if (stamps.length) return stamps.map(s => s.slice(1)).sort()[0];
  return '';
}
