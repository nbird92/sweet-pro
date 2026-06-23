import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { extractPO, isSupportedAttachment, DEFAULT_MODEL, type ExtractHints } from './_poExtract.js';
import {
  gmailAccessToken, listMessages, getMessage, collectAttachments,
  getAttachmentBase64, getMessageBody, header, normalizePrivateKey,
} from './_gmail.js';

/**
 * Scheduled PO inbox scan (Vercel Cron, every 15 min).
 *
 * Reads recent messages from the shared PO mailbox. For each message it scans
 * the BODY first (the primary source for order info + changes), and only falls
 * back to the attachments when the body did not already contain a complete
 * order. Each extracted PO/amendment is APPENDED to the `incomingPoOrders`
 * Firestore collection; the web app ingests that queue into the review queue on
 * load (so cron writes never collide with the client's whole-collection sync).
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

function getAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not configured.');
  }
  return getApps().length ? getApps()[0] : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function getDb() {
  return getFirestore(getAdminApp(), 'sweetpro');
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
  // Ignore learned corrections older than 30 days (matches the client TTL) so a
  // stale alias can't keep steering extractions after it should have expired.
  // The client physically deletes them; this is a belt-and-suspenders read guard.
  const LEARNED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const learned = (learnedSnap.docs || []).map((d: any) => d.data()).filter((l: any) => {
    if (!l?.field || !l?.from || !l?.to) return false;
    if (!l.recordedAt) return true; // legacy undated entry — keep
    const at = Date.parse(l.recordedAt);
    return Number.isNaN(at) || (nowMs - at) <= LEARNED_TTL_MS;
  });
  return {
    customers: Array.from(new Set(customers)),
    products: Array.from(new Set(products)),
    contracts: Array.from(new Set(contracts)),
    learned,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Authorize EITHER the Vercel cron (Bearer <CRON_SECRET>) OR a signed-in app
  // user (Bearer <Firebase ID token>) — the latter lets the Email Center
  // "Scan Inbox Now" button trigger an ad-hoc run without exposing the secret.
  // When no CRON_SECRET is configured the endpoint stays open (prior behaviour).
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = (req.headers['authorization'] as string) || '';
  let authorized = !cronSecret;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) authorized = true;
  if (!authorized && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
      // Optional staff allowlist: when PO_SCAN_ALLOWED_DOMAINS is set, the signed-in
      // user's email (or Google hosted-domain) must match one of the listed domains;
      // otherwise any verified user of the Firebase project is accepted.
      const allowed = (process.env.PO_SCAN_ALLOWED_DOMAINS || '')
        .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
      const emailDomain = (decoded.email || '').split('@')[1]?.toLowerCase() || '';
      const hd = decoded.hd ? String(decoded.hd).toLowerCase() : '';
      const domainOk = allowed.length === 0 || allowed.includes(emailDomain) || (hd !== '' && allowed.includes(hd));
      if (decoded.email_verified !== false && domainOk) authorized = true;
    } catch (e) {
      console.warn('scan-po-inbox token verify failed:', e instanceof Error ? e.message : e);
    }
  }
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

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

  const summary = { scanned: 0, skipped: 0, attachments: 0, queued: 0, remaining: 0, partial: false, errors: [] as Array<{ where: string; message: string }> };

  // Each Gemini extraction takes a few seconds, so a backlog can exceed the
  // function's time limit (-> HTTP 504). Stop cleanly before that: progress is
  // persisted per message (processedPoEmails + incomingPoOrders), so the next
  // run — or the 15-min cron — continues where this one left off.
  // Budget sits ~50s under the 300s maxDuration (vercel.json, Pro plan) to leave
  // room for the in-flight message's extraction + Firestore writes + response.
  const startMs = Date.now();
  const BUDGET_MS = 250000;

  try {
    const db = getDb();
    const hints = await buildHints(db);
    const token = await gmailAccessToken(inbox);
    const processedRef = db.collection('processedPoEmails');
    const messages = await listMessages(token, inbox, query, maxTotal);
    // Load processed ids once (in-memory dedup) so skipping already-handled mail
    // costs no time — a Firestore read per message would itself eat the budget.
    const processedIds = new Set<string>((await processedRef.get()).docs.map(d => d.id));

    for (let i = 0; i < messages.length; i++) {
      const meta = messages[i];
      try {
        // Read-only dedup: skip a message already handled on a previous run
        // (we can't mark it read/labelled with a read-only scope). `force`
        // bypasses this for a re-test; the client-side order dedup still holds.
        if (!force && processedIds.has(meta.id)) { summary.skipped++; continue; }

        // Stop before the function times out, recording how many are left so the
        // UI can prompt another run. Checked after the cheap skip so a backlog of
        // already-processed mail doesn't count against the budget.
        if (Date.now() - startMs > BUDGET_MS) {
          summary.partial = true;
          summary.remaining = messages.slice(i).filter(m => force || !processedIds.has(m.id)).length;
          break;
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

        // 1. Email BODY first — the primary source for order info AND changes.
        //    New POs and amendments are frequently written in the message text
        //    itself, so always read it before touching attachments.
        const attachments = collectAttachments(msg.payload).filter(a => isSupportedAttachment(a.filename, a.mimeType));
        let bodyHasOrder = false; // a complete new order was found in the body
        try {
          const body = getMessageBody(msg.payload);
          if (body && body.trim().length > 20) {
            const bodyB64 = Buffer.from(body, 'utf8').toString('base64');
            const docs = await extractPO({ name: '(email body)', mimeType: 'text/plain', dataBase64: bodyB64 }, hints, { apiKey, model });
            for (const extraction of docs) {
              if (extraction?.documentType === 'new_order' && Array.isArray(extraction.lineItems) && extraction.lineItems.length > 0) {
                bodyHasOrder = true;
              }
              await queueExtraction(extraction, '(email body)'); // queues new_order / amendment / cancellation
            }
          }
        } catch (e) {
          summary.errors.push({ where: `${meta.id}:(body)`, message: e instanceof Error ? e.message : String(e) });
        }

        // 2. Attachments — scanned only IF NEEDED, i.e. the body did not already
        //    contain a complete order. This covers "see attached PO" emails and
        //    supplies detail a short body lacked, without re-reading a PO the body
        //    already captured (which would duplicate it).
        if (!bodyHasOrder) {
          for (const att of attachments) {
            summary.attachments++;
            try {
              const dataBase64 = await getAttachmentBase64(token, inbox, meta.id, att.attachmentId);
              // One attachment can contain several POs (e.g. a multi-page PDF with
              // one PO per page) — queue every order the extractor returns.
              const docs = await extractPO({ name: att.filename, mimeType: att.mimeType, dataBase64 }, hints, { apiKey, model });
              for (const extraction of docs) await queueExtraction(extraction, att.filename);
            } catch (e) {
              summary.errors.push({ where: `${meta.id}:${att.filename}`, message: e instanceof Error ? e.message : String(e) });
            }
          }
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
