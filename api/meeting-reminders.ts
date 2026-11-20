import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { normalizePrivateKey } from './_gmail.js';

// Conference meeting follow-up reminders (Vercel cron, every 15 minutes — see
// vercel.json).
//
// Each meeting follow-up can carry a reminder date + time (reminderAt,
// "YYYY-MM-DDTHH:mm" in the business time zone). When that time has passed and
// the follow-up isn't completed, ONE email goes to the follow-up's assignee
// (else the meeting owner). What was sent is recorded in
// appStatus/meetingReminders (follow-up id -> reminderAt it was sent for), so
// a follow-up is reminded once per reminder time — changing the reminder time
// re-arms it. Kept off the conference documents so the app's autosave can't
// wipe the marker.
//
// Honours the Email Center settings (emailSettings/settings): enabled=false
// sends nothing; testMode reroutes to testAddress with a [TEST] prefix.
// Env: FIREBASE_*, RESEND_API_KEY, EMAIL_FROM_ADDRESS (optional), CRON_SECRET
// (optional — when set, requires Authorization: Bearer <CRON_SECRET>),
// APP_URL (optional), REMINDER_TIMEZONE (default America/Toronto).
// Query: ?dryRun=1 lists what would be sent without sending or recording.

function getDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not configured.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore(app, 'sweetpro2'); // MUST match DATABASE_ID in src/firebaseDb.ts
}

