'use strict';

/**
 * Public routes, federated mode — exactly Lab/2's shape (/api/groups...)
 * when PAYMENT_RAIL=stripe. Extended to the other two rails: bitcoin groups
 * show a donation address instead of taking a POST /donate, and PayPal
 * follows the same donate/subscribe shape as Stripe.
 */

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const groupsService = require('../services/groups');
const recipients = require('../services/recipients');
const donations = require('../services/donations');
const { signGroupAdminToken } = require('../auth/admin');
const { rateLimit } = require('../auth/rateLimit');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function publicGroup(group) {
  const meta = await groupsService.getMeta(group._id);
  const recipientList = await recipients.listRecipients(group._id);
  const base = {
    slug: group.slug,
    name: group.name,
    description: group.description,
    recipientCount: recipientList.length,
    createdAt: group.createdAt,
  };
  if (config.isBitcoin) {
    let balanceSats = null;
    try {
      balanceSats = await groupsService.walletForGroup(group).getBalanceSats();
    } catch {
      // hiccup shouldn't break the directory
    }
    return { ...base, network: config.btc.network, donationAddress: group.btc.address, balanceSats };
  }
  return {
    ...base,
    roundThreshold: group.roundThreshold,
    payoutUnit: donations.dollars((group.roundThreshold || 1) * 100),
    balance: donations.dollars(meta.balanceCents),
  };
}

router.get(
  '/api/groups',
  wrap(async (req, res) => {
    const groups = await groupsService.listGroups();
    res.json(await Promise.all(groups.map(publicGroup)));
  })
);

router.get(
  '/api/groups/:slug',
  wrap(async (req, res) => {
    const group = await groupsService.getGroupBySlug(req.params.slug);
    if (!group) return res.status(404).json({ error: 'No group with that address.' });
    res.json(await publicGroup(group));
  })
);

router.post(
  '/api/groups',
  express.json(),
  wrap(async (req, res) => {
    const { name, slug, description, password, roundThreshold } = req.body || {};
    const group = await groupsService.createGroup({ name, slug, description, password, roundThreshold });
    const token = signGroupAdminToken(group);
    res.status(201).json({ group: await publicGroup(group), token });
  })
);

// Subscribe/enroll — instant, no approval queue (federated mode delegates
// identity trust to the institution running the group).
router.post(
  '/api/groups/:slug/subscribe',
  express.json(),
  wrap(async (req, res) => {
    const group = await groupsService.getGroupBySlug(req.params.slug);
    if (!group) return res.status(404).json({ error: 'No group with that address.' });
    const result = await recipients.addRecipient(group, req.body || {});
    if (!result.ok) return res.status(result.error && result.error.includes('already') ? 409 : 400).json({ error: result.error });
    res.status(201).json({
      ok: true,
      onboardingUrl: result.onboardingUrl,
      loginPassword: result.loginPassword,
      message: config.isBitcoin
        ? 'Enrolled. You will receive funds on the next cycle.'
        : 'Enrolled. Finish payout setup to start receiving funds.',
    });
  })
);

if (config.isUsd) {
  router.post(
    '/api/groups/:slug/donate',
    express.json(),
    wrap(async (req, res) => {
      const group = await groupsService.getGroupBySlug(req.params.slug);
      if (!group) return res.status(404).json({ error: 'No group with that address.' });
      const returnUrl = `${config.publicUrl}/g/${group.slug}?donated=1`;
      const cancelUrl = `${config.publicUrl}/g/${group.slug}`;
      const result = await donations.createDonation(group, (req.body || {}).amount, { returnUrl, cancelUrl });
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.status(201).json(result);
    })
  );

  router.get(
    '/onboarding/return',
    wrap(async (req, res) => {
      const rid = req.query.rid || req.query.sub;
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

router.post(
  '/api/groups/:slug/login',
  express.json(),
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `${req.ip}:${req.params.slug}` }),
  wrap(async (req, res) => {
    const group = await groupsService.getGroupBySlug(req.params.slug);
    const { password } = req.body || {};
    const hash = group ? group.passwordHash : '$2a$12$0000000000000000000000000000000000000000000000000000';
    const ok = await bcrypt.compare(password || '', hash);
    if (!group || !ok) return res.status(401).json({ error: 'Wrong group address or password.' });
    res.json({ token: signGroupAdminToken(group), slug: group.slug, name: group.name });
  })
);

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// Friendly deep link to a group; the public page reads the slug from the path.
router.get('/g/:slug', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

router.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

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
