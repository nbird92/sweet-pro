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
  disableNetwork,
  enableNetwork,
  waitForPendingWrites,
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
    // DEFAULT (streaming) TRANSPORT — final division of labor, 2026-08-20:
    //   READS  → SDK over the default streaming WebChannel. Reads have always
    //            worked on the operator's machine (the original instant loads
    //            were on this transport); it was only the WRITE stream that
    //            never acked there.
    //   WRITES → REST-first (see restSyncCollection + the app's restFirst flag):
    //            plain HTTPS PATCH/DELETE that works everywhere.
    // experimentalForceLongPolling was left on here after the write-channel
    // experiments and made every BULK READ crawl — ~40 parallel
    // getDocsFromServer over tens of thousands of docs took minutes on
    // long-polling (a no-op "Sync Now", which pulls everything after pushing,
    // ran 15+ min). With writes off the SDK channel entirely, there is no
    // reason left to hobble the read transport. Do not re-add either
    // long-polling flag: writes don't need it and reads are wrecked by it.
  }, DATABASE_ID);
} catch {
  db = getFirestore(app, DATABASE_ID);
}

/** RECONNECT + DRAIN — non-destructive first resort. Tears down the SDK's
 *  write stream and opens a fresh one, then waits (bounded) for every queued
 *  local mutation to be acknowledged. Built for the case where the stream was
 *  opened during a network fault (2026-08-19: a dead IPv6 route — the stream
 *  hung on a half-open IPv6 socket even after the fault was fixed) and never
 *  recovered on its own. No data is touched: queued writes are REPLAYED, not
 *  dropped. Returns true when the queue fully drained.
 *  Console:  await reconnectFirestore()
 */
export async function reconnectFirestore(timeoutMs = 30000): Promise<boolean> {
  const log = (m: string) => console.log(`%c[reconnect] ${m}`, 'color:#0a7');
  try {
    log('disabling network (tears down the stale write stream)…');
    await disableNetwork(db);
    await new Promise(r => setTimeout(r, 500));
    log('re-enabling network (fresh stream over the current route)…');
    await enableNetwork(db);
    log(`waiting up to ${Math.round(timeoutMs / 1000)}s for every queued local write to be acknowledged…`);
    const drained = await Promise.race([
      waitForPendingWrites(db).then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs)),
    ]);
    if (drained) log('✓ all pending local writes ACKNOWLEDGED by the server — queue is empty. Sync should be green.');
    else console.error('[reconnect] queue did NOT drain in time — a queued mutation is being rejected server-side. Run resetFirestoreCache() to discard the stale queue (the data on screen is re-pushed from memory afterwards).');
    return drained;
  } catch (e) {
    console.error('[reconnect] failed:', e);
    return false;
  }
}
if (typeof window !== 'undefined') {
  (window as unknown as { reconnectFirestore?: typeof reconnectFirestore }).reconnectFirestore = reconnectFirestore;
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
  // BYPASS THE SDK. The SDK-level path (terminate → clearIndexedDbPersistence)
  // routes through the SDK's internal async queue — and when that queue is the
  // thing that's wedged (2026-08-19: disableNetwork() itself hung behind a dead
  // write stream), those calls never return and the reset silently no-ops.
  // Deleting the IndexedDB databases directly needs no live client at all.
  // Firestore's persistence DB is named "firestore/<appName>/<projectId>/<db>"
  // (+ "firestore/…/main" for the default DB); we delete every IndexedDB whose
  // name starts with "firestore/". Auth storage ("firebaseLocalStorageDb") is
  // deliberately left alone so the user stays signed in.
  //
  // ALWAYS RELOAD afterwards — success OR failure — so the page can never be
  // stranded on a half-dead client (the bug that sent this diagnosis in circles).
  let cleared = false;
  console.log('%c[resetFirestoreCache] step 1/3 — stopping the Firestore client (bounded 3s; may be wedged)…', 'color:#c60');
  try {
    await Promise.race([terminate(db), new Promise<void>(r => setTimeout(r, 3000))]);
  } catch (e) { console.warn('[resetFirestoreCache] terminate threw (continuing):', e); }
  console.log('%c[resetFirestoreCache] step 2/3 — deleting local Firestore IndexedDB cache + write queue directly…', 'color:#c60');
  try {
    const idb = (typeof indexedDB !== 'undefined') ? indexedDB : null;
    if (!idb) throw new Error('IndexedDB unavailable');
    // Enumerate when supported; otherwise fall back to the known name pattern.
    let names: string[] = [];
    const anyIdb = idb as unknown as { databases?: () => Promise<Array<{ name?: string }>> };
    if (typeof anyIdb.databases === 'function') {
      names = (await anyIdb.databases()).map(d => d.name || '').filter(n => n.startsWith('firestore/'));
    }
    if (!names.length) {
      const appName = app.name || '[DEFAULT]';
      const projectId = (app.options as { projectId?: string }).projectId || '';
      names = [`firestore/${appName}/${projectId}/${DATABASE_ID}`, `firestore/${appName}/${projectId}/main`];
    }
    for (const n of names) {
      await new Promise<void>((resolve) => {
        const req = idb.deleteDatabase(n);
        const done = (msg: string) => { console.log(`%c[resetFirestoreCache]   ${msg}: ${n}`, 'color:#c60'); resolve(); };
        req.onsuccess = () => done('deleted');
        req.onerror = () => done('delete FAILED');
        // "blocked" = another tab still holds it open; it will be deleted when
        // that tab closes. Don't hang — reload and retry on the next load.
        req.onblocked = () => done('delete BLOCKED by another open tab (close other Sweet Pro tabs)');
        setTimeout(() => done('delete timed out'), 5000);
      });
    }
    cleared = true;
    console.log('%c[resetFirestoreCache] step 3/3 — done. Reloading…', 'color:#c60');
  } catch (e) {
    console.error('[resetFirestoreCache] direct IndexedDB delete failed (reloading anyway):', e);
  }
  if (typeof window !== 'undefined') {
    // Flag so the next load can tell the user whether the queue was actually
    // cleared, and retry once if it wasn't (other tabs may have closed by then).
    try { sessionStorage.setItem('sweetpro.cacheReset', cleared ? 'ok' : 'failed'); } catch { /* ignore */ }
    window.location.reload();
  }
}
// On load: if the previous reset failed to clear (other tab held the cache),
// try ONCE more now — before the SDK opens the cache — and report the outcome.
if (typeof window !== 'undefined') {
  try {
    const flag = sessionStorage.getItem('sweetpro.cacheReset');
    if (flag) {
      sessionStorage.removeItem('sweetpro.cacheReset');
      if (flag === 'failed') {
        console.error('[resetFirestoreCache] The previous reset could not delete the local cache (another tab probably held it open). Close EVERY other Sweet Pro tab/window, then run resetFirestoreCache() again.');
      } else {
        console.log('[resetFirestoreCache] Local Firestore cache/queue was cleared on the previous load. Starting fresh from the server.');
      }
    }
  } catch { /* sessionStorage unavailable */ }
}
if (typeof window !== 'undefined') {
  (window as unknown as { resetFirestoreCache?: () => Promise<void> }).resetFirestoreCache = resetFirestoreCache;
}

