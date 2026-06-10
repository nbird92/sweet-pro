// Return Orders page — table view of every return-order record, with the
// same banner-driven CRUD pattern as the regular Orders page.
//
// Phase 1 scope:
//   - Table with sort + search (BOL, original BOL, customer, product, PO).
//   - "Add Return Order" button → opens the parent-controlled modal in App.
//   - Per-row Edit / Delete / Preview Return Order Confirmation actions.
//   - Excel export via the shared PageBanner.
//
// The actual Add/Edit modals (BOL-picker etc.) live in App.tsx because they
// need access to invoices/orders/customers/contracts state. This component
// is purely the list + action triggers.

import React, { useMemo, useState } from 'react';
import { Plus, RotateCcw, Edit2, Trash2, FileText, Mail, CheckCircle2 } from 'lucide-react';
import PageBanner from './PageBanner';
import type { ReturnOrder } from '../types';
import type { SheetSpec } from '../utils/exportExcel';

interface Props {
  returnOrders: ReturnOrder[];
  onAdd: () => void;
  onEdit: (returnOrder: ReturnOrder) => void;
  onDelete: (returnOrderId: string) => void;
  onPreview: (returnOrder: ReturnOrder) => void;
  onSendEmail: (returnOrder: ReturnOrder) => void;
  onReturnAndBill: (returnOrder: ReturnOrder) => void;
  onViewDetails: (returnOrder: ReturnOrder) => void;
  /** Change a return-order's status from the inline pill dropdown.
   *  Cancel is gated behind a window.confirm in the parent. */
  onStatusChange: (returnOrderId: string, newStatus: ReturnOrder['status']) => void;
}

type SortKey = keyof Pick<ReturnOrder, 'bolNumber' | 'originalBolNumber' | 'customer' | 'product' | 'po' | 'date' | 'amount' | 'status'>;

