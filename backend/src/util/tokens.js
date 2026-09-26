'use strict';

// Session tokens and order tokens are UUIDs. Anything else is rejected BEFORE it
// reaches Postgres — a malformed value in a uuid comparison is a query error, and
// on the socket path that error used to crash the whole server (bug 16).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = value => typeof value === 'string' && UUID.test(value);

// Bearer token from the Authorization header only — never the query string
// (URLs end up in logs and browser history; bug 13).
function bearerToken(req) {
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '').trim();
  return isUuid(token) ? token : null;
}

module.exports = { isUuid, bearerToken };
