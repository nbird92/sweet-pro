// Standard detail modal used to view / edit / add / delete a single row
// from any DataTable across the app.
//
// Behaviour contract:
//   1. Title is always "<Table Name> Detail" — e.g. "Freight Rates Detail".
//      The parent passes the table name; the " Detail" suffix is appended
//      here so it's impossible to forget.
//   2. Two modes:
//        - mode="view"  → renders children + Edit + Delete + Close buttons.
//        - mode="edit"  → renders children + Save + Cancel buttons. The
//                          parent controls draft state and onSave.
//      mode="add" is just mode="edit" with no Delete button surfaced (the
//      parent passes onDelete only when editing an existing row).
//   3. Delete is gated behind a window.confirm — message is configurable
//      via deleteConfirmMessage.
//   4. Footer is sticky at the bottom of the modal (same pattern as the
//      Order Details modal) so action buttons are always reachable in
//      long forms.

import React from 'react';
import { motion } from 'motion/react';
import { X, Edit2, Trash2, CheckCircle2 } from 'lucide-react';

interface DetailModalProps {
  /** Table name. Modal title is "<tableName> Detail". */
  tableName: string;
  /** Optional icon shown in the header next to the title. */
  icon?: React.ReactNode;
  /** True when the modal is being rendered. Parent controls mounting. */
  isOpen: boolean;
  /** "view" shows Edit + Delete + Close. "edit"/"add" shows Save + Cancel. */
  mode: 'view' | 'edit' | 'add';
  /** Fired when the operator clicks Close, the backdrop, or Cancel. */
  onClose: () => void;
  /** Switch to edit mode. Required when mode="view". */
  onEdit?: () => void;
  /** Save handler — fired in edit + add modes. */
  onSave?: () => void;
  /** Delete handler — only rendered in view/edit mode; not in add mode. */
  onDelete?: () => void;
  /** Custom delete-confirm message. Defaults to "Delete this record?" */
  deleteConfirmMessage?: string;
  /** Disable the Save button while validation is failing. */
  saveDisabled?: boolean;
  /** Render the form / view content. */
  children: React.ReactNode;
}

export default function DetailModal({
  tableName,
  icon,
  isOpen,
  mode,
  onClose,
  onEdit,
  onSave,
  onDelete,
  deleteConfirmMessage,
  saveDisabled,
  children,
}: DetailModalProps) {
  if (!isOpen) return null;

  const title = `${tableName} Detail`;
  const isEditing = mode === 'edit' || mode === 'add';
  const isAdd = mode === 'add';

  const handleDelete = () => {
    if (!onDelete) return;
    const msg = deleteConfirmMessage || `Delete this ${tableName.toLowerCase().replace(/s$/, '')} record? This cannot be undone.`;
    if (window.confirm(msg)) onDelete();
  };

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center shrink-0">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            {icon}
            {isAdd ? `New ${tableName.toLowerCase().replace(/s$/, '')}` : title}
          </h3>
          {/* No close button in header — anchored to footer for consistency
              with the Order Details modal. */}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {children}
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t border-[#141414] bg-[#F5F5F5] p-4 flex justify-between items-center gap-2">
          <div className="flex gap-2">
            {!isAdd && onDelete && (
              <button
                onClick={handleDelete}
                className="px-4 py-2 border border-red-500 text-red-600 text-xs font-bold uppercase flex items-center gap-2 hover:bg-red-500 hover:text-white transition-all"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={onSave}
                  disabled={saveDisabled}
                  className="px-4 py-2 bg-emerald-700 text-white text-xs font-bold uppercase hover:bg-emerald-800 transition-all flex items-center gap-2 disabled:opacity-40"
                >
                  <CheckCircle2 size={14} /> {isAdd ? 'Create' : 'Save Changes'}
                </button>
              </>
            ) : (
              <>
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
                  >
                    <Edit2 size={14} /> Edit
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-white transition-all"
                >
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** Compact label / value row used inside DetailModal view-mode content.
 *  Mirrors the styling used in the Confirm Order Status Change modal so
 *  the standardized look stays consistent. */
export function DetailRow({
  label,
  value,
  mono,
  bold,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-3 py-1">
      <div className="text-[10px] uppercase font-bold opacity-50 tracking-widest">{label}</div>
      <div className={`text-sm ${bold ? 'font-bold' : ''} ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}

/** Compact form field used inside DetailModal edit-mode content. */
export function DetailField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase font-bold opacity-50 tracking-widest">
        {label}
        {required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {children}
      {hint && <div className="text-[10px] opacity-60">{hint}</div>}
    </div>
  );
}
