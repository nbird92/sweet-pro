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
  contractStartDate?: string;
  contractEndDate?: string;
  isPalletCharge: boolean;
  palletCostCadMt: number;
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
  location: 'Hamilton' | 'Vancouver';
  description?: string;
}

export interface Customer {
  id: string;
  name: string;
  defaultLocation: 'Hamilton' | 'Vancouver';
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  defaultMargin: number;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  salespersonId?: string;
  defaultCarrierCode?: string;
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
}

export const INITIAL_PRODUCT_GROUPS: ProductGroup[] = [
  { id: 'PG-001', name: 'Bulk', color: '#E4E3E0' },
  { id: 'PG-002', name: 'Bagged', color: '#F5F5F5' },
  { id: 'PG-003', name: 'Tote', color: '#F9F9F9' },
  { id: 'PG-004', name: 'Liquid', color: '#FFFFFF' },
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
  freightType: 'Dry Van' | 'Bulk' | 'Liquid' | 'Bulk Rail' | 'Intermodal';
  mtPerLoad: number;
}

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
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  bays: string[];
}

export const INITIAL_LOCATIONS: Location[] = [
  {
    id: 'LOC-001',
    name: 'Hamilton',
    address: '123 Ferguson Ave.',
    city: 'Hamilton',
    province: 'ON',
    postalCode: 'L8L 1L1',
    bays: ['BAY 1 (W) - FERGUSON AVE.', 'BAY 2 (E) - FERGUSON AVE.']
  },
  {
    id: 'LOC-002',
    name: 'Vancouver',
    address: '456 Port Road',
    city: 'Vancouver',
    province: 'BC',
    postalCode: 'V6B 1A1',
    bays: ['BAY 1', 'BAY 2']
  }
];

export interface Carrier {
  id: string;
  carrierNumber: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
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
}

export const INITIAL_CARRIERS: Carrier[] = [
  { id: 'CARR-001', carrierNumber: '1001', name: 'FastTruck', contactEmail: 'ops@fasttruck.com', contactPhone: '555-0101' },
  { id: 'CARR-002', carrierNumber: '1002', name: 'WestLogistics', contactEmail: 'dispatch@westlog.com', contactPhone: '555-0102' },
  { id: 'CARR-003', carrierNumber: '1003', name: 'Maersk', contactEmail: 'support@maersk.com', contactPhone: '555-0103' },
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

export const INITIAL_HAMILTON_SHIPMENTS: Shipment[] = [
  {
    id: 'SHIP-001',
    week: 'Week 9',
    date: '2026-02-24',
    day: 'Tuesday',
    time: '08:00',
    bay: 'BAY 1 (W) - FERGUSON AVE.',
    customer: 'Alberta Honey Co Op',
    product: 'Bulk Fine Granulated 45',
    po: 'PO-12345',
    bol: 'BOL-98765',
    qty: 22,
    carrier: 'FastTruck',
    arrive: '07:45',
    start: '08:05',
    out: '08:45',
    status: 'Confirmed'
  },
  {
    id: 'SHIP-002',
    week: 'Week 9',
    date: '2026-02-24',
    day: 'Tuesday',
    time: '08:30',
    bay: 'BAY 1 (W) - FERGUSON AVE.',
    customer: 'Cavalier Candies',
    product: '20kg Fine Granulated Bag 45',
    po: 'PO-12346',
    bol: 'BOL-98766',
    qty: 22,
    carrier: 'FastTruck',
    arrive: '08:15',
    start: '08:35',
    out: '09:15',
    status: 'Pending'
  }
];

export const INITIAL_TRANSFERS: Transfer[] = [];

export const INITIAL_INVOICES: Invoice[] = [];

export const INITIAL_ORDERS: Order[] = [];

export interface ConferenceAttendee {
  id: string;
  name: string;
  email: string;
  phone?: string;
}

export interface ConferenceMeeting {
  id: string;
  conferenceId: string;
  date: string; // Conference date (YYYY-MM-DD)
  time: string;
  meetingName: string;
  attendees: string[]; // Array of attendee IDs
  customerAttendees: string[]; // Array of customer IDs
  location: string;
  notes?: string;
  customerId?: string;
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
