import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createHotelBooking, createPackageBooking, getCoTravellers, getHotelVoucherUrl, getTicketPdfUrl, verifyHotelBookingPayment, verifyPackagePayment } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { processPreparedOrder } from '../utils/razorpay';
import { formatINR, getBookableDateRange, getAirlineDisplay } from '../utils/flightUtils';

function ageFromDob(dob) {
  if (!dob) return 28;
  const born = new Date(dob);
  const now = new Date();
  return now.getFullYear() - born.getFullYear() - ((now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) ? 1 : 0);
}

export default function PackageCheckoutPage({ hotelOnly = false }) {
  const { state } = useLocation();
  const { user, setLoginOpen } = useAuth();
  const flight = hotelOnly ? null : state?.flight;
  const hotel = state?.hotel;
  const range = useMemo(() => getBookableDateRange(), []);
  const [checkIn, setCheckIn] = useState(state?.checkInDate || range.defaultDate);
  const [travelDate, setTravelDate] = useState(state?.travelDate || range.defaultDate);
  const [nights, setNights] = useState(Math.max(1, Number(state?.nights || hotel?.nights || 1)));
  const [guests, setGuests] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [passenger, setPassenger] = useState({ name: '', age: 28, gender: 'M' });
  const [travellers, setTravellers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    if (!user) return;
    const fullName = [user.first_middle_name, user.last_name].filter(Boolean).join(' ') || user.name || '';
    setName(fullName); setEmail(user.email || ''); setPhone(user.mobile_number || user.phone || '');
    setPassenger({ name: fullName, age: ageFromDob(user.dob), gender: user.gender === 'Female' ? 'F' : user.gender === 'Male' ? 'M' : user.gender || 'M' });
    getCoTravellers().then(setTravellers).catch(() => setTravellers([]));
  }, [user]);

  const perNight = Number(hotel?.total_price_per_night_inr || 0);
  const stayTotal = Math.round(perNight * Number(nights) * 100) / 100;
  const flightTotal = Number(flight?.price || 0);
  const taxNight = Number(hotel?.tax_is_estimated ? hotel?.estimated_tax_inr : hotel?.tax_inr || 0);
  const combinedTotal = flightTotal + stayTotal;

  const addTraveller = (item) => {
    const travellerName = [item.first_middle_name, item.last_name].filter(Boolean).join(' ');
    setPassenger({ name: travellerName, age: ageFromDob(item.dob), gender: item.gender === 'Female' ? 'F' : item.gender === 'Male' ? 'M' : item.gender || 'Other' });
    setName(travellerName);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!hotel) { setError('Hotel selection is missing. Return to search and choose a hotel.'); return; }
    if (!name.trim() || !email.trim()) { setError('Enter a guest name and email to continue.'); return; }
    if (flight && !passenger.name.trim()) { setError('Enter the flight passenger name.'); return; }
    setBusy(true); setError('');
    try {
      if (flight) {
        const created = await createPackageBooking({
          flight_id: Number(flight.flight_id), travel_date: travelDate,
          passengers: [{ ...passenger, name: passenger.name || name, gender: passenger.gender || 'M' }],
          email, name, phone: phone || null, hotel_id: Number(hotel.hotel_id),
          check_in_date: checkIn, nights: Number(nights), guests: Number(guests),
        });
        const paid = await processPreparedOrder({ order: created.order, customer: { name, email, phone }, description: 'Flight + Hotel Complete Package', verify: (payload) => verifyPackagePayment(created.package_ref, payload) });
        setConfirmation({ type: 'package', result: paid.verified });
      } else {
        const created = await createHotelBooking({ hotel_id: Number(hotel.hotel_id), check_in_date: checkIn, nights: Number(nights), guests: Number(guests), guest_name: name, guest_email: email });
        const paid = await processPreparedOrder({ order: created.order, customer: { name, email, phone }, description: 'Hotel Booking', verify: (payload) => verifyHotelBookingPayment(created.hotel_booking.booking_ref, payload) });
        setConfirmation({ type: 'hotel', result: paid.verified });
      }
    } catch (err) { setError(err.message || 'Checkout could not be completed.'); }
    finally { setBusy(false); }
  };

  if (confirmation) {
    const isPackage = confirmation.type === 'package';
    const flightBooking = isPackage ? confirmation.result.flight_booking : null;
    const hotelBooking = isPackage ? confirmation.result.hotel_booking : confirmation.result.hotel_booking;
    const packageRef = confirmation.result.package_ref;
    return (
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <section className="rounded-3xl border border-primary/30 bg-surface-container p-7 text-center shadow-xl">
          <span className="material-symbols-outlined text-5xl text-primary">verified</span>
          <h1 className="mt-2 font-headline text-3xl font-bold text-white">{isPackage ? `Package Confirmed · ${packageRef}` : 'Hotel Booking Confirmed'}</h1>
          <p className="mt-2 text-sm text-on-surface-variant">Your payment was confirmed. Download your travel documents below.</p>
        </section>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {flightBooking && <article className="rounded-2xl border border-surface-container-highest bg-surface-container p-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">Flight E-Ticket / Boarding Pass</p><h2 className="mt-2 text-xl font-bold text-white">PNR {flightBooking.pnr}</h2><p className="mt-2 text-sm text-on-surface-variant">{flightBooking.flight?.airline} · {flightBooking.flight?.flight_code}</p><p className="text-sm text-on-surface-variant">{flightBooking.flight?.source_city} → {flightBooking.flight?.destination_city} · {flightBooking.travel_date}</p><a className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary" href={getTicketPdfUrl(flightBooking.pnr)} target="_blank" rel="noreferrer">Download Flight E-Ticket PDF</a></article>}
          {hotelBooking && <article className="rounded-2xl border border-surface-container-highest bg-surface-container p-5"><p className="text-xs font-bold uppercase tracking-wider text-secondary">Hotel Confirmation</p><h2 className="mt-2 text-xl font-bold text-white">{hotelBooking.hotel_name}</h2><p className="mt-2 text-sm text-on-surface-variant">Ref {hotelBooking.booking_ref} · {hotelBooking.star_rating || '—'}★</p><p className="text-sm text-on-surface-variant">{hotelBooking.location}, {hotelBooking.city}</p><p className="text-sm text-on-surface-variant">{hotelBooking.check_in_date} → {hotelBooking.check_out_date} · {hotelBooking.nights} nights · {hotelBooking.guests} guests</p><a className="mt-5 inline-flex rounded-xl border border-secondary/40 bg-secondary-container/60 px-4 py-2.5 text-sm font-bold text-white" href={getHotelVoucherUrl(hotelBooking.booking_ref)} target="_blank" rel="noreferrer">Download Hotel Voucher PDF</a></article>}
        </div>
        <div className="mt-5 flex justify-center gap-3"><Link className="rounded-xl border border-surface-container-highest px-4 py-2.5 text-sm text-white" to="/bookings">My Bookings</Link><Link className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary" to="/">Search Flights</Link></div>
      </main>
    );
  }

  if (!hotel) return <main className="mx-auto max-w-3xl px-5 py-16 text-center"><h1 className="text-2xl font-bold text-white">Select a hotel to continue</h1><Link to="/" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary">Back to Search</Link></main>;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <div className="mb-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Secure checkout</p><h1 className="mt-1 font-headline text-3xl font-bold text-white">{flight ? 'Complete Travel Package' : 'Hotel Checkout'}</h1><p className="mt-2 text-sm text-on-surface-variant">Review your stay and details before continuing to Razorpay.</p></div>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-surface-container-highest bg-surface-container p-5 md:p-7">
          {flight && <section className="rounded-xl border border-primary/20 bg-primary/5 p-4"><h2 className="font-bold text-white">Flight · {getAirlineDisplay(flight.airline)} {flight.flight_code}</h2><p className="mt-1 text-sm text-on-surface-variant">{flight.source_city} → {flight.destination_city} · {formatINR(flight.price)}</p><label className="mt-3 block text-xs text-on-surface-variant">Travel date<input required type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} className="mt-1 block rounded-lg border border-surface-container-highest bg-surface-container-low p-2 text-white" /></label></section>}
          <section><h2 className="text-lg font-bold text-white">{hotel.hotel_name}</h2><p className="mt-1 text-sm text-on-surface-variant">{hotel.location} · {hotel.city} · {hotel.star_rating || '—'}★</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs text-on-surface-variant">Check-in<input required type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-2 text-white" /></label><label className="text-xs text-on-surface-variant">Nights<input type="number" min="1" max="90" value={nights} onChange={(e) => setNights(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-2 text-white" /></label><label className="text-xs text-on-surface-variant">Guests<input type="number" min="1" max="20" value={guests} onChange={(e) => setGuests(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-2 text-white" /></label></div></section>
          {flight && <section><h2 className="font-bold text-white">Passenger 1</h2>{travellers.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{travellers.map((person) => <button key={person.id} type="button" onClick={() => addTraveller(person)} className="rounded-full border border-secondary/30 bg-secondary-container/30 px-3 py-1.5 text-[11px] text-secondary">+ Add {[person.first_middle_name, person.last_name].filter(Boolean).join(' ')}</button>)}</div>}<div className="mt-3 grid gap-3 sm:grid-cols-3"><input required placeholder="Passenger name" value={passenger.name} onChange={(e) => setPassenger({ ...passenger, name: e.target.value })} className="rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"/><input required type="number" min="1" max="110" placeholder="Age" value={passenger.age} onChange={(e) => setPassenger({ ...passenger, age: Number(e.target.value) })} className="rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"/><select value={passenger.gender} onChange={(e) => setPassenger({ ...passenger, gender: e.target.value })} className="rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"><option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option></select></div></section>}
          <section className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-on-surface-variant">Guest name<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"/></label><label className="text-xs text-on-surface-variant">Contact email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"/></label><label className="text-xs text-on-surface-variant sm:col-span-2">Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 block w-full rounded-lg border border-surface-container-highest bg-surface-container-low p-3 text-sm text-white"/></label></section>
          {!user && <button type="button" onClick={() => setLoginOpen(true)} className="text-xs font-semibold text-primary">Sign in with Google to save this booking to your account</button>}
          {error && <p role="alert" className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-red-300">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-primary px-5 py-3.5 text-sm font-bold text-on-primary shadow-lg disabled:opacity-60">{busy ? 'Preparing secure payment…' : `Continue to Razorpay · ${formatINR(combinedTotal)}`}</button>
        </form>
        <aside className="h-fit rounded-2xl border border-surface-container-highest bg-surface-container p-5"><h2 className="font-bold text-white">Price breakdown</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3 text-on-surface-variant"><span>Hotel base · {nights} nights</span><span>{formatINR(Number(hotel.price_inr || 0) * nights)}</span></div><div className="flex justify-between gap-3 text-on-surface-variant"><span>{hotel.tax_is_estimated ? 'Estimated GST' : 'Hotel tax'} · {nights} nights</span><span>{formatINR(taxNight * nights)}</span></div>{flight && <div className="flex justify-between gap-3 text-on-surface-variant"><span>Flight fare</span><span>{formatINR(flightTotal)}</span></div>}<div className="border-t border-surface-container-highest pt-3 flex justify-between font-bold text-white"><span>Total</span><span className="font-mono text-primary">{formatINR(combinedTotal)}</span></div></div><p className="mt-4 text-[10px] leading-relaxed text-on-surface-variant">One user-confirmed Razorpay checkout covers the listed {flight ? 'flight and hotel' : 'hotel'} total. No payment is made until you confirm in checkout.</p></aside>
      </div>
    </main>
  );
}
