import {
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  setDoc,
  writeBatch,
  deleteDoc,
  runTransaction,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  terminate,
  clearIndexedDbPersistence,
  type Firestore,
} from 'firebase/firestore';
import { app } from './firebaseConfig';

/** The NAMED Firestore database the whole system reads and writes.
 *
 *  "sweetpro2" is the restored database (2026-08-14). A Firestore restore always
 *  creates a NEW database — it cannot overwrite in place — so recovery meant
 *  repointing here rather than importing back into the damaged "sweetpro".
 *  The old "sweetpro" is intentionally left untouched as a reference copy.
 *
 *  This MUST stay in step with api/scan-po-inbox.ts and scripts/restore-from-
 *  sheets.ts: if the cron writes to one database while the app reads another,
 *  imported POs silently vanish.
 *
 *  Side benefit of the rename: Firestore's offline queue and IndexedDB cache are
 *  PER-DATABASE, so every browser that still holds the damaged cache — and any
 *  deletes queued in it — is orphaned rather than replayed against live data. */
export const DATABASE_ID = 'sweetpro2';

// OFFLINE PERSISTENCE (IndexedDB) is on: a write commits to the local cache
// immediately and syncs in the background, RETRYING across a tab close /
// refresh — so an edit isn't lost between "user made the change" and "server
// acknowledged it". The multi-tab manager lets several tabs share one cache.
// Falls back to the plain (memory-only) instance if IndexedDB isn't available
// (private browsing / unsupported browser) so the app still runs.
let db: Firestore;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  }, DATABASE_ID);
} catch {
  db = getFirestore(app, DATABASE_ID);
}

/** DRAIN THE LOCAL WRITE QUEUE + CACHE for this database, then reload.
 *
 *  Firestore's offline mutation queue is FIFO: a write the SERVER permanently
 *  rejects (a 400 — e.g. a document over the 1 MiB limit, queued before the
 *  skip-guard shipped) stays at the head and blocks EVERY write behind it, so a
 *  collection sits on "still waiting for the server" forever. New code can stop
 *  creating such writes but cannot evict one already persisted in IndexedDB —
 *  only clearing the cache does.
 *
 *  terminate() shuts the client down so clearIndexedDbPersistence() is allowed at
 *  runtime (its documented precondition). SAFE when the server holds the
 *  authoritative data (post-restore it does): anything dropped is an unsynced
 *  local write that — being rejected — could never have reached the server anyway.
 *  Requires OTHER TABS on this app to be closed (multi-tab shared cache), else it
 *  throws failed-precondition.
 *
 *  Exposed on window so it can be run from the console without shipping UI:
 *    await resetFirestoreCache()
 */
export async function resetFirestoreCache(): Promise<void> {
  await terminate(db);
  await clearIndexedDbPersistence(db);
  if (typeof window !== 'undefined') window.location.reload();
}
if (typeof window !== 'undefined') {
  (window as unknown as { resetFirestoreCache?: () => Promise<void> }).resetFirestoreCache = resetFirestoreCache;
}

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
  // Carrier demurrage / wait-time / accessorial invoices (managed on the Supply
  // Chain page). Kept out of the sugar-order flow entirely.
  demurrageInvoices: 'demurrageInvoices',
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

/** Write documents to Firestore RIGHT NOW — never waits for the debounced
 *  autosave. Use at every explicit user save (create/edit a contract, customer,
 *  order…) so a record the user committed is durable the moment they save it,
 *  independent of the diff/baseline machinery, the 5s debounce, or the page
 *  living long enough for either to run.
 *
 *  Upsert-only: it never deletes, so it cannot be the cause of data loss. The
 *  debounced autosave still runs and reconciles everything else (including
 *  deletions). Failures propagate — callers MUST surface them to the user rather
 *  than reporting a save that did not happen. */
