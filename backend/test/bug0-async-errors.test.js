'use strict';
// Bug 0: async route errors were unhandled rejections that killed the process
// (wrapAsync never wrapped handlers inside the /api Router).
const { resetDb, startApp } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app;
before(async () => { await resetDb(); app = await startApp(); });
after(() => app.close());

test('an HttpError thrown in an async handler becomes a JSON error response', async () => {
  const res = await app.api('GET', '/api/orders/lookup?q=99999');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /not found/i);
});

test('the server keeps serving after a handler error', async () => {
  await app.api('GET', '/api/orders/lookup?q=99999');
  const res = await app.api('GET', '/health');
  assert.equal(res.status, 200);
});
