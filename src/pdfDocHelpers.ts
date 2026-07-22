import jsPDF from 'jspdf';
import type { OrderLineItem, QAProduct } from './types';

// Shared drawing primitives + palette for the logistics document generators
// (Packing List, Bag ID Report, Scale Ticket, and the combined Document Package).
// These mirror the look of the existing BOL / COA / Order Confirmation PDFs.

export const BLACK = '#141414';
export const DARK_GREEN = '#1a5c2e';

/** Resolve a line item's QA catalog product. Matches on the stable productKey
 *  (QA product id, then SKU id) before falling back to the display name — the
 *  name match alone misses when several QA variants share an SKU name or when a
 *  weight prefix has been appended. */
export function resolveLineQaProduct(
  item: { productKey?: string; productName?: string },
  qaProducts: QAProduct[],
): QAProduct | undefined {
  const key = (item.productKey || '').trim();
  if (key) {
    // Exact QA-product id is the precise match.
    const byId = qaProducts.find(p => p.id === key);
    if (byId) return byId;
    // A bare SKU id (unpaired-SKU line) doesn't say WHICH variant; only trust it
    // when exactly one QA product carries that skuId. Otherwise fall through to
    // the name match so we don't arbitrarily pick the first of several children.
    const bySku = qaProducts.filter(p => p.skuId === key);
    if (bySku.length === 1) return bySku[0];
  }
  const name = (item.productName || '').trim();
  return name ? qaProducts.find(p => p.skuName === name) : undefined;
}

/** Per-unit net & gross weight in KILOGRAMS for a line item, with fallbacks so
 *  neither column ends up blank on the BOL / Packing List: net → QA net (kg) →
 *  derived from the line's total weight; gross → QA gross (kg) → net (no tare
 *  known, so gross ≈ net).
 *
 *  Do NOT fall back to OrderLineItem.netWeightPerUnit directly: it is stored in
 *  METRIC TONS per unit on the scan/manual/invoice paths (App.tsx buildScanLineItem
 *  divides kg by 1000) but in KILOGRAMS on the Google-sheet sync path — a
 *  dual-convention field. OrderLineItem.totalWeight, by contrast, is reliably
 *  metric tons on every path (it's the "Qty (MT)" column), so per-unit kg =
 *  totalWeight × 1000 / qty is unit-safe for both conventions. */
export function resolveLineWeights(
  item: OrderLineItem,
  qaProducts: QAProduct[],
): { netWt: number; grossWt: number } {
  const qa = resolveLineQaProduct(item, qaProducts);
  const derivedPerUnitKg = (item.qty > 0 && item.totalWeight > 0)
    ? (item.totalWeight * 1000) / item.qty
    : 0;
  const netWt = qa?.netWeightKg || derivedPerUnitKg;
  const grossWt = qa?.grossWeightKg || netWt;
  return { netWt, grossWt };
}

/** Filled black band with white bold caption. Returns the y just below it. */
export function drawSectionHeader(doc: jsPDF, text: string, x: number, y: number, width: number): number {
  doc.setFillColor(BLACK);
  doc.rect(x, y, width, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + 2, y + 5);
  doc.setTextColor(BLACK);
  return y + 7;
}

/** Bordered label/value cell (label on top, value below). Returns y + height.
 *
 *  The value baseline SCALES with the row height instead of being pinned at y+10.
 *  Pinned, a 10mm signature row put the baseline exactly on the bottom rule, so
 *  descenders (and visually the whole value) were clipped by the border. Keep at
 *  least ~2.5mm of clearance beneath the baseline, and never rise so high that the
 *  value collides with the label above it. */
export function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, width: number, height = 13): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y + 4.2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  const maxWidth = width - 4;
  let displayValue = value || '';
  while (doc.getTextWidth(displayValue) > maxWidth && displayValue.length > 0) {
    displayValue = displayValue.slice(0, -1);
  }
  doc.text(displayValue, x + 2, y + Math.max(7.8, height - 2.5));
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y, width, height);
  return y + height;
}

/** Compact info field used in the top rows (label above value, thin box). */
export function drawInfoField(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(BLACK);
  doc.text(value || '—', x + 2, y + 5.5);
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y - 3.5, width, 12);
}

/** Standard document header: big title (left), Sucro Canada branding (right),
 *  divider line. Returns the y at which body content should start. */
export function drawDocHeader(doc: jsPDF, title: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text(title, M, 20);

  doc.setFontSize(16);
  doc.setTextColor(DARK_GREEN);
  doc.text('Sucro Canada', pageWidth - M, 16, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('sucrosourcing.com', pageWidth - M, 21, { align: 'right' });

  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(M, 25, pageWidth - M, 25);
  return 32;
}

/** Italic centred footer line. */
export function drawDocFooter(doc: jsPDF, y: number): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Sucro Can Canada Inc. | Hamilton Sherman Plant | sucrosourcing.com', pageWidth / 2, y, { align: 'center' });
}
