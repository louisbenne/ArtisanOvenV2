'use strict';

const postgres = require('postgres');

const sql = postgres({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'artisanoven',
  username: process.env.DB_USER     || 'artisanoven',
  password: process.env.DB_PASS,
  max:      parseInt(process.env.DB_POOL_MAX || '10', 10),
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {},  // suppress NOTICE from schema.sql IF NOT EXISTS runs
});

module.exports = sql;
