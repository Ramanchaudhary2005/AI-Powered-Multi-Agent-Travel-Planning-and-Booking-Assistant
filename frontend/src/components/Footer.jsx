import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="w-full bg-surface-container-lowest border-t border-surface-container-highest/50 py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-on-surface-variant">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container-low border border-outline-variant/40 text-[11px] font-mono text-primary">
            <span className="material-symbols-outlined text-[14px]">verified</span>
            <span>FlightAgent India</span>
          </div>
          <span>300,153 Domestic Flights • Manual &amp; SkyAgent AI</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/" className="hover:text-on-surface transition-colors">
            Manual Search
          </Link>
          <Link to="/agent" className="hover:text-on-surface transition-colors">
            Talk with Agent
          </Link>
          <Link to="/my-bookings" className="hover:text-on-surface transition-colors">
            My Bookings
          </Link>
        </div>
      </div>
    </footer>
  );
}
