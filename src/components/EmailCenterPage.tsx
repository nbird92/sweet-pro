// Email Center — operator's view of every outbound email the app has sent
// (or attempted to send) plus the global email-sending settings.
//
// Phase 1 scope: read-only log, settings editor, manual sends only.
// Phase 2 will add automation triggers + retry/resend actions; the wiring
// here already supports those — just no UI for them yet.

import React, { useMemo, useState } from 'react';
import { Mail, Settings, AlertTriangle, CheckCircle2, Clock, X, Inbox, Pencil, RefreshCw, ChevronRight, ChevronDown, Trash2, Paperclip } from 'lucide-react';
import PageBanner from './PageBanner';
import type { EmailLog, EmailSettings, EmailStatus, EmailDocumentType, PoImportLogEntry, PoAmendment, PoPendingImport, InboxFeedItem, InboxTriage } from '../types';

interface Props {
  emailLog: EmailLog[];
  emailSettings: EmailSettings;
  setEmailSettings: (next: EmailSettings) => void;
  /** Dashboard log of POs imported from the Gmail inbox scan. */
  poImportLog?: PoImportLogEntry[];
  /** Emailed new POs awaiting operator approval (no longer auto-created). */
  poPendingImports?: PoPendingImport[];
  /** Open the given pending imports in the review-and-approve modal. */
  onReviewImports?: (imports: PoPendingImport[]) => void;
  /** Discard a pending import without creating an order. */
  onDismissImport?: (imp: PoPendingImport) => void;
  /** Delete a single Email Import History entry. */
  onDeleteImport?: (id: string) => void;
  /** Clear the whole Email Import History. */
  onClearImportHistory?: () => void;
  /** Read-only inbox feed (rolling ~7 days) of the order-desk mailbox. */
  inboxFeed?: InboxFeedItem[];
  /** Operator triage state for feed emails (handled/dismissed). */
  inboxTriage?: InboxTriage[];
  /** Open the pending PO(s) extracted from a feed email in the review modal. */
  onReviewFeedPo?: (feedId: string, poNumber?: string) => void;
  onDismissInbox?: (id: string) => void;
  onMarkInboxHandled?: (id: string) => void;
  onReopenInbox?: (id: string) => void;
  onRefreshInbox?: () => void;
  /** Review queue of emailed order amendments/cancellations. */
  poAmendments?: PoAmendment[];
  onApplyAmendment?: (a: PoAmendment) => void;
  onDismissAmendment?: (a: PoAmendment) => void;
  /** Trigger an ad-hoc inbox scan now; resolves with the run summary. */
  onScanInbox?: (opts?: { force?: boolean }) => Promise<{ ok: boolean; summary?: any; error?: string }>;
}

/** Compact "before → after" description of a requested amendment. */
function amendmentChangeText(a: PoAmendment): string {
  if (a.kind === 'cancellation' || a.cancel) return 'Cancel order';
  const parts: string[] = [];
  if (a.newShipmentDate) parts.push(`Ship ${a.prevShipmentDate || '—'} → ${a.newShipmentDate}`);
  if (a.newDeliveryDate) parts.push(`Delivery ${a.prevDeliveryDate || '—'} → ${a.newDeliveryDate}`);
  if (typeof a.newQuantityMt === 'number') parts.push(`Qty ${a.prevQuantityMt != null ? a.prevQuantityMt.toFixed(2) : '—'} → ${a.newQuantityMt.toFixed(2)} MT`);
  if (a.newSplitNumber) parts.push(`Split ${a.prevSplitNumber || '—'} → ${a.newSplitNumber}`);
  return parts.join('   ·   ') || (a.summary || 'See email');
}

