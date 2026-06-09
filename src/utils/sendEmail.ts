// Client-side wrapper around the /api/send-email endpoint.
//
// Flow:
//   1. Caller builds a SendEmailRequest with recipients + subject + HTML body
//      + optional PDF Blob attachment.
//   2. This helper converts the PDF Blob to base64 and POSTs to the endpoint.
//   3. Returns { success, messageId? } so the caller can decide how to
//      write the corresponding emailLog entry to Firestore.
//
// Authentication is via VITE_EMAIL_SHARED_SECRET when set. The server-side
// counterpart (EMAIL_SHARED_SECRET) must match. When neither is set the
// endpoint is open (development mode).

import type { EmailDocumentType } from '../types';

export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  subject: string;
  /** Plain HTML email body. Newlines are preserved by the user agent; no
   *  templating done here. */
  html: string;
  /** Optional PDF attachment as a Blob. Will be base64-encoded for transport. */
  attachment?: Blob;
  attachmentFilename?: string;
  /** When true, the server reroutes the email to testAddress with a [TEST]
   *  subject prefix. Caller passes EmailSettings.testMode through. */
  testMode?: boolean;
  testAddress?: string;
  fromName?: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  /** Echoes which recipient(s) actually received the email — differs from
   *  request `to` when testMode rerouted it. */
  actualTo?: string[];
  testMode?: boolean;
}

/** Convert a Blob to a base64 string (no data URL prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read attachment as base64'));
        return;
      }
      // result is "data:application/pdf;base64,XXX" — strip the prefix.
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export async function sendEmail(req: SendEmailRequest): Promise<SendEmailResponse> {
  let attachmentBase64: string | undefined;
  let attachmentSizeBytes: number | undefined;
  if (req.attachment) {
    attachmentBase64 = await blobToBase64(req.attachment);
    attachmentSizeBytes = req.attachment.size;
  }

  const sharedSecret = (import.meta as any).env?.VITE_EMAIL_SHARED_SECRET as string | undefined;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sharedSecret) headers['Authorization'] = `Bearer ${sharedSecret}`;

  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: req.to,
        cc: req.cc,
        subject: req.subject,
        html: req.html,
        attachmentBase64,
        attachmentFilename: req.attachmentFilename,
        testMode: req.testMode === true,
        testAddress: req.testAddress,
        fromName: req.fromName,
      }),
    });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return { success: false, error: body?.error || `HTTP ${res.status}` };
    }
    return {
      success: !!body.success,
      messageId: body.messageId,
      error: body.error,
      actualTo: body.actualTo,
      testMode: body.testMode,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

/** Stable idempotency key — same record + same type always produces the
 *  same key so a retry doesn't create duplicate log rows. */
export function idempotencyKey(type: EmailDocumentType, recordId: string): string {
  return `${type}:${recordId}`;
}
