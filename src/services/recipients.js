'use strict';

/**
 * Recipients — people who receive payouts. Called "payees" in the source
 * bitcoin/single-mode app and "subscribers" in the source usd/federated-mode
 * app; this is the merger of Stage/UBIO's src/services/payees.js and Lab/2's
 * enrollment logic.
 *
 * Two admission workflows, selected by platform mode (not by rail):
 *
 *   single mode: apply -> pending application -> admin approves/rejects,
 *   the intention being manual, out-of-band identity verification (exactly
 *   Stage/UBIO's model). An admin may also add someone directly, skipping
 *   the queue (the "+ Add payee directly" affordance both apps' admin UIs
 *   already have).
 *
 *   federated mode: subscribe -> immediately a recipient (exactly Lab/2's
 *   model — the institution running the group already vets who it serves,
 *   so there's no separate approval step). The group's own admin can also
 *   add someone directly; it's the same enrollment function either way.
 *
 * What "becoming a recipient" also does depends on the rail:
 *   bitcoin: nothing further — the applicant already gave a receiving
 *            address, so they're payout-ready immediately.
 *   stripe:  a Connect Express account is created and an onboarding link
 *            generated; payoutReady flips true once onboarding completes.
 *   paypal:  nothing further — PayPal Payouts sends straight to the email
 *            given, so they're payout-ready immediately.
 */

const config = require('../config');
const { getCollections, oid } = require('../db');
const payments = require('../payments');
const recipientAuth = require('./recipientAuth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body) {
  const errors = [];
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const btcAddress = String(body.btcAddress || '').trim();
  const note = String(body.note || '').trim();

  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  if (note.length > 2000) errors.push('Note is too long (2000 character max).');

  if (config.isBitcoin) {
    if (fullName.length < 1) errors.push('Full name is required.');
    if (btcAddress.length < 14) errors.push('A valid BTC address is required.');
  } else {
    if (phone.length < 1) errors.push('A phone number is required.');
  }

  return { ok: errors.length === 0, errors, value: { fullName, email, phone, btcAddress, note } };
}

/* ─── Single mode: application queue ──────────────────────────────── */

async function submitApplication(group, body) {
  const { ok, errors, value } = validate(body);
  if (!ok) return { ok: false, errors };
  const { applications } = getCollections();
  await applications.insertOne({
    groupId: oid(group._id),
    ...value,
    status: 'pending',
    createdAt: new Date(),
  });
  return { ok: true };
}

async function listApplications(groupId) {
  const { applications } = getCollections();
  return applications.find({ groupId: oid(groupId), status: 'pending' }).sort({ createdAt: 1 }).toArray();
}

async function approveApplication(group, applicationId) {
  const { applications } = getCollections();
  const app = await applications.findOne({ _id: oid(applicationId), groupId: oid(group._id) });
  if (!app) return { ok: false, error: 'Application not found.' };
  const added = await addRecipient(group, app);
  if (!added.ok) return added;
  await applications.updateOne({ _id: app._id }, { $set: { status: 'approved' } });
  return added;
}

async function rejectApplication(group, applicationId) {
  const { applications } = getCollections();
  await applications.updateOne(
    { _id: oid(applicationId), groupId: oid(group._id) },
    { $set: { status: 'rejected' } }
  );
  return { ok: true };
}

/* ─── Both modes: enrollment ───────────────────────────────────────── */

async function addRecipient(group, body) {
  const { ok, errors, value } = validate(body);
  if (!ok) return { ok: false, error: errors[0], errors };

  const { recipients } = getCollections();
  const doc = {
    groupId: oid(group._id),
    fullName: value.fullName,
    email: value.email,
    note: value.note,
    accountRef: null,
    onboardingUrl: null,
    payoutReady: false,
    addedAt: new Date(),
  };
  if (config.isBitcoin) {
    doc.btcAddress = value.btcAddress;
    doc.payoutReady = true; // an address is all a bitcoin payout needs
  } else {
    doc.phone = value.phone;
  }

  let res;
  try {
    res = await recipients.insertOne(doc);
  } catch (e) {
    if (e.code === 11000) {
      return { ok: false, error: 'A recipient with that email or phone already exists.' };
    }
    throw e;
  }
  const recipientId = res.insertedId;

  let onboardingUrl = null;
  if (config.isUsd) {
    const returnUrl = `${config.publicUrl}/onboarding/return?rid=${recipientId}`;
    const refreshUrl = `${config.publicUrl}/g/${group.slug}`;
    const enrolled = await payments.enrollPayoutRecipient({ email: value.email, returnUrl, refreshUrl });
    await recipients.updateOne(
      { _id: recipientId },
      {
        $set: {
          accountRef: enrolled.accountRef,
          onboardingUrl: enrolled.onboardingUrl,
          payoutReady: enrolled.payoutReady,
        },
      }
    );
    onboardingUrl = enrolled.onboardingUrl;
  }

  const loginPassword = await recipientAuth.issueCredentials(recipientId, { email: value.email });

  return { ok: true, recipientId, onboardingUrl, loginPassword };
}

function listRecipients(groupId) {
  const { recipients } = getCollections();
  return recipients.find({ groupId: oid(groupId) }).sort({ addedAt: 1 }).toArray();
}

function getRecipient(groupId, recipientId) {
  const { recipients } = getCollections();
  return recipients.findOne({ _id: oid(recipientId), groupId: oid(groupId) });
}

function getRecipientById(recipientId) {
  const { recipients } = getCollections();
  return recipients.findOne({ _id: oid(recipientId) });
}

async function removeRecipientByEmail(groupId, email) {
  const { recipients } = getCollections();
  const res = await recipients.deleteOne({
    groupId: oid(groupId),
    email: String(email || '').trim().toLowerCase(),
  });
  return res.deletedCount > 0;
}

async function removeRecipient(groupId, recipientId) {
  const { recipients } = getCollections();
  const res = await recipients.deleteOne({ _id: oid(recipientId), groupId: oid(groupId) });
  return res.deletedCount > 0;
}

/** Called when a recipient lands back from Stripe Connect onboarding. */
async function refreshOnboardingStatus(recipientId) {
  if (!config.isUsd) return null;
  const recipient = await getRecipientById(recipientId);
  if (!recipient) return null;
  const ready = recipient.accountRef ? await payments.isPayoutReady(recipient.accountRef) : false;
  const { recipients } = getCollections();
  await recipients.updateOne({ _id: oid(recipientId) }, { $set: { payoutReady: ready } });
  return ready;
}

module.exports = {
  validate,
  submitApplication,
  listApplications,
  approveApplication,
  rejectApplication,
  addRecipient,
  listRecipients,
  getRecipient,
  getRecipientById,
  removeRecipientByEmail,
  removeRecipient,
  refreshOnboardingStatus,
};
