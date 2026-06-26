export interface CommodityConfig {
  rawPriceUsdCwt: number;
  oceanFreightUsdMt: number;
  yieldLossMultiplier: number;
  fxRate: number;
  refiningMarginCadMt: number;
  freightCostTotalCad: number;
  volumeMt: number;
  volumePerLoadMt: number;
  isDelivered: boolean;
  deliveredFreightCadMt: number;
  currency: 'USD' | 'CAD';
  isExport: boolean;
  exportDutyUsdMt: number;
  origin: 'Hamilton' | 'Vancouver';
  destination: string;
  freightType: 'Dry Van' | 'Bulk' | 'Liquid' | 'Bulk Rail' | 'Intermodal' | 'Transload' | '';
  useManualFreight: boolean;
  contractStartDate?: string;
  contractEndDate?: string;
  isPalletCharge: boolean;
  palletCostCadMt: number;
  palletType?: 'CHEP' | 'One Way' | '';
  shippingTerms?: 'FOB' | 'DAP' | 'DDP' | 'FCA' | '';
  paymentTerms?: string; // Payment terms (e.g. "Net 30", "2% / Net 15")
  customerDifferentialCadMt: number; // Customer-specific differential (CAD/MT)
}

export interface SKU {
  id: string;
  productCode?: string; // Uniform 6-digit catalog code (e.g. "000001"). Display value for the Prod No. column.
  name: string; // Product Description (editable)
  productGroup: string;
  category: 'Conventional' | 'Organic';
  netWeight: number;
  brix: number;
  premiumCadMt: number; // Default Differential
  netWeightKg?: number;
  grossWeightKg?: number;
  maxColor: number;
  location: string;
  description?: string;
  sugarType?: string; // e.g., Granulated, Liquid, Icing, Brown, Yellow, Molasses
  productFormat?: string; // Format field (e.g., Bulk, Bagged, Tote, Liquid)
  shortForm?: string; // Auto-calculated: ProductGroupCode + C/B + SugarTypeAbbr
  productLongForm?: string; // Auto-calculated: ProductFormat + SugarType + Conv./Organic + Color
}

export interface ShipToLocation {
  id: string;
  locationCode: string;
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  province?: string;     // Province / State
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  customerNumber?: string;
  defaultLocation: string;  // canonical Location.name — see locations table
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  defaultMargin: number;
  contactEmail?: string;
  contactPhone?: string;
  qaContractEmail?: string;
  salesContactEmail?: string;
  customerServiceEmail?: string;
  notes?: string;
  salespersonId?: string;
  defaultCarrierCode?: string;
  defaultPaymentTerms?: string; // Payment terms (e.g. "Net 30", "2% / Net 15")
  itasCustomerName?: string;
  customerGroupId?: string;
  shipToLocations?: ShipToLocation[];
}

export interface Person {
  id: string;
  name: string;
  email: string;
  phone?: string;
  department: 'sales' | 'operations' | 'logistics' | 'customer service' | 'QA' | 'trading';
  salespersonNumber?: string;
  notes?: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  color: string;
  bolCode: string;
}

export const INITIAL_PRODUCT_GROUPS: ProductGroup[] = [
  { id: 'PG-001', name: 'Bulk', color: '#E4E3E0', bolCode: 'B' },
  { id: 'PG-002', name: 'Bagged', color: '#F5F5F5', bolCode: 'P' },
  { id: 'PG-003', name: 'Tote', color: '#F9F9F9', bolCode: 'T' },
  { id: 'PG-004', name: 'Liquid', color: '#FFFFFF', bolCode: 'L' },
];

export const INITIAL_SKUS: SKU[] = [
  { id: 'PROD-001', name: 'Bulk Fine Granulated 45', productGroup: 'Bulk', category: 'Conventional', netWeight: 1000, brix: 99.9, premiumCadMt: 0, netWeightKg: 1000, maxColor: 45, location: 'Hamilton', description: 'Standard bulk sugar' },
  { id: 'PROD-002', name: '20kg Fine Granulated Bag 45', productGroup: 'Bagged', category: 'Conventional', netWeight: 20, brix: 99.9, premiumCadMt: 130, netWeightKg: 20, maxColor: 45, location: 'Hamilton', description: '20kg industrial bags' },
  { id: 'PROD-003', name: '1,000kg Fine Granulated Totes 45', productGroup: 'Tote', category: 'Conventional', netWeight: 1000, brix: 99.9, premiumCadMt: 75, netWeightKg: 1000, maxColor: 45, location: 'Hamilton', description: 'Large industrial totes' },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  { id: 'CUST-001', name: "Alberta Honey Co Op", defaultLocation: "Hamilton", defaultMargin: 250 },
  { id: 'CUST-002', name: "Cavalier Candies", defaultLocation: "Hamilton", defaultMargin: 250 },
  { id: 'CUST-003', name: "Pacific Blends", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-004', name: "Sunco Foods", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-005', name: "Favorite Foods", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-006', name: "Save On Foods", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-007', name: "Punjab Milk Foods", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-008', name: "Costco", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-009', name: "Royal Ridge", defaultLocation: "Vancouver", defaultMargin: 250 },
  { id: 'CUST-010', name: "FCF Brands", defaultLocation: "Hamilton", defaultMargin: 250 },
  { id: 'CUST-011', name: "BCC", defaultLocation: "Vancouver", defaultMargin: 250 }
];

