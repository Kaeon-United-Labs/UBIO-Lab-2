'use strict';

/**
 * A minimal in-memory stand-in for a MongoDB collection — just enough of the
 * driver's surface (findOne/find().sort().toArray()/insertOne/updateOne/
 * deleteOne) for the real service code to run against in tests, with no
 * MongoDB required. Equality-only filters, $set/$inc updates.
 */

const { ObjectId } = require('mongodb');

function isEqual(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return String(a) === String(b);
}

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => isEqual(doc[k], v));
}

function applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      doc[k] = (doc[k] || 0) + v;
    }
  }
  if (update.$setOnInsert) {
    // only meaningful combined with upsert; handled in updateOne below
  }
}

class FakeCollection {
  constructor(seed = []) {
    this.docs = seed;
  }

  async findOne(filter) {
    return this.docs.find((d) => matches(d, filter)) || null;
  }

  find(filter) {
    const self = this;
    let sortSpec = null;
    const api = {
      sort(spec) {
        sortSpec = spec;
        return api;
      },
      async toArray() {
        let out = self.docs.filter((d) => matches(d, filter));
        if (sortSpec) {
          const [key, dir] = Object.entries(sortSpec)[0];
          out = out
            .slice()
            .sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * dir);
        }
        return out;
      },
    };
    return api;
  }

  async insertOne(doc) {
    const _id = doc._id || new ObjectId();
    const withId = { ...doc, _id };
    this.docs.push(withId);
    return { insertedId: _id };
  }

  async updateOne(filter, update, options = {}) {
    let doc = this.docs.find((d) => matches(d, filter));
    if (!doc && options.upsert) {
      doc = { ...filter, ...(update.$setOnInsert || {}) };
      this.docs.push(doc);
    }
    if (!doc) return { matchedCount: 0 };
    applyUpdate(doc, update);
    return { matchedCount: 1 };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const before = this.docs.find((d) => matches(d, filter));
    if (!before) return { value: null };
    const snapshot = { ...before };
    applyUpdate(before, update);
    return { value: options.returnDocument === 'after' ? before : snapshot };
  }

  async deleteOne(filter) {
    const idx = this.docs.findIndex((d) => matches(d, filter));
    if (idx === -1) return { deletedCount: 0 };
    this.docs.splice(idx, 1);
    return { deletedCount: 1 };
  }

  async createIndex() {
    return null;
  }
}

function makeFakeCollections(names) {
  const out = {};
  for (const name of names) out[name] = new FakeCollection();
  return out;
}

module.exports = { FakeCollection, makeFakeCollections };
