'use strict';

const crypto = require('crypto');
const sql    = require('../db');

// ── PayPal webhook ─────────────────────────────────────────────────────────────
// PayPal sends a PAYMENT.CAPTURE.COMPLETED event with custom_id set to the
// public_order_code when the buyer completes payment via the PayPal button.
async function paypal(req, res) {
  // Verify PayPal signature (headers: PAYPAL-TRANSMISSION-SIG etc.)
  // TODO: Phase 4 — implement full PayPal webhook signature verification.
  // For now, accept the body but require the PAYPAL_WEBHOOK_ID env var to be set.
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return res.status(200).json({ received: true });
  }

  const event = req.body;
  if (event?.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
    return res.status(200).json({ received: true });
  }

  const orderCode = event?.resource?.custom_id;
  const amount    = event?.resource?.amount?.value;
  if (!orderCode || !amount) return res.status(200).json({ received: true });

  const [order] = await sql`
    SELECT id, total_pence FROM orders WHERE upper(public_order_code) = ${orderCode.toUpperCase()}
  `;
  if (!order) return res.status(200).json({ received: true });

  const amountPence = Math.round(parseFloat(amount) * 100);
  await sql`
    INSERT INTO payments (order_id, amount_pence, method, reference, source)
    VALUES (${order.id}, ${amountPence}, 'paypal', ${event.id}, 'paypal_webhook')
    ON CONFLICT DO NOTHING
  `;

  const [totals] = await sql`
    SELECT COALESCE(SUM(amount_pence),0)::INTEGER AS paid FROM payments WHERE order_id = ${order.id}
  `;
  const paid   = parseInt(totals.paid, 10);
  const status = paid <= 0 ? 'unpaid' : paid >= order.total_pence ? 'paid' : 'partial';
  await sql`UPDATE orders SET payment_status = ${status}, updated_at = now() WHERE id = ${order.id}`;

  res.status(200).json({ received: true });
}

// ── WhatsApp webhook — GET (Meta verification challenge) ─────────────────────
function whatsappVerify(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
}

// ── WhatsApp webhook — POST (delivery status + inbound messages) ──────────────
async function whatsappEvent(req, res) {
  // Verify Meta signature.
  const sig  = req.headers['x-hub-signature-256'] || '';
  const body = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET || '')
    .update(body).digest('hex');

  if (process.env.WHATSAPP_APP_SECRET && !crypto.timingSafeEqual(
    Buffer.from(sig), Buffer.from(expected)
  )) {
    return res.status(403).send('Forbidden');
  }

  // Process status updates — update message_log rows.
  const statuses = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses || [];
  for (const s of statuses) {
    await sql`
      UPDATE message_log SET status = ${s.status}, updated_at = now()
      WHERE id = (
        SELECT id FROM message_log
        WHERE channel = 'whatsapp' AND status != 'failed'
        ORDER BY sent_at DESC LIMIT 1
      )
    `.catch(() => {});
  }

  res.status(200).json({ received: true });
}

module.exports = { paypal, whatsappVerify, whatsappEvent };
