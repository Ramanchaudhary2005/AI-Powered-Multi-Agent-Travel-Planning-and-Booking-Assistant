const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) {
        message = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail);
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(message);
  }

  return res.json();
}

// ── Flights ──────────────────────────────────────────────────────────────

export function getFlightMeta() {
  return request('/api/flights/meta');
}

export function searchFlights(payload) {
  return request('/api/flights/search', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getFlightById(flightId, travelDate) {
  const qs = new URLSearchParams({ travel_date: travelDate }).toString();
  return request(`/api/flights/${flightId}?${qs}`);
}

// ── Bookings ─────────────────────────────────────────────────────────────

export function createBooking(payload) {
  return request('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getBookingByPnr(pnr) {
  return request(`/api/bookings/${encodeURIComponent(pnr.trim().toUpperCase())}`);
}

export function getBookingsByEmail(email) {
  const qs = new URLSearchParams({ email: email.trim() }).toString();
  return request(`/api/bookings?${qs}`);
}

export function getTicketPdfUrl(pnr) {
  return `${API_BASE}/api/bookings/${encodeURIComponent(pnr.trim().toUpperCase())}/ticket.pdf`;
}

// ── Payments ─────────────────────────────────────────────────────────────

export function createPaymentOrder(bookingId) {
  return request('/api/payments/order', {
    method: 'POST',
    body: JSON.stringify({ booking_id: bookingId }),
  });
}

export function verifyPayment(payload) {
  return request('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Agent ────────────────────────────────────────────────────────────────

export function createAgentSession(userId = null) {
  return request('/api/agent/session', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });
}

export function updateSessionBudget(sessionId, budget) {
  return request(`/api/agent/session/${sessionId}/budget`, {
    method: 'PATCH',
    body: JSON.stringify({ budget }),
  });
}

export function getSessionSteps(sessionId) {
  return request(`/api/agent/session/${sessionId}/steps`);
}

/**
 * Stream POST SSE events using fetch() + ReadableStream getReader().
 * NEVER uses native EventSource.
 */
export async function streamAgentMessage(
  sessionId,
  content,
  { onStepUpdate, onUiCard, onAssistantMessage, onDone, onError, signal } = {}
) {
  const res = await fetch(`${API_BASE}/api/agent/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ session_id: sessionId, content }),
    signal,
  });

  if (!res.ok) {
    let msg = `Agent request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) msg = err.detail;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  if (!res.body) {
    throw new Error('Streaming response body unavailable.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const dispatchFrame = (rawFrame) => {
    const lines = rawFrame.replace(/\r\n/g, '\n').split('\n');
    let eventName = 'message';
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;

    let parsed;
    const rawData = dataLines.join('\n');
    try {
      parsed = JSON.parse(rawData);
    } catch {
      parsed = rawData;
    }

    if (eventName === 'step_update') onStepUpdate?.(parsed);
    else if (eventName === 'ui_card') onUiCard?.(parsed);
    else if (eventName === 'assistant_message') onAssistantMessage?.(parsed);
    else if (eventName === 'done') onDone?.(parsed);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const normalized = buffer.replace(/\r\n/g, '\n');
      const frames = normalized.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        if (frame.trim()) dispatchFrame(frame);
      }
    }

    if (buffer.trim()) {
      dispatchFrame(buffer);
    }
  } catch (err) {
    if (err?.name !== 'AbortError') {
      onError?.(err);
      throw err;
    }
  } finally {
    reader.releaseLock();
  }
}

export { API_BASE };
