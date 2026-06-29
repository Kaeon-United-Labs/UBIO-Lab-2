'use strict';

const assert = require('assert');
const { planDistribution, estimateFeeSats } = require('../src/services/distribution-math');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

// Conservation invariant: outputs + fee must equal the inputs total exactly,
// or Bitcoin silently pays the difference to miners.
function assertConserves(plan, totalSats) {
  const outSum = plan.shares.reduce((a, b) => a + b, 0);
  assert.strictEqual(outSum, plan.distributableSats, 'shares must sum to distributable');
  assert.strictEqual(outSum + plan.feeSats, totalSats, 'outputs + fee must equal total inputs');
}

test('no payees -> skip', () => {
  const p = planDistribution({ totalSats: 1_000_000, payeeCount: 0, inputCount: 1, feeRateSatPerVByte: 10 });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'no_payees');
});

test('clean even split, no remainder', () => {
  const total = 1_000_000;
  const p = planDistribution({ totalSats: total, payeeCount: 7, inputCount: 3, feeRateSatPerVByte: 10 });
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.feeSats, estimateFeeSats({ inputCount: 3, outputCount: 7, feeRateSatPerVByte: 10 }));
  assert.ok(p.shares.every((s) => s === p.shares[0]), 'all shares equal when remainder is 0');
  assertConserves(p, total);
});

test('remainder distributed as +1 sat to first payees', () => {
  const total = 1_000_000;
  const p = planDistribution({ totalSats: total, payeeCount: 3, inputCount: 1, feeRateSatPerVByte: 10 });
  assert.strictEqual(p.ok, true);
  // max inequality is a single satoshi
  assert.strictEqual(Math.max(...p.shares) - Math.min(...p.shares), p.remainderSats > 0 ? 1 : 0);
  // exactly `remainder` payees got the extra sat
  const extra = p.shares.filter((s) => s === p.baseShareSats + 1).length;
  assert.strictEqual(extra, p.remainderSats);
  assertConserves(p, total);
});

test('insufficient funds: fee exceeds balance', () => {
  const p = planDistribution({ totalSats: 5_000, payeeCount: 20, inputCount: 1, feeRateSatPerVByte: 10 });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'insufficient_funds');
});

test('sub-dust: positive distributable but per-share below dust -> skip, carry on-chain', () => {
  const p = planDistribution({ totalSats: 20_000, payeeCount: 35, inputCount: 1, feeRateSatPerVByte: 1 });
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.reason, 'sub_dust');
  assert.ok(p.baseShareSats < 546);
});

test('boundary: share exactly at dust threshold is allowed', () => {
  // engineer a case where baseShare === 546
  const payeeCount = 10;
  const inputCount = 1;
  const feeRate = 1;
  const fee = estimateFeeSats({ inputCount, outputCount: payeeCount, feeRateSatPerVByte: feeRate });
  const total = 546 * payeeCount + fee; // distributable = 5460, base = 546 exactly
  const p = planDistribution({ totalSats: total, payeeCount, inputCount, feeRateSatPerVByte: feeRate });
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.baseShareSats, 546);
  assertConserves(p, total);
});

test('large realistic round conserves to the satoshi', () => {
  const total = 5_000_000;
  const p = planDistribution({ totalSats: total, payeeCount: 137, inputCount: 12, feeRateSatPerVByte: 23 });
  assert.strictEqual(p.ok, true);
  assertConserves(p, total);
  assert.ok(p.shares.every((s) => s >= 546));
});

console.log(`\n${passed} tests passed.`);
