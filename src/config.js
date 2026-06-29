'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function optional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

const network = optional('BTC_NETWORK', 'testnet').toLowerCase();
if (!['testnet', 'mainnet'].includes(network)) {
  throw new Error(`BTC_NETWORK must be "testnet" or "mainnet", got "${network}"`);
}

// Mainnet moves real money. Require an explicit, separate acknowledgement so
// nobody points this at real funds by leaving a default in place.
if (network === 'mainnet' && optional('I_UNDERSTAND_MAINNET_RISK', 'no') !== 'yes') {
  throw new Error(
    'BTC_NETWORK=mainnet refused. This template keeps the wallet private key in ' +
      'plaintext env and runs next to a public web surface — unsafe for real funds ' +
      'without a proper custody story. Set I_UNDERSTAND_MAINNET_RISK=yes to override.'
  );
}

const config = {
  network, // 'testnet' | 'mainnet'
  port: parseInt(optional('PORT', '3000'), 10),

  mongoUri: required('MONGO_URI'),
  dbName: required('MONGO_DB_NAME'),

  walletAddress: required('WALLET_ADDRESS'), // public receive address
  walletPrivateKeyWif: required('WALLET_PRIVATE_KEY'), // WIF — NOT an "address"

  adminPassword: required('ADMIN_PASSWORD'), // also the API bearer token (per spec)
  institutionName: required('INSTITUTION_NAME'),

  // Cadence. The spec named neither of these in its env list — both added.
  distributionIntervalMs: parseInt(optional('DISTRIBUTION_INTERVAL_MS', String(7 * 24 * 3600 * 1000)), 10),
  schedulerTickMs: parseInt(optional('SCHEDULER_TICK_MS', String(60 * 1000)), 10),

  // Esplora-compatible REST API (Blockstream by default). Swap for your own.
  esploraBaseUrl: optional(
    'ESPLORA_BASE_URL',
    network === 'mainnet' ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api'
  ),

  sessionSecret: optional('SESSION_SECRET', required('ADMIN_PASSWORD')),
};

module.exports = config;