export interface SupplyChainComponent {
  id: string;
  component: string;
  provider: string;
  totalCostCad: number;
  weightPerLoadMt: number;
}

export interface FreightRate {
  id: string;
  origin: string;
  destination: string;
  provider: string;
  cost: number;
  freightType: 'Dry Van' | 'Bulk' | 'Liquid' | 'Bulk Rail' | 'Intermodal' | 'Transload';
  mtPerLoad: number;
  startDate?: string;
  endDate?: string;
}

export interface FuelSurcharge {
  id: string;
  carrierCode: string;
  carrier: string;
  surchargePercent: number;
  startDate: string;
  endDate: string;
}

export const INITIAL_FUEL_SURCHARGES: FuelSurcharge[] = [];

/** A tolling (refining) fee per metric tonne, set per product group + location. */
export interface TollingFee {
  id: string;
  productGroup: string;   // Product Group name (from the Product Groups table)
  location: string;       // Location name (from the Locations table)
  amountPerMt: number;    // Tolling fee amount per MT
  currency: string;       // e.g. "CAD", "USD"
  startDate?: string;     // ISO yyyy-mm-dd — fee effective from
  endDate?: string;       // ISO yyyy-mm-dd — fee effective to
}

export const INITIAL_TOLLING_FEES: TollingFee[] = [];

export interface Contract {
  id: string;
  contractNumber: string;
  customerNumber: string;
  customerName: string;
  contractVolume: number;
  volumeTaken: number;
  volumeOutstanding: number;
  startDate: string;
  endDate: string;
  skuName: string;
  origin: string;
  destination: string;
  finalPrice: number;
  currency: string;
  notes?: string;
  shippingTerms?: string;
  fxRate?: number;
  rawPriceUsdMt?: number;
  deliveredFreight?: number;
  exportDuty?: number;
  palletCharge?: number;
  paymentTerms?: string; // Payment terms (e.g. "Net 30", "2% / Net 15")
  palletType?: 'CHEP' | 'One Way' | '';
  margin?: number; // Margin in CAD/MT
  active?: boolean; // Contract active status (defaults to true)
  contractLines?: ContractLine[]; // Product-specific lines with differentials
  contractDate?: string; // ISO date the contract was signed/created (display + CSV)
  itasName?: string; // ITAS-system customer name, mirrored onto the contract for CSV portability
}

export interface ContractLine {
  id: string;
  productName: string;
  differentialCadMt: number; // Product-specific differential (CAD/MT)
  finalPriceMt: number; // Bulk price + differential = line-specific final price
}

export interface Shipment {
  id: string;
  week: string;
  date: string;
  day: string;
  time: string;
  bay: string;
  customer: string;
  product: string;
  contractNumber?: string;
  po: string;
  bol: string;
  qty: number;
  carrier: string;
  arrive: string;
  start: string;
  out: string;
  status: string;
  notes?: string;
  color?: string;
  scaledQty?: number;
  trailerNo?: string;
  colour?: string;
  lotNumber?: string;
  lotNumbers?: string[];
  deliveryDate?: string;
  sealNumbers?: string[];
  originOfGoods?: string;
  location?: string;
}

export interface Location {
  id: string;
  locationCode: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  bays: string[];
  active?: boolean; // Whether this location is shown in the location dropdowns across the app. Defaults to true when undefined.
  appointmentStartTime?: string;  // e.g. '00:00'
  appointmentEndTime?: string;    // e.g. '22:30'
  appointmentDuration?: number;   // minutes per appointment slot (e.g. 90)
  // GFSI Audit
  gfsiAuditStartDate?: string;
  gfsiAuditEndDate?: string;
  gfsiAuditCertifier?: string;
  gfsiAuditReport?: QADocument;
  gfsiAuditCertificate?: QADocument;
  // Organic Audit
  organicAuditStartDate?: string;
  organicAuditEndDate?: string;
  organicAuditCertifier?: string;
  organicAuditReport?: QADocument;
  organicAuditCertificate?: QADocument;
}

export const INITIAL_LOCATIONS: Location[] = [
  {
    id: 'LOC-001',
    locationCode: '100',
    name: 'Hamilton',
    address: '123 Ferguson Ave.',
    city: 'Hamilton',
    province: 'ON',
    postalCode: 'L8L 1L1',
    bays: ['BAY 1 (W) - FERGUSON AVE.', 'BAY 2 (E) - FERGUSON AVE.'],
    appointmentStartTime: '00:00',
    appointmentEndTime: '22:30',
    appointmentDuration: 90
  },
  {
    id: 'LOC-002',
    locationCode: '200',
    name: 'Vancouver',
    address: '456 Port Road',
    city: 'Vancouver',
    province: 'BC',
    postalCode: 'V6B 1A1',
    bays: ['BAY 1', 'BAY 2'],
    appointmentStartTime: '06:00',
    appointmentEndTime: '18:00',
    appointmentDuration: 30
  }
];

