import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { z } from "zod";

// --- Validation Schemas ---
const CustomerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  defaultLocation: z.enum(['Hamilton', 'Vancouver']),
  defaultMargin: z.coerce.number(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  province: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const ProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  productGroup: z.string(),
  category: z.enum(['Conventional', 'Organic']).default('Conventional'),
  netWeight: z.coerce.number(),
  brix: z.coerce.number(),
  premiumCadMt: z.coerce.number(),
  netWeightKg: z.coerce.number().optional().nullable(),
  grossWeightKg: z.coerce.number().optional().nullable(),
  maxColor: z.preprocess(val => (val === '' || val == null) ? 0 : val, z.coerce.number()),
  location: z.enum(['Hamilton', 'Vancouver']),
  description: z.string().optional().nullable(),
});

const LogisticsSchema = z.object({
  id: z.string(),
  component: z.string(),
  provider: z.string(),
  totalCostCad: z.coerce.number(),
  weightPerLoadMt: z.coerce.number(),
});

const FreightRateSchema = z.object({
  id: z.string(),
  origin: z.string(),
  destination: z.string(),
  provider: z.string(),
  cost: z.coerce.number(),
  freightType: z.enum(['Dry Van', 'Bulk', 'Liquid', 'Bulk Rail', 'Intermodal']),
  mtPerLoad: z.coerce.number(),
});

const ContractSchema = z.object({
  id: z.string(),
  contractNumber: z.string(),
  customerNumber: z.string(),
  customerName: z.string(),
  contractVolume: z.coerce.number(),
  volumeTaken: z.coerce.number().default(0),
  volumeOutstanding: z.coerce.number().default(0),
  startDate: z.string(),
  endDate: z.string(),
  skuName: z.string(),
  origin: z.string(),
  destination: z.string(),
  finalPrice: z.coerce.number(),
  currency: z.string(),
  notes: z.string().optional(),
});

const CarrierSchema = z.object({
  id: z.string(),
  carrierNumber: z.string(),
  name: z.string().min(1),
  contactEmail: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const ShipmentSchema = z.object({
  id: z.string(),
  week: z.string(),
  date: z.string(),
  day: z.string(),
  time: z.string(),
  bay: z.string(),
  customer: z.string(),
  product: z.string(),
  contractNumber: z.string().optional().nullable(),
  po: z.string(),
  bol: z.string(),
  qty: z.coerce.number(),
  carrier: z.string(),
  arrive: z.string(),
  start: z.string(),
  out: z.string(),
  status: z.string(),
  notes: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
});

const LocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  province: z.string(),
  postalCode: z.string(),
  bays: z.string(),
});

const TransferSchema = z.object({
  id: z.string(),
  transferNumber: z.string(),
  from: z.string(),
  to: z.string(),
  shipmentDate: z.string(),
  arrivalDate: z.string(),
  carrier: z.string(),
  product: z.string(),
  amount: z.coerce.number(),
  lotCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string(),
});

const InvoiceSchema = z.object({
  id: z.string(),
  bolNumber: z.string(),
  customer: z.string(),
  product: z.string(),
  po: z.string(),
  qty: z.coerce.number(),
  carrier: z.string(),
  amount: z.coerce.number(),
  shipmentId: z.string(),
  date: z.string(),
  status: z.string(),
});

const ProductGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

const OrderSchema = z.object({
  id: z.string(),
  bolNumber: z.string(),
  customer: z.string(),
  product: z.string().default(''),
  contractNumber: z.string().optional().default(''),
  po: z.string(),
  date: z.string(),
  shipmentDate: z.string().optional(),
  status: z.enum(['Open', 'Confirmed', 'Cancelled']),
  lineItems: z.preprocess(val => typeof val === 'object' ? JSON.stringify(val) : val, z.string()),
  amount: z.coerce.number(),
  carrier: z.string().optional(),
});

export const SyncRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Customers"), data: z.array(CustomerSchema) }),
  z.object({ type: z.literal("Products"), data: z.array(ProductSchema) }),
  z.object({ type: z.literal("Logistics"), data: z.array(LogisticsSchema) }),
  z.object({ type: z.literal("FreightRates"), data: z.array(FreightRateSchema) }),
  z.object({ type: z.literal("Contracts"), data: z.array(ContractSchema) }),
  z.object({ type: z.literal("Carriers"), data: z.array(CarrierSchema) }),
  z.object({ type: z.literal("Shipments"), data: z.array(ShipmentSchema) }),
  z.object({ type: z.literal("Locations"), data: z.array(LocationSchema) }),
  z.object({ type: z.literal("Transfers"), data: z.array(TransferSchema) }),
  z.object({ type: z.literal("Invoices"), data: z.array(InvoiceSchema) }),
  z.object({ type: z.literal("ProductGroups"), data: z.array(ProductGroupSchema) }),
  z.object({ type: z.literal("Orders"), data: z.array(OrderSchema) }),
]);

