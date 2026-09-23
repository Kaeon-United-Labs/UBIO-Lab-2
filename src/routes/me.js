'use strict';

/**
 * Recipient ("logged-in user") self-service routes — the third credential
 * tier alongside admin and anonymous. Mounted at /api/me in single mode, or
 * /api/groups/:slug/me in federated mode (see index.js).
 */

const express = require('express');
const config = require('../config');
const { getCollections, oid } = require('../db');
const groupsService = require('../services/groups');
const recipientAuthService = require('../services/recipientAuth');
const donations = require('../services/donations');
const recipientAuth = require('../auth/recipient');
const { rateLimit } = require('../auth/rateLimit');

const router = express.Router({ mergeParams: true });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function resolveGroup(req) {
  return config.isSingle ? groupsService.getSingletonGroup() : groupsService.getGroupBySlug(req.params.slug);
}

router.post(
  '/login',
  express.json(),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }),
  wrap(async (req, res) => {
    const group = await resolveGroup(req);
    if (!group) return res.status(404).json({ error: 'No such group.' });
    const { email, password } = req.body || {};
    const recipient = await recipientAuth.authenticate(group._id, email, password);
    if (!recipient) return res.status(401).json({ error: 'Wrong email or password.' });
    res.json({ token: recipientAuth.signRecipientToken(recipient) });
  })
);

router.use(recipientAuth.requireRecipient);

function serializeSelf(r) {
  const base = {
    id: String(r._id),
    fullName: r.fullName,
    email: r.email,
    note: r.note,
    addedAt: r.addedAt,
    payoutReady: r.payoutReady,
    onboardingUrl: r.onboardingUrl,
  };
  return config.isBitcoin ? { ...base, btcAddress: r.btcAddress } : { ...base, phone: r.phone };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const { payments } = getCollections();
    const history = await payments
      .find({ groupId: oid(req.recipient.groupId), recipientId: oid(req.recipient._id) })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({
      recipient: serializeSelf(req.recipient),
      payments: history.map((p) => ({
        id: String(p._id),
        amount: p.amountCents != null ? donations.dollars(p.amountCents) : undefined,
        status: p.status,
        txid: p.txid,
        transferId: p.transferId,
        createdAt: p.createdAt,
      })),
    });
  })
);

router.patch(
  '/',
  express.json(),
  wrap(async (req, res) => {
    const { recipients } = getCollections();
    const update = {};
    const body = req.body || {};
    if (typeof body.note === 'string') update.note = body.note.trim().slice(0, 2000);
    if (config.isBitcoin && typeof body.btcAddress === 'string' && body.btcAddress.trim().length >= 14) {
      update.btcAddress = body.btcAddress.trim();
    }
    if (config.isUsd && typeof body.phone === 'string') update.phone = body.phone.trim();
    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    await recipients.updateOne({ _id: oid(req.recipient._id) }, { $set: update });
    res.json({ ok: true });
  })
);

router.post(
  '/password',
  express.json(),
  wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const ok = await recipientAuthService.verifyLogin(req.recipient._id, currentPassword);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    await recipientAuthService.setPassword(req.recipient._id, newPassword);
    res.json({ ok: true });
  })
);

module.exports = router;
