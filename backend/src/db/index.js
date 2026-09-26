'use strict';

const postgres = require('postgres');

// DATABASE_URL (if set) wins over the individual DB_* vars.
// SSL is opt-in (DB_SSL=true) — the Compose stack talks to Postgres on a private network.
const common = {
  max:             parseInt(process.env.DB_POOL_MAX || '10', 10),
  idle_timeout:    30,
  connect_timeout: 10,
  ssl:             process.env.DB_SSL === 'true' ? 'require' : false,
  onnotice:        () => {},
};

const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, common)
  : postgres({
      host:     process.env.DB_HOST || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'artisanoven',
      username: process.env.DB_USER || 'artisanoven',
      password: process.env.DB_PASS,
      ...common,
    });

module.exports = sql;
