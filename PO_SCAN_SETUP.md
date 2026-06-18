# Purchase Order Scanning — Setup

Two features turn customer purchase orders into Sweet Pro orders:

1. **Scan PO modal** (Orders page → **Scan PO**) — upload PO files (PDF/Excel/CSV/image),
   AI extracts the fields, you review/fix them, then it creates an **Open** order.
   Your corrections are remembered and improve future scans.
2. **Automated Gmail scan** — every 15 minutes a cron reads the shared PO inbox,
   extracts each attached PO, and the app ingests them as **Open** orders automatically.

Both call one Gemini-backed endpoint (`/api/extract-po` / shared core in `api/_poExtract.ts`,
using `@google/genai`).

---

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

### Required for the modal (feature 1)
| Variable | Notes |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key used for extraction (`GOOGLE_API_KEY` also accepted). Create one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |

### Optional
| Variable | Notes |
|---|---|
| `PO_EXTRACT_MODEL` | Defaults to `gemini-2.5-flash`. |
| `EXTRACT_SHARED_SECRET` | If set, `/api/extract-po` requires `Authorization: Bearer <value>`. |
| `VITE_EXTRACT_SHARED_SECRET` | Must equal `EXTRACT_SHARED_SECRET` so the browser sends the header. |

### Required additionally for the Gmail scan (feature 2)
| Variable | Notes |
|---|---|
| `PO_INBOX_ADDRESS` | The mailbox to scan, e.g. `orders@sucrocan.com`. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Already set for Sheets — reused for Gmail (see delegation below). |
| `GOOGLE_PRIVATE_KEY` | Already set for Sheets (literal `\n` newlines are handled). |
| `FIREBASE_PROJECT_ID` | Firebase project id (the `sweetpro` database lives here). |
| `FIREBASE_CLIENT_EMAIL` | From a Firebase **service account** key (see below). |
| `FIREBASE_PRIVATE_KEY` | From the same key (literal `\n` newlines are handled). |
| `CRON_SECRET` | Recommended. Vercel sends it as `Authorization: Bearer` to the cron. |
| `PO_INBOX_QUERY` | Optional Gmail search; default `is:unread has:attachment`. |

---

## 2. Google Workspace — domain-wide delegation (Gmail)

The cron reads the inbox by impersonating `PO_INBOX_ADDRESS` with the existing
service account. Authorize it once:

1. Google Cloud Console → the service account → note its **Client ID** (numeric).
2. Workspace **Admin console** → Security → Access and data control →
   **API controls** → **Manage domain-wide delegation** → **Add new**.
3. Client ID = the service account's client ID.
   Scope = `https://www.googleapis.com/auth/gmail.modify`
4. Ensure `PO_INBOX_ADDRESS` is a real mailbox in your Workspace domain.

The Gmail API must be enabled on the service account's Google Cloud project.

## 3. Firebase admin service account (Firestore writes)

The cron writes to Firestore using the Admin SDK:

1. Firebase console → Project settings → **Service accounts** → **Generate new private key**.
2. From the JSON: `project_id` → `FIREBASE_PROJECT_ID`, `client_email` →
   `FIREBASE_CLIENT_EMAIL`, `private_key` → `FIREBASE_PRIVATE_KEY`.

## 4. Cron schedule

`vercel.json` runs `/api/scan-po-inbox` every 15 minutes (`*/15 * * * *`).
**Sub-daily cron requires a Vercel Pro plan** — on Hobby the minimum is once per day.
Adjust the schedule in `vercel.json` if needed.

Trigger a manual run to test (with `CRON_SECRET` set):

```bash
curl -X POST https://<your-app>/api/scan-po-inbox \
  -H "Authorization: Bearer $CRON_SECRET"
```

Response summarizes `scanned`, `attachments`, `queued`, and any `errors`.

---

## How it works / safety

- **No clobbering.** The web app persists each collection by *replacing* it
  wholesale. So the cron never writes to `orders` directly — it appends raw
  extractions to a separate **`incomingPoOrders`** queue. The app drains that
  queue into real Open orders (assigning BOLs, net weights, pricing with the
  existing order logic), deduping by PO number, then deletes the queue docs.
- **Processed emails** get the Gmail label **`PO-Imported`** and are marked read,
  so they are not picked up again.
- **Sucro = supplier.** Extraction always treats Sucro Can as the vendor and the
  PO issuer as the customer.
- **Learning.** Corrections you make in the Scan PO modal are stored in the
  browser (`localStorage` key `poFieldMappings`) and fed back to the extractor as
  hints. The cron also reads an optional Firestore `poFieldMappings` collection if
  you choose to populate it (future enhancement: auto-sync the browser store to
  Firestore so the inbox scan learns from modal corrections too).

## Files

- `api/_poExtract.ts` — shared Gemini extraction core (`@google/genai`).
- `api/extract-po.ts` — manual upload endpoint (Scan PO modal).
- `api/_gmail.ts` — Gmail REST helper (service-account impersonation).
- `api/scan-po-inbox.ts` — 15-minute cron: Gmail → extract → `incomingPoOrders`.
- `src/utils/poScan.ts` — client extraction call, catalog matching, learning store.
- `src/App.tsx` — Scan PO modal + review/create + queue ingestion.
