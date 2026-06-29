'use strict';

const config = require('../config');
const { getCollections } = require('../db');
const wallet = require('../wallet');
const { planDistribution } = require('./distribution-math');

// A lock older than this is presumed abandoned by a crashed worker and may be
// reclaimed. Must comfortably exceed how long a real payout takes.
const LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * Try to atomically claim the right to run a distribution. Exactly one caller
 * across any number of processes can win, because the update is a single
 * conditional findOneAndUpdate on the singleton meta document.
 *
 * Returns { claimed, meta } — meta is the pre-claim document when claimed.
 */
async function claimRun() {
  const { meta } = getCollections();
  const now = Date.now();
  const staleBefore = new Date(now - LOCK_STALE_MS);

  const res = await meta.findOneAndUpdate(
    {
      _id: 'scheduler',
      $or: [{ locked: false }, { locked: { $exists: false } }, { lockedAt: { $lt: staleBefore } }],
    },
    { $set: { locked: true, lockedAt: new Date(now) } },
    { returnDocument: 'before' }
  );

  const doc = res && (res.value !== undefined ? res.value : res);
  return { claimed: Boolean(doc), meta: doc };
}

async function releaseLock({ advanceTimestamp }) {
  const { meta } = getCollections();
  const update = { $set: { locked: false, lockedAt: null } };
  if (advanceTimestamp) update.$set.lastDistribution = new Date();
  await meta.updateOne({ _id: 'scheduler' }, update);
}

function isDue(meta) {
  if (!meta.lastDistribution) return false; // first run seeds the clock only
  const elapsed = Date.now() - new Date(meta.lastDistribution).getTime();
  return elapsed >= config.distributionIntervalMs;
}

/**
 * Before sending anything, look for a payment record for this cycle that was
 * left in 'broadcasting' state by a crash. If found, ask the network whether
 * its tx actually made it out. This is the at-most-once guard across the
 * two-system (Bitcoin + Mongo) boundary — true exactly-once is impossible, so
 * we reconcile instead of blindly re-sending.
 */
async function reconcilePending(cycleId) {
  const { payments } = getCollections();
  const pending = await payments.findOne({ cycleId, status: 'broadcasting' });
  if (!pending) return { resolved: false };

  if (pending.txid) {
    const tx = await wallet.getTransaction(pending.txid);
    if (tx) {
      await payments.updateOne({ cycleId }, { $set: { status: 'sent' } });
      return { resolved: true, alreadySent: true };
    }
  }
  // No txid recorded, or tx never propagated. Mark failed so a fresh attempt
  // can proceed; the funds are demonstrably still in the wallet.
  await payments.updateOne({ cycleId }, { $set: { status: 'failed' } });
  return { resolved: false };
}

/**
 * Run one distribution if due. Safe to call concurrently — only the lock winner
 * does work.
 *
 * @param {{ force?: boolean }} opts  force bypasses the interval check (manual trigger)
 */
async function runOnce(opts = {}) {
  const { claimed, meta } = await claimRun();
  if (!claimed) return { ran: false, reason: 'locked' };

  try {
    if (!meta.lastDistribution && !opts.force) {
      // First ever run: seed the clock, pay nothing this cycle.
      await releaseLock({ advanceTimestamp: true });
      return { ran: false, reason: 'seeded_clock' };
    }

    if (!opts.force && !isDue(meta)) {
      await releaseLock({ advanceTimestamp: false });
      return { ran: false, reason: 'not_due' };
    }

    const result = await executePayout();

    // Deliberate skips (no payees / insufficient / sub-dust) advance the clock
    // so we wait a full interval before retrying rather than hammering every
    // tick. Transient send failures do NOT advance — we want a prompt retry.
    const advance = result.outcome !== 'send_error';
    await releaseLock({ advanceTimestamp: advance });
    return { ran: true, ...result };
  } catch (err) {
    await releaseLock({ advanceTimestamp: false });
    throw err;
  }
}

async function executePayout() {
  const { payees, payments } = getCollections();

  const cycleId = new Date().toISOString().slice(0, 19); // one record per cycle
  await reconcilePending(cycleId);

  const payeeList = await payees.find({}).sort({ addedAt: 1 }).toArray();
  if (payeeList.length === 0) return { outcome: 'skipped', reason: 'no_payees' };

  const utxos = await wallet.getSpendableUtxos();
  const totalSats = utxos.reduce((s, u) => s + u.value, 0);
  const feeRate = await wallet.getFeeRateSatPerVByte();

  const plan = planDistribution({
    totalSats,
    payeeCount: payeeList.length,
    inputCount: utxos.length,
    feeRateSatPerVByte: feeRate,
  });

  if (!plan.ok) return { outcome: 'skipped', reason: plan.reason, totalSats };

  const outputs = payeeList.map((p, i) => ({
    address: p.btcAddress,
    valueSats: plan.shares[i],
    email: p.email,
  }));

  // Write an idempotent cycle record BEFORE broadcasting. The unique index on
  // cycleId means a duplicate concurrent attempt cannot create a second send.
  try {
    await payments.insertOne({
      cycleId,
      status: 'broadcasting',
      network: config.network,
      totalSats,
      feeSats: plan.feeSats,
      distributableSats: plan.distributableSats,
      payeeCount: payeeList.length,
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
    await payments.updateOne({ cycleId }, { $set: { status: 'failed', error: String(err.message) } });
    return { outcome: 'send_error', reason: String(err.message) };
  }

  await payments.updateOne({ cycleId }, { $set: { status: 'sent', txid } });
  return { outcome: 'sent', txid, totalSats, feeSats: plan.feeSats, payeeCount: payeeList.length };
}

module.exports = { runOnce, executePayout, claimRun, LOCK_STALE_MS };
