import {
  collection,
  doc,
  getDocs,
  writeBatch,
  deleteDoc,
  runTransaction,
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from './firebaseConfig';

// Use the "sweetpro" database instead of the default
const db = getFirestore(app, 'sweetpro');

// Collection names matching the old Google Sheets tab names
export const COLLECTIONS = {
  customers: 'customers',
  products: 'products',
  logistics: 'logistics',
  freightRates: 'freightRates',
  contracts: 'contracts',
  carriers: 'carriers',
  shipments: 'shipments',
  locations: 'locations',
  transfers: 'transfers',
  invoices: 'invoices',
  productGroups: 'productGroups',
  orders: 'orders',
  marketData: 'MarketData',
  conferences: 'conferences',
  people: 'people',
  qaProducts: 'qaProducts',
  fuelSurcharges: 'fuelSurcharges',
  vendors: 'vendors',
  chepPalletMovements: 'chepPalletMovements',
  salesLeads: 'salesLeads',
  sampleRequests: 'sampleRequests',
  qaTemplates: 'qaTemplates',
  sugarTypes: 'sugarTypes',
  lotCodes: 'lotCodes',
  fiscalYears: 'fiscalYears',
  customerForecasts: 'customerForecasts',
  customerGroups: 'customerGroups',
  packagingFormats: 'packagingFormats',
  namingFormulas: 'namingFormulas',
  shippingTerms: 'shippingTerms',
  emailLog: 'emailLog',
  emailSettings: 'emailSettings',
  returnOrders: 'returnOrders',
  // Persistent dashboard log of POs imported from the Gmail inbox scan.
  poImportLog: 'poImportLog',
  // Review queue of emailed order amendments/cancellations awaiting approval.
  poAmendments: 'poAmendments',
  // Review queue of emailed new POs awaiting operator approval (the app no
  // longer auto-creates orders from the inbox scan — each is approved here).
  poPendingImports: 'poPendingImports',
  // Read-only inbox feed (rolling ~7 days): the Gmail scan mirrors every inbox
  // message here so operators can read/triage the PO inbox inside the app. Cron-
  // written, so NOT part of the client whole-collection autosave.
  inboxFeed: 'inboxFeed',
  // Operator triage state (handled/dismissed) for inbox-feed emails. Client-owned
  // and synced (keyed by Gmail message id).
  inboxTriage: 'inboxTriage',
  // Learned PO field corrections (customer / product / contract aliases). The
  // app writes these as the operator corrects scans; the Gmail PO scan
  // (api/scan-po-inbox) reads them as extraction hints, so corrections improve
  // BOTH manual uploads and the automated inbox scan over time.
  poFieldMappings: 'poFieldMappings',
  // Append-only queue: the Gmail PO scan (api/scan-po-inbox) writes extracted
  // POs here; the app ingests them into `orders` on load, then deletes them.
  // NOT part of the whole-collection autosave, so cron writes are never
  // clobbered by the client's syncCollection.
  incomingPoOrders: 'incomingPoOrders',
} as const;

// Fetch all documents from a collection (one-time read)
export async function fetchCollection<T>(collectionName: string): Promise<T[]> {
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshot.docs.map(doc => ({ ...doc.data() } as T));
}

// Delete specific documents from a collection by id (used to drain the
// incomingPoOrders queue after the app ingests them into orders).
export async function deleteDocs(collectionName: string, ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => deleteDoc(doc(db, collectionName, id)).catch(() => {})));
}

// Atomically CLAIM a queue doc: in a transaction, read it and (if it still
// exists) delete it, returning its data. Returns null when another client
// already claimed it. This lets two open browser sessions drain the same
// incomingPoOrders queue without double-processing the same emailed PO.
export async function claimDoc<T>(collectionName: string, id: string): Promise<T | null> {
  const ref = doc(db, collectionName, id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;
    tx.delete(ref);
    return snap.data() as T;
  });
}

// Fetch all data from all collections (one-time bulk read)
export async function fetchAllData() {
  const results = await Promise.all(
    Object.values(COLLECTIONS).map(async (name) => {
      const snapshot = await getDocs(collection(db, name));
      return [name, snapshot.docs.map(d => d.data())] as const;
    })
  );
  return Object.fromEntries(results) as Record<string, any[]>;
}

// Sync an entire collection: clear all docs and re-add from the provided array.
// Each item MUST have an `id` field used as the document ID.
export async function syncCollection<T extends { id: string }>(
  collectionName: string,
  data: T[]
): Promise<void> {
  // Get existing docs
  const existing = await getDocs(collection(db, collectionName));

  // Use batched writes (max 500 per batch)
  const batchSize = 450; // Leave room for deletes + writes in same batch

  // First, delete all existing docs
  const deleteBatches: ReturnType<typeof writeBatch>[] = [];
  let currentBatch = writeBatch(db);
  let count = 0;

  for (const docSnap of existing.docs) {
    currentBatch.delete(docSnap.ref);
    count++;
    if (count >= batchSize) {
      deleteBatches.push(currentBatch);
      currentBatch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) deleteBatches.push(currentBatch);

  for (const batch of deleteBatches) {
    await batch.commit();
  }

  // Then, add all new docs
  const addBatches: ReturnType<typeof writeBatch>[] = [];
  currentBatch = writeBatch(db);
  count = 0;

  for (const item of data) {
    const docRef = doc(db, collectionName, item.id);
    // Strip undefined values — Firestore rejects them
    const cleanItem = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
    currentBatch.set(docRef, cleanItem);
    count++;
    if (count >= batchSize) {
      addBatches.push(currentBatch);
      currentBatch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) addBatches.push(currentBatch);

  for (const batch of addBatches) {
    await batch.commit();
  }
}

