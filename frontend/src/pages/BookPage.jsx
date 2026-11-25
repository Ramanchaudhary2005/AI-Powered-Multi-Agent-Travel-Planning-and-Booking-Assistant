import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createBooking, getFlightById } from '../api/client';
import {
  formatDisplayDate,
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getBookableDateRange,
  getCityCode,
} from '../utils/flightUtils';

export default function BookPage() {
  const { flightId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dateRange = useMemo(() => getBookableDateRange(), []);

  const travelDate = searchParams.get('travel_date') || dateRange.defaultDate;
  const paxCount = Math.max(1, Number(searchParams.get('passengers') || 1));

  const [flight, setFlight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [passengers, setPassengers] = useState(() =>
    Array.from({ length: paxCount }, () => ({ name: '', age: 28, gender: 'M' }))
  );
  const [email, setEmail] = useState(() => localStorage.getItem('flightagent_last_email') || '');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setPassengers((prev) => {
      if (prev.length === paxCount) return prev;
      return Array.from({ length: paxCount }, (_, i) => prev[i] || { name: '', age: 28, gender: 'M' });
    });
  }, [paxCount]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getFlightById(flightId, travelDate)
      .then((data) => {
        if (active) setFlight(data);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Flight not found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [flightId, travelDate]);

  const updatePassenger = (idx, field, val) => {
    setPassengers((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: val } : p))
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!flight) return;

    for (let i = 0; i < passengers.length; i += 1) {
      if (!passengers[i].name.trim()) {
        setError(`Please enter full name for Passenger ${i + 1}.`);
        return;
      }
      if (!passengers[i].age || Number(passengers[i].age) < 1) {
        setError(`Please enter a valid age for Passenger ${i + 1}.`);
        return;
      }
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid contact email.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const booking = await createBooking({
        flight_id: Number(flightId),
        travel_date: travelDate,
        passengers: passengers.map((p) => ({
          name: p.name.trim(),
          age: Number(p.age),
          gender: p.gender,
        })),
        email: email.trim(),
        name: passengers[0].name.trim(),
        phone: phone.trim() || null,
        booked_via: 'MANUAL',
      });
      localStorage.setItem('flightagent_last_email', email.trim());
      navigate(`/pay/${booking.pnr}`);
    } catch (err) {
      setError(err.message || 'Could not create booking hold.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="h-64 rounded-2xl bg-surface-container animate-pulse" />
      </div>
    );
  }

  if (!flight) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <div className="p-6 rounded-2xl bg-surface-container border border-error/40 text-error">
          {error || 'Flight not found.'}
        </div>
        <Link to="/" className="inline-block px-5 py-2.5 rounded-lg bg-primary text-on-primary font-semibold text-sm">
          Back to Search
        </Link>
      </div>
    );
  }

  const totalAmount = flight.price * paxCount;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Breadcrumbs + Step Indicator Ribbon */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-2 text-xs font-mono text-on-surface-variant">
          <Link to="/" className="hover:text-primary transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">home</span> Home
          </Link>
          <span>/</span>
          <span className="text-on-surface font-semibold">
            {getCityCode(flight.source_city)} → {getCityCode(flight.destination_city)}
          </span>
          <span>/</span>
          <span className="text-primary font-medium">Passenger Details</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container text-xs font-medium text-primary">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span>1. Select Flight</span>
          </div>
          <div className="w-4 h-0.5 bg-primary/40" />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/30">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <span>2. Passenger Details</span>
          </div>
          <div className="w-4 h-0.5 bg-surface-variant" />
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-low text-xs font-medium text-on-surface-variant">
            <span>3. Payment &amp; Ticket</span>
          </div>
        </div>
      </div>

      {/* Two-Column Checkout Workspace */}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Passenger & Contact Forms */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-surface-container border border-surface-container-highest rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-surface-variant/40">
              <div>
                <h1 className="text-lg font-headline font-bold text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">person</span>
                  Passenger Details
                </h1>
                <p className="text-xs text-on-surface-variant">
                  Enter details matching government photo ID for {paxCount}{' '}
                  {paxCount === 1 ? 'traveller' : 'travellers'}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-md bg-surface-container-high text-xs font-mono text-secondary-fixed">
                {paxCount} {paxCount === 1 ? 'Passenger' : 'Passengers'}
              </span>
            </div>

            <div className="space-y-5">
              {passengers.map((pax, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-surface-container-low border border-surface-container-highest/60 space-y-3"
                >
                  <div className="text-xs font-mono font-semibold text-primary uppercase">
                    Passenger {idx + 1}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div className="sm:col-span-2 space-y-1.5">
                      <label className="text-xs font-medium text-on-surface-variant">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Alice Sharma"
                        value={pax.name}
                        onChange={(e) => updatePassenger(idx, 'name', e.target.value)}
                        className="w-full bg-surface-container text-on-surface text-sm rounded-lg px-3.5 py-2.5 border border-surface-container-highest outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-on-surface-variant">Age</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={120}
                        value={pax.age}
                        onChange={(e) => updatePassenger(idx, 'age', e.target.value)}
                        className="w-full bg-surface-container text-on-surface text-sm rounded-lg px-3.5 py-2.5 border border-surface-container-highest outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-on-surface-variant">Gender</label>
                      <select
                        value={pax.gender}
                        onChange={(e) => updatePassenger(idx, 'gender', e.target.value)}
                        className="w-full bg-surface-container text-on-surface text-sm rounded-lg px-3.5 py-2.5 border border-surface-container-highest outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="M">Male (M)</option>
                        <option value="F">Female (F)</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Contact Info */}
            <div className="pt-4 border-t border-surface-variant/40 space-y-4">
              <h3 className="text-xs font-headline font-semibold uppercase tracking-wider text-on-surface-variant">
                Contact Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-on-surface-variant">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="alice@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-surface-container-low text-on-surface text-sm rounded-lg px-3.5 py-2.5 border border-surface-container-highest outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[11px] text-on-surface-variant">
                    Used to look up your bookings &amp; PDF ticket
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-on-surface-variant">
                    Mobile Number (Optional)
                  </label>
                  <div className="flex items-center">
                    <span className="px-3 py-2.5 bg-surface-container-high border border-r-0 border-surface-container-highest text-xs font-mono text-on-surface rounded-l-lg">
                      +91
                    </span>
                    <input
                      type="tel"
                      placeholder="9876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-surface-container-low text-on-surface text-sm rounded-r-lg px-3.5 py-2.5 border border-surface-container-highest outline-none focus:ring-1 focus:ring-primary font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-error-container/30 border border-error/40 text-error text-xs">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Flight & Fare Summary */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-surface-container border border-surface-container-highest rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-surface-variant/40">
              <div>
                <h2 className="text-base font-headline font-bold text-on-surface">
                  Flight &amp; Fare Summary
                </h2>
                <p className="text-xs font-mono text-on-surface-variant mt-0.5">
                  {getAirlineDisplay(flight.airline)} {flight.flight_code} • {flight.travel_class}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-primary/10 text-primary text-xs font-mono font-semibold">
                {flight.live_seats_left} seats left
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-on-surface-variant">
                <span>{formatDisplayDate(travelDate)}</span>
                <span className="text-primary">
                  {formatDuration(flight.duration_hrs)} • {formatStops(flight.stops_count)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xl font-headline font-bold text-white">
                    {getCityCode(flight.source_city)}
                  </div>
                  <div className="text-sm font-mono text-primary">{flight.dep_clock}</div>
                  <div className="text-[11px] text-on-surface-variant">{flight.source_city}</div>
                </div>
                <span className="material-symbols-outlined text-primary">flight_takeoff</span>
                <div className="text-right">
                  <div className="text-xl font-headline font-bold text-white">
                    {getCityCode(flight.destination_city)}
                  </div>
                  <div className="text-sm font-mono text-primary">{flight.arr_clock}</div>
                  <div className="text-[11px] text-on-surface-variant">
                    {flight.destination_city}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-on-surface-variant font-mono">
              <div className="flex justify-between">
                <span>
                  Base Fare ({paxCount} × {formatINR(flight.price)})
                </span>
                <span className="text-on-surface font-semibold">{formatINR(totalAmount)}</span>
              </div>
              <div className="flex justify-between text-primary">
                <span>Seat Hold Duration</span>
                <span>10 minutes</span>
              </div>
              <div className="pt-3 border-t border-surface-variant/50 flex justify-between items-center text-base font-sans font-bold text-on-surface">
                <span>Total Amount Payable</span>
                <span className="text-2xl font-mono text-primary">{formatINR(totalAmount)}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || flight.live_seats_left < paxCount}
              className="w-full py-3.5 px-6 rounded-xl bg-primary text-on-primary font-headline font-bold text-sm hover:bg-emerald-400 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-lg">lock</span>
              <span>
                {submitting
                  ? 'Holding Seats...'
                  : `Hold Seats & Proceed to Pay ${formatINR(totalAmount)}`}
              </span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
