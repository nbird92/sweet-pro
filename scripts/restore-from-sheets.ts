/**
 * SAFE restore: Google Sheets → Firestore, customers + products ONLY.
 *
 * Use this to recover the Customers and Products tables from the original
 * Google Sheet the app was migrated from, after the live Firestore copies were
 * lost. It is deliberately conservative:
 *   - Targets the "sweetpro" NAMED database the live app actually reads from
 *     (the old migrate-to-firestore.ts wrote to the DEFAULT database).
 *   - Touches ONLY the `customers` and `products` collections — your intact
 *     orders / invoices / contracts / shipments are never read or written.
 *   - UPSERTS by document id (batch.set). It never deletes, so it can only add
 *     back / refresh customer + product docs.
 *   - DRY RUN by default: it reads the sheet and prints what it found WITHOUT
 *     writing. Re-run with `--write` once the preview looks right.
 *
 * Prerequisites (same as migrate-to-firestore.ts):
 *   1. npm install firebase-admin --save-dev   (already a dep here)
 *   2. Firebase Console → Project Settings → Service Accounts → Generate New
 *      Private Key, saved as `scripts/firebase-service-account.json`
 *   3. .env.local has GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
 *      GOOGLE_PRIVATE_KEY
 *
 * Run (preview):   npx tsx scripts/restore-from-sheets.ts
 * Run (write):     npx tsx scripts/restore-from-sheets.ts --write
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '.env.local' });

const WRITE = process.argv.includes('--write');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------- Firebase Admin (NAMED "sweetpro" database) ----------
const serviceAccountPath = resolve(__dirname, 'firebase-service-account.json');
let serviceAccount: any;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
} catch (err: any) {
  console.error('ERROR: Could not read scripts/firebase-service-account.json');
  console.error('Download it from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
  console.error('Details:', err.message);
  process.exit(1);
}

const fbApp = initializeApp({ credential: cert(serviceAccount) });
// IMPORTANT: the live app uses the "sweetpro" named database, not the default.
const db = getFirestore(fbApp, 'sweetpro');

// ---------- Google Sheets ----------
const jwt = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
if (!SHEET_ID) {
  console.error('ERROR: GOOGLE_SHEET_ID not set in .env.local');
  process.exit(1);
}

// Only the two lost tables. tab title -> collection name.
const TABS: Record<string, string> = {
  Customers: 'customers',
  Products: 'products',
};
const NUMERIC_FIELDS: Record<string, string[]> = {
  customers: ['defaultMargin'],
  products: ['netWeight', 'brix', 'premiumCadMt', 'netWeightKg', 'grossWeightKg', 'maxColor'],
};

function clean(d: any, numericFields: string[]): any {
  const out: any = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || v === 'null' || v === 'undefined') continue;
    out[k] = v;
  }
  for (const f of numericFields) {
    if (out[f] !== undefined && out[f] !== '') out[f] = parseFloat(out[f]) || 0;
  }
  return out;
}

async function upsert(collectionName: string, docs: any[]) {
  const BATCH = 450;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = db.batch();
    for (const item of docs.slice(i, i + BATCH)) {
      if (!item.id) { console.warn(`  Skipping a ${collectionName} row with no id`); continue; }
      batch.set(db.collection(collectionName).doc(String(item.id)), item); // upsert, never delete
      written++;
    }
    await batch.commit();
  }
  return written;
}

async function run() {
  console.log(`\n${WRITE ? '*** WRITE MODE — will upsert into the "sweetpro" database ***' : 'DRY RUN — reading only, nothing will be written. Add --write to apply.'}\n`);
  const doc = new GoogleSpreadsheet(SHEET_ID!, jwt);
  await doc.loadInfo();
  console.log(`Spreadsheet: "${doc.title}"\n`);

  if (WRITE) {
    try {
      await db.collection('_restore_test').doc('_t').set({ ok: true });
      await db.collection('_restore_test').doc('_t').delete();
    } catch (e: any) {
      console.error('✗ Firestore (sweetpro) write test failed:', e.message);
      process.exit(1);
    }
  }

  for (const [tab, collectionName] of Object.entries(TABS)) {
    const sheet = doc.sheetsByTitle[tab];
    if (!sheet) { console.log(`[SKIP] Tab "${tab}" not found in the spreadsheet.`); continue; }
    const rows = await sheet.getRows();
    const docs = rows.map(r => clean(r.toObject(), NUMERIC_FIELDS[collectionName] || []));
    const withId = docs.filter(d => d.id);
    console.log(`[${tab}] ${docs.length} rows (${withId.length} with an id).`);
    const sample = withId.slice(0, 8).map(d => d.name || d.id).filter(Boolean);
    if (sample.length) console.log(`  e.g. ${sample.join(', ')}${withId.length > 8 ? ' …' : ''}`);
    if (WRITE) {
      const n = await upsert(collectionName, withId);
      console.log(`  → Upserted ${n} docs into "${collectionName}" (sweetpro).`);
    }
  }

  console.log(`\n${WRITE ? 'Restore complete. Hard-reload the app to see the data.' : 'Preview done. If the rows above look right, re-run with --write to restore.'}\n`);
}

run().catch((e) => { console.error('Restore failed:', e); process.exit(1); });
