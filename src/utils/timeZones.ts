// Time zones.
//
//  • Shipment appointment times (Shipment.time / dock schedule slots) are stored
//    in the LOCATION's local time zone (Location.timeZone).
//  • Emails and emailed appointment requests are in EASTERN time.
//  • The app shows times in the zone the user picks on the Dashboard.
//
// Conversion is by wall-clock time on a date (DST-correct via Intl), so a
// "10:00 on 2026-11-26 in Eastern" becomes "07:00" in Pacific.

export const EASTERN_TZ = 'America/Toronto';

/** Zone choices: [IANA id, label]. */
export const TIME_ZONE_OPTIONS: Array<[string, string]> = [
  ['America/St_Johns', 'Newfoundland (St. John’s)'],
  ['America/Halifax', 'Atlantic (Halifax)'],
  ['America/Toronto', 'Eastern (Toronto / New York)'],
  ['America/Winnipeg', 'Central (Winnipeg / Chicago)'],
  ['America/Regina', 'Saskatchewan (Regina)'],
  ['America/Edmonton', 'Mountain (Edmonton / Denver)'],
  ['America/Phoenix', 'Arizona (Phoenix)'],
  ['America/Vancouver', 'Pacific (Vancouver / Los Angeles)'],
  ['America/Anchorage', 'Alaska (Anchorage)'],
  ['Pacific/Honolulu', 'Hawaii (Honolulu)'],
  ['America/Mexico_City', 'Mexico City'],
  ['America/Bogota', 'Bogotá / Lima'],
  ['America/Sao_Paulo', 'São Paulo'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
  ['Europe/London', 'London / Dublin / Lisbon'],
  ['Europe/Paris', 'Central Europe (Paris / Berlin / Nuremberg)'],
  ['Europe/Athens', 'Eastern Europe (Athens / Istanbul)'],
  ['Africa/Johannesburg', 'Johannesburg'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'India (Mumbai / Delhi)'],
  ['Asia/Bangkok', 'Bangkok / Jakarta'],
  ['Asia/Singapore', 'Singapore / Kuala Lumpur'],
  ['Asia/Shanghai', 'China (Shanghai / Beijing)'],
  ['Asia/Tokyo', 'Tokyo / Seoul'],
  ['Australia/Sydney', 'Sydney / Melbourne'],
  ['Pacific/Auckland', 'Auckland'],
];

export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || EASTERN_TZ; } catch { return EASTERN_TZ; }
}

export function isValidTimeZone(tz?: string): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Offset (minutes) of `tz` from UTC at the instant `utcMs`. */
function offsetMinutes(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value || 0);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Wall time `HH:MM` on `YYYY-MM-DD` in `tz` → UTC milliseconds. */
export function zonedToUtc(dateISO: string, time: string, tz: string): number | null {
  const dm = (dateISO || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  const tm = (time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!dm || !tm || !isValidTimeZone(tz)) return null;
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  const off1 = offsetMinutes(tz, guess);
  let utc = guess - off1 * 60000;
  const off2 = offsetMinutes(tz, utc);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return utc;
}

/** UTC milliseconds → wall date + time in `tz`. */
export function utcToZoned(utcMs: number, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => parts.find(p => p.type === t)?.value || '00';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${String(Number(g('hour')) % 24).padStart(2, '0')}:${g('minute')}` };
}

/** Convert a wall time between zones. `dayShift` is −1/0/+1 when the date moves.
 *  Unparseable input (or the same zone) comes back unchanged. */
export function convertWallTime(dateISO: string, time: string, fromTz: string, toTz: string): { date: string; time: string; dayShift: number } {
  const same = { date: dateISO, time, dayShift: 0 };
  if (!fromTz || !toTz || fromTz === toTz) return same;
  const utc = zonedToUtc(dateISO, time, fromTz);
  if (utc === null || !isValidTimeZone(toTz)) return same;
  const out = utcToZoned(utc, toTz);
  const d0 = Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10));
  const d1 = Date.UTC(+out.date.slice(0, 4), +out.date.slice(5, 7) - 1, +out.date.slice(8, 10));
  return { ...out, dayShift: Math.round((d1 - d0) / 86400000) };
}

/** Short zone name on a date, e.g. "EST" / "PST". */
export function tzShort(tz?: string, dateISO?: string): string {
  if (!tz) return '';
  try {
    const d = dateISO ? new Date(`${dateISO}T12:00:00Z`) : new Date();
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
}

/** An ISO instant shown in `tz` (toLocaleString with the zone). */
export function formatInstant(iso: string | undefined, tz?: string, dateOnly = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const opt = isValidTimeZone(tz) ? { timeZone: tz } : undefined;
  return dateOnly ? d.toLocaleDateString(undefined, opt) : d.toLocaleString(undefined, opt);
}

/** Default zone for a location name when none is set: Vancouver sites are
 *  Pacific; everything else Eastern. */
export function guessLocationTimeZone(name?: string): string {
  return /vancouver/i.test(name || '') ? 'America/Vancouver' : EASTERN_TZ;
}
