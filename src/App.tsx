/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Calculator, 
  TrendingUp, 
  Globe, 
  Truck, 
  Package, 
  Download, 
  Printer, 
  Save, 
  ChevronRight,
  Info,
  Users,
  DollarSign,
  ArrowRightLeft,
  FileText,
  Menu,
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
  Palette,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebaseConfig';
import { fetchAllData, syncCollection, COLLECTIONS, fetchCollection } from './firebaseDb';
import { CommodityConfig, INITIAL_SKUS, INITIAL_CUSTOMERS, INITIAL_SUPPLY_CHAIN, INITIAL_FREIGHT_RATES, INITIAL_CONTRACTS, INITIAL_HAMILTON_SHIPMENTS, INITIAL_CARRIERS, INITIAL_LOCATIONS, INITIAL_PRODUCT_GROUPS, INITIAL_TRANSFERS, INITIAL_INVOICES, INITIAL_ORDERS, INITIAL_CONFERENCES, INITIAL_PEOPLE, SKU, Customer, SupplyChainComponent, FreightRate, Contract, Shipment, Carrier, Location, Transfer, Invoice, ProductGroup, Order, OrderLineItem, Conference, ConferenceMeeting, Person } from './types';
import ConferencesPage from './components/ConferencesPage';
import PeoplePage from './components/PeoplePage';

