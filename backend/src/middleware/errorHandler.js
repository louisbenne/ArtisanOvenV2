'use strict';

function errorHandler(err, req, res, _next) {
  const status  = err.status || err.statusCode || 500;
  const message = err.expose ? err.message : 'Internal server error.';

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`, err);
  }

  res.status(status).json({ success: false, message });
}

// Convenience: throw these from handlers to get a clean JSON error response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

module.exports = { errorHandler, HttpError };
