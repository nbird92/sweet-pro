/**
 * Migration script: Google Sheets → Firestore
 *
 * Prerequisites:
 *   1. Install firebase-admin:  npm install firebase-admin --save-dev
 *   2. Download a Firebase service account key JSON from:
 *      Firebase Console → Project Settings → Service Accounts → Generate New Private Key
 *   3. Save it as `scripts/firebase-service-account.json`
 *   4. Ensure .env.local has the Google Sheets credentials (GOOGLE_SHEET_ID, etc.)
 *
 * Run:
 *   npx tsx scripts/migrate-to-firestore.ts
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config({ path: '.env.local' });

// ---------- Firebase Admin Setup ----------
const serviceAccountPath = resolve(__dirname, 'firebase-service-account.json');
let serviceAccount: any;
try {
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
} catch {
  console.error('ERROR: Could not read scripts/firebase-service-account.json');
  console.error('Download it from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
  process.exit(1);
}

const fbApp = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(fbApp);

// ---------- Google Sheets Setup ----------
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

// ---------- Collection mapping ----------
const SHEET_TO_COLLECTION: Record<string, string> = {
  Customers: 'customers',
  Products: 'products',
  Logistics: 'logistics',
  FreightRates: 'freightRates',
  Contracts: 'contracts',
  Carriers: 'carriers',
  Shipments: 'shipments',
  Locations: 'locations',
  Transfers: 'transfers',
  Invoices: 'invoices',
  ProductGroups: 'productGroups',
  Orders: 'orders',
};

// Numeric fields per collection that should be parsed from strings
const NUMERIC_FIELDS: Record<string, string[]> = {
  customers: ['defaultMargin'],
  products: ['netWeight', 'brix', 'premiumCadMt', 'netWeightKg', 'grossWeightKg', 'maxColor'],
  logistics: ['totalCostCad', 'weightPerLoadMt'],
  freightRates: ['cost', 'mtPerLoad'],
  contracts: ['contractVolume', 'volumeTaken', 'volumeOutstanding', 'finalPrice'],
  shipments: ['qty'],
  transfers: ['amount'],
  invoices: ['qty', 'amount'],
  orders: ['amount'],
};

function parseNumeric(obj: any, fields: string[]): any {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null && result[field] !== '') {
      result[field] = parseFloat(result[field]) || 0;
    }
  }
  return result;
}

async function writeBatch(collectionName: string, docs: any[]) {
  const BATCH_SIZE = 450;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const item of chunk) {
      if (!item.id) {
        console.warn(`  Skipping doc without id in ${collectionName}`);
        continue;
      }
      const ref = db.collection(collectionName).doc(item.id);
      batch.set(ref, item);
    }
    await batch.commit();
    console.log(`  Wrote batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} docs)`);
  }
}

async function migrate() {
  console.log('Connecting to Google Sheets...');
  const doc = new GoogleSpreadsheet(SHEET_ID!, jwt);
  await doc.loadInfo();
  console.log(`Spreadsheet: "${doc.title}"\n`);

  // Migrate each sheet tab
  for (const [sheetTitle, collectionName] of Object.entries(SHEET_TO_COLLECTION)) {
    const sheet = doc.sheetsByTitle[sheetTitle];
    if (!sheet) {
      console.log(`[SKIP] Sheet "${sheetTitle}" not found`);
      continue;
    }

    const rows = await sheet.getRows();
    let docs = rows.map(r => r.toObject());
    console.log(`[${sheetTitle}] Read ${docs.length} rows`);

    if (docs.length === 0) continue;

    // Parse numeric fields
    const numericFields = NUMERIC_FIELDS[collectionName];
    if (numericFields) {
      docs = docs.map(d => parseNumeric(d, numericFields));
    }

    // Special transformations
    if (collectionName === 'locations') {
      docs = docs.map(d => ({
        ...d,
        bays: typeof d.bays === 'string'
          ? d.bays.split(',').map((b: string) => b.trim()).filter(Boolean)
          : (d.bays || []),
      }));
    }

    if (collectionName === 'orders') {
      docs = docs.map(d => ({
        ...d,
        lineItems: typeof d.lineItems === 'string'
          ? JSON.parse(d.lineItems || '[]')
          : (d.lineItems || []),
      }));
    }

    // Clean null/undefined string values
    docs = docs.map(d => {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(d)) {
        if (value === null || value === undefined) continue;
        if (value === 'null' || value === 'undefined') continue;
        cleaned[key] = value;
      }
      return cleaned;
    });

    await writeBatch(collectionName, docs);
    console.log(`  → Migrated to Firestore collection "${collectionName}"\n`);
  }

  // Migrate Market Data (from "Data Summary" tab)
  const marketSheet = doc.sheetsByTitle['Data Summary'];
  if (marketSheet) {
    const rows = await marketSheet.getRows();
    const docs = rows.map((r, i) => {
      const obj = r.toObject();
      // Market data rows might not have an id field — generate one
      return { id: obj.id || `market-${i}`, ...obj };
    });
    console.log(`[Data Summary] Read ${docs.length} rows`);

    if (docs.length > 0) {
      await writeBatch('marketData', docs);
      console.log(`  → Migrated to Firestore collection "marketData"\n`);
    }
  } else {
    console.log('[SKIP] Sheet "Data Summary" not found — no market data migrated');
  }

  console.log('Migration complete!');
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
