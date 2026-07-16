import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, LotCode, QAProduct } from './types';
import { drawDocHeader, drawSectionHeader, drawFieldRow, drawInfoField, drawDocFooter } from './pdfDocHelpers';

export interface GenerateBagIdReportParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  lotCodes: LotCode[];
  qaProducts: QAProduct[];
}

/** Draw a Bag ID / Lot Identification report onto an existing jsPDF `doc`. */
export function renderBagIdReportInto(doc: jsPDF, {
  shipment,
  order,
  customer,
  lotCodes,
}: GenerateBagIdReportParams): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = M;
  const rightCol = M + halfWidth + 2;
  const rightHalf = halfWidth - 2;

  let y = drawDocHeader(doc, 'Bag ID Report');

  // Resolve the lot codes assigned to this shipment (same rule as the COA).
  const assignedLotNums = shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : []);
  const shipmentLotCodes = assignedLotNums
    .map(ln => lotCodes.find(lc => lc.lotNumber === ln))
    .filter((lc): lc is LotCode => !!lc);

  const productName = order?.product || shipment.product || '';
  const bolNum = shipment.bol || order?.bolNumber || '';

  // Top info row — 4 fields
  const fieldW = contentWidth / 4;
  [
    { label: 'BOL #', value: bolNum },
    { label: 'Customer PO #', value: order?.po || shipment.po || '' },
    { label: 'Product', value: productName },
    { label: 'Ship Date', value: shipment.date || '' },
  ].forEach((f, i) => drawInfoField(doc, f.label, f.value, leftCol + i * fieldW, y, fieldW));
  y += 14;

  // Customer (left) & Shipment (right)
  const headerY = y;
  y = drawSectionHeader(doc, 'CUSTOMER', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'SHIPMENT', rightCol, headerY, rightHalf);

  let ly = y;
  ly = drawFieldRow(doc, 'Name', customer?.name || shipment.customer || '', leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Total Lots', shipmentLotCodes.length ? String(shipmentLotCodes.length) : '', leftCol, ly, halfWidth);

  let ry = y;
  ry = drawFieldRow(doc, 'Carrier', shipment.carrier || '', rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Quantity', shipment.qty ? `${shipment.qty} MT` : '', rightCol, ry, rightHalf);

  y = Math.max(ly, ry) + 3;

  // Bag / lot identification table
  y = drawSectionHeader(doc, 'BAG / LOT IDENTIFICATION', leftCol, y, contentWidth);

  const rowsData: string[][] = shipmentLotCodes.length
    ? shipmentLotCodes.map(lc => [
        lc.lotNumber || '',
        lc.productGroup || productName,
        lc.category || '',
        lc.countryOfOrigin || '',
        lc.date || '',
      ])
    : [['', productName, '', '', '']];

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Lot / Bag ID', 'Product', 'Category', 'Country of Origin', 'Production Date']],
    body: rowsData,
    styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.3, textColor: [20, 20, 20] },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 45 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 30 },
      3: { cellWidth: 38 },
      4: { cellWidth: 30 },
    },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;
  y += 6;

  // Certification / sign-off
  const sigHeaderY = y;
  y = drawSectionHeader(doc, 'PREPARED BY', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'VERIFIED BY', rightCol, sigHeaderY, rightHalf);
  const sigRowH = 11;
  let py = y;
  py = drawFieldRow(doc, 'Name', '', leftCol, py, halfWidth, sigRowH);
  py = drawFieldRow(doc, 'Signature / Date', '', leftCol, py, halfWidth, sigRowH);
  let vy = y;
  vy = drawFieldRow(doc, 'Name', '', rightCol, vy, rightHalf, sigRowH);
  vy = drawFieldRow(doc, 'Signature / Date', '', rightCol, vy, rightHalf, sigRowH);
  y = Math.max(py, vy) + 6;

  drawDocFooter(doc, Math.min(y, doc.internal.pageSize.getHeight() - 8));
}

export function generateBagIdReportPdf(params: GenerateBagIdReportParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderBagIdReportInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `BagIDReport_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), filename };
}
