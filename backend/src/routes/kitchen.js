'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');

async function getBoard(_req, res) {
  // Return the current session's order items, grouped by class — the kitchen checklist.
  const [session] = await sql`
    SELECT id FROM ordering_sessions WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1
  `;
  if (!session) return res.json({ success: true, items: [] });

  const items = await sql`
    SELECT
      i.id,
      i.child_name,
      i.child_class,
      i.size,
      i.prepared,
      i.prepared_at,
      o.public_order_code AS order_code,
      o.payment_method,
      o.payment_status,
      o.allergy_flag,
      o.allergy_notes,
      c.name AS payer_name
    FROM   order_items i
    JOIN   orders      o ON o.id = i.order_id
    JOIN   customers   c ON c.id = o.customer_id
    WHERE  o.session_id = ${session.id}
      AND  NOT o.is_deleted
    ORDER  BY o.public_order_code, i.id
  `;

  res.json({ success: true, items, sessionId: session.id });
}

async function tickItem(req, res) {
  const { id } = req.params;
  const { prepared } = req.body;
  if (prepared === undefined) throw new HttpError(400, 'prepared (boolean) required.');

  const [item] = await sql`
    UPDATE order_items
    SET prepared = ${!!prepared}, prepared_at = ${prepared ? new Date() : null}
    WHERE id = ${id}
    RETURNING id, prepared, prepared_at, order_id
  `;
  if (!item) throw new HttpError(404, 'Item not found.');

  // Broadcast to all connected kitchen/admin clients via Socket.IO.
  const io = req.app.get('io');
  if (io) io.to('kitchen').emit('item:tick', item);

  res.json({ success: true, item });
}

module.exports = { getBoard, tickItem };
