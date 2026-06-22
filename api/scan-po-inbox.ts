import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { extractPO, isSupportedAttachment, DEFAULT_MODEL, type ExtractHints } from './_poExtract.js';
import {
  gmailAccessToken, listMessages, getMessage, collectAttachments,
  getAttachmentBase64, getMessageBody, header,
} from './_gmail.js';

/**
 * Scheduled PO inbox scan (Vercel Cron, every 15 min).
 *
 * Reads recent attachment-bearing messages from the shared PO mailbox, runs
 * each attachment through Gemini, and APPENDS the structured result to the
 * `incomingPoOrders` Firestore collection. The web app ingests that queue into
 * real Open orders on load (so cron writes never collide with the client's
 * whole-collection sync).
 *
 * READ-ONLY mailbox: the Gmail scope is gmail.readonly, so the inbox is never
 * modified. To avoid reprocessing, each handled message's id is recorded in the
 * `processedPoEmails` Firestore collection and skipped on the next run.
 *
 * Required env:
 *   GEMINI_API_KEY  (GOOGLE_API_KEY also accepted)
 *   PO_INBOX_ADDRESS                     mailbox to scan (impersonated)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL         service account w/ domain-wide delegation
 *   GOOGLE_PRIVATE_KEY                   (gmail.readonly scope authorized in Admin)
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * Optional env:
 *   PO_EXTRACT_MODEL  (default gemini-2.5-flash)
 *   PO_INBOX_QUERY    (default "has:attachment newer_than:3d")
 *   CRON_SECRET       (when set, require Authorization: Bearer <CRON_SECRET>)
 */

function getDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not configured.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore(app, 'sweetpro');
}

async function buildHints(db: FirebaseFirestore.Firestore): Promise<ExtractHints> {
  const [custSnap, skuSnap, qaSnap, contractSnap, learnedSnap] = await Promise.all([
    db.collection('customers').get(),
    db.collection('products').get(),
    db.collection('qaProducts').get(),
    db.collection('contracts').get(),
    db.collection('poFieldMappings').get().catch(() => ({ docs: [] as any[] })),
  ]);
  const customers = custSnap.docs.map(d => (d.data() as any).name).filter(Boolean);
  const products = [
    ...skuSnap.docs.map(d => (d.data() as any).name),
    ...qaSnap.docs.map(d => (d.data() as any).skuName),
  ].filter(Boolean);
  const contracts = contractSnap.docs.map(d => (d.data() as any).contractNumber).filter(Boolean);
  const learned = (learnedSnap.docs || []).map((d: any) => d.data()).filter((l: any) => l?.field && l?.from && l?.to);
  return {
    customers: Array.from(new Set(customers)),
    products: Array.from(new Set(products)),
    contracts: Array.from(new Set(contracts)),
    learned,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cron auth — Vercel injects Authorization: Bearer <CRON_SECRET> when set.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const inbox = process.env.PO_INBOX_ADDRESS;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });
  if (!inbox) return res.status(500).json({ error: 'PO_INBOX_ADDRESS not configured.' });
  const model = process.env.PO_EXTRACT_MODEL || DEFAULT_MODEL;

  // Optional one-off overrides via query string (still gated by CRON_SECRET) for
  // ad-hoc tests, e.g. ?q=in:inbox&max=50&force=1 to scan the last 50 emails
  // and re-extract even ones already processed (the client still skips POs that
  // already exist in the orders table). The 15-min cron passes none of these.
  const qOverride = typeof req.query.q === 'string' ? req.query.q : undefined;
  // Default no longer requires an attachment so amendment emails (often plain
  // text, no attachment) are also scanned. The model classifies each as
  // new_order / amendment / cancellation / other; only non-'other' is queued.
  const query = qOverride !== undefined ? qOverride : (process.env.PO_INBOX_QUERY || 'newer_than:3d');
  const maxOverride = typeof req.query.max === 'string' ? parseInt(req.query.max, 10) : NaN;
  const maxTotal = Number.isFinite(maxOverride) && maxOverride > 0 ? maxOverride : 200;
  const force = req.query.force === '1' || req.query.force === 'true';

  const summary = { scanned: 0, skipped: 0, attachments: 0, queued: 0, errors: [] as Array<{ where: string; message: string }> };

  try {
    const db = getDb();
    const hints = await buildHints(db);
    const token = await gmailAccessToken(inbox);
    const processedRef = db.collection('processedPoEmails');
    const messages = await listMessages(token, inbox, query, maxTotal);

    for (const meta of messages) {
      try {
        // Read-only dedup: skip a message already handled on a previous run
        // (we can't mark it read/labelled with a read-only scope). `force`
        // bypasses this for a re-test; the client-side order dedup still holds.
        if (!force) {
          const seen = await processedRef.doc(meta.id).get();
          if (seen.exists) { summary.skipped++; continue; }
        }

        const msg = await getMessage(token, inbox, meta.id);
        const fromEmail = header(msg.payload, 'From');
        const subject = header(msg.payload, 'Subject');
        const receivedAt = new Date(Number(msg.internalDate) || Date.now()).toISOString();
        summary.scanned++;

        // Queue an extraction unless the model classified it as unrelated mail.
        const queueExtraction = async (extraction: any, sourceFile: string) => {
          if (!extraction || extraction.documentType === 'other') return;
          const id = `INPO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await db.collection('incomingPoOrders').doc(id).set({
            id, sourceEmailId: meta.id, sourceFile, fromEmail, subject, receivedAt,
            createdAt: new Date().toISOString(), extraction,
          });
          summary.queued++;
        };

        // 1. Each supported attachment — usually a new PO document.
        const attachments = collectAttachments(msg.payload).filter(a => isSupportedAttachment(a.filename, a.mimeType));
        for (const att of attachments) {
          summary.attachments++;
          try {
            const dataBase64 = await getAttachmentBase64(token, inbox, meta.id, att.attachmentId);
            const extraction = await extractPO({ name: att.filename, mimeType: att.mimeType, dataBase64 }, hints, { apiKey, model });
            await queueExtraction(extraction, att.filename);
          } catch (e) {
            summary.errors.push({ where: `${meta.id}:${att.filename}`, message: e instanceof Error ? e.message : String(e) });
          }
        }

        // 2. The email body text — catches amendments/cancellations written in
        //    the message itself (no attachment). When the message DID have
        //    attachments, those are the source of truth for new orders, so only
        //    act on the body for amendments/cancellations — a PO restated in the
        //    body can't then create a duplicate order.
        try {
          const body = getMessageBody(msg.payload);
          if (body && body.trim().length > 20) {
            const bodyB64 = Buffer.from(body, 'utf8').toString('base64');
            const extraction = await extractPO({ name: '(email body)', mimeType: 'text/plain', dataBase64: bodyB64 }, hints, { apiKey, model });
            const t = extraction?.documentType;
            if (attachments.length === 0 || t === 'amendment' || t === 'cancellation') {
              await queueExtraction(extraction, '(email body)');
            }
          }
        } catch (e) {
          summary.errors.push({ where: `${meta.id}:(body)`, message: e instanceof Error ? e.message : String(e) });
        }

        // Record the message as processed (read-only: tracked in Firestore,
        // not via Gmail labels) regardless of per-source outcome so a
        // permanently-failing message isn't retried forever.
        await processedRef.doc(meta.id).set({
          id: meta.id,
          subject,
          fromEmail,
          processedAt: new Date().toISOString(),
        });
      } catch (e) {
        summary.errors.push({ where: meta.id, message: e instanceof Error ? e.message : String(e) });
      }
    }

    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error('PO inbox scan error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e), ...summary });
  }
}
