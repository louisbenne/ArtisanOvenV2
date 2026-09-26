'use strict';
// Phase 1: v1's frontend is served verbatim from public/ at v1's URLs, with v1's
// aliases, cache headers and blocked files (docs/v1-reference/server.js).
const { resetDb, startApp } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PAGES } = require('../src/web/publicSite');

const PUBLIC = path.join(__dirname, '../../public');
let app;
before(async () => { await resetDb(); app = await startApp(); });
after(() => app.close());

const get = (p, opts = {}) => fetch(app.base + p, { redirect: 'manual', ...opts });

test('every v1 page URL and alias serves the exact v1 file, uncached', async () => {
  for (const [file, urls] of Object.entries(PAGES)) {
    const expected = fs.readFileSync(path.join(PUBLIC, file));
    for (const url of urls) {
      const res = await get(url);
      assert.equal(res.status, 200, url);
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(expected), `${url} ≠ ${file}`);
      assert.match(res.headers.get('cache-control'), /no-store/, url);
    }
  }
});

test('home page is v1\'s normal home page (0c2a41c^), not the fully-booked page', async () => {
  const home = await (await get('/')).text();
  assert.match(home, /I WANT TO ORDER/);
  assert.match(home, /I NEED TO PAY/);
  assert.match(await (await get('/fully-booked.html')).text(), /Thank You/i);
});

test('/live and /live.html redirect home', async () => {
  for (const url of ['/live', '/live.html']) {
    const res = await get(url);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
  }
});

test('/config.js exists (v1 pages load it) and is harmless', async () => {
  const res = await get('/config.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.doesNotMatch(await res.text(), /script\.google\.com/);
});

test('v1 cache headers: fonts immutable, CSS/JS 1 hour, service workers and manifests uncached', async () => {
  assert.match((await get('/fonts/BaarSophia.woff')).headers.get('cache-control'), /max-age=86400, immutable/);
  assert.match((await get('/style.css')).headers.get('cache-control'), /max-age=3600/);
  assert.match((await get('/admin-sw.js')).headers.get('cache-control'), /no-store/);
  assert.match((await get('/kitchen-manifest.json')).headers.get('cache-control'), /no-store/);
});

test('backend code, configs, docs and dotfiles are never served', async () => {
  for (const url of ['/metadata.json', '/.env', '/server.js', '/package.json', '/apps-script.js',
                     '/README.md', '/apps-script/Code.gs', '/.git/config']) {
    assert.equal((await get(url)).status, 404, url);
  }
});

test('unknown extensionless routes get the home page; missing files 404; API stays JSON', async () => {
  const route = await get('/some/old/route');
  assert.equal(route.status, 200);
  assert.match(await route.text(), /I WANT TO ORDER/);
  assert.equal((await get('/missing.png')).status, 404);
  const api = await get('/api/nope');
  assert.equal(api.status, 404);
  assert.equal((await api.json()).success, false);
});

test('the old v2 UI paths are gone (no /frontend/ tree served)', async () => {
  assert.equal((await get('/frontend/style.css')).status, 404);
});

test('pages may only call our own origin (v1 admin.html falls back to v1\'s live Apps Script)', async () => {
  for (const url of ['/', '/admin.html', '/order.html']) {
    assert.equal((await get(url)).headers.get('content-security-policy'), "connect-src 'self'", url);
  }
});
