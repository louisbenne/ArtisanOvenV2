'use strict';

const crypto = require('crypto');
const https  = require('https');
const sql    = require('../db');

// ── PayPal signature verification ────────────────────────────────────────────

function paypalApiRequest(path, method, body, headers) {
  const host = process.env.PAYPAL_MODE === 'sandbox'
    ? 'api-m.sandbox.paypal.com'
    : 'api-m.paypal.com';
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, path, method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`PayPal ${path} ${res.statusCode}: ${raw}`));
        else resolve(JSON.parse(raw));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');
  const data = await paypalApiRequest(
    '/v1/oauth2/token', 'POST',
    'grant_type=client_credentials',
    { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  return data.access_token;
}

async function verifyPayPalSignature(req) {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return true;
  const token = await getPayPalAccessToken();
  const result = await paypalApiRequest(
    '/v1/notifications/verify-webhook-signature', 'POST',
    JSON.stringify({
      auth_algo:         req.headers['paypal-auth-algo'],
      cert_url:          req.headers['paypal-cert-url'],
      transmission_id:   req.headers['paypal-transmission-id'],
      transmission_sig:  req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
      webhook_event:     req.body,
    }),
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  );
  return result.verification_status === 'SUCCESS';
}

// ── PayPal webhook ─────────────────────────────────────────────────────────────
// PayPal sends a PAYMENT.CAPTURE.COMPLETED event with custom_id set to the
// order's access_token (unique; lunch numbers repeat weekly) when the buyer
// completes payment via the PayPal button. Disabled for launch (plan D5).
async function paypal(req, res) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return res.status(200).json({ received: true });
  }

  try {
    const valid = await verifyPayPalSignature(req);
    if (!valid) return res.status(403).json({ error: 'Invalid PayPal signature' });
  } catch (err) {
    console.error('[paypal-webhook] signature verification failed:', err.message);
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
    SELECT id, total_pence FROM orders WHERE access_token::text = ${String(orderCode)}
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
