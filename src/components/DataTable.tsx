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
//   5. Columns are drag-to-reorder. The chosen order is persisted per-table in
//      localStorage (keyed by storageKey || title) and reconciled against the
//      live column set on load (new columns appended, removed columns dropped).
//
// The component is intentionally generic — pass columns + rows + onRowClick.

import React, { useMemo, useState, useCallback, useContext, useRef, useEffect } from 'react';
import { Plus, RotateCcw, SlidersHorizontal, Check } from 'lucide-react';

// Optional cross-table column-order store. When an ancestor provides this
// context (App does, backed by Firestore-synced per-user prefs), DataTable reads
// and writes the saved order through it so the choice is PERMANENT across
// sessions/devices. With no provider it falls back to plain localStorage.
export interface ColumnOrderStore {
  get: (tableKey: string) => string[] | undefined;
  set: (tableKey: string, order: string[]) => void;
}
export const ColumnOrderContext = React.createContext<ColumnOrderStore | null>(null);

// Optional cross-table column-VISIBILITY store, mirroring ColumnOrderContext.
// get()/set() carry the list of HIDDEN column keys per table. Backed by the same
// Firestore-synced per-user prefs in App; falls back to localStorage otherwise.
export interface ColumnVisibilityStore {
  get: (tableKey: string) => string[] | undefined;
  set: (tableKey: string, hidden: string[]) => void;
}
export const ColumnVisibilityContext = React.createContext<ColumnVisibilityStore | null>(null);

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
  /** Optional footer row(s) — rendered inside <tfoot>. Caller supplies the
   *  full <tr>...</tr> markup so totals rows keep their custom styling. */
  footer?: React.ReactNode;
  /** When true, the table body scrolls within a bounded height and the header
   *  row stays pinned to the top. Use for long full-page lists. Default off so
   *  existing sub-tables keep their plain horizontal-overflow behaviour. */
  stickyHeader?: boolean;
  /** localStorage key for the saved column order. Defaults to the title.
   *  Pass an explicit key when two tables could share a title. */
  storageKey?: string;
}

const ORDER_PREFIX = 'dt-colorder:';
const HIDDEN_PREFIX = 'dt-colhidden:';
const NATURAL_ORDER: string[] = []; // stable empty reference = "use the caller's column order"
const NO_HIDDEN: string[] = [];      // stable empty reference = "nothing hidden"

