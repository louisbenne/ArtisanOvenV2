'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');

async function getCurrent(_req, res) {
  const [session] = await sql`
    SELECT
      s.id,
      s.service_date,
      s.service_title,
      s.max_pizzas,
      s.ordering_open,
      s.auto_close_at,
      COALESCE(
        SUM(
          CASE i.size
            WHEN '12inch'      THEN 1.0
            WHEN 'Half12inch'  THEN 0.5
            WHEN 'Quarter12inch' THEN 0.25
          END
        ), 0
      )::NUMERIC(6,2) AS current_pizzas
    FROM ordering_sessions s
    LEFT JOIN orders     o ON o.session_id = s.id AND NOT o.is_deleted
    LEFT JOIN order_items i ON i.order_id  = o.id
    WHERE s.archived_at IS NULL
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT 1
  `;

  if (!session) {
    return res.json({
      success: true,
      orderingOpen: false,
      serviceTitle: 'No active session',
      currentPizzas: 0,
      maxPizzas: 0,
      remainingPizzas: 0,
    });
  }

  const isPastDeadline = session.auto_close_at && new Date() > new Date(session.auto_close_at);
  const currentPizzas  = parseFloat(session.current_pizzas);
  const remaining      = Math.max(0, session.max_pizzas - currentPizzas);
  const orderingOpen   = session.ordering_open && !isPastDeadline && remaining > 0;

  res.json({
    success:         true,
    sessionId:       session.id,
    serviceTitle:    session.service_title,
    serviceDate:     session.service_date,
    maxPizzas:       session.max_pizzas,
    currentPizzas,
    remainingPizzas: remaining,
    orderingOpen,
    autoCloseAt:     session.auto_close_at,
  });
}

async function adminList(_req, res) {
  const sessions = await sql`
    SELECT id, service_date, service_title, max_pizzas, ordering_open, auto_close_at,
           archived_at, created_at
    FROM   ordering_sessions
    ORDER  BY created_at DESC
    LIMIT  50
  `;
  res.json({ success: true, sessions });
}

async function adminCreate(req, res) {
  const { serviceDate, serviceTitle, maxPizzas, autoCloseAt } = req.body;
  if (!serviceDate || !serviceTitle || !maxPizzas) {
    throw new HttpError(400, 'serviceDate, serviceTitle, maxPizzas required.');
  }

  // Archive the current open session if one exists.
  await sql`
    UPDATE ordering_sessions SET archived_at = now()
    WHERE  archived_at IS NULL
  `;

  const [session] = await sql`
    INSERT INTO ordering_sessions (service_date, service_title, max_pizzas, auto_close_at)
    VALUES (${serviceDate}, ${serviceTitle}, ${maxPizzas}, ${autoCloseAt ?? null})
    RETURNING *
  `;

  res.status(201).json({ success: true, session });
}

async function adminUpdate(req, res) {
  const { id } = req.params;
  const fields  = {};
  const allowed = ['service_title', 'max_pizzas', 'ordering_open', 'auto_close_at'];

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
