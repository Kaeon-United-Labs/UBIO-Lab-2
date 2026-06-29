'use strict';

const crypto = require('crypto');
const config = require('../config');

// Constant-time comparison so login/token checks don't leak length or content
// through timing. Both sides hashed to fixed length first.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkPassword(candidate) {
  return safeEqual(candidate, config.adminPassword);
}

// Accepts either a logged-in session OR a bearer token equal to the admin
// password. "Any action on the admin panel may also be done via HTTP request
// with the admin password as the bearer token."
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();

  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && checkPassword(m[1])) return next();

  return res.status(401).json({ error: 'Unauthorized' });
}

// Minimal fixed-window in-memory rate limiter. Single-instance only; behind a
// load balancer use a shared store. Good enough to blunt brute force on login.
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    const entry = hits.get(k);
    if (!entry || now > entry.reset) {
      hits.set(k, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.reset - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    return next();
  };
}

module.exports = { checkPassword, requireAdmin, rateLimit, safeEqual };
