'use strict';

// Notification service — email always, WhatsApp if customer opted in.
// All sends are logged to message_log. Failures are caught and logged; they
// never bubble up to fail the order-creation request.

const sql = require('../db');

async function notifyOrder(template, orderId) {
  const [order] = await sql`
    SELECT
      o.id, o.public_order_code, o.order_type, o.total_pence,
      o.payment_method, o.access_token, o.discount_pence, o.allergy_notes,
      c.name  AS customer_name,
      c.email AS customer_email,
      c.phone_e164,
      c.whatsapp_opt_in
    FROM orders    o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
  `;
  if (!order) return;

  const items = await sql`
    SELECT size, child_name, child_class, unit_price_pence
    FROM   order_items
    WHERE  order_id = ${orderId}
    ORDER  BY id
  `;

  const channels = ['email'];
  if (order.whatsapp_opt_in && order.phone_e164) channels.push('whatsapp');

  for (const channel of channels) {
    try {
      if (channel === 'email') {
        await sendEmail({ order, items, template });
      } else {
        await sendWhatsApp({ order, items, template });
      }
      await logMessage({ orderId, channel, template, status: 'sent' });
    } catch (err) {
      console.error(`[notify] ${channel} ${template} for order ${orderId}:`, err.message);
      await logMessage({ orderId, channel, template, status: 'failed', error: err.message });
    }
  }
}

async function sendEmail({ order, items, template }) {
  // Nodemailer / SMTP — wired up in Phase 4. Stub logs intent for now.
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email-stub] Would send "${template}" to ${order.customer_email}`);
    return;
  }

  const subject = emailSubject(template, order);
  const html    = emailHtml(template, order, items);
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM || 'noreply@artisanoven.shop',
    to:      order.customer_email,
    subject,
    html,
    text:    html.replace(/<[^>]+>/g, ''),
  });
}

async function sendWhatsApp({ order, template }) {
  // Meta WhatsApp Cloud API — wired up in Phase 4.
  if (!process.env.WHATSAPP_TOKEN) {
    console.log(`[whatsapp-stub] Would send "${template}" to ${order.phone_e164}`);
    return;
  }
  // TODO: Phase 4 — call Meta Graph API with approved template.
}

async function logMessage({ orderId, channel, template, status, error }) {
  await sql`
    INSERT INTO message_log (order_id, channel, template, status, error)
    VALUES (${orderId}, ${channel}, ${template}, ${status}, ${error ?? null})
  `.catch(() => {});  // never throw from logging
}

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function emailSubject(template, order) {
  const titles = {
    order_confirmation: `Your Artisan Oven Order Confirmation (${order.public_order_code})`,
    payment_reminder:   `Artisan Oven — Payment Reminder (${order.public_order_code})`,
    ready_for_collection: `Your Artisan Oven Pizza is Ready! (${order.public_order_code})`,
  };
  return titles[template] || `Artisan Oven — ${order.public_order_code}`;
}

function emailHtml(template, order, items) {
  const PAYMENT_DOMAIN = process.env.FRONTEND_URL || 'https://artisanoven.shop';
  const viewLink = `${PAYMENT_DOMAIN}/payment.html?order=${order.public_order_code}&token=${order.access_token}`;

  const itemRows = items.map(i => {
    const label = { '12inch': 'Whole 12"', 'Half12inch': 'Half 12"', 'Quarter12inch': 'Quarter 12"' }[i.size];
    return `<tr>
      <td>${i.child_name || '—'}</td>
      <td>${i.child_class || '—'}</td>
      <td>${label}</td>
      <td>£${(i.unit_price_pence / 100).toFixed(2)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Artisan Oven</title></head>
<body style="font-family:-apple-system,sans-serif;background:#FAF8F5;margin:0;padding:0">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#1F3A2E;padding:24px 32px">
      <h1 style="color:#FAF8F5;margin:0;font-size:1.4em;letter-spacing:.08em">ARTISAN OVEN</h1>
    </div>
    <div style="padding:32px">
      <p>Hi ${order.customer_name},</p>
      <p>Thanks for your order! Here's your summary:</p>
      <p><strong>Order: ${order.public_order_code}</strong></p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#f0ede8">
            <th align="left" style="padding:8px">Child</th>
            <th align="left" style="padding:8px">Class</th>
            <th align="left" style="padding:8px">Size</th>
            <th align="left" style="padding:8px">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        ${order.discount_pence ? `<tr><td colspan="3" style="padding:8px">Discount (${order.discount_code})</td><td style="padding:8px">−£${(order.discount_pence/100).toFixed(2)}</td></tr>` : ''}
        <tr style="font-weight:600">
          <td colspan="3" style="padding:8px;border-top:2px solid #ccc">Total</td>
          <td style="padding:8px;border-top:2px solid #ccc">£${(order.total_pence/100).toFixed(2)}</td>
        </tr>
      </table>
      <p>
        <a href="${viewLink}" style="display:inline-block;background:#C65D3B;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">View Your Order &amp; Payment Options →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e0ddd8;margin:24px 0">
      <p style="color:#666;font-size:.9em">Marlow, Louis, and Quinton — Artisan Oven</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { notifyOrder };
