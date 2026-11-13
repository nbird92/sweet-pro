import jsPDF from 'jspdf';
import type { Shipment, Order, Customer, Carrier, Location } from './types';
import { BLACK } from './pdfDocHelpers';
import { renderTemplateGridInto } from './templateGridPdf';
import { docTemplate, commonDocTokens, computeGoods, goodsItems, goodsTotals } from './docTemplates';

export interface GenerateScaleTicketParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
  /** Which template checkbox to mark with an "X" — outbound loads are 'shipping'. */
  direction?: 'shipping' | 'receiving';
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
  direction,
}: GenerateScaleTicketParams): void {
  const tpl = docTemplate('scaleTicket');
  if (tpl) {
    // Scaled qty (MT) is the official on-trailer weight — printed in kg when known.
    const scaledKg = shipment.scaledQty && shipment.scaledQty > 0 ? Math.round(shipment.scaledQty * 1000).toLocaleString() : '';
    renderTemplateGridInto(doc, tpl.grid, {
      tokens: { ...commonDocTokens({ shipment, order, carrier }), total_gross: scaledKg, total_net: scaledKg, tare_weight: '', item_code: '' },
      items: [{ description: order?.product || shipment.product || '' }],
      marks: direction === 'receiving' ? ['Receiving'] : direction === 'shipping' ? ['Shipping'] : [],
      logoDataUrl: tpl.logo,
    });
    return;
  }
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 18;

  // ── Title ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BLACK);
  doc.text('Scale Ticket', M, 22);

  // ── Shipping / Receiving checkboxes (template row) ──
  let y = 36;
  const checkbox = (x: number, label: string, checked: boolean) => {
    doc.setDrawColor(BLACK);
    doc.setLineWidth(0.4);
    doc.rect(x, y - 4, 5, 5);
    if (checked) {
      // "X" drawn corner to corner, inset so it sits inside the box.
      doc.setLineWidth(0.5);
      doc.line(x + 1, y - 3, x + 4, y);
      doc.line(x + 4, y - 3, x + 1, y);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(label, x + 8, y);
  };
  checkbox(M, 'Shipping', direction === 'shipping');
  checkbox(M + 70, 'Receiving', direction === 'receiving');
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
  // The scaled quantity (MT) is the official on-trailer product weight — when it
  // has been recorded, print it (in kg); otherwise leave for the scale operator.
  const scaledKg = shipment.scaledQty && shipment.scaledQty > 0
    ? Math.round(shipment.scaledQty * 1000).toLocaleString()
    : '';
  row('Gross Weight (kg):', scaledKg);
  row('Tare Weight:', '');
  row('Net Weight (kg):', scaledKg);
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
