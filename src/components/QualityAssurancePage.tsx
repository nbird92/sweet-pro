import React, { useState, useRef, useEffect } from 'react';
import { QAProduct, QADocument, QASpecifications, ArtworkApproval, SKU, Person, ProductGroup, Location } from '../types';
import { Plus, X, Trash2, Upload, Send, CheckCircle2, AlertCircle, Clock, Image, ChevronDown, ChevronUp, Download, Mail, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { uploadQAFile, deleteQAFile } from '../firebaseStorage';

interface QualityAssurancePageProps {
  qaProducts: QAProduct[];
  skus: SKU[];
  people: Person[];
  productGroups: ProductGroup[];
  locations: Location[];
  onUpdateLocations: (locations: Location[]) => void;
  onAddQAProduct: (product: QAProduct) => void;
  onUpdateQAProduct: (product: QAProduct) => void;
  onDeleteQAProduct: (productId: string) => void;
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

export default function QualityAssurancePage({
  qaProducts,
  skus,
  people,
  productGroups,
  locations,
  onUpdateLocations,
  onAddQAProduct,
  onUpdateQAProduct,
  onDeleteQAProduct,
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

  // File input refs
  const packagingFileRef = useRef<HTMLInputElement>(null);
  const artworkFileRef = useRef<HTMLInputElement>(null);
  const upcFileRef = useRef<HTMLInputElement>(null);
  const specSheetFileRef = useRef<HTMLInputElement>(null);
  const certificateFileRef = useRef<HTMLInputElement>(null);

  // Upload states for spec sheets and certificates
  const [isUploadingSpecSheet, setIsUploadingSpecSheet] = useState(false);
  const [isUploadingCertificate, setIsUploadingCertificate] = useState(false);

  // Locations table state
  const [expandedLocRows, setExpandedLocRows] = useState<Set<string>>(new Set());
  const [editingAppointmentSchedule, setEditingAppointmentSchedule] = useState<Location | null>(null);
  const toggleLocRow = (id: string) => {
    setExpandedLocRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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

  // Add product from SKU
  const handleAddProduct = () => {
    const sku = skus.find(s => s.id === selectedSkuId);
    if (!sku) return;

    const newProduct: QAProduct = {
      id: `QA-${Date.now()}`,
      skuId: sku.id,
      skuName: sku.name,
      productGroup: sku.productGroup,
      category: sku.category,
      location: sku.location,
      netWeightKg: sku.netWeightKg,
      grossWeightKg: sku.grossWeightKg,
      maxColor: sku.maxColor,
      specifications: { ...emptySpecs },
      packagingSupplier: '',
      packagingPictureUrls: [],
      packagingPictureFilenames: [],
      artworkApprovals: [],
      upcCode: '',
      specSheets: [],
      certificates: [],
    };
    onAddQAProduct(newProduct);
    setShowAddModal(false);
    setSelectedSkuId('');
  };

  // Open detail card
  const openDetail = (product: QAProduct) => {
    setSelectedProduct(product);
    setEditData({ ...product, specifications: { ...product.specifications }, packagingPictureUrls: [...product.packagingPictureUrls], packagingPictureFilenames: [...product.packagingPictureFilenames], artworkApprovals: [...product.artworkApprovals], specSheets: [...(product.specSheets || [])], certificates: [...(product.certificates || [])] });
    setIsEditing(false);
  };

  const closeDetail = () => {
    setSelectedProduct(null);
    setEditData(null);
    setIsEditing(false);
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
      className="p-4 border-r border-white/10 cursor-pointer hover:bg-white/5 transition-colors select-none"
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

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h2 className="text-xl font-bold uppercase tracking-tighter">Quality Assurance</h2>
          <p className="text-[10px] uppercase font-bold opacity-50">
            {qaProducts.length} product{qaProducts.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <button
          onClick={() => { setShowAddModal(true); setSelectedSkuId(skus.length > 0 ? skus[0].id : ''); }}
          className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center gap-2 hover:bg-opacity-80 transition-all"
        >
          <Plus size={14} /> Add Product
        </button>
      </div>

      {/* Search */}
      <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search by name, product group, ID, or location..." />

      {/* Product Table */}
      <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                <SortHeader label="Prod No." sortKey="id" />
                <SortHeader label="Name" sortKey="skuName" />
                <SortHeader label="Product Group" sortKey="productGroup" />
                <SortHeader label="Conv./Organic" sortKey="category" />
                <SortHeader label="Max Color" sortKey="maxColor" />
                <SortHeader label="Location" sortKey="location" />
                <SortHeader label="Net Weight (KG)" sortKey="netWeightKg" />
                <SortHeader label="Gross Weight (KG)" sortKey="grossWeightKg" />
                <th className="p-4">Actions</th>
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
                    <td className="p-4 text-xs font-mono border-r border-[#141414]/10">{p.id}</td>
                    <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{p.skuName}</td>
                    <td className="p-4 border-r border-[#141414]/10">
                      <span
                        className="px-2 py-1 text-[10px] font-bold uppercase border border-[#141414]/20"
                        style={{ backgroundColor: pg?.color || '#F5F5F5' }}
                      >
                        {p.productGroup}
                      </span>
                    </td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.category}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.maxColor}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.location}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.netWeightKg ?? '-'}</td>
                    <td className="p-4 text-xs border-r border-[#141414]/10">{p.grossWeightKg ?? '-'}</td>
                    <td className="p-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(p.id); }}
                        className="p-1.5 text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td className="p-12 text-center text-xs opacity-50 italic" colSpan={9}>
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
              onUpdateLocations([...locations, { id, locationCode: '', name: '', address: '', city: '', province: '', postalCode: '', bays: [], appointmentStartTime: '06:00', appointmentEndTime: '18:00', appointmentDuration: 30 }]);
              setExpandedLocRows(new Set([id]));
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
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/10">
            {locations.map(loc => (
              <React.Fragment key={loc.id}>
                <tr className="hover:bg-[#F9F9F9] transition-colors">
                  <td className="p-4 text-xs font-bold font-mono border-r border-[#141414]/10 w-20">
                    <input
                      type="text"
                      value={loc.locationCode || ''}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, locationCode: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="Code"
                    />
                  </td>
                  <td className="p-4 text-xs font-bold border-r border-[#141414]/10">
                    <input
                      type="text"
                      value={loc.name}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, name: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="Location Name"
                    />
                  </td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">
                    <input
                      type="text"
                      value={loc.address}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, address: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="Address"
                    />
                  </td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">
                    <input
                      type="text"
                      value={loc.city}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, city: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="City"
                    />
                  </td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">
                    <input
                      type="text"
                      value={loc.province}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, province: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="Province"
                    />
                  </td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">
                    <input
                      type="text"
                      value={loc.postalCode}
                      onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, postalCode: e.target.value } : l))}
                      className="w-full bg-transparent focus:outline-none"
                      placeholder="Postal Code"
                    />
                  </td>
                  <td className="p-4 text-xs flex gap-2">
                    <button onClick={() => setEditingAppointmentSchedule({...loc})} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all" title="Set Appointment Schedule">
                      <Clock size={14} />
                    </button>
                    <button onClick={() => toggleLocRow(loc.id)} className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                      {expandedLocRows.has(loc.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <button onClick={() => onUpdateLocations(locations.filter(l => l.id !== loc.id))} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
                <AnimatePresence>
                  {expandedLocRows.has(loc.id) && (
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
                                onClick={() => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, bays: [...l.bays, ''] } : l))}
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
                                    onChange={(e) => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, bays: l.bays.map((b, i) => i === idx ? e.target.value : b) } : l))}
                                    className="flex-1 bg-white border border-[#141414]/20 p-2 text-xs"
                                    placeholder={`Bay ${idx + 1} Name`}
                                  />
                                  <button
                                    onClick={() => onUpdateLocations(locations.map(l => l.id === loc.id ? { ...l, bays: l.bays.filter((_, i) => i !== idx) } : l))}
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

      {/* Appointment Schedule Modal */}
      <AnimatePresence>
        {editingAppointmentSchedule && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm" onClick={() => setEditingAppointmentSchedule(null)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Appointment Schedule — {editingAppointmentSchedule.name}</h3>
                <button onClick={() => setEditingAppointmentSchedule(null)} className="p-1 hover:bg-white hover:text-[#141414] transition-all">
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">Start Time</label>
                    <input
                      type="time"
                      value={editingAppointmentSchedule.appointmentStartTime || '06:00'}
                      onChange={(e) => setEditingAppointmentSchedule({ ...editingAppointmentSchedule, appointmentStartTime: e.target.value })}
                      className="w-full border border-[#141414] p-2 text-sm focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold opacity-50">End Time</label>
                    <input
                      type="time"
                      value={editingAppointmentSchedule.appointmentEndTime || '18:00'}
                      onChange={(e) => setEditingAppointmentSchedule({ ...editingAppointmentSchedule, appointmentEndTime: e.target.value })}
                      className="w-full border border-[#141414] p-2 text-sm focus:outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold opacity-50">Appointment Duration (minutes)</label>
                  <input
                    type="number"
                    value={editingAppointmentSchedule.appointmentDuration || 30}
                    onChange={(e) => setEditingAppointmentSchedule({ ...editingAppointmentSchedule, appointmentDuration: parseInt(e.target.value) || 30 })}
                    className="w-full border border-[#141414] p-2 text-sm focus:outline-none"
                    min={5}
                    step={5}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      onUpdateLocations(locations.map(l => l.id === editingAppointmentSchedule.id ? {
                        ...l,
                        appointmentStartTime: editingAppointmentSchedule.appointmentStartTime,
                        appointmentEndTime: editingAppointmentSchedule.appointmentEndTime,
                        appointmentDuration: editingAppointmentSchedule.appointmentDuration,
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-md w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Product to QA</h3>
                <button onClick={() => setShowAddModal(false)} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold opacity-50 mb-2">Select Product (SKU)</label>
                  <select
                    value={selectedSkuId}
                    onChange={(e) => setSelectedSkuId(e.target.value)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm focus:bg-white transition-colors outline-none"
                  >
                    <option value="">-- Select a product --</option>
                    {skus.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.productGroup} - {s.location})</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={handleAddProduct}
                    disabled={!selectedSkuId}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all disabled:opacity-30"
                  >
                    Add Product
                  </button>
                  <button
                    onClick={() => setShowAddModal(false)}
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

      {/* Product Detail Card Modal */}
      <AnimatePresence>
        {selectedProduct && displayData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm overflow-y-auto" onClick={closeDetail}>
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-3xl w-full overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex justify-between items-center sticky top-0 z-10">
                <h3 className="text-xs font-bold uppercase tracking-widest">
                  Product QA: {displayData.skuName}
                </h3>
                <button onClick={closeDetail} className="hover:rotate-90 transition-transform"><X size={20} /></button>
              </div>

              <div className="p-6 space-y-4">
                {/* Section 0: Product Details (editable - syncs back to Products table) */}
                <div className="bg-[#F5F5F5] p-4 border border-[#141414]/10 space-y-3">
                  <div className="text-[10px] uppercase font-bold opacity-50 border-b border-[#141414]/10 pb-2">Product Details</div>
                  {isEditing ? (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Name</label>
                        <input value={editData?.skuName || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, skuName: e.target.value } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Product Group</label>
                        <select value={editData?.productGroup || ''} onChange={(e) => setEditData(prev => prev ? { ...prev, productGroup: e.target.value } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          {productGroups.map(pg => <option key={pg.id} value={pg.name}>{pg.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Category</label>
                        <select value={editData?.category || 'Conventional'} onChange={(e) => setEditData(prev => prev ? { ...prev, category: e.target.value as 'Conventional' | 'Organic' } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="Conventional">Conventional</option>
                          <option value="Organic">Organic</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase font-bold opacity-50 mb-1">Location</label>
                        <select value={editData?.location || 'Hamilton'} onChange={(e) => setEditData(prev => prev ? { ...prev, location: e.target.value as 'Hamilton' | 'Vancouver' } : prev)} className="w-full bg-white border border-[#141414] p-2 text-xs outline-none">
                          <option value="Hamilton">Hamilton</option>
                          <option value="Vancouver">Vancouver</option>
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
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-4">
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Name</div><div className="text-xs font-bold">{displayData.skuName}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Group</div><div className="text-xs font-bold">{displayData.productGroup}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Category</div><div className="text-xs font-bold">{displayData.category}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Location</div><div className="text-xs font-bold">{displayData.location}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Net Weight (KG)</div><div className="text-xs font-bold">{displayData.netWeightKg || '-'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Gross Weight (KG)</div><div className="text-xs font-bold">{displayData.grossWeightKg || '-'}</div></div>
                      <div><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Max Color</div><div className="text-xs font-bold">{displayData.maxColor}</div></div>
                    </div>
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
                    <input
                      value={editData?.packagingSupplier || ''}
                      onChange={(e) => setEditData(prev => prev ? { ...prev, packagingSupplier: e.target.value } : prev)}
                      className="w-full bg-white border border-[#141414] p-3 text-sm outline-none"
                      placeholder="Enter packaging supplier name"
                    />
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

                {/* Action Buttons */}
                <div className="flex gap-4 pt-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={saveChanges}
                        className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-opacity-80 transition-all"
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
                      <button
                        onClick={() => setIsEditing(true)}
                        className="flex-1 py-4 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-opacity-80 transition-all"
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
      </AnimatePresence>

      {/* Send for Approval Sub-Modal */}
      <AnimatePresence>
        {showApprovalModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm" onClick={() => setShowApprovalModal(false)}>
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
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase flex items-center justify-center gap-2 hover:bg-opacity-80 transition-all disabled:opacity-30"
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
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/40 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)}>
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
