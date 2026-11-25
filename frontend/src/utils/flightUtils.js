export const CITY_INFO = {
  Delhi: { code: 'DEL', airport: 'Indira Gandhi Intl', terminals: 'Terminal 1, 2, 3' },
  Mumbai: { code: 'BOM', airport: 'Chhatrapati Shivaji', terminals: 'Terminal 1, 2' },
  Bangalore: { code: 'BLR', airport: 'Kempegowda Intl', terminals: 'Terminal 1, 2' },
  Kolkata: { code: 'CCU', airport: 'Netaji Subhash Intl', terminals: 'Terminal 1, 2' },
  Hyderabad: { code: 'HYD', airport: 'Rajiv Gandhi Intl', terminals: 'Main Terminal' },
  Chennai: { code: 'MAA', airport: 'Chennai Intl', terminals: 'Terminal 1, 4' },
};

export const AIRLINE_META = {
  Indigo: { label: 'IndiGo', dot: 'bg-blue-400', text: 'text-blue-300' },
  Vistara: { label: 'Vistara', dot: 'bg-purple-400', text: 'text-purple-300' },
  Air_India: { label: 'Air India', dot: 'bg-red-400', text: 'text-red-300' },
  SpiceJet: { label: 'SpiceJet', dot: 'bg-amber-400', text: 'text-amber-300' },
  AirAsia: { label: 'AirAsia India', dot: 'bg-orange-400', text: 'text-orange-300' },
  GO_FIRST: { label: 'GO FIRST', dot: 'bg-cyan-400', text: 'text-cyan-300' },
};

export const TIME_SLOT_META = {
  Early_Morning: { label: 'Early Morning', range: '04:00 - 08:00' },
  Morning: { label: 'Morning', range: '08:00 - 12:00' },
  Afternoon: { label: 'Afternoon', range: '12:00 - 16:00' },
  Evening: { label: 'Evening', range: '16:00 - 20:00' },
  Night: { label: 'Night', range: '20:00 - 24:00' },
  Late_Night: { label: 'Late Night', range: '00:00 - 04:00' },
};

export function formatINR(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '₹0';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

export function formatDuration(hrs) {
  const num = Number(hrs) || 0;
  const h = Math.floor(num);
  const m = Math.round((num - h) * 60);
  if (m === 60) return `${h + 1}h 00m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatStops(stopsCount) {
  if (stopsCount === 0) return 'Non-stop';
  if (stopsCount === 1) return '1 Stop';
  return '2+ Stops';
}

export function formatDisplayDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDisplayDateFull(isoDate) {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getBookableDateRange() {
  const toIso = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const today = new Date();
  const min = new Date(today);
  min.setDate(today.getDate() + 1);
  const max = new Date(today);
  max.setDate(today.getDate() + 49);
  const def = new Date(today);
  def.setDate(today.getDate() + 7);
  return {
    minDate: toIso(min),
    maxDate: toIso(max),
    defaultDate: toIso(def),
  };
}

export function getAirlineDisplay(airline) {
  return AIRLINE_META[airline]?.label || airline?.replace(/_/g, ' ') || 'Airline';
}

export function getAirlineDot(airline) {
  return AIRLINE_META[airline]?.dot || 'bg-primary';
}

export function getCityCode(city) {
  return CITY_INFO[city]?.code || (city ? city.slice(0, 3).toUpperCase() : '---');
}

/**
 * Mirrors backend ranking_service.py formula so results page can highlight
 * Best Overall / Cheapest / Fastest on real API results.
 */
export function annotateFlightsWithBadges(flights, preferredSlot = null) {
  if (!flights || flights.length === 0) return [];
  const prices = flights.map((f) => f.price);
  const durs = flights.map((f) => f.duration_hrs);
  const pLo = Math.min(...prices);
  const pHi = Math.max(...prices);
  const dLo = Math.min(...durs);
  const dHi = Math.max(...durs);
  const stopsPenalty = { 0: 0.0, 1: 0.5, 2: 1.0 };
  const norm = (v, lo, hi) => (hi === lo ? 0 : (v - lo) / (hi - lo));

  const scored = flights.map((f) => {
    const score =
      0.45 * norm(f.price, pLo, pHi) +
      0.3 * norm(f.duration_hrs, dLo, dHi) +
      0.15 * (stopsPenalty[f.stops_count] ?? 1.0) +
      0.1 * (preferredSlot && f.departure_time === preferredSlot ? 0.0 : 0.5);
    return { ...f, score, badge: null };
  });

  const best = scored.reduce((a, b) => (b.score < a.score ? b : a), scored[0]);
  const cheapest = scored.reduce((a, b) => (b.price < a.price ? b : a), scored[0]);
  const fastest = scored.reduce((a, b) => (b.duration_hrs < a.duration_hrs ? b : a), scored[0]);

  best.badge = 'Best Overall';
  if (!cheapest.badge) cheapest.badge = 'Cheapest';
  if (!fastest.badge) fastest.badge = 'Fastest';

  return scored;
}
