'use strict';
// Order numbers exactly like v1 (V2_MASTER_PLAN §4B): lunch #1, #2… restarting
// each session; events + parent orders share one never-resetting E counter.
const { resetDb, startApp, createSession, createEvent, lunchOrder, loginAs } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseRef, displayRef, pickupId } = require('../src/domain/orderNumbers');

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); });
after(() => app.close());

const eventOrder = eventId => ({ ...lunchOrder(), orderType: 'event', eventId });

test('parseRef / displayRef / pickupId follow v1 formats', () => {
  assert.deepEqual(parseRef('12'),    { kind: 'lunch', ref: '12' });
  assert.deepEqual(parseRef(' #12 '), { kind: 'lunch', ref: '12' });
  assert.deepEqual(parseRef('AO-7'),  { kind: 'lunch', ref: '7' });
  assert.deepEqual(parseRef('e101'),  { kind: 'e', ref: 'E101' });
  assert.deepEqual(parseRef('E-101'), { kind: 'e', ref: 'E101' });
  assert.equal(parseRef('parent@example.com'), null);
  assert.equal(displayRef('12'), '#12');
  assert.equal(displayRef('E101'), 'E101');
  assert.equal(pickupId('E101', 2), 'E101-2');
});

test('lunch numbers count 1, 2, 3 and restart at 1 in a new session; E numbers keep counting', async () => {
  await createSession(sql);
  const event = await createEvent(sql);
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await app.api('POST', '/api/orders', lunchOrder())).body.orderId);
  assert.deepEqual(ids, ['#1', '#2', '#3']);
  assert.equal((await app.api('POST', '/api/orders', eventOrder(event.id))).body.orderId, 'E100');

  await createSession(sql);   // "Start New Week"
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).body.orderId, '#1');
  assert.equal((await app.api('POST', '/api/orders', eventOrder(event.id))).body.orderId, 'E101');
});

test('concurrent lunch orders get unique consecutive numbers', async () => {
  await createSession(sql);
  const res = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    app.api('POST', '/api/orders', lunchOrder({ payerEmail: `c${i}@example.com` }))));
  const numbers = res.map(r => Number(r.body.orderRef)).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('lookup by bare number finds the current session only; token links work across weeks', async () => {
  await createSession(sql);
  const old = (await app.api('POST', '/api/orders', lunchOrder({ payerEmail: 'old@example.com' }))).body;
  await createSession(sql);
  await app.api('POST', '/api/orders', lunchOrder({ payerEmail: 'new@example.com' }));

  const byNumber = await app.api('GET', '/api/orders/lookup?q=%231');
  assert.equal(byNumber.body.order.customerEmail, 'new@example.com');

  const byToken = await app.api('GET', `/api/orders/lookup?q=1&token=${old.token}`);
  assert.equal(byToken.body.order.customerEmail, 'old@example.com');
  assert.equal(byToken.body.order.orderId, '#1');
});

test('lookup by E number and by email', async () => {
  const event = await createEvent(sql, { name: 'Lookup Fair' });
  const placed = (await app.api('POST', '/api/orders', { ...eventOrder(event.id), payerEmail: 'fair@example.com' })).body;
  const byRef = await app.api('GET', `/api/orders/lookup?q=${placed.orderRef.toLowerCase()}`);
  assert.equal(byRef.body.order.orderId, placed.orderId);
  const byEmail = await app.api('GET', '/api/orders/lookup?q=FAIR@example.com');
  assert.equal(byEmail.body.order.orderId, placed.orderId);
});

test('kitchen board shows v1 pickup IDs (12-1, 12-2)', async () => {
  await createSession(sql);
  await app.api('POST', '/api/orders', lunchOrder({
    items: [{ size: '12inch', childName: 'A' }, { size: 'Half12inch', childName: 'B' }],
  }));
  const board = await app.api('GET', '/api/admin/kitchen/board', undefined, await loginAs(app, sql, 'kitchen'));
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.deepEqual(board.body.orders[0].items.map(i => i.pickupId), ['1-1', '1-2']);
  assert.equal(board.body.orders[0].orderId, '#1');
});
