'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');
const { slugFor, publicEvent } = require('../domain/events');

const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

// Public routes address events by slug (v1's Event ID); admin routes by internal id.
const findActiveBySlug = async slug => (await sql`
  SELECT * FROM events WHERE lower(slug) = lower(${String(slug)}) AND active`)[0];

// ── Public (v1 getEvents / getEvent / registerInterest) ───────────────────────
async function list(_req, res) {
  const rows = await sql`SELECT * FROM events WHERE active ORDER BY created_at, id`;
  res.json({ success: true, events: rows.map(publicEvent) });
}

async function get(req, res) {
  const event = await findActiveBySlug(req.params.id);
  if (!event) throw new HttpError(404, 'Event not found');
  res.json({ success: true, event: publicEvent(event) });
}

async function registerInterest(req, res) {
  const name  = String(req.body.customerName || req.body.name || '').trim();
  const email = String(req.body.customerEmail || req.body.email || '').trim();
  const notes = req.body.notes || req.body.details || null;

  const event = await findActiveBySlug(req.params.id);
  if (!event) throw new HttpError(404, 'Event not found');
  if (!name) throw new HttpError(400, 'Please provide your name.');
  if (email && !isValidEmail(email)) throw new HttpError(400, 'Please provide a valid email address.');

  await sql`
    INSERT INTO event_interest (event_id, name, email, phone_e164, notes)
    VALUES (${event.id}, ${name}, ${email || null}, ${req.body.phone ?? null}, ${notes})
  `;
  res.status(201).json({ success: true, message: 'Interest registered successfully!' });
}

// ── Admin ─────────────────────────────────────────────────────────────────────
async function adminList(_req, res) {
  const rows = await sql`
    SELECT e.*, (SELECT COUNT(*) FROM event_interest i WHERE i.event_id = e.id)::INTEGER AS interest_count
    FROM   events e
    ORDER  BY e.created_at DESC
  `;
  res.json({ success: true, events: rows });
}

async function adminGet(req, res) {
  const [event] = await sql`SELECT * FROM events WHERE id = ${parseInt(req.params.id, 10) || 0}`;
  if (!event) throw new HttpError(404, 'Event not found.');
  res.json({ success: true, event });
}

const EDITABLE = ['name', 'description', 'event_date', 'event_time', 'location', 'status', 'ordering_deadline',
                  'customer_instructions', 'email_subject_override', 'email_message_override',
                  'register_interest_mode', 'active'];

function pickEditable(body) {
  const out = {};
  for (const k of EDITABLE) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (body[camel] !== undefined) out[k] = body[camel];
    if (body[k]     !== undefined) out[k] = body[k];
  }
  return out;
}

async function adminCreate(req, res) {
  const fields = pickEditable(req.body);
  if (!fields.name) throw new HttpError(400, 'name required.');
  const slug = String(req.body.slug || req.body.eventId || '').trim() || slugFor(fields.name);

  const [event] = await sql`
    INSERT INTO events ${sql({ status: 'Open', active: true, register_interest_mode: false, ...fields, slug })}
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  if (!event) throw new HttpError(409, `An event with ID "${slug}" already exists.`);

  await logAudit({ adminUserId: req.admin.id, action: 'create_event', targetTable: 'events', targetId: String(event.id) });
  res.status(201).json({ success: true, event });
}

async function adminUpdate(req, res) {
  const id = parseInt(req.params.id, 10) || 0;
  const updates = pickEditable(req.body);
  if (!Object.keys(updates).length) throw new HttpError(400, 'Nothing to update.');

  const [event] = await sql`UPDATE events SET ${sql(updates)} WHERE id = ${id} RETURNING *`;
  if (!event) throw new HttpError(404, 'Event not found.');

  await logAudit({ adminUserId: req.admin.id, action: 'update_event', targetTable: 'events', targetId: String(id) });
  res.json({ success: true, event });
}

// v1 hard-deletes events. Events with orders are kept (their orders reference
// them) — deactivate those instead.
async function adminDelete(req, res) {
  const id = parseInt(req.params.id, 10) || 0;
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM orders WHERE event_id = ${id}`;
  if (n > 0) throw new HttpError(409, 'This event has orders — set it inactive instead of deleting it.');
  await sql.begin(async tx => {
    await tx`DELETE FROM event_interest WHERE event_id = ${id}`;
    await tx`DELETE FROM events WHERE id = ${id}`;
  });
  await logAudit({ adminUserId: req.admin.id, action: 'delete_event', targetTable: 'events', targetId: String(id) });
  res.json({ success: true });
}

async function adminInterest(_req, res) {
  const rows = await sql`
    SELECT i.*, e.name AS event_name, e.slug AS event_slug
    FROM   event_interest i
    JOIN   events         e ON e.id = i.event_id
    ORDER  BY i.created_at DESC
  `;
  res.json({ success: true, interest: rows });
}

module.exports = { list, get, registerInterest, adminList, adminGet, adminCreate, adminUpdate, adminDelete, adminInterest };
