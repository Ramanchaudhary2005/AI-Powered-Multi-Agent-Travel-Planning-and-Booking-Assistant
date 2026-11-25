import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getBookingByPnr, getFlightById } from '../api/client';
import {
  formatDisplayDate,
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getCityCode,
} from '../utils/flightUtils';
import { processBookingPayment } from '../utils/razorpay';

const PAYMENT_MODES = [
  { id: 'upi', icon: 'qr_code_2', label: 'UPI / QR', sub: 'GPay, PhonePe' },
  { id: 'cards', icon: 'credit_card', label: 'Cards', sub: 'Visa, RuPay' },
  { id: 'netbanking', icon: 'account_balance', label: 'Net Banking', sub: 'All Banks' },
  { id: 'wallets', icon: 'wallet', label: 'Wallets', sub: 'Instant' },
];

export default function PayPage() {
  const { pnr } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [flight, setFlight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [selectedMode, setSelectedMode] = useState('upi');
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getBookingByPnr(pnr)
      .then(async (b) => {
        if (!active) return;
        if (b.status === 'CONFIRMED') {
          navigate(`/ticket/${b.pnr}`, { replace: true });
          return;
        }
        setBooking(b);
        if (b.hold_expires) {
          const diff = Math.max(
            0,
            Math.floor((new Date(b.hold_expires).getTime() - Date.now()) / 1000)
          );
          setSecondsLeft(diff);
        }
        try {
          const f = b.flight || (await getFlightById(b.flight_id, b.travel_date));
          if (active) setFlight(f);
        } catch {
          // ignore if flight lookup fails
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Booking not found.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pnr, navigate]);

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const handlePay = async () => {
    if (!booking || paying) return;
    setPaying(true);
    setError('');
    try {
      const { verified } = await processBookingPayment({
        bookingId: booking.booking_id,
        description: `PNR ${booking.pnr} • FlightAgent India`,
      });
      navigate(`/ticket/${verified.pnr || booking.pnr}`, { replace: true });
    } catch (err) {
      setError(err.message || 'Payment failed.');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="h-72 rounded-2xl bg-surface-container animate-pulse" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <div className="p-6 rounded-2xl bg-surface-container border border-error/40 text-error">
          {error || 'Booking not found.'}
        </div>
        <Link to="/my-bookings" className="inline-block px-5 py-2.5 rounded-lg bg-primary text-on-primary font-semibold text-sm">
          Go to My Bookings
        </Link>
      </div>
    );
  }

  const isExpired = booking.status === 'EXPIRED' || secondsLeft === 0;
  const mins = secondsLeft !== null ? String(Math.floor(secondsLeft / 60)).padStart(2, '0') : '--';
  const secs = secondsLeft !== null ? String(secondsLeft % 60).padStart(2, '0') : '--';

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header + Progress Ribbon */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-mono text-on-surface-variant">
          <Link to="/" className="hover:text-primary flex items-center gap-1">
            <span className="material-symbols-outlined text-sm">home</span> Home
          </Link>
          <span>/</span>
          <span>PNR {booking.pnr}</span>
          <span>/</span>
          <span className="text-primary font-semibold">Razorpay Payment</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-full bg-surface-container text-xs font-medium text-primary flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span>1. Flight &amp; Passengers</span>
          </div>
          <div className="w-4 h-0.5 bg-primary/40" />
          <div className="px-3 py-1.5 rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/30 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
            <span>2. Payment</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Countdown + Payment Modes + Razorpay CTA */}
        <div className="lg:col-span-7 space-y-6">
          {/* 10-Minute Hold Countdown */}
          <div
            className={`relative overflow-hidden rounded-xl p-4 shadow-lg border ${
              isExpired
                ? 'bg-error-container/25 border-error/40'
                : 'bg-gradient-to-r from-surface-container via-surface-container-high to-surface-container border-primary/30'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-xl">timer</span>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold text-primary font-headline">
                    {isExpired
                      ? 'Seat Hold Expired'
                      : '10-Minute Guaranteed Seat Hold Active'}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {isExpired
                      ? 'Please start a new search to re-hold seats.'
                      : `Complete payment before hold expires to lock ${formatINR(
                          booking.total_amount
                        )}`}
                  </p>
                </div>
              </div>
              <div
                className={`px-3.5 py-1.5 rounded-lg bg-surface-container-lowest font-mono font-bold text-sm tracking-wider tabular-nums ${
                  isExpired ? 'text-error' : 'text-primary'
                }`}
              >
                {isExpired ? '00:00' : `${mins}:${secs}`}
              </div>
            </div>
          </div>

          {/* Payment Box */}
          <div className="bg-surface-container border border-surface-container-highest rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-surface-variant/40">
              <div>
                <h1 className="text-base font-headline font-bold text-on-surface">
                  Fare Summary &amp; Razorpay Checkout
                </h1>
                <p className="text-xs font-mono text-on-surface-variant mt-0.5">
                  PNR: <span className="text-primary font-bold">{booking.pnr}</span> •{' '}
                  {booking.passenger_count} Passenger(s)
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary/10 text-primary text-xs font-semibold">
                <span className="material-symbols-outlined text-sm">lock</span>
                <span>Price Locked</span>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-on-surface-variant font-mono">
              <div className="flex justify-between">
                <span>Booking Amount ({booking.passenger_count} Pax)</span>
                <span className="text-on-surface font-semibold">
                  {formatINR(booking.total_amount)}
                </span>
              </div>
              <div className="flex justify-between text-primary">
                <span>Convenience Fee</span>
                <span className="font-bold">₹0</span>
              </div>
              <div className="pt-3 border-t border-surface-variant/50 flex justify-between items-center text-base font-sans font-bold text-on-surface">
                <span>Total Amount Payable</span>
                <span className="text-2xl font-mono text-primary">
                  {formatINR(booking.total_amount)}
                </span>
              </div>
            </div>

            {/* Payment Modes */}
            <div className="space-y-3">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                Select Payment Mode
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMode(m.id)}
                    className={`p-3 rounded-xl flex flex-col items-center gap-1.5 text-center font-medium transition-all ${
                      selectedMode === m.id
                        ? 'bg-surface-container-high text-on-surface ring-2 ring-primary'
                        : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    <span
                      className={`material-symbols-outlined text-lg ${
                        selectedMode === m.id ? 'text-primary' : ''
                      }`}
                    >
                      {m.icon}
                    </span>
                    <span>{m.label}</span>
                    <span className="text-[10px] opacity-75 font-mono">{m.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-error-container/30 border border-error/40 text-error text-xs">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={paying || isExpired}
              onClick={handlePay}
              className="w-full py-4 px-6 rounded-xl bg-primary text-on-primary font-headline font-bold text-base hover:bg-emerald-400 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-3 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-xl">encrypted</span>
              <span>
                {paying
                  ? 'Processing & Verifying...'
                  : `Pay ${formatINR(booking.total_amount)} via Razorpay`}
              </span>
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Right: Booking Summary Preview */}
        <div className="lg:col-span-5">
          <div className="bg-surface-container border border-surface-container-highest rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-surface-variant/40">
              <span className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
                Pending Reservation
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400/15 text-amber-300 text-xs font-mono font-semibold">
                {booking.status}
              </span>
            </div>

            {flight && (
              <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-secondary-fixed font-semibold">
                    {getAirlineDisplay(flight.airline)} • {flight.flight_code}
                  </span>
                  <span className="text-on-surface-variant">
                    {formatDisplayDate(booking.travel_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-2xl font-headline font-extrabold text-white">
                      {getCityCode(flight.source_city)}
                    </div>
                    <div className="text-sm font-mono text-primary">{flight.dep_clock}</div>
                  </div>
                  <div className="text-center text-[11px] font-mono text-on-surface-variant">
                    {formatDuration(flight.duration_hrs)} • {formatStops(flight.stops_count)}
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-headline font-extrabold text-white">
                      {getCityCode(flight.destination_city)}
                    </div>
                    <div className="text-sm font-mono text-primary">{flight.arr_clock}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                Passengers
              </div>
              {booking.passengers?.map((p) => (
                <div
                  key={p.passenger_id}
                  className="p-2.5 rounded-lg bg-surface-container-low flex items-center justify-between text-xs"
                >
                  <span className="font-semibold text-on-surface">{p.name}</span>
                  <span className="font-mono text-on-surface-variant">
                    {p.gender}, {p.age} yrs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
