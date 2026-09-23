'use strict';

/**
 * Login credentials for the "logged-in user" API tier — a recipient (payee
 * or subscriber), as opposed to an admin or an anonymous third party.
 *
 * Every recipient gets a random password the moment they're admitted (either
 * approved from an application, or self-enrolled/added). It's returned once,
 * in the API response to whoever created the record (the admin, or the
 * recipient themselves for federated self-service subscribe), and logged to
 * the console — the same "share it out of band, mock delivery for now"
 * convention the rest of this codebase already uses for onboarding links.
 * A recipient can change it after logging in (see routes/me.js).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getCollections, oid } = require('../db');

function generatePassword() {
  return crypto.randomBytes(9).toString('base64url'); // 12 chars, url-safe
}

async function issueCredentials(recipientId, { email }) {
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const { recipient_auth } = getCollections();
  await recipient_auth.updateOne(
    { recipientId: oid(recipientId) },
    { $set: { recipientId: oid(recipientId), passwordHash, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log(`[recipient-auth] login password for ${email}: ${password}`);
  return password;
}

async function verifyLogin(recipientId, candidatePassword) {
  const { recipient_auth } = getCollections();
  const rec = await recipient_auth.findOne({ recipientId: oid(recipientId) });
  if (!rec) return false;
  return bcrypt.compare(String(candidatePassword || ''), rec.passwordHash);
}

async function setPassword(recipientId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const { recipient_auth } = getCollections();
  await recipient_auth.updateOne(
    { recipientId: oid(recipientId) },
    { $set: { passwordHash, updatedAt: new Date() } },
    { upsert: true }
  );
}

module.exports = { issueCredentials, verifyLogin, setPassword };
