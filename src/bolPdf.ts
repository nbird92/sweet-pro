import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, Carrier, Location, QAProduct } from './types';

interface GenerateBolParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
  shipToCustomer?: Customer;
  qaProducts: QAProduct[];
}

// Colors
const BLACK = '#141414';
const RED_BG = [220, 50, 50] as const;
const YELLOW_BG = [255, 255, 150] as const;

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

function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, labelWidth: number, valueWidth: number, h = 6): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(BLACK);
  doc.text(label, x + 1, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(value || '', x + labelWidth + 1, y + 4);
  doc.setDrawColor(150, 150, 150);
  doc.rect(x, y, labelWidth + valueWidth, h);
  return y + h;
}

function drawLabelValueBox(doc: jsPDF, label: string, value: string, x: number, y: number, w: number, h: number, options?: { fillColor?: readonly number[]; valueBold?: boolean; labelSize?: number; valueSize?: number }): void {
  if (options?.fillColor) {
    doc.setFillColor(options.fillColor[0], options.fillColor[1], options.fillColor[2]);
    doc.rect(x, y, w, h, 'F');
  }
  doc.setDrawColor(150, 150, 150);
  doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(options?.labelSize || 7);
  doc.setTextColor(BLACK);
  doc.text(label, x + 1, y + 4);
  doc.setFont('helvetica', options?.valueBold ? 'bold' : 'normal');
  doc.setFontSize(options?.valueSize || 9);
  doc.text(value || '', x + 1, y + h - 2);
}

