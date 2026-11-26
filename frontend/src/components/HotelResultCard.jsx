const formatHotelINR = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function HotelResultCard({ hotel, onPlan }) {
  const taxAmount = hotel.tax_is_estimated ? hotel.estimated_tax_inr : hotel.tax_inr;
  const ratingDescription = hotel.rating_description || 'Guest rating';

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-surface-container-highest bg-surface-container-low p-5 shadow-lg transition hover:border-primary/35 hover:bg-surface-container">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {hotel.badge && (
            <span className="inline-flex rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
              {hotel.badge}
            </span>
          )}
          <h3 className="mt-2 truncate font-headline text-lg font-bold text-white" title={hotel.hotel_name}>
            {hotel.hotel_name}
          </h3>
          <p className="mt-1 truncate text-xs text-on-surface-variant">
            {[hotel.location, hotel.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-secondary/20 bg-secondary-container/30 px-2.5 py-1.5 text-center">
          <div className="font-mono text-sm font-bold text-secondary">{Number(hotel.value_score || 0).toFixed(0)}<span className="text-[9px] text-on-surface-variant">/100</span></div>
          <div className="text-[9px] font-semibold uppercase tracking-wide text-on-surface-variant">Value</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {hotel.star_rating != null && (
          <span className="font-semibold text-amber-300">{Number(hotel.star_rating).toFixed(0)}★ hotel</span>
        )}
        <span className="text-on-surface">
          <span className="font-bold text-white">{hotel.rating == null ? '—' : Number(hotel.rating).toFixed(1)}</span>{' '}
          <span className="text-on-surface-variant">{ratingDescription}</span>
        </span>
        <span className="text-on-surface-variant">{Number(hotel.reviews || 0).toLocaleString('en-IN')} reviews</span>
      </div>

      {hotel.nearest_landmark && hotel.distance_to_landmark_km != null && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-sm text-tertiary">near_me</span>
          {Number(hotel.distance_to_landmark_km).toLocaleString('en-IN')} km from {hotel.nearest_landmark}
        </p>
      )}

      <div className="mt-4 rounded-xl border border-surface-container-highest/70 bg-surface-container-lowest/70 p-3.5">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">Per night</p>
            <p className="mt-0.5 font-headline text-xl font-bold text-white">{formatHotelINR(hotel.price_inr)}</p>
          </div>
          <span className="pb-1 text-[10px] text-on-surface-variant">base price</span>
        </div>
        {taxAmount != null && (
          <p className="mt-1.5 text-[11px] text-on-surface-variant">
            + {formatHotelINR(taxAmount)} {hotel.tax_is_estimated ? 'estimated GST' : 'tax'} / night
          </p>
        )}
        {Number(hotel.nights) > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-surface-container-highest pt-2.5">
            <span className="text-xs text-on-surface-variant">{hotel.nights}-night stay total</span>
            <span className="font-mono text-sm font-bold text-primary">{formatHotelINR(hotel.stay_total_inr)}</span>
          </div>
        )}
      </div>

      {hotel.explanation && (
        <p className="mt-3 min-h-9 border-l-2 border-secondary/60 pl-2.5 text-[11px] leading-relaxed text-on-surface-variant">
          {hotel.explanation}
        </p>
      )}

      <button
        type="button"
        onClick={() => onPlan?.(hotel)}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-secondary/30 bg-secondary-container/70 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-secondary-container"
      >
        <span className="material-symbols-outlined text-base">auto_awesome</span>
        Plan with SkyAgent
      </button>
      <p className="mt-2 text-center text-[10px] text-on-surface-variant/80">Indicative hotel listing · guided planning only</p>
    </article>
  );
}
