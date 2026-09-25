'use strict';

// Simple in-process rate limiter (no Redis dependency).
// For high-traffic scenarios, swap for express-rate-limit + redis-store.
const windows = new Map(); // key → [timestamps]

function rateLimit({ windowMs = 60_000, max = 20, keyFn } = {}) {
  return (req, res, next) => {
    const key  = keyFn ? keyFn(req) : req.ip;
    const now  = Date.now();
    const hits = (windows.get(key) || []).filter(t => now - t < windowMs);
    hits.push(now);
    windows.set(key, hits);

    if (hits.length > max) {
      return res.status(429).json({ success: false, message: 'Too many requests — please slow down.' });
    }
    next();
  };
}

module.exports = { rateLimit };
