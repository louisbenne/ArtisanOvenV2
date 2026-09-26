'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const path           = require('path');
const routes         = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const { initSockets }  = require('./src/sockets');

const app    = express();

// Behind Caddy (and possibly a tunnel) on private networks: trust those hops so
// req.ip is the real visitor from X-Forwarded-For (rate limiting depends on it).
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

const server = http.createServer(app);

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || '*',
    methods: ['GET','POST'],
  },
});
initSockets(io);
app.set('io', io);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));

// Preserve raw body for webhook signature verification.
app.use('/api/webhooks', express.raw({ type: '*/*' }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    req.body    = JSON.parse(req.body.toString() || '{}');
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// ── Static files (Railway: single container serves frontend + admin) ─────────
app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.use('/frontend', express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// Wrap async route handlers automatically so they don't need try/catch.
// Must be called after all routes are registered.
wrapAsync(app._router.stack);

// ── Start ─────────────────────────────────────────────────────────────────────
// Only listen when run directly (`node server.js`); tests import { app, server }.
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000', 10);
  server.listen(PORT, () => {
    console.log(`[artisan-oven] backend listening on :${PORT}`);
  });
}

// ── Utility: auto-wrap async route handlers ───────────────────────────────────
// Takes a layer stack (app._router.stack, or a Router's own .stack) and recurses
// into mounted Routers. Without this, a rejected handler promise is unhandled and
// Node exits the whole process.
function wrapAsync(stack) {
  for (const layer of stack) {
    if (layer.route) {
      for (const rl of layer.route.stack) {
        if (rl.handle?.constructor?.name === 'AsyncFunction') {
          const orig = rl.handle;
          rl.handle = (req, res, next) => orig(req, res, next).catch(next);
        }
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      wrapAsync(layer.handle.stack);
    }
  }
}

module.exports = { app, server };
