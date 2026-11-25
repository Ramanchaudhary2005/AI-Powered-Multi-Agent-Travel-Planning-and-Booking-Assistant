import { Link, NavLink, useLocation } from 'react-router-dom';

export default function Navbar() {
  const { pathname } = useLocation();
  const isManual =
    pathname === '/' ||
    pathname.startsWith('/results') ||
    pathname.startsWith('/book') ||
    pathname.startsWith('/pay') ||
    pathname.startsWith('/ticket');
  const isAgent = pathname.startsWith('/agent');
  const isBookings = pathname.startsWith('/my-bookings');

  return (
    <header className="fixed top-0 left-0 right-0 w-full z-50 bg-surface/85 backdrop-blur-xl border-b border-surface-container-highest/60 shadow-[0_1px_8px_rgba(0,0,0,0.25)]">
      <div className="h-16 max-w-7xl mx-auto px-6 lg:px-12 flex items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center text-primary shadow-[0_0_12px_rgba(78,222,163,0.15)] group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[21px]">flight_takeoff</span>
            </div>
            <span className="text-base lg:text-lg font-headline font-bold tracking-tight text-on-surface flex items-center gap-1.5">
              FlightAgent
              <span className="text-primary font-bold">India</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            <NavLink
              to="/"
              className={`px-3.5 py-1.5 text-sm transition-all flex items-center gap-2 rounded-lg ${
                isManual
                  ? 'bg-surface-container-high text-on-surface font-semibold shadow-sm border border-primary/25'
                  : 'font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              Manual Search
            </NavLink>

            <NavLink
              to="/agent"
              className={`px-3.5 py-1.5 text-sm transition-all flex items-center gap-2 rounded-lg ${
                isAgent
                  ? 'bg-secondary-container text-white shadow-[0_0_14px_rgba(176,144,255,0.35)] font-semibold'
                  : 'font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              <span>Talk with Agent</span>
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
                  isAgent
                    ? 'bg-white/20 text-white'
                    : 'bg-secondary-container text-on-secondary-container'
                }`}
              >
                AI
              </span>
            </NavLink>

            <NavLink
              to="/my-bookings"
              className={`px-3.5 py-1.5 text-sm transition-all flex items-center gap-2 rounded-lg ${
                isBookings
                  ? 'bg-surface-container-high text-primary font-semibold shadow-sm border border-primary/25'
                  : 'font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              }`}
            >
              My Bookings
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-mono font-medium border border-surface-container-highest">
            <span className="font-semibold text-primary">₹</span>
            <span>INR</span>
          </div>
          <Link
            to="/agent"
            className="md:hidden px-3 py-1.5 rounded-lg bg-secondary-container text-white text-xs font-semibold"
          >
            AI Agent
          </Link>
          <Link
            to="/my-bookings"
            className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors"
            title="My Bookings"
          >
            <span className="material-symbols-outlined text-[18px]">person</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
