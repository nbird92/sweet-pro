import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, Location, ShipToLocation, LotCode, QAProduct } from './types';
import { sameLotCode } from './utils/lotCode';

interface GenerateCoaParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  shipFromLocation?: Location;
  /** The order's ship-to site — the DELIVER TO / DESTINATION address. The
   *  customer's own address is the consignee (corporate) address, never the
   *  delivery address when a ship-to site is known. */
  shipTo?: ShipToLocation;
  lotCodes: LotCode[];
  qaProducts: QAProduct[];
  /** Catalog-resolved product for the COA's Product Name / Quantity columns and
   *  spec lookup (resolved by the caller from the order line's productKey or the
   *  lot's sugar type / group / category). Falls back to a name lookup. */
  product?: { label: string; units: string; qaProduct?: QAProduct };
  /** Carrier contact email — the template's "{{carrier_name}}  {{carrier_email}}". */
  carrierEmail?: string;
}

const BLACK = '#141414';

/** COA template rule: LIQUID / MOLASSES sugar types use the liquid COA; every
 *  other type (granulated, icing, brown, yellow, …) uses the granulated COA. */
export function isLiquidSugar(sugarType: string): boolean {
  const lower = (sugarType || '').toLowerCase();
  return lower.includes('liquid') || lower.includes('molasses');
}

/** Resolve the sugar type that drives the COA layout/template for a shipment:
 *  the first assigned lot code's sugar type, else the matching QA product's.
 *  Mirrors the resolution inside renderCoaInto so the linked template matches
 *  the generated COA. */
export function resolveCoaSugarType(params: {
  shipment: Shipment;
  order?: Order;
  lotCodes: LotCode[];
  qaProducts: QAProduct[];
}): string {
  const { shipment, order, lotCodes, qaProducts } = params;
  const assignedLotNums = shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : []);
  const shipmentLotCodes = assignedLotNums
    .map(ln => lotCodes.find(lc => sameLotCode(lc.lotNumber, ln)))
    .filter((lc): lc is LotCode => !!lc);
  if (shipmentLotCodes.length > 0 && shipmentLotCodes[0].sugarType) return shipmentLotCodes[0].sugarType;
  const displayProductName = order?.product || shipment.product || '';
  const lookupProductName = order?.lineItems?.[0]?.productName || shipment.product || displayProductName;
  const qaProduct =
    qaProducts.find(p => p.skuName === lookupProductName) ||
    qaProducts.find(p => p.skuName === displayProductName);
  return qaProduct?.sugarType || '';
}

// ============================================================
// COA PAGE — one layout, copied from the customer's Google Sheets templates:
//   • "Granulated COA Template" (1CtUthOGFF…) — bulk / granulated / every
//     non-liquid sugar.
//   • "Liquid COA Template"     (1vA6uWIU4I…) — liquid sugar and molasses.
// Both templates are the same sheet apart from the specification rows and the
// footer: centered title; Customer block left / BOL-Carrier-Trailer-Pick-up-
// PO-Delivery block right; one item line (Quantity | Product Name | Lot # |
// Brand | Production Date | Expiration Date); Specification | Standards |
// Results; MANUFACTURED BY / SHIPPER / ORIGIN / DESTINATION; Loading Date + QA
// approval; footer. Wording below is the templates' text verbatim — only the
// {{tokens}} are filled. (There is no Product Group field on either template.)
// ============================================================
type CoaKind = 'liquid' | 'granulated';