export interface Carrier {
  id: string;
  carrierNumber: string;
  name: string;
  contactEmail?: string;      // primary email (kept for PDFs / legacy; = contactEmails[0])
  contactEmails?: string[];   // all of the carrier's email addresses
  contactPhone?: string;
  notes?: string;
  defaultLocationCode?: string;
}

export interface TransferLeg {
  id: string;
  legNumber: number;
  from: string;
  to: string;
  carrier: string;
  amount: number; // MT for this leg
  shipmentDate?: string;
  arrivalDate?: string;
  status?: string;
  notes?: string;
}

export interface Transfer {
  id: string;
  transferNumber: string;
  from: string;
  to: string;
  shipmentDate: string;
  arrivalDate: string;
  carrier: string;
  product: string;
  amount: number;
  po?: string;
  lotCode?: string;
  notes?: string;
  status: string;
  legs?: TransferLeg[];
}

export interface Invoice {
  id: string;
  invoiceNumber?: string;
  bolNumber: string;
  customer: string;
  product: string;
  po: string;
  qty: number;
  carrier: string;
  amount: number;
  pricePerMt?: number; // Price per metric ton — amount = pricePerMt × qty
  shipmentId: string;
  date: string;
  status: string;
  splitNo?: string;
  dueDate?: string; // Calculated from date + customer payment terms
  lineItems?: OrderLineItem[]; // Line item details from the linked order
  shippingTerms?: string;
  location?: string;
  contractNumber?: string;
  papsNo?: string;          // PAPS number (cross-border customs pre-arrival)
  customsEntryNo?: string;  // Customs entry number
}

export interface OrderLineItem {
  id: string;
  productName: string;
  productDisplayName?: string; // Rendered Product Name captured at selection time so the line shows what the user picked even when several QA products share a SKU name
  productKey?: string; // QA product id (or SKU id for unpaired SKUs) — uniquely identifies the chosen catalog variant so display logic can render the correct shortform when multiple QAs share an SKU name
  qty: number;
  contractNumber: string;
  netWeightPerUnit: number;
  totalWeight: number;
  unitAmount?: number;
  mtAmount?: number;
  lineAmount?: number;
}

export interface Order {
  id: string;
  bolNumber: string;
  customer: string;
  product: string;
  contractNumber?: string;
  po: string;
  date: string;
  shipmentDate?: string;
  pickupTime?: string;     // requested pick-up/load time (HH:MM) — pre-fills the appointment
  deliveryDate?: string;
  status: 'Open' | 'Confirmed' | 'Cancelled' | 'Completed';
  lineItems: OrderLineItem[];
  amount: number;
  carrier?: string;
  shippingTerms?: 'FOB' | 'DAP' | 'DDP' | 'FCA' | '';
  location?: string;       // shipping origin from contract
  splitNumber?: string;    // user-entered split number
  currency?: string;       // currency from CSV or contract (e.g. "CAD", "USD")
  palletType?: 'CHEP' | 'One Way' | ''; // from contract
  hidden?: boolean;        // hide instead of delete for confirmed orders (BOL permanently reserved)
  shipToLocationId?: string; // references ShipToLocation.id under the order's customer
  papsNo?: string;          // PAPS number (cross-border customs pre-arrival)
  customsEntryNo?: string;  // Customs entry number
}

/** One row in the Email Center's PO-import dashboard. Written by the app each
 *  time it ingests an emailed PO (from the Gmail inbox scan queue) into an order. */
export interface PoImportLogEntry {
  id: string;
  importedAt: string;          // ISO — when the app turned the queued PO into an order
  receivedAt?: string;         // ISO — when the email arrived (from the cron)
  fromEmail?: string;          // sender of the PO email
  subject?: string;            // email subject
  sourceFile?: string;         // attachment filename the PO was read from
  poNumber?: string;
  customer?: string;
  orderId?: string;            // id of the created order (when result === 'created')
  orderBol?: string;           // BOL of the created order
  amount?: number;             // order amount
  productSummary?: string;     // products on the order
  result: 'created' | 'duplicate' | 'skipped' | 'updated';
  note?: string;               // reason when duplicate / skipped / updated
}

/** An emailed PO awaiting operator review/approval. The Gmail scan extracts it
 *  and the app queues it here INSTEAD of auto-creating an order; the operator
 *  reviews + corrects it in the scan modal, then approves (creates the order)
 *  or dismisses it from the Email Center. */
export interface PoPendingImport {
  id: string;
  createdAt: string;           // ISO — when queued for review
  sourceEmailId?: string;      // Gmail message id (links to the inbox-feed email)
  receivedAt?: string;         // email date
  fromEmail?: string;
  subject?: string;
  sourceFile?: string;         // attachment name or "(email body)"
  poNumber?: string;
  customer?: string;           // extracted buyer name (for the table)
  extraction: any;             // ExtractedPO-shaped payload fed into the review modal
}

