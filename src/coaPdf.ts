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
const GREEN = [0, 128, 0] as const;

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

function drawLabelValue(doc: jsPDF, label: string, value: string, x: number, y: number, labelW: number, valueW: number, h: number) {
  doc.setDrawColor(100, 100, 100);
  doc.rect(x, y, labelW, h, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(label, x + 2, y + h / 2 + 1);
  doc.rect(x + labelW, y, valueW, h, 'S');
  doc.setFont('helvetica', 'normal');
  doc.text(value || '', x + labelW + 2, y + h / 2 + 1);
}

function isLiquidSugar(sugarType: string): boolean {
  const lower = sugarType.toLowerCase();
  return lower.includes('liquid') || lower.includes('molasses');
}

// ============================================================
// GRANULATED COA — Hamilton Granulated COA template
// ============================================================
function generateGranulatedCoa(
  doc: jsPDF,
  params: GenerateCoaParams & { shipmentLotCodes: LotCode[] }
) {
  const { shipment, order, customer, shipFromLocation, shipmentLotCodes, qaProducts } = params;
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 12;
  const W = pageWidth - M * 2;
  const halfW = W / 2;
  const L = M;
  const R = M + halfW;
  const rh = 7;
  const lblW = 38;
  const valW = halfW - lblW;

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);

  // ── HEADER ──
  let y = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BLACK);
  doc.text('Certificate of Analysis', pageWidth / 2, y + 6, { align: 'center' });
  doc.setFontSize(11);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text('Sucro Can Canada Inc.', pageWidth / 2, y + 14, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('Hamilton Sherman Plant', pageWidth / 2, y + 19, { align: 'center' });
  doc.setTextColor(BLACK);
  y += 26;

  // ── PRODUCT & SHIPMENT INFO ──
  y = drawBlackHeader(doc, 'PRODUCT & SHIPMENT INFORMATION', L, y, W) + 0;

  const productName = shipment.product || order?.product || '';
  const qaProduct = qaProducts.find(p => p.skuName === productName);
  const lotNums = shipmentLotCodes.map(lc => lc.lotNumber).join(', ');
  const origins = [...new Set(shipmentLotCodes.map(lc => lc.countryOfOrigin).filter(Boolean))].join(', ');
  const bolNum = shipment.bol || order?.bolNumber || '';
  const category = shipmentLotCodes.length > 0 ? shipmentLotCodes[0].category : (qaProduct?.category || '');

  drawLabelValue(doc, 'Product:', productName, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'BOL #:', bolNum, R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Customer:', customer?.name || shipment.customer || '', L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Customer PO #:', order?.po || shipment.po || '', R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Lot Code(s):', lotNums, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Ship Date:', shipment.date || '', R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Country of Origin:', origins, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Category:', category, R, y, lblW, valW, rh);
  y += rh;

  const shipperName = shipFromLocation?.name || order?.location || 'Hamilton Sherman Plant';
  drawLabelValue(doc, 'Ship From:', shipperName, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Quantity:', shipment.qty ? `${shipment.qty} MT` : '', R, y, lblW, valW, rh);
  y += rh + 3;

  // ── SPECIFICATIONS vs ACTUAL RESULTS TABLE ──
  y = drawBlackHeader(doc, 'QUALITY ANALYSIS', L, y, W) + 0;

  // Determine spec values from QA product
  const specs = qaProduct?.specifications;

  // Build rows for each lot code
  const hasMultiple = shipmentLotCodes.length > 1;

  // Granulated parameters
  const parameters = [
    { name: 'Polarization / Brix', spec: specs?.brix || '99.80 Min', unit: '°Z / °Bx', key: 'brix' as const },
    { name: 'Color (ICUMSA)', spec: specs?.color || '45 Max', unit: 'IU', key: 'color' as const },
    { name: 'Moisture', spec: specs?.moisture || '0.04 Max', unit: '%', key: 'moisture' as const },
    { name: 'Ash (Conductivity)', spec: specs?.ash || '0.04 Max', unit: '%', key: 'ash' as const },
    { name: 'Invert Sugar', spec: '', unit: '%', key: 'invert' as const },
    { name: 'Granulation', spec: specs?.granulation || '', unit: '', key: null },
    { name: 'Odour / Flavour', spec: 'Normal', unit: '', key: null },
    { name: 'pH', spec: '', unit: '', key: 'ph' as const },
    { name: 'Temperature', spec: '', unit: '°C', key: 'temperature' as const },
  ];

  if (hasMultiple) {
    // Multiple lot codes — show each as a column
    const head = [['Parameter', 'Specification', 'Unit', ...shipmentLotCodes.map(lc => lc.lotNumber)]];
    const body = parameters.map(p => {
      const row: string[] = [p.name, p.spec, p.unit];
      shipmentLotCodes.forEach(lc => {
        if (p.key === null) {
          if (p.name.includes('Odour')) row.push(lc.flavourOdourOk === 'Yes' ? 'Normal' : lc.flavourOdourOk === 'No' ? 'Abnormal' : '');
          else if (p.name.includes('Granulation')) row.push('');
          else row.push('');
        } else {
          row.push(lc[p.key] || '');
        }
      });
      return row;
    });

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [100, 100, 100], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: 30 },
        2: { cellWidth: 18, halign: 'center' },
      },
    });
  } else {
    // Single lot code
    const lc = shipmentLotCodes[0];
    const head = [['Parameter', 'Specification', 'Unit', 'Result']];
    const body = parameters.map(p => {
      let result = '';
      if (lc) {
        if (p.key === null) {
          if (p.name.includes('Odour')) result = lc.flavourOdourOk === 'Yes' ? 'Normal' : lc.flavourOdourOk === 'No' ? 'Abnormal' : '';
          else if (p.name.includes('Granulation')) result = '';
        } else {
          result = lc[p.key] || '';
        }
      }
      return [p.name, p.spec, p.unit, result];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [100, 100, 100], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 48 },
        1: { cellWidth: 40 },
        2: { cellWidth: 22, halign: 'center' },
        3: { halign: 'center' },
      },
    });
  }

  y = (doc as any).lastAutoTable?.finalY || y + 60;
  y += 5;

  // ── TESTER INFORMATION ──
  const testers = [...new Set(shipmentLotCodes.map(lc => lc.testerName).filter(Boolean))].join(', ');
  const testDates = [...new Set(shipmentLotCodes.map(lc => lc.date).filter(Boolean))].join(', ');

  drawLabelValue(doc, 'Tested By:', testers, L, y, lblW, W - lblW, rh);
  y += rh;
  drawLabelValue(doc, 'Test Date(s):', testDates, L, y, lblW, W - lblW, rh);
  y += rh + 5;

  // ── CERTIFICATION ──
  y = drawBlackHeader(doc, 'CERTIFICATION', L, y, W) + 0;
  drawRect(doc, L, y, W, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(
    'We hereby certify that the above product has been tested and the results are as shown above.',
    L + 3, y + 5
  );
  doc.text(
    'This product complies with all applicable food safety regulations and is fit for human consumption.',
    L + 3, y + 10
  );
  y += 22;

  // ── SIGNATURES ──
  y += 3;
  const sigLbl = 32;
  const sigW = halfW - sigLbl;
  drawLabelValue(doc, 'QA Approved By:', '', L, y, sigLbl, sigW, 12);
  drawLabelValue(doc, 'Date:', '', R, y, 20, halfW - 20, 12);
  y += 14;

  drawLabelValue(doc, 'Authorized By:', '', L, y, sigLbl, sigW, 12);
  drawLabelValue(doc, 'Date:', '', R, y, 20, halfW - 20, 12);
  y += 16;

  // ── FOOTER ──
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text('Sucro Can Canada Inc. | Hamilton Sherman Plant | www.sucrocan.com', pageWidth / 2, y, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleDateString('en-CA')}`, pageWidth / 2, y + 4, { align: 'center' });
}

// ============================================================
// LIQUID COA — Hamilton Liquid COA template
// ============================================================
function generateLiquidCoa(
  doc: jsPDF,
  params: GenerateCoaParams & { shipmentLotCodes: LotCode[] }
) {
  const { shipment, order, customer, shipFromLocation, shipmentLotCodes, qaProducts } = params;
  const pageWidth = doc.internal.pageSize.getWidth();
  const M = 12;
  const W = pageWidth - M * 2;
  const halfW = W / 2;
  const L = M;
  const R = M + halfW;
  const rh = 7;
  const lblW = 38;
  const valW = halfW - lblW;

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.3);

  // ── HEADER ──
  let y = 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BLACK);
  doc.text('Certificate of Analysis', pageWidth / 2, y + 6, { align: 'center' });
  doc.setFontSize(11);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text('Sucro Can Canada Inc.', pageWidth / 2, y + 14, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text('Hamilton Sherman Plant — Liquid Sugar', pageWidth / 2, y + 19, { align: 'center' });
  doc.setTextColor(BLACK);
  y += 26;

  // ── PRODUCT & SHIPMENT INFO ──
  y = drawBlackHeader(doc, 'PRODUCT & SHIPMENT INFORMATION', L, y, W) + 0;

  const productName = shipment.product || order?.product || '';
  const qaProduct = qaProducts.find(p => p.skuName === productName);
  const lotNums = shipmentLotCodes.map(lc => lc.lotNumber).join(', ');
  const origins = [...new Set(shipmentLotCodes.map(lc => lc.countryOfOrigin).filter(Boolean))].join(', ');
  const bolNum = shipment.bol || order?.bolNumber || '';
  const category = shipmentLotCodes.length > 0 ? shipmentLotCodes[0].category : (qaProduct?.category || '');

  drawLabelValue(doc, 'Product:', productName, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'BOL #:', bolNum, R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Customer:', customer?.name || shipment.customer || '', L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Customer PO #:', order?.po || shipment.po || '', R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Lot Code(s):', lotNums, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Ship Date:', shipment.date || '', R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Country of Origin:', origins, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Category:', category, R, y, lblW, valW, rh);
  y += rh;

  const shipperName = shipFromLocation?.name || order?.location || 'Hamilton Sherman Plant';
  drawLabelValue(doc, 'Ship From:', shipperName, L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Quantity:', shipment.qty ? `${shipment.qty} MT` : '', R, y, lblW, valW, rh);
  y += rh;

  drawLabelValue(doc, 'Tank #:', [...new Set(shipmentLotCodes.map(lc => lc.tankNumber).filter(Boolean))].join(', '), L, y, lblW, valW, rh);
  drawLabelValue(doc, 'Silo:', [...new Set(shipmentLotCodes.map(lc => lc.silo).filter(Boolean))].join(', '), R, y, lblW, valW, rh);
  y += rh + 3;

  // ── QUALITY ANALYSIS TABLE ──
  y = drawBlackHeader(doc, 'QUALITY ANALYSIS', L, y, W) + 0;

  const specs = qaProduct?.specifications;

  // Liquid-specific parameters
  const parameters = [
    { name: 'Brix', spec: specs?.brix || '67.0 Min', unit: '°Bx', key: 'brix' as const },
    { name: 'Color (ICUMSA)', spec: specs?.color || '45 Max', unit: 'IU', key: 'color' as const },
    { name: 'pH', spec: '', unit: '', key: 'ph' as const },
    { name: 'Temperature', spec: '', unit: '°C', key: 'temperature' as const },
    { name: 'Invert Sugar', spec: '', unit: '%', key: 'invert' as const },
    { name: 'Ash (Conductivity)', spec: specs?.ash || '', unit: '%', key: 'ash' as const },
    { name: 'Turbidity', spec: specs?.turbidity || '', unit: 'NTU', key: null },
    { name: 'Odour / Flavour', spec: 'Normal', unit: '', key: null },
  ];

  const hasMultiple = shipmentLotCodes.length > 1;

  if (hasMultiple) {
    const head = [['Parameter', 'Specification', 'Unit', ...shipmentLotCodes.map(lc => lc.lotNumber)]];
    const body = parameters.map(p => {
      const row: string[] = [p.name, p.spec, p.unit];
      shipmentLotCodes.forEach(lc => {
        if (p.key === null) {
          if (p.name.includes('Odour')) row.push(lc.flavourOdourOk === 'Yes' ? 'Normal' : lc.flavourOdourOk === 'No' ? 'Abnormal' : '');
          else row.push('');
        } else {
          row.push(lc[p.key] || '');
        }
      });
      return row;
    });

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [100, 100, 100], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: 30 },
        2: { cellWidth: 18, halign: 'center' },
      },
    });
  } else {
    const lc = shipmentLotCodes[0];
    const head = [['Parameter', 'Specification', 'Unit', 'Result']];
    const body = parameters.map(p => {
      let result = '';
      if (lc) {
        if (p.key === null) {
          if (p.name.includes('Odour')) result = lc.flavourOdourOk === 'Yes' ? 'Normal' : lc.flavourOdourOk === 'No' ? 'Abnormal' : '';
        } else {
          result = lc[p.key] || '';
        }
      }
      return [p.name, p.spec, p.unit, result];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head,
      body,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [100, 100, 100], lineWidth: 0.3, textColor: [20, 20, 20] },
      headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 48 },
        1: { cellWidth: 40 },
        2: { cellWidth: 22, halign: 'center' },
        3: { halign: 'center' },
      },
    });
  }

  y = (doc as any).lastAutoTable?.finalY || y + 60;
  y += 5;

  // ── TESTER INFORMATION ──
  const testers = [...new Set(shipmentLotCodes.map(lc => lc.testerName).filter(Boolean))].join(', ');
  const testDates = [...new Set(shipmentLotCodes.map(lc => lc.date).filter(Boolean))].join(', ');

  drawLabelValue(doc, 'Tested By:', testers, L, y, lblW, W - lblW, rh);
  y += rh;
  drawLabelValue(doc, 'Test Date(s):', testDates, L, y, lblW, W - lblW, rh);
  y += rh + 5;

  // ── CERTIFICATION ──
  y = drawBlackHeader(doc, 'CERTIFICATION', L, y, W) + 0;
  drawRect(doc, L, y, W, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(
    'We hereby certify that the above product has been tested and the results are as shown above.',
    L + 3, y + 5
  );
  doc.text(
    'This product complies with all applicable food safety regulations and is fit for human consumption.',
    L + 3, y + 10
  );
  y += 22;

  // ── SIGNATURES ──
  y += 3;
  const sigLbl = 32;
  const sigW = halfW - sigLbl;
  drawLabelValue(doc, 'QA Approved By:', '', L, y, sigLbl, sigW, 12);
  drawLabelValue(doc, 'Date:', '', R, y, 20, halfW - 20, 12);
  y += 14;

  drawLabelValue(doc, 'Authorized By:', '', L, y, sigLbl, sigW, 12);
  drawLabelValue(doc, 'Date:', '', R, y, 20, halfW - 20, 12);
  y += 16;

  // ── FOOTER ──
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text('Sucro Can Canada Inc. | Hamilton Sherman Plant | www.sucrocan.com', pageWidth / 2, y, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleDateString('en-CA')}`, pageWidth / 2, y + 4, { align: 'center' });
}

