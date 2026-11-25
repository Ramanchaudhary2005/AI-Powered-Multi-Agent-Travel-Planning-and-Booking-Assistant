import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getBookingByPnr, getFlightById, getTicketPdfUrl } from '../api/client';
import {
  formatDisplayDateFull,
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getCityCode,
} from '../utils/flightUtils';

export default function TicketPage() {
  const { pnr } = useParams();
  const [booking, setBooking] = useState(null);
  const [flight, setFlight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getBookingByPnr(pnr)
      .then(async (b) => {
        if (!active) return;
        setBooking(b);
        try {
          const f = b.flight || (await getFlightById(b.flight_id, b.travel_date));
          if (active) setFlight(f);
        } catch {
          // ignore
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
  }, [pnr]);

  const copyPnr = () => {
    if (!booking?.pnr) return;
    navigator.clipboard.writeText(booking.pnr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="h-96 rounded-3xl bg-surface-container animate-pulse" />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <div className="p-6 rounded-2xl bg-surface-container border border-error/40 text-error">
          {error || 'Ticket not found.'}
        </div>
        <Link to="/my-bookings" className="inline-block px-5 py-2.5 rounded-lg bg-primary text-on-primary font-semibold text-sm">
          Back to My Bookings
        </Link>
      </div>
    );
  }

  const isConfirmed = booking.status === 'CONFIRMED';

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
      {/* Top Breadcrumb */}
      <div className="flex items-center justify-between text-xs font-mono text-on-surface-variant">
        <Link to="/my-bookings" className="hover:text-primary flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          <span>All Bookings</span>
        </Link>
        <span>PNR: {booking.pnr}</span>
      </div>

      {/* Pending Warning if not confirmed yet */}
      {!isConfirmed && (
        <div className="p-4 rounded-xl bg-amber-500/15 border border-amber-400/40 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-amber-200">
            This booking is currently <span className="font-mono font-bold">{booking.status}</span>.
            PDF tickets are generated after payment confirmation.
          </div>
          {booking.status === 'PENDING_PAYMENT' && (
            <Link
              to={`/pay/${booking.pnr}`}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-bold"
            >
              Complete Payment
            </Link>
          )}
        </div>
      )}

      {/* Boarding-Pass Style E-Ticket Card */}
      <div className="relative bg-surface-container border border-surface-container-highest rounded-3xl shadow-2xl overflow-hidden">
        {/* Top Banner */}
        <div className="bg-gradient-to-r from-primary/20 via-surface-container-high to-surface-container px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">flight_takeoff</span>
            <span className="font-headline font-bold text-xs uppercase tracking-widest text-on-surface">
              E-Ticket / Digital Boarding Pass
            </span>
          </div>
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider font-mono ${
              isConfirmed
                ? 'bg-primary/20 text-primary'
                : 'bg-amber-400/20 text-amber-300'
            }`}
          >
            {isConfirmed && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
            <span>{booking.status}</span>
          </div>
        </div>

        {/* Main Body */}
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono tracking-wider uppercase text-on-surface-variant block">
                Booking Reference (PNR)
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl sm:text-3xl font-mono font-extrabold tracking-widest text-on-surface bg-surface-container-high px-3.5 py-1 rounded-lg border border-surface-container-highest">
                  {booking.pnr}
                </span>
                <button
                  type="button"
                  onClick={copyPnr}
                  className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors"
                  title="Copy PNR"
                >
                  <span className="material-symbols-outlined text-base">
                    {copied ? 'done' : 'content_copy'}
                  </span>
                </button>
              </div>
            </div>

            {flight && (
              <div className="text-right">
                <div className="px-3 py-1 rounded-lg bg-surface-container-high text-xs font-semibold text-secondary-fixed inline-block">
                  {getAirlineDisplay(flight.airline)} • {flight.flight_code}
                </div>
                <div className="text-xs text-on-surface-variant font-mono mt-1">
                  {flight.travel_class} Class
                </div>
              </div>
            )}
          </div>

          {/* Route Trajectory */}
          {flight && (
            <div className="py-5 px-5 rounded-2xl bg-surface-container-low border border-surface-container-highest/50 space-y-4">
              <div className="flex items-center justify-between text-xs font-mono text-on-surface-variant">
                <span>{formatDisplayDateFull(booking.travel_date)}</span>
                <span className="text-primary font-semibold">
                  {formatDuration(flight.duration_hrs)} • {formatStops(flight.stops_count)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-3xl font-headline font-extrabold text-on-surface">
                    {getCityCode(flight.source_city)}
                  </div>
                  <div className="text-base font-mono font-bold text-primary">
                    {flight.dep_clock}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {flight.source_city} ({flight.departure_time.replace(/_/g, ' ')})
                  </div>
                </div>

                <div className="flex-1 mx-4 flex flex-col items-center">
                  <div className="w-full flex items-center">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <div className="flex-1 h-0.5 bg-gradient-to-r from-primary via-surface-variant to-primary mx-1 relative">
                      <span className="material-symbols-outlined text-sm text-primary absolute left-1/2 -top-2 -translate-x-1/2 rotate-90">
                        flight
                      </span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-primary" />
                  </div>
                </div>

                <div className="text-right space-y-0.5">
                  <div className="text-3xl font-headline font-extrabold text-on-surface">
                    {getCityCode(flight.destination_city)}
                  </div>
                  <div className="text-base font-mono font-bold text-primary">
                    {flight.arr_clock}
                  </div>
                  <div className="text-xs text-on-surface-variant">
                    {flight.destination_city} ({flight.arrival_time.replace(/_/g, ' ')})
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Passengers */}
          <div className="space-y-2.5">
            <span className="text-xs font-mono uppercase tracking-wider text-on-surface-variant">
              Passengers ({booking.passenger_count})
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {booking.passengers?.map((p, idx) => (
                <div
                  key={p.passenger_id}
                  className="p-3 rounded-xl bg-surface-container-low flex items-center justify-between text-xs border border-surface-container-highest/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base text-primary">badge</span>
                    <span className="font-bold text-on-surface">
                      {idx + 1}. {p.name}
                    </span>
                  </div>
                  <span className="font-mono text-on-surface-variant">
                    {p.gender} • {p.age} yrs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Perforated Ticket Divider */}
        <div className="relative py-2 flex items-center justify-center">
          <div className="absolute -left-3 w-6 h-6 rounded-full bg-surface" />
          <div className="w-full border-b-2 border-dashed border-surface-variant" />
          <div className="absolute -right-3 w-6 h-6 rounded-full bg-surface" />
        </div>

        {/* Stub & Download Action */}
        <div className="p-6 sm:p-8 bg-surface-container-low space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-on-surface-variant uppercase block">
                Total Amount Paid
              </span>
              <span className="text-base font-bold text-primary">
                {formatINR(booking.total_amount)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-on-surface-variant uppercase block">
                Booked Via
              </span>
              <span className="text-xs text-on-surface font-semibold">{booking.booked_via}</span>
            </div>
            <div className="sm:text-right">
              <span className="text-[10px] text-on-surface-variant uppercase block">
                Travel Date
              </span>
              <span className="text-xs text-on-surface">{booking.travel_date}</span>
            </div>
          </div>

          {isConfirmed && (
            <a
              href={getTicketPdfUrl(booking.pnr)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 rounded-xl bg-primary text-on-primary font-headline font-bold text-sm hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/15"
            >
              <span className="material-symbols-outlined text-lg">download</span>
              <span>Download PDF Ticket</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
