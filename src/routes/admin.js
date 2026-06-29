'use strict';

const express = require('express');
const payees = require('../services/payees');
const distribution = require('../services/distribution');
const { getCollections } = require('../db');
const { checkPassword, requireAdmin, rateLimit } = require('../middleware/auth');

const router = express.Router();
router.use(express.json());

// --- Session login (browser admin panel) ---
router.post(
  '/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  (req, res) => {
    const { password } = req.body || {};
    if (!password || !checkPassword(password)) {
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

// Everything below requires session OR bearer token.
router.use(requireAdmin);

router.get('/payees', async (req, res) => {
  res.json(await payees.listPayees());
});

router.post('/payees', async (req, res) => {
  const result = await payees.addPayee(req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.delete('/payees', async (req, res) => {
  const email = (req.body && req.body.email) || req.query.email;
  const result = await payees.removePayeeByEmail(email);
  if (!result.ok) return res.status(404).json({ error: 'No payee with that email.' });
  res.json({ ok: true });
});

router.get('/applications', async (req, res) => {
  res.json(await payees.listApplications());
});

router.post('/applications/:id/approve', async (req, res) => {
  const result = await payees.approveApplication(req.params.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

router.post('/applications/:id/reject', async (req, res) => {
  await payees.rejectApplication(req.params.id);
  res.json({ ok: true });
});

router.get('/payments', async (req, res) => {
  const { payments } = getCollections();
  res.json(await payments.find({}).sort({ createdAt: -1 }).limit(100).toArray());
});

// Manual distribution trigger (bypasses the interval check, still single-fire).
router.post('/distribute', async (req, res) => {
  try {
    const result = await distribution.runOnce({ force: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
