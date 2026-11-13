import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { drawSectionHeader, drawFieldRow } from './pdfDocHelpers';

/** Values for the Pro Forma Invoice page — mirrors the tokens of the
 *  "Pro Forma Invoice" template in the QA Templates table. */
export interface ProFormaData {
  invoiceNo: string;
  contractNo: string;
  invoiceDate: string;
  reference: string;          // customer PO
  shipperName: string;
  shipperAddress: string;
  shipperCityProvince: string;
  consigneeName: string;
  consigneeTel: string;
  consigneeEmail: string;
  bolDate: string;
  currency: string;
  lines: Array<{ description: string; contract: string; units: string; unitPrice: string; tax: string; amount: string }>;
  totalAmount: string;        // formatted, e.g. "$28,088.55"
  totalInWords: string;
  /** The template's text BELOW the goods table (banking details, payment
   *  reference / terms, terms & conditions, signature block), read from the
   *  template sheet at run time with its tokens already filled. Kept out of the
   *  code on purpose — it carries banking details. Empty when the sheet can't
   *  be read (the page then shows a note instead). */
  footerLines: string[];
  /** Logo for the top-right corner (data URL) — '' for none. */
  logoDataUrl?: string;
}

const BLACK = '#141414';

/** Draw the Pro Forma Invoice onto the current page of `doc` (one page). */
export function renderProFormaInto(doc: jsPDF, d: ProFormaData): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const half = (contentWidth - 6) / 2;
  const leftCol = M;
  const rightCol = M + half + 6;

  // Title (left two-thirds) + logo (top-right block, like the template's W1:AF6).
  const logoBoxW = 58, logoBoxH = 16;
  const logoBoxX = pageWidth - M - logoBoxW, logoBoxY = 4;
  let hasLogo = false;
  if (d.logoDataUrl) {
    try {
      const props = doc.getImageProperties(d.logoDataUrl);
      const k = Math.min(logoBoxW / props.width, logoBoxH / props.height);
      const w = props.width * k, h = props.height * k;
      // Contain-fit, right-aligned and vertically centred in the logo block.
      doc.addImage(d.logoDataUrl, (props.fileType || 'PNG') as any, logoBoxX + (logoBoxW - w), logoBoxY + (logoBoxH - h) / 2, w, h);
      hasLogo = true;
    } catch (e) {
      console.warn('Pro forma logo could not be drawn:', e);
    }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(BLACK);
  if (hasLogo) doc.text('Pro Forma Invoice', M, 18);
  else doc.text('Pro Forma Invoice', pageWidth / 2, 18, { align: 'center' });
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(M, 22, pageWidth - M, 22);
  let y = 26;

  // Invoice / contract / date / reference
  let ly = drawFieldRow(doc, 'Invoice No.', d.invoiceNo, leftCol, y, half, 11);
  ly = drawFieldRow(doc, 'Invoice Date', d.invoiceDate, leftCol, ly, half, 11);
  let ry = drawFieldRow(doc, 'Contract No.', d.contractNo, rightCol, y, half, 11);
  ry = drawFieldRow(doc, 'Reference', d.reference, rightCol, ry, half, 11);
  y = Math.max(ly, ry) + 3;

  // Shipper (left) / Consignee (right)
  drawSectionHeader(doc, 'SHIPPER', leftCol, y, half);
  drawSectionHeader(doc, 'CONSIGNEE', rightCol, y, half);
  y += 7;
  ly = drawFieldRow(doc, 'Name', d.shipperName, leftCol, y, half, 11);
  ly = drawFieldRow(doc, 'Address', d.shipperAddress, leftCol, ly, half, 11);
  ly = drawFieldRow(doc, 'City, Province', d.shipperCityProvince, leftCol, ly, half, 11);
  ly = drawFieldRow(doc, 'BOL Date', d.bolDate, leftCol, ly, half, 11);
  ry = drawFieldRow(doc, 'Name', d.consigneeName, rightCol, y, half, 11);
  ry = drawFieldRow(doc, 'Tel', d.consigneeTel, rightCol, ry, half, 11);
  ry = drawFieldRow(doc, 'Email', d.consigneeEmail, rightCol, ry, half, 11);
  y = Math.max(ly, ry) + 4;

  // Goods shipped
  y = drawSectionHeader(doc, 'GOODS SHIPPED', leftCol, y, contentWidth);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Description Of Goods', 'Contract #', 'Qty (Units)', 'Unit Price', 'Tax', 'Amount']],
    body: d.lines.length ? d.lines.map(l => [l.description, l.contract, l.units, l.unitPrice, l.tax, l.amount]) : [['', '', '', '', '', '']],
    foot: [[{ content: 'TOTAL INVOICE VALUE DUE TO Sucro Can Sourcing LLC (Trading)', colSpan: 4, styles: { halign: 'left' } }, d.currency, d.totalAmount]],
    styles: { fontSize: 8, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.3, textColor: [20, 20, 20] },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [245, 245, 243], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  });
  y = ((doc as any).lastAutoTable?.finalY ?? y) + 4;

  // Amount in words
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(BLACK);
  const words = doc.splitTextToSize(d.totalInWords, contentWidth);
  doc.text(words, leftCol, y + 3);
  y += words.length * 4 + 5;

  // The template's own footer text (banking / terms / signature), line by line.
  if (!d.footerLines.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(170, 30, 30);
    const note = doc.splitTextToSize('Banking details and terms could not be read from the Pro Forma Invoice template — share the template sheet with the app\'s service account (Viewer) so they print here.', contentWidth);
    doc.text(note, leftCol, y);
    return;
  }
  for (const raw of d.footerLines) {
    const line = raw.trim();
    if (!line) { y += 2; continue; }
    // Section-style lines ("Banking Details") get a band like the rest of the page.
    if (/^banking details$/i.test(line)) {
      y = drawSectionHeader(doc, line.toUpperCase(), leftCol, y, contentWidth) + 4;
      continue;
    }
    const isLabel = /^(payment terms|payment due on|reference)\b/i.test(line);
    const isFine = line.length > 140; // long legal paragraphs
    doc.setFont('helvetica', isLabel ? 'bold' : 'normal');
    doc.setFontSize(isFine ? 7 : 8);
    doc.setTextColor(isFine ? 90 : 20, isFine ? 90 : 20, isFine ? 90 : 20);
    const wrapped = doc.splitTextToSize(line, contentWidth - 2);
    const lh = isFine ? 3.2 : 3.8;
    if (y + wrapped.length * lh > pageHeight - 8) break; // stay on one page
    doc.text(wrapped, leftCol + 1, y);
    y += wrapped.length * lh + 0.6;
  }
}
