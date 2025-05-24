const { Pool } = require('pg');
const dbConfig = require('../config/db.config.js');

// Create a new pool instance
const pool = new Pool({
  user: dbConfig.USER,
  host: dbConfig.HOST,
  database: dbConfig.DB,
  password: dbConfig.PASSWORD,
  port: dbConfig.PORT,
  // Optional: configure pool size, connection timeout, etc.
  // max: 20, // max number of clients in the pool
  // idleTimeoutMillis: 30000, // how long a client is allowed to remain idle before being closed
  // connectionTimeoutMillis: 2000, // how long to wait for a connection from the pool
});

// Listener for errors on idle clients in the pool
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // process.exit(-1); // Recommended to restart the app on unavoidable errors
});

// Test the connection (optional, but good for startup diagnostics)
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client for connection test:', err.stack);
  }
  client.query('SELECT NOW()', (err, result) => {
    release(); // Release client back to the pool
    if (err) {
      return console.error('Error executing query for connection test:', err.stack);
    }
    console.log('Successfully connected to PostgreSQL. Current time from DB:', result.rows[0].now);
  });
});

// Export a query function to be used by services
// This function will get a client from the pool, execute the query, and release the client
const query = async (text, params) => {
  const start = Date.now();
  try {
    const client = await pool.connect(); // Get a client from the pool
    const res = await client.query(text, params);
    client.release(); // Release the client back to the pool
    const duration = Date.now() - start;
    console.log('Executed query:', { text: text.substring(0,100) + (text.length > 100 ? '...':''), duration: `${duration}ms`, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('Database query error:', { query: text.substring(0,100) + (text.length > 100 ? '...':''), params, error: err.message });
    throw err; // Re-throw the error to be handled by the calling function
  }
};

module.exports = {
  query,
  pool // Expose pool if direct access is needed for transactions, etc.
}; 