function generateTemplateCoaPage(
  doc: jsPDF,
  kind: CoaKind,
  shipment: Shipment,
  order: Order | undefined,
  customer: Customer | undefined,
  shipFromLocation: Location | undefined,
  shipTo: ShipToLocation | undefined,
  shipmentLotCodes: LotCode[],
  qaProduct: QAProduct | undefined,
  product: { label: string; units: string },
  carrierEmail: string,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 16;
  const rightColX = 122;           // label column of the right-hand info block
  const rightValX = 152;           // value column of the right-hand info block
  const joinVals = (key: keyof LotCode) =>
    [...new Set(shipmentLotCodes.map(lc => String((lc as any)[key] ?? '').trim()).filter(Boolean))].join(', ');

  // ── Title ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BLACK);
  doc.text('CERTIFICATE OF ANALYSIS', pageWidth / 2, 20, { align: 'center' });

  // ── Customer block (left) — Name / Address (deliver-to) / Email ──
  let y = 34;
  doc.setFontSize(10);
  doc.text('Customer', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 6;
  doc.text(`Name: ${customer?.name || shipment.customer || ''}`, M, y);
  y += 5.5;
  // {{deliver_name}} {{deliver_address}} {{deliver_city_province}} {{deliver_postal}}
  const deliverName = shipTo?.name || '';
  const deliverAddr = shipTo ? [shipTo.addressLine1, shipTo.addressLine2].filter(Boolean).join(' ') : (customer?.address || '');
  const deliverCity = shipTo ? [shipTo.city, shipTo.province].filter(Boolean).join(', ') : [customer?.city, customer?.province].filter(Boolean).join(', ');
  const deliverPostal = shipTo?.postalCode || customer?.postalCode || '';
  const addrLines = doc.splitTextToSize(`Address: ${[deliverName, deliverAddr, deliverCity, deliverPostal].filter(Boolean).join(' ')}`, 95) as string[];
  doc.text(addrLines, M, y);
  y += addrLines.length * 5 + 0.5;
  doc.text(`Email: ${customer?.qaContractEmail || customer?.contactEmail || ''}`, M, y);

  // ── Shipment block (right) ──
  let ry = 34;
  const rightRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(label, rightColX, ry);
    doc.setFont('helvetica', 'normal');
    const v = doc.splitTextToSize(value || '', pageWidth - M - rightValX) as string[];
    doc.text(v, rightValX, ry);
    ry += 5.5 * Math.max(1, v.length);
  };
  rightRow('BOL #', shipment.bol || order?.bolNumber || '');
  rightRow('Carrier:', [shipment.carrier || order?.carrier || '', carrierEmail].filter(Boolean).join('  '));
  rightRow('Trailer #:', joinVals('trailerNumber') || shipment.trailerNo || '');
  rightRow('Pick-up Date:', shipment.date || order?.shipmentDate || '');
  rightRow('PO #:', order?.po || shipment.po || '');
  rightRow('Delivery Required:', shipment.deliveryDate || order?.deliveryDate || '');

  y = Math.max(y, ry) + 8;

  // ── Item line ──
  const lotNums = shipmentLotCodes.length
    ? shipmentLotCodes.map(lc => lc.lotNumber).join(', ')
    : (shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : [])).join(', ');
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Quantity', 'Product Name', 'Lot #', 'Brand', 'Production Date', 'Expiration Date']],
    body: [[product.units, product.label, lotNums, 'SUCRO CAN', joinVals('date'), '']],
    styles: { fontSize: 8, cellPadding: 2, lineColor: [20, 20, 20], lineWidth: 0.2, textColor: [20, 20, 20], halign: 'center' },
    headStyles: { fillColor: [255, 255, 255], textColor: [20, 20, 20], fontStyle: 'bold', lineColor: [20, 20, 20], lineWidth: 0.2 },
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 18) + 8;

  // ── Specification | Standards | Results — the template's rows, verbatim ──
  const res = (key: keyof LotCode) => joinVals(key);
  const maxColor = qaProduct?.maxColor != null && qaProduct.maxColor !== 0 ? String(qaProduct.maxColor) : '';
  const rows: string[][] = kind === 'liquid'
    ? [
        ['Sensorial', 'Clear viscous liquid, free of haze or sediment, typical sweet, free of foreign odors and off flavours', 'Confirm standard'],
        ['Total solids (° Brix)', '67.0 to 68.0°', res('brix')],
        ['pH', '6.5 to 8.0', res('ph')],
        ['Color (ICUMSA units)', `Target ${maxColor}`.trim(), res('color')],
      ]
    : [
        ['Sensorial', 'Typical, Sweet, no off flavor or odor, dry crystalline, white refined sugar with a free flowing capacity', 'Conforms to Standard'],
        ['Color', `Max. ICUMSA ${maxColor}`.trim(), res('color')],
        ['Moisture', 'Max. 0.05%', res('moisture')],
        ['Ash', 'Max. 0.04%', res('ash')],
        ['Sucrose', 'Min. 99.8%', res('sucrose')],
      ];
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Specification', 'Standards', 'Results']],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 2.5, lineColor: [20, 20, 20], lineWidth: 0.2, textColor: [20, 20, 20] },
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', lineColor: [20, 20, 20], lineWidth: 0.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 1: { cellWidth: 92 }, 2: { halign: 'center' } },
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 40) + 4;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.text('*The results reported correspond only to the lots referenced above.', M, y);
  y += 9;

  // ── Manufacturer / Shipper / Origin / Destination ──
  const block = (label: string, lines: string[]) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text(label, M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    for (const l of lines) { doc.text(l, M, y); y += 4.5; }
    y += 3;
  };
  block('MANUFACTURED BY:', ['Sucro Can Canada Inc']);
  block('SHIPPER:', ['Sucro Can Canada Inc', '560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9', 'TEL: (289) 799-8966']);
  const originTxt = shipFromLocation?.name ? `${shipFromLocation.name.replace(/\s*\(.+\)$/, '')}, ON, Canada` : 'Hamilton, ON, Canada';
  // DESTINATION is the DELIVER-TO: the order's ship-to site address. The
  // customer's corporate address is only the fallback when no site is known.
  const destTxt = shipTo
    ? [shipTo.city || shipTo.addressLine1, shipTo.province, shipTo.country || (shipTo.city || shipTo.province ? 'Canada' : '')].filter(Boolean).join(', ')
    : [customer?.city, customer?.province, customer?.city || customer?.province ? 'Canada' : ''].filter(Boolean).join(', ');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('ORIGIN:', M, y); doc.setFont('helvetica', 'normal'); doc.text(originTxt, M + 30, y); y += 5.5;
  doc.setFont('helvetica', 'bold'); doc.text('DESTINATION:', M, y); doc.setFont('helvetica', 'normal'); doc.text(destTxt, M + 30, y); y += 10;

  // ── Loading Date + QA approval ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Loading Date', M, y);
  doc.text('Approved by QA Personnel ONLY', rightColX, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.text(shipment.date || order?.shipmentDate || '', M, y);
  doc.setDrawColor(BLACK); doc.setLineWidth(0.3);
  doc.line(M, y + 2, M + 55, y + 2);
  doc.line(rightColX, y + 2, rightColX + 65, y + 2);
  y += 14;

  // ── Footer — each template's own text ──
  const footY = Math.max(y, doc.internal.pageSize.getHeight() - 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);
  if (kind === 'liquid') {
    doc.text('SUCRO CANADA INC.', pageWidth / 2, footY, { align: 'center' });
    doc.text('560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9', pageWidth / 2, footY + 4, { align: 'center' });
    doc.text('TEL : (289)-799-8966 quality@sucro.ca', pageWidth / 2, footY + 8, { align: 'center' });
  } else {
    doc.text('560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9 | 1(289)-799-8966 | quality@sucro.ca', pageWidth / 2, footY + 4, { align: 'center' });
  }
  doc.setTextColor(BLACK);
}

