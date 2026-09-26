'use strict';
// Bugs 3, 4, 5: parent access used to issue an ADMIN session (volunteer role);
// any public order could apply MUTTI; parent orders had no auth (and always 400'd).
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app, sql;
before(async () => {
  sql = await resetDb();
  app = await startApp();
  await sql`INSERT INTO access_codes (code, purpose, linked_discount_code) VALUES ('FAMILY', 'parent_gate', 'MUTTI')`;
});
after(() => app.close());

const parentLogin = async (code = 'family') => {
  const res = await app.api('POST', '/api/parent/auth', { code });
  return res.body.token && { authorization: `Bearer ${res.body.token}` };
};

test('a wrong access code is rejected', async () => {
  assert.equal((await app.api('POST', '/api/parent/auth', { code: 'NOPE' })).status, 401);
});

test('bug 3: a parent token cannot reach any admin route', async () => {
  const parent = await parentLogin();
  assert.ok(parent);
  for (const path of ['/api/admin/orders', '/api/admin/kitchen/board', '/api/admin/users']) {
    const res = await app.api('GET', path, undefined, parent);
    assert.equal(res.status, 401, `${path} → ${res.status}`);
  }
});

test('bug 3: the parent_gate admin pseudo-user no longer exists', async () => {
  const rows = await sql`SELECT 1 FROM admin_users WHERE username = 'parent_gate'`;
  assert.equal(rows.length, 0);
});

test('bug 4: MUTTI is rejected on a public order (any casing)', async () => {
  await createSession(sql);
  for (const code of ['MUTTI', 'mutti']) {
    const res = await app.api('POST', '/api/orders', lunchOrder({ discountCode: code }));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /not found/i);
  }
});

test('a public discount code (STMSCS, 15%) still works on public orders', async () => {
  await createSession(sql);
  const res = await app.api('POST', '/api/orders', lunchOrder({ discountCode: 'stmscs' }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.total, 6.8);
});

test('bug 4: parent orders require a parent session', async () => {
  assert.equal((await app.api('POST', '/api/parent/orders', lunchOrder())).status, 401);
  const bogus = { authorization: 'Bearer 00000000-0000-0000-0000-000000000000' };
  assert.equal((await app.api('POST', '/api/parent/orders', lunchOrder(), bogus)).status, 401);
});

test('bug 5: a parent order is accepted, typed parent, E-numbered, with MUTTI applied server-side', async () => {
  const parent = await parentLogin();
  // The body tries to pick its own type and discount — both must be ignored.
  const res = await app.api('POST', '/api/parent/orders',
    lunchOrder({ orderType: 'lunch', discountCode: 'STMSCS' }), parent);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.orderId, /^E\d+$/);
  assert.equal(res.body.total, 4);
  const [o] = await sql`SELECT order_type, discount_code FROM orders WHERE id = ${res.body.id}`;
  assert.deepEqual({ ...o }, { order_type: 'parent', discount_code: 'MUTTI' });
});

test('parent orders count toward the session\'s capacity but are never refused for it (as in v1)', async () => {
  const session = await createSession(sql, { maxPizzas: 2 });
  const parent = await parentLogin();
  const one = lunchOrder({ items: [{ size: '12inch' }] });
  assert.equal((await app.api('POST', '/api/parent/orders', one, parent)).status, 201);
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 201);   // 2 of 2
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 409);   // full for the public
  assert.equal((await app.api('POST', '/api/parent/orders', one, parent)).status, 201);   // v1: parents still go through
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM orders WHERE session_id = ${session.id} AND order_type = 'parent'`;
  assert.equal(n, 2);
});

test('expired sessions and deactivated codes are rejected', async () => {
  const parent = await parentLogin();
  await sql`UPDATE parent_sessions SET expires_at = now() - interval '1 minute'`;
  assert.equal((await app.api('POST', '/api/parent/orders', lunchOrder(), parent)).status, 401);

  const fresh = await parentLogin();
  await sql`UPDATE access_codes SET active = FALSE WHERE code = 'FAMILY'`;
  assert.equal((await app.api('POST', '/api/parent/orders', lunchOrder(), fresh)).status, 401);
  assert.equal((await app.api('POST', '/api/parent/auth', { code: 'FAMILY' })).status, 401);
  await sql`UPDATE access_codes SET active = TRUE WHERE code = 'FAMILY'`;
});
