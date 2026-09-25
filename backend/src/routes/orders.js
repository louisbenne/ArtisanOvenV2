'use strict';

const sql  = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');
const { applyDiscount } = require('../services/discountService');
const { notifyOrder }   = require('../services/notificationService');

const PRICE_PENCE = { '12inch': 800, 'Half12inch': 500, 'Quarter12inch': 300 };
const CAPACITY    = { '12inch': 1.0, 'Half12inch': 0.5, 'Quarter12inch': 0.25 };

// ── Public: create a lunch or event order ─────────────────────────────────────
async function create(req, res) {
  const {
    orderType = 'lunch',
    eventId,
    payerName,
    payerEmail,
    payerPhone,
    whatsappOptIn = false,
    items = [],
    allergyFlag = false,
    allergyNotes,
    discountCode,
    paymentMethod,
    notes,
    submissionId,
    termsAcceptedAt,
  } = req.body;

  if (!['lunch','event'].includes(orderType)) throw new HttpError(400, 'Invalid order type.');
  if (!payerName)   throw new HttpError(400, 'payerName required.');
  if (!payerEmail)  throw new HttpError(400, 'payerEmail required.');
  if (!items.length) throw new HttpError(400, 'At least one pizza item required.');
  if (!termsAcceptedAt) throw new HttpError(400, 'Terms must be accepted.');
  if (!['bank_transfer','paypal','cash'].includes(paymentMethod)) {
    throw new HttpError(400, 'Invalid paymentMethod.');
  }

  for (const item of items) {
    if (!PRICE_PENCE[item.size]) throw new HttpError(400, `Invalid pizza size: ${item.size}`);
  }

  // Idempotency check: reject if this submissionId was seen in the last 10 minutes.
  if (submissionId) {
    const [dupe] = await sql`
      SELECT id FROM orders
      WHERE  notes LIKE ${`%sub:${submissionId}%`}
        AND  created_at > now() - interval '10 minutes'
    `;
    if (dupe) return res.json({ success: true, duplicate: true, orderId: dupe.id });
  }

  const subtotal = items.reduce((s, i) => s + PRICE_PENCE[i.size], 0);
  const discount = discountCode ? await applyDiscount(discountCode, subtotal) : { discountPence: 0, finalPence: subtotal };
  const total    = discount.finalPence;

  // Capacity check + order insert in one transaction.
  const result = await sql.begin(async sql => {
    // 1. Find current session (lunch orders only).
    let sessionId = null;
    if (orderType === 'lunch') {
      const [session] = await sql`
        SELECT s.id, s.max_pizzas, s.ordering_open, s.auto_close_at,
               COALESCE(SUM(
                 CASE i.size
                   WHEN '12inch'       THEN 1.0
                   WHEN 'Half12inch'   THEN 0.5
                   WHEN 'Quarter12inch' THEN 0.25
                 END
               ), 0)::NUMERIC(6,2) AS current_pizzas
        FROM   ordering_sessions s
        LEFT JOIN orders     o ON o.session_id = s.id AND NOT o.is_deleted
        LEFT JOIN order_items i ON i.order_id = o.id
        WHERE  s.archived_at IS NULL
        GROUP  BY s.id
        LIMIT  1
        FOR UPDATE
      `;
      if (!session) throw new HttpError(503, 'No active ordering session.');
      if (!session.ordering_open) throw new HttpError(409, 'Ordering is currently closed.');
      if (session.auto_close_at && new Date() > new Date(session.auto_close_at)) {
        throw new HttpError(409, 'Ordering deadline has passed.');
      }

      const incomingCapacity = items.reduce((s, i) => s + CAPACITY[i.size], 0);
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

    // 3. Allocate order code atomically.
    const prefix = { lunch: 'L', event: 'E', parent: 'P' }[orderType];
    const [counter] = await sql`
      UPDATE order_code_counters
      SET    next_val = next_val + 1
      WHERE  order_type = ${orderType}
      RETURNING next_val - 1 AS val
    `;
    const publicCode = `${prefix}-${String(counter.val).padStart(4,'0')}`;

    // 4. Insert order.
    const [order] = await sql`
      INSERT INTO orders (
        public_order_code, order_type, session_id, event_id, customer_id,
        subtotal_pence, discount_code, discount_pence, total_pence,
        payment_method, allergy_flag, allergy_notes, notes, terms_accepted_at
      ) VALUES (
        ${publicCode}, ${orderType}, ${sessionId}, ${eventId ?? null}, ${customer.id},
        ${subtotal}, ${discount.code ?? null}, ${discount.discountPence}, ${total},
        ${paymentMethod}, ${!!allergyFlag}, ${allergyNotes ?? null},
        ${[notes, submissionId ? `sub:${submissionId}` : null].filter(Boolean).join(' | ') || null},
        ${termsAcceptedAt}
      )
      RETURNING *
    `;

    // 5. Insert order items.
    for (const item of items) {
      await sql`
        INSERT INTO order_items (order_id, child_name, child_class, size, unit_price_pence)
        VALUES (${order.id}, ${item.childName ?? null}, ${item.childClass ?? null},
                ${item.size}, ${PRICE_PENCE[item.size]})
      `;
    }

    return { order, customerId: customer.id };
  });

  // Notify asynchronously (don't block the response on email/WhatsApp delivery).
  notifyOrder('order_confirmation', result.order.id).catch(console.error);

  res.status(201).json({
    success:    true,
    orderId:    result.order.public_order_code,
    total:      total / 100,
    token:      result.order.access_token,
  });
}

// ── Public: create an internal parent order ───────────────────────────────────
async function createParent(req, res) {
  // Same as create() but order_type='parent' and discount is auto-applied via access code.
  // The token from /auth/parent is verified by requireAuth in the router.
  req.body.orderType = 'parent';
  return create(req, res);
}

// ── Public: order lookup ──────────────────────────────────────────────────────
async function lookup(req, res) {
  const { query, token } = req.query;
  if (!query) throw new HttpError(400, 'query required.');

  let order;

  // Token match (from confirmation email link) — most secure, try first.
  if (token) {
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      WHERE  o.access_token = ${token}
        AND  NOT o.is_deleted
    `;
  }

  // Email or order code match.
  if (!order) {
    [order] = await sql`
      SELECT o.*, c.name AS customer_name, c.email AS customer_email
      FROM   orders    o
      JOIN   customers c ON c.id = o.customer_id
      WHERE  (
        lower(c.email) = ${query.toLowerCase()}
        OR upper(o.public_order_code) = ${query.toUpperCase()}
      )
      AND NOT o.is_deleted
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
      id:            order.public_order_code,
      customerName:  order.customer_name,
      customerEmail: order.customer_email,
      items:         items.map(i => ({
        childName:  i.child_name,
        childClass: i.child_class,
        size:       i.size,
        price:      i.unit_price_pence / 100,
      })),
      subtotal:       order.subtotal_pence / 100,
      discountCode:   order.discount_code,
      discount:       order.discount_pence / 100,
      total:          order.total_pence / 100,
      amountPaid:     parseInt(paid[0].total, 10) / 100,
      paymentMethod:  order.payment_method,
      paymentStatus:  order.payment_status,
      allergyFlag:    order.allergy_flag,
      notes:          order.notes,
    },
  });
}

