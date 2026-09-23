'use strict';

/**
 * USD payment-provider webhook (Stripe or PayPal — whichever adapter is
 * selected). Must read the raw body for signature verification, so it's
 * mounted before the JSON body parser. Mode-agnostic: the donation record
 * looked up by provider ref already carries the groupId to credit, so this
 * route doesn't need to know whether it's single or federated.
 */

const express = require('express');
const payments = require('../payments');
const donations = require('../services/donations');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  '/api/webhook',
  express.raw({ type: 'application/json' }),
  wrap(async (req, res) => {
    try {
      await payments.handleDonationWebhook(req.body, req, {
        getDonationByRef: donations.getDonationByRef,
        markDonationSucceeded: donations.markDonationSucceeded,
        creditPool: donations.creditPool,
      });
    } catch (err) {
      return res.status(400).json({ error: `Webhook failed: ${err.message}` });
    }
    res.json({ received: true });
  })
);

module.exports = router;
