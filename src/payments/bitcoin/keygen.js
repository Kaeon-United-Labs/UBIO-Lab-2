'use strict';

/**
 * Generates a fresh receiving wallet for a federated-mode group. Each group
 * is its own institution with its own publicly-visible donation address, so
 * (unlike single mode, which reads one wallet from the environment) a new
 * keypair is minted when the group is created and stored on the group
 * document. Native segwit (P2WPKH), same script type the wallet/signing
 * code assumes everywhere else.
 */

const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const ecc = require('tiny-secp256k1');
const { NETWORK } = require('./wallet');

const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc);

function generateWallet() {
  const keyPair = ECPair.makeRandom({ network: NETWORK });
  const { address } = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(keyPair.publicKey),
    network: NETWORK,
  });
  return { address, privateKeyWif: keyPair.toWIF() };
}

module.exports = { generateWallet };
