'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');

async function getBoard(_req, res) {
  const [session] = await sql`
    SELECT id FROM ordering_sessions WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1
  `;
  if (!session) return res.json({ success: true, orders: [], sessionId: null });

  const rows = await sql`
    SELECT
      o.id            AS order_db_id,
      o.public_order_code,
      o.payment_method,
      o.payment_status,
      o.allergy_flag,
      o.allergy_notes,
      o.notes,
      c.name          AS payer_name,
      i.id            AS item_id,
      i.child_name,
      i.child_class,
      i.size,
      i.topping,
      i.unit_price_pence,
      i.prepared,
      i.prepared_at
    FROM   order_items i
    JOIN   orders      o ON o.id = i.order_id
    JOIN   customers   c ON c.id = o.customer_id
    WHERE  o.session_id = ${session.id}
      AND  NOT o.is_deleted
    ORDER  BY o.public_order_code, i.id
  `;

  const orderMap = new Map();
  for (const row of rows) {
    if (!orderMap.has(row.order_db_id)) {
      orderMap.set(row.order_db_id, {
        orderCode:     row.public_order_code,
        payerName:     row.payer_name,
        paymentMethod: row.payment_method,
        paymentStatus: row.payment_status,
        allergyFlag:   row.allergy_flag,
        allergyNotes:  row.allergy_notes,
        notes:         row.notes,
        items:         [],
      });
    }
    orderMap.get(row.order_db_id).items.push({
      id:         row.item_id,
      childName:  row.child_name,
      childClass: row.child_class,
      size:       row.size,
      topping:    row.topping,
      price:      row.unit_price_pence / 100,
      prepared:   row.prepared,
      preparedAt: row.prepared_at,
    });
  }

  res.json({ success: true, orders: [...orderMap.values()], sessionId: session.id });
}

async function tick(req, res) {
  const { itemId, prepared = true } = req.body;
  if (!itemId) throw new HttpError(400, 'itemId required.');

  const [item] = await sql`
    UPDATE order_items
    SET prepared = ${!!prepared}, prepared_at = ${prepared ? new Date() : null}
    WHERE id = ${itemId}
    RETURNING id, prepared, prepared_at, order_id
  `;
  if (!item) throw new HttpError(404, 'Item not found.');

  const io = req.app.get('io');
  if (io) {
    const kitchenNs = io.of('/kitchen');
    kitchenNs.to('kitchen').emit('item:tick', item);
  }

  res.json({ success: true, item });
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

  const io = req.app.get('io');
  if (io) {
    const kitchenNs = io.of('/kitchen');
    kitchenNs.to('kitchen').emit('item:tick', item);
  }

  res.json({ success: true, item });
}

module.exports = { getBoard, tick, tickItem };
