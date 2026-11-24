// Shipment identity + duplicate cleanup.
//
// A shipment's identity is its BOL on its date. BOL numbers are reused across
// years (L5000770 is a 2024 load AND a 2026 lot code), so the BOL alone is not
// an identity; the date pins it to one load. Every import / sync path checks
// this key before creating a row, so a re-sync updates (or skips) instead of
// adding a second row for the same load.
//
// The schedule grid shows only the first shipment per bay/day/time slot, so a
// duplicate hides the other copy — and the hidden copy often holds data (lot
// codes, scaled qty, status) the visible one lacks. planShipmentDedupe() groups
// the copies, picks the best row, fills its blanks from the others, and lists
// the rest for deletion. It is pure: the caller previews the plan and performs
// the writes/deletes through the app's tombstoned delete path.

import type { Shipment } from '../types';

/** Normalized BOL used as identity: uppercase letters/digits only, and only when
 *  it contains a digit — placeholders like "UNLOADED" / "ONHOLD" / "TBD" are
 *  shared by unrelated loads and are never an identity. */
export function shipmentBolKey(bol?: string | null): string {
  const k = String(bol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /\d/.test(k) ? k : '';
}

/** BOL + date identity ('' when either is missing). */
export function shipmentIdentityKey(s: { bol?: string | null; date?: string | null }): string {
  const b = shipmentBolKey(s.bol);
  const d = String(s.date ?? '').trim();
  return b && d ? `${b}|${d}` : '';
}

/** Days between two ISO dates (NaN when either is unreadable). */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${(a || '').trim()}T12:00:00Z`);
  const tb = Date.parse(`${(b || '').trim()}T12:00:00Z`);
  return Math.abs(ta - tb) / 86400000;
}

/* ------------------------------------------------------------------ */
/* Duplicate cleanup plan                                              */
/* ------------------------------------------------------------------ */

export interface DedupeGroup {
  key: string;
  bol: string;
  date: string;
  /** The surviving row with blanks filled from the copies (same id as `original`). */
  keep: Shipment;
  original: Shipment;
  drop: Shipment[];
  /** Fields the merge filled or changed on the surviving row. */
  filled: string[];
}

export interface DedupeHold {
  key: string;
  reason: string;
  rows: Shipment[];
}

export interface DedupePlan {
  groups: DedupeGroup[];
  /** Every row the plan deletes (the copies, never a surviving row). */
  dropIds: string[];
  /** Surviving rows whose content changed (fields filled / status raised). */
  changed: Shipment[];
  /** Duplicate sets left untouched — they need a person to decide. */
  held: DedupeHold[];
}

const norm = (s?: string | null) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** PO identity: its digits (leading zeros dropped) so "PO71106" == "71106";
 *  letters-only refs fall back to their letters. */
const poId = (po?: string | null) => {
  const digits = String(po ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits || norm(po);
};

/** Progress rank for merging status. A completed / in-progress copy is physical
 *  evidence the load moved, so it wins; otherwise the most advanced wins. */
const STATUS_RANK = (st?: string | null): number => {
  const x = String(st ?? '').trim().toLowerCase();
  if (!x) return 0;
  if (x.includes('complet')) return 5;
  if (x.includes('progress')) return 4;
  if (x.includes('cancel')) return 3;
  if (x.includes('confirm')) return 2;
  return 1; // Scheduled / Pending / anything else
};
const CANON_STATUS: Record<number, string> = { 5: 'Completed', 4: 'In Progress', 3: 'Cancelled', 2: 'Confirmed' };

/** Text fields copied onto the surviving row when it has none. */
const FILL_TEXT: Array<keyof Shipment> = [
  'customer', 'product', 'contractNumber', 'po', 'carrier', 'arrive', 'start', 'out',
  'notes', 'color', 'colour', 'trailerNo', 'lotNumber', 'deliveryDate', 'originOfGoods',
];
/** Fields counted when judging which copy is most complete. */
const SCORE_FIELDS: Array<keyof Shipment> = [
  ...FILL_TEXT, 'time', 'bay', 'location', 'qty', 'scaledQty', 'lotNumbers', 'sealNumbers',
];
const filledCount = (s: Shipment) => SCORE_FIELDS.reduce((n, f) => {
  const v = s[f] as unknown;
  if (Array.isArray(v)) return n + (v.some(x => !blank(x)) ? 1 : 0);
  if (typeof v === 'number') return n + (v > 0 ? 1 : 0);
  return n + (blank(v) ? 0 : 1);
}, 0);

const sameCustomer = (a: string, b: string) => !a || !b || a === b || a.includes(b) || b.includes(a);
const sameText = (a?: string | null, b?: string | null) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

const union = (lists: Array<string[] | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lists) for (const x of l || []) {
    const t = String(x ?? '').trim();
    if (t && !seen.has(t.toUpperCase())) { seen.add(t.toUpperCase()); out.push(t); }
  }
  return out;
};

/**
 * Plan the cleanup of shipments that share a BOL + date.
 *  • validBay(s): true when the row's bay is a real bay of its location — such a
 *    row is visible on the schedule, so it is preferred as the survivor.
 *  • invoicedIds: shipment ids an invoice points at (Invoice.shipmentId) — that
 *    row must survive; two invoiced rows in one set are held for review.
 * Sets are left untouched (held) when the copies carry different POs with no way
 * to tell which blank-PO row belongs where, different customers, different
 * transfer links, two invoiced rows, or a Cancelled copy next to a still-open
 * one (cancelling may have been the user's own call — a person decides).
 */
export function planShipmentDedupe(
  shipments: Shipment[],
  ctx: { validBay?: (s: Shipment) => boolean; invoicedIds?: Set<string> } = {},
): DedupePlan {
  const validBay = ctx.validBay || (() => false);
  const invoiced = ctx.invoicedIds || new Set<string>();
  const plan: DedupePlan = { groups: [], dropIds: [], changed: [], held: [] };

  const byKey = new Map<string, Shipment[]>();
  const seenIds = new Set<string>();
  for (const s of shipments) {
    if (!s || !s.id || seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    const k = shipmentIdentityKey(s);
    if (!k) continue;
    const list = byKey.get(k);
    if (list) list.push(s); else byKey.set(k, [s]);
  }

  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    // Different POs under one BOL + date (transfer refs SHER-REFBB-SL-96/97…,
    // or two customers on one sheet line) are different loads: split by PO.
    const pos = new Set(rows.map(r => poId(r.po)).filter(Boolean));
    const sets: Array<{ key: string; rows: Shipment[] }> = [];
    if (pos.size > 1) {
      for (const p of pos) sets.push({ key: `${key}|PO ${p}`, rows: rows.filter(r => poId(r.po) === p) });
      const noPo = rows.filter(r => !poId(r.po));
      if (noPo.length) plan.held.push({ key, reason: 'Rows with no PO under a BOL shared by several POs', rows: noPo });
    } else {
      sets.push({ key, rows });
    }

    for (const set of sets) {
      const grp = set.rows;
      if (grp.length < 2) continue;
      const custs = Array.from(new Set(grp.map(r => norm(r.customer)).filter(Boolean)));
      if (custs.some((a, i) => custs.slice(i + 1).some(b => !sameCustomer(a, b)))) {
        plan.held.push({ key: set.key, reason: 'Different customers on the same BOL and date', rows: grp });
        continue;
      }
      const transferLinks = new Set(grp.map(r => String(r.notes || '')).filter(n => n.startsWith('TRANSFER:')));
      if (transferLinks.size > 1) {
        plan.held.push({ key: set.key, reason: 'Linked to different transfers', rows: grp });
        continue;
      }
      const inv = grp.filter(r => invoiced.has(r.id));
      if (inv.length > 1) {
        plan.held.push({ key: set.key, reason: 'More than one copy is linked to an invoice', rows: grp });
        continue;
      }
      const ranks = grp.map(r => STATUS_RANK(r.status));
      const maxRank = Math.max(...ranks);
      if (maxRank === 3 && ranks.some(r => r !== 3)) {
        plan.held.push({ key: set.key, reason: 'A Cancelled copy next to a Scheduled/Confirmed one', rows: grp });
        continue;
      }

      // Survivor: the invoiced row; else a row on a real bay (visible on the
      // schedule); then the most advanced status; then the most complete; then a
      // stable id order so the plan is deterministic.
      const score = (s: Shipment) =>
        (invoiced.has(s.id) ? 1e6 : 0) + (validBay(s) ? 1e4 : 0) + STATUS_RANK(s.status) * 100 + filledCount(s);
      const ordered = [...grp].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      const original = ordered[0];
      const donors = ordered.slice(1);
      const keep: Shipment = { ...original };
      const filled: string[] = [];
      const set1 = (f: keyof Shipment, v: unknown) => { (keep as unknown as Record<string, unknown>)[f] = v; filled.push(f); };

      // Slot: a survivor with no bay takes bay + time (+ location) from the best
      // donor that has one, as a unit; otherwise only a missing time/location
      // is taken, and only from a donor on the same bay.
      if (blank(keep.bay)) {
        const d = donors.find(x => !blank(x.bay));
        if (d) {
          set1('bay', d.bay);
          if (!blank(d.time)) set1('time', d.time);
          if (blank(keep.location) && !blank(d.location)) set1('location', d.location);
        }
      } else {
        const sameBay = donors.filter(x => sameText(x.bay, keep.bay));
        if (blank(keep.time)) { const d = sameBay.find(x => !blank(x.time)); if (d) set1('time', d.time); }
        if (blank(keep.location)) { const d = sameBay.find(x => !blank(x.location)); if (d) set1('location', d.location); }
      }
      for (const f of FILL_TEXT) {
        if (!blank(keep[f])) continue;
        const d = donors.find(x => !blank(x[f]));
        if (d) set1(f, d[f]);
      }
      if (!(typeof keep.qty === 'number' && keep.qty > 0)) {
        const d = donors.find(x => typeof x.qty === 'number' && x.qty > 0);
        if (d) set1('qty', d.qty);
      }
      if (!(typeof keep.scaledQty === 'number' && keep.scaledQty > 0)) {
        const d = donors.find(x => typeof x.scaledQty === 'number' && x.scaledQty > 0);
        if (d) set1('scaledQty', d.scaledQty);
      }
      const lots = union([keep.lotNumbers, ...donors.map(x => x.lotNumbers)]);
      if (lots.length > (keep.lotNumbers || []).length) set1('lotNumbers', lots);
      const seals = union([keep.sealNumbers, ...donors.map(x => x.sealNumbers)]);
      if (seals.length > (keep.sealNumbers || []).length) set1('sealNumbers', seals);
      if (maxRank > STATUS_RANK(keep.status) && CANON_STATUS[maxRank]) set1('status', CANON_STATUS[maxRank]);

      plan.groups.push({ key: set.key, bol: original.bol, date: original.date, keep, original, drop: donors, filled });
      plan.dropIds.push(...donors.map(d => d.id));
      if (filled.length) plan.changed.push(keep);
    }
  }
  plan.groups.sort((a, b) => b.date.localeCompare(a.date) || a.bol.localeCompare(b.bol));
  return plan;
}
