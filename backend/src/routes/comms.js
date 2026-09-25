'use strict';

const sql = require('../db');
const { HttpError }    = require('../middleware/errorHandler');
const { notifyOrder }  = require('../services/notificationService');

async function log(req, res) {
  const { orderId, limit = 50, offset = 0 } = req.query;

  const rows = await sql`
    SELECT m.*, o.public_order_code
    FROM   message_log m
    LEFT JOIN orders   o ON o.id = m.order_id
    WHERE  (${orderId ?? null} IS NULL OR m.order_id = ${parseInt(orderId || '0', 10)})
    ORDER  BY m.sent_at DESC
    LIMIT  ${parseInt(String(limit), 10)}
    OFFSET ${parseInt(String(offset), 10)}
  `;
  res.json({ success: true, log: rows });
}

async function send(req, res) {
  const { orderId, template, channel } = req.body;
  if (!orderId || !template) throw new HttpError(400, 'orderId and template required.');

  await notifyOrder(template, parseInt(orderId, 10));
  res.json({ success: true });
}

module.exports = { log, send };
