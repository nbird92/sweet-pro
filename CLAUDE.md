# Sweet Pro — Project Context

## What this is
Sweet Pro is a commodity trading and logistics management web application built for **Sucro Canada**. It handles the full order lifecycle: pricing/contracts, orders, shipments, invoicing, QA documents, email dispatch, and reporting.

## Tech stack
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4
- **Backend**: Express server (`server.ts`) with Vercel serverless functions under `api/`
- **Database**: Firebase Firestore (real-time sync via `src/firebaseDb.ts`)
- **Auth**: Firebase Auth — Google sign-in only (`src/firebaseConfig.ts`)
- **Storage**: Firebase Storage (`src/firebaseStorage.ts`)
- **Email**: Resend API via `api/send-email.ts` and `src/utils/sendEmail.ts`
- **PDFs**: jsPDF + jsPDF-autotable — BOL (`bolPdf.ts`), COA (`coaPdf.ts`), Order Confirmation (`orderConfirmationPdf.ts`)
- **Excel export**: ExcelJS via `src/utils/exportExcel.ts`
- **Google Sheets sync**: `api/_sheets.ts`, `api/sync.ts`, `src/utils/googleSheetsSync.ts`, `src/utils/googleOrderSheetSync.ts`
- **AI**: Gemini via `@google/genai`; market data via `api/market-data.ts`

## Dev commands
```
npm run dev        # Express server (tsx server.ts) — main dev entry
npm run dev:vite   # Vite only on port 3007
npm run build      # Vite build
npm run lint       # tsc --noEmit
```

## Repo & deploy
- GitHub: `https://github.com/nbird92/sweet-pro.git` (branch: `main`)
- Deployed on **Vercel** (`vercel.json` present)

## Project structure
```
src/
  App.tsx               # Single large root component (~all page state lives here)
  types.ts              # All shared TypeScript interfaces/types
  firebaseDb.ts         # Firestore CRUD helpers + COLLECTIONS enum
  firebaseConfig.ts     # Firebase init + Google auth provider
  utils/
    sendEmail.ts        # Resend email helper + idempotency key
    exportExcel.ts      # Excel export (SheetSpec pattern)
    googleSheetsSync.ts # Shipment schedule sheet sync
    googleOrderSheetSync.ts  # Orders/invoices/shipments sheet sync
    namingFormulaResolver.ts # Product short-form / long-form name rules
  components/
    DataTable.tsx        # Reusable table with sort/filter (standard pattern)
    DetailModal.tsx      # Reusable detail drawer (DetailRow / DetailField)
    ConferencesPage.tsx
    EmailCenterPage.tsx  # Email log + manual send UI
    FinancePage.tsx
    LabPage.tsx
    PeoplePage.tsx
    QualityAssurancePage.tsx
    ReportsPage.tsx
    ReturnOrdersPage.tsx
    SalesForecastPage.tsx
    SalesStatsPage.tsx
    PageBanner.tsx
api/
  data.ts              # Firestore data API endpoint
  send-email.ts        # Email send endpoint (Resend)
  sync.ts              # Google Sheets sync endpoint
  _sheets.ts           # Sheets helper
  market-data.ts       # Market data fetch endpoint
```

## Key data models (src/types.ts)
- `SKU` — products with productCode, sugarType, productFormat, shortForm, productLongForm
- `Customer` — with defaultLocation, salesperson, margin, contact emails
- `Order` / `OrderLineItem` — full order workflow (Draft → Confirmed → Shipped → Complete & Billed)
- `Shipment` / `Contract` / `ContractLine` / `Invoice`
- `ReturnOrder` — BOL-driven, created from completed orders
- `QAProduct` / `QADocument` / `QATemplate` / `SampleRequest`
- `EmailLog` / `EmailSettings` — Resend-backed email center
- `Conference` / `Person` / `SalesLead` / `SalesLeadFollowUp`
- `Transfer` / `TransferLeg` / `ChepPalletMovement`
- `NamingFormula` / `ShippingTerm` / `FuelSurcharge` / `Vendor`
- `FiscalYear` / `CustomerForecast` / `CustomerGroup` / `PackagingFormat`
- `CommodityConfig` — pricing calculator inputs (FX, freight, refining margin, etc.)

## UI conventions
- **DataTable + DetailModal** is the standard pattern for every list page. When adding a new table page, follow the pattern established in `DataTable.tsx` and `DetailModal.tsx`.
- All page components import from the root `App.tsx` state via props — no global state library.
- Tailwind CSS v4 (use `@import "tailwindcss"` not `@tailwind` directives).
- Motion/Framer for animations (`motion/react`).
- Lucide React for icons.

## Recent work (latest commits)
- Standardized QA Templates, Supply Chain, and Fuel Surcharges pages to DataTable + DetailModal pattern
- Return Orders page: inline status dropdown, BOL-driven creation, email + Return & Bill flow
- Email Center: Resend integration, BOL + COA auto-send on Complete & Bill, email log
- Order workflow: full-screen detail modal, Complete & Bill confirm, sticky footer
- BOL + COA PDF generation wired to order product names