// --- Sheet Header Definitions ---
const SHEET_HEADERS: Record<string, string[]> = {
  Customers: ['id', 'name', 'defaultLocation', 'address', 'city', 'province', 'postalCode', 'defaultMargin', 'contactEmail', 'contactPhone', 'notes'],
  Products: ['id', 'name', 'productType', 'category', 'netWeight', 'brix', 'premiumCadMt', 'netWeightKg', 'grossWeightKg', 'maxColor', 'location', 'description'],
  FreightRates: ['id', 'origin', 'destination', 'provider', 'cost', 'freightType', 'mtPerLoad'],
  Contracts: ['id', 'contractNumber', 'customerNumber', 'customerName', 'contractVolume', 'volumeTaken', 'volumeOutstanding', 'startDate', 'endDate', 'skuName', 'origin', 'destination', 'finalPrice', 'currency', 'notes'],
  Carriers: ['id', 'carrierNumber', 'name', 'contactEmail', 'contactPhone', 'notes'],
  Shipments: ['id', 'week', 'date', 'day', 'time', 'bay', 'customer', 'product', 'contractNumber', 'po', 'bol', 'qty', 'carrier', 'arrive', 'start', 'out', 'status', 'notes', 'color'],
  Locations: ['id', 'name', 'address', 'city', 'province', 'postalCode', 'bays'],
  Transfers: ['id', 'transferNumber', 'from', 'to', 'shipmentDate', 'arrivalDate', 'carrier', 'product', 'amount', 'lotCode', 'notes', 'status'],
  Invoices: ['id', 'bolNumber', 'customer', 'product', 'po', 'qty', 'carrier', 'amount', 'shipmentId', 'date', 'status'],
  ProductGroups: ['id', 'name', 'color'],
  Orders: ['id', 'bolNumber', 'customer', 'product', 'contractNumber', 'po', 'date', 'shipmentDate', 'status', 'lineItems', 'amount', 'carrier'],
  Logistics: ['id', 'component', 'provider', 'totalCostCad', 'weightPerLoadMt'],
};

// --- Google Sheets Auth ---
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

function getJWT() {
  return new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });
}

export function getDoc(sheetId?: string) {
  const jwt = getJWT();
  return new GoogleSpreadsheet(sheetId || process.env.GOOGLE_SHEET_ID || '', jwt);
}

export function getMarketDoc() {
  const marketSheetId = process.env.MARKET_DATA_SHEET_ID || process.env.GOOGLE_SHEET_ID || '';
  return getDoc(marketSheetId);
}

export async function getSheet(doc: GoogleSpreadsheet, title: string, skipHeaderCheck = false) {
  try {
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[title];
    const headers = SHEET_HEADERS[title] || ['id'];

    if (!sheet) {
      sheet = await doc.addSheet({ title, headerValues: headers });
    } else if (!skipHeaderCheck) {
      await sheet.loadHeaderRow();
      const currentHeaders = [...sheet.headerValues].filter(h => h !== '');
      let updated = false;
      const newHeaders = [...currentHeaders];

      if (title === 'Products') {
        const unitSizeIdx = newHeaders.indexOf('unitSizeKg');
        if (unitSizeIdx !== -1 && !newHeaders.includes('netWeightKg')) {
          newHeaders[unitSizeIdx] = 'netWeightKg';
          updated = true;
        }
      }

      for (const col of headers) {
        if (!newHeaders.includes(col)) {
          newHeaders.push(col);
          updated = true;
        }
      }

      if (updated) {
        await sheet.setHeaderRow(newHeaders);
      }
    }
    return sheet;
  } catch (e) {
    console.error(`Error loading sheet ${title}:`, e);
    return null;
  }
}

export function checkAuth(accessKey: string | string[] | undefined): boolean {
  const requiredKey = process.env.APP_ACCESS_KEY;
  if (requiredKey && accessKey !== requiredKey) {
    return false;
  }
  return true;
}

export function checkGoogleConfig() {
  return {
    hasId: !!process.env.GOOGLE_SHEET_ID,
    hasEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    hasKey: !!process.env.GOOGLE_PRIVATE_KEY,
  };
}