export default function App() {
  const [activePage, setActivePage] = useState('Dashboard');
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [skus, setSkus] = useState<SKU[]>(INITIAL_SKUS);
  const [supplyChain, setSupplyChain] = useState<SupplyChainComponent[]>(INITIAL_SUPPLY_CHAIN);
  const [freightRates, setFreightRates] = useState<FreightRate[]>(INITIAL_FREIGHT_RATES);
  const [contracts, setContracts] = useState<Contract[]>(INITIAL_CONTRACTS);
  const [carriers, setCarriers] = useState<Carrier[]>(INITIAL_CARRIERS);
  const [locations, setLocations] = useState<Location[]>(INITIAL_LOCATIONS);
  const [transfers, setTransfers] = useState<Transfer[]>(INITIAL_TRANSFERS);
  const [invoices, setInvoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [conferences, setConferences] = useState<Conference[]>(INITIAL_CONFERENCES);
  const [people, setPeople] = useState<Person[]>(INITIAL_PEOPLE);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [isAddingTransfer, setIsAddingTransfer] = useState(false);
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
    entries: [{ shipmentDate: '', deliveryDate: '', po: '', bol: '', qty: 22, carrier: '', amount: 0 }]
  });

  // New Order Modal State
  const [orderCustomerId, setOrderCustomerId] = useState('');
  const [orderPO, setOrderPO] = useState('');
  const [orderShipmentDate, setOrderShipmentDate] = useState('');
  const [orderDeliveryDate, setOrderDeliveryDate] = useState('');
  const [orderCarrier, setOrderCarrier] = useState('');
  const [orderLineItems, setOrderLineItems] = useState<OrderLineItem[]>([]);
  const [newLineItem, setNewLineItem] = useState<{
    productName: string;
    qty: number;
    contractNumber: string;
  }>({ productName: '', qty: 0, contractNumber: '' });
  const [filteredOrderContracts, setFilteredOrderContracts] = useState<Contract[]>([]);
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ orderId: string; newStatus: Order['status'] } | null>(null);
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
  const [isFetchingShipments, setIsFetchingShipments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      
      const newShipments: Shipment[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = lines[i].split(',').map(v => v.trim());
        const entry: any = {};
        headers.forEach((h, idx) => {
          entry[h] = values[idx];
        });

        // Basic validation and defaults
        if (!entry.date) continue;

        const date = entry.date;
        const week = entry.week || `Week ${getWeekNumber(date)}`;
        const day = entry.day || new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(date + 'T12:00:00'));
        
        newShipments.push({
          id: entry.id || `SHIP-${Date.now()}-${Math.random()}`,
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
          status: entry.status || 'Pending',
          notes: entry.notes || '',
          color: entry.color || ''
        });
      }

      if (newShipments.length > 0) {
        if (activePage === 'Hamilton Shipments') {
          setHamiltonShipments(prev => [...prev, ...newShipments]);
        } else {
          setVancouverShipments(prev => [...prev, ...newShipments]);
        }
        alert(`Successfully imported ${newShipments.length} shipments.`);
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };
  const [selectedBay, setSelectedBay] = useState('');
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
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
  const [editingSupplyChain, setEditingSupplyChain] = useState<SupplyChainComponent | null>(null);
  const [isAddingSupplyChain, setIsAddingSupplyChain] = useState(false);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null);
  const [isAddingShipment, setIsAddingShipment] = useState(false);
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
        const mapped = data.locations.map((l: any) => ({
          ...l,
          bays: Array.isArray(l.bays) ? l.bays : (typeof l.bays === 'string' ? l.bays.split(',').map((b: string) => b.trim()).filter(Boolean) : [])
        }));
        setLocations(mapped);
        lastSyncedData.current.locations = JSON.stringify(mapped);
      }
      if (data.transfers?.length) {
        const mapped = data.transfers.map((t: any) => ({
          ...t,
          amount: parseFloat(t.amount) || 0
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
        setConferences(data.conferences);
        lastSyncedData.current.conferences = JSON.stringify(data.conferences);
      }
      if (data.people?.length) {
        setPeople(data.people);
        lastSyncedData.current.people = JSON.stringify(data.people);
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
  }, [customers, skus, supplyChain, freightRates, contracts, carriers, hamiltonShipments, vancouverShipments, locations, transfers, invoices, productGroups, orders, conferences, people, lastSynced, user]);
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
    contractStartDate: new Date().toISOString().split('T')[0],
    contractEndDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    isPalletCharge: false,
    palletCostCadMt: 15.00
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
    const rawKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('raw sugar') || k.toLowerCase().includes('#11'));
    const fxKey = Object.keys(firstRow).find(k => k.toLowerCase().includes('fx') || k.toLowerCase().includes('cad'));

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
  const timeSlotsList = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    const totalMinutes = i * 90;
    const hour = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const min = (totalMinutes % 60).toString().padStart(2, '0');
    return `${hour}:${min}`;
  }), []);

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

  const checkShipmentConflicts = (shipment: Shipment, excludeId?: string) => {
    const allShipments = [...hamiltonShipments, ...vancouverShipments];
    
    // Check appointment collision
    const collision = allShipments.find(s => 
      s.id !== excludeId && 
      s.date === shipment.date && 
      s.time === shipment.time && 
      s.bay === shipment.bay
    );
    if (collision) return 'appointment already taken';

    // Check PO uniqueness
    if (shipment.po) {
      const poDuplicate = allShipments.find(s => s.id !== excludeId && s.po === shipment.po);
      if (poDuplicate) return 'PO number has already been used';
    }

    // Check BOL uniqueness
    if (shipment.bol) {
      const bolDuplicate = allShipments.find(s => s.id !== excludeId && s.bol === shipment.bol);
      if (bolDuplicate) return 'BOL number has already been used';
    }

    return null;
  };

  const getWeekNumber = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const firstMonday = new Date(y, 0, 1);
    const dayOfWeek = firstMonday.getDay();
    const diff = (dayOfWeek <= 4 ? 1 - dayOfWeek : 8 - dayOfWeek);
    firstMonday.setDate(firstMonday.getDate() + diff);
    
    if (date < firstMonday) return 1;
    const diffDays = Math.floor((date.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
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
    // Determine prefix based on product groups in line items
    const productGroups = lineItems.map(item => {
      const product = skus.find(s => s.name === item.productName);
      return product?.productGroup || 'Other';
    });

    const uniqueGroups = new Set(productGroups);
    const prefix =
      uniqueGroups.size === 1 && uniqueGroups.has('Liquid') ? 'L' :
      uniqueGroups.size === 1 && uniqueGroups.has('Bulk') ? 'B' :
      'P'; // Mixed or Other

    // Find highest existing BOL with same prefix and extract counter
    const currentYear = new Date().getFullYear();
    const samePrefixBOLs = orders
      .map(o => o.bolNumber)
      .filter(bol => bol?.startsWith(prefix + '-' + currentYear + '-'))
      .map(bol => parseInt(bol.split('-')[2]) || 0);

    const nextCounter = (Math.max(...samePrefixBOLs, 0) + 1).toString().padStart(3, '0');
    return `${prefix}-${currentYear}-${nextCounter}`;
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
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [isAddingSku, setIsAddingSku] = useState(false);
  const [isAddingFreightRate, setIsAddingFreightRate] = useState(false);
  const [isAddingCarrier, setIsAddingCarrier] = useState(false);
  const [showPreviousWeeks, setShowPreviousWeeks] = useState(false);
  const [isAddingBatchShipment, setIsAddingBatchShipment] = useState(false);
  const [batchShipment, setBatchShipment] = useState<{
    customer: string;
    product: string;
    entries: { date: string; time: string; po: string; bol: string; qty: number; carrier: string; }[];
  }>({
    customer: '',
    product: '',
    entries: [{ date: new Date().toISOString().split('T')[0], time: '08:00', po: '', bol: '', qty: 22, carrier: '' }]
  });
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
    color: '#E4E3E0'
  });
  const [newFreightRate, setNewFreightRate] = useState<FreightRate>({
    id: '',
    origin: 'Hamilton',
    destination: '',
    provider: '',
    cost: 0,
    freightType: 'Dry Van',
    mtPerLoad: 22
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
      mtPerLoad: 22
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

  const updateShipment = (id: string, field: keyof Shipment, value: any) => {
    setHamiltonShipments(hamiltonShipments.map(s => s.id === id ? { ...s, [field]: value } : s));
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
      notes: `Generated from quote tool for ${customer}`
    };

    setContracts([...contracts, newContract]);
    setShowContractConfirm(false);
    setActivePage('Contracts');
  };

  const updateCustomer = (id: string, field: keyof Customer, value: any) => {
    setCustomers(customers.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const updateSku = (id: string, field: keyof SKU, value: any) => {
    setSkus(skus.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const calculations = useMemo(() => {
    const mtToCwt = 22.0462;
    const fx = config.fxRate || 1;
    
    // Lookup freight cost based on origin/destination
    const matchedRate = freightRates.find(r => r.origin === config.origin && r.destination === config.destination);
    const freightCost = matchedRate ? matchedRate.cost : config.freightCostTotalCad;

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

  const handlePrint = () => window.print();

  const navItems = [
    { name: 'Dashboard', icon: TrendingUp },
    { name: 'Customer Quote', icon: Calculator },
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
    { name: 'People', icon: Users },
  ];

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
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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

    if (activePage === 'Hamilton Shipments') {
      const currentWeekNum = getWeekNumber(new Date().toISOString());
      const currentWeek = `Week ${currentWeekNum}`;
      const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

      const hamiltonLocation = locations.find(l => l.name.toLowerCase().includes('hamilton'));
      const hamiltonBays = hamiltonLocation ? hamiltonLocation.bays : ['BAY 1 (W) - FERGUSON AVE.', 'BAY 2 (E) - WELLINGTON ST.', 'BAY 3 - MOLASSES, DRY DOCKS'];

      const filteredShipments = hamiltonShipments.filter(s => {
        const matchesSearch = !searchTerm || 
          s.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.product.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.po.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.bol.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.carrier.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      });

      // Group by Week -> Bay -> Day -> Time
      const groupedData: { [week: string]: { [bay: string]: { [day: string]: { [time: string]: Shipment[] } } } } = {};
      
      weeksList.forEach(w => {
        groupedData[w] = {};
        hamiltonBays.forEach(b => {
          groupedData[w][b] = {};
          daysList.forEach(d => {
            groupedData[w][b][d] = {};
          });
        });
      });

      filteredShipments.forEach(s => {
        if (groupedData[s.week] && groupedData[s.week][s.bay] && groupedData[s.week][s.bay][s.day]) {
          if (!groupedData[s.week][s.bay][s.day][s.time]) groupedData[s.week][s.bay][s.day][s.time] = [];
          groupedData[s.week][s.bay][s.day][s.time].push(s);
        }
      });

      const visibleWeeks = showPreviousWeeks 
        ? weeksList 
        : weeksList.filter(w => parseInt(w.replace('Week ', '')) >= Number(currentWeekNum));

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold uppercase tracking-tighter">Hamilton Shipment Schedule</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} className={isFetchingShipments ? 'animate-spin' : ''} />
                Last Updated: {new Date().toLocaleString()}
              </div>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowPreviousWeeks(!showPreviousWeeks)}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
              >
                {showPreviousWeeks ? 'Hide Previous Weeks' : 'Show Previous Weeks'}
              </button>
              <button 
                onClick={() => {
                  const headers = ['id', 'date', 'time', 'bay', 'customer', 'product', 'contractNumber', 'po', 'bol', 'qty', 'carrier', 'status', 'notes'];
                  const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", "shipment_template.csv");
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#F5F5F5] transition-all"
              >
                <Download size={14} /> Template
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#F5F5F5] transition-all"
              >
                <FileText size={14} /> Import CSV
              </button>
              <button 
                onClick={() => setIsAddingBatchShipment(true)}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Plus size={14} /> Add Batch Shipments
              </button>
              <button
                onClick={() => {
                  setShipmentSearchCustomer('');
                  setShipmentSearchBOL('');
                  setShipmentSearchTransfer('');
                  setIsAddingShipment(true);
                }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={14} /> Add Shipment
              </button>
            </div>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search shipments by customer, product, PO, BOL or carrier..."
          />

          <div className="space-y-4">
            {visibleWeeks.map(week => {
              const isExpanded = expandedRows.has(week) || (week === currentWeek && expandedRows.size === 0);
              
              return (
                <div key={week} className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
                  <button 
                    onClick={() => {
                      const next = new Set(expandedRows);
                      if (next.has(week)) next.delete(week);
                      else next.add(week);
                      setExpandedRows(next);
                    }}
                    className="w-full p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center hover:bg-opacity-90 transition-all"
                  >
                    <span className="text-xs font-bold uppercase tracking-widest">{week} {week === currentWeek ? '(CURRENT)' : ''}</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-4">
                          {hamiltonBays.map(bay => {
                            const bayKey = `${week}-${bay}`;
                            const isBayExpanded = expandedBays.has(bayKey);
                            
                            return (
                              <div key={bay} className="border-2 border-[#141414] rounded-lg overflow-hidden">
                                <button 
                                  onClick={() => {
                                    const next = new Set(expandedBays);
                                    if (next.has(bayKey)) next.delete(bayKey);
                                    else next.add(bayKey);
                                    setExpandedBays(next);
                                  }}
                                  className="w-full p-3 bg-[#F5F5F5] flex justify-between items-center hover:bg-[#E4E3E0] transition-all border-b border-[#141414]"
                                >
                                  <span className="text-xs font-black uppercase tracking-widest">{bay}</span>
                                  {isBayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>

                                {isBayExpanded && (
                                  <div className="p-4 space-y-4 bg-white">
                                    {daysList.map(day => {
                                      const dayKey = `${week}-${bay}-${day}`;
                                      const isDayExpanded = expandedDays.has(dayKey) || (week === currentWeek && day === currentDay && !expandedDays.has(dayKey));
                                      const weekNum = parseInt(week.replace('Week ', ''));
                                      const dateObj = getDateForWeekDay(weekNum, day);
                                      const dateStr = toLocalDateString(dateObj);
                                      const displayDate = formatDateMMM_DD(dateStr);

                                      return (
                                        <div key={day} className="border border-[#141414]/10 rounded-lg overflow-hidden">
                                          <button 
                                            onClick={() => {
                                              const next = new Set(expandedDays);
                                              if (next.has(dayKey)) next.delete(dayKey);
                                              else next.add(dayKey);
                                              setExpandedDays(next);
                                            }}
                                            className="w-full p-3 bg-[#F9F9F9] flex justify-between items-center hover:bg-[#F0F0F0] transition-all"
                                          >
                                            <div className="flex items-center gap-4">
                                              <span className="text-[10px] font-black uppercase tracking-widest">{day}</span>
                                              <span className="text-[10px] font-bold opacity-50">{displayDate}</span>
                                            </div>
                                            {isDayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                          </button>

                                          {isDayExpanded && (
                                            <div className="overflow-x-auto">
                                              <table className="w-full text-left border-collapse">
                                                <thead>
                                                  <tr className="bg-white text-[9px] uppercase font-bold border-b border-[#141414]/10">
                                                    <th className="p-2 border-r border-[#141414]/5 w-16">Time</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Customer</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Product</th>
                                                    <th className="p-2 border-r border-[#141414]/5">PO</th>
                                                    <th className="p-2 border-r border-[#141414]/5">BOL #</th>
                                                    <th className="p-2 border-r border-[#141414]/5">QTY</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Carrier</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Arrive</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Start</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Out</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Status</th>
                                                    <th className="p-2">Actions</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[#141414]/5">
                                                  {timeSlotsList.map(slot => {
                                                    const shipments = groupedData[week][bay][day][slot] || [];
                                                    if (shipments.length === 0) {
                                                      return (
                                                        <tr key={slot} className="group hover:bg-[#F9F9F9] transition-colors bg-[#141414]/5 hover:bg-[#141414]/10">
                                                          <td className="p-2 text-[10px] font-mono border-r border-[#141414]/5">{slot}</td>
                                                          <td colSpan={10} className="p-2 text-[9px] italic font-bold opacity-40">Available Slot</td>
                                                          <td className="p-2 text-xs">
                                                            <button 
                                                              onClick={() => {
                                                                setEditingShipment({
                                                                  id: '',
                                                                  week,
                                                                  date: dateStr,
                                                                  day,
                                                                  time: slot,
                                                                  bay: bay,
                                                                  customer: '',
                                                                  product: '',
                                                                  po: '',
                                                                  bol: '',
                                                                  qty: 22,
                                                                  carrier: '',
                                                                  arrive: '',
                                                                  start: '',
                                                                  out: '',
                                                                  status: 'Pending',
                                                                  contractNumber: ''
                                                                });
                                                                setIsAddingShipment(false);
                                                              }}
                                                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                                                            >
                                                              <Plus size={10} />
                                                            </button>
                                                          </td>
                                                        </tr>
                                                      );
                                                    }
                                                    return shipments.map(s => (
                                                      <tr key={s.id} className="hover:bg-[#F9F9F9] transition-colors" style={{ backgroundColor: s.color || 'transparent' }}>
                                                        <td className="p-2 text-[10px] font-mono font-bold border-r border-[#141414]/5">{slot}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5 font-black">{s.customer}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.product}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.po}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.bol}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.qty}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.carrier}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.arrive}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.start}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.out}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">
                                                          <select 
                                                            value={s.status} 
                                                            onChange={(e) => updateShipmentStatus(s.id, e.target.value)}
                                                            className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer ${
                                                              (s.status || '').toLowerCase().includes('confirmed') ? 'bg-emerald-100 text-emerald-700' :
                                                              (s.status || '').toLowerCase().includes('pending') ? 'bg-amber-100 text-amber-700' :
                                                              'bg-slate-100 text-slate-700'
                                                            }`}
                                                          >
                                                            <option value="Pending">Pending</option>
                                                            <option value="Confirmed">Confirmed</option>
                                                            <option value="In Progress">In Progress</option>
                                                            <option value="Completed">Completed</option>
                                                            <option value="Cancelled">Cancelled</option>
                                                          </select>
                                                        </td>
                                                        <td className="p-2 text-xs flex gap-1">
                                                          <button onClick={() => setEditingShipment(s)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"><Edit2 size={10} /></button>
                                                          <button onClick={() => deleteShipment(s.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all"><Trash2 size={10} /></button>
                                                        </td>
                                                      </tr>
                                                    ));
                                                  })}
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

    if (activePage === 'Vancouver Shipments') {
      const currentWeekNum = getWeekNumber(new Date().toISOString());
      const currentWeek = `Week ${currentWeekNum}`;
      const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());

      const vancouverLocation = locations.find(l => l.name.toLowerCase().includes('vancouver'));
      const vancouverBays = vancouverLocation ? vancouverLocation.bays : ['BAY 1', 'BAY 2'];

      const filteredShipments = vancouverShipments.filter(s => {
        const matchesSearch = !searchTerm || 
          s.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.product.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.po.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.bol.toLowerCase().includes(searchTerm.toLowerCase()) ||
          s.carrier.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesSearch;
      });

      // Group by Week -> Bay -> Day -> Time
      const groupedData: { [week: string]: { [bay: string]: { [day: string]: { [time: string]: Shipment[] } } } } = {};
      
      weeksList.forEach(w => {
        groupedData[w] = {};
        vancouverBays.forEach(b => {
          groupedData[w][b] = {};
          daysList.forEach(d => {
            groupedData[w][b][d] = {};
          });
        });
      });

      filteredShipments.forEach(s => {
        if (groupedData[s.week] && groupedData[s.week][s.bay] && groupedData[s.week][s.bay][s.day]) {
          if (!groupedData[s.week][s.bay][s.day][s.time]) groupedData[s.week][s.bay][s.day][s.time] = [];
          groupedData[s.week][s.bay][s.day][s.time].push(s);
        }
      });

      const visibleWeeks = showPreviousWeeks 
        ? weeksList 
        : weeksList.filter(w => parseInt(w.replace('Week ', '')) >= Number(currentWeekNum));

      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold uppercase tracking-tighter">Vancouver Shipment Schedule</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} className={isFetchingShipments ? 'animate-spin' : ''} />
                Last Updated: {new Date().toLocaleString()}
              </div>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowPreviousWeeks(!showPreviousWeeks)}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
              >
                {showPreviousWeeks ? 'Hide Previous Weeks' : 'Show Previous Weeks'}
              </button>
              <button 
                onClick={() => {
                  const headers = ['id', 'date', 'time', 'bay', 'customer', 'product', 'contractNumber', 'po', 'bol', 'qty', 'carrier', 'status', 'notes'];
                  const csvContent = "data:text/csv;charset=utf-8," + headers.join(",");
                  const encodedUri = encodeURI(csvContent);
                  const link = document.createElement("a");
                  link.setAttribute("href", encodedUri);
                  link.setAttribute("download", "shipment_template.csv");
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#F5F5F5] transition-all"
              >
                <Download size={14} /> Template
              </button>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#F5F5F5] transition-all"
              >
                <FileText size={14} /> Import CSV
              </button>
              <button 
                onClick={() => setIsAddingBatchShipment(true)}
                className="px-4 py-2 border border-[#141414] text-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Plus size={14} /> Add Batch Shipments
              </button>
              <button
                onClick={() => {
                  setShipmentSearchCustomer('');
                  setShipmentSearchBOL('');
                  setShipmentSearchTransfer('');
                  setIsAddingShipment(true);
                }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={14} /> Add Shipment
              </button>
            </div>
          </div>

          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search shipments..."
          />

          <div className="space-y-4">
            {visibleWeeks.map(week => {
              const isExpanded = expandedRows.has(week) || (week === currentWeek && expandedRows.size === 0);
              
              return (
                <div key={week} className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
                  <button 
                    onClick={() => {
                      const next = new Set(expandedRows);
                      if (next.has(week)) next.delete(week);
                      else next.add(week);
                      setExpandedRows(next);
                    }}
                    className="w-full p-4 bg-[#141414] text-[#E4E3E0] flex justify-between items-center hover:bg-opacity-90 transition-all"
                  >
                    <span className="text-xs font-bold uppercase tracking-widest">{week} {week === currentWeek ? '(CURRENT)' : ''}</span>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="p-4 space-y-4">
                          {vancouverBays.map(bay => {
                            const bayKey = `${week}-${bay}`;
                            const isBayExpanded = expandedBays.has(bayKey);
                            
                            return (
                              <div key={bay} className="border-2 border-[#141414] rounded-lg overflow-hidden">
                                <button 
                                  onClick={() => {
                                    const next = new Set(expandedBays);
                                    if (next.has(bayKey)) next.delete(bayKey);
                                    else next.add(bayKey);
                                    setExpandedBays(next);
                                  }}
                                  className="w-full p-3 bg-[#F5F5F5] flex justify-between items-center hover:bg-[#E4E3E0] transition-all border-b border-[#141414]"
                                >
                                  <span className="text-xs font-black uppercase tracking-widest">{bay}</span>
                                  {isBayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                </button>

                                {isBayExpanded && (
                                  <div className="p-4 space-y-4 bg-white">
                                    {daysList.map(day => {
                                      const dayKey = `${week}-${bay}-${day}`;
                                      const isDayExpanded = expandedDays.has(dayKey) || (week === currentWeek && day === currentDay && !expandedDays.has(dayKey));
                                      const weekNum = parseInt(week.replace('Week ', ''));
                                      const dateObj = getDateForWeekDay(weekNum, day);
                                      const dateStr = toLocalDateString(dateObj);
                                      const displayDate = formatDateMMM_DD(dateStr);

                                      return (
                                        <div key={day} className="border border-[#141414]/10 rounded-lg overflow-hidden">
                                          <button 
                                            onClick={() => {
                                              const next = new Set(expandedDays);
                                              if (next.has(dayKey)) next.delete(dayKey);
                                              else next.add(dayKey);
                                              setExpandedDays(next);
                                            }}
                                            className="w-full p-3 bg-[#F9F9F9] flex justify-between items-center hover:bg-[#F0F0F0] transition-all"
                                          >
                                            <div className="flex items-center gap-4">
                                              <span className="text-[10px] font-black uppercase tracking-widest">{day}</span>
                                              <span className="text-[10px] font-bold opacity-50">{displayDate}</span>
                                            </div>
                                            {isDayExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                          </button>

                                          {isDayExpanded && (
                                            <div className="overflow-x-auto">
                                              <table className="w-full text-left border-collapse">
                                                <thead>
                                                  <tr className="bg-white text-[9px] uppercase font-bold border-b border-[#141414]/10">
                                                    <th className="p-2 border-r border-[#141414]/5 w-16">Time</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Customer</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Product</th>
                                                    <th className="p-2 border-r border-[#141414]/5">PO</th>
                                                    <th className="p-2 border-r border-[#141414]/5">BOL #</th>
                                                    <th className="p-2 border-r border-[#141414]/5">QTY</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Carrier</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Arrive</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Start</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Out</th>
                                                    <th className="p-2 border-r border-[#141414]/5">Status</th>
                                                    <th className="p-2">Actions</th>
                                                  </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[#141414]/5">
                                                  {timeSlotsList.map(slot => {
                                                    const shipments = groupedData[week][bay][day][slot] || [];
                                                    if (shipments.length === 0) {
                                                      return (
                                                        <tr key={slot} className="group hover:bg-[#F9F9F9] transition-colors bg-[#141414]/5 hover:bg-[#141414]/10">
                                                          <td className="p-2 text-[10px] font-mono border-r border-[#141414]/5">{slot}</td>
                                                          <td colSpan={10} className="p-2 text-[9px] italic font-bold opacity-40">Available Slot</td>
                                                          <td className="p-2 text-xs">
                                                            <button 
                                                              onClick={() => {
                                                                setEditingShipment({
                                                                  id: '',
                                                                  week,
                                                                  date: dateStr,
                                                                  day,
                                                                  time: slot,
                                                                  bay: bay,
                                                                  customer: '',
                                                                  product: '',
                                                                  po: '',
                                                                  bol: '',
                                                                  qty: 22,
                                                                  carrier: '',
                                                                  arrive: '',
                                                                  start: '',
                                                                  out: '',
                                                                  status: 'Pending',
                                                                  contractNumber: ''
                                                                });
                                                                setIsAddingShipment(false);
                                                              }}
                                                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                                                            >
                                                              <Plus size={10} />
                                                            </button>
                                                          </td>
                                                        </tr>
                                                      );
                                                    }
                                                    return shipments.map(s => (
                                                      <tr key={s.id} className="hover:bg-[#F9F9F9] transition-colors" style={{ backgroundColor: s.color || 'transparent' }}>
                                                        <td className="p-2 text-[10px] font-mono font-bold border-r border-[#141414]/5">{slot}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5 font-black">{s.customer}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.product}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.po}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.bol}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.qty}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.carrier}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.arrive}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.start}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">{s.out}</td>
                                                        <td className="p-2 text-[10px] border-r border-[#141414]/5">
                                                          <select 
                                                            value={s.status} 
                                                            onChange={(e) => updateShipmentStatus(s.id, e.target.value)}
                                                            className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] focus:outline-none cursor-pointer ${
                                                              (s.status || '').toLowerCase().includes('confirmed') ? 'bg-emerald-100 text-emerald-700' :
                                                              (s.status || '').toLowerCase().includes('pending') ? 'bg-amber-100 text-amber-700' :
                                                              'bg-slate-100 text-slate-700'
                                                            }`}
                                                          >
                                                            <option value="Pending">Pending</option>
                                                            <option value="Confirmed">Confirmed</option>
                                                            <option value="In Progress">In Progress</option>
                                                            <option value="Completed">Completed</option>
                                                            <option value="Cancelled">Cancelled</option>
                                                          </select>
                                                        </td>
                                                        <td className="p-2 text-xs flex gap-1">
                                                          <button onClick={() => setEditingShipment(s)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"><Edit2 size={10} /></button>
                                                          <button onClick={() => deleteShipment(s.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all"><Trash2 size={10} /></button>
                                                        </td>
                                                      </tr>
                                                    ));
                                                  })}
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

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="No." sortKey="id" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Customer Name" sortKey="name" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Default Location" sortKey="defaultLocation" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Default Margin" sortKey="defaultMargin" currentSort={sortConfig} onSort={handleSort} />
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
                          <td colSpan={7} className="p-0">
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

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                    <td colSpan={12} className="p-6 text-center text-xs font-bold opacity-40 italic">
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
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.shipmentDate}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">{t.arrivalDate}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase" style={{ backgroundColor: getStatusColor(t.status).bg, color: getStatusColor(t.status).text }}>
                        {t.status}
                      </span>
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
          
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredInvoices.map(i => (
                  <tr key={i.id} className="hover:bg-[#F9F9F9] transition-colors group">
                    <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{i.bolNumber}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.date}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{i.customer}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.product}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{i.po}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{i.qty}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">${i.amount.toLocaleString()}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">
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
                    <td className="p-4 text-xs flex items-center gap-2">
                      <button className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Print Invoice">
                        <Printer size={14} />
                      </button>
                      <button onClick={() => setInvoices(invoices.filter(item => item.id !== i.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
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

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                  <th className="p-3 border-r border-[#E4E3E0]/20">Appointment</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={13} className="p-6 text-center text-xs font-bold opacity-40 italic">
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
                              if (newStatus === 'Confirmed') {
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
                                    setShipmentCreationData({ location, date: '', time: '', bay: '', carrier: '', orderId: ord.id });
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
                          <button onClick={() => toggleRow(ord.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                            {expandedRows.has(ord.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          <button onClick={() => setOrders(orders.filter(o => o.id !== ord.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
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
              <button 
                onClick={addSku}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={14} /> Add Product
              </button>
            </div>
          </div>

          {/* Product Groups Table */}
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                        <th className="p-4 border-r border-[#141414]/10">Color Coding</th>
                        <th className="p-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/10">
                      {filteredProductGroups.map(pg => (
                        <tr key={pg.id} className="hover:bg-[#F9F9F9] transition-colors">
                          <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{pg.name}</td>
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
          
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                          <button onClick={() => setEditingSku(s)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Edit Product">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => deleteSku(s.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all" title="Delete Product">
                            <Trash2 size={14} />
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
                                <div className="p-6 grid grid-cols-2 gap-6">
                                  <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="space-y-1">
                                        <label className="text-[10px] uppercase font-bold opacity-50">Net Weight (kg)</label>
                                        <div className="text-xs font-bold">{s.netWeightKg || s.netWeight}</div>
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (kg)</label>
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
                                      <label className="text-[10px] uppercase font-bold opacity-50">Premium (CAD/MT)</label>
                                      <div className="text-xs font-bold">${s.premiumCadMt}</div>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold opacity-50">Product Description</label>
                                    <div className="text-xs opacity-70 whitespace-pre-wrap">{s.description || 'No description provided.'}</div>
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

    if (activePage === 'Conferences') {
      return (
        <ConferencesPage
          conferences={conferences}
          customers={customers}
          people={people}
          onAddConference={(newConference) => setConferences([...conferences, newConference])}
          onUpdateConference={(updated) => setConferences(conferences.map(c => c.id === updated.id ? updated : c))}
          onDeleteConference={(id) => setConferences(conferences.filter(c => c.id !== id))}
          onAddMeeting={(conferenceId, newMeeting) => {
            setConferences(conferences.map(c =>
              c.id === conferenceId
                ? { ...c, meetings: [...c.meetings, newMeeting] }
                : c
            ));
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

    if (activePage === 'Supply Chain') {
      const totalCostPerMt = supplyChain.reduce((sum, item) => sum + (item.totalCostCad / (item.weightPerLoadMt || 1)), 0);
      const filteredFreightRates = getSortedAndFilteredData(freightRates, ['origin', 'destination', 'provider', 'freightType']);

      return (
        <div className="p-6 space-y-8">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold uppercase tracking-tighter">Supply Chain Management</h2>
          </div>

          {/* Locations Table */}
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
            <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest">Locations</h3>
              <button 
                onClick={() => {
                  const id = `LOC-${String(locations.length + 1).padStart(3, '0')}`;
                  setLocations([...locations, { id, name: '', address: '', city: '', province: '', postalCode: '', bays: [] }]);
                  setExpandedRows(new Set([id]));
                }}
                className="px-3 py-1 bg-white text-[#141414] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add New Location
              </button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
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
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">
                        <input 
                          type="text" 
                          value={loc.name} 
                          onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, name: e.target.value } : l))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="Location Name"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input 
                          type="text" 
                          value={loc.address} 
                          onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, address: e.target.value } : l))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="Address"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input 
                          type="text" 
                          value={loc.city} 
                          onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, city: e.target.value } : l))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="City"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input 
                          type="text" 
                          value={loc.province} 
                          onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, province: e.target.value } : l))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="Province"
                        />
                      </td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">
                        <input 
                          type="text" 
                          value={loc.postalCode} 
                          onChange={(e) => setLocations(locations.map(l => l.id === loc.id ? { ...l, postalCode: e.target.value } : l))}
                          className="w-full bg-transparent focus:outline-none"
                          placeholder="Postal Code"
                        />
                      </td>
                      <td className="p-4 text-xs flex gap-2">
                        <button onClick={() => toggleRow(loc.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          {expandedRows.has(loc.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button onClick={() => setLocations(locations.filter(l => l.id !== loc.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRows.has(loc.id) && (
                        <tr>
                          <td colSpan={6} className="p-0">
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
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
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
                    <th className="p-4 border-r border-[#141414]/10">Provider</th>
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
                onClick={() => setIsAddingCarrier(true)}
                className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
              >
                <Plus size={12} /> Add Carrier
              </button>
            </div>
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <th className="p-4 border-r border-[#141414]/10">Carrier #</th>
                    <th className="p-4 border-r border-[#141414]/10">Name</th>
                    <th className="p-4 border-r border-[#141414]/10">Contact Email</th>
                    <th className="p-4 border-r border-[#141414]/10">Contact Phone</th>
                    <th className="p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {carriers.map(carrier => (
                    <tr key={carrier.id} className="hover:bg-[#F9F9F9] transition-colors">
                      <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{carrier.carrierNumber}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.name}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.contactEmail}</td>
                      <td className="p-4 text-xs border-r border-[#141414]/10">{carrier.contactPhone}</td>
                      <td className="p-4 text-xs flex items-center gap-2">
                        <button onClick={() => setEditingCarrier(carrier)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setCarriers(carriers.filter(c => c.id !== carrier.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
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

            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                    <SortableHeader label="Origin" sortKey="origin" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Destination" sortKey="destination" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Type" sortKey="freightType" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Provider" sortKey="provider" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Cost (CAD)" sortKey="cost" currentSort={sortConfig} onSort={handleSort} />
                    <SortableHeader label="MT / Load" sortKey="mtPerLoad" currentSort={sortConfig} onSort={handleSort} />
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

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <SortableHeader label="Contract No." sortKey="contractNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Cust No." sortKey="customerNumber" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Customer Name" sortKey="customerName" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume (MT)" sortKey="contractVolume" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume Taken (MT)" sortKey="volumeTaken" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Volume Outstanding (MT)" sortKey="volumeOutstanding" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="Start Date" sortKey="startDate" currentSort={sortConfig} onSort={handleSort} />
                  <SortableHeader label="End Date" sortKey="endDate" currentSort={sortConfig} onSort={handleSort} />
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]">
                {filteredContracts.map(c => (
                  <React.Fragment key={c.id}>
                    <tr className="hover:bg-[#F9F9F9] transition-colors group">
                      <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{c.contractNumber}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10">{c.customerNumber}</td>
                      <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{c.customerName}</td>
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
                      <td className="p-3 text-xs flex items-center gap-2">
                        <button onClick={() => toggleRow(c.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          {expandedRows.has(c.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button onClick={() => setEditingContract(c)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => deleteContract(c.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                    <AnimatePresence>
                      {expandedRows.has(c.id) && (
                        <tr>
                          <td colSpan={9} className="p-0">
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
                                  <div className="text-xs font-bold text-indigo-600">{c.currency} ${c.finalPrice.toFixed(2)}</div>
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
      return (
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-y-1">
              <h2 className="text-xl font-bold uppercase tracking-tighter">US #11 Market Data</h2>
              <div className="flex items-center gap-2 text-[10px] font-bold opacity-50">
                <RefreshCw size={12} className={isFetchingMarket ? 'animate-spin' : ''} />
                Last Updated: {lastMarketUpdate ? new Date(lastMarketUpdate).toLocaleString() : 'Never'}
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

          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    {marketData.length > 0 && Object.keys(marketData[0]).map(key => (
                      <th key={key} className="p-4 border-r border-white/10">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {marketData.length > 0 ? marketData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-[#F9F9F9] transition-colors">
                      {Object.values(row).map((val: any, i) => (
                        <td key={i} className="p-4 text-xs border-r border-[#141414]/10">{val}</td>
                      ))}
                    </tr>
                  )) : (
                    <tr>
                      <td className="p-12 text-center text-xs opacity-50 italic" colSpan={100}>
                        No market data available. Click refresh to fetch.
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
              onChange={(e) => setCustomer(e.target.value)}
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

                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold opacity-60">Pallet Charge</label>
                  <button 
                    onClick={() => handleToggleChange('isPalletCharge')}
                    className={`w-10 h-5 rounded-full relative transition-colors ${config.isPalletCharge ? 'bg-[#141414]' : 'bg-slate-300'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.isPalletCharge ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <AnimatePresence>
            {config.isPalletCharge && (
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
                      {freightRates.filter(r => r.origin === config.origin).map(r => (
                        <option key={r.id} value={r.destination}>{r.destination}</option>
                      ))}
                    </select>
                  </div>
                  <InputField label="Total Freight Cost (CAD)" value={calculations.freightCost} onChange={(v) => handleInputChange('freightCostTotalCad', v)} />
                  <InputField label="Volume per Load (MT)" value={config.volumePerLoadMt} onChange={(v) => handleInputChange('volumePerLoadMt', v)} />
                  <InputField label="Delivered Freight per MT (CAD)" value={calculations.deliveredFreight} onChange={(v) => handleInputChange('deliveredFreightCadMt', v)} />
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
                <DataRow label={`Pallet Charge (${calculations.currencySymbol}/MT)`} value={`${calculations.palletCharge.toFixed(2)}`} />
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
      {/* Hidden File Input for CSV Import */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImportCSV} 
        accept=".csv" 
        className="hidden" 
      />

      {/* Sidebar */}
      <aside className="w-64 border-r border-[#141414] bg-white/50 backdrop-blur-sm flex flex-col sticky top-0 h-screen z-50 print:hidden">
        <div className="p-6 border-b border-[#141414] flex items-center gap-3">
          <div className="bg-[#141414] text-[#E4E3E0] p-1.5">
            <TrendingUp size={20} />
          </div>
          <h1 className="text-sm font-bold uppercase tracking-tighter leading-none">Sweet<br/>Pro</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.name}
              onClick={() => setActivePage(item.name)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-bold uppercase transition-all border ${
                activePage === item.name 
                  ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,0.2)]' 
                  : 'bg-transparent text-[#141414] border-transparent hover:border-[#141414]/20'
              }`}
            >
              <item.icon size={16} />
              {item.name}
            </button>
          ))}
        </nav>

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
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
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

      {/* Modals */}
      <AnimatePresence>
        {showContractConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
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
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-2">
                  <div className="flex justify-between text-[10px] uppercase font-bold opacity-50">
                    <span>Volume</span>
                    <span>Price</span>
                  </div>
                  <div className="flex justify-between text-sm font-black">
                    <span>{config.volumeMt} MT</span>
                    <span>{config.currency} ${calculations.finalMt.toFixed(2)}/MT</span>
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
        )}

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
                                      setShipmentCreationData({ location: loc as 'Hamilton' | 'Vancouver', date: '', time: '', bay: '', carrier: '', orderId: o.id });
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
                                            setShipmentCreationData({ location: loc as 'Hamilton' | 'Vancouver', date: '', time: '', bay: '', carrier: '', orderId: o.id });
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
                          {timeSlotsList.map(t => <option key={t} value={t}>{t}</option>)}
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
                          value={editingShipment.status || 'Pending'}
                          onChange={(e) => setEditingShipment({...editingShipment, status: e.target.value})}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none"
                        >
                          <option value="Pending">Pending</option>
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <select 
                      value={newFreightRate.provider} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Provider</option>
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
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="number" 
                      value={newFreightRate.cost} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT / Load</label>
                    <input 
                      type="number" 
                      value={newFreightRate.mtPerLoad} 
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <input 
                      type="text" 
                      value={editingContract.customerName} 
                      onChange={(e) => setEditingContract({ ...editingContract, customerName: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Volume (MT)</label>
                    <input 
                      type="number" 
                      value={editingContract.contractVolume} 
                      onChange={(e) => setEditingContract({ ...editingContract, contractVolume: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Final Price</label>
                    <input 
                      type="number" 
                      value={editingContract.finalPrice} 
                      onChange={(e) => setEditingContract({ ...editingContract, finalPrice: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Start Date</label>
                    <input 
                      type="date" 
                      value={editingContract.startDate} 
                      onChange={(e) => setEditingContract({ ...editingContract, startDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">End Date</label>
                    <input 
                      type="date" 
                      value={editingContract.endDate} 
                      onChange={(e) => setEditingContract({ ...editingContract, endDate: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
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

        {editingFreightRate && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <select 
                      value={editingFreightRate.provider} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="">Select Provider</option>
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
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="number" 
                      value={editingFreightRate.cost} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, cost: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT / Load</label>
                    <input 
                      type="number" 
                      value={editingFreightRate.mtPerLoad} 
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

        {isAddingCustomer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                      type="number"
                      value={newCustomer.defaultMargin}
                      onChange={(e) => setNewCustomer({ ...newCustomer, defaultMargin: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
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
                    disabled={!newProductGroup.name}
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                      type="number" 
                      value={newSku.netWeightKg || ''} 
                      onChange={(e) => setNewSku({ ...newSku, netWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (kg)</label>
                    <input 
                      type="number" 
                      value={newSku.grossWeightKg || ''} 
                      onChange={(e) => setNewSku({ ...newSku, grossWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                    <input 
                      type="number" 
                      value={newSku.brix} 
                      onChange={(e) => setNewSku({ ...newSku, brix: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Max Color</label>
                    <input 
                      type="number" 
                      value={newSku.maxColor} 
                      onChange={(e) => setNewSku({ ...newSku, maxColor: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Differential (CAD/MT)</label>
                    <input 
                      type="number" 
                      value={newSku.premiumCadMt} 
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                      type="number"
                      value={editingCustomer.defaultMargin}
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Product: {editingSku.id}</h3>
                <button onClick={() => setEditingSku(null)} className="hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Name</label>
                    <input 
                      type="text" 
                      value={editingSku.name} 
                      onChange={(e) => setEditingSku({ ...editingSku, name: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Product Group</label>
                    <select 
                      value={editingSku.productGroup} 
                      onChange={(e) => setEditingSku({ ...editingSku, productGroup: e.target.value })}
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
                      value={editingSku.category} 
                      onChange={(e) => setEditingSku({ ...editingSku, category: e.target.value as any })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Conventional">Conventional</option>
                      <option value="Organic">Organic</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Location</label>
                    <select 
                      value={editingSku.location} 
                      onChange={(e) => setEditingSku({ ...editingSku, location: e.target.value as 'Hamilton' | 'Vancouver' })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    >
                      <option value="Hamilton">Hamilton</option>
                      <option value="Vancouver">Vancouver</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Net Weight (kg)</label>
                    <input 
                      type="number" 
                      value={editingSku.netWeightKg || ''} 
                      onChange={(e) => setEditingSku({ ...editingSku, netWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Gross Weight (kg)</label>
                    <input 
                      type="number" 
                      value={editingSku.grossWeightKg || ''} 
                      onChange={(e) => setEditingSku({ ...editingSku, grossWeightKg: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Brix</label>
                    <input 
                      type="number" 
                      value={editingSku.brix} 
                      onChange={(e) => setEditingSku({ ...editingSku, brix: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Max Color</label>
                    <input 
                      type="number" 
                      value={editingSku.maxColor} 
                      onChange={(e) => setEditingSku({ ...editingSku, maxColor: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Default Differential (CAD/MT)</label>
                    <input 
                      type="number" 
                      value={editingSku.premiumCadMt} 
                      onChange={(e) => setEditingSku({ ...editingSku, premiumCadMt: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Product Description</label>
                  <textarea 
                    value={editingSku.description || ''} 
                    onChange={(e) => setEditingSku({ ...editingSku, description: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-32 resize-none focus:bg-white transition-colors outline-none"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      setSkus(skus.map(s => s.id === editingSku.id ? editingSku : s));
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <input 
                      type="text" 
                      value={newFreightRate.provider} 
                      onChange={(e) => setNewFreightRate({ ...newFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="number" 
                      value={newFreightRate.cost} 
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
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT per Load</label>
                    <input 
                      type="number" 
                      value={newFreightRate.mtPerLoad} 
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <label className="text-[10px] uppercase font-bold opacity-50">Provider</label>
                    <input 
                      type="text" 
                      value={editingFreightRate.provider} 
                      onChange={(e) => setEditingFreightRate({ ...editingFreightRate, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Cost (CAD)</label>
                    <input 
                      type="number" 
                      value={editingFreightRate.cost} 
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
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">MT per Load</label>
                    <input 
                      type="number" 
                      value={editingFreightRate.mtPerLoad} 
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                      type="number" 
                      value={newSupplyChain.totalCostCad} 
                      onChange={(e) => setNewSupplyChain({ ...newSupplyChain, totalCostCad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Weight Per Load (MT)</label>
                    <input 
                      type="number" 
                      value={newSupplyChain.weightPerLoadMt} 
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                    <input 
                      type="text" 
                      value={editingSupplyChain.provider} 
                      onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, provider: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Total Cost (CAD)</label>
                    <input 
                      type="number" 
                      value={editingSupplyChain.totalCostCad} 
                      onChange={(e) => setEditingSupplyChain({ ...editingSupplyChain, totalCostCad: parseFloat(e.target.value) || 0 })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Weight Per Load (MT)</label>
                    <input 
                      type="number" 
                      value={editingSupplyChain.weightPerLoadMt} 
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
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md">
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
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-[#141414]/20 backdrop-blur-sm">
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
          <div className="fixed inset-0 z-[700] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-sm" onClick={() => setContractInvoicePopup(null)}>
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
                <button onClick={() => { setIsAddingOrder(false); setEditingOrder(null); setOrderLineItems([]); setOrderCustomerId(''); setOrderPO(''); setOrderShipmentDate(''); setOrderDeliveryDate(''); setOrderCarrier(''); }} className="hover:rotate-90 transition-transform">
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
                  </div>
                  <div className="grid grid-cols-2 gap-6">
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
                  </div>
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
                        type="number"
                        value={newLineItem.qty}
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
                          const totalWeight = newLineItem.qty * product.netWeight;
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
                          const unitAmount = mtAmount * product.netWeight;
                          const lineAmount = totalWeight * mtAmount;
                          const lineItem: OrderLineItem = {
                            id: `LINEITEM-${Date.now()}-${Math.random()}`,
                            productName: newLineItem.productName,
                            qty: newLineItem.qty,
                            contractNumber: newLineItem.contractNumber,
                            netWeightPerUnit: product.netWeight,
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
                    <div className="grid grid-cols-6 gap-3 text-center">
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

                {/* Create Order Button */}
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      if (!orderCustomerId || orderLineItems.length === 0 || !orderPO) {
                        setErrorBox('Please select customer, add line items, and enter PO number');
                        return;
                      }
                      const totalAmount = orderLineItems.reduce((sum, item) => sum + (item.lineAmount || 0), 0);
                      const contractNumbers = [...new Set(orderLineItems.map(li => li.contractNumber).filter(Boolean))];
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
                        carrier: orderCarrier || undefined
                      };
                      setOrders([...orders, newOrder]);
                      setIsAddingOrder(false);
                      setOrderLineItems([]);
                      setOrderCustomerId('');
                      setOrderPO('');
                      setOrderShipmentDate('');
                      setOrderDeliveryDate('');
                      setOrderCarrier('');
                    }}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Create Order
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingOrder(false);
                      setOrderLineItems([]);
                      setOrderCustomerId('');
                      setOrderPO('');
                      setOrderShipmentDate('');
                      setOrderDeliveryDate('');
                      setOrderCarrier('');
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
                  const totalWeightMT = product ? totalUnits * product.netWeight : 0;
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
                              let defaultCarrierName = '';
                              if (selectedCust?.defaultCarrierCode) {
                                const dc = carriers.find(c => c.carrierNumber === selectedCust.defaultCarrierCode || c.name === selectedCust.defaultCarrierCode);
                                if (dc) defaultCarrierName = dc.name;
                              }
                              // Auto-fill carrier on all existing entries
                              const updatedEntries = batchOrder.entries.map(entry => ({
                                ...entry,
                                carrier: entry.carrier || defaultCarrierName
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
                        <div className="bg-blue-50 border border-blue-200 p-3 grid grid-cols-4 gap-3">
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
                            <div className="text-[10px] uppercase font-bold text-blue-600 mb-0.5">Batch Total Weight</div>
                            <div className={`text-xs font-bold ${totalWeightMT > selectedContract.volumeOutstanding ? 'text-red-600' : ''}`}>
                              {(totalWeightMT * 1000).toFixed(0)} KG ({totalWeightMT.toFixed(2)} MT)
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
                              let defaultCarrierName = '';
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
                                const entryWeightMT = product ? entry.qty * product.netWeight : 0;
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
                                        type="number"
                                        value={entry.qty}
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
                      <div className="bg-[#F5F5F5] p-3 border border-[#141414]/10 grid grid-cols-4 gap-3">
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
                          <div className="text-sm font-bold">{(totalWeightMT * 1000).toFixed(0)}</div>
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
                            const newOrders: Order[] = batchOrder.entries.map((entry) => {
                              const entryWeightMT = entry.qty * product.netWeight;
                              const entryAmount = entryWeightMT * mtRate;
                              const lineItem: OrderLineItem = {
                                id: `LINEITEM-${Date.now()}-${Math.random()}`,
                                productName: batchOrder.product,
                                qty: entry.qty,
                                contractNumber: batchOrder.contractNumber,
                                netWeightPerUnit: product.netWeight,
                                totalWeight: entryWeightMT,
                                unitAmount: mtRate * product.netWeight,
                                mtAmount: mtRate,
                                lineAmount: entryAmount
                              };
                              return {
                                id: `ORD-${Date.now()}-${Math.random()}`,
                                bolNumber: generateBOLNumber([lineItem]),
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
                                carrier: entry.carrier
                              };
                            });
                            setOrders([...orders, ...newOrders]);
                            setIsAddingBatchOrder(false);
                            setBatchOrder({
                              customer: '',
                              product: '',
                              contractNumber: '',
                              entries: [{ shipmentDate: '', deliveryDate: '', po: '', bol: '', qty: 22, carrier: '', amount: 0 }]
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

        {/* Order Confirmation Dialog */}
        {showOrderConfirmation && pendingStatusChange && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center p-6 bg-[#141414]/90 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
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
                  return (
                    <>
                      <p className="text-sm leading-relaxed">
                        Are you sure you want to confirm this order? This will lock the order details and prepare it for scheduling into shipments.
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
                      </div>
                      <div className="flex gap-4">
                        <button
                          onClick={() => {
                            setOrders(orders.map(o => o.id === pendingStatusChange.orderId ? { ...o, status: 'Confirmed' } : o));
                            setShowOrderConfirmation(false);
                            setPendingStatusChange(null);
                          }}
                          className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 size={16} /> Confirm Status
                        </button>
                        <button
                          onClick={() => {
                            setShowOrderConfirmation(false);
                            setPendingStatusChange(null);
                          }}
                          className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
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
                  if (!order && !transfer) return null;
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
                  const availableTimeSlots = timeSlotsList.filter(t => isSlotAvailable(t));

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
                              {timeSlotsList.map(slot => {
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
                                status: 'Pending',
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
                                status: 'Pending',
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

      {/* Add New Transfer Modal */}
      {isAddingTransfer && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
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
                  const t: Transfer = {
                    id: `TRF-${Date.now()}`,
                    transferNumber: `TRF-${new Date().getFullYear()}-${String(transfers.length + 1).padStart(3, '0')}`,
                    from: data.get('from') as string,
                    to: data.get('to') as string,
                    product: data.get('product') as string,
                    lotCode: data.get('lotCode') as string || '',
                    amount: parseFloat(data.get('amount') as string) || 0,
                    carrier: data.get('carrier') as string,
                    shipmentDate: data.get('shipmentDate') as string,
                    arrivalDate: data.get('arrivalDate') as string,
                    notes: data.get('notes') as string || '',
                    status: 'Pending'
                  };
                  setTransfers([...transfers, t]);
                  setIsAddingTransfer(false);
                }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">From</label>
                      <select name="from" defaultValue="Hamilton" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">To</label>
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
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Amount (MT)</label>
                      <input name="amount" type="number" step="0.01" defaultValue={22} required className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Lot Code</label>
                      <input name="lotCode" type="text" placeholder="e.g. LOT-2026-001" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                      <select name="carrier" required className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                        <option value="">Select Carrier</option>
                        {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
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
        )}

        {/* Edit Transfer Modal */}
        {editingTransfer && !isAddingTransfer && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/60 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Transfer — {editingTransfer.transferNumber}</h3>
                <button onClick={() => setEditingTransfer(null)} className="hover:rotate-90 transition-transform"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">From</label>
                    <select value={editingTransfer.from} onChange={(e) => setEditingTransfer({...editingTransfer, from: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">To</label>
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
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Amount (MT)</label>
                    <input type="number" step="0.01" value={editingTransfer.amount} onChange={(e) => setEditingTransfer({...editingTransfer, amount: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Lot Code</label>
                    <input type="text" value={editingTransfer.lotCode || ''} onChange={(e) => setEditingTransfer({...editingTransfer, lotCode: e.target.value})} placeholder="e.g. LOT-2026-001" className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-60">Carrier</label>
                    <select value={editingTransfer.carrier} onChange={(e) => setEditingTransfer({...editingTransfer, carrier: e.target.value})} className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">Select Carrier</option>
                      {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                  </div>
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
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => {
                      setTransfers(transfers.map(t => t.id === editingTransfer.id ? editingTransfer : t));
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
        )}

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

function InputField({ label, value, onChange, step = "0.01" }: { label: string, value: number, onChange: (v: string) => void, step?: string }) {
  const isCurrency = label.includes('CAD') || label.includes('USD');
  const displayValue = isCurrency ? Number(value ?? 0).toFixed(2) : (value ?? '');

  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase font-bold opacity-60">{label}</label>
      <input 
        type="number" 
        step={step}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:bg-white transition-colors outline-none"
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
