import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// One-page customer Sales Report: header band, four KPI tiles, a 12-month sales
// bar chart and a contract details table. Same jsPDF + autotable pipeline as the
// BOL, so it previews in the shared document viewer and attaches to email.

export interface CustomerReportContract {
  contractNumber: string;
  product: string;
  origin: string;
  active: boolean;
  price: number;        // final price per MT
  currency: string;
  startDate: string;
  endDate: string;
  contractVol: number;
  taken: number;
  remaining: number;
  qtyOnOrder: number;
}

export interface CustomerReportData {
  customer: string;
  customerNumber?: string;
  salesMt: number;
  onOrderMt: number;
  contractCount: number;
  remainingTotal: number;
  /** YYYY-MM → invoiced MT. */
  byMonth: Record<string, number>;
  contracts: CustomerReportContract[];
}

const INK: [number, number, number] = [20, 20, 20];
const GREEN: [number, number, number] = [26, 92, 46];
const MUTED: [number, number, number] = [110, 110, 110];
const PANEL: [number, number, number] = [245, 245, 243];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (n: number, d = 1) => (n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}` : (iso || '—');
};

/** The 12 calendar months ending with the current month, as YYYY-MM keys. */
function last12Months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function sectionTitle(doc: jsPDF, text: string, x: number, y: number, w: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(text.toUpperCase(), x, y);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.6);
  doc.line(x, y + 1.6, x + w, y + 1.6);
  return y + 5;
}

export function renderCustomerReportInto(doc: jsPDF, data: CustomerReportData): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = W - M * 2;

  // ── Header band ──
  doc.setFillColor(...INK);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(...GREEN);
  doc.rect(0, 30, W, 1.4, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SUCRO CANADA  ·  SALES REPORT', M, 10);
  doc.setFontSize(18);
  let name = data.customer || 'Customer';
  while (doc.getTextWidth(name) > CW - 60 && name.length > 4) name = name.slice(0, -2);
  doc.text(name, M, 21);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const generated = `Generated ${fmtDate(new Date().toISOString().slice(0, 10))}`;
  doc.text(generated, W - M, 10, { align: 'right' });
  if (data.customerNumber) doc.text(`Customer # ${data.customerNumber}`, W - M, 21, { align: 'right' });

  // ── Sales summary tiles ──
  let y = 40;
  y = sectionTitle(doc, 'Sales Summary', M, y, CW);
  const tiles: Array<{ label: string; value: string; unit: string }> = [
    { label: 'Sales Volume', value: num(data.salesMt), unit: 'MT invoiced' },
    { label: 'Qty on Order', value: num(data.onOrderMt), unit: 'MT open' },
    { label: 'Active Contracts', value: String(data.contractCount), unit: 'contracts' },
    { label: 'Remaining Balance', value: num(data.remainingTotal), unit: 'MT on contract' },
  ];
  const gap = 4;
  const tw = (CW - gap * 3) / 4;
  const th = 24;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + gap);
    doc.setFillColor(...PANEL);
    doc.roundedRect(x, y, tw, th, 2, 2, 'F');
    doc.setFillColor(...GREEN);
    doc.rect(x, y + 3, 1.2, th - 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(t.label.toUpperCase(), x + 5, y + 7);
    doc.setFontSize(15);
    doc.setTextColor(...INK);
    doc.text(t.value, x + 5, y + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(t.unit, x + 5, y + 21);
  });
  y += th + 10;

  // ── Sales by month (last 12 months) ──
  const months = last12Months();
  const vals = months.map(k => data.byMonth[k] || 0);
  const yearTotal = vals.reduce((s, v) => s + v, 0);
  y = sectionTitle(doc, 'Sales by Month (MT) — Last 12 Months', M, y, CW);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(`12-month total: ${num(yearTotal)} MT`, W - M, y - 6.5, { align: 'right' });

  const chartH = 58;
  const chartTop = y + 2;
  const baseY = chartTop + chartH - 10; // leave room for month labels
  const plotH = chartH - 18;
  doc.setFillColor(...PANEL);
  doc.roundedRect(M, chartTop - 2, CW, chartH + 2, 2, 2, 'F');
  const maxV = Math.max(...vals, 1);
  // Light gridlines at 50% / 100% of the max.
  doc.setDrawColor(215, 215, 210);
  doc.setLineWidth(0.2);
  [0.5, 1].forEach(f => doc.line(M + 4, baseY - plotH * f, M + CW - 4, baseY - plotH * f));
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(M + 4, baseY, M + CW - 4, baseY);
  const slot = (CW - 8) / 12;
  const bw = slot * 0.58;
  vals.forEach((v, i) => {
    const cx = M + 4 + slot * i + slot / 2;
    const h = v > 0 ? Math.max(0.8, (v / maxV) * plotH) : 0;
    if (h > 0) {
      doc.setFillColor(...(i === 11 ? GREEN : INK));
      doc.rect(cx - bw / 2, baseY - h, bw, h, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(...INK);
      doc.text(num(v, v >= 100 ? 0 : 1), cx, baseY - h - 1.5, { align: 'center' });
    }
    const [yy, mm] = months[i].split('-');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(`${MONTHS[parseInt(mm, 10) - 1]} '${yy.slice(2)}`, cx, baseY + 4.5, { align: 'center' });
  });
  y = chartTop + chartH + 10;

  // ── Contract details ──
  y = sectionTitle(doc, 'Contract Details', M, y, CW);
  const footerY = H - 10;
  // Fit on one page: estimate rows that fit, summarise any overflow.
  const rowH = 6.2;
  const maxRows = Math.max(1, Math.floor((footerY - 8 - y - 8) / rowH));
  const rows = data.contracts.slice(0, maxRows);
  const hidden = data.contracts.length - rows.length;
  // Same columns as the customer card's Contracts table.
  const body = rows.map(c => [
    c.contractNumber,
    c.active ? 'Active' : 'Closed',
    c.product,
    c.origin || '—',
    `${c.startDate ? fmtDate(c.startDate) : '—'} – ${c.endDate ? fmtDate(c.endDate) : '—'}`,
    c.price ? `${c.currency ? c.currency + ' ' : ''}${num(c.price, 2)}` : '—',
    num(c.contractVol),
    num(c.taken),
    num(c.qtyOnOrder),
    num(c.remaining),
  ]);
  if (body.length === 0) body.push(['No active contracts', '', '', '', '', '', '', '', '', '']);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Contract #', 'Status', 'Product', 'Origin', 'Term', 'Price', 'Volume (MT)', 'Taken', 'On Order', 'Balance']],
    body,
    styles: { fontSize: 7, cellPadding: 1.6, textColor: INK, lineColor: [225, 225, 220], lineWidth: 0.2 },
    headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles: { fillColor: PANEL },
    columnStyles: {
      0: { fontStyle: 'bold' },
      6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (d: any) => {
      if (d.section === 'head' && [6, 7, 8, 9].includes(d.column.index)) d.cell.styles.halign = 'right';
      // Status pill colour, matching the card table's Active / Closed badge.
      if (d.section === 'body' && d.column.index === 1) {
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.textColor = d.cell.raw === 'Active' ? GREEN : MUTED;
      }
    },
  });
  if (hidden > 0) {
    const endY = (doc as any).lastAutoTable?.finalY || y;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`+ ${hidden} more contract${hidden === 1 ? '' : 's'} not shown`, M, endY + 4);
  }

  // ── Footer ──
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.4);
  doc.line(M, footerY - 4, W - M, footerY - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text('Volumes in metric tonnes (MT). Sales volume is invoiced product; qty on order is open and confirmed orders not yet invoiced.', M, footerY);
  doc.text('Sucro Canada', W - M, footerY, { align: 'right' });
}

export function generateCustomerReportPdf(data: CustomerReportData): { blob: Blob; blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderCustomerReportInto(doc, data);
  const blob = doc.output('blob');
  const filename = `SalesReport_${(data.customer || 'Customer').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  return { blob, blobUrl: URL.createObjectURL(blob), filename };
}