// Read a persisted column-key list (order or hidden set) from localStorage.
// Always returns an array of strings (empty when absent / malformed) so callers
// never have to guard.
function loadStringList(prefix: string, id: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(prefix + id);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
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
  footer,
  stickyHeader = false,
  storageKey,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey || null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  // Persisted column order (array of column keys). Empty = use the natural order
  // the caller passed. Drag-and-drop on the headers rewrites this. Source of
  // truth is the ColumnOrderContext store when present (Firestore-synced), else
  // component-local state; localStorage is always written as an instant-load cache.
  const storageId = storageKey || title;
  const store = useContext(ColumnOrderContext);
  const [localOrder, setLocalOrder] = useState<string[]>(() => loadStringList(ORDER_PREFIX, storageId));
  // With a provider, the store is the single source of truth (it's seeded from
  // this device's localStorage at startup and overwritten by the user's Firestore
  // prefs on load) — so absence means "natural order", never the stale local cache.
  const order = store ? (store.get(storageId) ?? NATURAL_ORDER) : localOrder;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  // Hidden-column set, persisted the same way as the order (Firestore-synced store
  // when present, else localStorage). Holds the keys the user has hidden.
  const visStore = useContext(ColumnVisibilityContext);
  const [localHidden, setLocalHidden] = useState<string[]>(() => loadStringList(HIDDEN_PREFIX, storageId));
  const hidden = visStore ? (visStore.get(storageId) ?? NO_HIDDEN) : localHidden;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const persistOrder = useCallback((next: string[]) => {
    if (typeof window !== 'undefined') {
      try {
        if (next.length) window.localStorage.setItem(ORDER_PREFIX + storageId, JSON.stringify(next));
        else window.localStorage.removeItem(ORDER_PREFIX + storageId);
      } catch {
        /* storage full / disabled — cache just won't persist */
      }
    }
    if (store) store.set(storageId, next);
    else setLocalOrder(next);
  }, [store, storageId]);

  const persistHidden = useCallback((next: string[]) => {
    if (typeof window !== 'undefined') {
      try {
        if (next.length) window.localStorage.setItem(HIDDEN_PREFIX + storageId, JSON.stringify(next));
        else window.localStorage.removeItem(HIDDEN_PREFIX + storageId);
      } catch {
        /* storage full / disabled — cache just won't persist */
      }
    }
    if (visStore) visStore.set(storageId, next);
    else setLocalHidden(next);
  }, [visStore, storageId]);

  // Close the column picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  // Apply the saved order to the live columns: saved keys first (only those that
  // still exist), then any brand-new columns appended in their original order.
  const orderedColumns = useMemo(() => {
    if (!order.length) return columns;
    const byKey = new Map(columns.map(c => [c.key, c] as const));
    const result: DataTableColumn<T>[] = [];
    for (const k of order) {
      const c = byKey.get(k);
      if (c) { result.push(c); byKey.delete(k); }
    }
    for (const c of columns) {
      if (byKey.has(c.key)) { result.push(c); byKey.delete(c.key); }
    }
    return result;
  }, [columns, order]);

  // The columns actually rendered: ordered set minus any the user has hidden.
  // Fall back to the full set if a persisted hidden set ever covers every live
  // column (e.g. column keys changed across an app version) — a zero-column table
  // is never a useful state.
  const visibleColumns = useMemo(() => {
    const shown = orderedColumns.filter(c => !hiddenSet.has(c.key));
    return shown.length ? shown : orderedColumns;
  }, [orderedColumns, hiddenSet]);

  // Toggle one column's visibility. Guard against hiding the last visible column
  // (a zero-column table is unusable — the picker stays open to re-enable others).
  const toggleColumn = useCallback((key: string) => {
    if (hiddenSet.has(key)) {
      persistHidden(hidden.filter(k => k !== key));
    } else {
      if (visibleColumns.length <= 1) return;
      persistHidden([...hidden, key]);
    }
  }, [hidden, hiddenSet, visibleColumns.length, persistHidden]);

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

  // Move the dragged column so it lands immediately before the drop target.
  const dropOnColumn = (targetKey: string) => {
    if (dragKey && dragKey !== targetKey) {
      const keys = orderedColumns.map(c => c.key).filter(k => k !== dragKey);
      const to = keys.indexOf(targetKey);
      if (to !== -1) {
        keys.splice(to, 0, dragKey);
        persistOrder(keys);
      }
    }
    setDragKey(null);
    setOverKey(null);
  };

  const isCustomized = order.length > 0 || hidden.length > 0;

  return (
    <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
      {/* Banner */}
      <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <span className="text-[10px] opacity-50 font-mono">{rows.length} records</span>
          {isCustomized && (
            <button
              onClick={() => { persistOrder([]); persistHidden([]); }}
              title="Reset column order & visibility"
              className="text-[9px] uppercase tracking-widest opacity-50 hover:opacity-100 flex items-center gap-1 transition-opacity"
            >
              <RotateCcw size={10} /> reset columns
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Show / hide columns picker */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen(o => !o)}
              title="Show / hide columns"
              className="px-3 py-1.5 bg-white/10 text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/20 transition-all whitespace-nowrap"
            >
              <SlidersHorizontal size={12} /> Columns
              {hidden.length > 0 && (
                <span className="opacity-60 font-mono normal-case">{visibleColumns.length}/{orderedColumns.length}</span>
              )}
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 bg-white text-[#141414] border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] min-w-[240px] max-h-[60vh] overflow-auto py-1">
                <div className="text-[9px] uppercase tracking-widest opacity-50 px-3 py-1.5 border-b border-[#141414]/10 sticky top-0 bg-white">Show columns</div>
                {orderedColumns.map(c => {
                  const isVisible = !hiddenSet.has(c.key);
                  const isLast = isVisible && visibleColumns.length <= 1;
                  return (
                    <button
                      key={c.key}
                      onClick={() => toggleColumn(c.key)}
                      disabled={isLast}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-[#F5F5F5] transition-colors ${isLast ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <span className={`w-3.5 h-3.5 border border-[#141414] flex items-center justify-center shrink-0 ${isVisible ? 'bg-[#141414]' : 'bg-white'}`}>
                        {isVisible && <Check size={10} className="text-white" strokeWidth={3} />}
                      </span>
                      <span className="truncate">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
      </div>

      {/* Table. With stickyHeader the body scrolls within a bounded height and
          the header row stays pinned; otherwise it keeps the original
          horizontal-only overflow. */}
      <div className={stickyHeader ? 'overflow-auto max-h-[calc(100vh-16rem)]' : 'overflow-x-auto'}>
      <table className="w-full text-left border-collapse">
        <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
          <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
            {visibleColumns.map(col => {
              const sortable = col.sortable !== false;
              const isActive = sortKey === col.key;
              const isDragging = dragKey === col.key;
              const isDropTarget = overKey === col.key && dragKey !== null && dragKey !== col.key;
              return (
                <th
                  key={col.key}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(col.key);
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', col.key); } catch { /* some browsers reject */ }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (overKey !== col.key) setOverKey(col.key);
                  }}
                  onDragLeave={() => setOverKey(k => (k === col.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); dropOnColumn(col.key); }}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  onClick={() => toggleSort(col.key, sortable)}
                  title={sortable ? 'Click to sort · drag to reorder' : 'Drag to reorder'}
                  className={`p-3 border-r border-[#141414]/10 cursor-grab select-none ${stickyHeader ? 'bg-[#F5F5F5]' : ''} ${col.widthClass || ''} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${sortable ? 'hover:bg-[#141414]/5' : ''} ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'border-l-2 border-l-[#141414] bg-[#141414]/5' : ''}`}
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
              {visibleColumns.map(col => {
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
              <td colSpan={visibleColumns.length} className="p-8 text-center text-xs opacity-50 italic">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      </div>
    </div>
  );
}
