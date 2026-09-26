'use strict';

// Loads the canonical dataset (fixtures/data.js) into the v2 DEV database, so
// v2 screenshots can be compared with the v1 baseline. Wipes the dev data first.
// Used by TARGET=v2 runs (tests are serial; each test starts from a fresh seed).

const postgres = require('postgres');
const data = require('./data');

const PRICE = { '12inch': 800, 'Half12inch': 500, 'Quarter12inch': 300 };
const METHOD = { 'Bank Transfer': 'bank_transfer', PayPal: 'paypal', Cash: 'cash' };
const PARENT_ACCESS_CODE = 'FAMILY26';

let sql;
const db = () => (sql ||= postgres({
  host: process.env.DB_HOST || 'db', port: 5432, database: 'artisanoven',
  username: 'artisanoven', password: process.env.DB_PASS || 'devpassword', max: 1, onnotice: () => {},
}));

async function seed() {
  const s = data.settings;
  await db().begin(async tx => {
    const tables = (await tx`SELECT tablename FROM pg_tables WHERE schemaname = 'public'
                             AND tablename NOT IN ('schema_migrations', 'site_settings', 'discount_codes', 'order_number_counters')`)
      .map(r => `"${r.tablename}"`).join(', ');
    await tx.unsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);

    await tx`UPDATE site_settings SET
      service_notice_date = ${s.serviceNoticeDate}, capacity_message = ${s.capacityMessage},
      deadline_message = ${s.deadlineMessage}, fully_booked_message = ${s.fullyBookedMessage},
      next_opening_text = ${s.nextOpeningTime}, orders_team_email = ${s.ordersTeamEmail},
      close_weekday = 7, close_time = ${s.autoCloseTime}, reopen_weekday = 2, reopen_time = '13:00',
      auto_close_enabled = FALSE   -- screenshots must not depend on the real clock
      WHERE id = 1`;
    await tx`UPDATE discount_codes SET times_used = 0`;

    const [session] = await tx`
      INSERT INTO ordering_sessions (service_date, service_title, max_pizzas, ordering_open, next_lunch_number)
      VALUES ('2026-09-29', ${s.serviceTitle}, ${s.maxPizzas}, ${s.orderingEnabled}, ${data.lunchOrders.length + 1})
      RETURNING id`;

    const events = {};
    for (const e of data.events) {
      const [row] = await tx`
        INSERT INTO events (slug, name, description, event_date, event_time, location, status,
                            register_interest_mode, active, customer_instructions)
        VALUES (${e.id}, ${e.name}, ${e.description}, ${e.date}, ${e.time}, ${e.location}, ${e.status},
                ${e.registerInterest}, ${e.active}, ${e.customerInstructions})
        RETURNING id`;
      events[e.id] = row.id;
    }

    await tx`INSERT INTO access_codes (code, purpose, linked_discount_code) VALUES (${PARENT_ACCESS_CODE}, 'parent_gate', 'MUTTI')`;

    async function order({ type, number, ref, eventId = null, sessionId = null, payer, email, method, paid,
                           items, discountCode = null, percent = 0, allergy = '', token = null }) {
      const [c] = await tx`
        INSERT INTO customers (name, email) VALUES (${payer}, ${email})
        ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const subtotal = items.reduce((t, i) => t + PRICE[i.size], 0);
      const discount = Math.round(subtotal * percent / 100);
      const total = subtotal - discount;
      const [o] = await tx`
        INSERT INTO orders ${tx({
          order_number: number, order_ref: ref, order_type: type, session_id: sessionId, event_id: eventId,
          customer_id: c.id, subtotal_pence: subtotal, discount_code: discountCode, discount_pence: discount,
          total_pence: total, payment_method: METHOD[method], payment_status: paid ? 'paid' : 'unpaid',
          allergy_flag: Boolean(allergy), allergy_notes: allergy || null,
          ...(token ? { access_token: token } : {}),
        })} RETURNING id`;
      for (const i of items) {
        await tx`INSERT INTO order_items (order_id, child_name, child_class, size, unit_price_pence)
                 VALUES (${o.id}, ${i.childName || null}, ${i.childClass || null}, ${i.size}, ${PRICE[i.size]})`;
      }
      if (paid) await tx`INSERT INTO payments (order_id, amount_pence, method, source) VALUES (${o.id}, ${total}, ${METHOD[method]}, 'admin')`;
    }

    for (const l of data.lunchOrders) {
      await order({
        type: 'lunch', number: l.number, ref: String(l.number), sessionId: session.id,
        payer: l.payer, email: l.email, method: l.method, paid: l.paid, allergy: l.allergy,
        items: l.pizzas.map(([size, childName, childClass]) => ({ size, childName, childClass })),
        discountCode: l.discount || null, percent: l.discount === 'STMSCS' ? 15 : 0,
        token: l.number === 3 ? data.tokens.lunch3 : null,
      });
    }
    const expand = list => list.flatMap(([size, qty]) => Array.from({ length: qty }, () => ({ size })));
    for (const e of data.eventOrders) {
      await order({ type: 'event', number: Number(e.ref.slice(1)), ref: e.ref, eventId: events[e.eventId],
                    payer: e.name, email: e.email, method: e.method, paid: e.paid, items: expand(e.items) });
    }
    for (const p of data.parentOrders) {
      await order({ type: 'parent', number: Number(p.ref.slice(1)), ref: p.ref, sessionId: session.id,
                    payer: p.parent, email: p.email, method: p.method, paid: p.paid, discountCode: 'MUTTI', percent: 50,
                    items: expand(p.items).map(i => ({ ...i, childName: p.child, childClass: p.className })) });
    }
    await tx`UPDATE order_number_counters SET next_value = 106 WHERE name = 'E'`;
  });
}

const close = () => sql && sql.end({ timeout: 1 }).then(() => { sql = null; });

module.exports = { seed, close, PARENT_ACCESS_CODE };
