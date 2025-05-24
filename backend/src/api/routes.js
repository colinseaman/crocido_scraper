const express = require('express');
const router = express.Router();
const scraperService = require('../services/scraperService');

// Middleware for API key validation
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['authorization'] ? req.headers['authorization'].split(' ')[1] : null;
  let userIdFromBody = req.body && req.body.userId ? req.body.userId : null;

  // Log the incoming request path and method for all requests hitting this middleware
  console.log(`validateApiKey: Method=${req.method}, Path=${req.path}, BodyUserId=${userIdFromBody}`);

  if (!apiKey) {
    console.warn('validateApiKey: API Key is missing');
    return res.status(401).json({ message: 'API Key is missing' });
  }

  // For POST /api/config, userId is expected and required in the body.
  if (req.method === 'POST' && req.path.startsWith('/config')) {
    if (!userIdFromBody) {
        console.warn(`validateApiKey: User ID is missing in request body for POST ${req.path}`);
        return res.status(400).json({ message: 'User ID is missing in request body for this operation' });
    }
  }

  // Actual API Key validation
  if (apiKey === "valid-api-key-placeholder") {
    // If userId was provided in the body (e.g., for /config), use that.
    // Otherwise (e.g., for /scrape), default to "tempUserId123" because the API key matches the placeholder.
    const effectiveUserId = userIdFromBody || "tempUserId123";
    
    console.log(`API Key validated for user ${effectiveUserId}`);
    req.user = { id: effectiveUserId, apiKey: apiKey }; // Attach user info to request object
    next();
  } else {
    // For logging, use userIdFromBody if present, otherwise indicate it might not have been expected.
    const logUserId = userIdFromBody || "(not provided in body)";
    console.warn(`Invalid API Key: Key ${apiKey.substring(0,5)}... for user ${logUserId}`);
    return res.status(403).json({ message: 'Invalid API Key' }); // Simplified error, API key is the main point of failure here
  }
};

// Endpoint to save scraper configuration
router.post('/config', validateApiKey, async (req, res) => {
  try {
    const { config } = req.body; // userId is now on req.user from middleware
    const userId = req.user.id;
    const apiKey = req.user.apiKey; // Though apiKey is validated, service might not need it if userId implies auth

    if (!config || typeof config !== 'object') {
      return res.status(400).json({ message: 'Config object is missing or invalid in request body' });
    }
    if (!config.domain || !Array.isArray(config.selectors)) {
      return res.status(400).json({ message: 'Invalid config structure: domain and selectors array are required' });
    }

    const savedConfig = await scraperService.saveConfiguration(userId, config);
    res.status(201).json({ message: 'Configuration saved successfully', configId: savedConfig.id, userId: userId });
  } catch (error) {
    console.error('Error saving configuration:', error);
    res.status(500).json({ message: 'Failed to save configuration', error: error.message });
  }
});

// Endpoint to get scraper configuration
router.get('/config/:configId', validateApiKey, async (req, res) => {
  try {
    const { configId } = req.params;
    const userId = req.user.id; // Ensure config belongs to this user
    // TODO: Modify getConfiguration to also check userId against configId for ownership
    const config = await scraperService.getConfiguration(configId, userId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).json({ message: 'Configuration not found or not authorized' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to get configuration', error: error.message });
  }
});

// Endpoint to trigger a scrape for a given configuration
router.post('/scrape/:configId', validateApiKey, async (req, res) => {
  try {
    const { configId } = req.params;
    const userId = req.user.id;
    // TODO: Check ownership of configId by userId before running scraper
    const result = await scraperService.runScraper(configId, userId);
    res.json({ message: 'Scraping process started', jobId: result.jobId });
  } catch (error) {
    res.status(500).json({ message: 'Failed to start scraping process', error: error.message });
  }
});

// Endpoint to get scraped data / export CSV
router.get('/data/export/:configId', validateApiKey, async (req, res) => {
  try {
    const { configId } = req.params;
    const userId = req.user.id;
    // TODO: Check ownership of configId by userId before exporting
    const csvData = await scraperService.exportDataToCsv(configId, userId);
    res.header('Content-Type', 'text/csv');
    res.attachment(`export_config_${configId}.csv`);
    res.send(csvData);
  } catch (error) {
    res.status(500).json({ message: 'Failed to export data', error: error.message });
  }
});

module.exports = router; 