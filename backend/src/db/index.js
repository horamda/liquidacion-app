const { Pool } = require('pg');
const { parsePositiveInteger, requireEnv, shouldUseSsl } = require('../config/env');

const connectionString = requireEnv('DATABASE_URL');

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  max: parsePositiveInteger(process.env.PG_POOL_MAX, 10),
  connectionTimeoutMillis: parsePositiveInteger(process.env.PG_CONNECTION_TIMEOUT_MS, 10000),
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  ping: () => pool.query('SELECT 1'),
  close: () => pool.end(),
  pool,
};
