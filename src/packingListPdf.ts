import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, Location, QAProduct, ShipToLocation } from './types';
import { drawDocHeader, drawSectionHeader, drawFieldRow, drawInfoField, drawDocFooter, resolveLineWeights, BLACK } from './pdfDocHelpers';

export interface GeneratePackingListParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  shipFromLocation?: Location;
  shipToLocation?: ShipToLocation;
  qaProducts: QAProduct[];
}

/** Draw a Packing List onto an existing jsPDF `doc` (its current page). */
export function renderPackingListInto(doc: jsPDF, {
  shipment,
  order,
  customer,
  shipFromLocation,
  shipToLocation,
  qaProducts,
}: GeneratePackingListParams): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = M;
  const rightCol = M + halfWidth + 2;
  const rightHalf = halfWidth - 2;

  let y = drawDocHeader(doc, 'Packing List');

  // Top info row — 4 fields
  const bolNum = shipment.bol || order?.bolNumber || '';
  const fieldW = contentWidth / 4;
  [
    { label: 'BOL #', value: bolNum },
    { label: 'Customer PO #', value: order?.po || shipment.po || '' },
    { label: 'Ship Date', value: shipment.date || '' },
    { label: 'Delivery Date', value: shipment.deliveryDate || order?.deliveryDate || '' },
  ].forEach((f, i) => drawInfoField(doc, f.label, f.value, leftCol + i * fieldW, y, fieldW));
  y += 14;

  // Ship To (left) & Ship From (right)
  const headerY = y;
  y = drawSectionHeader(doc, 'SHIP TO', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'SHIP FROM', rightCol, headerY, rightHalf);

  const shipToName = shipToLocation?.name
    ? `${customer?.name || shipment.customer || ''} — ${shipToLocation.name}`
    : (customer?.name || shipment.customer || '');
  const shipToAddr = shipToLocation
    ? [shipToLocation.addressLine1, shipToLocation.addressLine2, shipToLocation.city, shipToLocation.province, shipToLocation.country].filter(Boolean).join(', ')
    : (customer ? [customer.address, customer.city, customer.province].filter(Boolean).join(', ') : '');
  const shipToPostal = shipToLocation?.postalCode || customer?.postalCode || '';

  // Ship From name prints the location's legal BOL name when set, else its name.
  const shipperName = shipFromLocation?.bolName || shipFromLocation?.name || order?.location || 'Sucro Can Canada';
  const shipperAddr = shipFromLocation ? [shipFromLocation.address, shipFromLocation.city, shipFromLocation.province].filter(Boolean).join(', ') : '';
  const shipperPostal = shipFromLocation?.postalCode || '';

  let ly = y;
  ly = drawFieldRow(doc, 'Name', shipToName, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Address', shipToAddr, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Postal Code', shipToPostal, leftCol, ly, halfWidth);

  let ry = y;
  ry = drawFieldRow(doc, 'Name', shipperName, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Address', shipperAddr, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Postal Code', shipperPostal, rightCol, ry, rightHalf);

  y = Math.max(ly, ry) + 3;

  // Package contents table
  y = drawSectionHeader(doc, 'PACKAGE CONTENTS', leftCol, y, contentWidth);

  const rowsData: (string | number)[][] = [];
  let totalNet = 0;
  let totalGross = 0;
  let totalUnits = 0;

  if (order?.lineItems && order.lineItems.length > 0) {
    order.lineItems.forEach(item => {
      // Matched on productKey then name; gross falls back to net when no tare.
      const { netWt, grossWt } = resolveLineWeights(item, qaProducts);
      const itemNet = netWt * item.qty;
      const itemGross = grossWt * item.qty;
      totalNet += itemNet;
      totalGross += itemGross;
      totalUnits += item.qty || 0;
      rowsData.push([
        item.productDisplayName || item.productName || '',
        item.qty ? item.qty.toString() : '',
        item.totalWeight ? item.totalWeight.toFixed(2) : '',
        itemNet ? itemNet.toFixed(2) : '',
        itemGross ? itemGross.toFixed(2) : '',
      ]);
    });
  } else {
    rowsData.push([
      order?.product || shipment.product || '',
      '',
      shipment.qty ? shipment.qty.toString() : '',
      '',
      '',
    ]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Description Of Goods', 'Qty (Units)', 'Qty (MT)', 'Net Weight (Kg)', 'Gross Weight (Kg)']],
    body: rowsData,
    foot: [[
      'Total',
      totalUnits ? totalUnits.toString() : '',
      '',
      totalNet ? totalNet.toFixed(2) : '',
      totalGross ? totalGross.toFixed(2) : '',
    ]],
    styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.3, textColor: [20, 20, 20] },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    footStyles: { fillColor: [245, 245, 245], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 22 },
      2: { halign: 'right', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 30 },
    },
    // Force right alignment on every NUMERIC column across head, body AND foot —
    // columnStyles alone left the "Total" row's figures aligned left.
    didParseCell: (data: any) => {
      if (data.column.index !== 0) data.cell.styles.halign = 'right';
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;
  y += 3;

  // Shipment details
  const thirdW = contentWidth / 3;
  const lotNums = (shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : [])).join(', ');
  drawInfoField(doc, 'Carrier', shipment.carrier || '', leftCol, y, thirdW);
  drawInfoField(doc, 'Trailer Number', shipment.trailerNo || '', leftCol + thirdW, y, thirdW);
  drawInfoField(doc, 'Lot Code(s)', lotNums, leftCol + thirdW * 2, y, thirdW);
  y += 17;

  // Notes box — clamp to the space left on the page (no forced minimum, which
  // could push the box and footer past the bottom margin). Skip when no room.
  const pageHeight = doc.internal.pageSize.getHeight();
  const notesH = Math.max(0, Math.min(20, pageHeight - 14 - y));
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
    y += notesH + 6;
  }

  drawDocFooter(doc, Math.min(y, pageHeight - 8));
}

export function generatePackingListPdf(params: GeneratePackingListParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderPackingListInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `PackingList_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), filename };
}
