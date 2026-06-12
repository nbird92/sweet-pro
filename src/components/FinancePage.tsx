import React, { useState } from 'react';
import { FiscalYear, FiscalQuarter, FiscalPeriod } from '../types';
import { X, Trash2, Plus, ChevronDown, ChevronUp, Save, Calendar, Landmark } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageBanner from './PageBanner';
import DataTable from './DataTable';
import type { SheetSpec } from '../utils/exportExcel';

interface FinancePageProps {
  fiscalYears: FiscalYear[];
  onUpdateFiscalYears: (years: FiscalYear[]) => void;
}

function generateDefaultQuarters(startDate: string, endDate: string): FiscalQuarter[] {
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();
  const end = endDate ? new Date(endDate + 'T00:00:00') : new Date();
  const totalMs = end.getTime() - start.getTime();
  const quarterMs = totalMs / 4;

  return [1, 2, 3, 4].map((num) => {
    const qStart = new Date(start.getTime() + quarterMs * (num - 1));
    const qEnd = num < 4
      ? new Date(start.getTime() + quarterMs * num - 86400000)
      : new Date(end);
    const lockDate = new Date(qStart.getTime() - 14 * 86400000); // 2 weeks before quarter start
    return {
      id: `FQ-${Date.now()}-${num}`,
      quarterNumber: num,
      name: `Q${num}`,
      startDate: qStart.toISOString().split('T')[0],
      endDate: qEnd.toISOString().split('T')[0],
      budgetLockDate: lockDate.toISOString().split('T')[0],
    };
  });
}

function generateDefaultPeriods(startDate: string, endDate: string): FiscalPeriod[] {
  const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();
  const end = endDate ? new Date(endDate + 'T00:00:00') : new Date();
  const totalMs = end.getTime() - start.getTime();
  const periodMs = totalMs / 12;

  return Array.from({ length: 12 }, (_, i) => {
    const num = i + 1;
    const pStart = new Date(start.getTime() + periodMs * i);
    const pEnd = num < 12
      ? new Date(start.getTime() + periodMs * num - 86400000)
      : new Date(end);
    return {
      id: `FP-${Date.now()}-${num}`,
      periodNumber: num,
      name: `Period ${num}`,
      startDate: pStart.toISOString().split('T')[0],
      endDate: pEnd.toISOString().split('T')[0],
    };
  });
}

function createBlankFiscalYear(): FiscalYear {
  const now = new Date();
  const yearStr = String(now.getFullYear());
  const startDate = `${yearStr}-01-01`;
  const endDate = `${yearStr}-12-31`;
  return {
    id: '',
    name: `FY ${yearStr}`,
    startDate,
    endDate,
    budgetLockDate: `${Number(yearStr) - 1}-12-01`,
    quarters: generateDefaultQuarters(startDate, endDate),
    periods: generateDefaultPeriods(startDate, endDate),
  };
}

