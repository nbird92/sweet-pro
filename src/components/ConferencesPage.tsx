import React, { useState, useMemo } from 'react';
import { Conference, ConferenceAttendee, ConferenceMeeting, CustomerAttendeeDetail, MeetingFollowUp, Customer, Person } from '../types';
import { Plus, X, Edit2, Trash2, ChevronDown, Clock, MapPin, Users, Search, ArrowUpDown, CheckSquare, Square, FileText } from 'lucide-react';
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

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-4 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
      />
    </div>
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
  const [showEditMeetingModal, setShowEditMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<ConferenceMeeting | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);

  const [editingConference, setEditingConference] = useState<Conference | null>(null);
  const [newConference, setNewConference] = useState<Partial<Conference>>({
    name: '', startDate: '', endDate: '', location: '', address: '', city: '', province: '', postalCode: '',
    attendees: [], meetings: [], status: 'Planned',
  });

  const [newMeeting, setNewMeeting] = useState<Partial<ConferenceMeeting>>({
    date: '', time: '', meetingName: '', attendees: [], customerAttendees: [], customerAttendeeDetails: [],
    location: '', notes: '', customerId: '', followUps: [],
  });

  // Customer attendee input state
  const [newCustAttendee, setNewCustAttendee] = useState<{ name: string; email: string; phone: string }>({ name: '', email: '', phone: '' });

  // Follow-up input state
  const [newFollowUp, setNewFollowUp] = useState('');

  // Meeting search/sort state
  const [meetingSearch, setMeetingSearch] = useState('');
  const [meetingSortField, setMeetingSortField] = useState<'date' | 'time' | 'meetingName' | 'location' | 'customer'>('date');
  const [meetingSortDir, setMeetingSortDir] = useState<'asc' | 'desc'>('asc');

  const salesPeople = people.filter(p => p.department === 'sales');

  // --- Handlers ---

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
    // Also update the selectedConference if we are inside a conference detail view
    if (selectedConference && selectedConference.id === editingConference.id) {
      setSelectedConference(editingConference);
    }
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

  const addSalesAttendeeToConference = (personId: string, target: 'new' | 'edit') => {
    const person = people.find(p => p.id === personId);
    if (!person) return;
    const attendee: ConferenceAttendee = {
      id: `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      personId: person.id,
      name: person.name,
      email: person.email,
      phone: person.phone,
    };
    if (target === 'new') {
      // Check duplicate
      if ((newConference.attendees || []).some(a => a.personId === personId)) return;
      setNewConference(prev => ({ ...prev, attendees: [...(prev.attendees || []), attendee] }));
    } else if (target === 'edit' && editingConference) {
      if (editingConference.attendees.some(a => a.personId === personId)) return;
      setEditingConference(prev => ({ ...prev!, attendees: [...prev!.attendees, attendee] }));
    }
  };

  const removeAttendee = (attendeeId: string) => {
    setNewConference(prev => ({ ...prev, attendees: prev.attendees?.filter(a => a.id !== attendeeId) || [] }));
  };

  const removeEditAttendee = (attendeeId: string) => {
    if (editingConference) {
      setEditingConference(prev => ({ ...prev!, attendees: prev!.attendees.filter(a => a.id !== attendeeId) }));
    }
  };

  const handleAddMeeting = () => {
    if (!selectedConference || !newMeeting.date || !newMeeting.time || !newMeeting.location) {
      alert('Please fill in date, time, and location');
      return;
    }
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
      meetingName,
      attendees: newMeeting.attendees || [],
      customerAttendees: [],
      customerAttendeeDetails: newMeeting.customerAttendeeDetails || [],
      location: newMeeting.location!,
      notes: newMeeting.notes,
      customerId: newMeeting.customerId,
      followUps: [],
    };
    const updatedConference: Conference = { ...selectedConference, meetings: [...selectedConference.meetings, meeting] };
    onAddMeeting(selectedConference.id, meeting);
    setSelectedConference(updatedConference);
    setShowAddMeetingModal(false);
    resetMeetingForm();
  };

  const handleEditMeeting = () => {
    if (!selectedConference || !editingMeeting) return;
    if (!editingMeeting.date || !editingMeeting.time || !editingMeeting.location) {
      alert('Please fill in date, time, and location');
      return;
    }
    // Auto-generate name from customer if blank
    if (editingMeeting.customerId && !editingMeeting.meetingName) {
      const customer = customers.find(c => c.id === editingMeeting.customerId);
      editingMeeting.meetingName = customer ? customer.name : 'Meeting';
    }
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => m.id === editingMeeting.id ? editingMeeting : m),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
    setShowEditMeetingModal(false);
    setEditingMeeting(null);
  };

  const handleDeleteMeeting = (meetingId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.filter(m => m.id !== meetingId),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
    if (expandedMeeting === meetingId) setExpandedMeeting(null);
  };

  const toggleFollowUp = (meetingId: string, followUpId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => {
        if (m.id !== meetingId) return m;
        return {
          ...m,
          followUps: (m.followUps || []).map(f =>
            f.id === followUpId ? { ...f, completed: !f.completed } : f
          ),
        };
      }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const addFollowUp = (meetingId: string, text: string) => {
    if (!selectedConference || !text.trim()) return;
    const followUp: MeetingFollowUp = {
      id: `FU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      completed: false,
      createdAt: new Date().toISOString(),
    };
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => {
        if (m.id !== meetingId) return m;
        return { ...m, followUps: [...(m.followUps || []), followUp] };
      }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const updateMeetingNotes = (meetingId: string, notes: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m =>
        m.id === meetingId ? { ...m, notes } : m
      ),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const deleteFollowUp = (meetingId: string, followUpId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => {
        if (m.id !== meetingId) return m;
        return { ...m, followUps: (m.followUps || []).filter(f => f.id !== followUpId) };
      }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const resetConferenceForm = () => {
    setNewConference({
      name: '', startDate: '', endDate: '', location: '', address: '', city: '', province: '', postalCode: '',
      attendees: [], meetings: [], status: 'Planned',
    });
  };

  const resetMeetingForm = () => {
    setNewMeeting({
      date: '', time: '', meetingName: '', attendees: [], customerAttendees: [], customerAttendeeDetails: [],
      location: '', notes: '', customerId: '', followUps: [],
    });
    setNewCustAttendee({ name: '', email: '', phone: '' });
  };

  const filteredConferences = conferences.filter(conf =>
    (conf.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (conf.location || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getConferenceDates = (): string[] => {
    if (!selectedConference) return [];
    const dates: string[] = [];
    const start = new Date(selectedConference.startDate);
    const end = new Date(selectedConference.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  };

  // Helper to get person name from ID
  const getPersonName = (personId: string): string => {
    const person = people.find(p => p.id === personId);
    return person ? person.name : personId;
  };

  // ============================
  // CONFERENCE DETAIL VIEW
  // ============================
  if (selectedConference) {
    const conferenceDates = getConferenceDates();
    const meetings = [...(selectedConference.meetings || [])];

    // Filter meetings by search
    const filteredMeetings = meetings.filter(m => {
      if (!meetingSearch) return true;
      const search = meetingSearch.toLowerCase();
      const customer = m.customerId ? customers.find(c => c.id === m.customerId) : null;
      const attendeeNames = (m.attendees || []).map(id => getPersonName(id)).join(' ');
      const custAttendeesStr = (m.customerAttendeeDetails || []).map(ca => ca.name).join(' ');
      return (
        (m.meetingName || '').toLowerCase().includes(search) ||
        (m.location || '').toLowerCase().includes(search) ||
        (m.date || '').includes(search) ||
        (m.time || '').includes(search) ||
        (customer?.name || '').toLowerCase().includes(search) ||
        attendeeNames.toLowerCase().includes(search) ||
        custAttendeesStr.toLowerCase().includes(search)
      );
    });

    // Sort meetings
    const sortedMeetings = filteredMeetings.sort((a, b) => {
      let cmp = 0;
      if (meetingSortField === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
        if (cmp === 0) cmp = (a.time || '').localeCompare(b.time || '');
      } else if (meetingSortField === 'time') {
        cmp = (a.time || '').localeCompare(b.time || '');
      } else if (meetingSortField === 'meetingName') {
        cmp = (a.meetingName || '').localeCompare(b.meetingName || '');
      } else if (meetingSortField === 'location') {
        cmp = (a.location || '').localeCompare(b.location || '');
      } else if (meetingSortField === 'customer') {
        const custA = a.customerId ? customers.find(c => c.id === a.customerId)?.name || '' : '';
        const custB = b.customerId ? customers.find(c => c.id === b.customerId)?.name || '' : '';
        cmp = custA.localeCompare(custB);
      }
      return meetingSortDir === 'asc' ? cmp : -cmp;
    });

    const toggleSort = (field: typeof meetingSortField) => {
      if (meetingSortField === field) {
        setMeetingSortDir(meetingSortDir === 'asc' ? 'desc' : 'asc');
      } else {
        setMeetingSortField(field);
        setMeetingSortDir('asc');
      }
    };

    const SortHeader = ({ field, label }: { field: typeof meetingSortField; label: string }) => (
      <th
        className="p-3 border-r border-[#E4E3E0]/20 cursor-pointer hover:bg-[#2a2a2a] transition-colors select-none"
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          {label}
          <ArrowUpDown size={10} className={meetingSortField === field ? 'opacity-100' : 'opacity-40'} />
        </div>
      </th>
    );

    return (
      <main className="flex-1 p-6 overflow-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => {
              setSelectedConference(null);
              setShowEditConferenceModal(false);
              setEditingConference(null);
              setExpandedMeeting(null);
              setMeetingSearch('');
            }}
            className="text-sm font-bold uppercase text-gray-600 hover:text-[#141414] mb-4 flex items-center gap-2"
          >
            ← Back to Conferences
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{selectedConference.name}</h1>
              <p className="text-sm text-gray-600 mt-2">
                {new Date(selectedConference.startDate).toLocaleDateString()} - {new Date(selectedConference.endDate).toLocaleDateString()}
              </p>
              <p className="text-sm text-gray-600">
                <MapPin size={14} className="inline mr-1" />
                {[selectedConference.location, selectedConference.city, selectedConference.province].filter(Boolean).join(', ') || 'No location'}
              </p>
              <p className="text-xs uppercase font-bold mt-2 text-gray-600">{selectedConference.status || 'Planned'}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  resetMeetingForm();
                  setShowAddMeetingModal(true);
                }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
              >
                <Plus size={16} /> Add Meeting
              </button>
              <button
                onClick={() => {
                  setEditingConference({ ...selectedConference });
                  setShowEditConferenceModal(true);
                }}
                className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
              >
                <Edit2 size={16} />
              </button>
              <button
                onClick={() => handleDeleteConference(selectedConference.id)}
                className="p-2 hover:bg-red-500 hover:text-white transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Attendees */}
        <div className="mb-8">
          <h2 className="font-bold text-lg mb-4">Attendees ({(selectedConference.attendees || []).length})</h2>
          {!selectedConference.attendees || selectedConference.attendees.length === 0 ? (
            <p className="text-gray-500 text-sm">No attendees added</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {(selectedConference.attendees || []).map(attendee => (
                <div key={attendee.id} className="bg-white border border-[#141414] p-3">
                  <div className="font-bold text-sm">{attendee.name}</div>
                  <div className="text-xs text-gray-600 mt-1">{attendee.email}</div>
                  {attendee.phone && <div className="text-xs text-gray-600">{attendee.phone}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scheduled Meetings */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">Scheduled Meetings ({(selectedConference.meetings || []).length})</h2>
          </div>

          {/* Meeting Search */}
          <div className="mb-4">
            <SearchInput
              value={meetingSearch}
              onChange={setMeetingSearch}
              placeholder="Search meetings by name, customer, attendee, location..."
            />
          </div>

          {!selectedConference.meetings || selectedConference.meetings.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50">
              <p>No meetings scheduled yet</p>
            </div>
          ) : (
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    <SortHeader field="date" label="Date" />
                    <SortHeader field="time" label="Time" />
                    <SortHeader field="meetingName" label="Meeting" />
                    <SortHeader field="customer" label="Customer" />
                    <th className="p-3 border-r border-[#E4E3E0]/20">Internal Attendees</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Customer Attendees</th>
                    <SortHeader field="location" label="Location" />
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedMeetings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-xs font-bold opacity-40 italic">
                        No meetings match your search.
                      </td>
                    </tr>
                  )}
                  {sortedMeetings.map(meeting => {
                    const customer = meeting.customerId ? customers.find(c => c.id === meeting.customerId) : null;
                    const internalAttendeeNames = (meeting.attendees || []).map(id => getPersonName(id));
                    const custAttendees = meeting.customerAttendeeDetails || [];
                    const isExpanded = expandedMeeting === meeting.id;

                    return (
                      <React.Fragment key={meeting.id}>
                        <tr
                          className={`hover:bg-[#F5F5F5] transition-colors cursor-pointer ${isExpanded ? 'bg-[#F5F5F5]' : ''}`}
                          onClick={() => setExpandedMeeting(isExpanded ? null : meeting.id)}
                        >
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">
                            {meeting.date ? new Date(meeting.date + 'T00:00:00').toLocaleDateString() : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.time || '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.meetingName || 'Untitled'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">{customer?.name || '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">
                            {internalAttendeeNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {internalAttendeeNames.map((name, i) => (
                                  <span key={i} className="bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{name}</span>
                                ))}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">
                            {custAttendees.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {custAttendees.map(ca => (
                                  <span key={ca.id} className="bg-green-100 text-green-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{ca.name}</span>
                                ))}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">{meeting.location || '—'}</td>
                          <td className="p-3 text-xs">
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setEditingMeeting({ ...meeting, customerAttendeeDetails: meeting.customerAttendeeDetails || [], followUps: meeting.followUps || [] });
                                  setShowEditMeetingModal(true);
                                }}
                                className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                                title="Edit Meeting"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteMeeting(meeting.id)}
                                className="p-1 hover:bg-red-500 hover:text-white transition-all"
                                title="Delete Meeting"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Meeting Detail (Notes + Follow-ups) */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="p-0">
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden bg-[#F9F9F9] border-t border-[#141414]/10"
                                >
                                  <div className="p-6 space-y-4">
                                    {/* Meeting Notes */}
                                    <div>
                                      <label className="text-xs font-bold uppercase text-gray-600 mb-2 flex items-center gap-1">
                                        <FileText size={12} /> Meeting Notes
                                      </label>
                                      <textarea
                                        value={meeting.notes || ''}
                                        onChange={(e) => updateMeetingNotes(meeting.id, e.target.value)}
                                        placeholder="Add meeting notes..."
                                        rows={3}
                                        className="w-full px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]"
                                      />
                                    </div>

                                    {/* Follow-ups */}
                                    <div>
                                      <label className="text-xs font-bold uppercase text-gray-600 mb-2 block">Follow-ups</label>
                                      {(meeting.followUps || []).length > 0 && (
                                        <div className="space-y-2 mb-3">
                                          {(meeting.followUps || []).map(fu => (
                                            <div key={fu.id} className="flex items-start gap-2 bg-white p-2 border border-[#141414]/10">
                                              <button
                                                onClick={(e) => { e.stopPropagation(); toggleFollowUp(meeting.id, fu.id); }}
                                                className="mt-0.5 flex-shrink-0"
                                              >
                                                {fu.completed ? (
                                                  <CheckSquare size={16} className="text-emerald-600" />
                                                ) : (
                                                  <Square size={16} className="text-gray-400" />
                                                )}
                                              </button>
                                              <span className={`text-sm flex-1 ${fu.completed ? 'line-through text-gray-400' : ''}`}>
                                                {fu.text}
                                              </span>
                                              <button
                                                onClick={(e) => { e.stopPropagation(); deleteFollowUp(meeting.id, fu.id); }}
                                                className="p-0.5 hover:text-red-500 transition-all flex-shrink-0"
                                              >
                                                <X size={12} />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          value={newFollowUp}
                                          onChange={(e) => setNewFollowUp(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newFollowUp.trim()) {
                                              addFollowUp(meeting.id, newFollowUp);
                                              setNewFollowUp('');
                                            }
                                          }}
                                          placeholder="Add a follow-up item..."
                                          className="flex-1 px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]"
                                          onClick={(e) => e.stopPropagation()}
                                        />
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (newFollowUp.trim()) {
                                              addFollowUp(meeting.id, newFollowUp);
                                              setNewFollowUp('');
                                            }
                                          }}
                                          className="px-3 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
                                        >
                                          Add
                                        </button>
                                      </div>
                                    </div>

                                    {/* Contact info for customer attendees */}
                                    {custAttendees.length > 0 && (
                                      <div>
                                        <label className="text-xs font-bold uppercase text-gray-600 mb-2 block">Customer Attendee Details</label>
                                        <div className="grid grid-cols-3 gap-2">
                                          {custAttendees.map(ca => (
                                            <div key={ca.id} className="bg-white p-2 border border-[#141414]/10 text-xs">
                                              <div className="font-bold">{ca.name}</div>
                                              {ca.email && <div className="text-gray-600">{ca.email}</div>}
                                              {ca.phone && <div className="text-gray-600">{ca.phone}</div>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
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
          )}
        </div>

        {/* Add Meeting Modal */}
        <AnimatePresence>
          {showAddMeetingModal && (
            <MeetingModal
              title="Add Meeting"
              meeting={newMeeting}
              setMeeting={setNewMeeting}
              onSubmit={handleAddMeeting}
              onClose={() => { setShowAddMeetingModal(false); resetMeetingForm(); }}
              submitLabel="Add Meeting"
              customers={customers}
              salesPeople={salesPeople}
              conferenceDates={conferenceDates}
              newCustAttendee={newCustAttendee}
              setNewCustAttendee={setNewCustAttendee}
            />
          )}
        </AnimatePresence>

        {/* Edit Meeting Modal */}
        <AnimatePresence>
          {showEditMeetingModal && editingMeeting && (
            <MeetingModal
              title="Edit Meeting"
              meeting={editingMeeting}
              setMeeting={(m: any) => setEditingMeeting(m)}
              onSubmit={handleEditMeeting}
              onClose={() => { setShowEditMeetingModal(false); setEditingMeeting(null); }}
              submitLabel="Update Meeting"
              customers={customers}
              salesPeople={salesPeople}
              conferenceDates={conferenceDates}
              newCustAttendee={newCustAttendee}
              setNewCustAttendee={setNewCustAttendee}
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
              onRemoveAttendee={removeEditAttendee}
              onSubmit={handleEditConference}
              onClose={() => { setShowEditConferenceModal(false); setEditingConference(null); }}
              submitLabel="Update Conference"
              salesPeople={salesPeople}
              onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'edit')}
            />
          )}
        </AnimatePresence>
      </main>
    );
  }

  // ============================
  // CONFERENCES LIST VIEW
  // ============================
  return (
    <main className="flex-1 p-6 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conferences</h1>
        <button
          onClick={() => { resetConferenceForm(); setShowAddConferenceModal(true); }}
          className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
        >
          <Plus size={16} /> Add Conference
        </button>
      </div>

      <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search conferences by name or location..." />

      {/* Conferences Table */}
      <div className="mt-6">
        {filteredConferences.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No conferences found. Create one to get started!</p>
          </div>
        ) : (
          <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                  <th className="p-3 border-r border-[#E4E3E0]/20">Conference</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Dates</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Location</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Attendees</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Meetings</th>
                  <th className="p-3 border-r border-[#E4E3E0]/20">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/10">
                {filteredConferences.map(conference => (
                  <tr
                    key={conference.id}
                    className="hover:bg-[#F5F5F5] transition-colors cursor-pointer group"
                    onClick={() => setSelectedConference(conference)}
                  >
                    <td className="p-3 text-xs font-bold border-r border-[#141414]/10">{conference.name}</td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      {new Date(conference.startDate).toLocaleDateString()} - {new Date(conference.endDate).toLocaleDateString()}
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <span className="flex items-center gap-1"><MapPin size={10} /> {conference.location || '—'}</span>
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <span className="flex items-center gap-1"><Users size={10} /> {(conference.attendees || []).length}</span>
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <span className="flex items-center gap-1"><Clock size={10} /> {(conference.meetings || []).length}</span>
                    </td>
                    <td className="p-3 text-xs border-r border-[#141414]/10">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] ${
                        (conference.status || 'Planned') === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                        (conference.status || 'Planned') === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{conference.status || 'Planned'}</span>
                    </td>
                    <td className="p-3 text-xs" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditingConference({ ...conference });
                            setShowEditConferenceModal(true);
                          }}
                          className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteConference(conference.id)}
                          className="p-1 hover:bg-red-500 hover:text-white transition-all"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Conference Modal */}
      <AnimatePresence>
        {showAddConferenceModal && (
          <ConferenceModal
            title="Add Conference"
            conference={newConference}
            onConferenceChange={setNewConference}
            onRemoveAttendee={removeAttendee}
            onSubmit={handleAddConference}
            onClose={() => setShowAddConferenceModal(false)}
            submitLabel="Add Conference"
            salesPeople={salesPeople}
            onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'new')}
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
            onRemoveAttendee={removeEditAttendee}
            onSubmit={handleEditConference}
            onClose={() => { setShowEditConferenceModal(false); setEditingConference(null); }}
            submitLabel="Update Conference"
            salesPeople={salesPeople}
            onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'edit')}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ============================
// CONFERENCE MODAL (Add/Edit)
// ============================
interface ConferenceModalProps {
  title: string;
  conference: Partial<Conference> | Conference;
  onConferenceChange: (conf: any) => void;
  onRemoveAttendee: (attendeeId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitLabel: string;
  salesPeople: Person[];
  onAddSalesAttendee: (personId: string) => void;
}

function ConferenceModal({
  title, conference, onConferenceChange, onRemoveAttendee,
  onSubmit, onClose, submitLabel, salesPeople, onAddSalesAttendee,
}: ConferenceModalProps) {
  const [selectedSalesPersonId, setSelectedSalesPersonId] = useState('');

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
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#141414] transition-all"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Name*</label>
              <input type="text" value={conference.name || ''} onChange={(e) => onConferenceChange({ ...conference, name: e.target.value })}
                placeholder="Conference Name" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Status</label>
              <select value={conference.status || 'Planned'} onChange={(e) => onConferenceChange({ ...conference, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="Planned">Planned</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Start Date*</label>
              <input type="date" value={conference.startDate || ''} onChange={(e) => onConferenceChange({ ...conference, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">End Date*</label>
              <input type="date" value={conference.endDate || ''} onChange={(e) => onConferenceChange({ ...conference, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Location*</label>
            <input type="text" value={conference.location || ''} onChange={(e) => onConferenceChange({ ...conference, location: e.target.value })}
              placeholder="Venue Name" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Address</label>
            <input type="text" value={conference.address || ''} onChange={(e) => onConferenceChange({ ...conference, address: e.target.value })}
              placeholder="Street Address" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">City</label>
              <input type="text" value={conference.city || ''} onChange={(e) => onConferenceChange({ ...conference, city: e.target.value })}
                placeholder="City" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Province</label>
              <input type="text" value={conference.province || ''} onChange={(e) => onConferenceChange({ ...conference, province: e.target.value })}
                placeholder="Province" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Postal Code</label>
              <input type="text" value={conference.postalCode || ''} onChange={(e) => onConferenceChange({ ...conference, postalCode: e.target.value })}
                placeholder="Postal Code" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
          </div>

          {/* Attendees - Sales Employee Dropdown */}
          <div className="border-t pt-4">
            <h4 className="font-bold mb-3">Attendees (Sales Employees)</h4>
            <div className="flex gap-2 mb-3">
              <select
                value={selectedSalesPersonId}
                onChange={(e) => setSelectedSalesPersonId(e.target.value)}
                className="flex-1 px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]"
              >
                <option value="">Select a sales employee...</option>
                {salesPeople.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.salespersonNumber ? `(${p.salespersonNumber})` : ''} — {p.email}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (selectedSalesPersonId) {
                    onAddSalesAttendee(selectedSalesPersonId);
                    setSelectedSalesPersonId('');
                  }
                }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all"
              >
                Add
              </button>
            </div>

            {conference.attendees && conference.attendees.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase text-gray-600">Added Attendees ({conference.attendees.length})</h5>
                {conference.attendees.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-gray-50 p-2 border border-gray-200">
                    <div className="text-xs">
                      <div className="font-bold">{att.name}</div>
                      <div className="text-gray-600">{att.email}{att.phone ? ` | ${att.phone}` : ''}</div>
                    </div>
                    <button onClick={() => onRemoveAttendee(att.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
              Cancel
            </button>
            <button onClick={onSubmit} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all">
              {submitLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================
// MEETING MODAL (Add/Edit)
// ============================
interface MeetingModalProps {
  title: string;
  meeting: Partial<ConferenceMeeting>;
  setMeeting: (m: any) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitLabel: string;
  customers: Customer[];
  salesPeople: Person[];
  conferenceDates: string[];
  newCustAttendee: { name: string; email: string; phone: string };
  setNewCustAttendee: (a: { name: string; email: string; phone: string }) => void;
}

function MeetingModal({
  title, meeting, setMeeting, onSubmit, onClose, submitLabel,
  customers, salesPeople, conferenceDates, newCustAttendee, setNewCustAttendee,
}: MeetingModalProps) {

  const toggleInternalAttendee = (personId: string) => {
    const current = meeting.attendees || [];
    setMeeting({
      ...meeting,
      attendees: current.includes(personId)
        ? current.filter((id: string) => id !== personId)
        : [...current, personId],
    });
  };

  const addCustomerAttendee = () => {
    if (!newCustAttendee.name) {
      alert('Please enter a name for the customer attendee');
      return;
    }
    const detail: CustomerAttendeeDetail = {
      id: `CA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newCustAttendee.name,
      email: newCustAttendee.email,
      phone: newCustAttendee.phone,
    };
    setMeeting({
      ...meeting,
      customerAttendeeDetails: [...(meeting.customerAttendeeDetails || []), detail],
    });
    setNewCustAttendee({ name: '', email: '', phone: '' });
  };

  const removeCustomerAttendee = (id: string) => {
    setMeeting({
      ...meeting,
      customerAttendeeDetails: (meeting.customerAttendeeDetails || []).filter((ca: CustomerAttendeeDetail) => ca.id !== id),
    });
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden"
      >
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#141414] transition-all"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Date*</label>
              <select value={meeting.date || ''} onChange={(e) => setMeeting({ ...meeting, date: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="">Select a date</option>
                {conferenceDates.map(date => (
                  <option key={date} value={date}>{new Date(date + 'T00:00:00').toLocaleDateString()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase block mb-1">Time*</label>
              <input type="time" value={meeting.time || ''} onChange={(e) => setMeeting({ ...meeting, time: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Location*</label>
            <input type="text" value={meeting.location || ''} onChange={(e) => setMeeting({ ...meeting, location: e.target.value })}
              placeholder="Meeting Location" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Customer (auto-generates meeting name)</label>
            <select value={meeting.customerId || ''} onChange={(e) => setMeeting({ ...meeting, customerId: e.target.value })}
              className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
              <option value="">Select a customer</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Meeting Name</label>
            <input type="text" value={meeting.meetingName || ''} onChange={(e) => setMeeting({ ...meeting, meetingName: e.target.value })}
              placeholder="Auto-generated from customer if left blank" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
          </div>

          {/* Internal Attendees (Sales People) */}
          <div>
            <label className="text-xs font-bold uppercase block mb-1">Internal Attendees (Sales)</label>
            <div className="space-y-2 max-h-40 overflow-y-auto bg-gray-50 p-2 border border-gray-200">
              {salesPeople.length === 0 ? (
                <p className="text-xs text-gray-600">No sales employees available</p>
              ) : (
                salesPeople.map(person => (
                  <label key={person.id} className="flex items-center text-xs cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors">
                    <input
                      type="checkbox"
                      checked={(meeting.attendees || []).includes(person.id)}
                      onChange={() => toggleInternalAttendee(person.id)}
                      className="mr-2"
                    />
                    <span className="font-bold">{person.name}</span>
                    <span className="text-gray-500 ml-1">{person.salespersonNumber ? `(${person.salespersonNumber})` : ''} — {person.email}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Customer Attendees (open text fields) */}
          <div>
            <label className="text-xs font-bold uppercase block mb-1">Customer Attendees</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input type="text" value={newCustAttendee.name} onChange={(e) => setNewCustAttendee({ ...newCustAttendee, name: e.target.value })}
                placeholder="Name" className="px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
              <input type="email" value={newCustAttendee.email} onChange={(e) => setNewCustAttendee({ ...newCustAttendee, email: e.target.value })}
                placeholder="Email" className="px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
              <div className="flex gap-2">
                <input type="tel" value={newCustAttendee.phone} onChange={(e) => setNewCustAttendee({ ...newCustAttendee, phone: e.target.value })}
                  placeholder="Phone" className="flex-1 px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                <button onClick={addCustomerAttendee}
                  className="px-3 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all whitespace-nowrap">
                  Add
                </button>
              </div>
            </div>

            {(meeting.customerAttendeeDetails || []).length > 0 && (
              <div className="space-y-2">
                {(meeting.customerAttendeeDetails || []).map((ca: CustomerAttendeeDetail) => (
                  <div key={ca.id} className="flex items-center justify-between bg-green-50 p-2 border border-green-200 text-xs">
                    <div>
                      <span className="font-bold">{ca.name}</span>
                      {ca.email && <span className="text-gray-600 ml-2">{ca.email}</span>}
                      {ca.phone && <span className="text-gray-600 ml-2">{ca.phone}</span>}
                    </div>
                    <button onClick={() => removeCustomerAttendee(ca.id)} className="p-1 hover:bg-red-500 hover:text-white transition-all">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold uppercase block mb-1">Notes</label>
            <textarea value={meeting.notes || ''} onChange={(e) => setMeeting({ ...meeting, notes: e.target.value })}
              placeholder="Additional notes..." rows={3}
              className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
              Cancel
            </button>
            <button onClick={onSubmit} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-all">
              {submitLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
