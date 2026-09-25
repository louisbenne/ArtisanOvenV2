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
  console.error('Migration failed:', err.message);
  process.exit(1);
});
