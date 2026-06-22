# Purchase Order Scanning — Step-by-Step Setup

Two features turn customer purchase orders into Sweet Pro orders:

1. **Scan PO modal** (Orders page → **Scan PO**) — upload PO files, AI extracts the
   fields, you review/fix, it creates an **Open** order. Corrections are remembered.
2. **Automated Gmail scan** — every 15 min a cron reads the shared PO inbox, extracts
   each attached PO, and the app ingests them as **Open** orders automatically.

You can roll this out in two milestones:

- **Milestone A — manual modal** needs only a Gemini API key. ~10 minutes.
- **Milestone B — automated email scan** adds Gmail access + Firebase Admin + the cron.
  ~30–45 minutes (one-time Google Workspace / Firebase config).

Both call one Gemini-backed endpoint (`api/_poExtract.ts`, using `@google/genai`).
You are on the **Vercel Pro** plan, so the every-15-minutes cron is allowed.

---

## Milestone A — Gemini API key (manual Scan PO modal)

### A1. Create the Gemini API key
1. Go to **https://aistudio.google.com/apikey** and sign in with the Google account that
   should own billing (ideally the same org account that owns your existing service
   account + Firebase project).
2. A Google Cloud project is required. If prompted, click **Import project** and pick the
   **same project** that owns your Sheets/Gmail service account (keeps billing + IAM in one
   place). New accounts get a default project created automatically.
