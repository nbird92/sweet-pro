import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDoc, getSheet, checkAuth, checkGoogleConfig, SyncRequestSchema } from './_sheets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkAuth(req.headers['x-access-key'])) {
    return res.status(401).json({ error: 'Unauthorized access' });
  }

  const config = checkGoogleConfig();
  if (!config.hasId || !config.hasEmail || !config.hasKey) {
    return res.json({ configMissing: true });
  }

  try {
    const validated = SyncRequestSchema.safeParse(req.body);
    if (!validated.success) {
      console.error("Validation Error:", JSON.stringify(validated.error.format(), null, 2));
      return res.status(400).json({
        error: "Invalid data format",
        details: validated.error.format()
      });
    }

    const { type, data } = validated.data;
    const doc = getDoc();
    await doc.loadInfo();
    const sheet = await getSheet(doc, type);
    if (!sheet) throw new Error(`Sheet ${type} not found`);

    await sheet.clearRows();

    if (data.length > 0) {
      await sheet.addRows(data as any[]);
    }

    res.json({ success: true, updated: true });
  } catch (e) {
    console.error("Sync Error:", e);
    res.status(500).json({ error: (e as Error).message });
  }
}