export async function saveDocsNow<T extends { id: string }>(
  collectionName: string,
  docs: T[],
): Promise<void> {
  const valid = docs.filter(d => d && d.id !== undefined && d.id !== null);
  if (valid.length === 0) return;
  // Capped by ops AND bytes, same reasoning as syncCollectionDiff: an oversized
  // commit request never settles cleanly when offline persistence is on.
  const MAX_OPS = 450;
  const MAX_BYTES = 4 * 1024 * 1024;
  let batch = writeBatch(db);
  let count = 0;
  let bytes = 0;
  const oversize: { id: string; size: number }[] = [];
  for (const item of valid) {
    const clean = stripUndefinedDeep(item);
    const size = JSON.stringify(clean).length;
    // See SINGLE_DOC_MAX_BYTES — one oversized doc 400s and wedges the collection.
    if (size > SINGLE_DOC_MAX_BYTES) {
      oversize.push({ id: item.id, size });
      continue;
    }
    if (count > 0 && (count >= MAX_OPS || bytes + size > MAX_BYTES)) {
      await withBatchTimeout(batch.commit(), collectionName);
      batch = writeBatch(db);
      count = 0;
      bytes = 0;
    }
    batch.set(doc(db, collectionName, item.id), clean);
    count++;
    bytes += size;
  }
  if (oversize.length) {
    console.error(
      `[saveDocsNow] "${collectionName}": ${oversize.length} document(s) exceed Firestore's 1 MiB per-document limit and were SKIPPED:\n` +
      oversize.map(o => `  • ${o.id} — ${Math.round(o.size / 1024)} KB`).join('\n'),
    );
  }
  // BOUNDED WAIT — same reasoning as syncCollectionDiff. With offline persistence
  // on, batch.commit() resolves only on the SERVER's ack; when the server is
  // unreachable it NEVER resolves and NEVER rejects. Left unbounded, an
  // immediate write-through save (saveNow) that can't reach the server would
  // hang forever with no .then and no .catch — so the caller records nothing,
  // shows nothing, and the user believes their new record saved when it is only
  // queued locally. Timing out lets saveNow surface an honest "saved locally,
  // not yet confirmed" state; the write itself is still queued and replays when
  // the connection returns.
  if (count > 0) await withBatchTimeout(batch.commit(), collectionName);
}

