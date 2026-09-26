'use strict';

// Simple in-process rate limiter (no Redis dependency).
// Each limiter has its OWN buckets (keyed by client IP), so e.g. order submissions
// and login attempts never eat into each other's allowance.
// Client IP comes from X-Forwarded-For via Express `trust proxy` (see server.js) —
// without that, every visitor behind Caddy would share one bucket.
// RATE_LIMIT=off disables limiting (tests).

const limiters = new Set();

function rateLimit({ windowMs = 60_000, max = 20, keyFn } = {}) {
  const windows = new Map(); // key → [timestamps]
  limiters.add(windows);

  return (req, res, next) => {
    if (process.env.RATE_LIMIT === 'off') return next();
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

// Tests: forget all recorded hits.
rateLimit.reset = () => limiters.forEach(w => w.clear());

module.exports = { rateLimit };
