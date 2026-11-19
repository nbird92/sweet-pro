import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { renderTemplateGridInto } from './templateGridPdf';
import { docTemplate } from './docTemplates';

/** One labelled field of the sample request (used by the built-in layout). */
export interface SampleRequestField { label: string; value: string }

/**
 * Build the Sample Request form PDF.
 * When the "Sample Request" template (QA Templates table) is loaded, the page
 * is drawn FROM THE TEMPLATE with its {{tokens}} filled. Otherwise a simple
 * built-in form listing every field is drawn.
 */
export function generateSampleRequestPdf(p: {
  tokens: Record<string, string>;
  fields: SampleRequestField[];
  filename: string;
  /** "X " mark labels (e.g. "Mail Sample") for checkbox cells in the template. */
  marks?: string[];
}): { blob: Blob; filename: string; fromTemplate: boolean } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const tpl = docTemplate('sampleRequest');
  if (tpl) {
    renderTemplateGridInto(doc, tpl.grid, { tokens: p.tokens, marks: p.marks, logoDataUrl: tpl.logo });
    return { blob: doc.output('blob'), filename: p.filename, fromTemplate: true };
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor('#141414');
  doc.text('Sample Request', 14, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Sucro Canada', 14, 26);
  autoTable(doc, {
    startY: 32,
    body: p.fields.map(f => [f.label, f.value || '']),
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2.5, textColor: '#141414' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 50, fillColor: [245, 245, 245] } },
  });
  return { blob: doc.output('blob'), filename: p.filename, fromTemplate: false };
}
