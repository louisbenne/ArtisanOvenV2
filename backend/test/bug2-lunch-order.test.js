'use strict';
// Bug 2: the lunch-order capacity query used GROUP BY … FOR UPDATE, which Postgres rejects.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); await createSession(sql); });
after(() => app.close());

test('a valid lunch order is accepted', { todo: 'bug 2 — fixed in phase-0-lunch-transaction' }, async () => {
  const res = await app.api('POST', '/api/orders', lunchOrder());
  assert.ok(res.status < 300, `${res.status} ${JSON.stringify(res.body)}`);
});
