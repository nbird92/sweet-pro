import React, { useState, useEffect } from 'react';
import { Conference, ConferenceAttendee, ConferenceMeeting, CustomerAttendeeDetail, MeetingFollowUp, Customer, Person, SalesLead, SalesLeadFollowUp } from '../types';
import { Plus, X, Edit2, Trash2, ChevronDown, ChevronUp, Clock, MapPin, Users, Search, ArrowUpDown, CheckSquare, Square, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import PageBanner from './PageBanner';
import { PageToolbar } from './PageShell';
import DataTable from './DataTable';
import type { SheetSpec } from '../utils/exportExcel';

/** "2026-11-21T09:30" → "Nov 21, 9:30 AM". */
const fmtReminder = (v?: string) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

interface ConferencesPageProps {
  conferences: Conference[];
  customers: Customer[];
  people: Person[];
  onAddConference: (conference: Conference) => void;
  onUpdateConference: (conference: Conference) => void;
  onDeleteConference: (conferenceId: string) => void;
  onAddMeeting: (conferenceId: string, meeting: ConferenceMeeting) => void;
  onCreateSalesLead?: (lead: SalesLead) => void;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full pl-9 pr-4 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" />
    </div>
  );
}

export default function ConferencesPage({
  conferences, customers, people, onAddConference, onUpdateConference, onDeleteConference, onAddMeeting, onCreateSalesLead,
}: ConferencesPageProps) {
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [showAddConferenceModal, setShowAddConferenceModal] = useState(false);
  const [showEditConferenceModal, setShowEditConferenceModal] = useState(false);
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false);
  const [showEditMeetingModal, setShowEditMeetingModal] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<ConferenceMeeting | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  // Scheduled Meetings: table list or daily calendar (days × hourly slots).
  const [meetingView, setMeetingView] = useState<'table' | 'calendar'>('table');
  const [editingConference, setEditingConference] = useState<Conference | null>(null);

  const [newConference, setNewConference] = useState<Partial<Conference>>({
    name: '', startDate: '', endDate: '', location: '', address: '', city: '', province: '', postalCode: '',
    attendees: [], meetings: [], status: 'Planned',
  });
  const [newMeeting, setNewMeeting] = useState<Partial<ConferenceMeeting>>({
    date: '', time: '', meetingName: '', meetingOwner: '', attendees: [], customerAttendees: [],
    customerAttendeeDetails: [], location: '', notes: '', customerId: '', followUps: [],
  });
  const [newInlineCustAttendee, setNewInlineCustAttendee] = useState({ name: '', email: '', phone: '' });
  const [newFollowUp, setNewFollowUp] = useState('');

  // Meeting table sort state
  const [meetingSearch, setMeetingSearch] = useState('');
  const [meetingSortField, setMeetingSortField] = useState<'date' | 'time' | 'meetingName' | 'location' | 'customer' | 'owner'>('date');
  const [meetingSortDir, setMeetingSortDir] = useState<'asc' | 'desc'>('asc');

  // Follow-up table state
  const [followUpSearch, setFollowUpSearch] = useState('');
  const [followUpSortField, setFollowUpSortField] = useState<'status' | 'text' | 'meeting' | 'owner' | 'customer'>('status');
  const [followUpSortDir, setFollowUpSortDir] = useState<'asc' | 'desc'>('asc');
  const [editingFollowUp, setEditingFollowUp] = useState<{ meetingId: string; followUp: MeetingFollowUp } | null>(null);
  const [editingFollowUpText, setEditingFollowUpText] = useState('');

  // Keep selectedConference in sync with conferences prop (e.g., after Firestore updates)
  useEffect(() => {
    if (selectedConference) {
      const updated = conferences.find(c => c.id === selectedConference.id);
      if (updated) {
        setSelectedConference(updated);
      } else {
        setSelectedConference(null);
      }
    }
  }, [conferences]);

  const salesPeople = people.filter(p => p.department === 'sales');

  const getPersonName = (personId: string): string => {
    const person = people.find(p => p.id === personId);
    return person ? person.name : personId;
  };

  const getCustomerAttendeeNames = (meeting: ConferenceMeeting): string[] => {
    const names: string[] = [];
    // New format
    if (meeting.customerAttendeeDetails && meeting.customerAttendeeDetails.length > 0) {
      names.push(...meeting.customerAttendeeDetails.map(ca => ca.name));
    }
    // Legacy format: customerAttendees are customer IDs
    if (meeting.customerAttendees && meeting.customerAttendees.length > 0) {
      for (const cId of meeting.customerAttendees) {
        const cust = customers.find(c => c.id === cId);
        if (cust && !names.includes(cust.name)) names.push(cust.name);
      }
    }
    return names;
  };

  // --- Handlers ---
  const handleAddConference = () => {
    if (!newConference.name || !newConference.startDate || !newConference.endDate) { alert('Please fill in all required fields'); return; }
    const conference: Conference = {
      id: `CONF-${Date.now()}`, name: newConference.name!, startDate: newConference.startDate!, endDate: newConference.endDate!,
      location: newConference.location!, address: newConference.address, city: newConference.city, province: newConference.province,
      postalCode: newConference.postalCode, attendees: newConference.attendees || [], meetings: [],
      createdAt: new Date().toISOString(), status: newConference.status || 'Planned',
    };
    onAddConference(conference);
    setShowAddConferenceModal(false);
    resetConferenceForm();
  };

  const handleEditConference = () => {
    if (!editingConference || !editingConference.name || !editingConference.startDate || !editingConference.endDate) { alert('Please fill in all required fields'); return; }
    onUpdateConference(editingConference);
    if (selectedConference && selectedConference.id === editingConference.id) setSelectedConference(editingConference);
    setShowEditConferenceModal(false);
    setEditingConference(null);
  };

  const handleDeleteConference = (id: string) => {
    if (confirm('Are you sure you want to delete this conference?')) {
      onDeleteConference(id);
      if (selectedConference?.id === id) setSelectedConference(null);
    }
  };

  const addSalesAttendeeToConference = (personId: string, target: 'new' | 'edit') => {
    const person = people.find(p => p.id === personId);
    if (!person) return;
    const attendee: ConferenceAttendee = {
      id: `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      personId: person.id, name: person.name, email: person.email, phone: person.phone,
    };
    if (target === 'new') {
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
    if (editingConference) setEditingConference(prev => ({ ...prev!, attendees: prev!.attendees.filter(a => a.id !== attendeeId) }));
  };

  const handleAddMeeting = (override?: Partial<ConferenceMeeting>) => {
    const nm = override || newMeeting;
    if (!selectedConference || !nm.date || !nm.time || !nm.location) { alert('Please fill in date, start time, and location'); return; }
    if (nm.endTime && nm.endTime < nm.time) { alert('End time must be after the start time'); return; }
    const isNewCustomer = nm.customerId === '__NEW_CUSTOMER__';
    let meetingName = nm.meetingName || '';
    if (nm.customerId && nm.customerId !== '__NEW_CUSTOMER__' && !meetingName) {
      const customer = customers.find(c => c.id === nm.customerId);
      meetingName = customer ? customer.name : 'Meeting';
    }
    if (isNewCustomer && !meetingName) {
      meetingName = 'New Customer Meeting';
    }
    // Ensure owner is also in attendees
    let attendees = [...(nm.attendees || [])];
    if (nm.meetingOwner && !attendees.includes(nm.meetingOwner)) {
      attendees = [nm.meetingOwner, ...attendees];
    }
    const meeting: ConferenceMeeting = {
      id: `MTG-${Date.now()}`, conferenceId: selectedConference.id, date: nm.date!, time: nm.time!, endTime: nm.endTime || undefined,
      meetingName, meetingOwner: nm.meetingOwner || undefined, attendees,
      customerAttendees: [], customerAttendeeDetails: nm.customerAttendeeDetails || [],
      location: nm.location!, notes: nm.notes, customerId: isNewCustomer ? '' : nm.customerId, followUps: nm.followUps || [],
    };
    const updatedConference: Conference = { ...selectedConference, meetings: [...selectedConference.meetings, meeting] };
    onAddMeeting(selectedConference.id, meeting);
    setSelectedConference(updatedConference);

    // Create a Sales Lead if "New Customer" was selected
    if (isNewCustomer && onCreateSalesLead) {
      const customerContactName = (nm.customerAttendeeDetails || []).map(ca => ca.name).join(', ');
      const leadFollowUps: SalesLeadFollowUp[] = (meeting.followUps || []).map(fu => ({
        id: `SLFU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: fu.createdAt || meeting.date,
        description: fu.text,
        infoSent: '',
        completed: fu.completed,
      }));
      const salesLead: SalesLead = {
        id: `SL-${Date.now()}`,
        customerName: customerContactName || meetingName,
        product: '',
        volume: 0,
        location: '',
        salespersonId: nm.meetingOwner || '',
        notes: `Contact info: ${(nm.customerAttendeeDetails || []).map(ca => `${ca.name} (${ca.email}${ca.phone ? ', ' + ca.phone : ''})`).join('; ')}`,
        status: 'New',
        followUps: leadFollowUps,
        createdAt: new Date().toISOString(),
        source: `Conference - ${selectedConference.name}`,
      };
      onCreateSalesLead(salesLead);
    }

    setShowAddMeetingModal(false);
    resetMeetingForm();
  };

  const handleEditMeeting = (override?: Partial<ConferenceMeeting>) => {
    const em = (override as ConferenceMeeting) || editingMeeting;
    if (!selectedConference || !em) return;
    if (!em.date || !em.time || !em.location) { alert('Please fill in date, start time, and location'); return; }
    if (em.endTime && em.endTime < em.time) { alert('End time must be after the start time'); return; }
    if (em.customerId && !em.meetingName) {
      const customer = customers.find(c => c.id === em.customerId);
      em.meetingName = customer ? customer.name : 'Meeting';
    }
    // Ensure owner is also in attendees
    if (em.meetingOwner && !(em.attendees || []).includes(em.meetingOwner)) {
      em.attendees = [em.meetingOwner, ...(em.attendees || [])];
    }
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => m.id === em.id ? em : m),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
    setShowEditMeetingModal(false);
    setEditingMeeting(null);
  };

  const handleDeleteMeeting = (meetingId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = { ...selectedConference, meetings: selectedConference.meetings.filter(m => m.id !== meetingId) };
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
        return { ...m, followUps: (m.followUps || []).map(f => f.id === followUpId ? { ...f, completed: !f.completed } : f) };
      }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const addFollowUp = (meetingId: string, text: string) => {
    if (!selectedConference || !text.trim()) return;
    const followUp: MeetingFollowUp = {
      id: `FU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: text.trim(), completed: false, createdAt: new Date().toISOString(),
    };
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => m.id !== meetingId ? m : { ...m, followUps: [...(m.followUps || []), followUp] }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const updateMeetingNotes = (meetingId: string, notes: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference, meetings: selectedConference.meetings.map(m => m.id === meetingId ? { ...m, notes } : m),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const deleteFollowUp = (meetingId: string, followUpId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => m.id !== meetingId ? m : { ...m, followUps: (m.followUps || []).filter(f => f.id !== followUpId) }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const updateFollowUpText = (meetingId: string, followUpId: string, newText: string) => {
    if (!selectedConference || !newText.trim()) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m => {
        if (m.id !== meetingId) return m;
        return { ...m, followUps: (m.followUps || []).map(f => f.id === followUpId ? { ...f, text: newText.trim() } : f) };
      }),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const addCustomerAttendeeToMeeting = (meetingId: string, attendee: { name: string; email: string; phone: string }) => {
    if (!selectedConference || !attendee.name.trim()) return;
    const detail: CustomerAttendeeDetail = {
      id: `CA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: attendee.name.trim(),
      email: attendee.email.trim(),
      phone: attendee.phone.trim(),
    };
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m =>
        m.id !== meetingId ? m : { ...m, customerAttendeeDetails: [...(m.customerAttendeeDetails || []), detail] }
      ),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const removeCustomerAttendeeFromMeeting = (meetingId: string, attendeeId: string) => {
    if (!selectedConference) return;
    const updatedConference: Conference = {
      ...selectedConference,
      meetings: selectedConference.meetings.map(m =>
        m.id !== meetingId ? m : { ...m, customerAttendeeDetails: (m.customerAttendeeDetails || []).filter(ca => ca.id !== attendeeId) }
      ),
    };
    onUpdateConference(updatedConference);
    setSelectedConference(updatedConference);
  };

  const resetConferenceForm = () => {
    setNewConference({ name: '', startDate: '', endDate: '', location: '', address: '', city: '', province: '', postalCode: '', attendees: [], meetings: [], status: 'Planned' });
  };
  const resetMeetingForm = () => {
    setNewMeeting({ date: '', time: '', meetingName: '', meetingOwner: '', attendees: [], customerAttendees: [], customerAttendeeDetails: [], location: '', notes: '', customerId: '', followUps: [] });
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

  // ============================
  // CONFERENCE DETAIL VIEW
  // ============================
  if (selectedConference) {
    const conferenceDates = getConferenceDates();
    const meetings = [...(selectedConference.meetings || [])];

    // Filter meetings
    const filteredMeetings = meetings.filter(m => {
      if (!meetingSearch) return true;
      const s = meetingSearch.toLowerCase();
      const customer = m.customerId ? customers.find(c => c.id === m.customerId) : null;
      const attendeeNames = (m.attendees || []).map(id => getPersonName(id)).join(' ');
      const custNames = getCustomerAttendeeNames(m).join(' ');
      const ownerName = m.meetingOwner ? getPersonName(m.meetingOwner) : '';
      return (m.meetingName || '').toLowerCase().includes(s) || (m.location || '').toLowerCase().includes(s) ||
        (m.date || '').includes(s) || (m.time || '').includes(s) || (customer?.name || '').toLowerCase().includes(s) ||
        attendeeNames.toLowerCase().includes(s) || custNames.toLowerCase().includes(s) || ownerName.toLowerCase().includes(s);
    });

    // Sort meetings
    const sortedMeetings = [...filteredMeetings].sort((a, b) => {
      let cmp = 0;
      if (meetingSortField === 'date') { cmp = (a.date || '').localeCompare(b.date || ''); if (cmp === 0) cmp = (a.time || '').localeCompare(b.time || ''); }
      else if (meetingSortField === 'time') cmp = (a.time || '').localeCompare(b.time || '');
      else if (meetingSortField === 'meetingName') cmp = (a.meetingName || '').localeCompare(b.meetingName || '');
      else if (meetingSortField === 'location') cmp = (a.location || '').localeCompare(b.location || '');
      else if (meetingSortField === 'customer') {
        const ca = a.customerId ? customers.find(c => c.id === a.customerId)?.name || '' : '';
        const cb = b.customerId ? customers.find(c => c.id === b.customerId)?.name || '' : '';
        cmp = ca.localeCompare(cb);
      } else if (meetingSortField === 'owner') {
        cmp = (a.meetingOwner ? getPersonName(a.meetingOwner) : '').localeCompare(b.meetingOwner ? getPersonName(b.meetingOwner) : '');
      }
      return meetingSortDir === 'asc' ? cmp : -cmp;
    });

    const toggleMeetingSort = (field: typeof meetingSortField) => {
      if (meetingSortField === field) setMeetingSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setMeetingSortField(field); setMeetingSortDir('asc'); }
    };

    const MSortHeader = ({ field, label }: { field: typeof meetingSortField; label: string }) => (
      <th className="p-3 border-r border-[#E4E3E0]/20 cursor-pointer hover:bg-[#2a2a2a] transition-colors select-none" onClick={() => toggleMeetingSort(field)}>
        <div className="flex items-center gap-1">{label}<ArrowUpDown size={10} className={meetingSortField === field ? 'opacity-100' : 'opacity-40'} /></div>
      </th>
    );

    // === Follow-ups table data ===
    const allFollowUps: { meetingId: string; meetingName: string; ownerId: string; ownerName: string; customerName: string; followUp: MeetingFollowUp }[] = [];
    for (const m of meetings) {
      const ownerName = m.meetingOwner ? getPersonName(m.meetingOwner) : '—';
      const customerName = m.customerId ? (customers.find(c => c.id === m.customerId)?.name || '—') : '—';
      for (const fu of (m.followUps || [])) {
        allFollowUps.push({ meetingId: m.id, meetingName: m.meetingName || 'Untitled', ownerId: m.meetingOwner || '', ownerName, customerName, followUp: fu });
      }
    }

    const filteredFollowUps = allFollowUps.filter(item => {
      if (!followUpSearch) return true;
      const s = followUpSearch.toLowerCase();
      return item.followUp.text.toLowerCase().includes(s) || item.meetingName.toLowerCase().includes(s) ||
        item.ownerName.toLowerCase().includes(s) || item.customerName.toLowerCase().includes(s);
    });

    const sortedFollowUps = [...filteredFollowUps].sort((a, b) => {
      let cmp = 0;
      if (followUpSortField === 'status') cmp = (a.followUp.completed ? 1 : 0) - (b.followUp.completed ? 1 : 0);
      else if (followUpSortField === 'text') cmp = a.followUp.text.localeCompare(b.followUp.text);
      else if (followUpSortField === 'meeting') cmp = a.meetingName.localeCompare(b.meetingName);
      else if (followUpSortField === 'owner') cmp = a.ownerName.localeCompare(b.ownerName);
      else if (followUpSortField === 'customer') cmp = a.customerName.localeCompare(b.customerName);
      return followUpSortDir === 'asc' ? cmp : -cmp;
    });

    const toggleFollowUpSort = (field: typeof followUpSortField) => {
      if (followUpSortField === field) setFollowUpSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setFollowUpSortField(field); setFollowUpSortDir('asc'); }
    };

    const FSortHeader = ({ field, label }: { field: typeof followUpSortField; label: string }) => (
      <th className="p-3 border-r border-[#E4E3E0]/20 cursor-pointer hover:bg-[#2a2a2a] transition-colors select-none" onClick={() => toggleFollowUpSort(field)}>
        <div className="flex items-center gap-1">{label}<ArrowUpDown size={10} className={followUpSortField === field ? 'opacity-100' : 'opacity-40'} /></div>
      </th>
    );

    return (
      <main className="flex-1 p-6 overflow-auto">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => { setSelectedConference(null); setShowEditConferenceModal(false); setEditingConference(null); setExpandedMeeting(null); setMeetingSearch(''); setFollowUpSearch(''); }}
            className="text-sm font-bold uppercase text-gray-600 hover:text-[#141414] mb-4 flex items-center gap-2">
            ← Back to Conferences
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{selectedConference.name}</h1>
              <p className="text-sm text-gray-600 mt-2">{new Date(selectedConference.startDate).toLocaleDateString()} - {new Date(selectedConference.endDate).toLocaleDateString()}</p>
              <p className="text-sm text-gray-600"><MapPin size={14} className="inline mr-1" />{[selectedConference.location, selectedConference.city, selectedConference.province].filter(Boolean).join(', ') || 'No location'}</p>
              <p className="text-xs uppercase font-bold mt-2 text-gray-600">{selectedConference.status || 'Planned'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { resetMeetingForm(); setShowAddMeetingModal(true); }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-colors flex items-center gap-2">
                <Plus size={16} /> Add Meeting
              </button>
              <button onClick={() => { setEditingConference({ ...selectedConference }); setShowEditConferenceModal(true); }}
                className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"><Edit2 size={16} /></button>
              <button onClick={() => handleDeleteConference(selectedConference.id)}
                className="p-2 hover:bg-red-500 hover:text-white transition-colors"><Trash2 size={16} /></button>
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
              {(selectedConference.attendees || []).map(att => (
                <div key={att.id} className="bg-white border border-[#141414] p-3">
                  <div className="font-bold text-sm">{att.name}</div>
                  <div className="text-xs text-gray-600 mt-1">{att.email}</div>
                  {att.phone && <div className="text-xs text-gray-600">{att.phone}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scheduled Meetings */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">Scheduled Meetings ({meetings.length})</h2>
            <div className="flex border border-[#141414]">
              {(['table', 'calendar'] as const).map(v => (
                <button key={v} onClick={() => setMeetingView(v)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${meetingView === v ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-white hover:bg-[#F5F5F5]'}`}>
                  {v === 'table' ? <FileText size={12} /> : <Clock size={12} />}{v === 'table' ? 'Table' : 'Calendar'}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-4"><SearchInput value={meetingSearch} onChange={setMeetingSearch} placeholder="Search meetings by name, customer, attendee, owner, location..." /></div>

          {meetingView === 'calendar' ? (
            <MeetingCalendar
              days={conferenceDates}
              meetings={sortedMeetings}
              customers={customers}
              getPersonName={getPersonName}
              onOpen={(meeting) => { setEditingMeeting({ ...meeting, customerAttendeeDetails: meeting.customerAttendeeDetails || [], followUps: meeting.followUps || [] }); setShowEditMeetingModal(true); }}
            />
          ) : meetings.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50"><p>No meetings scheduled yet</p></div>
          ) : (
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <table className="std-table w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    <MSortHeader field="date" label="Date" />
                    <MSortHeader field="time" label="Start" />
                    <th className="p-3 border-r border-[#E4E3E0]/20">End</th>
                    <MSortHeader field="meetingName" label="Meeting" />
                    <MSortHeader field="customer" label="Customer" />
                    <MSortHeader field="owner" label="Owner" />
                    <th className="p-3 border-r border-[#E4E3E0]/20">Internal Attendees</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Customer Attendees</th>
                    <MSortHeader field="location" label="Location" />
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedMeetings.length === 0 && (
                    <tr><td colSpan={10} className="p-6 text-center text-xs font-bold opacity-40 italic">No meetings match your search.</td></tr>
                  )}
                  {sortedMeetings.map(meeting => {
                    const customer = meeting.customerId ? customers.find(c => c.id === meeting.customerId) : null;
                    const internalNames = (meeting.attendees || []).map(id => getPersonName(id));
                    const custNames = getCustomerAttendeeNames(meeting);
                    const ownerName = meeting.meetingOwner ? getPersonName(meeting.meetingOwner) : '—';
                    const isExpanded = expandedMeeting === meeting.id;

                    return (
                      <React.Fragment key={meeting.id}>
                        <tr className={`hover:bg-[#F5F5F5] transition-colors ${isExpanded ? 'bg-[#F5F5F5]' : ''}`}>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.date ? new Date(meeting.date + 'T00:00:00').toLocaleDateString() : '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.time || '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.endTime || '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{meeting.meetingName || 'Untitled'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">{customer?.name || '—'}</td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">
                            {meeting.meetingOwner ? <span className="bg-purple-100 text-purple-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{ownerName}</span> : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">
                            {internalNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">{internalNames.map((name, i) => (
                                <span key={i} className="bg-blue-100 text-blue-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{name}</span>
                              ))}</div>
                            ) : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">
                            {custNames.length > 0 ? (
                              <div className="flex flex-wrap gap-1">{custNames.map((name, i) => (
                                <span key={i} className="bg-green-100 text-green-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{name}</span>
                              ))}</div>
                            ) : '—'}
                          </td>
                          <td className="p-3 text-xs border-r border-[#141414]/10">{meeting.location || '—'}</td>
                          <td className="p-3 text-xs">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setExpandedMeeting(isExpanded ? null : meeting.id)}
                                className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors" title={isExpanded ? 'Collapse' : 'Expand'}>
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              </button>
                              <button onClick={() => { setEditingMeeting({ ...meeting, customerAttendeeDetails: meeting.customerAttendeeDetails || [], followUps: meeting.followUps || [] }); setShowEditMeetingModal(true); }}
                                className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors" title="Edit"><Edit2 size={14} /></button>
                              <button onClick={() => handleDeleteMeeting(meeting.id)}
                                className="p-1 hover:bg-red-500 hover:text-white transition-colors" title="Delete"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Meeting Detail */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr><td colSpan={10} className="p-0">
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden bg-[#F9F9F9] border-t border-[#141414]/10">
                                <div className="p-6 space-y-4">
                                  <div>
                                    <label className="text-xs font-bold uppercase text-gray-600 mb-2 flex items-center gap-1"><FileText size={12} /> Meeting Notes</label>
                                    <textarea value={meeting.notes || ''} onChange={(e) => updateMeetingNotes(meeting.id, e.target.value)}
                                      placeholder="Add meeting notes..." rows={3}
                                      className="w-full px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                                  </div>
                                  <div>
                                    <label className="text-xs font-bold uppercase text-gray-600 mb-2 block">Follow-ups</label>
                                    {(meeting.followUps || []).length > 0 && (
                                      <div className="space-y-2 mb-3">
                                        {(meeting.followUps || []).map(fu => (
                                          <div key={fu.id} className="flex items-start gap-2 bg-white p-2 border border-[#141414]/10">
                                            <button onClick={() => toggleFollowUp(meeting.id, fu.id)} className="mt-0.5 flex-shrink-0">
                                              {fu.completed ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} className="text-gray-400" />}
                                            </button>
                                            <span className={`text-sm flex-1 ${fu.completed ? 'line-through text-gray-400' : ''}`}>{fu.text}</span>
                                            <button onClick={() => deleteFollowUp(meeting.id, fu.id)} className="p-0.5 hover:text-red-500 transition-colors flex-shrink-0"><X size={12} /></button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <input type="text" value={newFollowUp} onChange={(e) => setNewFollowUp(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && newFollowUp.trim()) { addFollowUp(meeting.id, newFollowUp); setNewFollowUp(''); } }}
                                        placeholder="Add a follow-up item..." className="flex-1 px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                                      <button onClick={() => { if (newFollowUp.trim()) { addFollowUp(meeting.id, newFollowUp); setNewFollowUp(''); } }}
                                        className="px-3 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors">Add</button>
                                    </div>
                                  </div>
                                  {/* Customer Attendees - Inline Add/Remove */}
                                  <div>
                                    <label className="text-xs font-bold uppercase text-gray-600 mb-2 flex items-center gap-1"><Users size={12} /> Customer Attendees</label>
                                    {(meeting.customerAttendeeDetails || []).length > 0 && (
                                      <div className="space-y-2 mb-3">
                                        {(meeting.customerAttendeeDetails || []).map(ca => (
                                          <div key={ca.id} className="flex items-center justify-between bg-green-50 p-2 border border-green-200 text-xs">
                                            <div className="flex items-center gap-3">
                                              <span className="font-bold text-green-900">{ca.name}</span>
                                              {ca.email && <span className="text-gray-500">{ca.email}</span>}
                                              {ca.phone && <span className="text-gray-500">{ca.phone}</span>}
                                            </div>
                                            <button onClick={() => removeCustomerAttendeeFromMeeting(meeting.id, ca.id)}
                                              className="p-1 hover:bg-red-500 hover:text-white transition-colors flex-shrink-0"><X size={12} /></button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <input type="text" value={newInlineCustAttendee.name}
                                        onChange={(e) => setNewInlineCustAttendee(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="Name *"
                                        className="flex-1 px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                                      <input type="email" value={newInlineCustAttendee.email}
                                        onChange={(e) => setNewInlineCustAttendee(prev => ({ ...prev, email: e.target.value }))}
                                        placeholder="Email"
                                        className="flex-1 px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                                      <input type="tel" value={newInlineCustAttendee.phone}
                                        onChange={(e) => setNewInlineCustAttendee(prev => ({ ...prev, phone: e.target.value }))}
                                        placeholder="Phone"
                                        className="flex-1 px-3 py-2 border border-[#141414]/20 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                                      <button
                                        onClick={() => {
                                          if (!newInlineCustAttendee.name.trim()) { alert('Please enter a name'); return; }
                                          addCustomerAttendeeToMeeting(meeting.id, newInlineCustAttendee);
                                          setNewInlineCustAttendee({ name: '', email: '', phone: '' });
                                        }}
                                        className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors whitespace-nowrap">
                                        Add Attendee
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            </td></tr>
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

        {/* ====== FOLLOW-UPS SECTION ====== */}
        <div className="mb-8">
          <h2 className="font-bold text-lg mb-4">Follow-Ups ({allFollowUps.length})</h2>
          <div className="mb-4"><SearchInput value={followUpSearch} onChange={setFollowUpSearch} placeholder="Search follow-ups by text, meeting, owner, customer..." /></div>

          {allFollowUps.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50"><p>No follow-ups yet. Add follow-ups from meeting details above.</p></div>
          ) : (
            <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-hidden">
              <table className="std-table w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                    <FSortHeader field="status" label="Status" />
                    <FSortHeader field="text" label="Follow-Up" />
                    <FSortHeader field="meeting" label="Meeting" />
                    <FSortHeader field="owner" label="Meeting Owner" />
                    <FSortHeader field="customer" label="Customer" />
                    <th className="p-3 border-r border-[#E4E3E0]/20">Assigned To</th>
                    <th className="p-3 border-r border-[#E4E3E0]/20">Reminder</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/10">
                  {sortedFollowUps.length === 0 && (
                    <tr><td colSpan={8} className="p-6 text-center text-xs font-bold opacity-40 italic">No follow-ups match your search.</td></tr>
                  )}
                  {sortedFollowUps.map(item => {
                    const isEditing = editingFollowUp?.followUp.id === item.followUp.id;
                    return (
                      <tr key={item.followUp.id} className={`hover:bg-[#F5F5F5] transition-colors ${item.followUp.completed ? 'opacity-60' : ''}`}>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          <button onClick={() => toggleFollowUp(item.meetingId, item.followUp.id)} className="flex-shrink-0">
                            {item.followUp.completed ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} className="text-gray-400" />}
                          </button>
                        </td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          {isEditing ? (
                            <div className="flex gap-2">
                              <input type="text" value={editingFollowUpText} onChange={(e) => setEditingFollowUpText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { updateFollowUpText(item.meetingId, item.followUp.id, editingFollowUpText); setEditingFollowUp(null); } }}
                                className="flex-1 px-2 py-1 border border-[#141414]/30 text-xs focus:outline-none focus:border-[#141414]" autoFocus />
                              <button onClick={() => { updateFollowUpText(item.meetingId, item.followUp.id, editingFollowUpText); setEditingFollowUp(null); }}
                                className="px-2 py-1 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase">Save</button>
                              <button onClick={() => setEditingFollowUp(null)} className="px-2 py-1 border border-[#141414]/30 text-[10px] font-bold uppercase">Cancel</button>
                            </div>
                          ) : (
                            <span className={item.followUp.completed ? 'line-through text-gray-400' : ''}>{item.followUp.text}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs border-r border-[#141414]/10 font-bold">{item.meetingName}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">
                          {item.ownerId ? <span className="bg-purple-100 text-purple-900 px-1.5 py-0.5 rounded text-[10px] font-bold">{item.ownerName}</span> : '—'}
                        </td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{item.customerName}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10">{getPersonName(item.followUp.assigneeId || item.ownerId) || '—'}</td>
                        <td className="p-3 text-xs border-r border-[#141414]/10 whitespace-nowrap">{fmtReminder(item.followUp.reminderAt)}</td>
                        <td className="p-3 text-xs">
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setEditingFollowUp({ meetingId: item.meetingId, followUp: item.followUp }); setEditingFollowUpText(item.followUp.text); }}
                              className="p-1 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors" title="Edit"><Edit2 size={12} /></button>
                            <button onClick={() => deleteFollowUp(item.meetingId, item.followUp.id)}
                              className="p-1 hover:bg-red-500 hover:text-white transition-colors" title="Delete"><Trash2 size={12} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modals */}
        <AnimatePresence>
          {showAddMeetingModal && (
            <MeetingModal title="Add Meeting" meeting={newMeeting} setMeeting={setNewMeeting} onSubmit={handleAddMeeting}
              onClose={() => { setShowAddMeetingModal(false); resetMeetingForm(); }} submitLabel="Add Meeting"
              customers={customers} salesPeople={salesPeople} conferenceDates={conferenceDates} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showEditMeetingModal && editingMeeting && (
            <MeetingModal title="Edit Meeting" meeting={editingMeeting} setMeeting={(m: any) => setEditingMeeting(m)} onSubmit={handleEditMeeting}
              onClose={() => { setShowEditMeetingModal(false); setEditingMeeting(null); }} submitLabel="Update Meeting"
              customers={customers} salesPeople={salesPeople} conferenceDates={conferenceDates} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showEditConferenceModal && editingConference && (
            <ConferenceModal title="Edit Conference" conference={editingConference} onConferenceChange={setEditingConference}
              onRemoveAttendee={removeEditAttendee} onSubmit={handleEditConference}
              onClose={() => { setShowEditConferenceModal(false); setEditingConference(null); }} submitLabel="Update Conference"
              salesPeople={salesPeople} onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'edit')} />
          )}
        </AnimatePresence>
      </main>
    );
  }

  // ============================
  // CONFERENCES LIST VIEW
  // ============================
  const conferenceExportSheets = (): SheetSpec[] => [{
    sheetName: 'Conferences',
    title: 'Conferences',
    subtitle: `Generated ${new Date().toLocaleDateString()} | ${conferences.length} conferences`,
    columns: [
      { header: 'Conference', key: 'name' },
      { header: 'Start Date', key: 'startDate' },
      { header: 'End Date', key: 'endDate' },
      { header: 'Location', key: 'location' },
      { header: 'Attendees', key: 'attendeeCount', format: 'integer' },
      { header: 'Meetings', key: 'meetingCount', format: 'integer' },
      { header: 'Status', key: 'status' },
    ],
    rows: conferences.map(c => ({
      name: c.name,
      startDate: c.startDate || '',
      endDate: c.endDate || '',
      location: c.location || '',
      attendeeCount: (c.attendees || []).length,
      meetingCount: (c.meetings || []).length,
      status: c.status || '',
    })),
  }];
  return (
    <div>
      <PageBanner
        icon={<MapPin size={18} />}
        title="Conferences"
        count={filteredConferences.length}
        exportSheets={conferenceExportSheets}
        exportFileName="Conferences"
      >
        <button onClick={() => { resetConferenceForm(); setShowAddConferenceModal(true); }}
          className="px-3 py-1.5 bg-white/10 text-[#E4E3E0] text-[10px] font-bold uppercase hover:bg-white/20 transition-colors flex items-center gap-2">
          <Plus size={12} /> Add Conference
        </button>
      </PageBanner>
      <PageToolbar
        search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search conferences by name or location…' }}
      />
    <main className="flex-1 p-6 overflow-auto">

      {/* Conferences — standardized DataTable. Row click drills into the
          conference detail view (which has its own Edit / Delete buttons), so
          the per-row Actions column is gone. Add Conference stays in the
          PageBanner. */}
      <div className="mt-6">
        <DataTable<Conference>
          variant="page"
          title="Conferences"
          icon={<MapPin size={14} />}
          columns={[
            { key: 'name', label: 'Conference', bold: true },
            {
              key: 'dates', label: 'Dates', sortable: false,
              render: (c) => `${new Date(c.startDate).toLocaleDateString()} - ${new Date(c.endDate).toLocaleDateString()}`,
            },
            {
              key: 'location', label: 'Location',
              render: (c) => <span className="flex items-center gap-1"><MapPin size={10} /> {c.location || '—'}</span>,
            },
            {
              key: 'attendees', label: 'Attendees', align: 'right',
              sortValue: (c) => (c.attendees || []).length,
              render: (c) => <span className="flex items-center gap-1 justify-end"><Users size={10} /> {(c.attendees || []).length}</span>,
            },
            {
              key: 'meetings', label: 'Meetings', align: 'right',
              sortValue: (c) => (c.meetings || []).length,
              render: (c) => <span className="flex items-center gap-1 justify-end"><Clock size={10} /> {(c.meetings || []).length}</span>,
            },
            {
              key: 'status', label: 'Status', sortValue: (c) => c.status || 'Planned',
              render: (c) => (
                <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[8px] ${
                  (c.status || 'Planned') === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                  (c.status || 'Planned') === 'In Progress' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                }`}>{c.status || 'Planned'}</span>
              ),
            },
          ]}
          rows={filteredConferences}
          getRowKey={(c) => c.id}
          onRowClick={(c) => setSelectedConference(c)}
          emptyMessage="No conferences found. Click “Add Conference” to create one."
          defaultSortKey="name"
        />
      </div>

      <AnimatePresence>
        {showAddConferenceModal && (
          <ConferenceModal title="Add Conference" conference={newConference} onConferenceChange={setNewConference}
            onRemoveAttendee={removeAttendee} onSubmit={handleAddConference} onClose={() => setShowAddConferenceModal(false)}
            submitLabel="Add Conference" salesPeople={salesPeople} onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'new')} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showEditConferenceModal && editingConference && (
          <ConferenceModal title="Edit Conference" conference={editingConference} onConferenceChange={setEditingConference}
            onRemoveAttendee={removeEditAttendee} onSubmit={handleEditConference}
            onClose={() => { setShowEditConferenceModal(false); setEditingConference(null); }} submitLabel="Update Conference"
            salesPeople={salesPeople} onAddSalesAttendee={(personId) => addSalesAttendeeToConference(personId, 'edit')} />
        )}
      </AnimatePresence>
    </main>
    </div>
  );
}

// ============================
// CONFERENCE MODAL
// ============================
function ConferenceModal({ title, conference, onConferenceChange, onRemoveAttendee, onSubmit, onClose, submitLabel, salesPeople, onAddSalesAttendee }: {
  title: string; conference: Partial<Conference> | Conference; onConferenceChange: (c: any) => void; onRemoveAttendee: (id: string) => void;
  onSubmit: () => void; onClose: () => void; submitLabel: string; salesPeople: Person[]; onAddSalesAttendee: (id: string) => void;
}) {
  const [selectedSalesPersonId, setSelectedSalesPersonId] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden">
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#141414] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-bold uppercase block mb-1">Name*</label>
              <input type="text" value={conference.name || ''} onChange={(e) => onConferenceChange({ ...conference, name: e.target.value })}
                placeholder="Conference Name" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
            <div><label className="text-xs font-bold uppercase block mb-1">Status</label>
              <select value={conference.status || 'Planned'} onChange={(e) => onConferenceChange({ ...conference, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="Planned">Planned</option><option value="In Progress">In Progress</option><option value="Completed">Completed</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-bold uppercase block mb-1">Start Date*</label>
              <input type="date" value={conference.startDate || ''} onChange={(e) => onConferenceChange({ ...conference, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
            <div><label className="text-xs font-bold uppercase block mb-1">End Date*</label>
              <input type="date" value={conference.endDate || ''} onChange={(e) => onConferenceChange({ ...conference, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
          </div>
          <div><label className="text-xs font-bold uppercase block mb-1">Location*</label>
            <input type="text" value={conference.location || ''} onChange={(e) => onConferenceChange({ ...conference, location: e.target.value })}
              placeholder="Venue Name" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
          <div><label className="text-xs font-bold uppercase block mb-1">Address</label>
            <input type="text" value={conference.address || ''} onChange={(e) => onConferenceChange({ ...conference, address: e.target.value })}
              placeholder="Street Address" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-xs font-bold uppercase block mb-1">City</label>
              <input type="text" value={conference.city || ''} onChange={(e) => onConferenceChange({ ...conference, city: e.target.value })}
                placeholder="City" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
            <div><label className="text-xs font-bold uppercase block mb-1">Province</label>
              <input type="text" value={conference.province || ''} onChange={(e) => onConferenceChange({ ...conference, province: e.target.value })}
                placeholder="Province" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
            <div><label className="text-xs font-bold uppercase block mb-1">Postal Code</label>
              <input type="text" value={conference.postalCode || ''} onChange={(e) => onConferenceChange({ ...conference, postalCode: e.target.value })}
                placeholder="Postal Code" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-bold mb-3">Attendees (Sales Employees)</h4>
            <div className="flex gap-2 mb-3">
              <select value={selectedSalesPersonId} onChange={(e) => setSelectedSalesPersonId(e.target.value)}
                className="flex-1 px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="">Select a sales employee...</option>
                {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name} {p.salespersonNumber ? `(${p.salespersonNumber})` : ''} — {p.email}</option>)}
              </select>
              <button onClick={() => { if (selectedSalesPersonId) { onAddSalesAttendee(selectedSalesPersonId); setSelectedSalesPersonId(''); } }}
                className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors">Add</button>
            </div>
            {conference.attendees && conference.attendees.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase text-gray-600">Added Attendees ({conference.attendees.length})</h5>
                {conference.attendees.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-gray-50 p-2 border border-gray-200">
                    <div className="text-xs"><div className="font-bold">{att.name}</div><div className="text-gray-600">{att.email}{att.phone ? ` | ${att.phone}` : ''}</div></div>
                    <button onClick={() => onRemoveAttendee(att.id)} className="p-1 hover:bg-red-500 hover:text-white transition-colors"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors">Cancel</button>
            <button onClick={onSubmit} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors">{submitLabel}</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ============================
// MEETING MODAL
// ============================
/** Daily calendar for a conference: one column per conference day, one row
 *  per hour. Meetings are blocks placed by start time and sized by duration
 *  (end time, else 1 hour); overlapping meetings share the column side by side.
 *  Click a meeting to edit it. */
function MeetingCalendar({ days, meetings, customers, getPersonName, onOpen }: {
  days: string[]; meetings: ConferenceMeeting[]; customers: Customer[];
  getPersonName: (id: string) => string; onOpen: (m: ConferenceMeeting) => void;
}) {
  const ROW = 56; // px per hour
  const toMin = (t?: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const span = (m: ConferenceMeeting) => {
    const start = toMin(m.time);
    let end = toMin(m.endTime);
    if (!Number.isFinite(end) || end <= start) end = start + 60;
    return { start, end };
  };
  const timed = meetings.filter(m => Number.isFinite(toMin(m.time)));
  // Hour range: 7 AM – 6 PM, widened to fit every meeting.
  let first = 7, last = 18;
  for (const m of timed) {
    const { start, end } = span(m);
    first = Math.min(first, Math.floor(start / 60));
    last = Math.max(last, Math.ceil(end / 60));
  }
  last = Math.min(24, Math.max(last, first + 1));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const untimed = meetings.filter(m => !Number.isFinite(toMin(m.time)));

  if (!days.length) return <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50"><p>Set the conference start and end dates to see the calendar.</p></div>;

  return (
    <div className="bg-white border border-[#141414] shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] overflow-x-auto">
      <div className="min-w-max" style={{ display: 'grid', gridTemplateColumns: `64px repeat(${days.length}, minmax(180px, 1fr))` }}>
        {/* Header row */}
        <div className="bg-[#F5F5F5] border-b border-r border-[#141414] sticky left-0 z-10" />
        {days.map(d => (
          <div key={d} className="bg-[#F5F5F5] border-b border-r border-[#141414] border-r-[#141414]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest">
            {dayLabel(d)}
            <span className="ml-2 opacity-50 normal-case font-mono">{meetings.filter(m => m.date === d).length}</span>
          </div>
        ))}
        {/* Hour labels */}
        <div className="border-r border-[#141414] bg-white sticky left-0 z-10">
          {hours.map(h => (
            <div key={h} className="border-b border-[#141414]/10 text-[10px] font-mono opacity-60 text-right pr-2 pt-1" style={{ height: ROW }}>{hourLabel(h)}</div>
          ))}
        </div>
        {/* Day columns */}
        {days.map(d => {
          const dayMeetings = timed.filter(m => m.date === d).map(m => ({ m, ...span(m) })).sort((a, b) => a.start - b.start || a.end - b.end);
          // Greedy lanes so overlapping meetings sit side by side.
          const laneEnds: number[] = [];
          const placed = dayMeetings.map(x => {
            let lane = laneEnds.findIndex(e => e <= x.start);
            if (lane < 0) { lane = laneEnds.length; laneEnds.push(x.end); } else laneEnds[lane] = x.end;
            return { ...x, lane };
          });
          const lanes = Math.max(1, laneEnds.length);
          return (
            <div key={d} className="relative border-r border-[#141414]/10" style={{ height: hours.length * ROW }}>
              {hours.map((h, i) => <div key={h} className="absolute left-0 right-0 border-b border-[#141414]/10" style={{ top: (i + 1) * ROW - 1 }} />)}
              {placed.map(({ m, start, end, lane }) => {
                const customer = m.customerId ? customers.find(c => c.id === m.customerId)?.name : '';
                const open = (m.followUps || []).filter(f => !f.completed).length;
                return (
                  <button key={m.id} onClick={() => onOpen(m)}
                    title={`${m.meetingName || 'Meeting'} · ${m.time}${m.endTime ? `–${m.endTime}` : ''}${m.location ? ` · ${m.location}` : ''}`}
                    className="absolute text-left bg-purple-100 border border-purple-400 border-l-4 border-l-purple-700 hover:bg-purple-200 transition-colors px-1.5 py-1 overflow-hidden"
                    style={{ top: ((start - first * 60) / 60) * ROW + 1, height: Math.max(22, ((end - start) / 60) * ROW - 2), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}>
                    <div className="text-[10px] font-mono opacity-70">{m.time}{m.endTime ? `–${m.endTime}` : ''}</div>
                    <div className="text-[11px] font-bold leading-tight truncate">{m.meetingName || 'Untitled'}</div>
                    {customer && <div className="text-[10px] truncate opacity-80">{customer}</div>}
                    {m.location && <div className="text-[10px] truncate opacity-60">{m.location}</div>}
                    {m.meetingOwner && <div className="text-[10px] truncate opacity-60">{getPersonName(m.meetingOwner)}</div>}
                    {open > 0 && <div className="text-[9px] font-bold uppercase text-amber-700">{open} follow-up{open === 1 ? '' : 's'}</div>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {untimed.length > 0 && (
        <div className="border-t border-[#141414] p-3 text-xs">
          <span className="font-bold uppercase text-[10px] tracking-widest opacity-60 mr-2">No start time:</span>
          {untimed.map(m => <button key={m.id} onClick={() => onOpen(m)} className="mr-2 underline">{m.meetingName || 'Untitled'}</button>)}
        </div>
      )}
    </div>
  );
}

function MeetingModal({ title, meeting, setMeeting, onSubmit, onClose, submitLabel, customers, salesPeople, conferenceDates }: {
  title: string; meeting: Partial<ConferenceMeeting>; setMeeting: (m: any) => void; onSubmit: (final: Partial<ConferenceMeeting>) => void; onClose: () => void;
  submitLabel: string; customers: Customer[]; salesPeople: Person[]; conferenceDates: string[];
}) {
  // Fully local state for customer attendee management to avoid stale closure / prop round-trip issues
  const [localCustAttendees, setLocalCustAttendees] = useState<CustomerAttendeeDetail[]>(meeting.customerAttendeeDetails || []);
  const [custInput, setCustInput] = useState({ name: '', email: '', phone: '' });
  const [editingAttendeeId, setEditingAttendeeId] = useState<string | null>(null);
  // New follow-up being typed in the menu.
  const [fuDraft, setFuDraft] = useState({ text: '', assigneeId: '', reminderAt: '' });
  const addFollowUpDraft = () => {
    if (!fuDraft.text.trim()) return;
    const fu: MeetingFollowUp = {
      id: `FU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: fuDraft.text.trim(), completed: false,
      createdAt: new Date().toISOString(),
      ...(fuDraft.assigneeId ? { assigneeId: fuDraft.assigneeId } : {}),
      ...(fuDraft.reminderAt ? { reminderAt: fuDraft.reminderAt } : {}),
    };
    setMeeting({ ...meeting, followUps: [...(meeting.followUps || []), fu] });
    setFuDraft({ text: '', assigneeId: '', reminderAt: '' });
  };

  const toggleInternalAttendee = (personId: string) => {
    const current = meeting.attendees || [];
    setMeeting({ ...meeting, attendees: current.includes(personId) ? current.filter((id: string) => id !== personId) : [...current, personId] });
  };
  const syncAttendeesToParent = (attendees: CustomerAttendeeDetail[]) => {
    setLocalCustAttendees(attendees);
    setMeeting({ ...meeting, customerAttendeeDetails: attendees });
  };
  const addCustomerAttendee = () => {
    if (!custInput.name.trim()) { alert('Please enter a name'); return; }
    const detail: CustomerAttendeeDetail = { id: `CA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: custInput.name.trim(), email: custInput.email.trim(), phone: custInput.phone.trim() };
    syncAttendeesToParent([...localCustAttendees, detail]);
    setCustInput({ name: '', email: '', phone: '' });
  };
  const removeCustomerAttendee = (id: string) => {
    syncAttendeesToParent(localCustAttendees.filter((ca: CustomerAttendeeDetail) => ca.id !== id));
  };
  const updateCustomerAttendee = (id: string, field: keyof CustomerAttendeeDetail, value: string) => {
    syncAttendeesToParent(localCustAttendees.map((ca: CustomerAttendeeDetail) => ca.id === id ? { ...ca, [field]: value } : ca));
  };
  // Ensure local attendees are always synced to parent before submit
  const handleSubmit = () => {
    const pending: MeetingFollowUp[] = fuDraft.text.trim() ? [{
      id: `FU-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: fuDraft.text.trim(), completed: false, createdAt: new Date().toISOString(),
      ...(fuDraft.assigneeId ? { assigneeId: fuDraft.assigneeId } : {}), ...(fuDraft.reminderAt ? { reminderAt: fuDraft.reminderAt } : {}),
    }] : [];
    const final = { ...meeting, customerAttendeeDetails: localCustAttendees, followUps: [...(meeting.followUps || []), ...pending] };
    setMeeting(final);
    onSubmit(final); // save exactly what's in the menu (no stale-state timer)
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center-safe justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden">
        <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-widest">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-white hover:text-[#141414] transition-colors"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-bold uppercase block mb-1">Date*</label>
              <select value={meeting.date || ''} onChange={(e) => setMeeting({ ...meeting, date: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="">Select a date</option>
                {conferenceDates.map(d => <option key={d} value={d}>{new Date(d + 'T00:00:00').toLocaleDateString()}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-bold uppercase block mb-1">Start Time*</label>
                <input type="time" value={meeting.time || ''} onChange={(e) => setMeeting({ ...meeting, time: e.target.value })}
                  className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
              <div><label className="text-xs font-bold uppercase block mb-1">End Time</label>
                <input type="time" value={meeting.endTime || ''} min={meeting.time || undefined} onChange={(e) => setMeeting({ ...meeting, endTime: e.target.value })}
                  className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
            </div>
          </div>

          <div><label className="text-xs font-bold uppercase block mb-1">Location*</label>
            <input type="text" value={meeting.location || ''} onChange={(e) => setMeeting({ ...meeting, location: e.target.value })}
              placeholder="Meeting Location" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-bold uppercase block mb-1">Customer (auto-generates name)</label>
              <select value={meeting.customerId || ''} onChange={(e) => setMeeting({ ...meeting, customerId: e.target.value })}
                className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
                <option value="">Select a customer</option>
                <option value="__NEW_CUSTOMER__">+ New Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="text-xs font-bold uppercase block mb-1">Meeting Name</label>
              <input type="text" value={meeting.meetingName || ''} onChange={(e) => setMeeting({ ...meeting, meetingName: e.target.value })}
                placeholder="Auto-generated if blank" className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>
          </div>

          {/* Meeting Owner */}
          <div>
            <label className="text-xs font-bold uppercase block mb-1">Meeting Owner (responsible for follow-ups)</label>
            <select value={meeting.meetingOwner || ''} onChange={(e) => setMeeting({ ...meeting, meetingOwner: e.target.value })}
              className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]">
              <option value="">Select meeting owner...</option>
              {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name} {p.salespersonNumber ? `(${p.salespersonNumber})` : ''}</option>)}
            </select>
          </div>

          {/* Internal Attendees */}
          <div><label className="text-xs font-bold uppercase block mb-1">Internal Attendees (Sales)</label>
            <div className="space-y-2 max-h-40 overflow-y-auto bg-gray-50 p-2 border border-gray-200">
              {salesPeople.length === 0 ? <p className="text-xs text-gray-600">No sales employees available</p> : (
                salesPeople.map(person => (
                  <label key={person.id} className="flex items-center text-xs cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors">
                    <input type="checkbox" checked={(meeting.attendees || []).includes(person.id)} onChange={() => toggleInternalAttendee(person.id)} className="mr-2" />
                    <span className="font-bold">{person.name}</span>
                    <span className="text-gray-500 ml-1">{person.salespersonNumber ? `(${person.salespersonNumber})` : ''} — {person.email}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Customer Attendees */}
          <div><label className="text-xs font-bold uppercase block mb-1">Customer Attendees</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input type="text" value={custInput.name} onChange={(e) => setCustInput({ ...custInput, name: e.target.value })}
                placeholder="Name" className="px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
              <input type="email" value={custInput.email} onChange={(e) => setCustInput({ ...custInput, email: e.target.value })}
                placeholder="Email" className="px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
              <div className="flex gap-2">
                <input type="tel" value={custInput.phone} onChange={(e) => setCustInput({ ...custInput, phone: e.target.value })}
                  placeholder="Phone" className="flex-1 px-3 py-2 border border-[#141414]/30 bg-white text-sm focus:outline-none focus:border-[#141414]" />
                <button onClick={addCustomerAttendee} className="px-3 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors whitespace-nowrap">Add</button>
              </div>
            </div>
            {localCustAttendees.length > 0 && (
              <div className="space-y-2">
                {localCustAttendees.map((ca: CustomerAttendeeDetail) => (
                  <div key={ca.id} className="bg-green-50 p-2 border border-green-200 text-xs">
                    {editingAttendeeId === ca.id ? (
                      <div className="flex items-center gap-2">
                        <input type="text" value={ca.name} onChange={(e) => updateCustomerAttendee(ca.id, 'name', e.target.value)}
                          className="flex-1 px-2 py-1 border border-green-300 bg-white text-xs focus:outline-none" placeholder="Name" />
                        <input type="email" value={ca.email || ''} onChange={(e) => updateCustomerAttendee(ca.id, 'email', e.target.value)}
                          className="flex-1 px-2 py-1 border border-green-300 bg-white text-xs focus:outline-none" placeholder="Email" />
                        <input type="tel" value={ca.phone || ''} onChange={(e) => updateCustomerAttendee(ca.id, 'phone', e.target.value)}
                          className="flex-1 px-2 py-1 border border-green-300 bg-white text-xs focus:outline-none" placeholder="Phone" />
                        <button onClick={() => setEditingAttendeeId(null)} className="p-1 hover:bg-green-600 hover:text-white transition-colors" title="Done"><CheckSquare size={12} /></button>
                        <button onClick={() => removeCustomerAttendee(ca.id)} className="p-1 hover:bg-red-500 hover:text-white transition-colors" title="Remove"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold">{ca.name}</span>
                          {ca.email && <span className="text-gray-600 ml-2">{ca.email}</span>}
                          {ca.phone && <span className="text-gray-600 ml-2">{ca.phone}</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setEditingAttendeeId(ca.id)} className="p-1 hover:bg-green-600 hover:text-white transition-colors" title="Edit"><Edit2 size={12} /></button>
                          <button onClick={() => removeCustomerAttendee(ca.id)} className="p-1 hover:bg-red-500 hover:text-white transition-colors" title="Remove"><X size={12} /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div><label className="text-xs font-bold uppercase block mb-1">Notes</label>
            <textarea value={meeting.notes || ''} onChange={(e) => setMeeting({ ...meeting, notes: e.target.value })}
              placeholder="Additional notes..." rows={3} className="w-full px-3 py-2 border border-[#141414] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]" /></div>

          {/* Follow-ups — each can carry a reminder date + time; the assignee
              (else the meeting owner) is emailed automatically at that time. */}
          <div>
            <label className="text-xs font-bold uppercase block mb-1">Follow-Ups</label>
            <div className="space-y-2">
              {(meeting.followUps || []).map((fu: MeetingFollowUp) => {
                const upd = (patch: Partial<MeetingFollowUp>) => setMeeting({ ...meeting, followUps: (meeting.followUps || []).map((f: MeetingFollowUp) => f.id === fu.id ? { ...f, ...patch } : f) });
                return (
                  <div key={fu.id} className="bg-gray-50 border border-gray-200 p-2 grid grid-cols-12 gap-2 items-center text-xs">
                    <button onClick={() => upd({ completed: !fu.completed })} className="col-span-1 flex justify-center" title={fu.completed ? 'Mark open' : 'Mark done'}>
                      {fu.completed ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} className="text-gray-400" />}
                    </button>
                    <input value={fu.text} onChange={(e) => upd({ text: e.target.value })} className={`col-span-5 px-2 py-1 border border-[#141414]/30 bg-white text-xs focus:outline-none ${fu.completed ? 'line-through opacity-60' : ''}`} />
                    <select value={fu.assigneeId || ''} onChange={(e) => upd({ assigneeId: e.target.value || undefined })} className="col-span-2 px-1 py-1 border border-[#141414]/30 bg-white text-xs focus:outline-none" title="Assigned to">
                      <option value="">Owner</option>
                      {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input type="datetime-local" value={fu.reminderAt || ''} onChange={(e) => upd({ reminderAt: e.target.value || undefined })} className="col-span-3 px-1 py-1 border border-[#141414]/30 bg-white text-xs focus:outline-none" title="Reminder date & time" />
                    <button onClick={() => setMeeting({ ...meeting, followUps: (meeting.followUps || []).filter((f: MeetingFollowUp) => f.id !== fu.id) })} className="col-span-1 flex justify-center p-1 hover:bg-red-500 hover:text-white" title="Remove"><X size={12} /></button>
                  </div>
                );
              })}
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6"><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Follow-up</div>
                  <input value={fuDraft.text} onChange={(e) => setFuDraft({ ...fuDraft, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addFollowUpDraft(); }}
                    placeholder="e.g. Send pricing for GC45" className="w-full px-2 py-1.5 border border-[#141414]/30 bg-white text-xs focus:outline-none focus:border-[#141414]" /></div>
                <div className="col-span-2"><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Assigned To</div>
                  <select value={fuDraft.assigneeId} onChange={(e) => setFuDraft({ ...fuDraft, assigneeId: e.target.value })} className="w-full px-1 py-1.5 border border-[#141414]/30 bg-white text-xs focus:outline-none">
                    <option value="">Owner</option>
                    {salesPeople.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></div>
                <div className="col-span-3"><div className="text-[10px] uppercase font-bold opacity-50 mb-1">Reminder</div>
                  <input type="datetime-local" value={fuDraft.reminderAt} onChange={(e) => setFuDraft({ ...fuDraft, reminderAt: e.target.value })} className="w-full px-1 py-1.5 border border-[#141414]/30 bg-white text-xs focus:outline-none" /></div>
                <button onClick={addFollowUpDraft} className="col-span-1 py-1.5 bg-[#141414] text-[#E4E3E0] text-[10px] font-bold uppercase">Add</button>
              </div>
              <p className="text-[10px] opacity-50">A reminder email is sent at the reminder time to the assigned person (or the meeting owner).</p>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t">
            <button onClick={onClose} className="px-4 py-2 border border-[#141414] text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors">Cancel</button>
            <button onClick={handleSubmit} className="px-4 py-2 bg-[#141414] text-[#E4E3E0] text-xs font-bold uppercase hover:bg-opacity-80 transition-colors">{submitLabel}</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
