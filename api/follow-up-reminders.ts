import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { normalizePrivateKey } from './_gmail.js';

// Daily follow-up reminders (Vercel cron — see vercel.json).
//
// Emails each salesperson ONE digest of their follow-ups that are due today or
// overdue and not yet completed:
//   • Sample Requests — follow-ups on requests that aren't Cancelled, sent to the
//     request's selected Sales Person.
//   • Sales Leads     — follow-ups on leads that aren't Closed Won / Closed Lost,
//     sent to the lead's Sales Person.
//
// Each follow-up is reminded ONCE. What was sent is recorded in
// appStatus/followUpReminders (follow-up id -> date sent) rather than on the
// sample/lead documents themselves, so the app's own autosave of those records
// can never wipe the marker and re-trigger a reminder.
//
// Honours the Email Center settings (emailSettings/settings): enabled=false sends
// nothing; testMode reroutes every reminder to testAddress with a [TEST] prefix.
//
// Env: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
//      RESEND_API_KEY, EMAIL_FROM_ADDRESS (optional), CRON_SECRET (optional —
//      when set, require Authorization: Bearer <CRON_SECRET>),
//      APP_URL (optional link in the email), REMINDER_TIMEZONE (default America/Toronto).
// Query: ?dryRun=1 lists what would be sent without sending or recording.

function getDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not configured.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  // MUST match DATABASE_ID in src/firebaseDb.ts (same as scan-po-inbox).
  return getFirestore(app, 'sweetpro2');
}

