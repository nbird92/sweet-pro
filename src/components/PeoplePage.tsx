import { useState } from 'react';
import { Person } from '../types';
import { Plus, X, Edit2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface PeoplePageProps {
  people: Person[];
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

export default function PeoplePage({
  people,
  onAddPerson,
  onUpdatePerson,
  onDeletePerson,
}: PeoplePageProps) {
  const [showAddPersonModal, setShowAddPersonModal] = useState(false);
  const [showEditPersonModal, setShowEditPersonModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [newPerson, setNewPerson] = useState<Partial<Person>>({
    name: '',
    email: '',
    phone: '',
    department: 'operations',
    salespersonNumber: '',
    notes: '',
  });

  const departments = ['sales', 'operations', 'logistics', 'customer service', 'QA', 'trading'] as const;

  const handleAddPerson = () => {
    if (!newPerson.name || !newPerson.email || !newPerson.department) {
      alert('Please fill in all required fields (Name, Email, Department)');
      return;
    }

    const person: Person = {
      id: `PERSON-${Date.now()}`,
      name: newPerson.name!,
      email: newPerson.email!,
      phone: newPerson.phone || undefined,
      department: newPerson.department!,
      salespersonNumber: newPerson.salespersonNumber || undefined,
      notes: newPerson.notes || undefined,
    };

    onAddPerson(person);
    setShowAddPersonModal(false);
    setNewPerson({
      name: '',
      email: '',
      phone: '',
      department: 'operations',
      salespersonNumber: '',
      notes: '',
    });
  };

  const handleUpdatePerson = () => {
    if (!editingPerson || !editingPerson.name || !editingPerson.email || !editingPerson.department) {
      alert('Please fill in all required fields');
      return;
    }

    onUpdatePerson(editingPerson);
    setShowEditPersonModal(false);
    setEditingPerson(null);
  };

  const handleDeletePerson = (personId: string) => {
    if (confirm('Are you sure you want to delete this person?')) {
      onDeletePerson(personId);
    }
  };

  const filteredPeople = people.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <main className="flex-1 p-6 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">People Management</h1>
        <button
          onClick={() => {
            setNewPerson({
              name: '',
              email: '',
              phone: '',
              department: 'operations',
              salespersonNumber: '',
              notes: '',
            });
            setShowAddPersonModal(true);
          }}
          className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
        >
          <Plus size={16} /> Add Person
        </button>
      </div>

      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by name, email, or department..."
      />

      {/* People Table */}
      <div className="mt-6 bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
              <th className="p-4 border-r border-[#141414]/10">Name</th>
              <th className="p-4 border-r border-[#141414]/10">Email</th>
              <th className="p-4 border-r border-[#141414]/10">Phone</th>
              <th className="p-4 border-r border-[#141414]/10">Department</th>
              <th className="p-4 border-r border-[#141414]/10">Sales #</th>
              <th className="p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]">
            {filteredPeople.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-500">
                  No people found
                </td>
              </tr>
            ) : (
              filteredPeople.map(person => (
                <tr key={person.id} className="hover:bg-[#F9F9F9] transition-colors">
                  <td className="p-4 text-xs font-bold border-r border-[#141414]/10">{person.name}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{person.email}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{person.phone || '-'}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10 uppercase">{person.department}</td>
                  <td className="p-4 text-xs border-r border-[#141414]/10">{person.salespersonNumber || '-'}</td>
                  <td className="p-4 text-xs flex gap-2">
                    <button
                      onClick={() => {
                        setEditingPerson(person);
                        setShowEditPersonModal(true);
                      }}
                      className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeletePerson(person.id)}
                      className="p-1 hover:bg-red-500 hover:text-white transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Person Modal */}
      <AnimatePresence>
        {showAddPersonModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Person</h3>
                <button
                  onClick={() => setShowAddPersonModal(false)}
                  className="p-1 hover:bg-white hover:text-[#141414] transition-all"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Name*</label>
                  <input
                    type="text"
                    value={newPerson.name || ''}
                    onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Email*</label>
                  <input
                    type="email"
                    value={newPerson.email || ''}
                    onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })}
                    placeholder="Email Address"
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={newPerson.phone || ''}
                    onChange={(e) => setNewPerson({ ...newPerson, phone: e.target.value })}
                    placeholder="Phone Number"
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Department*</label>
                  <select
                    value={newPerson.department || 'operations'}
                    onChange={(e) => setNewPerson({ ...newPerson, department: e.target.value as any })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  >
                    {departments.map(dept => (
                      <option key={dept} value={dept}>
                        {dept.charAt(0).toUpperCase() + dept.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                {newPerson.department === 'sales' && (
                  <div>
                    <label className="text-xs font-bold uppercase block mb-1">Sales Person Number</label>
                    <input
                      type="text"
                      value={newPerson.salespersonNumber || ''}
                      onChange={(e) => setNewPerson({ ...newPerson, salespersonNumber: e.target.value })}
                      placeholder="e.g., SP-001"
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Notes</label>
                  <textarea
                    value={newPerson.notes || ''}
                    onChange={(e) => setNewPerson({ ...newPerson, notes: e.target.value })}
                    placeholder="Additional notes..."
                    rows={3}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <button
                    onClick={() => setShowAddPersonModal(false)}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddPerson}
                    className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                  >
                    Add Person
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Person Modal */}
      <AnimatePresence>
        {showEditPersonModal && editingPerson && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest">Edit Person</h3>
                <button
                  onClick={() => setShowEditPersonModal(false)}
                  className="p-1 hover:bg-white hover:text-[#141414] transition-all"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Name*</label>
                  <input
                    type="text"
                    value={editingPerson.name}
                    onChange={(e) => setEditingPerson({ ...editingPerson, name: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Email*</label>
                  <input
                    type="email"
                    value={editingPerson.email}
                    onChange={(e) => setEditingPerson({ ...editingPerson, email: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editingPerson.phone || ''}
                    onChange={(e) => setEditingPerson({ ...editingPerson, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Department*</label>
                  <select
                    value={editingPerson.department}
                    onChange={(e) => setEditingPerson({ ...editingPerson, department: e.target.value as any })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  >
                    {departments.map(dept => (
                      <option key={dept} value={dept}>
                        {dept.charAt(0).toUpperCase() + dept.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                {editingPerson.department === 'sales' && (
                  <div>
                    <label className="text-xs font-bold uppercase block mb-1">Sales Person Number</label>
                    <input
                      type="text"
                      value={editingPerson.salespersonNumber || ''}
                      onChange={(e) => setEditingPerson({ ...editingPerson, salespersonNumber: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Notes</label>
                  <textarea
                    value={editingPerson.notes || ''}
                    onChange={(e) => setEditingPerson({ ...editingPerson, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <button
                    onClick={() => setShowEditPersonModal(false)}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdatePerson}
                    className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                  >
                    Update Person
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}
