const db = require('../db/connection'); // Import the actual db connection
const scraper = require('../../../scraper_engine/src/main.js');

// Helper function to safely parse JSON fields
function parseJsonField(fieldValue, defaultValue, fieldNameForLog = 'field') {
  if (typeof fieldValue === 'string') {
    if (fieldValue.trim() === '') {
      console.warn(`JSON field '${fieldNameForLog}' is an empty string. Defaulting to`, defaultValue);
      return defaultValue;
    }
    try {
      return JSON.parse(fieldValue);
    } catch (e) {
      console.error(`Error parsing JSON string for '${fieldNameForLog}': ${e.message}. Defaulting to`, defaultValue, ". Raw data:", fieldValue);
      return defaultValue;
    }
  }
  // If it's not a string, assume it's already parsed (or null/undefined)
  if (fieldValue === null || fieldValue === undefined) {
    console.warn(`JSON field '${fieldNameForLog}' is null or undefined. Defaulting to`, defaultValue);
    return defaultValue;
  }
  return fieldValue; // Already an object/array
}

async function saveConfiguration(userId, config) {
  // API Key validation is now handled by middleware in routes.js
  // userId is trusted here as it comes from the validated req.user object.
  console.log(`Saving configuration for user ${userId}:`);
  console.log(`Config Details - Domain: ${config.domain}, Selectors: ${config.selectors.length}, Container XPath: ${config.productContainersXpath}, Pagination: ${config.paginationMethod}`);
  if (config.paginationDetails && config.paginationDetails.selector) {
    console.log(`Pagination Selector: ${config.paginationDetails.selector}`);
  }
  if (config.paginationMethod === 'xhrInfinite' && config.detectedXhrPatterns && config.detectedXhrPatterns.length > 0) {
    console.log(`Detected XHR Patterns: ${JSON.stringify(config.detectedXhrPatterns)}`);
  }
  // console.log(JSON.stringify(config, null, 2));

  const queryText = `
    INSERT INTO scraper_configs (
      id, user_id, config_name, domain, selectors_json, product_container_xpath, 
      pagination_method, pagination_details_json, detected_xhr_patterns_json,
      category_urls_json, headers_json, created_at, last_updated
    ) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET -- Using config ID as the conflict target
      config_name = EXCLUDED.config_name,
      domain = EXCLUDED.domain,
      selectors_json = EXCLUDED.selectors_json,
      product_container_xpath = EXCLUDED.product_container_xpath,
      pagination_method = EXCLUDED.pagination_method,
      pagination_details_json = EXCLUDED.pagination_details_json,
      detected_xhr_patterns_json = EXCLUDED.detected_xhr_patterns_json, 
      category_urls_json = EXCLUDED.category_urls_json,
      headers_json = EXCLUDED.headers_json,
      last_updated = EXCLUDED.last_updated
    RETURNING id, user_id, config_name, domain, created_at, last_updated;
  `;

  const configId = config.id || `config_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date();

  const values = [
    configId,
    userId,
    config.configName || `Config for ${config.domain}`,
    config.domain,
    JSON.stringify(config.selectors || []),
    config.productContainersXpath || null,
    config.paginationMethod || 'none',
    JSON.stringify(config.paginationDetails || {}),
    JSON.stringify(config.detectedXhrPatterns || []),
    JSON.stringify(config.categoryUrls || []),
    JSON.stringify(config.headers || {}),
    config.createdAt || now, // Use existing createdAt if updating, else now
    now                     // last_updated is always now
  ];

  console.log(`Service: Attempting to save/update config. DB Query Params - ID: ${configId}, UserID: ${userId}`);

  try {
    const result = await db.query(queryText, values);
    console.log("Configuration saved/updated in DB:", result.rows[0]);
    return result.rows[0]; // Return the saved/updated row data
  } catch (dbError) {
    console.error("Database error saving configuration in service:", dbError);
    throw dbError; // Propagate error to be handled by the route
  }
}

async function getConfiguration(configId, userId) {
  console.log(`Service: Attempting to fetch config. DB Query Params - ID: ${configId}, UserID: ${userId}`);
  const queryText = 'SELECT * FROM scraper_configs WHERE id = $1 AND user_id = $2';
  try {
    const result = await db.query(queryText, [configId, userId]);
    if (result.rows.length > 0) {
      console.log(`Service: Configuration found for ID: ${configId}, UserID: ${userId}`);
      return result.rows[0];
    } else {
      console.warn(`Service: Configuration NOT FOUND for ID: ${configId}, UserID: ${userId}`);
      return null; // Not found or not authorized
    }
  } catch (dbError) {
    console.error(`Database error getting configuration ${configId} for user ${userId}:`, dbError);
    throw dbError;
  }
}

async function saveScrapedItems(configId, userId, items) {
  if (!items || items.length === 0) {
    console.log(`No items to save for config ${configId}`);
    return 0;
  }
  console.log(`Attempting to save ${items.length} items for config ${configId}, user ${userId}`);

  let successfullySavedCount = 0;
  // Use a transaction to insert all items or none if one fails (optional, but good practice)
  const client = await db.pool.connect(); // Get a client directly for transaction
  try {
    await client.query('BEGIN');
    const queryText = `
      INSERT INTO scraped_products (\n        config_id, user_id, title, price, product_link, image_url, description, custom_fields\n      )\n      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)\n      ON CONFLICT (product_link) DO UPDATE SET -- Assumes product_link should be unique
        title = EXCLUDED.title,\n        price = EXCLUDED.price,\n        image_url = EXCLUDED.image_url,\n        description = EXCLUDED.description,\n        custom_fields = EXCLUDED.custom_fields,\n        scraped_at = NOW()\n      RETURNING id;\n    `;

    for (const item of items) {
      // Map general field names to specific DB columns. Assumes item has Title, Price, Link etc.
      // Any other fields will go into custom_fields JSONB
      const { Title, Price, Link, Image, Description, ...otherFields } = item;
      const values = [
        configId,
        userId,
        Title || null,
        Price || null,
        Link || null,
        Image || null, // Assuming 'Image' is the key for image_url
        Description || null,
        Object.keys(otherFields).length > 0 ? JSON.stringify(otherFields) : null
      ];
      try {
        const res = await client.query(queryText, values);
        if(res.rowCount > 0) successfullySavedCount++;
      } catch (itemInsertError) {
        // Log individual item insert error but continue transaction (or rollback all)
        // For now, we log and continue. If product_link constraint is strict, this might fail often.
        console.warn(`Failed to insert/update item with link ${Link} for config ${configId}: ${itemInsertError.message}. Detail: ${itemInsertError.detail}`);
        // If ON CONFLICT is robust, this catch might not be hit for mere duplicates if they are updated.
      }
    }
    await client.query('COMMIT');
    console.log(`Successfully saved/updated ${successfullySavedCount} items out of ${items.length} for config ${configId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`Transaction ROLLBACK. Error saving scraped items for config ${configId}:`, error);
    throw error; // Propagate error
  } finally {
    client.release();
  }
  return successfullySavedCount;
}