// Sender bucket chip for the inbox feed: customer / internal / logistics.
function SenderCategoryChip({ category }: { category?: 'customer' | 'internal' | 'logistics' }) {
  if (!category) return null;
  const m = {
    customer:  { label: 'Customer',  cls: 'bg-sky-100    text-sky-800'    },
    internal:  { label: 'Internal',  cls: 'bg-slate-200  text-slate-700'  },
    logistics: { label: 'Logistics', cls: 'bg-violet-100 text-violet-800' },
  }[category];
  if (!m) return null;
  return <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase ${m.cls}`}>{m.label}</span>;
}

const TYPE_LABELS: Record<EmailDocumentType, string> = {
  order_confirmation: 'Order Confirmation',
  bol: 'Bill of Lading',
  coa: 'Certificate of Analysis',
  invoice: 'Invoice',
  return_order_confirmation: 'Return Order Confirmation',
};

const STATUS_STYLES: Record<EmailStatus, string> = {
  queued:  'bg-amber-100  text-amber-800',
  sending: 'bg-blue-100   text-blue-800',
  sent:    'bg-emerald-100 text-emerald-800',
  failed:  'bg-red-100    text-red-700',
  bounced: 'bg-red-100    text-red-700',
};

export default function EmailCenterPage({ emailLog, emailSettings, setEmailSettings, poImportLog = [], poPendingImports = [], onReviewImports, onDismissImport, onDeleteImport, onClearImportHistory, inboxFeed = [], inboxTriage = [], onReviewFeedPo, onDismissInbox, onMarkInboxHandled, onReopenInbox, onRefreshInbox, poAmendments = [], onApplyAmendment, onDismissAmendment, onScanInbox }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const [expandedImport, setExpandedImport] = useState<string | null>(null);
  const [expandedFeed, setExpandedFeed] = useState<string | null>(null);
  const [feedShowAll, setFeedShowAll] = useState(false);
  const triageMap = useMemo(() => {
    const m: Record<string, InboxTriage['status']> = {};
    for (const t of inboxTriage) m[t.id] = t.status;
    return m;
  }, [inboxTriage]);
  const feedSorted = useMemo(
    () => [...inboxFeed].sort((a, b) => (b.internalDateMs || 0) - (a.internalDateMs || 0) || (b.receivedAt || '').localeCompare(a.receivedAt || '')),
    [inboxFeed],
  );
  const feedVisible = useMemo(
    () => feedShowAll ? feedSorted : feedSorted.filter(e => !triageMap[e.id]),
    [feedSorted, feedShowAll, triageMap],
  );
  const feedOpenCount = useMemo(() => feedSorted.filter(e => !triageMap[e.id]).length, [feedSorted, triageMap]);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const handleScanInbox = async (opts?: { force?: boolean }) => {
    if (!onScanInbox || scanning) return;
    setScanning(true);
    setScanMsg(null);
    const r = await onScanInbox(opts);
    setScanning(false);
    if (r.ok) {
      const s = r.summary || {};
      const scanned = s.scanned ?? 0;
      const skipped = s.skipped ?? 0;
      const queued = s.queued ?? 0;
      const found = scanned + skipped;
      let errs = '';
      if (s.errors?.length) {
        // Surface the most common error message so the cause is visible (e.g. a
        // rate-limit / quota error vs. a parse error), not just the count.
        const distinct = Array.from(new Set((s.errors as any[]).map(e => (e?.message || '').trim()).filter(Boolean)));
        errs = ` · ${s.errors.length} error(s)`;
        if (distinct[0]) errs += ` — e.g. "${String(distinct[0]).slice(0, 200)}"`;
      }
      let text: string;
      if (found === 0) {
        // The inbox query matched no messages — almost always a query/scope or
        // address issue, not a genuine "no POs" situation.
        text = 'No emails matched the inbox query in the last 3 days. If you expected POs, check the inbox address and PO_INBOX_QUERY — group mail is matched by "to:" (e.g. to:orderdesk@sucro.ca), not "deliveredto:".';
      } else if (scanned === 0) {
        text = `Found ${found} email${found === 1 ? '' : 's'} in the last 3 days, all already processed. Use "Re-import last 3 days" to pull them in again.`;
      } else {
        text = `Scanned ${scanned} of ${found} email${found === 1 ? '' : 's'} · ${queued} queued · ${skipped} already processed${errs}. New orders/amendments appear below.`;
      }
      if (s.partial) text += ` Stopped early to avoid a timeout — ${s.remaining ?? 0} more to go; click Scan Inbox Now again to continue.`;
      setScanMsg({ ok: true, text });
    } else {
      setScanMsg({ ok: false, text: `Scan failed: ${r.error || 'unknown error'}` });
    }
  };
  const [statusFilter, setStatusFilter] = useState<EmailStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<EmailDocumentType | 'all'>('all');
  const [viewingLog, setViewingLog] = useState<EmailLog | null>(null);

  const filtered = useMemo(() => {
    const list = emailLog.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (typeFilter   !== 'all' && e.type   !== typeFilter)   return false;
      return true;
    });
    // newest first
    return [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [emailLog, statusFilter, typeFilter]);

  const counts = useMemo(() => {
    const c = { total: emailLog.length, sent: 0, failed: 0, queued: 0, testMode: 0 };
    for (const e of emailLog) {
      if (e.status === 'sent') c.sent++;
      else if (e.status === 'failed' || e.status === 'bounced') c.failed++;
      else c.queued++;
      if (e.testMode) c.testMode++;
    }
    return c;
  }, [emailLog]);

  // PO import dashboard — newest first + outcome counts.
  const poImports = useMemo(
    () => [...poImportLog].sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || '')),
    [poImportLog],
  );
  const lastImport = poImports[0]?.importedAt;
  const importCounts = useMemo(() => {
    const c = { total: poImportLog.length, created: 0, updated: 0, duplicate: 0, skipped: 0 };
    for (const e of poImportLog) {
      if (e.result === 'created') c.created++;
      else if (e.result === 'updated') c.updated++;
      else if (e.result === 'duplicate') c.duplicate++;
      else c.skipped++;
    }
    return c;
  }, [poImportLog]);

  // Emailed POs awaiting approval — newest first.
  const pendingImportsSorted = useMemo(
    () => [...poPendingImports].sort((a, b) => (b.receivedAt || b.createdAt || '').localeCompare(a.receivedAt || a.createdAt || '')),
    [poPendingImports],
  );

  // Amendment review queue — pending/unmatched first (need action), then newest.
  const amendmentsSorted = useMemo(() => {
    const rank = (s: PoAmendment['status']) => (s === 'pending' ? 0 : s === 'unmatched' ? 1 : 2);
    return [...poAmendments].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      return r !== 0 ? r : (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [poAmendments]);
  const pendingAmendments = poAmendments.filter(a => a.status === 'pending' || a.status === 'unmatched').length;

  const setSettings = (patch: Partial<EmailSettings>) => setEmailSettings({ ...emailSettings, ...patch });
  const setTriggers = (patch: Partial<EmailSettings['triggers']>) =>
    setEmailSettings({ ...emailSettings, triggers: { ...emailSettings.triggers, ...patch } });

  return (
    <div>
      <PageBanner icon={<Mail size={18} />} title="Email Center" count={emailLog.length}>
        {onScanInbox && (
          <button
            onClick={handleScanInbox}
            disabled={scanning}
            title="Scan the PO inbox now instead of waiting for the 15-minute schedule."
            className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> {scanning ? 'Scanning…' : 'Scan Inbox Now'}
          </button>
        )}
        {onScanInbox && (
          <button
            onClick={() => handleScanInbox({ force: true })}
            disabled={scanning}
            title="Re-import POs from the last 3 days, including emails already processed. Existing orders are never duplicated."
            className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap disabled:opacity-50"
          >
            <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} /> Re-import last 3 days
          </button>
        )}
        <button
          onClick={() => setShowSettings(true)}
          className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap"
        >
          <Settings size={12} /> Settings
        </button>
      </PageBanner>

      {/* Test-mode + master-switch banner */}
      <div className="px-6 pt-4">
        {scanMsg && (
          <div className={`border p-3 text-xs mb-3 flex items-center justify-between gap-2 ${scanMsg.ok ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-red-500 bg-red-50 text-red-800'}`}>
            <span className="flex items-center gap-2">{scanMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {scanMsg.text}</span>
            <button onClick={() => setScanMsg(null)} className="hover:opacity-70"><X size={14} /></button>
          </div>
        )}
        {!emailSettings.enabled && (
          <div className="border border-red-500 bg-red-50 text-red-800 p-3 text-xs mb-3 flex items-center gap-2">
            <AlertTriangle size={14} /> Email sending is DISABLED globally. Open Settings to turn it on.
          </div>
        )}
        {emailSettings.enabled && emailSettings.testMode && (
          <div className="border border-amber-400 bg-amber-50 text-amber-800 p-3 text-xs mb-3 flex items-center gap-2">
            <AlertTriangle size={14} />
            Test mode is ON. Every send is rerouted to <span className="font-mono font-bold">{emailSettings.testAddress || '(no test address set)'}</span> with a [TEST → original] subject prefix. Configure in Settings.
          </div>
        )}
      </div>

      {/* Live inbox feed — read-only mirror of the order-desk mailbox */}
      <div className="px-6 pt-2 pb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Inbox size={14} /> Inbox Feed</h3>
            {feedOpenCount > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[9px] font-bold uppercase">{feedOpenCount} open</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFeedShowAll(v => !v)} className="px-2 py-1 border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#F5F5F5]">{feedShowAll ? 'Show open only' : 'Show all'}</button>
            {onRefreshInbox && <button onClick={() => onRefreshInbox()} title="Refresh feed" className="px-2 py-1 border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#F5F5F5] flex items-center gap-1"><RefreshCw size={11} /> Refresh</button>}
          </div>
        </div>
        <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-auto max-h-[520px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                <th className="p-3 bg-[#141414] border-r border-white/20 w-6"></th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Received</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">From</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Subject</th>
                <th className="p-3 bg-[#141414] border-r border-white/20 text-center">Att</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Suggested action</th>
                <th className="p-3 bg-[#141414]">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {feedVisible.map(e => {
                const open = expandedFeed === e.id;
                const status = triageMap[e.id];
                return (
                  <React.Fragment key={e.id}>
                    <tr className={`hover:bg-[#F9F9F9] cursor-pointer ${status ? 'opacity-60' : ''}`} onClick={() => setExpandedFeed(open ? null : e.id)}>
                      <td className="p-3 text-xs">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                      <td className="p-3 text-xs font-mono whitespace-nowrap">{e.receivedAt ? new Date(e.receivedAt).toLocaleString() : '—'}</td>
                      <td className="p-3 text-xs max-w-[180px]" title={e.fromEmail}>
                        <div className="truncate">{e.fromName || e.fromEmail || '—'}</div>
                        <SenderCategoryChip category={e.senderCategory} />
                      </td>
                      <td className="p-3 text-xs max-w-[280px] truncate" title={e.subject}>{e.subject || '(no subject)'}</td>
                      <td className="p-3 text-center">{e.hasAttachments ? <Paperclip size={12} className="inline opacity-60" /> : ''}</td>
                      <td className="p-3">
                        <FeedSuggestionPill suggestion={e.suggestion} poNumber={e.poNumber} />
                        {e.suggestion && e.suggestion !== 'none' && (e.customer || e.carrier) && (
                          <div className="text-[9px] opacity-60 mt-0.5">{[e.customer, e.carrier && `via ${e.carrier}`].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td className="p-3 text-[9px] uppercase font-bold opacity-60">{status || 'open'}</td>
                    </tr>
                    {open && (
                      <tr className="bg-[#FAFAFA]">
                        <td colSpan={7} className="p-4">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                            <Row label="From" value={[e.fromName, e.fromEmail].filter(Boolean).join(' · ') || '—'} />
                            <Row label="Received" value={e.receivedAt ? new Date(e.receivedAt).toLocaleString() : '—'} />
                            <Row label="Subject" value={e.subject || '(no subject)'} />
                            <Row label="Attachments" value={e.attachments?.length ? e.attachments.map(a => a.filename).join(', ') : '—'} />
                            {e.customer && <Row label="Customer" value={e.customer} />}
                            {e.carrier && <Row label="Carrier" value={e.carrier} />}
                          </div>
                          <div className="border border-[#141414]/15 bg-white p-3 text-xs whitespace-pre-wrap max-h-[320px] overflow-auto">{e.body || e.snippet || '(no body text)'}</div>
                          <div className="mt-3 flex justify-end items-center gap-2">
                            {e.suggestion === 'new_po' && onReviewFeedPo && (
                              <button onClick={() => onReviewFeedPo(e.id, e.poNumber)} className="px-3 py-1.5 bg-emerald-700 text-white text-[10px] font-bold uppercase hover:bg-emerald-800">Review &amp; Approve PO</button>
                            )}
                            {(e.suggestion === 'amendment' || e.suggestion === 'cancellation') && (
                              <span className="text-[10px] uppercase font-bold text-amber-700 mr-auto">Order change — review under Order Amendments below</span>
                            )}
                            {status ? (
                              onReopenInbox && <button onClick={() => onReopenInbox(e.id)} className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">Reopen</button>
                            ) : (
                              <>
                                {onMarkInboxHandled && <button onClick={() => onMarkInboxHandled(e.id)} className="px-3 py-1.5 border border-emerald-600 text-emerald-700 text-[10px] font-bold uppercase hover:bg-emerald-50">Mark handled</button>}
                                {onDismissInbox && <button onClick={() => onDismissInbox(e.id)} className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">Dismiss</button>}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {feedVisible.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-xs opacity-50 italic">{inboxFeed.length === 0 ? 'No inbox emails yet. The scan mirrors the order-desk mailbox here every 15 minutes — run "Scan Inbox Now" to populate it.' : 'No open emails — switch to "Show all" to see triaged mail.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Emailed POs awaiting operator approval (no longer auto-created) */}
      {pendingImportsSorted.length > 0 && (
        <div className="px-6 pt-2 pb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Inbox size={14} /> PO Imports — Awaiting Approval</h3>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold uppercase">{pendingImportsSorted.length} to review</span>
            </div>
            {onReviewImports && (
              <button onClick={() => onReviewImports(pendingImportsSorted)} className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:opacity-80">Review all ({pendingImportsSorted.length})</button>
            )}
          </div>
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-auto max-h-[460px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <th className="p-3 bg-[#141414] border-r border-white/20 w-6"></th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Received</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">From</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Subject</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">PO No.</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Customer</th>
                  <th className="p-3 bg-[#141414]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {pendingImportsSorted.map(imp => {
                  const ex = imp.extraction || {};
                  const lines = Array.isArray(ex.lineItems) ? ex.lineItems : [];
                  const open = expandedImport === imp.id;
                  return (
                    <React.Fragment key={imp.id}>
                      <tr className="hover:bg-[#F9F9F9] cursor-pointer" onClick={() => setExpandedImport(open ? null : imp.id)}>
                        <td className="p-3 text-xs">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="p-3 text-xs font-mono whitespace-nowrap">{(imp.receivedAt || imp.createdAt) ? new Date(imp.receivedAt || imp.createdAt).toLocaleString() : '—'}</td>
                        <td className="p-3 text-xs max-w-[180px] truncate" title={imp.fromEmail}>{imp.fromEmail || '—'}</td>
                        <td className="p-3 text-xs max-w-[240px] truncate" title={imp.subject}>{imp.subject || '—'}</td>
                        <td className="p-3 text-xs font-mono font-bold">{imp.poNumber || ex.poNumber || '—'}</td>
                        <td className="p-3 text-xs">{imp.customer || ex.customerName || '—'}</td>
                        <td className="p-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-2">
                            <button onClick={() => onReviewImports?.([imp])} className="px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[9px] font-bold uppercase hover:bg-emerald-800">Review &amp; Approve</button>
                            <button onClick={() => onDismissImport?.(imp)} className="px-2 py-0.5 rounded-full border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#F5F5F5]">Dismiss</button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-[#FAFAFA]">
                          <td colSpan={7} className="p-4">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                              <Row label="Customer (read)" value={ex.customerName || '—'} />
                              <Row label="PO Number" value={ex.poNumber || '—'} mono />
                              <Row label="Ship To" value={[ex.shipToName, ex.shipToAddress].filter(Boolean).join(', ') || '—'} />
                              <Row label="Contract" value={ex.contractNumber || '—'} mono />
                              <Row label="Ship / Delivery" value={[ex.shipmentDate, ex.deliveryDate].filter(Boolean).join('  →  ') || '—'} />
                              <Row label="Incoterms" value={ex.shippingTerms || '—'} />
                            </div>
                            <div className="border border-[#141414]/15 bg-white">
                              <table className="w-full text-xs">
                                <thead className="bg-[#F5F5F5] border-b border-[#141414]/15">
                                  <tr>
                                    <th className="p-2 text-left font-bold">Product (read)</th>
                                    <th className="p-2 text-left font-bold">Item #</th>
                                    <th className="p-2 text-right font-bold">Qty</th>
                                    <th className="p-2 text-right font-bold">Qty (MT)</th>
                                    <th className="p-2 text-right font-bold">$/MT</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.map((li: any, i: number) => (
                                    <tr key={i} className="border-b border-[#141414]/5">
                                      <td className="p-2">{li.description || '—'}</td>
                                      <td className="p-2 font-mono">{li.itemNumber || '—'}</td>
                                      <td className="p-2 text-right font-mono">{li.quantity != null ? `${li.quantity}${li.unit ? ' ' + li.unit : ''}` : '—'}</td>
                                      <td className="p-2 text-right font-mono">{typeof li.quantityMt === 'number' ? li.quantityMt.toFixed(3) : '—'}</td>
                                      <td className="p-2 text-right font-mono">{typeof li.pricePerMt === 'number' ? `$${li.pricePerMt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                                    </tr>
                                  ))}
                                  {lines.length === 0 && <tr><td colSpan={5} className="p-3 text-center opacity-50 italic">No line items extracted.</td></tr>}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                              <button onClick={() => onDismissImport?.(imp)} className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5]">Dismiss</button>
                              <button onClick={() => onReviewImports?.([imp])} className="px-3 py-1.5 bg-emerald-700 text-white text-[10px] font-bold uppercase hover:bg-emerald-800">Review &amp; Approve</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PO import history — approved / dismissed / duplicate emailed POs */}
      <div className="px-6 pt-2 pb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Inbox size={14} /> Email Import History</h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] opacity-50 font-mono">
              {importCounts.total} imported{lastImport ? ` · last ${new Date(lastImport).toLocaleString()}` : ''}
              {importCounts.duplicate > 0 ? ` · ${importCounts.duplicate} dup` : ''}
              {importCounts.skipped > 0 ? ` · ${importCounts.skipped} skipped` : ''}
            </span>
            {onClearImportHistory && poImports.length > 0 && (
              <button
                onClick={() => { if (window.confirm(`Delete all ${poImports.length} import history entries? This does not affect any orders already created.`)) onClearImportHistory(); }}
                className="px-2 py-1 border border-[#141414] text-[9px] font-bold uppercase flex items-center gap-1 hover:bg-red-50 hover:border-red-500 hover:text-red-700 transition-all"
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
          </div>
        </div>
        <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-auto max-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                <th className="p-3 bg-[#141414] border-r border-white/20">Imported</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">From</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Subject</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">File</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">PO No.</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Customer</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Order (BOL)</th>
                <th className="p-3 bg-[#141414] border-r border-white/20 text-right">Amount</th>
                <th className="p-3 bg-[#141414] border-r border-white/20">Result</th>
                <th className="p-3 bg-[#141414] text-center">Delete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {poImports.map(e => (
                <tr key={e.id} className="hover:bg-[#F9F9F9]">
                  <td className="p-3 text-xs font-mono whitespace-nowrap">{e.importedAt ? new Date(e.importedAt).toLocaleString() : '—'}</td>
                  <td className="p-3 text-xs">{e.fromEmail || '—'}</td>
                  <td className="p-3 text-xs max-w-[240px] truncate" title={e.subject}>{e.subject || '—'}</td>
                  <td className="p-3 text-xs font-mono">{e.sourceFile || '—'}</td>
                  <td className="p-3 text-xs font-mono font-bold">{e.poNumber || '—'}</td>
                  <td className="p-3 text-xs">{e.customer || '—'}</td>
                  <td className="p-3 text-xs font-mono">{e.orderBol || '—'}</td>
                  <td className="p-3 text-xs text-right font-mono">{typeof e.amount === 'number' && e.amount > 0 ? `$${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                  <td className="p-3"><ImportResultPill result={e.result} note={e.note} /></td>
                  <td className="p-3 text-center">
                    <button onClick={() => onDeleteImport?.(e.id)} title="Delete this history entry" className="text-red-600 hover:bg-red-50 p-1 rounded">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {poImports.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-xs opacity-50 italic">No emailed POs processed yet. The inbox scan runs every 15 minutes; new POs appear above under "Awaiting Approval" for review — approved or dismissed ones land here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order amendment review queue — emailed changes awaiting approval */}
      {poAmendments.length > 0 && (
        <div className="px-6 pt-2 pb-5">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Pencil size={14} /> Order Amendments</h3>
            {pendingAmendments > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold uppercase">{pendingAmendments} to review</span>}
          </div>
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-auto max-h-[380px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <th className="p-3 bg-[#141414] border-r border-white/20">Received</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">From</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">PO No.</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Order (BOL)</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Requested change</th>
                  <th className="p-3 bg-[#141414] border-r border-white/20">Status</th>
                  <th className="p-3 bg-[#141414]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {amendmentsSorted.map(a => (
                  <tr key={a.id} className="hover:bg-[#F9F9F9]">
                    <td className="p-3 text-xs font-mono whitespace-nowrap">{(a.receivedAt || a.createdAt) ? new Date(a.receivedAt || a.createdAt).toLocaleString() : '—'}</td>
                    <td className="p-3 text-xs max-w-[200px] truncate" title={a.subject}>{a.fromEmail || '—'}</td>
                    <td className="p-3 text-xs font-mono font-bold">{a.poNumber || '—'}</td>
                    <td className="p-3 text-xs font-mono">{a.orderBol || '—'}</td>
                    <td className={`p-3 text-xs ${a.kind === 'cancellation' || a.cancel ? 'text-red-700 font-bold' : ''}`} title={a.summary}>{amendmentChangeText(a)}</td>
                    <td className="p-3"><AmendmentStatusPill status={a.status} /></td>
                    <td className="p-3 whitespace-nowrap">
                      {a.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button onClick={() => onApplyAmendment?.(a)} className="px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[9px] font-bold uppercase hover:bg-emerald-800">Apply</button>
                          <button onClick={() => onDismissAmendment?.(a)} className="px-2 py-0.5 rounded-full border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#F5F5F5]">Dismiss</button>
                        </div>
                      ) : a.status === 'unmatched' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] uppercase opacity-60">no matching order</span>
                          <button onClick={() => onDismissAmendment?.(a)} className="px-2 py-0.5 rounded-full border border-[#141414] text-[9px] font-bold uppercase hover:bg-[#F5F5F5]">Dismiss</button>
                        </div>
                      ) : a.status === 'applied' ? (
                        <span className="text-[9px] uppercase opacity-60">{a.appliedAt ? `applied ${new Date(a.appliedAt).toLocaleDateString()}` : 'applied'}</span>
                      ) : (
                        <span className="text-[9px] uppercase opacity-40">dismissed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="px-6 grid grid-cols-4 gap-4 mb-4">
        <StatTile label="Total" value={counts.total} />
        <StatTile label="Sent" value={counts.sent} accent="emerald" />
        <StatTile label="Failed" value={counts.failed} accent="red" />
        <StatTile label="Test-mode sends" value={counts.testMode} accent="amber" />
      </div>

      {/* Filters */}
      <div className="px-6 mb-3 flex items-center gap-3 text-xs">
        <label className="opacity-60 uppercase tracking-widest text-[10px] font-bold">Type</label>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="border border-[#141414] bg-white p-1.5">
          <option value="all">All</option>
          {(Object.keys(TYPE_LABELS) as EmailDocumentType[]).map(t => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        <label className="opacity-60 uppercase tracking-widest text-[10px] font-bold">Status</label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="border border-[#141414] bg-white p-1.5">
          <option value="all">All</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="bounced">Bounced</option>
          <option value="queued">Queued</option>
          <option value="sending">Sending</option>
        </select>
      </div>

      {/* Log table */}
      <div className="px-6 pb-6">
        <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                <th className="p-3 border-r border-white/20">When</th>
                <th className="p-3 border-r border-white/20">Type</th>
                <th className="p-3 border-r border-white/20">Customer</th>
                <th className="p-3 border-r border-white/20">Recipient</th>
                <th className="p-3 border-r border-white/20">Subject</th>
                <th className="p-3 border-r border-white/20">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {filtered.map(log => (
                <tr key={log.id} className="hover:bg-[#F9F9F9] cursor-pointer" onClick={() => setViewingLog(log)}>
                  <td className="p-3 text-xs font-mono">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                  <td className="p-3 text-xs">{TYPE_LABELS[log.type]}</td>
                  <td className="p-3 text-xs font-bold">{log.customerName || '—'}</td>
                  <td className="p-3 text-xs font-mono">
                    {log.actualRecipientTo?.length ? log.actualRecipientTo.join(', ') : (log.recipientTo?.join(', ') || '—')}
                    {log.testMode && <span className="ml-2 text-[10px] uppercase font-bold opacity-60">[test]</span>}
                  </td>
                  <td className="p-3 text-xs max-w-[280px] truncate" title={log.subject}>{log.subject}</td>
                  <td className="p-3"><StatusPill status={log.status} /></td>
                  <td className="p-3"><button className="text-[10px] uppercase font-bold opacity-60 hover:opacity-100">View</button></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-xs opacity-50 italic">No emails {statusFilter !== 'all' || typeFilter !== 'all' ? 'match the current filters' : 'sent yet'}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[600] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
          <div className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Settings size={14} /> Email Center Settings</h3>
              <button onClick={() => setShowSettings(false)} className="hover:opacity-70"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-5 text-sm">
              <ToggleRow
                label="Email sending enabled"
                description="Master kill switch. When off, no sends happen at all — even manual ones."
                checked={emailSettings.enabled}
                onChange={v => setSettings({ enabled: v })}
              />
              <ToggleRow
                label="Test mode"
                description="When ON, every send is rerouted to the test address below with a [TEST] subject prefix. Strongly recommended until you've verified the full pipeline."
                checked={emailSettings.testMode}
                onChange={v => setSettings({ testMode: v })}
              />
              <Field label="Test address" hint="Where test-mode sends go (e.g. your own inbox).">
                <input type="email" value={emailSettings.testAddress} onChange={e => setSettings({ testAddress: e.target.value })} placeholder="you@sucrocanada.com" className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm" />
              </Field>
              <Field label="From name" hint="Shown to the recipient as the sender's name.">
                <input value={emailSettings.fromName} onChange={e => setSettings({ fromName: e.target.value })} className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm" />
              </Field>
              <Field label="From address" hint="Overrides the server's EMAIL_FROM_ADDRESS env var. Leave blank to fall back to that env var (or Resend's onboarding@resend.dev tester if no env var is set). MUST be a verified sender on your Resend account — unverified domains are rejected with a validation_error.">
                <input value={emailSettings.fromAddress || ''} onChange={e => setSettings({ fromAddress: e.target.value })} placeholder="onboarding@resend.dev" className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm" />
              </Field>
              <Field label="Reply-to address" hint="Where customer replies land. Leave blank to default to the From address.">
                <input value={emailSettings.replyToAddress || ''} onChange={e => setSettings({ replyToAddress: e.target.value })} className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm" />
              </Field>
              <Field label="Internal CC (comma-separated)" hint="Always CC these addresses on every outbound email. Used for internal audit / sales visibility.">
                <input
                  value={emailSettings.internalCc.join(', ')}
                  onChange={e => setSettings({ internalCc: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm"
                />
              </Field>
              <div className="border-t border-[#141414]/20 pt-4">
                <div className="text-[10px] uppercase font-bold opacity-50 mb-2">Emailed PO import</div>
                <ToggleRow
                  label="Auto-approve emailed POs"
                  description="When ON, a scanned PO at/above the confidence threshold whose customer matches a known customer is created as an Open order automatically, skipping the review queue. Leave OFF to review every PO. Best once the scan has been reliable for a customer."
                  checked={!!emailSettings.autoApproveEmailedPos}
                  onChange={v => setSettings({ autoApproveEmailedPos: v })}
                  compact
                />
                {emailSettings.autoApproveEmailedPos && (
                  <Field label="Auto-approve confidence threshold" hint="0–1. POs at or above this AI confidence auto-create (default 0.85).">
                    <input
                      type="number" min="0" max="1" step="0.05"
                      value={emailSettings.autoApproveMinConfidence ?? 0.85}
                      onChange={e => setSettings({ autoApproveMinConfidence: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0.85)) })}
                      className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm"
                    />
                  </Field>
                )}
              </div>
              <div className="border-t border-[#141414]/20 pt-4">
                <div className="text-[10px] uppercase font-bold opacity-50 mb-2">Auto-send triggers</div>
                <div className="space-y-2">
                  <ToggleRow
                    label="Order confirmation when status → Confirmed"
                    description="Sent to customer.customerServiceEmail. Phase 2 — wiring exists, flip on when ready."
                    checked={emailSettings.triggers.orderConfirmationOnConfirmed}
                    onChange={v => setTriggers({ orderConfirmationOnConfirmed: v })}
                    compact
                  />
                  <ToggleRow
                    label="Bill of Lading on Complete &amp; Bill"
                    description="When an order is completed and billed, email the BOL PDF to customer.customerServiceEmail."
                    checked={emailSettings.triggers.bolOnCompletedAndBilled}
                    onChange={v => setTriggers({ bolOnCompletedAndBilled: v })}
                    compact
                  />
                  <ToggleRow
                    label="Certificate of Analysis on Complete &amp; Bill"
                    description="Same trigger as BOL. Routed to customer.qaContractEmail when set, otherwise customerServiceEmail."
                    checked={emailSettings.triggers.coaOnCompletedAndBilled}
                    onChange={v => setTriggers({ coaOnCompletedAndBilled: v })}
                    compact
                  />
                  <ToggleRow
                    label="Invoice when status → Billed"
                    description="Phase 2 — not implemented yet."
                    checked={emailSettings.triggers.invoiceOnBilled}
                    onChange={v => setTriggers({ invoiceOnBilled: v })}
                    compact
                    disabled
                  />
                </div>
              </div>
            </div>
            <div className="bg-[#F5F5F5] border-t border-[#141414] p-4 flex justify-end">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-[11px] font-bold uppercase hover:opacity-80">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Log detail modal */}
      {viewingLog && (
        <div className="fixed inset-0 z-[600] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
          <div className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-[#141414] text-[#E4E3E0] px-6 py-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Mail size={14} /> {TYPE_LABELS[viewingLog.type]}</h3>
              <button onClick={() => setViewingLog(null)} className="hover:opacity-70"><X size={16} /></button>
            </div>
            <div className="p-6 text-xs space-y-3">
              <Row label="Customer" value={viewingLog.customerName || '—'} />
              <Row label="Status" value={<StatusPill status={viewingLog.status} />} />
              <Row label="Created" value={viewingLog.createdAt ? new Date(viewingLog.createdAt).toLocaleString() : '—'} />
              <Row label="Sent" value={viewingLog.sentAt ? new Date(viewingLog.sentAt).toLocaleString() : '—'} />
              <Row label="To (intended)" value={(viewingLog.recipientTo || []).join(', ') || '—'} />
              <Row label="To (actual)" value={(viewingLog.actualRecipientTo || []).join(', ') || '—'} />
              {viewingLog.recipientCc?.length ? <Row label="CC" value={viewingLog.recipientCc.join(', ')} /> : null}
              <Row label="Subject" value={viewingLog.subject} />
              <Row label="Attachment" value={viewingLog.attachmentFilename ? `${viewingLog.attachmentFilename}${viewingLog.attachmentSizeBytes ? ` (${Math.round(viewingLog.attachmentSizeBytes / 1024)} KB)` : ''}` : '—'} />
              <Row label="Test mode" value={viewingLog.testMode ? 'Yes' : 'No'} />
              <Row label="Provider Message ID" value={viewingLog.providerMessageId || '—'} mono />
              <Row label="Idempotency Key" value={viewingLog.idempotencyKey} mono />
              <Row label="Attempts" value={String(viewingLog.attemptCount)} />
              {viewingLog.error && (
                <div className="border border-red-300 bg-red-50 p-3 text-red-800">
                  <div className="text-[10px] uppercase font-bold opacity-60 mb-1">Error</div>
                  <div className="font-mono break-all">{viewingLog.error}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'red' | 'amber' }) {
  const accentClass =
    accent === 'emerald' ? 'border-emerald-500/40 bg-emerald-50' :
    accent === 'red'     ? 'border-red-500/40     bg-red-50'    :
    accent === 'amber'   ? 'border-amber-500/40   bg-amber-50'  :
                           'border-[#141414]/20   bg-white';
  return (
    <div className={`border ${accentClass} p-3`}>
      <div className="text-[10px] uppercase opacity-60">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: EmailStatus }) {
  const Icon =
    status === 'sent' ? CheckCircle2 :
    status === 'failed' || status === 'bounced' ? AlertTriangle :
    Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${STATUS_STYLES[status]}`}>
      <Icon size={10} /> {status}
    </span>
  );
}

function AmendmentStatusPill({ status }: { status: PoAmendment['status'] }) {
  const style =
    status === 'pending'   ? 'bg-amber-100   text-amber-800' :
    status === 'applied'   ? 'bg-emerald-100 text-emerald-800' :
    status === 'unmatched' ? 'bg-red-100     text-red-700' :
                             'bg-slate-100   text-slate-600';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${style}`}>{status}</span>;
}

function FeedSuggestionPill({ suggestion, poNumber }: { suggestion?: InboxFeedItem['suggestion']; poNumber?: string }) {
  if (!suggestion || suggestion === 'none') return <span className="text-[10px] opacity-40">—</span>;
  const map = {
    new_po:       { label: 'New PO',       cls: 'bg-emerald-100 text-emerald-800' },
    amendment:    { label: 'Order change', cls: 'bg-amber-100   text-amber-800'   },
    cancellation: { label: 'Cancellation', cls: 'bg-red-100     text-red-700'     },
  } as const;
  const m = map[suggestion];
  if (!m) return <span className="text-[10px] opacity-40">—</span>;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${m.cls}`}>{m.label}{poNumber ? ` · ${poNumber}` : ''}</span>;
}

function ImportResultPill({ result, note }: { result: PoImportLogEntry['result']; note?: string }) {
  const style =
    result === 'created'   ? 'bg-emerald-100 text-emerald-800' :
    result === 'updated'   ? 'bg-sky-100     text-sky-800'     :
    result === 'duplicate' ? 'bg-amber-100   text-amber-800'   :
                             'bg-slate-100   text-slate-700';
  return (
    <span title={note} className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${style}`}>
      {result}
    </span>
  );
}

function ToggleRow({ label, description, checked, onChange, compact, disabled }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; compact?: boolean; disabled?: boolean }) {
  return (
    <div className={`flex items-start gap-3 ${compact ? '' : 'pb-2'}`}>
      <button
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 w-10 h-5 rounded-full transition-all relative ${checked ? 'bg-emerald-600' : 'bg-[#141414]/20'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
      <div className="flex-1">
        <div className="text-sm font-bold">{label}</div>
        {description && <div className="text-[11px] opacity-60">{description}</div>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{label}</div>
      {children}
      {hint && <div className="text-[10px] opacity-60 mt-1">{hint}</div>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3">
      <div className="text-[10px] uppercase font-bold opacity-50">{label}</div>
      <div className={mono ? 'font-mono break-all' : ''}>{value}</div>
    </div>
  );
}
