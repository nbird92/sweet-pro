import React, { useState } from 'react';
import { Conference, ConferenceAttendee, ConferenceMeeting, Customer } from '../types';
import { Plus, X, Edit2, Trash2, ChevronRight, Clock, MapPin, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ConferencesPageProps {
  conferences: Conference[];
  customers: Customer[];
  onAddConference: (conference: Conference) => void;
  onUpdateConference: (conference: Conference) => void;
  onDeleteConference: (conferenceId: string) => void;
  onAddMeeting: (conferenceId: string, meeting: ConferenceMeeting) => void;
}

export default function ConferencesPage({
  conferences,
  customers,
  onAddConference,
  onUpdateConference,
  onDeleteConference,
  onAddMeeting,
}: ConferencesPageProps) {
  const [selectedConference, setSelectedConference] = useState<Conference | null>(null);
  const [showAddConferenceModal, setShowAddConferenceModal] = useState(false);
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false);
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
    time: '',
    meetingName: '',
    attendees: [],
    location: '',
    notes: '',
    customerId: '',
  });

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
      status: 'Planned',
    };

    onAddConference(conference);
    setShowAddConferenceModal(false);
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

  const handleAddMeeting = () => {
    if (!selectedConference || !newMeeting.time || !newMeeting.meetingName) {
      alert('Please fill in all required fields');
      return;
    }

    const meeting: ConferenceMeeting = {
      id: `MTG-${Date.now()}`,
      conferenceId: selectedConference.id,
      time: newMeeting.time!,
      meetingName: newMeeting.meetingName!,
      attendees: newMeeting.attendees || [],
      location: newMeeting.location!,
      notes: newMeeting.notes,
      customerId: newMeeting.customerId,
    };

    onAddMeeting(selectedConference.id, meeting);
    setShowAddMeetingModal(false);
    setNewMeeting({
      time: '',
      meetingName: '',
      attendees: [],
      location: '',
      notes: '',
      customerId: '',
    });
  };

  const removeAttendee = (attendeeId: string) => {
    setNewConference(prev => ({
      ...prev,
      attendees: prev.attendees?.filter(a => a.id !== attendeeId) || [],
    }));
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

  if (selectedConference) {
    return (
      <ConferenceDetailView
        conference={selectedConference}
        customers={customers}
        onBack={() => setSelectedConference(null)}
        onAddMeeting={() => setShowAddMeetingModal(true)}
        onDeleteMeeting={(mId) => {
          const updated = {
            ...selectedConference,
            meetings: selectedConference.meetings.filter(m => m.id !== mId),
          };
          onUpdateConference(updated);
          setSelectedConference(updated);
        }}
        onAddMeetingModal={showAddMeetingModal}
        onSetShowAddMeetingModal={setShowAddMeetingModal}
        selectedConference={selectedConference}
        newMeeting={newMeeting}
        setNewMeeting={setNewMeeting}
        onHandleAddMeeting={handleAddMeeting}
      />
    );
  }

  return (
    <main className="flex-1 p-6 overflow-auto">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conferences</h1>
        <button
          onClick={() => setShowAddConferenceModal(true)}
          className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
        >
          <Plus size={16} /> Add Conference
        </button>
      </div>

      {/* Conferences List */}
      <div className="space-y-4">
        {conferences.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No conferences yet. Create one to get started!</p>
          </div>
        ) : (
          conferences.map(conference => (
            <div
              key={conference.id}
              onClick={() => setSelectedConference(conference)}
              className="bg-white border border-[#141414] p-4 hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{conference.name}</h3>
                  <div className="mt-2 space-y-1 text-sm text-gray-600">
                    <div className="flex items-center gap-2">
                      <Clock size={14} />
                      {new Date(conference.startDate).toLocaleDateString()} -{' '}
                      {new Date(conference.endDate).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} />
                      {conference.location}
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={14} />
                      {conference.attendees.length} attendees · {conference.meetings.length} meetings
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-1 bg-gray-200 rounded">
                    {conference.status || 'Planned'}
                  </span>
                  <ChevronRight size={20} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Conference Modal */}
      <AnimatePresence>
        {showAddConferenceModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#141414]/80 backdrop-blur-md overflow-y-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white border border-[#141414] shadow-[12px_12px_0px_0px_rgba(20,20,20,1)] max-w-2xl w-full overflow-hidden my-8"
            >
              <div className="bg-[#141414] text-[#E4E3E0] p-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest">Add New Conference</h3>
                <button
                  onClick={() => setShowAddConferenceModal(false)}
                  className="hover:bg-white/10 p-1 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {/* Conference Details */}
                <div>
                  <h4 className="font-bold text-sm uppercase mb-3">Conference Details</h4>
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Conference Name *"
                      value={newConference.name || ''}
                      onChange={e => setNewConference({ ...newConference, name: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="date"
                        placeholder="Start Date *"
                        value={newConference.startDate || ''}
                        onChange={e => setNewConference({ ...newConference, startDate: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <input
                        type="date"
                        placeholder="End Date *"
                        value={newConference.endDate || ''}
                        onChange={e => setNewConference({ ...newConference, endDate: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Location/Venue *"
                      value={newConference.location || ''}
                      onChange={e => setNewConference({ ...newConference, location: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      value={newConference.address || ''}
                      onChange={e => setNewConference({ ...newConference, address: e.target.value })}
                      className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                    />
                    <div className="grid grid-cols-3 gap-3">
                      <input
                        type="text"
                        placeholder="City"
                        value={newConference.city || ''}
                        onChange={e => setNewConference({ ...newConference, city: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <input
                        type="text"
                        placeholder="Province"
                        value={newConference.province || ''}
                        onChange={e => setNewConference({ ...newConference, province: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <input
                        type="text"
                        placeholder="Postal Code"
                        value={newConference.postalCode || ''}
                        onChange={e => setNewConference({ ...newConference, postalCode: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                    </div>
                  </div>
                </div>

                {/* Add Attendees */}
                <div>
                  <h4 className="font-bold text-sm uppercase mb-3">Attendees</h4>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Attendee Name"
                        value={newAttendee.name}
                        onChange={e => setNewAttendee({ ...newAttendee, name: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={newAttendee.email}
                        onChange={e => setNewAttendee({ ...newAttendee, email: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <input
                        type="tel"
                        placeholder="Phone Number"
                        value={newAttendee.phone}
                        onChange={e => setNewAttendee({ ...newAttendee, phone: e.target.value })}
                        className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                      />
                      <button
                        onClick={handleAddAttendee}
                        className="w-full py-2 border border-[#141414] font-bold text-xs uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
                      >
                        + Add Attendee
                      </button>
                    </div>

                    {/* Attendees List */}
                    <div className="space-y-2">
                      {newConference.attendees?.map(attendee => (
                        <div
                          key={attendee.id}
                          className="flex items-center justify-between bg-[#F5F5F5] p-3 border border-[#141414]/20"
                        >
                          <div className="text-sm">
                            <div className="font-bold">{attendee.name}</div>
                            <div className="text-xs text-gray-600">{attendee.email}</div>
                            {attendee.phone && <div className="text-xs text-gray-600">{attendee.phone}</div>}
                          </div>
                          <button
                            onClick={() => removeAttendee(attendee.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-4 pt-4 border-t border-[#141414]/20">
                  <button
                    onClick={handleAddConference}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Create Conference
                  </button>
                  <button
                    onClick={() => setShowAddConferenceModal(false)}
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
    </main>
  );
}

interface ConferenceDetailViewProps {
  conference: Conference;
  customers: Customer[];
  onBack: () => void;
  onAddMeeting: () => void;
  onDeleteMeeting: (meetingId: string) => void;
  onAddMeetingModal: boolean;
  onSetShowAddMeetingModal: (show: boolean) => void;
  selectedConference: Conference;
  newMeeting: Partial<ConferenceMeeting>;
  setNewMeeting: (meeting: Partial<ConferenceMeeting>) => void;
  onHandleAddMeeting: () => void;
}

function ConferenceDetailView({
  conference,
  customers,
  onBack,
  onAddMeeting,
  onDeleteMeeting,
  onAddMeetingModal,
  onSetShowAddMeetingModal,
  newMeeting,
  setNewMeeting,
  onHandleAddMeeting,
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
              {new Date(conference.startDate).toLocaleDateString()} -{' '}
              {new Date(conference.endDate).toLocaleDateString()}
            </p>
            <p className="text-sm text-gray-600">{conference.location}</p>
          </div>
          <button
            onClick={() => onSetShowAddMeetingModal(true)}
            className="px-4 py-2 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all flex items-center gap-2"
          >
            <Plus size={16} /> Add Meeting
          </button>
        </div>
      </div>

      {/* Attendees */}
      <div className="mb-8">
        <h2 className="font-bold text-lg mb-4">Attendees ({conference.attendees.length})</h2>
        <div className="grid grid-cols-2 gap-4">
          {conference.attendees.map(attendee => (
            <div key={attendee.id} className="bg-white border border-[#141414] p-4">
              <div className="font-bold">{attendee.name}</div>
              <div className="text-xs text-gray-600 mt-1">{attendee.email}</div>
              {attendee.phone && <div className="text-xs text-gray-600">{attendee.phone}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Meetings Schedule */}
      <div>
        <h2 className="font-bold text-lg mb-4">Meeting Agenda</h2>
        {conference.meetings.length === 0 ? (
          <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 bg-gray-50">
            <p>No meetings scheduled yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {conference.meetings
              .sort((a, b) => a.time.localeCompare(b.time))
              .map(meeting => (
                <div key={meeting.id} className="bg-white border border-[#141414] p-4">
                  <div className="grid grid-cols-5 gap-4 items-start">
                    <div>
                      <div className="text-xs font-bold uppercase text-gray-600">Time</div>
                      <div className="text-lg font-bold mt-1">{meeting.time}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs font-bold uppercase text-gray-600">Meeting</div>
                      <div className="font-bold mt-1">{meeting.meetingName}</div>
                      {meeting.customerId && (
                        <div className="text-xs text-gray-600 mt-1">
                          Customer: {customers.find(c => c.id === meeting.customerId)?.name || 'Unknown'}
                        </div>
                      )}
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
                    <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
                      {meeting.notes}
                    </div>
                  )}
                  {meeting.attendees.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="text-xs font-bold uppercase text-gray-600 mb-2">Attendees</div>
                      <div className="flex flex-wrap gap-2">
                        {meeting.attendees.map(attendeeId => {
                          const attendee = conference.attendees.find(a => a.id === attendeeId);
                          return attendee ? (
                            <span
                              key={attendeeId}
                              className="text-xs bg-gray-200 px-2 py-1 rounded"
                            >
                              {attendee.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Add Meeting Modal */}
      <AnimatePresence>
        {onAddMeetingModal && (
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
                  className="hover:bg-white/10 p-1 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <input
                  type="time"
                  value={newMeeting.time || ''}
                  onChange={e => setNewMeeting({ ...newMeeting, time: e.target.value })}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                />
                <input
                  type="text"
                  placeholder="Meeting Name *"
                  value={newMeeting.meetingName || ''}
                  onChange={e => setNewMeeting({ ...newMeeting, meetingName: e.target.value })}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                />
                <input
                  type="text"
                  placeholder="Location *"
                  value={newMeeting.location || ''}
                  onChange={e => setNewMeeting({ ...newMeeting, location: e.target.value })}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                />

                <select
                  value={newMeeting.customerId || ''}
                  onChange={e => setNewMeeting({ ...newMeeting, customerId: e.target.value })}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white"
                >
                  <option value="">Select Customer (Optional)</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                  <option value="other">+ Add New Customer</option>
                </select>

                <div>
                  <label className="text-xs font-bold uppercase text-gray-600 block mb-2">
                    Attendees
                  </label>
                  <div className="space-y-2 max-h-32 overflow-y-auto border border-[#141414]/20 p-3 bg-[#F5F5F5]">
                    {conference.attendees.map(attendee => (
                      <label key={attendee.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newMeeting.attendees?.includes(attendee.id) || false}
                          onChange={() => {
                            const current = newMeeting.attendees || [];
                            setNewMeeting({
                              ...newMeeting,
                              attendees: current.includes(attendee.id)
                                ? current.filter(id => id !== attendee.id)
                                : [...current, attendee.id],
                            });
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">{attendee.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <textarea
                  placeholder="Notes (Optional)"
                  value={newMeeting.notes || ''}
                  onChange={e => setNewMeeting({ ...newMeeting, notes: e.target.value })}
                  className="w-full bg-[#F5F5F5] border border-[#141414] p-3 text-sm outline-none focus:bg-white min-h-20"
                />

                <div className="flex gap-4 pt-4 border-t border-[#141414]/20">
                  <button
                    onClick={onHandleAddMeeting}
                    className="flex-1 py-3 bg-[#141414] text-[#E4E3E0] font-bold text-xs uppercase hover:bg-opacity-80 transition-all"
                  >
                    Add Meeting
                  </button>
                  <button
                    onClick={() => onSetShowAddMeetingModal(false)}
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
    </main>
  );
}
