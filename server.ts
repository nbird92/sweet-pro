import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import dotenv from "dotenv";
import { z } from "zod";
import rateLimit from "express-rate-limit";

dotenv.config({ path: '.env.local' });

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
  bays: z.string(), // Stored as comma-separated string in Sheets
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

const OrderLineItemSchema = z.object({
  id: z.string(),
  productName: z.string(),
  qty: z.coerce.number(),
  contractNumber: z.string(),
  netWeightPerUnit: z.coerce.number(),
  totalWeight: z.coerce.number(),
  unitAmount: z.coerce.number().optional(),
  mtAmount: z.coerce.number().optional(),
  lineAmount: z.coerce.number().optional(),
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

const SyncRequestSchema = z.discriminatedUnion("type", [
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust proxy for express-rate-limit to work behind nginx
  app.set('trust proxy', 1);

  // --- Security Middleware ---
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: { error: "Too many requests, please try again later." },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  app.use(limiter);
  app.use(express.json({ limit: '1mb' }));

  // Simple Access Key Middleware
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const accessKey = req.headers['x-access-key'];
    const requiredKey = process.env.APP_ACCESS_KEY;
    
    if (requiredKey && accessKey !== requiredKey) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
    next();
  };

  // Google Sheets Setup
  const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ];

  const jwt = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: SCOPES,
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID || '', jwt);

  async function getSheet(title: string, skipHeaderCheck = false) {
    try {
      await doc.loadInfo();
      let sheet = doc.sheetsByTitle[title];
      const headers = title === 'Customers' 
        ? ['id', 'name', 'defaultLocation', 'address', 'city', 'province', 'postalCode', 'defaultMargin', 'contactEmail', 'contactPhone', 'notes']
        : title === 'Products'
        ? ['id', 'name', 'productType', 'category', 'netWeight', 'brix', 'premiumCadMt', 'netWeightKg', 'grossWeightKg', 'maxColor', 'location', 'description']
        : title === 'FreightRates'
        ? ['id', 'origin', 'destination', 'provider', 'cost', 'freightType', 'mtPerLoad']
        : title === 'Contracts'
        ? ['id', 'contractNumber', 'customerNumber', 'customerName', 'contractVolume', 'volumeTaken', 'volumeOutstanding', 'startDate', 'endDate', 'skuName', 'origin', 'destination', 'finalPrice', 'currency', 'notes']
        : title === 'Carriers'
        ? ['id', 'carrierNumber', 'name', 'contactEmail', 'contactPhone', 'notes']
        : title === 'Shipments'
        ? ['id', 'week', 'date', 'day', 'time', 'bay', 'customer', 'product', 'contractNumber', 'po', 'bol', 'qty', 'carrier', 'arrive', 'start', 'out', 'status', 'notes', 'color']
        : title === 'Locations'
        ? ['id', 'name', 'address', 'city', 'province', 'postalCode', 'bays']
        : title === 'Transfers'
        ? ['id', 'transferNumber', 'from', 'to', 'shipmentDate', 'arrivalDate', 'carrier', 'product', 'amount', 'lotCode', 'notes', 'status']
        : title === 'Invoices'
        ? ['id', 'bolNumber', 'customer', 'product', 'po', 'qty', 'carrier', 'amount', 'shipmentId', 'date', 'status']
        : title === 'ProductGroups'
        ? ['id', 'name', 'color']
        : title === 'Orders'
        ? ['id', 'bolNumber', 'customer', 'product', 'contractNumber', 'po', 'date', 'shipmentDate', 'status', 'lineItems', 'amount', 'carrier']
        : ['id', 'component', 'provider', 'totalCostCad', 'weightPerLoadMt'];

      if (!sheet) {
        sheet = await doc.addSheet({ title, headerValues: headers });
      } else if (!skipHeaderCheck) {
        // Ensure all headers exist - only if requested
        await sheet.loadHeaderRow();
        const currentHeaders = [...sheet.headerValues].filter(h => h !== '');
        let updated = false;
        const newHeaders = [...currentHeaders];

        // Products: rename unitSizeKg â†’ netWeightKg
        if (title === 'Products') {
          const unitSizeIdx = newHeaders.indexOf('unitSizeKg');
          if (unitSizeIdx !== -1 && !newHeaders.includes('netWeightKg')) {
            newHeaders[unitSizeIdx] = 'netWeightKg';
            updated = true;
          }
        }

        // Add any missing columns from expected headers
        for (const col of headers) {
          if (!newHeaders.includes(col)) {
            newHeaders.push(col);
            updated = true;
          }
        }

        if (updated) {
          await sheet.setHeaderRow(newHeaders);
          console.log(`${title} sheet columns migrated:`, newHeaders);
        }
      }
      return sheet;
    } catch (e) {
      console.error(`Error loading sheet ${title}:`, e);
      return null;
    }
  }

  // --- API Routes ---
  app.get("/api/data", authMiddleware, async (req, res) => {
    const hasId = !!process.env.GOOGLE_SHEET_ID;
    const hasEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const hasKey = !!process.env.GOOGLE_PRIVATE_KEY;

    if (!hasId || !hasEmail || !hasKey) {
      return res.json({ configMissing: true, details: { hasId, hasEmail, hasKey } });
    }

    try {
      await doc.loadInfo();
      // Use skipHeaderCheck=true for bulk loading to save quota
      const customerSheet = await getSheet('Customers', true);
      const productSheet = await getSheet('Products', true);
      const supplySheet = await getSheet('Logistics', true);
      const freightSheet = await getSheet('FreightRates', true);
      const contractSheet = await getSheet('Contracts', true);
      const carrierSheet = await getSheet('Carriers', true);
      const shipmentSheet = await getSheet('Shipments', true);
      const locationSheet = await getSheet('Locations', true);
      const transferSheet = await getSheet('Transfers', true);
      const invoiceSheet = await getSheet('Invoices', true);
      const productGroupSheet = await getSheet('ProductGroups', true);
      const orderSheet = await getSheet('Orders', true);

      const customers = customerSheet ? await customerSheet.getRows() : [];
      const products = productSheet ? await productSheet.getRows() : [];
      const logistics = supplySheet ? await supplySheet.getRows() : [];
      const freightRates = freightSheet ? await freightSheet.getRows() : [];
      const contracts = contractSheet ? await contractSheet.getRows() : [];
      const carriers = carrierSheet ? await carrierSheet.getRows() : [];
      const shipments = shipmentSheet ? await shipmentSheet.getRows() : [];
      const locations = locationSheet ? await locationSheet.getRows() : [];
      const transfers = transferSheet ? await transferSheet.getRows() : [];
      const invoicesData = invoiceSheet ? await invoiceSheet.getRows() : [];
      const productGroups = productGroupSheet ? await productGroupSheet.getRows() : [];
      const ordersData = orderSheet ? await orderSheet.getRows() : [];

      res.json({
        customers: customers.map(r => r.toObject()),
        products: products.map(r => r.toObject()),
        logistics: logistics.map(r => r.toObject()),
        freightRates: freightRates.map(r => r.toObject()),
        contracts: contracts.map(r => r.toObject()),
        carriers: carriers.map(r => r.toObject()),
        shipments: shipments.map(r => r.toObject()),
        locations: locations.map(r => r.toObject()),
        transfers: transfers.map(r => r.toObject()),
        invoices: invoicesData.map(r => r.toObject()),
        productGroups: productGroups.map(r => r.toObject()),
        orders: ordersData.map(r => r.toObject()),
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/market-data", authMiddleware, async (req, res) => {
    const marketSheetId = process.env.MARKET_DATA_SHEET_ID || '1J2pC-TklaqnSJG61943U-D5NQV16dxTtzCo02rfoJtQ';
    const hasEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const hasKey = !!process.env.GOOGLE_PRIVATE_KEY;

    if (!hasEmail || !hasKey) {
      return res.status(500).json({ error: "Server authentication not configured" });
    }

    try {
      const marketDoc = new GoogleSpreadsheet(marketSheetId, jwt);
      await marketDoc.loadInfo();
      const sheet = marketDoc.sheetsByTitle['Data Summary'];
      if (!sheet) {
        return res.status(404).json({ error: "Sheet 'Data Summary' not found in market spreadsheet" });
      }

      const rows = await sheet.getRows();
      res.json({
        data: rows.map(r => r.toObject()),
        lastUpdated: new Date().toISOString()
      });
    } catch (e) {
      console.error("Market Data Fetch Error:", e);
      res.status(500).json({ error: (e as Error).message });
    }
  });


  app.post("/api/sync", authMiddleware, async (req, res) => {
    if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      return res.json({ configMissing: true });
    }

    try {
      // 1. Validate Input
      const validated = SyncRequestSchema.safeParse(req.body);
      if (!validated.success) {
        console.error("Validation Error:", JSON.stringify(validated.error.format(), null, 2));
        return res.status(400).json({ 
          error: "Invalid data format", 
          details: validated.error.format() 
        });
      }

      const { type, data } = validated.data;
      await doc.loadInfo();
      const sheet = await getSheet(type);
      if (!sheet) throw new Error(`Sheet ${type} not found`);

      // 2. Batch Sync Logic
      // To avoid 429 Quota Exceeded, we replace the entire sheet content in two operations
      // instead of updating/deleting row by row.
      
      // First, clear all existing rows (except headers)
      await sheet.clearRows(); 
      
      // Then, add all new rows in a single batch request
      if (data.length > 0) {
        await sheet.addRows(data as any[]);
      }

      res.json({ success: true, updated: true });
    } catch (e) {
      console.error("Sync Error:", e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
