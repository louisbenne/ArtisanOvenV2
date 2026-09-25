'use strict';

const sql = require('../db');

// Role hierarchy — each role implicitly includes everything below it.
const ROLE_RANK = { owner: 4, treasurer: 3, kitchen: 2, volunteer: 1 };

function requireAuth(minRole = 'volunteer') {
  return async (req, res, next) => {
    const token = req.headers['authorization']?.replace(/^Bearer\s+/, '')
                  || req.query._token;

    if (!token) return res.status(401).json({ success: false, message: 'No session token.' });

    const [session] = await sql`
      SELECT s.token, s.expires_at, u.id AS user_id, u.username, u.role, u.active
      FROM   admin_sessions s
      JOIN   admin_users    u ON u.id = s.admin_user_id
      WHERE  s.token = ${token}
        AND  s.expires_at > now()
    `;

    if (!session || !session.active) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }

    const rank = ROLE_RANK[session.role] ?? 0;
    if (rank < (ROLE_RANK[minRole] ?? 0)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }

    req.admin = { id: session.user_id, username: session.username, role: session.role };
    next();
  };
}

module.exports = { requireAuth };
