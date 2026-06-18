import type { VercelRequest, VercelResponse } from '@vercel/node';
import { extractPO, DEFAULT_MODEL, type UploadFile } from './_poExtract.js';

/**
 * Manual PO extraction endpoint (backs the "Scan PO" modal).
 *
 * Request (POST JSON):
 *   { files: [{ name, mimeType, dataBase64 }],
 *     hints?: { customers?, products?, contracts?, learned? } }
 * Response: { extractions: ExtractedPO[], errors: [{file,message}] }
 *
 * Env: ANTHROPIC_API_KEY (required), PO_EXTRACT_MODEL (optional),
 *      EXTRACT_SHARED_SECRET (optional — when set, require Bearer auth).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sharedSecret = process.env.EXTRACT_SHARED_SECRET;
  if (sharedSecret && req.headers['authorization'] !== `Bearer ${sharedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }
  const model = process.env.PO_EXTRACT_MODEL || DEFAULT_MODEL;

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const files: UploadFile[] = Array.isArray(body?.files) ? body.files : [];
    const hints = body?.hints;
    if (files.length === 0) return res.status(400).json({ error: 'No files provided.' });
    if (files.length > 10) return res.status(400).json({ error: 'Too many files (max 10 per request).' });

    const extractions: any[] = [];
    const errors: Array<{ file: string; message: string }> = [];
    for (const file of files) {
      try {
        extractions.push(await extractPO(file, hints, { apiKey, model }));
      } catch (e) {
        errors.push({ file: file.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return res.status(200).json({ extractions, errors });
  } catch (e) {
    console.error('PO extraction error:', e);
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
