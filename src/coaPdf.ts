import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Shipment, Order, Customer, Location, LotCode, QAProduct } from './types';

interface GenerateCoaParams {
  shipment: Shipment;
  order?: Order;
  customer?: Customer;
  shipFromLocation?: Location;
  lotCodes: LotCode[];
  qaProducts: QAProduct[];
}

const BLACK = '#141414';
const DARK_GREEN = '#1a5c2e';

// ── Shared helpers matching BOL / Order Confirmation style ──

function drawSectionHeader(doc: jsPDF, text: string, x: number, y: number, width: number): number {
  doc.setFillColor(BLACK);
  doc.rect(x, y, width, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(text, x + 2, y + 5);
  doc.setTextColor(BLACK);
  return y + 7;
}

function drawFieldRow(doc: jsPDF, label: string, value: string, x: number, y: number, width: number, height = 13): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  const maxWidth = width - 4;
  let displayValue = value || '';
  while (doc.getTextWidth(displayValue) > maxWidth && displayValue.length > 0) {
    displayValue = displayValue.slice(0, -1);
  }
  doc.text(displayValue, x + 2, y + 10);
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y, width, height);
  return y + height;
}

function drawInfoField(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(label.toUpperCase(), x + 2, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(BLACK);
  doc.text(value || '—', x + 2, y + 5.5);
  doc.setDrawColor(200, 200, 200);
  doc.rect(x, y - 3.5, width, 12);
}

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
    .map(ln => lotCodes.find(lc => lc.lotNumber === ln))
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
// SHARED COA LAYOUT — used by both Granulated and Liquid
// ============================================================
function generateCoaPage(
  doc: jsPDF,
  shipment: Shipment,
  order: Order | undefined,
  customer: Customer | undefined,
  shipFromLocation: Location | undefined,
  shipmentLotCodes: LotCode[],
  qaProducts: QAProduct[],
  templateSubtitle: string,
  parameters: { name: string; spec: string; unit: string; key: string | null }[],
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 14;
  const contentWidth = pageWidth - M * 2;
  const halfWidth = contentWidth / 2;
  const leftCol = M;
  const rightCol = M + halfWidth + 2;
  const rightHalf = halfWidth - 2;

  // ═══════════════════════════════════════════════════════════
  // HEADER — matches BOL / Order Confirmation
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(BLACK);
  doc.text('Certificate of Analysis', leftCol, 20);

  doc.setFontSize(16);
  doc.setTextColor(DARK_GREEN);
  doc.text('Sucro Canada', pageWidth - M, 16, { align: 'right' });
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('sucrosourcing.com', pageWidth - M, 21, { align: 'right' });

  // Divider
  doc.setDrawColor(BLACK);
  doc.setLineWidth(0.5);
  doc.line(leftCol, 25, pageWidth - M, 25);

  let y = 32;

  // ═══════════════════════════════════════════════════════════
  // TOP INFO ROW — 4 equal-width fields
  // ═══════════════════════════════════════════════════════════
  const fieldW = contentWidth / 4;
  // Display product = same string the order shows in the Orders table.
  // Lookup product = bare catalog name used to hit the qaProducts table
  // (Order.product may include a weight prefix like "20kg GC100" which
  // wouldn't match a QA.skuName of "GC100").
  const displayProductName = order?.product || shipment.product || '';
  const lookupProductName = order?.lineItems?.[0]?.productName || shipment.product || displayProductName;
  const productName = displayProductName;
  const bolNum = shipment.bol || order?.bolNumber || '';
  const lotNums = shipmentLotCodes.map(lc => lc.lotNumber).join(', ');
  const testDates = [...new Set(shipmentLotCodes.map(lc => lc.date).filter(Boolean))].join(', ');

  const topFields = [
    { label: 'BOL #', value: bolNum },
    { label: 'Customer PO #', value: order?.po || shipment.po || '' },
    { label: 'Test Date', value: testDates },
    { label: 'Ship Date', value: shipment.date || '' },
  ];
  topFields.forEach((f, i) => {
    drawInfoField(doc, f.label, f.value, leftCol + i * fieldW, y, fieldW);
  });
  y += 14;

  // ═══════════════════════════════════════════════════════════
  // PRODUCT INFO (left) & SHIPMENT INFO (right)
  // ═══════════════════════════════════════════════════════════
  const headerY = y;
  y = drawSectionHeader(doc, 'PRODUCT INFORMATION', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'SHIPMENT INFORMATION', rightCol, headerY, rightHalf);

  // QA-spec lookup uses the bare productName (e.g. "GC100") since QA records
  // are keyed on skuName without weight prefixes. Fall back to the display
  // string when no line item is available.
  const qaProduct =
    qaProducts.find(p => p.skuName === lookupProductName) ||
    qaProducts.find(p => p.skuName === productName);
  const origins = [...new Set(shipmentLotCodes.map(lc => lc.countryOfOrigin).filter(Boolean))].join(', ');
  const category = shipmentLotCodes.length > 0 ? shipmentLotCodes[0].category : (qaProduct?.category || '');
  const productGroup = qaProduct?.productGroup || (shipmentLotCodes.length > 0 ? shipmentLotCodes[0].productGroup : '');

  let ly = y;
  // "Product" row shows the display string (same as the order shows).
  ly = drawFieldRow(doc, 'Product', productName, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Product Group', productGroup, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Category', category, leftCol, ly, halfWidth);
  ly = drawFieldRow(doc, 'Country of Origin', origins, leftCol, ly, halfWidth);

  const shipperName = shipFromLocation?.name || order?.location || 'Hamilton Sherman Plant';
  let ry = y;
  ry = drawFieldRow(doc, 'Customer', customer?.name || shipment.customer || '', rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Lot Code(s)', lotNums, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Ship From', shipperName, rightCol, ry, rightHalf);
  ry = drawFieldRow(doc, 'Quantity', shipment.qty ? `${shipment.qty} MT` : '', rightCol, ry, rightHalf);

  y = Math.max(ly, ry) + 3;

  // ═══════════════════════════════════════════════════════════
  // QUALITY ANALYSIS TABLE
  // ═══════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, `QUALITY ANALYSIS — ${templateSubtitle}`, leftCol, y, contentWidth);

  const hasMultiple = shipmentLotCodes.length > 1;

  // Helper to extract a lot code result value
  const getLotValue = (lc: LotCode, key: string | null, pName: string): string => {
    if (key === null) {
      if (pName.includes('Odour') || pName.includes('Flavour')) return lc.flavourOdourOk === 'Yes' ? 'Normal' : lc.flavourOdourOk === 'No' ? 'Abnormal' : '';
      return '';
    }
    return (lc as any)[key] || '';
  };

  if (hasMultiple) {
    const head = [['Parameter', 'Specification', 'Unit', ...shipmentLotCodes.map(lc => lc.lotNumber)]];
    const body = parameters.map(p => {
      const row: string[] = [p.name, p.spec, p.unit];
      shipmentLotCodes.forEach(lc => row.push(getLotValue(lc, p.key, p.name)));
      return row;
    });

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: 35 },
        2: { cellWidth: 16, halign: 'center' },
      },
    });
  } else {
    const lc = shipmentLotCodes[0];
    const head = [['Parameter', 'Specification', 'Unit', 'Result']];
    const body = parameters.map(p => [
      p.name,
      p.spec,
      p.unit,
      lc ? getLotValue(lc, p.key, p.name) : '',
    ]);

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 3, lineColor: [200, 200, 200], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold', fontSize: 7 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 48 },
        1: { cellWidth: 42 },
        2: { cellWidth: 20, halign: 'center' },
        3: { halign: 'center' },
      },
    });
  }

  y = (doc as any).lastAutoTable?.finalY || y + 60;
  y += 3;

  // ═══════════════════════════════════════════════════════════
  // TESTER & TEST INFO — 3 equal fields
  // ═══════════════════════════════════════════════════════════
  const thirdW = contentWidth / 3;
  const testers = [...new Set(shipmentLotCodes.map(lc => lc.testerName).filter(Boolean))].join(', ');
  const weeklyVerifications = [...new Set(shipmentLotCodes.map(lc => lc.weeklyVerification).filter(Boolean))].join(', ');

  drawInfoField(doc, 'Tested By', testers, leftCol, y, thirdW);
  drawInfoField(doc, 'Test Date', testDates, leftCol + thirdW, y, thirdW);
  drawInfoField(doc, 'Weekly Verification', weeklyVerifications, leftCol + thirdW * 2, y, thirdW);
  y += 17;

  // ═══════════════════════════════════════════════════════════
  // CERTIFICATION
  // ═══════════════════════════════════════════════════════════
  y = drawSectionHeader(doc, 'CERTIFICATION', leftCol, y, contentWidth);
  doc.setDrawColor(200, 200, 200);
  doc.rect(leftCol, y, contentWidth, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    'We hereby certify that the above product has been tested and the results are as shown above.',
    leftCol + 3, y + 5
  );
  doc.text(
    'This product complies with all applicable food safety regulations and is fit for human consumption.',
    leftCol + 3, y + 10
  );
  y += 19;

  // ═══════════════════════════════════════════════════════════
  // SIGNATURES — QA Approved By (tester from lot code) & Authorized By
  // ═══════════════════════════════════════════════════════════
  const sigHeaderY = y;
  y = drawSectionHeader(doc, 'QA APPROVAL', leftCol, y, halfWidth);
  drawSectionHeader(doc, 'AUTHORIZATION', rightCol, sigHeaderY, rightHalf);

  const sigRowH = 11;
  const lotCodeDates = [...new Set(shipmentLotCodes.map(lc => lc.date).filter(Boolean))].join(', ');

  let qy = y;
  qy = drawFieldRow(doc, 'QA Approved By', testers, leftCol, qy, halfWidth, sigRowH);
  qy = drawFieldRow(doc, 'Date', lotCodeDates, leftCol, qy, halfWidth, sigRowH);
  qy = drawFieldRow(doc, 'Signature', '', leftCol, qy, halfWidth, sigRowH);

  let ay = y;
  ay = drawFieldRow(doc, 'Authorized By', '', rightCol, ay, rightHalf, sigRowH);
  ay = drawFieldRow(doc, 'Date', '', rightCol, ay, rightHalf, sigRowH);
  ay = drawFieldRow(doc, 'Signature', '', rightCol, ay, rightHalf, sigRowH);

  y = Math.max(qy, ay) + 5;

  // ═══════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Sucro Can Canada Inc. | Hamilton Sherman Plant | sucrosourcing.com', pageWidth / 2, y, { align: 'center' });
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
  lotCodes,
  qaProducts,
}: GenerateCoaParams): void {
  // Resolve the lot codes assigned to this shipment
  const assignedLotNums = shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : []);
  const shipmentLotCodes = assignedLotNums
    .map(ln => lotCodes.find(lc => lc.lotNumber === ln))
    .filter((lc): lc is LotCode => !!lc);

  // Determine sugar type from lot codes or QA product. Use the bare
  // lookup name for the QA hit; the display-string is reserved for any
  // user-facing fields.
  const displayProductName = order?.product || shipment.product || '';
  const lookupProductName = order?.lineItems?.[0]?.productName || shipment.product || displayProductName;
  const productName = displayProductName;
  const qaProduct =
    qaProducts.find(p => p.skuName === lookupProductName) ||
    qaProducts.find(p => p.skuName === productName);
  const sugarType = shipmentLotCodes.length > 0
    ? shipmentLotCodes[0].sugarType
    : (qaProduct?.sugarType || '');

  // Get specification values from the QA product table
  const specs = qaProduct?.specifications;

  // Build the parameter list based on sugar type
  let templateSubtitle: string;
  let parameters: { name: string; spec: string; unit: string; key: string | null }[];

  if (isLiquidSugar(sugarType)) {
    templateSubtitle = 'LIQUID SUGAR';
    parameters = [
      { name: 'Brix', spec: specs?.brix || '', unit: '°Bx', key: 'brix' },
      { name: 'Color (ICUMSA)', spec: specs?.color || '', unit: 'IU', key: 'color' },
      { name: 'pH', spec: '', unit: '', key: 'ph' },
      { name: 'Temperature', spec: '', unit: '°C', key: 'temperature' },
      { name: 'Invert Sugar', spec: '', unit: '%', key: 'invert' },
      { name: 'Ash (Conductivity)', spec: specs?.ash || '', unit: '%', key: 'ash' },
      { name: 'Moisture', spec: specs?.moisture || '', unit: '%', key: 'moisture' },
      { name: 'Turbidity', spec: specs?.turbidity || '', unit: 'NTU', key: null },
      { name: 'Odour / Flavour', spec: 'Normal', unit: '', key: null },
    ];
  } else {
    templateSubtitle = 'GRANULATED SUGAR';
    parameters = [
      { name: 'Polarization / Brix', spec: specs?.brix || '', unit: '°Z / °Bx', key: 'brix' },
      { name: 'Color (ICUMSA)', spec: specs?.color || '', unit: 'IU', key: 'color' },
      { name: 'Moisture', spec: specs?.moisture || '', unit: '%', key: 'moisture' },
      { name: 'Ash (Conductivity)', spec: specs?.ash || '', unit: '%', key: 'ash' },
      { name: 'Invert Sugar', spec: '', unit: '%', key: 'invert' },
      { name: 'Granulation', spec: specs?.granulation || '', unit: '', key: null },
      { name: 'Odour / Flavour', spec: 'Normal', unit: '', key: null },
      { name: 'pH', spec: '', unit: '', key: 'ph' },
      { name: 'Temperature', spec: '', unit: '°C', key: 'temperature' },
    ];
  }

  generateCoaPage(
    doc,
    shipment,
    order,
    customer,
    shipFromLocation,
    shipmentLotCodes,
    qaProducts,
    templateSubtitle,
    parameters,
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
