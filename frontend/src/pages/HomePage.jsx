import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createAgentSession, getFlightMeta, searchFlights, searchHotels } from '../api/client';
import HotelResultCard from '../components/HotelResultCard';
import {
  CITY_INFO,
  formatDisplayDate,
  formatDuration,
  formatINR,
  getAirlineDisplay,
  getBookableDateRange,
  getCityCode,
} from '../utils/flightUtils';

const SAMPLE_PROMPTS = [
  'Cheapest non-stop Delhi to Mumbai under ₹6,000',
  'Best morning Vistara flight from Delhi to Bangalore',
  'Find Economy flights from Kolkata to Hyderabad',
  'Compare fastest evening flights Mumbai to Chennai',
];

const FEATURED_ROUTE_PAIRS = [
  ['Delhi', 'Mumbai'],
  ['Mumbai', 'Bangalore'],
  ['Delhi', 'Bangalore'],
  ['Bangalore', 'Kolkata'],
  ['Hyderabad', 'Delhi'],
  ['Chennai', 'Mumbai'],
];

export default function HomePage() {
  const navigate = useNavigate();
  const dateRange = useMemo(() => getBookableDateRange(), []);

  const [meta, setMeta] = useState({
    cities: ['Delhi', 'Mumbai', 'Bangalore', 'Kolkata', 'Hyderabad', 'Chennai'],
    classes: ['Economy', 'Business'],
  });
  const [sourceCity, setSourceCity] = useState('Delhi');
  const [destinationCity, setDestinationCity] = useState('Mumbai');
  const [travelDate, setTravelDate] = useState(dateRange.defaultDate);
  const [travelClass, setTravelClass] = useState('Economy');
  const [passengers, setPassengers] = useState(1);
  const [nonStopOnly, setNonStopOnly] = useState(false);
  const [formError, setFormError] = useState('');
  const [searchMode, setSearchMode] = useState('flights');
  const [hotelCity, setHotelCity] = useState('Delhi');
  const [hotelNights, setHotelNights] = useState(1);
  const [hotelMaxPrice, setHotelMaxPrice] = useState('');
  const [hotelStars, setHotelStars] = useState('');
  const [hotelMinRating, setHotelMinRating] = useState('');
  const [hotelSort, setHotelSort] = useState('recommended');
  const [hotelResults, setHotelResults] = useState(null);
  const [hotelLoading, setHotelLoading] = useState(false);
  const [hotelError, setHotelError] = useState('');

  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);

  const [featuredRoutes, setFeaturedRoutes] = useState([]);
  const [routesLoading, setRoutesLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getFlightMeta()
      .then((data) => {
        if (!active) return;
        setMeta(data);
        if (data.cities?.length >= 2) {
          setSourceCity((prev) => (data.cities.includes(prev) ? prev : data.cities[0]));
          setDestinationCity((prev) => (data.cities.includes(prev) ? prev : data.cities[1]));
        }
      })
      .catch(() => {});

    // Fetch live sample lowest fares from backend DuckDB for the 6 metro routes
    Promise.allSettled(
      FEATURED_ROUTE_PAIRS.map(async ([src, dst]) => {
        const res = await searchFlights({
          source_city: src,
          destination_city: dst,
          travel_date: dateRange.defaultDate,
          travel_class: 'Economy',
          passengers: 1,
        });
        return { src, dst, total: res.total, cheapest: res.flights?.[0] || null };
      })
    ).then((results) => {
      if (!active) return;
      const loaded = results
        .filter((r) => r.status === 'fulfilled' && r.value.cheapest)
        .map((r) => r.value);
      setFeaturedRoutes(loaded);
      setRoutesLoading(false);
    });

    return () => {
      active = false;
    };
  }, [dateRange.defaultDate]);

  const handleSwapCities = () => {
    setSourceCity(destinationCity);
    setDestinationCity(sourceCity);
    setFormError('');
  };

  const handleManualSearch = (e) => {
    e.preventDefault();
    if (sourceCity === destinationCity) {
      setFormError('Origin and destination cities must be different.');
      return;
    }
    setFormError('');
    const params = new URLSearchParams({
      source_city: sourceCity,
      destination_city: destinationCity,
      travel_date: travelDate,
      travel_class: travelClass,
      passengers: String(passengers),
    });
    if (nonStopOnly) {
      params.set('stops', 'zero');
    }
    navigate(`/results?${params.toString()}`);
  };

  const handleHotelSearch = async (e) => {
    e.preventDefault();
    setHotelError('');
    setHotelLoading(true);
    try {
      const results = await searchHotels({
        city: hotelCity,
        nights: hotelNights,
        max_price: hotelMaxPrice || undefined,
        star_rating: hotelStars || undefined,
        min_rating: hotelMinRating || undefined,
        sort_by: hotelSort,
        limit: 30,
      });
      setHotelResults(results);
    } catch (err) {
      setHotelError(err.message || 'Could not search hotels.');
      setHotelResults(null);
    } finally {
      setHotelLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    if (searchMode === 'hotels') handleHotelSearch(e);
    else handleManualSearch(e);
  };

  const handleOpenAgent = async (promptText = '') => {
    if (agentLoading) return;
    setAgentLoading(true);
    try {
      const session = await createAgentSession(null);
      navigate(`/agent/${session.session_id}`, {
        state: promptText.trim() ? { initialPrompt: promptText.trim() } : undefined,
      });
    } catch {
      navigate('/agent');
    } finally {
      setAgentLoading(false);
    }
  };

  const handleFeaturedClick = (route) => {
    const params = new URLSearchParams({
      source_city: route.src,
      destination_city: route.dst,
      travel_date: dateRange.defaultDate,
      travel_class: 'Economy',
      passengers: '1',
    });
    navigate(`/results?${params.toString()}`);
  };

  return (
    <div className="flex flex-col w-full relative overflow-hidden">
      {/* Ambient Atmospheric Glows */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[360px] bg-gradient-to-b from-primary/10 via-secondary-container/10 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-[520px] -right-48 w-[500px] h-[500px] bg-tertiary-container/10 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-[800px] -left-48 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Hero Header */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 pt-10 pb-8 w-full flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-surface-container-high border border-surface-container-highest shadow-md shadow-black/20 mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-semibold text-on-surface tracking-wide uppercase font-label">
            India&apos;s Intelligent Flight Booking Engine
          </span>
        </div>

        <h1 className="font-headline font-extrabold text-3xl sm:text-5xl lg:text-6xl text-white tracking-tight leading-[1.12] max-w-4xl">
          Book Domestic Flights{' '}
          <span className="bg-gradient-to-r from-primary via-emerald-300 to-tertiary bg-clip-text text-transparent">
            Across India
          </span>
        </h1>

        <p className="mt-4 text-base sm:text-lg text-on-surface-variant max-w-2xl font-normal leading-relaxed">
          Search 300,153 real domestic flights manually across 6 metro hubs or let SkyAgent plan,
          rank, and reserve within your ₹ budget cap.
        </p>

        <div className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container-lowest border border-surface-container-highest/60 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-primary text-[15px]">bolt</span>
          <span>Live catalog:</span>
          <span className="text-on-surface font-medium">
            IndiGo • Vistara • Air India • SpiceJet • AirAsia • GO FIRST
          </span>
        </div>
      </section>

      {/* Main Search + Agent Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 w-full pb-14 flex flex-col gap-6">
        {/* Manual Flight Search Card */}
        <form
          onSubmit={handleSearchSubmit}
          className="w-full bg-surface-container-low border border-surface-container-highest rounded-2xl p-5 sm:p-7 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />

          <div className="mb-6 flex justify-center">
            <div className="inline-flex rounded-xl border border-surface-container-highest bg-surface-container-lowest p-1 shadow-inner" role="group" aria-label="Search type">
              {[
                { id: 'flights', label: '✈️ Flights' },
                { id: 'hotels', label: '🏨 Hotels' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setSearchMode(mode.id)}
                  aria-pressed={searchMode === mode.id}
                  className={`rounded-lg px-5 py-2 text-xs font-bold transition-all sm:text-sm ${searchMode === mode.id ? 'bg-primary text-on-primary shadow-md' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-white'}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {searchMode === 'flights' ? (
          <>

          <div className="flex flex-wrap items-center justify-between gap-4 pb-5">
            <div className="flex items-center gap-2">
              <span className="px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold bg-primary text-on-primary shadow">
                One Way
              </span>
              <span className="text-xs text-on-surface-variant px-2">
                Bookable window: +1 to +49 days
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px] text-primary">verified</span>
              <span className="font-medium">Live DuckDB + SQLite Seat Inventory</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 relative items-stretch">
            {/* From City */}
            <div className="md:col-span-3 bg-surface-container border border-surface-container-highest/60 rounded-xl p-3.5 hover:bg-surface-container-high transition-colors">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="from-city"
                  className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase font-label"
                >
                  From
                </label>
                <span className="text-xs font-mono font-bold text-primary">
                  {getCityCode(sourceCity)}
                </span>
              </div>
              <select
                id="from-city"
                value={sourceCity}
                onChange={(e) => {
                  setSourceCity(e.target.value);
                  setFormError('');
                }}
                className="mt-1.5 w-full bg-transparent text-base sm:text-lg font-headline font-bold text-white focus:outline-none cursor-pointer"
              >
                {meta.cities.map((c) => (
                  <option key={c} value={c} className="bg-surface-container text-white">
                    {c}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-on-surface-variant/80 truncate mt-0.5">
                {CITY_INFO[sourceCity]?.airport || 'Domestic Airport'}
              </p>
            </div>

            {/* Swap Button */}
            <div className="hidden md:flex absolute left-[25%] top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <button
                type="button"
                onClick={handleSwapCities}
                aria-label="Swap departure and destination"
                className="w-9 h-9 rounded-full bg-surface-container-highest border border-outline-variant/40 text-primary hover:bg-primary hover:text-on-primary transition-all duration-200 shadow-lg flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-base">swap_horiz</span>
              </button>
            </div>

            {/* To City */}
            <div className="md:col-span-3 bg-surface-container border border-surface-container-highest/60 rounded-xl p-3.5 hover:bg-surface-container-high transition-colors">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="to-city"
                  className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase font-label"
                >
                  To
                </label>
                <span className="text-xs font-mono font-bold text-primary">
                  {getCityCode(destinationCity)}
                </span>
              </div>
              <select
                id="to-city"
                value={destinationCity}
                onChange={(e) => {
                  setDestinationCity(e.target.value);
                  setFormError('');
                }}
                className="mt-1.5 w-full bg-transparent text-base sm:text-lg font-headline font-bold text-white focus:outline-none cursor-pointer"
              >
                {meta.cities.map((c) => (
                  <option key={c} value={c} className="bg-surface-container text-white">
                    {c}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-on-surface-variant/80 truncate mt-0.5">
                {CITY_INFO[destinationCity]?.airport || 'Domestic Airport'}
              </p>
            </div>

            {/* Departure Date */}
            <div className="md:col-span-2 bg-surface-container border border-surface-container-highest/60 rounded-xl p-3.5 hover:bg-surface-container-high transition-colors">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="travel-date"
                  className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase font-label"
                >
                  Departure
                </label>
                <span className="material-symbols-outlined text-[15px] text-primary">
                  calendar_today
                </span>
              </div>
              <input
                id="travel-date"
                type="date"
                min={dateRange.minDate}
                max={dateRange.maxDate}
                value={travelDate}
                onChange={(e) => setTravelDate(e.target.value)}
                className="mt-1.5 w-full bg-transparent text-sm sm:text-base font-headline font-bold text-white focus:outline-none [color-scheme:dark]"
              />
              <p className="text-[11px] text-primary font-medium mt-0.5 truncate">
                {formatDisplayDate(travelDate)}
              </p>
            </div>

            {/* Passengers */}
            <div className="md:col-span-2 bg-surface-container border border-surface-container-highest/60 rounded-xl p-3.5 hover:bg-surface-container-high transition-colors">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="pax-count"
                  className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase font-label"
                >
                  Passengers
                </label>
                <span className="material-symbols-outlined text-[15px] text-primary">group</span>
              </div>
              <select
                id="pax-count"
                value={passengers}
                onChange={(e) => setPassengers(Number(e.target.value))}
                className="mt-1.5 w-full bg-transparent text-base font-headline font-bold text-white focus:outline-none cursor-pointer"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n} className="bg-surface-container text-white">
                    {n} {n === 1 ? 'Passenger' : 'Passengers'}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-on-surface-variant/80 mt-0.5">Live seat check</p>
            </div>

            {/* Cabin Class */}
            <div className="md:col-span-2 bg-surface-container border border-surface-container-highest/60 rounded-xl p-3.5 hover:bg-surface-container-high transition-colors">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="travel-class"
                  className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase font-label"
                >
                  Cabin Class
                </label>
                <span className="material-symbols-outlined text-[15px] text-primary">
                  airline_seat_recline_extra
                </span>
              </div>
              <select
                id="travel-class"
                value={travelClass}
                onChange={(e) => setTravelClass(e.target.value)}
                className="mt-1.5 w-full bg-transparent text-base font-headline font-bold text-white focus:outline-none cursor-pointer"
              >
                {meta.classes.map((cls) => (
                  <option key={cls} value={cls} className="bg-surface-container text-white">
                    {cls}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-on-surface-variant/80 mt-0.5">All taxes incl.</p>
            </div>
          </div>

          {formError && (
            <div className="mt-3 px-3.5 py-2 rounded-lg bg-error-container/40 border border-error/40 text-error text-xs font-medium">
              {formError}
            </div>
          )}

          {/* Action Footer */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 bg-surface-container-lowest/60 -mx-5 -mb-5 sm:-mx-7 sm:-mb-7 px-5 sm:px-7 py-4 border-t border-surface-container-highest/60">
            <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span>DEL, BOM, BLR, CCU, HYD &amp; MAA</span>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={nonStopOnly}
                  onChange={(e) => setNonStopOnly(e.target.checked)}
                  className="w-3.5 h-3.5 rounded accent-emerald-500 bg-surface-container"
                />
                <span className="text-on-surface font-medium">Non-stop flights only</span>
              </label>
            </div>

            <button
              type="submit"
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-primary hover:bg-emerald-400 text-on-primary font-headline font-bold text-sm tracking-wide shadow-lg shadow-primary/20 hover:shadow-primary/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
            >
              <span className="material-symbols-outlined text-[20px]">flight_takeoff</span>
              <span>Search Flights</span>
            </button>
          </div>
          </>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="font-headline text-xl font-bold text-white">Find your stay</h2>
                <p className="mt-1 text-xs text-on-surface-variant">Compare curated hotels with transparent nightly tax and full-stay pricing.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">City</span>
                  <select value={hotelCity} onChange={(e) => setHotelCity(e.target.value)} className="mt-2 w-full bg-transparent text-base font-bold text-white outline-none">
                    {['Delhi', 'Mumbai', 'Bangalore', 'Kolkata', 'Hyderabad', 'Chennai'].map((city) => <option key={city} value={city} className="bg-surface-container text-white">{city}</option>)}
                  </select>
                </label>
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Nights</span>
                  <input type="number" min="1" max="14" value={hotelNights} onChange={(e) => setHotelNights(Math.min(14, Math.max(1, Number(e.target.value) || 1)))} className="mt-2 w-full bg-transparent text-base font-bold text-white outline-none" />
                </label>
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Max price / night</span>
                  <div className="mt-1 flex items-center gap-2"><span className="text-primary">₹</span><input type="number" min="1" value={hotelMaxPrice} onChange={(e) => setHotelMaxPrice(e.target.value)} placeholder="Any budget" className="w-full bg-transparent text-base font-bold text-white outline-none placeholder:text-on-surface-variant/60" /></div>
                </label>
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Star rating</span>
                  <select value={hotelStars} onChange={(e) => setHotelStars(e.target.value)} className="mt-2 w-full bg-transparent text-base font-bold text-white outline-none">
                    <option value="" className="bg-surface-container">Any</option><option value="5" className="bg-surface-container">5★</option><option value="4" className="bg-surface-container">4★</option><option value="3" className="bg-surface-container">3★</option>
                  </select>
                </label>
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Minimum guest rating</span>
                  <select value={hotelMinRating} onChange={(e) => setHotelMinRating(e.target.value)} className="mt-2 w-full bg-transparent text-base font-bold text-white outline-none">
                    <option value="" className="bg-surface-container">Any</option><option value="4" className="bg-surface-container">4.0+</option><option value="4.5" className="bg-surface-container">4.5+</option>
                  </select>
                </label>
                <label className="rounded-xl border border-surface-container-highest/60 bg-surface-container p-3.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Sort by</span>
                  <select value={hotelSort} onChange={(e) => setHotelSort(e.target.value)} className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none">
                    <option value="recommended" className="bg-surface-container">Recommended</option><option value="price_asc" className="bg-surface-container">Price: Low to High</option><option value="price_desc" className="bg-surface-container">Price: High to Low</option><option value="rating_desc" className="bg-surface-container">Top Rated</option>
                  </select>
                </label>
              </div>
              {hotelError && <p className="rounded-lg border border-error/40 bg-error-container/30 px-3 py-2 text-xs text-error">{hotelError}</p>}
              <div className="flex flex-col gap-3 border-t border-surface-container-highest pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-on-surface-variant">Indicative inventory · tax shown as listed or estimated</p>
                <button type="submit" disabled={hotelLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3 font-headline text-sm font-bold text-on-primary shadow-lg transition hover:bg-emerald-400 disabled:opacity-60">
                  <span className="material-symbols-outlined text-lg">{hotelLoading ? 'progress_activity' : 'hotel'}</span>
                  {hotelLoading ? 'Searching stays…' : 'Search Hotels'}
                </button>
              </div>
            </div>
          )}
        </form>

        {searchMode === 'hotels' && hotelResults && (
          <section aria-live="polite" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="font-headline text-xl font-bold text-white">Stays in {hotelCity}</h2><p className="mt-1 text-xs text-on-surface-variant">{hotelResults.total} matches · {hotelNights} {hotelNights === 1 ? 'night' : 'nights'}</p></div>
              {hotelResults.total > 0 && <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">Value-ranked · taxes disclosed</span>}
            </div>
            {hotelResults.hotels.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {hotelResults.hotels.map((hotel) => <HotelResultCard key={hotel.hotel_id} hotel={hotel} onPlan={(item) => handleOpenAgent(`Help me plan a trip with ${item.hotel_name} in ${item.city} for ${hotelNights} ${hotelNights === 1 ? 'night' : 'nights'}. The indicative stay total is ₹${Math.round(item.stay_total_inr).toLocaleString('en-IN')}; compare it with flight options and my overall budget. Do not place a hotel booking.`)} />)}
              </div>
            ) : (
              <div className="rounded-xl border border-surface-container-highest bg-surface-container p-8 text-center text-sm text-on-surface-variant">No stays match those filters. Try raising the nightly budget or lowering the rating filter.</div>
            )}
          </section>
        )}

        {/* Glowing AI Agent Spotlight Card */}
        <div className="w-full rounded-2xl p-6 sm:p-8 bg-surface-container-high border border-secondary/30 relative overflow-hidden shadow-[0_0_40px_rgba(99,102,241,0.12)]">
          <div className="absolute -top-24 -right-24 w-80 h-80 bg-secondary-container/30 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-tertiary-container/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold uppercase tracking-wider mb-3">
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                <span>SkyAgent Autonomous Concierge</span>
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
              </div>
              <h2 className="font-headline font-bold text-2xl sm:text-3xl text-white tracking-tight">
                Talk with SkyAgent —{' '}
                <span className="bg-gradient-to-r from-secondary to-tertiary-container bg-clip-text text-transparent">
                  AI Travel Concierge
                </span>
              </h2>
              <p className="mt-2 text-sm sm:text-base text-on-surface-variant leading-relaxed">
                Set a hard ₹ budget cap, ask in plain English, and watch SkyAgent search, rank,
                verify live seats, and generate Razorpay checkout in real time.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setAgentPrompt(prompt)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-surface-container border border-surface-container-highest text-on-surface-variant hover:text-white hover:border-secondary/50 hover:bg-surface-container-highest transition-all flex items-center gap-1.5"
                  >
                    <span className="text-tertiary">✦</span>
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="w-full lg:w-[460px] bg-surface-container-lowest/85 border border-secondary/25 backdrop-blur-md rounded-xl p-4 shadow-xl flex flex-col gap-3">
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs font-mono font-medium text-on-surface">
                    Agent Status: Ready
                  </span>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-container text-tertiary">
                  Hard Budget Guard Enabled
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleOpenAgent(agentPrompt);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  placeholder="E.g., Morning DEL to BOM under ₹6,000..."
                  className="flex-1 bg-surface-container border border-surface-container-highest text-xs sm:text-sm text-white placeholder-on-surface-variant/60 rounded-lg px-3.5 py-3 focus:outline-none focus:ring-2 focus:ring-secondary/60"
                />
                <button
                  type="submit"
                  disabled={agentLoading}
                  className="px-4 py-3 rounded-lg bg-secondary-container hover:bg-indigo-600 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 shrink-0 disabled:opacity-60"
                >
                  <span>{agentLoading ? 'Starting...' : 'Ask'}</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              </form>

              <button
                type="button"
                onClick={() => handleOpenAgent('')}
                disabled={agentLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-headline font-bold text-xs tracking-wide shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                <span>Open Full SkyAgent Split-View</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Live Metro Route Fares Strip */}
      <section className="max-w-7xl mx-auto px-6 lg:px-12 w-full pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary font-label">
              <span className="material-symbols-outlined text-sm">trending_down</span>
              <span>Live Catalog Pricing</span>
            </div>
            <h3 className="font-headline font-bold text-2xl text-white tracking-tight mt-1">
              Popular Metro Routes ({formatDisplayDate(dateRange.defaultDate)})
            </h3>
          </div>
          <span className="text-xs text-on-surface-variant">
            Click any route to view live seats &amp; fares
          </span>
        </div>

        {routesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="h-36 rounded-xl bg-surface-container border border-surface-container-highest/50 animate-pulse"
              />
            ))}
          </div>
        ) : featuredRoutes.length === 0 ? (
          <div className="rounded-xl bg-surface-container p-6 text-center text-xs text-on-surface-variant border border-surface-container-highest">
            Start the FastAPI backend on <span className="font-mono text-primary">localhost:8000</span>{' '}
            to load live metro route fares.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredRoutes.map((route) => {
              const f = route.cheapest;
              return (
                <button
                  key={`${route.src}-${route.dst}`}
                  type="button"
                  onClick={() => handleFeaturedClick(route)}
                  className="text-left bg-surface-container border border-surface-container-highest/60 rounded-xl p-5 hover:bg-surface-container-high hover:border-primary/40 transition-all group shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-container-highest text-primary font-mono">
                        {getAirlineDisplay(f.airline)} {f.flight_code}
                      </span>
                      <span className="text-xs text-on-surface-variant font-mono">
                        {f.stops_count === 0 ? 'Non-stop' : `${f.stops_count} Stop`} •{' '}
                        {formatDuration(f.duration_hrs)}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <p className="font-headline font-bold text-lg text-white">
                          {route.src} ({getCityCode(route.src)})
                        </p>
                        <p className="text-xs text-on-surface-variant font-mono">{f.dep_clock}</p>
                      </div>
                      <span className="material-symbols-outlined text-sm text-primary group-hover:translate-x-1 transition-transform">
                        east
                      </span>
                      <div className="text-right">
                        <p className="font-headline font-bold text-lg text-white">
                          {route.dst} ({getCityCode(route.dst)})
                        </p>
                        <p className="text-xs text-on-surface-variant font-mono">{f.arr_clock}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-surface-container-highest/50 flex items-center justify-between">
                    <span className="text-xs text-on-surface-variant">
                      {f.live_seats_left} seats left
                    </span>
                    <div>
                      <span className="text-xs text-on-surface-variant">from </span>
                      <span className="font-headline font-bold text-lg text-primary font-mono">
                        {formatINR(f.price)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
