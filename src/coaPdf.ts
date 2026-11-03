import jsPDF from 'jspdf';
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
  /** Logo from the linked COA template (QA → Templates), drawn top-right. */
  logoDataUrl?: string;
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
// COA PAGE — a cell-for-cell copy of the customer's Google Sheets templates:
//   • "Granulated COA Template" (1CtUthOGFF…) — bulk / granulated / every
//     non-liquid sugar.
//   • "Liquid COA Template"     (1vA6uWIU4I…) — liquid sugar and molasses.
// Geometry, merges, fills, borders and fonts are taken from the template sheet
// itself (Sheets API grid data): 32 columns × 25px, the template's row heights,
// Arial 10 (24 bold title), #D9D9D9 label fills, a black Specification header,
// and the same border sides. The sheet is scaled to the page width, exactly as
// Google's "fit to width" PDF export does. Wording is the templates' verbatim
// text; only the {{tokens}} are filled. The two templates are the same sheet
// apart from the specification rows and the footer.
// ============================================================
type CoaKind = 'liquid' | 'granulated';

const GRID_COLS = 32;
const COL_PX = 25;
// Template row heights (px), row 1 → 42 — from the Granulated COA Template.
const ROW_PX = [25, 25, 25, 25, 23, 25, 25, 25, 25, 25, 25, 23, 40, 50, 14, 25, 21, 21, 21, 25, 25, 25, 25, 25, 25, 25, 25, 14, 25, 25, 25, 25, 13, 25, 25, 25, 25, 50, 47, 30, 21, 21];
const LABEL_FILL: [number, number, number] = [217, 217, 217];

