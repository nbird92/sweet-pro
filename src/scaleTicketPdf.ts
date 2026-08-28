import jsPDF from 'jspdf';
import type { Shipment, Order, Customer, Carrier, Location } from './types';
import { BLACK } from './pdfDocHelpers';

export interface GenerateScaleTicketParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
}

/** Draw a Scale (weigh) Ticket matching the customer-provided Google Sheets
 *  template ("Scale Ticket" tab): title, Shipping/Receiving checkboxes, a plain
 *  label/value list (Pick Up Date, BOL #, PO #, Carrier, Trailer #, Gross/Tare/
 *  Net Weight, Goods Ordered, Item Code, Notes) and Driver / Authorized
 *  signature lines. Weight VALUES are intentionally left blank — recorded at
 *  the scale. */
export function renderScaleTicketInto(doc: jsPDF, {
  shipment,
  order,
  customer: _customer,
  carrier,
  shipFromLocation: _shipFromLocation,
}: GenerateScaleTicketParams): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 18;

  // ── Title ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BLACK);
  doc.text('Scale Ticket', M, 22);

  // ── Shipping / Receiving checkboxes (template row) ──
  let y = 36;
  const checkbox = (x: number, label: string) => {
    doc.setDrawColor(BLACK);
    doc.setLineWidth(0.4);
    doc.rect(x, y - 4, 5, 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, x + 8, y);
  };
  checkbox(M, 'Shipping');
  checkbox(M + 70, 'Receiving');
  y += 12;

  // ── Label / value rows (template order; underlined value area) ──
  const labelX = M;
  const valueX = M + 62;
  const valueW = pageWidth - M - valueX;
  const row = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, labelX, y);
    doc.setFont('helvetica', 'normal');
    let v = value || '';
    while (doc.getTextWidth(v) > valueW - 2 && v.length) v = v.slice(0, -1);
    doc.text(v, valueX, y);
    doc.setDrawColor(120, 120, 120);
    doc.setLineWidth(0.2);
    doc.line(valueX, y + 1.5, valueX + valueW, y + 1.5);
    y += 10;
  };
  const bolNum = shipment.bol || order?.bolNumber || '';
  row('Pick Up Date:', shipment.date || order?.shipmentDate || '');
  row('Bill of Lading #:', bolNum);
  row('Customer PO #:', order?.po || shipment.po || '');
  row('Carrier:', carrier?.name || shipment.carrier || '');
  row('Trailer #:', shipment.trailerNo || '');
  row('Gross Weight (kg):', ''); // recorded at the scale
  row('Tare Weight:', '');
  row('Net Weight (kg):', '');
  row('Goods Ordered:', order?.product || shipment.product || '');
  row('Item Code:', '');
  row('Notes:', '');
  y += 24;

  // ── Signature lines ──
  const sigW = 70;
  const rightSigX = pageWidth - M - sigW;
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.4);
  doc.line(M, y, M + sigW, y);
  doc.line(rightSigX, y, rightSigX + sigW, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Driver Signature', M + sigW / 2, y + 5, { align: 'center' });
  doc.text('Authorized Signature', rightSigX + sigW / 2, y + 5, { align: 'center' });
}

export function generateScaleTicketPdf(params: GenerateScaleTicketParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderScaleTicketInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `ScaleTicket_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), filename };
}
