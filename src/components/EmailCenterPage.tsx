// Email Center — operator's view of every outbound email the app has sent
// (or attempted to send) plus the global email-sending settings.
//
// Phase 1 scope: read-only log, settings editor, manual sends only.
// Phase 2 will add automation triggers + retry/resend actions; the wiring
// here already supports those — just no UI for them yet.

import React, { useMemo, useState } from 'react';
import { Mail, Settings, AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react';
import PageBanner from './PageBanner';
import type { EmailLog, EmailSettings, EmailStatus, EmailDocumentType } from '../types';

interface Props {
  emailLog: EmailLog[];
  emailSettings: EmailSettings;
  setEmailSettings: (next: EmailSettings) => void;
}

const TYPE_LABELS: Record<EmailDocumentType, string> = {
  order_confirmation: 'Order Confirmation',
  bol: 'Bill of Lading',
  coa: 'Certificate of Analysis',
  invoice: 'Invoice',
};

const STATUS_STYLES: Record<EmailStatus, string> = {
  queued:  'bg-amber-100  text-amber-800',
  sending: 'bg-blue-100   text-blue-800',
  sent:    'bg-emerald-100 text-emerald-800',
  failed:  'bg-red-100    text-red-700',
  bounced: 'bg-red-100    text-red-700',
};

export default function EmailCenterPage({ emailLog, emailSettings, setEmailSettings }: Props) {
  const [showSettings, setShowSettings] = useState(false);
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

  const setSettings = (patch: Partial<EmailSettings>) => setEmailSettings({ ...emailSettings, ...patch });
  const setTriggers = (patch: Partial<EmailSettings['triggers']>) =>
    setEmailSettings({ ...emailSettings, triggers: { ...emailSettings.triggers, ...patch } });

  return (
    <div>
      <PageBanner icon={<Mail size={18} />} title="Email Center" count={emailLog.length}>
        <button
          onClick={() => setShowSettings(true)}
          className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap"
        >
          <Settings size={12} /> Settings
        </button>
      </PageBanner>

      {/* Test-mode + master-switch banner */}
      <div className="px-6 pt-4">
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
        <div className="fixed inset-0 z-[600] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto" onClick={() => setShowSettings(false)}>
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
              <Field label="From address" hint="Leave blank to use the server-side default. When set, overrides the env-var default (must still be a verified Resend sender).">
                <input value={emailSettings.fromAddress || ''} onChange={e => setSettings({ fromAddress: e.target.value })} placeholder="(server default)" className="w-full border border-[#141414] bg-[#F5F5F5] p-2 text-sm" />
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
                <div className="text-[10px] uppercase font-bold opacity-50 mb-2">Auto-send triggers (Phase 2 — disabled now)</div>
                <div className="space-y-2 opacity-70">
                  <ToggleRow label="Order confirmation when status → Confirmed" description="" checked={emailSettings.triggers.orderConfirmationOnConfirmed} onChange={v => setTriggers({ orderConfirmationOnConfirmed: v })} compact disabled />
                  <ToggleRow label="BOL when shipment → Loaded / Out" description="" checked={emailSettings.triggers.bolOnShipmentLoaded} onChange={v => setTriggers({ bolOnShipmentLoaded: v })} compact disabled />
                  <ToggleRow label="COA after QA approval" description="" checked={emailSettings.triggers.coaOnQaApproval} onChange={v => setTriggers({ coaOnQaApproval: v })} compact disabled />
                  <ToggleRow label="Invoice when status → Billed" description="" checked={emailSettings.triggers.invoiceOnBilled} onChange={v => setTriggers({ invoiceOnBilled: v })} compact disabled />
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
        <div className="fixed inset-0 z-[600] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto" onClick={() => setViewingLog(null)}>
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
