// Minimal Gmail REST helper for the PO inbox scan.
//
// Uses a Google service account with domain-wide delegation to impersonate the
// shared PO mailbox (no extra SDK — google-auth-library is already a dep, and
// Gmail REST is called via fetch). The service account's client ID must be
// authorized in the Workspace Admin console for the gmail.readonly scope.
// READ-ONLY: this helper never modifies the mailbox (no labelling, no marking
// read). Dedup of already-processed messages is tracked in Firestore instead.

import { JWT } from 'google-auth-library';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users';

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
}

/** Authorize as the impersonated mailbox and return a bearer access token. */
export async function gmailAccessToken(impersonate: string): Promise<string> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY are not configured.');
  }
  // Vercel stores newlines as literal "\n" — normalize them back.
  const key = rawKey.replace(/\\n/g, '\n');
  const jwt = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    subject: impersonate,
  });
  const creds = await jwt.authorize();
  if (!creds.access_token) throw new Error('Failed to obtain Gmail access token.');
  return creds.access_token;
}

async function gfetch(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${GMAIL_BASE}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status} on ${path}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

/** List message ids matching a Gmail search query, FOLLOWING pagination so all
 *  in-window messages are enumerated. Read-only dedup can't shrink the Gmail
 *  result set (processed mail stays listed), so a small cap would let the oldest
 *  unprocessed messages fall off the end; paging avoids that. Bounded by maxTotal. */
export async function listMessages(
  token: string,
  userId: string,
  q: string,
  maxTotal = 200,
  pageSize = 100,
): Promise<GmailMessageMeta[]> {
  const out: GmailMessageMeta[] = [];
  let pageToken: string | undefined;
  do {
    const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const data = await gfetch(token, `${encodeURIComponent(userId)}/messages?q=${encodeURIComponent(q)}&maxResults=${pageSize}${pageParam}`);
    for (const m of (data.messages || [])) out.push(m as GmailMessageMeta);
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < maxTotal);
  return out.slice(0, maxTotal);
}

/** Fetch a full message payload. */
export async function getMessage(token: string, userId: string, id: string): Promise<any> {
  return gfetch(token, `${encodeURIComponent(userId)}/messages/${id}?format=full`);
}

/** Walk a message payload tree and collect file attachments. */
export function collectAttachments(payload: any): GmailAttachment[] {
  const out: GmailAttachment[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      out.push({ filename: part.filename, mimeType: part.mimeType || '', attachmentId: part.body.attachmentId });
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
}

/** Download an attachment and return standard base64 (Gmail returns base64url). */
export async function getAttachmentBase64(token: string, userId: string, messageId: string, attachmentId: string): Promise<string> {
  const data = await gfetch(token, `${encodeURIComponent(userId)}/messages/${messageId}/attachments/${attachmentId}`);
  const b64url: string = data.data || '';
  return b64url.replace(/-/g, '+').replace(/_/g, '/');
}

/** Read a header value (case-insensitive) from a message payload. */
export function header(payload: any, name: string): string {
  const h = (payload?.headers || []).find((x: any) => (x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

/** Extract the plain-text body of a message (prefers text/plain, falls back to
 *  stripped text/html). Used to catch order amendments written in the email
 *  itself rather than an attachment. Capped to keep token use bounded. */
export function getMessageBody(payload: any): string {
  const decode = (data?: string) =>
    data ? Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '';
  let plain = '';
  let html = '';
  const walk = (part: any) => {
    if (!part) return;
    const mt = (part.mimeType || '').toLowerCase();
    if (mt === 'text/plain' && part.body?.data) plain += decode(part.body.data) + '\n';
    else if (mt === 'text/html' && part.body?.data) html += decode(part.body.data) + '\n';
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  let text = plain.trim();
  if (!text && html) {
    text = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return stripQuotedReply(text).slice(0, 20000);
}

/** Drop quoted reply / forwarded history so only the new message text is read
 *  (otherwise a reply in an old PO thread re-extracts the quoted original). */
function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;                              // quoted line
    if (/^\s*-{2,}\s*original message\s*-{2,}/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line)) break;                      // Outlook divider
    if (/^\s*On .+(wrote|écrit)\s*:?\s*$/i.test(line)) break;   // "On <date> ... wrote:"
    if (out.length > 2 && /^\s*From:\s.+/i.test(line)) break;   // forwarded header block
    out.push(line);
  }
  const result = out.join('\n').trim();
  return result || text; // never return empty if the whole body looked quoted
}
