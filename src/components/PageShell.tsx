// Standard page layout — every page should be built from this so headers,
// search and filters sit in the same place everywhere:
//
//   ┌ PageBanner (black) ── icon · TITLE · N records ──── [actions…] [Export Excel] ┐
//   ├ Toolbar (white) ───── [🔍 search……………]  [filters…]                [toolbarRight] ┤
//   └ Content ───────────── padded area holding the page's DataTable(s) / cards      ┘
//
// Banner actions use <BannerButton> so every page's buttons look the same and
// sit in the same order (Template · Import · Sync · Add — Export Excel is always
// last and automatic). The toolbar row is only drawn when the page has a
// search box or filters.

import React from 'react';
import { Search, X } from 'lucide-react';
import PageBanner from './PageBanner';
import type { SheetSpec } from '../utils/exportExcel';

export interface PageShellProps {
  icon?: React.ReactNode;
  title: string;
  /** Record count shown in the banner (usually the filtered row count). */
  count?: number;
  exportSheets?: SheetSpec[] | (() => SheetSpec[]);
  exportFileName?: string;
  /** Banner buttons (use <BannerButton>), rendered before Export Excel. */
  actions?: React.ReactNode;
  /** Page search box — always the first item of the toolbar row. */
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  /** Page filters (location, fiscal year, toggles…) — right of the search box.
   *  Use <ToolbarSelect> / <ToolbarToggle> for a uniform look. */
  filters?: React.ReactNode;
  /** Extra toolbar content pinned to the right (rare — e.g. a summary). */
  toolbarRight?: React.ReactNode;
  children: React.ReactNode;
}

export default function PageShell({ icon, title, count, exportSheets, exportFileName, actions, search, filters, toolbarRight, children }: PageShellProps) {
  return (
    <div>
      <PageBanner icon={icon} title={title} count={count} exportSheets={exportSheets} exportFileName={exportFileName}>
        {actions}
      </PageBanner>
      <PageToolbar search={search} filters={filters} toolbarRight={toolbarRight} />
      <div className="p-6 space-y-6">{children}</div>
    </div>
  );
}

/** The standard toolbar row on its own — for pages that keep their own
 *  <PageBanner> (drop it directly under the banner). Renders nothing when
 *  there is no search / filter content. */
export function PageToolbar({ search, filters, toolbarRight }: Pick<PageShellProps, 'search' | 'filters' | 'toolbarRight'>) {
  if (!(search || filters || toolbarRight)) return null;
  return (
    <div data-page-toolbar-zone="" className="bg-white border-b border-[#141414] px-6 py-3 flex flex-wrap items-center gap-3">
      {search && <ToolbarSearch {...search} />}
      {filters && <div className="flex flex-wrap items-center gap-3">{filters}</div>}
      {/* Right end of the toolbar — the ONE place a page's Columns button lives.
          Page-mode DataTables portal their Columns menu into this slot. */}
      <div data-page-toolbar-slot="" className="ml-auto flex items-center gap-3">{toolbarRight}</div>
    </div>
  );
}

/** Standard banner action button. `primary` = the page's main action (Add X). */
export function BannerButton({ icon, children, onClick, primary, disabled, title }: {
  icon?: React.ReactNode; children: React.ReactNode; onClick?: () => void;
  primary?: boolean; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-50 ${primary ? 'bg-white/10 hover:bg-white/20' : 'hover:bg-white/10'}`}
    >
      {icon}{children}
    </button>
  );
}

/** Standard toolbar search box. */
export function ToolbarSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[240px] max-w-xl">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 pointer-events-none" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || 'Search…'}
        className="w-full bg-[#F5F5F5] border border-[#141414] pl-9 pr-8 py-2 text-xs focus:bg-white focus:outline-none placeholder:opacity-50"
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Standard labelled toolbar dropdown (location, fiscal year, status…). */
export function ToolbarSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
      <span className="opacity-50">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-[#F5F5F5] border border-[#141414] px-2 py-2 text-xs normal-case tracking-normal font-normal focus:bg-white focus:outline-none">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Standard on/off toolbar toggle (e.g. "Show previous weeks", "Show hidden"). */
export function ToolbarToggle({ label, checked, onChange, disabled, title, icon }: {
  label: React.ReactNode; checked: boolean; onChange: (v: boolean) => void;
  disabled?: boolean; title?: string; icon?: React.ReactNode;
}) {
  return (
    <button onClick={() => onChange(!checked)} disabled={disabled} title={title}
      className={`px-3 py-2 border border-[#141414] text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${checked ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white hover:bg-[#F5F5F5]'}`}>
      {icon}{label}
    </button>
  );
}
