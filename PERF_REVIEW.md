# Sweet Pro — Performance & Multi-User Readiness Report

## Executive summary

The dominant root cause of the lag is architectural: **the entire ~46-collection dataset is loaded once into a single ~25,136-line root component (246 `useState`, 0 `React.memo`), so every keystroke, dropdown change, and 15-second autosave tick re-renders the whole app and re-runs uncached O(dataset) work.** The single worst offender is the **Orders table (App.tsx:10445)**, which renders every row with no cap and performs two full `contracts.find` scans plus a `customers.find` per row on every render. Compounding it, **six always-on backfill effects (App.tsx:3643–3837) full-scan orders/invoices/lotCodes on every edit**, and the **debounced autosave (App.tsx:5453–5514) `JSON.stringify`s all 40+ collections each cycle** to detect what changed. For multi-user rollout the blocking issue is different and more serious: **there are no `onSnapshot` listeners anywhere — data is frozen at login, and same-document edits are last-writer-wins with full-document overwrites**, so concurrent operators silently clobber each other's work.

## Ranked action plan

Ranked by user-perceived impact ÷ effort — quick wins first.

| Rank | Fix | Impact | Effort | Why |
|---|---|---|---|---|
| 1 | Lazy-load ExcelJS at export call site (`import type` + `await import` in `exportExcel.ts:153`) | High | **S** | ~200–250 KB gzip off the cold chunk every user downloads, for zero UX change. PageBanner drags it onto every page today. |
| 2 | Add `manualChunks` vendor splitting in `vite.config.ts` | High | **S** | One monolithic 3.56 MB chunk means every app edit busts React/firebase cache. Splitting gives long-lived cache boundaries for the whole team. |
| 3 | Memoize `enrichedTransfers` (App.tsx:9457) in `useMemo([transfers, recordIndex])` | Med-High | **S** | Removes a full unmemoized resolve-map from the keystroke path on Supply Chain. |
| 4 | Extract `isLiquidSugar`/`resolveCoaSugarType` out of `coaPdf.ts` into a jsPDF-free module | High | **S** | Without this, the jsPDF split (rank 8) silently fails — these two pure helpers keep jsPDF in the eager graph. |
| 5 | Decorate-sort-undecorate the Orders price sort (App.tsx:10182–10199) | High | **S** | Kills ~1.8M contract scans per sort; runs on every keystroke while sorted by price. |
| 6 | Orders table: build `contractByNumber`/`customerByName` maps + progressive slice + `contentVisibility` (App.tsx:10445–10488) | **Critical** | **M** | The app's most-used page; turns O(orders×contracts) per render into O(1)/row and caps DOM to visible rows. |
| 7 | Collapse the six backfill effects (App.tsx:3643–3837) into one ran-once/single-pass effect | **Critical** | **M** | Every edit currently triggers tens of thousands of iterations + a render cascade; gate behind a `useRef` flag like the existing 5590/5658 pattern. |
| 8 | Dynamic-import all jsPDF generators at their async handlers (App.tsx:68–72) | High | **M** | ~110 KB gzip off cold load; handlers are already `async`. |
| 9 | Per-collection dirty flags instead of stringifying all 40 collections in autosave (App.tsx:5455) | High | **M** | Removes the periodic multi-hundred-ms main-thread stall during typing. |
| 10 | Add `onSnapshot` listeners on live collections + optimistic-concurrency writes | **Critical (multi-user)** | **L** | The must-do correctness fix before rollout — see Multi-user section. Large but non-negotiable. |

## Render architecture

- **Everything is one root component.** 246 `useState`, 0 `React.memo`, 0 `React.lazy`, 27 inline `if (activePage === 'X')` render blocks. Any state change re-renders the entire ~25k-line tree, which is why every finding below is amplified "on every keystroke."
- **Orders table renders all rows with no cap and no content-visibility** (App.tsx:10445 map, `<tr>` at 10471). Contrast the invoice table which slices (`filteredInvoices.slice(0, effectiveLimit)`, 9744) and sets `contentVisibility:'auto', containIntrinsicSize:'0 56px'` (9951–9953). **Fix:** slice to ~200 rows + `contentVisibility` per row.
- **Extracted page components are statically imported** (App.tsx:75–92: ReportsPage, FinancePage, LabPage, QualityAssurancePage, SalesForecastPage, ConferencesPage, EmailCenterPage, etc.), so a user who only opens Orders still downloads all of them. **Fix:** `React.lazy` each, wrap the switch in one `<Suspense>`; prioritize ReportsPage (pulls ExcelJS) and the motion-heavy pages. The 27 inline `activePage===` blocks must be extracted into modules before they can be split — the larger structural follow-up.

