'use strict';

// Reusable PG pool for Netlify functions
const { Pool } = require('pg');

let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('Missing DATABASE_URL');
    pool = new Pool({
      connectionString: cs,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

module.exports = { getPool };

