/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Calculator,
  TrendingUp,
  Globe,
  Truck,
  Package,
  Download,
  Printer,
  Save,
  Info,
  Users,
  DollarSign,
  ArrowRightLeft,
  FileText,
  X,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Calendar,
  ShoppingCart,
  LogOut,
  Clock,
  Eye,
  EyeOff,
  Settings,
  Mail,
  Send,
  ClipboardCheck,
  GripVertical,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebaseConfig';
import { fetchAllData, syncCollection, COLLECTIONS, fetchCollection } from './firebaseDb';
import { CommodityConfig, INITIAL_SKUS, INITIAL_CUSTOMERS, INITIAL_SUPPLY_CHAIN, INITIAL_FREIGHT_RATES, INITIAL_CONTRACTS, INITIAL_CARRIERS, INITIAL_LOCATIONS, INITIAL_PRODUCT_GROUPS, INITIAL_TRANSFERS, INITIAL_INVOICES, INITIAL_ORDERS, INITIAL_CONFERENCES, INITIAL_PEOPLE, INITIAL_QA_PRODUCTS, INITIAL_FUEL_SURCHARGES, INITIAL_VENDORS, INITIAL_CHEP_PALLET_MOVEMENTS, INITIAL_SALES_LEADS, SKU, Customer, SupplyChainComponent, FreightRate, Contract, Shipment, Carrier, Location, Transfer, TransferLeg, Invoice, ProductGroup, Order, OrderLineItem, Conference, Person, QAProduct, QADocument, FuelSurcharge, Vendor, ChepPalletMovement, SalesLead, SalesLeadFollowUp } from './types';
import ConferencesPage from './components/ConferencesPage';
import PeoplePage from './components/PeoplePage';
import QualityAssurancePage from './components/QualityAssurancePage';

