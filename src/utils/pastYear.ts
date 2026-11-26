// Customers never place orders for past years. When a date lands well BEFORE
// the moment the order was created (an AI-scanned "Nov 28" read as 2023-11-28),
// the year is wrong: move it to the same month/day in the reference year, or
// the next year if that is still too far back. (api/_poExtract.ts keeps a copy.)

const DAY = 86400000;

export function fixPastYear(dateISO: string | undefined, refISO: string, toleranceDays = 120): string | undefined {
  if (!dateISO) return dateISO;
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const r = refISO.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !r) return dateISO;
  const ref = Date.UTC(+r[1], +r[2] - 1, +r[3]);
  const floor = ref - toleranceDays * DAY;
  if (Date.UTC(+m[1], +m[2] - 1, +m[3]) >= floor) return dateISO;
  const month = +m[2], day = +m[3];
  for (const y of [+r[1], +r[1] + 1]) {
    // Feb 29 in a non-leap year → Feb 28.
    let d = day;
    while (d > 28 && new Date(Date.UTC(y, month - 1, d)).getUTCMonth() !== month - 1) d--;
    if (Date.UTC(y, month - 1, d) >= floor) return `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return dateISO;
}
