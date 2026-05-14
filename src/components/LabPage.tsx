import React, { useState } from 'react';
import { LotCode, SugarType, Person, ProductGroup } from '../types';
import { Plus, X, Trash2, Edit2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LabPageProps {
  lotCodes: LotCode[];
  sugarTypes: SugarType[];
  people: Person[];
  productGroups: ProductGroup[];
  onUpdateLotCodes: (lotCodes: LotCode[]) => void;
}

const EMPTY_FORM = {
  lotNumber: '', tankNumber: '', date: '', julianDate: '',
  category: '' as 'Conventional' | 'Organic' | '',
  productGroup: '', silo: '' as 'North' | 'South' | '',
  brix: '', ph: '', color: '', temperature: '',
  invert: '', flavourOdourOk: '' as 'Yes' | 'No' | '',
  testerId: '', testerName: '', notes: '',
  weeklyVerification: '', sugarType: '',
};

// Get Julian day of the year (1-366) from a date string YYYY-MM-DD
function getJulianDay(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const day = Math.floor(diff / oneDay);
  return String(day).padStart(3, '0');
}

// Generate lot code: HS-[sugarType][productGroup][orgConv][YY][JJJ][silo]
function generateLotCode(form: typeof EMPTY_FORM): string {
  // 1. Plant prefix
  const plant = 'HS';

  // 2. Sugar type code: R=Granulated, L=Liquid, M=Molasses
  const sugarTypeMap: Record<string, string> = {
    'Granulated': 'R', 'Liquid': 'L', 'Molasses': 'M',
    'Icing': 'I', 'Brown': 'B', 'Yellow': 'Y',
  };
  const sugarCode = sugarTypeMap[form.sugarType] || '?';

  // 3. Product group code: 00=Bulk, 10=Totes, 50=Packaged
  const pg = form.productGroup.toLowerCase();
  let pgCode = '00'; // default to bulk
  if (pg.includes('tote')) {
    pgCode = '10';
  } else if (pg.includes('pack') || pg.includes('bag')) {
    pgCode = '50';
  }

  // 4. Organic/Conventional: B=Organic, C=Conventional
  const catCode = form.category === 'Organic' ? 'B' : form.category === 'Conventional' ? 'C' : '?';

  // 5. YY = last 2 digits of year
  let yy = '??';
  if (form.date) {
    yy = form.date.slice(2, 4);
  }

  // 6. JJJ = Julian date
  const jjj = form.julianDate || '???';

  // 7. Silo: N=North, S=South
  const siloCode = form.silo === 'North' ? 'N' : form.silo === 'South' ? 'S' : '';

  return `${plant}-${sugarCode}${pgCode}${catCode}${yy}${jjj}${siloCode}`;
}

export default function LabPage({ lotCodes, sugarTypes, people, productGroups, onUpdateLotCodes }: LabPageProps) {
  const [filterSugarType, setFilterSugarType] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingLot, setEditingLot] = useState<LotCode | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  const qaPeople = people.filter(p => p.department === 'QA');

  const filtered = filterSugarType
    ? lotCodes.filter(lc => lc.sugarType === filterSugarType)
    : lotCodes;

  // Update form and auto-compute lot code + julian date
  const updateForm = (patch: Partial<typeof EMPTY_FORM>) => {
    const next = { ...formData, ...patch };
    // Auto-compute Julian date when date changes
    if ('date' in patch && patch.date) {
      next.julianDate = getJulianDay(patch.date);
    }
    // Auto-generate lot number
    next.lotNumber = generateLotCode(next);
    setFormData(next);
  };

  const openAdd = () => {
    setFormData({ ...EMPTY_FORM });
    setIsAdding(true);
  };

  const openEdit = (lc: LotCode) => {
    setFormData({
      lotNumber: lc.lotNumber, tankNumber: lc.tankNumber,
      date: lc.date || '', julianDate: lc.julianDate || '',
      category: lc.category || '', productGroup: lc.productGroup || '',
      silo: lc.silo || '',
      brix: lc.brix, ph: lc.ph, color: lc.color, temperature: lc.temperature,
      invert: lc.invert, flavourOdourOk: lc.flavourOdourOk,
      testerId: lc.testerId, testerName: lc.testerName,
      notes: lc.notes, weeklyVerification: lc.weeklyVerification, sugarType: lc.sugarType,
    });
    setEditingLot(lc);
  };

  const handleSave = () => {
    if (editingLot) {
      onUpdateLotCodes(lotCodes.map(lc => lc.id === editingLot.id ? { ...editingLot, ...formData } : lc));
      setEditingLot(null);
    } else {
      const newLot: LotCode = {
        ...formData,
        id: `LOT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        createdAt: new Date().toISOString(),
      } as LotCode;
      onUpdateLotCodes([...lotCodes, newLot]);
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    onUpdateLotCodes(lotCodes.filter(lc => lc.id !== id));
    setDeleteConfirmId(null);
  };

  const isOpen = isAdding || !!editingLot;
  const modalTitle = editingLot ? 'Edit Lot Code' : 'Add New Lot Code';

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold uppercase tracking-tighter">Hamilton Lab</h2>
      </div>

      {/* Lot Code Testing Log Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
          <h3 className="text-xs font-bold uppercase tracking-widest">Lot Code Testing Log</h3>
          <div className="flex items-center gap-3">
            <select
              value={filterSugarType}
              onChange={(e) => setFilterSugarType(e.target.value)}
              className="bg-[#2a2a2a] text-[#E4E3E0] border border-[#E4E3E0]/20 px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="">All Sugar Types</option>
              {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
            </select>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E4E3E0] text-[#141414] text-xs font-bold uppercase hover:bg-white transition-all"
            >
              <Plus size={12} /> Add New Lot Code
            </button>
          </div>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
              <th className="p-3 border-r border-[#141414]/10">Lot #</th>
              <th className="p-3 border-r border-[#141414]/10">Date</th>
              <th className="p-3 border-r border-[#141414]/10">Tank #</th>
              <th className="p-3 border-r border-[#141414]/10">Sugar Type</th>
              <th className="p-3 border-r border-[#141414]/10">Brix</th>
              <th className="p-3 border-r border-[#141414]/10">PH</th>
              <th className="p-3 border-r border-[#141414]/10">Color</th>
              <th className="p-3 border-r border-[#141414]/10">Temp °C</th>
              <th className="p-3 border-r border-[#141414]/10">Invert</th>
              <th className="p-3 border-r border-[#141414]/10">Flavour/Odour OK</th>
              <th className="p-3 border-r border-[#141414]/10">Tester</th>
              <th className="p-3 border-r border-[#141414]/10">Notes</th>
              <th className="p-3 border-r border-[#141414]/10">Weekly Verification</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10">
            {filtered.length === 0 ? (
              <tr><td colSpan={14} className="p-8 text-center text-xs opacity-50">No lot codes recorded yet.</td></tr>
            ) : filtered.map(lc => (
              <tr key={lc.id} className="hover:bg-[#F9F9F9] transition-colors">
                <td className="p-3 text-xs font-mono font-bold border-r border-[#141414]/10">{lc.lotNumber}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.date || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.tankNumber || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.sugarType || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.brix || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.ph || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.color || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.temperature || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.invert || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.flavourOdourOk || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.testerName || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10 max-w-[150px] truncate" title={lc.notes}>{lc.notes || '—'}</td>
                <td className="p-3 text-xs border-r border-[#141414]/10">{lc.weeklyVerification || '—'}</td>
                <td className="p-3 text-xs">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(lc)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => setDeleteConfirmId(lc.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Lot Code Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">{modalTitle}</h3>
                <button onClick={() => { setIsAdding(false); setEditingLot(null); }} className="hover:opacity-70"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Auto-generated Lot Code preview */}
                <div className="bg-[#F5F5F5] border border-[#141414]/20 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Generated Lot Code</div>
                    <div className="text-sm font-mono font-bold">{formData.lotNumber || '—'}</div>
                  </div>
                  <div className="text-[9px] opacity-40 text-right">HS-[Type][Group][Conv/Org][YY][JJJ][Silo]</div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  {/* Date & Julian Date */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Date</label>
                    <input type="date" value={formData.date}
                      onChange={(e) => updateForm({ date: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Julian Date</label>
                    <div className="bg-[#F5F5F5] border border-[#141414]/20 p-2 text-sm font-mono font-bold">{formData.julianDate || '—'}</div>
                    <p className="text-[9px] opacity-40">Auto-calculated from date</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Sugar Type</label>
                    <select value={formData.sugarType}
                      onChange={(e) => updateForm({ sugarType: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Conventional / Organic</label>
                    <select value={formData.category}
                      onChange={(e) => updateForm({ category: e.target.value as 'Conventional' | 'Organic' | '' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      <option value="Conventional">Conventional</option>
                      <option value="Organic">Organic</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Group</label>
                    <select value={formData.productGroup}
                      onChange={(e) => updateForm({ productGroup: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Silo</label>
                    <select value={formData.silo}
                      onChange={(e) => updateForm({ silo: e.target.value as 'North' | 'South' | '' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      <option value="North">North</option>
                      <option value="South">South</option>
                    </select>
                  </div>

                  {/* Existing fields */}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Tank #</label>
                    <input type="text" value={formData.tankNumber} onChange={(e) => setFormData({ ...formData, tankNumber: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="Enter tank number" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                    <input type="text" value={formData.brix} onChange={(e) => setFormData({ ...formData, brix: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="e.g. 99.9" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">PH</label>
                    <input type="text" value={formData.ph} onChange={(e) => setFormData({ ...formData, ph: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="e.g. 7.0" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Color</label>
                    <input type="text" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="e.g. 45" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Temperature °C</label>
                    <input type="text" value={formData.temperature} onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="e.g. 25" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Invert</label>
                    <input type="text" value={formData.invert} onChange={(e) => setFormData({ ...formData, invert: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="e.g. 0.04" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Flavour/Odour OK</label>
                    <select value={formData.flavourOdourOk} onChange={(e) => setFormData({ ...formData, flavourOdourOk: e.target.value as 'Yes' | 'No' | '' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Tester</label>
                    <select
                      value={formData.testerId}
                      onChange={(e) => {
                        const person = people.find(p => p.id === e.target.value);
                        setFormData({ ...formData, testerId: e.target.value, testerName: person?.name || '' });
                      }}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      <option value="">— Select Tester —</option>
                      {qaPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Weekly Verification</label>
                    <input type="text" value={formData.weeklyVerification} onChange={(e) => setFormData({ ...formData, weeklyVerification: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" placeholder="Verification notes" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none min-h-[80px] resize-y" placeholder="Additional notes..." />
                </div>
                <div className="flex gap-4 pt-4">
                  <button onClick={handleSave} disabled={!formData.lotNumber || formData.lotNumber.includes('?')}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50">
                    {editingLot ? 'Save Changes' : 'Add Lot Code'}
                  </button>
                  <button onClick={() => { setIsAdding(false); setEditingLot(null); }}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Lot Code Confirmation */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center gap-3">
                <AlertCircle size={20} className="text-red-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Delete</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm">Are you sure you want to delete lot code <span className="font-bold font-mono">{lotCodes.find(lc => lc.id === deleteConfirmId)?.lotNumber}</span>? This action cannot be undone.</p>
                <div className="flex gap-4">
                  <button onClick={() => handleDelete(deleteConfirmId)}
                    className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-all">
                    Yes, Delete
                  </button>
                  <button onClick={() => setDeleteConfirmId(null)}
                    className="flex-1 py-3 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
