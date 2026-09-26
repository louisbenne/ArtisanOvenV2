'use strict';

const sql = require('../db');
const { HttpError } = require('../middleware/errorHandler');
const { logAudit }  = require('../services/auditService');
const schedule      = require('../domain/schedule');

async function get(_req, res) {
  const [s] = await sql`SELECT * FROM site_settings WHERE id = 1`;
  res.json({ success: true, settings: s });
}

const TEXT_FIELDS = ['orders_team_email', 'orders_team_whatsapp', 'capacity_message', 'deadline_message',
                     'fully_booked_message', 'service_notice_date', 'next_opening_text'];
const WEEKDAY_FIELDS = ['close_weekday', 'reopen_weekday', 'service_weekday'];
const TIME_FIELDS    = ['close_time', 'reopen_time'];

async function update(req, res) {
  const updates = { updated_at: new Date() };
  for (const k of TEXT_FIELDS) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  for (const k of WEEKDAY_FIELDS) {
    if (req.body[k] === undefined) continue;
    if (!schedule.isValidWeekday(req.body[k])) throw new HttpError(400, `${k} must be 1 (Monday) … 7 (Sunday).`);
    updates[k] = req.body[k];
  }
  for (const k of TIME_FIELDS) {
    if (req.body[k] === undefined) continue;
    if (!schedule.isValidTime(req.body[k])) throw new HttpError(400, `${k} must be HH:MM (24-hour).`);
    updates[k] = req.body[k];
  }
  if (req.body.auto_close_enabled !== undefined) updates.auto_close_enabled = Boolean(req.body.auto_close_enabled);

  const [s] = await sql`UPDATE site_settings SET ${sql(updates)} WHERE id = 1 RETURNING *`;
  await logAudit({ adminUserId: req.admin.id, action: 'update_site_settings', details: updates });
  res.json({ success: true, settings: s });
}

async function getDiscounts(_req, res) {
  const rows = await sql`SELECT * FROM discount_codes ORDER BY code`;
  res.json({ success: true, discounts: rows });
}

async function createDiscount(req, res) {
  const { code, description, percentOff, flatOffPence, active = true, maxUses, expiresAt } = req.body;
  if (!code) throw new HttpError(400, 'code required.');

  const [row] = await sql`
    INSERT INTO discount_codes (code, description, percent_off, flat_off_pence, active, max_uses, expires_at)
    VALUES (${code.toUpperCase()}, ${description ?? null}, ${percentOff ?? null}, ${flatOffPence ?? null},
            ${!!active}, ${maxUses ?? null}, ${expiresAt ?? null})
    ON CONFLICT (code) DO NOTHING
    RETURNING *
  `;
  if (!row) throw new HttpError(409, 'Discount code already exists.');

  res.status(201).json({ success: true, discount: row });
}

async function updateDiscount(req, res) {
  const { code } = req.params;
  const allowed  = ['description','percent_off','flat_off_pence','active','max_uses','expires_at'];
  const updates  = {};
  for (const k of allowed) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[camel] !== undefined) updates[k] = req.body[camel];
    if (req.body[k]     !== undefined) updates[k] = req.body[k];
  }
  if (!Object.keys(updates).length) throw new HttpError(400, 'Nothing to update.');

  const [row] = await sql`UPDATE discount_codes SET ${sql(updates)} WHERE code = ${code} RETURNING *`;
  if (!row) throw new HttpError(404, 'Discount code not found.');

  res.json({ success: true, discount: row });
}

async function getAccessCodes(_req, res) {
  const rows = await sql`SELECT a.*, d.percent_off FROM access_codes a LEFT JOIN discount_codes d ON d.code = a.linked_discount_code ORDER BY a.code`;
  res.json({ success: true, accessCodes: rows });
}

async function createAccessCode(req, res) {
  const { code, purpose = 'parent_gate', linkedDiscountCode, active = true } = req.body;
  if (!code) throw new HttpError(400, 'code required.');

  const [row] = await sql`
    INSERT INTO access_codes (code, purpose, linked_discount_code, active)
    VALUES (${code.toUpperCase()}, ${purpose}, ${linkedDiscountCode ?? null}, ${!!active})
    ON CONFLICT (code) DO NOTHING
    RETURNING *
  `;
  if (!row) throw new HttpError(409, 'Access code already exists.');

  res.status(201).json({ success: true, accessCode: row });
}

module.exports = { get, update, getDiscounts, createDiscount, updateDiscount, getAccessCodes, createAccessCode };
