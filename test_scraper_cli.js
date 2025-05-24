const dbPool = require('./backend/src/db/connection'); // Adjust path as needed
const scraperService = require('./backend/src/services/scraperService'); // Adjust path
const scraperEngine = require('./scraper_engine/src/main'); // Adjust path

async function main() {
  const configId = process.argv[2];
  if (!configId) {
    console.error('Usage: node test_scraper_cli.js <configId>');
    process.exit(1);
  }

  console.log(`Attempting to test scraper with Config ID: ${configId}`);

  try {
    // 1. Fetch configuration (simplified version of scraperService.getConfiguration)
    // Note: scraperService.getConfiguration also checks userId, which we don't have here easily.
    // For a CLI test, we might bypass the userId check or use a placeholder if the function requires it.
    // Let's assume we need userId for getConfiguration as per scraperService structure.
    const testUserId = 'tempUserId123'; // Or another relevant test user ID.
    console.log(`Fetching configuration for configId: ${configId}, userId: ${testUserId}`);
    
    // Directly query the DB for the config, bypassing service-level userId check for this CLI tool
    const configQueryText = 'SELECT * FROM scraper_configs WHERE id = $1';
    const dbResult = await dbPool.query(configQueryText, [configId]);
    let configFromDb;

    if (dbResult.rows.length > 0) {
        configFromDb = dbResult.rows[0];
        console.log('Successfully fetched configuration from DB:', configFromDb.id);
    } else {
        console.error(`Configuration not found in DB for ID: ${configId}`);
        process.exit(1);
    }

    // 2. Parse the configuration (similar to how it's done in scraperService.runScraper)
    const selectors = scraperService.parseJsonField(configFromDb.selectors_json, [], 'selectors_json');
    const categoryUrls = scraperService.parseJsonField(configFromDb.category_urls_json, [], 'category_urls_json');
    const paginationDetails = scraperService.parseJsonField(configFromDb.pagination_details_json, {}, 'pagination_details_json');
    const detectedXhrPatterns = scraperService.parseJsonField(configFromDb.detected_xhr_patterns_json, [], 'detected_xhr_patterns_json');
    const headers = scraperService.parseJsonField(configFromDb.headers_json, {}, 'headers_json');

    const parsedConfigForEngine = {
      id: configFromDb.id,
      userId: configFromDb.user_id, // Keep original user_id from config
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

    console.log('Parsed config being sent to scraper engine:', JSON.stringify(parsedConfigForEngine, null, 2));

    // 3. Run the scraper engine
    if (typeof scraperEngine.start !== 'function') {
        console.error("scraperEngine.start is not a function. Check scraper_engine/src/main.js exports.");
        throw new Error("Scraper engine's start function is not available.");
    }

    console.log('Starting scraper engine...');
    const result = await scraperEngine.start(parsedConfigForEngine);

    console.log('Scraper engine finished.');
    console.log('Scraped Data:', JSON.stringify(result, null, 2));
    console.log(`Total items scraped: ${result && result.data ? result.data.length : 0}`);

  } catch (error) {
    console.error('Error during CLI scraper test:', error);
    process.exit(1);
  } finally {
    await dbPool.pool.end(); // Close database pool
    console.log('Database pool closed.');
  }
}

// Helper function for parsing JSON - needs to be defined or imported if scraperService isn't structured for it
// For simplicity, defining a local version if scraperService.parseJsonField is not directly accessible or static
if (typeof scraperService.parseJsonField !== 'function') {
    scraperService.parseJsonField = (fieldValue, defaultValue, fieldNameForLog = 'field') => {
        if (typeof fieldValue === 'string') {
            if (fieldValue.trim() === '') return defaultValue;
            try { return JSON.parse(fieldValue); }
            catch (e) { 
                console.error(`Error parsing JSON string for '${fieldNameForLog}': ${e.message}. Defaulting. Raw:`, fieldValue);
                return defaultValue;
            }
        }
        if (fieldValue === null || fieldValue === undefined) return defaultValue;
        return fieldValue;
    };
}

main(); 