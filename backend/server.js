'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const routes         = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const { initSockets }  = require('./src/sockets');

const app    = express();
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

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// Wrap async route handlers automatically so they don't need try/catch.
// Must be called after all routes are registered.
wrapAsync(app);

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, () => {
  console.log(`[artisan-oven] backend listening on :${PORT}`);
});

// ── Utility: auto-wrap async route handlers ───────────────────────────────────
function wrapAsync(app) {
  for (const layer of app._router?.stack || []) {
    if (layer.route) {
      for (const rl of layer.route.stack) {
        if (rl.handle?.constructor?.name === 'AsyncFunction') {
          const orig = rl.handle;
          rl.handle = (req, res, next) => orig(req, res, next).catch(next);
        }
      }
    } else if (layer.handle?.stack) {
      wrapAsync(layer.handle);
    }
  }
}

module.exports = { app, server };
