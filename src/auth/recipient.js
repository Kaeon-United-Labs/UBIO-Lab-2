'use strict';

/**
 * Recipient ("logged-in user") credentials — the second of the three API
 * tiers, distinct from admin and anonymous. A recipient logs in with the
 * email they applied/subscribed with and the password issued to them at
 * admission time (see services/recipientAuth.js), and gets a bearer JWT
 * scoped to their own recipient record.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getCollections, oid } = require('../db');
const recipientAuth = require('../services/recipientAuth');
const groupsService = require('../services/groups');

function signRecipientToken(recipient) {
  return jwt.sign(
    { recipientId: String(recipient._id), groupId: String(recipient.groupId) },
    config.jwtSecret,
    { expiresIn: '30d' }
  );
}

async function authenticate(groupId, email, password) {
  const { recipients } = getCollections();
  const recipient = await recipients.findOne({
    groupId: oid(groupId),
    email: String(email || '').trim().toLowerCase(),
  });
  if (!recipient) return null;
  const ok = await recipientAuth.verifyLogin(recipient._id, password);
  return ok ? recipient : null;
}

async function requireRecipient(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Sign in to view your account.' });
  try {
    const claims = jwt.verify(match[1], config.jwtSecret);
    const { recipients } = getCollections();
    const recipient = await recipients.findOne({ _id: oid(claims.recipientId) });
    if (!recipient) return res.status(401).json({ error: 'Account no longer exists.' });
    req.recipient = recipient;
    req.group = await groupsService.getGroupById(recipient.groupId);
    next();
  } catch {
    return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }
}

module.exports = { signRecipientToken, authenticate, requireRecipient };
