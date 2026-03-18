import React, { useState, useRef, useEffect } from 'react';
import { QAProduct, QASpecifications, ArtworkApproval, SKU, Person, ProductGroup } from '../types';
import { Plus, X, Trash2, Upload, Send, CheckCircle2, AlertCircle, Clock, Image, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { uploadQAFile, deleteQAFile } from '../firebaseStorage';

interface QualityAssurancePageProps {
  qaProducts: QAProduct[];
  skus: SKU[];
  people: Person[];
  productGroups: ProductGroup[];
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
    };
    onAddQAProduct(newProduct);
    setShowAddModal(false);
    setSelectedSkuId('');
  };

  // Open detail card
  const openDetail = (product: QAProduct) => {
    setSelectedProduct(product);
    setEditData({ ...product, specifications: { ...product.specifications }, packagingPictureUrls: [...product.packagingPictureUrls], packagingPictureFilenames: [...product.packagingPictureFilenames], artworkApprovals: [...product.artworkApprovals] });
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
    if (file.size > 5 * 1024 * 1024) { alert('File must be under 5MB'); return; }
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
    if (file.size > 5 * 1024 * 1024) { alert('File must be under 5MB'); return; }
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
    if (file.size > 5 * 1024 * 1024) { alert('File must be under 5MB'); return; }
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

      {/* Hidden file inputs */}
      <input type="file" ref={packagingFileRef} className="hidden" accept="image/*" onChange={handlePackagingUpload} />
      <input type="file" ref={artworkFileRef} className="hidden" accept="image/*,.pdf" onChange={handleArtworkUpload} />
      <input type="file" ref={upcFileRef} className="hidden" accept="image/*" onChange={handleUpcUpload} />

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
