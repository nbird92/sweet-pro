// "Send to Customer" email menu for a generated PDF — the same look and
// behaviour as the Email Customer Report menu (ReportsPage): From (the signed-in
// user), To defaulting to the customer's Sales Contact address(es) (else the
// main contact email), quick-pick chips for every contact address on the
// customer card, CC, Subject, Message, the PDF attached, and the send result.

import { useEffect, useState } from 'react';
import { Mail, X, FileText, Send } from 'lucide-react';
import type { Customer } from '../types';
import { sendEmail } from '../utils/sendEmail';

export interface EmailPdfModalProps {
  title: string;                 // e.g. "Email Sales Contract"
  customers: Customer[];         // the customer (or group members) it goes to
  pdf: { blob: Blob; filename: string };
  defaultSubject: string;
  /** Message body; the sign-off with the sender is appended. */
  defaultIntro: string[];
  senderName?: string;
  senderEmail?: string;
  onClose: () => void;
  onSent?: (to: string[]) => void;
}

const splitEmails = (v?: string) => (v || '').split(/[,;]+/).map(x => x.trim()).filter(Boolean);
const uniq = (xs: string[]) => [...new Map(xs.map(x => [x.toLowerCase(), x])).values()];

export default function EmailPdfModal({ title, customers, pdf, defaultSubject, defaultIntro, senderName, senderEmail, onClose, onSent }: EmailPdfModalProps) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    // Default To: every Sales Contact address on the customer card(s); else the
    // main contact email.
    const sales = uniq(customers.flatMap(m => splitEmails(m.salesContactEmail)));
    setTo((sales.length ? sales : uniq(customers.flatMap(m => splitEmails(m.contactEmail)))).join(', '));
    setCc('');
    setSubject(defaultSubject);
    setBody([...defaultIntro, '', 'Best regards,', senderName || 'Sucro Canada', ...(senderEmail ? [senderEmail] : [])].join('\n'));
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.filename]);

  // One quick-pick chip per address (a card field can hold several; a group
  // offers every member's addresses).
  const seenChip = new Set<string>();
  const chips = customers.flatMap(c => ([
    ['Sales', c.salesContactEmail], ['Main', c.contactEmail], ['QA', c.qaContractEmail], ['CS', c.customerServiceEmail],
  ] as Array<[string, string | undefined]>).flatMap(([label, v]) =>
    splitEmails(v).map((addr, i) => ({ label: customers.length > 1 ? `${label} · ${c.name}` : label, v: addr, key: `${c.id}-${label}-${i}` }))))
    .filter(x => { const k = x.v.toLowerCase(); if (seenChip.has(k)) return false; seenChip.add(k); return true; });

  const send = async () => {
    const toList = splitEmails(to);
    if (!toList.length) { setResult({ ok: false, message: 'Enter at least one recipient.' }); return; }
    setSending(true);
    setResult(null);
    try {
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const res = await sendEmail({
        to: toList,
        cc: splitEmails(cc),
        subject: subject || defaultSubject,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap">${esc(body)}</div>`,
        attachment: pdf.blob,
        attachmentFilename: pdf.filename,
        ...(senderName ? { fromName: senderName } : {}),
        ...(senderEmail ? { replyTo: senderEmail } : {}),
      });
      if (res.success) {
        const sentTo = res.actualTo || toList;
        setResult({ ok: true, message: `Sent to ${sentTo.join(', ')}` });
        onSent?.(sentTo);
      } else {
        setResult({ ok: false, message: res.error || 'Send failed.' });
      }
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || String(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[650] flex items-center-safe justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
          <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Mail size={16} /> {title}</h3>
          <button onClick={onClose} className="hover:opacity-70"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold opacity-60">From</label>
            <div className="w-full bg-[#F5F5F5] border border-[#141414]/30 p-2 text-sm text-[#141414]/70">
              {senderName || 'Sucro Canada'}{senderEmail ? ` <${senderEmail}>` : ''}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold opacity-60">To</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
              placeholder="recipient@example.com (separate several with commas)"
            />
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {chips.map(x => (
                  <button key={x.key} onClick={() => setTo(prev => {
                    // Add to the To list (no duplicates) rather than replacing it.
                    const list = prev.split(/[,;]+/).map(y => y.trim()).filter(Boolean);
                    return list.some(y => y.toLowerCase() === x.v.toLowerCase()) ? prev : [...list, x.v].join(', ');
                  })} className="text-[9px] px-2 py-0.5 bg-[#F5F5F5] border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors">
                    {x.label}: {x.v}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold opacity-60">CC</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
              placeholder="cc@example.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold opacity-60">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold opacity-60">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="w-full bg-white border border-[#141414] p-3 text-xs font-mono leading-relaxed outline-none"
            />
          </div>
          <div className="flex items-center gap-2 border border-[#141414]/15 bg-[#F5F5F5] px-3 py-2 text-xs">
            <FileText size={14} className="text-red-600" />
            <span className="font-mono">{pdf.filename}</span>
            <span className="opacity-50">· attached</span>
          </div>
          {result && (
            <div className={`text-xs border-l-2 pl-3 py-1 ${result.ok ? 'border-emerald-600 text-emerald-700' : 'border-red-500 text-red-700'}`}>
              {result.message}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[#141414]/10 flex gap-3">
          <button
            onClick={send}
            disabled={sending || !to.trim()}
            className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-colors flex items-center-safe justify-center gap-2 disabled:opacity-50"
          >
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
          >
            {result?.ok ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
