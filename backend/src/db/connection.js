const { Pool } = require('pg');
const dbConfig = require('../../config/db.config');

const pool = new Pool({
  user: dbConfig.user,
  host: dbConfig.host,
  database: dbConfig.database,
  password: dbConfig.password,
  port: dbConfig.port,
});

async function connect() {
  try {
    await pool.connect();
    console.log('Connected to PostgreSQL database!');
  } catch (err) {
    console.error('Connection error', err.stack);
    // Optionally re-throw or handle gracefully
    // process.exit(1); // Exit if DB connection is critical
  }
}

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Error in query', { text, params }, err);
    throw err;
  }
}

// Optional: Listen for pool errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = {
  query,
  connect,
  pool // Export pool if direct access is needed, e.g. for transactions
}; 