## Data loading & Firestore (multi-user)

- **No `onSnapshot` anywhere.** `firebaseDb.ts:1–11` imports only `getDoc/getDocs/setDoc/writeBatch/deleteDoc/runTransaction`. The sole load path `loadDataFromFirestore()` (App.tsx:5021) runs `fetchAllData()` once per session via `useEffect(..., [user])` (App.tsx:5396–5400). Only `handleSyncNow` (5537) and the 5-min inbox/PO pollers (5581–5586) re-pull, and the pollers refresh only those queues. **Result:** operator B works against a login-time snapshot for hours and never sees operator A's rows or edits.
- **`fetchAllData` reads every doc of all 46 collections with no query/where/limit/orderBy** (`firebaseDb.ts:120–128`, collection list 18–77). A repo-wide search for `query(`/`where(`/`limit(`/`orderBy(`/`startAfter(` returns zero matches. Runs on every login and again at the end of every `handleSyncNow` (5554). At 10k orders + 10k invoices + 10k shipments this is tens of thousands of Firestore reads per page load; cost scales as N_users × total_dataset per day. **Fix:** narrow heavy collections (`where` active status / `updatedAt` window + `limit` + `startAfter` cursors), keep full reads only for small reference collections (sugarTypes, packagingFormats, namingFormulas, shippingTerms).
- **Unbounded dataset lives entirely in root state with no archival** (App.tsx:5032–5385). Append-only collections (emailLog, poImportLog, MarketData, invoices, orders, shipments) have no time-window boundary in read or state model, so read volume and heap grow monotonically forever. **Fix:** retention window (current + prior fiscal year) with on-demand paging; cold-store old logs.

## Per-render computation

- **Orders rows do uncached O(contracts)×2 + O(customers) + O(products) work** (App.tsx:10445–10488): `customers.find` (10462), `contractForOrder` → `contracts.find` (7358), `orderPricePerMt` calls `contractForOrder` *again* (7365 → second scan), and `lineItemToShortform` → `resolveProduct` → `skus.find` + `qaProducts.find` per line item. The invoice block already builds `customersByName`/`ordersByBol`/`productMatchCache` maps (9753–9781); Orders has no equivalent. **Fix:** build the same lookup maps once, pass the single resolved contract into `orderPricePerMt`, and ideally lift `filteredOrders` + maps into a `useMemo`.
- **Orders sort calls `orderPricePerMt` twice per comparison** (App.tsx:10190–10191) → 2× `contracts.find` per compare → ~500·9·2·200 ≈ 1.8M scans per sort, inline in render. **Fix:** decorate-sort-undecorate on a precomputed `Map<orderId, priceMt>`.
- **`enrichedTransfers` maps unmemoized `resolveByPo` over all transfers every render** (App.tsx:9457–9472). `resolveByPo` → `resolveRecord` (2365) allocates a `contribs` array + `Set` and loops all 14 `RESOLVE_FIELDS`, though only 10 are consumed. `recordIndex` is memoized (2348) but this `.map` is not. **Fix:** `useMemo([transfers, recordIndex])` — searchTerm doesn't affect enrichment, so this leaves the keystroke path.
- **`resolveRecord` has no per-key result cache** (App.tsx:2365). Called per row at 8835, 9145, 9458, 9946, 10468, 11163 — the same BOL re-resolves from scratch each render, no dedupe across rows sharing a BOL. **Fix:** add `const resolveCache = useMemo(() => new Map(), [recordIndex])`, key by `${bolU}|${pk}`.
- **`resolveInvoiceRows` does `contracts.find` + `resolveProduct` per line item per visible invoice** (App.tsx:1051–1090, called at 9940). Bounded by the progressive slice so less severe than Orders, but not routed through the block's existing caches. **Fix:** pass `contractsByNumber` + product cache in, or precompute a lighter `invoicePricingByBol` map.
- **`getSortedAndFilteredData` is unmemoized and called 15+ times per render** (App.tsx:8376–8400; call sites 9215, 9473, 9738, 10628, 11284, 11409, 12696, 12819, 13806…), each doing an O(n) filter + `[...filtered].sort` copy. **Fix:** memoize per active page keyed on `[sourceArray, searchTerm, sortConfig]`.
- **Invoice-block lookup maps rebuilt every render** (App.tsx:9753–9781 — `customersByName`, `ordersByBol`, product caches). **Fix:** lift into `useMemo([customers])` / `useMemo([orders])`.