/** One email in the read-only inbox feed (rolling ~7-day window), written by the
 *  Gmail scan so operators can read + triage the PO inbox inside SweetPro without
 *  opening Gmail. READ-ONLY: the app never modifies the real mailbox. */
export interface InboxFeedItem {
  id: string;                  // Gmail message id
  receivedAt: string;          // ISO
  internalDateMs?: number;     // epoch ms (for pruning / sorting)
  fromName?: string;
  fromEmail?: string;
  subject?: string;
  snippet?: string;            // Gmail one-line preview
  body?: string;               // plain-text body, capped (the in-app viewer content)
  hasAttachments?: boolean;
  attachments?: { filename: string; mimeType: string }[];
  /** AI suggestion for order-related mail; 'none' for everything else. */
  suggestion?: 'new_po' | 'amendment' | 'cancellation' | 'none';
  /** Sender bucket: customer (buyer), internal (Sucro employee) or logistics
   *  (a known carrier). Internal/logistics senders never get a new_po suggestion. */
  senderCategory?: 'customer' | 'internal' | 'logistics';
  poNumber?: string;           // referenced PO when order-related
  customer?: string;           // buyer identified from participant domains/signatures
  carrier?: string;            // freight carrier identified from participants/body
}

/** Operator triage state for an inbox-feed email (client-owned, synced). Absence
 *  of an entry means the email is still "open" in the feed. */
export interface InboxTriage {
  id: string;                  // Gmail message id (matches InboxFeedItem.id)
  status: 'handled' | 'dismissed';
  updatedAt: string;
}

/** A change to an existing order detected from an emailed amendment/cancellation,
 *  held in a review queue (Email Center) until the operator applies or dismisses it. */
export interface PoAmendment {
  id: string;
  createdAt: string;           // ISO — when the amendment was queued for review
  receivedAt?: string;         // email date
  fromEmail?: string;
  subject?: string;
  sourceFile?: string;         // attachment name or "(email body)"
  poNumber?: string;           // the existing PO being amended
  customer?: string;
  orderId?: string;            // matched order (absent when status === 'unmatched')
  orderBol?: string;
  kind: 'amendment' | 'cancellation';
  // Requested change (only the fields that change are set):
  newShipmentDate?: string;
  newDeliveryDate?: string;
  newQuantityMt?: number;
  newSplitNumber?: string;     // split # from an internal / "Stock Request" email
  cancel?: boolean;
  summary?: string;            // model's one-line description
  // Before-values captured at match time, for the review diff:
  prevShipmentDate?: string;
  prevDeliveryDate?: string;
  prevQuantityMt?: number;
  prevSplitNumber?: string;
  prevStatus?: string;
  status: 'pending' | 'applied' | 'dismissed' | 'unmatched';
  appliedAt?: string;
}

/* ====================================================================== */
/* Return Orders — track product being returned after it has shipped.     */
/* Mirrors the Order shape so the existing UI patterns translate.         */
/* BOL numbers always start with "R" followed by 6 digits (R000001+).     */
/* ====================================================================== */
export interface ReturnOrder {
  id: string;
  /** Return BOL number: "R000123". Generated server-side on save. */
  bolNumber: string;
  /** BOL of the original outbound shipment this return is against. */
  originalBolNumber: string;
  /** Link to the invoice the line items / pricing came from. */
  originalInvoiceId?: string;
  customer: string;
  product: string;
  contractNumber?: string;
  po: string;
  /** ISO yyyy-mm-dd; when the return order was created. */
  date: string;
  /** ISO date when the product is expected to ship back. */
  shipmentDate?: string;
  /** ISO date the goods are expected to arrive at the return location. */
  deliveryDate?: string;
  /** Statuses mirror Order so the order detail card can render either type. */
  status: 'Open' | 'Confirmed' | 'Cancelled' | 'Completed';
  /** Line items copied from the source invoice / order. */
  lineItems: OrderLineItem[];
  /** Credit amount (positive number; sign-flip happens at invoice creation). */
  amount: number;
  carrier?: string;
  shippingTerms?: 'FOB' | 'DAP' | 'DDP' | 'FCA' | '';
  location?: string;
  splitNumber?: string;
  currency?: string;
  palletType?: 'CHEP' | 'One Way' | '';
  hidden?: boolean;
  shipToLocationId?: string;
  /** Free-text reason — required when the return order is created. */
  reasonForReturn: string;
}

export const INITIAL_CARRIERS: Carrier[] = [
  { id: 'CARR-001', carrierNumber: '1001', name: 'FastTruck', contactEmail: 'ops@fasttruck.com', contactPhone: '555-0101', defaultLocationCode: '100' },
  { id: 'CARR-002', carrierNumber: '1002', name: 'WestLogistics', contactEmail: 'dispatch@westlog.com', contactPhone: '555-0102', defaultLocationCode: '200' },
  { id: 'CARR-003', carrierNumber: '1003', name: 'Maersk', contactEmail: 'support@maersk.com', contactPhone: '555-0103', defaultLocationCode: '200' },
];

