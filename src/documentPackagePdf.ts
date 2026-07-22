import jsPDF from 'jspdf';
import type { Shipment, Order, Customer, Carrier, Location, ShipToLocation, LotCode, QAProduct } from './types';
import { renderBolInto } from './bolPdf';
import { renderCoaInto } from './coaPdf';
import { renderPackingListInto } from './packingListPdf';
import { renderBagIdReportInto } from './bagIdReportPdf';
import { renderScaleTicketInto } from './scaleTicketPdf';

export interface GenerateDocumentPackageParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  carrier?: Carrier;
  shipFromLocation?: Location;
  shipToLocation?: ShipToLocation;
  lotCodes: LotCode[];
  qaProducts: QAProduct[];
  /** Include the Bag ID Report page. Only true when the invoice/order carries
   *  packaged or tote products (bulk/liquid loads have no bag IDs). */
  includeBagIdReport: boolean;
}

/**
 * Build ONE multi-page PDF containing the full shipping document package, one
 * document per page, in this order:
 *   1. Bill of Lading
 *   2. Certificate of Analysis
 *   3. Packing List
 *   4. Bag ID Report   (only when includeBagIdReport — packaged / tote products)
 *   5. Scale Ticket    (weight values blank — linked later)
 * Each document type mirrors a template type in the QA Templates table.
 */
export function generateDocumentPackagePdf(params: GenerateDocumentPackageParams): { blobUrl: string; filename: string } {
  const { shipment, order, customer, carrier, shipFromLocation, shipToLocation, lotCodes, qaProducts, includeBagIdReport } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  // One render step per document; each draws onto the current page. addPage()
  // starts a fresh page before every document after the first. The Bag ID Report
  // is included only for packaged / tote shipments.
  const steps: Array<() => void> = [
    () => renderBolInto(doc, { shipment, order, customer, carrier, shipFromLocation, shipToCustomer: customer, shipToLocation, qaProducts, lotCodes }),
    () => renderCoaInto(doc, { shipment, order, customer, shipFromLocation, lotCodes, qaProducts }),
    () => renderPackingListInto(doc, { shipment, order, customer, shipFromLocation, shipToLocation, qaProducts }),
  ];
  if (includeBagIdReport) {
    steps.push(() => renderBagIdReportInto(doc, { shipment, order, customer, lotCodes, qaProducts }));
  }
  steps.push(() => renderScaleTicketInto(doc, { shipment, order, customer, carrier, shipFromLocation }));

  steps.forEach((step, i) => {
    if (i > 0) doc.addPage();
    step();
  });

  const bolNum = shipment.bol || order?.bolNumber || '';
  const filename = `DocumentPackage_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), filename };
}
