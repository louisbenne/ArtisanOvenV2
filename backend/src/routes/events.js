'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');

async function list(_req, res) {
  const rows = await sql`
    SELECT id, name, event_date, event_time, location, status,
           customer_instructions, register_interest_mode, active
    FROM   events
    WHERE  active = TRUE
    ORDER  BY event_date ASC NULLS LAST
  `;
  res.json({ success: true, events: rows });
}

async function get(req, res) {
  const [event] = await sql`
    SELECT * FROM events WHERE id = ${req.params.id} AND active = TRUE
  `;
  if (!event) throw new HttpError(404, 'Event not found.');
  res.json({ success: true, event });
}

async function registerInterest(req, res) {
  const { name, email, phone, notes } = req.body;
  const eventId = req.params.id;

  const [event] = await sql`SELECT id FROM events WHERE id = ${eventId} AND active`;
  if (!event) throw new HttpError(404, 'Event not found.');

  await sql`
    INSERT INTO event_interest (event_id, name, email, phone_e164, notes)
    VALUES (${eventId}, ${name ?? null}, ${email ?? null}, ${phone ?? null}, ${notes ?? null})
  `;
  res.status(201).json({ success: true });
}

async function adminList(_req, res) {
  const rows = await sql`SELECT * FROM events ORDER BY created_at DESC`;
  res.json({ success: true, events: rows });
}

async function adminCreate(req, res) {
  const { name, eventDate, eventTime, location, status = 'Open',
          customerInstructions, emailSubjectOverride, emailMessageOverride,
          registerInterestMode = false, active = true } = req.body;
  if (!name) throw new HttpError(400, 'name required.');

  const [event] = await sql`
    INSERT INTO events (
      name, event_date, event_time, location, status,
      customer_instructions, email_subject_override, email_message_override,
      register_interest_mode, active
    ) VALUES (
      ${name}, ${eventDate ?? null}, ${eventTime ?? null}, ${location ?? null}, ${status},
      ${customerInstructions ?? null}, ${emailSubjectOverride ?? null}, ${emailMessageOverride ?? null},
      ${!!registerInterestMode}, ${!!active}
    ) RETURNING *
  `;

  await logAudit({ adminUserId: req.admin.id, action: 'create_event',
                   targetTable: 'events', targetId: String(event.id) });
  res.status(201).json({ success: true, event });
}

async function adminUpdate(req, res) {
  const { id } = req.params;
  const allowed = ['name','event_date','event_time','location','status',
                   'customer_instructions','email_subject_override','email_message_override',
                   'register_interest_mode','active'];
  const updates = {};
  for (const k of allowed) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[camel] !== undefined) updates[k] = req.body[camel];
    if (req.body[k]     !== undefined) updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) throw new HttpError(400, 'Nothing to update.');

  const [event] = await sql`UPDATE events SET ${sql(updates)} WHERE id = ${id} RETURNING *`;
  if (!event) throw new HttpError(404, 'Event not found.');

  await logAudit({ adminUserId: req.admin.id, action: 'update_event',
                   targetTable: 'events', targetId: String(id) });
  res.json({ success: true, event });
}

async function adminDelete(req, res) {
  const { id } = req.params;
  await sql`DELETE FROM events WHERE id = ${id}`;
  await logAudit({ adminUserId: req.admin.id, action: 'delete_event',
                   targetTable: 'events', targetId: String(id) });
  res.json({ success: true });
}

async function adminInterest(_req, res) {
  const rows = await sql`
    SELECT i.*, e.name AS event_name
    FROM   event_interest i
    JOIN   events         e ON e.id = i.event_id
    ORDER  BY i.created_at DESC
  `;
  res.json({ success: true, interest: rows });
}

module.exports = { list, get, registerInterest, adminList, adminCreate, adminUpdate, adminDelete, adminInterest };
