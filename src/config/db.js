const { Pool } = require('pg');

// Railway (and most hosted Postgres providers) supply a DATABASE_URL.
// Fall back to individual vars for local development.
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err.message);
  process.exit(1);
});

module.exports = pool;