/** CONNECTIVITY PROBE — isolates WHICH layer is failing when the SDK reports
 *  "Backend didn't respond". Bypasses the Firestore SDK entirely and hits the
 *  REST API directly with the current user's ID token, so it separates:
 *    (a) auth token missing/expired      → step 1 fails
 *    (b) plain REST READ to sweetpro2     → step 2 (needs only network + token)
 *    (c) plain REST WRITE to sweetpro2    → step 3 (proves writes are allowed
 *                                            server-side; if this succeeds while
 *                                            the SDK hangs, the SDK transport is
 *                                            the problem, not auth/rules/network)
 *  Run from the console:  await probeFirestore()
 */
export async function probeFirestore(): Promise<void> {
  const log = (m: string) => console.log(`%c[probe] ${m}`, 'color:#0a7');
  const bad = (m: string) => console.error(`[probe] ${m}`);
  const { getAuth } = await import('firebase/auth');
  const authInst = getAuth(app);
  const u = authInst.currentUser;
  if (!u) { bad('1. NO signed-in user (auth.currentUser is null). Sign in and rerun.'); return; }
  let token = '';
  try {
    const t0 = performance.now();
    token = await u.getIdToken(true); // force refresh — surfaces a dead refresh token
    log(`1. Auth OK — fresh ID token obtained in ${Math.round(performance.now() - t0)}ms (uid ${u.uid}, ${u.email || ''})`);
  } catch (e) {
    bad(`1. Auth token refresh FAILED — this is your problem: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const projectId = (app.options as { projectId?: string }).projectId;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents`;
  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // 2. REST READ (one page of customers)
  try {
    const t0 = performance.now();
    const r = await fetch(`${base}/customers?pageSize=1`, { headers: hdr });
    const ms = Math.round(performance.now() - t0);
    if (r.ok) log(`2. REST READ OK — HTTP ${r.status} in ${ms}ms (network + token + rules all fine for reads)`);
    else bad(`2. REST READ rejected — HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  } catch (e) {
    bad(`2. REST READ network failure: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  // 3. REST WRITE (a probe doc in its own collection — harmless, overwritten each run)
  try {
    const t0 = performance.now();
    const r = await fetch(`${base}/_probe/connectivity`, {
      method: 'PATCH',
      headers: hdr,
      body: JSON.stringify({ fields: { at: { stringValue: new Date().toISOString() }, ua: { stringValue: navigator.userAgent.slice(0, 120) } } }),
    });
    const ms = Math.round(performance.now() - t0);
    if (r.ok) log(`3. REST WRITE OK — HTTP ${r.status} in ${ms}ms. ⇒ Server accepts writes from this machine. If the app still shows "waiting for the server", the Firestore SDK's transport/queue is the fault — NOT auth, rules, or network.`);
    else bad(`3. REST WRITE rejected — HTTP ${r.status}: ${(await r.text()).slice(0, 300)}  ⇒ server-side refusal (rules / App Check / API disabled).`);
  } catch (e) {
    bad(`3. REST WRITE network failure: ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (typeof window !== 'undefined') {
  (window as unknown as { probeFirestore?: () => Promise<void> }).probeFirestore = probeFirestore;
}

/** FIND THE POISON DOC. When a collection's batch never acks, the SDK hides
 *  WHICH document the server rejected (batch.commit() under offline persistence
 *  neither resolves nor rejects). This writes each doc INDIVIDUALLY via the
 *  REST API — which returns the real HTTP status + message — and reports every
 *  one the server refuses. Read-only in effect: accepted docs are identical to
 *  what the batch would have written anyway.
 *  Run from the console:  await findRejectedDocs('poFieldMappings')
 *  (collection name as stored; the app passes its current in-memory docs). */
export async function findRejectedDocs(
  collectionName: string,
  docs?: Array<{ id: string } & Record<string, unknown>>,
): Promise<{ tested: number; rejected: number } | null> {
  const log = (m: string) => console.log(`%c[find] ${m}`, 'color:#0a7');
  const bad = (m: string) => console.error(`[find] ${m}`);
  const { getAuth } = await import('firebase/auth');
  const u = getAuth(app).currentUser;
  if (!u) { bad('not signed in'); return null; }
  const token = await u.getIdToken(true);
  const projectId = (app.options as { projectId?: string }).projectId;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents`;
  const list = docs ?? (window as unknown as { __sweetproDocs?: Record<string, Array<{ id: string }>> }).__sweetproDocs?.[collectionName];
  if (!list || !list.length) { bad(`no docs supplied for "${collectionName}" — the app exposes current data as window.__sweetproDocs[collection]`); return null; }
  log(`testing ${list.length} doc(s) in "${collectionName}" individually…`);
  let rejected = 0;
  for (const d of list) {
    // Write the FULL document, INCLUDING the id field — the app reads docs via
    // snapshot.data() and relies on the stored `id`. (A PATCH with no updateMask
    // replaces the whole document, so omitting id would DELETE that field — an
    // earlier version of this diagnostic did exactly that and corrupted docs.)
    const err = await restPatchDoc(base, collectionName, token, d);
    if (err) { rejected++; bad(`REJECTED id="${d.id}": ${err}\n  doc: ${JSON.stringify(d).slice(0, 300)}`); }
  }
  if (rejected === 0) log(`all ${list.length} doc(s) ACCEPTED by the server via REST. ⇒ The payload is fine; the SDK's local queue/transport is what is stuck. The app will now cycle its connection automatically (reconnectFirestore).`);
  else bad(`${rejected} doc(s) rejected — these are what wedge the collection. Fix/remove them.`);
  return { tested: list.length, rejected };
}
if (typeof window !== 'undefined') {
  (window as unknown as { findRejectedDocs?: typeof findRejectedDocs }).findRejectedDocs = findRejectedDocs;
}

// JSON → Firestore REST "Value" encoding (covers every shape this app stores:
// strings, finite numbers, booleans, null, arrays, nested maps). Non-finite
// numbers (NaN/Infinity) can't be represented and become null.
function firestoreValue(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) fields[k] = firestoreValue(x);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// PATCH one document over REST (full-document replace, matching batch.set).
// Returns null on success, or an error string. base = documents root URL.
async function restPatchDoc(base: string, collectionName: string, token: string, d: { id: string } & Record<string, unknown>): Promise<string | null> {
  const clean = stripUndefinedDeep(d) as { id: string } & Record<string, unknown>;
  if (JSON.stringify(clean).length > SINGLE_DOC_MAX_BYTES) return `exceeds Firestore's 1 MiB per-document limit`;
  const fields: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(clean)) if (x !== undefined) fields[k] = firestoreValue(x);
  try {
    const r = await fetch(`${base}/${collectionName}/${encodeURIComponent(String(d.id))}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    if (r.ok) return null;
    return `HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** PERSIST A COLLECTION DIFF VIA THE REST API — the reliable write path when the
 *  SDK's streaming Write channel won't ack (diagnosed 2026-08-19: on the
 *  operator's machine plain REST writes succeed every time while the SDK stream
 *  hangs). Upserts are full-document replaces INCLUDING the id field; deletes
 *  are REST DELETEs. Same document shape the SDK batch would have written, so the
 *  in-memory baseline stays valid and the SDK's still-queued duplicate is a
 *  harmless no-op. Runs in small concurrent chunks for speed without hammering.
 *  Returns ok=true only if EVERY write/delete succeeded. */
export async function restSyncCollection(
  collectionName: string,
  upserts: Array<{ id: string } & Record<string, unknown>>,
  deleteIds: string[] = [],
): Promise<{ ok: boolean; upserted: number; deleted: number; failed: number; firstError?: string }> {
  const { getAuth } = await import('firebase/auth');
  const u = getAuth(app).currentUser;
  if (!u) return { ok: false, upserted: 0, deleted: 0, failed: upserts.length + deleteIds.length, firstError: 'not signed in' };
  let token: string;
  try { token = await u.getIdToken(); } catch (e) { return { ok: false, upserted: 0, deleted: 0, failed: upserts.length + deleteIds.length, firstError: `token: ${e instanceof Error ? e.message : String(e)}` }; }
  const projectId = (app.options as { projectId?: string }).projectId;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents`;
  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let upserted = 0, deleted = 0, failed = 0;
  let firstError: string | undefined;
  const note = (e: string | null) => { if (e) { failed++; if (!firstError) firstError = e; } };

  // Bounded concurrency so a big collection doesn't fire 500 requests at once.
  // 24 concurrent single-doc PATCHes. Browsers multiplex these over one HTTP/2
  // connection, and Firestore handles per-doc writes at this rate comfortably —
  // at 8 a first-time 900-doc backlog took minutes; at 24 it's ~3x faster while
  // still bounded (never thousands of requests in flight at once).
  const CHUNK = 24;
  for (let i = 0; i < upserts.length; i += CHUNK) {
    const slice = upserts.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map(d => restPatchDoc(base, collectionName, token, d)));
    for (const e of results) { if (e === null) upserted++; else note(e); }
  }
  for (let i = 0; i < deleteIds.length; i += CHUNK) {
    const slice = deleteIds.slice(i, i + CHUNK);
    const results = await Promise.all(slice.map(async (id) => {
      try {
        // DELETE is idempotent — removing a doc that doesn't exist returns 200.
        const r = await fetch(`${base}/${collectionName}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: hdr });
        return r.ok ? null : `DELETE HTTP ${r.status} on ${id}`;
      } catch (e) { return `delete ${id}: ${e instanceof Error ? e.message : String(e)}`; }
    }));
    for (const e of results) { if (e === null) deleted++; else note(e); }
  }
  return { ok: failed === 0, upserted, deleted, failed, firstError };
}
if (typeof window !== 'undefined') {
  (window as unknown as { restSyncCollection?: typeof restSyncCollection }).restSyncCollection = restSyncCollection;
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
    const idProblem = invalidDocIdReason(item.id);
    if (idProblem) { console.error(`[saveDocsNow] "${collectionName}": skipped doc with invalid id "${String(item.id).slice(0, 80)}" — ${idProblem}`); continue; }
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
  // Every doc is written with doc(collection, item.id) and carries `id` in its
  // data too, so the Firestore document id IS the record id. Fall back to it when
  // the `id` FIELD is missing — which self-heals any doc whose id field got
  // dropped (e.g. an earlier REST diagnostic that replaced docs without it), so a
  // missing id field can never leave a record unidentifiable in memory.
  const withId = (d: { id: string; data: () => any }) => {
    const data = d.data();
    return data && data.id != null ? data : { ...data, id: d.id };
  };
  try {
    const results = await Promise.all(
      names.map(async (name) => {
        const snapshot = await getDocsFromServer(collection(db, name));
        return [name, snapshot.docs.map(withId)] as const;
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
        return [name, snapshot.docs.map(withId)] as const;
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

/** Why Firestore would REJECT this document id (null = valid). Firestore's
 *  rules: non-empty, ≤ 1,500 bytes UTF-8, no "/", not "." or "..", and not the
 *  reserved `__name__` form. A single bad id 400s its whole batch — and with
 *  offline persistence that batch is retried forever and wedges the collection
 *  on "still waiting for the server". This happened with poFieldMappings
 *  (2026-08-18): ids were built from raw PO-email text and one exceeded 1,500
 *  bytes. Skipping + naming the offender keeps the rest of the collection
 *  syncing and makes the culprit visible instead of silent. */
function invalidDocIdReason(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) return 'empty / non-string id';
  if (id === '.' || id === '..') return 'reserved "." / ".." id';
  if (id.includes('/')) return 'contains "/"';
  if (/^__.*__$/.test(id)) return 'reserved __name__ form';
  // Byte length, not char length — multi-byte chars count more.
  if (new TextEncoder().encode(id).length > 1500) return `exceeds 1,500 bytes (${id.length} chars)`;
  return null;
}

// 15s. This is the window the SDK's streaming write gets before the caller
// falls back to a REST write (which works on machines where the SDK stream
// hangs). It does NOT need to exceed real ack latency: if the SDK ack arrives
// later, opts.onLateAck still reconciles the baseline; if it never arrives, the
// REST fallback has already persisted the data. Shorter than this would make
// healthy-but-slow acks fall back needlessly; much longer would delay the REST
// save on a machine where the stream is dead.
const BATCH_ACK_TIMEOUT_MS = 15000;
function withBatchTimeout<T>(p: Promise<T>, collectionName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SyncTimeoutError(collectionName)), BATCH_ACK_TIMEOUT_MS);
    }),
  ]);
}