/** A user-managed shipping-terms entry (e.g. FOB, DAP, FCA, custom names).
 *  Populates the Shipping Terms dropdown on the Customer Quote page and
 *  lives in its own table on the Supply Chain page. */
export interface ShippingTerm {
  id: string;
  name: string;        // short code, e.g. "FCA"
  description: string; // free-text description shown next to the dropdown
}

export const INITIAL_SHIPPING_TERMS: ShippingTerm[] = [
  { id: 'ST-001', name: 'FOB', description: 'Free On Board — seller delivers to port; buyer takes on freight + risk' },
  { id: 'ST-002', name: 'DAP', description: 'Delivered At Place — seller pays freight; buyer handles import duties' },
  { id: 'ST-003', name: 'DDP', description: 'Delivered Duty Paid — seller pays freight + import duties' },
  { id: 'ST-004', name: 'FCA', description: 'Free Carrier — seller delivers to carrier at named place' },
];

/* ====================================================================== */
/* Email Center — outbound transactional emails (order confirmations, BOLs */
/* COAs, invoices) + their audit log. Powered by Resend.                  */
/* ====================================================================== */

export type EmailDocumentType = 'order_confirmation' | 'bol' | 'coa' | 'invoice' | 'return_order_confirmation';
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'bounced';

export interface EmailLog {
  id: string;
  type: EmailDocumentType;
  /** Source record this email is about (one of these will be set). */
  orderId?: string;
  shipmentId?: string;
  invoiceId?: string;
  /** Snapshot of intended recipient + the actual recipient when test-mode is on. */
  customerName: string;
  recipientTo: string[];
  recipientCc?: string[];
  actualRecipientTo: string[]; // What was actually sent — differs from recipientTo when test-mode reroutes
  subject: string;
  attachmentFilename?: string;
  attachmentSizeBytes?: number;
  status: EmailStatus;
  providerMessageId?: string; // Resend's message id
  error?: string;
  /** Stable key — e.g. "order_confirmation:ORD-123" — prevents double sends. */
  idempotencyKey: string;
  attemptCount: number;
  testMode: boolean; // Was this send routed through test mode?
  triggeredBy: 'automation' | 'manual' | 'retry';
  triggeredByUser?: string;
  createdAt: string;
  sentAt?: string;
}

export interface EmailSettings {
  id: string; // always "settings" (single-doc collection)
  /** Master kill switch — when false, no sends happen at all. */
  enabled: boolean;
  /** When true, every send is rerouted to testAddress with [TEST] subject prefix. */
  testMode: boolean;
  testAddress: string;
  /** Display name shown in From header, e.g. "Sucro Canada Sales". */
  fromName: string;
  /** Defaults pulled from server env when blank. */
  fromAddress?: string;
  replyToAddress?: string;
  /** Always BCC these on every send (internal audit trail). */
  internalCc: string[];
  /** When true, emailed POs above autoApproveMinConfidence whose customer
   *  matches a known customer are auto-created as Open orders, bypassing the
   *  review queue. Off by default — operator opts in once they trust the scan. */
  autoApproveEmailedPos?: boolean;
  /** Minimum extraction confidence (0..1) required to auto-approve. Default 0.85. */
  autoApproveMinConfidence?: number;
  /** Per-event auto-send toggles. Off by default — operator turns each on
   *  from the Email Center once they're comfortable with the test sends. */
  triggers: {
    orderConfirmationOnConfirmed: boolean;
    /** BOL emailed when the linked order is Completed & Billed. */
    bolOnCompletedAndBilled: boolean;
    /** Certificate of Analysis emailed when the linked order is Completed
     *  & Billed. Lot codes from the shipment drive the spec values. */
    coaOnCompletedAndBilled: boolean;
    invoiceOnBilled: boolean;
  };
}

export const INITIAL_EMAIL_SETTINGS: EmailSettings = {
  id: 'settings',
  enabled: true,
  testMode: true,
  testAddress: '', // user fills in via Email Center UI
  fromName: 'Sucro Canada',
  fromAddress: '', // server fills from env when blank
  replyToAddress: '',
  internalCc: [],
  autoApproveEmailedPos: false,
  autoApproveMinConfidence: 0.85,
  triggers: {
    orderConfirmationOnConfirmed: false,
    bolOnCompletedAndBilled: false,
    coaOnCompletedAndBilled: false,
    invoiceOnBilled: false,
  },
};

export const INITIAL_SUPPLY_CHAIN: SupplyChainComponent[] = [
  { id: 'SC-001', component: 'Ocean Freight', provider: 'Maersk', totalCostCad: 4500, weightPerLoadMt: 22 },
  { id: 'SC-002', component: 'Port Handling', provider: 'Port of Vancouver', totalCostCad: 850, weightPerLoadMt: 22 },
  { id: 'SC-003', component: 'Transloading', provider: 'Vancouver Transloading', totalCostCad: 1200, weightPerLoadMt: 22 },
  { id: 'SC-004', component: 'Last Mile Delivery', provider: 'Local Trucking', totalCostCad: 650, weightPerLoadMt: 22 },
];

