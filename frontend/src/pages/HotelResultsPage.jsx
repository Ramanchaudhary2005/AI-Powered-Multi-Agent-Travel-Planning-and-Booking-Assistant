import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createAgentSession, searchHotels } from '../api/client';
import HotelResultCard from '../components/HotelResultCard';

const CITIES = ['Delhi', 'Mumbai', 'Bangalore', 'Kolkata', 'Hyderabad', 'Chennai'];
const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating_desc', label: 'Top Rated' },
];
const DEFAULTS = { city: 'Delhi', nights: '1', max_price: '', star_rating: '', min_rating: '', locality: '', sort_by: 'recommended', check_in: '' };
const HOTEL_SORTS = new Set(SORTS.map((item) => item.value));

function fromParams(params) {
  const city = CITIES.includes(params.get('city')) ? params.get('city') : DEFAULTS.city;
  const nights = Math.min(14, Math.max(1, Number(params.get('nights') || DEFAULTS.nights) || 1));
  const stars = ['3', '4', '5'].includes(params.get('star_rating')) ? params.get('star_rating') : '';
  const rating = ['4', '4.5'].includes(params.get('min_rating')) ? params.get('min_rating') : '';
  const sort = HOTEL_SORTS.has(params.get('sort_by')) ? params.get('sort_by') : DEFAULTS.sort_by;
  return {
    city, nights: String(nights), max_price: params.get('max_price') || '', star_rating: stars,
    min_rating: rating, locality: params.get('locality') || '', sort_by: sort,
    check_in: params.get('check_in') || '',
  };
}

function SkeletonCards() {
  return <div className="flex w-full min-w-0 flex-col gap-4">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex min-h-64 w-full animate-pulse flex-col overflow-hidden rounded-2xl border border-surface-container-highest bg-surface-container-low md:flex-row"><div className="min-w-0 flex-1 p-5"><div className="h-5 w-2/3 rounded bg-surface-container-high"/><div className="mt-4 h-3 w-1/2 rounded bg-surface-container-high"/><div className="mt-8 h-3 w-3/4 rounded bg-surface-container-high"/><div className="mt-8 h-12 w-full rounded bg-surface-container-high"/></div><div className="h-52 w-full border-t border-surface-container-highest p-5 md:h-auto md:w-[230px] md:border-l md:border-t-0"><div className="h-8 rounded bg-surface-container-high"/><div className="mt-6 h-10 rounded bg-surface-container-high"/><div className="mt-3 h-10 rounded bg-surface-container-high"/></div></div>)}</div>;
}

