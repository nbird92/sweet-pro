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
}

export interface SKU {
  id: string;
  name: string;
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
}

export interface Customer {
  id: string;
  name: string;
  customerNumber?: string;
  defaultLocation: 'Hamilton' | 'Vancouver';
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
  deliveryDate?: string;
  sealNumbers?: string[];
  originOfGoods?: string;
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
  contactEmail?: string;
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
  lotCode?: string;
  notes?: string;
  status: string;
  legs?: TransferLeg[];
}

export interface Invoice {
  id: string;
  bolNumber: string;
  customer: string;
  product: string;
  po: string;
  qty: number;
  carrier: string;
  amount: number;
  shipmentId: string;
  date: string;
  status: string;
  splitNo?: string;
  dueDate?: string; // Calculated from date + customer payment terms
  lineItems?: OrderLineItem[]; // Line item details from the linked order
  shippingTerms?: string;
  location?: string;
  contractNumber?: string;
}

export interface OrderLineItem {
  id: string;
  productName: string;
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
  deliveryDate?: string;
  status: 'Open' | 'Confirmed' | 'Cancelled';
  lineItems: OrderLineItem[];
  amount: number;
  carrier?: string;
  shippingTerms?: 'FOB' | 'DAP' | 'DDP' | 'FCA' | '';
  location?: string;       // shipping origin from contract
  splitNumber?: string;    // user-entered split number
  palletType?: 'CHEP' | 'One Way' | ''; // from contract
  hidden?: boolean;        // hide instead of delete for confirmed orders (BOL permanently reserved)
}

export const INITIAL_CARRIERS: Carrier[] = [
  { id: 'CARR-001', carrierNumber: '1001', name: 'FastTruck', contactEmail: 'ops@fasttruck.com', contactPhone: '555-0101', defaultLocationCode: '100' },
  { id: 'CARR-002', carrierNumber: '1002', name: 'WestLogistics', contactEmail: 'dispatch@westlog.com', contactPhone: '555-0102', defaultLocationCode: '200' },
  { id: 'CARR-003', carrierNumber: '1003', name: 'Maersk', contactEmail: 'support@maersk.com', contactPhone: '555-0103', defaultLocationCode: '200' },
];

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
  notes?: string;
}

export interface QAProduct {
  id: string;
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
}

export const INITIAL_QA_PRODUCTS: QAProduct[] = [];

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

export interface QATemplate {
  id: string;
  name: string;
  type: 'Bill of Lading' | 'Certificate of Analysis' | 'Packing List' | 'Order Confirmation' | 'Other';
  googleSheetUrl: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export const INITIAL_QA_TEMPLATES: QATemplate[] = [];
