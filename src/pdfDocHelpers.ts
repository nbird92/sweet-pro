import jsPDF from 'jspdf';

// Shared drawing primitives + palette for the logistics document generators
// (Packing List, Bag ID Report, Scale Ticket, and the combined Document Package).
// These mirror the look of the existing BOL / COA / Order Confirmation PDFs.

export const BLACK = '#141414';
export const DARK_GREEN = '#1a5c2e';

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

/** Bordered label/value cell (label on top, value below). Returns y + height. */
export function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, width: number, height = 13): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  const maxWidth = width - 4;
  let displayValue = value || '';
  while (doc.getTextWidth(displayValue) > maxWidth && displayValue.length > 0) {
    displayValue = displayValue.slice(0, -1);
  }
  doc.text(displayValue, x + 2, y + 10);
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
