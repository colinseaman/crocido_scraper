// backend/config/db.config.js
// Load environment variables from .env file if using dotenv
// require('dotenv').config();

module.exports = {
  user: process.env.DB_USER || 'crocido_user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'crocido_scraper_db',
  password: process.env.DB_PASSWORD || 'changeMe123',
  port: process.env.DB_PORT || 5432,
}; 