// ============================================================
// MAIN EXPORT
// ============================================================
export function generateCoaPdf({
  shipment,
  order,
  customer,
  shipFromLocation,
  lotCodes,
  qaProducts,
}: GenerateCoaParams): { blobUrl: string; filename: string } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  // Resolve the lot codes assigned to this shipment
  const assignedLotNums = shipment.lotNumbers || (shipment.lotNumber ? [shipment.lotNumber] : []);
  const shipmentLotCodes = assignedLotNums
    .map(ln => lotCodes.find(lc => lc.lotNumber === ln))
    .filter((lc): lc is LotCode => !!lc);

  // Determine which template to use based on the sugar type of the lot codes or the product
  const sugarType = shipmentLotCodes.length > 0
    ? shipmentLotCodes[0].sugarType
    : (qaProducts.find(p => p.skuName === (shipment.product || order?.product))?.sugarType || '');

  const params = { shipment, order, customer, shipFromLocation, lotCodes, qaProducts, shipmentLotCodes };

  if (isLiquidSugar(sugarType)) {
    generateLiquidCoa(doc, params);
  } else {
    generateGranulatedCoa(doc, params);
  }

  const bolNum = shipment.bol || order?.bolNumber || '';
  const filename = `COA_${bolNum || 'draft'}_${(shipment.customer || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, filename };
}
