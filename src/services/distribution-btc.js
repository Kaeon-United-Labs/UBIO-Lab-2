'use strict';

/**
 * The bitcoin distribution engine. Ported from Stage/UBIO's
 * src/services/distribution.js, generalized from one global wallet/lock to
 * one per group — in single mode there's exactly one group, so this reduces
 * to exactly the original behavior; in federated mode, each group's whole
 * balance is split among its own recipients on its own clock.
 *
 * Per group: an atomic lock (so multiple processes/restarts can't double-
 * pay), an idempotent cycle record (a unique index on (groupId, cycleId)),
 * and crash reconciliation (ask the chain whether a 'broadcasting' cycle's
 * tx actually went out before doing anything else). Honest at-most-once
 * with reconciliation — true exactly-once across Bitcoin + Mongo is
 * impossible.
 */

const config = require('../config');
const { getCollections, oid } = require('../db');
const groupsService = require('../services/groups');
const recipients = require('./recipients');
const { planDistribution } = require('./distribution-btc-math');

const LOCK_STALE_MS = 10 * 60 * 1000;

async function claimRun(groupId) {
  const { group_meta } = getCollections();
  const now = Date.now();
  const staleBefore = new Date(now - LOCK_STALE_MS);

  const res = await group_meta.findOneAndUpdate(
    {
      groupId: oid(groupId),
      $or: [{ locked: false }, { locked: { $exists: false } }, { lockedAt: { $lt: staleBefore } }],
    },
    { $set: { locked: true, lockedAt: new Date(now) } },
    { returnDocument: 'before' }
  );
  const doc = res && (res.value !== undefined ? res.value : res);
  return { claimed: Boolean(doc), meta: doc };
}

async function releaseLock(groupId, { advanceTimestamp }) {
  const { group_meta } = getCollections();
  const update = { $set: { locked: false, lockedAt: null } };
  if (advanceTimestamp) update.$set.lastDistribution = new Date();
  await group_meta.updateOne({ groupId: oid(groupId) }, update);
}

function isDue(meta) {
  if (!meta.lastDistribution) return false; // first run just seeds the clock
  const elapsed = Date.now() - new Date(meta.lastDistribution).getTime();
  return elapsed >= config.distributionIntervalMs;
}

async function reconcilePending(groupId, cycleId, wallet) {
  const { payments } = getCollections();
  const pending = await payments.findOne({ groupId: oid(groupId), cycleId, status: 'broadcasting' });
  if (!pending) return;

  if (pending.txid) {
    const tx = await wallet.getTransaction(pending.txid);
    if (tx) {
      await payments.updateOne({ groupId: oid(groupId), cycleId }, { $set: { status: 'sent' } });
      return;
    }
  }
  await payments.updateOne({ groupId: oid(groupId), cycleId }, { $set: { status: 'failed' } });
}

async function runOnceForGroup(group, opts = {}) {
  const { claimed, meta } = await claimRun(group._id);
  if (!claimed) return { ran: false, reason: 'locked' };

  try {
    if (!meta.lastDistribution && !opts.force) {
      await releaseLock(group._id, { advanceTimestamp: true });
      return { ran: false, reason: 'seeded_clock' };
    }
    if (!opts.force && !isDue(meta)) {
      await releaseLock(group._id, { advanceTimestamp: false });
      return { ran: false, reason: 'not_due' };
    }

    const result = await executePayout(group);
    const advance = result.outcome !== 'send_error';
    await releaseLock(group._id, { advanceTimestamp: advance });
    return { ran: true, ...result };
  } catch (err) {
    await releaseLock(group._id, { advanceTimestamp: false });
    throw err;
  }
}

async function executePayout(group) {
  const { payments } = getCollections();
  const wallet = groupsService.walletForGroup(group);

  const cycleId = new Date().toISOString().slice(0, 19);
  await reconcilePending(group._id, cycleId, wallet);

  const recipientList = await recipients.listRecipients(group._id);
  if (recipientList.length === 0) return { outcome: 'skipped', reason: 'no_payees' };

  const utxos = await wallet.getSpendableUtxos();
  const totalSats = utxos.reduce((s, u) => s + u.value, 0);
  const feeRate = await wallet.getFeeRateSatPerVByte();

  const plan = planDistribution({
    totalSats,
    payeeCount: recipientList.length,
    inputCount: utxos.length,
    feeRateSatPerVByte: feeRate,
  });

  if (!plan.ok) return { outcome: 'skipped', reason: plan.reason, totalSats };

  const outputs = recipientList.map((r, i) => ({
    address: r.btcAddress,
    valueSats: plan.shares[i],
    email: r.email,
  }));

  try {
    await payments.insertOne({
      groupId: oid(group._id),
      cycleId,
      status: 'broadcasting',
      network: config.btc.network,
      totalSats,
      feeSats: plan.feeSats,
      distributableSats: plan.distributableSats,
      payeeCount: recipientList.length,
      outputs,
      txid: null,
      createdAt: new Date(),
    });
  } catch (err) {
    if (err.code === 11000) return { outcome: 'skipped', reason: 'cycle_already_recorded' };
    throw err;
  }

  let txid;
  try {
    txid = await wallet.sendMany(utxos, outputs);
  } catch (err) {
    await payments.updateOne(
      { groupId: oid(group._id), cycleId },
      { $set: { status: 'failed', error: String(err.message) } }
    );
    return { outcome: 'send_error', reason: String(err.message) };
  }

  await payments.updateOne({ groupId: oid(group._id), cycleId }, { $set: { status: 'sent', txid } });
  return { outcome: 'sent', txid, totalSats, feeSats: plan.feeSats, payeeCount: recipientList.length };
}

/** Runs one cycle for every group (one group, in single mode). */
async function runCycle() {
  const groups = await groupsService.listGroups();
  const results = [];
  for (const group of groups) {
    try {
      results.push({ slug: group.slug, ...(await runOnceForGroup(group)) });
    } catch (err) {
      results.push({ slug: group.slug, ran: false, reason: 'error', error: err.message });
    }
  }
  return results;
}

module.exports = { runOnceForGroup, runCycle, executePayout, claimRun, LOCK_STALE_MS };
