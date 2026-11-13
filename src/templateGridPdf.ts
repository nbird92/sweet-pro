import jsPDF from 'jspdf';

// Draw a document from its TEMPLATE GRID (api/template-grid) — the template
// sheet's cells, merges, sizes, borders, fills and fonts — with {{tokens}}
// filled. Instant (no server round trip at print time) and laid out like the
// template, so template edits show after the app reloads its template cache.

type Rgb = [number, number, number];
interface Border { s: string; w: number; c: Rgb }
export interface GridCell {
  r: number; c: number;
  t?: string; n?: boolean; bg?: Rgb;
  b?: { t?: Border; r?: Border; b?: Border; l?: Border };
  f?: { b?: boolean; i?: boolean; u?: boolean; s?: number; c?: Rgb; fam?: string };
  h?: string; v?: string; w?: string;
}
export interface TemplateGrid {
  title?: string;
  rows: number[];   // pixel heights
  cols: number[];   // pixel widths
  merges: Array<{ r0: number; r1: number; c0: number; c1: number }>;
  cells: GridCell[];
}

export interface TemplateFill {
  /** Scalar {{token}} values (case-insensitive keys). */
  tokens: Record<string, string>;
  /** Line items: each written into a copy of the template's item row. Keys are
   *  the item_ field names (description, units, …) or the extra itemTokens. */
  items?: Array<Record<string, string>>;
  /** Extra per-row tokens without the item_ prefix (e.g. Invoice_line_Amount). */
  itemTokens?: string[];
  /** Repeated tokens filled one value per occurrence, column by column
   *  (e.g. bag_lot_number → bags 1-20 down the left, 21-40 down the right). */
  sequences?: Record<string, string[]>;
  /** Cells whose text equals one of these get an "X " mark (checkbox labels such
   *  as "Prepaid" / "Shipping"). */
  marks?: string[];
  /** Logo drawn into the largest empty block at the top right, if any. */
  logoDataUrl?: string;
}

const PX_MM = 25.4 / 96;
const lower = (s: string) => s.toLowerCase();

/** Draw `grid` filled with `fill` onto the current page of `doc`, fitted to the
 *  page width (and shrunk to fit the height when needed). */