// opts.onLateAck: called if the server ack arrives AFTER SyncTimeoutError was
// already thrown — the write landed; the caller should advance its baseline.
export async function syncCollectionDiff<T extends { id: string }>(
  collectionName: string,
  upserts: T[],
  deleteIds: string[],
  baselineCount: number,
  opts?: { allowMassDelete?: boolean; onLateAck?: () => void },
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
  const badIds: { id: string; reason: string }[] = [];
  const flush = () => { if (count > 0) { batches.push(batch); batch = writeBatch(db); count = 0; bytes = 0; } };

  for (const item of upserts) {
    // BAD DOCUMENT ID — Firestore would 400 the whole batch. Skip + name it.
    const idProblem = invalidDocIdReason(item.id);
    if (idProblem) {
      badIds.push({ id: String(item.id).slice(0, 80), reason: idProblem });
      continue;
    }
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
  if (badIds.length) {
    console.error(
      `[sync] "${collectionName}": ${badIds.length} document(s) have an id Firestore would REJECT and were SKIPPED ` +
      `(one bad id 400s the whole batch and wedges the collection):\n` +
      badIds.map(b => `  • "${b.id}${b.id.length >= 80 ? '…' : ''}" — ${b.reason}`).join('\n'),
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

  // Commit every batch (they're independent), then race the combined ack
  // against the budget. On timeout the caller gets SyncTimeoutError as before —
  // but the underlying commits keep running, and when the LATE ack eventually
  // lands, opts.onLateAck fires so the caller can advance its baseline instead
  // of re-pushing identical docs forever. This is what breaks the 2026-08-19
  // loop where real acks took longer than the watchdog on a slow write stream.
  if (batches.length) {
    const allAcked = Promise.all(batches.map(b => b.commit()));
    try {
      await withBatchTimeout(allAcked, collectionName);
    } catch (e) {
      if (e instanceof SyncTimeoutError) {
        console.warn(
          `[sync] "${collectionName}" (${batches.length} batch(es)) did not get a server ack in time — ` +
          `${upserts.length} upserts (~${Math.round(totalBytes / 1024)} KB total), ${deleteIds.length} deletes. ` +
          `Will report if the ack arrives late.`,
        );
        allAcked
          .then(() => {
            console.log(`%c[sync] "${collectionName}" LATE server ack received — the write DID land; baseline advanced.`, 'color:#0a7');
            opts?.onLateAck?.();
          })
          .catch(() => { /* genuine failure — the normal retry cycle handles it */ });
      }
      throw e;
    }
  }
}

