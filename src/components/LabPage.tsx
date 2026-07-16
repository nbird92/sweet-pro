import React, { useState, useMemo, useRef } from 'react';
import { LotCode, SugarType, Person, ProductGroup, Shipment, Transfer } from '../types';
import { Plus, X, Trash2, Search, Upload, Download, FlaskConical, ShieldAlert, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageBanner from './PageBanner';
import DataTable from './DataTable';
import type { SheetSpec } from '../utils/exportExcel';

interface LabPageProps {
  lotCodes: LotCode[];
  sugarTypes: SugarType[];
  people: Person[];
  productGroups: ProductGroup[];
  shipments: Shipment[];
  transfers: Transfer[];
  onUpdateLotCodes: (lotCodes: LotCode[]) => void;
  onUpdateShipments: (shipments: Shipment[]) => void;
  /** Opens the shared Google-Sheets sync modal in lot-code mode. */
  onSyncLotCodes?: () => void;
}

const EMPTY_FORM = {
  lotNumber: '', tankNumber: '', date: '', julianDate: '',
  category: '' as 'Conventional' | 'Organic' | '',
  productGroup: '', silo: '' as 'North' | 'South' | '',
  brix: '', ph: '', color: '', temperature: '',
  invert: '', ash: '', moisture: '', flavourOdourOk: '' as 'Yes' | 'No' | '',
  testerId: '', testerName: '', notes: '',
  weeklyVerification: '', sugarType: '', countryOfOrigin: '',
  bolNumber: '', customerPo: '',
  // Granulated loading-log fields.
  customerName: '', qtyMt: '', exitTime: '', loadedFrom: '', sugarUsed: '',
  colorConfirmedCoa: '', moistureConfirmedCoa: '', sucrose: '',
  foreignMaterial: '', sievingResults: '', initials: '',
};

// Get Julian day of the year (1-366) from a date string YYYY-MM-DD
function getJulianDay(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const day = Math.floor(diff / oneDay);
  return String(day).padStart(3, '0');
}

// Generate lot code: HS-[sugarType][productGroup][orgConv][YY][JJJ][silo]
function generateLotCode(form: typeof EMPTY_FORM): string {
  const plant = 'HS';
  const sugarTypeMap: Record<string, string> = {
    'Granulated': 'R', 'Liquid': 'L', 'Molasses': 'M',
    'Icing': 'I', 'Brown': 'B', 'Yellow': 'Y',
  };
  const sugarCode = sugarTypeMap[form.sugarType] || '?';
  const pg = form.productGroup.toLowerCase();
  let pgCode = '00';
  if (pg.includes('tote')) {
    pgCode = '10';
  } else if (pg.includes('pack') || pg.includes('bag')) {
    pgCode = '50';
  }
  const catCode = form.category === 'Organic' ? 'B' : form.category === 'Conventional' ? 'C' : '?';
  let yy = '??';
  if (form.date) { yy = form.date.slice(2, 4); }
  const jjj = form.julianDate || '???';
  const siloCode = form.silo === 'North' ? 'N' : form.silo === 'South' ? 'S' : '';
  return `${plant}-${sugarCode}${pgCode}${catCode}${yy}${jjj}${siloCode}`;
}

export default function LabPage({ lotCodes, sugarTypes, people, productGroups, shipments, transfers, onUpdateLotCodes, onUpdateShipments, onSyncLotCodes }: LabPageProps) {
  const [filterSugarType, setFilterSugarType] = useState('Granulated');
  const [isAdding, setIsAdding] = useState(false);
  const [editingLot, setEditingLot] = useState<LotCode | null>(null);
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [showShipmentPicker, setShowShipmentPicker] = useState(false);
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [pickerTab, setPickerTab] = useState<'shipments' | 'transfers'>('shipments');
  const csvInputRef = useRef<HTMLInputElement>(null);

  const qaPeople = people.filter(p => p.department === 'QA');

  const filtered = filterSugarType
    ? lotCodes.filter(lc => lc.sugarType === filterSugarType)
    : lotCodes;

  // Filter shipments for the search picker
  const filteredShipments = useMemo(() => {
    if (!shipmentSearch.trim()) return shipments;
    const q = shipmentSearch.toLowerCase();
    return shipments.filter(s =>
      (s.bol || '').toLowerCase().includes(q) ||
      (s.po || '').toLowerCase().includes(q) ||
      (s.customer || '').toLowerCase().includes(q) ||
      (s.product || '').toLowerCase().includes(q) ||
      (s.carrier || '').toLowerCase().includes(q) ||
      (s.date || '').toLowerCase().includes(q) ||
      (s.status || '').toLowerCase().includes(q)
    );
  }, [shipments, shipmentSearch]);

  const filteredTransfers = useMemo(() => {
    if (!shipmentSearch.trim()) return transfers;
    const q = shipmentSearch.toLowerCase();
    return transfers.filter(t =>
      (t.transferNumber || '').toLowerCase().includes(q) ||
      (t.from || '').toLowerCase().includes(q) ||
      (t.to || '').toLowerCase().includes(q) ||
      (t.product || '').toLowerCase().includes(q) ||
      (t.carrier || '').toLowerCase().includes(q) ||
      (t.shipmentDate || '').toLowerCase().includes(q) ||
      (t.lotCode || '').toLowerCase().includes(q) ||
      (t.status || '').toLowerCase().includes(q)
    );
  }, [transfers, shipmentSearch]);

  const handleSelectTransfer = (t: Transfer) => {
    setFormData({ ...formData, bolNumber: t.transferNumber || '', customerPo: t.lotCode || '' });
    setShowShipmentPicker(false);
    setShipmentSearch('');
  };

  // CSV Import
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Strip UTF-8 BOM, normalise line endings
      const text = (ev.target?.result as string || '')
        .replace(/^﻿/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      if (!text) return;

      // Auto-detect delimiter from the first non-empty line
      const firstLine = text.split('\n').find(l => l.trim()) || '';
      const tabs   = (firstLine.match(/\t/g)  || []).length;
      const semis  = (firstLine.match(/;/g)   || []).length;
      const commas = (firstLine.match(/,/g)   || []).length;
      const delim  = tabs > commas && tabs > semis ? '\t'
                   : semis > commas ? ';'
                   : ',';

      // RFC 4180-compliant parser for comma-delimited; plain split for others
      const parseLine = (line: string): string[] => {
        if (delim !== ',') {
          return line.split(delim).map(v => v.trim().replace(/^"|"$/g, ''));
        }
        const fields: string[] = [];
        let i = 0;
        while (i <= line.length) {
          if (i === line.length) { fields.push(''); break; }
          if (line[i] === '"') {
            let value = '';
            i++;
            while (i < line.length) {
              if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; }
              else if (line[i] === '"') { i++; break; }
              else { value += line[i++]; }
            }
            fields.push(value.trim());
            if (i < line.length && line[i] === ',') i++;
          } else {
            const end = line.indexOf(',', i);
            if (end === -1) { fields.push(line.slice(i).trim()); break; }
            fields.push(line.slice(i, end).trim());
            i = end + 1;
          }
        }
        return fields;
      };

      // Keywords used to identify a header row vs a title/data row
      const HEADER_KEYS = new Set([
        'lot','lotnumber','lotcode','lotno','lotnum',
        'date','brix','ph','color','colour',
        'tanknumber','tank','tankno',
        'sugartype','sugar',
        'temperature','temp','tempc',
        'invert','tester','testername',
        'notes','weeklyverification',
        'category','productgroup','silo',
        'bolnumber','bol','customerpo','countryoforigin',
      ]);
      const isHeaderRow = (cells: string[]) =>
        cells.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(h => HEADER_KEYS.has(h)).length >= 3;

      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { alert('File is empty or has only one row.'); return; }

      // Find the actual header row (first within 8 rows matching ≥3 known column keywords)
      let headerRowIdx = 0;
      for (let r = 0; r < Math.min(lines.length, 8); r++) {
        if (isHeaderRow(parseLine(lines[r]))) { headerRowIdx = r; break; }
      }

      // currentHeaders switches whenever a new header row appears mid-file
      // (handles CSVs with multiple table sections that have different column layouts)
      let currentHeaders = parseLine(lines[headerRowIdx]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      const newLots: LotCode[] = [];
      let skipped = 0;

      for (let i = headerRowIdx + 1; i < lines.length; i++) {
        const vals = parseLine(lines[i]);
        if (isHeaderRow(vals)) {
          // New section with different columns — adopt its headers
          currentHeaders = vals.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
          continue;
        }
        const row: Record<string, string> = {};
        currentHeaders.forEach((h, idx) => { row[h] = vals[idx] || ''; });

        const lotNumber = row['lotnumber'] || row['lotcode'] || row['lot'] || row['lotno'] || row['lotnum'] || '';
        const date      = row['date'] || '';
        if (!lotNumber && !date) { skipped++; continue; } // blank/filler row

        newLots.push({
          id: `LOT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}-${i}`,
          lotNumber,
          tankNumber:         row['tanknumber'] || row['tank'] || row['tankno'] || '',
          date,
          julianDate:         row['juliandate'] || (date ? getJulianDay(date) : ''),
          category:           (row['category'] === 'Organic' ? 'Organic' : row['category'] === 'Conventional' ? 'Conventional' : '') as LotCode['category'],
          productGroup:       row['productgroup'] || '',
          silo:               (row['silo'] === 'North' ? 'North' : row['silo'] === 'South' ? 'South' : '') as LotCode['silo'],
          brix:               row['brix'] || '',
          ph:                 row['ph'] || '',
          color:              row['color'] || row['colour'] || '',
          temperature:        row['temperature'] || row['temp'] || row['tempc'] || '',
          invert:             row['invert'] || '',
          ash:                row['ash'] || '',
          moisture:           row['moisture'] || '',
          flavourOdourOk:     (row['flavourodourok'] === 'Yes' ? 'Yes' : row['flavourodourok'] === 'No' ? 'No' : '') as LotCode['flavourOdourOk'],
          testerId:           row['testerid'] || '',
          testerName:         row['testername'] || row['tester'] || '',
          notes:              row['notes'] || '',
          weeklyVerification: row['weeklyverification'] || '',
          sugarType:          row['sugartype'] || '',
          countryOfOrigin:    row['countryoforigin'] || row['origin'] || '',
          bolNumber:          row['bolnumber'] || row['bol'] || '',
          customerPo:         row['customerpo'] || row['po'] || '',
          createdAt:          new Date().toISOString(),
        });
      }

      // --- Diagnostic alert (always shown so column mapping is visible) ---
      const firstImported = newLots[0];
      const diagLines = [
        `Delimiter detected: ${delim === '\t' ? 'TAB' : delim === ';' ? 'SEMICOLON' : 'COMMA'}`,
        `Header row found at line ${headerRowIdx + 1}`,
        `Columns mapped (first section): ${currentHeaders.filter(Boolean).join(' | ')}`,
        '',
        newLots.length > 0
          ? `✓ ${newLots.length} lot code${newLots.length > 1 ? 's' : ''} imported${skipped ? `, ${skipped} rows skipped` : ''}`
          : `✗ No lot codes imported${skipped ? ` (${skipped} rows skipped)` : ''}`,
        '',
        firstImported
          ? `First row: LotNumber="${firstImported.lotNumber}" | Tank="${firstImported.tankNumber}" | Date="${firstImported.date}" | Sugar="${firstImported.sugarType}"`
          : '(no data rows found)',
      ];
      if (newLots.length > 0) onUpdateLotCodes([...lotCodes, ...newLots]);
      alert(diagLines.join('\n'));
    };
    reader.readAsText(file);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };

  const handleDownloadTemplate = () => {
    const headers = [
      'LotNumber','Date','SugarType','Category','ProductGroup','Silo',
      'CountryOfOrigin','TankNumber','Brix','PH','Color','Temperature',
      'Invert','Ash','Moisture','FlavourOdourOk','TesterName',
      'WeeklyVerification','Notes','BOLNumber','CustomerPO'
    ];
    const csvContent = headers.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lot_code_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const updateForm = (patch: Partial<typeof EMPTY_FORM>) => {
    const next = { ...formData, ...patch };
    if ('date' in patch && patch.date) {
      next.julianDate = getJulianDay(patch.date);
    }
    next.lotNumber = generateLotCode(next);
    setFormData(next);
  };

  const openAdd = () => {
    setFormData({ ...EMPTY_FORM });
    setIsAdding(true);
  };

  const openEdit = (lc: LotCode) => {
    setFormData({
      lotNumber: lc.lotNumber, tankNumber: lc.tankNumber,
      date: lc.date || '', julianDate: lc.julianDate || '',
      category: lc.category || '', productGroup: lc.productGroup || '',
      silo: lc.silo || '',
      brix: lc.brix, ph: lc.ph, color: lc.color, temperature: lc.temperature,
      invert: lc.invert, ash: lc.ash || '', moisture: lc.moisture || '', flavourOdourOk: lc.flavourOdourOk,
      testerId: lc.testerId, testerName: lc.testerName,
      notes: lc.notes, weeklyVerification: lc.weeklyVerification, sugarType: lc.sugarType, countryOfOrigin: lc.countryOfOrigin || '',
      bolNumber: lc.bolNumber || '', customerPo: lc.customerPo || '',
      customerName: lc.customerName || '', qtyMt: lc.qtyMt || '', exitTime: lc.exitTime || '',
      loadedFrom: lc.loadedFrom || '', sugarUsed: lc.sugarUsed || '',
      colorConfirmedCoa: lc.colorConfirmedCoa || '', moistureConfirmedCoa: lc.moistureConfirmedCoa || '',
      sucrose: lc.sucrose || '', foreignMaterial: lc.foreignMaterial || '', sievingResults: lc.sievingResults || '',
      initials: lc.initials || '',
    });
    setEditingLot(lc);
  };

  // Auto-assign lot code to shipment when BOL/PO is filled
  const autoAssignToShipment = (lotNum: string, bolNumber: string, customerPo: string, countryOfOrigin: string) => {
    if (!bolNumber && !customerPo) return;
    // Find matching shipment by BOL or PO
    const match = shipments.find(s =>
      (bolNumber && s.bol && s.bol === bolNumber) ||
      (customerPo && s.po && s.po === customerPo)
    );
    if (match) {
      const currentLotNums = match.lotNumbers || (match.lotNumber ? [match.lotNumber] : []);
      if (!currentLotNums.includes(lotNum)) {
        const updatedLotNums = [...currentLotNums, lotNum];
        // Also update origin of goods from lot code country of origin
        const existingOrigins = match.originOfGoods ? match.originOfGoods.split(', ').filter(Boolean) : [];
        if (countryOfOrigin && !existingOrigins.includes(countryOfOrigin)) {
          existingOrigins.push(countryOfOrigin);
        }
        const updatedShipments = shipments.map(s =>
          s.id === match.id
            ? { ...s, lotNumbers: updatedLotNums, lotNumber: updatedLotNums[0] || '', originOfGoods: existingOrigins.join(', ') }
            : s
        );
        onUpdateShipments(updatedShipments);
      }
    }
  };

  const handleSave = () => {
    if (editingLot) {
      const updated = { ...editingLot, ...formData };
      onUpdateLotCodes(lotCodes.map(lc => lc.id === editingLot.id ? updated : lc));
      autoAssignToShipment(updated.lotNumber, updated.bolNumber, updated.customerPo, updated.countryOfOrigin);
      setEditingLot(null);
    } else {
      const newLot: LotCode = {
        ...formData,
        id: `LOT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        createdAt: new Date().toISOString(),
      } as LotCode;
      onUpdateLotCodes([...lotCodes, newLot]);
      autoAssignToShipment(newLot.lotNumber, newLot.bolNumber, newLot.customerPo, newLot.countryOfOrigin);
      setIsAdding(false);
    }
  };

  const handleDelete = (id: string) => {
    onUpdateLotCodes(lotCodes.filter(lc => lc.id !== id));
  };

  const handleSelectShipment = (s: Shipment) => {
    setFormData({ ...formData, bolNumber: s.bol || '', customerPo: s.po || '' });
    setShowShipmentPicker(false);
    setShipmentSearch('');
  };

  const isOpen = isAdding || !!editingLot;
  const modalTitle = editingLot ? 'Edit Lot Code' : 'Add New Lot Code';

  const labExportSheets = (): SheetSpec[] => [{
    sheetName: 'Lot Code Testing Log',
    title: 'Hamilton Lab — Lot Code Testing Log',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${lotCodes.length} lot codes`,
    columns: [
      { header: 'Lot #', key: 'lotNumber' },
      { header: 'Date', key: 'date' },
      { header: 'BOL #', key: 'bolNumber' },
      { header: 'Tank #', key: 'tankNumber' },
      { header: 'Sugar Type', key: 'sugarType' },
      { header: 'Brix', key: 'brix', format: 'number' },
      { header: 'PH', key: 'ph', format: 'number' },
      { header: 'Color', key: 'color' },
      { header: 'Temp °C', key: 'temperature', format: 'number' },
      { header: 'Invert', key: 'invert' },
      { header: 'Flavour/Odour OK', key: 'flavourOdourOk' },
      { header: 'Tester', key: 'testerName' },
      { header: 'Notes', key: 'notes' },
      { header: 'Weekly Verification', key: 'weeklyVerification' },
    ],
    rows: filtered as any[],
  }];
  return (
    <div>
      <PageBanner
        icon={<FlaskConical size={18} />}
        title="Hamilton Lab"
        count={filtered.length}
        exportSheets={labExportSheets}
        exportFileName="Hamilton_Lab"
      >
        <input ref={csvInputRef} type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
        <div className="px-4 py-2 flex items-center gap-2">
          <label className="text-[10px] uppercase font-bold text-[#E4E3E0]/60 whitespace-nowrap">Sugar Type</label>
          <select
            value={filterSugarType}
            onChange={(e) => setFilterSugarType(e.target.value)}
            className="bg-[#2a2a2a] text-[#E4E3E0] border border-[#E4E3E0]/20 px-2 py-1 text-xs focus:outline-none"
          >
            {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
          </select>
        </div>
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap"
        >
          <Download size={12} /> Template
        </button>
        <button
          onClick={() => csvInputRef.current?.click()}
          className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap"
        >
          <Upload size={12} /> Import CSV
        </button>
        {onSyncLotCodes && (
          <button
            onClick={onSyncLotCodes}
            className="px-4 py-2 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/10 transition-all whitespace-nowrap"
          >
            <FileText size={12} /> Sync Lot Codes
          </button>
        )}
        <button
          onClick={openAdd}
          className="px-4 py-2 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-white/20 transition-all whitespace-nowrap"
        >
          <Plus size={12} /> + Add Lot Code
        </button>
        <button
          onClick={() => setClearAllConfirm(true)}
          className="px-4 py-2 text-red-400 text-[10px] font-bold uppercase flex items-center gap-1.5 hover:bg-red-500/20 transition-all whitespace-nowrap"
        >
          <ShieldAlert size={12} /> Clear All
        </button>
      </PageBanner>
    <div className="p-6 space-y-4">

      {/* Lot Code Testing Log — standardized DataTable. The Add button stays
          in the PageBanner (alongside Template / Import / Clear All) so the
          DataTable header has no onAdd. Row click opens the existing edit
          modal; Delete now lives in the modal footer instead of inline rows. */}
      <DataTable<LotCode>
        title="Lot Code Testing Log"
        storageKey={filterSugarType === 'Granulated' ? 'Lot Code Testing Log (Granulated)' : 'Lot Code Testing Log'}
        columns={filterSugarType === 'Granulated' ? [
          // Granulated loading-log column set — mirrors the "Granulated Loads 2026"
          // sheet's columns, in order.
          { key: 'date', label: 'Date' },
          { key: 'customerPo', label: 'PO #', mono: true, render: (lc) => lc.customerPo || '—' },
          { key: 'bolNumber', label: 'BOL #', mono: true, render: (lc) => lc.bolNumber || '—' },
          { key: 'customerName', label: 'Customer', render: (lc) => lc.customerName || '—' },
          { key: 'qtyMt', label: 'QTY MT', render: (lc) => lc.qtyMt || '—' },
          { key: 'exitTime', label: 'Exit Time', render: (lc) => lc.exitTime || '—' },
          { key: 'lotNumber', label: 'Lot #', mono: true, bold: true, widthClass: 'min-w-[120px]' },
          { key: 'loadedFrom', label: 'Loaded From', render: (lc) => lc.loadedFrom || '—' },
          { key: 'sugarUsed', label: 'Sugar Used', render: (lc) => lc.sugarUsed || '—' },
          { key: 'temperature', label: 'Temperature' },
          { key: 'moisture', label: 'Moisture %', render: (lc) => lc.moisture || '—' },
          { key: 'color', label: 'Color ICUMSA', render: (lc) => lc.color || '—' },
          { key: 'colorConfirmedCoa', label: 'Color confirmed on COA %', render: (lc) => lc.colorConfirmedCoa || '—' },
          { key: 'invert', label: 'Invert %' },
          { key: 'moistureConfirmedCoa', label: 'Moisture Confirmed on COA %', render: (lc) => lc.moistureConfirmedCoa || '—' },
          { key: 'ash', label: 'Ash %', render: (lc) => lc.ash || '—' },
          { key: 'sucrose', label: 'Sucrose %', render: (lc) => lc.sucrose || '—' },
          { key: 'foreignMaterial', label: 'Foreign Material Identified Y/N', render: (lc) => lc.foreignMaterial || '—' },
          { key: 'initials', label: 'Initials', render: (lc) => lc.initials || '—' },
          {
            key: 'notes', label: 'Note',
            render: (lc) => <span title={lc.notes} className="block max-w-[150px] truncate">{lc.notes || '—'}</span>,
          },
          { key: 'sievingResults', label: 'Sieving Results', render: (lc) => lc.sievingResults || '—' },
        ] : [
          { key: 'lotNumber', label: 'Lot #', mono: true, bold: true, widthClass: 'min-w-[120px]' },
          { key: 'date', label: 'Date' },
          { key: 'bolNumber', label: 'BOL #', mono: true },
          { key: 'customerName', label: 'Customer', render: (lc) => lc.customerName || '—' },
          { key: 'tankNumber', label: 'Tank #' },
          { key: 'sugarType', label: 'Sugar Type' },
          { key: 'brix', label: 'Brix' },
          { key: 'ph', label: 'PH' },
          { key: 'color', label: 'Color' },
          { key: 'temperature', label: 'Temp °C' },
          { key: 'invert', label: 'Invert' },
          { key: 'flavourOdourOk', label: 'Flavour/Odour OK' },
          { key: 'testerName', label: 'Tester' },
          {
            key: 'notes', label: 'Notes',
            render: (lc) => <span title={lc.notes} className="block max-w-[150px] truncate">{lc.notes || '—'}</span>,
          },
          { key: 'weeklyVerification', label: 'Weekly Verification' },
        ]}
        rows={filtered}
        getRowKey={(lc) => lc.id}
        onRowClick={(lc) => openEdit(lc)}
        emptyMessage="No lot codes recorded yet."
        defaultSortKey="date"
        defaultSortDir="desc"
      />

      {/* Add / Edit Lot Code Modal */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">{modalTitle}</h3>
                <button onClick={() => { setIsAdding(false); setEditingLot(null); }} className="hover:opacity-70"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Auto-generated Lot Code preview */}
                <div className="bg-[#F5F5F5] border border-[#141414]/20 p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase font-bold opacity-50 mb-0.5">Generated Lot Code</div>
                    <div className="text-sm font-mono font-bold">{formData.lotNumber || '—'}</div>
                  </div>
                  <div className="text-[9px] opacity-40 text-right">HS-[Type][Group][Conv/Org][YY][JJJ][Silo]</div>
                </div>

                {/* BOL Number & Customer PO with Search button */}
                <div className="bg-blue-50 border border-blue-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-blue-800">Shipment Link</span>
                    <button
                      onClick={() => { setShowShipmentPicker(true); setShipmentSearch(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700 transition-all"
                    >
                      <Search size={11} /> Search Shipments / Transfers
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-50">BOL Number</label>
                      <input type="text" value={formData.bolNumber}
                        onChange={(e) => setFormData({ ...formData, bolNumber: e.target.value })}
                        className="w-full bg-white border border-blue-300 p-2 text-sm focus:outline-none focus:border-blue-500" placeholder="e.g. BOL-12345" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold opacity-50">Customer PO #</label>
                      <input type="text" value={formData.customerPo}
                        onChange={(e) => setFormData({ ...formData, customerPo: e.target.value })}
                        className="w-full bg-white border border-blue-300 p-2 text-sm focus:outline-none focus:border-blue-500" placeholder="e.g. PO-67890" />
                    </div>
                  </div>
                  {(formData.bolNumber || formData.customerPo) && (() => {
                    const matched = shipments.find(s =>
                      (formData.bolNumber && s.bol === formData.bolNumber) ||
                      (formData.customerPo && s.po === formData.customerPo)
                    );
                    return matched ? (
                      <div className="text-[10px] text-blue-700 bg-blue-100 border border-blue-200 px-2 py-1.5 flex items-center gap-2">
                        <span className="font-bold">Matched:</span>
                        <span>{matched.customer}</span>
                        <span className="opacity-50">|</span>
                        <span>{matched.product}</span>
                        <span className="opacity-50">|</span>
                        <span className="font-mono">{matched.bol}</span>
                        <span className="opacity-50">|</span>
                        <span>{matched.date}</span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1.5">
                        No matching shipment found — lot code will be saved but not auto-assigned
                      </div>
                    );
                  })()}
                </div>

                {/* Date row — stays at top in 3 cols */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Date</label>
                    <input type="date" value={formData.date}
                      onChange={(e) => updateForm({ date: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Julian Date</label>
                    <div className="bg-[#F5F5F5] border border-[#141414]/20 p-2 text-sm font-mono font-bold">{formData.julianDate || '—'}</div>
                    <p className="text-[9px] opacity-40">Auto-calculated from date</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Sugar Type</label>
                    <select value={formData.sugarType}
                      onChange={(e) => updateForm({ sugarType: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none">
                      <option value="">— Select —</option>
                      {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Two-column table layout for remaining fields */}
                <table className="w-full border-collapse border border-[#141414]/20">
                  <thead>
                    <tr className="bg-[#F5F5F5] text-[10px] uppercase tracking-widest font-bold border-b border-[#141414]/20">
                      <th className="p-2 text-left border-r border-[#141414]/10 w-1/4">Field</th>
                      <th className="p-2 text-left border-r border-[#141414]/10 w-1/4">Value</th>
                      <th className="p-2 text-left border-r border-[#141414]/10 w-1/4">Field</th>
                      <th className="p-2 text-left w-1/4">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Conventional / Organic</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <select value={formData.category} onChange={(e) => updateForm({ category: e.target.value as 'Conventional' | 'Organic' | '' })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select —</option>
                          <option value="Conventional">Conventional</option>
                          <option value="Organic">Organic</option>
                        </select>
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Product Group</td>
                      <td className="p-1.5">
                        <select value={formData.productGroup} onChange={(e) => updateForm({ productGroup: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select —</option>
                          {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                        </select>
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Silo</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <select value={formData.silo} onChange={(e) => updateForm({ silo: e.target.value as 'North' | 'South' | '' })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select —</option>
                          <option value="North">North</option>
                          <option value="South">South</option>
                        </select>
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Country of Origin</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.countryOfOrigin} onChange={(e) => updateForm({ countryOfOrigin: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. Brazil" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Tank #</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <input type="text" value={formData.tankNumber} onChange={(e) => setFormData({ ...formData, tankNumber: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="Enter tank number" />
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Brix</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.brix} onChange={(e) => setFormData({ ...formData, brix: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 99.9" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">PH</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <input type="text" value={formData.ph} onChange={(e) => setFormData({ ...formData, ph: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 7.0" />
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Color</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.color} onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 45" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Temperature °C</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <input type="text" value={formData.temperature} onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 25" />
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Invert</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.invert} onChange={(e) => setFormData({ ...formData, invert: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 0.04" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Ash</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <input type="text" value={formData.ash} onChange={(e) => setFormData({ ...formData, ash: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 0.02" />
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Moisture</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.moisture} onChange={(e) => setFormData({ ...formData, moisture: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 0.03" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Flavour/Odour OK</td>
                      <td className="p-1.5 border-r border-[#141414]/10">
                        <select value={formData.flavourOdourOk} onChange={(e) => setFormData({ ...formData, flavourOdourOk: e.target.value as 'Yes' | 'No' | '' })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select —</option>
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Tester</td>
                      <td className="p-1.5">
                        <select value={formData.testerId}
                          onChange={(e) => { const person = people.find(p => p.id === e.target.value); setFormData({ ...formData, testerId: e.target.value, testerName: person?.name || '' }); }}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select Tester —</option>
                          {qaPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Weekly Verification</td>
                      <td className="p-1.5" colSpan={3}>
                        <input type="text" value={formData.weeklyVerification} onChange={(e) => setFormData({ ...formData, weeklyVerification: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="Verification notes" />
                      </td>
                    </tr>
                  </tbody>
                </table>
                {/* Granulated loading-log fields — surfaced when the sugar type is
                    Granulated (they also feed the Granulated table column set). */}
                {formData.sugarType === 'Granulated' && (
                  <div className="border border-[#141414]/20 p-3 space-y-3">
                    <div className="text-[10px] uppercase font-bold opacity-60">Granulated Loading Log</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {([
                        ['customerName', 'Customer'],
                        ['qtyMt', 'QTY MT'],
                        ['exitTime', 'Exit Time'],
                        ['loadedFrom', 'Loaded From'],
                        ['sugarUsed', 'Sugar Used'],
                        ['colorConfirmedCoa', 'Color confirmed on COA %'],
                        ['moistureConfirmedCoa', 'Moisture Confirmed on COA %'],
                        ['sucrose', 'Sucrose %'],
                        ['foreignMaterial', 'Foreign Material Identified Y/N'],
                        ['sievingResults', 'Sieving Results'],
                        ['initials', 'Initials'],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <label className="text-[10px] uppercase font-bold opacity-50">{label}</label>
                          <input
                            type="text"
                            value={(formData as any)[key]}
                            onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                            className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-sm focus:outline-none min-h-[80px] resize-y" placeholder="Additional notes..." />
                </div>
                <div className="flex gap-4 pt-4">
                  {editingLot && (
                    <button
                      onClick={() => {
                        if (!editingLot) return;
                        if (window.confirm(`Delete lot code "${editingLot.lotNumber}"? This cannot be undone.`)) {
                          handleDelete(editingLot.id);
                          setEditingLot(null);
                        }
                      }}
                      className="px-6 py-4 border border-red-500 text-red-600 font-bold text-xs uppercase flex items-center gap-2 hover:bg-red-500 hover:text-white transition-all"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  )}
                  <button onClick={handleSave} disabled={!formData.lotNumber || formData.lotNumber.includes('?')}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all disabled:opacity-50">
                    {editingLot ? 'Save Changes' : 'Add Lot Code'}
                  </button>
                  <button onClick={() => { setIsAdding(false); setEditingLot(null); }}
                    className="flex-1 py-4 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Shipment Search Picker Modal */}
      <AnimatePresence>
        {showShipmentPicker && (
          <div className="fixed inset-0 z-[400] flex items-center-safe justify-center p-6 bg-[#141414]/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-4xl w-full overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center shrink-0">
                <h3 className="text-xs font-bold uppercase tracking-widest">Search Shipments & Transfers</h3>
                <button onClick={() => { setShowShipmentPicker(false); setShipmentSearch(''); setPickerTab('shipments'); }} className="hover:opacity-70"><X size={18} /></button>
              </div>
              {/* Tabs */}
              <div className="flex border-b border-[#141414]/10 shrink-0">
                <button
                  onClick={() => setPickerTab('shipments')}
                  className={`flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all ${pickerTab === 'shipments' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#F5F5F5] text-[#141414] hover:bg-[#E4E3E0]'}`}
                >Shipments ({filteredShipments.length})</button>
                <button
                  onClick={() => setPickerTab('transfers')}
                  className={`flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all ${pickerTab === 'transfers' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#F5F5F5] text-[#141414] hover:bg-[#E4E3E0]'}`}
                >Transfers ({filteredTransfers.length})</button>
              </div>
              <div className="p-4 border-b border-[#141414]/10 shrink-0">
                <div className="flex items-center gap-2 bg-[#F5F5F5] border border-[#141414] px-3 py-2">
                  <Search size={14} className="opacity-40" />
                  <input
                    type="text"
                    value={shipmentSearch}
                    onChange={(e) => setShipmentSearch(e.target.value)}
                    className="flex-1 bg-transparent text-sm focus:outline-none"
                    placeholder={pickerTab === 'shipments' ? 'Search by BOL, PO, customer, product, carrier, date, status...' : 'Search by transfer #, from, to, product, carrier, date...'}
                    autoFocus
                  />
                  {shipmentSearch && (
                    <button onClick={() => setShipmentSearch('')} className="opacity-40 hover:opacity-100"><X size={14} /></button>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {pickerTab === 'shipments' ? (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                      <th className="p-3 border-r border-[#141414]/10">BOL #</th>
                      <th className="p-3 border-r border-[#141414]/10">PO #</th>
                      <th className="p-3 border-r border-[#141414]/10">Customer</th>
                      <th className="p-3 border-r border-[#141414]/10">Product</th>
                      <th className="p-3 border-r border-[#141414]/10">Date</th>
                      <th className="p-3 border-r border-[#141414]/10">Carrier</th>
                      <th className="p-3 border-r border-[#141414]/10">Status</th>
                      <th className="p-3">Select</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {filteredShipments.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-xs opacity-50">No shipments match your search.</td></tr>
                    ) : filteredShipments.map(s => (
                      <tr key={s.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => handleSelectShipment(s)}>
                        <td className="p-3 text-xs font-mono font-bold border-r border-[#141414]/10">{s.bol || '—'}</td>
                        <td className="p-3 text-xs font-mono border-r border-[#141414]/10">{s.po || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{s.customer || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{s.product || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{s.date || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{s.carrier || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            (s.status || '').toLowerCase() === 'completed' ? 'bg-green-100 text-green-700' :
                            (s.status || '').toLowerCase() === 'in progress' ? 'bg-yellow-100 text-yellow-700' :
                            (s.status || '').toLowerCase() === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>{s.status || '—'}</span>
                        </td>
                        <td className="p-3 text-xs">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectShipment(s); }}
                            className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700 transition-all"
                          >Select</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0">
                    <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                      <th className="p-3 border-r border-[#141414]/10">Transfer #</th>
                      <th className="p-3 border-r border-[#141414]/10">From</th>
                      <th className="p-3 border-r border-[#141414]/10">To</th>
                      <th className="p-3 border-r border-[#141414]/10">Product</th>
                      <th className="p-3 border-r border-[#141414]/10">Amount (MT)</th>
                      <th className="p-3 border-r border-[#141414]/10">Date</th>
                      <th className="p-3 border-r border-[#141414]/10">Status</th>
                      <th className="p-3">Select</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/10">
                    {filteredTransfers.length === 0 ? (
                      <tr><td colSpan={8} className="p-8 text-center text-xs opacity-50">No transfers match your search.</td></tr>
                    ) : filteredTransfers.map(t => (
                      <tr key={t.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => handleSelectTransfer(t)}>
                        <td className="p-3 text-xs font-mono font-bold border-r border-[#141414]/10">{t.transferNumber || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{t.from || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{t.to || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{t.product || '—'}</td>
                        <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{t.amount || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{t.shipmentDate || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                            (t.status || '').toLowerCase() === 'completed' ? 'bg-green-100 text-green-700' :
                            (t.status || '').toLowerCase() === 'in transit' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>{t.status || '—'}</span>
                        </td>
                        <td className="p-3 text-xs">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectTransfer(t); }}
                            className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700 transition-all"
                          >Select</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Clear All Confirmation */}
      <AnimatePresence>
        {clearAllConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center-safe justify-center p-6 bg-[#141414]/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
            >
              <div className="bg-red-600 text-white p-4 flex items-center gap-3">
                <ShieldAlert size={20} />
                <h3 className="text-xs font-bold uppercase tracking-widest">Clear All Lot Codes</h3>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm">This will permanently delete all <span className="font-bold">{lotCodes.length}</span> lot code records. This cannot be undone.</p>
                <div className="flex gap-4">
                  <button
                    onClick={() => { onUpdateLotCodes([]); setClearAllConfirm(false); }}
                    className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-all"
                  >
                    Yes, Delete All
                  </button>
                  <button
                    onClick={() => setClearAllConfirm(false)}
                    className="flex-1 py-3 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
    </div>
  );
}
