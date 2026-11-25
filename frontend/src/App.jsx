import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import Footer from './components/Footer';
import Navbar from './components/Navbar';
import AgentPage from './pages/AgentPage';
import BookPage from './pages/BookPage';
import HomePage from './pages/HomePage';
import MyBookingsPage from './pages/MyBookingsPage';
import PayPage from './pages/PayPage';
import ResultsPage from './pages/ResultsPage';
import TicketPage from './pages/TicketPage';
import ProfilePage from './pages/ProfilePage';
import WishlistPage from './pages/WishlistPage';

function AppShell() {
  const { pathname } = useLocation();
  const isAgentRoute = pathname.startsWith('/agent');

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <Navbar />
      <main className={`w-full pt-16 flex-1 flex flex-col ${isAgentRoute ? 'overflow-hidden' : ''}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/book/:flightId" element={<BookPage />} />
          <Route path="/pay/:pnr" element={<PayPage />} />
          <Route path="/ticket/:pnr" element={<TicketPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/agent/:sessionId" element={<AgentPage />} />
          <Route path="/my-bookings" element={<MyBookingsPage />} />
          <Route path="/bookings" element={<MyBookingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
        </Routes>
      </main>
      {!isAgentRoute && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