export function renderTemplateGridInto(doc: jsPDF, grid: TemplateGrid, fill: TemplateFill): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12.7;

  const tokenMap = new Map<string, string>();
  for (const [k, v] of Object.entries(fill.tokens || {})) tokenMap.set(lower(k), v ?? '');
  const itemTokenSet = new Set((fill.itemTokens || []).map(lower));
  const items = fill.items || [];
  const markSet = new Set((fill.marks || []).map(m => lower(m.trim())));
  const isCheckbox = (cell?: GridCell) => !!cell?.t && /^(TRUE|FALSE)$/.test(cell.t.trim());

  const cellAt = new Map<string, GridCell>();
  for (const c of grid.cells) cellAt.set(`${c.r},${c.c}`, c);

  // ── Line items: find the template item rows and build the output row list ──
  const itemFieldOf = (text: string): string | null => {
    const m = text.match(/\{\{\s*item_(\w+)\s*\}\}/i);
    if (m) return m[1];
    const t = text.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
    return t && itemTokenSet.has(lower(t[1])) ? t[1] : null;
  };
  const templateItemRows: number[] = [];
  for (let r = 0; r < grid.rows.length; r++) {
    if (grid.cells.some(c => c.r === r && c.t && itemFieldOf(c.t))) templateItemRows.push(r);
  }
  // Consecutive item rows starting at the first one form the item block.
  const block: number[] = [];
  if (templateItemRows.length) {
    let r = templateItemRows[0];
    while (templateItemRows.includes(r)) { block.push(r); r++; }
  }
  type OutRow = { src: number; item: number | null };
  const outRows: OutRow[] = [];
  if (block.length) {
    const first = block[0], last = block[block.length - 1];
    for (let r = 0; r < first; r++) outRows.push({ src: r, item: null });
    const n = Math.max(items.length, block.length);
    for (let i = 0; i < n; i++) outRows.push({ src: block[Math.min(i, block.length - 1)], item: i < items.length ? i : -1 });
    for (let r = last + 1; r < grid.rows.length; r++) outRows.push({ src: r, item: null });
  } else {
    for (let r = 0; r < grid.rows.length; r++) outRows.push({ src: r, item: null });
  }

  // ── Sequences: assign values to occurrences column by column ──
  const seqValue = new Map<string, string>(); // "outRow,col" -> value
  for (const [tok, values] of Object.entries(fill.sequences || {})) {
    const occ: Array<{ o: number; c: number }> = [];
    outRows.forEach((row, o) => {
      for (const cell of grid.cells) {
        if (cell.r === row.src && cell.t && new RegExp(`\\{\\{\\s*${tok}\\s*\\}\\}`, 'i').test(cell.t)) occ.push({ o, c: cell.c });
      }
    });
    occ.sort((a, b) => a.c - b.c || a.o - b.o);
    occ.forEach((x, i) => seqValue.set(`${x.o},${x.c}`, values[i] ?? ''));
  }

  // ── Geometry ──
  const totalWpx = grid.cols.reduce((a, b) => a + b, 0) || 1;
  const totalHpx = outRows.reduce((a, r) => a + (grid.rows[r.src] || 21), 0) || 1;
  let k = (pageW - margin * 2) / (totalWpx * PX_MM);
  const maxH = pageH - margin * 2;
  if (totalHpx * PX_MM * k > maxH) k = maxH / (totalHpx * PX_MM);
  const mm = (px: number) => px * PX_MM * k;
  const colX: number[] = [margin];
  for (const w of grid.cols) colX.push(colX[colX.length - 1] + mm(w));
  const rowY: number[] = [margin];
  for (const r of outRows) rowY.push(rowY[rowY.length - 1] + mm(grid.rows[r.src] || 21));

  // Merges, re-indexed onto output rows (a merge inside one template row is
  // repeated for every output row built from it).
  type OutMerge = { o0: number; o1: number; c0: number; c1: number };
  const outMerges: OutMerge[] = [];
  for (const m of grid.merges) {
    const os: number[] = [];
    outRows.forEach((row, o) => { if (row.src >= m.r0 && row.src < m.r1) os.push(o); });
    if (!os.length) continue;
    if (m.r1 - m.r0 === 1) { for (const o of os) outMerges.push({ o0: o, o1: o + 1, c0: m.c0, c1: m.c1 }); }
    else outMerges.push({ o0: Math.min(...os), o1: Math.max(...os) + 1, c0: m.c0, c1: m.c1 });
  }
  const mergeAt = new Map<string, OutMerge>();
  const covered = new Set<string>();
  for (const m of outMerges) {
    mergeAt.set(`${m.o0},${m.c0}`, m);
    for (let o = m.o0; o < m.o1; o++) for (let c = m.c0; c < m.c1; c++) if (o !== m.o0 || c !== m.c0) covered.add(`${o},${c}`);
  }
  const rectOf = (o: number, c: number) => {
    const m = mergeAt.get(`${o},${c}`);
    const o1 = m ? m.o1 : o + 1, c1 = m ? m.c1 : c + 1;
    return { x: colX[c], y: rowY[o], w: colX[Math.min(c1, grid.cols.length)] - colX[c], h: rowY[Math.min(o1, outRows.length)] - rowY[o] };
  };

  // The checkbox that belongs to a label. A row's boxes sit consistently either
  // BEFORE their labels ("☐ Shipping") or AFTER them ("Prepaid ☐"); which one
  // is read from the row — before when its first box precedes its first label.
  const checkboxLeftOf = (o: number, c: number): GridCell | undefined => {
    const src = outRows[o].src;
    const rowCells = grid.cells.filter(x => x.r === src && x.t && x.t.trim()).sort((a, b) => a.c - b.c);
    const firstBox = rowCells.find(x => isCheckbox(x));
    if (!firstBox) return undefined;
    const firstText = rowCells.find(x => !isCheckbox(x));
    const before = !firstText || firstBox.c < firstText.c;
    const step = before ? -1 : 1;
    for (let cc = c + step, n = 0; n < 4 && cc >= 0 && cc < grid.cols.length; cc += step, n++) {
      const nb = cellAt.get(`${src},${cc}`);
      if (isCheckbox(nb)) return nb;
      if (nb?.t && nb.t.trim()) return undefined;
    }
    return undefined;
  };
  // Checkbox cells ticked: TRUE in the sheet, or the label to their right is a mark.
  const checkedBoxes = new Set<string>();
  outRows.forEach((row, o) => {
    for (const cell of grid.cells) {
      if (cell.r !== row.src || !cell.t) continue;
      if (isCheckbox(cell) && cell.t.trim() === 'TRUE') checkedBoxes.add(`${o},${cell.c}`);
      if (markSet.has(lower(cell.t.replace(/\{\{[^}]*\}\}/g, '').trim()))) {
        const cb = checkboxLeftOf(o, cell.c);
        if (cb) checkedBoxes.add(`${o},${cb.c}`);
      }
    }
  });

  // Text for one output cell, tokens filled.
  const textFor = (o: number, cell: GridCell): string => {
    if (isCheckbox(cell)) return '';
    let t = cell.t || '';
    const row = outRows[o];
    if (row.item !== null) {
      const it = row.item >= 0 ? items[row.item] : undefined;
      t = t.replace(/\{\{\s*item_(\w+)\s*\}\}/gi, (_m, f) => (it ? (it[f] ?? it[lower(f)] ?? '') : ''));
      // Any other token in an item row: the item's own value when it has one
      // (by name, case-insensitive), else fall through to the scalar tokens.
      const itemVal = (key: string): string | undefined => {
        if (!it) return itemTokenSet.has(lower(key)) ? '' : undefined;
        const hit = Object.keys(it).find(x => lower(x) === lower(key));
        return hit !== undefined ? (it[hit] ?? '') : (itemTokenSet.has(lower(key)) ? '' : undefined);
      };
      t = t.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m0, key) => itemVal(String(key).trim()) ?? m0);
    }
    const sv = seqValue.get(`${o},${cell.c}`);
    if (sv !== undefined) t = t.replace(/\{\{\s*[^{}]+?\s*\}\}/, sv);
    t = t.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, key) => tokenMap.get(lower(String(key).trim())) ?? '');
    if (markSet.has(lower(t.trim())) && !checkboxLeftOf(o, cell.c)) t = `X  ${t.trim()}`;
    return t.replace(/\t+/g, ' ').replace(/[ ]{3,}/g, '  ').replace(/\s+$/g, '');
  };

  // ── 1. Backgrounds ──
  outRows.forEach((row, o) => {
    for (let c = 0; c < grid.cols.length; c++) {
      if (covered.has(`${o},${c}`)) continue;
      const cell = cellAt.get(`${row.src},${c}`);
      if (!cell?.bg) continue;
      const r = rectOf(o, c);
      doc.setFillColor(cell.bg[0], cell.bg[1], cell.bg[2]);
      doc.rect(r.x, r.y, r.w, r.h, 'F');
    }
  });

  // ── 2. Borders (every cell edge, including cells inside merges) ──
  const drawEdge = (bd: Border | undefined, x1: number, y1: number, x2: number, y2: number) => {
    if (!bd) return;
    const base = bd.s === 'SOLID_THICK' ? 3 : bd.s === 'SOLID_MEDIUM' ? 2 : 1;
    const lw = Math.max(0.12, mm(base) * 0.9);
    doc.setDrawColor(bd.c[0], bd.c[1], bd.c[2]);
    doc.setLineWidth(lw);
    if (bd.s === 'DOTTED') doc.setLineDashPattern([0.4, 0.6], 0);
    else if (bd.s === 'DASHED') doc.setLineDashPattern([1.5, 1], 0);
    if (bd.s === 'DOUBLE') {
      const off = Math.max(0.35, lw * 1.5);
      const vertical = x1 === x2;
      doc.line(x1 - (vertical ? off / 2 : 0), y1 - (vertical ? 0 : off / 2), x2 - (vertical ? off / 2 : 0), y2 - (vertical ? 0 : off / 2));
      doc.line(x1 + (vertical ? off / 2 : 0), y1 + (vertical ? 0 : off / 2), x2 + (vertical ? off / 2 : 0), y2 + (vertical ? 0 : off / 2));
    } else {
      doc.line(x1, y1, x2, y2);
    }
    doc.setLineDashPattern([], 0);
  };
  // As in Sheets: a merged cell's borders are its top-left cell's, drawn around
  // the whole merged area; cells hidden inside a merge draw none of their own.
  outRows.forEach((row, o) => {
    for (let c = 0; c < grid.cols.length; c++) {
      if (covered.has(`${o},${c}`)) continue;
      const cell = cellAt.get(`${row.src},${c}`);
      if (!cell?.b) continue;
      const rr = rectOf(o, c);
      const x0 = rr.x, x1 = rr.x + rr.w, y0 = rr.y, y1 = rr.y + rr.h;
      drawEdge(cell.b.t, x0, y0, x1, y0);
      drawEdge(cell.b.b, x0, y1, x1, y1);
      drawEdge(cell.b.l, x0, y0, x0, y1);
      drawEdge(cell.b.r, x1, y0, x1, y1);
    }
  });

  // ── 2b. Checkboxes (Sheets checkbox cells) ──
  outRows.forEach((row, o) => {
    for (let c = 0; c < grid.cols.length; c++) {
      if (covered.has(`${o},${c}`)) continue;
      const cell = cellAt.get(`${row.src},${c}`);
      if (!isCheckbox(cell)) continue;
      const r = rectOf(o, c);
      const size = Math.min(r.h * 0.6, r.w * 0.6, 4);
      const x = r.x + (r.w - size) / 2, y = r.y + (r.h - size) / 2;
      doc.setDrawColor(60, 60, 60); doc.setLineWidth(0.3);
      doc.rect(x, y, size, size);
      if (checkedBoxes.has(`${o},${c}`)) {
        doc.setLineWidth(0.45); doc.setDrawColor(0, 0, 0);
        doc.line(x + size * 0.2, y + size * 0.2, x + size * 0.8, y + size * 0.8);
        doc.line(x + size * 0.8, y + size * 0.2, x + size * 0.2, y + size * 0.8);
      }
    }
  });

  // ── 3. Logo: the largest EMPTY merged block in the top rows, right half ──
  if (fill.logoDataUrl) {
    const half = colX[0] + (colX[colX.length - 1] - colX[0]) / 2;
    const candidates = outMerges.filter(m => m.o0 <= 2 && colX[m.c0] >= half - 1
      && !(cellAt.get(`${outRows[m.o0].src},${m.c0}`)?.t || '').trim());
    const best = candidates.map(m => ({ m, r: rectOf(m.o0, m.c0) })).sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h)[0];
    // Only a block big enough to be a logo area (else the template has none).
    if (best && best.r.w >= 25 && best.r.h >= 10) {
      try {
        const props = doc.getImageProperties(fill.logoDataUrl);
        const pad = 1.2;
        const bw = best.r.w - pad * 2, bh = best.r.h - pad * 2;
        const s = Math.min(bw / props.width, bh / props.height);
        const w = props.width * s, h = props.height * s;
        doc.addImage(fill.logoDataUrl, (props.fileType || 'PNG') as any, best.r.x + pad + (bw - w) / 2, best.r.y + pad + (bh - h) / 2, w, h);
      } catch { /* bad image — skip */ }
    }
  }

  // ── 4. Text ──
  outRows.forEach((row, o) => {
    for (let c = 0; c < grid.cols.length; c++) {
      if (covered.has(`${o},${c}`)) continue;
      const cell = cellAt.get(`${row.src},${c}`);
      if (!cell?.t) continue;
      const text = textFor(o, cell);
      if (!text.trim()) continue;
      const r = rectOf(o, c);
      const f = cell.f || {};
      const fam = /times|serif/i.test(f.fam || '') && !/sans/i.test(f.fam || '') ? 'times' : /courier|mono/i.test(f.fam || '') ? 'courier' : 'helvetica';
      const style = f.b && f.i ? 'bolditalic' : f.b ? 'bold' : f.i ? 'italic' : 'normal';
      doc.setFont(fam, style);
      doc.setFontSize(Math.max(4, (f.s || 10) * k));
      const col = f.c || [0, 0, 0];
      doc.setTextColor(col[0], col[1], col[2]);
      const padX = mm(3);
      const h = cell.h || (cell.n ? 'RIGHT' : 'LEFT');
      const v = cell.v || 'BOTTOM';
      const lineH = doc.getFontSize() * 0.3528 * 1.15;
      let lines: string[];
      if (cell.w === 'WRAP') lines = doc.splitTextToSize(text, Math.max(1, r.w - padX * 2));
      else {
        lines = text.split(/\r?\n/);
        // Overflowing text stops at the next non-empty cell to its right (as in
        // Sheets); CLIP stops at its own edge.
        if (h === 'LEFT') {
          const endC = mergeAt.get(`${o},${c}`)?.c1 ?? c + 1;
          let limitC = grid.cols.length;
          if (cell.w === 'CLIP') limitC = endC;
          else for (let cc = endC; cc < grid.cols.length; cc++) {
            const nb = cellAt.get(`${row.src},${cc}`);
            if (nb?.t && (isCheckbox(nb) || textFor(o, nb).trim())) { limitC = cc; break; }
          }
          const maxW = colX[limitC] - (r.x + padX) - mm(2);
          lines = lines.map(ln => {
            if (doc.getTextWidth(ln) <= maxW) return ln;
            let cut = ln;
            while (cut.length > 1 && doc.getTextWidth(cut) > maxW) cut = cut.slice(0, -1);
            return cut;
          });
        }
      }
      const blockH = lines.length * lineH;
      let y: number;
      if (v === 'TOP') y = r.y + lineH * 0.85 + mm(2);
      else if (v === 'MIDDLE') y = r.y + (r.h - blockH) / 2 + lineH * 0.8;
      else y = r.y + r.h - blockH + lineH * 0.8 - mm(3);
      const x = h === 'CENTER' ? r.x + r.w / 2 : h === 'RIGHT' ? r.x + r.w - padX : r.x + padX;
      const align = h === 'CENTER' ? 'center' : h === 'RIGHT' ? 'right' : 'left';
      for (const ln of lines) {
        doc.text(ln, x, y, { align: align as any });
        if (f.u) {
          const tw = doc.getTextWidth(ln);
          const ux = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
          doc.setLineWidth(0.15); doc.setDrawColor(col[0], col[1], col[2]);
          doc.line(ux, y + 0.5, ux + tw, y + 0.5);
        }
        y += lineH;
      }
    }
  });
}
