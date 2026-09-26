'use strict';
// Bug 12: the submission id was stored in notes as "sub:…" and matched with LIKE —
// visible junk on admin/kitchen screens, only a 10-minute window, and racy.
const { resetDb, startApp, createSession, lunchOrder } = require('./helpers');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let app, sql;
before(async () => { sql = await resetDb(); app = await startApp(); });
after(() => app.close());

test('resubmitting the same submissionId returns the original order', async () => {
  await createSession(sql);
  const body = lunchOrder({ submissionId: 'sub_abc_1', notes: 'No basil please' });
  const first  = await app.api('POST', '/api/orders', body);
  const second = await app.api('POST', '/api/orders', body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.body.orderId, first.body.orderId);
  assert.equal(second.body.token, first.body.token);
  assert.equal((await sql`SELECT count(*)::int AS n FROM orders`)[0].n, 1);
});

test('notes are stored clean (no "sub:" marker)', async () => {
  const [o] = await sql`SELECT notes, submission_id FROM orders WHERE submission_id = 'sub_abc_1'`;
  assert.equal(o.notes, 'No basil please');
});

test('simultaneous identical submissions create exactly one order and use one capacity slot', async () => {
  const session = await createSession(sql, { maxPizzas: 5 });
  const body = lunchOrder({ submissionId: 'sub_race_1' });
  const results = await Promise.all(Array.from({ length: 8 }, () => app.api('POST', '/api/orders', body)));
  assert.ok(results.every(r => r.status === 200 || r.status === 201), results.map(r => r.status).join());
  assert.equal(new Set(results.map(r => r.body.id)).size, 1);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM orders WHERE session_id = ${session.id}`;
  assert.equal(n, 1);
  const [{ next }] = await sql`SELECT next_lunch_number AS next FROM ordering_sessions WHERE id = ${session.id}`;
  assert.equal(next, 2);   // only #1 was used
});

test('orders without a submissionId are never treated as duplicates', async () => {
  await createSession(sql);
  const a = await app.api('POST', '/api/orders', lunchOrder());
  const b = await app.api('POST', '/api/orders', lunchOrder());
  assert.notEqual(a.body.id, b.body.id);
});

test('migration 004 moves existing "sub:" markers out of notes', async () => {
  await createSession(sql);
  const { id: withNote } = (await app.api('POST', '/api/orders', lunchOrder())).body;
  const { id: onlySub }  = (await app.api('POST', '/api/orders', lunchOrder())).body;
  await sql`ALTER TABLE orders DROP CONSTRAINT orders_submission_id_key`;   // back to pre-004
  await sql`ALTER TABLE orders DROP COLUMN submission_id`;
  await sql`UPDATE orders SET notes = 'Extra napkins | sub:sub_old_1' WHERE id = ${withNote}`;
  await sql`UPDATE orders SET notes = 'sub:sub_old_2' WHERE id = ${onlySub}`;

  await sql.unsafe(fs.readFileSync(path.join(__dirname, '../src/db/migrations/004_submission_id.sql'), 'utf8'));
  const rows = await sql`SELECT id, notes, submission_id FROM orders WHERE id IN (${withNote}, ${onlySub}) ORDER BY id`;
  assert.deepEqual(rows.map(r => [r.notes, r.submission_id]),
    [['Extra napkins', 'sub_old_1'], [null, 'sub_old_2']]);
});
