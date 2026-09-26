'use strict';
// Events like v1: slug IDs in public URLs, v1 getEvents/getEvent shapes,
// register interest, Closed events refuse orders, quantities.
const { resetDb, startApp, createEvent, lunchOrder, loginAs } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { slugFor } = require('../src/domain/events');

let app, sql, owner, fair, bbq;
before(async () => {
  sql = await resetDb();
  app = await startApp();
  owner = await loginAs(app, sql, 'owner');
  fair = await createEvent(sql, { name: 'Summer Fair 2026', slug: 'summer-fair-2026' });
  bbq  = await createEvent(sql, { name: 'Autumn BBQ', slug: 'autumn-bbq-2026', registerInterest: true });
  await sql`UPDATE events SET description = 'Pizzas at the fair', event_time = '12:00 – 3:00 PM',
                              location = 'School Field', customer_instructions = 'Collect from the tent'
            WHERE id = ${fair.id}`;
});
after(() => app.close());

const eventOrder = (eventId, extra = {}) =>
  ({ orderType: 'event', eventId, payerName: 'Nina Shaw', payerEmail: 'nina@example.com', items: [{ size: '12inch', qty: 1 }], ...extra });

test('GET /api/events returns active events in v1\'s shape, id = slug', async () => {
  const { events } = (await app.api('GET', '/api/events')).body;
  const e = events.find(x => x.id === 'summer-fair-2026');
  assert.deepEqual(e, {
    id: 'summer-fair-2026', name: 'Summer Fair 2026', description: 'Pizzas at the fair',
    date: 'Saturday 10th October 2026', time: '12:00 – 3:00 PM', location: 'School Field', status: 'Open',
    registerInterest: false, customerInstructions: 'Collect from the tent',
  });
  assert.equal(events.find(x => x.id === 'autumn-bbq-2026').registerInterest, true);
});

test('inactive events are hidden; GET /api/events/:slug is case-insensitive', async () => {
  const hidden = await createEvent(sql, { name: 'Old', slug: 'old-event' });
  await sql`UPDATE events SET active = FALSE WHERE id = ${hidden.id}`;
  assert.equal((await app.api('GET', '/api/events')).body.events.some(e => e.id === 'old-event'), false);
  assert.equal((await app.api('GET', '/api/events/old-event')).status, 404);
  assert.equal((await app.api('GET', '/api/events/SUMMER-FAIR-2026')).body.event.id, 'summer-fair-2026');
});

test('register interest (v1 fields and message)', async () => {
  const res = await app.api('POST', '/api/events/autumn-bbq-2026/interest',
    { customerName: 'Ola Park', customerEmail: 'ola@example.com', notes: 'Two vegetarians' });
  assert.equal(res.status, 201);
  assert.equal(res.body.message, 'Interest registered successfully!');
  assert.equal((await app.api('POST', '/api/events/autumn-bbq-2026/interest', { customerEmail: 'x@example.com' })).status, 400);
  assert.equal((await app.api('POST', '/api/events/autumn-bbq-2026/interest', { customerName: 'A', customerEmail: 'bad' })).status, 400);
});

test('event orders by slug, with quantities expanded to pizzas', async () => {
  const res = await app.api('POST', '/api/orders', eventOrder('summer-fair-2026',
    { items: [{ size: '12inch', qty: 2 }, { size: 'Half12inch', qty: 1 }] }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.total, 21);
  assert.match(res.body.orderId, /^E\d+$/);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM order_items WHERE order_id = ${res.body.id}`;
  assert.equal(n, 3);
  const [o] = await sql`SELECT event_id FROM orders WHERE id = ${res.body.id}`;
  assert.equal(o.event_id, fair.id);
});

test('v1 validation: Closed events, bad qty, bad size, bad email, unknown event', async () => {
  const closed = await createEvent(sql, { name: 'Closed Fair', slug: 'closed-fair', status: 'Closed' });
  const r1 = await app.api('POST', '/api/orders', eventOrder(closed.slug));
  assert.equal(r1.status, 409);
  assert.equal(r1.body.message, 'This event is currently closed for ordering.');
  assert.equal((await app.api('POST', '/api/orders', eventOrder('summer-fair-2026', { items: [{ size: '12inch', qty: 51 }] }))).body.message, 'Invalid quantity.');
  assert.equal((await app.api('POST', '/api/orders', eventOrder('summer-fair-2026', { items: [{ size: 'huge' }] }))).body.message, 'Invalid pizza size selected.');
  assert.equal((await app.api('POST', '/api/orders', eventOrder('summer-fair-2026', { payerEmail: 'nope' }))).status, 400);
  assert.equal((await app.api('POST', '/api/orders', eventOrder('no-such-event'))).status, 404);
});

test('admin creates events with a v1-style slug (or a supplied one); duplicates refused', async () => {
  const made = await app.api('POST', '/api/admin/events', { name: 'Winter Market!', description: 'Hot pizza' }, owner);
  assert.equal(made.status, 201);
  assert.match(made.body.event.slug, /^winter-market-\d{4}$/);
  const own = await app.api('POST', '/api/admin/events', { name: 'Spring', slug: 'spring-2027' }, owner);
  assert.equal(own.body.event.slug, 'spring-2027');
  assert.equal((await app.api('POST', '/api/admin/events', { name: 'Again', slug: 'spring-2027' }, owner)).status, 409);
  assert.equal(slugFor('Summer Fair 2026', 1790000001234), 'summer-fair-2026-1234');
});

test('an event with orders cannot be hard-deleted (would orphan orders)', async () => {
  assert.equal((await app.api('DELETE', `/api/admin/events/${fair.id}`, undefined, owner)).status, 409);
  const empty = await createEvent(sql, { name: 'Empty', slug: 'empty-one' });
  assert.equal((await app.api('DELETE', `/api/admin/events/${empty.id}`, undefined, owner)).status, 200);
});
