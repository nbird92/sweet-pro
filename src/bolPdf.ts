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
  drawValueCell(doc, shipment.deliveryDate || order?.deliveryDate || '', R + 38, y, halfW - 38, infoRowH);
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

  // Row 11: Consignee Address | Carrier Tel
  const consigneeAddr = customer ? [customer.address, customer.city, customer.province, customer.postalCode].filter(Boolean).join(', ') : '';
  drawLabelCell(doc, 'Address:', L, y, 20, rh);
  drawValueCell(doc, consigneeAddr, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Tel:', R, y, 20, rh);
  drawValueCell(doc, carrier?.contactPhone || '', R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 12: Consignee Email | Carrier Email
  drawLabelCell(doc, 'Email:', L, y, 20, rh);
  drawValueCell(doc, customer?.contactEmail || '', L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Email:', R, y, 20, rh);
  drawValueCell(doc, carrier?.contactEmail || '', R + 20, y, halfW - 20, rh);
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

  // Row 15: Deliver To Address | Shipper Address
  const deliverToAddr = customer ? [customer.address, customer.city, customer.province].filter(Boolean).join(', ') : '';
  const shipperAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province].filter(Boolean).join(', ') : '';
  drawLabelCell(doc, 'Address:', L, y, 20, rh);
  drawValueCell(doc, deliverToAddr, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Address:', R, y, 20, rh);
  drawValueCell(doc, shipperAddr, R + 20, y, halfW - 20, rh);
  y += rh;

  // Row 16: Postal Code | Postal Code
  const deliverToPostal = customer?.postalCode || '';
  const shipperPostal = shipFromLocation?.postalCode || '';
  drawLabelCell(doc, 'Postal Code', L, y, 20, rh);
  drawValueCell(doc, deliverToPostal, L + 20, y, halfW - 20, rh);
  drawLabelCell(doc, 'Postal Code', R, y, 20, rh);
  drawValueCell(doc, shipperPostal, R + 20, y, halfW - 20, rh);
  y += rh + 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 21: GOODS SHIPPED (full-width black header)
  // ═══════════════════════════════════════════════════════════
  drawBlackHeader(doc, 'GOODS SHIPPED:', L, y, W);
  y += 7;

  // ═══════════════════════════════════════════════════════════
  // ROW 22-34: GOODS TABLE
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
        item.qty ? item.qty.toString() : '',
        itemNet ? itemNet.toFixed(2) : '',
        itemGross ? itemGross.toFixed(2) : '',
      ]);
    });
  } else {
    lineItemsData.push([
      shipment.qty ? shipment.qty.toString() : '',
      shipment.product || '',
      '',
      '',
      '',
    ]);
  }

  // Pad to minimum rows
  while (lineItemsData.length < 10) {
    lineItemsData.push(['', '', '', '', '']);
  }

  // Add Total row — "Total" in the Qty (Units) column to match template
  lineItemsData.push([
    '', '', 'Total',
    totalNetWeight ? totalNetWeight.toFixed(2) : '0',
    totalGrossWeight ? totalGrossWeight.toFixed(2) : '0',
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Qty (MT)', 'Description Of Goods', 'Qty (Units)', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
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
      3: { halign: 'right', cellWidth: 34 },
      4: { halign: 'right', cellWidth: 37 },
    },
    didParseCell: (data) => {
      // Bold the Total row
      if (data.row.index === lineItemsData.length - 1) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;
  y += 2;

  // ═══════════════════════════════════════════════════════════
  // ROW 31: Separator bar
  // ═══════════════════════════════════════════════════════════
  doc.setFillColor(BLACK);
  doc.rect(L, y, W, 1.5, 'F');
  y += 3;

  // ═══════════════════════════════════════════════════════════
  // FOOTER ROWS: Uniform label widths for column alignment
  // ═══════════════════════════════════════════════════════════
  const lbl = 28;  // uniform left label width
  const rlbl = 34; // uniform right label width
  const cbSize = 3.5; // checkbox size
  const sigH = 7;

  // ROW 32: Freight Terms (left) | Trailer Number (right)
  const shippingTerms = order?.shippingTerms || '';
  const ftOptW = (halfW - lbl) / 3;
  drawLabelCell(doc, 'Freight Terms:', L, y, lbl, rh);
  // Prepaid option + checkbox
  drawRect(doc, L + lbl, y, ftOptW, rh);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(BLACK);
  doc.text('Prepaid', L + lbl + 2, y + rh / 2 + 1);
  doc.rect(L + lbl + ftOptW - cbSize - 3, y + (rh - cbSize) / 2, cbSize, cbSize, 'S');
  if (shippingTerms === 'FOB') { doc.setFont('helvetica', 'bold'); doc.text('X', L + lbl + ftOptW - cbSize - 3 + 0.6, y + (rh + cbSize) / 2 - 0.3); }
  // Collect option + checkbox
  drawRect(doc, L + lbl + ftOptW, y, ftOptW, rh);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('Collect', L + lbl + ftOptW + 2, y + rh / 2 + 1);
  doc.rect(L + lbl + ftOptW * 2 - cbSize - 3, y + (rh - cbSize) / 2, cbSize, cbSize, 'S');
  if (shippingTerms === 'DAP' || shippingTerms === 'DDP') { doc.setFont('helvetica', 'bold'); doc.text('X', L + lbl + ftOptW * 2 - cbSize - 3 + 0.6, y + (rh + cbSize) / 2 - 0.3); }
  // Third Party option + checkbox
  drawRect(doc, L + lbl + ftOptW * 2, y, ftOptW, rh);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('Third Party', L + lbl + ftOptW * 2 + 2, y + rh / 2 + 1);
  doc.rect(L + lbl + ftOptW * 3 - cbSize - 3, y + (rh - cbSize) / 2, cbSize, cbSize, 'S');
  if (shippingTerms === 'FCA') { doc.setFont('helvetica', 'bold'); doc.text('X', L + lbl + ftOptW * 3 - cbSize - 3 + 0.6, y + (rh + cbSize) / 2 - 0.3); }
  // Trailer Number on right
  drawLabelCell(doc, 'Trailer Number:', R, y, rlbl, rh);
  drawValueCell(doc, shipment.trailerNo || '', R + rlbl, y, halfW - rlbl, rh);
  y += rh;

  // ROW 33: Origin of Good | Seal number(s)
  const originOfGoods = shipment.originOfGoods || shipFromLocation?.name || order?.location || '';
  const sealNums = shipment.sealNumbers?.filter(Boolean).join(', ') || '';
  drawLabelCell(doc, 'Origin of Good:', L, y, lbl, rh);
  drawValueCell(doc, originOfGoods, L + lbl, y, halfW - lbl, rh);
  drawLabelCell(doc, 'Seal number(s):', R, y, rlbl, rh);
  drawValueCell(doc, sealNums, R + rlbl, y, halfW - rlbl, rh);
  y += rh;

  // ROW 34: Empty
  drawRect(doc, L, y, W, rh);
  y += rh + 2;

  // ROW 35: Consignor | Sucro Can Canada Inc. | All Goods received in good condition
  drawLabelCell(doc, 'Consignor:', L, y, lbl, sigH);
  drawValueCell(doc, 'Sucro Can Canada Inc.', L + lbl, y, halfW - lbl, sigH);
  drawLabelCell(doc, '', R, y, rlbl, sigH);
  drawRect(doc, R, y, halfW, sigH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text('All Goods received in good condition', R + 2, y + sigH / 2 + 1);
  y += sigH;

  // ROW 36: Date | Date
  drawLabelCell(doc, 'Date:', L, y, lbl, sigH);
  drawValueCell(doc, shipment.date || '', L + lbl, y, halfW - lbl, sigH);
  drawLabelCell(doc, 'Date:', R, y, rlbl, sigH);
  drawValueCell(doc, shipment.date || '', R + rlbl, y, halfW - rlbl, sigH);
  y += sigH;

  // ROW 37: Shipper | Carrier name
  const shipperSigName = shipFromLocation?.name || order?.location || 'Sucro Can Canada';
  drawLabelCell(doc, 'Shipper:', L, y, lbl, sigH);
  drawValueCell(doc, shipperSigName, L + lbl, y, halfW - lbl, sigH);
  drawLabelCell(doc, 'Carrier name:', R, y, rlbl, sigH);
  drawValueCell(doc, carrierName, R + rlbl, y, halfW - rlbl, sigH);
  y += sigH;

  // ROW 38: Print name | Carrier signature
  drawLabelCell(doc, 'Print name:', L, y, lbl, sigH);
  drawValueCell(doc, '', L + lbl, y, halfW - lbl, sigH);
  drawLabelCell(doc, 'Carrier signature:', R, y, rlbl, sigH);
  drawValueCell(doc, '', R + rlbl, y, halfW - rlbl, sigH);
  y += sigH + 4;

  // ═══════════════════════════════════════════════════════════
  // ROW 39: Special agreement text
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Special agreement between Consignor & carrier. Please Advise here:', L, y + 4);
  y += 6;
  drawRect(doc, L, y, W, rh * 2);
  y += rh * 2 + 4;

  // ═══════════════════════════════════════════════════════════
  // ROW 40: Notes text
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Please incate any notes here:', L, y + 4);
  y += 6;
  drawRect(doc, L, y, W, rh * 2);
  y += rh * 2;

  // ═══════════════════════════════════════════════════════════
  // RETURN BLOB URL + FILENAME
  // ═══════════════════════════════════════════════════════════
  const filename = `BOL_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