## Effects & autosave

- **Six mutually-triggering backfill effects share `{orders, invoices, lotCodes}` deps** (App.tsx:3643, 3673, 3710, 3762, 3794, 3837). Each does a full `.map` over its target collection plus rebuilds lookup Maps by scanning invoices+orders (3688–3689, 3774–3775, 3808–3817). A single row edit re-runs all effects whose deps include that collection; four of them call `setState`, rippling the cascade until it converges (guarded by `changed`/"fill blanks only", which stops loops but not the O(n) rescans). Every `setState` re-renders the 25k-line root and re-arms the autosave timer. **Fix:** gate behind a `useRef` ran-once flag (existing pattern at 5590/5658/5813/6232), or fold all six into one single-pass effect with at most one `setState` per collection; long-term run the fill at import time.
- **Additional continuous reconciliation effects full-scan / go quadratic:** customer-name canonicalize maps over all orders + all invoices on every `[customers, orders, invoices]` change (3710–3748, participates in the same ripple); contract↔ITAS fill is O(contracts×customers) via nested `.find` on every `[contracts, customers]` change (5746–5809); QA→SKU sync is O(skus×qaProducts) on every `qaProducts` change (5855–5916). **Fix:** ran-once refs or trigger only from the specific add/edit handlers, and replace inner `.find` with prebuilt Maps.
- **Debounced autosave serializes every collection on the main thread** (App.tsx:5453–5475). Line 5455 `JSON.stringify(task.data)` for all ~40 tasks just to detect dirtiness; `getDocBaseline` (5005–5018) `JSON.parse`s the whole prior snapshot + `JSON.stringify`s each doc to rebuild the baseline map; line 5464 stringifies each doc *again* for the diff. Baseline cache is invalidated every push (5473). For orders/invoices/lotCodes this is megabyte-scale synchronous JSON per 15s tick (5s on retry), freezing input. `lastSyncedData` also holds a full JSON string copy of every collection, ~doubling memory. **Fix:** per-collection version counter/dirty flag set by the setters; keep the parsed per-doc baseline map as source of truth and update incrementally; move remaining serialization to `requestIdleCallback`/Web Worker.
- **Autosave effect re-arms on a 41-item dependency array** (App.tsx:5479–5514) and rebuilds `buildSyncTasks` per call, allocating `[...hamiltonShipments, ...vancouverShipments]` (5411) and `pruneExpired(poLearned).map(...)` (5445). During the initial-load backfill cascade the `setState` ripples repeatedly reset the 15s timer, thrashing setup/teardown. The `beforeunload` dirty check (5521–5524) re-stringifies every collection for one boolean. **Fix:** arm the timer off a single dirty-flag dependency; memoize the merged-shipments array and `pruneExpired` output; use the dirty flag for the `beforeunload` check.
- **`handleSyncNow` does a full 46-collection re-read after every push** (App.tsx:5554) — the button operators press most. **Fix:** skip the pull (state already reflects the push) or refresh via `onSnapshot`.
- **PO review-queue quick-persist writes the ENTIRE collection** via `syncCollection` (App.tsx:5561–5577 → `firebaseDb.ts:164`, `getDocs` of the whole collection at 169) ~0.6s after any queue change, unlike the per-doc `syncCollectionDiff` used elsewhere. **Fix:** route through `syncCollectionDiff` with a tracked baseline.
- **Prefs-load effect does two full `localStorage` scans + per-key writes on every login** (App.tsx:3551–3613, loops at 3581–3584 and 3596–3599). **Fix:** store column prefs under a single JSON key. (Low impact — login only.)

