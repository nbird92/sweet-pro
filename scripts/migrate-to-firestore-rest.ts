/**
 * Migration script: Google Sheets → Firestore (using REST API)
 *
 * Prerequisites:
 *   1. Ensure .env.local has Google Sheets credentials
 *   2. Ensure .env.local has Firebase credentials (VITE_FIREBASE_API_KEY, etc.)
 *
 * Run:
 *   npx tsx scripts/migrate-to-firestore-rest.ts
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Firebase REST API setup
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const API_KEY = process.env.VITE_FIREBASE_API_KEY;

if (!PROJECT_ID || !API_KEY) {
  console.error('ERROR: VITE_FIREBASE_PROJECT_ID or VITE_FIREBASE_API_KEY not set in .env.local');
  process.exit(1);
}

// Google Sheets setup
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

// Collection mapping
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

// Numeric fields per collection
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

async function writeToFirestore(collectionName: string, docs: any[]): Promise<void> {
  console.log(`  Writing ${docs.length} documents to Firestore...`);

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc.id) {
      console.warn(`  Skipping doc without id`);
      continue;
    }

    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/sweetpro/documents/${collectionName}/${doc.id}?key=${API_KEY}`;

    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: Object.entries(doc).reduce((acc: any, [key, value]) => {
            acc[key] = { stringValue: String(value) };
            if (typeof value === 'number') {
              acc[key] = { doubleValue: value };
            } else if (typeof value === 'boolean') {
              acc[key] = { booleanValue: value };
            } else if (Array.isArray(value)) {
              acc[key] = {
                arrayValue: {
                  values: value.map(v => ({
                    stringValue: String(v)
                  }))
                }
              };
            }
            return acc;
          }, {})
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error(`  Error writing doc ${doc.id}:`, error);
      }
    } catch (err) {
      console.error(`  Network error writing doc ${doc.id}:`, err);
    }

    // Rate limiting - wait a bit between writes to avoid quota issues
    if ((i + 1) % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
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

    await writeToFirestore(collectionName, docs);
    console.log(`  → Migrated to Firestore collection "${collectionName}"\n`);
  }

  // Migrate Market Data
  const marketSheet = doc.sheetsByTitle['Data Summary'];
  if (marketSheet) {
    const rows = await marketSheet.getRows();
    const docs = rows.map((r, i) => {
      const obj = r.toObject();
      return { id: obj.id || `market-${i}`, ...obj };
    });
    console.log(`[Data Summary] Read ${docs.length} rows`);

    if (docs.length > 0) {
      await writeToFirestore('marketData', docs);
      console.log(`  → Migrated to Firestore collection "marketData"\n`);
    }
  }

  console.log('Migration complete!');
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
