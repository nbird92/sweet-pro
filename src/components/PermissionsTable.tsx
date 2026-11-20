// Permissions table (People page): one row per permission category, and for
// every page a View and an Edit tick box. Unticking View hides the page from
// that category; unticking Edit opens it view-only. Edit implies View.
// Admin always has full access. A page with no saved setting is allowed, so
// nothing changes until someone unticks a box.

import React, { useEffect, useState } from 'react';
import { ShieldCheck, Save, RotateCcw } from 'lucide-react';
import { PERMISSION_GROUPS, type Person } from '../types';
import type { PermissionMatrix } from '../firebaseDb';

interface Props {
  pages: string[];
  matrix: PermissionMatrix;
  people: Person[];
  /** Only Admins may change permissions (anyone, until an Admin exists). */
  canManage: boolean;
  onSave: (matrix: PermissionMatrix) => Promise<void>;
}

export const permFor = (matrix: PermissionMatrix, group: string, page: string) => {
  if (group === 'Admin') return { view: true, edit: true };
  const m = matrix[group]?.[page];
  if (!m) return { view: true, edit: true };
  return { view: !!m.view, edit: !!m.view && !!m.edit };
};

export default function PermissionsTable({ pages, matrix, people, canManage, onSave }: Props) {
  const [draft, setDraft] = useState<PermissionMatrix>(matrix);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDraft(matrix); }, [matrix]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(matrix);
  const groups = PERMISSION_GROUPS.filter(g => g !== 'Admin');

  const set = (group: string, page: string, field: 'view' | 'edit', value: boolean) => {
    setDraft(prev => {
      const cur = permFor(prev, group, page);
      let next = { ...cur, [field]: value };
      if (field === 'view' && !value) next = { view: false, edit: false };   // no view → no edit
      if (field === 'edit' && value) next = { view: true, edit: true };      // edit → view
      return { ...prev, [group]: { ...(prev[group] || {}), [page]: next } };
    });
  };
  const setRow = (group: string, field: 'view' | 'edit', value: boolean) => {
    for (const p of pages) set(group, p, field, value);
  };
  const count = (group: string) => people.filter(p => p.permission === group).length;

  const box = (checked: boolean, onChange: (v: boolean) => void, title: string) => (
    <input type="checkbox" checked={checked} disabled={!canManage} onChange={(e) => onChange(e.target.checked)} title={title}
      className="w-3.5 h-3.5 cursor-pointer accent-[#141414] disabled:cursor-not-allowed" />
  );

  return (
    <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
      <div className="bg-[#141414] text-[#E4E3E0] p-4 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck size={14} />
          <h3 className="text-xs font-bold uppercase tracking-widest">Permissions</h3>
          <span className="text-[10px] opacity-60">View = can open the page · Edit = can change it</span>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[10px] opacity-80">{msg}</span>}
          {dirty && canManage && (
            <button onClick={() => setDraft(matrix)} className="px-3 py-1.5 bg-white/10 text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/20"><RotateCcw size={12} /> Discard</button>
          )}
          {canManage && (
            <button disabled={!dirty || saving}
              onClick={async () => {
                setSaving(true); setMsg(null);
                try { await onSave(draft); setMsg('Saved'); } catch (e: any) { setMsg(`Save failed: ${e?.message || e}`); } finally { setSaving(false); }
              }}
              className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-emerald-700 disabled:opacity-40">
              <Save size={12} /> {saving ? 'Saving…' : 'Save Permissions'}
            </button>
          )}
        </div>
      </div>
      {!canManage && (
        <div className="px-4 py-2 text-[11px] bg-amber-50 border-b border-[#141414]/20">Only people in the <b>Admin</b> category can change permissions.</div>
      )}
      <div className="overflow-auto max-h-[70vh]">
        <table className="border-collapse text-xs">
          <thead className="sticky top-0 z-20">
            <tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest">
              <th rowSpan={2} className="sticky left-0 z-30 bg-[#F5F5F5] p-3 text-left border-b border-r border-[#141414] min-w-[190px]">Category</th>
              {pages.map(p => (
                <th key={p} colSpan={2} className="px-2 py-2 text-center border-r border-b border-[#141414]/15 whitespace-nowrap">{p}</th>
              ))}
            </tr>
            <tr className="bg-[#F5F5F5] text-[9px] uppercase">
              {pages.map(p => (
                <React.Fragment key={p}>
                  <th className="px-2 py-1 border-b border-[#141414] font-bold opacity-60">View</th>
                  <th className="px-2 py-1 border-b border-r border-[#141414] font-bold opacity-60">Edit</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-violet-50/60">
              <td className="sticky left-0 z-10 bg-violet-50 p-3 border-r border-b border-[#141414]/15 font-bold">
                Admin <span className="font-normal opacity-60">({count('Admin')})</span>
                <div className="text-[10px] font-normal opacity-60">Always full access</div>
              </td>
              {pages.map(p => (
                <React.Fragment key={p}>
                  <td className="text-center border-b border-[#141414]/15"><input type="checkbox" checked disabled className="w-3.5 h-3.5 accent-[#141414]" /></td>
                  <td className="text-center border-b border-r border-[#141414]/15"><input type="checkbox" checked disabled className="w-3.5 h-3.5 accent-[#141414]" /></td>
                </React.Fragment>
              ))}
            </tr>
            {groups.map(g => {
              const allView = pages.every(p => permFor(draft, g, p).view);
              const allEdit = pages.every(p => permFor(draft, g, p).edit);
              return (
                <tr key={g} className="hover:bg-[#F9F9F9]">
                  <td className="sticky left-0 z-10 bg-white p-3 border-r border-b border-[#141414]/15">
                    <div className="font-bold">{g} <span className="font-normal opacity-60">({count(g)})</span></div>
                    {canManage && (
                      <div className="flex gap-2 mt-1 text-[10px]">
                        <label className="flex items-center gap-1 cursor-pointer">{box(allView, v => setRow(g, 'view', v), 'View every page')} all view</label>
                        <label className="flex items-center gap-1 cursor-pointer">{box(allEdit, v => setRow(g, 'edit', v), 'Edit every page')} all edit</label>
                      </div>
                    )}
                  </td>
                  {pages.map(p => {
                    const perm = permFor(draft, g, p);
                    return (
                      <React.Fragment key={p}>
                        <td className={`text-center border-b border-[#141414]/15 ${perm.view ? '' : 'bg-red-50'}`}>{box(perm.view, v => set(g, p, 'view', v), `${g}: view ${p}`)}</td>
                        <td className={`text-center border-b border-r border-[#141414]/15 ${perm.edit ? '' : perm.view ? 'bg-amber-50' : 'bg-red-50'}`}>{box(perm.edit, v => set(g, p, 'edit', v), `${g}: edit ${p}`)}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-[10px] opacity-60 border-t border-[#141414]/15">
        Set each person's category in their People record (Permission). People with no category have full access. Changes apply the next time they load the app.
      </div>
    </div>
  );
}
