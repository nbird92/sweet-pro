// Shared show / hide / reorder columns menu for HAND-BUILT tables (Orders, …).
// Same look as DataTable's Columns button; preferences are saved through the
// same Firestore-synced per-user stores DataTable uses (localStorage fallback).
// Place the <ColumnsMenu> in the page toolbar's right end (PageToolbar
// `toolbarRight`) — the one place every page keeps its Columns button.

import React, { useContext, useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Check, RotateCcw, ArrowUp, ArrowDown } from 'lucide-react';
import { ColumnOrderContext, ColumnVisibilityContext } from './DataTable';

const readLocal = (prefix: string, id: string): string[] => {
  try {
    const raw = window.localStorage.getItem(prefix + id);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch { return []; }
};

export interface ColumnLayout {
  /** All column keys in the user's order. */
  ordered: string[];
  /** Visible column keys in the user's order (never empty). */
  shown: string[];
  hidden: Set<string>;
  toggle: (key: string) => void;
  move: (key: string, delta: number) => void;
  reset: () => void;
}

/** Column order + visibility for a hand-built table, persisted per user.
 *  Non-hook form for render branches that can't call hooks (App's page
 *  branches): pass App's column stores — their set() re-renders App. */
export function makeColumnLayout(
  tableKey: string, allKeys: string[],
  orderStore: { get: (k: string) => string[] | undefined; set: (k: string, v: string[]) => void } | null,
  visStore: { get: (k: string) => string[] | undefined; set: (k: string, v: string[]) => void } | null,
  bump: (fn: (b: number) => number) => void = () => {},
): ColumnLayout {
  return buildLayout(tableKey, allKeys, orderStore, visStore, bump);
}

/** Hook form (components). */
export function useColumnLayout(tableKey: string, allKeys: string[]): ColumnLayout {
  const orderStore = useContext(ColumnOrderContext);
  const visStore = useContext(ColumnVisibilityContext);
  const [, bump] = useState(0);
  return buildLayout(tableKey, allKeys, orderStore, visStore, bump);
}

function buildLayout(
  tableKey: string, allKeys: string[],
  orderStore: { get: (k: string) => string[] | undefined; set: (k: string, v: string[]) => void } | null,
  visStore: { get: (k: string) => string[] | undefined; set: (k: string, v: string[]) => void } | null,
  bump: (fn: (b: number) => number) => void,
): ColumnLayout {
  const savedOrder = (orderStore?.get(tableKey) ?? readLocal('dt-colorder:', tableKey)).filter(k => allKeys.includes(k));
  const ordered = [...savedOrder, ...allKeys.filter(k => !savedOrder.includes(k))];
  const hidden = new Set((visStore?.get(tableKey) ?? readLocal('dt-colhidden:', tableKey)).filter(k => allKeys.includes(k)));
  const shownRaw = ordered.filter(k => !hidden.has(k));
  const shown = shownRaw.length ? shownRaw : ordered;
  const setOrder = (keys: string[]) => {
    try { window.localStorage.setItem('dt-colorder:' + tableKey, JSON.stringify(keys)); } catch { /* ignore */ }
    if (orderStore) orderStore.set(tableKey, keys);
    bump(b => b + 1);
  };
  const setHidden = (keys: string[]) => {
    try { window.localStorage.setItem('dt-colhidden:' + tableKey, JSON.stringify(keys)); } catch { /* ignore */ }
    if (visStore) visStore.set(tableKey, keys);
    bump(b => b + 1);
  };
  return {
    ordered, shown, hidden,
    toggle: (key) => {
      if (hidden.has(key)) setHidden([...hidden].filter(k => k !== key));
      else if (shown.length > 1) setHidden([...hidden, key]);
    },
    move: (key, delta) => {
      const keys = [...ordered];
      const i = keys.indexOf(key), j = i + delta;
      if (i < 0 || j < 0 || j >= keys.length) return;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      setOrder(keys);
    },
    reset: () => { setOrder([]); setHidden([]); },
  };
}

/** The Columns button + dropdown (tick to show/hide, arrows to reorder). */
export function ColumnsMenu({ layout, labels }: { layout: ColumnLayout; labels: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const customized = layout.hidden.size > 0 || layout.ordered.join('|') !== Object.keys(labels).join('|');
  return (
    <div className="flex items-center gap-3">
      {customized && (
        <button onClick={layout.reset} title="Reset column order & visibility"
          className="text-[9px] uppercase tracking-widest opacity-50 hover:opacity-100 flex items-center gap-1 transition-opacity">
          <RotateCcw size={10} /> reset columns
        </button>
      )}
      <div className="relative" ref={ref}>
        <button onClick={() => setOpen(o => !o)} title="Show / hide columns"
          className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-[#F5F5F5] transition-colors whitespace-nowrap">
          <SlidersHorizontal size={12} /> Columns
          {layout.hidden.size > 0 && <span className="opacity-60 font-mono normal-case">{layout.shown.length}/{layout.ordered.length}</span>}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-30 bg-white text-[#141414] border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] min-w-[260px] max-h-[60vh] overflow-auto py-1">
            <div className="text-[9px] uppercase tracking-widest opacity-50 px-3 py-1.5 border-b border-[#141414]/10 sticky top-0 bg-white">Show columns</div>
            {layout.ordered.map((k, idx) => {
              const visible = !layout.hidden.has(k);
              const isLast = visible && layout.shown.length <= 1;
              return (
                <div key={k} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#F5F5F5]">
                  <button onClick={() => layout.toggle(k)} disabled={isLast} className={`flex items-center gap-2 flex-1 text-left ${isLast ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <span className={`w-3.5 h-3.5 border border-[#141414] flex items-center justify-center shrink-0 ${visible ? 'bg-[#141414]' : 'bg-white'}`}>
                      {visible && <Check size={10} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="truncate">{labels[k] || k}</span>
                  </button>
                  <button disabled={idx === 0} onClick={() => layout.move(k, -1)} className="p-0.5 disabled:opacity-20 hover:bg-[#141414] hover:text-[#E4E3E0]" title="Move left"><ArrowUp size={12} /></button>
                  <button disabled={idx === layout.ordered.length - 1} onClick={() => layout.move(k, 1)} className="p-0.5 disabled:opacity-20 hover:bg-[#141414] hover:text-[#E4E3E0]" title="Move right"><ArrowDown size={12} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
