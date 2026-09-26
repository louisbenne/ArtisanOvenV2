'use strict';
// D8 (Louis): the admin page asks for a password only, like v1.
const { resetDb, startApp } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

let app, sql;
before(async () => {
  sql = await resetDb();
  app = await startApp();
  await sql`INSERT INTO admin_users (username, password_hash, role) VALUES
    ('louis',   ${await bcrypt.hash('mutti', 4)},   'owner'),
    ('kitchen', ${await bcrypt.hash('ovenpw', 4)},  'kitchen')`;
});
after(() => app.close());

const login = body => app.api('POST', '/api/admin/login', body);

test('password alone logs in as the matching account', async () => {
  const res = await login({ password: 'mutti' });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'owner');
  const other = await login({ password: 'ovenpw' });
  assert.equal(other.body.role, 'kitchen');
});

test('the token works on admin routes', async () => {
  const { token } = (await login({ password: 'mutti' })).body;
  const res = await app.api('GET', '/api/admin/orders', undefined, { authorization: `Bearer ${token}` });
  assert.equal(res.status, 200);
});

test('wrong or missing password is refused', async () => {
  assert.equal((await login({ password: 'wrong' })).status, 401);
  assert.equal((await login({})).status, 400);
});

test('a username is still accepted if sent', async () => {
  assert.equal((await login({ username: 'louis', password: 'mutti' })).status, 200);
  assert.equal((await login({ username: 'kitchen', password: 'mutti' })).status, 401);
});
