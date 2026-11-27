import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { renderTemplateGridInto } from './templateGridPdf';
import { docTemplate } from './docTemplates';

/** Everything the Sales Contract draws from one contract. `tokens` are the
 *  "Sales Contract" template's {{tokens}} (case-insensitive); `items` fill any
 *  {{item_…}} row the template has (one per contract product line); `fields`
 *  drive the built-in layout used when the template isn't loaded. */
export interface SalesAgreementData {
  tokens: Record<string, string>;
  items: Array<Record<string, string>>;
  fields: Array<{ label: string; value: string }>;
  filename: string;
}

/**
 * Build the Sales Contract PDF for a contract.
 * When the "Sales Contract" template (QA Templates table) is loaded, the page
 * is drawn FROM THE TEMPLATE with its {{tokens}} filled — the agreement's
 * wording (force majeure, governing law, …) lives in the template sheet, never
 * in the code. Otherwise a plain built-in summary of the terms is drawn.
 */
export function generateSalesAgreementPdf(d: SalesAgreementData): { blobUrl: string; blob: Blob; filename: string; fromTemplate: boolean } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const tpl = docTemplate('salesAgreement');
  if (tpl) {
    // Long legal document: full page width, continued onto further pages.
    renderTemplateGridInto(doc, tpl.grid, { tokens: d.tokens, items: d.items, logoDataUrl: tpl.logo, paginate: true });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor('#141414');
    doc.text('Sales Contract', 14, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Sucro Canada', 14, 26);
    autoTable(doc, {
      startY: 32,
      body: d.fields.map(f => [f.label, f.value || '']),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2.5, textColor: '#141414' },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, fillColor: [245, 245, 245] } },
    });
    if (d.items.length > 1) {
      autoTable(doc, {
        startY: ((doc as any).lastAutoTable?.finalY || 32) + 6,
        head: [['Product', 'Differential (/MT)', 'Price (/MT)']],
        body: d.items.map(i => [i.product || '', i.differential || '', i.price_mt || '']),
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2.5, textColor: '#141414' },
        headStyles: { fillColor: [20, 20, 20], textColor: [228, 227, 224] },
      });
    }
  }
  const blob = doc.output('blob');
  return { blobUrl: URL.createObjectURL(blob), blob, filename: d.filename, fromTemplate: !!tpl };
}