async function runScraper(configId, userId) {
  console.log(`Attempting to run scraper for configId: ${configId}, userId: ${userId}`);
  try {
    const configFromDb = await getConfiguration(configId, userId);
    if (!configFromDb) {
      throw new Error(`Configuration not found for configId: ${configId} and userId: ${userId}`);
    }

    console.log("Raw config from DB:", configFromDb);

    const selectors = parseJsonField(configFromDb.selectors_json, [], 'selectors_json');
    const categoryUrls = parseJsonField(configFromDb.category_urls_json, [], 'category_urls_json');
    const paginationDetails = parseJsonField(configFromDb.pagination_details_json, {}, 'pagination_details_json');
    const detectedXhrPatterns = parseJsonField(configFromDb.detected_xhr_patterns_json, [], 'detected_xhr_patterns_json');
    const headers = parseJsonField(configFromDb.headers_json, {}, 'headers_json'); // Assuming headers_json might exist

    const parsedConfig = {
      id: configFromDb.id,
      userId: configFromDb.user_id,
      domain: configFromDb.domain,
      configName: configFromDb.config_name,
      selectors: selectors,
      categoryUrls: categoryUrls,
      productContainersXpath: configFromDb.product_container_xpath,
      paginationMethod: configFromDb.pagination_method,
      paginationDetails: paginationDetails,
      detectedXhrPatterns: detectedXhrPatterns,
      headers: headers
    };

    console.log("Parsed config being sent to scraper engine:", parsedConfig);

    // Ensure scraper.start exists and is a function
    if (typeof scraper.start !== 'function') {
        console.error("scraper.start is not a function. Check the import and scraper_engine/src/main.js exports.");
        throw new Error("Scraper engine's start function is not available.");
    }
    
    const scrapedItems = await scraper.start(parsedConfig);
    console.log(`Scraper engine finished. Received ${scrapedItems ? scrapedItems.length : 0} items.`);

    if (scrapedItems && scrapedItems.length > 0) {
      await saveScrapedItems(configFromDb.id, configFromDb.user_id, scrapedItems);
      console.log(`Successfully saved ${scrapedItems.length} items to the database.`);
    } else {
      console.log("No items were scraped or returned by the scraper engine.");
    }

    return { success: true, message: "Scraping process completed.", itemCount: scrapedItems ? scrapedItems.length : 0, configId: configFromDb.id };
  } catch (error) {
    console.error("Error in runScraper:", error);
    // Ensure the error object passed back has a message property
    const errorMessage = error.message || "An unknown error occurred during scraping.";
    throw new Error(errorMessage); // Re-throw to be caught by the route handler
  }
}