export default function FinancePage({ fiscalYears, onUpdateFiscalYears }: FinancePageProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<FiscalYear>(createBlankFiscalYear());

  // Open add modal
  const handleAdd = () => {
    setEditingIndex(null);
    setDraft(createBlankFiscalYear());
    setShowModal(true);
  };

  // Open edit modal
  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setDraft(JSON.parse(JSON.stringify(fiscalYears[index])));
    setShowModal(true);
  };


  // Save
  const handleSave = () => {
    if (!draft.name || !draft.startDate || !draft.endDate) {
      alert('Please fill in Name, Start Date, and End Date.');
      return;
    }
    const updated = [...fiscalYears];
    if (editingIndex !== null) {
      updated[editingIndex] = draft;
    } else {
      const newYear: FiscalYear = { ...draft, id: `FY-${Date.now()}` };
      updated.push(newYear);
    }
    onUpdateFiscalYears(updated);
    setShowModal(false);
  };

  // --- Quarter helpers ---
  const addQuarter = () => {
    const nextNum = draft.quarters.length + 1;
    const newQ: FiscalQuarter = {
      id: `FQ-${Date.now()}-${nextNum}`,
      quarterNumber: nextNum,
      name: `Q${nextNum}`,
      startDate: '',
      endDate: '',
      budgetLockDate: '',
    };
    setDraft({ ...draft, quarters: [...draft.quarters, newQ] });
  };

  const updateQuarter = (idx: number, field: keyof FiscalQuarter, value: string | number) => {
    const quarters = [...draft.quarters];
    quarters[idx] = { ...quarters[idx], [field]: value };
    setDraft({ ...draft, quarters });
  };

  const deleteQuarter = (idx: number) => {
    const quarters = [...draft.quarters];
    quarters.splice(idx, 1);
    setDraft({ ...draft, quarters });
  };

  // --- Period helpers ---
  const addPeriod = () => {
    const nextNum = draft.periods.length + 1;
    const newP: FiscalPeriod = {
      id: `FP-${Date.now()}-${nextNum}`,
      periodNumber: nextNum,
      name: `Period ${nextNum}`,
      startDate: '',
      endDate: '',
    };
    setDraft({ ...draft, periods: [...draft.periods, newP] });
  };

  const updatePeriod = (idx: number, field: keyof FiscalPeriod, value: string | number) => {
    const periods = [...draft.periods];
    periods[idx] = { ...periods[idx], [field]: value };
    setDraft({ ...draft, periods });
  };

  const deletePeriod = (idx: number) => {
    const periods = [...draft.periods];
    periods.splice(idx, 1);
    setDraft({ ...draft, periods });
  };

  // ============================
  // RENDER
  // ============================
  const financeExportSheets = (): SheetSpec[] => [{
    sheetName: 'Fiscal Years',
    title: 'Fiscal Years',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${fiscalYears.length} fiscal years`,
    columns: [
      { header: 'Name', key: 'name' },
      { header: 'Start Date', key: 'startDate' },
      { header: 'End Date', key: 'endDate' },
      { header: 'Budget Lock Date', key: 'budgetLockDate' },
      { header: '# Quarters', key: 'numQuarters', format: 'integer' },
      { header: '# Periods', key: 'numPeriods', format: 'integer' },
    ],
    rows: fiscalYears.map(fy => ({
      name: fy.name,
      startDate: fy.startDate,
      endDate: fy.endDate,
      budgetLockDate: fy.budgetLockDate || '',
      numQuarters: (fy.quarters || []).length,
      numPeriods: (fy.periods || []).length,
    })),
  }];
  return (
    <div>
      <PageBanner
        icon={<Landmark size={18} />}
        title="Finance — Fiscal Years"
        count={fiscalYears.length}
        exportSheets={financeExportSheets}
        exportFileName="Finance"
      >
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-white/20 transition-all flex items-center gap-2"
        >
          <Plus size={12} /> Add Fiscal Year
        </button>
      </PageBanner>
    <main className="flex-1 p-6 overflow-auto">

      {/* Fiscal Years — standardized DataTable. Row click opens the existing
          edit modal (which holds the nested Quarter / Period editors); Delete
          lives in that modal's footer. Add Fiscal Year stays in the PageBanner. */}
      <DataTable<FiscalYear>
        title="Fiscal Years"
        icon={<Landmark size={14} />}
        columns={[
          { key: 'name', label: 'Name', bold: true },
          { key: 'startDate', label: 'Start Date' },
          { key: 'endDate', label: 'End Date' },
          { key: 'budgetLockDate', label: 'Budget Lock Date', render: (fy) => fy.budgetLockDate || '—' },
          { key: 'numQuarters', label: '# Quarters', align: 'right', mono: true, sortValue: (fy) => (fy.quarters || []).length, render: (fy) => (fy.quarters || []).length },
          { key: 'numPeriods', label: '# Periods', align: 'right', mono: true, sortValue: (fy) => (fy.periods || []).length, render: (fy) => (fy.periods || []).length },
        ]}
        rows={fiscalYears}
        getRowKey={(fy) => fy.id}
        onRowClick={(fy) => handleEdit(fiscalYears.indexOf(fy))}
        emptyMessage="No fiscal years configured. Click “Add Fiscal Year” to create one."
        defaultSortKey="name"
      />

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-[200] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-4xl w-full overflow-hidden"
            >
              {/* Modal Header */}
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  {editingIndex !== null ? 'Edit Fiscal Year' : 'Add Fiscal Year'}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 hover:bg-white hover:text-[#141414] transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
                {/* Top-level fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1">
                      Fiscal Year Name *
                    </label>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="e.g. FY 2026"
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1">
                      Budget Lock Date
                    </label>
                    <input
                      type="date"
                      value={draft.budgetLockDate}
                      onChange={(e) => setDraft({ ...draft, budgetLockDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1">
                      Start Date *
                    </label>
                    <input
                      type="date"
                      value={draft.startDate}
                      onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest block mb-1">
                      End Date *
                    </label>
                    <input
                      type="date"
                      value={draft.endDate}
                      onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>

                {/* ====== QUARTERS ====== */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest">
                      Quarters ({draft.quarters.length})
                    </h4>
                    <button
                      onClick={addQuarter}
                      className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] font-bold text-[10px] uppercase hover:bg-opacity-80 transition-all flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Quarter
                    </button>
                  </div>
                  {draft.quarters.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No quarters added.</p>
                  ) : (
                    <div className="bg-white border border-[#141414] overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                            <th className="p-2 border-r border-[#E4E3E0]/20">Quarter Name</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">Start Date</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">End Date</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">Budget Lock Date</th>
                            <th className="p-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141414]/10">
                          {draft.quarters.map((q, qi) => (
                            <tr key={q.id} className="hover:bg-[#F5F5F5] transition-colors">
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="text"
                                  value={q.name}
                                  onChange={(e) => updateQuarter(qi, 'name', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="date"
                                  value={q.startDate}
                                  onChange={(e) => updateQuarter(qi, 'startDate', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="date"
                                  value={q.endDate}
                                  onChange={(e) => updateQuarter(qi, 'endDate', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="date"
                                  value={q.budgetLockDate}
                                  onChange={(e) => updateQuarter(qi, 'budgetLockDate', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  onClick={() => deleteQuarter(qi)}
                                  className="p-1 hover:bg-red-500 hover:text-white transition-all"
                                  title="Remove quarter"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ====== PERIODS ====== */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest">
                      Periods ({draft.periods.length})
                    </h4>
                    <button
                      onClick={addPeriod}
                      className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] font-bold text-[10px] uppercase hover:bg-opacity-80 transition-all flex items-center gap-1"
                    >
                      <Plus size={12} /> Add Period
                    </button>
                  </div>
                  {draft.periods.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No periods added.</p>
                  ) : (
                    <div className="bg-white border border-[#141414] overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                            <th className="p-2 border-r border-[#E4E3E0]/20">Period Name</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">#</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">Start Date</th>
                            <th className="p-2 border-r border-[#E4E3E0]/20">End Date</th>
                            <th className="p-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141414]/10">
                          {draft.periods.map((p, pi) => (
                            <tr key={p.id} className="hover:bg-[#F5F5F5] transition-colors">
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="text"
                                  value={p.name}
                                  onChange={(e) => updatePeriod(pi, 'name', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="number"
                                  value={p.periodNumber}
                                  onChange={(e) => updatePeriod(pi, 'periodNumber', parseInt(e.target.value) || 0)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                  min={1}
                                  max={12}
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="date"
                                  value={p.startDate}
                                  onChange={(e) => updatePeriod(pi, 'startDate', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input
                                  type="date"
                                  value={p.endDate}
                                  onChange={(e) => updatePeriod(pi, 'endDate', e.target.value)}
                                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  onClick={() => deletePeriod(pi)}
                                  className="p-1 hover:bg-red-500 hover:text-white transition-all"
                                  title="Remove period"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ====== FOOTER BUTTONS ====== */}
                <div className="flex gap-2 items-center pt-4 border-t">
                  {/* Delete moved here from the table's old Actions column. */}
                  {editingIndex !== null && (
                    <button
                      onClick={() => {
                        if (editingIndex === null) return;
                        if (!confirm('Delete this fiscal year? This cannot be undone.')) return;
                        const updated = [...fiscalYears];
                        updated.splice(editingIndex, 1);
                        onUpdateFiscalYears(updated);
                        setShowModal(false);
                      }}
                      className="px-4 py-2 border border-red-500 text-red-600 text-xs font-bold uppercase hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                  <div className="flex gap-2 justify-end ml-auto">
                    <button
                      onClick={() => setShowModal(false)}
                      className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
                    >
                      <Save size={14} /> Save
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
    </div>
  );
}
