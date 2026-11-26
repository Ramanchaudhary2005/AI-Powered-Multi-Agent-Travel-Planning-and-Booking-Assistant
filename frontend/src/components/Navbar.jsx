import { useEffect, useRef, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, wishlist, loginOpen, setLoginOpen, loginWithGoogle, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginError, setLoginError] = useState('');
  const menuRef = useRef(null);
  const isManual = pathname === '/' || ['/results', '/book/', '/pay/', '/ticket/'].some((p) => pathname.startsWith(p));
  const isAgent = pathname.startsWith('/agent');
  const isTripAnalysis = pathname.startsWith('/trip-analysis');
  const isMarketInsights = pathname.startsWith('/market-insights');
  const shortName = user?.first_middle_name?.split(' ')[0] || user?.name?.split(' ')[0] || 'Account';

  useEffect(() => {
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const handleLogout = () => {
    logout(); setMenuOpen(false); navigate('/');
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 w-full z-50 bg-surface/85 backdrop-blur-xl border-b border-surface-container-highest/60 shadow-[0_1px_8px_rgba(0,0,0,0.25)]">
        <div className="h-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2.5 group shrink-0">
              <div className="w-9 h-9 rounded-xl bg-surface-container-high flex items-center justify-center text-primary shadow-[0_0_12px_rgba(78,222,163,0.15)] group-hover:scale-105 transition-transform">
                <span className="material-symbols-outlined text-[21px]">flight_takeoff</span>
              </div>
              <span className="text-base lg:text-lg font-headline font-bold tracking-tight text-on-surface">FlightAgent <span className="text-primary">India</span></span>
            </Link>
            <nav className="hidden md:flex items-center gap-2">
              <NavLink to="/" className={`px-3.5 py-1.5 text-sm rounded-lg ${isManual ? 'bg-surface-container-high text-on-surface font-semibold border border-primary/25' : 'text-on-surface-variant hover:text-on-surface'}`}>Manual Search</NavLink>
              <NavLink to="/agent" className={`px-3.5 py-1.5 text-sm rounded-lg ${isAgent ? 'bg-secondary-container text-white font-semibold' : 'text-on-surface-variant hover:text-on-surface'}`}>Talk with Agent <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">AI</span></NavLink>
              <NavLink to="/trip-analysis" className={`px-3.5 py-1.5 text-sm rounded-lg ${isTripAnalysis ? 'bg-primary/10 text-primary font-semibold border border-primary/20' : 'text-on-surface-variant hover:text-on-surface'}`}>Trips Analysis</NavLink>
              <NavLink to="/market-insights" className={`px-3.5 py-1.5 text-sm rounded-lg ${isMarketInsights ? 'bg-indigo-400/10 text-indigo-200 font-semibold border border-indigo-300/20' : 'text-on-surface-variant hover:text-on-surface'}`}>Fare Insights</NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant text-xs font-mono border border-surface-container-highest"><span className="font-semibold text-primary">₹</span><span>INR</span></div>
            <Link to="/agent" className="md:hidden px-3 py-1.5 rounded-lg bg-secondary-container text-white text-xs font-semibold">AI Agent</Link>
            {user ? (
              <div className="relative" ref={menuRef}>
                <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-haspopup="menu" className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 bg-surface-container-high hover:bg-surface-container-highest border border-surface-container-highest transition-colors">
                  {user.avatar_url ? <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" /> : <span className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center"><span className="material-symbols-outlined text-[18px]">person</span></span>}
                  <span className="hidden sm:block text-sm font-semibold text-on-surface max-w-24 truncate">{shortName}</span>
                  <span className="material-symbols-outlined text-[17px] text-on-surface-variant">expand_more</span>
                </button>
                {menuOpen && <div role="menu" className="absolute right-0 mt-2 w-72 rounded-2xl bg-[#111a30] border border-surface-container-highest shadow-2xl p-2 z-50">
                  <div className="px-3 py-3 border-b border-surface-container-highest mb-1">
                    <div className="font-semibold text-on-surface truncate">{user.name}</div><div className="text-xs text-on-surface-variant truncate mt-0.5">{user.email}</div>
                  </div>
                  <Link role="menuitem" onClick={() => setMenuOpen(false)} to="/profile" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface hover:bg-surface-container-high"><span className="material-symbols-outlined text-primary text-lg">account_circle</span>My Profile</Link>
                  <Link role="menuitem" onClick={() => setMenuOpen(false)} to="/wishlist" className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-on-surface hover:bg-surface-container-high"><span className="flex items-center gap-3"><span className="material-symbols-outlined text-rose-400 text-lg">favorite</span>Wishlist</span><span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 text-[11px] font-bold">{wishlist.length}</span></Link>
                  <Link role="menuitem" onClick={() => setMenuOpen(false)} to="/bookings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface hover:bg-surface-container-high"><span className="material-symbols-outlined text-secondary-fixed text-lg">confirmation_number</span>My Bookings</Link>
                  <Link role="menuitem" onClick={() => setMenuOpen(false)} to="/trip-analysis" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-on-surface hover:bg-surface-container-high"><span className="material-symbols-outlined text-emerald-300 text-lg">monitoring</span>Trips Analysis</Link>
                  <button type="button" role="menuitem" onClick={handleLogout} className="w-full mt-1 border-t border-surface-container-highest flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-rose-300 hover:bg-rose-500/10"><span className="material-symbols-outlined text-lg">logout</span>Logout</button>
                </div>}
              </div>
            ) : <button type="button" onClick={() => { setLoginError(''); setLoginOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-semibold text-sm shadow-lg shadow-primary/15 hover:bg-emerald-400 transition-colors"><span className="material-symbols-outlined text-lg">login</span>Sign In</button>}
          </div>
        </div>
      </header>
      {loginOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setLoginOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="login-title" className="w-full max-w-md rounded-3xl bg-[#111a30] border border-white/10 shadow-2xl p-7 sm:p-9 relative overflow-hidden">
          <div className="absolute -top-20 -right-16 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
          <button type="button" aria-label="Close sign in" onClick={() => setLoginOpen(false)} className="absolute right-4 top-4 p-2 rounded-full text-on-surface-variant hover:bg-white/10"><span className="material-symbols-outlined">close</span></button>
          <div className="relative text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-400/15 text-indigo-300 flex items-center justify-center"><span className="material-symbols-outlined text-3xl">flight_takeoff</span></div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-primary font-bold">FlightAgent India</p><h2 id="login-title" className="mt-2 text-2xl font-headline font-bold text-on-surface">Welcome aboard</h2><p className="mt-2 text-sm text-on-surface-variant">Sign in to save flights and manage your trips.</p></div>
            <div className="flex justify-center"><GoogleLogin text="continue_with" shape="pill" theme="filled_black" onSuccess={async (result) => { try { await loginWithGoogle(result.credential); setLoginError(''); } catch (error) { setLoginError(error.message || 'Sign in failed.'); } }} onError={() => setLoginError('Google sign-in could not be completed.')} /></div>
            {loginError && <p role="alert" className="text-sm text-rose-300">{loginError}</p>}
            <p className="text-[11px] text-on-surface-variant">Secure sign-in with your verified Google account</p>
          </div>
        </section>
      </div>}
    </>
  );
}
