import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { exportSheetsToExcel } from '../utils/exportExcel';
import type { SheetSpec } from '../utils/exportExcel';

interface PageBannerProps {
  /** Icon element (e.g. <ShoppingCart size={18} />) */
  icon?: React.ReactNode;
  /** Page title shown in the banner */
  title: string;
  /** Optional record count shown next to the title */
  count?: number;
  /** Sheets to export, or a function returning them (lazy — evaluated on click) */
  exportSheets?: SheetSpec[] | (() => SheetSpec[]);
  /** Base file name for the exported workbook */
  exportFileName?: string;
  /** Page-specific action buttons (Template / Import CSV / Add X) rendered before Export Excel */
  children?: React.ReactNode;
}

/**
 * Uniform page banner used at the very top of every page.
 * Black bar, icon + title + record count on the left, action buttons on the right.
 * Always renders an "Export Excel" button wired to the shared multi-sheet exporter.
 */
export default function PageBanner({
  icon,
  title,
  count,
  exportSheets,
  exportFileName,
  children,
}: PageBannerProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (!exportSheets || busy) return;
    setBusy(true);
    try {
      const sheets = typeof exportSheets === 'function' ? exportSheets() : exportSheets;
      await exportSheetsToExcel(sheets, exportFileName || title.replace(/\s+/g, '_'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex justify-between items-center">
      <div className="flex items-center gap-4">
        {icon}
        <h2 className="text-sm font-bold uppercase tracking-widest">{title}</h2>
        {typeof count === 'number' && (
          <span className="text-[10px] opacity-50 font-mono">{count} records</span>
        )}
      </div>
      <div className="flex items-stretch divide-x divide-[#E4E3E0]/20">
        {children}
        {exportSheets && (
          <button
            onClick={handleExport}
            disabled={busy}
            className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all disabled:opacity-50 whitespace-nowrap"
            title="Export this page's tables to a formatted Excel workbook"
          >
            <FileSpreadsheet size={12} /> {busy ? 'Exporting…' : 'Export Excel'}
          </button>
        )}
      </div>
    </div>
  );
}