/** Now as "YYYY-MM-DDTHH:mm" in the business time zone (same shape as reminderAt). */
function nowIn(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmtWhen = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const fmtDate = (v?: string) => {
  if (!v) return '';
  const d = new Date(`${v}T12:00:00`);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && (req.headers['authorization'] || '') !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = String(req.query.dryRun || '') === '1';
  const tz = process.env.REMINDER_TIMEZONE || 'America/Toronto';
  const now = nowIn(tz);

  try {
    const db = getDb();
    const [peopleSnap, confSnap, customersSnap, settingsDoc, sentDoc] = await Promise.all([
      db.collection('people').get(),
      db.collection('conferences').get(),
      db.collection('customers').get(),
      db.collection('emailSettings').doc('settings').get(),
      db.collection('appStatus').doc('meetingReminders').get(),
    ]);
    const settings: any = settingsDoc.exists ? settingsDoc.data() : {};
    if (settings.enabled === false && !dryRun) {
      return res.status(200).json({ ok: true, skipped: 'Email sending is disabled in the Email Center.' });
    }
    const sent: Record<string, string> = (sentDoc.exists ? (sentDoc.data() as any)?.sent : null) || {};
    const people = new Map(peopleSnap.docs.map(d => [d.id, { id: d.id, ...(d.data() as any) }]));
    const customers = new Map(customersSnap.docs.map(d => [d.id, d.data() as any]));

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey && !dryRun) throw new Error('RESEND_API_KEY is not configured.');
    const resend = apiKey ? new Resend(apiKey) : null;
    const fromAddr = (settings.fromAddress || process.env.EMAIL_FROM_ADDRESS || 'onboarding@resend.dev').trim();
    const from = settings.fromName ? `${settings.fromName} <${fromAddr}>` : fromAddr;
    const appUrl = process.env.APP_URL || 'https://sweet-pro2.vercel.app';
    const testMode = settings.testMode === true && (settings.testAddress || '').trim();

    const results: any[] = [];
    const newlySent: Record<string, string> = {};
    for (const cd of confSnap.docs) {
      const conf: any = cd.data();
      // Reminder times are local to the conference (its time zone), else the default.
      let confNow = now;
      if (conf.timeZone) { try { confNow = nowIn(conf.timeZone); } catch { /* bad zone id → default */ } }
      for (const m of conf.meetings || []) {
        for (const fu of m.followUps || []) {
          if (!fu?.id || fu.completed || !fu.reminderAt) continue;
          if (fu.reminderAt > confNow) continue;          // not due yet (conference local time)
          if (sent[fu.id] === fu.reminderAt) continue;    // already reminded for this time
          const person = people.get(fu.assigneeId || m.meetingOwner || '');
          const to = (person?.email || '').trim();
          const item = { conference: conf.name, meeting: m.meetingName, followUp: fu.text, reminderAt: fu.reminderAt, to: to || null, person: person?.name || null };
          if (!to) { results.push({ ...item, skipped: 'no assignee / meeting owner email' }); continue; }
          if (dryRun) { results.push(item); continue; }
          const customer = m.customerId ? customers.get(m.customerId)?.name : '';
          const custAttendees = (m.customerAttendeeDetails || []).map((a: any) => [a.name, a.email].filter(Boolean).join(' — ')).filter(Boolean);
          const subject = `Follow-up reminder: ${fu.text}`.slice(0, 180);
          const row = (label: string, value: string) => value ? `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(label)}</td><td style="padding:4px 0;">${value}</td></tr>` : '';
          const html = `
            <div style="font-family:Arial,sans-serif;font-size:13px;color:#141414;">
              <p>Hi ${esc((person?.name || '').split(' ')[0] || 'there')},</p>
              <p>This is your reminder to follow up:</p>
              <div style="border-left:4px solid #141414;padding:8px 12px;margin:12px 0;background:#F5F5F5;font-size:15px;font-weight:bold;">${esc(fu.text)}</div>
              <table style="border-collapse:collapse;font-size:12px;">
                ${row('Conference', esc(conf.name || ''))}
                ${row('Meeting', esc(m.meetingName || ''))}
                ${row('Customer', esc(customer || ''))}
                ${row('When', esc([fmtDate(m.date), [m.time, m.endTime].filter(Boolean).join(' – '), conf.timeZone ? `(${conf.timeZone.replace(/_/g, ' ')} time)` : ''].filter(Boolean).join(', ')))}
                ${row('Type', esc([m.meetingType, m.reservationRequired ? 'reservation required' : ''].filter(Boolean).join(' — ')))}
                ${row('Location', esc([m.location, m.address].filter(Boolean).join(', ')))}
                ${row('Customer attendees', custAttendees.map(esc).join('<br/>'))}
                ${row('Reminder set for', esc(`${fmtWhen(fu.reminderAt)}${conf.timeZone ? ` (${conf.timeZone.replace(/_/g, ' ')})` : ''}`))}
              </table>
              <p style="margin-top:16px;">Mark the follow-up complete in <a href="${esc(appUrl)}">Sweet Pro</a> (Conferences page) once it's done.</p>
              <p style="color:#888;font-size:11px;">Automated reminder from Sweet Pro.</p>
            </div>`;
          try {
            const r = await resend!.emails.send({
              from,
              to: testMode ? [settings.testAddress.trim()] : [to],
              subject: testMode ? `[TEST → ${to}] ${subject}` : subject,
              html,
              ...(settings.replyToAddress ? { replyTo: settings.replyToAddress } : {}),
            } as any);
            if ((r as any).error) throw new Error((r as any).error.message || JSON.stringify((r as any).error));
            newlySent[fu.id] = fu.reminderAt;
            results.push({ ...item, to: testMode ? settings.testAddress : to, messageId: (r as any).data?.id });
          } catch (e: any) {
            results.push({ ...item, error: e?.message || String(e) });
          }
        }
      }
    }

    if (!dryRun && Object.keys(newlySent).length) {
      // Keep markers for ~1 year so the doc stays small.
      const cutoff = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10);
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries({ ...sent, ...newlySent })) if (v.slice(0, 10) >= cutoff) merged[k] = v;
      await db.collection('appStatus').doc('meetingReminders').set({ sent: merged, lastRun: new Date().toISOString(), lastResults: results }, { merge: false });
    }
    return res.status(200).json({ ok: true, now, dryRun, reminders: results });
  } catch (e: any) {
    console.error('meeting-reminders failed:', e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
