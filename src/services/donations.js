'use strict';

/**
 * USD donations (Stripe or PayPal). Not used on the bitcoin rail — there,
 * donations happen on-chain, straight to the wallet address shown on the
 * public page, with no processor and nothing to record locally.
 */

const { getCollections, oid } = require('../db');
const payments = require('../payments');

const dollars = (cents) => Math.round(cents) / 100;
const toCents = (value) => Math.round(Number(value) * 100);

async function creditPool(groupId, amountCents) {
  const { group_meta } = getCollections();
  await group_meta.updateOne({ groupId: oid(groupId) }, { $inc: { balanceCents: amountCents } });
}

async function debitPool(groupId, amountCents) {
  const { group_meta } = getCollections();
  await group_meta.updateOne({ groupId: oid(groupId) }, { $inc: { balanceCents: -amountCents } });
}

async function createDonation(group, rawAmount, urls = {}) {
  const amountCents = toCents(rawAmount);
  if (!Number.isFinite(amountCents) || amountCents < 100) {
    return { ok: false, error: 'Minimum donation is $1.00.' };
  }

  const intent = await payments.createDonationIntent({
    amountCents,
    groupSlug: group.slug,
    groupId: group._id,
    returnUrl: urls.returnUrl,
    cancelUrl: urls.cancelUrl,
  });

  const succeeded = intent.status === 'succeeded';
  const { donations } = getCollections();
  await donations.insertOne({
    groupId: oid(group._id),
    amountCents,
    providerRef: intent.id,
    status: succeeded ? 'succeeded' : 'pending',
    createdAt: new Date(),
  });
  if (succeeded) await creditPool(group._id, amountCents);

  const { group_meta } = getCollections();
  const meta = await group_meta.findOne({ groupId: oid(group._id) });

  return {
    ok: true,
    confirmed: succeeded,
    clientSecret: intent.clientSecret, // stripe
    redirectUrl: intent.redirectUrl, // paypal
    balance: dollars(meta.balanceCents),
  };
}

function getDonationByRef(providerRef) {
  const { donations } = getCollections();
  return donations.findOne({ providerRef });
}

async function markDonationSucceeded(providerRef) {
  const { donations } = getCollections();
  await donations.updateOne({ providerRef }, { $set: { status: 'succeeded' } });
}

function listDonations(groupId) {
  const { donations } = getCollections();
  return donations.find({ groupId: oid(groupId) }).sort({ createdAt: -1 }).toArray();
}

module.exports = {
  dollars,
  toCents,
  creditPool,
  debitPool,
  createDonation,
  getDonationByRef,
  markDonationSucceeded,
  listDonations,
};
