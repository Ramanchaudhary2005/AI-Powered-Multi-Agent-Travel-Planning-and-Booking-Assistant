import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createCoTraveller, deleteCoTraveller, getProfile, updateCoTraveller, updateProfile } from '../api/client';

const fields = [
  ['first_middle_name', 'First & Middle Name', 'text'], ['last_name', 'Last Name', 'text'],
  ['gender', 'Gender', 'select:Male|Female|Other'], ['dob', 'Date of Birth', 'date'],
  ['nationality', 'Nationality', 'text'], ['marital_status', 'Marital Status', 'select:Single|Married|Prefer not to say'],
  ['anniversary', 'Anniversary', 'date'], ['city', 'City of Residence', 'text'],
  ['state', 'State', 'select:Andhra Pradesh|Arunachal Pradesh|Assam|Bihar|Chhattisgarh|Goa|Gujarat|Haryana|Himachal Pradesh|Jharkhand|Karnataka|Kerala|Madhya Pradesh|Maharashtra|Manipur|Meghalaya|Mizoram|Nagaland|Odisha|Punjab|Rajasthan|Sikkim|Tamil Nadu|Telangana|Tripura|Uttar Pradesh|Uttarakhand|West Bengal|Andaman and Nicobar Islands|Chandigarh|Dadra and Nagar Haveli and Daman and Diu|Delhi|Jammu and Kashmir|Ladakh|Lakshadweep|Puducherry'],
];

const emptyTraveller = { first_middle_name: '', last_name: '', gender: '', dob: '', relationship: '' };
const travellerFields = [['first_middle_name', 'First & Middle Name', 'text'], ['last_name', 'Last Name', 'text'], ['gender', 'Gender', 'select:Male|Female|Other'], ['dob', 'Date of Birth', 'date'], ['relationship', 'Relationship', 'select:Spouse|Child|Parent|Sibling|Friend|Other']];

function ageFromDob(dob) {
  if (!dob) return '—';
  const birth = new Date(dob); const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return `${age} yrs`;
}

function InputField({ field, value, onChange, disabled }) {
  const [name, label, kind] = field;
  const selectOptions = kind.startsWith('select:') ? kind.slice(7).split('|') : null;
  const common = { id: name, value: value || '', onChange: (event) => onChange(name, event.target.value), disabled, className: `w-full px-3.5 py-2.5 rounded-xl bg-[#0b1326]/75 border ${name === 'anniversary' && !disabled ? 'border-primary/60 shadow-[0_0_14px_rgba(78,222,163,0.12)]' : 'border-surface-container-highest'} text-sm text-on-surface outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/30 disabled:opacity-60 [color-scheme:dark]` };
  return <label className="block space-y-1.5"><span className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant">{label}</span>{selectOptions ? <select {...common}><option value="">Select {label.toLowerCase()}</option>{selectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input {...common} type={kind} placeholder={kind === 'text' ? `Enter ${label.toLowerCase()}` : undefined} />}</label>;
}

