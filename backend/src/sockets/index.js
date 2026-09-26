'use strict';

const sql = require('../db');
const { isUuid } = require('../util/tokens');

function initSockets(io) {
  // Admin namespace — authenticated admins see live order/payment events.
  const admin   = io.of('/admin');
  // Kitchen namespace — kitchen board, live item ticks.
  const kitchen = io.of('/kitchen');

  // Shared token auth for both namespaces. Token from the handshake `auth`
  // payload only (never the URL query — bug 13). Must never throw: this runs
  // outside Express, so an unhandled error here used to kill the process (bug 16).
  async function authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth?.token;
      if (!isUuid(token)) return next(new Error('Invalid token.'));

      const [session] = await sql`
        SELECT u.role FROM admin_sessions s
        JOIN   admin_users u ON u.id = s.admin_user_id
        WHERE  s.token = ${token} AND s.expires_at > now() AND u.active
      `;
      if (!session) return next(new Error('Invalid token.'));

      socket.data.role = session.role;
      next();
    } catch (err) {
      console.error('[socket] auth failed:', err.message);
      next(new Error('Authentication unavailable.'));
    }
  }

  admin.use(authenticateSocket);
  kitchen.use(authenticateSocket);

  admin.on('connection', socket => {
    socket.join('admin');
    socket.on('disconnect', () => {});
  });

  kitchen.on('connection', socket => {
    socket.join('kitchen');
    socket.on('disconnect', () => {});
  });

  // Expose a helper so route handlers can broadcast to both rooms.
  io.broadcastOrderUpdate = (event, data) => {
    admin.to('admin').emit(event, data);
    kitchen.to('kitchen').emit(event, data);
  };
}

module.exports = { initSockets };
