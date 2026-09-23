'use strict';

/**
 * db.js — schema init and connection, shared by every mode/rail combination.
 *
 * Collections:
 *   groups        one document per institution. In single-institution mode
 *                 there is exactly one, auto-created at boot (see
 *                 services/groups.js#ensureSingletonGroup). In federated
 *                 mode, anyone can create one via the API.
 *   group_meta    scheduler/ledger state per group: lock fields (both rails),
 *                 lastDistribution (both rails), payoutIndex + balanceCents
 *                 (usd rails only — bitcoin's "balance" is read live from
 *                 the chain, so it isn't tracked here).
 *   recipients    people who receive payouts. Called "payees" in the
 *                 bitcoin/single-mode UI and "subscribers" in the usd/
 *                 federated-mode UI, per the source apps' own language, but
 *                 they're one collection with rail-appropriate fields.
 *   applications  pending recipient applications (single mode only — an
 *                 institution manually verifies identity before admitting
 *                 someone; federated mode instead has direct self-service
 *                 enrollment, per Lab/2, with no approval queue).
 *   donations     incoming donation records (usd rails only — bitcoin
 *                 donations are on-chain and need no local record).
 *   payments      outgoing payout records, one per bitcoin distribution
 *                 cycle or per usd transfer attempt.
 *   recipient_auth  a bcrypt-hashed login password per recipient, so a
 *                 recipient can authenticate as themselves (the "logged-in
 *                 user" API tier), separate from admin and anonymous access.
 */

const { MongoClient, ObjectId } = require('mongodb');
const config = require('./config');

let client;
let db;

const collections = {};

async function connect() {
  if (db) return db;
  client = new MongoClient(config.mongoUri, { ignoreUndefined: true });
  await client.connect();
  db = client.db(config.dbName);

  collections.groups = db.collection('groups');
  collections.group_meta = db.collection('group_meta');
  collections.recipients = db.collection('recipients');
  collections.applications = db.collection('applications');
  collections.donations = db.collection('donations');
  collections.payments = db.collection('payments');
  collections.recipient_auth = db.collection('recipient_auth');

  await ensureIndexes();
  return db;
}

async function ensureIndexes() {
  await collections.groups.createIndex({ slug: 1 }, { unique: true });
  await collections.group_meta.createIndex({ groupId: 1 }, { unique: true });
  // Duplicate identity is rejected *within a group* — the same email or
  // phone may belong to a recipient of more than one institution.
  await collections.recipients.createIndex({ groupId: 1, email: 1 }, { unique: true });
  await collections.recipients.createIndex(
    { groupId: 1, phone: 1 },
    { unique: true, partialFilterExpression: { phone: { $exists: true, $type: 'string' } } }
  );
  await collections.applications.createIndex({ groupId: 1, createdAt: 1 });
  await collections.donations.createIndex({ groupId: 1, createdAt: -1 });
  await collections.donations.createIndex({ providerRef: 1 });
  await collections.payments.createIndex({ groupId: 1, createdAt: -1 });
  // Idempotency for the bitcoin engine: at most one payment doc per
  // (group, cycleId).
  await collections.payments.createIndex(
    { groupId: 1, cycleId: 1 },
    { unique: true, partialFilterExpression: { cycleId: { $exists: true } } }
  );
  await collections.recipient_auth.createIndex({ recipientId: 1 }, { unique: true });
}

function oid(id) {
  return typeof id === 'string' ? new ObjectId(id) : id;
}

function getCollections() {
  if (!db) throw new Error('Database not connected. Call connect() first.');
  return collections;
}

async function close() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}

/**
 * Test-only seam: installs in-memory fake collections without a real Mongo
 * connection, so services can be unit-tested against the real business
 * logic. See test/support/fakeCollections.js.
 */
function _testConnect(fakeCollections) {
  db = {}; // truthy sentinel — getCollections() just checks this is set
  Object.assign(collections, fakeCollections);
}

module.exports = { connect, close, getCollections, oid, ObjectId, _testConnect };
