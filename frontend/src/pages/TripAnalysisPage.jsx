import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getMyTripsAnalytics } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CHART_COLORS = ['#4edea3', '#a58bfa', '#60a5fa', '#fbbf24', '#fb7185', '#2dd4bf', '#c084fc'];
const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="rounded-xl border border-white/10 bg-[#0b1326]/95 px-3.5 py-3 shadow-2xl backdrop-blur-xl">
    <p className="text-xs font-semibold text-white">{point.route || label}</p>
    {point.date && <p className="mt-1 text-[10px] text-slate-400">{point.date}</p>}
    <p className="mt-1.5 text-sm font-bold text-emerald-300">{inr(point.spend_inr ?? point.total_spend_inr)}</p>
    {point.trips_count != null && <p className="mt-1 text-[10px] text-slate-400">{point.trips_count} {point.trips_count === 1 ? 'trip' : 'trips'}</p>}
  </div>;
}

function KpiCard({ icon, label, value, detail, accent = 'text-primary' }) {
  return <article className="rounded-2xl border border-white/10 bg-slate-900/65 p-5 shadow-lg backdrop-blur-xl">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-3 text-2xl font-bold tracking-tight text-white">{value}</p></div><span className={`material-symbols-outlined rounded-xl bg-white/5 p-2.5 ${accent}`}>{icon}</span></div>
    {detail && <p className="mt-3 truncate text-xs text-slate-400">{detail}</p>}
  </article>;
}

function SectionCard({ title, subtitle, children, className = '' }) {
  return <section className={`rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-6 shadow-xl backdrop-blur-xl ${className}`}>
    <div className="mb-5"><h2 className="font-headline text-base font-bold text-white">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}</div>
    {children}
  </section>;
}

