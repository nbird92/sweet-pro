import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ColumnFormat = 'text' | 'number' | 'currency' | 'percent' | 'integer' | 'date';

export interface SheetColumn {
  /** Column header label shown in the dark header row */
  header: string;
  /** Key used to look up the value in each row object */
  key: string;
  /** Optional fixed column width (characters). Auto-sized if omitted. */
  width?: number;
  /** Optional cell format. Defaults to 'text'. */
  format?: ColumnFormat;
}

export interface SheetSpec {
  /** Worksheet tab name (truncated/sanitized for Excel's 31-char limit) */
  sheetName: string;
  /** Column definitions in display order */
  columns: SheetColumn[];
  /** Row objects keyed by column.key */
  rows: Record<string, any>[];
  /** Optional title shown above the table */
  title?: string;
  /** Optional subtitle (e.g. record count / generated date) */
  subtitle?: string;
}

// ─── Style constants (match the Sweet Pro design system) ────────────────────

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF141414' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFE4E3E0' }, size: 10 };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14 };
const SUBTITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10, color: { argb: 'FF666666' } };
const ALT_ROW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };

const CURRENCY_FMT = '$#,##0.00';
const NUMBER_FMT = '#,##0.00';
const PCT_FMT = '0.0%';
const INT_FMT = '#,##0';

function fmtFor(format: ColumnFormat | undefined): string | undefined {
  switch (format) {
    case 'currency': return CURRENCY_FMT;
    case 'number': return NUMBER_FMT;
    case 'percent': return PCT_FMT;
    case 'integer': return INT_FMT;
    default: return undefined;
  }
}

function isRightAligned(format: ColumnFormat | undefined): boolean {
  return format === 'currency' || format === 'number' || format === 'percent' || format === 'integer';
}

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
function sanitizeSheetName(name: string, used: Set<string>): string {
  let clean = (name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = clean;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

// ─── Builder ────────────────────────────────────────────────────────────────

function buildSheet(wb: ExcelJS.Workbook, spec: SheetSpec, usedNames: Set<string>) {
  const ws = wb.addWorksheet(sanitizeSheetName(spec.sheetName, usedNames));

  // Title / subtitle
  if (spec.title) {
    const tRow = ws.addRow([spec.title]);
    tRow.getCell(1).font = TITLE_FONT;
    tRow.height = 24;
  }
  if (spec.subtitle) {
    const sRow = ws.addRow([spec.subtitle]);
    sRow.getCell(1).font = SUBTITLE_FONT;
    sRow.height = 18;
  }
  if (spec.title || spec.subtitle) ws.addRow([]); // spacer

  // Header row
  const headerRowNum = ws.rowCount + 1;
  ws.addRow(spec.columns.map(c => c.header));
  const headerRow = ws.getRow(headerRowNum);
  headerRow.eachCell((cell, colNum) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    const col = spec.columns[colNum - 1];
    cell.alignment = { vertical: 'middle', horizontal: isRightAligned(col?.format) ? 'right' : 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF141414' } } };
  });
  headerRow.height = 22;

  // Data rows
  spec.rows.forEach((row, idx) => {
    const values = spec.columns.map(c => {
      const v = row[c.key];
      if (v == null) return '';
      if ((c.format === 'number' || c.format === 'currency' || c.format === 'percent' || c.format === 'integer')) {
        const num = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,%\s]/g, ''));
        return Number.isFinite(num) ? num : '';
      }
      return v;
    });
    const r = ws.addRow(values);
    spec.columns.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      const f = fmtFor(c.format);
      if (f) cell.numFmt = f;
      if (isRightAligned(c.format)) cell.alignment = { horizontal: 'right' };
    });
    if (idx % 2 === 1) {
      r.eachCell({ includeEmpty: true }, (cell) => { cell.fill = ALT_ROW_FILL; });
    }
  });

  // Column widths
  spec.columns.forEach((c, ci) => {
    if (c.width) {
      ws.getColumn(ci + 1).width = c.width;
    } else {
      const headerLen = c.header.length;
      let maxLen = headerLen;
      for (const row of spec.rows) {
        const v = row[c.key];
        const len = v == null ? 0 : String(v).length;
        if (len > maxLen) maxLen = len;
      }
      ws.getColumn(ci + 1).width = Math.min(Math.max(maxLen + 2, 10), 50);
    }
  });

  // Freeze the header row
  ws.views = [{ state: 'frozen', ySplit: headerRowNum }];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Export one or more tables to a single styled .xlsx workbook.
 * Multi-table pages pass multiple sheets; each becomes its own worksheet.
 */
export async function exportSheetsToExcel(sheets: SheetSpec[], fileBaseName: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sweet Pro';
  wb.created = new Date();

  const usedNames = new Set<string>();
  const valid = sheets.filter(s => s && s.columns && s.columns.length > 0);
  if (valid.length === 0) {
    // Still produce an (almost) empty workbook so the user gets feedback
    buildSheet(wb, { sheetName: 'Empty', columns: [{ header: 'No data', key: 'x' }], rows: [] }, usedNames);
  } else {
    for (const s of valid) buildSheet(wb, s, usedNames);
  }

  const buf = await wb.xlsx.writeBuffer();
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeName = (fileBaseName || 'Export').replace(/[^a-z0-9_-]+/gi, '_');
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `SweetPro_${safeName}_${dateStr}.xlsx`,
  );
}
