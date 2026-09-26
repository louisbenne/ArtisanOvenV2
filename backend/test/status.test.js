'use strict';
// GET /api/status: v1's getStatus shape (apps-script.js) built from v2 data,
// + soldOut / ordersTeamEmail (plan §4A).
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const statusService = require('../src/services/statusService');
const s = require('../src/domain/schedule');

// Exactly the keys v1's getStatus returns, in its order.
const V1_KEYS = ['success', 'orderingOpen', 'orderingEnabled', 'isPastDeadline', 'currentPizzas', 'maxPizzas',
  'remainingPizzas', 'currentOrders', 'serviceDate', 'serviceTitle', 'serviceNoticeDate', 'nextOpeningTime',
  'capacityMessage', 'deadlineMessage', 'closedMessage', 'sessionId', 'closingSchedule'];

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); });
after(() => app.close());
beforeEach(async () => {
  await sql`UPDATE site_settings SET auto_close_enabled = FALSE WHERE id = 1`;   // time-independent
  statusService.invalidate();
});
const status = async () => (await app.api('GET', '/api/status')).body;

test('has exactly v1\'s fields (plus soldOut, ordersTeamEmail) and is never cached by browsers', async () => {
  await createSession(sql);
  const res = await app.api('GET', '/api/status');
  assert.deepEqual(Object.keys(res.body), [...V1_KEYS, 'soldOut', 'ordersTeamEmail']);
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('counts lunch + parent pizzas (v1), lunch orders only in currentOrders, v1 wording', async () => {
  const session = await createSession(sql, { maxPizzas: 20 });
  await app.api('POST', '/api/orders', lunchOrder({ items: [{ size: '12inch' }, { size: 'Half12inch' }] }));
  await sql`INSERT INTO access_codes (code, purpose, linked_discount_code) VALUES ('FAM', 'parent_gate', 'MUTTI') ON CONFLICT DO NOTHING`;
  const { token } = (await app.api('POST', '/api/parent/auth', { code: 'FAM' })).body;
  await app.api('POST', '/api/parent/orders', lunchOrder(), { authorization: `Bearer ${token}` });
  await sql`UPDATE site_settings SET service_notice_date = 'Tuesday Lunchtime — 29th of September' WHERE id = 1`;
  await sql`UPDATE ordering_sessions SET service_date = '2026-09-29' WHERE id = ${session.id}`;
  statusService.invalidate();

  const st = await status();
  assert.equal(st.currentPizzas, 2.5);
  assert.equal(st.currentOrders, 1);
  assert.equal(st.remainingPizzas, 17.5);
  assert.equal(st.orderingOpen, true);
  assert.equal(st.closedMessage, '17.5 pizzas remaining.');
  assert.equal(st.serviceDate, 'Tuesday 29th September 2026');
  assert.equal(st.serviceTitle, 'Test Tuesday');
  assert.equal(st.serviceNoticeDate, 'Tuesday Lunchtime — 29th of September');
  assert.equal(st.closingSchedule, 'Sunday at 21:00');
  assert.equal(st.sessionId, String(session.id));
  assert.equal(st.soldOut, false);
});

test('a new order shows up immediately (cache is cleared on change)', async () => {
  await createSession(sql, { maxPizzas: 5 });
  assert.equal((await status()).currentPizzas, 0);
  await app.api('POST', '/api/orders', lunchOrder());
  assert.equal((await status()).currentPizzas, 1);
});

test('sold out: orderingOpen false, soldOut true, v1 fully-booked message', async () => {
  await createSession(sql, { maxPizzas: 1 });
  await app.api('POST', '/api/orders', lunchOrder());
  const st = await status();
  assert.equal(st.orderingOpen, false);
  assert.equal(st.soldOut, true);
  assert.equal(st.closedMessage, "We're fully booked for this session. Please check back next time.");
});

test('past the deadline is closed but NOT sold out; v1 message names the day and time', async () => {
  await createSession(sql);
  const today = s.londonParts(new Date()).weekday;
  await sql`UPDATE site_settings SET auto_close_enabled = TRUE, close_weekday = ${today}, close_time = '00:00',
                                     reopen_weekday = ${today % 7 + 1}, reopen_time = '00:00' WHERE id = 1`;
  statusService.invalidate();
  const st = await status();
  assert.equal(st.isPastDeadline, true);
  assert.equal(st.orderingOpen, false);
  assert.equal(st.soldOut, false);
  assert.equal(st.closedMessage, `Ordering for this week has closed (${s.DAYS[today]} 00:00).`);
});

test('closed by the admin takes precedence (v1 order of messages)', async () => {
  await createSession(sql, { open: false });
  const st = await status();
  assert.equal(st.orderingEnabled, false);
  assert.equal(st.closedMessage, 'Ordering is currently closed by the administrator.');
});

test('no active session: closed, not sold out', async () => {
  await sql`UPDATE ordering_sessions SET archived_at = now() WHERE archived_at IS NULL`;
  statusService.invalidate();
  const st = await status();
  assert.equal(st.orderingOpen, false);
  assert.equal(st.soldOut, false);
  assert.equal(st.maxPizzas, 0);
});

test('service date wording matches v1 (ordinals)', () => {
  const f = statusService.formatServiceDate;
  assert.equal(f('2026-10-01'), 'Thursday 1st October 2026');
  assert.equal(f('2026-10-02'), 'Friday 2nd October 2026');
  assert.equal(f('2026-10-13'), 'Tuesday 13th October 2026');
  assert.equal(f('2026-10-22'), 'Thursday 22nd October 2026');
});
