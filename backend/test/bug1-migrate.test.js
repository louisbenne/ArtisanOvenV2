'use strict';
// Bug 1: schema was not re-runnable, so every container restart crash-looped.
const { resetDb } = require('./helpers');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

after(() => require('../src/db').end({ timeout: 1 }));

test('migrations run twice on the same database without error', async () => {
  const sql = await resetDb();                       // first run
  await require('../src/db/migrate').migrate(sql);   // second run
});

test('the migrate CLI (what the container runs on boot) exits 0 on an existing DB', async () => {
  await resetDb();
  const run = spawnSync('node', ['src/db/migrate.js'], {
    cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
});
