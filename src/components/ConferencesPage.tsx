import React, { useState } from 'react';
import { Conference, ConferenceAttendee, ConferenceMeeting, Customer, Person } from '../types';
import { Plus, X, Edit2, Trash2, ChevronRight, ChevronDown, Clock, MapPin, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConferencesPageProps {
  conferences: Conference[];
  customers: Customer[];
  people: Person[];
  onAddConference: (conference: Conference) => void;
  onUpdateConference: (conference: Conference) => void;
  onDeleteConference: (conferenceId: string) => void;
  onAddMeeting: (conferenceId: string, meeting: ConferenceMeeting) => void;
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

export default function ConferencesPage({
  conferences,
  customers,
  people,
  onAddConference,
  onUpdateConference,
  onDeleteConference,
  onAddMeeting,
}: ConferencesPageProps) {
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [showAddConferenceModal, setShowAddConferenceModal] = useState(false);
  const [showEditConferenceModal, setShowEditConferenceModal] = useState(false);
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedConferences, setExpandedConferences] = useState<Set<string>>(new Set());

  const [editingConference, setEditingConference] = useState<Conference | null>(null);
  const [newConference, setNewConference] = useState<Partial<Conference>>({
    name: '',
    startDate: '',
    endDate: '',
    location: '',
    address: '',
    city: '',
    province: '',
    postalCode: '',
    attendees: [],
    meetings: [],
    status: 'Planned',
  });

  const [newAttendee, setNewAttendee] = useState({ name: '', email: '', phone: '' });
  const [newMeeting, setNewMeeting] = useState<Partial<ConferenceMeeting>>({
    date: '',
    time: '',
    meetingName: '',
    attendees: [],
    customerAttendees: [],
    location: '',
    notes: '',
    customerId: '',
  });

  const salespersons = people.filter(p => p.department === 'sales');

  const handleAddConference = () => {
    if (!newConference.name || !newConference.startDate || !newConference.endDate) {
      alert('Please fill in all required fields');
      return;
    }

    const conference: Conference = {
      id: `CONF-${Date.now()}`,
      name: newConference.name!,
      startDate: newConference.startDate!,
      endDate: newConference.endDate!,
      location: newConference.location!,
      address: newConference.address,
      city: newConference.city,
      province: newConference.province,
      postalCode: newConference.postalCode,
      attendees: newConference.attendees || [],
      meetings: [],
      createdAt: new Date().toISOString(),
      status: newConference.status || 'Planned',
    };

    onAddConference(conference);
    setShowAddConferenceModal(false);
    resetConferenceForm();
  };

  const handleEditConference = () => {
    if (!editingConference || !editingConference.name || !editingConference.startDate || !editingConference.endDate) {
      alert('Please fill in all required fields');
      return;
    }

    onUpdateConference(editingConference);
    setShowEditConferenceModal(false);
    setEditingConference(null);
  };

  const handleDeleteConference = (id: string) => {
    if (confirm('Are you sure you want to delete this conference?')) {
      onDeleteConference(id);
      if (selectedConference?.id === id) {
        setSelectedConference(null);
      }
    }
  };

  const handleAddAttendee = () => {
    if (!newAttendee.name || !newAttendee.email) {
      alert('Please fill in name and email');
      return;
    }

    const attendee: ConferenceAttendee = {
      id: `ATT-${Date.now()}`,
      name: newAttendee.name,
      email: newAttendee.email,
      phone: newAttendee.phone || undefined,
    };

    setNewConference(prev => ({
      ...prev,
      attendees: [...(prev.attendees || []), attendee],
    }));

    setNewAttendee({ name: '', email: '', phone: '' });
  };

  const handleAddEditAttendee = () => {
    if (!newAttendee.name || !newAttendee.email) {
      alert('Please fill in name and email');
      return;
    }

    const attendee: ConferenceAttendee = {
      id: `ATT-${Date.now()}`,
      name: newAttendee.name,
      email: newAttendee.email,
      phone: newAttendee.phone || undefined,
    };

    if (editingConference) {
      setEditingConference(prev => ({
        ...prev!,
        attendees: [...prev!.attendees, attendee],
      }));
    }

    setNewAttendee({ name: '', email: '', phone: '' });
  };

  const handleAddMeeting = () => {
    if (!selectedConference || !newMeeting.date || !newMeeting.time || !newMeeting.location) {
      alert('Please fill in all required fields');
      return;
    }

    // Auto-generate meeting name from customer if selected
    let meetingName = newMeeting.meetingName || '';
    if (newMeeting.customerId && !meetingName) {
      const customer = customers.find(c => c.id === newMeeting.customerId);
      meetingName = customer ? customer.name : 'Meeting';
    }

    const meeting: ConferenceMeeting = {
      id: `MTG-${Date.now()}`,
      conferenceId: selectedConference.id,
      date: newMeeting.date!,
      time: newMeeting.time!,
      meetingName: meetingName,
      attendees: newMeeting.attendees || [],
      customerAttendees: newMeeting.customerAttendees || [],
      location: newMeeting.location!,
      notes: newMeeting.notes,
      customerId: newMeeting.customerId,
    };

    // Update the selected conference with the new meeting
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: [...selectedConference.meetings, meeting],
    };

    onAddMeeting(selectedConference.id, meeting);
    setSelectedConference(updatedConference);
    setShowAddMeetingModal(false);
    resetMeetingForm();
  };

  const handleDeleteMeeting = (meetingId: string) => {
    if (!selectedConference) return;

    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.filter(m => m.id !== meetingId),
    };

    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const removeAttendee = (attendeeId: string) => {
    setNewConference(prev => ({
      ...prev,
      attendees: prev.attendees?.filter(a => a.id !== attendeeId) || [],
    }));
  };

  const removeEditAttendee = (attendeeId: string) => {
    if (editingConference) {
      setEditingConference(prev => ({
        ...prev!,
        attendees: prev!.attendees.filter(a => a.id !== attendeeId),
      }));
    }
  };

  const toggleMeetingAttendee = (attendeeId: string) => {
    setNewMeeting(prev => {
      const current = prev.attendees || [];
      return {
        ...prev,
        attendees: current.includes(attendeeId)
          ? current.filter(id => id !== attendeeId)
          : [...current, attendeeId],
      };
    });
  };

  const toggleMeetingCustomerAttendee = (customerId: string) => {
    setNewMeeting(prev => {
      const current = prev.customerAttendees || [];
      return {
        ...prev,
        customerAttendees: current.includes(customerId)
          ? current.filter(id => id !== customerId)
          : [...current, customerId],
      };
    });
  };

  const resetConferenceForm = () => {
    setNewConference({
      name: '',
      startDate: '',
      endDate: '',
      location: '',
      address: '',
      city: '',
      province: '',
      postalCode: '',
      attendees: [],
      meetings: [],
      status: 'Planned',
    });
  };

  const resetMeetingForm = () => {
    setNewMeeting({
      date: '',
      time: '',
      meetingName: '',
      attendees: [],
      customerAttendees: [],
      location: '',
      notes: '',
      customerId: '',
    });
  };

  const toggleExpandConference = (conferenceId: string) => {
    const newExpanded = new Set(expandedConferences);
    if (newExpanded.has(conferenceId)) {
      newExpanded.delete(conferenceId);
    } else {
      newExpanded.add(conferenceId);
    }
    setExpandedConferences(newExpanded);
  };

  const filteredConferences = conferences.filter(conf =>
    (conf.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (conf.location || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Generate date range for meeting dates
  const getConferenceDates = (): string[] => {
    if (!selectedConference) return [];
    const dates = [];
    const start = new Date(selectedConference.startDate);
    const end = new Date(selectedConference.endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  if (selectedConference) {
    return <ConferenceDetailView
      conference={selectedConference}
      customers={customers}
      people={people}
      onBack={() => setSelectedConference(null)}
      onEdit={() => {
        setEditingConference(selectedConference);
        setShowEditConferenceModal(true);
      }}
      onDelete={() => handleDeleteConference(selectedConference.id)}
      onAddMeeting={() => setShowAddMeetingModal(true)}
      onDeleteMeeting={handleDeleteMeeting}
      showAddMeetingModal={showAddMeetingModal}
      onSetShowAddMeetingModal={setShowAddMeetingModal}
      newMeeting={newMeeting}
      setNewMeeting={setNewMeeting}
      onHandleAddMeeting={handleAddMeeting}
      salespersons={salespersons}
      conferenceDates={getConferenceDates()}
      toggleMeetingAttendee={toggleMeetingAttendee}
      toggleMeetingCustomerAttendee={toggleMeetingCustomerAttendee}
    />;
  }

  return (
    <main className="flex-1 p-6 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conferences</h1>
        <button
          onClick={() => {
            resetConferenceForm();
            setShowAddConferenceModal(true);
          }}
          className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
        >
          <Plus size={16} /> Add Conference
        </button>
      </div>

      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search conferences by name or location..."
      />

      {/* Conferences List */}
      <div className="mt-6 space-y-3">
        {filteredConferences.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No conferences found. Create one to get started!</p>
          </div>
        ) : (
          filteredConferences.map(conference => (
            <div key={conference.id} className="bg-white border border-[#141414]">
              <div className="p-4 hover:bg-[#F9F9F9] transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpandConference(conference.id)}
                        className="p-1 hover:bg-[#141414] hover:text-white transition-all"
                      >
                        <ChevronDown
                          size={16}
                          style={{
                            transform: expandedConferences.has(conference.id) ? 'rotate(0deg)' : 'rotate(-90deg)',
                            transition: 'transform 0.2s',
                          }}
                        />
                      </button>
                      <div>
                        <h3 className="font-bold text-lg">{conference.name}</h3>
                        <div className="text-xs text-gray-600 mt-1">
                          {new Date(conference.startDate).toLocaleDateString()} - {new Date(conference.endDate).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 flex gap-4">
                          <span><MapPin size={12} className="inline mr-1" />{conference.location || 'No location'}</span>
                          <span><Users size={12} className="inline mr-1" />{(conference.attendees || []).length} attendees</span>
                          <span><Clock size={12} className="inline mr-1" />{(conference.meetings || []).length} meetings</span>
                          <span className="uppercase text-[10px] font-bold">{conference.status || 'Planned'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedConference(conference)}
                      className="px-3 py-1 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all flex items-center gap-1"
                    >
                      <ChevronRight size={12} /> View
                    </button>
                    <button
                      onClick={() => {
                        setEditingConference(conference);
                        setShowEditConferenceModal(true);
                      }}
                      className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteConference(conference.id)}
                      className="p-1 hover:bg-red-500 hover:text-white transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedConferences.has(conference.id) && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                    <div>
                      <h4 className="font-bold text-sm mb-2">Address</h4>
                      <p className="text-xs text-gray-600">
                        {[conference.address, conference.city, conference.province, conference.postalCode].filter(Boolean).join(', ') || 'No address set'}
                      </p>
                    </div>
                    {(conference.attendees || []).length > 0 && (
                      <div>
                        <h4 className="font-bold text-sm mb-2">Attendees</h4>
                        <div className="grid grid-cols-2 gap-2">
                          {(conference.attendees || []).map(att => (
                            <div key={att.id} className="text-xs bg-gray-50 p-2 border border-gray-200">
                              <div className="font-bold">{att.name}</div>
                              <div className="text-gray-600">{att.email}</div>
                              {att.phone && <div className="text-gray-600">{att.phone}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(conference.meetings || []).length > 0 && (
                      <div>
                        <h4 className="font-bold text-sm mb-2">Upcoming Meetings ({(conference.meetings || []).length})</h4>
                        <div className="space-y-2">
                          {(conference.meetings || []).slice(0, 3).map(meeting => (
                            <div key={meeting.id} className="text-xs bg-gray-50 p-2 border border-gray-200">
                              <div className="font-bold">{meeting.time || '-'} - {meeting.meetingName || 'Untitled'}</div>
                              <div className="text-gray-600">{meeting.location || '-'}</div>
                            </div>
                          ))}
                          {(conference.meetings || []).length > 3 && (
                            <div className="text-xs text-gray-600 italic">+{(conference.meetings || []).length - 3} more meetings</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Conference Modal */}
      <AnimatePresence>
        {showAddConferenceModal && (
          <ConferenceModal
            title="Add Conference"
            conference={newConference}
            onConferenceChange={setNewConference}
            newAttendee={newAttendee}
            onAttendeeChange={setNewAttendee}
            onAddAttendee={handleAddAttendee}
            onRemoveAttendee={removeAttendee}
            onSubmit={handleAddConference}
            onClose={() => setShowAddConferenceModal(false)}
            submitLabel="Add Conference"
          />
        )}
      </AnimatePresence>

      {/* Edit Conference Modal */}
      <AnimatePresence>
        {showEditConferenceModal && editingConference && (
          <ConferenceModal
            title="Edit Conference"
            conference={editingConference}
            onConferenceChange={setEditingConference}
            newAttendee={newAttendee}
            onAttendeeChange={setNewAttendee}
            onAddAttendee={handleAddEditAttendee}
            onRemoveAttendee={removeEditAttendee}
            onSubmit={handleEditConference}
            onClose={() => {
              setShowEditConferenceModal(false);
              setEditingConference(null);
            }}
            submitLabel="Update Conference"
          />
        )}
      </AnimatePresence>
    </main>
  );
}

interface ConferenceModalProps {
  title: string;
  conference: Partial<Conference> | Conference;
  onConferenceChange: (conf: any) => void;
  newAttendee: { name: string; email: string; phone: string };
  onAttendeeChange: (att: any) => void;
  onAddAttendee: () => void;
  onRemoveAttendee: (attendeeId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitLabel: string;
}

function ConferenceModal({
  title,
  conference,
  onConferenceChange,
  newAttendee,
  onAttendeeChange,
  onAddAttendee,
  onRemoveAttendee,
  onSubmit,
  onClose,
  submitLabel,
}: ConferenceModalProps) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
      >
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#141414] transition-all">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Name*</label>
              <input
                type="text"
                value={conference.name || ''}
                onChange={(e) => onConferenceChange({ ...conference, name: e.target.value })}
                placeholder="Conference Name"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Status</label>
              <select
                value={conference.status || 'Planned'}
                onChange={(e) => onConferenceChange({ ...conference, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              >
                <option value="Planned">Planned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Start Date*</label>
              <input
                type="date"
                value={conference.startDate || ''}
                onChange={(e) => onConferenceChange({ ...conference, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">End Date*</label>
              <input
                type="date"
                value={conference.endDate || ''}
                onChange={(e) => onConferenceChange({ ...conference, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Location*</label>
            <input
              type="text"
              value={conference.location || ''}
              onChange={(e) => onConferenceChange({ ...conference, location: e.target.value })}
              placeholder="Venue Name"
              className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Address</label>
            <input
              type="text"
              value={conference.address || ''}
              onChange={(e) => onConferenceChange({ ...conference, address: e.target.value })}
              placeholder="Street Address"
              className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">City</label>
              <input
                type="text"
                value={conference.city || ''}
                onChange={(e) => onConferenceChange({ ...conference, city: e.target.value })}
                placeholder="City"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Province</label>
              <input
                type="text"
                value={conference.province || ''}
                onChange={(e) => onConferenceChange({ ...conference, province: e.target.value })}
                placeholder="Province"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Postal Code</label>
              <input
                type="text"
                value={conference.postalCode || ''}
                onChange={(e) => onConferenceChange({ ...conference, postalCode: e.target.value })}
                placeholder="Postal Code"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
          </div>

          {/* Attendees Section */}
          <div className="border-t pt-4">
            <h4 className="font-bold mb-3">Add Attendees</h4>
            <div className="space-y-2 mb-3">
              <input
                type="text"
                value={newAttendee.name}
                onChange={(e) => onAttendeeChange({ ...newAttendee, name: e.target.value })}
                placeholder="Name"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
              <input
                type="email"
                value={newAttendee.email}
                onChange={(e) => onAttendeeChange({ ...newAttendee, email: e.target.value })}
                placeholder="Email"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
              <input
                type="tel"
                value={newAttendee.phone}
                onChange={(e) => onAttendeeChange({ ...newAttendee, phone: e.target.value })}
                placeholder="Phone (optional)"
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              />
              <button
                onClick={onAddAttendee}
                className="w-full px-3 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                Add Attendee
              </button>
            </div>

            {conference.attendees && conference.attendees.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase text-gray-600">Attendees ({conference.attendees.length})</h5>
                {conference.attendees.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-gray-50 p-2 border border-gray-200">
                    <div className="text-xs">
                      <div className="font-bold">{att.name}</div>
                      <div className="text-gray-600">{att.email}</div>
                    </div>
                    <button
                      onClick={() => onRemoveAttendee(att.id)}
                      className="p-1 hover:bg-red-500 hover:text-white transition-all"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

interface ConferenceDetailViewProps {
  conference: Conference;
  customers: Customer[];
  people: Person[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddMeeting: () => void;
  onDeleteMeeting: (meetingId: string) => void;
  showAddMeetingModal: boolean;
  onSetShowAddMeetingModal: (show: boolean) => void;
  newMeeting: Partial<ConferenceMeeting>;
  setNewMeeting: (meeting: Partial<ConferenceMeeting>) => void;
  onHandleAddMeeting: () => void;
  salespersons: Person[];
  conferenceDates: string[];
  toggleMeetingAttendee: (attendeeId: string) => void;
  toggleMeetingCustomerAttendee: (customerId: string) => void;
}

function ConferenceDetailView({
  conference,
  customers,
  people,
  onBack,
  onEdit,
  onDelete,
  onAddMeeting,
  onDeleteMeeting,
  showAddMeetingModal,
  onSetShowAddMeetingModal,
  newMeeting,
  setNewMeeting,
  onHandleAddMeeting,
  salespersons,
  conferenceDates,
  toggleMeetingAttendee,
  toggleMeetingCustomerAttendee,
}: ConferenceDetailViewProps) {
  return (
    <main className="flex-1 p-6 overflow-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="text-sm font-bold uppercase text-gray-600 hover:text-[#141414] mb-4 flex items-center gap-2"
        >
          ← Back to Conferences
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{conference.name}</h1>
            <p className="text-sm text-gray-600 mt-2">
              {new Date(conference.startDate).toLocaleDateString()} - {new Date(conference.endDate).toLocaleDateString()}
            </p>
            <p className="text-sm text-gray-600">
              <MapPin size={14} className="inline mr-1" />
              {[conference.location, conference.city, conference.province].filter(Boolean).join(', ') || 'No location'}
            </p>
            <p className="text-xs uppercase font-bold mt-2 text-gray-600">{conference.status || 'Planned'}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onAddMeeting}
              className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
            >
              <Plus size={16} /> Add Meeting
            </button>
            <button
              onClick={onEdit}
              className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={onDelete}
              className="p-2 hover:bg-red-500 hover:text-white transition-all"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Attendees */}
      <div className="mb-8">
        <h2 className="font-bold text-lg mb-4">Attendees ({(conference.attendees || []).length})</h2>
        {!conference.attendees || conference.attendees.length === 0 ? (
          <p className="text-gray-500">No attendees added</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {(conference.attendees || []).map(attendee => (
              <div key={attendee.id} className="bg-white border border-[#141414] p-4">
                <div className="font-bold">{attendee.name}</div>
                <div className="text-xs text-gray-600 mt-1">{attendee.email}</div>
                {attendee.phone && <div className="text-xs text-gray-600">{attendee.phone}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Meetings Schedule */}
      <div>
        <h2 className="font-bold text-lg mb-4">Meeting Agenda ({(conference.meetings || []).length})</h2>
        {!conference.meetings || conference.meetings.length === 0 ? (
          <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50">
            <p>No meetings scheduled yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...conference.meetings]
              .sort((a, b) => {
                const dateCompare = (a.date || '').localeCompare(b.date || '');
                return dateCompare !== 0 ? dateCompare : (a.time || '').localeCompare(b.time || '');
              })
              .map(meeting => {
                const customer = meeting.customerId ? customers.find(c => c.id === meeting.customerId) : null;
                const meetingAttendees = conference.attendees.filter(a => (meeting.attendees || []).includes(a.id));
                const customerAttendees = customers.filter(c => (meeting.customerAttendees || []).includes(c.id));

                return (
                  <div key={meeting.id} className="bg-white border border-[#141414] p-4">
                    <div className="grid grid-cols-5 gap-4 items-start mb-3">
                      <div>
                        <div className="text-xs font-bold uppercase text-gray-600">Date & Time</div>
                        <div className="text-sm font-bold mt-1">{meeting.date ? new Date(meeting.date).toLocaleDateString() : 'No date'}</div>
                        <div className="text-lg font-bold">{meeting.time || '-'}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-xs font-bold uppercase text-gray-600">Meeting</div>
                        <div className="font-bold mt-1">{meeting.meetingName}</div>
                        {customer && <div className="text-xs text-gray-600 mt-1">Customer: {customer.name}</div>}
                      </div>
                      <div>
                        <div className="text-xs font-bold uppercase text-gray-600">Location</div>
                        <div className="text-sm mt-1">{meeting.location}</div>
                      </div>
                      <div className="text-right">
                        <button
                          onClick={() => onDeleteMeeting(meeting.id)}
                          className="text-red-500 hover:text-red-700 font-bold"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {meeting.notes && (
                      <div className="text-sm text-gray-600 mb-3 p-2 bg-gray-50 border border-gray-200">
                        <strong>Notes:</strong> {meeting.notes}
                      </div>
                    )}

                    {meetingAttendees.length > 0 && (
                      <div className="mb-2">
                        <div className="text-xs font-bold uppercase text-gray-600 mb-1">Internal Attendees</div>
                        <div className="flex flex-wrap gap-2">
                          {meetingAttendees.map(att => (
                            <span key={att.id} className="text-xs bg-blue-100 text-blue-900 px-2 py-1 rounded">
                              {att.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {customerAttendees.length > 0 && (
                      <div>
                        <div className="text-xs font-bold uppercase text-gray-600 mb-1">Customer Attendees</div>
                        <div className="flex flex-wrap gap-2">
                          {customerAttendees.map(cust => (
                            <span key={cust.id} className="text-xs bg-green-100 text-green-900 px-2 py-1 rounded">
                              {cust.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Add Meeting Modal */}
      <AnimatePresence>
        {showAddMeetingModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add Meeting</h3>
                <button
                  onClick={() => onSetShowAddMeetingModal(false)}
                  className="p-1 hover:bg-white hover:text-[#141414] transition-all"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold uppercase block mb-1">Date*</label>
                    <select
                      value={newMeeting.date || ''}
                      onChange={(e) => setNewMeeting({ ...newMeeting, date: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    >
                      <option value="">Select a date</option>
                      {conferenceDates.map(date => (
                        <option key={date} value={date}>
                          {new Date(date).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase block mb-1">Time*</label>
                    <input
                      type="time"
                      value={newMeeting.time || ''}
                      onChange={(e) => setNewMeeting({ ...newMeeting, time: e.target.value })}
                      className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Location*</label>
                  <input
                    type="text"
                    value={newMeeting.location || ''}
                    onChange={(e) => setNewMeeting({ ...newMeeting, location: e.target.value })}
                    placeholder="Meeting Location"
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Customer (Optional - auto-generates meeting name)</label>
                  <select
                    value={newMeeting.customerId || ''}
                    onChange={(e) => setNewMeeting({ ...newMeeting, customerId: e.target.value })}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  >
                    <option value="">Select a customer</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Internal Attendees</label>
                  <div className="space-y-2 mb-2 max-h-40 overflow-y-auto bg-gray-50 p-2 border border-gray-200">
                    {salespersons.length === 0 ? (
                      <p className="text-xs text-gray-600">No salespersons available</p>
                    ) : (
                      salespersons.map(person => (
                        <label key={person.id} className="flex items-center text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newMeeting.attendees?.includes(person.id) || false}
                            onChange={() => toggleMeetingAttendee(person.id)}
                            className="mr-2"
                          />
                          <span>
                            {person.name} ({person.salespersonNumber})
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Customer Attendees</label>
                  <div className="space-y-2 mb-2 max-h-40 overflow-y-auto bg-gray-50 p-2 border border-gray-200">
                    {customers.length === 0 ? (
                      <p className="text-xs text-gray-600">No customers available</p>
                    ) : (
                      customers.map(customer => (
                        <label key={customer.id} className="flex items-center text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newMeeting.customerAttendees?.includes(customer.id) || false}
                            onChange={() => toggleMeetingCustomerAttendee(customer.id)}
                            className="mr-2"
                          />
                          <span>{customer.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase block mb-1">Notes</label>
                  <textarea
                    value={newMeeting.notes || ''}
                    onChange={(e) => setNewMeeting({ ...newMeeting, notes: e.target.value })}
                    placeholder="Additional notes..."
                    rows={3}
                    className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t">
                  <button
                    onClick={() => onSetShowAddMeetingModal(false)}
                    className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onHandleAddMeeting}
                    className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                  >
                    Add Meeting
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
