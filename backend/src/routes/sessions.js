'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const schedule = require('../domain/schedule');

// Superseded by GET /api/status (v1-shaped) — kept for the interim v2 UI.
async function getCurrent(_req, res) {
  const [session] = await sql`
    SELECT id, service_date, service_title, max_pizzas, ordering_open
    FROM   ordering_sessions WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1
  `;
  if (!session) {
    return res.json({
      success: true, orderingOpen: false, serviceTitle: 'No active session',
      currentPizzas: 0, maxPizzas: 0, remainingPizzas: 0,
    });
  }

  const [{ current }] = await sql`
    SELECT COALESCE(SUM(CASE i.size WHEN '12inch' THEN 1.0 WHEN 'Half12inch' THEN 0.5
                                    WHEN 'Quarter12inch' THEN 0.25 END), 0)::float AS current
    FROM   orders o JOIN order_items i ON i.order_id = o.id
    WHERE  o.session_id = ${session.id} AND o.order_type IN ('lunch', 'parent') AND NOT o.is_deleted
  `;
  const [settings] = await sql`SELECT * FROM site_settings WHERE id = 1`;
  const isPastDeadline = settings ? schedule.isPastDeadline(settings) : false;
  const remaining      = Math.max(0, session.max_pizzas - current);

  res.json({
    success:         true,
    sessionId:       session.id,
    serviceTitle:    session.service_title,
    serviceDate:     session.service_date,
    maxPizzas:       session.max_pizzas,
    currentPizzas:   current,
    remainingPizzas: remaining,
    orderingOpen:    session.ordering_open && !isPastDeadline && remaining > 0,
  });
}

async function adminList(_req, res) {
  const sessions = await sql`
    SELECT id, service_date, service_title, max_pizzas, ordering_open, archived_at, created_at
    FROM   ordering_sessions
    ORDER  BY created_at DESC
    LIMIT  50
  `;
  res.json({ success: true, sessions });
}

async function adminCreate(req, res) {
  const { serviceDate, serviceTitle, maxPizzas } = req.body;
  if (!serviceDate || !serviceTitle || !maxPizzas) {
    throw new HttpError(400, 'serviceDate, serviceTitle, maxPizzas required.');
  }

  const session = await sql.begin(async tx => {
    // Archive the current open session (history is kept, never deleted).
    await tx`UPDATE ordering_sessions SET archived_at = now() WHERE archived_at IS NULL`;
    const [s] = await tx`
      INSERT INTO ordering_sessions (service_date, service_title, max_pizzas)
      VALUES (${serviceDate}, ${serviceTitle}, ${maxPizzas})
      RETURNING *
    `;
    return s;
  });

  res.status(201).json({ success: true, session });
}

async function adminUpdate(req, res) {
  const { id } = req.params;
  const fields  = {};
  const allowed = ['service_date', 'service_title', 'max_pizzas', 'ordering_open'];

  for (const k of allowed) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update.');

  const [session] = await sql`
    UPDATE ordering_sessions SET ${sql(fields)} WHERE id = ${id} RETURNING *
  `;
  if (!session) throw new HttpError(404, 'Session not found.');

  res.json({ success: true, session });
}

module.exports = { getCurrent, adminList, adminCreate, adminUpdate };
