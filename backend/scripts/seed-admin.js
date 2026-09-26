'use strict';

// Setup: creates (or resets the password of) the owner account, and optionally
// the parent access code.
// Run: ADMIN_PASSWORD=… [PARENT_ACCESS_CODE=…] node scripts/seed-admin.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const bcrypt = require('bcrypt');
const sql    = require('../src/db');

async function seed() {
  const username = (process.env.ADMIN_USERNAME || 'louis').trim().toLowerCase();
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

  // Parent access code → the gated MUTTI discount (like v1's PARENT_ACCESS_CODE).
  // Only when provided: never ship a guessable default.
  const parentCode = process.env.PARENT_ACCESS_CODE?.trim().toUpperCase();
  if (parentCode) {
    await sql`
      INSERT INTO access_codes (code, purpose, linked_discount_code)
      VALUES (${parentCode}, 'parent_gate', 'MUTTI')
      ON CONFLICT (code) DO UPDATE SET active = TRUE, linked_discount_code = 'MUTTI'
    `;
    console.log(`Parent access code set → MUTTI (50% off)`);
  }

  await sql.end();
  console.log('Seed complete.');
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
