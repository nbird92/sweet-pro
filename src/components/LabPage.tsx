import React, { useState, useMemo, useRef } from 'react';
import { LotCode, SugarType, Person, ProductGroup, Shipment, Transfer } from '../types';
import { Plus, X, Trash2, Search, Upload, Download, FlaskConical, ShieldAlert, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageBanner from './PageBanner';
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
  productGroup: '', silo: '' as 'East' | 'West' | '', loadNumber: '',
  brix: '', ph: '', color: '', temperature: '',
  invert: '', ash: '', moisture: '', flavourOdourOk: '' as 'Yes' | 'No' | '',
  testerId: '', testerName: '', notes: '',
  weeklyVerification: '', sugarType: '', countryOfOrigin: '',
  bolNumber: '', customerPo: '',
  // Loading-log fields (Liquid + Granulated).
  customerName: '', qtyMt: '', exitTime: '',
  arrivalTime: '', carrierName: '', trailerNumber: '', loaderName: '',
  loadedFrom: '', sugarUsed: '', tempLoadingBay: '', atmosphericTemp: '',
  colorConfirmedCoa: '', moistureConfirmedCoa: '', sucrose: '',
  foreignMaterial: '', sievingResults: '', sugarLumpsGrams: '', initials: '',
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

// Generate lot code: HS-[Type][Group][Conv/Org][YY][JJJ]-[Silo][loadNumber]
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
  const siloCode = form.silo === 'East' ? 'E' : form.silo === 'West' ? 'W' : '';
  const load = (form.loadNumber || '').trim();
  return `${plant}-${sugarCode}${pgCode}${catCode}${yy}${jjj}-${siloCode}${load}`;
}

// ISO-8601 week number (Monday-based) from a YYYY-MM-DD date — mirrors the
// Shipment Schedule so lot codes group into the same week buckets.
function getWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const target = new Date(date.valueOf());
  const dayNum = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const jan4 = new Date(target.getFullYear(), 0, 4);
  const jan4DayNum = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4.valueOf());
  week1Monday.setDate(jan4.getDate() - jan4DayNum);
  const diffMs = target.getTime() - week1Monday.getTime();
  return 1 + Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

