'use strict';

/**
 * Groups (institutions).
 *
 * Single mode: exactly one group exists, auto-created at boot from env vars
 * (ensureSingletonGroup). Group creation/listing endpoints are not mounted
 * in this mode at all — see routes/public.js.
 *
 * Federated mode: anyone may create a group (POST /api/groups), same as
 * Lab/2. If the payment rail is bitcoin, group creation also mints that
 * group its own receiving wallet, since (unlike single mode) there is no
 * one global WALLET_ADDRESS to share.
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const { getCollections, oid } = require('../db');
const bitcoinWallet = require('../payments/bitcoin/wallet');

const SINGLETON_SLUG = 'default';

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug);
}

async function ensureMeta(groupId) {
  const { group_meta } = getCollections();
  await group_meta.updateOne(
    { groupId: oid(groupId) },
    {
      $setOnInsert: {
        groupId: oid(groupId),
        lastDistribution: null,
        locked: false,
        lockedAt: null,
        // usd rails only:
        balanceCents: 0,
        payoutIndex: 0,
      },
    },
    { upsert: true }
  );
}

async function getMeta(groupId) {
  const { group_meta } = getCollections();
  return group_meta.findOne({ groupId: oid(groupId) });
}

/**
 * Idempotent: creates the one institution's group + meta doc the first time
 * the app boots in single mode, and is a no-op on every boot after that.
 */
async function ensureSingletonGroup() {
  const { groups } = getCollections();
  let group = await groups.findOne({ slug: SINGLETON_SLUG });
  if (!group) {
    const doc = {
      slug: SINGLETON_SLUG,
      name: config.institutionName,
      description: '',
      singleton: true,
      createdAt: new Date(),
    };
    if (config.isUsd) doc.roundThreshold = config.roundThreshold;
    // Bitcoin: no per-group wallet — the single global one from config is
    // used directly wherever a wallet is needed (see walletForGroup below).
    await groups.insertOne(doc);
    group = await groups.findOne({ slug: SINGLETON_SLUG });
  }
  await ensureMeta(group._id);
  return group;
}

async function createGroup({ name, slug, description, password, roundThreshold }) {
  if (!config.isFederated) {
    const err = new Error('This install is not federated — there is only one institution.');
    err.status = 400;
    throw err;
  }
  if (!name || !name.trim()) {
    const err = new Error('Give the group a name.');
    err.status = 400;
    throw err;
  }
  if (!isValidSlug(slug)) {
    const err = new Error('Address must be 3-50 characters: lowercase letters, numbers, and hyphens.');
    err.status = 400;
    throw err;
  }
  if (!password || password.length < 8) {
    const err = new Error('Admin password must be at least 8 characters.');
    err.status = 400;
    throw err;
  }

  const { groups } = getCollections();
  const doc = {
    slug,
    name: name.trim(),
    description: description || '',
    singleton: false,
    passwordHash: await bcrypt.hash(password, 12),
    createdAt: new Date(),
  };
  if (config.isUsd) doc.roundThreshold = Math.max(1, Math.floor(Number(roundThreshold) || 1));
  if (config.isBitcoin) {
    const { generateWallet } = require('../payments/bitcoin/keygen');
    const wallet = generateWallet();
    doc.btc = wallet; // { address, privateKeyWif }
  }

  let res;
  try {
    res = await groups.insertOne(doc);
  } catch (e) {
    if (e.code === 11000) {
      const err = new Error('That address is already taken.');
      err.status = 409;
      throw err;
    }
    throw e;
  }
  await ensureMeta(res.insertedId);
  return getGroupById(res.insertedId);
}

function getGroupById(id) {
  const { groups } = getCollections();
  return groups.findOne({ _id: oid(id) });
}

function getGroupBySlug(slug) {
  const { groups } = getCollections();
  return groups.findOne({ slug });
}

async function listGroups() {
  const { groups } = getCollections();
  return groups.find({}).sort({ createdAt: -1 }).toArray();
}

/** The one group in single mode — the whole app operates on it implicitly. */
async function getSingletonGroup() {
  return getGroupBySlug(SINGLETON_SLUG);
}

/** Resolves the wallet to use for a group's donations/payouts. */
function walletForGroup(group) {
  if (config.isSingle) return bitcoinWallet.defaultWallet;
  return bitcoinWallet.walletFor({ address: group.btc.address, privateKeyWif: group.btc.privateKeyWif });
}

module.exports = {
  SINGLETON_SLUG,
  isValidSlug,
  ensureMeta,
  getMeta,
  ensureSingletonGroup,
  createGroup,
  getGroupById,
  getGroupBySlug,
  listGroups,
  getSingletonGroup,
  walletForGroup,
};
