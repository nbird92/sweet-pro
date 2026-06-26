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
  tollingFees: 'tollingFees',
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

// Firestore rejects `undefined` ANYWHERE in a document — not just at the top
// level, but nested inside objects and arrays (e.g. a ship-to location whose
// city/province were left undefined). Recursively drop undefined object
// properties and array elements before writing so a single nested undefined
// can't blow up the whole sync.
function stripUndefinedDeep(value: any): any {
  if (Array.isArray(value)) return value.filter(v => v !== undefined).map(stripUndefinedDeep);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}

// Sync an entire collection NON-DESTRUCTIVELY: UPSERT every provided doc (add +
// update) and delete ONLY the docs the user actually removed. Each item MUST have
// an `id` field used as the document ID.
//
// CRITICAL SAFETY INVARIANT: an automatic save must NEVER wipe or mass-delete a
// collection. A previous version deleted every doc and re-added the array, so any
// moment the in-memory state was empty or stale (e.g. a flaky read leaving the app
// on its built-in demo data) the real records were destroyed. Now:
//   * We never blind delete-all first — incoming docs are upserted, so a mid-sync
//     failure can't leave the collection emptied.
//   * Deletions are limited to docs that are genuinely absent from the incoming
//     set AND only when that's a small change. If the incoming set is empty, or
//     would remove a large fraction of what's stored (the signature of an
//     unloaded / bad state such as demo data replacing real data), ALL deletions
//     are SKIPPED and a warning is logged — existing records are preserved.
//     Genuine, small user deletions still propagate.
export async function syncCollection<T extends { id: string }>(
  collectionName: string,
  data: T[],
  opts?: { allowMassDelete?: boolean }
): Promise<void> {
  const existing = await getDocs(collection(db, collectionName));
  const existingCount = existing.docs.length;
  const incomingIds = new Set(data.map(it => it.id));
  const toDelete = existing.docs.filter(d => !incomingIds.has(d.id));

  // Mass-deletion guard: an update may remove a handful of user-deleted records,
  // never empty or gut the collection. Beyond max(20, 50% of the collection) we
  // treat it as a bad/unloaded state and keep the existing docs. Review queues
  // and logs (poPendingImports, poAmendments, poImportLog, emailLog, inboxTriage)
  // are EXEMPT — emptying/clearing them is a normal operator action — so callers
  // pass { allowMassDelete: true } for those.
  const massDelete = !opts?.allowMassDelete && (
    (data.length === 0 && existingCount > 0) ||
    toDelete.length > Math.max(20, existingCount * 0.5)
  );
  if (massDelete && toDelete.length > 0) {
    console.warn(
      `[syncCollection] Refusing to delete ${toDelete.length} of ${existingCount} docs in "${collectionName}" ` +
      `(incoming ${data.length}). Looks like an unloaded/bad in-memory state — preserving existing records, ` +
      `upserting incoming only. A genuine bulk delete must be re-done in smaller batches.`,
    );
  }

  const batchSize = 450;
  const batches: ReturnType<typeof writeBatch>[] = [];
  let batch = writeBatch(db);
  let count = 0;
  const rotate = () => { if (count >= batchSize) { batches.push(batch); batch = writeBatch(db); count = 0; } };

  // Upsert every incoming doc (Firestore rejects `undefined` at any depth, so
  // strip those recursively).
  for (const item of data) {
    const cleanItem = stripUndefinedDeep(item);
    batch.set(doc(db, collectionName, item.id), cleanItem);
    count++;
    rotate();
  }
  // Delete only genuine, small user removals.
  if (!massDelete) {
    for (const d of toDelete) {
      batch.delete(d.ref);
      count++;
      rotate();
    }
  }
  if (count > 0) batches.push(batch);

  for (const b of batches) await b.commit();
}

