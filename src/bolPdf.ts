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

function drawRect(doc: jsPDF, x: number, y: number, w: number, h: number, fill?: readonly number[]) {
  if (fill) {
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.rect(x, y, w, h, 'FD');
  } else {
    doc.rect(x, y, w, h, 'S');
  }
}

function drawBlackHeader(doc: jsPDF, text: string, x: number, y: number, w: number, h = 7): number {
  doc.setFillColor(BLACK);
  doc.rect(x, y, w, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + w / 2, y + h / 2 + 1, { align: 'center' });
  doc.setTextColor(BLACK);
  return y + h;
}

function drawLabelCell(doc: jsPDF, label: string, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(100, 100, 100);
  doc.rect(x, y, w, h, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text(label, x + 2, y + h / 2 + 1);
}

function drawValueCell(doc: jsPDF, value: string, x: number, y: number, w: number, h: number) {
  doc.setDrawColor(100, 100, 100);
  doc.rect(x, y, w, h, 'S');
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
  const rh = 7; // standard row height

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);

  // ═══════════════════════════════════════════════════════════
  // ROWS 1-6: HEADER — "Bill of Lading" + Sucro Canada logo
  // ═══════════════════════════════════════════════════════════
  let y = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text('Bill of Lading', L + halfW * 0.45, y + 8, { align: 'center' });

  // Sucro Canada text (logo placeholder)
  doc.setFontSize(14);
  doc.setTextColor(0, 128, 0);
  doc.text('Sucro Canada', R + halfW * 0.3, y + 5, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('www.sucrocan.com', R + halfW * 0.3, y + 10, { align: 'center' });
  doc.setTextColor(BLACK);

  y += 20;

  // ═══════════════════════════════════════════════════════════
  // ROW 8: BOL # (left) | CUSTOMER PO # (right)
  // ═══════════════════════════════════════════════════════════
  const bolNum = shipment.bol || order?.bolNumber || '';
  const infoRowH = 10;

  drawLabelCell(doc, 'BOL #:', L, y, 30, infoRowH);
  drawValueCell(doc, bolNum, L + 30, y, halfW - 30, infoRowH);
  drawLabelCell(doc, 'CUSTOMER PO #:', R, y, 38, infoRowH);
  drawValueCell(doc, order?.po || shipment.po || '', R + 38, y, halfW - 38, infoRowH);
  y += infoRowH;

  // ═══════════════════════════════════════════════════════════
  // ROW 9: Pick up Date (left) | Delivery Date (right)
  // ═══════════════════════════════════════════════════════════
  drawLabelCell(doc, 'Pick up Date', L, y, 30, infoRowH);
  drawValueCell(doc, shipment.date || '', L + 30, y, halfW - 30, infoRowH);
  drawLabelCell(doc, 'Delivery Date:', R, y, 38, infoRowH);
  drawValueCell(doc, order?.deliveryDate || '', R + 38, y, halfW - 38, infoRowH);
  y += infoRowH + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 11: CONSIGNEE (left header) | CARRIER (right header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'CONSIGNEE:', L, y, halfW);
  drawBlackHeader(doc, 'CARRIER:', R, y, halfW);
  y += 7;

  // Row 12: Consignee Name | Carrier Name
  const consigneeName = customer?.name || shipment.customer || '';
  const carrierName = carrier?.name || shipment.carrier || '';
  drawLabelCell(doc, 'Name:', L, y, 20, rh);
  drawValueCell(doc, consigneeName, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Name:', R, y, 20, rh);
  drawValueCell(doc, carrierName, R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 13: Consignee Address | Carrier Tel
  const consigneeAddr = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';
  drawLabelCell(doc, 'Address:', L, y, 20, rh);
  drawValueCell(doc, consigneeAddr, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Tel:', R, y, 20, rh);
  drawValueCell(doc, carrier?.contactPhone || '', R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 14: Consignee Email | Carrier Email
  drawLabelCell(doc, 'Email:', L, y, 20, rh);
  drawValueCell(doc, customer?.contactEmail || '', L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Email:', R, y, 20, rh);
  drawValueCell(doc, carrier?.contactEmail || '', R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 15: Empty spacer row
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 16: DELIVER TO (left header) | SHIPPER (right header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'DELIVER TO:', L, y, halfW);
  drawBlackHeader(doc, 'SHIPPER:', R, y, halfW);
  y += 7;

  // Row 17: Deliver To Name | Shipper Name
  const deliverToName = customer?.name || shipment.customer || '';
  const shipperName = shipFromLocation?.name || order?.location || 'Sucro Can Canada';
  drawLabelCell(doc, 'Name:', L, y, 20, rh);
  drawValueCell(doc, deliverToName, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Name:', R, y, 20, rh);
  drawValueCell(doc, shipperName, R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 18: Deliver To Address | Shipper Address
  const deliverToAddr = customer ? [customer.address, customer.city, customer.province].filter(Boolean).join(', ') : '';
  const shipperAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province].filter(Boolean).join(', ') : '';
  drawLabelCell(doc, 'Address:', L, y, 20, rh);
  drawValueCell(doc, deliverToAddr, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Address:', R, y, 20, rh);
  drawValueCell(doc, shipperAddr, R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 19: Empty row
  drawRect(doc, L, y, halfW, rh);
  drawRect(doc, R, y, halfW, rh);
  y += rh;

  // Row 20: Postal Code | Postal Code
  const deliverToPostal = customer?.postalCode || '';
  const shipperPostal = shipFromLocation?.postalCode || '';
  drawLabelCell(doc, 'Postal Code', L, y, 25, rh);
  drawValueCell(doc, deliverToPostal, L + 25, y, halfW - 25, rh);
  drawLabelCell(doc, 'Postal Code', R, y, 25, rh);
  drawValueCell(doc, shipperPostal, R + 25, y, halfW - 25, rh);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 21: GOODS SHIPPED (full-width black header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'GOODS SHIPPED:', L, y, W);
  y += 7;

  // ═══════════════════════════════════════════════════════════
  // ROW 22-26: GOODS TABLE
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
        item.qty ? item.qty.toString() : '',
        item.productName || '',
        itemNet ? itemNet.toFixed(2) : '',
        itemGross ? itemGross.toFixed(2) : '',
      ]);
    });
  } else {
    lineItemsData.push([
      shipment.qty ? shipment.qty.toString() : '',
      '',
      shipment.product || '',
      '',
      '',
    ]);
  }

  // Pad to 4 rows minimum
  while (lineItemsData.length < 4) {
    lineItemsData.push(['', '', '', '', '']);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Qty (MT)', 'Qty (Units)', 'Description Of Goods', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
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
      0: { halign: 'center', cellWidth: 28 },
      1: { halign: 'center', cellWidth: 28 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 32 },
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;

  // ═══════════════════════════════════════════════════════════
  // RETURN BLOB URL + FILENAME
  // ═══════════════════════════════════════════════════════════
  const filename = `BOL_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