type Sides = string; // any of 't','b','l','r'
interface CellOpts {
  bold?: boolean;
  size?: number;            // template pt (scaled on draw)
  font?: 'helvetica' | 'times';
  italic?: boolean;
  fill?: [number, number, number];
  color?: [number, number, number];
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  borders?: Sides;
}

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
  logoDataUrl: string,
) {
  const pageW = doc.internal.pageSize.getWidth();
  // Fit the 32-column sheet to the page width with a margin equal to the
  // template's own empty column A (so B…AE sit where the export puts them).
  const margin = 8;
  const s = (pageW - margin * 2) / (GRID_COLS * COL_PX); // mm per px
  const ptScale = s / 0.2646;                             // px@96dpi → mm, applied to pt sizes
  const top = 10;
  const colX = (c: number) => margin + c * COL_PX * s;
  const rowY = (r: number) => top + ROW_PX.slice(0, r).reduce((a, b) => a + b, 0) * s;

  /** Draw one (possibly merged) cell. r/c are 1-based sheet rows; c0 is the
   *  first column index (A=0) and c1 the exclusive end — Sheets merge style. */
  const cell = (r0: number, r1: number, c0: number, c1: number, text: string, o: CellOpts = {}) => {
    const x = colX(c0), y = rowY(r0 - 1), w = colX(c1) - x, h = rowY(r1) - y;
    if (o.fill) { doc.setFillColor(...o.fill); doc.rect(x, y, w, h, 'F'); }
    if (o.borders) {
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25);
      if (o.borders.includes('t')) doc.line(x, y, x + w, y);
      if (o.borders.includes('b')) doc.line(x, y + h, x + w, y + h);
      if (o.borders.includes('l')) doc.line(x, y, x, y + h);
      if (o.borders.includes('r')) doc.line(x + w, y, x + w, y + h);
    }
    if (!text) return;
    const size = (o.size || 10) * ptScale;
    doc.setFont(o.font || 'helvetica', o.bold && o.italic ? 'bolditalic' : o.bold ? 'bold' : o.italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(o.color || [0, 0, 0]));
    const pad = 1.2;
    const lines: string[] = o.wrap ? (doc.splitTextToSize(text, w - pad * 2) as string[]) : text.split('\n');
    const lineH = size * 0.3528 * 1.15;
    const blockH = lineH * lines.length;
    const valign = o.valign || 'middle';
    let ty = valign === 'top' ? y + pad + size * 0.3528
      : valign === 'bottom' ? y + h - pad - blockH + size * 0.3528
      : y + (h - blockH) / 2 + size * 0.3528 * 0.9;
    const align = o.align || 'left';
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
    for (const ln of lines) { doc.text(ln, tx, ty, { align }); ty += lineH; }
  };

  const joinVals = (key: keyof LotCode) =>
    [...new Set(shipmentLotCodes.map(lc => String((lc as any)[key] ?? '').trim()).filter(Boolean))].join(', ');
  const lotNums = shipmentLotCodes.length
    ? shipmentLotCodes.map(lc => lc.lotNumber).join(', ')
    : (shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : [])).join(', ');

  // ── Rows 1–4: title (B1:V4); W1:AF4 is the template's logo area ──
  cell(1, 4, 1, 22, 'CERTIFICATE OF ANALYSIS', { bold: true, size: 24, align: 'center' });
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const boxX = colX(22), boxY = rowY(0), boxW = colX(32) - boxX, boxH = rowY(4) - boxY;
      const k = Math.min(boxW / props.width, boxH / props.height);
      const w = props.width * k, h = props.height * k;
      // Contain-fit, centred in the merged W1:AF4 area.
      doc.addImage(logoDataUrl, (props.fileType || 'PNG') as any, boxX + (boxW - w) / 2, boxY + (boxH - h) / 2, w, h);
    } catch (e) {
      console.warn('COA logo could not be drawn:', e);
    }
  }

  // ── Rows 6–11: Customer box (B:O) and shipment block (R:V labels, W:AE values) ──
  // {{deliver_name}} {{deliver_address}} {{deliver_city_province}} {{deliver_postal}}
  const deliverName = shipTo?.name || '';
  const deliverAddr = shipTo ? [shipTo.addressLine1, shipTo.addressLine2].filter(Boolean).join(' ') : (customer?.address || '');
  const deliverCity = shipTo ? [shipTo.city, shipTo.province].filter(Boolean).join(', ') : [customer?.city, customer?.province].filter(Boolean).join(', ');
  const deliverPostal = shipTo?.postalCode || customer?.postalCode || '';
  cell(6, 6, 1, 15, 'Customer', { bold: true, fill: LABEL_FILL, borders: 'tlr' });
  cell(7, 7, 1, 15, `Name: ${customer?.name || shipment.customer || ''}`, { bold: true, valign: 'bottom', borders: 'tlr' });
  cell(8, 9, 1, 15, `Address: ${[deliverName, deliverAddr, deliverCity, deliverPostal].filter(Boolean).join(' ')}`, { bold: true, valign: 'top', wrap: true, borders: 'lr' });
  cell(10, 10, 1, 15, `Email: ${customer?.qaContractEmail || customer?.contactEmail || ''}`, { bold: true, valign: 'bottom', borders: 'lr' });
  cell(11, 11, 1, 15, '', { borders: 'blr' });

  const right: Array<[string, string]> = [
    ['BOL #', shipment.bol || order?.bolNumber || ''],
    ['Carrier:', [shipment.carrier || order?.carrier || '', carrierEmail].filter(Boolean).join('  ')],
    ['Trailer #:', joinVals('trailerNumber') || shipment.trailerNo || ''],
    ['Pick-up Date:', shipment.date || order?.shipmentDate || ''],
    ['PO #:', order?.po || shipment.po || ''],
    ['Delivery Required:', shipment.deliveryDate || order?.deliveryDate || ''],
  ];
  right.forEach(([label, value], i) => {
    const r = 6 + i;
    cell(r, r, 17, 22, label, { bold: true, fill: LABEL_FILL, borders: 'tblr' });
    cell(r, r, 22, 31, value, { borders: i === 0 ? 'tr' : i === right.length - 1 ? 'br' : 'r' });
  });

  // ── Rows 13–14: item line ──
  const itemCols: Array<[number, number, string, string, boolean]> = [
    [1, 6, 'Quantity', product.units, false],
    [6, 11, 'Product Name', product.label, true],
    [11, 16, 'Lot #', lotNums, true],
    [16, 21, 'Brand', 'SUCRO CAN', true],
    [21, 26, 'Production Date', joinVals('date'), false],
    [26, 31, 'Expiration Date', '', false],
  ];
  for (const [c0, c1, head, val, wrap] of itemCols) {
    cell(13, 13, c0, c1, head, { bold: true, fill: LABEL_FILL, align: 'center', wrap: true, borders: 'tblr' });
    cell(14, 14, c0, c1, val, { align: 'center', wrap, borders: 'tblr' });
  }

  // ── Rows 16–23: Specification | Standards | Results ──
  cell(16, 16, 1, 11, 'Specification', { bold: true, fill: [0, 0, 0], color: [255, 255, 255], align: 'center', borders: 'tblr' });
  cell(16, 16, 11, 21, 'Standards', { bold: true, fill: [0, 0, 0], color: [255, 255, 255], align: 'center', borders: 'tblr' });
  cell(16, 16, 21, 31, 'Results', { bold: true, fill: [0, 0, 0], color: [255, 255, 255], align: 'center', borders: 'tblr' });
  const maxColor = qaProduct?.maxColor != null && qaProduct.maxColor !== 0 ? String(qaProduct.maxColor) : '';
  const res = (key: keyof LotCode) => joinVals(key);
  const sensorial = kind === 'liquid'
    ? ['Clear viscous liquid, free of haze or sediment, typical sweet, free of foreign odors and off flavours', 'Confirm standard']
    : ['Typical, Sweet, no off flavor or odor, dry crystalline, white refined sugar with a free flowing capacity', 'Conforms to Standard'];
  const specRow = (r0: number, r1: number, name: string, standard: string, result: string) => {
    cell(r0, r1, 1, 10, name, { align: 'center', borders: 'tbl' });
    cell(r0, r1, 10, 22, standard, { align: 'center', wrap: true, borders: 'tblr' });
    cell(r0, r1, 22, 31, result, { align: 'center', wrap: true, borders: 'tbr' });
  };
  specRow(17, 19, 'Sensorial', sensorial[0], sensorial[1]);
  const rows: Array<[string, string, string]> = kind === 'liquid'
    ? [
        ['Total solids (° Brix)', '67.0 to 68.0°', res('brix')],
        ['pH', '6.5 to 8.0', res('ph')],
        ['Color (ICUMSA units)', `Target ${maxColor}`.trim(), res('color')],
      ]
    : [
        ['Color', `Max. ICUMSA ${maxColor}`.trim(), res('color')],
        ['Moisture', 'Max. 0.05%', res('moisture')],
        ['Ash', 'Max. 0.04%', res('ash')],
        ['Sucrose', 'Min. 99.8%', res('sucrose')],
      ];
  rows.forEach(([n, st, rs], i) => specRow(20 + i, 20 + i, n, st, rs));

  // ── Row 24: lots note; rows 26–35: manufacturer / shipper / origin / destination ──
  cell(24, 24, 1, 31, '*The results reported correspond only to the lots referenced above.');
  cell(26, 26, 1, 15, 'MANUFACTURED BY:', { bold: true });
  cell(27, 27, 1, 15, 'Sucro Can Canada Inc');
  cell(29, 29, 1, 15, 'SHIPPER:', { bold: true });
  cell(30, 30, 1, 15, 'Sucro Can Canada Inc');
  cell(31, 31, 1, 20, '560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9');
  cell(32, 32, 1, 15, 'TEL: (289) 799-8966');
  const originTxt = shipFromLocation?.name ? `${shipFromLocation.name.replace(/\s*\(.+\)$/, '')}, ON, Canada` : 'Hamilton, ON, Canada';
  // {{destination}} = the DELIVER-TO site; the customer's corporate address is
  // only the fallback when no ship-to site is known.
  const destTxt = shipTo
    ? [shipTo.city || shipTo.addressLine1, shipTo.province, shipTo.country || (shipTo.city || shipTo.province ? 'Canada' : '')].filter(Boolean).join(', ')
    : [customer?.city, customer?.province, customer?.city || customer?.province ? 'Canada' : ''].filter(Boolean).join(', ');
  cell(34, 34, 1, 5, 'ORIGIN:', { bold: true });
  cell(34, 34, 5, 20, originTxt, { valign: 'bottom' });
  cell(35, 35, 1, 5, 'DESTINATION:', { bold: true });
  cell(35, 35, 5, 20, destTxt, { valign: 'bottom' });

  // ── Rows 37–38: Loading Date | Approved by QA Personnel ONLY ──
  cell(37, 37, 1, 6, 'Loading Date', { bold: true, fill: LABEL_FILL, align: 'center', borders: 'tblr' });
  cell(37, 37, 6, 16, 'Approved by QA Personnel ONLY', { bold: true, fill: LABEL_FILL, align: 'center', borders: 'tbr' });
  cell(38, 38, 1, 6, shipment.date || order?.shipmentDate || '', { align: 'center', borders: 'tblr' });
  cell(38, 38, 6, 16, '', { borders: 'br' }); // signature box (Dancing Script in the sheet)

  // ── Row 40: footer — each template's own text ──
  const footer = kind === 'liquid'
    ? 'SUCRO CANADA INC.\n560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9\nTEL : (289)-799-8966 quality@sucro.ca'
    : '560 Ferguson Ave. North, Hamilton Ontario L8L 4Z9 | 1(289)-799-8966 | quality@sucro.ca';
  cell(40, kind === 'liquid' ? 42 : 40, 1, 31, footer, { align: 'center', size: kind === 'liquid' ? 9 : 10 });
  doc.setTextColor(0, 0, 0);
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
  logoDataUrl,
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
    logoDataUrl || '',
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
