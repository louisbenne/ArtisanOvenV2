'use strict';

// Notification service — email always, WhatsApp if customer opted in.
// All sends are logged to message_log. Failures are caught and logged; they
// never bubble up to fail the order-creation request.

const https    = require('https');
const sql      = require('../db');
const { displayRef } = require('../domain/orderNumbers');

async function notifyOrder(template, orderId) {
  const [order] = await sql`
    SELECT
      o.id, o.order_ref, o.order_type, o.total_pence, o.discount_pence,
      o.discount_code, o.payment_method, o.access_token, o.allergy_notes,
      c.name  AS customer_name,
      c.email AS customer_email,
      c.phone_e164,
      c.whatsapp_opt_in
    FROM orders    o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
  `;
  if (!order) return;
  order.display_ref = displayRef(order.order_ref);   // '#12' / 'E101'

  const items = await sql`
    SELECT size, topping, child_name, child_class, unit_price_pence
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

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail({ order, items, template }) {
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
    text:    html.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim(),
  });
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
    order_confirmation:   `Your order is confirmed — ${order.display_ref} · Artisan Oven`,
    payment_reminder:     `Friendly payment reminder — ${order.display_ref} · Artisan Oven`,
    ready_for_collection: `Your pizza is ready! — ${order.display_ref} · Artisan Oven`,
  };
  return titles[template] || `Artisan Oven — ${order.display_ref}`;
}

function emailHtml(template, order, items) {
  const BASE   = process.env.FRONTEND_URL || 'https://artisanoven.shop';
  const viewLink = `${BASE}/payment.html?q=${encodeURIComponent(order.order_ref)}&token=${order.access_token}`;
  const SIZE_LABEL = { '12inch': 'Whole 12"', 'Half12inch': 'Half 12"', 'Quarter12inch': 'Quarter 12"' };

  const itemRows = items.map(i =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #e8e4de">${escHtml(i.topping || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #e8e4de">${SIZE_LABEL[i.size] || i.size}</td>
      <td style="padding:8px;border-bottom:1px solid #e8e4de">${escHtml(i.child_name || '—')}</td>
      <td style="padding:8px;border-bottom:1px solid #e8e4de;text-align:right">£${(i.unit_price_pence/100).toFixed(2)}</td>
    </tr>`
  ).join('');

  const discountRow = order.discount_pence
    ? `<tr><td colspan="3" style="padding:8px;color:#888">Discount (${escHtml(order.discount_code || '')})</td><td style="padding:8px;text-align:right;color:#888">−£${(order.discount_pence/100).toFixed(2)}</td></tr>`
    : '';

  const bodyMap = {
    order_confirmation:
      `<p>Hi ${escHtml(order.customer_name)},</p>
       <p>Your Artisan Oven order is confirmed — no need to do anything else until collection.</p>`,
    payment_reminder:
      `<p>Hi ${escHtml(order.customer_name)},</p>
       <p>Just a friendly reminder that payment for your Artisan Oven order is still outstanding.</p>
       <p>You can pay cash at collection, or ask a member of staff about bank transfer.</p>`,
    ready_for_collection:
      `<p>Hi ${escHtml(order.customer_name)},</p>
       <p>Good news — your pizza is freshly baked and ready to collect! 🍕</p>
       <p>Head to the Artisan Oven counter and quote your order code.</p>`,
  };

  const body = bodyMap[template] || `<p>Hi ${escHtml(order.customer_name)},</p><p>Update on your order:</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Artisan Oven</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF8F5;margin:0;padding:0">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.07)">
    <div style="background:#1F3A2E;padding:24px 32px">
      <h1 style="color:#FAF8F5;margin:0;font-size:1.4em;letter-spacing:.1em;font-weight:700">ARTISAN OVEN</h1>
    </div>
    <div style="padding:32px">
      ${body}
      <p><strong>Order ${escHtml(order.display_ref)}</strong></p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:.9em">
        <thead>
          <tr style="background:#f5f2ee">
            <th align="left" style="padding:8px;font-weight:600">Topping</th>
            <th align="left" style="padding:8px;font-weight:600">Size</th>
            <th align="left" style="padding:8px;font-weight:600">Child</th>
            <th align="right" style="padding:8px;font-weight:600">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          ${discountRow}
          <tr style="font-weight:700">
            <td colspan="3" style="padding:10px 8px;border-top:2px solid #ccc">Total</td>
            <td style="padding:10px 8px;border-top:2px solid #ccc;text-align:right">£${(order.total_pence/100).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        <a href="${viewLink}" style="display:inline-block;background:#C65D3B;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">View order &amp; payment options →</a>
      </p>
      <hr style="border:none;border-top:1px solid #e0ddd8;margin:24px 0">
      <p style="color:#888;font-size:.85em;margin:0">Artisan Oven · artisanoven.shop</p>
    </div>
  </div>
</body>
</html>`;
}

// ── WhatsApp Cloud API ────────────────────────────────────────────────────────

async function sendWhatsApp({ order, items, template }) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.log(`[whatsapp-stub] Would send "${template}" to ${order.phone_e164}`);
    return;
  }

  const text = whatsappText(template, order, items);

  const body = JSON.stringify({
    messaging_product: 'whatsapp',
    to:               order.phone_e164,
    type:             'text',
    text:             { body: text, preview_url: false },
  });

  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path:     `/v19.0/${phoneId}/messages`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`WhatsApp API ${res.statusCode}: ${raw}`));
        else resolve(JSON.parse(raw));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function whatsappText(template, order, items) {
  const BASE = process.env.FRONTEND_URL || 'https://artisanoven.shop';
  const link = `${BASE}/payment.html?q=${encodeURIComponent(order.order_ref)}`;
  const SIZE_SHORT = { '12inch': 'Whole', 'Half12inch': 'Half', 'Quarter12inch': 'Quarter' };

  const itemLines = items.map(i =>
    `• ${i.topping || '?'} (${SIZE_SHORT[i.size] || i.size})${i.child_name ? ` — ${i.child_name}` : ''}`
  ).join('\n');

  const msgs = {
    order_confirmation:
      `Hi ${order.customer_name}! 👋\n\nYour Artisan Oven order *${order.display_ref}* is confirmed:\n\n${itemLines}\n\nTotal: £${(order.total_pence/100).toFixed(2)}\n\nView & pay: ${link}`,
    payment_reminder:
      `Hi ${order.customer_name} — friendly reminder that your Artisan Oven order *${order.display_ref}* (£${(order.total_pence/100).toFixed(2)}) still has an outstanding balance.\n\nPay cash at collection or visit: ${link}`,
    ready_for_collection:
      `Hi ${order.customer_name}! 🍕 Your pizza from Artisan Oven is ready to collect. Quote *${order.display_ref}* at the counter.`,
  };

  return msgs[template] || `Artisan Oven — update on your order ${order.display_ref}: ${link}`;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

async function logMessage({ orderId, channel, template, status, error }) {
  await sql`
    INSERT INTO message_log (order_id, channel, template, status, error)
    VALUES (${orderId}, ${channel}, ${template}, ${status}, ${error ?? null})
  `.catch(() => {});
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { notifyOrder };
