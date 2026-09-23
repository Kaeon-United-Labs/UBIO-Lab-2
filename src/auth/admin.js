'use strict';

/**
 * Admin credentials — one of the three API tiers (admin / logged-in
 * recipient / anonymous).
 *
 * Single mode: one shared password for the whole install (ADMIN_PASSWORD).
 * Works as a browser session (httpOnly cookie, set on POST /admin/api/login)
 * or as a bearer token equal to the password itself — "any admin action may
 * also be done via HTTP request with the admin password as the bearer
 * token," exactly as Stage/UBIO's spec requires. Compared in constant time.
 *
 * Federated mode: each group has its own bcrypt-hashed password, set at
 * group creation. Logging in (POST /api/groups/:slug/login) returns a
 * signed JWT scoped to that group; every admin route requires it as a
 * bearer token. Exactly Lab/2's model.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const groupsService = require('../services/groups');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkSingleAdminPassword(candidate) {
  return safeEqual(candidate, config.adminPassword);
}

function signGroupAdminToken(group) {
  return jwt.sign({ groupId: String(group._id), slug: group.slug }, config.jwtSecret, { expiresIn: '8h' });
}

/**
 * Mode-aware admin middleware. Resolves req.group either way, so every
 * downstream admin route can use req.group regardless of mode.
 */
function requireAdmin() {
  if (config.isSingle) {
    return async (req, res, next) => {
      if (req.session && req.session.isAdmin) {
        req.group = await groupsService.getSingletonGroup();
        return next();
      }
      const auth = req.get('authorization') || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m && checkSingleAdminPassword(m[1])) {
        req.group = await groupsService.getSingletonGroup();
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized' });
    };
  }

  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: 'Sign in to manage this group.' });
    try {
      const claims = jwt.verify(match[1], config.jwtSecret);
      const group = await groupsService.getGroupById(claims.groupId);
      if (!group) return res.status(401).json({ error: 'This group no longer exists.' });
      req.group = group;
      next();
    } catch {
      return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    }
  };
}

module.exports = { safeEqual, checkSingleAdminPassword, signGroupAdminToken, requireAdmin };
