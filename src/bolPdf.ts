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

const BLACK = '#141414';
const YELLOW = [255, 255, 200] as const;
const RED_BG = [220, 40, 40] as const;
const LIGHT_GRAY = [240, 240, 240] as const;

function drawRect(doc: jsPDF, x: number, y: number, w: number, h: number, fill?: readonly number[]) {
  if (fill) {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(x, y, w, h, 'FD');
  } else {
    doc.rect(x, y, w, h, 'S');
  }
}

function drawBlackHeader(doc: jsPDF, text: string, x: number, y: number, w: number, h = 6): number {
  doc.setFillColor(BLACK);
  doc.rect(x, y, w, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + w / 2, y + h / 2 + 1, { align: 'center' });
  doc.setTextColor(BLACK);
  return y + h;
}

function drawLabelCell(doc: jsPDF, label: string, x: number, y: number, w: number, h: number, fill?: readonly number[]) {
  doc.setDrawColor(100, 100, 100);
  if (fill) {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(x, y, w, h, 'FD');
  } else {
    doc.rect(x, y, w, h, 'S');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(label, x + 2, y + h / 2 + 1);
}

function drawValueCell(doc: jsPDF, value: string, x: number, y: number, w: number, h: number, fill?: readonly number[]) {
  doc.setDrawColor(100, 100, 100);
  if (fill) {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(x, y, w, h, 'FD');
  } else {
    doc.rect(x, y, w, h, 'S');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text(value || '', x + 2, y + h / 2 + 1);
}

export function generateBolPdf({
  shipment,
  order,
  customer,
  carrier,
  shipFromLocation,
  qaProducts,
}: GenerateBolParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 12; // margin
  const W = pageWidth - M * 2; // content width
  const halfW = W / 2;
  const L = M; // left edge
  const R = M + halfW; // right column start
  const rh = 6; // standard row height

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);

  // ═══════════════════════════════════════════════════════════
  // ROW 1-5: HEADER — "BILL OF LADING" + Sucro Canada logo
  // ═══════════════════════════════════════════════════════════
  let y = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text('BILL OF LADING', L + halfW * 0.45, y + 6, { align: 'center' });

  // Sucro Canada text (logo placeholder)
  doc.setFontSize(14);
  doc.setTextColor(0, 128, 0);
  doc.text('Sucro Canada', R + halfW * 0.3, y + 4, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('www.sucrocan.com', R + halfW * 0.3, y + 8, { align: 'center' });
  doc.setTextColor(BLACK);

  y += 16;

  // ═══════════════════════════════════════════════════════════
  // ROW 7: Pick Up Date (left, yellow) | CUSTOMER PO # (right, yellow)
  // ═══════════════════════════════════════════════════════════
  const dateRowH = 10;
  // Pick Up Date label
  drawLabelCell(doc, 'Pick Up Date:', L, y, 30, dateRowH, YELLOW);
  drawValueCell(doc, shipment.date || '', L + 30, y, halfW - 30, dateRowH, YELLOW);
  // Customer PO #
  drawLabelCell(doc, 'CUSTOMER PO #:', R, y, 35, dateRowH, YELLOW);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  drawValueCell(doc, order?.po || shipment.po || '', R + 35, y, halfW - 35, dateRowH, YELLOW);
  y += dateRowH + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 9: SHIP FROM (left header) | SHIP TO (right header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'SHIP FROM:', L, y, halfW);
  drawBlackHeader(doc, 'SHIP TO:', R, y, halfW);
  y += 6;

  // Row 10: Ship From Name | Ship To Name
  const shipFromName = shipFromLocation?.name || order?.location || '';
  const shipToName = customer?.name || shipment.customer || '';
  drawLabelCell(doc, 'Name:', L, y, 18, rh);
  drawValueCell(doc, shipFromName, L + 18, y, halfW - 18, rh);
  drawLabelCell(doc, 'Name:', R, y, 18, rh);
  drawValueCell(doc, shipToName, R + 18, y, halfW - 18, rh);
  y += rh;

  // Row 11: Ship From Address | Ship To Address
  const shipFromAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province, shipFromLocation.postalCode].filter(Boolean).join(', ') : '';
  const shipToAddr = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';
  drawLabelCell(doc, 'Address:', L, y, 18, rh * 2);
  drawValueCell(doc, shipFromAddr, L + 18, y, halfW - 18, rh * 2);
  drawLabelCell(doc, 'Address:', R, y, 18, rh * 2);
  drawValueCell(doc, shipToAddr, R + 18, y, halfW - 18, rh * 2);
  y += rh * 2;

  // Row 13: SID#
  drawLabelCell(doc, 'SID#:', L, y, 18, rh);
  drawValueCell(doc, '', L + 18, y, W - 18, rh);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 14: CARRIER (left header) | THIRD PARTY FREIGHT CHARGES BILL TO (right header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'CARRIER:', L, y, halfW);
  drawBlackHeader(doc, 'THIRD PARTY FREIGHT CHARGES BILL TO:', R, y, halfW);
  y += 6;

  // Row 15: Carrier Name | 3rd Party Name
  const carrierName = carrier?.name || shipment.carrier || '';
  drawLabelCell(doc, 'Name:', L, y, 18, rh);
  drawValueCell(doc, carrierName, L + 18, y, halfW - 18, rh);
  drawLabelCell(doc, 'Name:', R, y, 18, rh);
  drawValueCell(doc, '', R + 18, y, halfW - 18, rh);
  y += rh;

  // Row 16: SCAC | 3rd Party Address
  drawLabelCell(doc, 'SCAC:', L, y, 18, rh);
  drawValueCell(doc, carrier?.carrierNumber || '', L + 18, y, halfW - 18, rh);
  drawLabelCell(doc, 'Address:', R, y, 18, rh);
  drawValueCell(doc, '', R + 18, y, halfW - 18, rh);
  y += rh;

  // Row 17: Tel
  drawLabelCell(doc, 'Tel:', L, y, 18, rh);
  drawValueCell(doc, carrier?.contactPhone || '', L + 18, y, halfW - 18, rh);
  // Right side empty
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Row 18: Email
  drawLabelCell(doc, 'Email:', L, y, 18, rh);
  drawValueCell(doc, carrier?.contactEmail || '', L + 18, y, halfW - 18, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // ═══════════════════════════════════════════════════════════
  // ROW 19-20: Freight Charges Terms + checkboxes
  // ═══════════════════════════════════════════════════════════
  // Row 19: Freight Charges Terms label (right side)
  drawRect(doc, L, y, halfW, rh);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Freight Charges Terms:', R + 2, y + 4);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Row 20: Trailer Number (left) | Prepaid | Collect | Third Party | X (right)
  drawLabelCell(doc, 'Trailer Number:', L, y, 30, rh);
  drawValueCell(doc, shipment.trailerNo || '', L + 30, y, halfW - 30, rh);

  const freightTerms = order?.shippingTerms || '';
  const cbLabels = ['Prepaid', 'Collect', 'Third Party'];
  const cbW = halfW / 4;
  cbLabels.forEach((label, i) => {
    const bx = R + i * cbW;
    drawRect(doc, bx, y, cbW, rh);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(label, bx + 2, y + 4);
  });
  // X column
  const xCol = R + 3 * cbW;
  drawRect(doc, xCol, y, cbW, rh);
  // Check the matching one
  const freightLower = freightTerms.toLowerCase();
  if (freightLower.includes('prepaid')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('X', R + cbW * 0.4, y + 4.5);
  } else if (freightLower.includes('collect')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('X', R + cbW + cbW * 0.4, y + 4.5);
  } else if (freightLower.includes('third')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('X', R + cbW * 2 + cbW * 0.4, y + 4.5);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('X', xCol + cbW * 0.4, y + 4.5);
  }
  y += rh;

  // Row 21: Origin of Good (left) | Master BOL checkbox (right)
  drawLabelCell(doc, 'Origin of Good:', L, y, 30, rh);
  drawValueCell(doc, '', L + 30, y, halfW - 30, rh);
  // Checkbox + Master Bill text
  drawRect(doc, R, y, halfW, rh * 2);
  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(BLACK);
  // Checkbox symbol
  doc.setFontSize(10);
  doc.text('☑', R + 8, y + 5);
  doc.setFontSize(6);
  doc.text('Master Bill of Lading: with attached underlying', R + 14, y + 4);
  doc.text('Bills of Lading', R + 14, y + 8);
  y += rh;

  // Row 23: Seal number(s) | Check Box label
  drawLabelCell(doc, 'Seal number(s):', L, y, 30, rh);
  drawValueCell(doc, 'See below', L + 30, y, halfW - 30, rh);
  // "Check Box" label on right
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.text('Check Box', R + 8, y + 4);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 25: GOODS SHIPPED TABLE
  // ═══════════════════════════════════════════════════════════
  const lineItemsData: (string | number)[][] = [];
  let totalNetWeight = 0;
  let totalGrossWeight = 0;

  if (order?.lineItems && order.lineItems.length > 0) {
    order.lineItems.forEach(item => {
      const qaProduct = qaProducts.find(p => p.skuName === item.productName);
      const netWt = qaProduct?.netWeightKg || item.netWeightPerUnit || 0;
      const grossWt = qaProduct?.grossWeightKg || 0;
      const itemNet = netWt * item.qty;
      const itemGross = grossWt * item.qty;
      totalNetWeight += itemNet;
      totalGrossWeight += itemGross;

      lineItemsData.push([
        item.totalWeight ? item.totalWeight.toFixed(2) : '',
        item.productName || '',
        shipment.lotNumber || item.contractNumber || '',
        itemNet ? itemNet.toFixed(2) : '',
        itemGross ? itemGross.toFixed(2) : '',
      ]);
    });
  } else {
    lineItemsData.push([
      shipment.qty ? shipment.qty.toString() : '',
      shipment.product || '',
      shipment.lotNumber || '',
      '',
      '',
    ]);
  }

  // Pad to 3 rows minimum
  while (lineItemsData.length < 3) {
    lineItemsData.push(['', '', '', '', '']);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Qty (MT)', 'Description Of Goods', 'Lot #', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
    body: lineItemsData,
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      lineColor: [100, 100, 100],
      lineWidth: 0.3,
      textColor: [20, 20, 20],
    },
    headStyles: {
      fillColor: [20, 20, 20],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 25 },
      1: { cellWidth: 'auto' },
      2: { halign: 'center', cellWidth: 25 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 32 },
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 30;
  y += 1;

  // ═══════════════════════════════════════════════════════════
  // ROW 28-29: DISCLAIMER (red text)
  // ═══════════════════════════════════════════════════════════
  doc.setFillColor(255, 255, 230);
  doc.rect(L, y, W, 8, 'F');
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(200, 0, 0);
  doc.text('Please note that the quantity listed on this BoL is an estimate only. Please refer to the included scale ticket for the actual', pageWidth / 2, y + 3, { align: 'center' });
  doc.text('quantity.', pageWidth / 2, y + 6.5, { align: 'center' });
  doc.setTextColor(BLACK);
  y += 10;

  // ═══════════════════════════════════════════════════════════
  // ROW 30: SEAL #'s HEADER
  // ═══════════════════════════════════════════════════════════
  const sealHeaderW = 30;
  const sealX = L + halfW - sealHeaderW / 2;
  drawBlackHeader(doc, "SEAL #'s", sealX, y, sealHeaderW);
  // Empty cells beside it
  drawRect(doc, L, y, halfW - sealHeaderW / 2, 6);
  drawRect(doc, sealX + sealHeaderW, y, W - halfW - sealHeaderW / 2, 6);
  y += 6;

  // Rows 31-34: Seal # entry rows (with red fill cells)
  for (let i = 0; i < 4; i++) {
    drawRect(doc, L, y, halfW - 15, rh);
    drawRect(doc, L + halfW - 15, y, 30, rh, i < 2 ? RED_BG : undefined);
    drawRect(doc, L + halfW + 15, y, halfW - 15, rh);
    y += rh;
  }

  // Rows 35-40: Empty bordered rows
  for (let i = 0; i < 6; i++) {
    drawRect(doc, L, y, halfW, rh);
    drawRect(doc, R, y, halfW, rh);
    y += rh;
  }

  // ═══════════════════════════════════════════════════════════
  // ROW 41-44: SENT ALONG WITH SHIPMENT + TOTAL
  // ═══════════════════════════════════════════════════════════
  // Row 41: Sent along header
  drawRect(doc, L, y, W, rh);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Sent along with shipment:', L + 25, y + 4);
  y += rh;

  // Row 42: Packing List
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Packing List', L + 25, y + 4);
  y += rh;

  // Row 43: COA
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  doc.text('COA', L + 25, y + 4);
  y += rh;

  // Row 44: Retain Sample + Total
  drawRect(doc, L, y, halfW, rh);
  doc.text('Retain Sample', L + 25, y + 4);
  // Total label
  doc.setFont('helvetica', 'bold');
  doc.text('Total', R + 10, y + 4);
  // Total value (red background)
  const totalValStr = totalGrossWeight > 0 ? totalGrossWeight.toFixed(2) : '0.00';
  const totalCellW = 30;
  drawRect(doc, L + W - totalCellW, y, totalCellW, rh, RED_BG);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text(totalValStr, L + W - 2, y + 4, { align: 'right' });
  doc.setTextColor(BLACK);
  drawRect(doc, R, y, halfW, rh);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 45: SPECIAL AGREEMENT
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Special agreement between Consignor & carrier. Please Advise here:', L, y + 3);
  doc.setDrawColor(100, 100, 100);
  doc.line(L, y + 5, L + W, y + 5);
  y += 8;

  // ═══════════════════════════════════════════════════════════
  // ROW 47: CONSIGNOR + ALL GOODS RECEIVED
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Consignor:', L, y + 3);
  doc.setFont('helvetica', 'normal');
  doc.text('Sucro Can Canada', L + 40, y + 3);
  doc.setFont('helvetica', 'bold');
  doc.text('All Goods received in good condition', R + 5, y + 3);
  y += 6;

  // Signature line (empty box)
  drawRect(doc, L, y, halfW, 6);
  drawRect(doc, R, y, halfW, 6);
  y += 6;

  // Row 49: Date: | Date:
  drawLabelCell(doc, 'Date:', L, y, 15, rh);
  drawRect(doc, L + 15, y, halfW - 15, rh);
  drawLabelCell(doc, 'Date:', R, y, 15, rh);
  drawRect(doc, R + 15, y, halfW - 15, rh);
  y += rh;

  // Empty row
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Row 51: Shipper:
  drawLabelCell(doc, 'Shipper:', L, y, 18, rh);
  drawRect(doc, L + 18, y, halfW - 18, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Empty row
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Row 53: Print name: | Carrier signature
  drawLabelCell(doc, 'Print name:', L, y, 22, rh);
  drawRect(doc, L + 22, y, halfW - 22, rh);
  drawLabelCell(doc, 'Carrier signature', R, y, 30, rh);
  drawRect(doc, R + 30, y, halfW - 30, rh);
  y += rh + 2;

  // Row 54: Notes
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Notes: (please if anything to notify, indicate here)', L, y + 3);
  y += 7;

  // ═══════════════════════════════════════════════════════════
  // ROW 55: BILL OF LADING # (bottom)
  // ═══════════════════════════════════════════════════════════
  const bolNum = shipment.bol || order?.bolNumber || '';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Bill of Lading #', R - 5, y + 4, { align: 'right' });
  // Value box
  drawRect(doc, R, y - 1, halfW, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text(bolNum, R + 3, y + 4);

  // ═══════════════════════════════════════════════════════════
  // RETURN BLOB URL + FILENAME
  // ═══════════════════════════════════════════════════════════
  const filename = `BOL_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
