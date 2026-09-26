'use strict';
// Bug 14: one shared bucket per IP across every limiter, and no `trust proxy`,
// so behind Caddy the whole site shared ~10 orders/minute.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../src/middleware/rateLimit');

let app, sql;
before(async () => {
  sql = await resetDb(); app = await startApp(); await createSession(sql, { maxPizzas: 100 });
  process.env.RATE_LIMIT = 'on';
});
beforeEach(() => rateLimit.reset());
after(() => { process.env.RATE_LIMIT = 'off'; return app.close(); });

const from = ip => ({ 'x-forwarded-for': ip });

test('one visitor is limited after 10 orders a minute', async () => {
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await app.api('POST', '/api/orders', lunchOrder(), from('203.0.113.7'))).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(201));
  assert.equal(codes[10], 429);
});

test('different visitors behind the same proxy have separate allowances', async () => {
  for (let i = 0; i < 10; i++) await app.api('POST', '/api/orders', lunchOrder(), from('203.0.113.7'));
  const other = await app.api('POST', '/api/orders', lunchOrder(), from('198.51.100.9'));
  assert.equal(other.status, 201);
});

test('limiters do not share buckets (orders do not use up login attempts)', async () => {
  for (let i = 0; i < 10; i++) await app.api('POST', '/api/orders', lunchOrder(), from('203.0.113.7'));
  const login = await app.api('POST', '/api/admin/login', { username: 'x', password: 'y' }, from('203.0.113.7'));
  assert.notEqual(login.status, 429);
});