export default function App() {
  const [activePage, setActivePage] = useState('Dashboard');
  const [hiddenPages, setHiddenPages] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sweetpro-hidden-pages');
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [pageOrder, setPageOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('sweetpro-page-order');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [isEditingSidebar, setIsEditingSidebar] = useState(false);
  const [scheduleLocation, setScheduleLocation] = useState('Hamilton');
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [skus, setSkus] = useState<SKU[]>(INITIAL_SKUS);
  const [supplyChain, setSupplyChain] = useState<SupplyChainComponent[]>(INITIAL_SUPPLY_CHAIN);
  const [freightRates, setFreightRates] = useState<FreightRate[]>(INITIAL_FREIGHT_RATES);
  const [fuelSurcharges, setFuelSurcharges] = useState<FuelSurcharge[]>(INITIAL_FUEL_SURCHARGES);
  const [vendors, setVendors] = useState<Vendor[]>(INITIAL_VENDORS);
  const [chepPalletMovements, setChepPalletMovements] = useState<ChepPalletMovement[]>(INITIAL_CHEP_PALLET_MOVEMENTS);
  const [contracts, setContracts] = useState<Contract[]>(INITIAL_CONTRACTS);
  const [carriers, setCarriers] = useState<Carrier[]>(INITIAL_CARRIERS);
  const [locations, setLocations] = useState<Location[]>(INITIAL_LOCATIONS);
  const [transfers, setTransfers] = useState<Transfer[]>(INITIAL_TRANSFERS);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [conferences, setConferences] = useState<Conference[]>(INITIAL_CONFERENCES);
  const [people, setPeople] = useState<Person[]>(INITIAL_PEOPLE);
  const [qaProducts, setQaProducts] = useState<QAProduct[]>(INITIAL_QA_PRODUCTS);
  const [salesLeads, setSalesLeads] = useState<SalesLead[]>(INITIAL_SALES_LEADS);
  const [editingInvoiceCard, setEditingInvoiceCard] = useState<Invoice | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [isAddingTransfer, setIsAddingTransfer] = useState(false);
  const [newTransferLegs, setNewTransferLegs] = useState<TransferLeg[]>([]);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [isAddingBatchOrder, setIsAddingBatchOrder] = useState(false);
  const [batchOrder, setBatchOrder] = useState<{
    customer: string;
    product: string;
    contractNumber: string;
    entries: { shipmentDate: string; deliveryDate: string; po: string; bol: string; qty: number; carrier: string; amount: number; }[];
  }>({
    customer: '',
    product: '',
    contractNumber: '',
    entries: [{ shipmentDate: '', deliveryDate: '', po: '', bol: '', qty: 22, carrier: 'Customer Pick Up', amount: 0 }]
  });

  // New Order Modal State
  const [orderCustomerId, setOrderCustomerId] = useState('');
  const [orderPO, setOrderPO] = useState('');
  const [orderShipmentDate, setOrderShipmentDate] = useState('');
  const [orderDeliveryDate, setOrderDeliveryDate] = useState('');
  const [orderCarrier, setOrderCarrier] = useState('Customer Pick Up');
  const [orderShippingTerms, setOrderShippingTerms] = useState<'FOB' | 'DAP' | 'DDP' | 'FCA' | ''>('');
  const [orderLineItems, setOrderLineItems] = useState<OrderLineItem[]>([]);
  const [newLineItem, setNewLineItem] = useState<{
    productName: string;
    qty: number;
    contractNumber: string;
  }>({ productName: '', qty: 0, contractNumber: '' });
  const [filteredOrderContracts, setFilteredOrderContracts] = useState<Contract[]>([]);
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ orderId: string; newStatus: Order['status'] } | null>(null);
  const [orderDeleteConfirmId, setOrderDeleteConfirmId] = useState<string | null>(null);
  const [isCreatingShipments, setIsCreatingShipments] = useState(false);
  const [shipmentCreationData, setShipmentCreationData] = useState<{ location: 'Hamilton' | 'Vancouver'; date: string; time: string; bay: string; carrier: string; orderId: string; transferId?: string }>({ location: 'Hamilton', date: '', time: '', bay: '', carrier: '', orderId: '' });
  const [isCreatingTransferShipment, setIsCreatingTransferShipment] = useState(false);
  const [shipmentSearchCustomer, setShipmentSearchCustomer] = useState('');
  const [shipmentSearchBOL, setShipmentSearchBOL] = useState('');
  const [shipmentSearchTransfer, setShipmentSearchTransfer] = useState('');

  const [productGroups, setProductGroups] = useState<ProductGroup[]>(INITIAL_PRODUCT_GROUPS);
  const [customer, setCustomer] = useState(INITIAL_CUSTOMERS[0].name);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'error' | 'offline'>('synced');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [marketData, setMarketData] = useState<any[]>([]);
  const [lastMarketUpdate, setLastMarketUpdate] = useState<string | null>(null);
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);
  const [hamiltonShipments, setHamiltonShipments] = useState<Shipment[]>([]);
  const [vancouverShipments, setVancouverShipments] = useState<Shipment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          alert('CSV file is empty or has no data rows. Expected at least a header row and one data row.');
          return;
        }
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

        if (!headers.includes('date')) {
          alert(`CSV is missing a required "date" column.\n\nFound columns: ${headers.join(', ')}\n\nUse the Template button to download the expected format.`);
          return;
        }

        const newShipments: Shipment[] = [];
        let skippedRows = 0;
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          const entry: any = {};
          headers.forEach((h, idx) => {
            entry[h] = values[idx] || '';
          });

          if (!entry.date) { skippedRows++; continue; }

          const date = entry.date.trim();
          let week = entry.week;
          let day = entry.day;
          try {
            if (!week) week = `Week ${getWeekNumber(date)}`;
            if (!day) day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(date + 'T12:00:00'));
          } catch {
            skippedRows++;
            continue;
          }

          newShipments.push({
            id: entry.id || `SHIP-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            week,
            date,
            day,
            time: entry.time || '08:00',
            bay: entry.bay || (locations.find(l => l.name.toLowerCase().includes(activePage === 'Hamilton Shipments' ? 'hamilton' : 'vancouver'))?.bays[0] || ''),
            customer: entry.customer || '',
            product: entry.product || '',
            contractNumber: entry.contractnumber || entry.contractNumber || '',
            po: entry.po || '',
            bol: entry.bol || '',
            qty: parseFloat(entry.qty) || 0,
            carrier: entry.carrier || '',
            arrive: entry.arrive || '',
            start: entry.start || '',
            out: entry.out || '',
            status: entry.status || 'Confirmed',
            notes: entry.notes || '',
            color: entry.color || '',
            scaledQty: parseFloat(entry.scaledqty || entry.scaledQty) || undefined,
            trailerNo: entry.trailerno || entry.trailerNo || '',
            colour: entry.colour || '',
            lotNumber: entry.lotnumber || entry.lotNumber || '',
            deliveryDate: entry.deliverydate || entry.deliveryDate || ''
          });
        }

        if (newShipments.length > 0) {
          if (activePage === 'Hamilton Shipments') {
            setHamiltonShipments(prev => [...prev, ...newShipments]);
          } else {
            setVancouverShipments(prev => [...prev, ...newShipments]);
          }
          alert(`Successfully imported ${newShipments.length} shipment${newShipments.length > 1 ? 's' : ''}.${skippedRows > 0 ? ` (${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped due to missing/invalid date)` : ''}`);
        } else {
          alert(`No shipments could be imported from the CSV.\n\n${skippedRows > 0 ? `${skippedRows} row(s) were skipped because they had missing or invalid dates.` : 'The file may be empty or in an unexpected format.'}\n\nUse the Template button to download the expected format.`);
        }
      } catch (err) {
        alert(`Error reading CSV file: ${err instanceof Error ? err.message : 'Unknown error'}. Please check the file format and try again.`);
      }
    };
    reader.onerror = () => {
      alert('Failed to read the CSV file. Please try again.');
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-selected
    event.target.value = '';
  };
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const fetchMarketData = async () => {
    if (!user) return;
    setIsFetchingMarket(true);
    try {
      const data = await fetchCollection<any>(COLLECTIONS.marketData);
      if (data.length > 0) {
        setMarketData(data);
        setLastMarketUpdate(new Date().toISOString());

        const months = Array.from(new Set(data.map((d: any) => d.Month || d.month).filter(Boolean))) as string[];
        if (months.length > 0) {
          setConfig(prev => {
            const isIsoDate = (val: string | undefined) => val && /^\d{4}-\d{2}-\d{2}$/.test(val);
            return {
              ...prev,
              contractStartDate: (!prev.contractStartDate || isIsoDate(prev.contractStartDate)) ? months[0] : prev.contractStartDate,
              contractEndDate: (!prev.contractEndDate || isIsoDate(prev.contractEndDate)) ? months[Math.min(months.length - 1, 3)] : prev.contractEndDate
            };
          });
        }
      }
    } catch (e) {
      console.error("Failed to fetch market data:", e);
    } finally {
      setIsFetchingMarket(false);
    }
  };


  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      setSyncError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      console.error('Sign-in failed:', e);
      setSyncError(e.message || 'Sign-in failed');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setSyncStatus('offline');
      setLastSynced(null);
    } catch (e) {
      console.error('Sign-out failed:', e);
    }
  };

  useEffect(() => {
    if (user) {
      fetchMarketData();
      const interval = setInterval(() => {
        fetchMarketData();
      }, 30 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [user]);
  const [showContractConfirm, setShowContractConfirm] = useState(false);
  const [showEmailQuote, setShowEmailQuote] = useState(false);
  const [emailIncludeMargin, setEmailIncludeMargin] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [editingSupplyChain, setEditingSupplyChain] = useState<SupplyChainComponent | null>(null);
  const [isAddingSupplyChain, setIsAddingSupplyChain] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null);
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [editingAppointmentSchedule, setEditingAppointmentSchedule] = useState<Location | null>(null);
  const [newSupplyChain, setNewSupplyChain] = useState<SupplyChainComponent>({
    id: '',
    component: '',
    provider: '',
    totalCostCad: 0,
    weightPerLoadMt: 1
  });

  // Track last synced data to avoid redundant syncs
  const lastSyncedData = useRef<Record<string, string>>({
    customers: JSON.stringify(INITIAL_CUSTOMERS),
    products: JSON.stringify(INITIAL_SKUS),
    logistics: JSON.stringify(INITIAL_SUPPLY_CHAIN),
    freightrates: JSON.stringify(INITIAL_FREIGHT_RATES),
    contracts: JSON.stringify(INITIAL_CONTRACTS),
    carriers: JSON.stringify(INITIAL_CARRIERS),
    shipments: JSON.stringify([]),
    locations: JSON.stringify(INITIAL_LOCATIONS),
    transfers: JSON.stringify([]),
    invoices: JSON.stringify([]),
    orders: JSON.stringify([]),
    productgroups: JSON.stringify(INITIAL_PRODUCT_GROUPS),
    conferences: JSON.stringify([]),
    people: JSON.stringify(INITIAL_PEOPLE),
    qaproducts: JSON.stringify([]),
    fuelsurcharges: JSON.stringify([]),
    vendors: JSON.stringify([]),
    cheppalletmovements: JSON.stringify([]),
    salesleads: JSON.stringify([]),
  });

  // Fetch initial data from Firestore
  const loadDataFromFirestore = async () => {
    try {
      setSyncStatus('syncing');
      setSyncError(null);
      const data = await fetchAllData();

      if (data.customers?.length) {
        const mapped = data.customers.map((c: any) => ({
          ...c,
          defaultMargin: parseFloat(c.defaultMargin) || 0
        }));
        setCustomers(mapped);
        lastSyncedData.current.customers = JSON.stringify(mapped);
      }
      if (data.products?.length) {
        const validLocations = ['Hamilton', 'Vancouver'];
        const mapped = data.products.map((s: any) => ({
          ...s,
          productGroup: s.productGroup || s.productType || 'Bulk',
          netWeight: parseFloat(s.netWeight) || 0,
          brix: parseFloat(s.brix) || 0,
          premiumCadMt: parseFloat(s.premiumCadMt) || 0,
          netWeightKg: s.netWeightKg ? (parseFloat(s.netWeightKg) || 0) : (s.unitSizeKg ? (parseFloat(s.unitSizeKg) || 0) : undefined),
          grossWeightKg: s.grossWeightKg ? (parseFloat(s.grossWeightKg) || 0) : undefined,
          location: validLocations.includes(s.location) ? s.location : 'Hamilton',
          category: (s.category === 'Conventional' || s.category === 'Organic') ? s.category : 'Conventional'
        }));
        setSkus(mapped);
        lastSyncedData.current.products = JSON.stringify(mapped);
      }
      if (data.logistics?.length) {
        const mapped = data.logistics.map((l: any) => ({
          ...l,
          totalCostCad: parseFloat(l.totalCostCad) || 0,
          weightPerLoadMt: parseFloat(l.weightPerLoadMt) || 0
        }));
        setSupplyChain(mapped);
        lastSyncedData.current.logistics = JSON.stringify(mapped);
      }
      if (data.freightRates?.length) {
        const validTypes = ['Dry Van', 'Bulk', 'Liquid', 'Bulk Rail', 'Intermodal'];
        const mapped = data.freightRates.map((f: any) => ({
          ...f,
          cost: parseFloat(f.cost) || 0,
          mtPerLoad: parseFloat(f.mtPerLoad) || 0,
          freightType: validTypes.includes(f.freightType) ? f.freightType : 'Dry Van'
        }));
        setFreightRates(mapped);
        lastSyncedData.current.freightrates = JSON.stringify(mapped);
      }
      if (data.contracts?.length) {
        const mapped = data.contracts.map((c: any) => {
          const contractVolume = parseFloat(c.contractVolume) || 0;
          const volumeTaken = parseFloat(c.volumeTaken) || 0;
          return {
            ...c,
            contractVolume,
            volumeTaken,
            volumeOutstanding: parseFloat(c.volumeOutstanding) || (contractVolume - volumeTaken),
            finalPrice: parseFloat(c.finalPrice) || 0
          };
        });
        setContracts(mapped);
        lastSyncedData.current.contracts = JSON.stringify(mapped);
      }
      if (data.carriers?.length) {
        setCarriers(data.carriers);
        lastSyncedData.current.carriers = JSON.stringify(data.carriers);
      }
      if (data.shipments?.length) {
        const mapped = data.shipments.map((s: any) => ({
          ...s,
          qty: parseFloat(s.qty) || 0
        }));
        // Split shipments by location using bay names from location data
        const locs = data.locations?.length ? data.locations : [];
        const vancLoc = locs.find((l: any) => l.name?.toLowerCase().includes('vancouver'));
        const vancBays: string[] = vancLoc
          ? (typeof vancLoc.bays === 'string' ? vancLoc.bays.split(',').map((b: string) => b.trim()) : (vancLoc.bays || []))
          : [];
        const vancouver = mapped.filter((s: any) => vancBays.some((b: string) => s.bay === b));
        const hamilton = mapped.filter((s: any) => !vancBays.some((b: string) => s.bay === b));
        setHamiltonShipments(hamilton);
        setVancouverShipments(vancouver);
        lastSyncedData.current.shipments = JSON.stringify(mapped);
      }
      if (data.locations?.length) {
        const mapped = data.locations.map((l: any, idx: number) => ({
          ...l,
          locationCode: l.locationCode || String((idx + 1) * 100),
          bays: Array.isArray(l.bays) ? l.bays : (typeof l.bays === 'string' ? l.bays.split(',').map((b: string) => b.trim()).filter(Boolean) : []),
          appointmentStartTime: l.appointmentStartTime || '06:00',
          appointmentEndTime: l.appointmentEndTime || '18:00',
          appointmentDuration: l.appointmentDuration || 30
        }));
        setLocations(mapped);
        lastSyncedData.current.locations = JSON.stringify(mapped);
      }
      if (data.transfers?.length) {
        const mapped = data.transfers.map((t: any) => ({
          ...t,
          amount: parseFloat(t.amount) || 0,
          legs: Array.isArray(t.legs) ? t.legs.map((leg: any) => ({ ...leg, amount: parseFloat(leg.amount) || 0 })) : undefined
        }));
        setTransfers(mapped);
        lastSyncedData.current.transfers = JSON.stringify(mapped);
      }
      if (data.invoices?.length) {
        const mapped = data.invoices.map((i: any) => ({
          ...i,
          qty: parseFloat(i.qty) || 0,
          amount: parseFloat(i.amount) || 0
        }));

        const uniqueInvoices: Invoice[] = [];
        const seenShipmentIds = new Set<string>();
        for (const inv of mapped) {
          if (inv.shipmentId && seenShipmentIds.has(inv.shipmentId)) continue;
          if (inv.shipmentId) seenShipmentIds.add(inv.shipmentId);
          uniqueInvoices.push(inv);
        }

        setInvoices(uniqueInvoices);
        lastSyncedData.current.invoices = JSON.stringify(uniqueInvoices);
      }
      if (data.productGroups?.length) {
        setProductGroups(data.productGroups);
        lastSyncedData.current.productgroups = JSON.stringify(data.productGroups);
      }
      if (data.orders?.length) {
        const mapped = data.orders.map((o: any) => ({
          ...o,
          amount: parseFloat(o.amount) || 0,
          lineItems: Array.isArray(o.lineItems) ? o.lineItems : (typeof o.lineItems === 'string' ? JSON.parse(o.lineItems) : [])
        }));
        setOrders(mapped);
        lastSyncedData.current.orders = JSON.stringify(mapped);
      }
      if (data.conferences?.length) {
        // Normalize conference meetings to ensure customerAttendeeDetails is always an array
        const normalizedConferences = data.conferences.map((conf: any) => ({
          ...conf,
          meetings: Array.isArray(conf.meetings) ? conf.meetings.map((m: any) => ({
            ...m,
            customerAttendeeDetails: Array.isArray(m.customerAttendeeDetails) ? m.customerAttendeeDetails : [],
            customerAttendees: Array.isArray(m.customerAttendees) ? m.customerAttendees : [],
            attendees: Array.isArray(m.attendees) ? m.attendees : [],
            followUps: Array.isArray(m.followUps) ? m.followUps : [],
          })) : [],
        }));
        setConferences(normalizedConferences);
        lastSyncedData.current.conferences = JSON.stringify(normalizedConferences);
      }
      if (data.people?.length) {
        setPeople(data.people);
        lastSyncedData.current.people = JSON.stringify(data.people);
      }
      if (data.qaProducts?.length) {
        const mapped = data.qaProducts.map((qa: any) => ({
          ...qa,
          specifications: qa.specifications || { brix: '', granulation: '', color: '', ash: '', turbidity: '', moisture: '' },
          packagingPictureUrls: qa.packagingPictureUrls || [],
          packagingPictureFilenames: qa.packagingPictureFilenames || [],
          artworkApprovals: qa.artworkApprovals || [],
          specSheets: qa.specSheets || [],
          certificates: qa.certificates || [],
        }));
        setQaProducts(mapped);
        lastSyncedData.current.qaproducts = JSON.stringify(mapped);
      }
      if (data.fuelSurcharges?.length) {
        setFuelSurcharges(data.fuelSurcharges);
        lastSyncedData.current.fuelsurcharges = JSON.stringify(data.fuelSurcharges);
      }
      if (data.vendors?.length) {
        setVendors(data.vendors);
        lastSyncedData.current.vendors = JSON.stringify(data.vendors);
      }
      if (data.chepPalletMovements?.length) {
        setChepPalletMovements(data.chepPalletMovements);
        lastSyncedData.current.cheppalletmovements = JSON.stringify(data.chepPalletMovements);
      }
      if (data.salesLeads?.length) {
        setSalesLeads(data.salesLeads);
        lastSyncedData.current.salesleads = JSON.stringify(data.salesLeads);
      }
      if (data.MarketData?.length) {
        setMarketData(data.MarketData);
        setLastMarketUpdate(new Date().toISOString());
        const months = Array.from(new Set(data.MarketData.map((d: any) => d.Month || d.month).filter(Boolean))) as string[];
        if (months.length > 0) {
          setConfig(prev => {
            const isIsoDate = (val: string | undefined) => val && /^\d{4}-\d{2}-\d{2}$/.test(val);
            return {
              ...prev,
              contractStartDate: (!prev.contractStartDate || isIsoDate(prev.contractStartDate)) ? months[0] : prev.contractStartDate,
              contractEndDate: (!prev.contractEndDate || isIsoDate(prev.contractEndDate)) ? months[Math.min(months.length - 1, 3)] : prev.contractEndDate
            };
          });
        }
      }

      setSyncStatus('synced');
      setLastSynced(new Date());
    } catch (e) {
      console.error("Failed to fetch data:", e);
      setSyncStatus('error');
      setSyncError((e as Error).message);
    }
  };

  useEffect(() => {
    if (user) {
      loadDataFromFirestore();
    }
  }, [user]);

  // Sync data to Firestore with debounce
  const isSyncing = useRef(false);
  useEffect(() => {
    const syncAll = async () => {
      if (isSyncing.current || !lastSynced || !user) return;
      isSyncing.current = true;

      const syncTasks: { collection: string; key: string; data: any[] }[] = [
        { collection: COLLECTIONS.customers, key: 'customers', data: customers },
        { collection: COLLECTIONS.products, key: 'products', data: skus },
        { collection: COLLECTIONS.logistics, key: 'logistics', data: supplyChain },
        { collection: COLLECTIONS.freightRates, key: 'freightrates', data: freightRates },
        { collection: COLLECTIONS.contracts, key: 'contracts', data: contracts },
        { collection: COLLECTIONS.carriers, key: 'carriers', data: carriers },
        { collection: COLLECTIONS.shipments, key: 'shipments', data: [...hamiltonShipments, ...vancouverShipments] },
        { collection: COLLECTIONS.locations, key: 'locations', data: locations },
        { collection: COLLECTIONS.transfers, key: 'transfers', data: transfers },
        { collection: COLLECTIONS.invoices, key: 'invoices', data: invoices },
        { collection: COLLECTIONS.productGroups, key: 'productgroups', data: productGroups },
        { collection: COLLECTIONS.orders, key: 'orders', data: orders },
        { collection: COLLECTIONS.conferences, key: 'conferences', data: conferences },
        { collection: COLLECTIONS.people, key: 'people', data: people },
        { collection: COLLECTIONS.qaProducts, key: 'qaproducts', data: qaProducts },
        { collection: COLLECTIONS.fuelSurcharges, key: 'fuelsurcharges', data: fuelSurcharges },
        { collection: COLLECTIONS.vendors, key: 'vendors', data: vendors },
        { collection: COLLECTIONS.chepPalletMovements, key: 'cheppalletmovements', data: chepPalletMovements },
        { collection: COLLECTIONS.salesLeads, key: 'salesleads', data: salesLeads },
      ];

      try {
        for (const task of syncTasks) {
          const dataStr = JSON.stringify(task.data);
          if (dataStr === lastSyncedData.current[task.key]) continue;

          setSyncStatus('syncing');
          await syncCollection(task.collection, task.data);
          lastSyncedData.current[task.key] = dataStr;
        }

        setSyncStatus('synced');
        setLastSynced(new Date());
        setSyncError(null);
      } catch (e) {
        setSyncStatus('error');
        setSyncError((e as Error).message);
      } finally {
        isSyncing.current = false;
      }
    };

    const timeout = setTimeout(syncAll, 15000);
    return () => clearTimeout(timeout);
  }, [customers, skus, supplyChain, freightRates, contracts, carriers, hamiltonShipments, vancouverShipments, locations, transfers, invoices, productGroups, orders, conferences, people, qaProducts, fuelSurcharges, vendors, chepPalletMovements, salesLeads, lastSynced, user]);

  // Sync QA product edits back to the Products (SKU) table
  // Updates existing SKUs and creates new ones for QA products with no match
  useEffect(() => {
    if (qaProducts.length === 0) return;
    let changed = false;

    // Update existing SKUs that have a matching QA product
    const updatedSkus = skus.map(sku => {
      const qa = qaProducts.find(q => q.skuId === sku.id);
      if (!qa) return sku;
      if (
        qa.skuName !== sku.name ||
        qa.productGroup !== sku.productGroup ||
        qa.category !== sku.category ||
        qa.location !== sku.location ||
        (qa.netWeightKg !== undefined && qa.netWeightKg !== (sku.netWeightKg || sku.netWeight)) ||
        (qa.grossWeightKg !== undefined && qa.grossWeightKg !== sku.grossWeightKg) ||
        qa.maxColor !== sku.maxColor
      ) {
        changed = true;
        return {
          ...sku,
          name: qa.skuName,
          productGroup: qa.productGroup,
          category: qa.category,
          location: qa.location,
          netWeightKg: qa.netWeightKg ?? sku.netWeightKg ?? sku.netWeight,
          netWeight: qa.netWeightKg ?? sku.netWeightKg ?? sku.netWeight,
          grossWeightKg: qa.grossWeightKg ?? sku.grossWeightKg,
          maxColor: qa.maxColor,
        };
      }
      return sku;
    });

    // Create new SKUs for QA products that have no matching SKU
    const newSkus: SKU[] = [];
    qaProducts.forEach(qa => {
      if (!qa.skuName.trim()) return; // skip blank names
      const existingSku = updatedSkus.find(s => s.id === qa.skuId);
      if (!existingSku) {
        newSkus.push({
          id: qa.skuId,
          name: qa.skuName,
          productGroup: qa.productGroup,
          category: qa.category,
          netWeight: qa.netWeightKg || 0,
          netWeightKg: qa.netWeightKg || 0,
          grossWeightKg: qa.grossWeightKg || 0,
          brix: 0,
          premiumCadMt: 0,
          maxColor: qa.maxColor,
          location: qa.location || 'Hamilton',
        });
      }
    });

    if (newSkus.length > 0) {
      changed = true;
      setSkus([...updatedSkus, ...newSkus]);
    } else if (changed) {
      setSkus(updatedSkus);
    }
  }, [qaProducts]);

  const [config, setConfig] = useState<CommodityConfig>({
    rawPriceUsdCwt: 13.94,
    oceanFreightUsdMt: 135,
    yieldLossMultiplier: 1.08,
    fxRate: 1.354,
    refiningMarginCadMt: 250,
    freightCostTotalCad: 850,
    volumeMt: 22,
    volumePerLoadMt: 22,
    isDelivered: false,
    deliveredFreightCadMt: 0,
    currency: 'CAD',
    isExport: false,
    exportDutyUsdMt: 361.30,
    origin: 'Hamilton',
    destination: 'Toronto',
    freightType: '',
    useManualFreight: false,
    contractStartDate: new Date().toISOString().split('T')[0],
    contractEndDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    isPalletCharge: false,
    palletCostCadMt: 15.00,
    palletType: '',
    paymentTerms: undefined
  });

  // Auto-calculate market inputs based on contract dates
  useEffect(() => {
    if (marketData.length === 0 || !config.contractStartDate || !config.contractEndDate) return;

    const months = marketData.map(d => d.Month || d.month).filter(Boolean);
    const startIndex = months.indexOf(config.contractStartDate);
    const endIndex = months.indexOf(config.contractEndDate);

    if (startIndex === -1 || endIndex === -1) return;

    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);
    const range = marketData.slice(start, end + 1);

    if (range.length === 0) return;

    const firstRow = marketData[0];
    const monthKeyCalc = Object.keys(firstRow).find(k => k.toLowerCase() === 'month') || Object.keys(firstRow).find(k => k.toLowerCase() === 'date');
    const nonSystemKeys = Object.keys(firstRow).filter(k => k !== 'id' && k !== '__name__' && k !== monthKeyCalc);
    let rawKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('raw sugar') || k.toLowerCase().includes('#11') || k.toLowerCase().includes('raw') || k.toLowerCase().includes('raws'));
    let fxKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('fx') || k.toLowerCase().includes('cad') || k.toLowerCase().includes('exchange'));
    // Fallback: use remaining non-month keys
    if (!rawKey && nonSystemKeys.length >= 1) rawKey = nonSystemKeys[0];
    if (!fxKey && nonSystemKeys.length >= 2) fxKey = nonSystemKeys[1];

    if (rawKey && fxKey) {
      const avgRaw = range.reduce((acc, curr) => {
        const val = typeof curr[rawKey] === 'string' ? parseFloat(curr[rawKey].replace(/[^0-9.]/g, '')) : parseFloat(curr[rawKey]);
        return acc + (val || 0);
      }, 0) / range.length;
      
      const avgFx = range.reduce((acc, curr) => {
        const val = typeof curr[fxKey] === 'string' ? parseFloat(curr[fxKey].replace(/[^0-9.]/g, '')) : parseFloat(curr[fxKey]);
        return acc + (val || 0);
      }, 0) / range.length;

      const newRaw = Math.round(avgRaw * 100) / 100;
      const newFx = Math.round(avgFx * 10000) / 10000;

      if (newRaw !== config.rawPriceUsdCwt || newFx !== config.fxRate) {
        setConfig(prev => ({
          ...prev,
          rawPriceUsdCwt: newRaw,
          fxRate: newFx
        }));
      }
    }
  }, [config.contractStartDate, config.contractEndDate, marketData]);

  const [selectedSkuId, setSelectedSkuId] = useState(INITIAL_SKUS[1].id);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [expandedBays, setExpandedBays] = useState<Set<string>>(new Set());

  const weeksList = useMemo(() => Array.from({ length: 52 }, (_, i) => `Week ${i + 1}`), []);
  const daysList = useMemo(() => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], []);
  // Generate time slots for a location based on its appointment schedule settings
  const generateTimeSlots = useCallback((startTime: string, endTime: string, durationMin: number) => {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    const slots: string[] = [];
    for (let t = startTotal; t <= endTotal; t += durationMin) {
      const hour = Math.floor(t / 60).toString().padStart(2, '0');
      const min = (t % 60).toString().padStart(2, '0');
      slots.push(`${hour}:${min}`);
    }
    return slots;
  }, []);

  // Get time slots for a specific location from its schedule settings
  const getLocationTimeSlots = useCallback((locationName: string) => {
    const loc = locations.find(l => l.name.toLowerCase().includes(locationName.toLowerCase()));
    const start = loc?.appointmentStartTime || '06:00';
    const end = loc?.appointmentEndTime || '18:00';
    const duration = loc?.appointmentDuration || 30;
    return generateTimeSlots(start, end, duration);
  }, [locations, generateTimeSlots]);

  // Time slots for creation modal — aligned with the location's schedule settings
  const getLocationAllTimeSlots = useCallback((locationName: string) => {
    const loc = locations.find(l => l.name.toLowerCase().includes(locationName.toLowerCase()));
    const start = loc?.appointmentStartTime || '06:00';
    const end = loc?.appointmentEndTime || '18:00';
    const duration = loc?.appointmentDuration || 30;
    return generateTimeSlots(start, end, duration);
  }, [locations, generateTimeSlots]);

  const [skuToConfirm, setSkuToConfirm] = useState<SKU | null>(null);
  const [errorBox, setErrorBox] = useState<string | null>(null);

  const getStatusColor = (status: string) => {
    switch ((status || '').toLowerCase()) {
      case 'completed': return { bg: '#dcfce7', text: '#166534' }; // Green
      case 'in progress': return { bg: '#fef9c3', text: '#854d0e' }; // Light Yellow
      case 'confirmed': return { bg: '#f3e8ff', text: '#6b21a8' }; // Light Purple
      case 'cancelled': return { bg: '#fee2e2', text: '#991b1b' }; // Light Red BG, Dark Red Text
      default: return { bg: 'transparent', text: 'inherit' };
    }
  };


  const getWeekNumber = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    // ISO 8601 week number: week 1 is the week containing the first Thursday of the year
    const target = new Date(date.valueOf());
    // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
    const dayNum = (date.getDay() + 6) % 7; // Mon=0, Sun=6
    target.setDate(target.getDate() - dayNum + 3);
    // January 4th is always in week 1
    const jan4 = new Date(target.getFullYear(), 0, 4);
    const jan4DayNum = (jan4.getDay() + 6) % 7;
    const week1Monday = new Date(jan4.valueOf());
    week1Monday.setDate(jan4.getDate() - jan4DayNum);
    const diffMs = target.getTime() - week1Monday.getTime();
    return 1 + Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  };

  const toLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getDateForWeekDay = (weekNum: number, dayName: string) => {
    // Reference: Wednesday in week 9 should be February 25, 2026
    // Week 9 Monday is Feb 23, 2026
    // Week 1 Monday is Dec 29, 2025
    const week1Monday = new Date(2025, 11, 29); // Dec 29, 2025
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayIdx = days.indexOf(dayName);
    
    const targetDate = new Date(week1Monday);
    targetDate.setDate(week1Monday.getDate() + (weekNum - 1) * 7 + dayIdx);
    
    return targetDate;
  };

  const formatDateMMM_DD = (dateStr: string) => {
    // Parse dateStr manually to avoid UTC shift
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (isNaN(date.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit' }).format(date);
  };

  const generateBOLNumber = (lineItems: OrderLineItem[]): string => {
    // Determine prefix based on bolCode from product groups
    const itemGroups = lineItems.map(item => {
      const product = skus.find(s => s.name === item.productName);
      return product?.productGroup || 'Other';
    });

    const uniqueGroups = new Set(itemGroups);
    let prefix = 'P'; // Default for mixed or unknown
    if (uniqueGroups.size === 1) {
      const groupName = [...uniqueGroups][0];
      const pg = productGroups.find(g => g.name === groupName);
      if (pg?.bolCode) prefix = pg.bolCode;
    }

    // Find highest existing BOL with same prefix and extract 6-digit counter
    const samePrefixBOLs = orders
      .map(o => o.bolNumber)
      .filter(bol => bol?.startsWith(prefix) && /^[A-Z]\d{6}$/.test(bol))
      .map(bol => parseInt(bol.slice(1)) || 0);

    // Also check legacy format (PREFIX-YEAR-COUNTER)
    const legacyBOLs = orders
      .map(o => o.bolNumber)
      .filter(bol => bol?.startsWith(prefix + '-'))
      .map(bol => parseInt(bol.split('-')[2]) || 0);

    const maxCounter = Math.max(...samePrefixBOLs, ...legacyBOLs, 0);
    const nextCounter = (maxCounter + 1).toString().padStart(6, '0');
    return `${prefix}${nextCounter}`;
  };

  const updateShipmentStatus = (id: string, status: string) => {
    const allShipments = [...hamiltonShipments, ...vancouverShipments];
    const shipment = allShipments.find(s => s.id === id);

    if (!shipment) return;

    // Update the shipment status in the appropriate list
    const updateFn = (prev: Shipment[]) => prev.map(s => s.id === id ? { ...s, status } : s);
    setHamiltonShipments(updateFn);
    setVancouverShipments(updateFn);

    // If status changed to Completed, create an invoice and deduct contract volume
    if (status === 'Completed' && shipment.status !== 'Completed') {
      // Find the contract for this shipment to use contract pricing
      const contract = contracts.find(c => c.contractNumber === shipment.contractNumber);
      const invoiceAmount = contract
        ? shipment.qty * contract.finalPrice  // qty is in MT, finalPrice is $/MT
        : shipment.qty * config.refiningMarginCadMt; // fallback

      const invoiceId = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newInvoice: Invoice = {
        id: invoiceId,
        bolNumber: shipment.bol,
        customer: shipment.customer,
        product: shipment.product,
        po: shipment.po,
        qty: shipment.qty,
        carrier: shipment.carrier,
        amount: invoiceAmount,
        shipmentId: shipment.id,
        date: new Date().toISOString().split('T')[0],
        status: 'Pending'
      };

      setInvoices(prevInvoices => {
        // Prevent duplicate invoices for the same shipment
        if (prevInvoices.some(inv => inv.shipmentId === id)) return prevInvoices;
        return [...prevInvoices, newInvoice];
      });

      // Track CHEP pallet outbound if applicable
      const matchingOrder = orders.find(o => o.bolNumber === shipment.bol);
      if (matchingOrder?.palletType === 'CHEP') {
        const orderLocation = matchingOrder.location || '';
        let totalPallets = 0;
        for (const li of matchingOrder.lineItems) {
          const matchSku = skus.find(s => s.name === li.productName);
          const qaP = matchSku ? qaProducts.find(q => q.skuId === matchSku.id) : null;
          const upp = qaP?.unitsPerPallet;
          if (upp && upp > 0) {
            totalPallets += Math.ceil(li.qty / upp);
          } else {
            totalPallets += li.qty;
          }
        }
        if (totalPallets > 0) {
          const chepMovement: ChepPalletMovement = {
            id: `CHEP-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            date: new Date().toISOString().split('T')[0],
            location: orderLocation,
            type: 'out',
            quantity: totalPallets,
            reference: shipment.bol,
          };
          setChepPalletMovements(prev => [...prev, chepMovement]);
        }
      }

      // Deduct volume from the contract
      if (contract) {
        setContracts(prevContracts => prevContracts.map(c => {
          if (c.contractNumber === shipment.contractNumber) {
            const newVolumeTaken = c.volumeTaken + shipment.qty;
            return {
              ...c,
              volumeTaken: newVolumeTaken,
              volumeOutstanding: c.contractVolume - newVolumeTaken
            };
          }
          return c;
        }));
      }
    }
  };

  const updateInvoiceStatus = (id: string, status: string) => {
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  };
  const [contractInvoicePopup, setContractInvoicePopup] = useState<string | null>(null); // contract number for invoice popup
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingSku, setEditingSku] = useState<SKU | null>(null);
  const [editingFreightRate, setEditingFreightRate] = useState<FreightRate | null>(null);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [selectedContractDetail, setSelectedContractDetail] = useState<Contract | null>(null);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [isAddingSku, setIsAddingSku] = useState(false);
  const [isAddingFreightRate, setIsAddingFreightRate] = useState(false);
  const [isAddingCarrier, setIsAddingCarrier] = useState(false);
  const [showPreviousWeeks, setShowPreviousWeeks] = useState(false);
  const [isAddingBatchShipment, setIsAddingBatchShipment] = useState(false);
  const [newCustomer, setNewCustomer] = useState<Customer>({
    id: '',
    name: '',
    defaultLocation: 'Hamilton',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    defaultMargin: 250,
    contactEmail: '',
    contactPhone: '',
    notes: ''
  });
  const [newSku, setNewSku] = useState<SKU>({
    id: '',
    name: '',
    productGroup: 'Bulk',
    category: 'Conventional',
    netWeight: 1000,
    brix: 99.9,
    premiumCadMt: 0,
    netWeightKg: 1000,
    grossWeightKg: 1000,
    maxColor: 45,
    location: 'Hamilton',
    description: ''
  });
  const [isAddingProductGroup, setIsAddingProductGroup] = useState(false);
  const [editingProductGroup, setEditingProductGroup] = useState<ProductGroup | null>(null);
  const [newProductGroup, setNewProductGroup] = useState<ProductGroup>({
    id: '',
    name: '',
    color: '#E4E3E0',
    bolCode: ''
  });
  const [newFreightRate, setNewFreightRate] = useState<FreightRate>({
    id: '',
    origin: 'Hamilton',
    destination: '',
    provider: '',
    cost: 0,
    freightType: 'Dry Van',
    mtPerLoad: 22,
    startDate: '',
    endDate: ''
  });

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedRows(newExpanded);
  };

  const deleteCustomer = (id: string) => {
    setCustomers(customers.filter(c => c.id !== id));
  };

  const deleteSku = (id: string) => {
    setSkus(skus.filter(s => s.id !== id));
  };

  const addCustomer = () => {
    const id = `CUST-${String(customers.length + 1).padStart(3, '0')}`;
    setNewCustomer({
      id,
      name: '',
      defaultLocation: 'Hamilton',
      address: '',
      city: '',
      province: '',
      postalCode: '',
      defaultMargin: 250,
      contactEmail: '',
      contactPhone: '',
      qaContractEmail: '',
      salesContactEmail: '',
      customerServiceEmail: '',
      notes: ''
    });
    setIsAddingCustomer(true);
  };

  const addSku = () => {
    const id = `PROD-${String(skus.length + 1).padStart(3, '0')}`;
    setNewSku({
      id,
      name: '',
      productGroup: productGroups[0]?.name || 'Bulk',
      category: 'Conventional',
      netWeight: 1000,
      brix: 99.9,
      premiumCadMt: 0,
      netWeightKg: 1000,
      grossWeightKg: 1000,
      maxColor: 45,
      location: 'Hamilton',
      description: ''
    });
    setIsAddingSku(true);
  };

  const addProductGroup = () => {
    const id = `PG-${String(productGroups.length + 1).padStart(3, '0')}`;
    setNewProductGroup({
      id,
      name: '',
      color: '#E4E3E0'
    });
    setIsAddingProductGroup(true);
  };

  const addFreightRate = () => {
    const id = `FR-${String(freightRates.length + 1).padStart(3, '0')}`;
    setNewFreightRate({
      id,
      origin: 'Hamilton',
      destination: '',
      provider: '',
      cost: 0,
      freightType: 'Dry Van',
      mtPerLoad: 22,
      startDate: '',
      endDate: ''
    });
    setIsAddingFreightRate(true);
  };

  const deleteFreightRate = (id: string) => {
    setFreightRates(freightRates.filter(f => f.id !== id));
  };

  const deleteContract = (id: string) => {
    setContracts(contracts.filter(c => c.id !== id));
  };

  const deleteShipment = (id: string) => {
    setHamiltonShipments(hamiltonShipments.filter(s => s.id !== id));
  };


  const createContract = () => {
    const selectedSku = skus.find(s => s.id === selectedSkuId) || skus[0];
    const selectedCustomer = customers.find(c => c.name === customer) || customers[0];
    
    const newContract: Contract = {
      id: `CON-${Date.now()}`,
      contractNumber: `CON-${new Date().getFullYear()}-${String(contracts.length + 1).padStart(3, '0')}`,
      customerNumber: selectedCustomer.id,
      customerName: selectedCustomer.name,
      contractVolume: config.volumeMt,
      volumeTaken: 0,
      volumeOutstanding: config.volumeMt,
      startDate: config.contractStartDate || new Date().toISOString().split('T')[0],
      endDate: config.contractEndDate || new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
      skuName: selectedSku.name,
      origin: config.origin,
      destination: config.destination,
      finalPrice: calculations.finalMt,
      currency: config.currency,
      notes: `Generated from quote tool for ${customer}`,
      shippingTerms: config.shippingTerms || '',
      fxRate: config.fxRate,
      rawPriceUsdMt: calculations.rawMtUsd,
      deliveredFreight: calculations.deliveredFreight,
      exportDuty: calculations.exportDuty,
      palletCharge: calculations.palletCharge,
      paymentTerms: config.paymentTerms || selectedCustomer.defaultPaymentTerms || undefined,
      palletType: config.palletType || ''
    };

    setContracts([...contracts, newContract]);
    setShowContractConfirm(false);
    setActivePage('Contracts');
  };

  const updateCustomer = (id: string, field: keyof Customer, value: any) => {
    setCustomers(customers.map(c => c.id === id ? { ...c, [field]: value } : c));
  };


  const calculations = useMemo(() => {
    const mtToCwt = 22.0462;
    const fx = config.fxRate || 1;
    
    // Lookup freight cost based on origin/destination/freightType
    const matchedRate = config.useManualFreight ? null : freightRates.find(r =>
      r.origin === config.origin &&
      r.destination === config.destination &&
      (config.freightType ? r.freightType === config.freightType : true)
    );
    const freightCost = matchedRate ? matchedRate.cost : config.freightCostTotalCad;
    const matchedVolume = matchedRate ? matchedRate.mtPerLoad : config.volumePerLoadMt;

    // Base calculations in their native currencies first
    const rawUsdMt = config.rawPriceUsdCwt * mtToCwt;
    const oceanFreightUsdMt = config.oceanFreightUsdMt;
    const totalUsdMtBeforeYield = rawUsdMt + oceanFreightUsdMt;
    const totalUsdMtAfterYield = totalUsdMtBeforeYield * config.yieldLossMultiplier;
    
    // Convert base to CAD
    const totalCadMtBase = totalUsdMtAfterYield * fx;
    const totalCadMtRefined = totalCadMtBase + config.refiningMarginCadMt;
    
    // FCA Hamilton Bulk is just the refined cost (no freight, no supply chain)
    const fcaHamiltonBulk = totalCadMtRefined;

    // Vancouver Supply Chain Logic
    const totalSupplyChainCostPerMt = supplyChain.reduce((sum, item) => sum + (item.totalCostCad / (item.weightPerLoadMt || 1)), 0);
    
    // FCA Vancouver Bulk includes supply chain if origin is Vancouver
    let fcaVancouverBulk = 0;
    if (config.origin === 'Vancouver') {
      fcaVancouverBulk = fcaHamiltonBulk + totalSupplyChainCostPerMt;
    }

    const selectedSku = skus.find(s => s.id === selectedSkuId) || skus[0];
    
    // Start with the appropriate base price
    let finalCadMt = config.origin === 'Vancouver' ? fcaVancouverBulk : fcaHamiltonBulk;
    
    // Add SKU Premium (Differential)
    finalCadMt += selectedSku.premiumCadMt;
    
    // Add Freight ONLY if Delivered toggle is selected
    if (config.isDelivered) {
      // Use the matched freight rate or the manual input
      const freightPerMt = freightCost / (config.volumePerLoadMt || 1);
      finalCadMt += freightPerMt;
    }

    // Add Export Duty (USD -> CAD)
    let exportDutyCadMt = 0;
    if (config.isExport) {
      exportDutyCadMt = config.exportDutyUsdMt * fx;
      finalCadMt += exportDutyCadMt;
    }

    // Add Pallet Charge
    let palletChargeCadMt = 0;
    if (config.isPalletCharge) {
      palletChargeCadMt = config.palletCostCadMt;
      finalCadMt += palletChargeCadMt;
    }

    // Apply 2% surcharge for "2% / Net 15" payment terms
    if (config.paymentTerms === '2% / Net 15') {
      finalCadMt *= 1.02;
    }

    // Currency Conversion for Display
    const isUsd = config.currency === 'USD';
    const convert = (valCad: number) => isUsd ? valCad / fx : valCad;
    const convertUsd = (valUsd: number) => isUsd ? valUsd : valUsd * fx;

    const displayFinalMt = convert(finalCadMt);
    
    let cadPerUnit = 0;
    // Use netWeightKg if available, otherwise fallback to unitSizeKg (which we renamed in types but might still be in old data)
    const weightForUnit = selectedSku.netWeightKg || (selectedSku as any).unitSizeKg || 1000;
    cadPerUnit = (finalCadMt / 1000) * weightForUnit;
    
    const displayPerUnit = convert(cadPerUnit);

    const totalQuoteValue = finalCadMt * config.volumeMt;
    const displayTotalValue = convert(totalQuoteValue);

    return {
      rawMtUsd: rawUsdMt,
      oceanFreightUsd: oceanFreightUsdMt,
      totalUsd: totalUsdMtBeforeYield,
      yieldLoss: config.yieldLossMultiplier,
      totalCostOfRawsCad: convert(totalCadMtBase),
      marginCadMt: convert(config.refiningMarginCadMt),
      fcaHamiltonBulk: convert(fcaHamiltonBulk),
      fcaVancouverBulk: convert(fcaVancouverBulk),
      vancouverSupplyChainCost: convert(totalSupplyChainCostPerMt),
      differential: convert(selectedSku.premiumCadMt),
      deliveredFreight: config.isDelivered ? convert(freightCost / (config.volumePerLoadMt || 1)) : 0,
      exportDuty: convertUsd(config.exportDutyUsdMt),
      palletCharge: config.isPalletCharge ? convert(config.palletCostCadMt) : 0,
      finalMt: displayFinalMt,
      perUnit: displayPerUnit,
      totalQuoteValue: displayTotalValue,
      selectedSku,
      currencySymbol: isUsd ? 'USD' : 'CAD',
      freightCost: convert(freightCost),
      totalSupplyChainCostPerMt: convert(totalSupplyChainCostPerMt)
    };
  }, [config, selectedSkuId, skus, freightRates, supplyChain]);

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const getSortedAndFilteredData = <T extends Record<string, any>>(data: T[], searchFields: (keyof T)[]) => {
    if (!Array.isArray(data)) return [];
    let filtered = data;
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = data.filter(item => {
        if (!item) return false;
        return searchFields.some(field =>
          String(item[field] ?? '').toLowerCase().includes(lowerSearch)
        );
      });
    }

    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a?.[sortConfig.key as keyof T] ?? '';
        const bVal = b?.[sortConfig.key as keyof T] ?? '';
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  };

  const handleInputChange = (field: keyof CommodityConfig, value: string) => {
    if (field === 'contractStartDate' || field === 'contractEndDate') {
      setConfig(prev => ({ ...prev, [field]: value }));
      return;
    }
    const numValue = parseFloat(value) || 0;
    setConfig(prev => {
      const next = { ...prev, [field]: numValue };
      
      // Auto-calculate Delivered Freight per MT if source values change
      if (field === 'freightCostTotalCad' || field === 'volumePerLoadMt') {
        const volume = field === 'volumePerLoadMt' ? numValue : prev.volumePerLoadMt;
        const total = field === 'freightCostTotalCad' ? numValue : prev.freightCostTotalCad;
        if (volume > 0) {
          next.deliveredFreightCadMt = Math.round((total / volume) * 100) / 100;
        }
      }
      
      return next;
    });
  };

  const handleToggleChange = (field: keyof CommodityConfig) => {
    setConfig(prev => ({ ...prev, [field]: !prev[field] }));
  };


  const togglePageVisibility = useCallback((pageName: string) => {
    setHiddenPages(prev => {
      const next = new Set(prev);
      if (next.has(pageName)) {
        next.delete(pageName);
      } else {
        next.add(pageName);
        // If hiding the active page, switch to Dashboard
        if (activePage === pageName) setActivePage('Dashboard');
      }
      localStorage.setItem('sweetpro-hidden-pages', JSON.stringify([...next]));
      return next;
    });
  }, [activePage]);

  const defaultNavItems = [
    { name: 'Dashboard', icon: TrendingUp },
    { name: 'Customer Quote', icon: Calculator },
    { name: 'Shipment Schedule', icon: Calendar },
    { name: 'Hamilton Shipments', icon: Calendar },
    { name: 'Vancouver Shipments', icon: Calendar },
    { name: 'Customers', icon: Users },
    { name: 'Supply Chain', icon: Truck },
    { name: 'Contracts', icon: FileText },
    { name: 'Transfers', icon: ArrowRightLeft },
    { name: 'Orders', icon: ShoppingCart },
    { name: 'Invoices', icon: FileText },
    { name: 'US #11 Market', icon: TrendingUp },
    { name: 'Products', icon: Package },
    { name: 'Conferences', icon: Users },
    { name: 'Sales Leads', icon: Users },
    { name: 'People', icon: Users },
    { name: 'Quality Assurance', icon: ClipboardCheck },
    { name: 'Vendors', icon: Briefcase },
  ];

  // Apply saved page order (any new pages not in saved order appear at the end)
  const navItems = useMemo(() => {
    if (pageOrder.length === 0) return defaultNavItems;
    const orderMap = new Map<string, number>(pageOrder.map((name, idx) => [name, idx]));
    return [...defaultNavItems].sort((a, b) => {
      const aIdx: number = orderMap.get(a.name) ?? 999;
      const bIdx: number = orderMap.get(b.name) ?? 999;
      return aIdx - bIdx;
    });
  }, [pageOrder]);

  const [draggedPage, setDraggedPage] = useState<string | null>(null);
  const [dragOverPage, setDragOverPage] = useState<string | null>(null);

  const handlePageDragStart = useCallback((pageName: string) => {
    setDraggedPage(pageName);
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent, pageName: string) => {
    e.preventDefault();
    if (pageName !== draggedPage) setDragOverPage(pageName);
  }, [draggedPage]);

  const handlePageDrop = useCallback((targetPage: string) => {
    if (!draggedPage || draggedPage === targetPage) {
      setDraggedPage(null);
      setDragOverPage(null);
      return;
    }
    const currentOrder = pageOrder.length > 0 ? [...pageOrder] : defaultNavItems.map(n => n.name);
    const fromIdx = currentOrder.indexOf(draggedPage);
    const toIdx = currentOrder.indexOf(targetPage);
    if (fromIdx < 0 || toIdx < 0) return;
    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, draggedPage);
    setPageOrder(currentOrder);
    localStorage.setItem('sweetpro-page-order', JSON.stringify(currentOrder));
    setDraggedPage(null);
    setDragOverPage(null);
  }, [draggedPage, pageOrder]);

  const handlePageDragEnd = useCallback(() => {
    setDraggedPage(null);
    setDragOverPage(null);
  }, []);

  const renderContent = () => {
    try {
    if (activePage === 'Dashboard') {
      const completedShipments = [...hamiltonShipments, ...vancouverShipments].filter(s => s.status === 'Completed');
      
      // Weekly Totals
      const weeklyTotals: { [week: string]: { volume: number, tolling: number } } = {};
      completedShipments.forEach(s => {
        if (!weeklyTotals[s.week]) weeklyTotals[s.week] = { volume: 0, tolling: 0 };
        weeklyTotals[s.week].volume += s.qty;
        weeklyTotals[s.week].tolling += s.qty * config.refiningMarginCadMt;
      });

      // Volume by Customer
      const customerVolume: { [week: string]: { [customer: string]: number } } = {};
      completedShipments.forEach(s => {
        if (!customerVolume[s.week]) customerVolume[s.week] = {};
        if (!customerVolume[s.week][s.customer]) customerVolume[s.week][s.customer] = 0;
        customerVolume[s.week][s.customer] += s.qty;
      });

      // Volume by Product
      const productVolume: { [week: string]: { [product: string]: number } } = {};
      completedShipments.forEach(s => {
        if (!productVolume[s.week]) productVolume[s.week] = {};
        if (!productVolume[s.week][s.product]) productVolume[s.week][s.product] = 0;
        productVolume[s.week][s.product] += s.qty;
      });

      const sortedWeeks = Object.keys(weeklyTotals).sort((a, b) => {
        const aNum = parseInt(a.replace('Week ', ''));
        const bNum = parseInt(b.replace('Week ', ''));
        return bNum - aNum; // Newest first
      });

      return (
        <div className="p-6 space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Operational Dashboard</h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Weekly Totals Table */}
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <div className="bg-[#141414] text-[#E4E3E0] p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest">Weekly Completed Totals</h3>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                    <th className="p-4">Week</th>
                    <th className="p-4">Total Volume (MT)</th>
                    <th className="p-4">Total Tolling Fees (CAD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedWeeks.map(week => (
                    <tr key={week} className="hover:bg-[#F9F9F9]">
                      <td className="p-4 text-xs font-bold">{week}</td>
                      <td className="p-4 text-xs font-bold">{weeklyTotals[week].volume.toLocaleString()} MT</td>
                      <td className="p-4 text-xs font-bold">CAD ${weeklyTotals[week].tolling.toLocaleString()}</td>
                    </tr>
                  ))}
                  {sortedWeeks.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-xs opacity-50 italic">No completed shipments found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Volume by Customer */}
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <div className="bg-[#141414] text-[#E4E3E0] p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest">Weekly Volume by Customer (MT)</h3>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                    <th className="p-4">Week</th>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Volume (MT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedWeeks.flatMap(week => 
                    Object.entries(customerVolume[week]).map(([cust, vol], i) => (
                      <tr key={`${week}-${cust}`} className="hover:bg-[#F9F9F9]">
                        {i === 0 ? (
                          <td className="p-4 text-xs font-bold border-r border-[#141414]/10" rowSpan={Object.keys(customerVolume[week]).length}>
                            {week}
                          </td>
                        ) : null}
                        <td className="p-4 text-xs border-r border-[#141414]/10">{cust}</td>
                        <td className="p-4 text-xs font-bold">{vol.toLocaleString()} MT</td>
                      </tr>
                    ))
                  )}
                  {sortedWeeks.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-xs opacity-50 italic">No data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Volume by Product */}
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] lg:col-span-2 overflow-hidden">
              <div className="bg-[#141414] text-[#E4E3E0] p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest">Weekly Volume by Product (MT)</h3>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[10px] uppercase font-bold border-b border-[#141414]">
                    <th className="p-4">Week</th>
                    <th className="p-4">Product</th>
                    <th className="p-4">Volume (MT)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedWeeks.flatMap(week => 
                    Object.entries(productVolume[week]).map(([prod, vol], i) => (
                      <tr key={`${week}-${prod}`} className="hover:bg-[#F9F9F9]">
                        {i === 0 ? (
                          <td className="p-4 text-xs font-bold border-r border-[#141414]/10" rowSpan={Object.keys(productVolume[week]).length}>
                            {week}
                          </td>
                        ) : null}
                        <td className="p-4 text-xs border-r border-[#141414]/10">{prod}</td>
                        <td className="p-4 text-xs font-bold">{vol.toLocaleString()} MT</td>
                      </tr>
                    ))
                  )}
                  {sortedWeeks.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-xs opacity-50 italic">No data available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (activePage === 'Shipment Schedule') {
      const locationName = scheduleLocation;
      const locationShipments = locations.find(l => l.name.toLowerCase().includes(locationName.toLowerCase()))?.name.toLowerCase().includes('hamilton')
        ? hamiltonShipments
        : vancouverShipments;
      const currentWeekNum = getWeekNumber(new Date().toISOString().split('T')[0]);
      const currentWeek = `Week ${currentWeekNum}`;
      const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

      const locationObj = locations.find(l => l.name.toLowerCase().includes(locationName.toLowerCase()));
      const locationBays = locationObj ? locationObj.bays : ['BAY 1', 'BAY 2'];
      const locStartTime = locationObj?.appointmentStartTime || '06:00';
      const locEndTime = locationObj?.appointmentEndTime || '18:00';
      const locDuration = locationObj?.appointmentDuration || 30;
      const locationTimeSlots = generateTimeSlots(locStartTime, locEndTime, locDuration);

      const filteredShipments = locationShipments.filter(s => {
        const matchesSearch = !searchTerm ||
          (s.customer || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.product || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.bol || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.carrier || '').toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      });

      // Group by Week -> Bay -> Day -> Time
      const groupedData: { [week: string]: { [bay: string]: { [day: string]: { [time: string]: Shipment[] } } } } = {};
      weeksList.forEach(w => {
        groupedData[w] = {};
        locationBays.forEach(b => {
          groupedData[w][b] = {};
          daysList.forEach(d => { groupedData[w][b][d] = {}; });
        });
      });
      filteredShipments.forEach(s => {
        if (groupedData[s.week]?.[s.bay]?.[s.day]) {
          if (!groupedData[s.week][s.bay][s.day][s.time]) groupedData[s.week][s.bay][s.day][s.time] = [];
          groupedData[s.week][s.bay][s.day][s.time].push(s);
        }
      });

      const visibleWeeks = showPreviousWeeks
        ? weeksList
        : weeksList.filter(w => parseInt(w.replace('Week ', '')) >= Number(currentWeekNum));

      const isCurrentWeekExpanded = (week: string) => {
        if (week === currentWeek) return !expandedRows.has(`collapse-${week}`);
        return expandedRows.has(week);
      };

      // For current week, auto-expand all days
      const isDayExpandedSchedule = (dayKey: string, isCurrentWk: boolean) => {
        if (isCurrentWk) return !expandedDays.has(`collapse-sched-${dayKey}`);
        return expandedDays.has(dayKey);
      };

      // Status badge helper
      const statusBadge = (status: string) => {
        const sl = (status || '').toLowerCase();
        const cls = sl.includes('confirmed') ? 'bg-emerald-100 text-emerald-700' : sl.includes('pending') ? 'bg-amber-100 text-amber-700' : sl.includes('completed') ? 'bg-blue-100 text-blue-700' : sl.includes('cancelled') ? 'bg-red-100 text-red-700' : sl.includes('in progress') ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700';
        return <span className={`px-1 py-0 rounded-full font-bold uppercase text-[7px] whitespace-nowrap ${cls}`}>{status}</span>;
      };

      // Bay column headers for side-by-side layout
      const bayColumns = ['Client', 'Product', 'PO', 'BOL', 'QTY', 'Carrier', 'Arrives', 'Start', 'Out'];

      return (
        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="space-y-0.5">
              <h2 className="text-xl font-bold uppercase tracking-tighter">Shipment Schedule</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} />
                Last Updated: {new Date().toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-2">
                <label className="text-[10px] uppercase font-bold opacity-60">Location</label>
                <select
                  value={scheduleLocation}
                  onChange={(e) => setScheduleLocation(e.target.value)}
                  className="bg-white border border-[#141414] px-3 py-1.5 text-sm font-bold focus:outline-none"
                >
                  {locations.map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                </select>
              </div>
              <button onClick={() => setShowPreviousWeeks(!showPreviousWeeks)}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5] transition-all">
                {showPreviousWeeks ? 'Hide Previous Weeks' : 'Show Previous Weeks'}
              </button>
            </div>
          </div>

          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search by customer, product, BOL, or carrier..." />

          <div className="space-y-2">
            {visibleWeeks.map(week => {
              const isCurrentWk = week === currentWeek;
              const isExpanded = isCurrentWeekExpanded(week);
              const weekShipmentCount = locationBays.reduce((sum, bay) =>
                sum + daysList.reduce((daySum, day) =>
                  daySum + Object.values(groupedData[week]?.[bay]?.[day] || {}).reduce((tSum, arr) => tSum + arr.length, 0), 0), 0);

              return (
                <div key={week} className={`bg-white border-2 overflow-hidden ${isCurrentWk ? 'border-emerald-500 shadow-[2px_2px_0px_0px_rgba(16,185,129,0.6)]' : 'border-[#141414] shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]'}`}>
                  <button
                    onClick={() => {
                      const next = new Set(expandedRows);
                      if (isCurrentWk) {
                        const collapseKey = `collapse-${week}`;
                        if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey);
                      } else {
                        if (next.has(week)) next.delete(week); else next.add(week);
                      }
                      setExpandedRows(next);
                    }}
                    className={`w-full px-3 py-2 flex justify-between items-center hover:bg-opacity-90 transition-all ${isCurrentWk ? 'bg-emerald-600 text-white' : 'bg-[#141414] text-[#E4E3E0]'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest">{week} {isCurrentWk ? '(CURRENT WEEK)' : ''}</span>
                      {weekShipmentCount > 0 && <span className="text-[9px] font-bold bg-white/20 px-1.5 py-0.5 rounded-full">{weekShipmentCount} shipments</span>}
                    </div>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="p-2 space-y-1">
                          {daysList.map(day => {
                            const dayKey = `sched-${week}-${day}`;
                            const isDayExp = isDayExpandedSchedule(dayKey, isCurrentWk);
                            const weekNum = parseInt(week.replace('Week ', ''));
                            const dateObj = getDateForWeekDay(weekNum, day);
                            const dateStr = toLocalDateString(dateObj);
                            const displayDate = formatDateMMM_DD(dateStr);
                            const isToday = isCurrentWk && day === currentDay;
                            const shipmentCount = locationBays.reduce((sum, bay) =>
                              sum + Object.values(groupedData[week]?.[bay]?.[day] || {}).reduce((tSum, arr) => tSum + arr.length, 0), 0);

                            return (
                              <div key={day} className={`border overflow-hidden ${isToday ? 'border-emerald-400 bg-emerald-50/30' : 'border-[#141414]/10'}`}>
                                <button
                                  onClick={() => {
                                    const next = new Set(expandedDays);
                                    if (isCurrentWk) {
                                      const collapseKey = `collapse-sched-${dayKey}`;
                                      if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey);
                                    } else {
                                      if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey);
                                    }
                                    setExpandedDays(next);
                                  }}
                                  className={`w-full px-2 py-1 flex justify-between items-center transition-all ${isToday ? 'bg-emerald-100 hover:bg-emerald-200' : 'bg-[#F9F9F9] hover:bg-[#F0F0F0]'}`}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className={`text-[10px] font-black uppercase tracking-wider ${isToday ? 'text-emerald-800' : ''}`}>{day}</span>
                                    <span className="text-[10px] font-bold opacity-50">{displayDate}</span>
                                    {shipmentCount > 0 && <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{shipmentCount}</span>}
                                  </div>
                                  {isDayExp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>

                                {isDayExp && (
                                  <div className="overflow-x-auto">
                                    <table className="text-left border-collapse w-max">
                                      <thead>
                                        <tr className="bg-[#141414] text-[#E4E3E0] text-[7px] uppercase font-bold">
                                          <th className="px-1 py-0.5 border-r border-[#E4E3E0]/20 whitespace-nowrap">Time</th>
                                          {locationBays.map(bay => (
                                            <th key={bay} colSpan={bayColumns.length} className="px-1 py-0.5 border-r border-[#E4E3E0]/20 text-center whitespace-nowrap">{bay}</th>
                                          ))}
                                        </tr>
                                        <tr className="bg-[#F5F5F5] text-[7px] uppercase font-bold border-b border-[#141414]/10">
                                          <th className="px-1 py-0.5 border-r border-[#141414]/10"></th>
                                          {locationBays.map(bay => bayColumns.map(col => (
                                            <th key={`${bay}-${col}`} className="px-1 py-0.5 border-r border-[#141414]/5 whitespace-nowrap">{col}</th>
                                          )))}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {locationTimeSlots.map(slot => {
                                          return (
                                            <tr key={slot} className="border-b border-[#141414]/5 hover:bg-[#F5F5F5] transition-colors">
                                              <td className="px-1 py-0.5 text-[8px] font-mono font-bold border-r border-[#141414]/10 whitespace-nowrap">{slot}</td>
                                              {locationBays.map(bay => {
                                                const shipments = groupedData[week]?.[bay]?.[day]?.[slot] || [];
                                                const s = shipments[0];
                                                if (!s) {
                                                  return bayColumns.map((col, ci) => (
                                                    <td key={`${bay}-${slot}-${ci}`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 opacity-15">—</td>
                                                  ));
                                                }
                                                return [
                                                  <td key={`${bay}-${slot}-cust`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 font-black whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.customer}</td>,
                                                  <td key={`${bay}-${slot}-prod`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.product}</td>,
                                                  <td key={`${bay}-${slot}-po`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.po}</td>,
                                                  <td key={`${bay}-${slot}-bol`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 font-mono whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.bol}</td>,
                                                  <td key={`${bay}-${slot}-qty`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.qty}</td>,
                                                  <td key={`${bay}-${slot}-car`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.carrier}</td>,
                                                  <td key={`${bay}-${slot}-arr`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.arrive}</td>,
                                                  <td key={`${bay}-${slot}-srt`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.start}</td>,
                                                  <td key={`${bay}-${slot}-out`} className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 whitespace-nowrap" style={{ backgroundColor: s.color || undefined }}>{s.out}</td>,
                                                ];
                                              })}
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (activePage === 'Hamilton Shipments' || activePage === 'Vancouver Shipments') {
      const isHamiltonPage = activePage === 'Hamilton Shipments';
      const locationName = isHamiltonPage ? 'Hamilton' : 'Vancouver';
      const locationShipments = isHamiltonPage ? hamiltonShipments : vancouverShipments;
      const currentWeekNum = getWeekNumber(new Date().toISOString().split('T')[0]);
      const currentWeek = `Week ${currentWeekNum}`;
      const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

      const locationObj = locations.find(l => l.name.toLowerCase().includes(locationName.toLowerCase()));
      const locationBays = locationObj ? locationObj.bays : (isHamiltonPage ? ['BAY 1 (W) - FERGUSON AVE.', 'BAY 2 (E) - WELLINGTON ST.', 'BAY 3 - MOLASSES, DRY DOCKS'] : ['BAY 1', 'BAY 2']);
      const locStartTime = locationObj?.appointmentStartTime || '06:00';
      const locEndTime = locationObj?.appointmentEndTime || '18:00';
      const locDuration = locationObj?.appointmentDuration || 30;
      const locationTimeSlots = generateTimeSlots(locStartTime, locEndTime, locDuration);

      const filteredShipments = locationShipments.filter(s => {
        const matchesSearch = !searchTerm ||
          (s.customer || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.product || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.po || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.bol || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.carrier || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.contractNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (s.notes || '').toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      });

      // Group by Week -> Bay -> Day -> Time
      const groupedData: { [week: string]: { [bay: string]: { [day: string]: { [time: string]: Shipment[] } } } } = {};
      weeksList.forEach(w => {
        groupedData[w] = {};
        locationBays.forEach(b => {
          groupedData[w][b] = {};
          daysList.forEach(d => { groupedData[w][b][d] = {}; });
        });
      });
      filteredShipments.forEach(s => {
        if (groupedData[s.week]?.[s.bay]?.[s.day]) {
          if (!groupedData[s.week][s.bay][s.day][s.time]) groupedData[s.week][s.bay][s.day][s.time] = [];
          groupedData[s.week][s.bay][s.day][s.time].push(s);
        }
      });

      const visibleWeeks = showPreviousWeeks
        ? weeksList
        : weeksList.filter(w => parseInt(w.replace('Week ', '')) >= Number(currentWeekNum));

      // Current week is expanded by default, but can be collapsed by the user
      const isCurrentWeekExpanded = (week: string) => {
        if (week === currentWeek) return !expandedRows.has(`collapse-${week}`);
        return expandedRows.has(week);
      };

      return (
        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div className="space-y-0.5">
              <h2 className="text-xl font-bold uppercase tracking-tighter">{locationName} Shipment Schedule</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} className="" />
                Last Updated: {new Date().toLocaleString()}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPreviousWeeks(!showPreviousWeeks)}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase hover:bg-[#F5F5F5] transition-all">
                {showPreviousWeeks ? 'Hide Previous Weeks' : 'Show Previous Weeks'}
              </button>
              <button onClick={() => {
                  const headers = ['id', 'date', 'deliveryDate', 'time', 'bay', 'customer', 'product', 'contractNumber', 'po', 'bol', 'qty', 'scaledQty', 'carrier', 'trailerNo', 'colour', 'status', 'lotNumber'];
                  const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
                  const link = document.createElement("a");
                  link.setAttribute("href", encodeURI(csvContent));
                  link.setAttribute("download", "shipment_template.csv");
                  document.body.appendChild(link); link.click(); document.body.removeChild(link);
                }}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-[#F5F5F5] transition-all">
                <Download size={12} /> Template
              </button>
              <button onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-[#F5F5F5] transition-all">
                <FileText size={12} /> Import CSV
              </button>
              <button onClick={() => setIsAddingBatchShipment(true)}
                className="px-3 py-1.5 border border-[#141414] text-[#141414] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                <Plus size={12} /> Batch
              </button>
              <button onClick={() => { setShipmentSearchCustomer(''); setShipmentSearchBOL(''); setShipmentSearchTransfer(''); setIsAddingShipment(true); }}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1 hover:bg-opacity-80 transition-all">
                <Plus size={12} /> Add Shipment
              </button>
            </div>
          </div>

          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search by customer, product, PO, BOL, carrier, contract or notes..." />

          <div className="space-y-2">
            {visibleWeeks.map(week => {
              const isCurrentWk = week === currentWeek;
              const isExpanded = isCurrentWeekExpanded(week);

              return (
                <div key={week} className={`bg-white border-2 overflow-hidden ${isCurrentWk ? 'border-emerald-500 shadow-[2px_2px_0px_0px_rgba(16,185,129,0.6)]' : 'border-[#141414] shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]'}`}>
                  <button
                    onClick={() => {
                      const next = new Set(expandedRows);
                      if (isCurrentWk) {
                        const collapseKey = `collapse-${week}`;
                        if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey);
                      } else {
                        if (next.has(week)) next.delete(week); else next.add(week);
                      }
                      setExpandedRows(next);
                    }}
                    className={`w-full px-3 py-2 flex justify-between items-center hover:bg-opacity-90 transition-all ${isCurrentWk ? 'bg-emerald-600 text-white' : 'bg-[#141414] text-[#E4E3E0]'}`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-widest">{week} {isCurrentWk ? '(CURRENT WEEK)' : ''}</span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="p-2 space-y-2">
                          {locationBays.map(bay => {
                            const bayKey = `${week}-${bay}`;
                            const isBayExpanded = expandedBays.has(bayKey);

                            return (
                              <div key={bay} className="border border-[#141414] overflow-hidden">
                                <button
                                  onClick={() => {
                                    const next = new Set(expandedBays);
                                    if (next.has(bayKey)) next.delete(bayKey); else next.add(bayKey);
                                    setExpandedBays(next);
                                  }}
                                  className="w-full px-2 py-1.5 bg-[#F5F5F5] flex justify-between items-center hover:bg-[#E4E3E0] transition-all border-b border-[#141414]"
                                >
                                  <span className="text-[10px] font-black uppercase tracking-widest">{bay}</span>
                                  {isBayExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>

                                {isBayExpanded && (
                                  <div className="space-y-1 bg-white p-1">
                                    {daysList.map(day => {
                                      const dayKey = `${week}-${bay}-${day}`;
                                      const isDayExpanded = expandedDays.has(dayKey);
                                      const weekNum = parseInt(week.replace('Week ', ''));
                                      const dateObj = getDateForWeekDay(weekNum, day);
                                      const dateStr = toLocalDateString(dateObj);
                                      const displayDate = formatDateMMM_DD(dateStr);
                                      const isToday = isCurrentWk && day === currentDay;

                                      // Get all shipments for this day (including outside 6-18 range)
                                      const dayShipments = groupedData[week]?.[bay]?.[day] || {};
                                      const allDayTimes = Object.keys(dayShipments).filter(t => dayShipments[t]?.length > 0);
                                      // Times outside display range that have shipments
                                      const outsideRangeTimes = allDayTimes.filter(t => !locationTimeSlots.includes(t));
                                      const shipmentCount = Object.values(dayShipments).reduce((sum, arr) => sum + arr.length, 0);

                                      return (
                                        <div key={day} className={`border overflow-hidden ${isToday ? 'border-emerald-400 bg-emerald-50/30' : 'border-[#141414]/10'}`}>
                                          <button
                                            onClick={() => {
                                              const next = new Set(expandedDays);
                                              if (next.has(dayKey)) next.delete(dayKey); else next.add(dayKey);
                                              setExpandedDays(next);
                                            }}
                                            className={`w-full px-2 py-1 flex justify-between items-center transition-all ${isToday ? 'bg-emerald-100 hover:bg-emerald-200' : 'bg-[#F9F9F9] hover:bg-[#F0F0F0]'}`}
                                          >
                                            <div className="flex items-center gap-3">
                                              <span className={`text-[10px] font-black uppercase tracking-wider ${isToday ? 'text-emerald-800' : ''}`}>{day}</span>
                                              <span className="text-[10px] font-bold opacity-50">{displayDate}</span>
                                              {shipmentCount > 0 && <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{shipmentCount}</span>}
                                            </div>
                                            {isDayExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                          </button>

                                          {isDayExpanded && (
                                            <div className="overflow-x-auto">
                                              <table className="w-full text-left border-collapse">
                                                <thead>
                                                  <tr className="bg-white text-[8px] uppercase font-bold border-b border-[#141414]/10">
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5 w-12">Time</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Delivery Date</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Customer</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Product</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Contract</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">PO</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">BOL</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">QTY</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Scaled Qty (MT)</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Carrier</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Trailer No</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Colour</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Arrive</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Start</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Out</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Status</th>
                                                    <th className="px-1 py-0.5 border-r border-[#141414]/5">Lot Number</th>
                                                    <th className="px-1 py-0.5 w-16">Actions</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {/* Out-of-range shipments (before schedule start) */}
                                                  {outsideRangeTimes.filter(t => t < locStartTime).sort().map(slot => (
                                                    dayShipments[slot]?.map(s => (
                                                      <tr key={s.id} className="hover:bg-amber-50 transition-colors border-b border-[#141414]/5 bg-amber-50/50" style={{ backgroundColor: s.color || undefined }}>
                                                        <td className="px-1 py-0.5 text-[9px] font-mono font-bold border-r border-[#141414]/5">{slot}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.deliveryDate || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-black">{s.customer}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 truncate max-w-[100px]">{s.product}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.contractNumber || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.po}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.bol}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.qty}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.scaledQty || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.carrier}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.trailerNo || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.colour || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.arrive}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.start}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.out}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">
                                                          <select value={s.status} onChange={(e) => updateShipmentStatus(s.id, e.target.value)}
                                                            className={`px-1 py-0 rounded-full font-bold uppercase text-[7px] focus:outline-none cursor-pointer ${(s.status || '').toLowerCase().includes('confirmed') ? 'bg-emerald-100 text-emerald-700' : (s.status || '').toLowerCase().includes('completed') ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                                            <option value="Confirmed">Confirmed</option><option value="In Progress">In Progress</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option>
                                                          </select>
                                                        </td>
                                                        <td className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 truncate max-w-[80px]" title={s.lotNumber || ''}>{s.lotNumber || '—'}</td>
                                                        <td className="px-1 py-0.5 text-xs">
                                                          <div className="flex gap-0.5">
                                                            <button onClick={() => setEditingShipment(s)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit"><Edit2 size={10} /></button>
                                                            <button onClick={() => deleteShipment(s.id)} className="p-0.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={10} /></button>
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    ))
                                                  ))}
                                                  {/* Standard time slots from location schedule */}
                                                  {locationTimeSlots.map(slot => {
                                                    const shipments = groupedData[week]?.[bay]?.[day]?.[slot] || [];
                                                    if (shipments.length === 0) {
                                                      return (
                                                        <tr key={slot} className="group hover:bg-[#F5F5F5] transition-colors border-b border-[#141414]/5">
                                                          <td className="px-1 py-0.5 text-[9px] font-mono border-r border-[#141414]/5 opacity-40">{slot}</td>
                                                          <td colSpan={16} className="px-1 py-0.5 text-[8px] italic opacity-20">—</td>
                                                          <td className="px-1 py-0.5">
                                                            <button onClick={() => {
                                                                setShipmentCreationData({ location: locationName as 'Hamilton' | 'Vancouver', date: dateStr, time: slot, bay, carrier: '', orderId: '' });
                                                                setIsCreatingTransferShipment(false);
                                                                setShipmentSearchCustomer(''); setShipmentSearchBOL(''); setShipmentSearchTransfer('');
                                                                setIsAddingShipment(true);
                                                              }}
                                                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Add Shipment">
                                                              <Plus size={10} />
                                                            </button>
                                                          </td>
                                                        </tr>
                                                      );
                                                    }
                                                    return shipments.map(s => (
                                                      <tr key={s.id} className="hover:bg-[#F5F5F5] transition-colors border-b border-[#141414]/5" style={{ backgroundColor: s.color || undefined }}>
                                                        <td className="px-1 py-0.5 text-[9px] font-mono font-bold border-r border-[#141414]/5">{slot}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.deliveryDate || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-black">{s.customer}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 truncate max-w-[100px]">{s.product}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.contractNumber || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.po}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.bol}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.qty}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.scaledQty || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.carrier}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.trailerNo || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.colour || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.arrive}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.start}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.out}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">
                                                          <select value={s.status} onChange={(e) => updateShipmentStatus(s.id, e.target.value)}
                                                            className={`px-1 py-0 rounded-full font-bold uppercase text-[7px] focus:outline-none cursor-pointer ${(s.status || '').toLowerCase().includes('confirmed') ? 'bg-emerald-100 text-emerald-700' : (s.status || '').toLowerCase().includes('completed') ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                                            <option value="Confirmed">Confirmed</option><option value="In Progress">In Progress</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option>
                                                          </select>
                                                        </td>
                                                        <td className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 truncate max-w-[80px]" title={s.lotNumber || ''}>{s.lotNumber || '—'}</td>
                                                        <td className="px-1 py-0.5">
                                                          <div className="flex gap-0.5">
                                                            <button onClick={() => {
                                                                setShipmentCreationData({ location: locationName as 'Hamilton' | 'Vancouver', date: dateStr, time: slot, bay, carrier: '', orderId: '' });
                                                                setIsCreatingTransferShipment(false);
                                                                setShipmentSearchCustomer(''); setShipmentSearchBOL(''); setShipmentSearchTransfer('');
                                                                setIsAddingShipment(true);
                                                              }}
                                                              className="p-0.5 hover:bg-emerald-600 hover:text-white transition-all" title="Add Shipment"><Plus size={10} /></button>
                                                            <button onClick={() => setEditingShipment(s)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit"><Edit2 size={10} /></button>
                                                            <button onClick={() => deleteShipment(s.id)} className="p-0.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={10} /></button>
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    ));
                                                  })}
                                                  {/* Out-of-range shipments (after schedule end) */}
                                                  {outsideRangeTimes.filter(t => t >= locEndTime).sort().map(slot => (
                                                    dayShipments[slot]?.map(s => (
                                                      <tr key={s.id} className="hover:bg-amber-50 transition-colors border-b border-[#141414]/5 bg-amber-50/50" style={{ backgroundColor: s.color || undefined }}>
                                                        <td className="px-1 py-0.5 text-[9px] font-mono font-bold border-r border-[#141414]/5">{slot}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.deliveryDate || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-black">{s.customer}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 truncate max-w-[100px]">{s.product}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.contractNumber || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.po}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5 font-mono">{s.bol}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.qty}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.scaledQty || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.carrier}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.trailerNo || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.colour || '—'}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.arrive}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.start}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">{s.out}</td>
                                                        <td className="px-1 py-0.5 text-[9px] border-r border-[#141414]/5">
                                                          <select value={s.status} onChange={(e) => updateShipmentStatus(s.id, e.target.value)}
                                                            className={`px-1 py-0 rounded-full font-bold uppercase text-[7px] focus:outline-none cursor-pointer ${(s.status || '').toLowerCase().includes('confirmed') ? 'bg-emerald-100 text-emerald-700' : (s.status || '').toLowerCase().includes('completed') ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                                            <option value="Confirmed">Confirmed</option><option value="In Progress">In Progress</option><option value="Completed">Completed</option><option value="Cancelled">Cancelled</option>
                                                          </select>
                                                        </td>
                                                        <td className="px-1 py-0.5 text-[8px] border-r border-[#141414]/5 truncate max-w-[80px]" title={s.lotNumber || ''}>{s.lotNumber || '—'}</td>
                                                        <td className="px-1 py-0.5 text-xs">
                                                          <div className="flex gap-0.5">
                                                            <button onClick={() => setEditingShipment(s)} className="p-0.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit"><Edit2 size={10} /></button>
                                                            <button onClick={() => deleteShipment(s.id)} className="p-0.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={10} /></button>
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    ))
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (activePage === 'Customers') {
      const filteredCustomers = getSortedAndFilteredData<Customer>(customers, ['name', 'defaultLocation', 'id']);

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Customer Directory</h2>
            <button 
              onClick={addCustomer}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
            >
              <Plus size={14} /> Add Customer
            </button>
          </div>
          
          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="Search customers by name, default location or ID..." 
          />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="No." sortKey="id" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Customer Name" sortKey="name" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Default Location" sortKey="defaultLocation" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Default Margin" sortKey="defaultMargin" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Payment Terms" sortKey="defaultPaymentTerms" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-4 border-r border-[#141414]/10">Salesperson</th>
                  <th className="p-4 border-r border-[#141414]/10">Default Carrier</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredCustomers.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="hover:bg-[#F9F9F9] transition-colors group">
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{c.id}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{c.name}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{c.defaultLocation}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{c.defaultMargin}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{c.defaultPaymentTerms || '—'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{c.salespersonId ? people.find(p => p.id === c.salespersonId)?.name || 'Unknown' : '-'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{c.defaultCarrierCode || '-'}</td>
                      <td className="p-4 text-xs flex items-center gap-2">
                        <button onClick={() => toggleRow(c.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="View Details">
                          {expandedRows.has(c.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button onClick={() => setEditingCustomer(c)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit Customer">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => deleteCustomer(c.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all" title="Delete Customer">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRows.has(c.id) && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden bg-[#F5F5F5] border-t border-[#141414]/10"
                            >
                              <div className="p-6 grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Salesperson</label>
                                    <select
                                      value={c.salespersonId || ''}
                                      onChange={(e) => updateCustomer(c.id, 'salespersonId', e.target.value || undefined)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                    >
                                      <option value="">Select a salesperson</option>
                                      {people.filter(p => p.department === 'sales').map(p => (
                                        <option key={p.id} value={p.id}>
                                          {p.name} ({p.salespersonNumber})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Default Carrier Code</label>
                                    <select
                                      value={c.defaultCarrierCode || ''}
                                      onChange={(e) => updateCustomer(c.id, 'defaultCarrierCode', e.target.value || undefined)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                    >
                                      <option value="">Select a carrier</option>
                                      {carriers.map(carrier => (
                                        <option key={carrier.id} value={carrier.carrierNumber}>
                                          {carrier.name} ({carrier.carrierNumber})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Email</label>
                                    <input
                                      type="email"
                                      value={c.contactEmail || ''}
                                      onChange={(e) => updateCustomer(c.id, 'contactEmail', e.target.value)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                      placeholder="email@example.com"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Phone</label>
                                    <input
                                      type="text"
                                      value={c.contactPhone || ''}
                                      onChange={(e) => updateCustomer(c.id, 'contactPhone', e.target.value)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                      placeholder="+1 (555) 000-0000"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">QA Contract Email</label>
                                    <input
                                      type="email"
                                      value={c.qaContractEmail || ''}
                                      onChange={(e) => updateCustomer(c.id, 'qaContractEmail', e.target.value)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                      placeholder="qa@customer.com"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Sales Contact Email</label>
                                    <input
                                      type="email"
                                      value={c.salesContactEmail || ''}
                                      onChange={(e) => updateCustomer(c.id, 'salesContactEmail', e.target.value)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                      placeholder="sales@customer.com"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Service Email</label>
                                    <input
                                      type="email"
                                      value={c.customerServiceEmail || ''}
                                      onChange={(e) => updateCustomer(c.id, 'customerServiceEmail', e.target.value)}
                                      className="w-full bg-white border border-[#141414]/20 p-2 text-xs"
                                      placeholder="service@customer.com"
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Internal Notes</label>
                                  <textarea
                                    value={c.notes || ''}
                                    onChange={(e) => updateCustomer(c.id, 'notes', e.target.value)}
                                    className="w-full bg-white border border-[#141414]/20 p-2 text-xs h-24 resize-none"
                                    placeholder="Add customer specific notes here..."
                                  />
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Transfers') {
      const filteredTransfers = getSortedAndFilteredData<Transfer>(transfers, ['transferNumber', 'from', 'to', 'carrier', 'product', 'status', 'lotCode']);

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Inventory Transfers</h2>
            <button
              onClick={() => {
                setEditingTransfer(null);
                setNewTransferLegs([]);
                setIsAddingTransfer(true);
              }}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
            >
              <Plus size={14} /> New Transfer
            </button>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search transfers by number, origin, destination, carrier, lot code..."
          />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="Transfer No." sortKey="transferNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="From" sortKey="from" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="To" sortKey="to" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Product" sortKey="product" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Lot Code" sortKey="lotCode" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Amount (MT)" sortKey="amount" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Carrier" sortKey="carrier" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-3 border-r border-[#E4E3E0]/20">Legs</th>
                  <SortableHeader label="Ship Date" sortKey="shipmentDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Arrival Date" sortKey="arrivalDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-3 border-r border-[#E4E3E0]/20">Appointment</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredTransfers.length === 0 && (
                  <tr>
                    <td colSpan={13} className="p-6 text-center text-xs font-bold opacity-40 italic">
                      No transfers yet. Use "New Transfer" to create one.
                    </td>
                  </tr>
                )}
                {filteredTransfers.map(t => {
                  const allShipments = [...hamiltonShipments, ...vancouverShipments];
                  const transferShipment = allShipments.find(s => s.notes === `TRANSFER:${t.id}`);
                  return (
                  <tr key={t.id} className="hover:bg-[#F9F9F9] transition-colors group">
                    <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{t.transferNumber}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.from}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.to}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{t.product}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10 font-mono">{t.lotCode || '—'}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{t.amount}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.carrier}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      {t.legs && t.legs.length > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[8px] uppercase">{t.legs.length} Leg{t.legs.length > 1 ? 's' : ''}</span>
                      ) : (
                        <span className="text-[10px] opacity-40">Direct</span>
                      )}
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.shipmentDate}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.arrivalDate}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <select
                        value={t.status}
                        onChange={(e) => {
                          const newStatus = e.target.value;
                          setTransfers(transfers.map(tr => tr.id === t.id ? { ...tr, status: newStatus } : tr));
                        }}
                        className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer ${
                          t.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                          t.status === 'In Transit' ? 'bg-blue-100 text-blue-700' :
                          t.status === 'Pending' ? 'bg-amber-100 text-amber-700' :
                          t.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <option value="Pending">Pending</option>
                        <option value="In Transit">In Transit</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      {transferShipment ? (
                        <select
                          value="scheduled"
                          onChange={(e) => {
                            if (e.target.value === 'edit') {
                              const loc = transferShipment.bay?.toLowerCase().includes('ferguson') ? 'Hamilton' : 'Vancouver';
                              setShipmentCreationData({ location: loc as 'Hamilton' | 'Vancouver', date: transferShipment.date, time: transferShipment.time, bay: transferShipment.bay, carrier: transferShipment.carrier, orderId: '', transferId: t.id });
                              setIsCreatingTransferShipment(true);
                              setIsCreatingShipments(true);
                            } else if (e.target.value === 'delete') {
                              setHamiltonShipments(hamiltonShipments.filter(s => s.notes !== `TRANSFER:${t.id}`));
                              setVancouverShipments(vancouverShipments.filter(s => s.notes !== `TRANSFER:${t.id}`));
                            }
                          }}
                          className="px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer bg-blue-100 text-blue-700"
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="edit">Edit Pick Up Appointment</option>
                          <option value="delete">Delete Pick Up Appointment</option>
                        </select>
                      ) : (
                        <button
                          onClick={() => {
                            const fromLoc = locations.find(l => l.name.toLowerCase().includes(t.from.toLowerCase()));
                            const loc = fromLoc ? fromLoc.name : 'Hamilton';
                            setShipmentCreationData({ location: loc as 'Hamilton' | 'Vancouver', date: t.shipmentDate || '', time: '', bay: '', carrier: t.carrier || '', orderId: '', transferId: t.id });
                            setIsCreatingTransferShipment(true);
                            setIsCreatingShipments(true);
                          }}
                          className="px-2 py-0.5 rounded-full font-bold uppercase text-[8px] bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all cursor-pointer whitespace-nowrap"
                        >
                          Create Pick Up Appointment
                        </button>
                      )}
                    </td>
                    <td className="p-3 text-xs flex items-center gap-1">
                      <button onClick={() => { setEditingTransfer({...t}); setIsAddingTransfer(false); }} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => setTransfers(transfers.filter(item => item.id !== t.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Invoices') {
      const filteredInvoices = getSortedAndFilteredData<Invoice>(invoices, ['bolNumber', 'customer', 'product', 'po', 'status']);

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Customer Invoices</h2>
            <div className="flex gap-2">
              <button className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                <Printer size={14} /> Batch Print
              </button>
              <button className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all">
                <Download size={14} /> Export All
              </button>
            </div>
          </div>

          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="Search invoices by BOL, Customer, PO, Product..." 
          />
          
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="BOL No." sortKey="bolNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Date" sortKey="date" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Customer" sortKey="customer" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Product" sortKey="product" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="PO No." sortKey="po" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Qty (MT)" sortKey="qty" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Amount (CAD)" sortKey="amount" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Status" sortKey="status" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Due Date" sortKey="dueDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Split No." sortKey="splitNo" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredInvoices.map(i => {
                  // Auto-calculate due date from invoice date + customer payment terms
                  const invoiceCustomer = customers.find(c => c.name === i.customer);
                  const paymentTermsStr = invoiceCustomer?.defaultPaymentTerms ? String(invoiceCustomer.defaultPaymentTerms) : '';
                  const paymentDays = paymentTermsStr ? parseInt(paymentTermsStr.match(/\d+/)?.[0] || '0') : 0;
                  const calculatedDueDate = (() => {
                    if (i.dueDate) return i.dueDate;
                    if (i.date && paymentDays) {
                      const d = new Date(i.date);
                      d.setDate(d.getDate() + paymentDays);
                      return d.toISOString().split('T')[0];
                    }
                    return '';
                  })();
                  const isOverdue = calculatedDueDate && new Date(calculatedDueDate) < new Date() && i.status !== 'Paid' && i.status !== 'Cancelled';
                  return (
                  <tr key={i.id} className="hover:bg-[#F9F9F9] transition-colors group cursor-pointer" onClick={() => setEditingInvoiceCard({ ...i, dueDate: calculatedDueDate || i.dueDate || '' })}>
                    <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{i.bolNumber}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.date}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{i.customer}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.product}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.po}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{i.qty}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">${i.amount.toLocaleString()}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={i.status}
                        onChange={(e) => updateInvoiceStatus(i.id, e.target.value)}
                        className="bg-transparent font-bold uppercase text-[10px] outline-none cursor-pointer hover:underline"
                        style={{ color: getStatusColor(i.status).text }}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Sent">Sent</option>
                        <option value="Paid">Paid</option>
                        <option value="Overdue">Overdue</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </td>
                    <td className={`p-4 text-xs border-r border-[#141414]/10 ${isOverdue ? 'text-red-600 font-bold' : ''}`}>
                      {calculatedDueDate || '—'}
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={i.splitNo || ''}
                        onChange={(e) => setInvoices(invoices.map(inv => inv.id === i.id ? { ...inv, splitNo: e.target.value } : inv))}
                        className="w-full bg-transparent focus:outline-none font-mono text-xs"
                        placeholder="—"
                      />
                    </td>
                    <td className="p-4 text-xs flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Print Invoice">
                        <Printer size={14} />
                      </button>
                      <button onClick={() => setInvoices(invoices.filter(item => item.id !== i.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Orders') {
      const filteredOrders = orders.filter(ord => {
        const matchesSearch = !searchTerm ||
          ord.bolNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
          ord.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ord.product || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          ord.lineItems.some(li => li.productName.toLowerCase().includes(searchTerm.toLowerCase())) ||
          ord.po.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (ord.carrier || '').toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      });

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Orders</h2>
            <div className="flex gap-4">
              <button
                onClick={() => setIsAddingBatchOrder(true)}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Plus size={14} /> Add Batch Orders
              </button>
              <button
                onClick={() => {
                  setOrderCustomerId('');
                  setOrderPO('');
                  setOrderLineItems([]);
                  setNewLineItem({ productName: '', qty: 0, contractNumber: '' });
                  setEditingOrder(null);
                  setIsAddingOrder(true);
                }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={14} /> Add Order
              </button>
            </div>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search orders by BOL, customer, product, PO or carrier..."
          />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <th className="p-3 border-r border-[#E4E3E0]/20">BOL Number</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Customer</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Product</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Contract #</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Total Weight (KG)</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">PO #</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Shipment Date</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Delivery Date</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Carrier</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Amount ($)</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Status</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Location</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Split No.</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Appointment</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={15} className="p-6 text-center text-xs font-bold opacity-40 italic">
                      No orders yet. Use "Add Order" to create new orders.
                    </td>
                  </tr>
                )}
                {filteredOrders.map(ord => {
                  const totalWeight = ord.lineItems.reduce((sum, item) => sum + item.totalWeight, 0);
                  const productDisplay = ord.product || ord.lineItems.map(li => li.productName).join(', ');
                  return (
                    <React.Fragment key={ord.id}>
                      <tr className="hover:bg-[#F9F9F9] transition-colors group">
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{ord.bolNumber}</td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{ord.customer}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10 truncate max-w-[180px]" title={productDisplay}>{productDisplay}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10 font-mono">{ord.contractNumber || ord.lineItems.map(li => li.contractNumber).filter(Boolean).join(', ') || '—'}</td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{(totalWeight * 1000).toFixed(0)}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{ord.po}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{ord.shipmentDate || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{ord.deliveryDate || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{ord.carrier || '—'}</td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">${ord.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          <select
                            value={ord.status}
                            onChange={(e) => {
                              const newStatus = e.target.value as Order['status'];
                              if (newStatus === 'Confirmed' || newStatus === 'Cancelled') {
                                setPendingStatusChange({ orderId: ord.id, newStatus });
                                setShowOrderConfirmation(true);
                              } else {
                                setOrders(orders.map(o => o.id === ord.id ? { ...o, status: newStatus } : o));
                              }
                            }}
                            className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer ${
                              ord.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' :
                              ord.status === 'Open' ? 'bg-amber-100 text-amber-700' :
                              ord.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                              'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <option value="Open">Open</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                        </td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{ord.location || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10 font-mono">{ord.splitNumber || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          {(() => {
                            const allShipments = [...hamiltonShipments, ...vancouverShipments];
                            const orderShipment = allShipments.find(s => s.bol === ord.bolNumber);
                            if (orderShipment) {
                              return (
                                <div className="relative">
                                  <select
                                    value="scheduled"
                                    onChange={(e) => {
                                      if (e.target.value === 'edit') {
                                        setShipmentCreationData({ location: orderShipment.bay?.toLowerCase().includes('ferguson') ? 'Hamilton' : 'Vancouver', date: orderShipment.date, time: orderShipment.time, bay: orderShipment.bay, carrier: orderShipment.carrier, orderId: ord.id });
                                        setIsCreatingTransferShipment(false);
                                        setIsCreatingShipments(true);
                                      } else if (e.target.value === 'delete') {
                                        setHamiltonShipments(hamiltonShipments.filter(s => s.bol !== ord.bolNumber));
                                        setVancouverShipments(vancouverShipments.filter(s => s.bol !== ord.bolNumber));
                                        setOrders(orders.map(o => o.id === ord.id ? { ...o, shipmentDate: undefined } : o));
                                      }
                                    }}
                                    className="px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer bg-blue-100 text-blue-700"
                                  >
                                    <option value="scheduled">Scheduled</option>
                                    <option value="edit">Edit Pick Up Appointment</option>
                                    <option value="delete">Delete Pick Up Appointment</option>
                                  </select>
                                </div>
                              );
                            } else if (ord.status === 'Confirmed') {
                              return (
                                <button
                                  onClick={() => {
                                    const customer = customers.find(c => c.name === ord.customer);
                                    const location = customer?.defaultLocation || 'Hamilton';
                                    setShipmentCreationData({ location, date: ord.shipmentDate || '', time: '', bay: '', carrier: ord.carrier || '', orderId: ord.id });
                                    setIsCreatingTransferShipment(false);
                                    setIsCreatingShipments(true);
                                  }}
                                  className="px-2 py-0.5 rounded-full font-bold uppercase text-[8px] bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-all cursor-pointer whitespace-nowrap"
                                >
                                  Create Pick Up Appointment
                                </button>
                              );
                            } else {
                              return <span className="text-[8px] uppercase font-bold opacity-30">—</span>;
                            }
                          })()}
                        </td>
                        <td className="p-4 text-xs flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (ord.status !== 'Open') {
                                setErrorBox('Only Open orders can be edited. This order is currently ' + ord.status + '.');
                                return;
                              }
                              const cust = customers.find(c => c.name === ord.customer);
                              setOrderCustomerId(cust?.id || '');
                              setOrderPO(ord.po);
                              setOrderShipmentDate(ord.shipmentDate || '');
                              setOrderDeliveryDate(ord.deliveryDate || '');
                              setOrderCarrier(ord.carrier || '');
                              setOrderShippingTerms(ord.shippingTerms || '');
                              setOrderLineItems(ord.lineItems);
                              if (cust) {
                                setFilteredOrderContracts(contracts.filter(c => c.customerNumber === cust.id));
                              }
                              setEditingOrder(ord);
                              setIsAddingOrder(false);
                            }}
                            className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                            title={ord.status !== 'Open' ? 'Only Open orders can be edited' : 'Edit order'}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => toggleRow(ord.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            {expandedRows.has(ord.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button onClick={() => setOrderDeleteConfirmId(ord.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      <AnimatePresence>
                        {expandedRows.has(ord.id) && (
                          <tr>
                            <td colSpan={13} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden bg-[#F5F5F5] border-t border-[#141414]/10"
                              >
                                <div className="p-6 space-y-4">
                                  <div className="grid grid-cols-4 gap-6">
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Order ID</div>
                                      <div className="text-xs font-bold">{ord.id}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Date Created</div>
                                      <div className="text-xs">{ord.date}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Total Weight (KG)</div>
                                      <div className="text-xs font-bold">{(totalWeight * 1000).toFixed(0)}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Status</div>
                                      <div className={`inline-block px-2 py-0.5 rounded-full font-bold uppercase text-[8px] ${
                                        ord.status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700' :
                                        ord.status === 'Open' ? 'bg-amber-100 text-amber-700' :
                                        'bg-red-100 text-red-700'
                                      }`}>{ord.status}</div>
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-3 gap-6">
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Shipment Date</div>
                                      <div className="text-xs font-bold">{ord.shipmentDate || '—'}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Delivery Date</div>
                                      <div className="text-xs font-bold">{ord.deliveryDate || '—'}</div>
                                    </div>
                                    <div>
                                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Carrier</div>
                                      <div className="text-xs font-bold">{ord.carrier || '—'}</div>
                                    </div>
                                  </div>

                                  {/* Line Items Display */}
                                  <div className="border border-[#141414]/10 overflow-hidden">
                                    <div className="bg-[#141414] text-[#E4E3E0] p-3">
                                      <h4 className="text-xs font-bold uppercase">Line Items</h4>
                                    </div>
                                    <table className="w-full text-xs">
                                      <thead className="bg-[#E4E3E0]/10 border-b border-[#141414]/10">
                                        <tr>
                                          <th className="p-3 text-left font-bold">Product</th>
                                          <th className="p-3 text-left font-bold">QTY (units)</th>
                                          <th className="p-3 text-left font-bold">Weight/Unit</th>
                                          <th className="p-3 text-left font-bold">Total Weight</th>
                                          <th className="p-3 text-left font-bold">Contract #</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#141414]/10">
                                        {ord.lineItems.map(item => (
                                          <tr key={item.id} className="hover:bg-[#141414]/5">
                                            <td className="p-3">{item.productName}</td>
                                            <td className="p-3">{item.qty}</td>
                                            <td className="p-3">{item.netWeightPerUnit}</td>
                                            <td className="p-3 font-bold">{item.totalWeight.toFixed(2)}</td>
                                            <td className="p-3">{item.contractNumber}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Products') {
      const filteredSkus = getSortedAndFilteredData<SKU>(skus, ['name', 'productGroup', 'id', 'location']);
      const filteredProductGroups = getSortedAndFilteredData<ProductGroup>(productGroups, ['name', 'id']);

      return (
        <div className="p-6 space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Product Catalog</h2>
            <div className="flex gap-2">
              <button
                onClick={addProductGroup}
                className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Plus size={14} /> Add Product Group
              </button>
              <div className="px-4 py-2 text-xs text-[#141414]/50 italic flex items-center">
                Manage products in QA page
              </div>
            </div>
          </div>

          {/* Product Groups Table */}
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest">Product Groups</h3>
              <button onClick={() => toggleRow('pg-table')} className="p-1 hover:bg-white hover:text-[#141414] transition-all">
                {expandedRows.has('pg-table') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>
            <AnimatePresence>
              {expandedRows.has('pg-table') && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                        <th className="p-4 border-r border-[#141414]/10">Group Name</th>
                        <th className="p-4 border-r border-[#141414]/10">BOL Code</th>
                        <th className="p-4 border-r border-[#141414]/10">Color Coding</th>
                        <th className="p-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/10">
                      {filteredProductGroups.map(pg => (
                        <tr key={pg.id} className="hover:bg-[#F9F9F9] transition-colors">
                          <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{pg.name}</td>
                          <td className="p-4 text-xs font-mono font-bold border-r border-[#141414]/10">{pg.bolCode || '—'}</td>
                          <td className="p-4 text-xs border-r border-[#141414]/10">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 border border-[#141414]/20" style={{ backgroundColor: pg.color }} />
                              <span className="text-[10px] opacity-50">{pg.color}</span>
                            </div>
                          </td>
                          <td className="p-4 text-xs flex gap-2">
                            <button onClick={() => setEditingProductGroup(pg)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                              <Edit2 size={14} />
                            </button>
                            <button onClick={() => setProductGroups(productGroups.filter(item => item.id !== pg.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="Search products by name, group, location or ID..." 
          />
          
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="Prod No." sortKey="id" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Name" sortKey="name" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Product Group" sortKey="productGroup" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Conv./Organic" sortKey="category" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Max Color" sortKey="maxColor" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Location" sortKey="location" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Net Weight (KG)" sortKey="netWeightKg" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Gross Weight (KG)" sortKey="grossWeightKg" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredSkus.map(s => {
                  const pg = productGroups.find(g => g.name === s.productGroup);
                  return (
                    <React.Fragment key={s.id}>
                      <tr className="hover:bg-[#F9F9F9] transition-colors group" style={{ borderLeft: pg ? `4px solid ${pg.color}` : 'none' }}>
                        <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{s.id}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{s.name}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">
                          <span className="px-2 py-0.5 border border-[#141414]/10 text-[10px] font-bold" style={{ backgroundColor: pg?.color }}>
                            {s.productGroup}
                          </span>
                        </td>
                        <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{s.category}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{s.maxColor}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">{s.location}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{s.netWeightKg || s.netWeight}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">{s.grossWeightKg || '-'}</td>
                        <td className="p-4 text-xs flex items-center gap-2">
                          <button onClick={() => toggleRow(s.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="View Details">
                            {expandedRows.has(s.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button onClick={() => setEditingSku(s)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit Differential">
                            <Edit2 size={14} />
                          </button>
                        </td>
                      </tr>
                      <AnimatePresence>
                        {expandedRows.has(s.id) && (
                          <tr>
                            <td colSpan={9} className="p-0">
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden bg-[#F5F5F5] border-t border-[#141414]/10"
                              >
                                {(() => {
                                  const qaP = qaProducts.find(q => q.skuId === s.id);
                                  return (
                                    <div className="p-6 space-y-6">
                                      {/* Row 1: Basic product info */}
                                      <div className="grid grid-cols-2 gap-6">
                                        <div className="space-y-4">
                                          <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                              <label className="text-[10px] uppercase font-bold opacity-50">Net Weight (KG)</label>
                                              <div className="text-xs font-bold">{s.netWeightKg || s.netWeight}</div>
                                            </div>
                                            <div className="space-y-1">
                                              <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (KG)</label>
                                              <div className="text-xs font-bold">{s.grossWeightKg || '-'}</div>
                                            </div>
                                            <div className="space-y-1">
                                              <label className="text-[10px] uppercase font-bold opacity-50">Max Color</label>
                                              <div className="text-xs font-bold">{s.maxColor}</div>
                                            </div>
                                            <div className="space-y-1">
                                              <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                                              <div className="text-xs font-bold">{s.brix}</div>
                                            </div>
                                          </div>
                                          <div className="space-y-1">
                                            <label className="text-[10px] uppercase font-bold opacity-50">Default Differential (CAD/MT)</label>
                                            <div className="text-xs font-bold">${s.premiumCadMt}</div>
                                          </div>
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[10px] uppercase font-bold opacity-50">Product Description</label>
                                          <div className="text-xs opacity-70 whitespace-pre-wrap">{s.description || 'No description provided.'}</div>
                                        </div>
                                      </div>

                                      {/* Row 2: QA Specifications */}
                                      {qaP && qaP.specifications && (
                                        <div className="space-y-2">
                                          <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 border-b border-[#141414]/10 pb-1">Specifications</h4>
                                          <div className="grid grid-cols-6 gap-3">
                                            {(['brix', 'granulation', 'color', 'ash', 'turbidity', 'moisture'] as const).map(spec => (
                                              <div key={spec} className="space-y-0.5">
                                                <label className="text-[10px] uppercase font-bold opacity-40">{spec}</label>
                                                <div className="text-xs font-bold">{qaP.specifications[spec] || '-'}</div>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {/* Row 3: Ti-Hi / Pallet Config */}
                                      {qaP && (qaP.ti || qaP.hi) && (
                                        <div className="space-y-2">
                                          <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 border-b border-[#141414]/10 pb-1">Pallet Configuration</h4>
                                          <div className="grid grid-cols-3 gap-3">
                                            <div className="space-y-0.5">
                                              <label className="text-[10px] uppercase font-bold opacity-40">Ti</label>
                                              <div className="text-xs font-bold">{qaP.ti || '-'}</div>
                                            </div>
                                            <div className="space-y-0.5">
                                              <label className="text-[10px] uppercase font-bold opacity-40">Hi</label>
                                              <div className="text-xs font-bold">{qaP.hi || '-'}</div>
                                            </div>
                                            <div className="space-y-0.5">
                                              <label className="text-[10px] uppercase font-bold opacity-40">Units per Pallet</label>
                                              <div className="text-xs font-bold">{qaP.unitsPerPallet || '-'}</div>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Row 4: Spec Sheets & Certificates */}
                                      {qaP && ((qaP.specSheets && qaP.specSheets.length > 0) || (qaP.certificates && qaP.certificates.length > 0)) && (
                                        <div className="grid grid-cols-2 gap-6">
                                          {/* Spec Sheets */}
                                          <div className="space-y-2">
                                            <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 border-b border-[#141414]/10 pb-1">Spec Sheets</h4>
                                            {qaP.specSheets && qaP.specSheets.length > 0 ? (
                                              <div className="space-y-1.5">
                                                {qaP.specSheets.map((doc: QADocument) => (
                                                  <div key={doc.id} className="flex items-center justify-between bg-white border border-[#141414]/10 px-3 py-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                      <FileText size={14} className="text-[#141414]/40 flex-shrink-0" />
                                                      <span className="text-xs font-bold truncate">{doc.filename}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                      <a href={doc.url} download={doc.filename} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download">
                                                        <Download size={12} />
                                                      </a>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="text-xs opacity-40 italic">No spec sheets</div>
                                            )}
                                          </div>

                                          {/* Certificates */}
                                          <div className="space-y-2">
                                            <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 border-b border-[#141414]/10 pb-1">Certificates</h4>
                                            {qaP.certificates && qaP.certificates.length > 0 ? (
                                              <div className="space-y-1.5">
                                                {qaP.certificates.map((doc: QADocument) => (
                                                  <div key={doc.id} className="flex items-center justify-between bg-white border border-[#141414]/10 px-3 py-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                      <FileText size={14} className="text-[#141414]/40 flex-shrink-0" />
                                                      <span className="text-xs font-bold truncate">{doc.filename}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                      <a href={doc.url} download={doc.filename} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download">
                                                        <Download size={12} />
                                                      </a>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div className="text-xs opacity-40 italic">No certificates</div>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Row 5: Packaging Pictures & Artwork */}
                                      {qaP && ((qaP.packagingPictureUrls && qaP.packagingPictureUrls.length > 0) || qaP.artworkUrl || qaP.upcImageUrl) && (
                                        <div className="space-y-2">
                                          <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 border-b border-[#141414]/10 pb-1">Images</h4>
                                          <div className="flex gap-4 flex-wrap">
                                            {qaP.packagingPictureUrls && qaP.packagingPictureUrls.map((url: string, idx: number) => (
                                              <div key={idx} className="space-y-1">
                                                <img src={url} alt={`Packaging ${idx + 1}`} className="w-24 h-24 object-cover border border-[#141414]/20" />
                                                <div className="text-[9px] opacity-40 text-center">Packaging</div>
                                              </div>
                                            ))}
                                            {qaP.artworkUrl && (
                                              <div className="space-y-1">
                                                <img src={qaP.artworkUrl} alt="Artwork" className="w-24 h-24 object-cover border border-[#141414]/20" />
                                                <div className="text-[9px] opacity-40 text-center">Artwork</div>
                                              </div>
                                            )}
                                            {qaP.upcImageUrl && (
                                              <div className="space-y-1">
                                                <img src={qaP.upcImageUrl} alt="UPC" className="w-24 h-24 object-cover border border-[#141414]/20" />
                                                <div className="text-[9px] opacity-40 text-center">UPC</div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}

                                      {/* Link to QA page */}
                                      {qaP && (
                                        <div className="text-[10px] opacity-40 italic pt-2 border-t border-[#141414]/10">
                                          To edit product details, spec sheets, certificates, or images, go to the Quality Assurance page.
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Conferences') {
      return (
        <ConferencesPage
          conferences={conferences}
          customers={customers}
          people={people}
          onAddConference={(newConference) => setConferences(prev => [...prev, newConference])}
          onUpdateConference={(updated) => setConferences(prev => prev.map(c => c.id === updated.id ? updated : c))}
          onDeleteConference={(id) => setConferences(prev => prev.filter(c => c.id !== id))}
          onAddMeeting={(conferenceId, newMeeting) => {
            setConferences(prev => prev.map(c =>
              c.id === conferenceId
                ? { ...c, meetings: [...(c.meetings || []), newMeeting] }
                : c
            ));
          }}
          onCreateSalesLead={(lead: SalesLead) => {
            setSalesLeads(prev => [...prev, lead]);
          }}
        />
      );
    }

    if (activePage === 'People') {
      return (
        <PeoplePage
          people={people}
          onAddPerson={(newPerson) => setPeople([...people, newPerson])}
          onUpdatePerson={(updated) => setPeople(people.map(p => p.id === updated.id ? updated : p))}
          onDeletePerson={(id) => setPeople(people.filter(p => p.id !== id))}
        />
      );
    }

    if (activePage === 'Quality Assurance') {
      return (
        <QualityAssurancePage
          qaProducts={qaProducts}
          skus={skus}
          people={people}
          productGroups={productGroups}
          locations={locations}
          vendors={vendors}
          onUpdateLocations={setLocations}
          onAddQAProduct={(product) => setQaProducts(prev => [...prev, product])}
          onUpdateQAProduct={(updated) => setQaProducts(prev => prev.map(p => p.id === updated.id ? updated : p))}
          onDeleteQAProduct={(id) => setQaProducts(prev => prev.filter(p => p.id !== id))}
        />
      );
    }

    if (activePage === 'Vendors') {
      const departmentCategories = ['sales', 'operations', 'logistics', 'customer service', 'QA', 'trading'];
      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Vendor Management</h2>
            <div className="flex gap-2">
              {/* Auto-add carriers as vendors */}
              <button
                onClick={() => {
                  const existingNames = new Set(vendors.map(v => v.name));
                  const newVendors: Vendor[] = carriers
                    .filter(c => !existingNames.has(c.name))
                    .map(c => ({
                      id: `VEND-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      vendorNumber: c.carrierNumber,
                      name: c.name,
                      category: 'logistics',
                      contactEmail: c.contactEmail || '',
                      contactPhone: c.contactPhone || '',
                    }));
                  if (newVendors.length > 0) {
                    setVendors(prev => [...prev, ...newVendors]);
                  }
                }}
                className="px-3 py-1.5 border border-[#141414] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Truck size={12} /> Sync Carriers as Vendors
              </button>
              <button
                onClick={() => {
                  const id = `VEND-${Date.now()}`;
                  setVendors(prev => [...prev, { id, vendorNumber: '', name: '', category: 'operations' }]);
                }}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Vendor
              </button>
            </div>
          </div>

          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search vendors by number, name or category..." />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                  <SortableHeader label="Vendor No." sortKey="vendorNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Name" sortKey="name" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Category" sortKey="category" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-4 border-r border-[#141414]/10">Email</th>
                  <th className="p-4 border-r border-[#141414]/10">Phone</th>
                  <th className="p-4 border-r border-[#141414]/10">Payment Terms</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {getSortedAndFilteredData<Vendor>(vendors, ['vendorNumber', 'name', 'category']).map(v => (
                  <tr key={v.id} className="hover:bg-[#F9F9F9] transition-colors">
                    <td className="p-4 text-xs font-mono border-r border-[#141414]/10">
                      <input type="text" value={v.vendorNumber} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, vendorNumber: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Vendor #" />
                    </td>
                    <td className="p-4 text-xs font-bold border-r border-[#141414]/10">
                      <input type="text" value={v.name} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, name: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Vendor Name" />
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">
                      <select value={v.category} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, category: e.target.value } : x))} className="w-full bg-transparent focus:outline-none">
                        {departmentCategories.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                      </select>
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">
                      <input type="email" value={v.contactEmail || ''} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, contactEmail: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Email" />
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">
                      <input type="text" value={v.contactPhone || ''} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, contactPhone: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Phone" />
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">
                      <select value={v.paymentTerms || ''} onChange={(e) => setVendors(vendors.map(x => x.id === v.id ? { ...x, paymentTerms: e.target.value || undefined } : x))} className="w-full bg-transparent focus:outline-none">
                        <option value="">Select...</option>
                        <option value="Net 15">Net 15</option>
                        <option value="Net 30">Net 30</option>
                        <option value="Net 45">Net 45</option>
                        <option value="Net 90">Net 90</option>
                        <option value="2% / Net 15">2% / Net 15</option>
                      </select>
                    </td>
                    <td className="p-4 text-xs">
                      <button onClick={() => setVendors(vendors.filter(x => x.id !== v.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-xs opacity-50 italic">No vendors added yet. Click "Sync Carriers as Vendors" to auto-add carriers.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'Sales Leads') {
      const salesPeople = people.filter(p => p.department === 'sales');
      const [expandedLeadIds, setExpandedLeadIds] = React.useState<Set<string>>(new Set());
      const [showAddLeadModal, setShowAddLeadModal] = React.useState(false);
      const [editingLeadCard, setEditingLeadCard] = React.useState<SalesLead | null>(null);
      const [newLeadFollowUp, setNewLeadFollowUp] = React.useState<Record<string, { date: string; description: string; infoSent: string }>>({});

      const toggleExpandLead = (id: string) => {
        setExpandedLeadIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      };

      const getLeadStatusColor = (status: string) => {
        switch (status) {
          case 'New': return 'bg-blue-100 text-blue-800';
          case 'In Progress': return 'bg-yellow-100 text-yellow-800';
          case 'Qualified': return 'bg-purple-100 text-purple-800';
          case 'Closed Won': return 'bg-green-100 text-green-800';
          case 'Closed Lost': return 'bg-red-100 text-red-800';
          default: return 'bg-gray-100 text-gray-800';
        }
      };

      const filteredLeads = salesLeads.filter(lead => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return lead.customerName.toLowerCase().includes(term) ||
          lead.product.toLowerCase().includes(term) ||
          lead.location.toLowerCase().includes(term) ||
          lead.status.toLowerCase().includes(term) ||
          (people.find(p => p.id === lead.salespersonId)?.name || '').toLowerCase().includes(term);
      });

      const emptyLead: SalesLead = {
        id: '', customerName: '', product: '', volume: 0, location: '', salespersonId: '',
        notes: '', status: 'New', followUps: [], createdAt: new Date().toISOString(),
      };

      const LeadModal = ({ lead, setLead, onSubmit, onClose, title }: { lead: SalesLead; setLead: (l: SalesLead) => void; onSubmit: () => void; onClose: () => void; title: string }) => (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
              <button onClick={onClose} className="p-1 hover:bg-white/20 transition-all"><X size={16} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Customer Name*</label>
                  <input type="text" value={lead.customerName} onChange={(e) => setLead({ ...lead, customerName: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" placeholder="Enter customer name" /></div>
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Product</label>
                  <select value={lead.product} onChange={(e) => setLead({ ...lead, product: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                    <option value="">Select product</option>
                    {qaProducts.map(qp => <option key={qp.id} value={qp.skuName}>{qp.skuName}</option>)}
                    {skus.filter(s => !qaProducts.some(qp => qp.skuName === s.name)).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Volume (MT)</label>
                  <input type="number" value={lead.volume || ''} onChange={(e) => setLead({ ...lead, volume: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Location</label>
                  <select value={lead.location} onChange={(e) => setLead({ ...lead, location: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                    <option value="">Select location</option>
                    {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select></div>
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Status</label>
                  <select value={lead.status} onChange={(e) => setLead({ ...lead, status: e.target.value as SalesLead['status'] })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                    <option value="New">New</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Closed Won">Closed Won</option>
                    <option value="Closed Lost">Closed Lost</option>
                  </select></div>
              </div>
              <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Sales Person</label>
                <select value={lead.salespersonId} onChange={(e) => setLead({ ...lead, salespersonId: e.target.value })}
                  className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                  <option value="">Select salesperson</option>
                  {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Notes</label>
                <textarea value={lead.notes || ''} onChange={(e) => setLead({ ...lead, notes: e.target.value })} rows={3}
                  className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" placeholder="Additional notes..." /></div>
              {lead.source && <div className="text-[10px] opacity-50">Source: {lead.source}</div>}

              {/* Follow-ups section in modal */}
              <div className="border-t border-[#141414]/10 pt-4">
                <h4 className="text-xs font-bold uppercase tracking-widest mb-3">Follow-ups</h4>
                {(lead.followUps || []).map(fu => (
                  <div key={fu.id} className="flex items-start gap-2 mb-2 p-2 bg-[#F5F5F5] border border-[#141414]/10">
                    <button onClick={() => setLead({ ...lead, followUps: lead.followUps.map(f => f.id === fu.id ? { ...f, completed: !f.completed } : f) })}
                      className="mt-0.5 flex-shrink-0">{fu.completed ? <CheckCircle2 size={14} className="text-green-600" /> : <div className="w-3.5 h-3.5 border border-[#141414] rounded-sm" />}</button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs ${fu.completed ? 'line-through opacity-50' : ''}`}>{fu.description}</div>
                      <div className="text-[10px] opacity-40">{fu.date}{fu.infoSent ? ` — Info: ${fu.infoSent}` : ''}</div>
                    </div>
                    <button onClick={() => setLead({ ...lead, followUps: lead.followUps.filter(f => f.id !== fu.id) })}
                      className="p-0.5 hover:bg-red-100 text-red-400 flex-shrink-0"><Trash2 size={12} /></button>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <input type="date" placeholder="Date" className="px-2 py-1 border border-[#141414] text-xs focus:outline-none"
                    value={(newLeadFollowUp[lead.id] || { date: '' }).date}
                    onChange={(e) => setNewLeadFollowUp(prev => ({ ...prev, [lead.id]: { ...(prev[lead.id] || { date: '', description: '', infoSent: '' }), date: e.target.value } }))} />
                  <input type="text" placeholder="Description" className="px-2 py-1 border border-[#141414] text-xs focus:outline-none"
                    value={(newLeadFollowUp[lead.id] || { description: '' }).description}
                    onChange={(e) => setNewLeadFollowUp(prev => ({ ...prev, [lead.id]: { ...(prev[lead.id] || { date: '', description: '', infoSent: '' }), description: e.target.value } }))} />
                  <div className="flex gap-1">
                    <input type="text" placeholder="Info sent" className="flex-1 px-2 py-1 border border-[#141414] text-xs focus:outline-none"
                      value={(newLeadFollowUp[lead.id] || { infoSent: '' }).infoSent}
                      onChange={(e) => setNewLeadFollowUp(prev => ({ ...prev, [lead.id]: { ...(prev[lead.id] || { date: '', description: '', infoSent: '' }), infoSent: e.target.value } }))} />
                    <button onClick={() => {
                      const fu = newLeadFollowUp[lead.id];
                      if (!fu?.description) return;
                      const newFu: SalesLeadFollowUp = { id: `SLFU-${Date.now()}`, date: fu.date || new Date().toISOString().split('T')[0], description: fu.description, infoSent: fu.infoSent || '', completed: false };
                      setLead({ ...lead, followUps: [...lead.followUps, newFu] });
                      setNewLeadFollowUp(prev => ({ ...prev, [lead.id]: { date: '', description: '', infoSent: '' } }));
                    }} className="px-2 py-1 bg-[#141414] text-[#E4E3E0] text-xs font-bold"><Plus size={12} /></button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[#141414]/10">
                <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">Cancel</button>
                <button onClick={onSubmit} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all">
                  {title.includes('Edit') ? 'Save Changes' : 'Create Lead'}</button>
              </div>
            </div>
          </motion.div>
        </div>
      );

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Sales Leads</h2>
            <button onClick={() => setShowAddLeadModal(true)}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all">
              <Plus size={14} /> Add Lead
            </button>
          </div>

          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search leads by customer, product, location, status..." />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <th className="p-3 w-8"></th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Customer</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Product</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Volume (MT)</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Location</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Sales Person</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Status</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Follow-ups</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {filteredLeads.length === 0 && (
                  <tr><td colSpan={9} className="p-6 text-center text-xs font-bold opacity-40 italic">No sales leads yet. Click "Add Lead" to create one.</td></tr>
                )}
                {filteredLeads.map(lead => {
                  const salesperson = people.find(p => p.id === lead.salespersonId);
                  const isExpanded = expandedLeadIds.has(lead.id);
                  return (
                    <React.Fragment key={lead.id}>
                      <tr className="hover:bg-[#F9F9F9] transition-colors cursor-pointer" onClick={() => setEditingLeadCard({ ...lead })}>
                        <td className="p-3" onClick={(e) => { e.stopPropagation(); toggleExpandLead(lead.id); }}>
                          {lead.followUps.length > 0 && (isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                        </td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{lead.customerName}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{lead.product}</td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{lead.volume}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{lead.location}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{salesperson?.name || '—'}</td>
                        <td className="p-3 border-r border-[#141414]/10">
                          <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] ${getLeadStatusColor(lead.status)}`}>{lead.status}</span>
                        </td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{lead.followUps.filter(f => !f.completed).length}/{lead.followUps.length}</td>
                        <td className="p-3 text-xs" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setEditingLeadCard({ ...lead })} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit"><Edit2 size={14} /></button>
                            <button onClick={() => setSalesLeads(salesLeads.filter(l => l.id !== lead.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && lead.followUps.length > 0 && lead.followUps.map(fu => (
                        <tr key={fu.id} className="bg-[#F9F9F9]">
                          <td className="p-2 pl-6"></td>
                          <td className="p-2 text-[10px] opacity-60" colSpan={2}>
                            <button onClick={() => {
                              const updatedFollowUps = lead.followUps.map(f => f.id === fu.id ? { ...f, completed: !f.completed } : f);
                              setSalesLeads(salesLeads.map(l => l.id === lead.id ? { ...l, followUps: updatedFollowUps } : l));
                            }} className="inline-flex items-center gap-1">
                              {fu.completed ? <CheckCircle2 size={12} className="text-green-600" /> : <div className="w-3 h-3 border border-[#141414] rounded-sm" />}
                              <span className={fu.completed ? 'line-through' : ''}>{fu.description}</span>
                            </button>
                          </td>
                          <td className="p-2 text-[10px] opacity-60">{fu.date}</td>
                          <td className="p-2 text-[10px] opacity-60" colSpan={2}>{fu.infoSent || '—'}</td>
                          <td colSpan={3}></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Add Lead Modal */}
          <AnimatePresence>
            {showAddLeadModal && (() => {
              const [newLead, setNewLead] = React.useState<SalesLead>({ ...emptyLead, id: `SL-${Date.now()}` });
              return (
                <LeadModal lead={newLead} setLead={setNewLead} title="Add Sales Lead" onClose={() => setShowAddLeadModal(false)}
                  onSubmit={() => {
                    if (!newLead.customerName) { alert('Please enter a customer name'); return; }
                    setSalesLeads(prev => [...prev, { ...newLead, id: `SL-${Date.now()}`, createdAt: new Date().toISOString() }]);
                    setShowAddLeadModal(false);
                  }} />
              );
            })()}
          </AnimatePresence>

          {/* Edit Lead Card Modal */}
          <AnimatePresence>
            {editingLeadCard && (
              <LeadModal lead={editingLeadCard} setLead={setEditingLeadCard as (l: SalesLead) => void} title="Edit Sales Lead" onClose={() => setEditingLeadCard(null)}
                onSubmit={() => {
                  setSalesLeads(salesLeads.map(l => l.id === editingLeadCard.id ? editingLeadCard : l));
                  setEditingLeadCard(null);
                }} />
            )}
          </AnimatePresence>
        </div>
      );
    }

    if (activePage === 'Supply Chain') {
      const totalCostPerMt = supplyChain.reduce((sum, item) => sum + (item.totalCostCad / (item.weightPerLoadMt || 1)), 0);

      return (
        <div className="p-6 space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Supply Chain Management</h2>
          </div>

          {/* Locations Table (read-only except bays & appointment schedule — edit locations in QA page) */}
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest">Locations</h3>
              <span className="text-[10px] opacity-50 italic">Manage locations in QA page</span>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                  <th className="p-4 border-r border-[#141414]/10">Code</th>
                  <th className="p-4 border-r border-[#141414]/10">Name</th>
                  <th className="p-4 border-r border-[#141414]/10">Address</th>
                  <th className="p-4 border-r border-[#141414]/10">City</th>
                  <th className="p-4 border-r border-[#141414]/10">Province</th>
                  <th className="p-4 border-r border-[#141414]/10">Postal Code</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {locations.map(loc => (
                  <React.Fragment key={loc.id}>
                    <tr className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-4 text-xs font-bold font-mono border-r border-[#141414]/10 w-20">{loc.locationCode || '—'}</td>
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{loc.name || '—'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{loc.address || '—'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{loc.city || '—'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{loc.province || '—'}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{loc.postalCode || '—'}</td>
                      <td className="p-4 text-xs flex gap-2">
                        <button onClick={() => setEditingAppointmentSchedule({...loc})} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Set Appointment Schedule">
                          <Clock size={14} />
                        </button>
                        <button onClick={() => toggleRow(loc.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          {expandedRows.has(loc.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRows.has(loc.id) && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden bg-[#F5F5F5] border-t border-[#141414]/10"
                            >
                              <div className="p-6 space-y-4">
                                <div className="flex justify-between items-center">
                                  <h4 className="text-[10px] uppercase font-bold opacity-50">Bays</h4>
                                  <button 
                                    onClick={() => setLocations(locations.map(l => l.id === loc.id ? { ...l, bays: [...l.bays, ''] } : l))}
                                    className="px-2 py-1 bg-[#141414] text-[#E4E3E0] text-[8px] font-bold uppercase flex items-center gap-1 hover:bg-opacity-80 transition-all"
                                  >
                                    <Plus size={10} /> Add Bay
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                  {loc.bays.map((bay, idx) => (
                                    <div key={idx} className="flex gap-2">
                                      <input 
                                        type="text" 
                                        value={bay} 
                                        onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, bays: l.bays.map((b, i) => i === idx ? e.target.value : b) } : l))}
                                        className="flex-1 bg-white border border-[#141414]/20 p-2 text-xs"
                                        placeholder={`Bay ${idx + 1} Name`}
                                      />
                                      <button 
                                        onClick={() => setLocations(locations.map(l => l.id === loc.id ? { ...l, bays: l.bays.filter((_, i) => i !== idx) } : l))}
                                        className="p-2 hover:bg-red-500 hover:text-white transition-all"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </div>
                                  ))}
                                  {loc.bays.length === 0 && (
                                    <div className="col-span-full text-center text-[10px] opacity-40 italic py-4">No bays added yet.</div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="space-y-4">
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Vancouver Supply Chain</h3>
                <button 
                  onClick={() => setIsAddingSupplyChain(true)}
                  className="px-3 py-1 bg-white text-[#141414] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
                >
                  <Plus size={12} /> Add Component
                </button>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <th className="p-4 border-r border-[#141414]/10">Component</th>
                    <th className="p-4 border-r border-[#141414]/10">Carrier</th>
                    <th className="p-4 border-r border-[#141414]/10">Total Cost (CAD)</th>
                    <th className="p-4 border-r border-[#141414]/10">Weight / Load (MT)</th>
                    <th className="p-4 border-r border-[#141414]/10">Cost / MT</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {supplyChain.map(item => {
                    const costPerMt = item.totalCostCad / (item.weightPerLoadMt || 1);
                    return (
                      <tr key={item.id} className="hover:bg-[#F9F9F9] transition-colors">
                        <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{item.component}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">{item.provider}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">CAD ${item.totalCostCad.toLocaleString()}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">{item.weightPerLoadMt}</td>
                        <td className="p-4 text-xs font-bold border-r border-[#141414]/10">CAD ${costPerMt.toFixed(2)}</td>
                        <td className="p-4 text-xs flex items-center gap-2">
                          <button onClick={() => setEditingSupplyChain(item)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => setSupplyChain(supplyChain.filter(sc => sc.id !== item.id))} 
                            className="p-1 hover:bg-red-500 hover:text-white transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F5F5F5] font-black border-t border-[#141414]">
                    <td colSpan={4} className="p-4 text-xs uppercase tracking-widest text-right border-r border-[#141414]/10">Total Supply Chain Cost / MT</td>
                    <td colSpan={2} className="p-4 text-sm text-indigo-600">CAD ${totalCostPerMt.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">Carriers</h3>
              <button 
                onClick={() => {
                  setEditingCarrier({ id: '', carrierNumber: '', name: '', contactEmail: '', contactPhone: '', notes: '', defaultLocationCode: '' });
                  setIsAddingCarrier(true);
                }}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Carrier
              </button>
            </div>
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <th className="p-4 border-r border-[#141414]/10">Carrier #</th>
                    <th className="p-4 border-r border-[#141414]/10">Name</th>
                    <th className="p-4 border-r border-[#141414]/10">Default Location</th>
                    <th className="p-4 border-r border-[#141414]/10">Contact Email</th>
                    <th className="p-4 border-r border-[#141414]/10">Contact Phone</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {carriers.map(carrier => {
                    const carrierLoc = locations.find(l => l.locationCode === carrier.defaultLocationCode);
                    return (
                    <tr key={carrier.id} className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{carrier.carrierNumber}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.name}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        {carrierLoc ? `${carrierLoc.locationCode} — ${carrierLoc.name}` : carrier.defaultLocationCode || '—'}
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.contactEmail}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.contactPhone}</td>
                      <td className="p-4 text-xs flex items-center gap-2">
                        <button onClick={() => { setIsAddingCarrier(false); setEditingCarrier(carrier); }} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setCarriers(carriers.filter(c => c.id !== carrier.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">Freight Rates</h3>
              <button 
                onClick={addFreightRate}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Rate
              </button>
            </div>

            <SearchInput 
              value={searchTerm} 
              onChange={setSearchTerm} 
              placeholder="Search freight rates by origin, destination, provider or type..." 
            />

            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <SortableHeader label="Origin" sortKey="origin" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Destination" sortKey="destination" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Type" sortKey="freightType" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Carrier" sortKey="provider" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Cost (CAD)" sortKey="cost" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="MT / Load" sortKey="mtPerLoad" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Start Date" sortKey="startDate" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="End Date" sortKey="endDate" currentSort={sortConfig} onSort={handleSort} />
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {getSortedAndFilteredData<FreightRate>(freightRates, ['origin', 'destination', 'provider', 'freightType']).map(rate => (
                    <tr key={rate.id} className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-4 text-xs font-bold">{rate.origin}</td>
                      <td className="p-4 text-xs">{rate.destination}</td>
                      <td className="p-4 text-xs">{rate.freightType}</td>
                      <td className="p-4 text-xs">{rate.provider}</td>
                      <td className="p-4 text-xs font-bold">{rate.cost.toLocaleString()}</td>
                      <td className="p-4 text-xs">{rate.mtPerLoad}</td>
                      <td className="p-4 text-xs">{rate.startDate || '—'}</td>
                      <td className="p-4 text-xs">{rate.endDate || '—'}</td>
                      <td className="p-4 text-xs flex items-center gap-2">
                        <button onClick={() => setEditingFreightRate(rate)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => deleteFreightRate(rate.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Fuel Surcharge Table */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">Fuel Surcharges</h3>
              <button
                onClick={() => {
                  const id = `FS-${Date.now()}`;
                  setFuelSurcharges([...fuelSurcharges, { id, carrierCode: '', carrier: '', surchargePercent: 0, startDate: '', endDate: '' }]);
                }}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Surcharge
              </button>
            </div>

            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <th className="p-4 border-r border-[#141414]/10">Carrier Code</th>
                    <th className="p-4 border-r border-[#141414]/10">Carrier</th>
                    <th className="p-4 border-r border-[#141414]/10">Fuel Surcharge (%)</th>
                    <th className="p-4 border-r border-[#141414]/10">Start Date</th>
                    <th className="p-4 border-r border-[#141414]/10">End Date</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {fuelSurcharges.map(fs => (
                    <tr key={fs.id} className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-4 text-xs font-mono border-r border-[#141414]/10">
                        <input
                          type="text"
                          value={fs.carrierCode}
                          onChange={(e) => setFuelSurcharges(fuelSurcharges.map(f => f.id === fs.id ? { ...f, carrierCode: e.target.value } : f))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="Code"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <select
                          value={fs.carrier}
                          onChange={(e) => {
                            const sel = carriers.find(c => c.name === e.target.value);
                            setFuelSurcharges(fuelSurcharges.map(f => f.id === fs.id ? { ...f, carrier: e.target.value, carrierCode: sel?.carrierNumber || f.carrierCode } : f));
                          }}
                          className="w-full bg-transparent focus:outline-none"
                        >
                          <option value="">Select Carrier</option>
                          {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">
                        <input
                          type="text" inputMode="decimal"
                          value={fs.surchargePercent || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setFuelSurcharges(fuelSurcharges.map(f => f.id === fs.id ? { ...f, surchargePercent: parseFloat(e.target.value) || 0 } : f))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="0.0"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input
                          type="date"
                          value={fs.startDate || ''}
                          onChange={(e) => setFuelSurcharges(fuelSurcharges.map(f => f.id === fs.id ? { ...f, startDate: e.target.value } : f))}
                          className="w-full bg-transparent focus:outline-none"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input
                          type="date"
                          value={fs.endDate || ''}
                          onChange={(e) => setFuelSurcharges(fuelSurcharges.map(f => f.id === fs.id ? { ...f, endDate: e.target.value } : f))}
                          className="w-full bg-transparent focus:outline-none"
                        />
                      </td>
                      <td className="p-4 text-xs">
                        <button onClick={() => setFuelSurcharges(fuelSurcharges.filter(f => f.id !== fs.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {fuelSurcharges.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-xs opacity-50 italic">No fuel surcharges added yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CHEP Pallets Inventory */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold uppercase tracking-widest">CHEP Pallets Inventory</h3>
              <button
                onClick={() => {
                  const id = `CHEP-${Date.now()}`;
                  setChepPalletMovements(prev => [...prev, {
                    id,
                    date: new Date().toISOString().split('T')[0],
                    location: locations[0]?.name || 'Hamilton',
                    type: 'in' as const,
                    quantity: 0,
                    reference: 'Manual Add',
                    notes: '',
                  }]);
                }}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Pallets
              </button>
            </div>

            {/* Location Summary */}
            {(() => {
              const balanceByLocation: Record<string, number> = {};
              for (const loc of locations) {
                balanceByLocation[loc.name] = 0;
              }
              for (const m of chepPalletMovements) {
                if (balanceByLocation[m.location] === undefined) balanceByLocation[m.location] = 0;
                balanceByLocation[m.location] += m.type === 'in' ? m.quantity : -m.quantity;
              }
              return (
                <div className="flex gap-4">
                  {Object.entries(balanceByLocation).map(([loc, bal]) => (
                    <div key={loc} className="flex-1 bg-white border border-[#141414] p-4 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
                      <div className="text-[10px] uppercase font-bold opacity-50 mb-1">{loc}</div>
                      <div className={`text-2xl font-black ${bal < 0 ? 'text-red-600' : 'text-[#141414]'}`}>{bal}</div>
                      <div className="text-[10px] opacity-40">pallets on hand</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Movements Table */}
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    <th className="p-3 border-r border-[#E4E3E0]/20">Date</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Location</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Type</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Quantity</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Reference</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Notes</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {[...chepPalletMovements].sort((a, b) => b.date.localeCompare(a.date)).map(m => (
                    <tr key={m.id} className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-3 text-xs border-r border-[#141414]/10">
                        <input type="date" value={m.date} onChange={(e) => setChepPalletMovements(prev => prev.map(x => x.id === m.id ? { ...x, date: e.target.value } : x))} className="bg-transparent focus:outline-none" />
                      </td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">
                        <select value={m.location} onChange={(e) => setChepPalletMovements(prev => prev.map(x => x.id === m.id ? { ...x, location: e.target.value } : x))} className="bg-transparent focus:outline-none">
                          {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                        </select>
                      </td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">
                        {m.type === 'in' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[8px] uppercase">IN</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[8px] uppercase">OUT</span>
                        )}
                      </td>
                      <td className="p-3 text-xs font-bold border-r border-[#141414]/10">
                        <input type="text" inputMode="numeric" value={m.quantity || ''} onFocus={(e) => e.target.select()} onChange={(e) => setChepPalletMovements(prev => prev.map(x => x.id === m.id ? { ...x, quantity: parseInt(e.target.value) || 0 } : x))} className="w-16 bg-transparent focus:outline-none" />
                      </td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">
                        <input type="text" value={m.reference} onChange={(e) => setChepPalletMovements(prev => prev.map(x => x.id === m.id ? { ...x, reference: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Reference" />
                      </td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">
                        <input type="text" value={m.notes || ''} onChange={(e) => setChepPalletMovements(prev => prev.map(x => x.id === m.id ? { ...x, notes: e.target.value } : x))} className="w-full bg-transparent focus:outline-none" placeholder="Notes" />
                      </td>
                      <td className="p-3 text-xs">
                        <button onClick={() => setChepPalletMovements(prev => prev.filter(x => x.id !== m.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {chepPalletMovements.length === 0 && (
                    <tr><td colSpan={7} className="p-8 text-center text-xs opacity-50 italic">No CHEP pallet movements recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      );
    }

    if (activePage === 'Contracts') {
      const filteredContracts = getSortedAndFilteredData<Contract>(contracts, ['contractNumber', 'customerName', 'customerNumber', 'skuName', 'origin', 'destination']);

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Contract Management</h2>
          </div>
          
          <SearchInput 
            value={searchTerm} 
            onChange={setSearchTerm} 
            placeholder="Search contracts by number, customer, SKU, origin or destination..." 
          />

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="Contract No." sortKey="contractNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Cust No." sortKey="customerNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Customer Name" sortKey="customerName" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="FX Rate" sortKey="fxRate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="#11 Raw (USD/MT)" sortKey="rawPriceUsdMt" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume (MT)" sortKey="contractVolume" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume Taken (MT)" sortKey="volumeTaken" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume Outstanding (MT)" sortKey="volumeOutstanding" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Start Date" sortKey="startDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="End Date" sortKey="endDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Shipping Terms" sortKey="shippingTerms" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Payment Terms" sortKey="paymentTerms" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredContracts.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="hover:bg-[#F9F9F9] transition-colors group cursor-pointer" onClick={() => setSelectedContractDetail(c)}>
                      <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{c.contractNumber}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.customerNumber}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{c.customerName}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10 font-mono">{c.fxRate?.toFixed(4) || '—'}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10 font-mono">{c.rawPriceUsdMt ? `$${c.rawPriceUsdMt.toFixed(2)}` : '—'}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.contractVolume}</td>
                      <td className="p-3 text-xs font-bold border-r border-[#141414]/10">
                        <button
                          onClick={(e) => { e.stopPropagation(); setContractInvoicePopup(contractInvoicePopup === c.contractNumber ? null : c.contractNumber); }}
                          className="text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800 cursor-pointer"
                        >
                          {c.volumeTaken || 0}
                        </button>
                      </td>
                      <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{(c.volumeOutstanding || c.contractVolume)}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.startDate}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.endDate}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{c.shippingTerms || '—'}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.paymentTerms || '—'}</td>
                      <td className="p-3 text-xs flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); toggleRow(c.id); }} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          {expandedRows.has(c.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingContract(c); }} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); deleteContract(c.id); }} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRows.has(c.id) && (
                        <tr>
                          <td colSpan={13} className="p-0">
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden bg-[#F5F5F5] border-t border-[#141414]/10"
                            >
                              <div className="p-4 grid grid-cols-4 gap-4">
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">SKU</label>
                                  <div className="text-xs font-bold">{c.skuName}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                                  <div className="text-xs font-bold">{c.origin}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Destination</label>
                                  <div className="text-xs font-bold">{c.destination}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Final Price</label>
                                  <div className="text-xs font-bold text-indigo-600">{c.currency} ${c.finalPrice.toFixed(2)}/MT</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Delivered Freight</label>
                                  <div className="text-xs font-bold">{c.deliveredFreight ? `$${c.deliveredFreight.toFixed(2)}/MT` : '—'}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Export Duty</label>
                                  <div className="text-xs font-bold">{c.exportDuty ? `$${c.exportDuty.toFixed(2)}/MT` : '—'}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Pallet Charge</label>
                                  <div className="text-xs font-bold">{c.palletCharge ? `$${c.palletCharge.toFixed(2)}/MT` : '—'}</div>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">FX Rate</label>
                                  <div className="text-xs font-bold">{c.fxRate?.toFixed(4) || '—'}</div>
                                </div>
                                <div className="col-span-4 space-y-1">
                                  <label className="text-[10px] uppercase font-bold opacity-50">Notes</label>
                                  <div className="text-xs italic">{c.notes || 'No notes available.'}</div>
                                </div>
                              </div>
                            </motion.div>
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePage === 'US #11 Market') {
      // Resolve column keys dynamically from data
      const resolveKey = (row: any, ...candidates: string[]) => {
        for (const c of candidates) {
          const key = Object.keys(row).find(k => k.toLowerCase() === c.toLowerCase());
          if (key && row[key] !== undefined) return key;
        }
        // Partial match fallback
        for (const c of candidates) {
          const key = Object.keys(row).find(k => k.toLowerCase().includes(c.toLowerCase()));
          if (key && row[key] !== undefined) return key;
        }
        return null;
      };
      const sampleRow = marketData.length > 0 ? marketData[0] : null;
      const allKeys = sampleRow ? Object.keys(sampleRow).filter(k => k !== 'id' && k !== '__name__') : [];
      const monthKey = sampleRow ? resolveKey(sampleRow, 'Month', 'month', 'date', 'Date', 'period') : null;
      let rawsKey = sampleRow ? resolveKey(sampleRow, '#11 Raws', '#11 Raw', '#11', 'raws', 'raw', 'Raw Sugar', 'rawSugar', 'raw_sugar', 'price', 'No11', 'no11', 'Raws', 'Raw') : null;
      let fxKey = sampleRow ? resolveKey(sampleRow, 'FX', 'Fx', 'fx', 'fxRate', 'FX Rate', 'CAD', 'USDCAD', 'usdcad', 'exchange', 'Exchange Rate', 'exchangeRate') : null;

      // Fallback: if we found month but not raws/fx, use remaining non-month keys
      if (monthKey && (!rawsKey || !fxKey)) {
        const remainingKeys = allKeys.filter(k => k !== monthKey);
        if (!rawsKey && remainingKeys.length >= 1) {
          // First remaining key is likely raws (the #11 value)
          rawsKey = remainingKeys[0];
        }
        if (!fxKey && remainingKeys.length >= 2) {
          // Second remaining key is likely FX
          fxKey = remainingKeys[1];
        }
      }

      // Sort market data chronologically by month
      const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const sortedMarketData = [...marketData].sort((a, b) => {
        const aMonth = monthKey ? String(a[monthKey] || '') : '';
        const bMonth = monthKey ? String(b[monthKey] || '') : '';
        // Parse "Mon YYYY" format (e.g., "Jul 2026")
        const parseMonth = (s: string) => {
          const parts = s.split(/\s+/);
          if (parts.length >= 2) {
            const mIdx = monthOrder.findIndex(m => s.toLowerCase().startsWith(m.toLowerCase()));
            const year = parseInt(parts[parts.length - 1]) || 0;
            return year * 12 + (mIdx >= 0 ? mIdx : 0);
          }
          // Try parsing as a date
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.getFullYear() * 12 + d.getMonth();
          return 0;
        };
        return parseMonth(aMonth) - parseMonth(bMonth);
      });

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold uppercase tracking-tighter">US #11 Market Data</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} className={isFetchingMarket ? 'animate-spin' : ''} />
                Last Updated: {lastMarketUpdate ? new Date(lastMarketUpdate).toLocaleString() : 'Never'}
                {marketData.length > 0 && <span className="ml-2">({marketData.length} rows)</span>}
              </div>
            </div>
            <button
              onClick={fetchMarketData}
              disabled={isFetchingMarket}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
            >
              <RefreshCw size={14} className={isFetchingMarket ? 'animate-spin' : ''} />
              Refresh Data
            </button>
          </div>

          {/* Data status indicator */}
          {marketData.length > 0 && !monthKey && (
            <div className="bg-amber-50 border border-amber-400 p-3 text-xs">
              <p className="font-bold">Unable to detect month column in your market data. Please ensure your Firebase "MarketData" collection documents include a field named "Month".</p>
            </div>
          )}

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    <th className="p-4 border-r border-white/10">Month</th>
                    <th className="p-4 border-r border-white/10">#11 Raws (USD/cwt)</th>
                    <th className="p-4">FX (USD/CAD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedMarketData.length > 0 ? sortedMarketData.map((row, idx) => {
                    const month = monthKey ? row[monthKey] : '-';
                    const raws = rawsKey ? row[rawsKey] : '-';
                    const fx = fxKey ? row[fxKey] : '-';
                    return (
                      <tr key={idx} className="hover:bg-[#F9F9F9] transition-colors">
                        <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{month}</td>
                        <td className="p-4 text-xs border-r border-[#141414]/10">{typeof raws === 'number' ? raws.toFixed(2) : raws}</td>
                        <td className="p-4 text-xs">{typeof fx === 'number' ? fx.toFixed(4) : fx}</td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="p-12 text-center text-xs opacity-50 italic" colSpan={3}>
                        {isFetchingMarket ? 'Loading market data...' : 'No market data available. Click Refresh Data to fetch from database.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (activePage !== 'Customer Quote') {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-12">
          <div className="bg-white border border-[#141414] p-12 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-md w-full">
            <h2 className="text-xl font-bold uppercase mb-4">{activePage}</h2>
            <p className="text-sm opacity-50 italic mb-8">This module is currently under development.</p>
            <button 
              onClick={() => setActivePage('Customer Quote')}
              className="w-full py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
            >
              Return to Quote Builder
            </button>
          </div>
        </div>
      );
    }

    return (
      <main className="max-w-[1400px] mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Input Section */}
        <div className="lg:col-span-4 space-y-4">
          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
              <Users size={14} /> Customer Selection
            </h2>
            <select 
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                const selectedCust = customers.find(c => c.name === e.target.value);
                if (selectedCust?.defaultPaymentTerms) {
                  setConfig(prev => ({ ...prev, paymentTerms: selectedCust.defaultPaymentTerms }));
                }
              }}
              className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/10"
            >
              {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </section>

          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
              <Package size={14} /> Product Selection
            </h2>
            <select 
              value={selectedSkuId}
              onChange={(e) => setSelectedSkuId(e.target.value)}
              className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/10"
            >
              {skus.map(sku => (
                <option key={sku.id} value={sku.id}>{sku.name.toUpperCase()}</option>
              ))}
            </select>
          </section>

          <section className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
              <DollarSign size={14} /> Market Inputs
            </h2>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold opacity-60">Origin</label>
                <select 
                  value={config.origin} 
                  onChange={(e) => setConfig(prev => ({ ...prev, origin: e.target.value as any }))}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                >
                  <option value="Hamilton">Hamilton</option>
                  <option value="Vancouver">Vancouver</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Contract Start</label>
                  <select 
                    value={config.contractStartDate} 
                    onChange={(e) => handleInputChange('contractStartDate', e.target.value)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs focus:outline-none"
                  >
                    <option value="">Select Month</option>
                    {Array.from(new Set(marketData.map(d => d.Month || d.month).filter(Boolean))).map(month => (
                      <option key={month as string} value={month as string}>{month as string}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Contract End</label>
                  <select 
                    value={config.contractEndDate} 
                    onChange={(e) => handleInputChange('contractEndDate', e.target.value)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs focus:outline-none"
                  >
                    <option value="">Select Month</option>
                    {Array.from(new Set(marketData.map(d => d.Month || d.month).filter(Boolean))).map(month => (
                      <option key={month as string} value={month as string}>{month as string}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold opacity-60">Quote Currency</label>
                <select
                  value={config.currency}
                  onChange={(e) => setConfig(prev => ({ ...prev, currency: e.target.value as 'USD' | 'CAD' }))}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                >
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold opacity-60">Shipping Terms</label>
                <select
                  value={config.shippingTerms || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, shippingTerms: e.target.value as any }))}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                >
                  <option value="">Select Terms</option>
                  <option value="FOB">FOB</option>
                  <option value="DAP">DAP</option>
                  <option value="DDP">DDP</option>
                  <option value="FCA">FCA</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold opacity-60">Payment Terms</label>
                <select
                  value={config.paymentTerms || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, paymentTerms: e.target.value || undefined }))}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                >
                  <option value="">Select...</option>
                  <option value="Net 15">Net 15</option>
                  <option value="Net 30">Net 30</option>
                  <option value="Net 45">Net 45</option>
                  <option value="Net 90">Net 90</option>
                  <option value="2% / Net 15">2% / Net 15</option>
                </select>
              </div>
              <InputField label="Raw Price (USD/cwt)" value={config.rawPriceUsdCwt} onChange={(v) => handleInputChange('rawPriceUsdCwt', v)} />
              <InputField label="Ocean Freight (USD/MT)" value={config.oceanFreightUsdMt} onChange={(v) => handleInputChange('oceanFreightUsdMt', v)} />
              <InputField label="Yield Loss Multiplier" value={config.yieldLossMultiplier} onChange={(v) => handleInputChange('yieldLossMultiplier', v)} step="0.01" />
              <InputField label="USD/CAD FX Rate" value={config.fxRate} onChange={(v) => handleInputChange('fxRate', v)} step="0.0001" />
              <InputField label="Contract Volume (MT)" value={config.volumeMt} onChange={(v) => handleInputChange('volumeMt', v)} />
              <InputField label="Refining Margin (CAD/MT)" value={config.refiningMarginCadMt} onChange={(v) => handleInputChange('refiningMarginCadMt', v)} />

              <div className="pt-4 border-t border-[#141414]/10 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold opacity-60">Delivered</label>
                  <button 
                    onClick={() => handleToggleChange('isDelivered')}
                    className={`w-10 h-5 rounded-full relative transition-colors ${config.isDelivered ? 'bg-[#141414]' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.isDelivered ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold opacity-60">Export</label>
                  <button 
                    onClick={() => handleToggleChange('isExport')}
                    className={`w-10 h-5 rounded-full relative transition-colors ${config.isExport ? 'bg-[#141414]' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.isExport ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold opacity-60">Pallet Type</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={config.palletType === 'CHEP'}
                        onChange={() => {
                          const newType = config.palletType === 'CHEP' ? '' : 'CHEP';
                          setConfig(prev => ({ ...prev, palletType: newType as any, isPalletCharge: newType !== '', palletCostCadMt: newType === 'CHEP' ? 0 : prev.palletCostCadMt }));
                        }}
                        className="w-4 h-4 accent-[#141414]"
                      />
                      CHEP Pallet
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={config.palletType === 'One Way'}
                        onChange={() => {
                          const newType = config.palletType === 'One Way' ? '' : 'One Way';
                          setConfig(prev => ({ ...prev, palletType: newType as any, isPalletCharge: newType !== '' }));
                        }}
                        className="w-4 h-4 accent-[#141414]"
                      />
                      One Way Pallet
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <AnimatePresence>
            {config.palletType === 'One Way' && (
              <motion.section
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
                  <Package size={14} /> Pallet Options
                </h2>
                <div className="space-y-4">
                  <InputField label="Pallet Cost per MT (CAD)" value={config.palletCostCadMt} onChange={(v) => handleInputChange('palletCostCadMt', v)} />
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {config.isDelivered && (
              <motion.section 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
                  <Truck size={14} /> Freight
                </h2>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Destination</label>
                    <select
                      value={config.destination}
                      onChange={(e) => setConfig(prev => ({ ...prev, destination: e.target.value }))}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      <option value="">Select Destination</option>
                      {[...new Set(freightRates.filter(r => r.origin === config.origin).map(r => r.destination))].map(dest => (
                        <option key={dest} value={dest}>{dest}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Freight Type</label>
                    <select
                      value={config.freightType}
                      onChange={(e) => {
                        const ft = e.target.value as CommodityConfig['freightType'];
                        setConfig(prev => {
                          const next = { ...prev, freightType: ft, useManualFreight: false };
                          const matched = freightRates.find(r => r.origin === prev.origin && r.destination === prev.destination && (ft ? r.freightType === ft : true));
                          if (matched) {
                            next.freightCostTotalCad = matched.cost;
                            next.volumePerLoadMt = matched.mtPerLoad;
                            if (matched.mtPerLoad > 0) {
                              next.deliveredFreightCadMt = Math.round((matched.cost / matched.mtPerLoad) * 100) / 100;
                            }
                          }
                          return next;
                        });
                      }}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      <option value="">All Types</option>
                      {[...new Set(freightRates.filter(r => r.origin === config.origin && r.destination === config.destination).map(r => r.freightType))].map(ft => (
                        <option key={ft} value={ft}>{ft}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={config.useManualFreight} onChange={() => setConfig(prev => ({ ...prev, useManualFreight: !prev.useManualFreight }))} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-checked:bg-[#141414] rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                    </label>
                    <span className="text-[10px] uppercase font-bold opacity-60">Manual Freight Entry</span>
                  </div>
                  <InputField label="Total Freight Cost (CAD)" value={calculations.freightCost} onChange={(v) => handleInputChange('freightCostTotalCad', v)} disabled={!config.useManualFreight} />
                  <InputField label="Volume per Load (MT)" value={config.volumePerLoadMt} onChange={(v) => handleInputChange('volumePerLoadMt', v)} disabled={!config.useManualFreight} />
                  <InputField label="Delivered Freight per MT (CAD)" value={calculations.deliveredFreight} onChange={(v) => handleInputChange('deliveredFreightCadMt', v)} disabled={!config.useManualFreight} />
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {config.isExport && (
              <motion.section 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="bg-white border border-[#141414] p-6 shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]"
              >
                <h2 className="text-xs font-bold uppercase mb-6 flex items-center gap-2 border-b border-[#141414] pb-2">
                  <Globe size={14} /> Export
                </h2>
                <div className="space-y-4">
                  <InputField label="Export Duty per MT (USD)" value={config.exportDutyUsdMt} onChange={(v) => handleInputChange('exportDutyUsdMt', v)} />
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Output Section */}
        <div className="lg:col-span-8 space-y-4">
          {/* Detailed Breakdown */}
          <section className="bg-white border border-[#141414] overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h2 className="text-xs font-bold uppercase tracking-widest">Cost Breakdown Analysis</h2>
              <div className="text-[10px] italic">Calculated for {customer}</div>
            </div>
            
            <div className="divide-y divide-[#141414]">
              <DataRow label={`Raw Sugar (USD/MT)`} value={`${calculations.rawMtUsd.toFixed(2)}`} />
              <DataRow label={`Ocean Freight (USD/MT)`} value={`${calculations.oceanFreightUsd.toFixed(2)}`} />
              <DataRow label={`Total USD`} value={`${calculations.totalUsd.toFixed(2)}`} highlight />
              <DataRow label={`Yield Multiplier`} value={`${calculations.yieldLoss.toFixed(2)}x`} />
              <DataRow label={`Total Cost of Raws ${calculations.currencySymbol} (MT)`} value={`${calculations.totalCostOfRawsCad.toFixed(2)}`} highlight />
              
              <DataRow label={`Margin ${calculations.currencySymbol} (MT)`} value={`${calculations.marginCadMt.toFixed(2)}`} />
              <DataRow label={`FCA Hamilton Bulk (${calculations.currencySymbol}/MT)`} value={`${calculations.fcaHamiltonBulk.toFixed(2)}`} highlight />
              
              {config.origin === 'Vancouver' && (
                <>
                  <DataRow label={`Vancouver Supply Chain Costs ${calculations.currencySymbol} (MT)`} value={`${calculations.vancouverSupplyChainCost.toFixed(2)}`} />
                  <DataRow label={`FCA Vancouver Bulk (${calculations.currencySymbol}/MT)`} value={`${calculations.fcaVancouverBulk.toFixed(2)}`} highlight />
                </>
              )}

              <DataRow label={`Differential ${calculations.currencySymbol} (MT)`} value={`${calculations.differential.toFixed(2)}`} />
              
              {config.isDelivered && (
                <DataRow label={`Delivered Freight (${calculations.currencySymbol}/MT)`} value={`${calculations.deliveredFreight.toFixed(2)}`} />
              )}
              {config.isExport && (
                <DataRow label={`Export Duty (${calculations.currencySymbol}/MT)`} value={`${calculations.exportDuty.toFixed(2)}`} />
              )}
              {config.isPalletCharge && (
                <DataRow label={`Pallet Charge (${calculations.currencySymbol}/MT) — ${config.palletType || 'Standard'}`} value={`${calculations.palletCharge.toFixed(2)}`} />
              )}
              {(config.paymentTerms || customers.find(c => c.name === customer)?.defaultPaymentTerms) && (
                <DataRow label="Payment Terms" value={`${config.paymentTerms || customers.find(c => c.name === customer)?.defaultPaymentTerms || ''}`} />
              )}

              <div className="p-6 bg-[#F5F5F5] grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-1">
                  <div className="text-[10px] uppercase opacity-50">Final Rate (MT)</div>
                  <div className="text-2xl font-black text-[#141414]">{calculations.currencySymbol} ${calculations.finalMt.toFixed(2)}</div>
                  <div className="text-[10px] italic">{calculations.currencySymbol} per Metric Ton</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] uppercase opacity-50">Unit Price ({calculations.selectedSku.netWeightKg ? `${calculations.selectedSku.netWeightKg}kg` : 'MT'})</div>
                  <div className="text-2xl font-black text-[#141414]">{calculations.currencySymbol} ${calculations.perUnit.toFixed(2)}</div>
                  <div className="text-[10px] italic">{calculations.currencySymbol} per {calculations.selectedSku.netWeightKg ? 'Unit' : 'Metric Ton'}</div>
                </div>
              </div>
            </div>
          </section>

          {/* Footer Info */}
          <div className="flex items-center gap-4 text-[10px] opacity-50 italic p-4 border border-dashed border-[#141414]">
            <Info size={12} />
            Note: Calculations are based on Hamilton/Vancouver transloading benchmarks. 
            Raw price is converted from USD/cwt using 22.0462 multiplier. 
            Yield loss is applied as a percentage multiplier.
          </div>
        </div>
      </main>
    );
    } catch (err: any) {
      console.error('Page render error:', err);
      return (
        <div className="p-6">
          <div className="bg-red-50 border border-red-300 p-6 text-center">
            <h2 className="text-lg font-bold text-red-800 mb-2">Something went wrong on this page</h2>
            <p className="text-sm text-red-600 mb-4">{err?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => setActivePage('Dashboard')}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-mono selection:bg-[#141414] selection:text-[#E4E3E0] flex">
      {/* Hidden File Input for CSV Import — use sr-only instead of hidden to ensure click() works in all browsers */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportCSV}
        accept=".csv"
        className="sr-only"
      />

      {/* Sidebar */}
      <aside className="w-64 border-r border-[#141414] bg-white/50 backdrop-blur-sm flex flex-col sticky top-0 h-screen z-50 print:hidden">
        <div className="p-6 border-b border-[#141414] flex items-center gap-3">
          <div className="bg-[#141414] text-[#E4E3E0] p-1.5">
            <TrendingUp size={20} />
          </div>
          <h1 className="text-sm font-bold uppercase tracking-tighter leading-none">Sweet<br/>Pro</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems
            .filter(item => isEditingSidebar || !hiddenPages.has(item.name))
            .map((item) => {
              const isHidden = hiddenPages.has(item.name);
              const isDragTarget = dragOverPage === item.name && draggedPage !== item.name;
              return (
                <div
                  key={item.name}
                  className={`flex items-center gap-1 ${isDragTarget ? 'border-t-2 border-indigo-500' : ''}`}
                  draggable={isEditingSidebar}
                  onDragStart={() => handlePageDragStart(item.name)}
                  onDragOver={(e) => handlePageDragOver(e, item.name)}
                  onDrop={() => handlePageDrop(item.name)}
                  onDragEnd={handlePageDragEnd}
                >
                  {isEditingSidebar && (
                    <div className="cursor-grab active:cursor-grabbing text-[#141414]/30 hover:text-[#141414]/60 px-0.5">
                      <GripVertical size={14} />
                    </div>
                  )}
                  <button
                    onClick={() => !isEditingSidebar && setActivePage(item.name)}
                    className={`flex-1 flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase transition-all border ${
                      isEditingSidebar && isHidden
                        ? 'bg-transparent text-[#141414]/30 border-transparent'
                        : activePage === item.name
                          ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,0.2)]'
                          : 'bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20'
                    } ${isEditingSidebar ? 'cursor-default' : ''} ${draggedPage === item.name ? 'opacity-40' : ''}`}
                  >
                    <item.icon size={16} />
                    {item.name}
                  </button>
                  {isEditingSidebar && (
                    <button
                      onClick={() => togglePageVisibility(item.name)}
                      className={`p-1.5 transition-all ${isHidden ? 'text-[#141414]/25 hover:text-[#141414]/60' : 'text-[#141414]/60 hover:text-[#141414]'}`}
                      title={isHidden ? `Show ${item.name}` : `Hide ${item.name}`}
                    >
                      {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
              );
            })}
          {isEditingSidebar && (
            <div className="pt-2 mt-2 border-t border-[#141414]/10">
              <p className="text-[9px] uppercase opacity-40 font-bold px-4">Drag to reorder, eye icon to show/hide pages</p>
            </div>
          )}
        </nav>

        {/* Customize Sidebar Toggle */}
        <div className="px-4 py-2 border-t border-[#141414]/10">
          <button
            onClick={() => setIsEditingSidebar(!isEditingSidebar)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-[10px] font-bold uppercase transition-all border ${
              isEditingSidebar
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-transparent text-[#141414]/50 border-transparent hover:border-[#141414]/20 hover:text-[#141414]'
            }`}
          >
            <Settings size={14} />
            {isEditingSidebar ? 'Done' : 'Customize Pages'}
          </button>
        </div>

        <div className="p-6 border-t border-[#141414] bg-[#F5F5F5] space-y-4">
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[10px] uppercase opacity-50 font-bold">Sync Status</div>
              <button
                onClick={() => loadDataFromFirestore()}
                disabled={syncStatus === 'syncing'}
                className="text-[9px] font-bold uppercase hover:underline disabled:opacity-50"
              >
                Sync Now
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              {syncStatus === 'synced' && <Cloud size={12} className="text-emerald-500" />}
              {syncStatus === 'syncing' && <RefreshCw size={12} className="text-indigo-500 animate-spin" />}
              {syncStatus === 'error' && <CloudOff size={12} className="text-red-500" />}
              {syncStatus === 'offline' && <CloudOff size={12} className="text-amber-500" />}
              <span className="capitalize">
                {syncStatus === 'offline' ? 'Not signed in' : syncStatus}
              </span>
            </div>
            {syncError && (
              <div className="text-[9px] text-red-500 mt-1 leading-tight font-bold break-words">
                {syncError}
              </div>
            )}
            {lastSynced && !syncError && (
              <div className="text-[8px] opacity-40 mt-1">
                Last synced: {lastSynced.toLocaleTimeString()}
              </div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase opacity-50 font-bold mb-2">System Status</div>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Live Market Data
            </div>
          </div>

          {user && (
            <div className="pt-2 border-t border-[#141414]/10">
              <div className="flex items-center gap-2">
                {user.photoURL && (
                  <img src={user.photoURL} alt="" className="w-6 h-6 rounded-full" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold truncate">{user.displayName || user.email}</div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="p-1 hover:bg-[#141414]/10 transition-colors"
                  title="Sign out"
                >
                  <LogOut size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="border-b border-[#141414] p-4 flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-40 print:hidden">
          <div className="flex items-center gap-4">
            <h2 className="text-xs font-bold uppercase tracking-widest opacity-50">{activePage}</h2>
          </div>
          <div className="flex gap-2">
            {activePage === 'Customer Quote' && (
              <>
                <button onClick={() => {
                  const selectedCust = customers.find(c => c.name === customer);
                  setEmailTo(selectedCust?.salesContactEmail || selectedCust?.contactEmail || '');
                  setEmailCc('');
                  const sku = skus.find(s => s.id === selectedSkuId) || skus[0];
                  setEmailSubject(`Quote - ${customer} - ${sku.name} - ${config.volumeMt} MT`);
                  setEmailIncludeMargin(false);
                  setShowEmailQuote(true);
                }} className="px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors text-xs font-bold flex items-center gap-2">
                  <Mail size={14} /> EMAIL QUOTE
                </button>
                <button onClick={() => setShowContractConfirm(true)} className="px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors text-xs font-bold flex items-center gap-2">
                  <FileText size={14} /> CREATE CONTRACT
                </button>
                <button className="px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:bg-opacity-80 transition-colors text-xs font-bold flex items-center gap-2">
                  <Save size={14} /> SAVE QUOTE
                </button>
              </>
            )}
          </div>
        </header>

        {renderContent()}
      </div>

      {/* Login Modal */}
      <AnimatePresence>
        {!user && !authLoading && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4">
                <h3 className="text-xs font-bold uppercase tracking-widest">Sign In Required</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs opacity-60">Sign in with your Google Workspace account to continue.</p>
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-3"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </button>
                {syncError && <div className="text-[10px] text-red-500 font-bold">{syncError}</div>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invoice Card Modal */}
      <AnimatePresence>
        {editingInvoiceCard && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto" onClick={() => setEditingInvoiceCard(null)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Invoice Details</h3>
                <button onClick={() => setEditingInvoiceCard(null)} className="p-1 hover:bg-white/20 transition-all"><X size={16} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">BOL Number</label>
                    <input type="text" value={editingInvoiceCard.bolNumber} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, bolNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Date</label>
                    <input type="date" value={editingInvoiceCard.date} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, date: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Customer</label>
                    <select value={editingInvoiceCard.customer} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, customer: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                      <option value="">Select customer</option>
                      {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select></div>
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Product</label>
                    <input type="text" value={editingInvoiceCard.product} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, product: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">PO Number</label>
                    <input type="text" value={editingInvoiceCard.po} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, po: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Quantity (MT)</label>
                    <input type="number" value={editingInvoiceCard.qty} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, qty: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Amount (CAD)</label>
                    <input type="number" value={editingInvoiceCard.amount} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Status</label>
                    <select value={editingInvoiceCard.status} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, status: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                      <option value="Pending">Pending</option>
                      <option value="Sent">Sent</option>
                      <option value="Paid">Paid</option>
                      <option value="Overdue">Overdue</option>
                      <option value="Cancelled">Cancelled</option>
                    </select></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Due Date</label>
                    <input type="date" value={editingInvoiceCard.dueDate || ''} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, dueDate: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                  <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Carrier</label>
                    <input type="text" value={editingInvoiceCard.carrier} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, carrier: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                </div>
                <div><label className="text-[10px] uppercase font-bold opacity-60 block mb-1">Split No.</label>
                  <input type="text" value={editingInvoiceCard.splitNo || ''} onChange={(e) => setEditingInvoiceCard({ ...editingInvoiceCard, splitNo: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
                <div className="flex justify-end gap-2 pt-4 border-t border-[#141414]/10">
                  <button onClick={() => setEditingInvoiceCard(null)}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">Cancel</button>
                  <button onClick={() => {
                    setInvoices(invoices.map(inv => inv.id === editingInvoiceCard.id ? editingInvoiceCard : inv));
                    setEditingInvoiceCard(null);
                  }} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all">Save Changes</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add / Edit Carrier Modal */}
      <AnimatePresence>
        {editingCarrier && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">{isAddingCarrier ? 'Add Carrier' : 'Edit Carrier'}</h3>
                <button onClick={() => { setIsAddingCarrier(false); setEditingCarrier(null); }} className="hover:rotate-90 transition-transform"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Carrier Number</label>
                    <input type="text" value={editingCarrier.carrierNumber}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, carrierNumber: e.target.value })}
                      placeholder="e.g. CAR-001"
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Carrier Name</label>
                    <input type="text" value={editingCarrier.name}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, name: e.target.value })}
                      placeholder="Carrier name"
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Contact Email</label>
                    <input type="email" value={editingCarrier.contactEmail || ''}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, contactEmail: e.target.value })}
                      placeholder="email@example.com"
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Contact Phone</label>
                    <input type="tel" value={editingCarrier.contactPhone || ''}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, contactPhone: e.target.value })}
                      placeholder="(555) 123-4567"
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Default Location</label>
                    <select
                      value={editingCarrier.defaultLocationCode || ''}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, defaultLocationCode: e.target.value })}
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    >
                      <option value="">No Default</option>
                      {locations.map(l => (
                        <option key={l.id} value={l.locationCode}>{l.locationCode} — {l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Notes</label>
                    <textarea value={editingCarrier.notes || ''}
                      onChange={(e) => setEditingCarrier({ ...editingCarrier, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={1}
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
                  </div>
                </div>
                <div className="flex gap-4 pt-4 border-t border-[#141414]/10">
                  <button
                    onClick={() => {
                      if (!editingCarrier.name) { alert('Please enter a carrier name'); return; }
                      if (isAddingCarrier) {
                        const newCarrier: Carrier = {
                          ...editingCarrier,
                          id: `CARRIER-${Date.now()}`,
                          carrierNumber: editingCarrier.carrierNumber || `CAR-${Date.now().toString().slice(-4)}`,
                        };
                        setCarriers(prev => [...prev, newCarrier]);
                      } else {
                        setCarriers(prev => prev.map(c => c.id === editingCarrier.id ? editingCarrier : c));
                      }
                      setIsAddingCarrier(false);
                      setEditingCarrier(null);
                    }}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} /> {isAddingCarrier ? 'Add Carrier' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => { setIsAddingCarrier(false); setEditingCarrier(null); }}
                    className="flex-1 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showContractConfirm && (() => {
          const confirmSku = skus.find(s => s.id === selectedSkuId) || skus[0];
          const confirmCustomer = customers.find(c => c.name === customer);
          const totalValue = calculations.finalMt * config.volumeMt;
          return (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center gap-3">
                <AlertCircle size={20} className="text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Contract Creation</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm leading-relaxed">
                  Are you sure you want to create a new contract for <span className="font-bold underline">{customer}</span>?
                  This will finalize the current quote parameters into a binding contract record.
                </p>
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Contract Summary</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="opacity-60">Customer</div>
                    <div className="font-bold text-right">{customer}</div>
                    {confirmCustomer?.customerNumber && <>
                      <div className="opacity-60">Customer #</div>
                      <div className="font-bold text-right">{confirmCustomer.customerNumber}</div>
                    </>}
                    <div className="opacity-60">Product (SKU)</div>
                    <div className="font-bold text-right">{confirmSku.name}</div>
                    <div className="opacity-60">Origin</div>
                    <div className="font-bold text-right">{config.origin}</div>
                    {config.isDelivered && <>
                      <div className="opacity-60">Destination</div>
                      <div className="font-bold text-right">{config.destination}</div>
                      {config.freightType && <>
                        <div className="opacity-60">Freight Type</div>
                        <div className="font-bold text-right">{config.freightType}</div>
                      </>}
                      <div className="opacity-60">Delivered Freight</div>
                      <div className="font-bold text-right">{calculations.currencySymbol} ${calculations.deliveredFreight.toFixed(2)}/MT</div>
                    </>}
                    <div className="opacity-60">Currency</div>
                    <div className="font-bold text-right">{config.currency}</div>
                    <div className="opacity-60">Contract Volume</div>
                    <div className="font-bold text-right">{config.volumeMt} MT</div>
                    <div className="opacity-60">Start Date</div>
                    <div className="font-bold text-right">{config.contractStartDate || 'N/A'}</div>
                    <div className="opacity-60">End Date</div>
                    <div className="font-bold text-right">{config.contractEndDate || 'N/A'}</div>
                    {(config.paymentTerms || customers.find(c => c.name === customer)?.defaultPaymentTerms) && <>
                      <div className="opacity-60">Payment Terms</div>
                      <div className="font-bold text-right">{config.paymentTerms || customers.find(c => c.name === customer)?.defaultPaymentTerms}</div>
                    </>}
                    {config.palletType && <>
                      <div className="opacity-60">Pallet Type</div>
                      <div className="font-bold text-right">{config.palletType}</div>
                    </>}
                  </div>
                  <div className="border-t border-[#141414]/10 pt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="opacity-60">Final Price</div>
                    <div className="font-black text-right text-base">{calculations.currencySymbol} ${calculations.finalMt.toFixed(2)}/MT</div>
                    <div className="opacity-60">Unit Price ({confirmSku.netWeightKg ? `${confirmSku.netWeightKg}kg` : 'MT'})</div>
                    <div className="font-bold text-right">{calculations.currencySymbol} ${calculations.perUnit.toFixed(2)}</div>
                    <div className="opacity-60">Total Contract Value</div>
                    <div className="font-bold text-right">{calculations.currencySymbol} ${totalValue.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={createContract}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} /> Confirm & Create
                  </button>
                  <button
                    onClick={() => setShowContractConfirm(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
          );
        })()}

        {showEmailQuote && (() => {
          const emailSku = skus.find(s => s.id === selectedSkuId) || skus[0];
          const emailCustomer = customers.find(c => c.name === customer);
          const cs = calculations.currencySymbol;
          const senderName = user?.displayName || 'Sweet Pro Trading';
          const senderEmail = user?.email || '';
          const buildEmailBody = () => {
            let lines: string[] = [];
            lines.push(`Dear ${customer},`);
            lines.push('');
            lines.push('Please find below the pricing details for your review:');
            lines.push('');
            lines.push('QUOTE SUMMARY');
            lines.push('-------------------------------------');
            lines.push(`Product: ${emailSku.name}`);
            lines.push(`Origin: ${config.origin}`);
            if (config.isDelivered) lines.push(`Destination: ${config.destination}`);
            lines.push(`Volume: ${config.volumeMt} MT`);
            lines.push(`Currency: ${config.currency}`);
            if (config.contractStartDate) lines.push(`Contract Period: ${config.contractStartDate} to ${config.contractEndDate || 'TBD'}`);
            lines.push('');
            lines.push('COST BREAKDOWN');
            lines.push('-------------------------------------');
            lines.push(`Raw Sugar (USD/MT): $${calculations.rawMtUsd.toFixed(2)}`);
            lines.push(`Ocean Freight (USD/MT): $${calculations.oceanFreightUsd.toFixed(2)}`);
            lines.push(`Total USD: $${calculations.totalUsd.toFixed(2)}`);
            lines.push(`Yield Multiplier: ${calculations.yieldLoss.toFixed(2)}x`);
            lines.push(`Total Cost of Raws (${cs}/MT): $${calculations.totalCostOfRawsCad.toFixed(2)}`);
            if (emailIncludeMargin) {
              lines.push(`Margin (${cs}/MT): $${calculations.marginCadMt.toFixed(2)}`);
            }
            lines.push(`FCA ${config.origin} Bulk (${cs}/MT): $${(config.origin === 'Vancouver' ? calculations.fcaVancouverBulk : calculations.fcaHamiltonBulk).toFixed(2)}`);
            if (config.origin === 'Vancouver') {
              lines.push(`Supply Chain Costs (${cs}/MT): $${calculations.vancouverSupplyChainCost.toFixed(2)}`);
            }
            lines.push(`Differential (${cs}/MT): $${calculations.differential.toFixed(2)}`);
            if (config.isDelivered) {
              lines.push(`Delivered Freight (${cs}/MT): $${calculations.deliveredFreight.toFixed(2)}`);
            }
            if (config.isExport) {
              lines.push(`Export Duty (${cs}/MT): $${calculations.exportDuty.toFixed(2)}`);
            }
            if (config.isPalletCharge) {
              lines.push(`Pallet Charge (${cs}/MT): $${calculations.palletCharge.toFixed(2)} — ${config.palletType || 'Standard'}`);
            }
            const emailPaymentTerms = config.paymentTerms || customers.find(c => c.name === customer)?.defaultPaymentTerms;
            if (emailPaymentTerms) {
              lines.push(`Payment Terms: ${emailPaymentTerms}`);
            }
            lines.push('');
            lines.push('FINAL PRICING');
            lines.push('-------------------------------------');
            lines.push(`Final Price: ${cs} $${calculations.finalMt.toFixed(2)}/MT`);
            lines.push(`Unit Price (${emailSku.netWeightKg ? emailSku.netWeightKg + 'kg' : 'MT'}): ${cs} $${calculations.perUnit.toFixed(2)}`);
            lines.push(`Total Quote Value: ${cs} $${calculations.totalQuoteValue.toFixed(2)}`);
            lines.push('');
            lines.push('Please let us know if you have any questions or would like to proceed.');
            lines.push('');
            lines.push('Best regards,');
            lines.push(senderName);
            if (senderEmail) lines.push(senderEmail);
            return lines.join('\n');
          };
          const openInGmail = () => {
            const body = buildEmailBody();
            const to = encodeURIComponent(emailTo);
            const cc = emailCc ? `&cc=${encodeURIComponent(emailCc)}` : '';
            const su = encodeURIComponent(emailSubject);
            const bo = encodeURIComponent(body);
            window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}${cc}&su=${su}&body=${bo}`, '_blank');
            setShowEmailQuote(false);
          };
          return (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2"><Mail size={16} /> Email Quote</h3>
                <button onClick={() => setShowEmailQuote(false)} className="hover:opacity-70"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Include Margin Toggle */}
                <div className="flex items-center gap-3 pb-3 border-b border-[#141414]/10">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={emailIncludeMargin} onChange={() => setEmailIncludeMargin(!emailIncludeMargin)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none peer-checked:bg-[#141414] rounded-full peer after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"></div>
                  </label>
                  <span className="text-[10px] uppercase font-bold opacity-60">Include Margin</span>
                </div>

                {/* Email Fields */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">From</label>
                    <div className="w-full bg-[#F5F5F5] border border-[#141414]/30 p-2 text-sm text-[#141414]/70">
                      {senderName}{senderEmail ? ` <${senderEmail}>` : ''}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">To</label>
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="recipient@example.com"
                    />
                    {emailCustomer && (emailCustomer.qaContractEmail || emailCustomer.salesContactEmail || emailCustomer.customerServiceEmail || emailCustomer.contactEmail) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {emailCustomer.contactEmail && (
                          <button onClick={() => setEmailTo(emailCustomer.contactEmail!)} className="text-[9px] px-2 py-0.5 bg-[#F5F5F5] border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            Main: {emailCustomer.contactEmail}
                          </button>
                        )}
                        {emailCustomer.qaContractEmail && (
                          <button onClick={() => setEmailTo(emailCustomer.qaContractEmail!)} className="text-[9px] px-2 py-0.5 bg-[#F5F5F5] border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            QA: {emailCustomer.qaContractEmail}
                          </button>
                        )}
                        {emailCustomer.salesContactEmail && (
                          <button onClick={() => setEmailTo(emailCustomer.salesContactEmail!)} className="text-[9px] px-2 py-0.5 bg-[#F5F5F5] border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            Sales: {emailCustomer.salesContactEmail}
                          </button>
                        )}
                        {emailCustomer.customerServiceEmail && (
                          <button onClick={() => setEmailTo(emailCustomer.customerServiceEmail!)} className="text-[9px] px-2 py-0.5 bg-[#F5F5F5] border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            CS: {emailCustomer.customerServiceEmail}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">CC</label>
                    <input
                      type="email"
                      value={emailCc}
                      onChange={(e) => setEmailCc(e.target.value)}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="cc@example.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Subject</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>

                {/* Email Body Preview */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Email Body Preview</label>
                  <div className="bg-white border border-[#141414] p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                    {buildEmailBody()}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-[#141414]/10 flex gap-3">
                <button
                  onClick={openInGmail}
                  disabled={!emailTo}
                  className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send size={14} /> Send via Gmail
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildEmailBody());
                    alert('Email body copied to clipboard!');
                  }}
                  className="px-6 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                >
                  Copy Body
                </button>
                <button
                  onClick={() => setShowEmailQuote(false)}
                  className="px-6 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
          );
        })()}

        {isAddingBatchShipment && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[24px_24px_0px_0px_rgba(20,20,20,1)] max-w-4xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-6 flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase tracking-widest">Schedule Batch Shipments from Orders</h3>
                <button onClick={() => setIsAddingBatchShipment(false)} className="hover:rotate-90 transition-transform">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm opacity-60">Select confirmed orders to schedule as shipments. Use the "Add Shipment" button for individual order scheduling.</p>
                {(() => {
                  const isHamilton = activePage === 'Hamilton Shipments';
                  const locationName = isHamilton ? 'Hamilton' : 'Vancouver';
                  const confirmedOrders = orders.filter(o => o.status === 'Confirmed');
                  const allShipments = [...hamiltonShipments, ...vancouverShipments];
                  const unscheduledOrders = confirmedOrders.filter(o => !allShipments.some(s => s.bol === o.bolNumber));
                  return (
                    <div className="border border-[#141414] overflow-hidden">
                      <div className="bg-[#141414] text-[#E4E3E0] p-3">
                        <h4 className="text-xs font-bold uppercase">Confirmed Orders — {unscheduledOrders.length} ready to schedule</h4>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-[#F5F5F5] border-b border-[#141414]/10 sticky top-0">
                            <tr>
                              <th className="p-2 text-left font-bold text-[10px] uppercase">BOL #</th>
                              <th className="p-2 text-left font-bold text-[10px] uppercase">Customer</th>
                              <th className="p-2 text-left font-bold text-[10px] uppercase">Product</th>
                              <th className="p-2 text-left font-bold text-[10px] uppercase">PO #</th>
                              <th className="p-2 text-right font-bold text-[10px] uppercase">Weight (KG)</th>
                              <th className="p-2 text-center font-bold text-[10px] uppercase">Schedule</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#141414]/5">
                            {unscheduledOrders.length === 0 && (
                              <tr><td colSpan={6} className="p-4 text-center text-xs opacity-40 italic">No confirmed unscheduled orders found</td></tr>
                            )}
                            {unscheduledOrders.map(o => (
                              <tr key={o.id} className="hover:bg-[#F9F9F9] transition-colors">
                                <td className="p-2 font-bold font-mono">{o.bolNumber}</td>
                                <td className="p-2">{o.customer}</td>
                                <td className="p-2 truncate max-w-[150px]">{o.product}</td>
                                <td className="p-2">{o.po}</td>
                                <td className="p-2 text-right font-bold">{(o.lineItems.reduce((s, li) => s + li.totalWeight, 0) * 1000).toFixed(0)}</td>
                                <td className="p-2 text-center">
                                  <button
                                    onClick={() => {
                                      setIsAddingBatchShipment(false);
                                      const customer = customers.find(c => c.name === o.customer);
                                      const loc = customer?.defaultLocation || locationName;
                                      setShipmentCreationData({ location: loc as 'Hamilton' | 'Vancouver', date: o.shipmentDate || '', time: '', bay: '', carrier: o.carrier || '', orderId: o.id });
                                      setIsCreatingShipments(true);
                                    }}
                                    className="px-3 py-1 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-opacity-80 transition-all"
                                  >
                                    Schedule
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
                <div className="flex justify-end pt-4 border-t border-[#141414]/10">
                  <button
                    onClick={() => setIsAddingBatchShipment(false)}
                    className="px-8 py-4 border-2 border-[#141414] text-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {(isAddingShipment || editingShipment) && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-4xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  {isAddingShipment ? 'Add Shipment from Order' : 'Edit Shipment'}
                </h3>
                <button onClick={() => { setIsAddingShipment(false); setEditingShipment(null); }} className="hover:rotate-90 transition-transform">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {isAddingShipment ? (
                  <>
                    {/* Order Lookup Section */}
                    {(() => {
                      const isHamilton = activePage === 'Hamilton Shipments';
                      const locationName = isHamilton ? 'Hamilton' : 'Vancouver';
                      const confirmedOrders = orders.filter(o => o.status === 'Confirmed');
                      const allShipments = [...hamiltonShipments, ...vancouverShipments];
                      const unscheduledOrders = confirmedOrders.filter(o => !allShipments.some(s => s.bol === o.bolNumber));

                      const filteredBOLOrders = unscheduledOrders.filter(o => {
                        const matchesCustomer = !shipmentSearchCustomer || o.customer === shipmentSearchCustomer;
                        const matchesBOL = !shipmentSearchBOL || o.bolNumber.toLowerCase().includes(shipmentSearchBOL.toLowerCase());
                        return matchesCustomer && matchesBOL;
                      });

                      const filteredTransfersForShipment = transfers.filter(t => {
                        const matchesSearch = !shipmentSearchTransfer ||
                          t.transferNumber.toLowerCase().includes(shipmentSearchTransfer.toLowerCase()) ||
                          t.product.toLowerCase().includes(shipmentSearchTransfer.toLowerCase()) ||
                          t.from.toLowerCase().includes(shipmentSearchTransfer.toLowerCase()) ||
                          t.to.toLowerCase().includes(shipmentSearchTransfer.toLowerCase()) ||
                          (t.lotCode || '').toLowerCase().includes(shipmentSearchTransfer.toLowerCase());
                        return matchesSearch;
                      });

                      const uniqueCustomers = [...new Set(unscheduledOrders.map(o => o.customer))];

                      return (
                        <div className="space-y-4">
                          <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-widest">Find Confirmed Order</h4>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-0.5">
                                <label className="text-[10px] uppercase font-bold opacity-60">Customer Number</label>
                                <select
                                  value={shipmentSearchCustomer}
                                  onChange={(e) => {
                                    const custName = e.target.value;
                                    setShipmentSearchCustomer(custName);
                                    setShipmentSearchBOL('');
                                  }}
                                  className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                                >
                                  <option value="">All Customers</option>
                                  {uniqueCustomers.map(name => {
                                    const cust = customers.find(c => c.name === name);
                                    return <option key={name} value={name}>{cust?.id || ''} — {name}</option>;
                                  })}
                                </select>
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[10px] uppercase font-bold opacity-60">Customer Name</label>
                                <select
                                  value={shipmentSearchCustomer}
                                  onChange={(e) => {
                                    setShipmentSearchCustomer(e.target.value);
                                    setShipmentSearchBOL('');
                                  }}
                                  className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                                >
                                  <option value="">All Customers</option>
                                  {uniqueCustomers.map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[10px] uppercase font-bold opacity-60">BOL Number</label>
                                <input
                                  type="text"
                                  value={shipmentSearchBOL}
                                  onChange={(e) => setShipmentSearchBOL(e.target.value)}
                                  placeholder="Search BOL..."
                                  className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                                  list="bol-options"
                                />
                                <datalist id="bol-options">
                                  {filteredBOLOrders.map(o => <option key={o.id} value={o.bolNumber} />)}
                                </datalist>
                              </div>
                            </div>
                          </div>

                          {/* Matching Orders */}
                          <div className="border border-[#141414] overflow-hidden">
                            <div className="bg-[#141414] text-[#E4E3E0] p-3">
                              <h4 className="text-xs font-bold uppercase">Confirmed Orders — {filteredBOLOrders.length} available</h4>
                            </div>
                            <div className="max-h-[250px] overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-[#F5F5F5] border-b border-[#141414]/10 sticky top-0">
                                  <tr>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">BOL #</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Customer</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Product</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">PO #</th>
                                    <th className="p-2 text-right font-bold text-[10px] uppercase">Weight (KG)</th>
                                    <th className="p-2 text-center font-bold text-[10px] uppercase">Schedule</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#141414]/5">
                                  {filteredBOLOrders.length === 0 && (
                                    <tr><td colSpan={6} className="p-4 text-center text-xs opacity-40 italic">No confirmed unscheduled orders found</td></tr>
                                  )}
                                  {filteredBOLOrders.map(o => (
                                    <tr key={o.id} className="hover:bg-[#F9F9F9] transition-colors">
                                      <td className="p-2 font-bold font-mono">{o.bolNumber}</td>
                                      <td className="p-2">{o.customer}</td>
                                      <td className="p-2 truncate max-w-[150px]">{o.product}</td>
                                      <td className="p-2">{o.po}</td>
                                      <td className="p-2 text-right font-bold">{(o.lineItems.reduce((s, li) => s + li.totalWeight, 0) * 1000).toFixed(0)}</td>
                                      <td className="p-2 text-center">
                                        <button
                                          onClick={() => {
                                            setIsAddingShipment(false);
                                            setEditingShipment(null);
                                            const customer = customers.find(c => c.name === o.customer);
                                            const loc = customer?.defaultLocation || locationName;
                                            // Preserve pre-filled date/time/bay from schedule + button click
                                            setShipmentCreationData(prev => ({
                                              location: prev.date ? prev.location : loc as 'Hamilton' | 'Vancouver',
                                              date: prev.date || o.shipmentDate || '',
                                              time: prev.time || '',
                                              bay: prev.bay || '',
                                              carrier: o.carrier || prev.carrier || '',
                                              orderId: o.id
                                            }));
                                            setIsCreatingShipments(true);
                                          }}
                                          className="px-3 py-1 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-opacity-80 transition-all"
                                        >
                                          Schedule
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Transfer Search */}
                          <div className="border border-[#141414] overflow-hidden">
                            <div className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center">
                              <h4 className="text-xs font-bold uppercase">Transfers</h4>
                              <input
                                type="text"
                                value={shipmentSearchTransfer}
                                onChange={(e) => setShipmentSearchTransfer(e.target.value)}
                                placeholder="Search transfers..."
                                className="bg-white/10 border border-[#E4E3E0]/20 px-2 py-1 text-xs text-[#E4E3E0] placeholder-[#E4E3E0]/40 focus:outline-none w-48"
                              />
                            </div>
                            <div className="max-h-[200px] overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-[#F5F5F5] border-b border-[#141414]/10 sticky top-0">
                                  <tr>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Transfer #</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">From</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">To</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Product</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Lot Code</th>
                                    <th className="p-2 text-right font-bold text-[10px] uppercase">Amount</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#141414]/5">
                                  {filteredTransfersForShipment.length === 0 && (
                                    <tr><td colSpan={6} className="p-4 text-center text-xs opacity-40 italic">No transfers found</td></tr>
                                  )}
                                  {filteredTransfersForShipment.map(t => (
                                    <tr key={t.id} className="hover:bg-[#F9F9F9] transition-colors">
                                      <td className="p-2 font-bold font-mono">{t.transferNumber}</td>
                                      <td className="p-2">{t.from}</td>
                                      <td className="p-2">{t.to}</td>
                                      <td className="p-2">{t.product}</td>
                                      <td className="p-2 font-mono">{t.lotCode || '—'}</td>
                                      <td className="p-2 text-right font-bold">{t.amount} MT</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    <div className="flex gap-4">
                      <button
                        onClick={() => { setIsAddingShipment(false); setEditingShipment(null); }}
                        className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                      >
                        Close
                      </button>
                    </div>
                  </>
                ) : editingShipment ? (
                  <>
                    {/* Edit Shipment - minimal fields */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Date</label>
                        <input
                          type="date"
                          value={editingShipment.date || ''}
                          onChange={(e) => {
                            const date = e.target.value;
                            const week = `Week ${getWeekNumber(date)}`;
                            const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(date + 'T12:00:00'));
                            setEditingShipment({...editingShipment, date, week, day});
                          }}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Time</label>
                        <select
                          value={editingShipment.time || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, time: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        >
                          {getLocationAllTimeSlots(activePage === 'Hamilton Shipments' ? 'Hamilton' : 'Vancouver').map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Bay</label>
                        <select
                          value={editingShipment.bay || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, bay: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        >
                          {locations
                            .find(l => l.name.toLowerCase().includes(activePage === 'Hamilton Shipments' ? 'hamilton' : 'vancouver'))
                            ?.bays.map(b => <option key={b} value={b}>{b}</option>)
                          }
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Status</label>
                        <select
                          value={editingShipment.status || 'Confirmed'}
                          onChange={(e) => setEditingShipment({...editingShipment, status: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        >
                          <option value="Confirmed">Confirmed</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Cancelled">Cancelled</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                        <select
                          value={editingShipment.carrier || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, carrier: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        >
                          <option value="">Select Carrier</option>
                          {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Arrive</label>
                        <input
                          type="time"
                          value={editingShipment.arrive || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, arrive: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Start</label>
                        <input
                          type="time"
                          value={editingShipment.start || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, start: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Out</label>
                        <input
                          type="time"
                          value={editingShipment.out || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, out: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Delivery Date</label>
                        <input
                          type="date"
                          value={editingShipment.deliveryDate || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, deliveryDate: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Lot Number</label>
                        <input
                          type="text"
                          value={editingShipment.lotNumber || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, lotNumber: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                          placeholder="Enter lot number"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Scaled Qty (MT)</label>
                        <input
                          type="number"
                          value={editingShipment.scaledQty || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, scaledQty: parseFloat(e.target.value) || undefined})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                          placeholder="Scaled quantity"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Trailer No</label>
                        <input
                          type="text"
                          value={editingShipment.trailerNo || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, trailerNo: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                          placeholder="Trailer number"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Colour</label>
                        <input
                          type="text"
                          value={editingShipment.colour || ''}
                          onChange={(e) => setEditingShipment({...editingShipment, colour: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                          placeholder="Colour"
                        />
                      </div>
                    </div>
                    {/* Summary info */}
                    <div className="bg-[#F5F5F5] p-3 border border-[#141414]/10 grid grid-cols-4 gap-3 text-xs">
                      <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Customer</span><span className="font-bold">{editingShipment.customer}</span></div>
                      <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Product</span><span className="font-bold">{editingShipment.product}</span></div>
                      <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">BOL #</span><span className="font-bold font-mono">{editingShipment.bol}</span></div>
                      <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">QTY</span><span className="font-bold">{editingShipment.qty}</span></div>
                    </div>
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          const isHamilton = activePage === 'Hamilton Shipments';
                          const list = isHamilton ? hamiltonShipments : vancouverShipments;
                          const setList = isHamilton ? setHamiltonShipments : setVancouverShipments;
                          setList(list.map(s => s.id === editingShipment.id ? editingShipment : s));
                          setIsAddingShipment(false);
                          setEditingShipment(null);
                        }}
                        className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => { setIsAddingShipment(false); setEditingShipment(null); }}
                        className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </motion.div>
          </div>
        )}

        {isAddingFreightRate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Freight Rate</h3>
                <button onClick={() => setIsAddingFreightRate(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                    <select 
                      value={newFreightRate.origin} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, origin: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Destination</label>
                    <input 
                      type="text" 
                      value={newFreightRate.destination} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, destination: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Carrier</label>
                    <select
                      value={newFreightRate.provider}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Carrier</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Freight Type</label>
                    <select 
                      value={newFreightRate.freightType} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, freightType: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Dry Van">Dry Van</option>
                      <option value="Bulk">Bulk</option>
                      <option value="Liquid">Liquid</option>
                      <option value="Bulk Rail">Bulk Rail</option>
                      <option value="Intermodal">Intermodal</option>
                      <option value="Transload">Transload</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={newFreightRate.cost || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT / Load</label>
                    <input
                      type="text" inputMode="decimal"
                      value={newFreightRate.mtPerLoad || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, mtPerLoad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Start Date</label>
                    <input
                      type="date"
                      value={newFreightRate.startDate || ''}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, startDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">End Date</label>
                    <input
                      type="date"
                      value={newFreightRate.endDate || ''}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, endDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setFreightRates([...freightRates, newFreightRate]);
                      setIsAddingFreightRate(false);
                    }}
                    disabled={!newFreightRate.destination}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Save Rate
                  </button>
                  <button 
                    onClick={() => setIsAddingFreightRate(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingContract && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Contract: {editingContract.contractNumber}</h3>
                <button onClick={() => setEditingContract(null)} className="hover:rotate-90 transition-transform">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Contract Number</label>
                    <input
                      type="text"
                      value={editingContract.contractNumber}
                      onChange={(e) => setEditingContract({ ...editingContract, contractNumber: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Name</label>
                    <select
                      value={editingContract.customerName}
                      onChange={(e) => {
                        const selectedCust = customers.find(c => c.name === e.target.value);
                        setEditingContract({
                          ...editingContract,
                          customerName: e.target.value,
                          customerNumber: selectedCust?.id || editingContract.customerNumber
                        });
                      }}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Customer</option>
                      {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Volume (MT) <span className="text-[8px] opacity-40">(locked)</span></label>
                    <input
                      type="text"
                      value={editingContract.contractVolume || ""}
                      disabled
                      className="w-full bg-[#E4E3E0] border border-[#141414]/30 p-3 text-sm text-[#141414]/60 cursor-not-allowed outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Final Price <span className="text-[8px] opacity-40">(locked)</span></label>
                    <input
                      type="text"
                      value={editingContract.finalPrice || ""}
                      disabled
                      className="w-full bg-[#E4E3E0] border border-[#141414]/30 p-3 text-sm text-[#141414]/60 cursor-not-allowed outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Start Date <span className="text-[8px] opacity-40">(locked)</span></label>
                    <input
                      type="date"
                      value={editingContract.startDate}
                      disabled
                      className="w-full bg-[#E4E3E0] border border-[#141414]/30 p-3 text-sm text-[#141414]/60 cursor-not-allowed outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">End Date <span className="text-[8px] opacity-40">(locked)</span></label>
                    <input
                      type="date"
                      value={editingContract.endDate}
                      disabled
                      className="w-full bg-[#E4E3E0] border border-[#141414]/30 p-3 text-sm text-[#141414]/60 cursor-not-allowed outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                    <select
                      value={editingContract.origin || 'Hamilton'}
                      onChange={(e) => setEditingContract({ ...editingContract, origin: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Shipping Terms</label>
                    <select
                      value={editingContract.shippingTerms || ''}
                      onChange={(e) => setEditingContract({ ...editingContract, shippingTerms: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Terms</option>
                      <option value="FOB">FOB</option>
                      <option value="DAP">DAP</option>
                      <option value="DDP">DDP</option>
                      <option value="FCA">FCA</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Payment Terms</label>
                    <select
                      value={editingContract.paymentTerms || ''}
                      onChange={(e) => setEditingContract({ ...editingContract, paymentTerms: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select...</option>
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 90">Net 90</option>
                      <option value="2% / Net 15">2% / Net 15</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Pallet Type</label>
                    <select
                      value={editingContract.palletType || ''}
                      onChange={(e) => setEditingContract({ ...editingContract, palletType: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">None</option>
                      <option value="CHEP">CHEP Pallet</option>
                      <option value="One Way">One Way Pallet</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setContracts(contracts.map(c => c.id === editingContract.id ? editingContract : c));
                      setEditingContract(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingContract(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {selectedContractDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto" onClick={() => setSelectedContractDetail(null)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Contract Detail: {selectedContractDetail.contractNumber}</h3>
                <button onClick={() => setSelectedContractDetail(null)} className="hover:rotate-90 transition-transform">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Contract Information */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Contract Information</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="opacity-60">Contract Number</div>
                    <div className="font-bold text-right">{selectedContractDetail.contractNumber}</div>
                    <div className="opacity-60">Customer</div>
                    <div className="font-bold text-right">{selectedContractDetail.customerName}</div>
                    <div className="opacity-60">Customer #</div>
                    <div className="font-bold text-right">{selectedContractDetail.customerNumber}</div>
                    <div className="opacity-60">Start Date</div>
                    <div className="font-bold text-right">{selectedContractDetail.startDate}</div>
                    <div className="opacity-60">End Date</div>
                    <div className="font-bold text-right">{selectedContractDetail.endDate}</div>
                    <div className="opacity-60">Shipping Terms</div>
                    <div className="font-bold text-right">{selectedContractDetail.shippingTerms || '—'}</div>
                    <div className="opacity-60">Payment Terms</div>
                    <div className="font-bold text-right">{selectedContractDetail.paymentTerms || '—'}</div>
                    <div className="opacity-60">Pallet Type</div>
                    <div className="font-bold text-right">{selectedContractDetail.palletType || '—'}</div>
                    <div className="opacity-60">Currency</div>
                    <div className="font-bold text-right">{selectedContractDetail.currency}</div>
                  </div>
                </div>

                {/* Product */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="opacity-60">SKU</div>
                    <div className="font-bold text-right">{selectedContractDetail.skuName}</div>
                    <div className="opacity-60">Origin</div>
                    <div className="font-bold text-right">{selectedContractDetail.origin}</div>
                    <div className="opacity-60">Destination</div>
                    <div className="font-bold text-right">{selectedContractDetail.destination || '—'}</div>
                  </div>
                </div>

                {/* Volume */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Volume</div>
                  <div className="grid grid-cols-3 gap-4 text-xs text-center">
                    <div>
                      <div className="opacity-60 mb-1">Total</div>
                      <div className="font-black text-lg">{selectedContractDetail.contractVolume} <span className="text-[10px] font-bold opacity-50">MT</span></div>
                    </div>
                    <div>
                      <div className="opacity-60 mb-1">Taken</div>
                      <div className="font-black text-lg">{selectedContractDetail.volumeTaken || 0} <span className="text-[10px] font-bold opacity-50">MT</span></div>
                    </div>
                    <div>
                      <div className="opacity-60 mb-1">Outstanding</div>
                      <div className="font-black text-lg">{selectedContractDetail.volumeOutstanding || selectedContractDetail.contractVolume} <span className="text-[10px] font-bold opacity-50">MT</span></div>
                    </div>
                  </div>
                </div>

                {/* Pricing Breakdown */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Pricing Breakdown</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                    <div className="opacity-60">FX Rate (USD/CAD)</div>
                    <div className="font-bold text-right">{selectedContractDetail.fxRate?.toFixed(4) || '—'}</div>
                    <div className="opacity-60">Raw #11 (USD/MT)</div>
                    <div className="font-bold text-right">{selectedContractDetail.rawPriceUsdMt ? `$${selectedContractDetail.rawPriceUsdMt.toFixed(2)}` : '—'}</div>
                    <div className="opacity-60">Delivered Freight</div>
                    <div className="font-bold text-right">{selectedContractDetail.deliveredFreight ? `$${selectedContractDetail.deliveredFreight.toFixed(2)}/MT` : '—'}</div>
                    <div className="opacity-60">Export Duty</div>
                    <div className="font-bold text-right">{selectedContractDetail.exportDuty ? `$${selectedContractDetail.exportDuty.toFixed(2)}/MT` : '—'}</div>
                    <div className="opacity-60">Pallet Charge</div>
                    <div className="font-bold text-right">{selectedContractDetail.palletCharge ? `$${selectedContractDetail.palletCharge.toFixed(2)}/MT` : '—'}</div>
                  </div>
                  <div className="border-t border-[#141414]/10 pt-3 grid grid-cols-2 gap-x-6 text-xs">
                    <div className="opacity-60">Final Price</div>
                    <div className="font-black text-right text-base text-indigo-600">{selectedContractDetail.currency} ${selectedContractDetail.finalPrice.toFixed(2)}/MT</div>
                    <div className="opacity-60">Total Contract Value</div>
                    <div className="font-bold text-right">{selectedContractDetail.currency} ${(selectedContractDetail.finalPrice * selectedContractDetail.contractVolume).toFixed(2)}</div>
                  </div>
                </div>

                {/* Notes */}
                {selectedContractDetail.notes && (
                  <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-2">
                    <div className="text-[10px] uppercase font-bold opacity-50">Notes</div>
                    <div className="text-xs italic">{selectedContractDetail.notes}</div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => {
                      setEditingContract(selectedContractDetail);
                      setSelectedContractDetail(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2"
                  >
                    <Edit2 size={16} /> Edit Contract
                  </button>
                  <button
                    onClick={() => setSelectedContractDetail(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingFreightRate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Freight Rate</h3>
                <button onClick={() => setEditingFreightRate(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                    <select 
                      value={editingFreightRate.origin} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, origin: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Destination</label>
                    <input 
                      type="text" 
                      value={editingFreightRate.destination} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, destination: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Carrier</label>
                    <select
                      value={editingFreightRate.provider}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Carrier</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Freight Type</label>
                    <select 
                      value={editingFreightRate.freightType} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, freightType: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Dry Van">Dry Van</option>
                      <option value="Bulk">Bulk</option>
                      <option value="Liquid">Liquid</option>
                      <option value="Bulk Rail">Bulk Rail</option>
                      <option value="Intermodal">Intermodal</option>
                      <option value="Transload">Transload</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={editingFreightRate.cost || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT / Load</label>
                    <input
                      type="text" inputMode="decimal"
                      value={editingFreightRate.mtPerLoad || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, mtPerLoad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Start Date</label>
                    <input
                      type="date"
                      value={editingFreightRate.startDate || ''}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, startDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">End Date</label>
                    <input
                      type="date"
                      value={editingFreightRate.endDate || ''}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, endDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setFreightRates(freightRates.map(f => f.id === editingFreightRate.id ? editingFreightRate : f));
                      setEditingFreightRate(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingFreightRate(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingCustomer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Customer</h3>
                <button onClick={() => setIsAddingCustomer(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer ID</label>
                    <input type="text" value={newCustomer.id} readOnly className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm opacity-50 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Name</label>
                    <input 
                      type="text" 
                      value={newCustomer.name} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="Enter customer name"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Location</label>
                    <select 
                      value={newCustomer.defaultLocation} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, defaultLocation: e.target.value as 'Hamilton' | 'Vancouver' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Address</label>
                    <input 
                      type="text" 
                      value={newCustomer.address || ''} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">City</label>
                    <input 
                      type="text" 
                      value={newCustomer.city || ''} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Province</label>
                    <input 
                      type="text" 
                      value={newCustomer.province || ''} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, province: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Postal Code</label>
                    <input 
                      type="text" 
                      value={newCustomer.postalCode || ''} 
                      onChange={(e) => setNewCustomer({ ...newCustomer, postalCode: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Margin (CAD/MT)</label>
                    <input
                      type="text" inputMode="decimal"
                        value={newCustomer.defaultMargin || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewCustomer({ ...newCustomer, defaultMargin: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Payment Terms</label>
                    <select
                      value={newCustomer.defaultPaymentTerms || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, defaultPaymentTerms: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select...</option>
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 90">Net 90</option>
                      <option value="2% / Net 15">2% / Net 15</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Salesperson</label>
                    <select
                      value={newCustomer.salespersonId || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, salespersonId: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select a salesperson</option>
                      {people.filter(p => p.department === 'sales').map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.salespersonNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Carrier Code</label>
                    <select
                      value={newCustomer.defaultCarrierCode || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, defaultCarrierCode: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select a carrier</option>
                      {carriers.map(carrier => (
                        <option key={carrier.id} value={carrier.carrierNumber}>
                          {carrier.name} ({carrier.carrierNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Email</label>
                    <input
                      type="email"
                      value={newCustomer.contactEmail || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contactEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Phone</label>
                    <input
                      type="text"
                      value={newCustomer.contactPhone || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, contactPhone: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">QA Contract Email</label>
                    <input
                      type="email"
                      value={newCustomer.qaContractEmail || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, qaContractEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="qa@customer.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Sales Contact Email</label>
                    <input
                      type="email"
                      value={newCustomer.salesContactEmail || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, salesContactEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="sales@customer.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Service Email</label>
                    <input
                      type="email"
                      value={newCustomer.customerServiceEmail || ''}
                      onChange={(e) => setNewCustomer({ ...newCustomer, customerServiceEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="service@customer.com"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Internal Notes</label>
                  <textarea
                    value={newCustomer.notes || ''}
                    onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-32 resize-none focus:bg-white transition-colors outline-none"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setCustomers([...customers, newCustomer]);
                      setIsAddingCustomer(false);
                      toggleRow(newCustomer.id);
                    }}
                    disabled={!newCustomer.name}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Save Customer
                  </button>
                  <button 
                    onClick={() => setIsAddingCustomer(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingProductGroup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Product Group</h3>
                <button onClick={() => setIsAddingProductGroup(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Group Name</label>
                  <input
                    type="text"
                    value={newProductGroup.name}
                    onChange={(e) => setNewProductGroup({ ...newProductGroup, name: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-bold"
                    placeholder="e.g., Bulk, Bagged, Liquid"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">BOL Code</label>
                  <input
                    type="text"
                    value={newProductGroup.bolCode}
                    onChange={(e) => setNewProductGroup({ ...newProductGroup, bolCode: e.target.value.toUpperCase().slice(0, 1) })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-mono font-bold uppercase"
                    placeholder="e.g., B, L, P, T"
                    maxLength={1}
                  />
                  <p className="text-[9px] opacity-40">Single letter prefix for BOL numbers (e.g., B for Bulk, L for Liquid)</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Color Coding</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={newProductGroup.color}
                      onChange={(e) => setNewProductGroup({ ...newProductGroup, color: e.target.value })}
                      className="w-12 h-12 border border-[#141414] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={newProductGroup.color}
                      onChange={(e) => setNewProductGroup({ ...newProductGroup, color: e.target.value })}
                      className="flex-1 bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-mono"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setProductGroups([...productGroups, newProductGroup]);
                      setIsAddingProductGroup(false);
                    }}
                    disabled={!newProductGroup.name || !newProductGroup.bolCode}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Add Group
                  </button>
                  <button 
                    onClick={() => setIsAddingProductGroup(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingProductGroup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Product Group</h3>
                <button onClick={() => setEditingProductGroup(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Group Name</label>
                  <input
                    type="text"
                    value={editingProductGroup.name}
                    onChange={(e) => setEditingProductGroup({ ...editingProductGroup, name: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">BOL Code</label>
                  <input
                    type="text"
                    value={editingProductGroup.bolCode || ''}
                    onChange={(e) => setEditingProductGroup({ ...editingProductGroup, bolCode: e.target.value.toUpperCase().slice(0, 1) })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-mono font-bold uppercase"
                    placeholder="e.g., B, L, P, T"
                    maxLength={1}
                  />
                  <p className="text-[9px] opacity-40">Single letter prefix for BOL numbers (e.g., B for Bulk, L for Liquid)</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Color Coding</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={editingProductGroup.color}
                      onChange={(e) => setEditingProductGroup({ ...editingProductGroup, color: e.target.value })}
                      className="w-12 h-12 border border-[#141414] cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editingProductGroup.color}
                      onChange={(e) => setEditingProductGroup({ ...editingProductGroup, color: e.target.value })}
                      className="flex-1 bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none font-mono"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setProductGroups(productGroups.map(pg => pg.id === editingProductGroup.id ? editingProductGroup : pg));
                      setEditingProductGroup(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingProductGroup(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingSku && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Product</h3>
                <button onClick={() => setIsAddingSku(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product ID</label>
                    <input 
                      type="text" 
                      value={newSku.id} 
                      onChange={(e) => setNewSku({ ...newSku, id: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Name</label>
                    <input 
                      type="text" 
                      value={newSku.name} 
                      onChange={(e) => setNewSku({ ...newSku, name: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Group</label>
                    <select 
                      value={newSku.productGroup} 
                      onChange={(e) => setNewSku({ ...newSku, productGroup: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      {productGroups.map(pg => (
                        <option key={pg.id} value={pg.name}>{pg.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Conv./Organic</label>
                    <select 
                      value={newSku.category} 
                      onChange={(e) => setNewSku({ ...newSku, category: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Conventional">Conventional</option>
                      <option value="Organic">Organic</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Location</label>
                    <select 
                      value={newSku.location} 
                      onChange={(e) => setNewSku({ ...newSku, location: e.target.value as 'Hamilton' | 'Vancouver' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Net Weight (kg)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSku.netWeightKg || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSku({ ...newSku, netWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (kg)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSku.grossWeightKg || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSku({ ...newSku, grossWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSku.brix || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSku({ ...newSku, brix: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Max Color</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSku.maxColor || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSku({ ...newSku, maxColor: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Differential (CAD/MT)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSku.premiumCadMt || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSku({ ...newSku, premiumCadMt: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Product Description</label>
                  <textarea 
                    value={newSku.description || ''} 
                    onChange={(e) => setNewSku({ ...newSku, description: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-24 resize-none focus:bg-white transition-colors outline-none"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setSkuToConfirm(newSku);
                    }}
                    disabled={!newSku.name || !newSku.id}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Create Product
                  </button>
                  <button 
                    onClick={() => setIsAddingSku(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingCustomer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Customer: {editingCustomer.id}</h3>
                <button onClick={() => setEditingCustomer(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Name</label>
                    <input 
                      type="text" 
                      value={editingCustomer.name} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, name: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Location</label>
                    <select 
                      value={editingCustomer.defaultLocation} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, defaultLocation: e.target.value as 'Hamilton' | 'Vancouver' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Address</label>
                    <input 
                      type="text" 
                      value={editingCustomer.address || ''} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, address: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">City</label>
                    <input 
                      type="text" 
                      value={editingCustomer.city || ''} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, city: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Province</label>
                    <input 
                      type="text" 
                      value={editingCustomer.province || ''} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, province: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Postal Code</label>
                    <input 
                      type="text" 
                      value={editingCustomer.postalCode || ''} 
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, postalCode: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Margin (CAD/MT)</label>
                    <input
                      type="text" inputMode="decimal"
                        value={editingCustomer.defaultMargin || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setEditingCustomer({ ...editingCustomer, defaultMargin: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Salesperson</label>
                    <select
                      value={editingCustomer.salespersonId || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, salespersonId: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select a salesperson</option>
                      {people.filter(p => p.department === 'sales').map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.salespersonNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Payment Terms</label>
                    <select
                      value={editingCustomer.defaultPaymentTerms || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, defaultPaymentTerms: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select...</option>
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 90">Net 90</option>
                      <option value="2% / Net 15">2% / Net 15</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Carrier Code</label>
                    <select
                      value={editingCustomer.defaultCarrierCode || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, defaultCarrierCode: e.target.value || undefined })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select a carrier</option>
                      {carriers.map(carrier => (
                        <option key={carrier.id} value={carrier.carrierNumber}>
                          {carrier.name} ({carrier.carrierNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Email</label>
                    <input
                      type="email"
                      value={editingCustomer.contactEmail || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, contactEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Contact Phone</label>
                    <input
                      type="text"
                      value={editingCustomer.contactPhone || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, contactPhone: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">QA Contract Email</label>
                    <input
                      type="email"
                      value={editingCustomer.qaContractEmail || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, qaContractEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="qa@customer.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Sales Contact Email</label>
                    <input
                      type="email"
                      value={editingCustomer.salesContactEmail || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, salesContactEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="sales@customer.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Customer Service Email</label>
                    <input
                      type="email"
                      value={editingCustomer.customerServiceEmail || ''}
                      onChange={(e) => setEditingCustomer({ ...editingCustomer, customerServiceEmail: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                      placeholder="service@customer.com"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Internal Notes</label>
                  <textarea
                    value={editingCustomer.notes || ''}
                    onChange={(e) => setEditingCustomer({ ...editingCustomer, notes: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-32 resize-none focus:bg-white transition-colors outline-none"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setCustomers(customers.map(c => c.id === editingCustomer.id ? editingCustomer : c));
                      setEditingCustomer(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingCustomer(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingSku && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Product: {editingSku.id}</h3>
                <button onClick={() => setEditingSku(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-300 p-3 text-xs text-amber-800">
                  Only the Default Differential can be edited here. To change other product details, use the <span className="font-bold">Quality Assurance</span> page.
                </div>
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Name</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.name}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Group</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.productGroup}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Conv./Organic</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.category}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Location</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.location}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Net Weight (kg)</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.netWeightKg || editingSku.netWeight || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (kg)</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.grossWeightKg || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.brix || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Max Color</label>
                    <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70">{editingSku.maxColor || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Differential (CAD/MT)</label>
                    <input
                      type="text" inputMode="decimal"
                        value={editingSku.premiumCadMt || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setEditingSku({ ...editingSku, premiumCadMt: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Product Description</label>
                  <div className="w-full bg-[#E4E3E0] border border-[#141414]/20 p-3 text-sm opacity-70 min-h-[80px] whitespace-pre-wrap">{editingSku.description || 'No description provided.'}</div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setSkus(skus.map(s => s.id === editingSku.id ? { ...s, premiumCadMt: editingSku.premiumCadMt } : s));
                      setEditingSku(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button
                    onClick={() => setEditingSku(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingFreightRate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Freight Rate</h3>
                <button onClick={() => setIsAddingFreightRate(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                    <select 
                      value={newFreightRate.origin} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, origin: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Destination</label>
                    <input 
                      type="text" 
                      value={newFreightRate.destination} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, destination: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Carrier</label>
                    <select
                      value={newFreightRate.provider}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Carrier</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={newFreightRate.cost || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Freight Type</label>
                    <select 
                      value={newFreightRate.freightType} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, freightType: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Dry Van">Dry Van</option>
                      <option value="Bulk">Bulk</option>
                      <option value="Liquid">Liquid</option>
                      <option value="Bulk Rail">Bulk Rail</option>
                      <option value="Intermodal">Intermodal</option>
                      <option value="Transload">Transload</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT per Load</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={newFreightRate.mtPerLoad || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, mtPerLoad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setFreightRates([...freightRates, newFreightRate]);
                      setIsAddingFreightRate(false);
                    }}
                    disabled={!newFreightRate.destination || !newFreightRate.provider}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Save Freight Rate
                  </button>
                  <button 
                    onClick={() => setIsAddingFreightRate(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingFreightRate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Freight Rate: {editingFreightRate.id}</h3>
                <button onClick={() => setEditingFreightRate(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Origin</label>
                    <select 
                      value={editingFreightRate.origin} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, origin: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Destination</label>
                    <input 
                      type="text" 
                      value={editingFreightRate.destination} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, destination: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Carrier</label>
                    <select
                      value={editingFreightRate.provider}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Carrier</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={editingFreightRate.cost || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Freight Type</label>
                    <select 
                      value={editingFreightRate.freightType} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, freightType: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Dry Van">Dry Van</option>
                      <option value="Bulk">Bulk</option>
                      <option value="Liquid">Liquid</option>
                      <option value="Bulk Rail">Bulk Rail</option>
                      <option value="Intermodal">Intermodal</option>
                      <option value="Transload">Transload</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT per Load</label>
                    <input 
                      type="text" inputMode="decimal"
                      value={editingFreightRate.mtPerLoad || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, mtPerLoad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setFreightRates(freightRates.map(f => f.id === editingFreightRate.id ? editingFreightRate : f));
                      setEditingFreightRate(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingFreightRate(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingSupplyChain && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Supply Chain Component</h3>
                <button onClick={() => setIsAddingSupplyChain(false)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Component Name</label>
                    <input 
                      type="text" 
                      value={newSupplyChain.component} 
                      onChange={(e) => setNewSupplyChain({ ...newSupplyChain, component: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <input 
                      type="text" 
                      value={newSupplyChain.provider} 
                      onChange={(e) => setNewSupplyChain({ ...newSupplyChain, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Total Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSupplyChain.totalCostCad || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSupplyChain({ ...newSupplyChain, totalCostCad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Weight Per Load (MT)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={newSupplyChain.weightPerLoadMt || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setNewSupplyChain({ ...newSupplyChain, weightPerLoadMt: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setSupplyChain([...supplyChain, newSupplyChain]);
                      setIsAddingSupplyChain(false);
                    }}
                    disabled={!newSupplyChain.component || !newSupplyChain.provider}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50"
                  >
                    Save Component
                  </button>
                  <button 
                    onClick={() => setIsAddingSupplyChain(false)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {editingSupplyChain && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Supply Chain Component: {editingSupplyChain.id}</h3>
                <button onClick={() => setEditingSupplyChain(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Component Name</label>
                    <input 
                      type="text" 
                      value={editingSupplyChain.component} 
                      onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, component: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <select
                      value={editingSupplyChain.provider}
                      onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Provider</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      {editingSupplyChain.provider && !carriers.find(c => c.name === editingSupplyChain.provider) && (
                        <option value={editingSupplyChain.provider}>{editingSupplyChain.provider}</option>
                      )}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Total Cost (CAD)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={editingSupplyChain.totalCostCad || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, totalCostCad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Weight Per Load (MT)</label>
                    <input 
                      type="text" inputMode="decimal"
                        value={editingSupplyChain.weightPerLoadMt || ""}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, weightPerLoadMt: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setSupplyChain(supplyChain.map(s => s.id === editingSupplyChain.id ? editingSupplyChain : s));
                      setEditingSupplyChain(null);
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setEditingSupplyChain(null)}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        {skuToConfirm && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white border border-[#141414] shadow-[24px_24px_0px_0px_rgba(20,20,20,1)] max-w-md w-full p-10 space-y-8"
            >
              <div className="space-y-2">
                <h3 className="text-xl font-black uppercase tracking-tighter">Confirm New Product</h3>
                <p className="text-xs font-bold opacity-50 uppercase">Please review the product details before saving.</p>
              </div>
              
              <div className="space-y-4 bg-[#F9F9F9] p-6 border border-[#141414]/5">
                <div className="flex justify-between border-b border-[#141414]/10 pb-2">
                  <span className="opacity-50 uppercase text-[10px] font-bold">ID</span>
                  <span className="font-mono text-sm">{skuToConfirm.id}</span>
                </div>
                <div className="flex justify-between border-b border-[#141414]/10 pb-2">
                  <span className="opacity-50 uppercase text-[10px] font-bold">Name</span>
                  <span className="font-bold text-sm">{skuToConfirm.name} {skuToConfirm.maxColor}</span>
                </div>
                <div className="flex justify-between border-b border-[#141414]/10 pb-2">
                  <span className="opacity-50 uppercase text-[10px] font-bold">Product Group</span>
                  <span className="text-sm">{skuToConfirm.productGroup}</span>
                </div>
                <div className="flex justify-between border-b border-[#141414]/10 pb-2">
                  <span className="opacity-50 uppercase text-[10px] font-bold">Location</span>
                  <span className="text-sm">{skuToConfirm.location}</span>
                </div>
                <div className="flex justify-between border-b border-[#141414]/10 pb-2">
                  <span className="opacity-50 uppercase text-[10px] font-bold">Max Color</span>
                  <span className="text-sm">{skuToConfirm.maxColor}</span>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => {
                    const finalSku = { ...skuToConfirm, name: `${skuToConfirm.name} ${skuToConfirm.maxColor}` };
                    setSkus([...skus, finalSku]);
                    setSkuToConfirm(null);
                    setIsAddingSku(false);
                    toggleRow(finalSku.id);
                  }}
                  className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all shadow-[8px_8px_0px_0px_rgba(20,20,20,0.2)]"
                >
                  Confirm & Save
                </button>
                <button 
                  onClick={() => setSkuToConfirm(null)}
                  className="flex-1 py-4 border-2 border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                >
                  Back to Edit
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {errorBox && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-[#141414]/20 backdrop-blur-sm overflow-y-auto">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white border-2 border-red-500 shadow-[16px_16px_0px_0px_rgba(239,68,68,1)] max-w-sm w-full p-10 text-center space-y-8"
            >
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center text-red-500">
                  <AlertCircle size={40} />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black uppercase tracking-tighter text-red-600">Error</h3>
                <p className="text-sm font-bold opacity-70 leading-relaxed">{errorBox}</p>
              </div>
              <button 
                onClick={() => setErrorBox(null)}
                className="w-full py-4 bg-red-500 text-white font-bold text-xs uppercase hover:bg-red-600 transition-all shadow-[8px_8px_0px_0px_rgba(239,68,68,0.2)]"
              >
                Dismiss
              </button>
            </motion.div>
          </div>
        )}

        {/* Contract Invoice Popup - Free Standing */}
        {contractInvoicePopup && (
          <div className="fixed inset-0 z-[700] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-sm overflow-y-auto" onClick={() => setContractInvoicePopup(null)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] min-w-[520px] max-w-2xl w-full overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase tracking-widest">Invoices — {contractInvoicePopup}</span>
                <button onClick={() => setContractInvoicePopup(null)} className="hover:rotate-90 transition-transform"><X size={14} /></button>
              </div>
              {(() => {
                const contractInvoices = invoices.filter(inv => {
                  const allShipments = [...hamiltonShipments, ...vancouverShipments];
                  const shipment = allShipments.find(s => s.id === inv.shipmentId);
                  return shipment?.contractNumber === contractInvoicePopup;
                });
                return contractInvoices.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead className="bg-[#F5F5F5] border-b border-[#141414]/10">
                      <tr>
                        <th className="p-2 text-left font-bold text-[10px] uppercase">Invoice #</th>
                        <th className="p-2 text-left font-bold text-[10px] uppercase">BOL</th>
                        <th className="p-2 text-left font-bold text-[10px] uppercase">Product</th>
                        <th className="p-2 text-right font-bold text-[10px] uppercase">Qty (MT)</th>
                        <th className="p-2 text-right font-bold text-[10px] uppercase">Amount</th>
                        <th className="p-2 text-left font-bold text-[10px] uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/5">
                      {contractInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-[#F9F9F9]">
                          <td className="p-2 font-mono">{inv.id.substring(0, 12)}</td>
                          <td className="p-2">{inv.bolNumber}</td>
                          <td className="p-2">{inv.product}</td>
                          <td className="p-2 text-right font-bold">{inv.qty.toFixed(2)}</td>
                          <td className="p-2 text-right font-bold">${inv.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                          <td className="p-2">
                            <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase ${inv.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{inv.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-[#F5F5F5] border-t border-[#141414]/10">
                      <tr className="font-bold">
                        <td className="p-2 text-[10px] uppercase" colSpan={3}>Total</td>
                        <td className="p-2 text-right">{contractInvoices.reduce((s, i) => s + i.qty, 0).toFixed(2)}</td>
                        <td className="p-2 text-right">${contractInvoices.reduce((s, i) => s + i.amount, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td className="p-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div className="p-4 text-center text-xs opacity-40 italic">No invoices yet for this contract</div>
                );
              })()}
            </motion.div>
          </div>
        )}

        {/* Add/Edit Order Modal - New Line Items Version */}
        {(isAddingOrder || editingOrder) && !isAddingBatchOrder && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-5xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  {isAddingOrder ? 'Add New Order' : 'Edit Order'}
                </h3>
                <button onClick={() => { setIsAddingOrder(false); setEditingOrder(null); setOrderLineItems([]); setOrderCustomerId(''); setOrderPO(''); setOrderShipmentDate(''); setOrderDeliveryDate(''); setOrderCarrier('Customer Pick Up'); setOrderShippingTerms(''); }} className="hover:rotate-90 transition-transform">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {/* Customer, PO, Carrier & Dates Section */}
                <div className="bg-[#F5F5F5] p-6 border border-[#141414]/10 space-y-4">
                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Customer</label>
                      <select
                        value={orderCustomerId}
                        onChange={(e) => {
                          const customerId = e.target.value;
                          setOrderCustomerId(customerId);
                          const customer = customers.find(c => c.id === customerId);
                          if (customer) {
                            const filtered = contracts.filter(c => c.customerNumber === customerId);
                            setFilteredOrderContracts(filtered);
                            // Auto-fill carrier from customer default
                            if (customer.defaultCarrierCode) {
                              const defaultCarrier = carriers.find(c => c.carrierNumber === customer.defaultCarrierCode || c.name === customer.defaultCarrierCode);
                              if (defaultCarrier) {
                                setOrderCarrier(defaultCarrier.name);
                              }
                            }
                          }
                        }}
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      >
                        <option value="">Select Customer</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">PO #</label>
                      <input
                        type="text"
                        value={orderPO}
                        onChange={(e) => setOrderPO(e.target.value)}
                        placeholder="Purchase Order Number"
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                      <select
                        value={orderCarrier}
                        onChange={(e) => setOrderCarrier(e.target.value)}
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      >
                        <option value="">Select Carrier</option>
                        {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Shipping Terms</label>
                      <select
                        value={orderShippingTerms}
                        onChange={(e) => setOrderShippingTerms(e.target.value as any)}
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      >
                        <option value="">Select Terms</option>
                        <option value="FOB">FOB</option>
                        <option value="DAP">DAP</option>
                        <option value="DDP">DDP</option>
                        <option value="FCA">FCA</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Shipment Date</label>
                      <input
                        type="date"
                        value={orderShipmentDate}
                        onChange={(e) => setOrderShipmentDate(e.target.value)}
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Delivery Date</label>
                      <input
                        type="date"
                        value={orderDeliveryDate}
                        onChange={(e) => setOrderDeliveryDate(e.target.value)}
                        className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Location (Origin)</label>
                      <div className="w-full bg-white border border-[#141414]/30 p-2 text-sm text-[#141414]/70">
                        {(() => {
                          const contractNums = orderLineItems.map(li => li.contractNumber).filter(Boolean);
                          if (contractNums.length === 0) return 'Auto-fills from contract';
                          const c = contracts.find(ct => ct.contractNumber === contractNums[0]);
                          return c?.origin || '—';
                        })()}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Pallet Type</label>
                      <div className="w-full bg-white border border-[#141414]/30 p-2 text-sm text-[#141414]/70">
                        {(() => {
                          const contractNums = orderLineItems.map(li => li.contractNumber).filter(Boolean);
                          if (contractNums.length === 0) return 'From contract';
                          const c = contracts.find(ct => ct.contractNumber === contractNums[0]);
                          return c?.palletType || '—';
                        })()}
                      </div>
                    </div>
                  </div>
                  {editingOrder && (
                    <div className="grid grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Split Number</label>
                        <input
                          type="text"
                          value={editingOrder.splitNumber || ''}
                          onChange={(e) => setEditingOrder({ ...editingOrder, splitNumber: e.target.value })}
                          placeholder="e.g. S-001"
                          className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Add Line Item Section */}
                <div className="border border-[#141414]/20 p-6 bg-[#F9F9F9]">
                  <h4 className="text-xs font-bold uppercase tracking-widest mb-4">Add Line Items</h4>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Product</label>
                      <select
                        value={newLineItem.productName}
                        onChange={(e) => setNewLineItem({...newLineItem, productName: e.target.value})}
                        className="w-full bg-white border border-[#141414] p-2 text-xs focus:outline-none"
                      >
                        <option value="">Select Product</option>
                        {skus.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">QTY (units)</label>
                      <input
                        type="text" inputMode="decimal"
                          value={newLineItem.qty || ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setNewLineItem({...newLineItem, qty: parseFloat(e.target.value) || 0})}
                        className="w-full bg-white border border-[#141414] p-2 text-xs focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Contract #</label>
                      <select
                        value={newLineItem.contractNumber}
                        onChange={(e) => setNewLineItem({...newLineItem, contractNumber: e.target.value})}
                        className="w-full bg-white border border-[#141414] p-2 text-xs focus:outline-none"
                      >
                        <option value="">Select Contract</option>
                        {filteredOrderContracts.map(c => <option key={c.id} value={c.contractNumber}>{c.contractNumber}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => {
                          if (!newLineItem.productName || !newLineItem.contractNumber || newLineItem.qty <= 0) {
                            setErrorBox('Please fill in all line item fields');
                            return;
                          }
                          const product = skus.find(s => s.name === newLineItem.productName);
                          if (!product) return;
                          const netWeightKg = product.netWeightKg || product.netWeight;
                          const totalWeightKg = newLineItem.qty * netWeightKg;
                          const totalWeight = totalWeightKg / 1000; // Convert to MT for contract/pricing
                          // Get contract for pricing and volume validation
                          const contract = contracts.find(c => c.contractNumber === newLineItem.contractNumber);
                          if (!contract) { setErrorBox('Contract not found'); return; }
                          // Calculate existing usage on this contract from current line items
                          const existingWeightOnContract = orderLineItems
                            .filter(li => li.contractNumber === newLineItem.contractNumber)
                            .reduce((sum, li) => sum + li.totalWeight, 0);
                          const outstanding = (contract.volumeOutstanding || contract.contractVolume) - existingWeightOnContract;
                          if (totalWeight > outstanding) {
                            setErrorBox(`Insufficient contract volume. Contract ${contract.contractNumber} has ${outstanding.toFixed(2)} MT outstanding, this item requires ${totalWeight.toFixed(2)} MT`);
                            return;
                          }
                          // Calculate amounts from contract finalPrice
                          const mtAmount = contract.finalPrice;
                          const unitAmount = mtAmount * netWeightKg / 1000; // Price per unit = $/MT × MT/unit
                          const lineAmount = totalWeight * mtAmount;
                          const lineItem: OrderLineItem = {
                            id: `LINEITEM-${Date.now()}-${Math.random()}`,
                            productName: newLineItem.productName,
                            qty: newLineItem.qty,
                            contractNumber: newLineItem.contractNumber,
                            netWeightPerUnit: netWeightKg / 1000, // Store in MT for compatibility
                            totalWeight,
                            unitAmount,
                            mtAmount,
                            lineAmount
                          };
                          setOrderLineItems([...orderLineItems, lineItem]);
                          setNewLineItem({ productName: '', qty: 0, contractNumber: '' });
                        }}
                        className="w-full py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                      >
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                {orderLineItems.length > 0 && (
                  <div className="border border-[#141414] overflow-hidden">
                    <div className="bg-[#141414] text-[#E4E3E0] p-3">
                      <h4 className="text-xs font-bold uppercase tracking-widest">Order Line Items</h4>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#F5F5F5] border-b border-[#141414]/10">
                        <tr>
                          <th className="p-2 font-bold">Product</th>
                          <th className="p-2 font-bold">QTY (units)</th>
                          <th className="p-2 font-bold">Weight (KG)</th>
                          <th className="p-2 font-bold">Contract #</th>
                          <th className="p-2 font-bold">$/Unit</th>
                          <th className="p-2 font-bold">$/MT</th>
                          <th className="p-2 font-bold">Amount ($)</th>
                          <th className="p-2 font-bold text-center">X</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#141414]/10">
                        {orderLineItems.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-[#F9F9F9] transition-colors">
                            <td className="p-2">{item.productName}</td>
                            <td className="p-2">{item.qty}</td>
                            <td className="p-2 font-bold">{(item.totalWeight * 1000).toFixed(0)}</td>
                            <td className="p-2">{item.contractNumber}</td>
                            <td className="p-2">${(item.unitAmount || 0).toFixed(2)}</td>
                            <td className="p-2">${(item.mtAmount || 0).toFixed(2)}</td>
                            <td className="p-2 font-bold">${(item.lineAmount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                            <td className="p-2 text-center">
                              <button
                                onClick={() => setOrderLineItems(orderLineItems.filter((_, i) => i !== idx))}
                                className="text-red-500 hover:bg-red-50 p-1 rounded transition-all"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Summary Table */}
                {orderLineItems.length > 0 && (
                  <div className="border border-[#141414] bg-[#F5F5F5] p-4">
                    <h4 className="text-xs font-bold uppercase tracking-widest mb-3">Order Summary</h4>
                    <div className="grid grid-cols-7 gap-3 text-center">
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Customer</div>
                        <div className="text-xs font-bold">{customers.find(c => c.id === orderCustomerId)?.name || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Items</div>
                        <div className="text-xs font-bold">{orderLineItems.length}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Total Units</div>
                        <div className="text-xs font-bold">{orderLineItems.reduce((sum, item) => sum + item.qty, 0)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Total Weight (KG)</div>
                        <div className="text-xs font-bold">{(orderLineItems.reduce((sum, item) => sum + item.totalWeight, 0) * 1000).toFixed(0)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Total Pallets</div>
                        <div className="text-xs font-bold">{(() => {
                          let pallets = 0;
                          orderLineItems.forEach(item => {
                            const matchSku = skus.find(s => s.name === item.productName);
                            const qaP = matchSku ? qaProducts.find(q => q.skuId === matchSku.id) : null;
                            const upp = qaP?.unitsPerPallet;
                            if (upp && upp > 0) {
                              pallets += Math.ceil(item.qty / upp);
                            }
                          });
                          return pallets > 0 ? pallets : '-';
                        })()}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Total Amount ($)</div>
                        <div className="text-xs font-bold text-indigo-600">${orderLineItems.reduce((sum, item) => sum + (item.lineAmount || 0), 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">PO #</div>
                        <div className="text-xs font-bold">{orderPO || '-'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Create/Save Order Button */}
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      if (!orderCustomerId || orderLineItems.length === 0 || !orderPO) {
                        setErrorBox('Please select customer, add line items, and enter PO number');
                        return;
                      }
                      const totalAmount = orderLineItems.reduce((sum, item) => sum + (item.lineAmount || 0), 0);
                      const contractNumbers = [...new Set(orderLineItems.map(li => li.contractNumber).filter(Boolean))];

                      // Derive location from first contract's origin
                      const firstContract = contractNumbers.length > 0 ? contracts.find(c => c.contractNumber === contractNumbers[0]) : null;
                      const orderLocation = firstContract?.origin || '';

                      if (editingOrder) {
                        // Update existing order
                        const updatedOrder: Order = {
                          ...editingOrder,
                          customer: customers.find(c => c.id === orderCustomerId)?.name || editingOrder.customer,
                          product: orderLineItems.map(li => li.productName).join(', '),
                          contractNumber: contractNumbers.join(', '),
                          po: orderPO,
                          shipmentDate: orderShipmentDate || undefined,
                          deliveryDate: orderDeliveryDate || undefined,
                          lineItems: orderLineItems,
                          amount: totalAmount,
                          carrier: orderCarrier || undefined,
                          shippingTerms: orderShippingTerms || undefined,
                          location: orderLocation || editingOrder.location,
                          splitNumber: editingOrder.splitNumber,
                          palletType: firstContract?.palletType || editingOrder.palletType || '',
                        };
                        setOrders(orders.map(o => o.id === editingOrder.id ? updatedOrder : o));
                      } else {
                        // Create new order
                        const newOrder: Order = {
                          id: `ORD-${Date.now()}`,
                          bolNumber: generateBOLNumber(orderLineItems),
                          customer: customers.find(c => c.id === orderCustomerId)?.name || '',
                          product: orderLineItems.map(li => li.productName).join(', '),
                          contractNumber: contractNumbers.join(', '),
                          po: orderPO,
                          date: new Date().toISOString().split('T')[0],
                          shipmentDate: orderShipmentDate || undefined,
                          deliveryDate: orderDeliveryDate || undefined,
                          status: 'Open',
                          lineItems: orderLineItems,
                          amount: totalAmount,
                          carrier: orderCarrier || undefined,
                          shippingTerms: orderShippingTerms || undefined,
                          location: orderLocation,
                          palletType: firstContract?.palletType || '',
                        };
                        setOrders([...orders, newOrder]);
                      }
                      setIsAddingOrder(false);
                      setEditingOrder(null);
                      setOrderLineItems([]);
                      setOrderCustomerId('');
                      setOrderPO('');
                      setOrderShipmentDate('');
                      setOrderDeliveryDate('');
                      setOrderCarrier('Customer Pick Up');
                      setOrderShippingTerms('');
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    {editingOrder ? 'Save Changes' : 'Create Order'}
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingOrder(false);
                      setEditingOrder(null);
                      setOrderLineItems([]);
                      setOrderCustomerId('');
                      setOrderPO('');
                      setOrderShipmentDate('');
                      setOrderDeliveryDate('');
                      setOrderCarrier('Customer Pick Up');
                      setOrderShippingTerms('');
                    }}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Add Batch Orders Modal */}
        {isAddingBatchOrder && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-6xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Batch Orders</h3>
                <button onClick={() => setIsAddingBatchOrder(false)} className="hover:rotate-90 transition-transform">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {(() => {
                  // Filter contracts for selected customer
                  const selectedCustomer = customers.find(c => c.name === batchOrder.customer);
                  const batchContracts = selectedCustomer
                    ? contracts.filter(c => c.customerNumber === selectedCustomer.id || c.customerName === batchOrder.customer)
                    : [];
                  const selectedContract = contracts.find(c => c.contractNumber === batchOrder.contractNumber);
                  const product = skus.find(s => s.name === batchOrder.product);

                  // Calculate batch totals
                  const totalUnits = batchOrder.entries.reduce((sum, e) => sum + e.qty, 0);
                  const batchNetWeightKg = product ? (product.netWeightKg || product.netWeight) : 0;
                  const totalWeightKg = totalUnits * batchNetWeightKg;
                  const totalWeightMT = totalWeightKg / 1000;
                  const mtRate = selectedContract ? selectedContract.finalPrice : 0;
                  const totalAmount = totalWeightMT * mtRate;

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-4 bg-[#F9F9F9] p-4 border border-[#141414]/5">
                        <div className="space-y-0.5">
                          <label className="text-[10px] uppercase font-bold opacity-60">Customer</label>
                          <select
                            value={batchOrder.customer}
                            onChange={(e) => {
                              const custName = e.target.value;
                              const selectedCust = customers.find(c => c.name === custName);
                              let defaultCarrierName = 'Customer Pick Up';
                              if (selectedCust?.defaultCarrierCode) {
                                const dc = carriers.find(c => c.carrierNumber === selectedCust.defaultCarrierCode || c.name === selectedCust.defaultCarrierCode);
                                if (dc) defaultCarrierName = dc.name;
                              }
                              // Auto-fill carrier on all existing entries
                              const updatedEntries = batchOrder.entries.map(entry => ({
                                ...entry,
                                carrier: defaultCarrierName
                              }));
                              setBatchOrder({...batchOrder, customer: custName, contractNumber: '', entries: updatedEntries});
                            }}
                            className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                          >
                            <option value="">Select Customer</option>
                            {customers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] uppercase font-bold opacity-60">Product</label>
                          <select
                            value={batchOrder.product}
                            onChange={(e) => setBatchOrder({...batchOrder, product: e.target.value})}
                            className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                          >
                            <option value="">Select Product</option>
                            {skus.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] uppercase font-bold opacity-60">Contract</label>
                          <select
                            value={batchOrder.contractNumber}
                            onChange={(e) => setBatchOrder({...batchOrder, contractNumber: e.target.value})}
                            className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                            disabled={!batchOrder.customer}
                          >
                            <option value="">Select Contract</option>
                            {batchContracts.map(c => (
                              <option key={c.id} value={c.contractNumber}>
                                {c.contractNumber} — {c.skuName} ({c.volumeOutstanding.toFixed(1)} MT avail.)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Contract Info Summary */}
                      {selectedContract && (
                        <div className="bg-blue-50 border border-blue-200 p-3 grid grid-cols-6 gap-3">
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Location (Origin)</div>
                            <div className="text-xs font-bold">{selectedContract.origin || '—'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Contract Volume</div>
                            <div className="text-xs font-bold">{selectedContract.contractVolume} MT</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Volume Outstanding</div>
                            <div className="text-xs font-bold">{selectedContract.volumeOutstanding.toFixed(1)} MT</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Price per MT</div>
                            <div className="text-xs font-bold">${mtRate.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Pallet Type</div>
                            <div className="text-xs font-bold">{selectedContract.palletType || '—'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Batch Total Weight</div>
                            <div className={`text-xs font-bold ${totalWeightMT > selectedContract.volumeOutstanding ? 'text-red-600' : ''}`}>
                              {totalWeightKg.toFixed(0)} KG ({totalWeightMT.toFixed(2)} MT)
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black uppercase tracking-widest">Order Entries</h4>
                          <button
                            onClick={() => {
                              // Auto-fill carrier from customer default if available
                              const selectedCust = customers.find(c => c.name === batchOrder.customer);
                              let defaultCarrierName = 'Customer Pick Up';
                              if (selectedCust?.defaultCarrierCode) {
                                const dc = carriers.find(c => c.carrierNumber === selectedCust.defaultCarrierCode || c.name === selectedCust.defaultCarrierCode);
                                if (dc) defaultCarrierName = dc.name;
                              }
                              setBatchOrder({
                                ...batchOrder,
                                entries: [...batchOrder.entries, { shipmentDate: '', deliveryDate: '', po: '', bol: '', qty: 22, carrier: defaultCarrierName, amount: 0 }]
                              });
                            }}
                            className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
                          >
                            <Plus size={12} /> Add Entry
                          </button>
                        </div>
                        <div className="max-h-[400px] overflow-y-auto border border-[#141414]">
                          <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-[#141414] text-[#E4E3E0] z-10">
                              <tr className="text-[10px] uppercase font-bold">
                                <th className="p-3">Shipment Date</th>
                                <th className="p-3">Delivery Date</th>
                                <th className="p-3">PO #</th>
                                <th className="p-3">Qty (units)</th>
                                <th className="p-3">Weight (KG)</th>
                                <th className="p-3">Carrier</th>
                                <th className="p-3">Amount ($)</th>
                                <th className="p-3"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#141414]/10">
                              {batchOrder.entries.map((entry, idx) => {
                                const entryWeightMT = product ? entry.qty * (product.netWeightKg || product.netWeight) / 1000 : 0;
                                const entryAmount = entryWeightMT * mtRate;
                                return (
                                  <tr key={idx} className="hover:bg-[#F5F5F5] transition-colors">
                                    <td className="p-2">
                                      <input
                                        type="date"
                                        value={entry.shipmentDate}
                                        onChange={(e) => {
                                          const next = [...batchOrder.entries];
                                          next[idx].shipmentDate = e.target.value;
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-full bg-white border border-[#141414]/20 p-1.5 text-xs focus:border-[#141414] outline-none"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <input
                                        type="date"
                                        value={entry.deliveryDate}
                                        onChange={(e) => {
                                          const next = [...batchOrder.entries];
                                          next[idx].deliveryDate = e.target.value;
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-full bg-white border border-[#141414]/20 p-1.5 text-xs focus:border-[#141414] outline-none"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <input
                                        type="text"
                                        value={entry.po}
                                        onChange={(e) => {
                                          const next = [...batchOrder.entries];
                                          next[idx].po = e.target.value;
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-full bg-white border border-[#141414]/20 p-1.5 text-xs focus:border-[#141414] outline-none"
                                        placeholder="PO #"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <input
                                        type="text" inputMode="decimal"
                                        value={entry.qty || ''}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => {
                                          const next = [...batchOrder.entries];
                                          next[idx].qty = parseFloat(e.target.value) || 0;
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-full bg-white border border-[#141414]/20 p-1.5 text-xs focus:border-[#141414] outline-none w-20"
                                      />
                                    </td>
                                    <td className="p-2 text-xs font-mono text-center">
                                      {(entryWeightMT * 1000).toFixed(0)}
                                    </td>
                                    <td className="p-2">
                                      <select
                                        value={entry.carrier}
                                        onChange={(e) => {
                                          const next = [...batchOrder.entries];
                                          next[idx].carrier = e.target.value;
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-full bg-white border border-[#141414]/20 p-1.5 text-xs focus:border-[#141414] outline-none"
                                      >
                                        <option value="">Select</option>
                                        {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                      </select>
                                    </td>
                                    <td className="p-2 text-xs font-mono text-right">
                                      ${entryAmount.toFixed(2)}
                                    </td>
                                    <td className="p-2">
                                      <button
                                        onClick={() => {
                                          const next = batchOrder.entries.filter((_, i) => i !== idx);
                                          setBatchOrder({...batchOrder, entries: next});
                                        }}
                                        className="w-7 h-7 rounded-full flex items-center justify-center text-red-500 hover:bg-red-50 transition-all"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Batch Summary */}
                      <div className="bg-[#F5F5F5] p-3 border border-[#141414]/10 grid grid-cols-5 gap-3">
                        <div>
                          <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Orders</div>
                          <div className="text-sm font-bold">{batchOrder.entries.length}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Units</div>
                          <div className="text-sm font-bold">{totalUnits}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Weight (KG)</div>
                          <div className="text-sm font-bold">{totalWeightKg.toFixed(0)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Pallets</div>
                          <div className="text-sm font-bold">{(() => {
                            const matchSku = skus.find(s => s.name === batchOrder.product);
                            const qaP = matchSku ? qaProducts.find(q => q.skuId === matchSku.id) : null;
                            const upp = qaP?.unitsPerPallet;
                            if (upp && upp > 0) {
                              return Math.ceil(totalUnits / upp);
                            }
                            return '-';
                          })()}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Amount ($)</div>
                          <div className="text-sm font-bold">${totalAmount.toFixed(2)}</div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-4 pt-4 border-t border-[#141414]/10">
                        <button
                          onClick={() => setIsAddingBatchOrder(false)}
                          className="px-6 py-3 border border-[#141414] text-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!batchOrder.customer || !batchOrder.product) {
                              setErrorBox('Please select customer and product');
                              return;
                            }
                            if (!product) {
                              setErrorBox('Product not found');
                              return;
                            }
                            // Volume validation against contract
                            if (selectedContract && totalWeightMT > selectedContract.volumeOutstanding) {
                              setErrorBox(`Insufficient contract volume. Contract has ${selectedContract.volumeOutstanding.toFixed(1)} MT outstanding, batch requires ${totalWeightMT.toFixed(2)} MT`);
                              return;
                            }
                            // Generate unique BOL numbers for each entry in the batch
                            const generatedBOLs: string[] = [];
                            const newOrders: Order[] = batchOrder.entries.map((entry) => {
                              const entryWeightMT = entry.qty * (product.netWeightKg || product.netWeight) / 1000;
                              const entryAmount = entryWeightMT * mtRate;
                              const lineItem: OrderLineItem = {
                                id: `LINEITEM-${Date.now()}-${Math.random()}`,
                                productName: batchOrder.product,
                                qty: entry.qty,
                                contractNumber: batchOrder.contractNumber,
                                netWeightPerUnit: (product.netWeightKg || product.netWeight) / 1000,
                                totalWeight: entryWeightMT,
                                unitAmount: mtRate * (product.netWeightKg || product.netWeight) / 1000,
                                mtAmount: mtRate,
                                lineAmount: entryAmount
                              };
                              // Determine BOL prefix from product group's bolCode
                              const prodInfo = skus.find(s => s.name === lineItem.productName);
                              const prodGroup = prodInfo?.productGroup || 'Other';
                              const pg = productGroups.find(g => g.name === prodGroup);
                              const bolPrefix = pg?.bolCode || 'P';
                              // Combine existing BOLs with already-generated ones in this batch
                              const allBOLs = [
                                ...orders.map(o => o.bolNumber),
                                ...generatedBOLs
                              ];
                              // Check new format (PREFIX + 6 digits)
                              const newFormatBOLs = allBOLs
                                .filter(bol => bol?.startsWith(bolPrefix) && /^[A-Z]\d{6}$/.test(bol))
                                .map(bol => parseInt(bol.slice(1)) || 0);
                              // Check legacy format (PREFIX-YEAR-COUNTER)
                              const legacyBOLs = allBOLs
                                .filter(bol => bol?.startsWith(bolPrefix + '-'))
                                .map(bol => parseInt(bol.split('-')[2]) || 0);
                              const maxCounter = Math.max(...newFormatBOLs, ...legacyBOLs, 0);
                              const nextCounter = (maxCounter + 1).toString().padStart(6, '0');
                              const bolNumber = `${bolPrefix}${nextCounter}`;
                              generatedBOLs.push(bolNumber);

                              return {
                                id: `ORD-${Date.now()}-${Math.random()}`,
                                bolNumber,
                                customer: batchOrder.customer,
                                product: batchOrder.product,
                                contractNumber: batchOrder.contractNumber,
                                po: entry.po,
                                date: entry.shipmentDate || new Date().toISOString().split('T')[0],
                                shipmentDate: entry.shipmentDate || undefined,
                                deliveryDate: entry.deliveryDate || undefined,
                                status: 'Open' as const,
                                lineItems: [lineItem],
                                amount: entryAmount,
                                carrier: entry.carrier,
                                location: selectedContract?.origin || '',
                                palletType: selectedContract?.palletType || '',
                              };
                            });
                            setOrders([...orders, ...newOrders]);
                            setIsAddingBatchOrder(false);
                            setBatchOrder({
                              customer: '',
                              product: '',
                              contractNumber: '',
                              entries: [{ shipmentDate: '', deliveryDate: '', po: '', bol: '', qty: 22, carrier: 'Customer Pick Up', amount: 0 }]
                            });
                          }}
                          className="px-6 py-3 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all shadow-[4px_4px_0px_0px_rgba(20,20,20,0.2)]"
                        >
                          Add All Orders
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}

        {/* Order Delete Confirmation Dialog */}
        {orderDeleteConfirmId && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center gap-3">
                <AlertCircle size={20} className="text-red-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Delete Order</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm">Are you sure you want to delete order <span className="font-bold">{orders.find(o => o.id === orderDeleteConfirmId)?.bolNumber || orderDeleteConfirmId}</span>? This action cannot be undone.</p>
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      setOrders(orders.filter(o => o.id !== orderDeleteConfirmId));
                      setOrderDeleteConfirmId(null);
                    }}
                    className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-all"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setOrderDeleteConfirmId(null)}
                    className="flex-1 py-3 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Order Confirmation Dialog */}
        {showOrderConfirmation && pendingStatusChange && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center gap-3">
                <AlertCircle size={20} className="text-amber-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Order Status Change</h3>
              </div>
              <div className="p-6 space-y-4">
                {(() => {
                  const order = orders.find(o => o.id === pendingStatusChange.orderId);
                  if (!order) return null;
                  const totalWeight = order.lineItems.reduce((sum, item) => sum + item.totalWeight, 0);
                  const isCancelling = pendingStatusChange.newStatus === 'Cancelled';
                  const allShipments = [...hamiltonShipments, ...vancouverShipments];
                  const associatedShipments = allShipments.filter(s => s.bol === order.bolNumber);
                  return (
                    <>
                      <p className="text-sm leading-relaxed">
                        {isCancelling
                          ? `Are you sure you want to cancel this order?${associatedShipments.length > 0 ? ` This will also delete ${associatedShipments.length} associated shipment appointment${associatedShipments.length > 1 ? 's' : ''}.` : ''}`
                          : 'Are you sure you want to confirm this order? This will lock the order details and prepare it for scheduling into shipments.'
                        }
                      </p>
                      <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                        <div className="flex justify-between text-[10px] uppercase font-bold opacity-50">
                          <span>BOL #</span>
                          <span className="text-sm font-black">{order.bolNumber}</span>
                        </div>
                        <div className="flex justify-between text-[10px] uppercase font-bold opacity-50">
                          <span>Customer</span>
                          <span className="text-sm font-black">{order.customer}</span>
                        </div>
                        <div className="flex justify-between text-[10px] uppercase font-bold opacity-50">
                          <span>Items</span>
                          <span className="text-sm font-black">{order.lineItems.length}</span>
                        </div>
                        <div className="flex justify-between text-[10px] uppercase font-bold opacity-50">
                          <span>Total Weight</span>
                          <span className="text-sm font-black">{totalWeight.toFixed(2)} MT</span>
                        </div>
                        {isCancelling && associatedShipments.length > 0 && (
                          <div className="flex justify-between text-[10px] uppercase font-bold text-red-500">
                            <span>Shipments to Delete</span>
                            <span className="text-sm font-black">{associatedShipments.length}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-4">
                        <button
                          onClick={() => {
                            if (isCancelling) {
                              // Cancel order and delete associated shipments
                              setOrders(orders.map(o => o.id === pendingStatusChange.orderId ? { ...o, status: 'Cancelled' } : o));
                              if (associatedShipments.length > 0) {
                                setHamiltonShipments(prev => prev.filter(s => s.bol !== order.bolNumber));
                                setVancouverShipments(prev => prev.filter(s => s.bol !== order.bolNumber));
                              }
                            } else {
                              setOrders(orders.map(o => o.id === pendingStatusChange.orderId ? { ...o, status: 'Confirmed' } : o));
                            }
                            setShowOrderConfirmation(false);
                            setPendingStatusChange(null);
                          }}
                          className={`flex-1 py-4 font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2 ${
                            isCancelling ? 'bg-red-600 text-white' : 'bg-[#141414] text-[#E4E3E0]'
                          }`}
                        >
                          {isCancelling ? <><AlertCircle size={16} /> Cancel Order</> : <><CheckCircle2 size={16} /> Confirm Status</>}
                        </button>
                        <button
                          onClick={() => {
                            setShowOrderConfirmation(false);
                            setPendingStatusChange(null);
                          }}
                          className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                        >
                          Go Back
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}

        {/* Shipment Creation Modal */}
        {isCreatingShipments && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-5xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">{isCreatingTransferShipment ? 'Schedule Transfer Pick Up' : 'Create Shipments from Order'}</h3>
                <button onClick={() => { setIsCreatingShipments(false); setIsCreatingTransferShipment(false); setShipmentCreationData({ location: 'Hamilton', date: '', time: '', bay: '', carrier: '', orderId: '' }); }} className="hover:rotate-90 transition-transform">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {(() => {
                  const transfer = isCreatingTransferShipment ? transfers.find(t => t.id === shipmentCreationData.transferId) : null;
                  const order = !isCreatingTransferShipment ? orders.find(o => o.id === shipmentCreationData.orderId) : null;
                  if (!order && !transfer) return (
                    <div className="p-6 text-center">
                      <p className="text-sm font-bold text-red-600">Unable to find the associated {isCreatingTransferShipment ? 'transfer' : 'order'}.</p>
                      <p className="text-xs opacity-50 mt-2">The record may have been deleted or modified. Please close and try again.</p>
                    </div>
                  );
                  const totalWeight = order ? order.lineItems.reduce((sum, item) => sum + item.totalWeight, 0) : (transfer?.amount || 0);

                  const locationData = locations.find(l => l.name.toLowerCase().includes(shipmentCreationData.location.toLowerCase()));
                  const validBays = locationData ? locationData.bays : [];

                  // Get all shipments for selected location and date to build schedule summary
                  const allLocationShipments = shipmentCreationData.location === 'Hamilton' ? hamiltonShipments : vancouverShipments;
                  const appointmentsForDay = shipmentCreationData.date
                    ? allLocationShipments.filter(s => s.date === shipmentCreationData.date).sort((a, b) => a.time.localeCompare(b.time))
                    : [];
                  const bookedSlots = new Set(appointmentsForDay.map(s => `${s.time}|${s.bay}`));
                  const bookedTimes = new Set(appointmentsForDay.map(s => s.time));

                  // Bay-aware availability: for each time slot, determine which bays are still open
                  const getAvailableBaysForSlot = (slot: string) => {
                    return validBays.filter(bay => !bookedSlots.has(`${slot}|${bay}`));
                  };

                  // If a bay is selected, filter time slots for that bay only
                  const selectedBayFilter = shipmentCreationData.bay;
                  const isSlotAvailable = (slot: string) => {
                    if (selectedBayFilter) {
                      return !bookedSlots.has(`${slot}|${selectedBayFilter}`);
                    }
                    return getAvailableBaysForSlot(slot).length > 0;
                  };

                  // Available time slots from shipment schedule
                  const modalAllTimeSlots = getLocationAllTimeSlots(shipmentCreationData.location);
                  const availableTimeSlots = modalAllTimeSlots.filter(t => isSlotAvailable(t));

                  return (
                    <>
                      {/* Shipping Details Input */}
                      <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-widest">Shipping Details</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="space-y-0.5">
                            <label className="text-[10px] uppercase font-bold opacity-60">Location</label>
                            <select
                              value={shipmentCreationData.location}
                              onChange={(e) => setShipmentCreationData({...shipmentCreationData, location: e.target.value as 'Hamilton' | 'Vancouver', bay: '', time: ''})}
                              className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                            >
                              <option value="Hamilton">Hamilton</option>
                              <option value="Vancouver">Vancouver</option>
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[10px] uppercase font-bold opacity-60">Date</label>
                            <input
                              type="date"
                              value={shipmentCreationData.date}
                              onChange={(e) => setShipmentCreationData({...shipmentCreationData, date: e.target.value, time: '', bay: ''})}
                              className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[10px] uppercase font-bold opacity-60">Bay</label>
                            <select
                              value={shipmentCreationData.bay}
                              onChange={(e) => setShipmentCreationData({...shipmentCreationData, bay: e.target.value})}
                              className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                            >
                              <option value="">Select Bay</option>
                              {validBays.map(bay => <option key={bay} value={bay}>{bay}</option>)}
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                            <select
                              value={shipmentCreationData.carrier}
                              onChange={(e) => setShipmentCreationData({...shipmentCreationData, carrier: e.target.value})}
                              className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                            >
                              <option value="">Select Carrier</option>
                              {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Schedule Summary & Time Slot Selection */}
                      {shipmentCreationData.date && (
                        <div className="border border-[#141414] overflow-hidden">
                          <div className="bg-[#141414] text-[#E4E3E0] p-3 flex justify-between items-center">
                            <h4 className="text-xs font-bold uppercase">
                              Schedule for {shipmentCreationData.location} — {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(shipmentCreationData.date + 'T12:00:00'))}
                            </h4>
                            <span className="text-[10px] opacity-60">{appointmentsForDay.length} booked · {availableTimeSlots.length} available</span>
                          </div>

                          {/* Existing appointments for the day */}
                          {appointmentsForDay.length > 0 && (
                            <div className="border-b border-[#141414]/10">
                              <table className="w-full text-xs">
                                <thead className="bg-[#F5F5F5] border-b border-[#141414]/10">
                                  <tr>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Time</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Bay</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Customer</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Product</th>
                                    <th className="p-2 text-left font-bold text-[10px] uppercase">Status</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-[#141414]/5">
                                  {appointmentsForDay.map(appt => (
                                    <tr key={appt.id} className="text-[11px] opacity-60">
                                      <td className="p-2 font-mono">{appt.time}</td>
                                      <td className="p-2 truncate max-w-[150px]">{appt.bay}</td>
                                      <td className="p-2">{appt.customer}</td>
                                      <td className="p-2">{appt.product}</td>
                                      <td className="p-2">
                                        <span className={`inline-block px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase ${
                                          appt.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                                          appt.status === 'Pending' ? 'bg-amber-100 text-amber-700' :
                                          'bg-blue-100 text-blue-700'
                                        }`}>{appt.status}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Available Time Slots - clickable, bay-aware */}
                          <div className="p-3 bg-[#FAFAFA]">
                            <div className="text-[10px] uppercase font-bold opacity-50 mb-2">
                              {selectedBayFilter ? `Available times for ${selectedBayFilter}` : 'Click an available time slot (bay shown for each)'}
                            </div>
                            <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
                              {modalAllTimeSlots.map(slot => {
                                const available = isSlotAvailable(slot);
                                const isSelected = shipmentCreationData.time === slot;
                                const availBays = getAvailableBaysForSlot(slot);
                                const bayLabel = !selectedBayFilter && availBays.length > 0 && availBays.length < validBays.length
                                  ? availBays.map(b => b.replace(/BAY\s*/i, 'B').split(' ')[0]).join(',')
                                  : '';
                                return (
                                  <button
                                    key={slot}
                                    onClick={() => {
                                      if (available) {
                                        setShipmentCreationData({...shipmentCreationData, time: slot});
                                      }
                                    }}
                                    disabled={!available}
                                    className={`py-1.5 px-2 text-[11px] font-mono border transition-all flex flex-col items-center ${
                                      isSelected
                                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] font-bold'
                                        : !available
                                          ? 'bg-red-50 text-red-300 border-red-200 cursor-not-allowed line-through'
                                          : 'bg-white text-[#141414] border-[#141414]/20 hover:border-[#141414] hover:bg-[#141414]/5 cursor-pointer'
                                    }`}
                                  >
                                    <span>{slot}</span>
                                    {bayLabel && <span className="text-[8px] opacity-50 leading-none">{bayLabel}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Items Preview */}
                      {order && (
                        <div className="border border-[#141414] overflow-hidden">
                          <div className="bg-[#141414] text-[#E4E3E0] p-3">
                            <h4 className="text-xs font-bold uppercase">Line Items to Ship</h4>
                          </div>
                          <table className="w-full text-xs">
                            <thead className="bg-[#F5F5F5] border-b border-[#141414]/10">
                              <tr>
                                <th className="p-2 text-left font-bold">Product</th>
                                <th className="p-2 text-left font-bold">QTY (units)</th>
                                <th className="p-2 text-left font-bold">Weight/Unit (KG)</th>
                                <th className="p-2 text-left font-bold">Total Weight (KG)</th>
                                <th className="p-2 text-left font-bold">Contract #</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#141414]/10">
                              {order.lineItems.map(item => (
                                <tr key={item.id} className="hover:bg-[#F9F9F9]">
                                  <td className="p-2">{item.productName}</td>
                                  <td className="p-2">{item.qty}</td>
                                  <td className="p-2">{(item.netWeightPerUnit * 1000).toFixed(0)}</td>
                                  <td className="p-2 font-bold">{(item.totalWeight * 1000).toFixed(0)}</td>
                                  <td className="p-2">{item.contractNumber}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Transfer Info Preview */}
                      {transfer && (
                        <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-2">
                          <h4 className="text-xs font-bold uppercase tracking-widest">Transfer Details</h4>
                          <div className="grid grid-cols-4 gap-3 text-xs">
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Transfer #</span><span className="font-bold font-mono">{transfer.transferNumber}</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">From</span><span className="font-bold">{transfer.from}</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">To</span><span className="font-bold">{transfer.to}</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Product</span><span className="font-bold">{transfer.product}</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Amount</span><span className="font-bold">{transfer.amount} MT</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Lot Code</span><span className="font-bold font-mono">{transfer.lotCode || '—'}</span></div>
                            <div><span className="text-[10px] uppercase font-bold opacity-50 block mb-0.5">Carrier</span><span className="font-bold">{transfer.carrier}</span></div>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      <div className="bg-[#F5F5F5] p-3 border border-[#141414]/10">
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">{order ? 'BOL #' : 'Transfer #'}</div>
                            <div className="text-sm font-bold">{order ? order.bolNumber : transfer?.transferNumber}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">{order ? 'Total Items' : 'Product'}</div>
                            <div className="text-sm font-bold">{order ? order.lineItems.length : transfer?.product}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Total Weight (KG)</div>
                            <div className="text-sm font-bold">{order ? (totalWeight * 1000).toFixed(0) : ((transfer?.amount || 0) * 1000).toFixed(0)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Selected Time</div>
                            <div className="text-sm font-bold font-mono">{shipmentCreationData.time || '—'}</div>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-4">
                        <button
                          onClick={() => {
                            if (!shipmentCreationData.date || !shipmentCreationData.time || !shipmentCreationData.bay || !shipmentCreationData.carrier) {
                              setErrorBox('Please fill in all shipping details (location, date, time slot, bay, and carrier)');
                              return;
                            }

                            if (order) {
                              // Create shipments from order line items
                              const newShipments: Shipment[] = order.lineItems.map(item => ({
                                id: `SHIP-${Date.now()}-${Math.random()}`,
                                week: `Week ${getWeekNumber(shipmentCreationData.date)}`,
                                date: shipmentCreationData.date,
                                day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(shipmentCreationData.date + 'T12:00:00')),
                                time: shipmentCreationData.time,
                                bay: shipmentCreationData.bay,
                                customer: order.customer,
                                product: item.productName,
                                contractNumber: item.contractNumber,
                                po: order.po,
                                bol: order.bolNumber,
                                qty: item.totalWeight,
                                carrier: shipmentCreationData.carrier,
                                arrive: '',
                                start: '',
                                out: '',
                                status: 'Confirmed',
                                notes: '',
                                color: ''
                              }));

                              if (shipmentCreationData.location === 'Hamilton') {
                                setHamiltonShipments([...hamiltonShipments, ...newShipments]);
                              } else {
                                setVancouverShipments([...vancouverShipments, ...newShipments]);
                              }
                              setOrders(orders.map(o => o.id === order.id ? { ...o, shipmentDate: shipmentCreationData.date } : o));
                            } else if (transfer) {
                              // Create shipment from transfer
                              const newShipment: Shipment = {
                                id: `SHIP-${Date.now()}-${Math.random()}`,
                                week: `Week ${getWeekNumber(shipmentCreationData.date)}`,
                                date: shipmentCreationData.date,
                                day: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(shipmentCreationData.date + 'T12:00:00')),
                                time: shipmentCreationData.time,
                                bay: shipmentCreationData.bay,
                                customer: `Transfer: ${transfer.from} → ${transfer.to}`,
                                product: transfer.product,
                                po: transfer.lotCode || '',
                                bol: transfer.transferNumber,
                                qty: transfer.amount,
                                carrier: shipmentCreationData.carrier,
                                arrive: '',
                                start: '',
                                out: '',
                                status: 'Confirmed',
                                notes: `TRANSFER:${transfer.id}`,
                                color: ''
                              };

                              if (shipmentCreationData.location === 'Hamilton') {
                                setHamiltonShipments([...hamiltonShipments, newShipment]);
                              } else {
                                setVancouverShipments([...vancouverShipments, newShipment]);
                              }
                            }

                            setIsCreatingShipments(false);
                            setIsCreatingTransferShipment(false);
                            setShipmentCreationData({ location: 'Hamilton', date: '', time: '', bay: '', carrier: '', orderId: '' });
                          }}
                          className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                        >
                          {isCreatingTransferShipment ? 'Schedule Transfer' : 'Create Shipments'}
                        </button>
                        <button
                          onClick={() => {
                            setIsCreatingShipments(false);
                            setIsCreatingTransferShipment(false);
                            setShipmentCreationData({ location: 'Hamilton', date: '', time: '', bay: '', carrier: '', orderId: '' });
                          }}
                          className="flex-1 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </div>
        )}

      {/* Appointment Schedule Modal */}
      {editingAppointmentSchedule && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md overflow-y-auto">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest">Appointment Schedule — {editingAppointmentSchedule.name}</h3>
              <button onClick={() => setEditingAppointmentSchedule(null)} className="hover:rotate-90 transition-transform"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-widest">Schedule Parameters</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Start Time</label>
                    <select
                      value={editingAppointmentSchedule.appointmentStartTime || '06:00'}
                      onChange={(e) => setEditingAppointmentSchedule({...editingAppointmentSchedule, appointmentStartTime: e.target.value})}
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = Math.floor(i * 30 / 60).toString().padStart(2, '0');
                        const m = (i * 30 % 60).toString().padStart(2, '0');
                        return <option key={i} value={`${h}:${m}`}>{h}:{m}</option>;
                      })}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">End Time</label>
                    <select
                      value={editingAppointmentSchedule.appointmentEndTime || '18:00'}
                      onChange={(e) => setEditingAppointmentSchedule({...editingAppointmentSchedule, appointmentEndTime: e.target.value})}
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      {Array.from({ length: 48 }, (_, i) => {
                        const h = Math.floor(i * 30 / 60).toString().padStart(2, '0');
                        const m = (i * 30 % 60).toString().padStart(2, '0');
                        return <option key={i} value={`${h}:${m}`}>{h}:{m}</option>;
                      })}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Appointment Length</label>
                    <select
                      value={editingAppointmentSchedule.appointmentDuration || 30}
                      onChange={(e) => setEditingAppointmentSchedule({...editingAppointmentSchedule, appointmentDuration: parseInt(e.target.value)})}
                      className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none"
                    >
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={90}>1.5 hours</option>
                      <option value={120}>2 hours</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Preview of generated time slots */}
              <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-widest">Appointment Slots Preview</h4>
                <div className="flex flex-wrap gap-1.5">
                  {generateTimeSlots(
                    editingAppointmentSchedule.appointmentStartTime || '06:00',
                    editingAppointmentSchedule.appointmentEndTime || '18:00',
                    editingAppointmentSchedule.appointmentDuration || 30
                  ).map(slot => (
                    <span key={slot} className="px-2 py-1 bg-white border border-[#141414]/20 text-[10px] font-mono font-bold">{slot}</span>
                  ))}
                </div>
                <p className="text-[10px] opacity-50">
                  {generateTimeSlots(
                    editingAppointmentSchedule.appointmentStartTime || '06:00',
                    editingAppointmentSchedule.appointmentEndTime || '18:00',
                    editingAppointmentSchedule.appointmentDuration || 30
                  ).length} appointment slots per bay per day
                </p>
              </div>

              {/* Bays info */}
              <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-widest">Bays at {editingAppointmentSchedule.name}</h4>
                {editingAppointmentSchedule.bays.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {editingAppointmentSchedule.bays.map((bay, idx) => (
                      <span key={idx} className="px-3 py-1.5 bg-white border border-[#141414]/20 text-xs font-bold">{bay}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs opacity-40 italic">No bays configured. Add bays from the location details.</p>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setLocations(locations.map(l => l.id === editingAppointmentSchedule.id ? {
                      ...l,
                      appointmentStartTime: editingAppointmentSchedule.appointmentStartTime,
                      appointmentEndTime: editingAppointmentSchedule.appointmentEndTime,
                      appointmentDuration: editingAppointmentSchedule.appointmentDuration
                    } : l));
                    setEditingAppointmentSchedule(null);
                  }}
                  className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                >
                  Save Schedule
                </button>
                <button
                  onClick={() => setEditingAppointmentSchedule(null)}
                  className="flex-1 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Add New Transfer Modal */}
      {isAddingTransfer && (() => {
          const addLeg = () => {
            setNewTransferLegs(prev => [...prev, {
              id: `LEG-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              legNumber: prev.length + 1,
              from: '',
              to: '',
              carrier: '',
              amount: 22,
              shipmentDate: '',
              arrivalDate: '',
              status: 'Pending',
            }]);
          };
          const updateLeg = (legId: string, field: keyof TransferLeg, value: any) => {
            setNewTransferLegs(prev => prev.map(l => l.id === legId ? { ...l, [field]: value } : l));
          };
          const removeLeg = (legId: string) => {
            setNewTransferLegs(prev => prev.filter(l => l.id !== legId).map((l, i) => ({ ...l, legNumber: i + 1 })));
          };
          return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">New Transfer</h3>
                <button onClick={() => setIsAddingTransfer(false)} className="hover:rotate-90 transition-transform"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <form onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const data = new FormData(form);
                  const totalLegAmount = newTransferLegs.reduce((s, l) => s + l.amount, 0);
                  const t: Transfer = {
                    id: `TRF-${Date.now()}`,
                    transferNumber: `TRF-${new Date().getFullYear()}-${String(transfers.length + 1).padStart(3, '0')}`,
                    from: data.get('from') as string,
                    to: data.get('to') as string,
                    product: data.get('product') as string,
                    lotCode: data.get('lotCode') as string || '',
                    amount: newTransferLegs.length > 0 ? totalLegAmount : (parseFloat(data.get('amount') as string) || 0),
                    carrier: newTransferLegs.length > 0 ? newTransferLegs.map(l => l.carrier).filter(Boolean).join(' → ') : (data.get('carrier') as string),
                    shipmentDate: data.get('shipmentDate') as string,
                    arrivalDate: data.get('arrivalDate') as string,
                    notes: data.get('notes') as string || '',
                    status: 'Pending',
                    legs: newTransferLegs.length > 0 ? newTransferLegs : undefined,
                  };
                  setTransfers([...transfers, t]);
                  setIsAddingTransfer(false);
                }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">From (Origin)</label>
                      <select name="from" defaultValue="Hamilton" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">To (Final Destination)</label>
                      <select name="to" defaultValue="Vancouver" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Product</label>
                      <select name="product" required className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        <option value="">Select Product</option>
                        {skus.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                    {newTransferLegs.length === 0 && (
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Amount (MT)</label>
                        <input name="amount" type="text" inputMode="decimal" defaultValue="22" onFocus={(e) => e.target.select()} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                      </div>
                    )}
                    {newTransferLegs.length > 0 && (
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Total Amount (MT)</label>
                        <div className="w-full bg-[#F5F5F5] border border-[#141414]/30 p-2 text-sm font-bold">{newTransferLegs.reduce((s, l) => s + l.amount, 0).toFixed(1)} MT</div>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Lot Code</label>
                      <input name="lotCode" type="text" placeholder="e.g. LOT-2026-001" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                    {newTransferLegs.length === 0 && (
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                        <select name="carrier" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                          <option value="">Select Carrier</option>
                          {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Shipment Date</label>
                      <input name="shipmentDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} required className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Arrival Date</label>
                      <input name="arrivalDate" type="date" defaultValue={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} required className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                  </div>

                  {/* Transfer Legs Section */}
                  <div className="border-t border-[#141414]/10 pt-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-60">Transfer Legs</h4>
                      <button type="button" onClick={addLeg} className="px-3 py-1 bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-1">
                        <Plus size={10} /> Add Leg
                      </button>
                    </div>
                    {newTransferLegs.length === 0 && (
                      <div className="text-xs italic opacity-40 text-center py-2">No legs — this is a direct transfer. Add legs to split into multiple segments.</div>
                    )}
                    {newTransferLegs.map((leg) => (
                      <div key={leg.id} className="bg-[#F5F5F5] border border-[#141414]/10 p-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase opacity-60">Leg {leg.legNumber}</span>
                          <button type="button" onClick={() => removeLeg(leg.id)} className="p-0.5 hover:bg-red-500 hover:text-white transition-all rounded">
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-4 gap-3">
                          <div className="space-y-0.5">
                            <label className="text-[9px] uppercase font-bold opacity-50">From</label>
                            <select value={leg.from} onChange={(e) => updateLeg(leg.id, 'from', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                              <option value="">Select</option>
                              {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] uppercase font-bold opacity-50">To</label>
                            <select value={leg.to} onChange={(e) => updateLeg(leg.id, 'to', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                              <option value="">Select</option>
                              {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] uppercase font-bold opacity-50">Carrier</label>
                            <select value={leg.carrier} onChange={(e) => updateLeg(leg.id, 'carrier', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                              <option value="">Select</option>
                              {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                          </div>
                          <div className="space-y-0.5">
                            <label className="text-[9px] uppercase font-bold opacity-50">Amount (MT)</label>
                            <input type="text" inputMode="decimal" value={leg.amount || ''} onFocus={(e) => e.target.select()} onChange={(e) => updateLeg(leg.id, 'amount', parseFloat(e.target.value) || 0)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Notes</label>
                    <textarea name="notes" rows={2} placeholder="Optional notes..." className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none resize-none" />
                  </div>
                  <div className="flex gap-4 pt-2">
                    <button type="submit" className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all">Create Transfer</button>
                    <button type="button" onClick={() => setIsAddingTransfer(false)} className="flex-1 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">Cancel</button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
          );
        })()}

        {/* Edit Transfer Modal */}
        {editingTransfer && !isAddingTransfer && (() => {
          const hasLegs = editingTransfer.legs && editingTransfer.legs.length > 0;
          const editLegs = editingTransfer.legs || [];
          const addEditLeg = () => {
            const newLeg: TransferLeg = {
              id: `LEG-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
              legNumber: editLegs.length + 1,
              from: '',
              to: '',
              carrier: '',
              amount: 22,
              shipmentDate: '',
              arrivalDate: '',
              status: 'Pending',
            };
            setEditingTransfer({ ...editingTransfer, legs: [...editLegs, newLeg] });
          };
          const updateEditLeg = (legId: string, field: keyof TransferLeg, value: any) => {
            const updated = editLegs.map(l => l.id === legId ? { ...l, [field]: value } : l);
            const totalAmt = updated.reduce((s, l) => s + l.amount, 0);
            const carrierStr = updated.map(l => l.carrier).filter(Boolean).join(' → ');
            setEditingTransfer({ ...editingTransfer, legs: updated, amount: updated.length > 0 ? totalAmt : editingTransfer.amount, carrier: updated.length > 0 ? carrierStr : editingTransfer.carrier });
          };
          const removeEditLeg = (legId: string) => {
            const updated = editLegs.filter(l => l.id !== legId).map((l, i) => ({ ...l, legNumber: i + 1 }));
            const totalAmt = updated.reduce((s, l) => s + l.amount, 0);
            const carrierStr = updated.map(l => l.carrier).filter(Boolean).join(' → ');
            setEditingTransfer({ ...editingTransfer, legs: updated.length > 0 ? updated : undefined, amount: updated.length > 0 ? totalAmt : editingTransfer.amount, carrier: updated.length > 0 ? carrierStr : editingTransfer.carrier });
          };
          return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Transfer — {editingTransfer.transferNumber}</h3>
                <button onClick={() => setEditingTransfer(null)} className="hover:rotate-90 transition-transform"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">From (Origin)</label>
                    <select value={editingTransfer.from} onChange={(e) => setEditingTransfer({...editingTransfer, from: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">To (Final Destination)</label>
                    <select value={editingTransfer.to} onChange={(e) => setEditingTransfer({...editingTransfer, to: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Product</label>
                    <select value={editingTransfer.product} onChange={(e) => setEditingTransfer({...editingTransfer, product: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">Select Product</option>
                      {skus.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    </select>
                  </div>
                  {!hasLegs ? (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Amount (MT)</label>
                      <input type="text" inputMode="decimal" value={editingTransfer.amount || ""} onFocus={(e) => e.target.select()} onChange={(e) => setEditingTransfer({...editingTransfer, amount: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Total Amount (MT)</label>
                      <div className="w-full bg-[#F5F5F5] border border-[#141414]/30 p-2 text-sm font-bold">{editLegs.reduce((s, l) => s + l.amount, 0).toFixed(1)} MT</div>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Lot Code</label>
                    <input type="text" value={editingTransfer.lotCode || ''} onChange={(e) => setEditingTransfer({...editingTransfer, lotCode: e.target.value})} placeholder="e.g. LOT-2026-001" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                  {!hasLegs && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                      <select value={editingTransfer.carrier} onChange={(e) => setEditingTransfer({...editingTransfer, carrier: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        <option value="">Select Carrier</option>
                        {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Shipment Date</label>
                    <input type="date" value={editingTransfer.shipmentDate} onChange={(e) => setEditingTransfer({...editingTransfer, shipmentDate: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Arrival Date</label>
                    <input type="date" value={editingTransfer.arrivalDate} onChange={(e) => setEditingTransfer({...editingTransfer, arrivalDate: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Status</label>
                    <select value={editingTransfer.status} onChange={(e) => setEditingTransfer({...editingTransfer, status: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="Pending">Pending</option>
                      <option value="In Transit">In Transit</option>
                      <option value="Completed">Completed</option>
                      <option value="Cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Notes</label>
                    <input type="text" value={editingTransfer.notes || ''} onChange={(e) => setEditingTransfer({...editingTransfer, notes: e.target.value})} placeholder="Optional notes..." className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                </div>

                {/* Transfer Legs Section */}
                <div className="border-t border-[#141414]/10 pt-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-60">Transfer Legs</h4>
                    <button type="button" onClick={addEditLeg} className="px-3 py-1 bg-[#141414] text-[#E4E3E0] text-[9px] font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-1">
                      <Plus size={10} /> Add Leg
                    </button>
                  </div>
                  {editLegs.length === 0 && (
                    <div className="text-xs italic opacity-40 text-center py-2">No legs — this is a direct transfer. Add legs to split into multiple segments.</div>
                  )}
                  {editLegs.map((leg) => (
                    <div key={leg.id} className="bg-[#F5F5F5] border border-[#141414]/10 p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase opacity-60">Leg {leg.legNumber}</span>
                        <button type="button" onClick={() => removeEditLeg(leg.id)} className="p-0.5 hover:bg-red-500 hover:text-white transition-all rounded">
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="space-y-0.5">
                          <label className="text-[9px] uppercase font-bold opacity-50">From</label>
                          <select value={leg.from} onChange={(e) => updateEditLeg(leg.id, 'from', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                            <option value="">Select</option>
                            {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] uppercase font-bold opacity-50">To</label>
                          <select value={leg.to} onChange={(e) => updateEditLeg(leg.id, 'to', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                            <option value="">Select</option>
                            {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] uppercase font-bold opacity-50">Carrier</label>
                          <select value={leg.carrier} onChange={(e) => updateEditLeg(leg.id, 'carrier', e.target.value)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none">
                            <option value="">Select</option>
                            {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] uppercase font-bold opacity-50">Amount (MT)</label>
                          <input type="text" inputMode="decimal" value={leg.amount || ''} onFocus={(e) => e.target.select()} onChange={(e) => updateEditLeg(leg.id, 'amount', parseFloat(e.target.value) || 0)} className="w-full bg-white border border-[#141414]/30 p-1.5 text-xs focus:outline-none" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => {
                      // Recalculate totals from legs before saving
                      let updatedTransfer = { ...editingTransfer };
                      if (updatedTransfer.legs && updatedTransfer.legs.length > 0) {
                        updatedTransfer.amount = updatedTransfer.legs.reduce((s, l) => s + l.amount, 0);
                        updatedTransfer.carrier = updatedTransfer.legs.map(l => l.carrier).filter(Boolean).join(' → ');
                      }
                      setTransfers(transfers.map(t => t.id === editingTransfer.id ? updatedTransfer : t));
                      setEditingTransfer(null);
                    }}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Save Changes
                  </button>
                  <button onClick={() => setEditingTransfer(null)} className="flex-1 py-3 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">Cancel</button>
                </div>
              </div>
            </motion.div>
          </div>
          );
        })()}

      {/* Print Styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body { background: white !important; }
          header, aside, .lg\\:col-span-4, button { display: none !important; }
          .lg\\:col-span-8 { width: 100% !important; }
          .shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] { box-shadow: none !important; border: 2px solid #141414 !important; }
          main { margin-left: 0 !important; }
        }
      `}} />
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string }) {
  return (
    <div className="relative mb-4">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <RefreshCw size={14} className="text-[#141414] opacity-40" />
      </div>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full pl-10 pr-3 py-2 border border-[#141414] bg-white text-xs font-bold uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-[#141414]/20 transition-all shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]"
      />
    </div>
  );
}

function SortableHeader({ label, sortKey, currentSort, onSort }: { label: string, sortKey: string, currentSort: { key: string, direction: 'asc' | 'desc' } | null, onSort: (key: string) => void }) {
  const isActive = currentSort?.key === sortKey;
  return (
    <th 
      className="p-4 border-r border-[#E4E3E0]/20 cursor-pointer hover:bg-white/10 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-2">
        {label}
        {isActive ? (
          currentSort.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronDown size={12} className="opacity-20" />
        )}
      </div>
    </th>
  );
}

function InputField({ label, value, onChange, step = "0.01", disabled = false }: { label: string, value: number, onChange: (v: string) => void, step?: string, disabled?: boolean }) {
  const isCurrency = label.includes('CAD') || label.includes('USD');
  const [isFocused, setIsFocused] = useState(false);
  const [localValue, setLocalValue] = useState('');

  const formattedValue = isCurrency ? Number(value ?? 0).toFixed(2) : String(value ?? 0);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    // On focus, show the raw number without trailing zeros so the user can edit naturally
    const raw = Number(value ?? 0);
    const display = raw === 0 ? '' : String(raw);
    setLocalValue(display);
    // Select all text for easy replacement
    setTimeout(() => e.target.select(), 0);
  };

  const handleBlur = () => {
    setIsFocused(false);
    // Commit the value on blur
    onChange(localValue || '0');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    // Allow empty, digits, decimal point, and minus sign
    if (v === '' || v === '-' || v === '.' || /^-?\d*\.?\d*$/.test(v)) {
      setLocalValue(v);
      // Live update parent so calculations reflect in real time
      if (v !== '' && v !== '-' && v !== '.') {
        onChange(v);
      }
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase font-bold opacity-60">{label}</label>
      <input
        type="text"
        inputMode="decimal"
        value={isFocused ? localValue : formattedValue}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        disabled={disabled}
        className={`w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}

function DataRow({ label, value, highlight = false }: { label: string, value: string, highlight?: boolean }) {
  return (
    <div className={`p-4 flex justify-between items-center ${highlight ? 'bg-[#F9F9F9]' : ''}`}>
      <span className={`text-xs ${highlight ? 'font-bold underline' : 'opacity-70'}`}>{label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-indigo-600' : ''}`}>{value}</span>
    </div>
  );
}
