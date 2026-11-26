// Location card — same look and behaviour as the Customer card
// (CustomerSummaryModal): full-height window, black header with an Edit
// button, tab bar, white panels. Holds EVERY location field — the old Supply
// Chain location detail (bays, terminals, appointment hours) and the old QA
// location card (QA manager, GFSI / Organic audits, Kosher / Halal
// certificates) — split into tabs. All fields are edited here.

import React, { useRef, useState } from 'react';
import { X, Pencil, Building2, Truck, ShieldCheck, Plus, Trash2, Upload, Download, FileText, CheckCircle2 } from 'lucide-react';
import type { Location, Person, ProductGroup, QADocument } from '../types';
import { uploadQAFile } from '../firebaseStorage';
import { TIME_ZONE_OPTIONS, guessLocationTimeZone, tzShort, normalizeTimeZone } from '../utils/timeZones';

type Tab = 'general' | 'logistics' | 'quality';
type DocField = 'gfsiAuditReport' | 'gfsiAuditCertificate' | 'organicAuditReport' | 'organicAuditCertificate' | 'kosherCertificate' | 'halalCertificate';

interface Props {
  location: Location;
  /** A brand-new location (not in the list yet) — opens in edit mode. */
  isNew?: boolean;
  people: Person[];
  productGroups: ProductGroup[];
  onSave: (loc: Location) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest font-bold opacity-50 mb-0.5">{label}</div>
    <div className="text-sm">{value || <span className="opacity-40">—</span>}</div>
  </div>
);
const Panel = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="bg-white border border-[#141414] p-4 space-y-3">
    <div className="text-[11px] uppercase font-bold tracking-widest border-b border-[#141414]/10 pb-2 flex items-center justify-between gap-2">
      <span>{title}</span>{right}
    </div>
    {children}
  </div>
);
const inputCls = 'w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm outline-none focus:bg-white';
const lblCls = 'block text-[10px] uppercase tracking-widest font-bold opacity-50 mb-1';
const fmtDate = (s?: string) => {
  if (!s) return '';
  const d = new Date(s.length === 10 ? `${s}T12:00:00` : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function LocationCard({ location, isNew, people, productGroups, onSave, onDelete, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const [editing, setEditing] = useState(!!isNew);
  const [draft, setDraft] = useState<Location>({ ...location });
  const [uploading, setUploading] = useState<DocField | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadField = useRef<DocField | null>(null);
  const data = editing ? draft : location;
  const set = (patch: Partial<Location>) => setDraft(d => ({ ...d, ...patch }));
  const qaPeople = people.filter(p => p.department === 'QA').sort((a, b) => a.name.localeCompare(b.name));
  const qaManager = people.find(p => p.id === data.qaManagerId);

  const text = (label: string, key: keyof Location, placeholder?: string, type = 'text') => editing ? (
    <div>
      <label className={lblCls}>{label}</label>
      <input type={type} value={(draft[key] as any) ?? ''} placeholder={placeholder}
        onChange={e => set({ [key]: type === 'number' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value } as Partial<Location>)}
        className={inputCls} />
    </div>
  ) : <Field label={label} value={type === 'date' ? fmtDate(location[key] as any) : (location[key] as any)} />;

  // Documents upload straight away (and persist) — like the old QA card.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const field = uploadField.current;
    e.target.value = '';
    if (!file || !field) return;
    setUploading(field);
    try {
      const { url, filename } = await uploadQAFile(draft.id, 'packaging', file);
      const doc: QADocument = { id: `${field}-${Date.now()}`, url, filename, uploadedAt: new Date().toISOString() };
      const updated = { ...draft, [field]: doc } as Location;
      setDraft(updated);
      if (!isNew) onSave(updated);
    } catch (err: any) {
      alert(err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(null);
    }
  };
  const removeDoc = (field: DocField) => {
    const updated = { ...draft } as Location;
    delete (updated as any)[field]; // DELETE the key — Firestore rejects undefined
    setDraft(updated);
    if (!isNew) onSave(updated);
  };
  const docRow = (label: string, field: DocField) => {
    const doc = data[field] as QADocument | undefined;
    return (
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-widest font-bold opacity-50">{label}</div>
        {doc ? (
          <div className="flex items-center justify-between border border-[#141414]/20 bg-[#F9F9F8] p-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <FileText size={15} className="opacity-50 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold truncate">{doc.filename}</div>
                <div className="text-[10px] opacity-50">Uploaded {fmtDate(doc.uploadedAt)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <a href={doc.url} download={doc.filename} target="_blank" rel="noreferrer" className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0]" title="Download"><Download size={14} /></a>
              {editing && <button onClick={() => removeDoc(field)} className="p-1.5 hover:bg-red-500 hover:text-white" title="Delete"><Trash2 size={14} /></button>}
            </div>
          </div>
        ) : <div className="text-xs opacity-40 italic">Nothing uploaded</div>}
        {editing && !doc && (
          <button onClick={() => { uploadField.current = field; fileRef.current?.click(); }} disabled={uploading === field}
            className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 disabled:opacity-50">
            <Upload size={12} /> {uploading === field ? 'Uploading…' : `Upload ${label}`}
          </button>
        )}
      </div>
    );
  };
  const certPanel = (title: string, startK: keyof Location, endK: keyof Location, certK: keyof Location, docs: Array<[string, DocField]>) => {
    const end = data[endK] as string | undefined;
    const expired = !!end && end < new Date().toISOString().slice(0, 10);
    return (
      <Panel title={title} right={end ? <span className={`px-2 py-0.5 text-[9px] ${expired ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{expired ? 'Expired' : 'Valid'}</span> : undefined}>
        <div className="grid grid-cols-3 gap-4">
          {text('Start Date', startK, undefined, 'date')}
          {text('End Date', endK, undefined, 'date')}
          {text('Certifier', certK, 'Certifying body')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {docs.map(([label, f]) => <React.Fragment key={f}>{docRow(label, f)}</React.Fragment>)}
        </div>
      </Panel>
    );
  };

  const save = () => {
    if (!draft.name?.trim()) { alert('Enter a location name.'); setTab('general'); return; }
    onSave({ ...draft, bays: draft.bays || [] });
    setEditing(false);
    if (isNew) onClose();
  };
  const cancel = () => {
    if (isNew) { onClose(); return; }
    setDraft({ ...location });
    setEditing(false);
  };

  const bays = data.bays || [];
  const terminals = data.terminalNames || [];
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'Location Details', icon: <Building2 size={13} /> },
    { id: 'logistics', label: `Logistics (${bays.length} bays)`, icon: <Truck size={13} /> },
    { id: 'quality', label: 'Quality & Certifications', icon: <ShieldCheck size={13} /> },
  ];
  const address = [data.address, [data.city, data.province].filter(Boolean).join(', '), data.postalCode].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#141414]/80 backdrop-blur-md" onClick={() => { if (!editing) onClose(); }}>
      <div className="bg-[#E4E3E0] border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] w-full max-w-[95vw] xl:max-w-7xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-[#141414] text-[#E4E3E0] px-5 py-4 flex justify-between items-start shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest opacity-60">Location Summary · {data.locationCode || (isNew ? 'New' : data.id)}</div>
            <h3 className="text-lg font-bold mt-0.5">{data.name || 'New Location'}</h3>
            <div className="text-[11px] opacity-60 mt-0.5">{[[data.city, data.province].filter(Boolean).join(', '), qaManager ? `QA: ${qaManager.name}` : '', data.active === false ? 'Inactive' : 'Active'].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="flex items-center gap-2">
            {editing && <span className="px-2 py-1 bg-amber-400 text-[#141414] text-[10px] font-bold uppercase tracking-widest">Editing</span>}
            {!editing && (
              <button onClick={() => { setDraft({ ...location }); setEditing(true); }} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E4E3E0]/40 text-[10px] uppercase font-bold tracking-widest hover:bg-white/10"><Pencil size={12} /> Edit Location</button>
            )}
            <button onClick={() => { if (!editing || window.confirm('Discard unsaved changes?')) onClose(); }} className="p-1 hover:bg-white/20" title="Close"><X size={18} /></button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-[#141414] bg-white shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-5 py-3 text-[11px] uppercase font-bold tracking-widest border-r border-[#141414]/20 whitespace-nowrap transition-colors ${tab === t.id ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-gray-100 opacity-70'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {tab === 'general' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Panel title="General">
                <div className="grid grid-cols-2 gap-4">
                  {text('Location Name', 'name', 'Location name')}
                  {text('Location Code', 'locationCode', 'e.g. 100')}
                  <div className="col-span-2">{text('BOL Name', 'bolName', 'Legal shipper name for BOL / Packing List')}</div>
                  <div className="col-span-2">{text('Port of Origin', 'portOfOrigin', 'e.g. Hamilton, ON — printed on the Sales Contract')}</div>
                  {editing ? (
                    <div className="col-span-2">
                      <label className={lblCls}>Time Zone</label>
                      <select value={normalizeTimeZone(draft.timeZone) || ''} onChange={e => set({ timeZone: e.target.value || undefined })} className={inputCls}
                        title="Local time zone of this location — its shipment appointment times are in this zone">
                        <option value="">Default — {guessLocationTimeZone(draft.name)}</option>
                        {TIME_ZONE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="col-span-2"><Field label="Time Zone" value={(() => { const tz = normalizeTimeZone(location.timeZone) || guessLocationTimeZone(location.name); const lbl = TIME_ZONE_OPTIONS.find(([id]) => id === tz)?.[1] || tz; return `${lbl} (${tzShort(tz)})${location.timeZone ? '' : ' — default'}`; })()} /></div>
                  )}
                  {editing ? (
                    <div>
                      <label className={lblCls}>Active</label>
                      <select value={draft.active === false ? 'No' : 'Yes'} onChange={e => set({ active: e.target.value === 'Yes' })} className={inputCls}
                        title="Inactive locations are hidden from all location dropdowns across the app">
                        <option value="Yes">Yes</option><option value="No">No</option>
                      </select>
                    </div>
                  ) : <Field label="Active" value={<span className={`px-2 py-0.5 text-[10px] font-bold uppercase ${location.active !== false ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{location.active !== false ? 'Yes' : 'No'}</span>} />}
                  {editing ? (
                    <div>
                      <label className={lblCls}>QA Manager</label>
                      <select value={draft.qaManagerId || ''} onChange={e => set({ qaManagerId: e.target.value })} className={inputCls}>
                        <option value="">— None —</option>
                        {qaPeople.map(p => <option key={p.id} value={p.id}>{p.name}{p.defaultLocation ? ` (${p.defaultLocation})` : ''}</option>)}
                      </select>
                    </div>
                  ) : <Field label="QA Manager" value={qaManager ? <>{qaManager.name}{qaManager.email && <div className="text-[11px] opacity-60">{qaManager.email}</div>}</> : undefined} />}
                </div>
              </Panel>
              <Panel title="Address">
                {editing ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">{text('Address', 'address', 'Street address')}</div>
                    {text('City', 'city')}
                    {text('Province', 'province')}
                    {text('Postal Code', 'postalCode')}
                  </div>
                ) : address.length ? <div className="text-sm leading-relaxed">{address.map((l, i) => <div key={i}>{l}</div>)}</div> : <div className="text-xs opacity-40 italic">No address on file.</div>}
              </Panel>
            </div>
          )}

          {tab === 'logistics' && (
            <>
              <Panel title="Appointment Schedule">
                <div className="grid grid-cols-3 gap-4">
                  {text('First Appointment', 'appointmentStartTime', '06:00', 'time')}
                  {text('Last Appointment', 'appointmentEndTime', '18:00', 'time')}
                  {text('Slot Length (minutes)', 'appointmentDuration', '30', 'number')}
                </div>
              </Panel>
              <Panel title={`Bays (${bays.length})`} right={editing ? (
                <button onClick={() => set({ bays: [...(draft.bays || []), ''] })} className="px-2 py-1 bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase flex items-center gap-1"><Plus size={10} /> Add Bay</button>
              ) : undefined}>
                <p className="text-[10px] opacity-50">The product groups each bay handles — the scan-PO menu auto-selects the matching bay for a load.</p>
                <div className="space-y-2">
                  {bays.map((bay, idx) => {
                    const raw = data.bayProductGroups?.[bay];
                    const groups: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
                    const setGroups = (next: string[]) => {
                      const g = { ...(draft.bayProductGroups || {}) };
                      if (next.length) g[bay] = next; else delete g[bay];
                      set({ bayProductGroups: g });
                    };
                    return (
                      <div key={idx} className="border border-[#141414]/20 bg-[#F9F9F8] p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        {editing ? (
                          <input value={bay} placeholder={`Bay ${idx + 1} name`} className="w-52 bg-white border border-[#141414]/30 p-2 text-xs font-bold"
                            onChange={e => {
                              const g = { ...(draft.bayProductGroups || {}) };
                              if (g[bay] !== undefined) { g[e.target.value] = g[bay]; delete g[bay]; }
                              set({ bays: (draft.bays || []).map((b, i) => i === idx ? e.target.value : b), bayProductGroups: g });
                            }} />
                        ) : <div className="w-52 text-sm font-bold">{bay || <span className="opacity-40">(unnamed)</span>}</div>}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[9px] uppercase font-bold opacity-40">Handles:</span>
                          {editing ? productGroups.map(g => {
                            const on = groups.includes(g.name);
                            return (
                              <button key={g.id} type="button" onClick={() => setGroups(on ? groups.filter(x => x !== g.name) : [...groups, g.name])}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border ${on ? 'bg-violet-700 text-white border-violet-700' : 'bg-white text-[#141414]/60 border-[#141414]/25 hover:border-[#141414]'}`}>
                                {g.name}
                              </button>
                            );
                          }) : (groups.length ? groups.map(g => <span key={g} className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-violet-700 text-white">{g}</span>) : <span className="text-xs opacity-40">—</span>)}
                        </div>
                        {editing && (
                          <button onClick={() => {
                            const g = { ...(draft.bayProductGroups || {}) }; delete g[bay];
                            set({ bays: (draft.bays || []).filter((_, i) => i !== idx), bayProductGroups: g });
                          }} className="ml-auto p-2 text-red-500 hover:bg-red-500 hover:text-white" title="Delete bay"><Trash2 size={12} /></button>
                        )}
                      </div>
                    );
                  })}
                  {bays.length === 0 && <div className="text-xs opacity-40 italic">No bays added yet.</div>}
                </div>
              </Panel>
              <Panel title={`Terminals (${terminals.length})`} right={editing ? (
                <button onClick={() => set({ terminalNames: [...(draft.terminalNames || []), { terminal: '', terminalName: '' }] })} className="px-2 py-1 bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase flex items-center gap-1"><Plus size={10} /> Add Terminal</button>
              ) : undefined}>
                {terminals.length > 0 ? (
                  <table className="w-full text-xs border-collapse">
                    <thead><tr className="text-[10px] uppercase tracking-widest text-left border-b border-[#141414]/20">
                      <th className="py-1.5 pr-2 w-36">Terminal</th><th className="py-1.5 pr-2">Terminal Name</th><th className="py-1.5 pr-2 w-36">Warehouse</th>{editing && <th className="w-8" />}
                    </tr></thead>
                    <tbody>
                      {terminals.map((tn, idx) => {
                        const upd = (patch: any) => set({ terminalNames: (draft.terminalNames || []).map((t, i) => i === idx ? { ...t, ...patch } : t) });
                        return (
                          <tr key={idx} className="border-b border-[#141414]/10">
                            <td className="py-1.5 pr-2">{editing ? <input value={tn.terminal} onChange={e => upd({ terminal: e.target.value })} className="w-full bg-white border border-[#141414]/30 p-1.5 font-mono" /> : <span className="font-mono">{tn.terminal || '—'}</span>}</td>
                            <td className="py-1.5 pr-2">{editing ? <input value={tn.terminalName} onChange={e => upd({ terminalName: e.target.value })} className="w-full bg-white border border-[#141414]/30 p-1.5" /> : (tn.terminalName || '—')}</td>
                            <td className="py-1.5 pr-2">{editing ? (
                              <select value={tn.warehouse || ''} onChange={e => upd({ warehouse: e.target.value || undefined })} className="w-full bg-white border border-[#141414]/30 p-1.5">
                                <option value="">—</option><option value="Liquid">Liquid</option><option value="DRY">DRY</option>
                              </select>
                            ) : (tn.warehouse || '—')}</td>
                            {editing && <td><button onClick={() => set({ terminalNames: (draft.terminalNames || []).filter((_, i) => i !== idx) })} className="p-1.5 hover:bg-red-500 hover:text-white"><Trash2 size={12} /></button></td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : <div className="text-xs opacity-40 italic">No terminals added yet.</div>}
              </Panel>
            </>
          )}

          {tab === 'quality' && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {certPanel('GFSI Audit', 'gfsiAuditStartDate', 'gfsiAuditEndDate', 'gfsiAuditCertifier', [['Audit Report', 'gfsiAuditReport'], ['Audit Certificate', 'gfsiAuditCertificate']])}
              {certPanel('Organic Audit', 'organicAuditStartDate', 'organicAuditEndDate', 'organicAuditCertifier', [['Audit Report', 'organicAuditReport'], ['Audit Certificate', 'organicAuditCertificate']])}
              {certPanel('Kosher Certificate', 'kosherCertStartDate', 'kosherCertEndDate', 'kosherCertifier', [['Certificate', 'kosherCertificate']])}
              {certPanel('Halal Certificate', 'halalCertStartDate', 'halalCertEndDate', 'halalCertifier', [['Certificate', 'halalCertificate']])}
            </div>
          )}
        </div>

        {editing && (
          <div className="shrink-0 border-t border-[#141414] bg-white px-5 py-3 flex gap-3">
            <button onClick={save} className="flex-1 py-2.5 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-opacity-80"><CheckCircle2 size={16} /> {isNew ? 'Add Location' : 'Save Changes'}</button>
            <button onClick={cancel} className="flex-1 py-2.5 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5]">Cancel</button>
            {!isNew && (
              <button onClick={() => { if (window.confirm(`Delete location "${location.name}"? This cannot be undone.`)) { onDelete(location.id); onClose(); } }}
                className="px-6 py-2.5 border border-red-500 text-red-600 text-xs font-bold uppercase hover:bg-red-500 hover:text-white flex items-center gap-2"><Trash2 size={14} /> Delete</button>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={onFile} />
      </div>
    </div>
  );
}
