'use strict';

/**
 * PayPal adapter — implements the same rail-agnostic USD payment interface
 * as payments/stripe.js, so the distribution engine and routes don't need
 * to know which USD processor is configured.
 *
 * Donations: a PayPal Order (intent=CAPTURE). The donor approves it via the
 * PayPal-hosted checkout page; PayPal calls our webhook when it's approved,
 * we capture it server-side, and credit the pool.
 *
 * Payouts: PayPal's Payouts API sends money straight to a recipient's PayPal
 * email — there's no Connect-style onboarding/KYC step to complete first, so
 * a recipient is payout-ready as soon as they give us that email.
 *
 * MOCK mode (default, PAYPAL_MOCK=true): no network calls. Donations confirm
 * immediately and payouts return a fake batch id marked 'paid'.
 */

const config = require('../config');

const MOCK = config.paypal.mock;
const API_BASE = config.paypal.apiBase ? config.paypal.apiBase.replace(/\/$/, '') : null;

function isMock() {
  return MOCK;
}

function log(...args) {
  if (MOCK) console.log('[paypal:mock]', ...args);
}

function fakeId(prefix) {
  return `${prefix}_mock_${Math.random().toString(36).slice(2, 12)}`;
}

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text().catch(() => '')}`);
  const body = await res.json();
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`PayPal ${path} -> ${res.status} ${text}`);
  return body;
}

/* ─── Donations in ─────────────────────────────────────────────────── */

async function createDonationIntent({ amountCents, groupSlug, groupId, returnUrl, cancelUrl }) {
  if (MOCK) {
    const id = fakeId('order');
    log(`donation order ${id} for $${(amountCents / 100).toFixed(2)} -> group ${groupSlug}`);
    return { id, status: 'succeeded', redirectUrl: null };
  }
  const order = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: String(groupId),
          description: `UBIO donation to ${groupSlug}`,
          amount: { currency_code: 'USD', value: (amountCents / 100).toFixed(2) },
        },
      ],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });
  const approve = (order.links || []).find((l) => l.rel === 'approve');
  return { id: order.id, status: 'created', redirectUrl: approve ? approve.href : null };
}

async function handleDonationWebhook(rawBody, req, hooks) {
  const event = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));

  const verification = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      transmission_id: req.get('paypal-transmission-id'),
      transmission_time: req.get('paypal-transmission-time'),
      cert_url: req.get('paypal-cert-url'),
      auth_algo: req.get('paypal-auth-algo'),
      transmission_sig: req.get('paypal-transmission-sig'),
      webhook_id: config.paypal.webhookId,
      webhook_event: event,
    }),
  });
  if (verification.verification_status !== 'SUCCESS') {
    throw new Error('PayPal webhook signature verification failed.');
  }

  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const orderId = event.resource.id;
    await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST', body: '{}' });
    const donation = await hooks.getDonationByRef(orderId);
    if (donation && donation.status !== 'succeeded') {
      await hooks.markDonationSucceeded(orderId);
      await hooks.creditPool(donation.groupId, donation.amountCents);
    }
  }
}

/* ─── Payouts out ──────────────────────────────────────────────────── */

// No onboarding needed: PayPal Payouts just needs a PayPal email.
async function enrollPayoutRecipient({ email }) {
  log(`registered payout email ${email} (no onboarding required for PayPal Payouts)`);
  return { accountRef: email, onboardingUrl: null, payoutReady: true };
}

async function isPayoutReady() {
  return true; // ready as soon as enrolled — see enrollPayoutRecipient
}

async function createTransfer({ amountCents, accountRef, groupSlug }) {
  if (MOCK) {
    const id = fakeId('batch');
    log(`payout ${id}: $${(amountCents / 100).toFixed(2)} -> ${accountRef} (${groupSlug})`);
    return { id, status: 'paid' };
  }
  const senderBatchId = fakeId('ubio');
  const batch = await paypalFetch('/v1/payments/payouts', {
    method: 'POST',
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: senderBatchId, email_subject: `UBIO payout from ${groupSlug}` },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: (amountCents / 100).toFixed(2), currency: 'USD' },
          receiver: accountRef,
          note: `UBIO payout from ${groupSlug}`,
          sender_item_id: senderBatchId,
        },
      ],
    }),
  });
  // Payouts settle asynchronously on PayPal's side.
  return { id: batch.batch_header.payout_batch_id, status: 'queued' };
}

module.exports = {
  isMock,
  createDonationIntent,
  handleDonationWebhook,
  enrollPayoutRecipient,
  isPayoutReady,
  createTransfer,
};
