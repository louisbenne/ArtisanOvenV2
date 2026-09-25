'use strict';

// Run the schema SQL against the connected database.
// Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
// Usage: node src/db/migrate.js

const fs   = require('fs');
const path = require('path');
const sql  = require('./index');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await sql.unsafe(schema);
  console.log('Migration complete.');
  await sql.end();
}

migrate().catch(err => {
  console.error('Migration failed (full error):', err);
  console.error('message:', err?.message);
  console.error('stack:', err?.stack);
  console.error('DATABASE_URL set:', !!process.env.DATABASE_URL);
  if (err?.errors) err.errors.forEach((e, i) => console.error(`  [${i}]`, e));
  process.exit(1);
});
