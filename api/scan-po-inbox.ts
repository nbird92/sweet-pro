import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { extractPO, isSupportedAttachment, DEFAULT_MODEL, type ExtractHints } from './_poExtract.js';
import {
  gmailAccessToken, listMessages, getMessage, collectAttachments,
  getAttachmentBase64, getOrCreateLabel, modifyMessage, header,
} from './_gmail.js';

/**
 * Scheduled PO inbox scan (Vercel Cron, every 15 min).
 *
 * Reads unread, attachment-bearing messages from the shared PO mailbox, runs
 * each attachment through Gemini, and APPENDS the structured result to the
 * `incomingPoOrders` Firestore collection. The web app ingests that queue into
 * real Open orders on load (so cron writes never collide with the client's
 * whole-collection sync). Processed messages are marked read + labelled so they
 * are not picked up again.
 *
 * Required env:
 *   GEMINI_API_KEY  (GOOGLE_API_KEY also accepted)
 *   PO_INBOX_ADDRESS                     mailbox to scan (impersonated)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL         service account w/ domain-wide delegation
 *   GOOGLE_PRIVATE_KEY                   (gmail.modify scope authorized in Admin)
 *   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
 * Optional env:
 *   PO_EXTRACT_MODEL  (default gemini-2.5-flash)
 *   PO_INBOX_QUERY    (default "is:unread has:attachment")
 *   CRON_SECRET       (when set, require Authorization: Bearer <CRON_SECRET>)
 */

const PROCESSED_LABEL = 'PO-Imported';

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
  const query = process.env.PO_INBOX_QUERY || 'is:unread has:attachment';

  const summary = { scanned: 0, attachments: 0, queued: 0, errors: [] as Array<{ where: string; message: string }> };

  try {
    const db = getDb();
    const hints = await buildHints(db);
    const token = await gmailAccessToken(inbox);
    const labelId = await getOrCreateLabel(token, inbox, PROCESSED_LABEL);
    const messages = await listMessages(token, inbox, query, 25);

    for (const meta of messages) {
      try {
        const msg = await getMessage(token, inbox, meta.id);
        const fromEmail = header(msg.payload, 'From');
        const subject = header(msg.payload, 'Subject');
        const attachments = collectAttachments(msg.payload).filter(a => isSupportedAttachment(a.filename, a.mimeType));
        summary.scanned++;

        for (const att of attachments) {
          summary.attachments++;
          try {
            const dataBase64 = await getAttachmentBase64(token, inbox, meta.id, att.attachmentId);
            const extraction = await extractPO(
              { name: att.filename, mimeType: att.mimeType, dataBase64 },
              hints,
              { apiKey, model },
            );
            const id = `INPO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await db.collection('incomingPoOrders').doc(id).set({
              id,
              sourceEmailId: meta.id,
              sourceFile: att.filename,
              fromEmail,
              subject,
              receivedAt: new Date(Number(msg.internalDate) || Date.now()).toISOString(),
              createdAt: new Date().toISOString(),
              extraction,
            });
            summary.queued++;
          } catch (e) {
            summary.errors.push({ where: `${meta.id}:${att.filename}`, message: e instanceof Error ? e.message : String(e) });
          }
        }

        // Mark processed regardless of per-attachment outcome so we don't loop
        // on a permanently-failing message; failures are recorded above.
        await modifyMessage(token, inbox, meta.id, { addLabelIds: [labelId], removeLabelIds: ['UNREAD'] });
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
