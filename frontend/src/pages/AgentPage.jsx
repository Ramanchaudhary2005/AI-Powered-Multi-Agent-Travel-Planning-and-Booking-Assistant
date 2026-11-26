import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  createAgentSession,
  getSessionSteps,
  streamAgentMessage,
  updateSessionBudget,
} from '../api/client';
import {
  formatDuration,
  formatINR,
  formatStops,
  getAirlineDisplay,
  getCityCode,
} from '../utils/flightUtils';
import { processBookingPayment } from '../utils/razorpay';
import { useAuth } from '../context/AuthContext';
import { getBookableDateRange } from '../utils/flightUtils';

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-indigo-100">{children}</em>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-primary">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-primary">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
};

function RankedFlightsCard({ data, onQuickReply }) {
  const { isWishlisted, toggleWishlist } = useAuth();
  const fallbackDate = getBookableDateRange().defaultDate;
  const flights = data?.top_3 || (data?.best_pick ? [data.best_pick] : []);
  if (flights.length === 0) return null;

  return (
    <div className="rounded-xl bg-surface-container border border-surface-container-highest p-4 space-y-3 shadow-md">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-bold text-on-surface uppercase tracking-wider">
          Top Ranked Options
        </span>
        <span className="text-[11px] text-on-surface-variant font-mono">
          Weighted Score Ranking
        </span>
      </div>

      {flights.map((f, idx) => {
        const isBest = f.badge === 'Best Overall' || idx === 0;
        return (
          <div
            key={f.flight_id}
            className={`p-3.5 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors ${
              isBest
                ? 'bg-surface-container-high border border-primary/40 shadow-sm'
                : 'bg-surface-container-low border border-surface-container-highest/50 hover:bg-surface-container-high'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-none text-[11px] font-mono font-bold ${
                  isBest
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {isBest ? (
                  <span className="material-symbols-outlined text-[14px]">check</span>
                ) : (
                  idx + 1
                )}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {f.badge && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${
                        f.badge === 'Best Overall'
                          ? 'bg-primary-container text-on-primary-container'
                          : f.badge === 'Cheapest'
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'bg-amber-400/20 text-amber-300'
                      }`}
                    >
                      {f.badge}
                    </span>
                  )}
                  <span className="text-xs font-semibold text-on-surface">
                    {getAirlineDisplay(f.airline)} •{' '}
                    <span className="font-mono">{f.flight_code}</span>
                  </span>
                  <span className="text-[10px] font-mono text-on-surface-variant">
                    ID #{f.flight_id}
                  </span>
                </div>

                <div className="flex items-center gap-2 mt-1.5 text-xs text-on-surface font-mono">
                  <span className="font-bold text-sm">{f.dep_clock}</span>
                  <span className="text-on-surface-variant text-[11px]">
                    {getCityCode(f.source_city)}
                  </span>
                  <span className="text-on-surface-variant text-[10px] px-1 font-sans">
                    ── {formatDuration(f.duration_hrs)} • {formatStops(f.stops_count)} ──
                  </span>
                  <span className="font-bold text-sm">{f.arr_clock}</span>
                  <span className="text-on-surface-variant text-[11px]">
                    {getCityCode(f.destination_city)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex md:flex-col items-center md:items-end justify-between gap-1.5 pt-2 md:pt-0">
              <div className="text-right">
                <div className="text-base font-bold text-primary font-mono">
                  {formatINR(f.price)}
                </div>
                <div className="text-[10px] text-on-surface-variant">
                  {f.live_seats_left} seats left
                </div>
              </div>
              <div className="flex items-center gap-2">
              <button type="button" aria-label={isWishlisted(f.flight_id, f.travel_date || fallbackDate) ? 'Remove from wishlist' : 'Add to wishlist'} onClick={() => toggleWishlist({ ...f, travel_date: f.travel_date || fallbackDate })} className={`p-2 rounded-full border transition-colors ${isWishlisted(f.flight_id, f.travel_date || fallbackDate) ? 'text-rose-300 bg-rose-500/15 border-rose-300/30' : 'text-on-surface-variant bg-surface-container border-surface-container-highest hover:text-rose-300'}`}><span className="material-symbols-outlined text-lg">favorite</span></button>
              <button
                type="button"
                onClick={() =>
                  onQuickReply?.(
                    `I'd like to book flight_id ${f.flight_id} (${getAirlineDisplay(f.airline)} ${
                      f.flight_code
                    }) at ${formatINR(f.price)}.`
                  )
                }
                className="text-[11px] px-2.5 py-1 rounded bg-secondary-container/60 hover:bg-secondary-container text-on-secondary-container hover:text-white font-medium transition-colors"
              >
                Select Flight
              </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankedHotelsCard({ data }) {
  const hotels = (data?.hotels || []).slice(0, 3);
  if (!hotels.length) return null;

  return (
    <div className="rounded-xl border border-surface-container-highest bg-surface-container p-4 shadow-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-on-surface">Top Ranked Hotels</span>
        <span className="text-[10px] font-mono text-on-surface-variant">{data.city} · {data.nights} {data.nights === 1 ? 'night' : 'nights'}</span>
      </div>
      <div className="space-y-2.5">
        {hotels.map((hotel) => {
          const taxAmount = hotel.tax_is_estimated ? hotel.estimated_tax_inr : hotel.tax_inr;
          return (
            <article key={hotel.hotel_id} className="rounded-xl border border-surface-container-highest/70 bg-surface-container-low p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {hotel.badge && <span className="rounded bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{hotel.badge}</span>}
                    <span className="rounded bg-secondary-container/50 px-2 py-0.5 text-[9px] font-bold text-secondary">Value {Number(hotel.value_score || 0).toFixed(0)}/100</span>
                  </div>
                  <h3 className="mt-1.5 text-sm font-bold text-white">{hotel.hotel_name}</h3>
                  <p className="mt-0.5 text-[10px] text-on-surface-variant">{[hotel.location, hotel.city].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right text-[10px]">
                  <p className="font-semibold text-amber-300">{hotel.star_rating == null ? 'Hotel' : `${Number(hotel.star_rating).toFixed(0)}★`}</p>
                  <p className="mt-0.5 text-on-surface"><strong className="text-white">{hotel.rating == null ? '—' : Number(hotel.rating).toFixed(1)}</strong> {hotel.rating_description || 'rating'}</p>
                  <p className="text-on-surface-variant">{Number(hotel.reviews || 0).toLocaleString('en-IN')} reviews</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-surface-container-highest/70 pt-2.5 text-[10px]">
                <span className="text-on-surface-variant">{formatINR(hotel.price_inr)} / night</span>
                {taxAmount != null && <span className={hotel.tax_is_estimated ? 'text-amber-300' : 'text-on-surface-variant'}>+ {formatINR(taxAmount)} {hotel.tax_is_estimated ? 'est. GST' : 'tax'}</span>}
                <span className="font-semibold text-primary">Stay total: {formatINR(hotel.stay_total_inr)}</span>
                {hotel.distance_to_landmark_km != null && hotel.nearest_landmark && <span className="text-on-surface-variant">{hotel.distance_to_landmark_km} km from {hotel.nearest_landmark}</span>}
              </div>
              {hotel.explanation && <p className="mt-2 text-[10px] leading-relaxed text-on-surface-variant">{hotel.explanation}</p>}
            </article>
          );
        })}
      </div>
      <p className="mt-2 text-[9px] text-on-surface-variant/80">Hotel prices are indicative; no hotel reservation or payment was made.</p>
    </div>
  );
}

function PaymentOrderCard({ data }) {
  const [paying, setPaying] = useState(false);
  const [paidResult, setPaidResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');

  if (!data) return null;

  const handlePay = async () => {
    if (paying || paidResult) return;
    setPaying(true);
    setErrMsg('');
    try {
      const { verified } = await processBookingPayment({
        bookingId: data.booking_id,
        existingOrder: data,
        description: `SkyAgent Booking #${data.booking_id}`,
      });
      setPaidResult(verified);
    } catch (err) {
      setErrMsg(err.message || 'Payment failed.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container border border-secondary/35 p-5 shadow-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-surface-container-highest">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">verified</span>
          <div>
            <div className="text-xs font-bold text-on-surface">
              {paidResult ? 'Ticket Confirmed!' : 'Payment Order Ready'}
            </div>
            <div className="text-[11px] text-on-surface-variant font-mono">
              Order: <span className="text-secondary">{data.gateway_order_id}</span>
              {paidResult?.pnr && (
                <>
                  {' '}
                  • PNR: <span className="text-primary font-bold">{paidResult.pnr}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-surface-container-high text-xs font-mono text-tertiary">
          Booking #{data.booking_id}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-on-surface-variant">Total Payable Amount</span>
        <span className="text-xl font-bold font-mono text-primary">
          {formatINR(data.amount)}
        </span>
      </div>

      {errMsg && (
        <div className="p-2.5 rounded-lg bg-error-container/30 border border-error/40 text-error text-xs">
          {errMsg}
        </div>
      )}

      {paidResult ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to={`/ticket/${paidResult.pnr}`}
            className="flex-1 py-2.5 px-4 rounded-xl bg-primary text-on-primary font-bold text-xs flex items-center justify-center gap-2 hover:bg-emerald-400 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">confirmation_number</span>
            <span>View Boarding Pass &amp; PDF (PNR {paidResult.pnr})</span>
          </Link>
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePay}
          disabled={paying}
          className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-bold text-sm tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:bg-emerald-400 transition-all disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[18px]">lock</span>
          <span>
            {paying ? 'Verifying Payment...' : `Pay ${formatINR(data.amount)} via Razorpay`}
          </span>
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      )}
    </div>
  );
}

function StepJsonBlock({ step }) {
  const [expanded, setExpanded] = useState(false);

  const parsedInput = (() => {
    if (!step.input_json) return null;
    try {
      return JSON.stringify(JSON.parse(step.input_json), null, 2);
    } catch {
      return step.input_json;
    }
  })();

  const parsedOutput = (() => {
    if (!step.output_json) return null;
    try {
      const obj = JSON.parse(step.output_json);
      return JSON.stringify(obj, null, 2);
    } catch {
      return step.output_json;
    }
  })();

  const hasJson = Boolean(parsedInput || parsedOutput);
  if (!hasJson) return null;

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] text-secondary hover:underline inline-flex items-center gap-0.5"
      >
        <span>{expanded ? 'Collapse JSON' : 'View JSON'}</span>
        <span className="material-symbols-outlined text-[14px]">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 p-3 rounded bg-surface-container-lowest border border-surface-container-highest font-mono text-[11px] leading-relaxed text-on-surface space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
          {parsedInput && (
            <div>
              <div className="text-[10px] uppercase text-tertiary mb-1">Input</div>
              <pre className="whitespace-pre-wrap break-all text-on-surface-variant">
                {parsedInput}
              </pre>
            </div>
          )}
          {parsedOutput && (
            <div>
              <div className="text-[10px] uppercase text-primary mb-1">Output</div>
              <pre className="whitespace-pre-wrap break-all text-on-surface-variant">
                {parsedOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentPage() {
  const { user } = useAuth();
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Budget editing
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  // Chat input & streaming state
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveCards, setLiveCards] = useState([]);

  const chatEndRef = useRef(null);
  const activityEndRef = useRef(null);
  const initialSentRef = useRef(false);
  const firstName = user?.first_middle_name?.trim().split(/\s+/)[0] || user?.name?.trim().split(/\s+/)[0] || 'there';
  const quickChips = [
    user?.city
      ? `My budget is ₹7,000 — find cheapest non-stop flight from ${user.city} to Mumbai`
      : 'Find cheapest non-stop Delhi to Mumbai flight next week',
    'Compare morning flights from Bangalore to Delhi',
    'Plan a Delhi to Mumbai flight + 2-night 4-star hotel stay under ₹18,000',
  ];

  // Create session if visited at /agent without :sessionId
  useEffect(() => {
    if (sessionId) return;
    let active = true;
    setLoading(true);
    createAgentSession(null)
      .then((s) => {
        if (active) navigate(`/agent/${s.session_id}`, { replace: true });
      })
      .catch((err) => {
        if (active) {
          setError(err.message || 'Could not create agent session.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [sessionId, navigate]);

  const hydrateSession = useCallback(async (id) => {
    const data = await getSessionSteps(id);
    setSession(data.session);
    setMessages(data.messages || []);
    setSteps(data.steps || []);
    setBudgetInput(data.session?.budget ? String(data.session.budget) : '');
    return data;
  }, []);

  // Hydrate messages & steps on mount / reload
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    setLoading(true);
    setError('');
    setLiveCards([]);
    initialSentRef.current = false;

    hydrateSession(sessionId)
      .catch((err) => {
        if (active) setError(err.message || 'Failed to load session.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [sessionId, hydrateSession]);

  // Auto-scroll chat & activity panel
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveCards, isStreaming]);

  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId || isStreaming) return;

      setError('');
      setInput('');
      setIsStreaming(true);
      setLiveCards([]);

      // Optimistically show user message
      const tempId = `temp-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          message_id: tempId,
          role: 'user',
          content: trimmed,
          ui_payload_json: null,
          created_at: new Date().toISOString(),
        },
      ]);

      let streamedCards = [];

      try {
        await streamAgentMessage(Number(sessionId), trimmed, {
          onStepUpdate: (ev) => {
            setSteps((prev) => {
              const idx = prev.findIndex((s) => s.step_id === ev.step_id);
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = { ...copy[idx], ...ev };
                return copy;
              }
              return [...prev, ev];
            });
          },
          onUiCard: (card) => {
            streamedCards = [...streamedCards, card];
            setLiveCards([...streamedCards]);
          },
          onHotelsResult: (card) => {
            streamedCards = [...streamedCards, card];
            setLiveCards([...streamedCards]);
          },
          onBudgetUpdated: (event) => {
            const cap = event.budget_cap ?? null;
            setSession((current) => current ? { ...current, budget: cap } : current);
            setBudgetInput(cap ? String(cap) : '');
            setEditingBudget(false);
          },
          onAssistantMessage: (msg) => {
            let persistedCard = null;
            if (msg.ui_payload_json) {
              try {
                persistedCard = JSON.parse(msg.ui_payload_json);
              } catch {
                persistedCard = null;
              }
            }
            const cards = streamedCards.length ? streamedCards : persistedCard ? [persistedCard] : [];
            const uiPayloadJson = cards.length > 1
              ? JSON.stringify({ type: 'MULTIPLE', cards })
              : cards.length === 1 ? JSON.stringify(cards[0]) : msg.ui_payload_json || null;
            setLiveCards([]);
            setMessages((prev) => [
              ...prev,
              {
                message_id: `ast-${Date.now()}`,
                role: 'assistant',
                content: msg.content,
                ui_payload_json: uiPayloadJson,
                created_at: new Date().toISOString(),
              },
            ]);
          },
          onDone: () => {
            // Re-hydrate from SQLite so full input_json / output_json & IDs are synced
            hydrateSession(sessionId).then((data) => {
              if (streamedCards.length > 1) {
                const latestAssistant = [...(data.messages || [])].reverse().find((message) => message.role === 'assistant');
                if (latestAssistant) {
                  setMessages((current) => current.map((message) => message.message_id === latestAssistant.message_id
                    ? { ...message, ui_payload_json: JSON.stringify({ type: 'MULTIPLE', cards: streamedCards }) }
                    : message));
                }
              }
            }).catch(() => {});
          },
        });
      } catch (err) {
        setError(err.message || 'Streaming error.');
      } finally {
        setIsStreaming(false);
      }
    },
    [sessionId, isStreaming, hydrateSession]
  );

  // Handle initialPrompt passed via router state from HomePage
  useEffect(() => {
    if (
      !loading &&
      sessionId &&
      location.state?.initialPrompt &&
      !initialSentRef.current
    ) {
      initialSentRef.current = true;
      const prompt = location.state.initialPrompt;
      navigate(location.pathname, { replace: true, state: {} });
      sendMessage(prompt);
    }
  }, [loading, sessionId, location, navigate, sendMessage]);

  const handleSaveBudget = async (e) => {
    e.preventDefault();
    const numeric = Number(budgetInput);
    if (!numeric || numeric < 500) return;
    setSavingBudget(true);
    try {
      const updated = await updateSessionBudget(Number(sessionId), numeric);
      setSession(updated);
      setEditingBudget(false);
    } catch (err) {
      setError(err.message || 'Failed to update budget.');
    } finally {
      setSavingBudget(false);
    }
  };

  const handleQuickBudget = async (amount) => {
    if (!sessionId || savingBudget) return;
    setSavingBudget(true);
    try {
      const updated = await updateSessionBudget(Number(sessionId), amount);
      setSession(updated);
      setBudgetInput(updated.budget ? String(updated.budget) : '');
      setEditingBudget(false);
    } catch (err) {
      setError(err.message || 'Failed to update budget.');
    } finally {
      setSavingBudget(false);
    }
  };

  const handleNewSession = async () => {
    try {
      const s = await createAgentSession(null);
      navigate(`/agent/${s.session_id}`);
    } catch (err) {
      setError(err.message || 'Could not start new session.');
    }
  };

  return (
    <div className="flex flex-col w-full h-[calc(100vh-4rem)] overflow-hidden bg-surface text-on-surface">
      {/* Session Subheader Bar */}
      <header className="w-full flex-none h-14 bg-surface-container-low border-b border-surface-container-highest px-4 lg:px-8 flex items-center justify-between gap-4 z-20">
        <div className="flex items-center gap-3 min-w-0">
          {session && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container text-xs text-on-surface-variant">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span className="font-medium font-mono">
                Session #{session.session_id} •{' '}
                <span className="text-primary font-semibold">{session.status}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-container text-xs text-secondary">
            <span className="material-symbols-outlined text-[16px] text-tertiary">smart_toy</span>
            <span className="font-semibold text-tertiary">SkyAgent • Gemini Tool Loop</span>
          </div>
          <button
            type="button"
            onClick={handleNewSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-variant border border-surface-container-highest text-xs font-medium text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>New Session</span>
          </button>
        </div>
      </header>

      {/* 60/40 Split Workspace with Independent Scrolling */}
      <div className="flex-1 flex flex-col lg:flex-row w-full min-h-0 overflow-hidden">
        {/* LEFT PANEL (60%): AI Chat Thread */}
        <section className="lg:w-[60%] w-full flex flex-col h-1/2 lg:h-full bg-surface-container-lowest border-b lg:border-b-0 lg:border-r border-surface-container-highest overflow-hidden">
          <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {loading ? (
              <div className="space-y-4">
                <div className="h-16 w-2/3 ml-auto rounded-2xl bg-surface-container animate-pulse" />
                <div className="h-32 w-3/4 rounded-2xl bg-surface-container animate-pulse" />
              </div>
            ) : messages.length === 0 ? (
              <div className="max-w-xl mx-auto mt-8 p-6 rounded-2xl bg-surface-container border border-secondary/25 text-center space-y-4">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-secondary-container flex items-center justify-center text-white">
                  <span className="material-symbols-outlined text-2xl">psychology</span>
                </div>
                <h2 className="font-headline font-bold text-lg text-white">
                  {user ? `Hello ${firstName}!` : 'Welcome to SkyAgent Concierge'}
                </h2>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  {user
                    ? "Tell me your budget and where you want to go today — I'll search, compare, and book the best flights for you."
                    : "Tell me your budget and where you want to go — I'll search, compare, and book flights for you."}
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {quickChips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => sendMessage(chip)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-variant text-on-surface-variant hover:text-white transition-colors"
                    >
                      ✦ {chip}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.message_id} className="flex flex-col items-end">
                      <div className="max-w-xl bg-secondary-container/40 border border-secondary/30 px-4 py-3 rounded-2xl rounded-tr-sm text-sm text-on-surface shadow-md">
                        <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                      </div>
                    </div>
                  );
                }

                let uiPayload = null;
                if (m.ui_payload_json) {
                  try {
                    uiPayload = JSON.parse(m.ui_payload_json);
                  } catch {
                    uiPayload = null;
                  }
                }
                const assistantCards = uiPayload?.type === 'MULTIPLE'
                  ? uiPayload.cards || []
                  : uiPayload ? [uiPayload] : [];

                return (
                  <div key={m.message_id} className="flex items-start gap-3.5 max-w-2xl">
                    <div className="flex-none w-8 h-8 rounded-xl bg-secondary-container flex items-center justify-center text-white shadow-[0_0_12px_rgba(176,144,255,0.3)]">
                      <span className="material-symbols-outlined text-[18px]">psychology</span>
                    </div>
                    <div className="flex-1 space-y-3 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-on-surface">SkyAgent</span>
                        <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-[10px] text-tertiary font-semibold">
                          Flight Concierge
                        </span>
                      </div>

                      <div className="text-sm text-on-surface-variant leading-relaxed break-words bg-surface-container/60 border border-surface-container-highest rounded-xl p-3.5">
                        <ReactMarkdown components={CHAT_MARKDOWN_COMPONENTS}>{m.content}</ReactMarkdown>
                      </div>

                      {assistantCards.map((card, index) => (
                        <div key={`${card.type}-${index}`}>
                          {card.type === 'RANKED_FLIGHTS' && <RankedFlightsCard data={card.data} onQuickReply={sendMessage} />}
                          {card.type === 'PAYMENT_ORDER' && <PaymentOrderCard data={card.data} />}
                          {card.type === 'HOTEL_RESULTS' && <RankedHotelsCard data={card.data} />}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {/* Live UI cards received before final assistant_message */}
            {isStreaming && liveCards.length > 0 && (
              <div className="space-y-3 pl-11 max-w-2xl">
                {liveCards.map((card, i) =>
                  card.type === 'RANKED_FLIGHTS' ? (
                    <RankedFlightsCard key={i} data={card.data} onQuickReply={sendMessage} />
                  ) : card.type === 'PAYMENT_ORDER' ? (
                    <PaymentOrderCard key={i} data={card.data} />
                  ) : card.type === 'HOTEL_RESULTS' ? (
                    <RankedHotelsCard key={i} data={card.data} />
                  ) : null
                )}
              </div>
            )}

            {isStreaming && (
              <div className="flex items-center gap-3 pl-11 text-xs text-tertiary font-mono">
                <span className="material-symbols-outlined animate-spin text-base">
                  progress_activity
                </span>
                <span>SkyAgent is thinking and executing tools...</span>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-error-container/30 border border-error/40 text-error text-xs">
                {error}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Sticky Chat Input */}
          <footer className="flex-none p-4 bg-surface-container-low border-t border-surface-container-highest">
            <div className="mb-3 rounded-xl border border-surface-container-highest bg-surface-container px-3.5 py-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" onClick={() => { setBudgetInput(session?.budget ? String(session.budget) : ''); setEditingBudget((current) => !current); }} className="inline-flex items-center gap-2 text-xs font-semibold text-on-surface hover:text-primary">
                  <span className={`w-2 h-2 rounded-full ${session?.budget ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.75)]' : 'bg-surface-bright'}`} />
                  <span>Budget Cap: {session?.budget ? formatINR(session.budget) : 'Not Set'}</span>
                  <span className="material-symbols-outlined text-sm text-on-surface-variant">edit</span>
                </button>
                {Boolean(session?.budget) && <button type="button" onClick={() => handleQuickBudget(0)} aria-label="Clear budget cap" title="Clear budget cap" className="w-6 h-6 rounded-full text-on-surface-variant hover:text-rose-300 hover:bg-rose-500/10 text-base leading-none">×</button>}
                <span className="hidden sm:block h-4 w-px bg-surface-container-highest" />
                {[5000, 8000, 12000].map((amount) => <button key={amount} type="button" disabled={savingBudget} onClick={() => handleQuickBudget(amount)} className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-colors disabled:opacity-50 ${Number(session?.budget) === amount ? 'bg-primary/15 border-primary/30 text-primary' : 'bg-surface-container-high border-surface-container-highest text-on-surface-variant hover:text-on-surface hover:border-primary/30'}`}>{formatINR(amount)}</button>)}
                <button type="button" onClick={() => { setBudgetInput(''); setEditingBudget(true); }} className="px-2.5 py-1 rounded-lg border border-indigo-300/20 bg-indigo-400/10 text-indigo-200 text-[11px] font-semibold hover:bg-indigo-400/20">Custom ₹</button>
              </div>
              {editingBudget && <form onSubmit={handleSaveBudget} className="mt-2.5 flex flex-wrap items-center gap-2">
                <label htmlFor="agent-budget-input" className="sr-only">Custom budget cap in rupees</label>
                <span className="text-xs text-on-surface-variant">Custom cap</span><span className="text-primary">₹</span>
                <input id="agent-budget-input" type="number" min={500} step={100} autoFocus value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} placeholder="e.g. 7000" className="w-28 px-2.5 py-1.5 rounded-lg bg-surface-container-high border border-surface-container-highest text-xs text-on-surface font-mono outline-none focus:border-primary/50" />
                <button type="submit" disabled={savingBudget} className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-semibold disabled:opacity-50">{savingBudget ? 'Saving…' : 'Set cap'}</button>
                <button type="button" onClick={() => setEditingBudget(false)} className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-on-surface">Cancel</button>
              </form>}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="flex items-center gap-2 bg-surface-container-highest px-3 py-2 rounded-xl focus-within:ring-2 focus-within:ring-tertiary"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isStreaming || !sessionId}
                placeholder="Ask SkyAgent to search, rank, or book flights..."
                className="flex-1 bg-transparent border-0 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none"
              />
              <button
                type="submit"
                disabled={isStreaming || !input.trim() || !sessionId}
                aria-label="Send Message"
                className="px-4 py-2 rounded-lg bg-secondary-container text-white text-xs font-semibold hover:bg-indigo-600 flex items-center gap-1.5 transition-all disabled:opacity-50"
              >
                <span>{isStreaming ? 'Working...' : 'Send'}</span>
                <span className="material-symbols-outlined text-[16px]">send</span>
              </button>
            </form>
          </footer>
        </section>

        {/* RIGHT PANEL (40%): Live Agent Activity Timeline */}
        <aside className="lg:w-[40%] w-full flex flex-col h-1/2 lg:h-full bg-surface-container-low overflow-hidden">
          <div className="h-14 px-5 flex items-center justify-between flex-none bg-surface-container border-b border-surface-container-highest">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-tertiary text-[20px]">terminal</span>
              <h2 className="text-sm font-bold text-on-surface tracking-tight">Agent Activity</h2>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container-high text-tertiary text-[11px] font-medium">
              <span className="relative flex h-2 w-2">
                {isStreaming && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isStreaming ? 'bg-tertiary' : 'bg-primary'
                  }`}
                />
              </span>
              <span>{isStreaming ? 'Streaming SSE' : 'Synced'}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
            {steps.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-xs text-on-surface-variant px-6 space-y-2">
                <span className="material-symbols-outlined text-3xl text-surface-bright">
                  timeline
                </span>
                <p className="font-medium text-on-surface">No tool executions yet</p>
                <p>
                  When SkyAgent calls <span className="font-mono text-primary">set_budget_cap</span>,{' '}
                  <span className="font-mono text-primary">search_flights</span>
                  , <span className="font-mono text-primary">rank_flights</span>,{' '}
                  <span className="font-mono text-primary">create_booking</span>, or{' '}
                  <span className="font-mono text-primary">create_payment_order</span>, live SSE
                  tool steps appear here.
                </p>
              </div>
            ) : (
              <div className="relative pl-6 space-y-5 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-surface-container-high">
                {steps.map((step) => {
                  const isDone = step.status === 'DONE';
                  const isFailed = step.status === 'FAILED';
                  const isRunning = step.status === 'RUNNING';
                  const isBudgetBlocked =
                    step.output_json && step.output_json.includes('BLOCKED_BY_BUDGET_GUARD');

                  return (
                    <div key={step.step_id || `${step.turn_id}-${step.step_no}`} className="relative">
                      <div
                        className={`absolute -left-[30px] top-0.5 w-6 h-6 rounded-full flex items-center justify-center shadow-sm ${
                          isFailed || isBudgetBlocked
                            ? 'bg-error-container text-error'
                            : isDone
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-highest text-tertiary'
                        }`}
                      >
                        <span
                          className={`material-symbols-outlined text-[14px] ${
                            isRunning ? 'animate-spin' : ''
                          }`}
                        >
                          {isFailed || isBudgetBlocked
                            ? 'block'
                            : isDone
                            ? 'check'
                            : 'progress_activity'}
                        </span>
                      </div>

                      <div className="bg-surface-container border border-surface-container-highest/70 rounded-lg p-3.5 shadow-sm space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-xs font-bold ${
                              isBudgetBlocked
                                ? 'text-amber-300'
                                : isFailed
                                ? 'text-error'
                                : isDone
                                ? 'text-primary'
                                : 'text-tertiary'
                            }`}
                          >
                            {step.tool_name}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-surface-container-high font-mono text-[10px] text-on-surface-variant">
                            #{step.step_no} • {step.status}
                          </span>
                        </div>

                        {step.summary && (
                          <p className="text-xs text-on-surface">{step.summary}</p>
                        )}

                        {isBudgetBlocked && (
                          <div className="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded px-2 py-1">
                            Blocked by budget_guard (exceeds session cap)
                          </div>
                        )}

                        <StepJsonBlock step={step} />
                      </div>
                    </div>
                  );
                })}
                <div ref={activityEndRef} />
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