const MONTH_IDX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Normalize any date shape the lot-code data carries (ISO "2026-01-27", day-first
// "29 Jan 2026", month-first "Jan 29, 2026", numeric M/D/Y) to ISO YYYY-MM-DD.
// Returns '' when unparseable.
function toIsoDate(raw?: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const build = (y: number, mo1: number, d: number): string => {
    if (!Number.isFinite(y) || !Number.isFinite(mo1) || !Number.isFinite(d)) return '';
    if (y < 1900 || mo1 < 1 || mo1 > 12 || d < 1 || d > 31) return '';
    return `${y}-${String(mo1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mo = MONTH_IDX[m[1].slice(0, 3).toLowerCase()]; if (mo !== undefined) return build(+m[3], mo + 1, +m[2]); }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m) { const mo = MONTH_IDX[m[2].slice(0, 3).toLowerCase()]; if (mo !== undefined) return build(+m[3], mo + 1, +m[1]); }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const a = +m[1], b = +m[2]; let y = +m[3]; if (y < 100) y += 2000; const swap = a > 12 && b <= 12; return build(y, swap ? b : a, swap ? a : b); }
  return '';
}

// Uniform display date — ISO when parseable, else the raw value unchanged.
function formatDisplayDate(raw?: string): string {
  return toIsoDate(raw) || (raw || '');
}

// ISO week-YEAR of a YYYY-MM-DD date — the year of that ISO week's Thursday, which
// diverges from the calendar year across the Dec/Jan boundary. Keying weeks off
// THIS (not the calendar year) keeps every date in an ISO week under one bucket.
function isoWeekYear(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const target = new Date(date.valueOf());
  target.setDate(target.getDate() - ((date.getDay() + 6) % 7) + 3); // move to this week's Thursday
  return target.getFullYear();
}

// Week bucket key for a date, e.g. "2026-W28"; '' when unparseable. Uses the ISO
// week-year so a week spanning New Year isn't split into two buckets.
function weekKeyOf(raw?: string): string {
  const iso = toIsoDate(raw);
  if (!iso) return '';
  return `${isoWeekYear(iso)}-W${String(getWeekNumber(iso)).padStart(2, '0')}`;
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
  // Which week sections are open. Current week is open by default (a `collapse-<key>`
  // entry marks it as user-collapsed); other weeks open only when their key is present.
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
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
          silo:               (/^[en]/i.test(row['silo'] || '') ? 'East' : /^[ws]/i.test(row['silo'] || '') ? 'West' : '') as LotCode['silo'],
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
      silo: lc.silo || '', loadNumber: lc.loadNumber || '',
      brix: lc.brix, ph: lc.ph, color: lc.color, temperature: lc.temperature,
      invert: lc.invert, ash: lc.ash || '', moisture: lc.moisture || '', flavourOdourOk: lc.flavourOdourOk,
      testerId: lc.testerId, testerName: lc.testerName,
      notes: lc.notes, weeklyVerification: lc.weeklyVerification, sugarType: lc.sugarType, countryOfOrigin: lc.countryOfOrigin || '',
      bolNumber: lc.bolNumber || '', customerPo: lc.customerPo || '',
      customerName: lc.customerName || '', qtyMt: lc.qtyMt || '', exitTime: lc.exitTime || '',
      arrivalTime: lc.arrivalTime || '', carrierName: lc.carrierName || '',
      trailerNumber: lc.trailerNumber || '', loaderName: lc.loaderName || '',
      loadedFrom: lc.loadedFrom || '', sugarUsed: lc.sugarUsed || '',
      tempLoadingBay: lc.tempLoadingBay || '', atmosphericTemp: lc.atmosphericTemp || '',
      colorConfirmedCoa: lc.colorConfirmedCoa || '', moistureConfirmedCoa: lc.moistureConfirmedCoa || '',
      sucrose: lc.sucrose || '', foreignMaterial: lc.foreignMaterial || '', sievingResults: lc.sievingResults || '',
      sugarLumpsGrams: lc.sugarLumpsGrams || '', initials: lc.initials || '',
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

  // Cell renderers used by both sugar-type column sets: '—' for empty values, and
  // a truncated note with a hover title.
  const dash = (v?: string) => v || '—';
  const noteCell = (v?: string) => <span title={v} className="block max-w-[150px] truncate">{v || '—'}</span>;

  // The rendered column set for the selected sugar type. The Date column shows a
  // NORMALIZED date (toIsoDate) so every row reads the same format regardless of
  // how it was entered/imported. BOL # is added (not on the sheets) for linking.
  type LotCol = { key: string; label: string; render?: (lc: LotCode) => React.ReactNode; mono?: boolean; bold?: boolean; widthClass?: string };
  const columns: LotCol[] = filterSugarType === 'Granulated' ? [
    { key: 'date', label: 'Date', render: (lc) => dash(formatDisplayDate(lc.date)) },
    { key: 'customerPo', label: 'PO #', mono: true, render: (lc) => dash(lc.customerPo) },
    { key: 'bolNumber', label: 'BOL #', mono: true, render: (lc) => dash(lc.bolNumber) },
    { key: 'customerName', label: 'Customer', render: (lc) => dash(lc.customerName) },
    { key: 'qtyMt', label: 'QTY MT', render: (lc) => dash(lc.qtyMt) },
    { key: 'exitTime', label: 'Exit Time', render: (lc) => dash(lc.exitTime) },
    { key: 'lotNumber', label: 'Lot #', mono: true, bold: true, widthClass: 'min-w-[120px]' },
    { key: 'loadedFrom', label: 'Loaded From', render: (lc) => dash(lc.loadedFrom) },
    { key: 'sugarUsed', label: 'Sugar Used', render: (lc) => dash(lc.sugarUsed) },
    { key: 'temperature', label: 'Temperature °C', render: (lc) => dash(lc.temperature) },
    { key: 'tempLoadingBay', label: 'Temperature at Loading Bay °C', render: (lc) => dash(lc.tempLoadingBay) },
    { key: 'atmosphericTemp', label: 'Atmospheric Temperature °C', render: (lc) => dash(lc.atmosphericTemp) },
    { key: 'moisture', label: 'Moisture %', render: (lc) => dash(lc.moisture) },
    { key: 'color', label: 'Color ICUMSA', render: (lc) => dash(lc.color) },
    { key: 'colorConfirmedCoa', label: 'Color Confirmed on COA %', render: (lc) => dash(lc.colorConfirmedCoa) },
    { key: 'invert', label: 'Invert %', render: (lc) => dash(lc.invert) },
    { key: 'moistureConfirmedCoa', label: 'Moisture Confirmed on COA %', render: (lc) => dash(lc.moistureConfirmedCoa) },
    { key: 'ash', label: 'Ash %', render: (lc) => dash(lc.ash) },
    { key: 'sucrose', label: 'Sucrose %', render: (lc) => dash(lc.sucrose) },
    { key: 'foreignMaterial', label: 'Foreign Material Identified Y/N', render: (lc) => dash(lc.foreignMaterial) },
    { key: 'initials', label: 'Initials', render: (lc) => dash(lc.initials) },
    { key: 'notes', label: 'Note', render: (lc) => noteCell(lc.notes) },
    { key: 'sievingResults', label: 'Sieving Results', render: (lc) => dash(lc.sievingResults) },
    { key: 'sugarLumpsGrams', label: 'Sugar Lumps (grams)', render: (lc) => dash(lc.sugarLumpsGrams) },
    { key: 'weeklyVerification', label: 'Weekly Verification', render: (lc) => dash(lc.weeklyVerification) },
  ] : [
    { key: 'date', label: 'Date', render: (lc) => dash(formatDisplayDate(lc.date)) },
    { key: 'customerName', label: 'Customer', render: (lc) => dash(lc.customerName) },
    { key: 'customerPo', label: 'PO #', mono: true, render: (lc) => dash(lc.customerPo) },
    { key: 'bolNumber', label: 'BOL #', mono: true, render: (lc) => dash(lc.bolNumber) },
    { key: 'qtyMt', label: 'QTY MT', render: (lc) => dash(lc.qtyMt) },
    { key: 'arrivalTime', label: 'Arrival Time', render: (lc) => dash(lc.arrivalTime) },
    { key: 'exitTime', label: 'Exit Time', render: (lc) => dash(lc.exitTime) },
    { key: 'carrierName', label: 'Carrier Name', render: (lc) => dash(lc.carrierName) },
    { key: 'trailerNumber', label: 'Trailer #', render: (lc) => dash(lc.trailerNumber) },
    { key: 'loaderName', label: 'Loader Name', render: (lc) => dash(lc.loaderName) },
    { key: 'lotNumber', label: 'Lot #', mono: true, bold: true, widthClass: 'min-w-[120px]' },
    { key: 'tankNumber', label: 'Tank #', render: (lc) => dash(lc.tankNumber) },
    { key: 'brix', label: 'Brix', render: (lc) => dash(lc.brix) },
    { key: 'ph', label: 'PH', render: (lc) => dash(lc.ph) },
    { key: 'colorConfirmedCoa', label: 'Color Confirmed on COA %', render: (lc) => dash(lc.colorConfirmedCoa) },
    { key: 'color', label: 'Color ICUMSA', render: (lc) => dash(lc.color) },
    { key: 'temperature', label: 'Temperature °C', render: (lc) => dash(lc.temperature) },
    { key: 'invert', label: 'Invert', render: (lc) => dash(lc.invert) },
    { key: 'flavourOdourOk', label: 'Flavour/Odour OK', render: (lc) => dash(lc.flavourOdourOk) },
    { key: 'initials', label: 'Initials', render: (lc) => dash(lc.initials) },
    { key: 'notes', label: 'Note', render: (lc) => noteCell(lc.notes) },
    { key: 'weeklyVerification', label: 'Weekly Verification', render: (lc) => dash(lc.weeklyVerification) },
  ];

  // Group the filtered lot codes into ISO weeks (newest first), like the Shipment
  // Schedule. Unparseable-date rows fall into an "undated" bucket at the bottom.
  const now = new Date();
  const currentIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const currentWeekKey = `${isoWeekYear(currentIso)}-W${String(getWeekNumber(currentIso)).padStart(2, '0')}`;
  const byWeek = new Map<string, LotCode[]>();
  for (const lc of filtered) {
    const wk = weekKeyOf(lc.date) || 'undated';
    (byWeek.get(wk) || byWeek.set(wk, []).get(wk)!).push(lc);
  }
  if (!byWeek.has(currentWeekKey)) byWeek.set(currentWeekKey, []); // always show the current week
  const weekKeys = Array.from(byWeek.keys()).sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return b.localeCompare(a); // newest week first
  });
  const isWeekExpanded = (key: string) => key === currentWeekKey ? !expandedWeeks.has(`collapse-${key}`) : expandedWeeks.has(key);
  const toggleWeek = (key: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      const k = key === currentWeekKey ? `collapse-${key}` : key;
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const weekLabel = (key: string) => {
    if (key === 'undated') return 'Undated';
    const [y, w] = key.split('-W');
    return `Week ${parseInt(w, 10)} · ${y}`;
  };

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

      {/* Lot Code Testing Log — grouped into ISO weeks (newest first) with
          expandable sections, mirroring the Shipment Schedule. The current week is
          green and expanded by default. Row click opens the edit modal. */}
      <div className="space-y-2">
        {weekKeys.map((key) => {
          const rows = (byWeek.get(key) || []).slice().sort((a, b) =>
            (toIsoDate(b.date) || '').localeCompare(toIsoDate(a.date) || '') ||
            (a.lotNumber || '').localeCompare(b.lotNumber || ''));
          const isCurrent = key === currentWeekKey;
          const expanded = isWeekExpanded(key);
          return (
            <div key={key} className={`bg-white border-2 overflow-hidden ${isCurrent ? 'border-emerald-500 shadow-[2px_2px_0px_0px_rgba(16,185,129,0.6)]' : 'border-[#141414] shadow-[2px_2px_0px_0px_rgba(20,20,20,1)]'}`}>
              <button
                onClick={() => toggleWeek(key)}
                className={`w-full px-3 py-2 flex justify-between items-center transition-all ${isCurrent ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-[#141414] text-[#E4E3E0] hover:bg-opacity-90'}`}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  {weekLabel(key)}{isCurrent ? ' (Current Week)' : ''}
                  <span className="opacity-60 font-mono normal-case ml-2">· {rows.length}</span>
                </span>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase tracking-widest border-b border-[#141414]">
                            {columns.map((c) => (
                              <th key={c.key} className={`p-3 border-r border-[#141414]/10 ${c.widthClass || ''}`}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#141414]/10">
                          {rows.length === 0 ? (
                            <tr>
                              <td colSpan={columns.length} className="p-6 text-center text-xs opacity-50 italic">No lot codes this week.</td>
                            </tr>
                          ) : rows.map((lc) => (
                            <tr key={lc.id} onClick={() => openEdit(lc)} className="hover:bg-[#F9F9F9] transition-colors cursor-pointer">
                              {columns.map((c) => (
                                <td key={c.key} className={`p-3 text-xs border-r border-[#141414]/10 ${c.mono ? 'font-mono' : ''} ${c.bold ? 'font-bold' : ''}`}>
                                  {c.render ? c.render(lc) : ((lc as any)[c.key] ?? '—')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

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
                  <div className="text-[9px] opacity-40 text-right">HS-[Type][Group][Conv/Org][YY][JJJ]-[Silo][Load#]</div>
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
                        <select value={formData.silo} onChange={(e) => updateForm({ silo: e.target.value as 'East' | 'West' | '' })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none">
                          <option value="">— Select —</option>
                          <option value="East">East</option>
                          <option value="West">West</option>
                        </select>
                      </td>
                      <td className="p-2 text-[10px] uppercase font-bold opacity-60 border-r border-[#141414]/10">Load #</td>
                      <td className="p-1.5">
                        <input type="text" value={formData.loadNumber} onChange={(e) => updateForm({ loadNumber: e.target.value })}
                          className="w-full bg-[#F5F5F5] border border-[#141414] p-1.5 text-sm focus:outline-none" placeholder="e.g. 1" />
                      </td>
                    </tr>
                    <tr className="border-b border-[#141414]/10">
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
                {/* Loading-log fields — the extra columns from the Liquid Loads /
                    Granulated Loads sheets, surfaced by sugar type. These feed the
                    matching sugar-type table column set. */}
                {(() => {
                  const liquidFields: [string, string][] = [
                    ['customerName', 'Customer'], ['qtyMt', 'QTY MT'],
                    ['arrivalTime', 'Arrival Time'], ['exitTime', 'Exit Time'],
                    ['carrierName', 'Carrier Name'], ['trailerNumber', 'Trailer #'],
                    ['loaderName', 'Loader Name'], ['colorConfirmedCoa', 'Color Confirmed on COA %'],
                    ['initials', 'Initials'],
                  ];
                  const granulatedFields: [string, string][] = [
                    ['customerName', 'Customer'], ['qtyMt', 'QTY MT'], ['exitTime', 'Exit Time'],
                    ['loadedFrom', 'Loaded From'], ['sugarUsed', 'Sugar Used'],
                    ['tempLoadingBay', 'Temperature at Loading Bay °C'],
                    ['atmosphericTemp', 'Atmospheric Temperature °C'],
                    ['colorConfirmedCoa', 'Color Confirmed on COA %'],
                    ['moistureConfirmedCoa', 'Moisture Confirmed on COA %'],
                    ['sucrose', 'Sucrose %'], ['foreignMaterial', 'Foreign Material Identified Y/N'],
                    ['sievingResults', 'Sieving Results'], ['sugarLumpsGrams', 'Sugar Lumps (grams)'],
                    ['initials', 'Initials'],
                  ];
                  const isGranulated = formData.sugarType === 'Granulated';
                  const fields = isGranulated ? granulatedFields : liquidFields;
                  return (
                    <div className="border border-[#141414]/20 p-3 space-y-3">
                      <div className="text-[10px] uppercase font-bold opacity-60">{isGranulated ? 'Granulated' : 'Liquid'} Loading Log</div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {fields.map(([key, label]) => (
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
                  );
                })()}
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
