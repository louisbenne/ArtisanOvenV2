'use strict';

const statusService = require('../services/statusService');

// GET /api/status — v1 getStatus shape (+ soldOut, ordersTeamEmail). Public.
async function get(_req, res) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(await statusService.get());
}

module.exports = { get };
