#!/usr/bin/env node
'use strict';
/**
 * migrate-from-v1.js — import a v1 Google Sheets CSV export into the v2 database.
 *
 * Usage:
 *   node scripts/migrate-from-v1.js --csv path/to/orders.csv
 *
 * Expected v1 columns: [Timestamp, Name, Email, Size, Topping, Paid, Notes]
 * Run AFTER the v2 schema has been migrated (npm run migrate).
 */

// This importer assumes CSV columns v1 never had (bug 10) and the pre-002 order
// codes. It is rewritten for real v1 workbook exports in Phase 7.
console.error('migrate-from-v1.js is disabled until Phase 7 (see docs/V2_MASTER_PLAN.md).');
process.exit(1);

const fs   = require('fs');
const path = require('path');
const sql  = require('../src/db');

const args     = process.argv.slice(2);
const csvIndex = args.indexOf('--csv');
if (csvIndex === -1 || !args[csvIndex + 1]) {
  console.error('Usage: node scripts/migrate-from-v1.js --csv <path>');
  process.exit(1);
}

const csvPath = path.resolve(args[csvIndex + 1]);
if (!fs.existsSync(csvPath)) {
  console.error('File not found:', csvPath);
  process.exit(1);
}

async function run() {
  const raw    = fs.readFileSync(csvPath, 'utf8');
  const lines  = raw.trim().split('\n');
  const header = lines.shift().split(',').map(h => h.trim().replace(/"/g, ''));
  console.log('Headers:', header);

  let inserted = 0;
  let skipped  = 0;

  await sql.begin(async sql => {
    // Ensure a legacy migration session exists.
    let [session] = await sql`
      SELECT id FROM ordering_sessions WHERE service_title = 'V1 Migration Import'
    `;
    if (!session) {
      [session] = await sql`
        INSERT INTO ordering_sessions (service_title, service_date, ordering_open, max_pizzas)
        VALUES ('V1 Migration Import', CURRENT_DATE, false, 9999)
        RETURNING id
      `;
    }
    const sessionId = session.id;

    for (const line of lines) {
      const cols = parseCsvLine(line);
      if (cols.length < 4) { skipped++; continue; }

      const name    = cols[header.indexOf('Name')]    ?? cols[1] ?? '';
      const email   = cols[header.indexOf('Email')]   ?? cols[2] ?? '';
      const size    = cols[header.indexOf('Size')]    ?? cols[3] ?? '12inch';
      const topping = cols[header.indexOf('Topping')] ?? cols[4] ?? '';
      const paid    = (cols[header.indexOf('Paid')]   ?? cols[5] ?? '').toLowerCase();
      const notes   = cols[header.indexOf('Notes')]   ?? cols[6] ?? '';

      if (!name || !email) { skipped++; continue; }

      // Normalise size aliases from v1 free-text.
      const sizeMap = { half: 'Half12inch', quarter: 'Quarter12inch', '12inch': '12inch' };
      const normSize = sizeMap[size.toLowerCase()] || '12inch';
      const priceMap = { '12inch': 800, 'Half12inch': 450, 'Quarter12inch': 250 };
      const pricePence = priceMap[normSize];

      // Upsert customer.
      const [customer] = await sql`
        INSERT INTO customers (name, email)
        VALUES (${name.trim()}, ${email.toLowerCase().trim()})
        ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;

      // Atomically allocate next lunch order code.
      const [counter] = await sql`
        UPDATE order_code_counters
        SET next_val = next_val + 1
        WHERE order_type = 'lunch'
        RETURNING next_val - 1 AS seq
      `;
      const publicCode = `L-${String(counter.seq).padStart(4, '0')}`;
      const isPaid = paid === 'yes' || paid === 'true' || paid === '1';

      const [order] = await sql`
        INSERT INTO orders (
          public_order_code, order_type, session_id, customer_id,
          subtotal_pence, discount_pence, total_pence,
          payment_status, notes
        )
        VALUES (
          ${publicCode}, 'lunch', ${sessionId}, ${customer.id},
          ${pricePence}, 0, ${pricePence},
          ${isPaid ? 'paid' : 'unpaid'},
          ${notes.trim() || null}
        )
        RETURNING id
      `;

      await sql`
        INSERT INTO order_items (order_id, size, topping, unit_price_pence)
        VALUES (${order.id}, ${normSize}, ${topping.trim() || null}, ${pricePence})
      `;

      if (isPaid) {
        await sql`
          INSERT INTO payments (order_id, amount_pence, method, note)
          VALUES (${order.id}, ${pricePence}, 'cash', 'migrated from v1')
        `;
      }

      inserted++;
    }
  });

  console.log(`Migration complete: ${inserted} inserted, ${skipped} skipped.`);
  await sql.end();
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  result.push(cur.trim());
  return result;
}

run().catch(err => { console.error(err); process.exit(1); });
