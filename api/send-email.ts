// Vercel serverless function — sends an email (with PDF attachment) via Resend.
//
// Request body shape:
//   {
//     to: string[],
//     cc?: string[],
//     subject: string,
//     html: string,
//     attachmentBase64?: string,    // PDF bytes encoded as base64 (no data URL prefix)
//     attachmentFilename?: string,
//     // Test-mode controls — when testMode=true, the email is rerouted to
//     // testAddress and the subject is prefixed with [TEST → original@...].
//     testMode?: boolean,
//     testAddress?: string,
//     // Display metadata
//     fromName?: string,
//   }
//
// Response shape:
//   { success: true,  messageId: string, testMode: boolean, actualTo: string[] }
//   { success: false, error: string }
//
// Auth: optional shared-secret. If EMAIL_SHARED_SECRET is set on the server,
// requests must include "Authorization: Bearer <same secret>". When the env
// var isn't set, the endpoint is open (intended only for early development).
//
// Required env vars (set in the Vercel project settings):
//   RESEND_API_KEY        — your Resend API key. Required.
//   EMAIL_FROM_ADDRESS    — sender address, e.g. "orders@sucrocanada.com".
//                           Defaults to onboarding@resend.dev when blank
//                           (Resend's built-in tester address — only delivers
//                            to the account owner's email; perfect for smoke
//                            tests, swap once your domain is verified).
//   EMAIL_SHARED_SECRET   — optional. When set, callers must send a matching
//                           Authorization: Bearer header.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

const DEFAULT_FROM_ADDRESS = 'onboarding@resend.dev';

function authorized(req: VercelRequest): boolean {
  const required = process.env.EMAIL_SHARED_SECRET;
  if (!required) return true; // No secret configured — open mode.
  const header = req.headers.authorization || '';
  return header === `Bearer ${required}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow the same-origin app to POST.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!authorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: 'RESEND_API_KEY environment variable is not set on the server.',
    });
  }

  const {
    to,
    cc,
    subject,
    html,
    attachmentBase64,
    attachmentFilename,
    testMode,
    testAddress,
    fromName,
    fromAddress,
    replyTo,
  } = req.body || {};

  if (!Array.isArray(to) || to.length === 0) {
    return res.status(400).json({ success: false, error: 'to[] is required and must be a non-empty array' });
  }
  if (typeof subject !== 'string' || !subject.trim()) {
    return res.status(400).json({ success: false, error: 'subject is required' });
  }
  if (typeof html !== 'string') {
    return res.status(400).json({ success: false, error: 'html body is required' });
  }

  // Test-mode rerouting — keep the original recipient visible in the subject
  // so the operator can confirm the rewrite worked end to end.
  let actualTo = to;
  let actualCc = cc;
  let actualSubject = subject;
  if (testMode === true) {
    if (typeof testAddress !== 'string' || !testAddress.trim()) {
      return res.status(400).json({ success: false, error: 'testMode=true requires a non-empty testAddress' });
    }
    actualTo = [testAddress.trim()];
    actualCc = undefined; // No CC in test mode — keeps things from accidentally going out.
    actualSubject = `[TEST → ${to.join(', ')}] ${subject}`;
  }

  // Resolution order for the sender address (highest priority first):
  //   1. fromAddress from the request body (Email Center → Settings)
  //   2. EMAIL_FROM_ADDRESS env var (Vercel project setting)
  //   3. onboarding@resend.dev (Resend's tester address — always works)
  // Whichever we land on must be a verified Resend sender or Resend will
  // reject with a domain-not-verified validation_error.
  const clientFrom = typeof fromAddress === 'string' && fromAddress.trim() ? fromAddress.trim() : '';
  const envFrom = (process.env.EMAIL_FROM_ADDRESS || '').trim();
  const resolvedFrom = clientFrom || envFrom || DEFAULT_FROM_ADDRESS;
  const from = fromName
    ? `${fromName} <${resolvedFrom}>`
    : resolvedFrom;

  try {
    const resend = new Resend(apiKey);
    const attachments = attachmentBase64 && attachmentFilename
      ? [{ filename: attachmentFilename, content: attachmentBase64 }]
      : undefined;
    const sendBody: any = {
      from,
      to: actualTo,
      cc: actualCc,
      subject: actualSubject,
      html,
      attachments,
    };
    if (typeof replyTo === 'string' && replyTo.trim()) sendBody.replyTo = replyTo.trim();
    const result = await resend.emails.send(sendBody);
    if (result.error) {
      return res.status(502).json({
        success: false,
        error: `Resend error: ${result.error.name || ''} ${result.error.message || JSON.stringify(result.error)}`.trim(),
      });
    }
    return res.status(200).json({
      success: true,
      messageId: result.data?.id || '',
      testMode: testMode === true,
      actualTo,
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e?.message || 'Unknown error sending email',
    });
  }
}
