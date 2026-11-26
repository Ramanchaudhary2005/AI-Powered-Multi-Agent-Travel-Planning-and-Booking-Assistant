import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getFlightMeta, getMarketTrends, predictFare } from '../api/client';
import { formatINR } from '../utils/flightUtils';

const CITIES = ['Delhi','Mumbai','Bangalore','Kolkata','Hyderabad','Chennai'];
const HOTEL_CITIES = CITIES;
const COLORS = ['#34d399','#818cf8','#fbbf24','#f472b6','#22d3ee','#a78bfa'];
const money = (value) => value == null ? '—' : formatINR(value);

function ChartCard({ title, subtitle, children, className = '' }) {
  return <section className={`rounded-2xl border border-surface-container-highest bg-surface-container/90 p-5 shadow-lg ${className}`}><div className="mb-4"><h2 className="font-headline text-base font-bold text-white">{title}</h2>{subtitle && <p className="mt-1 text-xs text-on-surface-variant">{subtitle}</p>}</div>{children}</section>;
}

function EmptyChart({ text = 'No matching trend data.' }) { return <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-surface-container-highest text-sm text-on-surface-variant">{text}</div>; }

function CurrencyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-surface-container-highest bg-[#101827] p-3 text-xs shadow-xl"><p className="mb-2 font-semibold text-white">{label}</p>{payload.map((item) => <p key={item.dataKey} style={{ color: item.color }} className="mt-1">{item.name || item.dataKey}: {money(item.value)}</p>)}</div>;
}

export default function MarketInsightsPage() {
  const [meta, setMeta] = useState(null);
  const [source, setSource] = useState('Delhi');
  const [destination, setDestination] = useState('Mumbai');
  const [flightClass, setFlightClass] = useState('Economy');
  const [hotelCity, setHotelCity] = useState('Mumbai');
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [airline, setAirline] = useState('');
  const [daysLeft, setDaysLeft] = useState(7);
  const [currentPrice, setCurrentPrice] = useState(7000);
  const [advisor, setAdvisor] = useState(null);
  const [advisorBusy, setAdvisorBusy] = useState(false);

  useEffect(() => { getFlightMeta().then(setMeta).catch(() => setMeta({ cities: CITIES, classes: ['Economy','Business'] })); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setAdvisor(null);
    getMarketTrends({ source_city: source, destination_city: destination, flight_class: flightClass, hotel_city: hotelCity })
      .then((result) => { if (alive) { setTrends(result); const firstAirline = result.airline_comparison?.[0]; if (firstAirline) { setAirline((current) => result.airline_comparison.some((item) => item.airline === current) ? current : firstAirline.airline); setCurrentPrice((current) => current === 7000 ? firstAirline.avg_price_inr : current); } } })
      .catch((err) => { if (alive) setError(err.message || 'Market insights could not be loaded.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, destination, flightClass, hotelCity]);

  const advisorAirline = useMemo(() => trends?.airline_comparison?.find((item) => item.airline === airline), [trends, airline]);
  const checkFare = async () => {
    setAdvisorBusy(true); setAdvisor(null); setError('');
    try {
      const result = await predictFare({ source_city: source, destination_city: destination, airline: airline || advisorAirline?.airline || 'IndiGo', flight_class: flightClass, days_left: Number(daysLeft), current_price: Number(currentPrice), stops_count: 0, duration_hrs: advisorAirline?.avg_duration_hrs || 2.2 });
      setAdvisor(result);
    } catch (err) { setError(err.message || 'Fare estimate is unavailable.'); }
    finally { setAdvisorBusy(false); }
  };

  const summary = trends?.ml_summary;
  const quality = trends?.data_quality;
  const flightsQuality = quality?.flights || {};
  const hotelsQuality = quality?.hotels || {};
  const metrics = summary?.metrics || {};
  const bestWindow = trends?.optimal_booking_window;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 lg:px-10">
      <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-primary">Market intelligence</p><h1 className="mt-1 font-headline text-3xl font-bold text-white">Fare & Hotel Insights</h1><p className="mt-2 text-sm text-on-surface-variant">Market-wide price patterns and model guidance. Kept separate from your personal trip history.</p></div><span className="w-fit rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1.5 text-[11px] font-semibold text-indigo-200">ML + curated inventory</span></header>

      <section className="mb-5 grid gap-3 rounded-2xl border border-surface-container-highest bg-surface-container/90 p-4 shadow-lg sm:grid-cols-2 lg:grid-cols-4">
        {[['Origin',source,setSource],['Destination',destination,setDestination],['Cabin Class',flightClass,setFlightClass],['Hotel City',hotelCity,setHotelCity]].map(([label,value,setter],i) => <label key={label} className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{label}<select value={value} onChange={(e) => setter(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-surface-container-highest bg-surface-container-low px-3 py-2.5 text-sm font-semibold normal-case text-white">{(i === 2 ? (meta?.classes || ['Economy','Business']) : i === 3 ? HOTEL_CITIES : (meta?.cities || CITIES)).map((option) => <option key={option}>{option}</option>)}</select></label>)}
      </section>

      <section className="mb-5 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-r from-emerald-500/10 via-surface-container to-indigo-500/10 p-5 shadow-lg">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-xl"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-primary">ML Fare Advisor</p><h2 className="mt-1 text-xl font-bold text-white">Should you book now or wait?</h2><p className="mt-1 text-xs leading-relaxed text-on-surface-variant">A learned estimate compares this fare with predicted fair value and the next five-day trend.</p></div>
          <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-5"><select value={airline} onChange={(e) => setAirline(e.target.value)} className="rounded-lg border border-surface-container-highest bg-surface-container-low px-3 py-2 text-xs text-white">{(trends?.airline_comparison || []).map((item) => <option key={item.airline}>{item.airline}</option>)}</select><input type="number" min="1" max="49" value={daysLeft} onChange={(e) => setDaysLeft(e.target.value)} aria-label="Days until departure" className="rounded-lg border border-surface-container-highest bg-surface-container-low px-3 py-2 text-xs text-white"/><input type="number" min="1" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} aria-label="Current price in rupees" className="rounded-lg border border-surface-container-highest bg-surface-container-low px-3 py-2 text-xs text-white"/><button type="button" disabled={advisorBusy || !trends?.airline_comparison?.length} onClick={checkFare} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-on-primary disabled:opacity-50">{advisorBusy ? 'Checking…' : 'Check fare'}</button><div className="flex items-center justify-center rounded-lg border border-surface-container-highest bg-surface-container-low px-3 py-2 text-center text-[10px] text-on-surface-variant">Model MAE {money(summary?.mae_inr)}<br/>R² {summary?.r2 ?? '—'}</div></div>
        </div>
        {advisor && <div className={`mt-4 rounded-xl border p-4 ${advisor.signal === 'BOOK_NOW' ? 'border-emerald-300/25 bg-emerald-400/10' : 'border-amber-300/25 bg-amber-400/10'}`}><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-extrabold ${advisor.signal === 'BOOK_NOW' ? 'bg-emerald-300/20 text-emerald-200' : 'bg-amber-300/20 text-amber-200'}`}>{advisor.signal === 'BOOK_NOW' ? 'Book Now' : 'Wait'}</span><strong className="text-sm text-white">Predicted fair fare: {money(advisor.predicted_fair_price_inr)}</strong><span className="text-xs text-on-surface-variant">Confidence {advisor.confidence_pct}%</span><span className="text-xs text-on-surface-variant">5-day expected change {money(advisor.expected_change_inr)}</span></div><p className="mt-2 text-xs text-on-surface-variant">{advisor.reason}</p>{!advisor.model_available && <p className="mt-1 text-[10px] text-amber-200">Model artifact unavailable; this estimate uses a route history fallback.</p>}</div>}
      </section>

      {error && <div role="alert" className="mb-4 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</div>}
      {loading ? <div className="rounded-2xl border border-surface-container-highest bg-surface-container p-12 text-center text-sm text-on-surface-variant">Loading current market trends…</div> : trends && <>
        <div className="grid gap-5 xl:grid-cols-2">
          <ChartCard title="Price vs. Days to Departure" subtitle={`${source} → ${destination} · ${flightClass} · historical average and median fare`}>
            {trends.days_left_curve?.some((point) => point.avg_fare_inr != null) ? <ResponsiveContainer width="100%" height={280}><AreaChart data={trends.days_left_curve}><defs><linearGradient id="fareFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#34d399" stopOpacity={.32}/><stop offset="95%" stopColor="#34d399" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#26334b" strokeDasharray="3 3"/><XAxis dataKey="days_left" reversed tick={{fill:'#94a3b8',fontSize:10}} label={{value:'Days before departure',position:'insideBottom',offset:-4,fill:'#94a3b8',fontSize:10}}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`} tick={{fill:'#94a3b8',fontSize:10}}/><Tooltip content={<CurrencyTooltip/>}/><Area type="monotone" dataKey="avg_fare_inr" name="Average fare" stroke="#34d399" fill="url(#fareFill)" connectNulls/><Line type="monotone" dataKey="median_fare_inr" name="Median fare" stroke="#818cf8" dot={false} connectNulls/></AreaChart></ResponsiveContainer> : <EmptyChart/>}
            {bestWindow && <p className="mt-2 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">Lowest observed average in this route sample: around {bestWindow.days_left} days before departure ({money(bestWindow.avg_fare_inr)}).</p>}
          </ChartCard>
          <ChartCard title="Airline Value Comparison" subtitle="Average ticket price and fare per flight hour">
            {trends.airline_comparison?.length ? <ResponsiveContainer width="100%" height={280}><BarChart data={trends.airline_comparison} margin={{bottom:20}}><CartesianGrid stroke="#26334b" vertical={false}/><XAxis dataKey="airline" angle={-18} textAnchor="end" interval={0} height={52} tick={{fill:'#94a3b8',fontSize:9}}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`} tick={{fill:'#94a3b8',fontSize:10}}/><Tooltip content={<CurrencyTooltip/>}/><Bar dataKey="avg_price_inr" name="Average fare" fill="#818cf8" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer> : <EmptyChart/>}
            {trends.airline_comparison?.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{trends.airline_comparison.slice(0,4).map((item) => <span key={item.airline} className="rounded-lg bg-surface-container-low px-2.5 py-1.5 text-[10px] text-on-surface-variant">{item.airline} · {money(item.fare_per_flight_hour_inr)}/hr</span>)}</div>}
          </ChartCard>
          <ChartCard title="Departure Time Slot Pricing" subtitle="Compare average fare across the day">
            {trends.departure_slot_trends?.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={trends.departure_slot_trends}><CartesianGrid stroke="#26334b" vertical={false}/><XAxis dataKey="departure_time" tickFormatter={(v)=>v.replace('_',' ')} tick={{fill:'#94a3b8',fontSize:9}}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`} tick={{fill:'#94a3b8',fontSize:10}}/><Tooltip content={<CurrencyTooltip/>}/><Bar dataKey="avg_price_inr" name="Average fare" radius={[5,5,0,0]}>{trends.departure_slot_trends.map((entry,index)=><Cell key={entry.departure_time} fill={COLORS[index%COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer> : <EmptyChart/>}
          </ChartCard>
          <ChartCard title="Six-City Hotel Price & Rating Value" subtitle="Average nightly total and price per guest-rating point">
            {trends.hotel_city_overview?.length ? <ResponsiveContainer width="100%" height={260}><BarChart data={trends.hotel_city_overview}><CartesianGrid stroke="#26334b" vertical={false}/><XAxis dataKey="city" tick={{fill:'#94a3b8',fontSize:9}}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`} tick={{fill:'#94a3b8',fontSize:10}}/><Tooltip content={<CurrencyTooltip/>}/><Bar dataKey="avg_price_per_night_inr" name="Avg total/night" fill="#34d399" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer> : <EmptyChart/>}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{trends.hotel_city_overview?.map((item)=> <div key={item.city} className={`rounded-lg border px-2.5 py-2 ${item.city.toLowerCase()===hotelCity.toLowerCase()?'border-primary/30 bg-primary/5':'border-surface-container-highest bg-surface-container-low'}`}><p className="text-[10px] font-bold text-white">{item.city} · {item.avg_rating ?? '—'}★</p><p className="mt-0.5 text-[9px] text-on-surface-variant">{money(item.price_per_rating_point_inr)} / rating point</p></div>)}</div>
            <div className="mt-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{hotelCity} price by hotel star rating</p>{trends.hotel_star_breakdown?.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={trends.hotel_star_breakdown}><CartesianGrid stroke="#26334b" vertical={false}/><XAxis dataKey="star_rating" tickFormatter={(v)=>`${v}★`} tick={{fill:'#94a3b8',fontSize:10}}/><YAxis tickFormatter={(v)=>`₹${Math.round(v/1000)}k`} tick={{fill:'#94a3b8',fontSize:9}}/><Tooltip content={<CurrencyTooltip/>}/><Bar dataKey="avg_price_per_night_inr" name="Average total/night" fill="#fbbf24" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer> : <EmptyChart text="No star breakdown for this city."/>}</div>
          </ChartCard>
        </div>

        <section className="mt-5 rounded-2xl border border-surface-container-highest bg-surface-container/90 p-5 shadow-lg"><div className="mb-4"><p className="text-[10px] font-bold uppercase tracking-[.18em] text-secondary">Transparent evaluation</p><h2 className="mt-1 text-lg font-bold text-white">Model & Data Quality</h2></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-surface-container-highest bg-surface-container-low p-4"><p className="text-xs font-bold text-white">Fare model · {summary?.selected_model_key || 'Not trained'}</p><p className="mt-2 text-xs text-on-surface-variant">MAE {money(summary?.mae_inr)} · RMSE {money(summary?.rmse_inr)}</p><p className="mt-1 text-xs text-on-surface-variant">R² {summary?.r2 ?? '—'}</p></div>
          <div className="rounded-xl border border-surface-container-highest bg-surface-container-low p-4"><p className="text-xs font-bold text-white">Benchmarks · MAE / RMSE</p>{Object.entries(metrics).map(([key,value])=><p key={key} className="mt-1 text-[10px] text-on-surface-variant">{key.replaceAll('_',' ')} · {money(value.mae_inr)} / {money(value.rmse_inr)}</p>)}</div>
          <div className="rounded-xl border border-surface-container-highest bg-surface-container-low p-4"><p className="text-xs font-bold text-white">Recommender NDCG@5</p><p className="mt-2 text-xs text-on-surface-variant">Flight hybrid lift {summary?.flight_ndcg_at_5_lift == null ? '—' : `${summary.flight_ndcg_at_5_lift >= 0 ? '+' : ''}${summary.flight_ndcg_at_5_lift}`}</p><p className="mt-1 text-xs text-on-surface-variant">Hotel hybrid lift {summary?.hotel_ndcg_at_5_lift == null ? '—' : `${summary.hotel_ndcg_at_5_lift >= 0 ? '+' : ''}${summary.hotel_ndcg_at_5_lift}`}</p></div>
          <div className="rounded-xl border border-surface-container-highest bg-surface-container-low p-4"><p className="text-xs font-bold text-white">Curated inventory quality</p><p className="mt-2 text-xs text-on-surface-variant">Flights · {Number(flightsQuality.total_curated_rows || 0).toLocaleString('en-IN')} rows · {flightsQuality.duplicate_rate_pct ?? '—'}% duplicates</p><p className="mt-1 text-xs text-on-surface-variant">Hotels · {Number(hotelsQuality.total_curated_rows || 0).toLocaleString('en-IN')} rows · {hotelsQuality.duplicate_rate_pct ?? '—'}% duplicates</p></div>
        </div></section>
      </>}
    </main>
  );
}
