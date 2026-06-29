'use strict';

const { MongoClient } = require('mongodb');
const config = require('./config');

let client;
let db;

const collections = {};

async function connect() {
  if (db) return db;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db(config.dbName);

  // "Any requisite contents of the Mongo database not found on execution shall
  // be created dynamically." Collections are created lazily by Mongo on first
  // write, but we ensure indexes and the singleton meta doc up front.
  collections.payees = db.collection('payees');
  collections.applications = db.collection('applications');
  collections.payments = db.collection('payments');
  collections.meta = db.collection('meta');

  await collections.payees.createIndex({ email: 1 }, { unique: true });
  await collections.applications.createIndex({ createdAt: 1 });
  // Idempotency: at most one payment record per distribution cycle.
  await collections.payments.createIndex({ cycleId: 1 }, { unique: true });

  await collections.meta.updateOne(
    { _id: 'scheduler' },
    {
      $setOnInsert: {
        _id: 'scheduler',
        lastDistribution: null, // set on first run; first payout is next cycle
        locked: false,
        lockedAt: null,
      },
    },
    { upsert: true }
  );

  return db;
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

module.exports = { connect, getCollections, close };
