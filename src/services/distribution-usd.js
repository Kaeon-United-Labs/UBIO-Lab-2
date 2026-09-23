'use strict';

/**
 * The USD distribution engine (Stripe or PayPal — the payments adapter is
 * whichever PAYMENT_RAIL selected). Ported from Lab/2's monitor.js.
 *
 * Per group, per tick:
 *   1. payout_unit = $1.00 * roundThreshold.
 *   2. units = floor(balance / payout_unit).
 *   3. Pay floor(units / 2) recipients this cycle — paying at most half of
 *      what the pool could afford is deliberate: it keeps a buffer so the
 *      pool is never drained in one pass and later recipients in the
 *      rotation still get a turn as new donations arrive.
 *   4. Round-robin order from a persistent per-group index; at most one lap,
 *      so nobody is paid twice in a single cycle.
 *   5. Recipients who haven't finished payout onboarding (Stripe Connect) or
 *      have no payout destination on file yet are skipped.
 *
 * Federated mode runs this per group, independently, on the shared
 * PAYOUT_INTERVAL_MS tick. Single mode has exactly one group, so this is the
 * same algorithm running for the one institution.
 */

const { getCollections, oid } = require('../db');
const groupsService = require('./groups');
const recipients = require('./recipients');
const payments = require('../payments');

async function runGroupPayout(group) {
  const { group_meta } = getCollections();
  const meta = await group_meta.findOne({ groupId: oid(group._id) });
  if (!meta) return { paid: 0, totalCents: 0 };

  const unitCents = (group.roundThreshold || 1) * 100;
  const units = Math.floor(meta.balanceCents / unitCents);
  const numToPay = Math.floor(units / 2);
  if (numToPay <= 0) return { paid: 0, totalCents: 0 };

  const recipientList = await recipients.listRecipients(group._id);
  if (recipientList.length === 0) return { paid: 0, totalCents: 0 };

  const { payments: paymentsCol } = getCollections();
  let index = meta.payoutIndex || 0;
  let paid = 0;
  let totalCents = 0;

  for (let examined = 0; examined < recipientList.length && paid < numToPay; examined += 1) {
    const recipient = recipientList[index % recipientList.length];
    index += 1;

    if (!recipient.payoutReady || !recipient.accountRef) continue; // not onboarded — retry next cycle

    try {
      const transfer = await payments.createTransfer({
        amountCents: unitCents,
        accountRef: recipient.accountRef,
        groupSlug: group.slug,
      });
      await group_meta.updateOne({ groupId: oid(group._id) }, { $inc: { balanceCents: -unitCents } });
      await paymentsCol.insertOne({
        groupId: oid(group._id),
        recipientId: recipient._id,
        amountCents: unitCents,
        transferId: transfer.id,
        status: transfer.status,
        createdAt: new Date(),
      });
      paid += 1;
      totalCents += unitCents;
    } catch (err) {
      await paymentsCol.insertOne({
        groupId: oid(group._id),
        recipientId: recipient._id,
        amountCents: unitCents,
        transferId: null,
        status: 'failed',
        createdAt: new Date(),
      });
      console.error(`[distribution-usd] transfer failed for group ${group.slug}:`, err.message);
    }
  }

  await group_meta.updateOne({ groupId: oid(group._id) }, { $set: { payoutIndex: index % recipientList.length } });
  return { paid, totalCents };
}

async function runCycle() {
  const groups = await groupsService.listGroups();
  const results = [];
  for (const group of groups) {
    try {
      const result = await runGroupPayout(group);
      results.push({ slug: group.slug, ran: result.paid > 0, ...result });
    } catch (err) {
      results.push({ slug: group.slug, ran: false, reason: 'error', error: err.message });
    }
  }
  return results;
}

module.exports = { runGroupPayout, runCycle };
