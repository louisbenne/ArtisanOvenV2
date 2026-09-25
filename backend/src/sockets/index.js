'use strict';

const sql = require('../db');

function initSockets(io) {
  // Admin namespace — authenticated admins see live order/payment events.
  const admin   = io.of('/admin');
  // Kitchen namespace — kitchen board, live item ticks.
  const kitchen = io.of('/kitchen');

  // Shared token auth for both namespaces.
  async function authenticateSocket(socket, next) {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('No token.'));

    const [session] = await sql`
      SELECT u.role FROM admin_sessions s
      JOIN   admin_users u ON u.id = s.admin_user_id
      WHERE  s.token = ${token} AND s.expires_at > now() AND u.active
    `;
    if (!session) return next(new Error('Invalid token.'));

    socket.data.role = session.role;
    next();
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
