'use strict';
// Bug 2: the lunch-order capacity query used GROUP BY … FOR UPDATE, which Postgres
// rejects — every lunch order failed. Now: lock the session row, then sum capacity.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); });
after(() => app.close());

const pizzasIn = async sessionId => Number((await sql`
  SELECT COALESCE(SUM(CASE i.size WHEN '12inch' THEN 1.0 WHEN 'Half12inch' THEN 0.5 ELSE 0.25 END), 0) AS n
  FROM orders o JOIN order_items i ON i.order_id = o.id
  WHERE o.session_id = ${sessionId} AND NOT o.is_deleted`)[0].n);

test('a valid lunch order is accepted and stored with its items and total', async () => {
  const session = await createSession(sql);
  const res = await app.api('POST', '/api/orders', lunchOrder({
    items: [{ size: '12inch', childName: 'Alex' }, { size: 'Half12inch', childName: 'Sam' }],
  }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.total, 13);
  const [order] = await sql`SELECT * FROM orders WHERE session_id = ${session.id}`;
  assert.equal(order.total_pence, 1300);
  assert.equal(await pizzasIn(session.id), 1.5);
});

test('an order that exceeds remaining capacity is rejected with 409', async () => {
  const session = await createSession(sql, { maxPizzas: 1 });
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 201);
  const res = await app.api('POST', '/api/orders', lunchOrder());
  assert.equal(res.status, 409);
  assert.equal(await pizzasIn(session.id), 1);
});

test('fractional capacity: a quarter still fits when 0.25 remains', async () => {
  const session = await createSession(sql, { maxPizzas: 1 });
  const three = lunchOrder({ items: [{ size: 'Half12inch' }, { size: 'Quarter12inch' }] });
  assert.equal((await app.api('POST', '/api/orders', three)).status, 201);
  const quarter = lunchOrder({ items: [{ size: 'Quarter12inch' }] });
  assert.equal((await app.api('POST', '/api/orders', quarter)).status, 201);
  assert.equal((await app.api('POST', '/api/orders', quarter)).status, 409);
  assert.equal(await pizzasIn(session.id), 1);
});

test('closed session rejects orders', async () => {
  await createSession(sql, { open: false });
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 409);
});

test('concurrent orders never exceed capacity', async () => {
  const session = await createSession(sql, { maxPizzas: 5 });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      app.api('POST', '/api/orders', lunchOrder({ payerEmail: `p${i}@example.com` }))));
  const statuses = results.map(r => r.status);
  assert.equal(statuses.filter(s => s === 201).length, 5, statuses.join(','));
  assert.equal(statuses.filter(s => s === 409).length, 15, statuses.join(','));
  assert.equal(await pizzasIn(session.id), 5);
});