## Bundle & initial load

Single monolithic `index-*.js` = 3,565,567 bytes (903 KB gzip) holding React, react-dom, firebase, motion, lucide-react, ExcelJS, jsPDF, and all app code. `vite.config.ts` (31 lines) has no `manualChunks`.

- **ExcelJS (~947 KB min / ~230 KB gzip) eagerly bundled** because `PageBanner.tsx:3` statically imports `exportSheetsToExcel` from `exportExcel.ts` and PageBanner renders on nearly every page (App.tsx:8621, 8907, 9268, 9507…). `ReportsPage.tsx:16` also static-imports it. Only runtime use is `new ExcelJS.Workbook()` at `exportExcel.ts:154`. **Fix:** `import type ExcelJS` + `const ExcelJS = (await import('exceljs')).default` inside the already-async `exportSheetsToExcel` (line 153); same in ReportsPage or `React.lazy` the page.
- **jsPDF + jsPDF-autotable (~343 KB min) pulled in by 5 static imports** (App.tsx:68–72), though all generators fire only from async click handlers (4089, 4197, 4386, 4546, 4633, 4721, 4774). ~110 KB gzip most views never need. **Fix:** `const { generateBolPdf } = await import('./bolPdf')` at each handler top.
- **`coaPdf.ts` mixes jsPDF generation with two pure helpers** used in render logic (App.tsx:4713 `isLiquidSugar`, 4731 `resolveCoaSugarType`). Their static import keeps jsPDF eager even after splitting the generator. **Fix:** extract into a jsPDF-free `coaHelpers.ts`; audit other PDF helpers for the same mixed-export pattern.
- **No vendor splitting** means any one-line app edit busts the entire 3.56 MB cache. **Fix:** `manualChunks` for a `react` chunk and a `firebase` chunk; ExcelJS/jsPDF fall into their own async chunks once dynamically imported.
- **`motion/react` imported in 7 files** (App.tsx:62 + 6 pages), 152 `motion.`/`<AnimatePresence` usages in App.tsx alone — too pervasive to trivially defer. **Fix (lower priority):** isolate into its own `manualChunk`; consider `LazyMotion + domAnimation`; replace simple fades with CSS transitions. Measure with a bundle analyzer first.

## Remaining lists (un-virtualized tables)

- **Email Center email-log table (`EmailCenterPage.tsx:609`)** renders every log row uncapped, `<tr>` at 610 has no `contentVisibility`, container has no max-height. emailLog is append-only and never pruned — the fastest-growing shared table. **Fix:** 200-row progressive cap + `contentVisibility`; `react-window` is the better long-term fit. (High.)
- **QA products table (`QualityAssurancePage.tsx:968`)** uncapped, per-row `productGroups.find` (969) + `resolveProductName` (984). Bounded by catalog size (hundreds). **Fix:** cap + `contentVisibility` + `productGroupByName` map. (Med.)
- **Return Orders table (`ReturnOrdersPage.tsx:149`)** uncapped. Low volume, same pattern. **Fix:** cap + `contentVisibility`. (Med-low.)
- **Shipment Schedule grid (App.tsx:9002)** is naturally gated by collapse state (only current week expanded by default, 8873–8877) — *not* a flat unvirtualized list. Only risk is a user expanding many weeks (each day is a `min-w-[1400px]` table over ~24 slots, each shipment calls `resolveRecord`). **Fix (optional):** `contentVisibility` on each week/day panel. (Low.)

## Multi-user readiness

This app currently behaves as a single-writer local cache, not a shared database. Before rollout to concurrent users, three things break:

1. **Stale reads for the whole session (critical).** No `onSnapshot` (firebaseDb.ts:1–11), single load at `[user]` (App.tsx:5396–5400). Operator B never sees operator A's new/edited orders until a manual reload. **Must-do:** replace the one-shot `fetchAllData` with `onSnapshot` listeners on the collections that change mid-session (orders, invoices, shipments, contracts, customers, review queues), each narrowed with `where`/`limit`, reducer-merging deltas into state. Static reference collections can stay one-shot.

