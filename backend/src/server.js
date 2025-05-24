const express = require('express');
const serverConfig = require('../config/server.config');
const apiRoutes = require('./api/routes');
const db = require('./db/connection'); // Ensure DB pool is initialized
const fs = require('fs');
const util = require('util');
const path = require('path');

const app = express();

app.use(express.json());

// Ensure the backend directory exists for the log file if this script is run from elsewhere
const backendDir = __dirname; // Assumes server.js is in backend/src
const logFilePath = path.join(backendDir, '../server.log'); // Place server.log in backend/

// Create a write stream for the log file (append mode)
const log_file = fs.createWriteStream(logFilePath, { flags: 'a' });

// Save original stdout and stderr write functions
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Override process.stdout.write
process.stdout.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string') {
    log_file.write(util.format(chunk));
  }
  return originalStdoutWrite(chunk, encoding, callback);
};

// Override process.stderr.write
process.stderr.write = (chunk, encoding, callback) => {
  if (typeof chunk === 'string') {
    log_file.write(util.format(chunk));
  }
  return originalStderrWrite(chunk, encoding, callback);
};

console.log('----------------------------------------');
console.log(`Logging to console and to ${logFilePath}`);
console.log('Server process started at: ' + new Date().toISOString());
console.log('----------------------------------------');

// Basic route
app.get('/', (req, res) => {
  res.send('Crocido Scraper Backend is running!');
});

// API routes
app.use('/api', apiRoutes);

// Global error handler (basic)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(serverConfig.port, () => {
  console.log(`Server listening on port ${serverConfig.port}`);
  // db.connect(); // This line is not needed as connection.js runs its own test.
}); 