export default function ReturnOrdersPage({ returnOrders, onAdd, onEdit, onDelete, onPreview, onSendEmail, onReturnAndBill, onViewDetails, onStatusChange }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = returnOrders.filter(r => !r.hidden);
    if (term) {
      list = list.filter(r =>
        (r.bolNumber || '').toLowerCase().includes(term) ||
        (r.originalBolNumber || '').toLowerCase().includes(term) ||
        (r.customer || '').toLowerCase().includes(term) ||
        (r.product || '').toLowerCase().includes(term) ||
        (r.po || '').toLowerCase().includes(term) ||
        (r.reasonForReturn || '').toLowerCase().includes(term)
      );
    }
    list = [...list].sort((a, b) => {
      const av = (a[sortKey] ?? '') as string | number;
      const bv = (b[sortKey] ?? '') as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [returnOrders, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const exportSheets = (): SheetSpec[] => [{
    sheetName: 'Return Orders',
    title: 'Return Orders',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${returnOrders.length} return orders`,
    columns: [
      { header: 'Return BOL',     key: 'bolNumber' },
      { header: 'Original BOL',   key: 'originalBolNumber' },
      { header: 'Customer',       key: 'customer' },
      { header: 'Product',        key: 'product' },
      { header: 'PO',             key: 'po' },
      { header: 'Reason',         key: 'reasonForReturn' },
      { header: 'Status',         key: 'status' },
      { header: 'Date',           key: 'date' },
      { header: 'Shipment Date',  key: 'shipmentDate' },
      { header: 'Delivery Date',  key: 'deliveryDate' },
      { header: 'Total Weight (KG)', key: 'totalWeightKg', format: 'number' },
      { header: 'Amount',         key: 'amount', format: 'currency' },
      { header: 'Carrier',        key: 'carrier' },
      { header: 'Currency',       key: 'currency' },
      { header: 'Contract #',     key: 'contractNumber' },
    ],
    rows: returnOrders.map(r => ({
      ...r,
      totalWeightKg: (r.lineItems || []).reduce((s, li) => s + (li.totalWeight || 0), 0) * 1000,
    })) as any[],
  }];

  return (
    <div className="space-y-0">
      <PageBanner
        icon={<RotateCcw size={18} />}
        title="Return Orders"
        count={filtered.length}
        exportSheets={exportSheets}
        exportFileName="Return_Orders"
      >
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/20 transition-all whitespace-nowrap"
        >
          <Plus size={12} /> Add Return Order
        </button>
      </PageBanner>

      <div className="px-6 pt-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by Return BOL, Original BOL, Customer, Product, PO or Reason..."
          className="w-full bg-white border border-[#141414] p-3 text-xs uppercase tracking-widest font-bold placeholder:opacity-40 shadow-[2px_2px_0px_0px_rgba(20,20,20,1)] focus:outline-none"
        />
      </div>

      <div className="px-6 pb-6">
        <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                {([
                  ['bolNumber',         'Return BOL'],
                  ['originalBolNumber', 'Original BOL'],
                  ['customer',          'Customer'],
                  ['product',           'Product'],
                  ['po',                'PO'],
                  ['date',              'Date'],
                  ['amount',            'Amount'],
                  ['status',            'Status'],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <th
                    key={k}
                    onClick={() => toggleSort(k)}
                    className="p-3 border-r border-[#E4E3E0]/20 cursor-pointer hover:bg-[#E4E3E0]/10 transition-colors"
                  >
                    {label}{sortKey === k && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                  </th>
                ))}
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-[#F9F9F9] cursor-pointer" onClick={() => onViewDetails(r)}>
                  <td className="p-3 text-xs font-bold font-mono">{r.bolNumber || '—'}</td>
                  <td className="p-3 text-xs font-mono">{r.originalBolNumber || '—'}</td>
                  <td className="p-3 text-xs font-bold">{r.customer || '—'}</td>
                  <td className="p-3 text-xs">{r.product || '—'}</td>
                  <td className="p-3 text-xs font-mono">{r.po || '—'}</td>
                  <td className="p-3 text-xs">{r.date || '—'}</td>
                  <td className="p-3 text-xs font-mono font-bold">${(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    {/* Inline status dropdown styled like the pill, with a
                        visible ▾ chevron so the operator can tell it's
                        interactive. Completed orders are locked (no
                        rolling back a credit). Cancel goes through a confirm
                        in the parent handler. */}
                    {r.status === 'Completed' ? (
                      <span className="inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[8px] bg-green-100 text-green-700">{r.status}</span>
                    ) : (
                      <div className={`inline-flex items-center rounded-full pl-2 pr-1 py-0.5 cursor-pointer hover:ring-2 hover:ring-[#141414]/30 ${
                        r.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        <select
                          value={r.status}
                          onChange={(e) => onStatusChange(r.id, e.target.value as ReturnOrder['status'])}
                          className="appearance-none bg-transparent font-bold uppercase text-[8px] border-0 cursor-pointer focus:outline-none pr-1 m-0"
                          title="Change return order status"
                        >
                          <option value="Open">Open</option>
                          <option value="Confirmed">Confirmed</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                        <span className="text-[8px] font-bold opacity-70 select-none">▾</span>
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-xs" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onPreview(r)} className="p-1 hover:bg-emerald-600 hover:text-white transition-all" title="Preview Return Order Confirmation">
                        <FileText size={14} />
                      </button>
                      <button onClick={() => onSendEmail(r)} className="p-1 hover:bg-blue-600 hover:text-white transition-all" title="Email return confirmation to customer">
                        <Mail size={14} />
                      </button>
                      {r.status === 'Confirmed' && (
                        <button onClick={() => onReturnAndBill(r)} className="p-1 hover:bg-emerald-700 hover:text-white transition-all" title="Return & Bill — creates the R-BOL and the credit invoice">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      <button onClick={() => onEdit(r)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit return order">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => { if (window.confirm(`Delete return order ${r.bolNumber}?`)) onDelete(r.id); }} className="p-1 hover:bg-red-500 hover:text-white transition-all" title="Delete return order">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-xs opacity-50 italic">
                  {search ? 'No return orders match your search.' : 'No return orders yet. Click "Add Return Order" to create one against an existing BOL.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