2. **Silent lost updates on shared documents (critical).** Autosave diffs each doc against *this session's* login-time baseline (App.tsx:5464) then does a full-document `batch.set(doc(...), stripUndefinedDeep(item))` (`firebaseDb.ts:252`) — no merge, no version/`updatedAt` precondition, no transaction. If A edits ship-to and B edits quantity on the same order, the later writer overwrites the whole doc and erases the other's field, with no conflict signal (because neither session sees the other's write). The per-doc diff protects *different* docs, nothing for the *same* doc. **Must-do:** wrap same-doc writes in `runTransaction` (already imported) or use an `updatedAt`/version field as a `setDoc` precondition with re-read+merge on mismatch; write changed fields via `update()`/merge instead of `set()` of the whole object. Pair with the `onSnapshot` fix so baselines reflect committed writes.

3. **Read/write cost and client stall scale with N_users × total dataset (high).** Every login and every `Sync Now` re-reads all 46 collections in full (`firebaseDb.ts:120–128`; App.tsx:5554). The PO queue quick-persist rewrites entire shared queues on every triage click (App.tsx:5571) — when several users triage concurrently, each whole-collection rewrite re-sets docs the others just changed, amplifying write contention. Each user's tab independently runs the six-effect backfill cascade and the full-collection autosave serialization on every edit, so typing latency worsens for everyone as the team's shared data grows. **Must-do before rollout:** query-narrow `fetchAllData`, drop the post-push full re-read in `handleSyncNow`, and convert the PO queue quick-persist to `syncCollectionDiff`.

**Rollout gate:** items 1 and 2 are correctness bugs that will corrupt shared data with even 2 concurrent editors — do not roll out to multiple users without them. Item 3 is a cost/latency scaling issue that degrades gracefully but should ship close behind.

## Quick wins (ship this week)

- [ ] Lazy-load ExcelJS in `exportExcel.ts:153` (`import type` + `await import`); repeat in ReportsPage.
- [ ] Extract `isLiquidSugar`/`resolveCoaSugarType` out of `coaPdf.ts` into a jsPDF-free module.
- [ ] Dynamic-import all jsPDF generators at their async handlers (App.tsx:68–72 call sites).
- [ ] Add `manualChunks` (react, firebase) to `vite.config.ts`.
- [ ] Wrap `enrichedTransfers` in `useMemo([transfers, recordIndex])` (App.tsx:9457).
- [ ] Decorate-sort-undecorate the Orders price sort (App.tsx:10182–10199).
- [ ] Add the invoice-style lookup maps + `.slice(0,200)` + `contentVisibility` to the Orders table (App.tsx:10445–10488).
- [ ] Lift invoice-block maps into `useMemo` (App.tsx:9753–9781).
- [ ] 200-row cap + `contentVisibility` on Email Center (609), QA products (968), Return Orders (149).
- [ ] Convert PO queue quick-persist to `syncCollectionDiff` (App.tsx:5561–5577).
- [ ] Drop the post-push full re-read in `handleSyncNow` (App.tsx:5554).
- [ ] `React.lazy` the extracted page components (App.tsx:75–92), one `<Suspense>`.

## Larger refactors

- Replace one-shot `fetchAllData` with narrowed `onSnapshot` listeners + reducer-merge (multi-user correctness).
- Add optimistic concurrency (transaction or `updatedAt` precondition + field-level `update`) to same-doc writes.
- Query-narrow / paginate the heavy collections and add a retention window + on-demand history paging; scope large collections out of root state into their own hooks/context.
- Collapse the six backfill effects (App.tsx:3643–3837) into one ran-once single-pass reconciliation; move fills to import time.
- Rework autosave dirty-tracking to per-collection version flags; move serialization off the main thread; arm the debounce off a single dirty flag instead of a 41-item dep array.
- Add a memoized `resolveRecord` result cache and route Orders/Invoices resolvers through shared maps.
- Extract the 27 inline `activePage===` blocks into modules so they can be `React.lazy`-split; consider `react-window` for the append-only email log.
- Evaluate `motion` footprint (own chunk / `LazyMotion` / CSS transitions) with a bundle analyzer.