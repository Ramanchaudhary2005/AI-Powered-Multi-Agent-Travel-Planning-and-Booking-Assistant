import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { deleteWishlistFlight, getMyProfile, getWishlist, googleAuth, saveWishlistFlight } from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY = 'flightagent_jwt';
const USER_KEY = 'flightagent_user';
const wishKey = (flightId, date) => `${flightId}:${date || ''}`;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  });
  const [wishlist, setWishlist] = useState([]);
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const [loginOpen, setLoginOpen] = useState(false);

  const refreshProfile = useCallback(async () => {
    const profile = await getMyProfile();
    setUser(profile);
    localStorage.setItem(USER_KEY, JSON.stringify(profile));
    return profile;
  }, []);

  useEffect(() => {
    if (!token) { setAuthLoading(false); setWishlist([]); return undefined; }
    let active = true;
    Promise.all([getMyProfile(), getWishlist()])
      .then(([profile, saved]) => {
        if (!active) return;
        setUser(profile);
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
        setWishlist(saved);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setToken(null);
        setUser(null);
        setWishlist([]);
      })
      .finally(() => active && setAuthLoading(false));
    return () => { active = false; };
  }, [token]);

  const loginWithGoogle = useCallback(async (credential) => {
    const result = await googleAuth(credential);
    localStorage.setItem(TOKEN_KEY, result.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setToken(result.access_token);
    setUser(result.user);
    setLoginOpen(false);
    return result.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setWishlist([]);
    setLoginOpen(false);
  }, []);

  const toggleWishlist = useCallback(async (flight) => {
    if (!token) { setLoginOpen(true); return false; }
    const key = wishKey(flight.flight_id, flight.travel_date);
    const existing = wishlist.find((item) => wishKey(item.flight_id, item.travel_date) === key);
    if (existing) {
      setWishlist((items) => items.filter((item) => wishKey(item.flight_id, item.travel_date) !== key));
      try { await deleteWishlistFlight(flight.flight_id, flight.travel_date); return false; }
      catch { setWishlist((items) => [existing, ...items]); return false; }
    }
    const snapshot = {
      flight_id: String(flight.flight_id), airline: flight.airline, flight_code: flight.flight_code,
      source_city: flight.source_city, destination_city: flight.destination_city,
      travel_date: flight.travel_date, flight_class: flight.travel_class || flight.flight_class,
      price_when_saved: flight.price, duration_hrs: flight.duration_hrs,
      stops: flight.stops || (flight.stops_count === 0 ? 'zero' : undefined),
    };
    setWishlist((items) => [snapshot, ...items]);
    try { await saveWishlistFlight(snapshot); return true; }
    catch { setWishlist((items) => items.filter((item) => wishKey(item.flight_id, item.travel_date) !== key)); return false; }
  }, [token, wishlist]);

  const value = useMemo(() => ({
    token, user, wishlist, authLoading, loginOpen, setLoginOpen, loginWithGoogle, logout,
    refreshProfile, toggleWishlist, isWishlisted: (id, date) => wishlist.some((item) => wishKey(item.flight_id, item.travel_date) === wishKey(id, date)),
  }), [token, user, wishlist, authLoading, loginOpen, loginWithGoogle, logout, refreshProfile, toggleWishlist]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
