import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  getBookingByPnr,
  getBookingsByEmail,
  getFlightById,
  getTicketPdfUrl,
} from '../api/client';
import {
  formatDisplayDate,
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getAirlineDot,
  getCityCode,
} from '../utils/flightUtils';

function HoldCountdown({ holdExpires }) {
  const [secsLeft, setSecsLeft] = useState(() => {
    if (!holdExpires) return null;
    return Math.max(0, Math.floor((new Date(holdExpires).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    if (secsLeft === null || secsLeft <= 0) return undefined;
    const t = setInterval(() => {
      setSecsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [secsLeft]);

  if (secsLeft === null) return null;
  if (secsLeft <= 0) return <span className="text-error">Hold expired</span>;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const ss = String(secsLeft % 60).padStart(2, '0');
  return (
    <span>
      {mm}:{ss} left
    </span>
  );
}

export default function MyBookingsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState(
    () => localStorage.getItem('flightagent_last_lookup') || localStorage.getItem('flightagent_last_email') || ''
  );
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [copiedPnr, setCopiedPnr] = useState('');

  const performLookup = useCallback(async (rawTerm) => {
    const term = rawTerm.trim();
    if (!term) return;

    setLoading(true);
    setError('');
    localStorage.setItem('flightagent_last_lookup', term);

    try {
      let list = [];
      if (term.includes('@')) {
        list = await getBookingsByEmail(term);
      } else {
        const single = await getBookingByPnr(term);
        list = single ? [single] : [];
      }

      // Enrich each booking with live DuckDB flight metadata
      const enriched = await Promise.all(
        list.map(async (b) => {
          if (b.flight) return b;
          try {
            const f = await getFlightById(b.flight_id, b.travel_date);
            return { ...b, flight: f };
          } catch {
            return b;
          }
        })
      );

      setBookings(enriched);
    } catch (err) {
      setBookings([]);
      setError(err.message || 'No bookings found for that Email or PNR.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query.trim()) {
      performLookup(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    return {
      ALL: bookings.length,
      CONFIRMED: bookings.filter((b) => b.status === 'CONFIRMED').length,
      PENDING_PAYMENT: bookings.filter((b) => b.status === 'PENDING_PAYMENT').length,
      EXPIRED: bookings.filter((b) => b.status === 'EXPIRED').length,
    };
  }, [bookings]);

  const visibleBookings = useMemo(() => {
    if (statusFilter === 'ALL') return bookings;
    return bookings.filter((b) => b.status === statusFilter);
  }, [bookings, statusFilter]);

  const handleCopy = (pnr) => {
    navigator.clipboard.writeText(pnr);
    setCopiedPnr(pnr);
    setTimeout(() => setCopiedPnr(''), 1500);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-6 lg:px-12 py-8 flex flex-col gap-8">
      {/* Header + Stats */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex flex-col gap-2 max-w-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center text-primary shadow-inner">
              <span className="material-symbols-outlined text-[24px]">confirmation_number</span>
            </div>
            <h1 className="text-3xl font-headline font-bold tracking-tight text-on-surface">
              My Bookings
            </h1>
          </div>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Look up reservations by Email or 6-character PNR, resume pending holds, and download
            boarding pass PDFs.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5 text-xs font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-on-surface-variant">Pending:</span>
            <span className="text-amber-300 font-semibold">{counts.PENDING_PAYMENT}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-high">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-on-surface-variant">Confirmed:</span>
            <span className="text-primary font-semibold">{counts.CONFIRMED}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container">
            <span className="text-on-surface-variant">Total:</span>
            <span className="text-on-surface font-semibold">{counts.ALL}</span>
          </div>
        </div>
      </div>

      {/* Search & Filter Card */}
      <div className="bg-surface-container border border-surface-container-highest rounded-xl p-5 md:p-6 shadow-md flex flex-col gap-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            performLookup(query);
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
              search
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by Email (e.g. alice@test.com) or 6-char PNR..."
              className="w-full pl-11 pr-4 py-3 bg-surface-container-lowest border border-surface-container-highest text-on-surface text-sm placeholder:text-on-surface-variant/60 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="flex items-center justify-center gap-2 px-6 py-3 bg-primary text-on-primary font-headline font-semibold text-sm rounded-xl hover:bg-emerald-400 transition-all shadow-md disabled:opacity-50"
          >
            <span>{loading ? 'Searching...' : 'Find Bookings'}</span>
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
        </form>

        {/* Status Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pt-1">
          {[
            { key: 'ALL', label: 'All' },
            { key: 'CONFIRMED', label: 'CONFIRMED' },
            { key: 'PENDING_PAYMENT', label: 'PENDING_PAYMENT' },
            { key: 'EXPIRED', label: 'EXPIRED' },
          ].map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium font-mono flex items-center gap-2 transition-all ${
                  active
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                <span>{tab.label}</span>
                <span className="text-[11px] opacity-80">({counts[tab.key] || 0})</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-error-container/30 border border-error/40 text-error text-xs">
          {error}
        </div>
      )}

      {/* Bookings Table */}
      <div className="bg-surface-container border border-surface-container-highest rounded-xl shadow-lg overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            <div className="h-12 rounded-lg bg-surface-container-high animate-pulse" />
            <div className="h-12 rounded-lg bg-surface-container-high animate-pulse" />
          </div>
        ) : visibleBookings.length === 0 ? (
          <div className="p-10 text-center space-y-3 text-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl text-surface-bright">
              airplane_ticket
            </span>
            <p className="text-on-surface font-medium">No matching bookings to display</p>
            <p className="text-xs max-w-md mx-auto">
              Enter the email address used during booking or a 6-character PNR code above.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-high/60 text-[11px] font-mono uppercase tracking-wider text-on-surface-variant">
                  <th className="py-3.5 px-5">PNR</th>
                  <th className="py-3.5 px-5">Route &amp; Flight</th>
                  <th className="py-3.5 px-5">Travel Date</th>
                  <th className="py-3.5 px-5">Passengers</th>
                  <th className="py-3.5 px-5">Total Fare</th>
                  <th className="py-3.5 px-5">Source</th>
                  <th className="py-3.5 px-5">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-surface-container-high/50">
                {visibleBookings.map((b) => {
                  const f = b.flight;
                  const isConfirmed = b.status === 'CONFIRMED';
                  const isPending = b.status === 'PENDING_PAYMENT';
                  const isExpired = b.status === 'EXPIRED' || b.status === 'CANCELLED';

                  return (
                    <tr
                      key={b.booking_id}
                      className={`hover:bg-surface-container-high/40 transition-colors ${
                        isExpired ? 'opacity-70' : ''
                      }`}
                    >
                      {/* PNR */}
                      <td className="py-4 px-5 align-top">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono font-bold tracking-wider bg-surface-container-lowest px-2 py-1 rounded text-xs ${
                              isExpired ? 'line-through text-on-surface-variant' : 'text-on-surface'
                            }`}
                          >
                            {b.pnr}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(b.pnr)}
                            className="p-1 text-on-surface-variant hover:text-primary rounded"
                            title="Copy PNR"
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              {copiedPnr === b.pnr ? 'done' : 'content_copy'}
                            </span>
                          </button>
                        </div>
                      </td>

                      {/* Route & Flight */}
                      <td className="py-4 px-5 align-top">
                        {f ? (
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-2 h-2 rounded-full ${getAirlineDot(f.airline)}`}
                              />
                              <span className="font-headline font-bold text-on-surface">
                                {getCityCode(f.source_city)} → {getCityCode(f.destination_city)}
                              </span>
                              <span className="text-xs font-mono text-on-surface-variant">
                                • {getAirlineDisplay(f.airline)} {f.flight_code}
                              </span>
                            </div>
                            <div className="text-xs text-on-surface-variant">
                              {f.source_city} to {f.destination_city} ({f.travel_class})
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs font-mono text-on-surface-variant">
                            Flight #{b.flight_id}
                          </span>
                        )}
                      </td>

                      {/* Travel Date */}
                      <td className="py-4 px-5 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium text-on-surface">
                            {formatDisplayDate(b.travel_date)}
                          </span>
                          {f && (
                            <span className="text-xs font-mono text-on-surface-variant mt-0.5">
                              {f.dep_clock} – {f.arr_clock} • {formatDuration(f.duration_hrs)} •{' '}
                              {formatStops(f.stops_count)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Passengers */}
                      <td className="py-4 px-5 align-top font-mono text-xs text-on-surface">
                        {b.passenger_count} Pax
                      </td>

                      {/* Total Fare */}
                      <td className="py-4 px-5 align-top font-mono">
                        <span className="text-base font-bold text-on-surface">
                          {formatINR(b.total_amount)}
                        </span>
                      </td>

                      {/* Source */}
                      <td className="py-4 px-5 align-top">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono ${
                            b.booked_via === 'AGENT'
                              ? 'bg-tertiary-container/25 text-tertiary'
                              : 'bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {b.booked_via === 'AGENT' ? 'auto_awesome' : 'person'}
                          </span>
                          <span>{b.booked_via}</span>
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-5 align-top">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium font-mono w-fit ${
                              isConfirmed
                                ? 'bg-primary/15 text-primary'
                                : isPending
                                ? 'bg-amber-400/15 text-amber-300'
                                : 'bg-surface-container-high text-outline'
                            }`}
                          >
                            <span>{b.status}</span>
                          </span>
                          {isPending && b.hold_expires && (
                            <span className="text-[11px] font-mono text-amber-300">
                              <HoldCountdown holdExpires={b.hold_expires} />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-5 align-top text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isConfirmed && (
                            <>
                              <Link
                                to={`/ticket/${b.pnr}`}
                                className="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface text-xs font-medium transition-colors"
                              >
                                View Pass
                              </Link>
                              <a
                                href={getTicketPdfUrl(b.pnr)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/40 hover:bg-primary hover:text-on-primary text-primary font-medium text-xs transition-colors"
                              >
                                <span className="material-symbols-outlined text-[15px]">
                                  picture_as_pdf
                                </span>
                                <span>Download Ticket</span>
                              </a>
                            </>
                          )}
                          {isPending && (
                            <button
                              type="button"
                              onClick={() => navigate(`/pay/${b.pnr}`)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-on-primary font-headline font-semibold text-xs hover:bg-emerald-400 transition-all shadow-sm"
                            >
                              <span className="material-symbols-outlined text-[15px]">bolt</span>
                              <span>Resume Pay</span>
                            </button>
                          )}
                          {isExpired && (
                            <Link
                              to="/"
                              className="text-xs text-primary hover:underline font-medium"
                            >
                              Rebook
                            </Link>
                          )}
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
    </div>
  );
}
