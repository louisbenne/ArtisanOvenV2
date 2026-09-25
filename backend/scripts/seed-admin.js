'use strict';

// One-time setup: creates the first owner account and the parent_gate pseudo-user.
// Run: node scripts/seed-admin.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bcrypt = require('bcrypt');
const sql    = require('../src/db');

async function seed() {
  const username = process.env.ADMIN_USERNAME || 'louis';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('Set ADMIN_PASSWORD env var before running this script.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  // Owner account.
  const [owner] = await sql`
    INSERT INTO admin_users (username, password_hash, role)
    VALUES (${username}, ${hash}, 'owner')
    ON CONFLICT (username) DO UPDATE SET password_hash = ${hash}
    RETURNING id, username, role
  `;
  console.log('Owner account:', owner);

  // Parent gate pseudo-user (no real login — used only to issue parent session tokens).
  await sql`
    INSERT INTO admin_users (username, password_hash, role, active)
    VALUES ('parent_gate', ${hash}, 'volunteer', TRUE)
    ON CONFLICT (username) DO NOTHING
  `;

  // Seed the default parent access code pointing at MUTTI discount.
  await sql`
    INSERT INTO access_codes (code, purpose, linked_discount_code)
    VALUES ('PARENTGATE', 'parent_gate', 'MUTTI')
    ON CONFLICT DO NOTHING
  `;
  console.log('Parent access code: PARENTGATE → MUTTI (50% off)');

  await sql.end();
  console.log('Seed complete.');
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
