// Standard table template used across the app for "sub-tables" inside a page
// (e.g. Fuel Surcharges on Supply Chain, Freight Rates, Shipping Terms, etc).
//
// Behaviour contract — every refactored table follows these rules:
//   1. Black banner with a title + record count + a single primary "+ Add X"
//      button. NO actions column at the row level.
//   2. Rows are clickable; clicking opens the parent-controlled detail modal.
//      The parent passes onRowClick to wire that up.
//   3. Sortable columns: click a header to toggle asc → desc → off.
//   4. No inline editing. All Add / Edit / Delete actions happen inside
//      the detail modal (see DetailModal.tsx).
//
// The component is intentionally generic — pass columns + rows + onRowClick.

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

export interface DataTableColumn<T> {
  /** Unique key — typically a property name on T. Used for sort + key. */
  key: string;
  /** Header label shown in the banner row of the table. */
  label: string;
  /** Optional cell renderer. Receives the row and returns whatever to display. */
  render?: (row: T) => React.ReactNode;
  /** Sort accessor — defaults to row[key]. Use for derived sort keys. */
  sortValue?: (row: T) => string | number;
  /** Visual alignment of the cell content. */
  align?: 'left' | 'right' | 'center';
  /** Render the cell content in font-mono. */
  mono?: boolean;
  /** Render the cell content in bold. */
  bold?: boolean;
  /** Optional width / min-width Tailwind class (e.g. "w-32"). */
  widthClass?: string;
  /** Set to false to disable sorting on this column. Defaults true. */
  sortable?: boolean;
}

interface DataTableProps<T> {
  /** Plain section title, e.g. "Fuel Surcharges". The banner renders this
   *  in uppercase tracking-widest matching the rest of the app. */
  title: string;
  /** Optional icon shown before the title (lucide-react element). */
  icon?: React.ReactNode;
  /** Column definitions. */
  columns: DataTableColumn<T>[];
  /** Row data. */
  rows: T[];
  /** Stable React key extractor — typically `row.id`. */
  getRowKey: (row: T) => string;
  /** Called when a row is clicked. Use this to open the detail modal. */
  onRowClick?: (row: T) => void;
  /** Called when the "+ Add X" button is clicked. When omitted, the
   *  button is hidden — useful for read-only tables. */
  onAdd?: () => void;
  /** Label for the Add button, e.g. "Add Surcharge". Default: "Add". */
  addLabel?: string;
  /** Text shown when there are no rows. */
  emptyMessage?: string;
  /** Optional default sort key + direction. */
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
}

export default function DataTable<T>({
  title,
  icon,
  columns,
  rows,
  getRowKey,
  onRowClick,
  onAdd,
  addLabel = 'Add',
  emptyMessage = 'No records yet.',
  defaultSortKey,
  defaultSortDir = 'asc',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey || null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find(c => c.key === sortKey);
    if (!col) return rows;
    const accessor = col.sortValue || ((row: T) => (row as any)[sortKey] ?? '');
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string, sortable: boolean) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
      {/* Banner */}
      <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <span className="text-[10px] opacity-50 font-mono">{rows.length} records</span>
        </div>
        {onAdd && (
          <button
            onClick={onAdd}
            className="px-3 py-1.5 bg-white/10 text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/20 transition-all whitespace-nowrap"
          >
            <Plus size={12} /> {addLabel}
          </button>
        )}
      </div>

      {/* Table */}
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
            {columns.map(col => {
              const sortable = col.sortable !== false;
              const isActive = sortKey === col.key;
              return (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key, sortable)}
                  className={`p-3 border-r border-[#141414]/10 ${col.widthClass || ''} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${sortable ? 'cursor-pointer select-none hover:bg-[#141414]/5' : ''}`}
                >
                  {col.label}
                  {sortable && isActive && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#141414]/10">
          {sorted.map(row => (
            <tr
              key={getRowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={`hover:bg-[#F9F9F9] transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
            >
              {columns.map(col => {
                const value = col.render
                  ? col.render(row)
                  : (row as any)[col.key];
                return (
                  <td
                    key={col.key}
                    className={`p-3 text-xs border-r border-[#141414]/10 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.mono ? 'font-mono' : ''} ${col.bold ? 'font-bold' : ''}`}
                  >
                    {value ?? '—'}
                  </td>
                );
              })}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-8 text-center text-xs opacity-50 italic">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