export default function ProfilePage() {
  const { user, setLoginOpen, refreshProfile } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [travellers, setTravellers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [travellerModal, setTravellerModal] = useState(false);
  const [editingTraveller, setEditingTraveller] = useState(null);
  const [travellerForm, setTravellerForm] = useState(emptyTraveller);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    getProfile().then((data) => {
      if (!active) return;
      const general = data.general_information || {};
      const contact = data.contact_details || {};
      setProfile(data); setForm({ ...general, mobile_number: contact.mobile_number || '', nationality: general.nationality || 'Indian' });
      setTravellers(data.co_travellers || []);
    }).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [user]);

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2800); };
  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const saveProfile = async () => {
    setError('');
    if (form.mobile_number && !/^\d{10}$/.test(form.mobile_number)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    try {
      await updateProfile(form);
      const data = await getProfile();
      setProfile(data); setForm({ ...data.general_information, mobile_number: data.contact_details.mobile_number || '', nationality: data.general_information.nationality || 'Indian' });
      await refreshProfile(); setEditing(false); notify('Profile saved successfully.');
    } catch (err) { setError(err.message || 'Could not save profile.'); }
  };

  const openTraveller = (traveller = null) => {
    setEditingTraveller(traveller);
    setTravellerForm(traveller ? { ...traveller } : emptyTraveller);
    setTravellerModal(true);
  };
  const saveTraveller = async (event) => {
    event.preventDefault(); setError('');
    try {
      const saved = editingTraveller ? await updateCoTraveller(editingTraveller.id, travellerForm) : await createCoTraveller(travellerForm);
      setTravellers((items) => editingTraveller ? items.map((item) => item.id === saved.id ? saved : item) : [saved, ...items]);
      setTravellerModal(false); notify(editingTraveller ? 'Co-traveller updated.' : 'Co-traveller added.');
    } catch (err) { setError(err.message || 'Could not save co-traveller.'); }
  };
  const removeTraveller = async (traveller) => {
    try { await deleteCoTraveller(traveller.id); setTravellers((items) => items.filter((item) => item.id !== traveller.id)); notify('Co-traveller removed.'); }
    catch (err) { setError(err.message || 'Could not remove co-traveller.'); }
  };

  if (!user) return <div className="max-w-xl mx-auto px-5 py-20 text-center"><div className="rounded-3xl bg-surface-container/80 border border-surface-container-highest p-10 shadow-2xl"><span className="material-symbols-outlined text-5xl text-primary">account_circle</span><h1 className="mt-4 text-2xl font-bold text-on-surface">Your travel profile</h1><p className="mt-2 text-sm text-on-surface-variant">Sign in to manage your details and saved travellers.</p><button type="button" onClick={() => setLoginOpen(true)} className="mt-6 px-5 py-3 rounded-xl bg-primary text-on-primary font-semibold">Continue with Google</button></div></div>;

  const completion = profile?.profile_completion_pct ?? user.profile_completion_pct ?? 0;
  const fullName = [form.first_middle_name || user.first_middle_name, form.last_name || user.last_name].filter(Boolean).join(' ') || user.name;

  return <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-8 space-y-7">
    <div className="absolute -top-5 right-1/4 w-96 h-72 bg-indigo-500/10 blur-3xl rounded-full pointer-events-none" />
    <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-primary font-bold">Account center</p><h1 className="mt-2 text-3xl font-headline font-bold text-on-surface">My Profile</h1><p className="mt-1 text-sm text-on-surface-variant">Your details, contact information and travel companions.</p></div><span className="text-xs text-on-surface-variant">Member since {user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'FlightAgent India'}</span></div>
    <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#17213a]/95 via-[#111a30]/90 to-indigo-950/60 p-6 sm:p-8 shadow-xl backdrop-blur-xl">
      <div className="absolute -right-10 -top-20 w-64 h-64 rounded-full bg-indigo-500/15 blur-3xl" />
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_300px] gap-8 items-center">
        <div className="flex items-center gap-4 min-w-0">{user.avatar_url ? <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="w-20 h-20 rounded-2xl object-cover border border-white/15 shadow-lg" /> : <div className="w-20 h-20 rounded-2xl bg-primary/15 text-primary flex items-center justify-center"><span className="material-symbols-outlined text-4xl">person</span></div>}<div className="min-w-0"><h2 className="text-xl sm:text-2xl font-bold text-white truncate">{fullName}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant"><span className="truncate">{user.email}</span><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-300/20 text-[10px] uppercase tracking-wider font-bold"><span className="material-symbols-outlined text-xs">verified</span>Verified</span></div></div></div>
        <div className="rounded-2xl bg-black/20 border border-white/10 p-4"><div className="flex justify-between items-center text-sm"><span className="font-semibold text-on-surface">Profile Completion</span><span className="font-mono font-bold text-primary">{completion}%</span></div><div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-primary transition-all" style={{ width: `${completion}%` }} /></div><p className="mt-2 text-[11px] text-on-surface-variant">A complete profile makes every trip smoother.</p></div>
      </div>
    </section>

    {error && <div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
    <section className="rounded-3xl border border-white/10 bg-surface-container/75 backdrop-blur-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/10"><div><h2 className="text-lg font-bold text-on-surface">General Information</h2><p className="text-xs text-on-surface-variant mt-1">Personal details as shown on your travel documents</p></div><button type="button" onClick={() => editing ? saveProfile() : setEditing(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary font-semibold text-sm hover:bg-primary/20">{editing ? <><span className="material-symbols-outlined text-lg">save</span>Save</> : <><span className="material-symbols-outlined text-lg">edit</span>Edit</>}</button></div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">{fields.map((field) => <InputField key={field[0]} field={field} value={form[field[0]]} onChange={setField} disabled={!editing || (field[0] === 'anniversary' && form.marital_status !== 'Married')} />)}</div>
    </section>

    <section className="rounded-3xl border border-white/10 bg-surface-container/75 backdrop-blur-xl shadow-xl overflow-hidden">
      <div className="px-6 py-5 border-b border-white/10"><h2 className="text-lg font-bold text-on-surface">Contact Details</h2><p className="mt-1 text-xs text-on-surface-variant">Add contact information to receive booking details &amp; other alerts</p></div>
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5"><label className="space-y-1.5"><span className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant">Add Mobile Number</span><div className="flex"><span className="px-3 py-2.5 rounded-l-xl bg-surface-container-high border border-r-0 border-surface-container-highest text-sm text-on-surface-variant">+91</span><input type="tel" inputMode="numeric" maxLength={10} pattern="[0-9]{10}" placeholder="9876543210" value={form.mobile_number || ''} onChange={(e) => setField('mobile_number', e.target.value.replace(/\D/g, '').slice(0, 10))} className="w-full px-3.5 py-2.5 rounded-r-xl bg-[#0b1326]/75 border border-surface-container-highest text-sm text-on-surface outline-none focus:border-primary/70" /></div><span className="text-[10px] text-on-surface-variant">Enter a 10-digit Indian mobile number</span></label><div className="space-y-1.5"><span className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant">Verified Email Address</span><div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-black/15 border border-emerald-400/20 text-sm text-on-surface"><span className="truncate">{user.email}</span><span className="inline-flex items-center gap-1 text-emerald-300 text-xs shrink-0"><span className="material-symbols-outlined text-sm">verified</span>Verified</span></div><span className="text-[10px] text-on-surface-variant">Email is locked to your Google account</span></div></div>
      <div className="px-6 pb-6 flex justify-end"><button type="button" onClick={saveProfile} className="px-4 py-2 rounded-xl bg-primary text-on-primary font-semibold text-sm">Save Contact Details</button></div>
    </section>

    <section className="rounded-3xl border border-white/10 bg-surface-container/75 backdrop-blur-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-white/10"><div><h2 className="text-lg font-bold text-on-surface">Co-Travellers</h2><p className="mt-1 text-xs text-on-surface-variant">Keep your frequent companions ready for checkout</p></div><button type="button" onClick={() => openTraveller()} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-400/15 border border-indigo-300/20 text-indigo-200 font-semibold text-sm hover:bg-indigo-400/25"><span className="material-symbols-outlined text-lg">person_add</span><span className="hidden sm:inline">Add Co-Traveller</span><span className="sm:hidden">Add</span></button></div>
      {travellers.length ? <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">{travellers.map((item) => <article key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center gap-3 min-w-0"><div className="w-11 h-11 shrink-0 rounded-xl bg-indigo-400/10 text-indigo-200 flex items-center justify-center"><span className="material-symbols-outlined">person</span></div><div className="min-w-0"><h3 className="font-semibold text-on-surface truncate">{[item.first_middle_name, item.last_name].filter(Boolean).join(' ')}</h3><div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant"><span>{item.gender || 'Gender not set'}</span><span>·</span><span>{ageFromDob(item.dob)}</span>{item.relationship && <span className="px-2 py-0.5 rounded-full bg-secondary-container/60 text-secondary-fixed">{item.relationship}</span>}</div></div></div><div className="flex gap-1"><button type="button" aria-label={`Edit ${item.first_middle_name}`} onClick={() => openTraveller(item)} className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10"><span className="material-symbols-outlined text-lg">edit</span></button><button type="button" aria-label={`Delete ${item.first_middle_name}`} onClick={() => removeTraveller(item)} className="p-2 rounded-lg text-on-surface-variant hover:text-rose-300 hover:bg-rose-500/10"><span className="material-symbols-outlined text-lg">delete</span></button></div></article>)}</div> : <div className="p-10 text-center"><span className="material-symbols-outlined text-4xl text-on-surface-variant">group_add</span><p className="mt-2 text-sm font-medium text-on-surface">No co-travellers saved yet</p><p className="mt-1 text-xs text-on-surface-variant">Add family and friends to speed up booking.</p></div>}
    </section>
    {toast && <div role="status" className="fixed bottom-6 right-6 z-40 rounded-xl bg-emerald-400 text-emerald-950 px-4 py-3 shadow-xl text-sm font-semibold">{toast}</div>}
    {travellerModal && <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setTravellerModal(false)}><form onSubmit={saveTraveller} className="w-full max-w-xl rounded-3xl bg-[#111a30] border border-white/10 shadow-2xl p-6 sm:p-8"><div className="flex justify-between items-start mb-6"><div><h2 className="text-xl font-bold text-on-surface">{editingTraveller ? 'Edit Co-Traveller' : 'Add Co-Traveller'}</h2><p className="mt-1 text-xs text-on-surface-variant">Save details for a faster booking next time.</p></div><button type="button" aria-label="Close" onClick={() => setTravellerModal(false)} className="p-2 rounded-full text-on-surface-variant hover:bg-white/10"><span className="material-symbols-outlined">close</span></button></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{travellerFields.map((field) => <InputField key={field[0]} field={field} value={travellerForm[field[0]]} onChange={(name, value) => setTravellerForm((current) => ({ ...current, [name]: value }))} />)}</div><div className="flex justify-end gap-3 mt-7"><button type="button" onClick={() => setTravellerModal(false)} className="px-4 py-2 rounded-xl text-sm text-on-surface-variant hover:bg-white/5">Cancel</button><button type="submit" className="px-5 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold">{editingTraveller ? 'Save Changes' : 'Add Co-Traveller'}</button></div></form></div>}
  </div>;
}
