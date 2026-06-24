import React, { useState, useRef, useEffect } from 'react';
import { QAProduct, QADocument, QASpecifications, ArtworkApproval, SKU, Person, ProductGroup, Location, Vendor, QATemplate, BOMItem, SugarType, PackagingFormat, NamingFormula, FormulaToken } from '../types';
import { resolveProductName, resolveShortForm } from '../utils/namingFormulaResolver';
import { Plus, X, Trash2, Upload, Send, CheckCircle2, AlertCircle, Clock, Image, ChevronDown, ChevronUp, Download, Mail, FileText, ExternalLink, Pencil, Minimize2, Maximize2, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { uploadQAFile, deleteQAFile } from '../firebaseStorage';
import PageBanner from './PageBanner';
import DataTable from './DataTable';
import DetailModal, { DetailRow, DetailField } from './DetailModal';
import type { SheetSpec } from '../utils/exportExcel';

interface QualityAssurancePageProps {
  qaProducts: QAProduct[];
  skus: SKU[];
  people: Person[];
  productGroups: ProductGroup[];
  locations: Location[];
  vendors: Vendor[];
  qaTemplates: QATemplate[];
  sugarTypes: SugarType[];
  packagingFormats: PackagingFormat[];
  onUpdatePackagingFormats: (formats: PackagingFormat[]) => void;
  namingFormulas: NamingFormula[];
  onUpdateNamingFormulas: (formulas: NamingFormula[]) => void;
  onUpdateProductGroups: (groups: ProductGroup[]) => void;
  onUpdateSugarTypes: (types: SugarType[]) => void;
  onUpdateLocations: (locations: Location[]) => void;
  onAddQAProduct: (product: QAProduct) => void;
  onUpdateQAProduct: (product: QAProduct) => void;
  onDeleteQAProduct: (productId: string) => void;
  onUpdateTemplates: (templates: QATemplate[]) => void;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
    />
  );
}

const emptySpecs: QASpecifications = { brix: '', granulation: '', color: '', ash: '', turbidity: '', moisture: '' };

// Sample values used for formula preview rendering
const PREVIEW_SAMPLE = {
  netWeightKg: '20',
  grossWeightKg: '22',
  productFormat: 'Bagged',
  productGroup: 'Bagged',
  category: 'Conventional',
  sugarType: 'Granulated',
  sugarTypeAbbreviation: 'GC',
  productGroupBolCode: 'P',
  coChar: 'C',
  location: 'Hamilton',
  maxColor: '45',
};

// Convert an array of tokens into a preview string using sample data
function tokensToPreview(tokens: FormulaToken[]): string {
  return tokens.map(t => {
    if (t.type === 'literal') return t.value;
    if (t.type === 'productGroup') return t.value;
    if (t.type === 'productGroupCode') return t.value;
    if (t.type === 'sugarType') return t.value;
    if (t.type === 'sugarTypeAbbr') return t.value;
    if (t.type === 'field') {
      const sample = (PREVIEW_SAMPLE as any)[t.value];
      return sample !== undefined ? String(sample) : `{${t.label}}`;
    }
    return '';
  }).join('');
}

// Convert an array of tokens into a display formula string (with placeholders for fields)
function tokensToFormulaString(tokens: FormulaToken[]): string {
  return tokens.map(t => {
    if (t.type === 'literal') return t.value;
    return `{${t.label}}`;
  }).join('');
}

