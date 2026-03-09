import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  onSnapshot,
  query,
  type Unsubscribe,
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
  marketData: 'marketData',
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

// Fetch all documents from a collection (one-time read)
export async function fetchCollection<T>(collectionName: string): Promise<T[]> {
  const snapshot = await getDocs(collection(db, collectionName));
  return snapshot.docs.map(doc => ({ ...doc.data() } as T));
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

// Subscribe to real-time updates on a collection
export function subscribeToCollection<T>(
  collectionName: string,
  callback: (data: T[]) => void
): Unsubscribe {
  const q = query(collection(db, collectionName));
  return onSnapshot(q, (snapshot) => {
    const data = snapshot.docs.map(doc => ({ ...doc.data() } as T));
    callback(data);
  });
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
    currentBatch.set(docRef, { ...item });
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

// Set a single document (create or overwrite)
export async function setDocument<T extends { id: string }>(
  collectionName: string,
  data: T
): Promise<void> {
  const docRef = doc(db, collectionName, data.id);
  await setDoc(docRef, { ...data });
}
