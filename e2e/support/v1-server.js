'use strict';

// Serves the READ-ONLY v1 snapshot (docs/v1-reference, home page from
// docs/v1-reference-extra) the way v1's server.js did, for the visual baseline.
// /config.js points the pages at a fake API host that support/mock-v1.js intercepts.

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..', '..', 'docs', 'v1-reference');
const EXTRA = path.join(__dirname, '..', '..', 'docs', 'v1-reference-extra');
const PORT  = parseInt(process.env.V1_PORT || '4100', 10);
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
                '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff' };

const ALIASES = {
  '/': 'index.html', '/payment': 'Payment.html', '/payment.html': 'Payment.html', '/order': 'order.html',
  '/admin': 'admin.html', '/events': 'events.html', '/event-order': 'event-order.html', '/kitchen': 'kitchen.html',
  '/parent-order': 'parent-order.html', '/terms': 'terms.html', '/fully-booked': 'fully-booked.html',
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end('window.ORDER_API_URL = "https://v1-api.mock/exec";\nwindow.STATUS_API_URL = "/api/status";\n');
  }
  const rel = ALIASES[url.pathname] || decodeURIComponent(url.pathname.slice(1));
  const file = rel === 'index.html' ? path.join(EXTRA, 'index.html') : path.join(ROOT, rel);
  if (!file.startsWith(ROOT) && !file.startsWith(EXTRA)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(PORT, () => console.log(`v1 snapshot on http://127.0.0.1:${PORT}`));
