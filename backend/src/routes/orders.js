'use strict';

const sql  = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');
const { applyDiscount } = require('../services/discountService');
const { notifyOrder }   = require('../services/notificationService');
const orderNumbers      = require('../domain/orderNumbers');
const { isUuid }        = require('../util/tokens');

const PRICE_PENCE  = { '12inch': 800, 'Half12inch': 500, 'Quarter12inch': 300 };
const CAPACITY     = { '12inch': 1.0, 'Half12inch': 0.5, 'Quarter12inch': 0.25 };
const SIZE_ALIAS   = { Half: 'Half12inch', Quarter: 'Quarter12inch' };
const normalizeSize = s => SIZE_ALIAS[s] || s;

// ── Create a lunch / event order (public) or a parent order (parent session) ──
// Parent orders arrive via requireParent (req.parent set); their type and
// discount come from the parent session, never from the request body.
async function create(req, res) {
  const {
    eventId,
    payerPhone,
    whatsappOptIn = false,
    items = [],
    allergyFlag = false,
    allergyNotes,
    paymentMethod,
    notes,
    submissionId,
    termsAcceptedAt,
  } = req.body;

  const isParent     = Boolean(req.parent);
  const orderType    = isParent ? 'parent' : (req.body.orderType ?? 'lunch');
  const discountCode = isParent ? req.parent.discountCode : req.body.discountCode;

  const payerName  = req.body.payerName  || req.body.customerName;
  const payerEmail = req.body.payerEmail || req.body.email;

  if (!isParent && !['lunch','event'].includes(orderType)) throw new HttpError(400, 'Invalid order type.');
  if (!payerName)   throw new HttpError(400, 'Name required.');
  if (!payerEmail)  throw new HttpError(400, 'Email required.');
  if (!items.length) throw new HttpError(400, 'At least one pizza item required.');
  if (paymentMethod && !['bank_transfer','paypal','cash'].includes(paymentMethod)) {
    throw new HttpError(400, 'Invalid paymentMethod.');
  }

  for (const item of items) {
    if (!PRICE_PENCE[normalizeSize(item.size)]) throw new HttpError(400, `Invalid pizza size: ${item.size}`);
  }

  // Idempotency: a repeated submissionId (double-click, retry after a timeout)
  // returns the original order instead of creating a second one.
  const findDuplicate = async () => submissionId && (await sql`
    SELECT id, order_ref, total_pence, access_token FROM orders WHERE submission_id = ${submissionId}
  `)[0];
  const sendDuplicate = dupe => res.json({
    success: true, duplicate: true, id: dupe.id, orderRef: dupe.order_ref,
    orderId: orderNumbers.displayRef(dupe.order_ref), total: dupe.total_pence / 100, token: dupe.access_token,
  });
  const earlier = await findDuplicate();
  if (earlier) return sendDuplicate(earlier);

  const subtotal = items.reduce((s, i) => s + PRICE_PENCE[normalizeSize(i.size)], 0);
  const discount = discountCode
    ? await applyDiscount(discountCode, subtotal, { scope: isParent ? 'parent_gate' : 'public' })
    : { discountPence: 0, finalPence: subtotal };
  const total    = discount.finalPence;

  // Capacity check + order insert in one transaction.
  const result = await sql.begin(async sql => {
    // 1. Find the current session. Lunch AND parent orders belong to it and use
    //    its capacity (v1's getStatus counts both); event orders don't.
    let sessionId = null;
    if (orderType === 'parent') {
      // v1 never refuses a parent order for capacity or deadline — it just counts.
      // Lock the row anyway so lunch capacity checks see this order consistently.
      const [session] = await sql`
        SELECT id FROM ordering_sessions WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE
      `;
      sessionId = session?.id ?? null;
    }
    if (orderType === 'lunch') {
      // Lock the session row first: concurrent orders queue here, so the
      // capacity sum below can't be stale. (Postgres forbids FOR UPDATE with GROUP BY.)
      const [session] = await sql`
        SELECT id, max_pizzas, ordering_open, auto_close_at
        FROM   ordering_sessions
        WHERE  archived_at IS NULL
        ORDER  BY id DESC
        LIMIT  1
        FOR UPDATE
      `;
      if (!session) throw new HttpError(503, 'No active ordering session.');
      const [{ current_pizzas }] = await sql`
        SELECT COALESCE(SUM(
                 CASE i.size
                   WHEN '12inch'        THEN 1.0
                   WHEN 'Half12inch'    THEN 0.5
                   WHEN 'Quarter12inch' THEN 0.25
                 END
               ), 0)::NUMERIC(6,2) AS current_pizzas
        FROM   orders o
        JOIN   order_items i ON i.order_id = o.id
        WHERE  o.session_id = ${session.id} AND o.order_type IN ('lunch', 'parent') AND NOT o.is_deleted
      `;
      session.current_pizzas = current_pizzas;
      if (!session.ordering_open) throw new HttpError(409, 'Ordering is currently closed.');
      if (session.auto_close_at && new Date() > new Date(session.auto_close_at)) {
        throw new HttpError(409, 'Ordering deadline has passed.');
      }

      const incomingCapacity = items.reduce((s, i) => s + CAPACITY[normalizeSize(i.size)], 0);
      const remaining = session.max_pizzas - parseFloat(session.current_pizzas);
      if (incomingCapacity > remaining) {
        throw new HttpError(409, `Only ${remaining} pizza units remaining — cannot place this order.`);
      }
      sessionId = session.id;
    }

    // 2. Upsert customer.
    const [customer] = await sql`
      INSERT INTO customers (name, email, phone_e164, whatsapp_opt_in)
      VALUES (${payerName}, ${payerEmail.toLowerCase()}, ${payerPhone ?? null}, ${!!whatsappOptIn})
      ON CONFLICT (lower(email)) DO UPDATE
        SET name            = EXCLUDED.name,
            phone_e164      = COALESCE(EXCLUDED.phone_e164, customers.phone_e164),
            whatsapp_opt_in = customers.whatsapp_opt_in OR EXCLUDED.whatsapp_opt_in,
            updated_at      = now()
      RETURNING id
    `;

    // 3. Allocate the v1-style number (lunch: under the session row lock above).
    const { orderNumber, orderRef } = await orderNumbers.allocate(sql, orderType, sessionId);

    // 4. Insert order.
    const [order] = await sql`
      INSERT INTO orders (
        order_number, order_ref, order_type, session_id, event_id, customer_id,
        subtotal_pence, discount_code, discount_pence, total_pence,
        payment_method, allergy_flag, allergy_notes, notes, terms_accepted_at, submission_id
      ) VALUES (
        ${orderNumber}, ${orderRef}, ${orderType}, ${sessionId}, ${eventId ?? null}, ${customer.id},
        ${subtotal}, ${discount.code ?? null}, ${discount.discountPence}, ${total},
        ${paymentMethod ?? null}, ${!!allergyFlag}, ${allergyNotes ?? null},
        ${notes || null}, ${termsAcceptedAt}, ${submissionId || null}
      )
      RETURNING *
    `;

    // 5. Insert order items.
    for (const item of items) {
      const sz = normalizeSize(item.size);
      await sql`
        INSERT INTO order_items (order_id, child_name, child_class, size, topping, unit_price_pence)
        VALUES (${order.id}, ${item.childName ?? null}, ${item.childClass ?? null},
                ${sz}, ${item.topping ?? null}, ${PRICE_PENCE[sz]})
      `;
    }

    return { order, customerId: customer.id };
  }).catch(async err => {
    // Two identical submissions raced past the check above: the unique
    // constraint picked a winner (this transaction rolled back, so no capacity
    // or number was used). Return the winner.
    if (err.code === '23505' && err.constraint_name === 'orders_submission_id_key') {
      return { duplicate: await findDuplicate() };
    }
    throw err;
  });
  if (result.duplicate) return sendDuplicate(result.duplicate);

  // Notify asynchronously (don't block the response on email/WhatsApp delivery).
  notifyOrder('order_confirmation', result.order.id).catch(console.error);

  // Broadcast to connected kitchen / admin boards.
  const io = req.app.get('io');
  if (io) {
    io.broadcastOrderUpdate('order:new', {
      id:        result.order.id,
      orderRef:  result.order.order_ref,
      orderType: result.order.order_type,
      sessionId: result.order.session_id,
    });
  }

  res.status(201).json({
    success:    true,
    id:         result.order.id,
    orderRef:   result.order.order_ref,
    orderId:    orderNumbers.displayRef(result.order.order_ref),   // '#12' / 'E101'
    total:      total / 100,
    token:      result.order.access_token,
  });
}