export default function HotelResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryString = searchParams.toString();
  const [filters, setFilters] = useState(() => fromParams(new URLSearchParams(queryString)));
  const [response, setResponse] = useState({ hotels: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);

  useEffect(() => {
    setFilters(fromParams(new URLSearchParams(queryString)));
  }, [queryString]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      const apiParams = {
        city: filters.city,
        nights: filters.nights,
        max_price: filters.max_price || undefined,
        star_rating: filters.star_rating || undefined,
        min_rating: filters.min_rating || undefined,
        locality: filters.locality.trim() || undefined,
        sort_by: filters.sort_by,
        limit: 30,
      };
      searchHotels(apiParams, { signal: controller.signal })
        .then((data) => setResponse({ hotels: data.hotels || [], total: Number(data.total || 0) }))
        .catch((err) => {
          if (err.name === 'AbortError') return;
          setError(err.message || 'Could not load hotel results.');
          setResponse({ hotels: [], total: 0 });
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters.city, filters.nights, filters.max_price, filters.star_rating, filters.min_rating, filters.locality, filters.sort_by]);

  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: String(value) }));
    const params = new URLSearchParams(searchParams);
    const normalized = String(value).trim();
    if (!normalized || (key === 'nights' && normalized === '1') || (key === 'sort_by' && normalized === 'recommended')) params.delete(key);
    else params.set(key, normalized);
    setSearchParams(params, { replace: ['locality', 'max_price', 'nights'].includes(key) });
  }, [searchParams, setSearchParams]);

  const activeFilters = useMemo(() => [
    filters.max_price && `Up to ₹${Number(filters.max_price).toLocaleString('en-IN')} / night`,
    filters.star_rating && `${filters.star_rating}★ hotels`,
    filters.min_rating && `${filters.min_rating}+ guest rating`,
    filters.locality.trim() && `“${filters.locality.trim()}”`,
  ].filter(Boolean), [filters.max_price, filters.star_rating, filters.min_rating, filters.locality]);

  const resetFilters = () => {
    const reset = { ...DEFAULTS, city: filters.city, nights: filters.nights, check_in: filters.check_in };
    setFilters(reset);
    const params = new URLSearchParams();
    params.set('city', reset.city);
    if (reset.nights !== '1') params.set('nights', reset.nights);
    if (reset.check_in) params.set('check_in', reset.check_in);
    setSearchParams(params, { replace: true });
  };

  const openAgent = async (hotel) => {
    const prompt = `Help me plan a trip with ${hotel.hotel_name} in ${hotel.city} for ${filters.nights} ${Number(filters.nights) === 1 ? 'night' : 'nights'}. The listed stay total is ₹${Math.round(hotel.stay_total_inr || 0).toLocaleString('en-IN')}; compare it with flight options and my overall budget.`;
    try {
      const session = await createAgentSession(null);
      navigate(`/agent/${session.session_id}`, { state: { initialPrompt: prompt } });
    } catch {
      navigate('/agent', { state: { initialPrompt: prompt } });
    }
  };

  const selectClass = 'w-full rounded-xl border border-surface-container-highest bg-surface-container-low px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-primary/50';
  const fieldLabel = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[.15em] text-on-surface-variant';

  return (
    <main className="relative mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-12">
      <div className="pointer-events-none absolute left-1/4 top-28 -z-10 h-96 w-96 rounded-full bg-primary-container/10 blur-3xl" />
      <div className="pointer-events-none absolute right-8 top-72 -z-10 h-80 w-80 rounded-full bg-secondary-container/15 blur-3xl" />

      <section className="mb-5 rounded-2xl border border-surface-container-highest bg-surface-container-low p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-surface-container px-3 py-2">
              <span className="material-symbols-outlined text-primary">hotel</span>
              <span className="font-headline text-sm font-bold text-white">{filters.city}</span>
              <span className="text-xs text-on-surface-variant">· {filters.nights} {Number(filters.nights) === 1 ? 'night' : 'nights'}</span>
            </div>
            {filters.check_in && <span className="flex items-center gap-1.5 text-xs text-on-surface-variant"><span className="material-symbols-outlined text-sm">calendar_month</span>Check-in {filters.check_in}</span>}
            <button type="button" onClick={() => setModifyOpen((open) => !open)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold text-primary transition hover:bg-surface-container"><span className="material-symbols-outlined text-sm">edit</span>{modifyOpen ? 'Close' : 'Modify search'}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 xl:w-[610px]">
            <label><span className={fieldLabel}>City</span><select value={filters.city} onChange={(e) => updateFilter('city', e.target.value)} className={selectClass}>{CITIES.map((city) => <option key={city}>{city}</option>)}</select></label>
            <label><span className={fieldLabel}>Nights</span><select value={filters.nights} onChange={(e) => updateFilter('nights', e.target.value)} className={selectClass}>{Array.from({ length: 14 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n} {n === '1' ? 'night' : 'nights'}</option>)}</select></label>
            <label><span className={fieldLabel}>Sort</span><select value={filters.sort_by} onChange={(e) => updateFilter('sort_by', e.target.value)} className={selectClass}>{SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}</select></label>
          </div>
        </div>
        {modifyOpen && <div className="mt-4 grid gap-3 border-t border-surface-container-highest pt-4 sm:grid-cols-[1fr_auto] sm:items-end"><label><span className={fieldLabel}>Optional check-in date</span><input type="date" value={filters.check_in} onChange={(e) => updateFilter('check_in', e.target.value)} className={`${selectClass} [color-scheme:dark]`} /></label><button type="button" onClick={() => setModifyOpen(false)} className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary">Done</button></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-surface-container-highest pt-3">
          <p className="text-sm font-semibold text-white">{loading ? 'Searching hotels…' : `${response.total} hotels found in ${filters.city}`}</p>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-primary">Value ranked · tax disclosed</span>
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between lg:hidden">
        <button type="button" onClick={() => setFiltersOpen((open) => !open)} className="inline-flex items-center gap-2 rounded-xl border border-surface-container-highest bg-surface-container px-4 py-2.5 text-xs font-bold text-white"><span className="material-symbols-outlined text-base">tune</span>{filtersOpen ? 'Hide filters' : 'Filters'}{activeFilters.length > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] text-on-primary">{activeFilters.length}</span>}</button>
        <span className="text-[11px] text-on-surface-variant">{loading ? 'Updating…' : `${response.total} stays`}</span>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
        <aside className={`${filtersOpen ? 'block' : 'hidden'} h-fit w-full shrink-0 space-y-5 rounded-2xl border border-surface-container-highest bg-surface-container p-5 shadow-lg lg:sticky lg:top-20 lg:block lg:w-[280px]`}>
          <div className="flex items-center justify-between"><h2 className="font-headline text-base font-bold text-white">Filters</h2><button type="button" onClick={resetFilters} className="text-[10px] font-bold text-primary hover:text-emerald-300">Reset Filters</button></div>
          <label className="block"><span className={fieldLabel}>City</span><select value={filters.city} onChange={(e) => updateFilter('city', e.target.value)} className={selectClass}>{CITIES.map((city) => <option key={city}>{city}</option>)}</select></label>
          <label className="block"><span className={fieldLabel}>Nights</span><select value={filters.nights} onChange={(e) => updateFilter('nights', e.target.value)} className={selectClass}>{Array.from({ length: 14 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n} {n === '1' ? 'night' : 'nights'}</option>)}</select></label>
          <label className="block"><span className={fieldLabel}>Max price / night</span><span className="flex items-center gap-2 rounded-xl border border-surface-container-highest bg-surface-container-low px-3"><span className="text-sm font-bold text-primary">₹</span><input type="number" min="1" inputMode="numeric" placeholder="Any price" value={filters.max_price} onChange={(e) => updateFilter('max_price', e.target.value)} className="w-full bg-transparent py-2.5 text-sm font-semibold text-white outline-none placeholder:text-on-surface-variant/60" /></span></label>
          <label className="block"><span className={fieldLabel}>Star rating</span><select value={filters.star_rating} onChange={(e) => updateFilter('star_rating', e.target.value)} className={selectClass}><option value="">Any stars</option><option value="5">5★</option><option value="4">4★</option><option value="3">3★</option></select></label>
          <label className="block"><span className={fieldLabel}>Minimum guest rating</span><select value={filters.min_rating} onChange={(e) => updateFilter('min_rating', e.target.value)} className={selectClass}><option value="">Any rating</option><option value="4">4.0+</option><option value="4.5">4.5+</option></select></label>
          <label className="block"><span className={fieldLabel}>Locality</span><input type="search" value={filters.locality} onChange={(e) => updateFilter('locality', e.target.value)} placeholder="Area, hotel or landmark" className={selectClass} /></label>
          <div className="border-t border-surface-container-highest pt-4"><p className={fieldLabel}>Active filters</p>{activeFilters.length ? <div className="flex flex-wrap gap-1.5">{activeFilters.map((filter) => <span key={filter} className="rounded-full border border-secondary/20 bg-secondary-container/30 px-2.5 py-1 text-[10px] text-secondary">{filter}</span>)}</div> : <p className="text-xs text-on-surface-variant">No additional filters applied</p>}</div>
          {filters.check_in && <p className="text-[10px] text-on-surface-variant">Check-in date: {filters.check_in}</p>}
        </aside>

        <section className="w-full min-w-0 flex-1 space-y-4" aria-live="polite">
          {loading ? <SkeletonCards /> : error ? <div role="alert" className="w-full min-w-0 rounded-2xl border border-error/30 bg-error-container/20 p-6 text-sm text-error">{error}</div> : response.hotels.length ? <div className="flex w-full min-w-0 flex-col gap-4">{response.hotels.map((hotel) => <HotelResultCard key={`${hotel.hotel_id}-${filters.nights}`} hotel={hotel} onBook={(item) => navigate('/hotel-checkout', { state: { hotel: item, nights: Number(filters.nights), checkInDate: filters.check_in || undefined } })} onPlan={openAgent} />)}</div> : <div className="w-full min-w-0 rounded-2xl border border-surface-container-highest bg-surface-container-low p-9 text-center shadow-lg"><span className="material-symbols-outlined text-4xl text-on-surface-variant">hotel</span><h2 className="mt-3 font-headline text-xl font-bold text-white">No hotels match these filters</h2><p className="mx-auto mt-2 max-w-md text-sm text-on-surface-variant">Try clearing a filter or increasing your nightly budget to see more stays in {filters.city}.</p><button type="button" onClick={resetFilters} className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary">Reset Filters</button></div>}
        </section>
      </div>
    </main>
  );
}
