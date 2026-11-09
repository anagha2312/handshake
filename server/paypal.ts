// Thin client for the PayPal REST APIs Handshake uses:
// Orders v2 (fund escrow), Payments v2 (refunds), Payouts v1 (release to freelancer),
// Invoicing v2 (alternate funding), Notifications v1 (webhook verification).
import { randomUUID } from 'node:crypto';

const BASE = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
export const PAYPAL_WEB = process.env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com';

// Simulation mode: lets anyone run the full product without PayPal credentials.
// Every simulated step is labelled in the ledger; real credentials always hit the real sandbox APIs.
export let MOCK = process.env.PAYPAL_MODE === 'mock' || !process.env.PAYPAL_CLIENT_ID?.trim();

// If the sandbox credentials stop working (revoked app, retired sandbox), fall back to simulation
// so the project stays demoable instead of failing on every payment.
export async function probe() {
  if (MOCK) return 'simulated';
  try { await accessToken(); return 'sandbox'; } catch (e: any) {
    console.warn(`PayPal credentials rejected (${e.message}). Switching to simulation mode.`);
    MOCK = true;
    return 'simulated';
  }
}
const fakeId = (p: string) => `${p}-SIM-${randomUUID().slice(0, 8).toUpperCase()}`;

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const json: any = await res.json();
  if (!res.ok) throw new PayPalError('OAuth failed', res.status, json);
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export class PayPalError extends Error {
  constructor(message: string, public status: number, public details: any) {
    super(`${message} (${status}): ${details?.message || details?.name || details?.error_description || JSON.stringify(details).slice(0, 300)}`);
  }
}

async function call<T = any>(method: string, path: string, body?: unknown, opts: { requestId?: string; prefer?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' };
  // PayPal-Request-Id makes retries of money-moving calls idempotent.
  if (method !== 'GET') headers['PayPal-Request-Id'] = opts.requestId || randomUUID();
  if (opts.prefer) headers.Prefer = opts.prefer;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(`${method} ${path} failed`, res.status, json);
  return json as T;
}

export const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// ---------- Orders v2: client funds a milestone into escrow ----------
export async function createOrder(p: { milestoneId: string; amount: number; currency: string; description: string; returnUrl: string; cancelUrl: string }) {
  if (MOCK) {
    const id = fakeId('ORDER');
    const q = new URLSearchParams({ token: id, amount: money(p.amount), currency: p.currency, description: p.description, return: p.returnUrl, cancel: p.cancelUrl });
    return { id, status: 'PAYER_ACTION_REQUIRED', approveUrl: `/simulated-paypal/checkout?${q}` };
  }
  const order = await call('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: p.milestoneId,
      custom_id: p.milestoneId,
      description: p.description.slice(0, 127),
      amount: { currency_code: p.currency, value: money(p.amount) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Handshake Escrow',
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
          landing_page: 'LOGIN',
          return_url: p.returnUrl,
          cancel_url: p.cancelUrl,
        },
      },
    },
  }, { requestId: `order-${p.milestoneId}-${Date.now()}` });
  const approveUrl = order.links?.find((l: any) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  return { id: order.id as string, status: order.status as string, approveUrl: approveUrl as string };
}

export async function captureOrder(orderId: string) {
  if (MOCK) return { status: 'COMPLETED', captureId: fakeId('CAPTURE'), captureStatus: 'COMPLETED', payerEmail: undefined, payerName: 'Simulated payer' };
  const res = await call('POST', `/v2/checkout/orders/${orderId}/capture`, {}, { requestId: `capture-${orderId}` });
  const capture = res.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: res.status as string,
    captureId: capture?.id as string,
    captureStatus: capture?.status as string,
    payerEmail: res.payer?.email_address as string | undefined,
    payerName: [res.payer?.name?.given_name, res.payer?.name?.surname].filter(Boolean).join(' '),
  };
}

export const getOrder = (orderId: string) => call('GET', `/v2/checkout/orders/${orderId}`);

// ---------- Payments v2: refunds (full or partial) back to the client ----------
export async function refundCapture(captureId: string, amount: number, currency: string, note: string, key: string) {
  if (MOCK || captureId.includes('-SIM-')) return { refundId: fakeId('REFUND'), status: 'COMPLETED' };
  const res = await call('POST', `/v2/payments/captures/${captureId}/refund`, {
    amount: { value: money(amount), currency_code: currency },
    note_to_payer: note.slice(0, 255),
  }, { requestId: `refund-${key}` });
  return { refundId: res.id as string, status: res.status as string };
}

