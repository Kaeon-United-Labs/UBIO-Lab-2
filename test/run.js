'use strict';

/**
 * Runs every test file in this directory in its own process (each test file
 * sets env vars / a fake db before requiring app code, so they can't safely
 * share a process). No MongoDB or network required for any of them.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const files = ['config.test.js', 'distribution-btc-math.test.js', 'distribution-usd.test.js'];

let failed = false;
for (const file of files) {
  console.log(`\n=== ${file} ===`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) failed = true;
}

if (failed) {
  console.error('\nSome tests failed.');
  process.exit(1);
} else {
  console.log('\nAll test files passed.');
}
