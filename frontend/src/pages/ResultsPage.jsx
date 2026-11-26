import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getFlightMeta, searchFlights } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  TIME_SLOT_META,
  annotateFlightsWithBadges,
  formatDisplayDate,
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getAirlineDot,
  getBookableDateRange,
  getCityCode,
} from '../utils/flightUtils';

const STOPS_OPTIONS = [
  { value: 'zero', label: 'Non-stop' },
  { value: 'one', label: '1 Stop' },
  { value: 'two_or_more', label: '2+ Stops' },
];

export default function ResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isWishlisted, toggleWishlist } = useAuth();
  const dateRange = useMemo(() => getBookableDateRange(), []);

  const sourceCity = searchParams.get('source_city') || 'Delhi';
  const destinationCity = searchParams.get('destination_city') || 'Mumbai';
  const travelDate = searchParams.get('travel_date') || dateRange.defaultDate;
  const travelClass = searchParams.get('travel_class') || 'Economy';
  const passengers = Number(searchParams.get('passengers') || 1);
  const initialStops = searchParams.get('stops');

  const [meta, setMeta] = useState({
    cities: ['Delhi', 'Mumbai', 'Bangalore', 'Kolkata', 'Hyderabad', 'Chennai'],
    classes: ['Economy', 'Business'],
  });

  // Modify search bar toggle
  const [showModify, setShowModify] = useState(false);
  const [modSrc, setModSrc] = useState(sourceCity);
  const [modDst, setModDst] = useState(destinationCity);
  const [modDate, setModDate] = useState(travelDate);
  const [modPax, setModPax] = useState(passengers);
  const [modClass, setModClass] = useState(travelClass);

  // API state
  const [rawFlights, setRawFlights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Client filter / sort controls
  const [selectedStops, setSelectedStops] = useState(() =>
    initialStops ? [initialStops] : []
  );
  const [selectedAirlines, setSelectedAirlines] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [maxPriceCap, setMaxPriceCap] = useState(50000);
  const [sortBy, setSortBy] = useState('best'); // cheapest | fastest | departure | best

  useEffect(() => {
    setModSrc(sourceCity);
    setModDst(destinationCity);
    setModDate(travelDate);
    setModPax(passengers);
    setModClass(travelClass);
  }, [sourceCity, destinationCity, travelDate, passengers, travelClass]);

  useEffect(() => {
    getFlightMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    searchFlights({
      source_city: sourceCity,
      destination_city: destinationCity,
      travel_date: travelDate,
      travel_class: travelClass,
      passengers,
    })
      .then((res) => {
        if (!active) return;
        const list = res.flights || [];
        setRawFlights(list);
        if (list.length > 0) {
          const highest = Math.max(...list.map((f) => f.price));
          setMaxPriceCap(highest);
        }
        setSelectedAirlines([]);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Failed to load flights.');
        setRawFlights([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sourceCity, destinationCity, travelDate, travelClass, passengers]);

  const priceBounds = useMemo(() => {
    if (rawFlights.length === 0) return { min: 1500, max: 50000 };
    const prices = rawFlights.map((f) => f.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [rawFlights]);

  const availableAirlines = useMemo(() => {
    const counts = {};
    for (const f of rawFlights) {
      counts[f.airline] = (counts[f.airline] || 0) + 1;
    }
    return Object.entries(counts).map(([airline, count]) => ({ airline, count }));
  }, [rawFlights]);

  const stopCounts = useMemo(() => {
    const c = { zero: 0, one: 0, two_or_more: 0 };
    for (const f of rawFlights) {
      if (c[f.stops] !== undefined) c[f.stops] += 1;
    }
    return c;
  }, [rawFlights]);

  const filteredAndSorted = useMemo(() => {
    const filtered = rawFlights.filter((f) => {
      if (selectedStops.length > 0 && !selectedStops.includes(f.stops)) return false;
      if (selectedAirlines.length > 0 && !selectedAirlines.includes(f.airline)) return false;
      if (selectedSlot && f.departure_time !== selectedSlot) return false;
      if (f.price > maxPriceCap) return false;
      return true;
    });

    const badged = annotateFlightsWithBadges(filtered, selectedSlot || null);

    return [...badged].sort((a, b) => {
      if (sortBy === 'cheapest') return a.price - b.price;
      if (sortBy === 'fastest') return a.duration_hrs - b.duration_hrs;
      if (sortBy === 'departure') return a.dep_clock.localeCompare(b.dep_clock);
      return a.score - b.score; // best overall
    });
  }, [rawFlights, selectedStops, selectedAirlines, selectedSlot, maxPriceCap, sortBy]);

  const toggleItem = (list, setter, val) => {
    setter(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  };

  const resetFilters = () => {
    setSelectedStops([]);
    setSelectedAirlines([]);
    setSelectedSlot('');
    setMaxPriceCap(priceBounds.max);
  };

  const applyModifySearch = (e) => {
    e.preventDefault();
    if (modSrc === modDst) return;
    setShowModify(false);
    setSearchParams({
      source_city: modSrc,
      destination_city: modDst,
      travel_date: modDate,
      travel_class: modClass,
      passengers: String(modPax),
    });
  };

  return (
    <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-6">
      <div className="absolute top-12 left-1/4 w-96 h-96 bg-primary-container/10 rounded-full blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-48 right-10 w-80 h-80 bg-secondary-container/15 rounded-full blur-3xl pointer-events-none -z-10" />

      {/* Top Compact Search Summary Bar */}
      <section className="w-full bg-surface-container-low border border-surface-container-highest shadow-xl rounded-xl p-4 sm:p-5 mb-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-lg border border-surface-container-highest">
              <span className="text-sm font-headline font-bold text-on-surface tracking-wide">
                {sourceCity} ({getCityCode(sourceCity)})
              </span>
              <span className="material-symbols-outlined text-primary text-[18px]">
                arrow_forward
              </span>
              <span className="text-sm font-headline font-bold text-on-surface tracking-wide">
                {destinationCity} ({getCityCode(destinationCity)})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-medium text-on-surface-variant">
              <span className="flex items-center gap-1.5 text-on-surface">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  calendar_month
                </span>
                {formatDisplayDate(travelDate)}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">person</span>
                {passengers} {passengers === 1 ? 'Passenger' : 'Passengers'}
              </span>
              <span>•</span>
              <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-xs font-semibold text-on-surface">
                {travelClass}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowModify((v) => !v)}
              className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-primary hover:bg-surface-container rounded-lg transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">edit</span>
              <span>{showModify ? 'Close' : 'Modify'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 w-full lg:w-auto pt-3 lg:pt-0 border-t lg:border-t-0 border-surface-container-highest">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-xs text-on-surface font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span>{filteredAndSorted.length} flights found</span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-medium">
              {[
                { key: 'best', label: 'Best Overall' },
                { key: 'cheapest', label: 'Cheapest' },
                { key: 'fastest', label: 'Fastest' },
                { key: 'departure', label: 'Departure' },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSortBy(s.key)}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    sortBy === s.key
                      ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Expandable Modify Search Form */}
        {showModify && (
          <form
            onSubmit={applyModifySearch}
            className="mt-4 pt-4 border-t border-surface-container-highest grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
          >
            <div>
              <label className="text-[11px] uppercase text-on-surface-variant block mb-1">
                From
              </label>
              <select
                value={modSrc}
                onChange={(e) => setModSrc(e.target.value)}
                className="w-full bg-surface-container border border-surface-container-highest rounded-lg px-3 py-2 text-sm text-white"
              >
                {meta.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase text-on-surface-variant block mb-1">To</label>
              <select
                value={modDst}
                onChange={(e) => setModDst(e.target.value)}
                className="w-full bg-surface-container border border-surface-container-highest rounded-lg px-3 py-2 text-sm text-white"
              >
                {meta.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase text-on-surface-variant block mb-1">
                Date
              </label>
              <input
                type="date"
                min={dateRange.minDate}
                max={dateRange.maxDate}
                value={modDate}
                onChange={(e) => setModDate(e.target.value)}
                className="w-full bg-surface-container border border-surface-container-highest rounded-lg px-3 py-2 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase text-on-surface-variant block mb-1">
                Passengers
              </label>
              <select
                value={modPax}
                onChange={(e) => setModPax(Number(e.target.value))}
                className="w-full bg-surface-container border border-surface-container-highest rounded-lg px-3 py-2 text-sm text-white"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} Pax
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase text-on-surface-variant block mb-1">
                Class
              </label>
              <select
                value={modClass}
                onChange={(e) => setModClass(e.target.value)}
                className="w-full bg-surface-container border border-surface-container-highest rounded-lg px-3 py-2 text-sm text-white"
              >
                {meta.classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-primary text-on-primary font-headline font-bold text-sm hover:bg-emerald-400 transition-colors"
            >
              Update Search
            </button>
          </form>
        )}
      </section>

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Filter Sidebar */}
        <aside className="lg:col-span-4 xl:col-span-3 w-full bg-surface-container-low border border-surface-container-highest shadow-xl rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-surface-container-highest">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
              <h2 className="font-headline font-bold text-base text-on-surface">Filters</h2>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Reset All
            </button>
          </div>

          {/* Stops */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
              Stops
            </h3>
            <div className="space-y-2.5">
              {STOPS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center justify-between text-sm text-on-surface cursor-pointer select-none group"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedStops.includes(opt.value)}
                      onChange={() => toggleItem(selectedStops, setSelectedStops, opt.value)}
                      className="w-4 h-4 rounded bg-surface-container accent-emerald-500 cursor-pointer"
                    />
                    <span className="group-hover:text-primary transition-colors">{opt.label}</span>
                  </span>
                  <span className="text-xs text-on-surface-variant font-mono">
                    {stopCounts[opt.value] || 0}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Max Price Slider */}
          <div className="space-y-3 pt-3 border-t border-surface-container-highest">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
                Max Price
              </h3>
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-xs font-bold">
                Up to {formatINR(maxPriceCap)}
              </span>
            </div>
            <input
              type="range"
              min={priceBounds.min}
              max={priceBounds.max}
              step={100}
              value={Math.min(maxPriceCap, priceBounds.max)}
              onChange={(e) => setMaxPriceCap(Number(e.target.value))}
              className="w-full accent-emerald-500 bg-surface-container rounded-lg h-1.5 cursor-pointer"
            />
            <div className="flex items-center justify-between text-[11px] text-on-surface-variant font-mono">
              <span>{formatINR(priceBounds.min)}</span>
              <span>{formatINR(priceBounds.max)}</span>
            </div>
          </div>

          {/* Airlines */}
          <div className="space-y-3 pt-3 border-t border-surface-container-highest">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
              Airlines
            </h3>
            <div className="space-y-2.5">
              {availableAirlines.map(({ airline, count }) => (
                <label
                  key={airline}
                  className="flex items-center justify-between text-sm text-on-surface cursor-pointer select-none group"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={selectedAirlines.includes(airline)}
                      onChange={() =>
                        toggleItem(selectedAirlines, setSelectedAirlines, airline)
                      }
                      className="w-4 h-4 rounded bg-surface-container accent-emerald-500 cursor-pointer"
                    />
                    <span className={`w-2.5 h-2.5 rounded-full ${getAirlineDot(airline)}`} />
                    <span className="group-hover:text-primary transition-colors">
                      {getAirlineDisplay(airline)}
                    </span>
                  </span>
                  <span className="text-xs text-on-surface-variant font-mono">{count}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Departure Time Slots */}
          <div className="space-y-3 pt-3 border-t border-surface-container-highest">
            <h3 className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
              Departure Time
            </h3>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(TIME_SLOT_META).map(([slotKey, info]) => {
                const active = selectedSlot === slotKey;
                return (
                  <button
                    key={slotKey}
                    type="button"
                    onClick={() => setSelectedSlot(active ? '' : slotKey)}
                    className={`p-2 rounded-lg text-left transition-colors ${
                      active
                        ? 'bg-primary-container text-on-primary-container font-semibold shadow-sm'
                        : 'bg-surface-container hover:bg-surface-container-high text-on-surface'
                    }`}
                  >
                    <span className="block font-medium">{info.label}</span>
                    <span className="font-mono text-[10px] opacity-80">{info.range}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Results Column */}
        <section className="lg:col-span-8 xl:col-span-9 w-full space-y-4">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-40 rounded-xl bg-surface-container-low border border-surface-container-highest animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl bg-error-container/30 border border-error/40 p-6 text-error text-sm">
              {error}
            </div>
          ) : filteredAndSorted.length === 0 ? (
            <div className="rounded-xl bg-surface-container-low border border-surface-container-highest p-8 text-center space-y-4">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant">
                flight_land
              </span>
              <h3 className="font-headline font-bold text-lg text-white">
                No flights match your current filters
              </h3>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Reset filters or ask SkyAgent to automatically search nearby dates and alternative
                options.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-xs"
                >
                  Reset Filters
                </button>
                <Link
                  to="/agent"
                  className="px-4 py-2 rounded-lg bg-secondary-container text-white font-semibold text-xs"
                >
                  Ask SkyAgent for Alternatives
                </Link>
              </div>
            </div>
          ) : (
            filteredAndSorted.map((flight) => {
              const isBest = flight.badge === 'Best Overall';
              return (
                <article
                  key={flight.flight_id}
                  className={`relative overflow-hidden rounded-xl p-5 lg:p-6 transition-all duration-200 ${
                    isBest
                      ? 'bg-gradient-to-r from-surface-container-low to-surface-container border border-primary/50 shadow-[0_0_25px_rgba(16,185,129,0.12)]'
                      : 'bg-surface-container-low border border-surface-container-highest hover:bg-surface-container'
                  }`}
                >
                  {/* Top Row: Badges & Live Seats */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-surface-container-highest">
                    <div className="flex items-center gap-2.5">
                      {flight.badge === 'Best Overall' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-primary text-on-primary text-xs font-bold uppercase tracking-wider flex items-center gap-1 shadow-sm">
                          <span className="material-symbols-outlined text-[14px]">verified</span>
                          Best Pick
                        </span>
                      )}
                      {flight.badge === 'Cheapest' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">local_offer</span>
                          Cheapest
                        </span>
                      )}
                      {flight.badge === 'Fastest' && (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">bolt</span>
                          Fastest
                        </span>
                      )}

                      <span className="px-2.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface text-xs font-semibold flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${getAirlineDot(flight.airline)}`}
                        />
                        {getAirlineDisplay(flight.airline)} •{' '}
                        <span className="font-mono">{flight.flight_code}</span>
                        {flight.price_signal && <span title={flight.price_signal.reason} className={`ml-2 inline-flex rounded-full border px-2 py-0.5 align-middle text-[9px] font-bold ${flight.price_signal.signal === 'BOOK_NOW' ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-300' : 'border-amber-300/25 bg-amber-400/10 text-amber-200'}`}>{flight.price_signal.signal === 'BOOK_NOW' ? 'Book Now' : 'Wait'} · {flight.price_signal.confidence_pct}%</span>}
                      </span>
                      <span className="text-xs text-on-surface-variant hidden sm:inline">
                        {flight.travel_class}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-medium">
                      <button type="button" aria-pressed={isWishlisted(flight.flight_id, travelDate)} aria-label={isWishlisted(flight.flight_id, travelDate) ? 'Remove from wishlist' : 'Add to wishlist'} title={isWishlisted(flight.flight_id, travelDate) ? 'Remove from wishlist' : 'Save flight'} onClick={() => toggleWishlist({ ...flight, travel_date: travelDate })} className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${isWishlisted(flight.flight_id, travelDate) ? 'bg-rose-500/15 border-rose-300/30 text-rose-300' : 'bg-surface-container border-surface-container-highest text-on-surface-variant hover:text-rose-300 hover:border-rose-300/30'}`}>
                        <span className="material-symbols-outlined text-[19px]">{isWishlisted(flight.flight_id, travelDate) ? 'favorite' : 'favorite'}</span>
                      </button>
                      <span
                        className={`px-2.5 py-0.5 rounded font-mono ${
                          flight.live_seats_left <= 6
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : 'bg-primary/10 text-primary border border-primary/20'
                        }`}
                      >
                        {flight.live_seats_left} seats left
                      </span>
                    </div>
                  </div>

                  {/* Timeline & CTA */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                    <div className="md:col-span-8 flex items-center justify-between gap-4">
                      <div className="text-left min-w-[76px]">
                        <div className="font-mono text-2xl font-bold text-on-surface">
                          {flight.dep_clock}
                        </div>
                        <div className="font-headline font-bold text-primary text-sm tracking-wide">
                          {getCityCode(flight.source_city)}
                        </div>
                        <div className="text-[11px] text-on-surface-variant">
                          {flight.source_city}
                        </div>
                      </div>

                      <div className="flex-1 flex flex-col items-center px-2">
                        <span className="text-xs font-medium text-on-surface-variant mb-1 font-mono">
                          {formatDuration(flight.duration_hrs)}
                        </span>
                        <div className="w-full relative flex items-center justify-center">
                          <div className="w-full h-0.5 bg-surface-container-highest" />
                          <div className="absolute bg-surface-container-low px-1.5 flex items-center">
                            <span className="material-symbols-outlined text-primary text-[18px] rotate-90">
                              flight
                            </span>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-semibold mt-1 ${
                            flight.stops_count === 0 ? 'text-primary' : 'text-amber-300'
                          }`}
                        >
                          {formatStops(flight.stops_count)}
                        </span>
                      </div>

                      <div className="text-right min-w-[76px]">
                        <div className="font-mono text-2xl font-bold text-on-surface">
                          {flight.arr_clock}
                        </div>
                        <div className="font-headline font-bold text-primary text-sm tracking-wide">
                          {getCityCode(flight.destination_city)}
                        </div>
                        <div className="text-[11px] text-on-surface-variant">
                          {flight.destination_city}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-4 flex flex-col items-start md:items-end justify-center md:pl-6 md:border-l border-surface-container-highest pt-4 md:pt-0">
                      <div className="font-mono text-3xl font-extrabold text-on-surface">
                        {formatINR(flight.price)}
                      </div>
                      <span className="text-[11px] text-on-surface-variant mb-3">
                        Per passenger (incl. taxes)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/book/${flight.flight_id}?travel_date=${encodeURIComponent(
                              travelDate
                            )}&passengers=${passengers}`
                          )
                        }
                        className="w-full py-2.5 px-4 rounded-lg bg-primary-container hover:bg-primary-fixed-dim text-on-primary-container font-headline font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-container/20 group"
                      >
                        <span>Book Now</span>
                        <span className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-1">
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