// Delete specific documents from a collection by id (used to drain the
// incomingPoOrders queue after the app ingests them into orders).
export async function deleteDocs(collectionName: string, ids: string[]): Promise<void> {
  // Let failures propagate so callers with a try/catch (e.g. Clear All) actually
  // surface a "sync failed" warning instead of falsely reporting success.
  // Best-effort callers attach their own .catch() at the call site.
  await Promise.all(ids.map(id => deleteDoc(doc(db, collectionName, id))));
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

// Per-user UI preferences (page/nav order, hidden pages, per-table column order).
// Stored one doc per user under `userPreferences/{uid}` so a user's layout follows
// them across devices instead of living only in that browser's localStorage.
export async function fetchUserPrefs(uid: string): Promise<Record<string, any> | null> {
  const snap = await getDoc(doc(db, 'userPreferences', uid));
  return snap.exists() ? (snap.data() as Record<string, any>) : null;
}
export async function saveUserPrefs(uid: string, prefs: Record<string, any>): Promise<void> {
  await setDoc(doc(db, 'userPreferences', uid), stripUndefinedDeep({ ...prefs, id: uid, updatedAt: new Date().toISOString() }));
}

// Fetch all data from all collections (one-time bulk read). Reads FROM THE SERVER
// (getDocsFromServer), not the local cache: with offline persistence enabled a
// plain getDocs would silently resolve from stale IndexedDB when the server is
// unreachable, and the caller treats a resolved load as the authoritative
// baseline that arms the autosave — editing against stale data could then clobber
// newer server records. Forcing a server read means an offline load REJECTS (the
// caller then leaves autosave disabled and keeps showing the last good state)
// instead of quietly baselining on stale data. Pending un-synced local writes are
// unaffected — the persistence queue still delivers them to the server.
// Returns the data PLUS whether it came from the server. A server read is the
// only AUTHORITATIVE load — the caller must arm the autosave only for that case.
//
// When the server is unreachable we fall back to the local IndexedDB cache so the
// app is still USABLE (blank tables are useless to an operator), and report
// fromCache: true. The caller then leaves `lastSynced` unset, which disables
// EVERY writer (autosave, saveNow write-through, the leave-flush all gate on it)
// — so cached data can be read but can never be written back over newer server
// records. That keeps the anti-clobber invariant while degrading to read-only
// instead of degrading to nothing.
export async function fetchAllData(): Promise<{ data: Record<string, any[]>; fromCache: boolean }> {
  const names = Object.values(COLLECTIONS);
  try {
    const results = await Promise.all(
      names.map(async (name) => {
        const snapshot = await getDocsFromServer(collection(db, name));
        return [name, snapshot.docs.map(d => d.data())] as const;
      })
    );
    return { data: Object.fromEntries(results) as Record<string, any[]>, fromCache: false };
  } catch (serverErr) {
    console.warn('[fetchAllData] Server read failed — falling back to the local cache (READ-ONLY).', serverErr);
    // getDocs prefers the cache when the server is unreachable. If even this
    // throws (no cache yet — e.g. a first visit while offline) let it propagate:
    // there is genuinely nothing to show.
    const results = await Promise.all(
      names.map(async (name) => {
        const snapshot = await getDocs(collection(db, name));
        return [name, snapshot.docs.map(d => d.data())] as const;
      })
    );
    return { data: Object.fromEntries(results) as Record<string, any[]>, fromCache: true };
  }
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
  // NOTE: no special case for an empty incoming array — deleting the LAST record
  // of a small collection is a legitimate user action and must persist (with the
  // old `data.length === 0` clause the delete was silently skipped and the record
  // resurrected on every reload). Emptying a collection of more than 20 docs still
  // trips the threshold below, which is the actual mass-delete signature.
  const massDelete = !opts?.allowMassDelete &&
    toDelete.length > Math.max(20, existingCount * 0.5);
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

// Per-document sync: write ONLY the docs this session actually changed (upserts)
// and delete ONLY the ids it removed (deleteIds), leaving every other doc in the
// collection untouched. This is what the debounced autosave uses so a stale tab
// can no longer overwrite another session's edits or resurrect its deletes by
// re-pushing the whole collection. `baselineCount` is how many docs this session
// last knew about (its load-time / last-push snapshot size); the mass-delete
// guard blocks a delete larger than max(20, 50% of that) unless allowMassDelete.
// No getDocs here — we never touch docs we didn't change, which is both faster
// and the whole point.
/** Marks a write whose SERVER acknowledgement didn't arrive in time. The write
 *  itself is already durable in the local IndexedDB cache and Firestore replays
 *  it when the connection returns — this is "not confirmed yet", NOT "lost". */
export class SyncTimeoutError extends Error {
  constructor(public collection: string) {
    super(`${collection}: still waiting for the server (saved locally, will finish when the connection returns)`);
    this.name = 'SyncTimeoutError';
  }
}

/** With offline persistence on, batch.commit() only settles on SERVER ack — when
 *  the server is unreachable it never resolves AND never rejects, which once
 *  wedged the whole sync loop. So every commit races a watchdog.
 *
 *  PER BATCH, deliberately. This used to wrap the WHOLE multi-batch write with
 *  one 15s budget, which meant a large-but-perfectly-healthy write (a collection
 *  with thousands of dirty docs = many sequential 450-doc round trips) tripped
 *  the timer, never advanced its baseline, and retried the same oversized write
 *  forever — permanently stuck on "still waiting for the server". A per-batch
 *  budget still catches a genuinely hung connection within seconds, while
 *  letting a big write take as long as it legitimately needs. */
// Firestore's hard per-document limit is 1,048,576 bytes. We measure JSON string
// length (≈ byte count for ASCII; a touch under for multi-byte UTF-8, so we keep a
// safety margin). A document over this 400s on write and, under offline
// persistence, wedges its whole collection — so writers skip + report offenders
// rather than letting one record poison the queue.
const SINGLE_DOC_MAX_BYTES = 1_000_000;

const BATCH_ACK_TIMEOUT_MS = 20000;
function withBatchTimeout<T>(p: Promise<T>, collectionName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SyncTimeoutError(collectionName)), BATCH_ACK_TIMEOUT_MS);
    }),
  ]);
}