export const INITIAL_FREIGHT_RATES: FreightRate[] = [
  { id: 'FR-001', origin: 'Hamilton', destination: 'Toronto', provider: 'FastTruck', cost: 850, freightType: 'Dry Van', mtPerLoad: 22 },
  { id: 'FR-002', origin: 'Hamilton', destination: 'Montreal', provider: 'FastTruck', cost: 1200, freightType: 'Dry Van', mtPerLoad: 22 },
  { id: 'FR-003', origin: 'Vancouver', destination: 'Calgary', provider: 'WestLogistics', cost: 2500, freightType: 'Bulk', mtPerLoad: 28 },
  { id: 'FR-004', origin: 'Vancouver', destination: 'Edmonton', provider: 'WestLogistics', cost: 2800, freightType: 'Bulk', mtPerLoad: 28 },
];

export const INITIAL_CONTRACTS: Contract[] = [
  {
    id: 'CON-001',
    contractNumber: '2024-001',
    customerNumber: 'CUST-001',
    customerName: 'Alberta Honey Co Op',
    contractVolume: 500,
    volumeTaken: 0,
    volumeOutstanding: 500,
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    skuName: 'Bulk Fine Granulated',
    origin: 'Hamilton',
    destination: 'Calgary',
    finalPrice: 1250.50,
    currency: 'CAD'
  }
];