3. Click **Create API key** → **Copy** the key. You can't view it in full again later.
4. **Restrict the key:** on the API Keys list, if it shows **Unrestricted**, click
   **Add restrictions → Restrict to Gemini API only → Restrict key**.
   *Do not* add HTTP-referrer or IP restrictions — this key is used only server-side in the
   Vercel function (Vercel's egress IPs are dynamic, so those rules would just cause 403s).

> ⚠️ **Data privacy — upgrade to the paid tier.** On the **free** Gemini tier, Google may
> use your submitted prompts **and uploaded files** (your customers' PO PDFs) to improve its
> products, and humans may review them. For production PO data you should link a billing
> account (**Set up billing** in AI Studio, ~$10 minimum prepay) to move to the **paid tier**,
> where prompts/files are **not** used for training and **not** human-reviewed. Paid also lifts
> the low free-tier rate limits that a 15-minute cron would exhaust.

### A2. Add the key to Vercel
1. **Vercel Dashboard → your Sweet Pro project → Settings → Environment Variables.**
2. Add **`GEMINI_API_KEY`** = the copied key. Scope = **Production** (also Preview if you test
   there). Toggle **Sensitive** on. **Do not** prefix it `VITE_` — that would ship it to the
   browser.
3. (Optional) **`PO_EXTRACT_MODEL`** = `gemini-2.5-flash` (this is already the default).
   Don't use `gemini-2.0-flash` — it's being shut down.

### A3. (Optional but recommended) Protect the extract endpoint from drive-by abuse
The `/api/extract-po` endpoint is public. To require a handshake token:
1. Add **`EXTRACT_SHARED_SECRET`** = a random string (server-side, Sensitive).
2. Add **`VITE_EXTRACT_SHARED_SECRET`** = the **same** string. (This one is intentionally
   `VITE_`-prefixed so the browser sends it — note it's therefore visible in the client bundle,
   so it only deters casual abuse, it's not a true secret.)
If you set one you must set both, with identical values.

### A4. Redeploy and test
1. **Redeploy** (env-var changes only apply to new deployments): push to `main`, or
   Deployments → latest → **⋯ → Redeploy**.
2. Open the app → **Orders → Scan PO**, upload one of your PO PDFs, and confirm the review
   card fills in. That's Milestone A done — the modal works without any of the email setup.

---

## Milestone B — Automated Gmail inbox scan

The cron does two privileged things, handled by **two different service accounts**:

| Job | Identity | Credentials |
|---|---|---|
| Read the shared PO mailbox (Gmail API) | your **existing** Sheets service account | `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` (already set) + domain-wide delegation |
| Write Open orders to Firestore | a **Firebase Admin** service account | new `FIREBASE_*` vars |

### B1. Enable the Gmail API (Google Cloud Console)
1. Go to **https://console.cloud.google.com/** and use the **project picker** (top bar) to
   select the project that owns your existing service account (= your `FIREBASE_PROJECT_ID`).
2. **Navigation menu → APIs & Services → Library** (direct:
   https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Open **Gmail API** → click **Enable**. (If it says **Manage**, it's already enabled.)

### B2. Get the service account's numeric Client ID
1. **Navigation menu → IAM & Admin → Service Accounts**
   (https://console.cloud.google.com/iam-admin/serviceaccounts).
2. Click the row whose email is your **`GOOGLE_SERVICE_ACCOUNT_EMAIL`** (the one already used
   for Sheets — do **not** create a new one or a new key).
3. On the **Details** tab copy the **Unique ID** — a ~21-digit number (also shown under
   *Advanced settings → Client ID*). **This number, not the email, is what Workspace needs.**

### B3. Authorize domain-wide delegation (Google Workspace Admin)
> You must be a Workspace **super administrator**.
1. Go to **https://admin.google.com** → **Menu → Security → Access and data control →
   API controls** → **Manage Domain Wide Delegation**
   (direct: https://admin.google.com/ac/owl/domainwidedelegation).
2. Click **Add new**.
3. **Client ID** = the numeric Unique ID from B2.
4. **OAuth scopes** = exactly `https://www.googleapis.com/auth/gmail.readonly`
   (read-only — the scan never modifies the mailbox; it can't send, label, or delete.)
5. Click **Authorize**. (Propagation is usually a few minutes, occasionally longer.)

### B4. Pick / prepare the inbox
- **`PO_INBOX_ADDRESS`** must be a **real, licensed user mailbox** in your Workspace domain
  (e.g. `orders@yourdomain.com`) — not a Group, alias, or external address. The cron
  impersonates this mailbox.
- Forward customers' PO emails into it (or have them send there directly). The cron reads
  messages matching `newer_than:3d` by default — both the **attachments** (new PO documents)
  and the **email body text** (order amendments are usually written in the message). The AI
  classifies each as a new order, an amendment, a cancellation, or unrelated mail; only the
  first three are acted on. It's **read-only** — it never marks emails read, labels, or deletes
  anything; instead it records each processed message id in the Firestore `processedPoEmails`
  collection so the same email isn't imported twice.

### B5. Firebase Admin service account (Firestore writes)
1. **https://console.firebase.google.com/** → your project → **gear ⚙ → Project settings →
   Service accounts** tab.
2. Click **Generate new private key → Generate key**. A JSON file downloads (keep it secret —
   never commit it).
3. From the JSON, map three fields to Vercel env vars:
   - `project_id` → **`FIREBASE_PROJECT_ID`**
   - `client_email` → **`FIREBASE_CLIENT_EMAIL`**
   - `private_key` → **`FIREBASE_PRIVATE_KEY`**
4. **Private key paste:** paste the `private_key` **value only** (exclude the wrapping
   double-quotes from the JSON). The single-line form with literal `\n` is fine — the code
   normalizes it (`.replace(/\\n/g,'\n')`); pasting the raw multi-line PEM also works. Just
   don't wrap it in extra quotes.
5. **Grant Firestore access:** Google Cloud Console → **IAM & Admin → IAM** → find the
   `client_email` principal → **Grant** role **Cloud Datastore User** (`roles/datastore.user`).
   (Project-level IAM covers the non-default `sweetpro` database automatically — the database id
   is set in code, not via env.)

### B6. Add the remaining Vercel env vars
In **Settings → Environment Variables** (Production, Sensitive where noted):

| Variable | Value |
|---|---|
| `PO_INBOX_ADDRESS` | the mailbox from B4 |
| `FIREBASE_PROJECT_ID` | from the Firebase JSON |
| `FIREBASE_CLIENT_EMAIL` | from the Firebase JSON (Sensitive) |
| `FIREBASE_PRIVATE_KEY` | from the Firebase JSON (Sensitive) |
| `CRON_SECRET` | a random ≥16-char string, no spaces/newlines (recommended) |
| `PO_INBOX_QUERY` | *(optional)* override the default `newer_than:3d` (add `has:attachment` to skip body-only amendment emails) |

`GEMINI_API_KEY` (from Milestone A) is also required for the cron. `GOOGLE_SERVICE_ACCOUNT_EMAIL`
and `GOOGLE_PRIVATE_KEY` are already present from Sheets — don't re-add them.

`CRON_SECRET` note: when set, Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>`
on each cron call, and the handler rejects anything else (stops the public URL being triggered
by others).

### B7. Deploy and verify
1. **Redeploy** (push to `main` or Redeploy in the dashboard).
2. **Settings → Cron Jobs** — confirm `/api/scan-po-inbox` is registered at `*/15 * * * *`.
3. **Manually trigger** to test now instead of waiting 15 min:
   ```bash
   curl -X POST https://<your-app>/api/scan-po-inbox -H "Authorization: Bearer $CRON_SECRET"
   ```
   The JSON response reports `scanned`, `skipped`, `attachments`, `queued`, and any `errors`.
4. Send a test PO email into the inbox, trigger the cron, then open the app — within a few
   minutes the order appears as **Open** (a toast confirms "N orders imported from emailed POs").
   The email itself is left untouched; its id is recorded in `processedPoEmails` so it isn't
   re-imported.

---

## How it works (and why it's safe)

- The cron **never writes to the `orders` collection directly** — the app persists orders by
  replacing that whole collection, which would clobber a direct write. Instead the cron appends
  raw extractions to an **`incomingPoOrders`** queue; the app (polling ~every 5 min and shortly
  after login) drains the queue into real Open orders — assigning BOLs, net weights and pricing
  with the same logic as a hand-entered order — deduping by PO number, then deletes the queue docs.
- **Sucro = supplier.** Extraction always treats Sucro Can as the vendor and the PO issuer as the
  customer.
- **Order amendments.** Emails that change an existing order (new ship date, new quantity, or a
  cancellation) are detected and matched to the order by PO number, then placed in a **review
  queue** on the Email Center ("Order Amendments"). Nothing is auto-applied — you click **Apply**
  (or **Dismiss**) per amendment; unmatched ones (no order with that PO yet) are flagged for you.
- **Learning.** Corrections in the Scan PO modal are stored in the browser
  (`localStorage` → `poFieldMappings`) and fed back to the extractor as hints. The cron also reads
  an optional Firestore `poFieldMappings` collection if you populate it (future: auto-sync the
  browser store to Firestore so the inbox scan learns from modal corrections too).

## Troubleshooting (symptom → cause)

| Symptom | Likely cause |
|---|---|
| Function: `GEMINI_API_KEY is not configured` | env var added but **not redeployed**, or it's `VITE_`-prefixed |
| Gemini `PERMISSION_DENIED` / intermittent 403 | HTTP-referrer/IP restriction on the key — remove it, restrict by **API** only |
| Gmail `unauthorized_client` / 403 | pasted the service-account **email** instead of the **numeric Client ID**, or delegation not yet propagated |
| Gmail `403 ... Gmail API has not been used/disabled` | Gmail API enabled on the **wrong project** |
| Gmail `invalid_grant` / "not a valid email or user ID" | `PO_INBOX_ADDRESS` isn't a real licensed user in the domain |
| firebase-admin `DECODER routines` / `Invalid PEM` | `FIREBASE_PRIVATE_KEY` pasted **with** wrapping quotes, or newline handling mismatch |
| Firestore reads/writes look empty | wrong database — must be `getFirestore(app, 'sweetpro')` (already in code) |
| Cron returns 401 | `CRON_SECRET` mismatch — compare must be `Bearer ${CRON_SECRET}` exactly |
| Cron fails to register | `*/15` requires Pro (you're on Pro) — confirm the project's team is the Pro one |

## Files
- `api/_poExtract.ts` — shared Gemini extraction core (`@google/genai`).
- `api/extract-po.ts` — manual upload endpoint (Scan PO modal).
- `api/_gmail.ts` — Gmail REST helper (service-account impersonation).
- `api/scan-po-inbox.ts` — 15-minute cron: Gmail → extract → `incomingPoOrders`.
- `src/utils/poScan.ts` — client extraction call, catalog matching, learning store.
- `src/App.tsx` — Scan PO modal + review/create + queue ingestion.
