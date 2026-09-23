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

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return String(v).toLowerCase() !== 'false';
}

/* ── The two axes that determine everything else ──────────────────────
 *
 *   PAYMENT_RAIL   bitcoin | stripe | paypal   (stripe/paypal both mean USD)
 *   PLATFORM_MODE  single  | federated
 *
 * PAYMENT_RAIL=bitcoin + PLATFORM_MODE=single    -> behaves exactly like
 *                                                    Stage/UBIO.
 * PAYMENT_RAIL=stripe  + PLATFORM_MODE=federated -> behaves exactly like
 *                                                    Lab/2.
 * The other four combinations reuse the same engines and adapters.
 */

const paymentRail = optional('PAYMENT_RAIL', 'bitcoin').toLowerCase();
if (!['bitcoin', 'stripe', 'paypal'].includes(paymentRail)) {
  throw new Error(`PAYMENT_RAIL must be "bitcoin", "stripe", or "paypal", got "${paymentRail}"`);
}

const platformMode = optional('PLATFORM_MODE', 'single').toLowerCase();
if (!['single', 'federated'].includes(platformMode)) {
  throw new Error(`PLATFORM_MODE must be "single" or "federated", got "${platformMode}"`);
}

const currency = paymentRail === 'bitcoin' ? 'BTC' : 'USD';
const isFederated = platformMode === 'federated';
const isSingle = !isFederated;
const isUsd = currency === 'USD';
const isBitcoin = currency === 'BTC';

const config = {
  paymentRail, // 'bitcoin' | 'stripe' | 'paypal'
  platformMode, // 'single' | 'federated'
  currency, // 'BTC' | 'USD'
  isFederated,
  isSingle,
  isUsd,
  isBitcoin,

  port: parseInt(optional('PORT', '3000'), 10),
  publicUrl: optional('PUBLIC_URL', null), // filled in below once port is known

  mongoUri: required('MONGO_URI'),
  dbName: optional('MONGO_DB_NAME', 'ubio'),

  // JWT signs federated-mode admin tokens and recipient ("logged-in user")
  // tokens in both modes. No insecure default — this template is meant to be
  // deployed, and a shared guessable secret would let anyone mint tokens.
  jwtSecret: required('JWT_SECRET'),

  // Cadence: how often the scheduler checks the clock, and (for the two
  // engines) what "regular interval" means.
  schedulerTickMs: parseInt(optional('SCHEDULER_TICK_MS', String(60 * 1000)), 10),
  distributionIntervalMs: parseInt(
    optional('DISTRIBUTION_INTERVAL_MS', String(7 * 24 * 3600 * 1000)),
    10
  ), // bitcoin rail: whole-balance cycle length
  payoutIntervalMs: parseInt(optional('PAYOUT_INTERVAL_MS', String(60 * 1000)), 10), // usd rails: monitor tick
};

config.publicUrl = config.publicUrl || `http://localhost:${config.port}`;

/* ── Single-institution mode ───────────────────────────────────────────
 * One admin password for the whole install, one display name. Mirrors
 * Stage/UBIO exactly. Federated mode instead stores a password hash and a
 * name per group, set at group-creation time.
 */
if (isSingle) {
  config.adminPassword = required('ADMIN_PASSWORD'); // also the bearer token, per spec
  config.institutionName = required('INSTITUTION_NAME');
  config.sessionSecret = optional('SESSION_SECRET', config.adminPassword);
} else {
  config.sessionSecret = optional('SESSION_SECRET', config.jwtSecret);
}

/* ── Bitcoin rail ───────────────────────────────────────────────────── */
if (isBitcoin) {
  const network = optional('BTC_NETWORK', 'testnet').toLowerCase();
  if (!['testnet', 'mainnet'].includes(network)) {
    throw new Error(`BTC_NETWORK must be "testnet" or "mainnet", got "${network}"`);
  }
  if (network === 'mainnet' && optional('I_UNDERSTAND_MAINNET_RISK', 'no') !== 'yes') {
    throw new Error(
      'BTC_NETWORK=mainnet refused. This template keeps wallet private keys in plaintext ' +
        '(env for single-mode, the database for federated-mode group wallets) next to a ' +
        'public web surface — unsafe for real funds without a proper custody story. ' +
        'Set I_UNDERSTAND_MAINNET_RISK=yes to override.'
    );
  }
  config.btc = {
    network,
    esploraBaseUrl: optional(
      'ESPLORA_BASE_URL',
      network === 'mainnet' ? 'https://blockstream.info/api' : 'https://blockstream.info/testnet/api'
    ),
  };

  if (isSingle) {
    // One wallet for the one institution — identical to Stage/UBIO.
    config.btc.walletAddress = required('WALLET_ADDRESS');
    config.btc.walletPrivateKeyWif = required('WALLET_PRIVATE_KEY');
  }
  // In federated mode, each group gets its own wallet, generated at
  // group-creation time and stored on the group document (see
  // src/payments/bitcoin/keygen.js and src/services/groups.js).
}

/* ── Stripe rail ────────────────────────────────────────────────────── */
if (paymentRail === 'stripe') {
  config.stripe = {
    mock: bool('STRIPE_MOCK', true),
  };
  if (!config.stripe.mock) {
    config.stripe.secretKey = required('STRIPE_SECRET_KEY');
    config.stripe.webhookSecret = required('STRIPE_WEBHOOK_SECRET');
  }
}

/* ── PayPal rail ────────────────────────────────────────────────────── */
if (paymentRail === 'paypal') {
  config.paypal = {
    mock: bool('PAYPAL_MOCK', true),
    apiBase: optional('PAYPAL_API_BASE', 'https://api-m.sandbox.paypal.com'),
  };
  if (!config.paypal.mock) {
    config.paypal.clientId = required('PAYPAL_CLIENT_ID');
    config.paypal.clientSecret = required('PAYPAL_CLIENT_SECRET');
    config.paypal.webhookId = required('PAYPAL_WEBHOOK_ID');
  }
}

/* ── USD payout unit (both stripe and paypal) ──────────────────────────
 * Federated mode: each group sets its own roundThreshold at creation.
 * Single mode: one institution-wide value, read once at boot.
 */
if (isUsd && isSingle) {
  config.roundThreshold = Math.max(1, parseInt(optional('ROUND_THRESHOLD', '1'), 10));
}

module.exports = config;
