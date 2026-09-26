'use strict';

// Numbered migrations: src/db/migrations/NNN_description.sql, applied in order,
// each exactly once (recorded in schema_migrations). Never edit an applied file —
// add a new one. Runs on every container start; with nothing pending it's a no-op.
// Usage: node src/db/migrate.js   (or require('./migrate').migrate(sql) from tests)

const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 7_331_001;   // advisory lock: two containers never migrate at once

function migrationFiles() {
  return fs.readdirSync(DIR)
    .filter(f => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();
}

async function migrate(sql, { log = () => {} } = {}) {
  const applied = [];
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    const done = new Set((await tx`SELECT version FROM schema_migrations`).map(r => r.version));

    for (const file of migrationFiles()) {
      const version = file.slice(0, 3);
      if (done.has(version)) continue;
      await tx.unsafe(fs.readFileSync(path.join(DIR, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (version) VALUES (${version})`;
      applied.push(file);
      log(`applied ${file}`);
    }
  });
  return applied;
}

module.exports = { migrate, migrationFiles };

if (require.main === module) {
  const sql = require('./index');
  migrate(sql, { log: m => console.log(`[migrate] ${m}`) })
    .then(applied => {
      console.log(`[migrate] ${applied.length ? `${applied.length} applied` : 'up to date'}`);
      return sql.end();
    })
    .catch(err => {
      console.error('[migrate] failed:', err?.message || err);
      process.exit(1);
    });
}