export function generateBolPdf({
  shipment,
  order,
  customer,
  carrier,
  shipFromLocation,
  shipToCustomer,
  qaProducts,
}: GenerateBolParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = margin;
  const rightCol = margin + halfWidth + 1;
  const rightHalfWidth = halfWidth - 1;

  // ─── HEADER ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(BLACK);
  doc.text('BILL OF LADING', pageWidth / 2, 14, { align: 'center' });

  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(leftCol, 17, pageWidth - margin, 17);

  let y = 20;

  // ─── CARRIER INFO (left) & PICK UP / PO (right) ───
  // Left column: Carrier details
  const carrierName = carrier?.name || shipment.carrier || '';
  const carrierScac = carrier?.carrierNumber || '';
  const carrierTel = carrier?.contactPhone || '';
  const carrierEmail = carrier?.contactEmail || '';

  drawFieldRow(doc, 'CARRIER:', carrierName, leftCol, y, 18, halfWidth - 18);
  // Right: Pick Up Date
  drawLabelValueBox(doc, 'Pick Up Date:', shipment.date || '', rightCol, y, rightHalfWidth, 6);
  y += 6;

  drawFieldRow(doc, 'SCAC:', carrierScac, leftCol, y, 18, halfWidth - 18);
  y += 6;

  drawFieldRow(doc, 'Tel:', carrierTel, leftCol, y, 18, halfWidth - 18);
  // Right: Customer PO # (yellow background)
  drawLabelValueBox(doc, 'CUSTOMER PO #:', order?.po || shipment.po || '', rightCol, y - 6, rightHalfWidth, 12, { fillColor: YELLOW_BG, valueBold: true, labelSize: 9, valueSize: 11 });
  y += 6;

  drawFieldRow(doc, 'email:', carrierEmail, leftCol, y, 18, halfWidth - 18);
  y += 8;

  // ─── SHIP FROM ───
  y = drawSectionHeader(doc, 'SHIP FROM:', leftCol, y, halfWidth);

  const shipFromName = shipFromLocation?.name || order?.location || '';
  const shipFromAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province, shipFromLocation.postalCode].filter(Boolean).join(', ') : '';

  drawFieldRow(doc, 'Name:', shipFromName, leftCol, y, 18, halfWidth - 18);
  y += 6;
  drawFieldRow(doc, 'Address:', shipFromAddr, leftCol, y, 18, halfWidth - 18, 12);
  y += 14;

  // SID# and Trailer/Seal on right
  const sidY = y;
  drawFieldRow(doc, 'SID#:', '', leftCol, y, 18, halfWidth - 18);
  // Trailer Number (red bg)
  drawLabelValueBox(doc, 'Trailer Number:', shipment.trailerNo || '', rightCol, sidY - 14, rightHalfWidth, 8, { fillColor: RED_BG as unknown as readonly number[] });
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('Trailer Number:', rightCol + 1, sidY - 14 + 4);
  doc.setTextColor(BLACK);
  // Seal number(s)
  drawLabelValueBox(doc, 'Seal number(s):', 'See below', rightCol, sidY - 6, rightHalfWidth, 6);
  // Origin of Good
  drawLabelValueBox(doc, 'Origin of Good:', '', rightCol, sidY, rightHalfWidth, 6);

  y += 8;

  // ─── SHIP TO ───
  y = drawSectionHeader(doc, 'SHIP TO:', leftCol, y, halfWidth);
  // Freight Charges Terms on right
  drawLabelValueBox(doc, 'Freight Charges Terms:', '', rightCol, y - 1, rightHalfWidth, 7);

  const shipToName = customer?.name || shipment.customer || '';
  const shipToAddr = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';

  drawFieldRow(doc, 'Name:', shipToName, leftCol, y, 18, halfWidth - 18);
  y += 6;
  drawFieldRow(doc, 'Address:', shipToAddr, leftCol, y, 18, halfWidth - 18, 12);

  // Freight terms checkboxes on right
  const ftY = y - 5;
  const cbSize = 3;
  const freightTerms = order?.shippingTerms || '';
  const cbLabels = ['Prepaid', 'Collect', 'Third Party'];
  const cbX = rightCol;
  const cbW = rightHalfWidth / 3;
  cbLabels.forEach((label, i) => {
    const bx = cbX + i * cbW;
    doc.setDrawColor(150, 150, 150);
    doc.rect(bx, ftY, cbW, 8);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(label, bx + cbSize + 3, ftY + 5);
    // Draw checkbox
    doc.rect(bx + 1, ftY + 2, cbSize, cbSize);
    if (freightTerms.toLowerCase().includes(label.toLowerCase())) {
      doc.setFont('helvetica', 'bold');
      doc.text('X', bx + 1.5, ftY + 4.5);
    }
  });

  y += 14;

  // ─── THIRD PARTY FREIGHT CHARGES BILL TO ───
  y = drawSectionHeader(doc, 'THIRD PARTY FREIGHT CHARGES BILL TO:', leftCol, y, halfWidth);
  // Master Bill of Lading text on right
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Master Bill of Lading: with attached', rightCol + 1, y + 2);
  doc.text('underlying Bills of Lading', rightCol + 1, y + 5.5);
  doc.setDrawColor(150, 150, 150);
  doc.rect(rightCol, y - 7, rightHalfWidth, 14);
  doc.setTextColor(BLACK);

  drawFieldRow(doc, 'Name:', '', leftCol, y, 18, halfWidth - 18);
  y += 6;
  drawFieldRow(doc, 'Address:', '', leftCol, y, 18, halfWidth - 18);
  y += 9;

  // ─── GOODS SHIPPED TABLE ───
  y = drawSectionHeader(doc, 'GOODS SHIPPED:', leftCol, y, contentWidth);

  // Build line items
  const lineItemsData: (string | number)[][] = [];
  let totalNetWeight = 0;
  let totalGrossWeight = 0;

  if (order?.lineItems && order.lineItems.length > 0) {
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
        item.productName || '',
        shipment.lotNumber || item.contractNumber || '',
        itemNetWeight ? itemNetWeight.toFixed(2) : '',
        itemGrossWeight ? itemGrossWeight.toFixed(2) : '',
      ]);
    });
  } else {
    // Single line from shipment data
    lineItemsData.push([
      shipment.qty ? shipment.qty.toString() : '',
      shipment.product || '',
      shipment.lotNumber || '',
      '',
      '',
    ]);
  }

  // Pad to at least 3 rows
  while (lineItemsData.length < 3) {
    lineItemsData.push(['', '', '', '', '']);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Qty (MT)', 'Description Of Goods', 'Lot #', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
    body: lineItemsData,
    styles: {
      fontSize: 8,
      cellPadding: 3,
      lineColor: [150, 150, 150],
      lineWidth: 0.3,
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [20, 20, 20],
      fontStyle: 'bold',
      fontSize: 7,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 25 },
      1: { cellWidth: 'auto' },
      2: { halign: 'center', cellWidth: 25 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;

  // Disclaimer
  y += 2;
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(200, 50, 50);
  doc.text('Please note that the quantity listed on this BoL is an estimate only. Please refer to the included scale ticket for the actual quantity.', pageWidth / 2, y, { align: 'center' });
  doc.setTextColor(BLACK);
  y += 5;

  // ─── SEAL #'s ───
  doc.setFillColor(BLACK);
  doc.rect(margin + halfWidth * 0.4, y, halfWidth * 0.3, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("SEAL #'s", margin + halfWidth * 0.4 + 2, y + 4);
  doc.setTextColor(BLACK);
  y += 7;

  // 3 seal number rows
  for (let i = 0; i < 3; i++) {
    doc.setDrawColor(150, 150, 150);
    doc.rect(margin + halfWidth * 0.3, y, halfWidth * 0.4, 6);
    y += 6;
  }
  y += 4;

  // ─── SENT ALONG WITH SHIPMENT ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Sent along with shipment:', leftCol + 20, y);
  y += 4;
  const sentItems = ['Packing List', 'COA', 'Retain Sample'];
  sentItems.forEach(item => {
    doc.setDrawColor(150, 150, 150);
    doc.rect(leftCol + 20, y, halfWidth - 20, 5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(item, leftCol + 22, y + 3.5);
    // Checkbox
    doc.rect(leftCol + 22 + doc.getTextWidth(item) + 3, y + 0.5, 3.5, 3.5);
    y += 5;
  });

  // Total on the right of last row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Total', rightCol, y - 2);
  const totalVal = totalGrossWeight > 0 ? totalGrossWeight.toFixed(2) : '0.00';
  doc.text(totalVal, pageWidth - margin, y - 2, { align: 'right' });

  y += 3;

  // ─── SPECIAL AGREEMENT ───
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text('Special agreement between Consignor & carrier. Please Advise here:', leftCol, y);
  doc.setDrawColor(150, 150, 150);
  doc.line(leftCol, y + 1, pageWidth - margin, y + 1);
  doc.setTextColor(BLACK);
  y += 8;

  // ─── SIGNATURE SECTION ───
  // Left: Consignor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Consignor:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Sucro Can Canada', leftCol + 22, y);

  // Right: All Goods received
  doc.setFont('helvetica', 'bold');
  doc.text('All Goods received in good condition', rightCol, y);
  y += 5;

  // Signature lines
  doc.setDrawColor(150, 150, 150);
  // Left signature block
  doc.rect(leftCol, y, halfWidth, 8);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('Date:', leftCol + 1, y + 4);
  doc.rect(leftCol, y, halfWidth, 6);
  // Right Date
  doc.text('Date:', rightCol + 1, y + 4);
  doc.rect(rightCol, y, rightHalfWidth, 6);
  y += 6;

  // Empty signature row
  doc.rect(leftCol, y, halfWidth, 6);
  doc.rect(rightCol, y, rightHalfWidth, 6);
  y += 6;

  doc.text('Shipper:', leftCol + 1, y + 4);
  doc.rect(leftCol, y, halfWidth, 6);
  // Right: Carrier signature area
  doc.rect(rightCol, y, rightHalfWidth, 6);
  y += 6;

  doc.rect(leftCol, y, halfWidth, 6);
  doc.rect(rightCol, y, rightHalfWidth, 6);
  y += 6;

  doc.text('Print name:', leftCol + 1, y + 4);
  doc.rect(leftCol, y, halfWidth, 6);
  doc.text('Carrier signature', rightCol + 1, y + 4);
  doc.rect(rightCol, y, rightHalfWidth, 6);
  y += 8;

  // Notes
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(80, 80, 80);
  doc.text('Notes: (please if anything to notify, indicate here)', leftCol, y);
  doc.setTextColor(BLACK);
  y += 5;

  // ─── BOL NUMBER (bottom) ───
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Bill of Lading #', pageWidth / 2 - 20, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  const bolNum = shipment.bol || order?.bolNumber || '';
  doc.text(bolNum, pageWidth / 2 + 20, y + 2);
  doc.setDrawColor(BLACK);
  doc.rect(pageWidth / 2 + 18, y - 2, halfWidth - 20, 8);

  // ─── RETURN BLOB URL + FILENAME ───
  const filename = `BOL_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