export default function QualityAssurancePage({
  qaProducts,
  skus,
  people,
  productGroups,
  locations,
  vendors,
  qaTemplates,
  sugarTypes,
  packagingFormats,
  onUpdatePackagingFormats,
  namingFormulas,
  onUpdateNamingFormulas,
  onUpdateProductGroups,
  onUpdateSugarTypes,
  onUpdateLocations,
  onAddQAProduct,
  onUpdateQAProduct,
  onDeleteQAProduct,
  onUpdateTemplates,
}: QualityAssurancePageProps) {
  // Auto-populate: create QA entries for any SKUs not already tracked
  useEffect(() => {
    const existingSkuIds = new Set(qaProducts.map(q => q.skuId));
    const missing = skus.filter(s => !existingSkuIds.has(s.id));
    if (missing.length > 0) {
      missing.forEach(sku => {
        onAddQAProduct({
          id: `QA-${sku.id}`,
          skuId: sku.id,
          skuName: sku.name,
          productGroup: sku.productGroup,
          category: sku.category,
          location: sku.location,
          netWeightKg: sku.netWeightKg,
          grossWeightKg: sku.grossWeightKg,
          maxColor: sku.maxColor,
          sugarType: sku.sugarType,
          productFormat: sku.productFormat,
          specifications: { ...emptySpecs },
          packagingSupplier: '',
          packagingPictureUrls: [],
          packagingPictureFilenames: [],
          artworkApprovals: [],
          upcCode: '',
          specSheets: [],
          certificates: [],
        });
      });
    }
  }, [skus, qaProducts, onAddQAProduct]);

  // Auto-categorize sugar type for products that don't have one set
  useEffect(() => {
    qaProducts.forEach(qa => {
      if (qa.sugarType) return; // Already categorized
      const name = qa.skuName.toLowerCase();
      let autoType: string | undefined;
      if (qa.productGroup === 'Liquid' || name.includes('liquid')) {
        autoType = 'Liquid';
      } else if (
        (name.includes('fine granulated') && (qa.productGroup === 'Tote' || name.includes('tote'))) ||
        (name.includes('fine granulated') && (qa.productGroup === 'Bulk' || name.includes('bulk')))
      ) {
        autoType = 'Granulated';
      }
      if (autoType && sugarTypes.some(st => st.name === autoType)) {
        onUpdateQAProduct({ ...qa, sugarType: autoType });
      }
    });
  }, [qaProducts.length]); // Only run when product count changes (initial load)

  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  // Add product modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState('');

  // Product detail card
  const [selectedProduct, setSelectedProduct] = useState<QAProduct | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<QAProduct | null>(null);

  // Upload loading states
  const [isUploadingPackaging, setIsUploadingPackaging] = useState(false);
  const [isUploadingArtwork, setIsUploadingArtwork] = useState(false);
  const [isUploadingUpc, setIsUploadingUpc] = useState(false);

  // Approval modal
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalRecipientId, setApprovalRecipientId] = useState('');

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Modal window state
  const [productModalMaximized, setProductModalMaximized] = useState(false);
  const [productModalMinimized, setProductModalMinimized] = useState(false);

  // BOM editing state
  const [editingBomItem, setEditingBomItem] = useState<BOMItem | null>(null);
  const [showBomForm, setShowBomForm] = useState(false);
  const emptyBomItem: BOMItem = { id: '', materialName: '', category: 'Raw Material', quantity: 0, unit: 'kg' };

  // File input refs
  const packagingFileRef = useRef<HTMLInputElement>(null);
  const artworkFileRef = useRef<HTMLInputElement>(null);
  const upcFileRef = useRef<HTMLInputElement>(null);
  const specSheetFileRef = useRef<HTMLInputElement>(null);
  const certificateFileRef = useRef<HTMLInputElement>(null);

  // Upload states for spec sheets and certificates
  const [isUploadingSpecSheet, setIsUploadingSpecSheet] = useState(false);
  const [isUploadingCertificate, setIsUploadingCertificate] = useState(false);

  // Location detail card state
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [editLocationData, setEditLocationData] = useState<Location | null>(null);

  // Location audit upload states
  const [isUploadingGfsiReport, setIsUploadingGfsiReport] = useState(false);
  const [isUploadingGfsiCert, setIsUploadingGfsiCert] = useState(false);
  const [isUploadingOrganicReport, setIsUploadingOrganicReport] = useState(false);
  const [isUploadingOrganicCert, setIsUploadingOrganicCert] = useState(false);
  const gfsiReportRef = useRef<HTMLInputElement>(null);
  const gfsiCertRef = useRef<HTMLInputElement>(null);
  const organicReportRef = useRef<HTMLInputElement>(null);
  const organicCertRef = useRef<HTMLInputElement>(null);

  // Template state
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QATemplate | null>(null);
  const [templateForm, setTemplateForm] = useState<{ name: string; type: QATemplate['type']; googleSheetUrl: string; description: string }>({ name: '', type: 'Bill of Lading', googleSheetUrl: '', description: '' });
  const [deleteTemplateConfirmId, setDeleteTemplateConfirmId] = useState<string | null>(null);

  // Packaging Format detail-modal state (DataTable + DetailModal standard).
  const [pkgFormatDraft, setPkgFormatDraft] = useState<PackagingFormat | null>(null);
  const [pkgFormatMode, setPkgFormatMode] = useState<'view' | 'edit' | 'add'>('view');

  // Naming Formula detail-modal state (DataTable + DetailModal standard).
  // The detailed token-builder UI (picker, drag-drop, preview) stays inside
  // the modal — only the shell + delete dialog change.
  const [namingFormulaDraft, setNamingFormulaDraft] = useState<NamingFormula | null>(null);
  const [namingFormulaMode, setNamingFormulaMode] = useState<'view' | 'edit' | 'add'>('view');
  const [draggedTokenIdx, setDraggedTokenIdx] = useState<number | null>(null);
  const [tokenPickerCategory, setTokenPickerCategory] = useState<string>('field');
  const [tokenPickerValue, setTokenPickerValue] = useState<string>('');
  const [literalText, setLiteralText] = useState<string>('');

  // Product Group detail-modal state (DataTable + DetailModal standard).
  const [productGroupDraft, setProductGroupDraft] = useState<ProductGroup | null>(null);
  const [productGroupMode, setProductGroupMode] = useState<'view' | 'edit' | 'add'>('view');

  // Sugar Type detail-modal state (DataTable + DetailModal standard).
  const [sugarTypeDraft, setSugarTypeDraft] = useState<SugarType | null>(null);
  const [sugarTypeMode, setSugarTypeMode] = useState<'view' | 'edit' | 'add'>('view');

  const openLocationDetail = (loc: Location) => {
    setSelectedLocation(loc);
    setEditLocationData({ ...loc });
    setIsEditingLocation(false);
  };

  const closeLocationDetail = () => {
    setSelectedLocation(null);
    setEditLocationData(null);
    setIsEditingLocation(false);
  };

  const saveLocationChanges = () => {
    if (!editLocationData) return;
    onUpdateLocations(locations.map(l => l.id === editLocationData.id ? editLocationData : l));
    setSelectedLocation(editLocationData);
    setIsEditingLocation(false);
  };

  // Generic audit document upload handler
  const handleAuditDocUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'gfsiAuditReport' | 'gfsiAuditCertificate' | 'organicAuditReport' | 'organicAuditCertificate',
    setLoading: (v: boolean) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file || !editLocationData) return;
    setLoading(true);
    try {
      const { url, filename } = await uploadQAFile(editLocationData.id, 'packaging', file);
      const doc: QADocument = { id: `${field}-${Date.now()}`, url, filename, uploadedAt: new Date().toISOString() };
      const updated = { ...editLocationData, [field]: doc };
      setEditLocationData(updated);
      onUpdateLocations(locations.map(l => l.id === updated.id ? updated : l));
      setSelectedLocation(updated);
    } catch (err: any) {
      alert(err.message || 'Upload failed. Please try again.');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const deleteAuditDoc = (field: 'gfsiAuditReport' | 'gfsiAuditCertificate' | 'organicAuditReport' | 'organicAuditCertificate') => {
    if (!editLocationData) return;
    const updated = { ...editLocationData, [field]: undefined };
    setEditLocationData(updated);
    onUpdateLocations(locations.map(l => l.id === updated.id ? updated : l));
    setSelectedLocation(updated);
  };

  // Filter and sort
  const filtered = qaProducts.filter(p => {
    const term = searchTerm.toLowerCase();
    return !term ||
      p.skuName.toLowerCase().includes(term) ||
      p.productGroup.toLowerCase().includes(term) ||
      p.id.toLowerCase().includes(term) ||
      p.location.toLowerCase().includes(term);
  });

  const sorted = [...filtered].sort((a, b) => {
    if (!sortConfig) return 0;
    const { key, direction } = sortConfig;
    const aVal = (a as any)[key];
    const bVal = (b as any)[key];
    if (aVal < bVal) return direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev?.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  // New product template
  const createBlankProduct = (): QAProduct => ({
    id: `QA-${Date.now()}`,
    skuId: '',
    skuName: '',
    // Leave blank — the group is derived from the packaging format on save so a
    // Liquid/Bagged/Tote product is never silently stamped with the first group.
    productGroup: '',
    category: 'Conventional',
    location: locations.length > 0 ? locations[0].name : '',
    netWeightKg: 0,
    grossWeightKg: 0,
    maxColor: 0,
    specifications: { ...emptySpecs },
    packagingSupplier: '',
    packagingPictureUrls: [],
    packagingPictureFilenames: [],
    artworkApprovals: [],
    upcCode: '',
    specSheets: [],
    certificates: [],
  });

  const [newProductData, setNewProductData] = useState<QAProduct>(createBlankProduct);

  const openAddModal = () => {
    setNewProductData(createBlankProduct());
    setSelectedSkuId('');
    setShowAddModal(true);
  };

  const prefillFromSku = (skuId: string) => {
    setSelectedSkuId(skuId);
    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;
    setNewProductData(prev => ({
      ...prev,
      skuId: sku.id,
      skuName: sku.name,
      productGroup: sku.productGroup,
      category: sku.category,
      location: sku.location,
      netWeightKg: sku.netWeightKg,
      grossWeightKg: sku.grossWeightKg,
      maxColor: sku.maxColor,
      sugarType: sku.sugarType,
      productFormat: sku.productFormat,
    }));
  };

  const handleAddProduct = () => {
    if (!newProductData.productFormat?.trim()) return;
    // If no skuId (scratch product), generate one
    const product: QAProduct = {
      ...newProductData,
      id: `QA-${Date.now()}`,
      skuId: newProductData.skuId || `SKU-NEW-${Date.now()}`,
      // Auto-set skuName from productFormat if empty
      skuName: newProductData.skuName?.trim() || newProductData.productFormat || '',
    };
    onAddQAProduct(product);
    setShowAddModal(false);
    setNewProductData(createBlankProduct());
    setSelectedSkuId('');
  };

  // Open detail card
  const openDetail = (product: QAProduct) => {
    setSelectedProduct(product);
    setEditData({ ...product, specifications: { ...product.specifications }, packagingPictureUrls: [...product.packagingPictureUrls], packagingPictureFilenames: [...product.packagingPictureFilenames], artworkApprovals: [...product.artworkApprovals], specSheets: [...(product.specSheets || [])], certificates: [...(product.certificates || [])], billOfMaterials: [...(product.billOfMaterials || [])] });
    setIsEditing(false);
    setProductModalMaximized(false);
    setProductModalMinimized(false);
  };

  const closeDetail = () => {
    setSelectedProduct(null);
    setEditData(null);
    setIsEditing(false);
    setProductModalMaximized(false);
    setProductModalMinimized(false);
    setShowBomForm(false);
    setEditingBomItem(null);
  };

  const saveChanges = () => {
    if (!editData) return;
    onUpdateQAProduct(editData);
    setSelectedProduct(editData);
    setIsEditing(false);
  };

  // Image upload handlers
  const handlePackagingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editData) return;
    // Size validation is handled by uploadQAFile (images compressed, docs limited to 400KB)
    setIsUploadingPackaging(true);
    try {
      const { url, filename } = await uploadQAFile(editData.id, 'packaging', file);
      const updated = {
        ...editData,
        packagingPictureUrls: [...editData.packagingPictureUrls, url],
        packagingPictureFilenames: [...editData.packagingPictureFilenames, filename],
      };
      setEditData(updated);
      onUpdateQAProduct(updated);
      setSelectedProduct(updated);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsUploadingPackaging(false);
      e.target.value = '';
    }
  };

  const handleDeletePackagingImage = async (index: number) => {
    if (!editData) return;
    const url = editData.packagingPictureUrls[index];
    await deleteQAFile(url);
    const updated = {
      ...editData,
      packagingPictureUrls: editData.packagingPictureUrls.filter((_, i) => i !== index),
      packagingPictureFilenames: editData.packagingPictureFilenames.filter((_, i) => i !== index),
    };
    setEditData(updated);
    onUpdateQAProduct(updated);
    setSelectedProduct(updated);
  };

  const handleArtworkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editData) return;
    // Size validation is handled by uploadQAFile (images compressed, docs limited to 400KB)
    setIsUploadingArtwork(true);
    try {
      const { url, filename } = await uploadQAFile(editData.id, 'artwork', file);
      const updated = { ...editData, artworkUrl: url, artworkFilename: filename };
      setEditData(updated);
      onUpdateQAProduct(updated);
      setSelectedProduct(updated);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload artwork. Please try again.');
    } finally {
      setIsUploadingArtwork(false);
      e.target.value = '';
    }
  };

  const handleUpcUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editData) return;
    // Size validation is handled by uploadQAFile (images compressed, docs limited to 400KB)
    setIsUploadingUpc(true);
    try {
      const { url, filename } = await uploadQAFile(editData.id, 'upc', file);
      const updated = { ...editData, upcImageUrl: url, upcImageFilename: filename };
      setEditData(updated);
      onUpdateQAProduct(updated);
      setSelectedProduct(updated);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload UPC image. Please try again.');
    } finally {
      setIsUploadingUpc(false);
      e.target.value = '';
    }
  };

  // Send artwork for approval
  const handleSendApproval = () => {
    if (!editData || !approvalRecipientId) return;
    const person = people.find(p => p.id === approvalRecipientId);
    if (!person) return;

    const approval: ArtworkApproval = {
      id: `APPROVAL-${Date.now()}`,
      artworkUrl: editData.artworkUrl || '',
      artworkFilename: editData.artworkFilename || '',
      sentTo: person.id,
      sentToName: person.name,
      sentAt: new Date().toISOString(),
      status: 'pending',
    };

    const updated = { ...editData, artworkApprovals: [...editData.artworkApprovals, approval] };
    setEditData(updated);
    onUpdateQAProduct(updated);
    setSelectedProduct(updated);
    setShowApprovalModal(false);
    setApprovalRecipientId('');
  };

  const updateApprovalStatus = (approvalId: string, status: 'pending' | 'approved' | 'rejected') => {
    if (!editData) return;
    const updated = {
      ...editData,
      artworkApprovals: editData.artworkApprovals.map(a =>
        a.id === approvalId ? { ...a, status, respondedAt: new Date().toISOString() } : a
      ),
    };
    setEditData(updated);
    onUpdateQAProduct(updated);
    setSelectedProduct(updated);
  };

  // Spec sheet upload handler
  const handleSpecSheetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editData) return;
    // Size validation is handled by uploadQAFile (images compressed, docs limited to 400KB)
    setIsUploadingSpecSheet(true);
    try {
      const { url, filename } = await uploadQAFile(editData.id, 'packaging', file); // reuse 'packaging' category path
      const doc: QADocument = { id: `SPEC-${Date.now()}`, url, filename, uploadedAt: new Date().toISOString() };
      const updated = { ...editData, specSheets: [...(editData.specSheets || []), doc] };
      setEditData(updated);
      onUpdateQAProduct(updated);
      setSelectedProduct(updated);
    } catch (err) {
      console.error('Spec sheet upload failed:', err);
      alert('Failed to upload spec sheet. Please try again.');
    } finally {
      setIsUploadingSpecSheet(false);
      e.target.value = '';
    }
  };

  // Certificate upload handler
  const handleCertificateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editData) return;
    // Size validation is handled by uploadQAFile (images compressed, docs limited to 400KB)
    setIsUploadingCertificate(true);
    try {
      const { url, filename } = await uploadQAFile(editData.id, 'artwork', file); // reuse 'artwork' category path
      const doc: QADocument = { id: `CERT-${Date.now()}`, url, filename, uploadedAt: new Date().toISOString() };
      const updated = { ...editData, certificates: [...(editData.certificates || []), doc] };
      setEditData(updated);
      onUpdateQAProduct(updated);
      setSelectedProduct(updated);
    } catch (err) {
      console.error('Certificate upload failed:', err);
      alert('Failed to upload certificate. Please try again.');
    } finally {
      setIsUploadingCertificate(false);
      e.target.value = '';
    }
  };

  // Delete a spec sheet
  const handleDeleteSpecSheet = async (docId: string) => {
    if (!editData) return;
    const doc = (editData.specSheets || []).find(d => d.id === docId);
    if (doc) await deleteQAFile(doc.url);
    const updated = { ...editData, specSheets: (editData.specSheets || []).filter(d => d.id !== docId) };
    setEditData(updated);
    onUpdateQAProduct(updated);
    setSelectedProduct(updated);
  };

  // Delete a certificate
  const handleDeleteCertificate = async (docId: string) => {
    if (!editData) return;
    const doc = (editData.certificates || []).find(d => d.id === docId);
    if (doc) await deleteQAFile(doc.url);
    const updated = { ...editData, certificates: (editData.certificates || []).filter(d => d.id !== docId) };
    setEditData(updated);
    onUpdateQAProduct(updated);
    setSelectedProduct(updated);
  };

  // Email a document (opens mailto with attachment link)
  const handleEmailDocument = (doc: QADocument, type: 'Spec Sheet' | 'Certificate') => {
    const productName = selectedProduct?.skuName || 'Product';
    const subject = encodeURIComponent(`${type}: ${productName} - ${doc.filename}`);
    const body = encodeURIComponent(`Please find the ${type.toLowerCase()} for ${productName} attached.\n\nDocument: ${doc.filename}\nDownload: ${doc.url}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  // Download a document
  const handleDownloadDocument = (doc: QADocument) => {
    const link = document.createElement('a');
    link.href = doc.url;
    link.download = doc.filename;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // People filtered by department
  const qaPeople = people.filter(p => p.department === 'QA');
  const salesPeople = people.filter(p => p.department === 'sales');
  const opsPeople = people.filter(p => p.department === 'operations');

  const getPersonName = (id?: string) => {
    if (!id) return 'Unassigned';
    return people.find(p => p.id === id)?.name || 'Unknown';
  };

  const SortHeader = ({ label, sortKey }: { label: string; sortKey: string }) => (
    <th
      className="p-4 bg-[#141414] border-r border-white/10 cursor-pointer hover:bg-white/5 transition-colors select-none"
      onClick={() => handleSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortConfig?.key === sortKey && (
          <ChevronDown size={10} className={`transition-transform ${sortConfig.direction === 'desc' ? 'rotate-180' : ''}`} />
        )}
      </div>
    </th>
  );

  // Current data to display in detail card (editing or viewing)
  const displayData = isEditing ? editData : selectedProduct;

  const qaExportSheets = (): SheetSpec[] => [{
    sheetName: 'QA Products',
    title: 'Quality Assurance',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${qaProducts.length} products`,
    columns: [
      { header: 'Prod No.', key: 'productCode' },
      { header: 'Product Name', key: 'productName' },
      { header: 'Packaging Format', key: 'productFormat' },
      { header: 'Product Group', key: 'productGroup' },
      { header: 'Sugar Type', key: 'sugarType' },
      { header: 'Shortform', key: 'shortform' },
      { header: 'Conv./Organic', key: 'category' },
      { header: 'Max Color', key: 'maxColor' },
      { header: 'Location', key: 'location' },
      { header: 'Net Weight (KG)', key: 'netWeightKg', format: 'number' },
      { header: 'Gross Weight (KG)', key: 'grossWeightKg', format: 'number' },
    ],
    rows: qaProducts.map(p => {
      const ctx = { sugarTypes, productGroups };
      const resolvedName = resolveProductName(namingFormulas, p, ctx);
      const productName = resolvedName && resolvedName.trim()
        ? resolvedName
        : ((p.productFormat && p.sugarType)
            ? `${p.netWeightKg ? `${p.netWeightKg}kg ` : ''}${p.productFormat} ${p.sugarType} ${p.category} ${p.maxColor || 0}`
            : '');

      const resolvedShort = resolveShortForm(namingFormulas, p, ctx);
      let shortform = resolvedShort && resolvedShort.trim() ? resolvedShort : '';
      if (!shortform) {
        if (p.sugarType === 'Molasses') {
          shortform = 'MOL';
        } else {
          const st = sugarTypes.find(s => s.name === p.sugarType);
          if (st) {
            const co = p.category === 'Conventional' ? 'C' : 'B';
            if (p.productGroup === 'Bulk') {
              shortform = `${st.abbreviation}${co}${p.maxColor}`;
            } else {
              const wt = p.netWeightKg ? `${p.netWeightKg}kg ` : '';
              shortform = `${wt}${st.abbreviation}${co}${p.maxColor}`;
            }
          }
        }
      }
      return { ...p, shortform, productName } as any;
    }),
  }];
  return (
    <div>
      <PageBanner
        icon={<CheckCircle2 size={18} />}
        title="Quality Assurance"
        count={qaProducts.length}
        exportSheets={qaExportSheets}
        exportFileName="Quality_Assurance"
      >
        <button
          onClick={openAddModal}
          className="px-3 py-1.5 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-white/20 transition-all"
        >
          <Plus size={12} /> Add Product
        </button>
      </PageBanner>
    <div className="p-6 space-y-4">

      {/* Search */}
      <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search by name, product group, ID, or location..." />

      {/* Product Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-13rem)]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                <SortHeader label="Prod No." sortKey="productCode" />
                <SortHeader label="Product Name" sortKey="productName" />
                <SortHeader label="Packaging Format" sortKey="productFormat" />
                <SortHeader label="Product Group" sortKey="productGroup" />
                <SortHeader label="Sugar Type" sortKey="sugarType" />
                <SortHeader label="Shortform" sortKey="shortform" />
                <SortHeader label="Conv./Organic" sortKey="category" />
                <SortHeader label="Max Color" sortKey="maxColor" />
                <SortHeader label="Location" sortKey="location" />
                <SortHeader label="Net Weight (KG)" sortKey="netWeightKg" />
                <SortHeader label="Gross Weight (KG)" sortKey="grossWeightKg" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/10">
              {sorted.length > 0 ? sorted.map((p) => {
                const pg = productGroups.find(g => g.name === p.productGroup);
                // Row color based on approval status
                const hasApprovals = p.artworkApprovals.length > 0;
                const allApproved = hasApprovals && p.artworkApprovals.every(a => a.status === 'approved');
                const somePending = hasApprovals && p.artworkApprovals.some(a => a.status === 'pending');
                const rowBg = allApproved ? 'bg-green-50' : somePending ? 'bg-amber-50' : '';
                return (
                  <tr
                    key={p.id}
                    className={`${rowBg} hover:bg-opacity-70 transition-colors cursor-pointer group`}
                    style={{ borderLeft: pg ? `4px solid ${pg.color}` : 'none' }}
                    onClick={() => openDetail(p)}
                  >
                    <td className="p-4 text-xs font-mono border-r border-[#141414]/10">{p.productCode || '—'}</td>
                    <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{(() => {
                      const resolved = resolveProductName(namingFormulas, p, { sugarTypes, productGroups });
                      if (resolved && resolved.trim()) return resolved;
                      return (p.productFormat && p.sugarType)
                        ? `${p.netWeightKg ? `${p.netWeightKg}kg ` : ''}${p.productFormat} ${p.sugarType} ${p.category} ${p.maxColor || 0}`
                        : '—';
                    })()}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.productFormat || '—'}</td>
                    <td className="p-4 border-r border-[#141414]/10">
                      <span
                        className="px-2 py-1 text-[10px] font-bold uppercase border border-[#141414]/20"
                        style={{ backgroundColor: pg?.color || '#F5F5F5' }}
                      >
                        {p.productGroup}
                      </span>
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-bold">{p.sugarType || '—'}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10 font-mono font-bold">{(() => {
                      const resolved = resolveShortForm(namingFormulas, p, { sugarTypes, productGroups });
                      if (resolved && resolved.trim()) return resolved;
                      // Legacy fallback
                      if (p.sugarType === 'Molasses') return 'MOL';
                      const st = sugarTypes.find(s => s.name === p.sugarType);
                      if (!st) return '—';
                      const co = p.category === 'Conventional' ? 'C' : 'B';
                      if (p.productGroup === 'Bulk') return `${st.abbreviation}${co}${p.maxColor}`;
                      const wt = p.netWeightKg ? `${p.netWeightKg}kg ` : '';
                      return `${wt}${st.abbreviation}${co}${p.maxColor}`;
                    })()}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.category}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.maxColor}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.location}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.netWeightKg ?? '-'}</td>
                    <td className="p-4 text-xs">{p.grossWeightKg ?? '-'}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td className="p-12 text-center text-xs opacity-50 italic" colSpan={11}>
                    No products added yet. Click "Add Product" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Locations Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
          <h3 className="text-xs font-bold uppercase tracking-widest">Locations</h3>
          <button
            onClick={() => {
              const id = `LOC-${String(locations.length + 1).padStart(3, '0')}`;
              const newLoc: Location = { id, locationCode: '', name: '', address: '', city: '', province: '', postalCode: '', bays: [], appointmentStartTime: '06:00', appointmentEndTime: '18:00', appointmentDuration: 30 };
              onUpdateLocations([...locations, newLoc]);
              openLocationDetail(newLoc);
              setIsEditingLocation(true);
            }}
            className="px-3 py-1 bg-white text-[#141414] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
          >
            <Plus size={12} /> Add New Location
          </button>
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
              <th className="p-4 border-r border-[#141414]/10 text-center">Active</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10">
            {locations.map(loc => {
              const isActive = loc.active !== false; // undefined defaults to active
              return (
                <tr key={loc.id} className={`hover:bg-[#F9F9F9] transition-colors cursor-pointer group ${isActive ? '' : 'opacity-50'}`} onClick={() => openLocationDetail(loc)}>
                  <td className="p-4 text-xs font-bold font-mono border-r border-[#141414]/10 w-20">{loc.locationCode || '—'}</td>
                  <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{loc.name || '—'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{loc.address || '—'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{loc.city || '—'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{loc.province || '—'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{loc.postalCode || '—'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, active: e.target.checked } : l))}
                      className="w-4 h-4 cursor-pointer"
                      title={isActive ? 'Active — shown in location dropdowns' : 'Inactive — hidden from location dropdowns'}
                    />
                  </td>
                  <td className="p-4 text-xs">
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateLocations(locations.filter(l => l.id !== loc.id)); }}
                      className="p-1.5 text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {locations.length === 0 && (
              <tr><td colSpan={8} className="p-12 text-center text-xs opacity-50 italic">No locations added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Packaging Formats — standardized DataTable + DetailModal. */}
      <DataTable<PackagingFormat>
        title="Packaging Formats"
        columns={[
          { key: 'code', label: 'Code', mono: true, bold: true, widthClass: 'w-32' },
          { key: 'name', label: 'Name', bold: true },
          { key: 'description', label: 'Description' },
          { key: 'packagingLine', label: 'Packaging Line' },
          { key: 'location', label: 'Location' },
        ]}
        rows={packagingFormats}
        getRowKey={(pf) => pf.id}
        onRowClick={(pf) => { setPkgFormatDraft({ ...pf }); setPkgFormatMode('view'); }}
        onAdd={() => {
          setPkgFormatDraft({
            id: `PF-${Date.now()}`,
            name: '',
            code: '',
            description: '',
            packagingLine: '',
            location: locations[0]?.name || '',
          });
          setPkgFormatMode('add');
        }}
        addLabel="Add Packaging Format"
        emptyMessage="No packaging formats added yet."
        defaultSortKey="name"
      />

      <DetailModal
        tableName="Packaging Formats"
        isOpen={!!pkgFormatDraft}
        mode={pkgFormatMode}
        onClose={() => setPkgFormatDraft(null)}
        onEdit={() => setPkgFormatMode('edit')}
        onSave={() => {
          if (!pkgFormatDraft) return;
          if (!pkgFormatDraft.name.trim()) return;
          if (pkgFormatMode === 'add') {
            onUpdatePackagingFormats([...packagingFormats, pkgFormatDraft]);
          } else {
            onUpdatePackagingFormats(packagingFormats.map(pf => pf.id === pkgFormatDraft.id ? pkgFormatDraft : pf));
          }
          setPkgFormatDraft(null);
        }}
        onDelete={pkgFormatMode === 'add' ? undefined : () => {
          if (!pkgFormatDraft) return;
          onUpdatePackagingFormats(packagingFormats.filter(pf => pf.id !== pkgFormatDraft.id));
          setPkgFormatDraft(null);
        }}
        deleteConfirmMessage={pkgFormatDraft ? `Delete packaging format "${pkgFormatDraft.name || pkgFormatDraft.id}"? This cannot be undone.` : undefined}
        saveDisabled={!pkgFormatDraft?.name.trim()}
      >
        {pkgFormatDraft && (
          pkgFormatMode === 'view' ? (
            <>
              <DetailRow label="Code" value={pkgFormatDraft.code} mono bold />
              <DetailRow label="Name" value={pkgFormatDraft.name} bold />
              <DetailRow label="Description" value={pkgFormatDraft.description} />
              <DetailRow label="Packaging Line" value={pkgFormatDraft.packagingLine} />
              <DetailRow label="Location" value={pkgFormatDraft.location} />
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <DetailField label="Code">
                  <input
                    value={pkgFormatDraft.code}
                    onChange={(e) => setPkgFormatDraft(d => d ? { ...d, code: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm font-mono outline-none focus:bg-white"
                    placeholder="e.g. BAG, TOT"
                  />
                </DetailField>
                <div className="col-span-2">
                  <DetailField label="Name" required>
                    <input
                      value={pkgFormatDraft.name}
                      onChange={(e) => setPkgFormatDraft(d => d ? { ...d, name: e.target.value } : d)}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      placeholder="e.g. Bulk Bag, 25kg Bag, Tote"
                    />
                  </DetailField>
                </div>
              </div>
              <DetailField label="Description">
                <textarea
                  value={pkgFormatDraft.description}
                  onChange={(e) => setPkgFormatDraft(d => d ? { ...d, description: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-20 resize-none outline-none focus:bg-white"
                  placeholder="Describe this packaging format"
                />
              </DetailField>
              <DetailField label="Packaging Line">
                <input
                  value={pkgFormatDraft.packagingLine}
                  onChange={(e) => setPkgFormatDraft(d => d ? { ...d, packagingLine: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  placeholder="e.g. Line 1, Line 2"
                />
              </DetailField>
              <DetailField label="Location">
                <select
                  value={pkgFormatDraft.location}
                  onChange={(e) => setPkgFormatDraft(d => d ? { ...d, location: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                >
                  <option value="">Select Location</option>
                  {locations.filter(l => l.active !== false).map(loc => (
                    <option key={loc.id} value={loc.name}>{loc.name}</option>
                  ))}
                </select>
              </DetailField>
            </div>
          )
        )}
      </DetailModal>

      {/* Naming Formulas — standardized DataTable + DetailModal. */}
      <DataTable<NamingFormula>
        title="Naming Formulas"
        columns={[
          {
            key: 'type', label: 'Type', widthClass: 'w-32',
            render: (nf) => (
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                nf.type === 'Product Name' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
              }`}>{nf.type}</span>
            ),
            sortValue: (nf) => nf.type,
          },
          { key: 'name', label: 'Name', bold: true },
          { key: 'condition', label: 'Condition', mono: true },
          { key: 'formula', label: 'Formula', mono: true },
          { key: 'priority', label: 'Priority', align: 'center', bold: true, mono: true, widthClass: 'w-20' },
          { key: 'description', label: 'Description' },
        ]}
        rows={namingFormulas}
        getRowKey={(nf) => nf.id}
        onRowClick={(nf) => {
          setNamingFormulaDraft({ ...nf, tokens: nf.tokens ? [...nf.tokens] : [] });
          setNamingFormulaMode('view');
          setTokenPickerCategory('field');
          setTokenPickerValue('');
          setLiteralText('');
        }}
        onAdd={() => {
          setNamingFormulaDraft({
            id: `NF-${Date.now()}`,
            type: 'Short Form',
            name: '',
            condition: 'Default',
            formula: '',
            description: '',
            priority: 50,
            tokens: [],
          });
          setNamingFormulaMode('add');
          setTokenPickerCategory('field');
          setTokenPickerValue('');
          setLiteralText('');
        }}
        addLabel="Add Naming Formula"
        emptyMessage="No naming formulas added yet."
        defaultSortKey="priority"
      />

      {/* Naming Formula DetailModal — formula token builder lives inside.
          The token-builder is too specialized for the basic Detail layout, so
          we drop it in as-is with view/edit branching. */}
      <DetailModal
        tableName="Naming Formulas"
        isOpen={!!namingFormulaDraft}
        mode={namingFormulaMode}
        onClose={() => setNamingFormulaDraft(null)}
        onEdit={() => setNamingFormulaMode('edit')}
        onSave={() => {
          if (!namingFormulaDraft) return;
          if (!namingFormulaDraft.name.trim() || (namingFormulaDraft.tokens || []).length === 0) return;
          const computedFormula = tokensToFormulaString(namingFormulaDraft.tokens || []);
          const final: NamingFormula = { ...namingFormulaDraft, formula: computedFormula };
          if (namingFormulaMode === 'add') {
            onUpdateNamingFormulas([...namingFormulas, final]);
          } else {
            onUpdateNamingFormulas(namingFormulas.map(nf => nf.id === final.id ? final : nf));
          }
          setNamingFormulaDraft(null);
        }}
        onDelete={namingFormulaMode === 'add' ? undefined : () => {
          if (!namingFormulaDraft) return;
          onUpdateNamingFormulas(namingFormulas.filter(nf => nf.id !== namingFormulaDraft.id));
          setNamingFormulaDraft(null);
        }}
        deleteConfirmMessage={namingFormulaDraft ? `Delete naming formula "${namingFormulaDraft.name || namingFormulaDraft.id}"? This cannot be undone.` : undefined}
        saveDisabled={!namingFormulaDraft?.name.trim() || (namingFormulaDraft?.tokens || []).length === 0}
      >
        {namingFormulaDraft && (
          namingFormulaMode === 'view' ? (
            <>
              <DetailRow
                label="Type"
                value={
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                    namingFormulaDraft.type === 'Product Name' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>{namingFormulaDraft.type}</span>
                }
              />
              <DetailRow label="Name" value={namingFormulaDraft.name} bold />
              <DetailRow label="Condition" value={namingFormulaDraft.condition} mono />
              <DetailRow label="Formula" value={namingFormulaDraft.formula} mono />
              <DetailRow label="Priority" value={namingFormulaDraft.priority} bold mono />
              <DetailRow label="Description" value={namingFormulaDraft.description} />
              <DetailRow
                label="Preview"
                value={
                  <span className="font-mono font-bold">
                    {(namingFormulaDraft.tokens || []).length > 0 ? tokensToPreview(namingFormulaDraft.tokens || []) : '—'}
                  </span>
                }
              />
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <DetailField label="Type" required>
                  <select
                    value={namingFormulaDraft.type}
                    onChange={(e) => setNamingFormulaDraft(d => d ? { ...d, type: e.target.value as 'Product Name' | 'Short Form' } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  >
                    <option value="Short Form">Short Form</option>
                    <option value="Product Name">Product Name</option>
                  </select>
                </DetailField>
                <DetailField label="Priority" hint="Lower = applied first.">
                  <input
                    type="number"
                    value={namingFormulaDraft.priority}
                    onChange={(e) => setNamingFormulaDraft(d => d ? { ...d, priority: parseInt(e.target.value) || 0 } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  />
                </DetailField>
              </div>
              <DetailField label="Name" required>
                <input
                  value={namingFormulaDraft.name}
                  onChange={(e) => setNamingFormulaDraft(d => d ? { ...d, name: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  placeholder="e.g. Default Short Form, Bulk Short Form"
                />
              </DetailField>
              <DetailField label="Condition">
                <input
                  value={namingFormulaDraft.condition}
                  onChange={(e) => setNamingFormulaDraft(d => d ? { ...d, condition: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm font-mono outline-none focus:bg-white"
                  placeholder="e.g. Default, Product Group = Bulk, Sugar Type = Molasses"
                />
              </DetailField>
              <DetailField label="Formula Builder" required>
                {/* Token picker */}
                <div className="bg-[#F5F5F5] border border-[#141414]/30 p-3 space-y-2">
                  <div className="flex gap-2 items-center">
                    <select
                      value={tokenPickerCategory}
                      onChange={(e) => { setTokenPickerCategory(e.target.value); setTokenPickerValue(''); }}
                      className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                    >
                      <option value="field">Product Field</option>
                      <option value="productGroup">Product Group Name</option>
                      <option value="productGroupCode">Product Group BOL Code</option>
                      <option value="sugarType">Sugar Type Name</option>
                      <option value="sugarTypeAbbr">Sugar Type Abbreviation</option>
                      <option value="literal">Literal Text</option>
                    </select>
                    {tokenPickerCategory === 'field' && (
                      <select
                        value={tokenPickerValue}
                        onChange={(e) => setTokenPickerValue(e.target.value)}
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      >
                        <option value="">Select Field...</option>
                        <option value="productFormat">Product Format</option>
                        <option value="productGroup">Product Group</option>
                        <option value="category">Conv./Organic</option>
                        <option value="coChar">C/B Character</option>
                        <option value="sugarType">Sugar Type</option>
                        <option value="sugarTypeAbbreviation">Sugar Type Abbreviation</option>
                        <option value="productGroupBolCode">Product Group BOL Code</option>
                        <option value="location">Location</option>
                        <option value="netWeightKg">Net Weight (KG)</option>
                        <option value="grossWeightKg">Gross Weight (KG)</option>
                        <option value="maxColor">Max Color</option>
                      </select>
                    )}
                    {tokenPickerCategory === 'productGroup' && (
                      <select
                        value={tokenPickerValue}
                        onChange={(e) => setTokenPickerValue(e.target.value)}
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      >
                        <option value="">Select Group...</option>
                        {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                      </select>
                    )}
                    {tokenPickerCategory === 'productGroupCode' && (
                      <select
                        value={tokenPickerValue}
                        onChange={(e) => setTokenPickerValue(e.target.value)}
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      >
                        <option value="">Select Code...</option>
                        {productGroups.map(pg => <option key={pg.id} value={pg.bolCode}>{pg.name} → {pg.bolCode}</option>)}
                      </select>
                    )}
                    {tokenPickerCategory === 'sugarType' && (
                      <select
                        value={tokenPickerValue}
                        onChange={(e) => setTokenPickerValue(e.target.value)}
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      >
                        <option value="">Select Type...</option>
                        {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                      </select>
                    )}
                    {tokenPickerCategory === 'sugarTypeAbbr' && (
                      <select
                        value={tokenPickerValue}
                        onChange={(e) => setTokenPickerValue(e.target.value)}
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      >
                        <option value="">Select Abbreviation...</option>
                        {sugarTypes.map(st => <option key={st.id} value={st.abbreviation}>{st.name} → {st.abbreviation}</option>)}
                      </select>
                    )}
                    {tokenPickerCategory === 'literal' && (
                      <input
                        value={literalText}
                        onChange={(e) => setLiteralText(e.target.value)}
                        placeholder='e.g. "kg ", " ", "MOL"'
                        className="bg-white border border-[#141414] p-2 text-xs outline-none flex-1"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        let newToken: FormulaToken | null = null;
                        const id = `tk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                        if (tokenPickerCategory === 'field' && tokenPickerValue) {
                          const labelMap: Record<string, string> = {
                            productFormat: 'Product Format',
                            productGroup: 'Product Group',
                            category: 'Conv./Organic',
                            coChar: 'C/B Character',
                            sugarType: 'Sugar Type',
                            sugarTypeAbbreviation: 'Sugar Type Abbreviation',
                            productGroupBolCode: 'Product Group BOL Code',
                            location: 'Location',
                            netWeightKg: 'Net Weight (KG)',
                            grossWeightKg: 'Gross Weight (KG)',
                            maxColor: 'Max Color',
                          };
                          newToken = { id, type: 'field', value: tokenPickerValue, label: labelMap[tokenPickerValue] || tokenPickerValue };
                        } else if (tokenPickerCategory === 'productGroup' && tokenPickerValue) {
                          newToken = { id, type: 'productGroup', value: tokenPickerValue, label: `Group: ${tokenPickerValue}` };
                        } else if (tokenPickerCategory === 'productGroupCode' && tokenPickerValue) {
                          newToken = { id, type: 'productGroupCode', value: tokenPickerValue, label: `Code: ${tokenPickerValue}` };
                        } else if (tokenPickerCategory === 'sugarType' && tokenPickerValue) {
                          newToken = { id, type: 'sugarType', value: tokenPickerValue, label: `Type: ${tokenPickerValue}` };
                        } else if (tokenPickerCategory === 'sugarTypeAbbr' && tokenPickerValue) {
                          newToken = { id, type: 'sugarTypeAbbr', value: tokenPickerValue, label: `Abbr: ${tokenPickerValue}` };
                        } else if (tokenPickerCategory === 'literal' && literalText) {
                          newToken = { id, type: 'literal', value: literalText, label: `"${literalText}"` };
                        }
                        if (newToken) {
                          setNamingFormulaDraft(d => d ? { ...d, tokens: [...(d.tokens || []), newToken!] } : d);
                          setTokenPickerValue('');
                          setLiteralText('');
                        }
                      }}
                      className="bg-[#141414] text-[#E4E3E0] px-3 py-2 text-[10px] font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-1"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>

                {/* Token list with drag-and-drop */}
                <div className="bg-white border border-[#141414]/30 p-3 min-h-[60px] mt-2">
                  <div className="text-[10px] uppercase font-bold opacity-50 mb-2">Formula Components (drag to reorder)</div>
                  {(namingFormulaDraft.tokens || []).length === 0 ? (
                    <div className="text-xs opacity-40 italic py-2">No components yet. Use the picker above to add fields, text, or values.</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(namingFormulaDraft.tokens || []).map((token, idx) => (
                        <div
                          key={token.id}
                          draggable
                          onDragStart={() => setDraggedTokenIdx(idx)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedTokenIdx === null || draggedTokenIdx === idx) return;
                            setNamingFormulaDraft(d => {
                              if (!d) return d;
                              const newTokens = [...(d.tokens || [])];
                              const [moved] = newTokens.splice(draggedTokenIdx, 1);
                              newTokens.splice(idx, 0, moved);
                              return { ...d, tokens: newTokens };
                            });
                            setDraggedTokenIdx(null);
                          }}
                          onDragEnd={() => setDraggedTokenIdx(null)}
                          className={`flex items-center gap-2 px-2 py-1 border border-[#141414] cursor-move transition-all ${
                            draggedTokenIdx === idx ? 'opacity-30' : 'opacity-100'
                          } ${
                            token.type === 'literal' ? 'bg-amber-50' :
                            token.type === 'field' ? 'bg-blue-50' :
                            token.type === 'productGroup' || token.type === 'productGroupCode' ? 'bg-emerald-50' :
                            'bg-purple-50'
                          }`}
                        >
                          <span className="text-[10px] opacity-40">≡</span>
                          <span className="text-xs font-bold">{token.label}</span>
                          <button
                            type="button"
                            onClick={() => setNamingFormulaDraft(d => d ? { ...d, tokens: (d.tokens || []).filter(t => t.id !== token.id) } : d)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preview */}
                <div className="bg-[#141414] text-[#E4E3E0] border border-[#141414] p-3 mt-2">
                  <div className="text-[10px] uppercase font-bold opacity-60 mb-1">Preview (with sample values)</div>
                  <div className="text-sm font-mono font-bold">
                    {(namingFormulaDraft.tokens || []).length > 0 ? tokensToPreview(namingFormulaDraft.tokens || []) : <span className="opacity-40">—</span>}
                  </div>
                  <div className="text-[9px] opacity-50 mt-2 font-mono">
                    Formula: {(namingFormulaDraft.tokens || []).length > 0 ? tokensToFormulaString(namingFormulaDraft.tokens || []) : '—'}
                  </div>
                </div>
              </DetailField>
              <DetailField label="Description">
                <textarea
                  value={namingFormulaDraft.description || ''}
                  onChange={(e) => setNamingFormulaDraft(d => d ? { ...d, description: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-20 resize-none outline-none focus:bg-white"
                  placeholder="Explain when this rule applies"
                />
              </DetailField>
            </div>
          )
        )}
      </DetailModal>

      {/* Product Groups — standardized DataTable + DetailModal. */}
      <DataTable<ProductGroup>
        title="Product Groups"
        columns={[
          { key: 'name', label: 'Group Name', bold: true },
          { key: 'bolCode', label: 'BOL Code', mono: true, bold: true, widthClass: 'w-32' },
          {
            key: 'color',
            label: 'Color',
            sortValue: (pg) => pg.color,
            render: (pg) => (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border border-[#141414]/20" style={{ backgroundColor: pg.color }} />
                <span className="text-[10px] opacity-50 font-mono">{pg.color}</span>
              </div>
            ),
          },
        ]}
        rows={productGroups}
        getRowKey={(pg) => pg.id}
        onRowClick={(pg) => { setProductGroupDraft({ ...pg }); setProductGroupMode('view'); }}
        onAdd={() => { setProductGroupDraft({ id: `PG-${Date.now()}`, name: '', bolCode: '', color: '#E4E3E0' }); setProductGroupMode('add'); }}
        addLabel="Add Product Group"
        emptyMessage="No product groups added yet."
        defaultSortKey="name"
      />

      <DetailModal
        tableName="Product Groups"
        isOpen={!!productGroupDraft}
        mode={productGroupMode}
        onClose={() => setProductGroupDraft(null)}
        onEdit={() => setProductGroupMode('edit')}
        onSave={() => {
          if (!productGroupDraft) return;
          if (!productGroupDraft.name.trim()) return;
          if (productGroupMode === 'add') {
            onUpdateProductGroups([...productGroups, productGroupDraft]);
          } else {
            onUpdateProductGroups(productGroups.map(pg => pg.id === productGroupDraft.id ? productGroupDraft : pg));
          }
          setProductGroupDraft(null);
        }}
        onDelete={productGroupMode === 'add' ? undefined : () => {
          if (!productGroupDraft) return;
          onUpdateProductGroups(productGroups.filter(pg => pg.id !== productGroupDraft.id));
          setProductGroupDraft(null);
        }}
        deleteConfirmMessage={productGroupDraft ? `Delete product group "${productGroupDraft.name || productGroupDraft.id}"? This cannot be undone.` : undefined}
        saveDisabled={!productGroupDraft?.name.trim()}
      >
        {productGroupDraft && (
          productGroupMode === 'view' ? (
            <>
              <DetailRow label="Group Name" value={productGroupDraft.name} bold />
              <DetailRow label="BOL Code" value={productGroupDraft.bolCode} mono bold />
              <DetailRow
                label="Color"
                value={
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 border border-[#141414]/20" style={{ backgroundColor: productGroupDraft.color }} />
                    <span className="font-mono">{productGroupDraft.color}</span>
                  </div>
                }
              />
            </>
          ) : (
            <div className="space-y-4">
              <DetailField label="Group Name" required>
                <input
                  value={productGroupDraft.name}
                  onChange={(e) => setProductGroupDraft(d => d ? { ...d, name: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  placeholder="e.g. Bulk, Bagged, Tote"
                />
              </DetailField>
              <DetailField label="BOL Code" hint="Single-letter prefix used in BOL numbers (e.g., B for Bulk, L for Liquid).">
                <input
                  value={productGroupDraft.bolCode || ''}
                  onChange={(e) => setProductGroupDraft(d => d ? { ...d, bolCode: e.target.value.toUpperCase().slice(0, 1) } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm font-mono outline-none focus:bg-white"
                  placeholder="e.g. B, P, T, L"
                  maxLength={1}
                />
              </DetailField>
              <DetailField label="Color">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={productGroupDraft.color}
                    onChange={(e) => setProductGroupDraft(d => d ? { ...d, color: e.target.value } : d)}
                    className="w-12 h-10 border border-[#141414] cursor-pointer"
                  />
                  <input
                    value={productGroupDraft.color}
                    onChange={(e) => setProductGroupDraft(d => d ? { ...d, color: e.target.value } : d)}
                    className="flex-1 bg-[#F5F5F5] border border-[#141414] p-3 text-sm font-mono outline-none focus:bg-white"
                  />
                </div>
              </DetailField>
            </div>
          )
        )}
      </DetailModal>

      {/* Sugar Types — standardized DataTable + DetailModal. */}
      <DataTable<SugarType>
        title="Sugar Types"
        columns={[
          { key: 'name', label: 'Sugar Type', bold: true },
          { key: 'abbreviation', label: 'Abbreviation', mono: true, bold: true },
          {
            key: 'productCount',
            label: 'Products',
            align: 'right',
            mono: true,
            render: (st) => qaProducts.filter(q => q.sugarType === st.name).length,
            sortValue: (st) => qaProducts.filter(q => q.sugarType === st.name).length,
          },
        ]}
        rows={sugarTypes}
        getRowKey={(st) => st.id}
        onRowClick={(st) => { setSugarTypeDraft({ ...st }); setSugarTypeMode('view'); }}
        onAdd={() => { setSugarTypeDraft({ id: `ST-${Date.now()}`, name: '', abbreviation: '' }); setSugarTypeMode('add'); }}
        addLabel="Add Sugar Type"
        emptyMessage="No sugar types added yet."
        defaultSortKey="name"
      />

      <DetailModal
        tableName="Sugar Types"
        isOpen={!!sugarTypeDraft}
        mode={sugarTypeMode}
        onClose={() => setSugarTypeDraft(null)}
        onEdit={() => setSugarTypeMode('edit')}
        onSave={() => {
          if (!sugarTypeDraft) return;
          if (!sugarTypeDraft.name.trim()) return;
          if (sugarTypeMode === 'add') {
            onUpdateSugarTypes([...sugarTypes, sugarTypeDraft]);
          } else {
            onUpdateSugarTypes(sugarTypes.map(st => st.id === sugarTypeDraft.id ? sugarTypeDraft : st));
          }
          setSugarTypeDraft(null);
        }}
        onDelete={sugarTypeMode === 'add' ? undefined : () => {
          if (!sugarTypeDraft) return;
          onUpdateSugarTypes(sugarTypes.filter(st => st.id !== sugarTypeDraft.id));
          setSugarTypeDraft(null);
        }}
        deleteConfirmMessage={sugarTypeDraft ? `Delete sugar type "${sugarTypeDraft.name || sugarTypeDraft.id}"? This cannot be undone.` : undefined}
        saveDisabled={!sugarTypeDraft?.name.trim()}
      >
        {sugarTypeDraft && (
          sugarTypeMode === 'view' ? (
            <>
              <DetailRow label="Sugar Type" value={sugarTypeDraft.name} bold />
              <DetailRow label="Abbreviation" value={sugarTypeDraft.abbreviation} mono bold />
              <DetailRow
                label="Products"
                value={qaProducts.filter(q => q.sugarType === sugarTypeDraft.name).length}
                mono
              />
            </>
          ) : (
            <div className="space-y-4">
              <DetailField label="Sugar Type Name" required>
                <input
                  value={sugarTypeDraft.name}
                  onChange={(e) => setSugarTypeDraft(d => d ? { ...d, name: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  placeholder="e.g. Granulated, Liquid, Brown"
                />
              </DetailField>
              <DetailField label="Abbreviation" hint="Short code used in product shortform (e.g., GC for Granulated).">
                <input
                  value={sugarTypeDraft.abbreviation}
                  onChange={(e) => setSugarTypeDraft(d => d ? { ...d, abbreviation: e.target.value.toUpperCase().slice(0, 4) } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm font-mono outline-none focus:bg-white"
                  placeholder="e.g. GC, LC, BR"
                  maxLength={4}
                />
              </DetailField>
            </div>
          )
        )}
      </DetailModal>

      {/* Templates Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h3 className="text-xs font-bold uppercase tracking-widest">Templates</h3>
            <span className="text-[10px] opacity-60">{qaTemplates.length} templates</span>
          </div>
          <button
            onClick={() => {
              setEditingTemplate(null);
              setTemplateForm({ name: '', type: 'Bill of Lading', googleSheetUrl: '', description: '' });
              setShowTemplateModal(true);
            }}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-[10px] font-bold uppercase tracking-widest transition-all"
          >
            <Plus size={12} /> Add Template
          </button>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#F5F5F5] text-[#141414] text-[10px] uppercase font-bold tracking-widest border-b border-[#141414]/10">
              <th className="p-4">Name</th>
              <th className="p-4">Type</th>
              <th className="p-4">Description</th>
              <th className="p-4">Google Sheet</th>
              <th className="p-4">Last Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10">
            {/* Standard pattern: row click opens the Templates Detail modal;
                edit / delete live inside it. No Actions column. */}
            {qaTemplates.map(template => (
              <tr
                key={template.id}
                onClick={() => {
                  setEditingTemplate(template);
                  setTemplateForm({
                    name: template.name,
                    type: template.type,
                    googleSheetUrl: template.googleSheetUrl,
                    description: template.description || '',
                  });
                  setShowTemplateModal(true);
                }}
                className="hover:bg-[#F9F9F9] transition-colors cursor-pointer"
              >
                <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{template.name}</td>
                <td className="p-4 text-xs border-r border-[#141414]/10">
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                    template.type === 'Bill of Lading' ? 'bg-blue-100 text-blue-700' :
                    template.type === 'Certificate of Analysis' ? 'bg-emerald-100 text-emerald-700' :
                    template.type === 'Packing List' ? 'bg-amber-100 text-amber-700' :
                    template.type === 'Order Confirmation' ? 'bg-purple-100 text-purple-700' :
                    template.type === 'Return Order Confirmation' ? 'bg-rose-100 text-rose-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>{template.type}</span>
                </td>
                <td className="p-4 text-xs border-r border-[#141414]/10 opacity-70">{template.description || '—'}</td>
                <td className="p-4 text-xs border-r border-[#141414]/10">
                  {template.googleSheetUrl ? (
                    <a
                      href={template.googleSheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline font-bold"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink size={12} /> Open Sheet
                    </a>
                  ) : '—'}
                </td>
                <td className="p-4 text-xs opacity-60">{template.updatedAt ? new Date(template.updatedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {qaTemplates.length === 0 && (
              <tr><td colSpan={5} className="p-12 text-center text-xs opacity-50 italic">No templates added yet. Add a Bill of Lading, Certificate of Analysis, or Packing List template.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Template Modal */}
      <AnimatePresence>
        {showTemplateModal && (
          <div className="fixed inset-0 z-[100] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[8px_8px_0px_0px_rgba(20,20,20,1)] max-w-lg w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">{editingTemplate ? 'Templates Detail' : 'New Template'}</h3>
                <button onClick={() => setShowTemplateModal(false)} className="p-1 hover:bg-white/20 transition-all"><X size={16} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Template Name *</label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                    placeholder="e.g. Standard Bill of Lading"
                    className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Template Type *</label>
                  <select
                    value={templateForm.type}
                    onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value as QATemplate['type'] })}
                    className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  >
                    <option value="Bill of Lading">Bill of Lading</option>
                    <option value="Certificate of Analysis">Certificate of Analysis</option>
                    <option value="Packing List">Packing List</option>
                    <option value="Order Confirmation">Order Confirmation</option>
                    <option value="Return Order Confirmation">Return Order Confirmation</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Google Sheet URL *</label>
                  <input
                    type="url"
                    value={templateForm.googleSheetUrl}
                    onChange={(e) => setTemplateForm({ ...templateForm, googleSheetUrl: e.target.value })}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                  <p className="text-[9px] opacity-50 mt-1">Paste the full URL of your Google Sheet template. Make sure the sheet is shared with anyone who needs access.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-60">Description</label>
                  <textarea
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                    placeholder="Optional description of this template..."
                    rows={2}
                    className="w-full bg-white border border-[#141414] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
                <div className="flex justify-between gap-2 pt-4 border-t border-[#141414]/10">
                  <div>
                    {/* Delete moved into the modal (standard pattern). Reuses
                        the existing delete-confirm dialog. */}
                    {editingTemplate && (
                      <button
                        onClick={() => {
                          setShowTemplateModal(false);
                          setDeleteTemplateConfirmId(editingTemplate.id);
                        }}
                        className="px-4 py-2 border border-red-500 text-red-600 text-xs font-bold uppercase hover:bg-red-500 hover:text-white transition-all flex items-center gap-2"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                  <button
                    onClick={() => setShowTemplateModal(false)}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!templateForm.name || !templateForm.googleSheetUrl) return;
                      const now = new Date().toISOString();
                      if (editingTemplate) {
                        const updated: QATemplate = {
                          ...editingTemplate,
                          name: templateForm.name,
                          type: templateForm.type,
                          googleSheetUrl: templateForm.googleSheetUrl,
                          description: templateForm.description,
                          updatedAt: now,
                        };
                        onUpdateTemplates(qaTemplates.map(t => t.id === editingTemplate.id ? updated : t));
                      } else {
                        const newTemplate: QATemplate = {
                          id: `TMPL-${Date.now()}`,
                          name: templateForm.name,
                          type: templateForm.type,
                          googleSheetUrl: templateForm.googleSheetUrl,
                          description: templateForm.description,
                          createdAt: now,
                          updatedAt: now,
                        };
                        onUpdateTemplates([...qaTemplates, newTemplate]);
                      }
                      setShowTemplateModal(false);
                      setEditingTemplate(null);
                    }}
                    className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                  >
                    {editingTemplate ? 'Save Changes' : 'Add Template'}
                  </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Template Confirmation */}
      <AnimatePresence>
        {deleteTemplateConfirmId && (
          <div className="fixed inset-0 z-[100] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full p-6 space-y-4"
            >
              <h3 className="text-xs font-bold uppercase tracking-widest">Delete Template</h3>
              <p className="text-sm opacity-70">Are you sure you want to delete this template? This action cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setDeleteTemplateConfirmId(null)}
                  className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">Cancel</button>
                <button onClick={() => {
                  onUpdateTemplates(qaTemplates.filter(t => t.id !== deleteTemplateConfirmId));
                  setDeleteTemplateConfirmId(null);
                }} className="px-4 py-2 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-all">Delete</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden file inputs for audit documents */}
      <input type="file" ref={gfsiReportRef} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => handleAuditDocUpload(e, 'gfsiAuditReport', setIsUploadingGfsiReport)} />
      <input type="file" ref={gfsiCertRef} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => handleAuditDocUpload(e, 'gfsiAuditCertificate', setIsUploadingGfsiCert)} />
      <input type="file" ref={organicReportRef} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => handleAuditDocUpload(e, 'organicAuditReport', setIsUploadingOrganicReport)} />
      <input type="file" ref={organicCertRef} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => handleAuditDocUpload(e, 'organicAuditCertificate', setIsUploadingOrganicCert)} />

      {/* Location Detail Card Modal */}
      <AnimatePresence>
        {selectedLocation && editLocationData && (
          <div className="fixed inset-0 z-[100] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center sticky top-0 z-10">
                <h3 className="text-xs font-bold uppercase tracking-widest">Location: {(isEditingLocation ? editLocationData : selectedLocation).name || 'New Location'}</h3>
                <button onClick={closeLocationDetail} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Section 1: Location Details */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Location Details</div>
                  {isEditingLocation ? (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Location Code</label>
                        <input value={editLocationData.locationCode || ''} onChange={(e) => setEditLocationData({ ...editLocationData, locationCode: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 100" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Name</label>
                        <input value={editLocationData.name || ''} onChange={(e) => setEditLocationData({ ...editLocationData, name: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Location Name" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Address</label>
                        <input value={editLocationData.address || ''} onChange={(e) => setEditLocationData({ ...editLocationData, address: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Address" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">City</label>
                        <input value={editLocationData.city || ''} onChange={(e) => setEditLocationData({ ...editLocationData, city: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="City" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Province</label>
                        <input value={editLocationData.province || ''} onChange={(e) => setEditLocationData({ ...editLocationData, province: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Province" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Postal Code</label>
                        <input value={editLocationData.postalCode || ''} onChange={(e) => setEditLocationData({ ...editLocationData, postalCode: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Postal Code" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Active</label>
                        <select
                          value={editLocationData.active === false ? 'No' : 'Yes'}
                          onChange={(e) => setEditLocationData({ ...editLocationData, active: e.target.value === 'Yes' })}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          title="Inactive locations are hidden from all location dropdowns across the app"
                        >
                          <option value="Yes">Yes</option>
                          <option value="No">No</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4">
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Code</div><div className="text-xs font-bold font-mono">{selectedLocation.locationCode || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Name</div><div className="text-xs font-bold">{selectedLocation.name || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Address</div><div className="text-xs font-bold">{selectedLocation.address || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">City</div><div className="text-xs font-bold">{selectedLocation.city || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Province</div><div className="text-xs font-bold">{selectedLocation.province || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Postal Code</div><div className="text-xs font-bold">{selectedLocation.postalCode || '—'}</div></div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Active</div>
                        <div className="text-xs font-bold">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase ${selectedLocation.active !== false ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {selectedLocation.active !== false ? 'Yes' : 'No'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 2: GFSI Audit */}
                {(() => {
                  const data = isEditingLocation ? editLocationData : selectedLocation;
                  return (
                    <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                      <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">GFSI Audit</div>
                      {isEditingLocation ? (
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Certified Start Date</label>
                            <input type="date" value={editLocationData.gfsiAuditStartDate || ''} onChange={(e) => setEditLocationData({ ...editLocationData, gfsiAuditStartDate: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Certified End Date</label>
                            <input type="date" value={editLocationData.gfsiAuditEndDate || ''} onChange={(e) => setEditLocationData({ ...editLocationData, gfsiAuditEndDate: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Audit Certifier</label>
                            <input value={editLocationData.gfsiAuditCertifier || ''} onChange={(e) => setEditLocationData({ ...editLocationData, gfsiAuditCertifier: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Certifying body" />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-4">
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Start Date</div><div className="text-xs font-bold">{data.gfsiAuditStartDate || '—'}</div></div>
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">End Date</div><div className="text-xs font-bold">{data.gfsiAuditEndDate || '—'}</div></div>
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Certifier</div><div className="text-xs font-bold">{data.gfsiAuditCertifier || '—'}</div></div>
                        </div>
                      )}
                      {/* Audit Report */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold opacity-40">Audit Report</div>
                        {data.gfsiAuditReport ? (
                          <div className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                            <div className="flex items-center gap-3">
                              <FileText size={16} className="text-[#141414]/50" />
                              <div>
                                <div className="text-xs font-bold">{data.gfsiAuditReport.filename}</div>
                                <div className="text-[10px] opacity-50">Uploaded {new Date(data.gfsiAuditReport.uploadedAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <a href={data.gfsiAuditReport.url} download={data.gfsiAuditReport.filename} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download"><Download size={14} /></a>
                              {isEditingLocation && <button onClick={() => deleteAuditDoc('gfsiAuditReport')} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={14} /></button>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs opacity-40 italic">No report uploaded</div>
                        )}
                        {isEditingLocation && !data.gfsiAuditReport && (
                          <button onClick={() => gfsiReportRef.current?.click()} disabled={isUploadingGfsiReport} className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50">
                            {isUploadingGfsiReport ? <RefreshSpinner /> : <Upload size={12} />} {isUploadingGfsiReport ? 'Uploading...' : 'Upload Report'}
                          </button>
                        )}
                      </div>
                      {/* Audit Certificate */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold opacity-40">Audit Certificate</div>
                        {data.gfsiAuditCertificate ? (
                          <div className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                            <div className="flex items-center gap-3">
                              <FileText size={16} className="text-[#141414]/50" />
                              <div>
                                <div className="text-xs font-bold">{data.gfsiAuditCertificate.filename}</div>
                                <div className="text-[10px] opacity-50">Uploaded {new Date(data.gfsiAuditCertificate.uploadedAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <a href={data.gfsiAuditCertificate.url} download={data.gfsiAuditCertificate.filename} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download"><Download size={14} /></a>
                              {isEditingLocation && <button onClick={() => deleteAuditDoc('gfsiAuditCertificate')} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={14} /></button>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs opacity-40 italic">No certificate uploaded</div>
                        )}
                        {isEditingLocation && !data.gfsiAuditCertificate && (
                          <button onClick={() => gfsiCertRef.current?.click()} disabled={isUploadingGfsiCert} className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50">
                            {isUploadingGfsiCert ? <RefreshSpinner /> : <Upload size={12} />} {isUploadingGfsiCert ? 'Uploading...' : 'Upload Certificate'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Section 3: Organic Audit */}
                {(() => {
                  const data = isEditingLocation ? editLocationData : selectedLocation;
                  return (
                    <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                      <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Organic Audit</div>
                      {isEditingLocation ? (
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Certified Start Date</label>
                            <input type="date" value={editLocationData.organicAuditStartDate || ''} onChange={(e) => setEditLocationData({ ...editLocationData, organicAuditStartDate: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Certified End Date</label>
                            <input type="date" value={editLocationData.organicAuditEndDate || ''} onChange={(e) => setEditLocationData({ ...editLocationData, organicAuditEndDate: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Audit Certifier</label>
                            <input value={editLocationData.organicAuditCertifier || ''} onChange={(e) => setEditLocationData({ ...editLocationData, organicAuditCertifier: e.target.value })} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="Certifying body" />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-4">
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Start Date</div><div className="text-xs font-bold">{data.organicAuditStartDate || '—'}</div></div>
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">End Date</div><div className="text-xs font-bold">{data.organicAuditEndDate || '—'}</div></div>
                          <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Certifier</div><div className="text-xs font-bold">{data.organicAuditCertifier || '—'}</div></div>
                        </div>
                      )}
                      {/* Organic Report */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold opacity-40">Audit Report</div>
                        {data.organicAuditReport ? (
                          <div className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                            <div className="flex items-center gap-3">
                              <FileText size={16} className="text-[#141414]/50" />
                              <div>
                                <div className="text-xs font-bold">{data.organicAuditReport.filename}</div>
                                <div className="text-[10px] opacity-50">Uploaded {new Date(data.organicAuditReport.uploadedAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <a href={data.organicAuditReport.url} download={data.organicAuditReport.filename} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download"><Download size={14} /></a>
                              {isEditingLocation && <button onClick={() => deleteAuditDoc('organicAuditReport')} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={14} /></button>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs opacity-40 italic">No report uploaded</div>
                        )}
                        {isEditingLocation && !data.organicAuditReport && (
                          <button onClick={() => organicReportRef.current?.click()} disabled={isUploadingOrganicReport} className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50">
                            {isUploadingOrganicReport ? <RefreshSpinner /> : <Upload size={12} />} {isUploadingOrganicReport ? 'Uploading...' : 'Upload Report'}
                          </button>
                        )}
                      </div>
                      {/* Organic Certificate */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-bold opacity-40">Audit Certificate</div>
                        {data.organicAuditCertificate ? (
                          <div className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                            <div className="flex items-center gap-3">
                              <FileText size={16} className="text-[#141414]/50" />
                              <div>
                                <div className="text-xs font-bold">{data.organicAuditCertificate.filename}</div>
                                <div className="text-[10px] opacity-50">Uploaded {new Date(data.organicAuditCertificate.uploadedAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <a href={data.organicAuditCertificate.url} download={data.organicAuditCertificate.filename} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download"><Download size={14} /></a>
                              {isEditingLocation && <button onClick={() => deleteAuditDoc('organicAuditCertificate')} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete"><Trash2 size={14} /></button>}
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs opacity-40 italic">No certificate uploaded</div>
                        )}
                        {isEditingLocation && !data.organicAuditCertificate && (
                          <button onClick={() => organicCertRef.current?.click()} disabled={isUploadingOrganicCert} className="px-3 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50">
                            {isUploadingOrganicCert ? <RefreshSpinner /> : <Upload size={12} />} {isUploadingOrganicCert ? 'Uploading...' : 'Upload Certificate'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Action Buttons */}
                <div className="flex gap-4 pt-2">
                  {isEditingLocation ? (
                    <>
                      <button onClick={saveLocationChanges} className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all">
                        <CheckCircle2 size={16} /> Save Changes
                      </button>
                      <button onClick={() => { setIsEditingLocation(false); setEditLocationData({ ...selectedLocation }); }} className="flex-1 py-4 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setIsEditingLocation(true)} className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all">Edit Location</button>
                      <button onClick={closeLocationDetail} className="flex-1 py-4 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all">Close</button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden file inputs */}
      <input type="file" ref={packagingFileRef} className="hidden" accept="image/*" onChange={handlePackagingUpload} />
      <input type="file" ref={artworkFileRef} className="hidden" accept="image/*,.pdf" onChange={handleArtworkUpload} />
      <input type="file" ref={upcFileRef} className="hidden" accept="image/*" onChange={handleUpcUpload} />
      <input type="file" ref={specSheetFileRef} className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={handleSpecSheetUpload} />
      <input type="file" ref={certificateFileRef} className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={handleCertificateUpload} />

      {/* Add Product Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center sticky top-0 z-10">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Product</h3>
                <button onClick={() => setShowAddModal(false)} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                {/* Pre-fill from existing SKU (optional) */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Pre-fill from Existing Product (Optional)</div>
                  <select
                    value={selectedSkuId}
                    onChange={(e) => prefillFromSku(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                  >
                    <option value="">— Create from scratch —</option>
                    {skus.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.productGroup} - {s.location})</option>
                    ))}
                  </select>
                </div>

                {/* Product Details */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Details</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Packaging Format <span className="text-red-500">*</span></label>
                      <select
                        value={newProductData.productFormat || ''}
                        onChange={(e) => setNewProductData(prev => ({ ...prev, productFormat: e.target.value || undefined, skuName: e.target.value || prev.skuName }))}
                        className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                      >
                        <option value="">Select Packaging Format</option>
                        {packagingFormats.map(pf => (
                          <option key={pf.id} value={pf.name}>{pf.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Group</label>
                      <select value={newProductData.productGroup} onChange={(e) => setNewProductData(prev => ({ ...prev, productGroup: e.target.value }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                        <option value="">Auto (from packaging format)</option>
                        {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Conv./Organic</label>
                      <select value={newProductData.category} onChange={(e) => setNewProductData(prev => ({ ...prev, category: e.target.value as 'Conventional' | 'Organic' }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                        <option value="Conventional">Conventional</option>
                        <option value="Organic">Organic</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Sugar Type</label>
                      <select value={newProductData.sugarType || ''} onChange={(e) => setNewProductData(prev => ({ ...prev, sugarType: e.target.value || undefined }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                        <option value="">Select Sugar Type</option>
                        {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Location</label>
                      <select value={newProductData.location} onChange={(e) => setNewProductData(prev => ({ ...prev, location: e.target.value }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                        <option value="">Select Location</option>
                        {locations.filter(l => l.active !== false).map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Net Weight (KG)</label>
                      <input type="number" value={newProductData.netWeightKg || ''} onFocus={(e) => e.target.select()} onChange={(e) => setNewProductData(prev => ({ ...prev, netWeightKg: parseFloat(e.target.value) || 0 }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Gross Weight (KG)</label>
                      <input type="number" value={newProductData.grossWeightKg || ''} onFocus={(e) => e.target.select()} onChange={(e) => setNewProductData(prev => ({ ...prev, grossWeightKg: parseFloat(e.target.value) || 0 }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Max Color</label>
                      <input type="number" value={newProductData.maxColor || ''} onFocus={(e) => e.target.select()} onChange={(e) => setNewProductData(prev => ({ ...prev, maxColor: parseFloat(e.target.value) || 0 }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                    </div>
                  </div>

                  {/* Packaged-only fields — Case Pack + Selling Unit details.
                      Only rendered when Product Group is "Packaged" since case-pack /
                      selling-unit hierarchy is specific to packaged retail SKUs. */}
                  {newProductData.productGroup === 'Packaged' && (
                    <div className="grid grid-cols-4 gap-4 pt-3 border-t border-[#141414]/10">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack Qty</label>
                        <input
                          type="number"
                          value={newProductData.casePackQuantity || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setNewProductData(prev => ({ ...prev, casePackQuantity: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="Units per case"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack (kg)</label>
                        <input
                          type="number"
                          value={newProductData.casePackKg || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setNewProductData(prev => ({ ...prev, casePackKg: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="Total kg / case"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit Qty</label>
                        <input
                          type="number"
                          value={newProductData.sellingUnitQuantity || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setNewProductData(prev => ({ ...prev, sellingUnitQuantity: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="Selling units"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit (kg)</label>
                        <input
                          type="number"
                          value={newProductData.sellingUnitKg || ''}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setNewProductData(prev => ({ ...prev, sellingUnitKg: parseFloat(e.target.value) || 0 }))}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="kg per selling unit"
                        />
                      </div>
                    </div>
                  )}

                  {/* Locked calculated fields */}
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#141414]/10">
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Shortform (Auto)</label>
                      <div className="w-full bg-[#EFEFEF] border border-[#141414]/20 p-2 text-xs font-mono font-bold">
                        {(() => {
                          const resolved = resolveShortForm(namingFormulas, newProductData, { sugarTypes, productGroups });
                          if (resolved && resolved.trim()) return resolved;
                          if (newProductData.sugarType === 'Molasses') return 'MOL';
                          const st = sugarTypes.find(s => s.name === newProductData.sugarType);
                          if (!st) return '—';
                          const co = newProductData.category === 'Conventional' ? 'C' : 'B';
                          if (newProductData.productGroup === 'Bulk') return `${st.abbreviation}${co}${newProductData.maxColor || 0}`;
                          const wt = newProductData.netWeightKg ? `${newProductData.netWeightKg}kg ` : '';
                          return `${wt}${st.abbreviation}${co}${newProductData.maxColor || 0}`;
                        })()}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Name (Auto)</label>
                      <div className="w-full bg-[#EFEFEF] border border-[#141414]/20 p-2 text-xs">
                        {(() => {
                          const resolved = resolveProductName(namingFormulas, newProductData, { sugarTypes, productGroups });
                          if (resolved && resolved.trim()) return resolved;
                          return newProductData.productFormat && newProductData.sugarType
                            ? `${newProductData.netWeightKg ? `${newProductData.netWeightKg}kg ` : ''}${newProductData.productFormat} ${newProductData.sugarType} ${newProductData.category} ${newProductData.maxColor || 0}`
                            : '—';
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Specifications */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Specifications</div>
                  <div className="grid grid-cols-3 gap-4">
                    {(['brix', 'granulation', 'color', 'ash', 'turbidity', 'moisture'] as const).map(spec => (
                      <div key={spec}>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">{spec}</label>
                        <input
                          value={newProductData.specifications[spec] || ''}
                          onChange={(e) => setNewProductData(prev => ({ ...prev, specifications: { ...prev.specifications, [spec]: e.target.value } }))}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Packaging & UPC */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Packaging & UPC</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Packaging Supplier</label>
                      <select value={newProductData.packagingSupplier} onChange={(e) => setNewProductData(prev => ({ ...prev, packagingSupplier: e.target.value }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                        <option value="">Select Vendor</option>
                        {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">UPC Code</label>
                      <input value={newProductData.upcCode} onChange={(e) => setNewProductData(prev => ({ ...prev, upcCode: e.target.value }))} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" placeholder="UPC number" />
                    </div>
                  </div>
                </div>

                {/* Ti-Hi */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Pallet Configuration (Ti-Hi)</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Ti</label>
                      <input type="number" value={newProductData.ti || ''} onFocus={(e) => e.target.select()} onChange={(e) => { const ti = parseInt(e.target.value) || 0; setNewProductData(prev => ({ ...prev, ti, unitsPerPallet: ti * (prev.hi || 0) })); }} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Hi</label>
                      <input type="number" value={newProductData.hi || ''} onFocus={(e) => e.target.select()} onChange={(e) => { const hi = parseInt(e.target.value) || 0; setNewProductData(prev => ({ ...prev, hi, unitsPerPallet: (prev.ti || 0) * hi })); }} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Units per Pallet</label>
                      <div className="bg-white border border-[#141414]/20 p-2 text-xs font-bold">{(newProductData.ti || 0) * (newProductData.hi || 0) || '—'}</div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={handleAddProduct}
                    disabled={!newProductData.productFormat?.trim()}
                    className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-30"
                  >
                    <CheckCircle2 size={16} /> Add Product
                  </button>
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-4 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Product Detail Card Modal */}
      <AnimatePresence>
        {selectedProduct && displayData && !productModalMinimized && (
          <div className="fixed inset-0 z-[100] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={`bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] overflow-hidden overflow-y-auto transition-all ${productModalMaximized ? 'w-full h-full max-w-full max-h-full' : 'max-w-3xl w-full max-h-[90vh]'}`}
            >
              {/* Header */}
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center sticky top-0 z-10">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  {/* Title uses the resolved Product Name (same value as the
                      Product Name (Auto) row in Product Details). Falls back
                      to skuName / productFormat when no naming rule resolves. */}
                  Product QA: {(() => {
                    const resolved = resolveProductName(namingFormulas, displayData, { sugarTypes, productGroups });
                    if (resolved && resolved.trim()) return resolved;
                    if (displayData.productFormat && displayData.sugarType) {
                      return `${displayData.netWeightKg ? `${displayData.netWeightKg}kg ` : ''}${displayData.productFormat} ${displayData.sugarType} ${displayData.category} ${displayData.maxColor || 0}`;
                    }
                    return displayData.skuName || displayData.productFormat || '—';
                  })()}
                </h3>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); setProductModalMinimized(true); }} className="p-1 hover:bg-white/20 transition-all" title="Minimize"><Minus size={16} /></button>
                  <button onClick={(e) => { e.stopPropagation(); setProductModalMaximized(!productModalMaximized); }} className="p-1 hover:bg-white/20 transition-all" title={productModalMaximized ? 'Restore' : 'Maximize'}>{productModalMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                  <button onClick={closeDetail} className="p-1 hover:bg-white/20 transition-all" title="Close"><X size={16} /></button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {/* Section 0: Product Details (editable - syncs back to Products table) */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Details</div>
                  {isEditing ? (
                    <>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Number</label>
                        <input
                          type="text"
                          value={editData?.productCode || ''}
                          onChange={(e) => setEditData(prev => prev ? { ...prev, productCode: e.target.value || undefined } : prev)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs font-mono outline-none"
                          placeholder="e.g. 000001"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Packaging Format</label>
                        <select
                          value={editData?.productFormat || ''}
                          onChange={(e) => setEditData(prev => prev ? { ...prev, productFormat: e.target.value || undefined, skuName: e.target.value || prev.skuName } : prev)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                        >
                          <option value="">Select Packaging Format</option>
                          {packagingFormats.map(pf => (
                            <option key={pf.id} value={pf.name}>{pf.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Group</label>
                        <select value={editData?.productGroup || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, productGroup: e.target.value } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="">Auto (from packaging format)</option>
                          {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Conv./Organic</label>
                        <select value={editData?.category || 'Conventional'} onChange={(e) => setEditData(prev => prev ? { ...prev, category: e.target.value as 'Conventional' | 'Organic' } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="Conventional">Conventional</option>
                          <option value="Organic">Organic</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Sugar Type</label>
                        <select value={editData?.sugarType || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, sugarType: e.target.value || undefined } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="">Select Sugar Type</option>
                          {sugarTypes.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Location</label>
                        <select value={editData?.location || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, location: e.target.value } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="">Select Location</option>
                          {locations.filter(l => l.active !== false).map(loc => <option key={loc.id} value={loc.name}>{loc.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Net Weight (KG)</label>
                        <input type="number" value={editData?.netWeightKg || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, netWeightKg: parseFloat(e.target.value) || 0 } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Gross Weight (KG)</label>
                        <input type="number" value={editData?.grossWeightKg || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, grossWeightKg: parseFloat(e.target.value) || 0 } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Max Color</label>
                        <input type="number" value={editData?.maxColor || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, maxColor: parseFloat(e.target.value) || 0 } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Shortform (Auto)</label>
                        <div className="bg-[#EFEFEF] border border-[#141414]/20 p-2 text-xs font-mono font-bold">{(() => {
                          const resolved = editData ? resolveShortForm(namingFormulas, editData, { sugarTypes, productGroups }) : null;
                          if (resolved && resolved.trim()) return resolved;
                          if (editData?.sugarType === 'Molasses') return 'MOL';
                          const st = sugarTypes.find(s => s.name === editData?.sugarType);
                          if (!st) return '—';
                          const co = editData?.category === 'Conventional' ? 'C' : 'B';
                          if (editData?.productGroup === 'Bulk') return `${st.abbreviation}${co}${editData?.maxColor || 0}`;
                          const wt = editData?.netWeightKg ? `${editData.netWeightKg}kg ` : '';
                          return `${wt}${st.abbreviation}${co}${editData?.maxColor || 0}`;
                        })()}</div>
                      </div>
                    </div>
                    {/* Packaged-only edit fields — only shown when Product Group is "Packaged" */}
                    {editData?.productGroup === 'Packaged' && (
                      <div className="grid grid-cols-4 gap-4 pt-3 border-t border-[#141414]/10">
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack Qty</label>
                          <input
                            type="number"
                            value={editData?.casePackQuantity || ''}
                            onChange={(e) => setEditData(prev => prev ? { ...prev, casePackQuantity: parseFloat(e.target.value) || 0 } : prev)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                            placeholder="Units per case"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack (kg)</label>
                          <input
                            type="number"
                            value={editData?.casePackKg || ''}
                            onChange={(e) => setEditData(prev => prev ? { ...prev, casePackKg: parseFloat(e.target.value) || 0 } : prev)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                            placeholder="Total kg / case"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit Qty</label>
                          <input
                            type="number"
                            value={editData?.sellingUnitQuantity || ''}
                            onChange={(e) => setEditData(prev => prev ? { ...prev, sellingUnitQuantity: parseFloat(e.target.value) || 0 } : prev)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                            placeholder="Selling units"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit (kg)</label>
                          <input
                            type="number"
                            value={editData?.sellingUnitKg || ''}
                            onChange={(e) => setEditData(prev => prev ? { ...prev, sellingUnitKg: parseFloat(e.target.value) || 0 } : prev)}
                            className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                            placeholder="kg per selling unit"
                          />
                        </div>
                      </div>
                    )}
                    {/* Locked calculated fields */}
                    <div className="pt-3 border-t border-[#141414]/10">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Name (Auto)</label>
                        <div className="bg-[#EFEFEF] border border-[#141414]/20 p-2 text-xs">
                          {(() => {
                            const resolved = editData ? resolveProductName(namingFormulas, editData, { sugarTypes, productGroups }) : null;
                            if (resolved && resolved.trim()) return resolved;
                            return editData?.productFormat && editData?.sugarType
                              ? `${editData?.netWeightKg ? `${editData.netWeightKg}kg ` : ''}${editData.productFormat} ${editData.sugarType} ${editData.category} ${editData.maxColor || 0}`
                              : '—';
                          })()}
                        </div>
                      </div>
                    </div>
                    </>
                  ) : (
                    <>
                    <div className="grid grid-cols-5 gap-4">
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Packaging Format</div><div className="text-xs font-bold">{displayData.productFormat || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Group</div><div className="text-xs font-bold">{displayData.productGroup}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Conv./Organic</div><div className="text-xs font-bold">{displayData.category}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Sugar Type</div><div className="text-xs font-bold">{displayData.sugarType || '—'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Location</div><div className="text-xs font-bold">{displayData.location}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Net Weight (KG)</div><div className="text-xs font-bold">{displayData.netWeightKg || '-'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Gross Weight (KG)</div><div className="text-xs font-bold">{displayData.grossWeightKg || '-'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Max Color</div><div className="text-xs font-bold">{displayData.maxColor}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Shortform</div><div className="text-xs font-mono font-bold">{(() => {
                        const resolved = resolveShortForm(namingFormulas, displayData, { sugarTypes, productGroups });
                        if (resolved && resolved.trim()) return resolved;
                        if (displayData.sugarType === 'Molasses') return 'MOL';
                        const st = sugarTypes.find(s => s.name === displayData.sugarType);
                        if (!st) return '—';
                        const co = displayData.category === 'Conventional' ? 'C' : 'B';
                        if (displayData.productGroup === 'Bulk') return `${st.abbreviation}${co}${displayData.maxColor}`;
                        const wt = displayData.netWeightKg ? `${displayData.netWeightKg}kg ` : '';
                        return `${wt}${st.abbreviation}${co}${displayData.maxColor}`;
                      })()}</div></div>
                    </div>
                    <div className="pt-3 border-t border-[#141414]/10">
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Product Name (Auto)</div><div className="text-xs font-bold">
                        {(() => {
                          const resolved = resolveProductName(namingFormulas, displayData, { sugarTypes, productGroups });
                          if (resolved && resolved.trim()) return resolved;
                          return displayData.productFormat && displayData.sugarType
                            ? `${displayData.netWeightKg ? `${displayData.netWeightKg}kg ` : ''}${displayData.productFormat} ${displayData.sugarType} ${displayData.category} ${displayData.maxColor || 0}`
                            : '—';
                        })()}
                      </div></div>
                    </div>
                    {/* Packaged-only view rows */}
                    {displayData.productGroup === 'Packaged' && (
                      <div className="grid grid-cols-4 gap-4 pt-3 border-t border-[#141414]/10">
                        <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack Qty</div><div className="text-xs font-bold">{displayData.casePackQuantity ?? '—'}</div></div>
                        <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Case Pack (kg)</div><div className="text-xs font-bold">{displayData.casePackKg ?? '—'}</div></div>
                        <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit Qty</div><div className="text-xs font-bold">{displayData.sellingUnitQuantity ?? '—'}</div></div>
                        <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Selling Unit (kg)</div><div className="text-xs font-bold">{displayData.sellingUnitKg ?? '—'}</div></div>
                      </div>
                    )}
                    </>
                  )}
                </div>

                {/* Section 1: Approvers */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Approvers</div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Approver QA</label>
                      {isEditing ? (
                        <select
                          value={editData?.approverQAId || ''}
                          onChange={(e) => setEditData(prev => prev ? { ...prev, approverQAId: e.target.value || undefined } : prev)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                        >
                          <option value="">Unassigned</option>
                          {qaPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <div className="text-xs font-bold">{getPersonName(displayData.approverQAId)}</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Approver Sales</label>
                      {isEditing ? (
                        <select
                          value={editData?.approverSalesId || ''}
                          onChange={(e) => setEditData(prev => prev ? { ...prev, approverSalesId: e.target.value || undefined } : prev)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                        >
                          <option value="">Unassigned</option>
                          {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <div className="text-xs font-bold">{getPersonName(displayData.approverSalesId)}</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Approver Operations</label>
                      {isEditing ? (
                        <select
                          value={editData?.approverOperationsId || ''}
                          onChange={(e) => setEditData(prev => prev ? { ...prev, approverOperationsId: e.target.value || undefined } : prev)}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                        >
                          <option value="">Unassigned</option>
                          {opsPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      ) : (
                        <div className="text-xs font-bold">{getPersonName(displayData.approverOperationsId)}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 2: Product Specifications */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Specifications</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                          <th className="p-3 border-r border-white/10">Brix</th>
                          <th className="p-3 border-r border-white/10">Granulation</th>
                          <th className="p-3 border-r border-white/10">Color</th>
                          <th className="p-3 border-r border-white/10">Ash</th>
                          <th className="p-3 border-r border-white/10">Turbidity</th>
                          <th className="p-3">Moisture</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="bg-white">
                          {isEditing ? (
                            <>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input value={editData?.specifications.brix || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, brix: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 99.9" />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input value={editData?.specifications.granulation || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, granulation: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. Fine" />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input value={editData?.specifications.color || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, color: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 45 max" />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input value={editData?.specifications.ash || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, ash: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 0.04%" />
                              </td>
                              <td className="p-2 border-r border-[#141414]/10">
                                <input value={editData?.specifications.turbidity || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, turbidity: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 25 NTU" />
                              </td>
                              <td className="p-2">
                                <input value={editData?.specifications.moisture || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, specifications: { ...prev.specifications, moisture: e.target.value } } : prev)} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. 0.04%" />
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-3 text-xs border-r border-[#141414]/10">{displayData.specifications.brix || '-'}</td>
                              <td className="p-3 text-xs border-r border-[#141414]/10">{displayData.specifications.granulation || '-'}</td>
                              <td className="p-3 text-xs border-r border-[#141414]/10">{displayData.specifications.color || '-'}</td>
                              <td className="p-3 text-xs border-r border-[#141414]/10">{displayData.specifications.ash || '-'}</td>
                              <td className="p-3 text-xs border-r border-[#141414]/10">{displayData.specifications.turbidity || '-'}</td>
                              <td className="p-3 text-xs">{displayData.specifications.moisture || '-'}</td>
                            </>
                          )}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section 3: Packaging Supplier */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Packaging Supplier</div>
                  {isEditing ? (
                    <select
                      value={editData?.packagingSupplier || ''}
                      onChange={(e) => setEditData(prev => prev ? { ...prev, packagingSupplier: e.target.value } : prev)}
                      className="w-full bg-white border border-[#141414] p-3 text-sm outline-none"
                    >
                      <option value="">Select Vendor</option>
                      {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                    </select>
                  ) : (
                    <div className="text-xs font-bold">{displayData.packagingSupplier || 'Not specified'}</div>
                  )}
                </div>

                {/* Section 4: Packaging Pictures */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Packaging Pictures</div>
                  {displayData.packagingPictureUrls.length > 0 ? (
                    <div className="grid grid-cols-4 gap-3">
                      {displayData.packagingPictureUrls.map((url, idx) => (
                        <div key={idx} className="relative group border border-[#141414]/10 bg-white">
                          <img src={url} alt={displayData.packagingPictureFilenames[idx] || 'Packaging'} className="w-full h-24 object-cover" />
                          <div className="text-[9px] p-1 truncate opacity-50">{displayData.packagingPictureFilenames[idx]}</div>
                          {isEditing && (
                            <button
                              onClick={() => handleDeletePackagingImage(idx)}
                              className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic">No packaging pictures uploaded</div>
                  )}
                  {isEditing && (
                    <button
                      onClick={() => packagingFileRef.current?.click()}
                      disabled={isUploadingPackaging}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
                    >
                      {isUploadingPackaging ? <RefreshSpinner /> : <Upload size={14} />}
                      {isUploadingPackaging ? 'Uploading...' : 'Upload Image'}
                    </button>
                  )}
                </div>

                {/* Section 5: Packaging Artwork */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Packaging Artwork</div>
                  {displayData.artworkUrl ? (
                    <div className="flex items-center gap-4">
                      <div className="border border-[#141414]/10 bg-white p-2">
                        <img src={displayData.artworkUrl} alt="Artwork" className="h-20 object-contain" />
                      </div>
                      <div className="text-xs">
                        <div className="font-bold">{displayData.artworkFilename}</div>
                        <div className="opacity-50">Current artwork</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic">No artwork uploaded</div>
                  )}
                  {isEditing && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => artworkFileRef.current?.click()}
                        disabled={isUploadingArtwork}
                        className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
                      >
                        {isUploadingArtwork ? <RefreshSpinner /> : <Upload size={14} />}
                        {isUploadingArtwork ? 'Uploading...' : 'Upload Artwork'}
                      </button>
                      {displayData.artworkUrl && (
                        <button
                          onClick={() => setShowApprovalModal(true)}
                          className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase flex items-center gap-2 hover:bg-[#F9F9F9] transition-all"
                        >
                          <Send size={14} /> Send for Approval
                        </button>
                      )}
                    </div>
                  )}

                  {/* Approval History */}
                  {displayData.artworkApprovals.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[10px] uppercase font-bold opacity-50">Approval History</div>
                      {displayData.artworkApprovals.map(a => (
                        <div key={a.id} className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                          <div className="flex items-center gap-3">
                            {a.status === 'pending' && <Clock size={14} className="text-amber-500" />}
                            {a.status === 'approved' && <CheckCircle2 size={14} className="text-green-600" />}
                            {a.status === 'rejected' && <AlertCircle size={14} className="text-red-500" />}
                            <div>
                              <div className="text-xs font-bold">{a.sentToName}</div>
                              <div className="text-[10px] opacity-50">Sent {new Date(a.sentAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isEditing ? (
                              <select
                                value={a.status}
                                onChange={(e) => updateApprovalStatus(a.id, e.target.value as 'pending' | 'approved' | 'rejected')}
                                className="text-xs border border-[#141414] p-1 outline-none bg-white"
                              >
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                              </select>
                            ) : (
                              <span className={`px-2 py-1 text-[10px] font-bold uppercase ${
                                a.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                                a.status === 'approved' ? 'bg-green-100 text-green-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {a.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 6: UPC Code */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">UPC Code</div>
                  {isEditing ? (
                    <input
                      value={editData?.upcCode || ''}
                      onChange={(e) => setEditData(prev => prev ? { ...prev, upcCode: e.target.value } : prev)}
                      className="w-full bg-white border border-[#141414] p-3 text-sm outline-none font-mono"
                      placeholder="Enter UPC code (e.g. 012345678905)"
                    />
                  ) : (
                    <div className="text-sm font-mono font-bold">{displayData.upcCode || 'Not set'}</div>
                  )}
                </div>

                {/* Section 7: UPC Image */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">UPC Image</div>
                  {displayData.upcImageUrl ? (
                    <div className="flex items-center gap-4">
                      <div className="border border-[#141414]/10 bg-white p-2">
                        <img src={displayData.upcImageUrl} alt="UPC Barcode" className="h-16 object-contain" />
                      </div>
                      <div className="text-xs">
                        <div className="font-bold">{displayData.upcImageFilename}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic flex items-center gap-2"><Image size={14} /> No UPC barcode image uploaded</div>
                  )}
                  {isEditing && (
                    <button
                      onClick={() => upcFileRef.current?.click()}
                      disabled={isUploadingUpc}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
                    >
                      {isUploadingUpc ? <RefreshSpinner /> : <Upload size={14} />}
                      {isUploadingUpc ? 'Uploading...' : 'Upload UPC Image'}
                    </button>
                  )}
                </div>

                {/* Section 8: Ti-Hi / Pallet Configuration (for packaged products) */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Pallet Configuration (Ti × Hi)</div>
                  {isEditing ? (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Ti (layers per row)</label>
                        <input
                          type="number" min="0"
                          value={editData?.ti || ''}
                          onChange={(e) => {
                            const ti = parseInt(e.target.value) || 0;
                            const hi = editData?.hi || 0;
                            setEditData(prev => prev ? { ...prev, ti, unitsPerPallet: ti * hi } : prev);
                          }}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="e.g. 5"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Hi (rows high)</label>
                        <input
                          type="number" min="0"
                          value={editData?.hi || ''}
                          onChange={(e) => {
                            const hi = parseInt(e.target.value) || 0;
                            const ti = editData?.ti || 0;
                            setEditData(prev => prev ? { ...prev, hi, unitsPerPallet: ti * hi } : prev);
                          }}
                          className="w-full bg-white border border-[#141414] p-2 text-xs outline-none"
                          placeholder="e.g. 8"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Units per Pallet</label>
                        <div className="bg-[#E4E3E0] border border-[#141414] p-2 text-xs font-bold">
                          {(editData?.ti || 0) * (editData?.hi || 0) || '-'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Ti</div>
                        <div className="text-xs font-bold">{displayData.ti || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Hi</div>
                        <div className="text-xs font-bold">{displayData.hi || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-bold opacity-50 mb-1">Units per Pallet</div>
                        <div className="text-xs font-bold">{displayData.unitsPerPallet || '-'}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 9: Spec Sheets */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Spec Sheets</div>
                  {(displayData.specSheets || []).length > 0 ? (
                    <div className="space-y-2">
                      {(displayData.specSheets || []).map(doc => (
                        <div key={doc.id} className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                          <div className="flex items-center gap-3">
                            <FileText size={16} className="text-[#141414]/50" />
                            <div>
                              <div className="text-xs font-bold">{doc.filename}</div>
                              <div className="text-[10px] opacity-50">Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleDownloadDocument(doc)} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download">
                              <Download size={14} />
                            </button>
                            <button onClick={() => handleEmailDocument(doc, 'Spec Sheet')} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Email">
                              <Mail size={14} />
                            </button>
                            {isEditing && (
                              <button onClick={() => handleDeleteSpecSheet(doc.id)} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic flex items-center gap-2"><FileText size={14} /> No spec sheets uploaded</div>
                  )}
                  {isEditing && (
                    <button
                      onClick={() => specSheetFileRef.current?.click()}
                      disabled={isUploadingSpecSheet}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
                    >
                      {isUploadingSpecSheet ? <RefreshSpinner /> : <Upload size={14} />}
                      {isUploadingSpecSheet ? 'Uploading...' : 'Upload Spec Sheet'}
                    </button>
                  )}
                </div>

                {/* Section 10: Certificates */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Certificates</div>
                  {(displayData.certificates || []).length > 0 ? (
                    <div className="space-y-2">
                      {(displayData.certificates || []).map(doc => (
                        <div key={doc.id} className="flex items-center justify-between bg-white border border-[#141414]/10 p-3">
                          <div className="flex items-center gap-3">
                            <FileText size={16} className="text-[#141414]/50" />
                            <div>
                              <div className="text-xs font-bold">{doc.filename}</div>
                              <div className="text-[10px] opacity-50">Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleDownloadDocument(doc)} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Download">
                              <Download size={14} />
                            </button>
                            <button onClick={() => handleEmailDocument(doc, 'Certificate')} className="p-1.5 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Email">
                              <Mail size={14} />
                            </button>
                            {isEditing && (
                              <button onClick={() => handleDeleteCertificate(doc.id)} className="p-1.5 hover:bg-red-500 hover:text-white transition-all" title="Delete">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic flex items-center gap-2"><FileText size={14} /> No certificates uploaded</div>
                  )}
                  {isEditing && (
                    <button
                      onClick={() => certificateFileRef.current?.click()}
                      disabled={isUploadingCertificate}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-50"
                    >
                      {isUploadingCertificate ? <RefreshSpinner /> : <Upload size={14} />}
                      {isUploadingCertificate ? 'Uploading...' : 'Upload Certificate'}
                    </button>
                  )}
                </div>

                {/* Bill of Materials */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="flex justify-between items-center border-b border-[#141414]/10 pb-2">
                    <div className="text-[10px] uppercase font-bold opacity-50">Bill of Materials</div>
                    {isEditing && (
                      <button
                        onClick={() => { setEditingBomItem({ ...emptyBomItem, id: `BOM-${Date.now()}` }); setShowBomForm(true); }}
                        className="flex items-center gap-1 px-2 py-1 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-opacity-80 transition-all"
                      >
                        <Plus size={12} /> Add Material
                      </button>
                    )}
                  </div>

                  {/* BOM Table */}
                  {(displayData.billOfMaterials && displayData.billOfMaterials.length > 0) ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                            <th className="p-2">Material</th>
                            <th className="p-2">Code</th>
                            <th className="p-2">Category</th>
                            <th className="p-2">Qty</th>
                            <th className="p-2">Unit</th>
                            <th className="p-2">Supplier</th>
                            <th className="p-2">Cost/Unit</th>
                            <th className="p-2">Shrinkage</th>
                            <th className="p-2">Notes</th>
                            {isEditing && <th className="p-2">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {(isEditing ? (editData?.billOfMaterials || []) : displayData.billOfMaterials).map((item, idx) => (
                            <tr key={item.id || idx} className="border-b border-[#141414]/10 hover:bg-white/50 transition-colors">
                              <td className="p-2 text-xs font-bold">{item.materialName}</td>
                              <td className="p-2 text-xs font-mono">{item.materialCode || '—'}</td>
                              <td className="p-2 text-xs">
                                <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${
                                  item.category === 'Raw Material' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  item.category === 'Packaging' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  item.category === 'Label' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                  item.category === 'Additive' ? 'bg-green-50 text-green-700 border-green-200' :
                                  'bg-gray-50 text-gray-700 border-gray-200'
                                }`}>{item.category}</span>
                              </td>
                              <td className="p-2 text-xs font-mono">{item.quantity}</td>
                              <td className="p-2 text-xs">{item.unit}</td>
                              <td className="p-2 text-xs">{item.supplier || '—'}</td>
                              <td className="p-2 text-xs font-mono">{item.costPerUnit ? `${item.currency || 'CAD'} $${item.costPerUnit.toFixed(2)}` : '—'}</td>
                              <td className="p-2 text-xs font-mono">{item.shrinkage != null && item.shrinkage !== 0 ? `${item.shrinkage}%` : '—'}</td>
                              <td className="p-2 text-xs italic opacity-60">{item.notes || '—'}</td>
                              {isEditing && (
                                <td className="p-2 text-xs">
                                  <div className="flex gap-1">
                                    <button onClick={() => { setEditingBomItem({ ...item }); setShowBomForm(true); }} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"><Pencil size={12} /></button>
                                    <button onClick={() => {
                                      const updated = (editData?.billOfMaterials || []).filter(b => b.id !== item.id);
                                      setEditData(prev => prev ? { ...prev, billOfMaterials: updated } : prev);
                                    }} className="p-1 hover:bg-red-500 hover:text-white transition-all"><Trash2 size={12} /></button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        {/* Total cost row */}
                        {displayData.billOfMaterials.some(b => b.costPerUnit) && (
                          <tfoot>
                            <tr className="bg-[#E4E3E0] font-bold">
                              <td colSpan={6} className="p-2 text-xs text-right uppercase">Total Cost per Unit:</td>
                              <td className="p-2 text-xs font-mono">
                                CAD ${displayData.billOfMaterials.reduce((sum, b) => sum + (b.costPerUnit || 0) * b.quantity, 0).toFixed(2)}
                              </td>
                              <td colSpan={isEditing ? 3 : 2}></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs opacity-50 italic">No bill of materials defined for this product.</div>
                  )}

                  {/* BOM Add/Edit Form */}
                  {showBomForm && editingBomItem && isEditing && (
                    <div className="bg-white p-4 border border-[#141414]/20 space-y-3 mt-2">
                      <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">
                        {editingBomItem.materialName ? 'Edit Material' : 'Add Material'}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Material Name *</label>
                          <input value={editingBomItem.materialName} onChange={(e) => setEditingBomItem({ ...editingBomItem, materialName: e.target.value })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. Fine Granulated Sugar" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Material Code</label>
                          <input value={editingBomItem.materialCode || ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, materialCode: e.target.value })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="e.g. RM-001" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Category</label>
                          <select value={editingBomItem.category} onChange={(e) => setEditingBomItem({ ...editingBomItem, category: e.target.value as BOMItem['category'] })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none">
                            <option value="Raw Material">Raw Material</option>
                            <option value="Packaging">Packaging</option>
                            <option value="Label">Label</option>
                            <option value="Additive">Additive</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Quantity *</label>
                          <input type="number" value={editingBomItem.quantity || ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, quantity: parseFloat(e.target.value) || 0 })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="0" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Unit</label>
                          <select value={editingBomItem.unit} onChange={(e) => setEditingBomItem({ ...editingBomItem, unit: e.target.value as BOMItem['unit'] })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none">
                            <option value="kg">kg</option>
                            <option value="g">g</option>
                            <option value="pcs">pcs</option>
                            <option value="rolls">rolls</option>
                            <option value="sheets">sheets</option>
                            <option value="liters">liters</option>
                            <option value="ml">ml</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Supplier</label>
                          <select value={editingBomItem.supplier || ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, supplier: e.target.value })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none">
                            <option value="">Select Supplier</option>
                            {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Cost Per Unit</label>
                          <input type="number" step="0.01" value={editingBomItem.costPerUnit || ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, costPerUnit: parseFloat(e.target.value) || 0 })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Currency</label>
                          <select value={editingBomItem.currency || 'CAD'} onChange={(e) => setEditingBomItem({ ...editingBomItem, currency: e.target.value as 'CAD' | 'USD' })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none">
                            <option value="CAD">CAD</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Shrinkage (%)</label>
                          <input type="number" step="0.01" value={editingBomItem.shrinkage ?? ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, shrinkage: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0 })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="0" />
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Notes</label>
                          <input value={editingBomItem.notes || ''} onChange={(e) => setEditingBomItem({ ...editingBomItem, notes: e.target.value })} className="w-full bg-[#F5F5F5] border border-[#141414] p-2 text-xs outline-none" placeholder="Optional notes" />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => {
                            if (!editingBomItem.materialName || !editingBomItem.quantity) return;
                            const existing = editData?.billOfMaterials || [];
                            const idx = existing.findIndex(b => b.id === editingBomItem.id);
                            const updated = idx >= 0 ? existing.map(b => b.id === editingBomItem.id ? editingBomItem : b) : [...existing, editingBomItem];
                            setEditData(prev => prev ? { ...prev, billOfMaterials: updated } : prev);
                            setShowBomForm(false);
                            setEditingBomItem(null);
                          }}
                          className="px-6 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                        >
                          {editingBomItem.materialName && (editData?.billOfMaterials || []).some(b => b.id === editingBomItem.id) ? 'Update' : 'Add'} Material
                        </button>
                        <button
                          onClick={() => { setShowBomForm(false); setEditingBomItem(null); }}
                          className="px-6 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={saveChanges}
                        className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all"
                      >
                        <CheckCircle2 size={16} /> Save Changes
                      </button>
                      <button
                        onClick={() => { setIsEditing(false); setEditData(selectedProduct ? { ...selectedProduct, specifications: { ...selectedProduct.specifications }, packagingPictureUrls: [...selectedProduct.packagingPictureUrls], packagingPictureFilenames: [...selectedProduct.packagingPictureFilenames], artworkApprovals: [...selectedProduct.artworkApprovals] } : null); }}
                        className="flex-1 py-4 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Delete moved here from the table's old Actions column —
                          routes through the existing delete-confirm dialog. */}
                      <button
                        onClick={() => {
                          if (selectedProduct) {
                            setDeleteConfirmId(selectedProduct.id);
                            closeDetail();
                          }
                        }}
                        className="px-6 py-4 border border-red-500 text-red-600 text-xs font-bold uppercase hover:bg-red-500 hover:text-white transition-all flex items-center-safe justify-center gap-2"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all"
                      >
                        Edit Product
                      </button>
                      <button
                        onClick={closeDetail}
                        className="flex-1 py-4 border border-[#141414] text-xs font-bold uppercase hover:bg-[#F5F5F5] transition-all"
                      >
                        Close
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {/* Minimized taskbar */}
        {selectedProduct && productModalMinimized && (
          <div className="fixed bottom-4 left-4 z-[100]">
            <button
              onClick={() => setProductModalMinimized(false)}
              className="bg-[#141414] text-[#E4E3E0] px-4 py-2 text-xs font-bold uppercase tracking-widest flex items-center gap-2 shadow-lg hover:bg-opacity-80 transition-all border border-[#141414]"
            >
              <Maximize2 size={12} /> Product QA: {(() => {
                const resolved = resolveProductName(namingFormulas, selectedProduct, { sugarTypes, productGroups });
                if (resolved && resolved.trim()) return resolved;
                if (selectedProduct.productFormat && selectedProduct.sugarType) {
                  return `${selectedProduct.netWeightKg ? `${selectedProduct.netWeightKg}kg ` : ''}${selectedProduct.productFormat} ${selectedProduct.sugarType} ${selectedProduct.category} ${selectedProduct.maxColor || 0}`;
                }
                return selectedProduct.skuName || selectedProduct.productFormat || '—';
              })()}
            </button>
          </div>
        )}
      </AnimatePresence>

      {/* Send for Approval Sub-Modal */}
      <AnimatePresence>
        {showApprovalModal && (
          <div className="fixed inset-0 z-[200] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Send Artwork for Approval</h3>
                <button onClick={() => setShowApprovalModal(false)} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold opacity-50 mb-2">Send To</label>
                  <select
                    value={approvalRecipientId}
                    onChange={(e) => setApprovalRecipientId(e.target.value)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                  >
                    <option value="">-- Select a person --</option>
                    {people.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.department})</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={handleSendApproval}
                    disabled={!approvalRecipientId}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center-safe justify-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-30"
                  >
                    <Send size={14} /> Send
                  </button>
                  <button
                    onClick={() => setShowApprovalModal(false)}
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirmId && (
          <div className="fixed inset-0 z-[200] flex items-center-safe justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-sm w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Confirm Delete</h3>
                <button onClick={() => setDeleteConfirmId(null)} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm">Are you sure you want to remove this product from Quality Assurance tracking?</p>
                <p className="text-xs opacity-50">This will delete all QA data (specifications, approvals, uploaded images) for this product.</p>
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => { onDeleteQAProduct(deleteConfirmId); setDeleteConfirmId(null); }}
                    className="flex-1 py-3 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-all"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
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

// Simple spinner component for upload loading states
function RefreshSpinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
