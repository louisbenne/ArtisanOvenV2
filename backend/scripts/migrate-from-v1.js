#!/usr/bin/env node
'use strict';
/**
 * migrate-from-v1.js — stub for migrating data from the v1 Google Sheets export.
 *
 * Usage:
 *   node scripts/migrate-from-v1.js --csv path/to/orders.csv
 *
 * The v1 export has columns: [Timestamp, Name, Email, Size, Topping, Paid, Notes]
 * This script reads that CSV and inserts rows into the v2 database.
 *
 * Run AFTER the v2 schema has been migrated (npm run migrate).
 */

const fs   = require('fs');
const path = require('path');
const sql  = require('../src/db');

const args = process.argv.slice(2);
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
  const raw  = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.trim().split('\n');
  const header = lines.shift().split(',').map(h => h.trim().replace(/"/g, ''));
  console.log('Headers:', header);

  let inserted = 0;
  let skipped  = 0;

  await sql.begin(async sql => {
    // Ensure a legacy migration session exists
    let [session] = await sql`
      SELECT session_id FROM ordering_sessions WHERE service_title = 'V1 Migration Import'
    `;
    if (!session) {
      [session] = await sql`
        INSERT INTO ordering_sessions (service_title, service_date, ordering_open, max_pizzas)
        VALUES ('V1 Migration Import', CURRENT_DATE, false, 9999)
        RETURNING session_id
      `;
    }
    const sessionId = session.session_id;

    // Ensure L counter exists
    await sql`
      INSERT INTO order_code_counters (order_type, next_val)
      VALUES ('L', 1)
      ON CONFLICT (order_type) DO NOTHING
    `;

    for (const line of lines) {
      const cols = parseCsvLine(line);
      if (cols.length < 4) { skipped++; continue; }

      // Best-effort column mapping — adjust indices to match the actual v1 export
      const name    = cols[header.indexOf('Name')]      || cols[1] || '';
      const email   = cols[header.indexOf('Email')]     || cols[2] || '';
      const size    = cols[header.indexOf('Size')]      || cols[3] || '12inch';
      const topping = cols[header.indexOf('Topping')]   || cols[4] || 'Margherita';
      const paid    = (cols[header.indexOf('Paid')]     || cols[5] || '').toLowerCase();
      const notes   = cols[header.indexOf('Notes')]     || cols[6] || '';

      if (!name || !email) { skipped++; continue; }

      // Upsert customer
      const [customer] = await sql`
        INSERT INTO customers (email, name)
        VALUES (${email.toLowerCase().trim()}, ${name.trim()})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
        RETURNING customer_id
      `;

      // Atomically get next order code
      const [counter] = await sql`
        UPDATE order_code_counters
        SET next_val = next_val + 1
        WHERE order_type = 'L'
        RETURNING next_val - 1 AS seq
      `;
      const orderId = `L-${String(counter.seq).padStart(4, '0')}`;

      const priceMap = { '12inch': 800, 'Half': 450, 'Quarter': 250 };
      const pricePence = priceMap[size] || 800;

      const [order] = await sql`
        INSERT INTO orders (order_id, session_id, customer_id, order_type, total_pence, payment_status, notes)
        VALUES (
          ${orderId}, ${sessionId}, ${customer.customer_id},
          'lunch', ${pricePence},
          ${paid === 'yes' || paid === 'true' || paid === '1' ? 'paid' : 'unpaid'},
          ${notes.trim() || null}
        )
        RETURNING order_id
      `;

      await sql`
        INSERT INTO order_items (order_id, size, topping, price_pence)
        VALUES (${order.order_id}, ${size}, ${topping}, ${pricePence})
      `;

      if (paid === 'yes' || paid === 'true' || paid === '1') {
        await sql`
          INSERT INTO payments (order_id, amount_pence, method, notes)
          VALUES (${order.order_id}, ${pricePence}, 'cash', 'migrated from v1')
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