// ---------- Payouts v1: release escrowed funds to the freelancer ----------
export async function sendPayout(p: { receiver: string; amount: number; currency: string; note: string; key: string }) {
  if (MOCK) return { batchId: fakeId('PAYOUT'), status: 'SUCCESS', simulated: true };
  try {
    return await realPayout(p);
  } catch (e) {
    // Some sandbox business accounts (e.g. non-US regions) can't send Payouts. Opt-in fallback, always labelled.
    if (e instanceof PayPalError && e.details?.name === 'PAYOUT_NOT_AVAILABLE' && process.env.PAYOUTS_FALLBACK === 'simulate') {
      return { batchId: fakeId('PAYOUT'), status: 'SUCCESS', simulated: true };
    }
    throw e;
  }
}

async function realPayout(p: { receiver: string; amount: number; currency: string; note: string; key: string }) {
  const res = await call('POST', '/v1/payments/payouts', {
    sender_batch_header: {
      sender_batch_id: `hs-${p.key}`.slice(0, 127),
      email_subject: 'You got paid through Handshake',
      email_message: p.note.slice(0, 1000),
    },
    items: [{
      recipient_type: 'EMAIL',
      receiver: p.receiver,
      amount: { value: money(p.amount), currency: p.currency },
      note: p.note.slice(0, 4000),
      sender_item_id: p.key.slice(0, 63),
    }],
  }, { requestId: `payout-${p.key}` });
  return { batchId: res.batch_header?.payout_batch_id as string, status: res.batch_header?.batch_status as string, simulated: false };
}

export async function getPayoutBatch(batchId: string) {
  if (batchId.includes('-SIM-')) return { status: 'SUCCESS', itemStatus: 'SUCCESS', transactionId: batchId };
  const res = await call('GET', `/v1/payments/payouts/${batchId}`);
  const item = res.items?.[0];
  return { status: res.batch_header?.batch_status as string, itemStatus: item?.transaction_status as string | undefined, transactionId: item?.transaction_id as string | undefined };
}

// ---------- Invoicing v2: fund a milestone by sending the client a PayPal invoice ----------
export async function createAndSendInvoice(p: { milestoneId: string; clientEmail: string; clientName: string; freelancerName: string; title: string; amount: number; currency: string; note: string }) {
  if (MOCK) return { invoiceId: fakeId('INV'), payUrl: '' };
  const inv = await call('POST', '/v2/invoicing/invoices', {
    detail: {
      currency_code: p.currency,
      reference: p.milestoneId,
      note: p.note.slice(0, 4000),
      memo: `Handshake escrow for ${p.milestoneId}`,
      payment_term: { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: { business_name: 'Handshake Escrow' },
    primary_recipients: [{ billing_info: { email_address: p.clientEmail, name: { full_name: p.clientName } } }],
    items: [{
      name: p.title.slice(0, 200),
      description: `Held in escrow and released to ${p.freelancerName} on approval`.slice(0, 1000),
      quantity: '1',
      unit_amount: { currency_code: p.currency, value: money(p.amount) },
    }],
  }, { prefer: 'return=representation' });
  const id: string = inv.id || String(inv.href || '').split('/').pop();
  const sent = await call('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false, send_to_recipient: true });
  return { invoiceId: id, payUrl: (sent.href as string | undefined) || `${PAYPAL_WEB}/invoice/p/#${id}` };
}

export async function getInvoice(invoiceId: string) {
  if (invoiceId.includes('-SIM-')) return { status: 'PAID', paymentId: fakeId('CAPTURE') };
  const inv = await call('GET', `/v2/invoicing/invoices/${invoiceId}`);
  const tx = inv.payments?.transactions?.[0];
  return { status: inv.status as string, paymentId: tx?.payment_id as string | undefined };
}

// ---------- Webhooks ----------
export async function verifyWebhook(headers: Record<string, string | string[] | undefined>, event: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => String(headers[k] ?? '');
  const res = await call('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === 'SUCCESS';
}
