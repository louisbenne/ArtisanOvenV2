'use strict';
const { resetDb, startApp } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app;
before(async () => { await resetDb(); app = await startApp(); });
after(() => app.close());

test('GET /health responds ok', async () => {
  const res = await app.api('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('unknown /api route returns a JSON 404 (does not hang)', async () => {
  const res = await app.api('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
});