export default function TripAnalysisPage() {
  const { user, setLoginOpen } = useAuth();
  const [scope, setScope] = useState('confirmed');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCity, setSelectedCity] = useState(null);

  useEffect(() => {
    if (!user) { setData(null); return undefined; }
    let active = true;
    setLoading(true); setError('');
    getMyTripsAnalytics(scope)
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message || 'Could not load your trip analysis.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [user, scope]);

  if (!user) return <div className="mx-auto flex w-full max-w-3xl flex-1 items-center px-5 py-16">
    <section className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-[#111a30] to-indigo-950/70 p-8 text-center shadow-2xl sm:p-12">
      <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
      <span className="material-symbols-outlined relative text-5xl text-primary">travel_explore</span>
      <p className="relative mt-4 text-xs font-bold uppercase tracking-[0.22em] text-primary">Personal travel insights</p>
      <h1 className="relative mt-2 text-3xl font-headline font-bold text-white">My Trips Analysis</h1>
      <p className="relative mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">Sign in with Google to see your personal flight spending, favourite routes, and travel footprint.</p>
      <button type="button" onClick={() => setLoginOpen(true)} className="relative mt-7 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-[#062317] shadow-lg shadow-emerald-400/15 transition hover:bg-emerald-300">Sign In with Google</button>
    </section>
  </div>;

  if (loading && !data) return <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-12"><div className="h-10 w-64 animate-pulse rounded bg-slate-800" /><div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <div key={key} className="h-36 animate-pulse rounded-2xl bg-slate-900" />)}</div></div>;

  const summary = data?.summary;
  const chartData = data?.trip_spend_series?.length ? data.trip_spend_series : data?.spending_timeline || [];
  const perTripView = Boolean(data?.trip_spend_series?.length);

  return <main className="relative mx-auto w-full max-w-7xl flex-1 space-y-7 px-4 py-8 sm:px-6 lg:px-12">
    <div className="pointer-events-none absolute -top-12 right-1/4 h-80 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
    <header className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Your travel footprint</p><h1 className="mt-2 text-3xl font-headline font-bold tracking-tight text-white">My Trips Analysis</h1><p className="mt-1 text-sm text-slate-400">Your personal flight spending &amp; travel footprint</p></div>
      <div className="inline-flex w-fit rounded-xl border border-white/10 bg-slate-900/80 p-1 shadow-lg" role="group" aria-label="Booking scope">
        {[['confirmed', 'Confirmed Trips'], ['all', 'All Bookings']].map(([value, label]) => <button key={value} type="button" onClick={() => setScope(value)} className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${scope === value ? 'bg-primary text-[#062317] shadow' : 'text-slate-400 hover:text-white'}`}>{label}</button>)}
      </div>
    </header>

    {error && <div role="alert" className="relative rounded-xl border border-rose-300/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
    {summary && summary.total_trips === 0 ? <section className="relative rounded-3xl border border-white/10 bg-slate-900/60 px-6 py-14 text-center shadow-xl backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-400/10 text-indigo-200"><span className="material-symbols-outlined text-4xl">flight_takeoff</span></div>
      <h2 className="mt-5 text-xl font-bold text-white">Your travel story starts here</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Once you have a confirmed booking, your trips and spending insights will appear here.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-[#062317] hover:bg-emerald-300">Search Flights</Link><Link to="/agent" className="rounded-xl border border-indigo-300/20 bg-indigo-400/10 px-4 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-indigo-400/20">Talk to SkyAgent</Link></div>
    </section> : summary && <>
      <section className="relative grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="payments" label="Total Ticket Spend" value={inr(summary.total_spend_inr)} detail={`${summary.total_trips} ${summary.total_trips === 1 ? 'trip' : 'trips'} · ${scope === 'all' ? 'all non-cancelled bookings' : 'confirmed bookings'}`} />
        <KpiCard icon="luggage" label="Total Trips" value={summary.total_trips.toLocaleString('en-IN')} detail={summary.favourite_airline ? `Favourite airline · ${summary.favourite_airline.airline}` : 'Your booked journeys'} accent="text-indigo-300" />
        <KpiCard icon="location_city" label="Cities Explored" value={summary.unique_destinations_count.toLocaleString('en-IN')} detail={summary.most_visited_destination ? `Top destination · ${summary.most_visited_destination.city}` : 'Unique destinations visited'} accent="text-sky-300" />
        <KpiCard icon="confirmation_number" label="Average Ticket Fare" value={inr(summary.avg_ticket_price_inr)} detail="Average spend per passenger ticket" accent="text-amber-300" />
      </section>

      <SectionCard title="Ticket Spending Overview" subtitle={perTripView ? 'Individual trip spend · all bookings are within one travel month' : 'Monthly ticket spend by travel date'}>
        {chartData.length ? <div className="h-[300px] w-full sm:h-[340px]">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 12, right: 10, left: 4, bottom: 2 }}>
            <defs><linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4edea3" stopOpacity={0.35} /><stop offset="95%" stopColor="#4edea3" stopOpacity={0.01} /></linearGradient></defs>
            <CartesianGrid stroke="#ffffff12" strokeDasharray="4 5" vertical={false} /><XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} /><YAxis tickFormatter={(value) => `₹${Number(value).toLocaleString('en-IN')}`} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} width={70} /><Tooltip content={<ChartTooltip />} cursor={{ stroke: '#4edea355', strokeDasharray: '4 4' }} />
            <Area type="monotone" dataKey="spend_inr" stroke="#4edea3" strokeWidth={3} fill="url(#spendGradient)" activeDot={{ r: 5, fill: '#4edea3', stroke: '#0b1326', strokeWidth: 2 }} />
          </AreaChart></ResponsiveContainer>
        </div> : <p className="py-10 text-center text-sm text-slate-400">No spending dates available.</p>}
      </SectionCard>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard title="Destinations Visited" subtitle="Total ticket spend by city · hover for trip count"><div className="h-[300px] w-full">
          {data.destinations_breakdown.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.destinations_breakdown} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
            <CartesianGrid stroke="#ffffff12" strokeDasharray="4 5" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `₹${Number(value).toLocaleString('en-IN')}`} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="city" width={90} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} cursor={{ fill: '#ffffff08' }} /><Bar dataKey="total_spend_inr" name="Spend" fill="#818cf8" radius={[0, 6, 6, 0]} barSize={18} />
          </BarChart></ResponsiveContainer> : <p className="py-10 text-center text-sm text-slate-400">No destinations yet.</p>}
        </div></SectionCard>
        <SectionCard title="Travel Footprint" subtitle="Cities you have reached and your favourite routes">
          <div className="flex flex-wrap gap-2">{data.destinations_breakdown.map((item) => <button key={item.city} type="button" aria-pressed={selectedCity === item.city} onClick={() => setSelectedCity((current) => current === item.city ? null : item.city)} className={`rounded-full border px-3 py-1.5 text-xs transition ${selectedCity === item.city ? 'border-emerald-300/40 bg-emerald-400/20 text-white' : 'border-emerald-300/15 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15'}`}>{item.city}<span className="ml-1.5 text-emerald-300">· {item.trips_count} {item.trips_count === 1 ? 'trip' : 'trips'}</span></button>)}</div>
          <div className="mt-6 border-t border-white/10 pt-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Top Routes</h3><span className="text-[10px] text-slate-500">Trips · spend</span></div>
            {data.top_routes.length ? <div className="space-y-2.5">{data.top_routes.filter((route) => !selectedCity || route.destination === selectedCity).slice(0, 5).map((route) => <div key={route.route} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3.5 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{route.origin} <span className="text-primary">→</span> {route.destination}</p><p className="mt-0.5 text-[10px] text-slate-500">{route.trips_count} {route.trips_count === 1 ? 'trip' : 'trips'}</p></div><span className="shrink-0 text-xs font-semibold text-emerald-300">{inr(route.total_spend_inr)}</span></div>)}</div> : <p className="text-xs text-slate-500">Your routes will show here.</p>}
          </div>
        </SectionCard>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Airline Spend Breakdown" subtitle="Share of your total ticket spend by airline">
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)]">
            <div className="h-[260px] w-full">{data.airline_breakdown.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Tooltip content={<ChartTooltip />} /><Pie data={data.airline_breakdown} dataKey="total_spend_inr" nameKey="airline" innerRadius={63} outerRadius={94} paddingAngle={3} stroke="none">{data.airline_breakdown.map((entry, index) => <Cell key={entry.airline} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie></PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-slate-500">No airline data.</div>}</div>
            <div className="space-y-3">{data.airline_breakdown.slice(0, 6).map((airline, index) => <div key={airline.airline} className="flex items-center justify-between gap-3 text-xs"><span className="flex min-w-0 items-center gap-2 text-slate-300"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="truncate">{airline.airline}</span></span><span className="shrink-0 font-mono text-slate-400">{airline.share_pct}%</span></div>)}</div>
          </div>
        </SectionCard>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <SectionCard title="Cabin Breakdown" subtitle="Spend by flight class"><div className="space-y-3">{data.class_breakdown.length ? data.class_breakdown.map((item) => <div key={item.flight_class} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3"><div><p className="text-sm font-semibold text-white">{item.flight_class}</p><p className="mt-0.5 text-[10px] text-slate-500">{item.trips_count} {item.trips_count === 1 ? 'trip' : 'trips'}</p></div><p className="text-sm font-bold text-indigo-200">{inr(item.total_spend_inr)}</p></div>) : <p className="text-xs text-slate-500">No cabin data yet.</p>}</div></SectionCard>
          <SectionCard title="Ticket Fare Range" subtitle="Per-passenger ticket fares"><div className="grid grid-cols-2 gap-3"><div className="rounded-2xl border border-rose-300/10 bg-rose-400/[0.06] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Highest</p><p className="mt-2 text-lg font-bold text-rose-200">{summary.highest_fare_inr == null ? '—' : inr(summary.highest_fare_inr)}</p></div><div className="rounded-2xl border border-emerald-300/10 bg-emerald-400/[0.06] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lowest</p><p className="mt-2 text-lg font-bold text-emerald-200">{summary.lowest_fare_inr == null ? '—' : inr(summary.lowest_fare_inr)}</p></div></div></SectionCard>
        </div>
      </section>
    </>}
  </main>;
}
