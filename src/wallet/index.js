'use strict';

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const config = require('./../config');
const esplora = require('./esplora');

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

const NETWORK =
  config.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

function keyPair() {
  return ECPair.fromWIF(config.walletPrivateKeyWif, NETWORK);
}

async function getBalanceSats() {
  const utxos = await esplora.getSpendableUtxos(config.walletAddress);
  return utxos.reduce((sum, u) => sum + u.value, 0);
}

async function getSpendableUtxos() {
  return esplora.getSpendableUtxos(config.walletAddress);
}

async function getFeeRateSatPerVByte() {
  return esplora.getFeeRateSatPerVByte();
}

/**
 * Build, sign and broadcast a single transaction spending ALL given UTXOs into
 * the provided outputs ([{ address, valueSats }]). Returns the broadcast txid.
 *
 * Signing happens here and nowhere else. Assumes the wallet address is native
 * segwit (P2WPKH); adjust if you fund a different script type.
 */
async function sendMany(utxos, outputs) {
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  const kp = keyPair();
  const signer = {
    publicKey: Buffer.from(kp.publicKey),
    sign: (hash) => Buffer.from(kp.sign(hash)),
  };

  for (const u of utxos) {
    const prev = await esplora.getTxOut(u.txid, u.vout);
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: {
        script: Buffer.from(prev.scriptPubKeyHex, 'hex'),
        value: prev.value,
      },
    });
  }

  for (const o of outputs) {
    psbt.addOutput({ address: o.address, value: o.valueSats });
  }

  psbt.signAllInputs(signer);
  psbt.finalizeAllInputs();
  const rawHex = psbt.extractTransaction().toHex();
  return esplora.broadcast(rawHex);
}

module.exports = {
  network: config.network,
  receiveAddress: config.walletAddress,
  getBalanceSats,
  getSpendableUtxos,
  getFeeRateSatPerVByte,
  sendMany,
  getTransaction: esplora.getTransaction,
};
