'use strict';

/**
 * Signing + chain-read facade for one Bitcoin wallet. Ported from
 * Stage/UBIO's src/wallet/index.js, generalized into a factory: single-mode
 * has exactly one wallet (built from WALLET_ADDRESS/WALLET_PRIVATE_KEY),
 * federated mode has one per group (built from the group's own generated
 * keypair — see keygen.js). Signing happens only here and nowhere else,
 * same as the original.
 */

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const config = require('../../config');
const esplora = require('./esplora');

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

// Required regardless of rail (see esplora.js's comment on the same); falls
// back to testnet when not on the bitcoin rail, where this value is unused.
const NETWORK =
  config.isBitcoin && config.btc.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;

function walletFor({ address, privateKeyWif }) {
  function keyPair() {
    return ECPair.fromWIF(privateKeyWif, NETWORK);
  }

  async function getSpendableUtxos() {
    return esplora.getSpendableUtxos(address);
  }

  async function getBalanceSats() {
    const utxos = await getSpendableUtxos();
    return utxos.reduce((sum, u) => sum + u.value, 0);
  }

  async function getFeeRateSatPerVByte() {
    return esplora.getFeeRateSatPerVByte();
  }

  /**
   * Build, sign and broadcast a single transaction spending ALL given UTXOs
   * into the given outputs ([{ address, valueSats }]). Returns the
   * broadcast txid. Assumes native segwit (P2WPKH).
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

  return {
    network: config.btc.network,
    receiveAddress: address,
    getBalanceSats,
    getSpendableUtxos,
    getFeeRateSatPerVByte,
    sendMany,
    getTransaction: esplora.getTransaction,
  };
}

// Single-mode convenience: the one wallet, built from env vars, exactly as
// Stage/UBIO's wallet module was. Only constructed on the bitcoin rail.
const defaultWallet =
  config.isSingle && config.isBitcoin
    ? walletFor({ address: config.btc.walletAddress, privateKeyWif: config.btc.walletPrivateKeyWif })
    : null;

module.exports = { walletFor, defaultWallet, NETWORK };
