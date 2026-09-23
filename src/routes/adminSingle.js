'use strict';

/**
 * Admin routes, single-institution mode — exactly Stage/UBIO's admin API
 * (mounted at /admin/api), generalized so the same handlers serve any rail.
 */

const express = require('express');
const config = require('../config');
const { getCollections, oid } = require('../db');
const groupsService = require('../services/groups');
const recipients = require('../services/recipients');
const distribution = require('../services/distribution');
const { checkSingleAdminPassword, requireAdmin } = require('../auth/admin');
const { rateLimit } = require('../auth/rateLimit');

const router = express.Router();
router.use(express.json());
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  (req, res) => {
    const { password } = req.body || {};
    if (!password || !checkSingleAdminPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    req.session.isAdmin = true;
    res.json({ ok: true });
  }
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  res.json({ isAdmin: Boolean(req.session && req.session.isAdmin) });
});

router.use(requireAdmin());

function serializeRecipient(r) {
  const base = {
    id: String(r._id),
    fullName: r.fullName,
    email: r.email,
    note: r.note,
    createdAt: r.addedAt,
  };
  if (config.isBitcoin) return { ...base, btcAddress: r.btcAddress };
  return { ...base, phone: r.phone, payoutReady: r.payoutReady, hasAccount: Boolean(r.accountRef) };
}

router.get(
  '/payees',
  wrap(async (req, res) => {
    res.json((await recipients.listRecipients(req.group._id)).map(serializeRecipient));
  })
);

router.post(
  '/payees',
  wrap(async (req, res) => {
    const result = await recipients.addRecipient(req.group, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, onboardingUrl: result.onboardingUrl, loginPassword: result.loginPassword });
  })
);

router.delete(
  '/payees',
  wrap(async (req, res) => {
    const email = (req.body && req.body.email) || req.query.email;
    const removed = await recipients.removeRecipientByEmail(req.group._id, email);
    if (!removed) return res.status(404).json({ error: 'No payee with that email.' });
    res.json({ ok: true });
  })
);

router.get(
  '/applications',
  wrap(async (req, res) => {
    res.json(await recipients.listApplications(req.group._id));
  })
);

router.post(
  '/applications/:id/approve',
  wrap(async (req, res) => {
    const result = await recipients.approveApplication(req.group, req.params.id);
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, onboardingUrl: result.onboardingUrl, loginPassword: result.loginPassword });
  })
);

router.post(
  '/applications/:id/reject',
  wrap(async (req, res) => {
    await recipients.rejectApplication(req.group, req.params.id);
    res.json({ ok: true });
  })
);

router.get(
  '/payments',
  wrap(async (req, res) => {
    const { payments } = getCollections();
    res.json(await payments.find({ groupId: oid(req.group._id) }).sort({ createdAt: -1 }).limit(100).toArray());
  })
);

// Manual distribution trigger (bypasses the interval check on the bitcoin
// rail; on the usd rails there's no interval gate to bypass, so this simply
// runs the payout pass immediately).
router.post(
  '/distribute',
  wrap(async (req, res) => {
    res.json(await distribution.forceRunGroup(req.group));
  })
);

module.exports = router;