/** Today's date (YYYY-MM-DD) in the business time zone. */
function todayIn(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

interface DueItem {
  followUpId: string;
  kind: 'Sample Request' | 'Sales Lead';
  customer: string;
  detail: string;
  description: string;
  date: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers['authorization'] || '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = String(req.query.dryRun || '') === '1';
  const tz = process.env.REMINDER_TIMEZONE || 'America/Toronto';
  const today = todayIn(tz);

  try {
    const db = getDb();
    const [peopleSnap, samplesSnap, leadsSnap, settingsDoc, sentDoc] = await Promise.all([
      db.collection('people').get(),
      db.collection('sampleRequests').get(),
      db.collection('salesLeads').get(),
      db.collection('emailSettings').doc('settings').get(),
      db.collection('appStatus').doc('followUpReminders').get(),
    ]);
    const settings: any = settingsDoc.exists ? settingsDoc.data() : {};
    if (settings.enabled === false && !dryRun) {
      return res.status(200).json({ ok: true, skipped: 'Email sending is disabled in the Email Center.' });
    }
    const sent: Record<string, string> = (sentDoc.exists ? (sentDoc.data() as any)?.sent : null) || {};
    const people = new Map(peopleSnap.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }]));
    const personById = (id?: string) => (id ? (people.get(id) || [...people.values()].find(p => p.id === id)) : undefined);

    // Collect due follow-ups per salesperson.
    const bySales = new Map<string, DueItem[]>();
    const add = (salespersonId: string | undefined, item: DueItem) => {
      if (!salespersonId) return;
      const arr = bySales.get(salespersonId) || [];
      arr.push(item);
      bySales.set(salespersonId, arr);
    };
    for (const d of samplesSnap.docs) {
      const sr: any = d.data();
      if (sr.status === 'Cancelled') continue;
      for (const fu of sr.followUps || []) {
        if (!fu?.id || fu.completed || !fu.date || fu.date > today || sent[fu.id]) continue;
        add(sr.salespersonId, {
          followUpId: fu.id, kind: 'Sample Request', customer: sr.customer || '(no customer)',
          detail: [sr.sampleProduct, sr.location, sr.status].filter(Boolean).join(' · '),
          description: fu.description || '', date: fu.date,
        });
      }
    }
    for (const d of leadsSnap.docs) {
      const l: any = d.data();
      if (l.status === 'Closed Won' || l.status === 'Closed Lost') continue;
      for (const fu of l.followUps || []) {
        if (!fu?.id || fu.completed || !fu.date || fu.date > today || sent[fu.id]) continue;
        add(l.salespersonId, {
          followUpId: fu.id, kind: 'Sales Lead', customer: l.customerName || '(no name)',
          detail: [l.product, l.volume ? `${l.volume} MT` : '', l.status, l.contactName].filter(Boolean).join(' · '),
          description: [fu.description, fu.infoSent ? `info sent: ${fu.infoSent}` : ''].filter(Boolean).join(' — '),
          date: fu.date,
        });
      }
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey && !dryRun) throw new Error('RESEND_API_KEY is not configured.');
    const resend = apiKey ? new Resend(apiKey) : null;
    const fromAddr = (settings.fromAddress || process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev').trim();
    const from = settings.fromName ? `${settings.fromName} <${fromAddr}>` : fromAddr;
    const appUrl = process.env.APP_URL || 'https://sweet-pro2.vercel.app';

    const results: any[] = [];
    const newlySent: Record<string, string> = {};
    for (const [salesId, items] of bySales) {
      const person = personById(salesId);
      const to = (person?.email || '').trim();
      if (!to) { results.push({ salesperson: person?.name || salesId, skipped: 'no email on the People record', count: items.length }); continue; }
      items.sort((a, b) => a.date.localeCompare(b.date));
      const overdue = items.filter(i => i.date < today).length;
      const subject = `Follow-up reminder: ${items.length} follow-up${items.length === 1 ? '' : 's'} due${overdue ? ` (${overdue} overdue)` : ''}`;
      const rows = items.map(i => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #ddd;white-space:nowrap;${i.date < today ? 'color:#b91c1c;font-weight:bold;' : ''}">${esc(i.date)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${esc(i.kind)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #ddd;font-weight:bold;">${esc(i.customer)}<div style="font-weight:normal;color:#666;font-size:11px;">${esc(i.detail)}</div></td>
          <td style="padding:6px 8px;border-bottom:1px solid #ddd;">${esc(i.description)}</td>
        </tr>`).join('');
      const html = `
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#141414;">
          <p>Hi ${esc((person?.name || '').split(' ')[0] || 'there')},</p>
          <p>This is your reminder to follow up on the items below${overdue ? ' — dates in red are overdue' : ''}:</p>
          <table style="border-collapse:collapse;width:100%;font-size:12px;">
            <thead><tr style="background:#141414;color:#E4E3E0;text-align:left;">
              <th style="padding:6px 8px;">Date</th><th style="padding:6px 8px;">Type</th><th style="padding:6px 8px;">Customer</th><th style="padding:6px 8px;">Follow-up</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:16px;">Mark each follow-up complete in <a href="${esc(appUrl)}">Sweet Pro</a> (Sales Leads page) once it's done.</p>
          <p style="color:#888;font-size:11px;">Automated reminder — each follow-up is reminded once.</p>
        </div>`;
      if (dryRun) { results.push({ salesperson: person?.name, to, count: items.length, overdue, items }); continue; }
      const testMode = settings.testMode === true && (settings.testAddress || '').trim();
      try {
        const r = await resend!.emails.send({
          from,
          to: testMode ? [settings.testAddress.trim()] : [to],
          subject: testMode ? `[TEST → ${to}] ${subject}` : subject,
          html,
          ...(settings.replyToAddress ? { replyTo: settings.replyToAddress } : {}),
        } as any);
        if ((r as any).error) throw new Error((r as any).error.message || JSON.stringify((r as any).error));
        for (const i of items) newlySent[i.followUpId] = today;
        results.push({ salesperson: person?.name, to: testMode ? settings.testAddress : to, count: items.length, overdue, messageId: (r as any).data?.id });
      } catch (e: any) {
        results.push({ salesperson: person?.name, to, count: items.length, error: e?.message || String(e) });
      }
    }

    if (!dryRun) {
      // Prune markers older than ~1 year so the doc stays small.
      const cutoff = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10);
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...sent, ...newlySent })) if (v >= cutoff) merged[k] = v;
      await db.collection('appStatus').doc('followUpReminders').set({ sent: merged, lastRun: new Date().toISOString(), lastResults: results }, { merge: false });
    }
    return res.status(200).json({ ok: true, today, dryRun, reminders: results });
  } catch (e: any) {
    console.error('follow-up-reminders failed:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
