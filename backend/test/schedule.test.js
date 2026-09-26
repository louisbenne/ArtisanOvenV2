'use strict';
// Weekly schedule in Europe/London, driven by settings (v1 fragility #6),
// correct either side of the BST→GMT change on Sunday 25 Oct 2026.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/domain/schedule');

const v1 = { auto_close_enabled: true, close_weekday: 7, close_time: '21:00', reopen_weekday: 2, reopen_time: '13:00' };
const at = iso => new Date(iso);

test('v1 default window: Sunday 21:00 → Tuesday 13:00 (BST week)', () => {
  assert.equal(s.isPastDeadline(v1, at('2026-10-18T19:59:00Z')), false); // Sun 20:59 BST
  assert.equal(s.isPastDeadline(v1, at('2026-10-18T20:00:00Z')), true);  // Sun 21:00 BST
  assert.equal(s.isPastDeadline(v1, at('2026-10-19T12:00:00Z')), true);  // Monday
  assert.equal(s.isPastDeadline(v1, at('2026-10-20T11:59:00Z')), true);  // Tue 12:59 BST
  assert.equal(s.isPastDeadline(v1, at('2026-10-20T12:00:00Z')), false); // Tue 13:00 BST
  assert.equal(s.isPastDeadline(v1, at('2026-10-21T12:00:00Z')), false); // Wednesday
});

test('after the clocks go back (GMT): Sunday 21:00 is 21:00Z', () => {
  assert.equal(s.isPastDeadline(v1, at('2026-10-25T20:59:00Z')), false);
  assert.equal(s.isPastDeadline(v1, at('2026-10-25T21:00:00Z')), true);
  assert.equal(s.nextOccurrence(7, '21:00', at('2026-10-22T10:00:00Z')).toISOString(), '2026-10-25T21:00:00.000Z');
  assert.equal(s.nextOccurrence(7, '21:00', at('2026-10-15T10:00:00Z')).toISOString(), '2026-10-18T20:00:00.000Z');
});

test('the configured days are honoured (not hardcoded to Tuesday)', () => {
  const fri = { auto_close_enabled: true, close_weekday: 5, close_time: '18:00', reopen_weekday: 1, reopen_time: '09:00' };
  assert.equal(s.isPastDeadline(fri, at('2026-10-10T12:00:00Z')), true);   // Saturday
  assert.equal(s.isPastDeadline(fri, at('2026-10-12T07:59:00Z')), true);   // Mon 08:59 BST
  assert.equal(s.isPastDeadline(fri, at('2026-10-12T08:00:00Z')), false);  // Mon 09:00 BST
  assert.equal(s.isPastDeadline({ ...fri, auto_close_enabled: false }, at('2026-10-10T12:00:00Z')), false);
});

test('closingSchedule text matches v1 ("Sunday at 21:00")', () => {
  assert.equal(s.closingSchedule(v1), 'Sunday at 21:00');
});

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); });
after(() => app.close());

test('orders are refused inside the closed window and accepted outside it', async () => {
  await createSession(sql);
  const today = s.londonParts(new Date()).weekday;
  const tomorrow = today % 7 + 1;
  await sql`UPDATE site_settings SET close_weekday = ${today}, close_time = '00:00',
                                     reopen_weekday = ${tomorrow}, reopen_time = '00:00' WHERE id = 1`;
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 409);
  await sql`UPDATE site_settings SET auto_close_enabled = FALSE WHERE id = 1`;
  assert.equal((await app.api('POST', '/api/orders', lunchOrder())).status, 201);
});