// ── Admin: list all orders ────────────────────────────────────────────────────
async function adminList(req, res) {
  const { type, sessionId, search, limit = 100, offset = 0 } = req.query;

  const rows = await sql`
    SELECT
      o.id, o.public_order_code, o.order_type, o.session_id, o.event_id,
      o.subtotal_pence, o.discount_code, o.discount_pence, o.total_pence,
      o.payment_method, o.payment_status, o.allergy_flag, o.is_deleted,
      o.created_at, o.updated_at,
      c.name  AS customer_name,
      c.email AS customer_email,
      c.phone_e164,
      COALESCE(SUM(p.amount_pence), 0)::INTEGER AS amount_paid_pence,
      COUNT(i.id)::INTEGER AS item_count
    FROM   orders     o
    JOIN   customers  c ON c.id = o.customer_id
    LEFT JOIN payments   p ON p.order_id  = o.id
    LEFT JOIN order_items i ON i.order_id = o.id
    WHERE  NOT o.is_deleted
      AND  (${type       ?? null} IS NULL OR o.order_type = ${type       ?? ''})
      AND  (${sessionId  ?? null} IS NULL OR o.session_id = ${parseInt(sessionId || '0', 10)})
      AND  (${search     ?? null} IS NULL OR (
             lower(c.name)  LIKE ${'%' + (search || '').toLowerCase() + '%'}
          OR lower(c.email) LIKE ${'%' + (search || '').toLowerCase() + '%'}
          OR lower(o.public_order_code) LIKE ${'%' + (search || '').toLowerCase() + '%'}
      ))
    GROUP BY o.id, c.id
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
    UPDATE orders SET ${sql(updates)} WHERE id = ${id} RETURNING public_order_code
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
    RETURNING public_order_code
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
