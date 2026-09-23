'use strict';

/**
 * Selects the USD payment adapter (stripe.js or paypal.js) named by
 * PAYMENT_RAIL. Both implement the same interface:
 *
 *   isMock()
 *   createDonationIntent({ amountCents, groupSlug, groupId, returnUrl?, cancelUrl? })
 *     -> { id, status: 'succeeded'|'created', clientSecret?, redirectUrl? }
 *   handleDonationWebhook(rawBody, req, { getDonationByRef, markDonationSucceeded, creditPool })
 *   enrollPayoutRecipient({ email, returnUrl?, refreshUrl? })
 *     -> { accountRef, onboardingUrl, payoutReady }
 *   isPayoutReady(accountRef) -> boolean
 *   createTransfer({ amountCents, accountRef, groupSlug }) -> { id, status: 'paid'|'queued' }
 *
 * Only meaningful when config.isUsd — the bitcoin rail uses
 * payments/bitcoin/wallet.js directly instead, since donations there are
 * on-chain rather than processor-mediated.
 */

const config = require('../config');

let adapter = null;
if (config.paymentRail === 'stripe') adapter = require('./stripe');
if (config.paymentRail === 'paypal') adapter = require('./paypal');

module.exports = adapter;
