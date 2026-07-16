import jsPDF from 'jspdf';
import type { Shipment, Order, Customer, Carrier, Location } from './types';
import { drawDocHeader, drawSectionHeader, drawFieldRow, drawInfoField, drawDocFooter, BLACK } from './pdfDocHelpers';

export interface GenerateScaleTicketParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
}

/** Draw a Scale (weigh) Ticket onto an existing jsPDF `doc`. Weight VALUES are
 *  intentionally left blank for now — they will be linked from the scale later. */
export function renderScaleTicketInto(doc: jsPDF, {
  shipment,
  order,
  customer,
  carrier,
  shipFromLocation,
}: GenerateScaleTicketParams): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = M;
  const rightCol = M + halfWidth + 2;
  const rightHalf = halfWidth - 2;

  let y = drawDocHeader(doc, 'Scale Ticket');

  const bolNum = shipment.bol || order?.bolNumber || '';

  // Top info row — 4 fields
  const fieldW = contentWidth / 4;
  [
    { label: 'Ticket #', value: bolNum },
    { label: 'BOL #', value: bolNum },
    { label: 'Customer PO #', value: order?.po || shipment.po || '' },
    { label: 'Date', value: shipment.date || '' },
  ].forEach((f, i) => drawInfoField(doc, f.label, f.value, leftCol + i * fieldW, y, fieldW));
  y += 14;

  // Carrier / Vehicle (left) & Product / Origin (right)
  const headerY = y;
  y = drawSectionHeader(doc, 'CARRIER / VEHICLE', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'PRODUCT / ORIGIN', rightCol, headerY, rightHalf);

  const carrierName = carrier?.name || shipment.carrier || '';
  const originName = shipment.originOfGoods || shipFromLocation?.name || order?.location || '';

  let ly = y;
  ly = drawFieldRow(doc, 'Carrier', carrierName, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Trailer #', shipment.trailerNo || '', leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Driver', '', leftCol, ly, halfWidth);

  let ry = y;
  ry = drawFieldRow(doc, 'Customer', customer?.name || shipment.customer || '', rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Product', order?.product || shipment.product || '', rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Origin of Goods', originName, rightCol, ry, rightHalf);

  y = Math.max(ly, ry) + 3;

  // Weights — values intentionally blank (to be linked later).
  y = drawSectionHeader(doc, 'WEIGHTS', leftCol, y, contentWidth);
  const thirdW = contentWidth / 3;
  // First row: the three weigh values, left blank.
  drawFieldRow(doc, 'Gross Weight (Kg)', '', leftCol, y, thirdW, 15);
  drawFieldRow(doc, 'Tare Weight (Kg)', '', leftCol + thirdW, y, thirdW, 15);
  drawFieldRow(doc, 'Net Weight (Kg)', '', leftCol + thirdW * 2, y, thirdW, 15);
  y += 15;
  // Second row: weigh in/out times, left blank.
  drawFieldRow(doc, 'Weighed In', '', leftCol, y, thirdW, 15);
  drawFieldRow(doc, 'Weighed Out', '', leftCol + thirdW, y, thirdW, 15);
  drawFieldRow(doc, 'Scale / Operator', '', leftCol + thirdW * 2, y, thirdW, 15);
  y += 15;

  // Note that weights are pending.
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text('Weight values to be recorded at the scale.', leftCol + 2, y + 4);
  doc.setTextColor(BLACK);
  y += 10;

  // Signatures
  const sigHeaderY = y;
  y = drawSectionHeader(doc, 'WEIGHMASTER', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'RECEIVED BY', rightCol, sigHeaderY, rightHalf);
  const sigRowH = 11;
  let wy = y;
  wy = drawFieldRow(doc, 'Name', '', leftCol, wy, halfWidth, sigRowH);
  wy = drawFieldRow(doc, 'Signature / Date', '', leftCol, wy, halfWidth, sigRowH);
  let rcy = y;
  rcy = drawFieldRow(doc, 'Name', '', rightCol, rcy, rightHalf, sigRowH);
  rcy = drawFieldRow(doc, 'Signature / Date', '', rightCol, rcy, rightHalf, sigRowH);
  y = Math.max(wy, rcy) + 6;

  drawDocFooter(doc, Math.min(y, doc.internal.pageSize.getHeight() - 8));
}

export function generateScaleTicketPdf(params: GenerateScaleTicketParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderScaleTicketInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `ScaleTicket_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), filename };
}
