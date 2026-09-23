'use strict';

/**
 * Thin wrapper around an Esplora-compatible REST API (Blockstream by
 * default). Ported from Stage/UBIO's src/wallet/esplora.js, unchanged except
 * that the base URL is passed in rather than read from a single global
 * config — federated mode has one Esplora base URL but many wallets.
 */

const config = require('../../config');

// This whole module is only meaningfully used on the bitcoin rail, but it's
// required unconditionally by wallet.js (loaded regardless of rail so
// services/groups.js can reference walletFor/keygen without branching at
// require-time) — so this must not throw when config.btc is undefined.
const BASE = config.isBitcoin ? config.btc.esploraBaseUrl.replace(/\/$/, '') : null;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Esplora GET ${path} -> ${res.status} ${body}`);
  }
  return res;
}

// Confirmed UTXOs only — never spend unconfirmed donations.
async function getSpendableUtxos(address) {
  const res = await get(`/address/${address}/utxo`);
  const utxos = await res.json();
  return utxos
    .filter((u) => u.status && u.status.confirmed)
    .map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
}

// sat/vByte. Esplora returns {targetBlocks: feeRate}; aim for ~3 blocks,
// floor at 1 to stay above the relay minimum.
async function getFeeRateSatPerVByte() {
  const res = await get('/fee-estimates');
  const est = await res.json();
  const rate = est['3'] || est['6'] || est['1'] || 1;
  return Math.max(1, Math.ceil(rate));
}

// For segwit signing we need each input's previous output script + value.
async function getTxOut(txid, vout) {
  const res = await get(`/tx/${txid}`);
  const tx = await res.json();
  const out = tx.vout[vout];
  return { scriptPubKeyHex: out.scriptpubkey, value: out.value };
}

async function broadcast(rawTxHex) {
  const res = await fetch(`${BASE}/tx`, { method: 'POST', body: rawTxHex });
  const text = await res.text();
  if (!res.ok) throw new Error(`Broadcast failed -> ${res.status} ${text}`);
  return text.trim(); // txid
}

async function getTransaction(txid) {
  try {
    const res = await get(`/tx/${txid}`);
    return await res.json();
  } catch {
    return null; // not found / not yet propagated
  }
}

module.exports = {
  getSpendableUtxos,
  getFeeRateSatPerVByte,
  getTxOut,
  broadcast,
  getTransaction,
};
