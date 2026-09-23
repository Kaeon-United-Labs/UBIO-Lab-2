'use strict';

/**
 * Stripe adapter — implements the rail-agnostic USD payment interface (see
 * payments/index.js) with card donations (Payment Intents) and payouts via
 * Stripe Connect (Express accounts). Ported from Lab/2's payments.js.
 *
 * MOCK mode (default): no network calls. Donations confirm immediately,
 * onboarding links point straight at the local return route, and payouts
 * return a fake transfer id marked 'paid'. Set STRIPE_MOCK=false and provide
 * real keys to go live — nothing else changes.
 */

const config = require('../config');

const MOCK = config.stripe.mock;

let stripe = null;
if (!MOCK) {
  // eslint-disable-next-line global-require
  stripe = require('stripe')(config.stripe.secretKey);
}

function isMock() {
  return MOCK;
}

function log(...args) {
  if (MOCK) console.log('[stripe:mock]', ...args);
}

function fakeId(prefix) {
  return `${prefix}_mock_${Math.random().toString(36).slice(2, 12)}`;
}

/* ─── Donations in ─────────────────────────────────────────────────── */

async function createDonationIntent({ amountCents, groupSlug, groupId }) {
  if (MOCK) {
    const id = fakeId('pi');
    log(`donation intent ${id} for $${(amountCents / 100).toFixed(2)} -> group ${groupSlug}`);
    return { id, clientSecret: `${id}_secret`, status: 'succeeded' };
  }
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    metadata: { groupSlug, groupId: String(groupId) },
    description: `UBIO donation to ${groupSlug}`,
  });
  return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
}

/**
 * Verify the webhook, resolve it to a donation record via the injected db
 * helpers, and credit the pool if it's a newly-succeeded payment. Mock mode
 * never receives real webhooks (donations already settle synchronously).
 */
async function handleDonationWebhook(rawBody, req, hooks) {
  const event = stripe.webhooks.constructEvent(
    rawBody,
    req.get('stripe-signature'),
    config.stripe.webhookSecret
  );
  if (event.type !== 'payment_intent.succeeded') return;
  const ref = event.data.object.id;
  const donation = await hooks.getDonationByRef(ref);
  if (donation && donation.status !== 'succeeded') {
    await hooks.markDonationSucceeded(ref);
    await hooks.creditPool(donation.groupId, donation.amountCents);
  }
}

/* ─── Payouts out (Connect) ────────────────────────────────────────── */

async function enrollPayoutRecipient({ email, returnUrl, refreshUrl }) {
  let accountRef;
  if (MOCK) {
    accountRef = fakeId('acct');
    log(`created Connect account ${accountRef} for ${email}`);
  } else {
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: { transfers: { requested: true } },
    });
    accountRef = account.id;
  }

  let onboardingUrl;
  if (MOCK) {
    onboardingUrl = returnUrl;
    log(`onboarding link for ${accountRef} -> ${onboardingUrl}`);
  } else {
    const link = await stripe.accountLinks.create({
      account: accountRef,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
    onboardingUrl = link.url;
  }

  return { accountRef, onboardingUrl, payoutReady: false };
}

async function isPayoutReady(accountRef) {
  if (MOCK) return true;
  const account = await stripe.accounts.retrieve(accountRef);
  return Boolean(account.payouts_enabled && account.charges_enabled);
}

async function createTransfer({ amountCents, accountRef, groupSlug }) {
  if (MOCK) {
    const id = fakeId('tr');
    log(`transfer ${id}: $${(amountCents / 100).toFixed(2)} -> ${accountRef} (${groupSlug})`);
    return { id, status: 'paid' };
  }
  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: accountRef,
    description: `UBIO payout from ${groupSlug}`,
  });
  return { id: transfer.id, status: 'queued' };
}

module.exports = {
  isMock,
  createDonationIntent,
  handleDonationWebhook,
  enrollPayoutRecipient,
  isPayoutReady,
  createTransfer,
};
