'use strict';

// Shared test setup. Require this FIRST in every test file:
//   - points the app at a dedicated test database (never the dev/prod one)
//   - resetDb(): drop + re-migrate that database (call once per test file)
//   - startApp(): the real Express app on a random port, with a tiny fetch client

process.env.DB_NAME   = process.env.TEST_DB_NAME || 'artisanoven_test';
process.env.SMTP_HOST = '';          // emails are logged, never sent
process.env.NODE_ENV  = 'test';
process.env.RATE_LIMIT = 'off';     // rate-limit.test.js turns it back on

const postgres = require('postgres');

async function ensureTestDatabase() {
  const admin = postgres({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'artisanoven',
    password: process.env.DB_PASS,
    database: process.env.DB_ADMIN_DB || 'postgres',
    max: 1,
    onnotice: () => {},
  });
  try {
    const name = process.env.DB_NAME;
    const [exists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (!exists) await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

async function resetDb() {
  await ensureTestDatabase();
  const sql = require('../src/db');
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await require('../src/db/migrate').migrate(sql);
  return sql;
}

async function startApp() {
  const { server } = require('../server');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body:    body === undefined ? undefined : JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json ?? text, headers: res.headers };
  }

  async function close() {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await require('../src/db').end({ timeout: 1 });
  }

  return { base, api, server, close };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createSession(sql, { maxPizzas = 20, open = true } = {}) {
  await sql`UPDATE ordering_sessions SET archived_at = now() WHERE archived_at IS NULL`;
  const [s] = await sql`
    INSERT INTO ordering_sessions (service_date, service_title, max_pizzas, ordering_open)
    VALUES (CURRENT_DATE + 1, 'Test Tuesday', ${maxPizzas}, ${open})
    RETURNING *`;
  return s;
}

function lunchOrder(overrides = {}) {
  return {
    orderType:     'lunch',
    payerName:     'Test Parent',
    payerEmail:    'parent@example.com',
    paymentMethod: 'cash',
    items:         [{ size: '12inch', childName: 'Alex', className: '5A' }],
    ...overrides,
  };
}

async function createEvent(sql, { name = 'Summer Fair', status = 'Open' } = {}) {
  const [e] = await sql`
    INSERT INTO events (name, event_date, status) VALUES (${name}, CURRENT_DATE + 30, ${status})
    RETURNING *`;
  return e;
}

// Creates an admin with the given role and logs in → headers for app.api().
async function loginAs(app, sql, role = 'owner') {
  const bcrypt = require('bcrypt');
  const username = `test-${role}`;
  await sql`
    INSERT INTO admin_users (username, password_hash, role)
    VALUES (${username}, ${await bcrypt.hash('pw', 4)}, ${role})
    ON CONFLICT (username) DO NOTHING`;
  const res = await app.api('POST', '/api/admin/login', { username, password: 'pw' });
  if (!res.body.token) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return { authorization: `Bearer ${res.body.token}` };
}

module.exports = { resetDb, startApp, createSession, createEvent, lunchOrder, loginAs };
