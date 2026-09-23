'use strict';

/**
 * Config validation test. Each case spawns a fresh Node process (config.js
 * is a require-time singleton, so in-process re-requiring with different
 * env vars wouldn't actually re-evaluate it) that requires src/config.js
 * with a specific environment and reports whether it threw.
 */

const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config.js');

function tryLoad(env) {
  // Merge over process.env (not replace it) so Windows/Unix still have what
  // they need to spawn node at all (PATH, SystemRoot, ...).
  const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(CONFIG_PATH)})`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: res.status, stderr: res.stderr || '' };
}

const BASE = { MONGO_URI: 'mongodb://127.0.0.1:27017', JWT_SECRET: 'x' };

let pass = 0;
function ok(label) {
  pass += 1;
  console.log(`  ok  - ${label}`);
}

// single + bitcoin, fully configured -> loads fine
{
  const r = tryLoad({
    ...BASE,
    PAYMENT_RAIL: 'bitcoin',
    PLATFORM_MODE: 'single',
    ADMIN_PASSWORD: 'secret',
    INSTITUTION_NAME: 'Test Mutual Aid',
    WALLET_ADDRESS: 'tb1qexampleaddress',
    WALLET_PRIVATE_KEY: 'cTexampleWIF',
  });
  assert.strictEqual(r.code, 0, `expected clean load, got: ${r.stderr}`);
  ok('single + bitcoin, fully configured -> loads');
}

// federated + stripe (mock), no wallet vars needed -> loads fine
{
  const r = tryLoad({ ...BASE, PAYMENT_RAIL: 'stripe', PLATFORM_MODE: 'federated', STRIPE_MOCK: 'true' });
  assert.strictEqual(r.code, 0, `expected clean load, got: ${r.stderr}`);
  ok('federated + stripe (mock) -> loads with no wallet vars');
}

// federated + paypal (mock) -> loads fine
{
  const r = tryLoad({ ...BASE, PAYMENT_RAIL: 'paypal', PLATFORM_MODE: 'federated', PAYPAL_MOCK: 'true' });
  assert.strictEqual(r.code, 0, `expected clean load, got: ${r.stderr}`);
  ok('federated + paypal (mock) -> loads');
}

// single + bitcoin missing WALLET_ADDRESS -> throws
{
  const r = tryLoad({
    ...BASE,
    PAYMENT_RAIL: 'bitcoin',
    PLATFORM_MODE: 'single',
    ADMIN_PASSWORD: 'secret',
    INSTITUTION_NAME: 'Test',
  });
  assert.notStrictEqual(r.code, 0);
  assert.ok(/WALLET_ADDRESS/.test(r.stderr));
  ok('single + bitcoin without WALLET_ADDRESS -> rejected');
}

// single mode missing ADMIN_PASSWORD -> throws
{
  const r = tryLoad({
    ...BASE,
    PAYMENT_RAIL: 'stripe',
    PLATFORM_MODE: 'single',
    STRIPE_MOCK: 'true',
    INSTITUTION_NAME: 'Test',
  });
  assert.notStrictEqual(r.code, 0);
  assert.ok(/ADMIN_PASSWORD/.test(r.stderr));
  ok('single mode without ADMIN_PASSWORD -> rejected');
}

// federated mode does not require ADMIN_PASSWORD or INSTITUTION_NAME
{
  const r = tryLoad({ ...BASE, PAYMENT_RAIL: 'bitcoin', PLATFORM_MODE: 'federated' });
  assert.strictEqual(r.code, 0, `expected clean load, got: ${r.stderr}`);
  ok('federated + bitcoin -> loads without a global wallet or admin password');
}

// mainnet without the explicit override -> throws
{
  const r = tryLoad({
    ...BASE,
    PAYMENT_RAIL: 'bitcoin',
    PLATFORM_MODE: 'single',
    ADMIN_PASSWORD: 'secret',
    INSTITUTION_NAME: 'Test',
    WALLET_ADDRESS: 'bc1qexample',
    WALLET_PRIVATE_KEY: 'Kexample',
    BTC_NETWORK: 'mainnet',
  });
  assert.notStrictEqual(r.code, 0);
  assert.ok(/I_UNDERSTAND_MAINNET_RISK/.test(r.stderr));
  ok('mainnet without I_UNDERSTAND_MAINNET_RISK -> rejected');
}

// mainnet with the override -> loads
{
  const r = tryLoad({
    ...BASE,
    PAYMENT_RAIL: 'bitcoin',
    PLATFORM_MODE: 'single',
    ADMIN_PASSWORD: 'secret',
    INSTITUTION_NAME: 'Test',
    WALLET_ADDRESS: 'bc1qexample',
    WALLET_PRIVATE_KEY: 'Kexample',
    BTC_NETWORK: 'mainnet',
    I_UNDERSTAND_MAINNET_RISK: 'yes',
  });
  assert.strictEqual(r.code, 0, `expected clean load, got: ${r.stderr}`);
  ok('mainnet with I_UNDERSTAND_MAINNET_RISK=yes -> loads');
}

// invalid PAYMENT_RAIL -> throws
{
  const r = tryLoad({ ...BASE, PAYMENT_RAIL: 'dogecoin', PLATFORM_MODE: 'single' });
  assert.notStrictEqual(r.code, 0);
  assert.ok(/PAYMENT_RAIL/.test(r.stderr));
  ok('invalid PAYMENT_RAIL -> rejected');
}

// invalid PLATFORM_MODE -> throws
{
  const r = tryLoad({ ...BASE, PAYMENT_RAIL: 'bitcoin', PLATFORM_MODE: 'communal' });
  assert.notStrictEqual(r.code, 0);
  assert.ok(/PLATFORM_MODE/.test(r.stderr));
  ok('invalid PLATFORM_MODE -> rejected');
}

console.log(`\nAll ${pass} checks passed.`);
