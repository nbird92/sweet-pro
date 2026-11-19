// Return Orders page — table view of every return-order record.
//
// PILOT of the standard page layout: <PageShell> (banner + toolbar search +
// content) with a variant="page" <DataTable> (sort, drag-to-reorder, show/hide
// columns, fixed Actions column). New / migrated pages should follow this file.
//
// The actual Add/Edit modals (BOL-picker etc.) live in App.tsx because they
// need access to invoices/orders/customers/contracts state. This component
// is purely the list + action triggers.

import React, { useMemo, useState } from 'react';
import { Plus, RotateCcw, Edit2, Trash2, FileText, Mail, CheckCircle2 } from 'lucide-react';
import PageShell, { BannerButton } from './PageShell';
import DataTable, { RowAction, type DataTableColumn } from './DataTable';
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

export default function ReturnOrdersPage({ returnOrders, onAdd, onEdit, onDelete, onPreview, onSendEmail, onReturnAndBill, onViewDetails, onStatusChange }: Props) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = returnOrders.filter(r => !r.hidden);
    if (!term) return list;
    return list.filter(r =>
      [r.bolNumber, r.originalBolNumber, r.customer, r.product, r.po, r.reasonForReturn]
        .some(v => (v || '').toLowerCase().includes(term))
    );
  }, [returnOrders, search]);

  const columns: DataTableColumn<ReturnOrder>[] = [
    { key: 'bolNumber', label: 'Return BOL', mono: true, bold: true, render: r => r.bolNumber || '—' },
    { key: 'originalBolNumber', label: 'Original BOL', mono: true, render: r => r.originalBolNumber || '—' },
    { key: 'customer', label: 'Customer', bold: true, render: r => r.customer || '—' },
    { key: 'product', label: 'Product', render: r => r.product || '—' },
    { key: 'po', label: 'PO', mono: true, render: r => r.po || '—' },
    { key: 'date', label: 'Date', render: r => r.date || '—' },
    {
      key: 'amount', label: 'Amount', align: 'right', mono: true, bold: true, sortValue: r => r.amount || 0,
      render: r => `$${(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      key: 'status', label: 'Status', render: r => (
        // Inline status dropdown styled like the pill. Completed orders are
        // locked (no rolling back a credit). Cancel is confirmed in the parent.
        <span onClick={e => e.stopPropagation()}>
          {r.status === 'Completed' ? (
            <span className="inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[8px] bg-green-100 text-green-700">{r.status}</span>
          ) : (
            <span className={`inline-flex items-center rounded-full pl-2 pr-1 py-0.5 cursor-pointer hover:ring-2 hover:ring-[#141414]/30 ${
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
            </span>
          )}
        </span>
      ),
    },
  ];

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
    <PageShell
      icon={<RotateCcw size={18} />}
      title="Return Orders"
      count={filtered.length}
      exportSheets={exportSheets}
      exportFileName="Return_Orders"
      actions={<BannerButton primary icon={<Plus size={12} />} onClick={onAdd}>Add Return Order</BannerButton>}
      search={{ value: search, onChange: setSearch, placeholder: 'Search by Return BOL, Original BOL, Customer, Product, PO or Reason…' }}
    >
      <DataTable<ReturnOrder>
        variant="page"
        title="Return Orders"
        storageKey="returnOrders"
        columns={columns}
        rows={filtered}
        getRowKey={r => r.id}
        onRowClick={onViewDetails}
        defaultSortKey="date"
        defaultSortDir="desc"
        stickyHeader
        emptyMessage={search ? 'No return orders match your search.' : 'No return orders yet. Click "Add Return Order" to create one against an existing BOL.'}
        rowActions={r => (
          <>
            <RowAction icon={<FileText size={14} />} title="Preview Return Order Confirmation" tone="success" onClick={() => onPreview(r)} />
            <RowAction icon={<Mail size={14} />} title="Email return confirmation to customer" tone="info" onClick={() => onSendEmail(r)} />
            {r.status === 'Confirmed' && (
              <RowAction icon={<CheckCircle2 size={14} />} title="Return & Bill — creates the R-BOL and the credit invoice" tone="success" onClick={() => onReturnAndBill(r)} />
            )}
            <RowAction icon={<Edit2 size={14} />} title="Edit return order" onClick={() => onEdit(r)} />
            <RowAction icon={<Trash2 size={14} />} title="Delete return order" tone="danger" onClick={() => { if (window.confirm(`Delete return order ${r.bolNumber}?`)) onDelete(r.id); }} />
          </>
        )}
      />
    </PageShell>
  );
}
