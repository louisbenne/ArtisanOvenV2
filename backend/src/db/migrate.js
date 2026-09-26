'use strict';

// Run the schema SQL against the connected database.
// Safe to re-run: every statement uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
// Usage: node src/db/migrate.js   (or require('./migrate').migrate(sql) from tests)

const fs   = require('fs');
const path = require('path');

async function migrate(sql) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await sql.unsafe(schema);
}

module.exports = { migrate };

if (require.main === module) {
  const sql = require('./index');
  migrate(sql)
    .then(() => { console.log('Migration complete.'); return sql.end(); })
    .catch(err => {
      console.error('Migration failed:', err?.message || err);
      if (err?.errors) err.errors.forEach((e, i) => console.error(`  [${i}]`, e));
      process.exit(1);
    });
}