// ── Parent session: create an internal parent order ───────────────────────────
// requireParent (router) verifies the parent session and sets req.parent; create()
// then forces order_type='parent' and the session's linked discount (e.g. MUTTI).
async function createParent(req, res) {
  if (!req.parent) throw new HttpError(401, 'Access denied.');
  return create(req, res);
}

// ── Public: order lookup ──────────────────────────────────────────────────────
async function lookup(req, res) {
  const { q, token } = req.query;
  if (!q) throw new HttpError(400, 'q required.');

  let order;

  // Token match (from confirmation email link) — most secure, try first.
  if (isUuid(token)) {   // malformed tokens are ignored, not a query error
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      WHERE  o.access_token = ${token}
        AND  NOT o.is_deleted
    `;
  }

  // Order number: '12' / '#12' searches the CURRENT session only (as v1 did — its
  // weekly reset deleted old rows); 'E101' is unique forever. Otherwise: email.
  const ref = orderNumbers.parseRef(q);
  if (!order && ref?.kind === 'lunch') {
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      JOIN   ordering_sessions s ON s.id = o.session_id AND s.archived_at IS NULL
      WHERE  o.order_type = 'lunch' AND o.order_ref = ${ref.ref} AND NOT o.is_deleted
    `;
  } else if (!order && ref?.kind === 'e') {
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      WHERE  o.order_type IN ('event', 'parent') AND o.order_ref = ${ref.ref} AND NOT o.is_deleted
    `;
  } else if (!order) {
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      WHERE  lower(c.email) = ${q.trim().toLowerCase()} AND NOT o.is_deleted
      ORDER BY o.created_at DESC
      LIMIT 1
    `;
  }

  if (!order) throw new HttpError(404, 'Order not found. Check your email address or order number.');

  const items = await sql`
    SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id
  `;

  const paid = await sql`
    SELECT COALESCE(SUM(amount_pence), 0) AS total FROM payments WHERE order_id = ${order.id}
  `;

  res.json({
    success: true,
    order: {
      id:              order.id,
      orderRef:        order.order_ref,
      orderId:         orderNumbers.displayRef(order.order_ref),
      orderType:       order.order_type,
      customerName:    order.customer_name,
      customerEmail:   order.customer_email,
      items:           items.map(i => ({
        childName:  i.child_name,
        childClass: i.child_class,
        size:       i.size,
        topping:    i.topping,
        pricePence: i.unit_price_pence,
      })),
      subtotalPence:   order.subtotal_pence,
      discountCode:    order.discount_code,
      discountPence:   order.discount_pence,
      totalPence:      order.total_pence,
      amountPaidPence: parseInt(paid[0].total, 10),
      paymentMethod:   order.payment_method,
      paymentStatus:   order.payment_status,
      allergyFlag:     order.allergy_flag,
      notes:           order.notes,
    },
  });
}

