import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, Carrier, Location, QAProduct, ShipToLocation } from './types';
import { resolveLineWeights } from './pdfDocHelpers';

interface GenerateBolParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
  shipToCustomer?: Customer;
  shipToLocation?: ShipToLocation; // selected ship-to address (overrides customer's default address)
  qaProducts: QAProduct[];
}

const BLACK = '#141414';
const DARK_GREEN = '#1a5c2e';

// ── Shared helpers matching Order Confirmation style ──

function drawSectionHeader(doc: jsPDF, text: string, x: number, y: number, width: number): number {
  doc.setFillColor(BLACK);
  doc.rect(x, y, width, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + 2, y + 5);
  doc.setTextColor(BLACK);
  return y + 7;
}

function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, width: number, height = 11): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  // Truncate value if it overflows the cell
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

function drawInfoField(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): void {
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

/** Draw the Bill of Lading onto an existing jsPDF `doc` (its current page).
 *  Used both standalone (generateBolPdf) and as one page of the Document Package. */
export function renderBolInto(doc: jsPDF, {
  shipment,
  order,
  customer,
  carrier,
  shipFromLocation,
  shipToLocation,
  qaProducts,
}: GenerateBolParams): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = M;
  const rightCol = M + halfWidth + 2;
  const rightHalf = halfWidth - 2;

  // ═══════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text('Bill of Lading', leftCol, 20);

  // Sucro Canada branding (right)
  doc.setFontSize(16);
  doc.setTextColor(DARK_GREEN);
  doc.text('Sucro Canada', pageWidth - M, 16, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('sucrosourcing.com', pageWidth - M, 21, { align: 'right' });

  // Divider line
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(leftCol, 25, pageWidth - M, 25);

  let y = 32;

  // ═══════════════════════════════════════════════════════════
  // TOP INFO ROW — 4 equal-width fields
  // ═══════════════════════════════════════════════════════════
  const bolNum = shipment.bol || order?.bolNumber || '';
  const fieldW = contentWidth / 4;

  const topFields = [
    { label: 'BOL #', value: bolNum },
    { label: 'Customer PO #', value: order?.po || shipment.po || '' },
    { label: 'Pick Up Date', value: shipment.date || '' },
    { label: 'Delivery Date', value: shipment.deliveryDate || order?.deliveryDate || '' },
  ];

  topFields.forEach((f, i) => {
    drawInfoField(doc, f.label, f.value, leftCol + i * fieldW, y, fieldW);
  });
  y += 14;

  // ═══════════════════════════════════════════════════════════
  // CONSIGNEE (left) & CARRIER (right)
  // ═══════════════════════════════════════════════════════════
  const consigneeHeaderY = y;
  y = drawSectionHeader(doc, 'CONSIGNEE', leftCol, y, halfWidth);

  // Carrier header at same position on right
  drawSectionHeader(doc, 'CARRIER', rightCol, consigneeHeaderY, rightHalf);

  const consigneeName = customer?.name || shipment.customer || '';
  const consigneeAddr = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';
  const consigneeEmail = customer?.contactEmail || '';

  const carrierName = carrier?.name || shipment.carrier || '';
  const carrierTel = carrier?.contactPhone || '';
  const carrierEmail = carrier?.contactEmail || '';

  let cy = y;
  cy = drawFieldRow(doc, 'Name', consigneeName, leftCol, cy, halfWidth);
  cy = drawFieldRow(doc, 'Address', consigneeAddr, leftCol, cy, halfWidth);
  cy = drawFieldRow(doc, 'Email', consigneeEmail, leftCol, cy, halfWidth);

  let ry = y;
  ry = drawFieldRow(doc, 'Name', carrierName, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Tel', carrierTel, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Email', carrierEmail, rightCol, ry, rightHalf);

  y = Math.max(cy, ry) + 3;

  // ═══════════════════════════════════════════════════════════
  // DELIVER TO (left) & SHIPPER (right)
  // ═══════════════════════════════════════════════════════════
  const deliverHeaderY = y;
  y = drawSectionHeader(doc, 'DELIVER TO', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'SHIPPER', rightCol, deliverHeaderY, rightHalf);

  // Prefer the explicitly-selected ship-to location's address when present.
  const deliverToName = shipToLocation?.name
    ? `${customer?.name || shipment.customer || ''} — ${shipToLocation.name}`
    : (customer?.name || shipment.customer || '');
  const deliverToAddr = shipToLocation
    ? [shipToLocation.addressLine1, shipToLocation.addressLine2, shipToLocation.city, shipToLocation.province, shipToLocation.country].filter(Boolean).join(', ')
    : (customer ? [customer.address, customer.city, customer.province].filter(Boolean).join(', ') : '');
  const deliverToPostal = shipToLocation?.postalCode || customer?.postalCode || '';

  // Shipper name prints the location's legal BOL name when set, else its name.
  const shipperName = shipFromLocation?.bolName || shipFromLocation?.name || order?.location || 'Sucro Can Canada';
  const shipperAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province].filter(Boolean).join(', ') : '';
  const shipperPostal = shipFromLocation?.postalCode || '';

  let dy = y;
  dy = drawFieldRow(doc, 'Name', deliverToName, leftCol, dy, halfWidth);
  dy = drawFieldRow(doc, 'Address', deliverToAddr, leftCol, dy, halfWidth);
  dy = drawFieldRow(doc, 'Postal Code', deliverToPostal, leftCol, dy, halfWidth);

  let sy = y;
  sy = drawFieldRow(doc, 'Name', shipperName, rightCol, sy, rightHalf);
  sy = drawFieldRow(doc, 'Address', shipperAddr, rightCol, sy, rightHalf);
  sy = drawFieldRow(doc, 'Postal Code', shipperPostal, rightCol, sy, rightHalf);

  y = Math.max(dy, sy) + 3;

  // ═══════════════════════════════════════════════════════════
  // GOODS SHIPPED TABLE
  // ═══════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, 'GOODS SHIPPED', leftCol, y, contentWidth);

  const lineItemsData: (string | number)[][] = [];
  let totalNetWeight = 0;
  let totalGrossWeight = 0;

  if (order?.lineItems && order.lineItems.length > 0) {
    order.lineItems.forEach(item => {
      // Per-unit net & gross weight, matched on productKey then name, with
      // fallbacks so neither column is blank (gross ≈ net when no tare known).
      const { netWt, grossWt } = resolveLineWeights(item, qaProducts);
      const itemNet = netWt * item.qty;
      const itemGross = grossWt * item.qty;
      totalNetWeight += itemNet;
      totalGrossWeight += itemGross;

      // Description Of Goods = the same product string the order shows
      // (productDisplayName when set, falling back to bare productName).
      const description = item.productDisplayName || item.productName || '';
      lineItemsData.push([
        item.totalWeight ? item.totalWeight.toFixed(2) : '',
        item.qty ? item.qty.toString() : '',
        description,
        itemNet ? itemNet.toFixed(2) : '',
        itemGross ? itemGross.toFixed(2) : '',
      ]);
    });
  } else {
    // No line items — fall back to the order's product field (matches what
    // the order row shows in the Orders table) before the shipment's.
    lineItemsData.push([
      shipment.qty ? shipment.qty.toString() : '',
      '',
      order?.product || shipment.product || '',
      '',
      '',
    ]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Qty (MT)', 'Qty (Units)', 'Description Of Goods', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
    body: lineItemsData,
    foot: [['', '', 'Total', totalNetWeight ? totalNetWeight.toFixed(2) : '', totalGrossWeight ? totalGrossWeight.toFixed(2) : '']],
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.3,
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [20, 20, 20],
      fontStyle: 'bold',
      fontSize: 7,
    },
    footStyles: {
      fillColor: [245, 245, 245],
      textColor: [20, 20, 20],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 22 },
      1: { halign: 'center', cellWidth: 22 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;
  y += 3;

  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 14;

  // Page-break guard: the SHIPMENT DETAILS + SIGNATURES blocks below are drawn at
  // fixed offsets from here with no internal pagination, so a tall goods table
  // (7+ single-line items, or wrapping descriptions) would push the legally
  // relevant signature block off the page bottom. When the fixed block (~76mm
  // through the signatures) won't fit on the physical page, start a fresh page so
  // nothing is clipped. (Threshold is the page edge, not the soft margin, so a
  // BOL that still fits — up to ~6 items — stays on one page.)
  const fixedBlockH = 76;
  if (y + fixedBlockH > pageHeight - 2) {
    doc.addPage();
    y = 20;
  }

  // ═══════════════════════════════════════════════════════════
  // SHIPMENT DETAILS — 3 equal-width fields per row
  // ═══════════════════════════════════════════════════════════
  const thirdW = contentWidth / 3;
  const shippingTerms = order?.shippingTerms || '';
  const freightTerms = shippingTerms === 'FOB' ? 'Prepaid' : (shippingTerms === 'DAP' || shippingTerms === 'DDP') ? 'Collect' : shippingTerms === 'FCA' ? 'Third Party' : '';
  const originOfGoods = shipment.originOfGoods || shipFromLocation?.name || order?.location || '';
  const sealNums = shipment.sealNumbers?.filter(Boolean).join(', ') || '';
  const lotNums = (shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : [])).join(', ');

  drawInfoField(doc, 'Freight Terms', freightTerms, leftCol, y, thirdW);
  drawInfoField(doc, 'Trailer Number', shipment.trailerNo || '', leftCol + thirdW, y, thirdW);
  drawInfoField(doc, 'Seal Number(s)', sealNums, leftCol + thirdW * 2, y, thirdW);
  y += 14;

  drawInfoField(doc, 'Origin of Goods', originOfGoods, leftCol, y, thirdW);
  drawInfoField(doc, 'Lot Code(s)', lotNums, leftCol + thirdW, y, thirdW);
  drawInfoField(doc, 'Colour', shipment.colour || '', leftCol + thirdW * 2, y, thirdW);
  y += 15;

  // ═══════════════════════════════════════════════════════════
  // SIGNATURES — 2 columns
  // ═══════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, 'CONSIGNOR', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'RECEIVED IN GOOD CONDITION', rightCol, y - 7, rightHalf);

  const sigRowH = 10;

  // Consignor side
  let csy = y;
  csy = drawFieldRow(doc, 'Company', 'Sucro Can Canada Inc.', leftCol, csy, halfWidth, sigRowH);
  csy = drawFieldRow(doc, 'Date', shipment.date || '', leftCol, csy, halfWidth, sigRowH);
  csy = drawFieldRow(doc, 'Shipper', shipperName, leftCol, csy, halfWidth, sigRowH);
  csy = drawFieldRow(doc, 'Print Name / Signature', '', leftCol, csy, halfWidth, sigRowH);

  // Receiver side
  let rsy = y;
  rsy = drawFieldRow(doc, 'Carrier', carrierName, rightCol, rsy, rightHalf, sigRowH);
  rsy = drawFieldRow(doc, 'Date', '', rightCol, rsy, rightHalf, sigRowH);
  rsy = drawFieldRow(doc, 'Print Name', '', rightCol, rsy, rightHalf, sigRowH);
  rsy = drawFieldRow(doc, 'Signature', '', rightCol, rsy, rightHalf, sigRowH);

  y = Math.max(csy, rsy) + 5;

  // ═══════════════════════════════════════════════════════════
  // NOTES — clamp height so box stays within page margin
  // ═══════════════════════════════════════════════════════════
  // Clamp to the space actually left on the page (never force a minimum — that
  // pushed the box past the bottom margin and cut the page off). Skip the box
  // entirely when there is no meaningful room left. (pageHeight/bottomMargin
  // declared above the page-break guard.)
  const notesH = Math.max(0, Math.min(18, pageHeight - bottomMargin - y));
  if (notesH >= 6) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text('NOTES', leftCol + 2, y + 3);
    doc.setDrawColor(200, 200, 200);
    doc.rect(leftCol, y, contentWidth, notesH);
    if (shipment.notes) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(BLACK);
      // Clip note lines to the box so long / multi-line notes never spill below
      // the box outline or past the page bottom.
      const lines = doc.splitTextToSize(shipment.notes, contentWidth - 4);
      const lineH = 3.3;
      const first = y + 7;
      const maxLines = Math.max(0, Math.floor((y + notesH - first) / lineH) + 1);
      if (maxLines > 0) doc.text(lines.slice(0, maxLines), leftCol + 2, first);
    }
  }

}

export function generateBolPdf(params: GenerateBolParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderBolInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `BOL_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
