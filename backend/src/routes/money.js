'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');
const { incrementUsage } = require('../services/discountService');

// ── Record a payment or refund ────────────────────────────────────────────────
async function recordPayment(req, res) {
  // orderId = internal orders.id (admin routes never use display numbers — plan §4B)
  const { orderId: rawId, amountPence, method, reference, note } = req.body;
  if (!rawId || amountPence === undefined) throw new HttpError(400, 'orderId and amountPence required.');

  const [order] = await sql`
    SELECT id, total_pence, discount_code FROM orders
    WHERE id = ${parseInt(rawId, 10) || 0} AND NOT is_deleted
  `;
  if (!order) throw new HttpError(404, 'Order not found.');

  const orderId = order.id;

  const [payment] = await sql`
    INSERT INTO payments (order_id, amount_pence, method, reference, source, recorded_by, note)
    VALUES (${orderId}, ${amountPence}, ${method ?? null}, ${reference ?? null}, 'admin', ${req.admin.id}, ${note ?? null})
    RETURNING *
  `;

  // Recompute payment_status from ledger.
  const [totals] = await sql`
    SELECT COALESCE(SUM(amount_pence),0)::INTEGER AS paid FROM payments WHERE order_id = ${orderId}
  `;
  const paid   = parseInt(totals.paid, 10);
  const status = paid <= 0 ? 'unpaid' : paid >= order.total_pence ? 'paid' : 'partial';

  await sql`UPDATE orders SET payment_status = ${status}, updated_at = now() WHERE id = ${orderId}`;

  // Increment discount usage when first marked paid.
  if (status === 'paid' && order.discount_code) {
    await incrementUsage(order.discount_code).catch(() => {});
  }

  await logAudit({ adminUserId: req.admin.id, action: 'record_payment',
                   targetTable: 'payments', targetId: String(payment.id),
                   details: { orderId: orderCode, amountPence, method } });

  res.status(201).json({ success: true, payment, paymentStatus: status });
}

// ── Money dashboard summary ────────────────────────────────────────────────────
async function summary(req, res) {
  const { sessionId } = req.query;

  const sessionFilter = sessionId
    ? sql`AND o.session_id = ${parseInt(sessionId, 10)}`
    : sql`AND s.archived_at IS NULL`;

  const [totals] = await sql`
    SELECT
      COUNT(DISTINCT o.id)::INTEGER                          AS order_count,
      COALESCE(SUM(o.total_pence), 0)::INTEGER               AS gross_pence,
      COALESCE(SUM(o.discount_pence), 0)::INTEGER            AS discounts_pence,
      COALESCE(SUM(CASE WHEN p.amount_pence > 0 THEN p.amount_pence END), 0)::INTEGER AS collected_pence,
      COUNT(DISTINCT CASE WHEN o.payment_status = 'unpaid'  THEN o.id END)::INTEGER AS unpaid_count,
      COUNT(DISTINCT CASE WHEN o.payment_status = 'partial' THEN o.id END)::INTEGER AS partial_count,
      COUNT(DISTINCT CASE WHEN o.payment_status = 'paid'    THEN o.id END)::INTEGER AS paid_count
    FROM   orders    o
    LEFT JOIN ordering_sessions s ON s.id = o.session_id
    LEFT JOIN payments          p ON p.order_id = o.id
    WHERE  NOT o.is_deleted
      ${sessionFilter}
  `;

  const byMethod = await sql`
    SELECT
      p.method,
      COALESCE(SUM(CASE WHEN p.amount_pence > 0 THEN p.amount_pence END), 0)::INTEGER AS total_pence
    FROM payments p
    JOIN orders   o ON o.id = p.order_id
    LEFT JOIN ordering_sessions s ON s.id = o.session_id
    WHERE NOT o.is_deleted
      ${sessionFilter}
    GROUP BY p.method
  `;

  // Outstanding balance (unpaid/partial), oldest first — aging report.
  const outstanding = await sql`
    SELECT
      o.id, o.order_ref, o.order_type, o.total_pence, o.payment_status,
      COALESCE(SUM(p.amount_pence),0)::INTEGER AS paid_pence,
      c.name AS customer_name, c.email AS customer_email,
      now()::DATE - o.created_at::DATE AS days_since_order
    FROM   orders    o
    JOIN   customers c ON c.id = o.customer_id
    LEFT JOIN payments p ON p.order_id = o.id
    LEFT JOIN ordering_sessions s ON s.id = o.session_id
    WHERE  o.payment_status IN ('unpaid','partial')
      AND  NOT o.is_deleted
      ${sessionFilter}
    GROUP  BY o.id, c.id
    ORDER  BY days_since_order DESC
    LIMIT  100
  `;

  res.json({ success: true, totals, byMethod, outstanding });
}

// ── CSV export ────────────────────────────────────────────────────────────────
async function exportCsv(req, res) {
  const { sessionId } = req.query;

  const rows = await sql`
    SELECT
      o.order_ref           AS "Order",
      o.order_type          AS "Type",
      c.name                AS "Customer",
      c.email               AS "Email",
      o.total_pence / 100.0 AS "Total (£)",
      o.discount_code       AS "Discount Code",
      o.discount_pence / 100.0 AS "Discount (£)",
      o.payment_method      AS "Payment Method",
      o.payment_status      AS "Status",
      o.created_at          AS "Ordered At"
    FROM   orders    o
    JOIN   customers c ON c.id = o.customer_id
    WHERE  NOT o.is_deleted
      AND  (${sessionId ?? null} IS NULL OR o.session_id = ${parseInt(sessionId || '0', 10)})
    ORDER  BY o.created_at
  `;

  if (!rows.length) return res.status(200).send('');

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="artisan-oven-orders.csv"');
  res.send(csv);
}

module.exports = { recordPayment, summary, export: exportCsv };
