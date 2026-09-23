'use strict';

// Minimal fixed-window in-memory rate limiter. Single-instance only; behind
// a load balancer use a shared store. Ported from Stage/UBIO.
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

module.exports = { rateLimit };
