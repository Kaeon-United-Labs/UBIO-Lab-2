'use strict';

const express = require('express');
const config = require('../config');
const wallet = require('../wallet');
const payees = require('../services/payees');
const { rateLimit } = require('../middleware/auth');

const router = express.Router();

router.get('/api/info', async (req, res) => {
  let balanceSats = null;
  try {
    balanceSats = await wallet.getBalanceSats();
  } catch {
    // Network/provider hiccup shouldn't break the landing page.
  }
  res.json({
    institutionName: config.institutionName,
    network: config.network,
    donationAddress: config.walletAddress,
    balanceSats,
  });
});

// Throttle the public form to limit spam/abuse (no auth here by design).
router.post(
  '/api/apply',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }),
  express.json(),
  async (req, res) => {
    const result = await payees.submitApplication(req.body || {});
    if (!result.ok) return res.status(400).json({ errors: result.errors });
    res.json({ ok: true });
  }
);

module.exports = router;
