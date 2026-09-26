'use strict';
// Bug 7: order/income totals multiplied by item and payment counts.
// Bug 8: the per-event order filter was ignored.
// Bug 11: discount usage counted on every payment, not once when an order becomes paid.
const { resetDb, startApp, createSession, createEvent, lunchOrder, loginAs } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app, sql, treasurer;
before(async () => {
  sql = await resetDb();
  app = await startApp();
  treasurer = await loginAs(app, sql, 'treasurer');
});
after(() => app.close());

const pay = (orderId, amountPence) =>
  app.api('POST', '/api/admin/payments', { orderId, amountPence, method: 'cash' }, treasurer);

const threePizzas = { items: [{ size: '12inch' }, { size: '12inch' }, { size: 'Half12inch' }] };  // £21

test('recording a payment works and derives payment_status from the ledger', async () => {
  await createSession(sql);
  const { id } = (await app.api('POST', '/api/orders', lunchOrder())).body;   // £8
  const part = await pay(id, 300);
  assert.equal(part.status, 201, JSON.stringify(part.body));
  assert.equal(part.body.paymentStatus, 'partial');
  assert.equal((await pay(id, 500)).body.paymentStatus, 'paid');
  assert.equal((await pay(id, -800)).body.paymentStatus, 'unpaid');   // full refund
});

test('bug 7: admin order list is not inflated by multiple items × multiple payments', async () => {
  await createSession(sql);
  const { id } = (await app.api('POST', '/api/orders', lunchOrder(threePizzas))).body;
  await pay(id, 1000);
  await pay(id, 1100);
  const list = await app.api('GET', '/api/admin/orders?type=lunch', undefined, treasurer);
  const row = list.body.orders.find(o => o.id === id);
  assert.equal(row.total_pence, 2100);
  assert.equal(row.amount_paid_pence, 2100);
  assert.equal(row.item_count, 3);
});

test('bug 7: money summary totals are exact with several items and payments per order', async () => {
  await createSession(sql);
  const a = (await app.api('POST', '/api/orders', lunchOrder(threePizzas))).body;   // £21
  const b = (await app.api('POST', '/api/orders', lunchOrder())).body;              // £8
  await pay(a.id, 1000); await pay(a.id, 1100); await pay(b.id, 800); await pay(b.id, -200);
  const { totals } = (await app.api('GET', '/api/admin/money/summary', undefined, treasurer)).body;
  assert.equal(totals.order_count, 2);
  assert.equal(totals.gross_pence, 2900);
  assert.equal(totals.collected_pence, 2900);
  assert.equal(totals.refunded_pence, 200);
  assert.equal(totals.paid_count, 1);
  assert.equal(totals.partial_count, 1);
});

test('bug 8: event order list is filtered by event', async () => {
  const fair = await createEvent(sql, { name: 'Fair' });
  const bbq  = await createEvent(sql, { name: 'BBQ' });
  const eventOrder = eventId => ({ ...lunchOrder(), orderType: 'event', eventId });
  await app.api('POST', '/api/orders', eventOrder(fair.id));
  await app.api('POST', '/api/orders', eventOrder(fair.id));
  await app.api('POST', '/api/orders', eventOrder(bbq.id));

  const byPath = await app.api('GET', `/api/admin/orders/event/${bbq.id}`, undefined, treasurer);
  assert.deepEqual(byPath.body.orders.map(o => o.event_id), [bbq.id]);
  const byQuery = await app.api('GET', `/api/admin/orders?type=event&eventId=${fair.id}`, undefined, treasurer);
  assert.deepEqual(byQuery.body.orders.map(o => o.event_id), [fair.id, fair.id]);
});

test('bug 11: a discount use is counted once, when the order becomes paid', async () => {
  await createSession(sql);
  await sql`UPDATE discount_codes SET times_used = 0 WHERE code = 'STMSCS'`;
  const { id } = (await app.api('POST', '/api/orders', lunchOrder({ discountCode: 'STMSCS' }))).body; // £6.80
  const used = async () => (await sql`SELECT times_used FROM discount_codes WHERE code = 'STMSCS'`)[0].times_used;

  await pay(id, 300);            assert.equal(await used(), 0);   // partial
  await pay(id, 380);            assert.equal(await used(), 1);   // → paid
  await pay(id, 100);            assert.equal(await used(), 1);   // overpayment, still paid
});

test('bug 11: two payments completing an order at the same moment count the use once', async () => {
  await createSession(sql);
  await sql`UPDATE discount_codes SET times_used = 0 WHERE code = 'STMSCS'`;
  const { id } = (await app.api('POST', '/api/orders', lunchOrder({ discountCode: 'STMSCS' }))).body;
  await Promise.all([pay(id, 680), pay(id, 680)]);
  assert.equal((await sql`SELECT times_used FROM discount_codes WHERE code = 'STMSCS'`)[0].times_used, 1);
});
