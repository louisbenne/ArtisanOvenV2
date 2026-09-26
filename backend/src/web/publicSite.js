'use strict';

// Serves public/ (v1's frontend, verbatim) with v1's URLs, aliases, cache
// headers and file-blocking rules — ported from docs/v1-reference/server.js.

const path    = require('path');
const express = require('express');

// v1: never serve hidden files, backend code, configs, logs or markdown.
const FORBIDDEN = [
  /^\./,
  /\.(gs|ts|env|bak|config|lock|log|md)$/i,
  /^(server\.js|package\.json|package-lock\.json|metadata\.json|apps-script\.js)$/i,
];

// Page → every URL v1 answered it on. Installed PWAs and emailed links use these.
const PAGES = {
  'index.html':        ['/', '/index.html'],
  'Payment.html':      ['/payment', '/payment.html', '/Payment', '/Payment.html'],
  'order.html':        ['/order', '/order.html', '/Order', '/Order.html'],
  'admin.html':        ['/admin', '/admin.html', '/Admin', '/Admin.html'],
  'events.html':       ['/events', '/events.html', '/Events', '/Events.html'],
  'event-order.html':  ['/event-order', '/event-order.html', '/Event-Order', '/Event-Order.html'],
  'kitchen.html':      ['/kitchen', '/kitchen.html', '/Kitchen', '/Kitchen.html'],
  'parent-order.html': ['/parent-order', '/parent-order.html', '/Parent-Order', '/Parent-Order.html'],
  'terms.html':        ['/terms', '/terms.html', '/Terms', '/Terms.html'],
  'fully-booked.html': ['/fully-booked', '/fully-booked.html'],
};

const NO_STORE = 'no-cache, no-store, must-revalidate, max-age=0';

function mountPublicSite(app, publicDir) {
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The browser may only fetch/XHR/WebSocket our own origin. v1's admin.html
    // falls back to v1's live Apps Script URL; this makes it impossible for v2
    // (or its staging) to read or write v1's production data by accident.
    // (Full CSP comes with Phase 8 hardening.)
    res.setHeader('Content-Security-Policy', "connect-src 'self'");
    const basename = path.posix.basename(path.posix.normalize(req.path));
    const hiddenSegment = req.path.split('/').some(s => s.startsWith('.'));
    if (hiddenSegment || req.path.startsWith('/apps-script') || FORBIDDEN.some(re => re.test(basename))) {
      return res.status(404).end();
    }
    next();
  });

  // v1 pages load <script src="/config.js">. In v2 the browser talks to the API
  // through public/js/api.js (same origin), so there is nothing to configure.
  app.get('/config.js', (_req, res) => {
    res.type('application/javascript').set('Cache-Control', NO_STORE)
       .send('/* ArtisanOven v2: same-origin API, see /js/api.js */\n');
  });

  // live.html was a hand-made draft of the fully-booked page: send old links home.
  app.get(['/live', '/live.html'], (_req, res) => res.redirect(302, '/'));

  for (const [file, urls] of Object.entries(PAGES)) {
    app.get(urls, (_req, res) => {
      res.set('Cache-Control', NO_STORE);
      res.sendFile(path.join(publicDir, file));
    });
  }

  app.use(express.static(publicDir, {
    dotfiles: 'ignore',
    index: false,
    setHeaders: (res, filePath) => {
      if (/\.html$|-sw\.js$|-manifest\.json$/.test(filePath)) {
        res.setHeader('Cache-Control', NO_STORE);
      } else if (/\.(ttf|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }));

  // v1: unknown extensionless routes → home page; missing files → 404.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    if (path.extname(req.path)) return res.status(404).end();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

module.exports = { mountPublicSite, PAGES };