export async function syncCollectionDiff<T extends { id: string }>(
  collectionName: string,
  upserts: T[],
  deleteIds: string[],
  baselineCount: number,
  opts?: { allowMassDelete?: boolean },
): Promise<void> {
  // WIPE-OUT GUARD. Two signatures, both meaning "the in-memory state is not
  // trustworthy" rather than "the user deleted these":
  //
  //  1. EVERYTHING GONE (deleteIds covers the whole baseline and nothing is left
  //     to upsert). The old threshold — max(20, baseline*0.5) — let this through
  //     for ANY collection with fewer than ~40 docs, so a failed/partial load
  //     could silently wipe smaller collections (locations, carriers, sugar
  //     types, shipping terms…). An autosave must never be the thing that empties
  //     a collection; deliberate clears go through deleteDocs(), which bypasses
  //     this function entirely.
  //  2. BULK DELETE beyond the proportional threshold, as before.
  const wipingAll = baselineCount > 0 && deleteIds.length >= baselineCount && upserts.length === 0;
  const massDelete = !opts?.allowMassDelete &&
    (wipingAll || deleteIds.length > Math.max(20, baselineCount * 0.5));
  if (massDelete && deleteIds.length > 0) {
    console.warn(
      `[syncCollectionDiff] Refusing to delete ${deleteIds.length} docs in "${collectionName}" ` +
      `(baseline ${baselineCount}, upserts ${upserts.length})${wipingAll ? ' — would EMPTY the collection' : ''}` +
      ` — looks like an unloaded/bad in-memory state; preserving them. Use an explicit clear.`,
    );
  }
  // Batches are capped by BOTH operation count and BYTES. Firestore allows 500
  // operations per commit, but the request also has a hard ~10 MiB ceiling — and
  // documents here are not small (orders carry lineItems, shipments carry lot and
  // seal arrays, poAmendments/poFieldMappings hold extracted PO payloads). 450
  // fat documents can exceed the size limit, and with offline persistence such a
  // commit does not fail cleanly: it is accepted locally and retried against the
  // server indefinitely, so the promise never settles and the collection appears
  // stuck on "waiting for the server" forever. Keeping each request well under
  // the ceiling is what actually makes these collections sync.
  const MAX_OPS = 450;
  const MAX_BYTES = 4 * 1024 * 1024; // 4 MiB — comfortably under Firestore's ~10 MiB
  const batches: ReturnType<typeof writeBatch>[] = [];
  let batch = writeBatch(db);
  let count = 0;
  let bytes = 0;
  let totalBytes = 0;
  const oversize: { id: string; size: number }[] = [];
  const flush = () => { if (count > 0) { batches.push(batch); batch = writeBatch(db); count = 0; bytes = 0; } };

  for (const item of upserts) {
    const clean = stripUndefinedDeep(item);
    // Rough but cheap size estimate; only needs to be the right order of magnitude.
    const size = JSON.stringify(clean).length;
    // SINGLE-DOCUMENT CEILING. Firestore rejects any document over 1,048,576
    // bytes with a 400 — and with offline persistence that rejected write is not
    // surfaced cleanly: it is accepted into the local cache, retried against the
    // server forever, and wedges the WHOLE collection on "waiting for the server"
    // (a batch cap on total bytes can't help — the offender is one doc). Skipping
    // it here lets every other doc in the collection sync, and names the culprit
    // so the oversized record (usually a runaway/duplicated array) can be fixed.
    if (size > SINGLE_DOC_MAX_BYTES) {
      oversize.push({ id: item.id, size });
      continue;
    }
    if (count > 0 && (count >= MAX_OPS || bytes + size > MAX_BYTES)) flush();
    batch.set(doc(db, collectionName, item.id), clean);
    count++;
    bytes += size;
    totalBytes += size;
  }
  if (oversize.length) {
    console.error(
      `[sync] "${collectionName}": ${oversize.length} document(s) exceed Firestore's 1 MiB per-document limit and were SKIPPED ` +
      `(they would 400 and wedge the whole collection). Fix these records — likely a runaway/duplicated array:\n` +
      oversize.map(o => `  • ${o.id} — ${Math.round(o.size / 1024)} KB`).join('\n'),
    );
  }
  if (!massDelete) {
    for (const id of deleteIds) {
      if (count >= MAX_OPS) flush();
      batch.delete(doc(db, collectionName, id));
      count++;
    }
  }
  flush();

  // Each batch gets its own ack budget — see withBatchTimeout. On timeout the
  // message carries the shape of the write so a stuck collection is diagnosable
  // from the console instead of guessed at.
  for (let i = 0; i < batches.length; i++) {
    try {
      await withBatchTimeout(batches[i].commit(), collectionName);
    } catch (e) {
      if (e instanceof SyncTimeoutError) {
        console.warn(
          `[sync] "${collectionName}" batch ${i + 1}/${batches.length} did not get a server ack in time — ` +
          `${upserts.length} upserts (~${Math.round(totalBytes / 1024)} KB total), ${deleteIds.length} deletes.`,
        );
      }
      throw e;
    }
  }
}

