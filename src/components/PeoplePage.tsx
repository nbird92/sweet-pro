import { useState } from 'react';
import { Person, Location, PERMISSION_GROUPS } from '../types';
import { Plus, Users } from 'lucide-react';
import PageBanner from './PageBanner';
import DataTable from './DataTable';
import DetailModal, { DetailRow, DetailField } from './DetailModal';
import type { SheetSpec } from '../utils/exportExcel';

interface PeoplePageProps {
  people: Person[];
  /** Active locations — options for a person's Default Location. */
  locations: Location[];
  onAddPerson: (person: Person) => void;
  onUpdatePerson: (person: Person) => void;
  onDeletePerson: (personId: string) => void;
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
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

const departments = ['sales', 'operations', 'logistics', 'customer service', 'QA', 'trading'] as const;

const emptyPerson = (): Person => ({
  id: `PERSON-${Date.now()}`,
  name: '',
  email: '',
  phone: '',
  department: 'operations',
  salespersonNumber: '',
  position: '',
  defaultLocation: '',
  notes: '',
});

export default function PeoplePage({
  people,
  locations,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
}: PeoplePageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  // Standardized DataTable + DetailModal state (replaces the old separate
  // Add/Edit modals + the row Actions column).
  const [personDraft, setPersonDraft] = useState<Person | null>(null);
  const [personMode, setPersonMode] = useState<'view' | 'edit' | 'add'>('view');

  const canSave = !!personDraft && !!personDraft.name.trim() && !!personDraft.email.trim() && !!personDraft.department;

  const filteredPeople = people.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.position || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.permission || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const peopleExportSheets = (): SheetSpec[] => [{
    sheetName: 'People',
    title: 'People Management',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${people.length} people`,
    columns: [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Phone', key: 'phone' },
      { header: 'Position', key: 'position' },
      { header: 'Department', key: 'department' },
      { header: 'Permission', key: 'permission' },
      { header: 'Default Location', key: 'defaultLocation' },
      { header: 'Sales #', key: 'salespersonNumber' },
      { header: 'Notes', key: 'notes' },
    ],
    rows: people as any[],
  }];

  return (
    <div>
      <PageBanner
        icon={<Users size={18} />}
        title="People Management"
        count={filteredPeople.length}
        exportSheets={peopleExportSheets}
        exportFileName="People"
      >
        <button
          onClick={() => { setPersonDraft(emptyPerson()); setPersonMode('add'); }}
          className="px-3 py-1.5 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-white/20 transition-colors flex items-center gap-2"
        >
          <Plus size={12} /> Add Person
        </button>
      </PageBanner>
    <main className="flex-1 p-6 overflow-auto">

      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by name, email, or department..."
      />

      {/* People — standardized DataTable + DetailModal. */}
      <div className="mt-6">
        <DataTable<Person>
          title="People"
          icon={<Users size={14} />}
          columns={[
            { key: 'name', label: 'Name', bold: true },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone', render: (p) => p.phone || '-' },
            { key: 'position', label: 'Position', render: (p) => p.position || '-' },
            { key: 'department', label: 'Department', render: (p) => <span className="uppercase">{p.department}</span> },
            { key: 'permission', label: 'Permission', render: (p) => p.permission || '-' },
            { key: 'defaultLocation', label: 'Default Location', render: (p) => p.defaultLocation || '-' },
            { key: 'salespersonNumber', label: 'Sales #', render: (p) => p.salespersonNumber || '-' },
          ]}
          rows={filteredPeople}
          getRowKey={(p) => p.id}
          onRowClick={(p) => { setPersonDraft({ ...p }); setPersonMode('view'); }}
          emptyMessage="No people found."
          defaultSortKey="name"
        />
      </div>

      <DetailModal
        tableName="People"
        icon={<Users size={14} />}
        isOpen={!!personDraft}
        mode={personMode}
        onClose={() => setPersonDraft(null)}
        onEdit={() => setPersonMode('edit')}
        onSave={() => {
          if (!personDraft || !canSave) return;
          if (personMode === 'add') {
            onAddPerson(personDraft);
          } else {
            onUpdatePerson(personDraft);
          }
          setPersonDraft(null);
        }}
        onDelete={personMode === 'add' ? undefined : () => {
          if (!personDraft) return;
          onDeletePerson(personDraft.id);
          setPersonDraft(null);
        }}
        deleteConfirmMessage={personDraft ? `Delete ${personDraft.name || 'this person'}? This cannot be undone.` : undefined}
        saveDisabled={!canSave}
      >
        {personDraft && (
          personMode === 'view' ? (
            <>
              <DetailRow label="Name" value={personDraft.name} bold />
              <DetailRow label="Email" value={personDraft.email} />
              <DetailRow label="Phone" value={personDraft.phone} />
              <DetailRow label="Position" value={personDraft.position} />
              <DetailRow label="Department" value={<span className="uppercase">{personDraft.department}</span>} />
              <DetailRow label="Permission" value={personDraft.permission} />
              <DetailRow label="Default Location" value={personDraft.defaultLocation} />
              {personDraft.department === 'sales' && <DetailRow label="Sales Person Number" value={personDraft.salespersonNumber} />}
              <DetailRow label="Notes" value={personDraft.notes} />
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <DetailField label="Name" required>
                  <input
                    type="text"
                    value={personDraft.name}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, name: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    placeholder="Full Name"
                  />
                </DetailField>
                <DetailField label="Email" required>
                  <input
                    type="email"
                    value={personDraft.email}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, email: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    placeholder="Email Address"
                  />
                </DetailField>
                <DetailField label="Phone">
                  <input
                    type="tel"
                    value={personDraft.phone || ''}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, phone: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    placeholder="Phone Number"
                  />
                </DetailField>
                <DetailField label="Position">
                  <input
                    type="text"
                    value={personDraft.position || ''}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, position: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    placeholder="e.g., Logistics Coordinator"
                  />
                </DetailField>
                <DetailField label="Permission">
                  <select
                    value={personDraft.permission || ''}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, permission: e.target.value as Person['permission'] } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  >
                    <option value="">— None —</option>
                    {PERMISSION_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </DetailField>
                <DetailField label="Default Location">
                  <select
                    value={personDraft.defaultLocation || ''}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, defaultLocation: e.target.value } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  >
                    <option value="">— None —</option>
                    {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    {/* Keep a since-retired location visible so it isn't silently dropped. */}
                    {personDraft.defaultLocation && !locations.some(l => l.name === personDraft.defaultLocation) && (
                      <option value={personDraft.defaultLocation}>{personDraft.defaultLocation} (inactive)</option>
                    )}
                  </select>
                </DetailField>
                <DetailField label="Department" required>
                  <select
                    value={personDraft.department}
                    onChange={(e) => setPersonDraft(d => d ? { ...d, department: e.target.value as Person['department'] } : d)}
                    className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                  >
                    {departments.map(dept => (
                      <option key={dept} value={dept}>{dept.charAt(0).toUpperCase() + dept.slice(1)}</option>
                    ))}
                  </select>
                </DetailField>
                {personDraft.department === 'sales' && (
                  <DetailField label="Sales Person Number">
                    <input
                      type="text"
                      value={personDraft.salespersonNumber || ''}
                      onChange={(e) => setPersonDraft(d => d ? { ...d, salespersonNumber: e.target.value } : d)}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      placeholder="e.g., SP-001"
                    />
                  </DetailField>
                )}
              </div>
              <DetailField label="Notes">
                <textarea
                  value={personDraft.notes || ''}
                  onChange={(e) => setPersonDraft(d => d ? { ...d, notes: e.target.value } : d)}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm h-20 resize-none outline-none focus:bg-white"
                  placeholder="Additional notes..."
                />
              </DetailField>
            </div>
          )
        )}
      </DetailModal>
    </main>
    </div>
  );
}
