const formatHotelINR = (amount) => `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function HotelResultCard({ hotel, onPlan, onBook }) {
  const taxAmount = hotel.tax_is_estimated ? hotel.estimated_tax_inr : hotel.tax_inr;
  const ratingDescription = hotel.rating_description || 'Guest rating';

  return (
    <article className="flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-container-highest bg-surface-container-low shadow-lg transition hover:border-primary/35 hover:bg-surface-container md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col p-5 md:p-6">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {hotel.badge && <span className="inline-flex rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">{hotel.badge}</span>}
              <span className="inline-flex rounded-full border border-secondary/20 bg-secondary-container/30 px-2.5 py-1 text-[10px] font-bold text-secondary">Value {Number(hotel.value_score || 0).toFixed(0)}/100</span>
            </div>
            <h2 className="mt-3 break-words font-headline text-xl font-bold leading-tight text-white">{hotel.hotel_name}</h2>
            <p className="mt-1 break-words text-sm text-on-surface-variant">{[hotel.location, hotel.city].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {hotel.star_rating != null && <span className="font-bold text-amber-300">{Number(hotel.star_rating).toFixed(0)}★ hotel</span>}
          <span className="text-on-surface"><strong className="text-sm text-white">{hotel.rating == null ? '—' : Number(hotel.rating).toFixed(1)}</strong><span className="ml-1.5 text-on-surface-variant">{ratingDescription}</span></span>
          <span className="text-on-surface-variant">{Number(hotel.reviews || 0).toLocaleString('en-IN')} reviews</span>
        </div>

        {hotel.nearest_landmark && hotel.distance_to_landmark_km != null && <p className="mt-4 flex min-w-0 items-center gap-2 text-xs text-on-surface-variant"><span className="material-symbols-outlined shrink-0 text-base text-tertiary">near_me</span><span className="break-words">{Number(hotel.distance_to_landmark_km).toLocaleString('en-IN')} km from {hotel.nearest_landmark}</span></p>}
        {hotel.explanation && <p className="mt-auto pt-5 text-xs leading-relaxed text-on-surface-variant"><span className="mr-2 inline-block h-4 border-l-2 border-secondary/60 align-middle" />{hotel.explanation}</p>}
      </div>

      <aside className="flex w-full min-w-0 shrink-0 flex-col border-t border-surface-container-highest bg-surface-container/50 p-5 md:w-[230px] md:items-end md:border-l md:border-t-0 md:p-5 md:text-right">
        <div className="w-full">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-on-surface-variant">Base price / night</p>
          <p className="mt-1 font-headline text-2xl font-extrabold text-white">{formatHotelINR(hotel.price_inr)}</p>
          {taxAmount != null && <p className={`mt-1 text-[11px] ${hotel.tax_is_estimated ? 'text-amber-300' : 'text-on-surface-variant'}`}>+ {formatHotelINR(taxAmount)} {hotel.tax_is_estimated ? 'est. GST' : 'tax'} / night</p>}
          {Number(hotel.nights) > 1 && <div className="mt-3 border-t border-surface-container-highest pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">{hotel.nights}-night stay total</p><p className="mt-1 font-mono text-lg font-bold text-primary">{formatHotelINR(hotel.stay_total_inr)}</p></div>}
        </div>
        <div className="mt-5 flex w-full flex-col gap-2 md:mt-auto md:pt-5">
          <button type="button" onClick={() => onBook?.(hotel)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-on-primary transition hover:bg-emerald-400"><span className="material-symbols-outlined text-base">hotel</span>Book Hotel</button>
          <button type="button" onClick={() => onPlan?.(hotel)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-secondary/30 bg-secondary-container/70 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-secondary-container"><span className="material-symbols-outlined text-base">auto_awesome</span>Plan with SkyAgent</button>
        </div>
      </aside>
    </article>
  );
}
