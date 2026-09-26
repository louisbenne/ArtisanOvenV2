'use strict';

const bcrypt = require('bcrypt');
const sql    = require('../db');
const { logAudit } = require('../services/auditService');
const { HttpError } = require('../middleware/errorHandler');

const SESSION_TTL_HOURS = 12;

async function adminLogin(req, res) {
  const { username, password } = req.body;
  if (!username || !password) throw new HttpError(400, 'Username and password required.');

  const [user] = await sql`
    SELECT id, username, password_hash, role, active
    FROM   admin_users
    WHERE  username = ${username.trim().toLowerCase()}
  `;

  if (!user || !user.active) throw new HttpError(401, 'Invalid credentials.');

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw new HttpError(401, 'Invalid credentials.');

  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  const [session] = await sql`
    INSERT INTO admin_sessions (admin_user_id, expires_at)
    VALUES (${user.id}, ${expiresAt})
    RETURNING token
  `;

  await logAudit({ adminUserId: user.id, action: 'admin_login' });

  res.json({ success: true, token: session.token, role: user.role, username: user.username });
}

async function adminLogout(req, res) {
  await sql`DELETE FROM admin_sessions WHERE token = ${req.headers['authorization']?.replace(/^Bearer\s+/, '')}`;
  res.json({ success: true });
}

async function parentAuth(req, res) {
  const code = req.body.code || req.body.accessCode;
  if (!code) throw new HttpError(400, 'Access code required.');

  const [row] = await sql`
    SELECT a.code, a.linked_discount_code, d.percent_off, d.flat_off_pence
    FROM   access_codes  a
    LEFT JOIN discount_codes d ON d.code = a.linked_discount_code
    WHERE  a.code = ${code.trim().toUpperCase()}
      AND  a.purpose = 'parent_gate'
      AND  a.active  = TRUE
  `;

  if (!row) throw new HttpError(401, 'Invalid access code.');

  // A PARENT session (parent_sessions), 12 hours like v1 — never an admin session.
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  const [session] = await sql`
    INSERT INTO parent_sessions (access_code, expires_at)
    VALUES (${row.code}, ${expiresAt})
    RETURNING token
  `;

  res.json({
    success:      true,
    token:        session.token,
    discountCode: row.linked_discount_code,
    discountPct:  row.percent_off,
    discountFlat: row.flat_off_pence,
  });
}

async function listUsers(req, res) {
  const users = await sql`
    SELECT id, username, role, active, created_at FROM admin_users ORDER BY id
  `;
  res.json({ success: true, users });
}

async function createUser(req, res) {
  const { username, password, role } = req.body;
  if (!username || !password || !role) throw new HttpError(400, 'username, password, role required.');

  const hash = await bcrypt.hash(password, 12);
  const [user] = await sql`
    INSERT INTO admin_users (username, password_hash, role)
    VALUES (${username.trim().toLowerCase()}, ${hash}, ${role})
    RETURNING id, username, role
  `;

  await logAudit({ adminUserId: req.admin.id, action: 'create_admin_user',
                   targetTable: 'admin_users', targetId: String(user.id) });

  res.status(201).json({ success: true, user });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const { role, active, password } = req.body;
  const updates = {};

  if (role   !== undefined) updates.role   = role;
  if (active !== undefined) updates.active = active;
  if (password)             updates.password_hash = await bcrypt.hash(password, 12);

  if (!Object.keys(updates).length) throw new HttpError(400, 'Nothing to update.');

  const [user] = await sql`
    UPDATE admin_users SET ${sql(updates)} WHERE id = ${id} RETURNING id, username, role, active
  `;
  if (!user) throw new HttpError(404, 'User not found.');

  await logAudit({ adminUserId: req.admin.id, action: 'update_admin_user',
                   targetTable: 'admin_users', targetId: id });

  res.json({ success: true, user });
}

async function auditLog(req, res) {
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  const rows = await sql`
    SELECT a.id, u.username, a.action, a.target_table, a.target_id, a.details, a.created_at
    FROM   audit_log  a
    LEFT JOIN admin_users u ON u.id = a.admin_user_id
    ORDER BY a.created_at DESC
    LIMIT  ${limit}
    OFFSET ${offset}
  `;
  res.json({ success: true, log: rows });
}

module.exports = { adminLogin, adminLogout, parentAuth, listUsers, createUser, updateUser, auditLog };
