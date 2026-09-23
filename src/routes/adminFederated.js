'use strict';

/**
 * Admin routes, federated mode — group resolved from a bearer JWT, exactly
 * Lab/2's shape (/api/admin/...). Adds one endpoint Lab/2 didn't have:
 * POST /api/admin/distribute, a manual trigger, for API/UI parity with the
 * single-mode admin panel and to satisfy "everything in the UI is also
 * available via the API" once the UI grows a "distribute now" button.
 */

const express = require('express');
const config = require('../config');
const { getCollections, oid } = require('../db');
const groupsService = require('../services/groups');
const recipients = require('../services/recipients');
const donations = require('../services/donations');
const distribution = require('../services/distribution');
const { requireAdmin } = require('../auth/admin');

const router = express.Router();
router.use(express.json());
router.use(requireAdmin());
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  '/balance',
  wrap(async (req, res) => {
    const { group_meta } = getCollections();
    const meta = await group_meta.findOne({ groupId: oid(req.group._id) });
    const list = await recipients.listRecipients(req.group._id);
    const base = { name: req.group.name, slug: req.group.slug, recipientCount: list.length };
    if (config.isBitcoin) {
      let balanceSats = null;
      try {
        balanceSats = await groupsService.walletForGroup(req.group).getBalanceSats();
      } catch {
        // hiccup
      }
      return res.json({ ...base, network: config.btc.network, donationAddress: req.group.btc.address, balanceSats });
    }
    const { payments } = getCollections();
    const agg = await payments
      .aggregate([
        { $match: { groupId: oid(req.group._id), status: { $in: ['paid', 'queued', 'sent'] } } },
        { $group: { _id: null, total: { $sum: '$amountCents' } } },
      ])
      .toArray();
    res.json({
      ...base,
      balance: donations.dollars(meta.balanceCents),
      payoutUnit: donations.dollars((req.group.roundThreshold || 1) * 100),
      totalPaidOut: donations.dollars(agg.length ? agg[0].total : 0),
    });
  })
);

function serializeRecipient(r) {
  const base = { id: String(r._id), email: r.email, note: r.note, createdAt: r.addedAt };
  if (config.isBitcoin) return { ...base, fullName: r.fullName, btcAddress: r.btcAddress };
  return { ...base, phone: r.phone, payoutReady: r.payoutReady, hasAccount: Boolean(r.accountRef) };
}

router.get(
  '/subscribers',
  wrap(async (req, res) => {
    res.json((await recipients.listRecipients(req.group._id)).map(serializeRecipient));
  })
);

router.post(
  '/subscribers',
  wrap(async (req, res) => {
    const result = await recipients.addRecipient(req.group, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({
      id: String(result.recipientId),
      onboardingUrl: result.onboardingUrl,
      loginPassword: result.loginPassword,
      message: 'Recipient added. Share the onboarding link/credentials so they can receive funds.',
    });
  })
);

router.delete(
  '/subscribers/:id',
  wrap(async (req, res) => {
    const removed = await recipients.removeRecipient(req.group._id, req.params.id).catch(() => false);
    if (!removed) return res.status(404).json({ error: 'No such recipient in this group.' });
    res.json({ ok: true });
  })
);

router.get(
  '/transactions',
  wrap(async (req, res) => {
    const { payments } = getCollections();
    const [txns, recipientList] = await Promise.all([
      payments.find({ groupId: oid(req.group._id) }).sort({ createdAt: -1 }).toArray(),
      recipients.listRecipients(req.group._id),
    ]);
    const byId = new Map(recipientList.map((r) => [String(r._id), r]));
    res.json(
      txns.map((t) => {
        const r = t.recipientId ? byId.get(String(t.recipientId)) : null;
        return {
          id: String(t._id),
          recipient: r ? r.email : t.recipientId ? '(removed recipient)' : null,
          outputs: t.outputs,
          amount: t.amountCents != null ? donations.dollars(t.amountCents) : undefined,
          transferId: t.transferId,
          txid: t.txid,
          status: t.status,
          createdAt: t.createdAt,
        };
      })
    );
  })
);

if (config.isUsd) {
  router.get(
    '/donations',
    wrap(async (req, res) => {
      const list = await donations.listDonations(req.group._id);
      res.json(
        list.map((d) => ({
          id: String(d._id),
          amount: donations.dollars(d.amountCents),
          providerRef: d.providerRef,
          status: d.status,
          createdAt: d.createdAt,
        }))
      );
    })
  );
}

router.post(
  '/distribute',
  wrap(async (req, res) => {
    res.json(await distribution.forceRunGroup(req.group));
  })
);

module.exports = router;
