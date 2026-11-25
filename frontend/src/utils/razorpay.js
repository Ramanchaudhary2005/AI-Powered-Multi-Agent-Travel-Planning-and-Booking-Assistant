import { createPaymentOrder, verifyPayment } from '../api/client';

let razorpayScriptPromise = null;

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

/**
 * Executes end-to-end payment for a booking or existing order:
 * 1. Creates Razorpay/mock order if `existingOrder` is not passed
 * 2. If `mock_ord_*` (or no razorpay_key_id), immediately verifies in mock mode
 * 3. Otherwise opens Razorpay Checkout modal and verifies HMAC signature
 */
export async function processBookingPayment({
  bookingId,
  existingOrder = null,
  customer = {},
  description = 'FlightAgent India Ticket',
}) {
  const order = existingOrder || (await createPaymentOrder(bookingId));

  const isMock =
    !order.razorpay_key_id || String(order.gateway_order_id).startsWith('mock_ord_');

  if (isMock) {
    const verified = await verifyPayment({
      razorpay_order_id: order.gateway_order_id,
      razorpay_payment_id: `mock_pay_${Date.now()}`,
      razorpay_signature: 'mock_sig',
    });
    return { order, verified, mode: 'mock' };
  }

  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Could not load Razorpay Checkout SDK.');
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.razorpay_key_id,
      amount: order.amount * 100,
      currency: order.currency || 'INR',
      name: 'FlightAgent India',
      description,
      order_id: order.gateway_order_id,
      prefill: {
        name: customer.name || '',
        email: customer.email || '',
        contact: customer.phone || '',
      },
      theme: { color: '#10b981' },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled by user.')),
      },
      handler: async (response) => {
        try {
          const verified = await verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
          resolve({ order, verified, mode: 'razorpay' });
        } catch (err) {
          reject(err);
        }
      },
    });
    rzp.open();
  });
}
