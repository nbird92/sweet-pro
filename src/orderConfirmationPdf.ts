import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Order, Customer, Carrier, Location, QAProduct, SKU } from './types';

interface GenerateOrderConfirmationParams {
  order: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipperLocation?: Location;
  qaProducts: QAProduct[];
  skus: SKU[];
}

// Colors
const BLACK = '#141414';
const DARK_GREEN = '#1a5c2e';
const RED = '#c0392b';

function drawSectionHeader(doc: jsPDF, text: string, y: number, width: number): number {
  doc.setFillColor(BLACK);
  doc.rect(14, y, width, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(text, 16, y + 5);
  doc.setTextColor(BLACK);
  return y + 7;
}

function drawLabelValue(doc: jsPDF, label: string, value: string, x: number, y: number, labelWidth = 28): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text(value || '—', x + labelWidth, y);
}

function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(label, x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text(value || '', x + 2, y + 10);
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y, width, 13);
  return y + 13;
}

export function generateOrderConfirmationPdf({
  order,
  customer,
  carrier,
  shipperLocation,
  qaProducts,
  skus,
}: GenerateOrderConfirmationParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 28; // 14mm margins
  const halfWidth = contentWidth / 2;
  const leftCol = 14;
  const rightCol = 14 + halfWidth + 2;

  // ─── HEADER ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text('Order Confirmation', leftCol, 20);

  // Sucro Canada branding (right side)
  doc.setFontSize(16);
  doc.setTextColor(DARK_GREEN);
  doc.text('Sucro Canada', pageWidth - 14, 16, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('sucrosourcing.com', pageWidth - 14, 21, { align: 'right' });

  // Divider line
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(leftCol, 25, pageWidth - 14, 25);

  let y = 32;

  // ─── ORDER INFO ROW ───
  const orderFields = [
    { label: 'Order Entry Date', value: order.date || '' },
    { label: 'Customer PO #', value: order.po || '' },
    { label: 'Pick Up Date', value: order.shipmentDate || '' },
    { label: 'Delivery Date', value: order.deliveryDate || '' },
  ];

  const fieldWidth = contentWidth / 4;
  orderFields.forEach((f, i) => {
    const x = leftCol + i * fieldWidth;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 100, 100);
    doc.text(f.label.toUpperCase(), x + 2, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(BLACK);
    doc.text(f.value || '—', x + 2, y + 5.5);
    doc.setDrawColor(200, 200, 200);
    doc.rect(x, y - 3.5, fieldWidth, 12);
  });

  y += 14;

  // ─── CONSIGNEE & CARRIER ───
  // Left: Consignee
  y = drawSectionHeader(doc, 'CONSIGNEE', y, halfWidth);
  const consigneeName = customer?.name || order.customer || '';
  const consigneeAddress = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';
  const consigneeEmail = customer?.contactEmail || customer?.salesContactEmail || '';

  let cy = y;
  cy = drawFieldRow(doc, 'Name:', consigneeName, leftCol, cy, halfWidth);
  cy = drawFieldRow(doc, 'Address:', consigneeAddress, leftCol, cy, halfWidth);
  cy = drawFieldRow(doc, 'Email:', consigneeEmail, leftCol, cy, halfWidth);

  // Right: Carrier
  let ry = drawSectionHeader(doc, 'CARRIER', y - 7, halfWidth);
  // Adjust: carrier header is at same y as consignee header
  ry = y; // align with consignee rows
  const carrierName = carrier?.name || order.carrier || '';
  const carrierTel = carrier?.contactPhone || '';
  const carrierEmail = carrier?.contactEmail || '';

  ry = drawFieldRow(doc, 'Name:', carrierName, rightCol, ry, halfWidth);
  ry = drawFieldRow(doc, 'Tel:', carrierTel, rightCol, ry, halfWidth);
  ry = drawFieldRow(doc, 'Email:', carrierEmail, rightCol, ry, halfWidth);

  // Re-draw the carrier header at the correct position
  drawSectionHeader(doc, 'CARRIER', y - 7, halfWidth);
  // Move the carrier section header to the right
  doc.setFillColor(BLACK);
  doc.rect(rightCol, y - 7, halfWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('CARRIER', rightCol + 2, y - 2);
  doc.setTextColor(BLACK);

  y = Math.max(cy, ry) + 3;

  // ─── DELIVER TO & SHIPPER ───
  y = drawSectionHeader(doc, 'DELIVER TO', y, halfWidth);
  // Right: Shipper header
  doc.setFillColor(BLACK);
  doc.rect(rightCol, y - 7, halfWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text('SHIPPER', rightCol + 2, y - 2);
  doc.setTextColor(BLACK);

  const deliverToName = customer?.name || order.customer || '';
  const deliverToAddr = customer?.address || '';
  const deliverToCityProv = customer ? [customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';

  let dy = y;
  dy = drawFieldRow(doc, 'Name:', deliverToName, leftCol, dy, halfWidth);
  dy = drawFieldRow(doc, 'Address:', deliverToAddr, leftCol, dy, halfWidth);
  dy = drawFieldRow(doc, 'Address:', deliverToCityProv, leftCol, dy, halfWidth);

  const shipperName = shipperLocation?.name || order.location || '';
  const shipperAddr = shipperLocation ? [shipperLocation.address, shipperLocation.city, shipperLocation.province, shipperLocation.postalCode].filter(Boolean).join(', ') : '';

  let sy = y;
  sy = drawFieldRow(doc, 'Name:', shipperName, rightCol, sy, halfWidth);
  sy = drawFieldRow(doc, 'Address:', shipperAddr, rightCol, sy, halfWidth);

  y = Math.max(dy, sy) + 3;

  // ─── GOODS SHIPPED TABLE ───
  y = drawSectionHeader(doc, 'GOODS SHIPPED', y, contentWidth);

  // Build line items data
  const lineItemsData: (string | number)[][] = [];
  let totalNetWeight = 0;
  let totalGrossWeight = 0;

  order.lineItems.forEach(item => {
    const qaProduct = qaProducts.find(p => p.skuName === item.productName);
    const netWeightKg = qaProduct?.netWeightKg || item.netWeightPerUnit || 0;
    const grossWeightKg = qaProduct?.grossWeightKg || 0;

    const itemNetWeight = netWeightKg * item.qty;
    const itemGrossWeight = grossWeightKg * item.qty;

    totalNetWeight += itemNetWeight;
    totalGrossWeight += itemGrossWeight;

    lineItemsData.push([
      item.totalWeight ? item.totalWeight.toFixed(2) : '',
      item.qty.toString(),
      item.productName || '',
      itemNetWeight ? itemNetWeight.toFixed(2) : '',
      itemGrossWeight ? itemGrossWeight.toFixed(2) : '',
    ]);
  });

  autoTable(doc, {
    startY: y,
    margin: { left: leftCol, right: 14 },
    head: [['Qty (MT)', 'Qty (Units)', 'Description Of Goods', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
    body: lineItemsData,
    foot: [['', '', 'Total', totalNetWeight ? totalNetWeight.toFixed(2) : '', totalGrossWeight ? totalGrossWeight.toFixed(2) : '']],
    styles: {
      fontSize: 8,
      cellPadding: 3,
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
    // Add empty rows to fill at least 8 rows for consistent look
    didParseCell: (data) => {
      // Nothing extra needed
    },
  });

  // Get the Y position after the table
  y = (doc as any).lastAutoTable?.finalY || y + 60;

  // Pad with empty rows if fewer than 8 line items
  // (already handled by the table)

  y += 6;

  // ─── FOOTER ───
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('Sucro Canada confirms conformation of this order.', leftCol, y);

  // Bill of Lading #
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(BLACK);
  doc.text('Bill of Lading #', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(order.bolNumber || '', rightCol + 32, y);

  // Draw a box around the BOL
  doc.setDrawColor(200, 200, 200);
  doc.rect(rightCol + 30, y - 4, halfWidth - 32, 7);

  // ─── RETURN BLOB URL + FILENAME ───
  const filename = `Order_Confirmation_${order.bolNumber || 'draft'}_${order.customer?.replace(/[^a-zA-Z0-9]/g, '_') || 'customer'}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