// ============================================================
// MAIN EXPORT
// ============================================================
/** Draw the Certificate of Analysis onto an existing jsPDF `doc` (its current
 *  page). Used both standalone (generateCoaPdf) and as a Document Package page. */
export function renderCoaInto(doc: jsPDF, {
  shipment,
  order,
  customer,
  shipFromLocation,
  shipTo,
  lotCodes,
  qaProducts,
  product,
  carrierEmail,
}: GenerateCoaParams): void {
  // Resolve the lot codes assigned to this shipment
  const assignedLotNums = shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : []);
  const shipmentLotCodes = assignedLotNums
    .map(ln => lotCodes.find(lc => sameLotCode(lc.lotNumber, ln)))
    .filter((lc): lc is LotCode => !!lc);

  // Product: the caller's catalog-resolved product wins (it pins the exact QA
  // record by productKey). The name lookup below is only the legacy fallback —
  // catalog names are often bare format words ("Bulk", and the Molasses SKU is
  // literally named "Bulk"), so a name hit can be the wrong product.
  const displayProductName = order?.product || shipment.product || '';
  const lookupProductName = order?.lineItems?.[0]?.productName || shipment.product || displayProductName;
  const qaProductRaw = product?.qaProduct
    || qaProducts.find(p => p.skuName === lookupProductName)
    || qaProducts.find(p => p.skuName === displayProductName);
  // Blank specification fields INHERIT from the product's linked BULK SUGAR
  // (QA card → Bill of Materials).
  const bulkParent = qaProductRaw?.bulkSugarQaId
    ? qaProducts.find(p => p.id === qaProductRaw.bulkSugarQaId)
    : undefined;
  const qaProduct = qaProductRaw && bulkParent?.specifications
    ? {
        ...qaProductRaw,
        maxColor: qaProductRaw.maxColor || bulkParent.maxColor,
        specifications: {
          ...bulkParent.specifications,
          ...Object.fromEntries(Object.entries(qaProductRaw.specifications || {}).filter(([, v]) => String(v || '').trim() !== '')),
        } as QAProduct['specifications'],
      }
    : qaProductRaw;
  const sugarType = shipmentLotCodes.length > 0 && shipmentLotCodes[0].sugarType
    ? shipmentLotCodes[0].sugarType
    : (qaProduct?.sugarType || '');

  const units = product?.units || (shipment.qty ? `${shipment.qty} MT` : '');
  generateTemplateCoaPage(
    doc,
    isLiquidSugar(sugarType) ? 'liquid' : 'granulated',
    shipment, order, customer, shipFromLocation, shipTo, shipmentLotCodes, qaProduct,
    { label: product?.label || displayProductName, units },
    carrierEmail || '',
  );
}

export function generateCoaPdf(params: GenerateCoaParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  renderCoaInto(doc, params);
  const bolNum = params.shipment.bol || params.order?.bolNumber || '';
  const filename = `COA_${bolNum || 'draft'}_${(params.shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