// ── Admin: list all orders ────────────────────────────────────────────────────
// Bug 7: payments and items used to be LEFT JOINed together and then summed, so
// amount paid was multiplied by the item count. Each is now pre-aggregated per order.
// Bug 8: the event filter (?eventId=, or /admin/orders/event/:id) was ignored.
async function adminList(req, res) {
  const { type, sessionId, eventId, search, limit = 100, offset = 0 } = req.query;
  const like = '%' + (search || '').toLowerCase() + '%';

  const rows = await sql`
    SELECT
      o.id, o.order_number, o.order_ref, o.order_type, o.session_id, o.event_id,
      o.subtotal_pence, o.discount_code, o.discount_pence, o.total_pence,
      o.payment_method, o.payment_status, o.allergy_flag, o.is_deleted,
      o.created_at, o.updated_at,
      c.name  AS customer_name,
      c.email AS customer_email,
      c.phone_e164,
      COALESCE(p.paid, 0)::INTEGER  AS amount_paid_pence,
      COALESCE(i.count, 0)::INTEGER AS item_count
    FROM   orders     o
    JOIN   customers  c ON c.id = o.customer_id
    LEFT JOIN LATERAL (SELECT SUM(amount_pence) AS paid FROM payments    WHERE order_id = o.id) p ON TRUE
    LEFT JOIN LATERAL (SELECT COUNT(*)          AS count FROM order_items WHERE order_id = o.id) i ON TRUE
    WHERE  NOT o.is_deleted
      AND  (${type ?? null}::text IS NULL OR o.order_type = ${type ?? ''})
      AND  (${sessionId ? parseInt(sessionId, 10) : null}::int IS NULL OR o.session_id = ${parseInt(sessionId || '0', 10)})
      AND  (${eventId ? parseInt(eventId, 10) : null}::int IS NULL OR o.event_id = ${parseInt(eventId || '0', 10)})
      AND  (${search ?? null}::text IS NULL OR (
             lower(c.name)  LIKE ${like}
          OR lower(c.email) LIKE ${like}
          OR lower(o.order_ref) LIKE ${like}
      ))
    ORDER BY o.created_at DESC
    LIMIT  ${parseInt(String(limit), 10)}
    OFFSET ${parseInt(String(offset), 10)}
  `;

  res.json({ success: true, orders: rows });
}

async function adminUpdate(req, res) {
  const { id } = req.params;
  const allowed = ['payment_method','allergy_flag','allergy_notes','notes'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) throw new HttpError(400, 'Nothing to update.');
  updates.updated_at = new Date();

  const [order] = await sql`
    UPDATE orders SET ${sql(updates)} WHERE id = ${id} RETURNING id
  `;
  if (!order) throw new HttpError(404, 'Order not found.');

  await logAudit({ adminUserId: req.admin.id, action: 'update_order',
                   targetTable: 'orders', targetId: String(id), details: updates });

  res.json({ success: true });
}

async function adminDelete(req, res) {
  const { id } = req.params;
  const [order] = await sql`
    UPDATE orders SET is_deleted = TRUE, updated_at = now()
    WHERE id = ${id} AND NOT is_deleted
    RETURNING id
  `;
  if (!order) throw new HttpError(404, 'Order not found.');

  await logAudit({ adminUserId: req.admin.id, action: 'delete_order',
                   targetTable: 'orders', targetId: String(id) });

  res.json({ success: true });
}

async function adminResend(req, res) {
  const { id } = req.params;
  await notifyOrder('order_confirmation', parseInt(id, 10));
  res.json({ success: true });
}

async function adminByEvent(req, res) {
  req.query.type    = 'event';
  req.query.eventId = req.params.id;
  return adminList(req, res);
}

module.exports = { create, createParent, lookup, adminList, adminUpdate, adminDelete, adminResend, adminByEvent };