export const INITIAL_TRANSFERS: Transfer[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_ORDERS: Order[] = [];

export interface ConferenceAttendee {
  id: string;
  personId: string; // References Person.id from People table
  name: string;
  email: string;
  phone?: string;
}

export interface CustomerAttendeeDetail {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface MeetingFollowUp {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

export interface ConferenceMeeting {
  id: string;
  conferenceId: string;
  date: string; // Conference date (YYYY-MM-DD)
  time: string;
  meetingName: string;
  meetingOwner?: string; // Person ID of the sales employee responsible
  attendees: string[]; // Array of Person IDs (sales employees)
  customerAttendees: string[]; // Legacy: Array of customer IDs
  customerAttendeeDetails: CustomerAttendeeDetail[]; // New: typed customer attendee entries
  location: string;
  notes?: string;
  customerId?: string;
  followUps: MeetingFollowUp[];
}

export interface Conference {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  location: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  attendees: ConferenceAttendee[];
  meetings: ConferenceMeeting[];
  createdAt?: string;
  status?: 'Planned' | 'In Progress' | 'Completed';
}

export const INITIAL_CONFERENCES: Conference[] = [];

export const INITIAL_PEOPLE: Person[] = [
  { id: 'PERSON-001', name: 'John Smith', email: 'john.smith@sucrosourcing.com', phone: '555-0101', department: 'sales', salespersonNumber: 'SP-001' },
  { id: 'PERSON-002', name: 'Sarah Johnson', email: 'sarah.johnson@sucrosourcing.com', phone: '555-0102', department: 'sales', salespersonNumber: 'SP-002' },
  { id: 'PERSON-003', name: 'Mike Chen', email: 'mike.chen@sucrosourcing.com', phone: '555-0103', department: 'operations' },
  { id: 'PERSON-004', name: 'Lisa Brown', email: 'lisa.brown@sucrosourcing.com', phone: '555-0104', department: 'logistics' },
  { id: 'PERSON-005', name: 'David Wilson', email: 'david.wilson@sucrosourcing.com', phone: '555-0105', department: 'customer service' },
];

export interface QASpecifications {
  brix: string;
  granulation: string;
  color: string;
  ash: string;
  turbidity: string;
  moisture: string;
}

export interface ArtworkApproval {
  id: string;
  artworkUrl: string;
  artworkFilename: string;
  sentTo: string;
  sentToName: string;
  sentAt: string;
  status: 'pending' | 'approved' | 'rejected';
  respondedAt?: string;
  notes?: string;
}

export interface QADocument {
  id: string;
  url: string;
  filename: string;
  uploadedAt: string;
}

export interface BOMItem {
  id: string;
  materialName: string;
  materialCode?: string;
  category: 'Raw Material' | 'Packaging' | 'Label' | 'Additive' | 'Other';
  quantity: number;
  unit: 'kg' | 'g' | 'pcs' | 'rolls' | 'sheets' | 'liters' | 'ml';
  supplier?: string;
  costPerUnit?: number;
  currency?: 'CAD' | 'USD';
  shrinkage?: number; // % material loss during production
  notes?: string;
}

export interface QAProduct {
  id: string;
  productCode?: string; // Uniform 6-digit catalog code; mirrors the matching SKU.productCode
  skuId: string;
  skuName: string;
  productGroup: string;
  category: 'Conventional' | 'Organic';
  location: string;
  netWeightKg?: number;
  grossWeightKg?: number;
  maxColor: number;
  approverQAId?: string;
  approverSalesId?: string;
  approverOperationsId?: string;
  specifications: QASpecifications;
  packagingSupplier: string;
  packagingPictureUrls: string[];
  packagingPictureFilenames: string[];
  artworkUrl?: string;
  artworkFilename?: string;
  artworkApprovals: ArtworkApproval[];
  upcCode: string;
  upcImageUrl?: string;
  upcImageFilename?: string;
  ti?: number;
  hi?: number;
  unitsPerPallet?: number;
  specSheets: QADocument[];
  certificates: QADocument[];
  pol?: string; // Port of Loading
  billOfMaterials?: BOMItem[];
  sugarType?: string; // e.g. Granulated, Liquid, Icing, Brown, Yellow
  productFormat?: string; // Format field (e.g. Bulk, Bagged, Tote, Liquid)
  // Packaging hierarchy — only meaningful when productGroup === 'Packaged'.
  // A selling unit is what the end-customer buys (e.g. a 1 kg retail bag);
  // a case pack groups multiple selling units for shipping (e.g. 12 × 1 kg = 12 kg case).
  casePackQuantity?: number;   // selling units per case
  casePackKg?: number;         // total kg per case pack
  sellingUnitQuantity?: number; // selling units per shippable unit (carton / bundle)
  sellingUnitKg?: number;      // kg per selling unit
}

export const INITIAL_QA_PRODUCTS: QAProduct[] = [];

export interface SugarType {
  id: string;
  name: string;
  abbreviation: string;
}

export const INITIAL_SUGAR_TYPES: SugarType[] = [
  { id: 'ST-001', name: 'Granulated', abbreviation: 'GC' },
  { id: 'ST-002', name: 'Liquid', abbreviation: 'LC' },
  { id: 'ST-003', name: 'Icing', abbreviation: 'IC' },
  { id: 'ST-004', name: 'Brown', abbreviation: 'BR' },
  { id: 'ST-005', name: 'Yellow', abbreviation: 'YW' },
  { id: 'ST-006', name: 'Molasses', abbreviation: 'ML' },
];

export interface PackagingFormat {
  id: string;
  name: string;
  code: string; // short identifier (e.g. "BAG", "TOT", "BLK")
  description: string;
  packagingLine: string;
  location: string;
}

export const INITIAL_PACKAGING_FORMATS: PackagingFormat[] = [];

export interface FormulaToken {
  id: string;
  type: 'field' | 'literal' | 'productGroup' | 'productGroupCode' | 'sugarType' | 'sugarTypeAbbr';
  value: string;   // Field key (e.g., 'productFormat'), literal text, or specific value (e.g., 'Bulk')
  label: string;   // Display label in the builder
}

export interface NamingFormula {
  id: string;
  type: 'Product Name' | 'Short Form';
  name: string;
  condition: string; // e.g., "Default", "Product Group = Bulk", "Sugar Type = Molasses"
  formula: string;   // Display string e.g., "{NetWeight}kg {SugarAbbr}{C/B}{MaxColor}"
  tokens?: FormulaToken[]; // Structured tokens (preferred over formula string when present)
  description?: string;
  priority: number;  // Lower = applied first
}

export const INITIAL_NAMING_FORMULAS: NamingFormula[] = [
  {
    id: 'NF-001',
    type: 'Product Name',
    name: 'Default Product Name',
    condition: 'Default',
    formula: '{Net Weight (KG)}kg {Product Format} {Sugar Type} {Conv./Organic} {Max Color}',
    tokens: [
      { id: 't1', type: 'field', value: 'netWeightKg', label: 'Net Weight (KG)' },
      { id: 't2', type: 'literal', value: 'kg ', label: '"kg "' },
      { id: 't3', type: 'field', value: 'productFormat', label: 'Product Format' },
      { id: 't4', type: 'literal', value: ' ', label: '" "' },
      { id: 't5', type: 'field', value: 'sugarType', label: 'Sugar Type' },
      { id: 't6', type: 'literal', value: ' ', label: '" "' },
      { id: 't7', type: 'field', value: 'category', label: 'Conv./Organic' },
      { id: 't8', type: 'literal', value: ' ', label: '" "' },
      { id: 't9', type: 'field', value: 'maxColor', label: 'Max Color' },
    ],
    description: 'Standard product name with weight, packaging, sugar type, category and color',
    priority: 10,
  },
  {
    id: 'NF-002',
    type: 'Short Form',
    name: 'Default Short Form',
    condition: 'Default',
    formula: '{Net Weight (KG)}kg {Sugar Type Abbr}{C/B}{Max Color}',
    tokens: [
      { id: 't1', type: 'field', value: 'netWeightKg', label: 'Net Weight (KG)' },
      { id: 't2', type: 'literal', value: 'kg ', label: '"kg "' },
      { id: 't3', type: 'field', value: 'sugarTypeAbbreviation', label: 'Sugar Type Abbreviation' },
      { id: 't4', type: 'field', value: 'coChar', label: 'C/B Character' },
      { id: 't5', type: 'field', value: 'maxColor', label: 'Max Color' },
    ],
    description: 'Standard short form with weight prefix',
    priority: 30,
  },
  {
    id: 'NF-003',
    type: 'Short Form',
    name: 'Bulk Short Form',
    condition: 'Product Group = Bulk',
    formula: '{Sugar Type Abbr}{C/B}{Max Color}',
    tokens: [
      { id: 't1', type: 'field', value: 'sugarTypeAbbreviation', label: 'Sugar Type Abbreviation' },
      { id: 't2', type: 'field', value: 'coChar', label: 'C/B Character' },
      { id: 't3', type: 'field', value: 'maxColor', label: 'Max Color' },
    ],
    description: 'Bulk products omit the weight prefix',
    priority: 20,
  },
  {
    id: 'NF-004',
    type: 'Short Form',
    name: 'Molasses Short Form',
    condition: 'Sugar Type = Molasses',
    formula: 'MOL',
    tokens: [
      { id: 't1', type: 'literal', value: 'MOL', label: '"MOL"' },
    ],
    description: 'Molasses products use the fixed short form "MOL"',
    priority: 10,
  },
];

export interface LotCode {
  id: string;
  lotNumber: string;
  tankNumber: string;
  date: string;
  julianDate: string;
  category: 'Conventional' | 'Organic' | '';
  productGroup: string;
  silo: 'North' | 'South' | '';
  brix: string;
  ph: string;
  color: string;
  temperature: string;
  invert: string;
  ash: string;
  moisture: string;
  flavourOdourOk: 'Yes' | 'No' | '';
  testerId: string;
  testerName: string;
  notes: string;
  weeklyVerification: string;
  sugarType: string;
  countryOfOrigin: string;
  bolNumber: string;
  customerPo: string;
  createdAt: string;
}

export const INITIAL_LOT_CODES: LotCode[] = [];

export interface Vendor {
  id: string;
  vendorNumber: string;
  name: string;
  category: string; // same categories as Person.department
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  paymentTerms?: string; // Payment terms (e.g. "Net 30", "2% / Net 15")
}

export const INITIAL_VENDORS: Vendor[] = [];

export interface ChepPalletMovement {
  id: string;
  date: string;
  location: string;
  type: 'in' | 'out';
  quantity: number;
  reference: string;
  notes?: string;
}

export const INITIAL_CHEP_PALLET_MOVEMENTS: ChepPalletMovement[] = [];

export interface SalesLeadFollowUp {
  id: string;
  date: string;
  description: string;
  infoSent: string;
  completed: boolean;
}

export interface SalesLead {
  id: string;
  customerName: string;
  product: string;
  volume: number;
  location: string;
  salespersonId: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  status: 'New' | 'In Progress' | 'Qualified' | 'Closed Won' | 'Closed Lost';
  followUps: SalesLeadFollowUp[];
  createdAt: string;
  source?: string;
}

export const INITIAL_SALES_LEADS: SalesLead[] = [];

export interface SampleRequestFollowUp {
  id: string;
  date: string;
  description: string;
  completed: boolean;
}

export interface SampleRequest {
  id: string;
  customer: string;
  shipmentDate: string;
  sampleProduct: string;
  location: string;
  salespersonId: string;
  notes?: string;
  status: 'Pending' | 'Shipped' | 'Delivered' | 'Cancelled';
  followUps: SampleRequestFollowUp[];
  createdAt: string;
}

export const INITIAL_SAMPLE_REQUESTS: SampleRequest[] = [];

export interface QATemplate {
  id: string;
  name: string;
  type: 'Bill of Lading' | 'Certificate of Analysis' | 'Packing List' | 'Order Confirmation' | 'Return Order Confirmation' | 'Other';
  googleSheetUrl: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export const INITIAL_QA_TEMPLATES: QATemplate[] = [];

// ── Fiscal Year / Finance ──

export interface FiscalPeriod {
  id: string;
  periodNumber: number; // 1-12
  name: string;         // e.g. "Period 1", "January"
  startDate: string;
  endDate: string;
}

export interface FiscalQuarter {
  id: string;
  quarterNumber: number; // 1-4
  name: string;          // e.g. "Q1"
  startDate: string;
  endDate: string;
  budgetLockDate: string;
}

export interface FiscalYear {
  id: string;
  name: string;          // e.g. "FY 2026"
  startDate: string;
  endDate: string;
  budgetLockDate: string;
  quarters: FiscalQuarter[];
  periods: FiscalPeriod[];
}

export const INITIAL_FISCAL_YEARS: FiscalYear[] = [];

// ── Sales Forecast ──

export interface ForecastEntry {
  periodIndex: number;  // 0-11 for monthly, 0-51 for weekly
  value: number;        // MT
}

export interface CustomerForecastLine {
  id: string;
  productName: string;
  location: string;
  entries: ForecastEntry[];
}

export interface CustomerForecast {
  id: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  location: string;
  fiscalYearId: string;
  type: 'Forecast' | 'Budget';
  viewMode: 'Monthly' | 'Weekly';
  lines: CustomerForecastLine[];
  annualForecast: number;  // sum of all line entries
}

export const INITIAL_CUSTOMER_FORECASTS: CustomerForecast[] = [];

// ── Customer Groups ──

export interface CustomerGroup {
  id: string;
  groupCode: string;
  name: string;
  notes?: string;
}

export const INITIAL_CUSTOMER_GROUPS: CustomerGroup[] = [];
