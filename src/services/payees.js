'use strict';

const { getCollections } = require('../db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validApplication(body) {
  const errors = [];
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const btcAddress = String(body.btcAddress || '').trim();
  const note = String(body.note || '').trim();

  if (fullName.length < 1) errors.push('Full name is required.');
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  if (btcAddress.length < 14) errors.push('A valid BTC address is required.');
  if (note.length > 2000) errors.push('Note is too long (2000 character max).');

  return { ok: errors.length === 0, errors, value: { fullName, email, btcAddress, note } };
}

async function submitApplication(body) {
  const { ok, errors, value } = validApplication(body);
  if (!ok) return { ok: false, errors };
  const { applications } = getCollections();
  await applications.insertOne({ ...value, status: 'pending', createdAt: new Date() });
  return { ok: true };
}

async function listApplications() {
  const { applications } = getCollections();
  return applications.find({ status: 'pending' }).sort({ createdAt: 1 }).toArray();
}

async function listPayees() {
  const { payees } = getCollections();
  return payees.find({}).sort({ addedAt: 1 }).toArray();
}

async function addPayee({ fullName, email, btcAddress, note }) {
  const { payees } = getCollections();
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: 'Invalid email.' };
  if (!btcAddress || String(btcAddress).trim().length < 14) {
    return { ok: false, error: 'Invalid BTC address.' };
  }
  try {
    await payees.insertOne({
      fullName: String(fullName || '').trim(),
      email: normalized,
      btcAddress: String(btcAddress).trim(),
      note: String(note || '').trim(),
      addedAt: new Date(),
    });
    return { ok: true };
  } catch (err) {
    if (err.code === 11000) return { ok: false, error: 'A payee with that email already exists.' };
    throw err;
  }
}

async function approveApplication(id) {
  const { applications } = getCollections();
  const { ObjectId } = require('mongodb');
  const app = await applications.findOne({ _id: new ObjectId(id) });
  if (!app) return { ok: false, error: 'Application not found.' };
  const added = await addPayee(app);
  if (!added.ok) return added;
  await applications.updateOne({ _id: app._id }, { $set: { status: 'approved' } });
  return { ok: true };
}

async function rejectApplication(id) {
  const { applications } = getCollections();
  const { ObjectId } = require('mongodb');
  await applications.updateOne({ _id: new ObjectId(id) }, { $set: { status: 'rejected' } });
  return { ok: true };
}

async function removePayeeByEmail(email) {
  const { payees } = getCollections();
  const res = await payees.deleteOne({ email: String(email || '').trim().toLowerCase() });
  return { ok: res.deletedCount > 0 };
}

module.exports = {
  submitApplication,
  listApplications,
  listPayees,
  addPayee,
  approveApplication,
  rejectApplication,
  removePayeeByEmail,
};
