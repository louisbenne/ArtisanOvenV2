'use strict';
// Bug 1: schema was not re-runnable, so every container restart crash-looped.
// Now: numbered migrations, each applied exactly once.
const { resetDb } = require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { migrate, migrationFiles } = require('../src/db/migrate');

after(() => require('../src/db').end({ timeout: 1 }));

const runCli = () => spawnSync('node', ['src/db/migrate.js'], {
  cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8',
});

test('every migration file is recorded once, and a second run applies nothing', async () => {
  const sql = await resetDb();
  const versions = (await sql`SELECT version FROM schema_migrations ORDER BY version`).map(r => r.version);
  assert.deepEqual(versions, migrationFiles().map(f => f.slice(0, 3)));
  assert.deepEqual(await migrate(sql), []);
});

test('the migrate CLI (what the container runs on boot) exits 0 five times in a row', async () => {
  await resetDb();
  for (let i = 0; i < 5; i++) {
    const run = runCli();
    assert.equal(run.status, 0, run.stderr);
  }
});

test('a pre-migrations database (tables exist, no schema_migrations) is adopted cleanly', async () => {
  const sql = await resetDb();
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const init = fs.readFileSync(path.join(__dirname, '../src/db/migrations/001_init.sql'), 'utf8');
  await sql.unsafe(init);                      // the old schema.sql had run, nothing else
  const applied = await migrate(sql);
  assert.deepEqual(applied, migrationFiles()); // 001 adopted, later ones applied
});

test('concurrent migrate runs (two containers booting) do not collide', async () => {
  const sql = await resetDb();
  await sql`DROP TABLE schema_migrations`;
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  const results = await Promise.all([migrate(sql), migrate(sql)]);
  assert.equal(results.flat().length, migrationFiles().length);
});
