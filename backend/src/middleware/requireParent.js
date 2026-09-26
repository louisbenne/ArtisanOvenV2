'use strict';

// Parent-order session check. Parent tokens live in parent_sessions — they are
// never admin sessions, so they can't reach any /api/admin route (bug 3).
// Sets req.parent = { accessCode, discountCode }.

const sql = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireParent() {
  return async (req, res, next) => {
    const token = req.headers['authorization']?.replace(/^Bearer\s+/, '');
    if (!token || !UUID.test(token)) {
      return res.status(401).json({ success: false, message: 'Access denied.' });
    }

    const [session] = await sql`
      SELECT a.code, a.linked_discount_code
      FROM   parent_sessions s
      JOIN   access_codes    a ON a.code = s.access_code
      WHERE  s.token = ${token} AND s.expires_at > now() AND a.active
    `;
    if (!session) return res.status(401).json({ success: false, message: 'Access denied.' });

    req.parent = { accessCode: session.code, discountCode: session.linked_discount_code };
    next();
  };
}

module.exports = { requireParent };
