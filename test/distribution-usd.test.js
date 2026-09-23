'use strict';

/**
 * USD distribution algorithm test — exercises the REAL distribution-usd.js
 * code against an in-memory store, no MongoDB or network required. Adapted
 * from Lab/2's test/algorithm.js (same five scenarios); this project's
 * db.getCollections() indirection is stubbed via db._testConnect instead of
 * overriding query functions directly, but the algorithm under test is
 * unchanged.
 */

process.env.PAYMENT_RAIL = 'stripe';
process.env.PLATFORM_MODE = 'federated';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017';
process.env.JWT_SECRET = 'test-secret';
process.env.STRIPE_MOCK = 'true';

const assert = require('assert');
const { ObjectId } = require('mongodb');
const db = require('../src/db');
const { makeFakeCollections } = require('./support/fakeCollections');

const fake = makeFakeCollections(['group_meta', 'recipients', 'payments', 'groups', 'applications', 'donations', 'recipient_auth']);
db._testConnect(fake);

const { runGroupPayout } = require('../src/services/distribution-usd');

let pass = 0;
const ok = (label) => {
  pass += 1;
  console.log(`  ok  - ${label}`);
};

function seedGroup({ slug, roundThreshold }) {
  const _id = new ObjectId();
  const group = { _id, slug, name: slug, roundThreshold };
  fake.group_meta.docs.push({ groupId: _id, balanceCents: 0, payoutIndex: 0, locked: false, lastDistribution: null });
  return group;
}

function seedRecipient(group, { ready }) {
  const _id = new ObjectId();
  const recipient = {
    _id,
    groupId: group._id,
    email: `${_id}@x.test`,
    payoutReady: ready,
    accountRef: ready ? `acct_${_id}` : null,
  };
  fake.recipients.docs.push(recipient);
  return recipient;
}

function balanceOf(group) {
  return fake.group_meta.docs.find((m) => String(m.groupId) === String(group._id)).balanceCents;
}

(async () => {
  console.log('UBIO usd-rail distribution test (real distribution-usd.js, in-memory store)\n');

  // roundThreshold 1 -> payout unit = 100 cents
  const g = seedGroup({ slug: 'eastside', roundThreshold: 1 });
  const subs = [seedRecipient(g, { ready: true }), seedRecipient(g, { ready: true }), seedRecipient(g, { ready: true })];

  // Pool $10.00; units=10; numToPay=floor(10/2)=5; only 3 eligible
  fake.group_meta.docs.find((m) => String(m.groupId) === String(g._id)).balanceCents = 1000;
  let r = await runGroupPayout(g);
  assert.strictEqual(r.paid, 3);
  assert.strictEqual(balanceOf(g), 700);
  ok('cycle 1: pays all 3 eligible (one lap cap), pool 1000 -> 700');

  // Pool 700; units=7; numToPay=3
  r = await runGroupPayout(g);
  assert.strictEqual(r.paid, 3);
  assert.strictEqual(balanceOf(g), 400);
  ok('cycle 2: floor(units/2) buffer holds, pool 700 -> 400');

  // round-robin index persisted and wraps
  const meta = fake.group_meta.docs.find((m) => String(m.groupId) === String(g._id));
  assert.strictEqual(meta.payoutIndex, 6 % subs.length);
  ok('payout index advances and wraps round-robin');

  // never overdraw: tiny pool, big threshold
  const g2 = seedGroup({ slug: 'big', roundThreshold: 50 }); // unit $50 = 5000c
  seedRecipient(g2, { ready: true });
  fake.group_meta.docs.find((m) => String(m.groupId) === String(g2._id)).balanceCents = 4000; // < one unit
  r = await runGroupPayout(g2);
  assert.strictEqual(r.paid, 0);
  assert.strictEqual(balanceOf(g2), 4000);
  ok('pool below one payout unit pays nobody and is untouched');

  // skip un-onboarded recipients
  const g3 = seedGroup({ slug: 'mix', roundThreshold: 1 });
  const ready = seedRecipient(g3, { ready: true });
  const notReady = seedRecipient(g3, { ready: false });
  fake.group_meta.docs.find((m) => String(m.groupId) === String(g3._id)).balanceCents = 1000;
  await runGroupPayout(g3);
  const paidNotReady = fake.payments.docs.filter((t) => String(t.recipientId) === String(notReady._id) && t.status !== 'failed');
  const paidReady = fake.payments.docs.filter((t) => String(t.recipientId) === String(ready._id));
  assert.strictEqual(paidNotReady.length, 0);
  assert.ok(paidReady.length >= 1);
  ok('un-onboarded recipient skipped; onboarded one paid');

  // conservative invariant across many cycles: never negative
  const g4 = seedGroup({ slug: 'drain', roundThreshold: 1 });
  for (let i = 0; i < 5; i++) seedRecipient(g4, { ready: true });
  fake.group_meta.docs.find((m) => String(m.groupId) === String(g4._id)).balanceCents = 333; // odd amount
  for (let c = 0; c < 50; c++) await runGroupPayout(g4);
  assert.ok(balanceOf(g4) >= 0, 'pool must never go negative');
  ok(`50 cycles never overdraw the pool (final $${(balanceOf(g4) / 100).toFixed(2)})`);

  console.log(`\nAll ${pass} checks passed.`);
})().catch((e) => {
  console.error('\nFAILED:', e);
  process.exitCode = 1;
});
