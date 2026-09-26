'use strict';
// v2's own lunch order form (replaces v1's Google Form): the server enforces the
// same rules the form had, and offers a live discount check for public codes.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); await createSession(sql); });
after(() => app.close());

const place = body => app.api('POST', '/api/orders', body);

test('T&Cs must be accepted', async () => {
  const res = await place(lunchOrder({ termsAccepted: false }));
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Terms & Conditions/);
});

test('every pizza needs a name and class; at most 5 pizzas; a payment method', async () => {
  assert.match((await place(lunchOrder({ items: [{ size: '12inch', childName: '' }] }))).body.message, /name and class/);
  assert.match((await place(lunchOrder({ items: Array(6).fill({ size: 'Quarter12inch' }) }))).body.message, /up to 5/);
  assert.match((await place(lunchOrder({ paymentMethod: undefined }))).body.message, /payment method/);
});

test('allergies, child names and classes are stored; terms time recorded', async () => {
  const res = await place(lunchOrder({ allergyFlag: true, allergyNotes: 'No nuts',
    items: [{ size: '12inch', childName: 'Oscar', childClass: 'Class 5' }] }));
  assert.equal(res.status, 201);
  const [o] = await sql`SELECT allergy_flag, allergy_notes, terms_accepted_at FROM orders WHERE id = ${res.body.id}`;
  assert.equal(o.allergy_flag, true);
  assert.equal(o.allergy_notes, 'No nuts');
  assert.ok(o.terms_accepted_at);
  const [i] = await sql`SELECT child_name, child_class FROM order_items WHERE order_id = ${res.body.id}`;
  assert.deepEqual({ ...i }, { child_name: 'Oscar', child_class: 'Class 5' });
});

test('discount check: public code valid with amounts; unknown and gated codes look the same', async () => {
  const ok = await app.api('POST', '/api/discounts/check', { code: 'stmscs', items: [{ size: '12inch' }, { size: 'Half12inch' }] });
  assert.deepEqual(ok.body, { success: true, valid: true, code: 'STMSCS', subtotalPence: 1300, discountPence: 195, totalPence: 1105 });
  for (const code of ['MUTTI', 'NOPE']) {
    const bad = await app.api('POST', '/api/discounts/check', { code });
    assert.equal(bad.body.valid, false);
    assert.equal(bad.body.message, 'Discount code not found.');
  }
});