// Utility to convert array of objects to CSV string
function convertToCsv(data, columns) {
  if (!data || data.length === 0) {
    return '';
  }
  // Use provided columns or infer from first object keys
  const header = columns ? columns.join(',') : Object.keys(data[0]).join(',');
  const rows = data.map(row => {
    return columns 
      ? columns.map(col => JSON.stringify(row[col] === null || row[col] === undefined ? '' : row[col])).join(',') 
      : Object.values(row).map(val => JSON.stringify(val === null || val === undefined ? '' : val)).join(',');
  });
  return `${header}\n${rows.join('\n')}`;
}

async function exportDataToCsv(configId, userId) {
  console.log(`Exporting data to CSV for config ID: ${configId} by user ${userId}`);
  // First, verify the user owns the config (implicit via getConfiguration)
  const config = await getConfiguration(configId, userId);
  if (!config) {
    throw new Error('Configuration not found or not authorized for export');
  }

  const queryText = `
    SELECT title, price, product_link, image_url, description, custom_fields, scraped_at 
    FROM scraped_products 
    WHERE config_id = $1 AND user_id = $2
    ORDER BY scraped_at DESC;
  `;
  try {
    const result = await db.query(queryText, [configId, userId]);
    if (result.rows.length === 0) {
      console.log(`No scraped data found for config ${configId} by user ${userId}`);
      // Return a CSV with headers only, or an empty string, or a message
      return "title,price,product_link,image_url,description,custom_fields_json,scraped_at\n"; 
    }

    // Define which columns to include and their order in the CSV
    // The custom_fields will be stringified JSON in its column.
    const columns = ['title', 'price', 'product_link', 'image_url', 'description', 'custom_fields', 'scraped_at'];
    const csvData = convertToCsv(result.rows.map(row => ({
        ...row,
        custom_fields: row.custom_fields ? JSON.stringify(row.custom_fields) : '' // Ensure JSON is string for CSV cell
    })), columns);
    
    console.log(`Successfully fetched ${result.rows.length} products for CSV export, config ${configId}`);
    return csvData;
  } catch (dbError) {
    console.error(`Database error exporting data for config ${configId}:`, dbError);
    throw dbError;
  }
}

module.exports = {
  saveConfiguration,
  getConfiguration,
  runScraper,
  exportDataToCsv,
  saveScrapedItems
}; 