'use strict';

/**
 * Public routes, single-institution mode. Flat paths (no group slug) —
 * exactly Stage/UBIO's shape when PAYMENT_RAIL=bitcoin. The usd rails add
 * one endpoint (POST /api/donate) that Stage/UBIO didn't need, since there
 * a donor just sends BTC to the address shown on the page.
 */

const express = require('express');
const config = require('../config');
const groupsService = require('../services/groups');
const recipients = require('../services/recipients');
const donations = require('../services/donations');
const { rateLimit } = require('../auth/rateLimit');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/api/info',
  wrap(async (req, res) => {
    const group = await groupsService.getSingletonGroup();
    const info = {
      institutionName: config.institutionName,
      currency: config.currency,
      paymentRail: config.paymentRail,
    };

    if (config.isBitcoin) {
      let balanceSats = null;
      try {
        balanceSats = await groupsService.walletForGroup(group).getBalanceSats();
      } catch {
        // Network/provider hiccup shouldn't break the landing page.
      }
      Object.assign(info, {
        network: config.btc.network,
        donationAddress: config.btc.walletAddress,
        balanceSats,
      });
    } else {
      const meta = await groupsService.getMeta(group._id);
      Object.assign(info, {
        processor: config.paymentRail,
        balance: donations.dollars(meta.balanceCents),
        payoutUnit: donations.dollars((group.roundThreshold || 1) * 100),
      });
    }

    res.json(info);
  })
);

// Throttle the public application/subscribe form to limit spam/abuse.
router.post(
  '/api/apply',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  express.json(),
  wrap(async (req, res) => {
    const group = await groupsService.getSingletonGroup();
    const result = await recipients.submitApplication(group, req.body || {});
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    res.json({ ok: true });
  })
);

if (config.isUsd) {
  router.post(
    '/api/donate',
    rateLimit({ windowMs: 60 * 1000, max: 20 }),
    express.json(),
    wrap(async (req, res) => {
      const group = await groupsService.getSingletonGroup();
      const returnUrl = `${config.publicUrl}/?donated=1`;
      const cancelUrl = `${config.publicUrl}/`;
      const result = await donations.createDonation(group, (req.body || {}).amount, { returnUrl, cancelUrl });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.status(201).json(result);
    })
  );

  router.get(
    '/onboarding/return',
    wrap(async (req, res) => {
      const rid = req.query.rid;
      const recipient = rid && (await recipients.getRecipientById(rid).catch(() => null));
      if (!recipient) return res.status(404).send(onboardingPage('We could not find that enrollment.', false));
      const ready = await recipients.refreshOnboardingStatus(rid);
      res.send(
        ready
          ? onboardingPage('Payout setup complete. You will receive funds on the next cycle.', true)
          : onboardingPage('Setup is not finished yet. Reopen the onboarding link to complete it.', false)
      );
    })
  );
}

function onboardingPage(message, ok) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Payout setup — UBIO</title>
<style>
  body{font-family:system-ui,sans-serif;background:#F5F4EF;color:#1C2B26;
       display:grid;place-items:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #D8D6CC;border-radius:14px;
        padding:2.5rem;max-width:30rem;text-align:center}
  .mark{font-size:2rem}
  a{color:#256B5A;font-weight:600}
</style></head><body><div class="card">
<div class="mark">${ok ? '✓' : '…'}</div>
<h1 style="font-size:1.25rem">${message}</h1>
<p><a href="/">Back to UBIO</a></p>
</div></body></html>`;
}

module.exports = router;
