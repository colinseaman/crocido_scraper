// background_scripts/main.js
console.log("Crocido Background Script Loaded");

let currentScraperConfig = {
  domain: null,
  selectors: [], // { name: 'title', xpath: '//h1/span'}
  headers: {},
  categoryUrls: [],
  paginationMethod: 'none', // Default to none
  paginationDetails: {},    // For selector, like { selector: '.next' }
  detectedXhrPatterns: [], // New field to store detected XHR URLs/patterns
  productContainersXpath: null,
  configName: "Default Config" // Added a name for the config
};
let detectedSitemapCategoryUrls = []; // Temporary store for URLs from sitemap
let detectedPageLinkCategoryUrls = []; // Temporary store for URLs from page links

chrome.runtime.onInstalled.addListener(() => {
  console.log("Crocido Scraper Extension Installed");
  chrome.storage.local.get(['apiKey', 'scraperConfigs', 'currentScraperConfig'], (result) => {
    if (!result.apiKey) chrome.storage.local.set({ apiKey: null });
    if (!result.scraperConfigs) chrome.storage.local.set({ scraperConfigs: [] });
    if (result.currentScraperConfig) {
      // If a previous currentScraperConfig was saved, load it.
      // currentScraperConfig = result.currentScraperConfig;
      // console.log("Loaded currentScraperConfig from storage:", currentScraperConfig);
      // For safety, start fresh or merge carefully. Starting fresh for now.
      chrome.storage.local.set({ currentScraperConfig: currentScraperConfig });
    } else {
      chrome.storage.local.set({ currentScraperConfig: currentScraperConfig });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in background:", request.action, "from:", sender.tab ? `Tab ${sender.tab.id}`: "Extension");

  if (request.action === "elementSelected") {
    // Received from content script (selector_tool.js)
    console.log(`Element selected: ${request.tagName} - ${request.xpath}`);
    // This data is now primarily handled by the content script's sidebar.
    // Background script might just log or update a temporary state if needed.
    sendResponse({status: "Element selection noted by background"});

  } else if (request.action === "startSetup") {
    console.log("Setup mode initiated on tab:", sender.tab.id);
    sendResponse({status: "Setup mode acknowledged by background"});

  } else if (request.action === "stopSetup") {
    console.log("Setup mode stopped on tab:", sender.tab.id);
    sendResponse({status: "Setup mode stop acknowledged by background"});

  } else if (request.action === "sitemapCategoriesDetected") {
    // Sent from page_monitor.js
    console.log("Background received sitemapCategoriesDetected:", request.urls);
    detectedSitemapCategoryUrls = request.urls || [];
    // TODO: Send these URLs to the selector_tool.js UI for user to select/confirm.
    // For now, just acknowledge.
    sendResponse({status: "Sitemap categories received by background", count: detectedSitemapCategoryUrls.length});
    
    // We also need to inform the selector_tool that detection is complete so it can re-enable the button
    // and potentially update its UI with these URLs.
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "categoryDetectionComplete", 
                source: "background", 
                detectedUrls: detectedSitemapCategoryUrls, 
                detectionType: "sitemap"
            });
        }
    });
    return; // Explicit return if no further async from this specific handler

  } else if (request.action === "pageLinkCategoriesDetected") {
    console.log("Background received pageLinkCategoriesDetected:", request.urls);
    detectedPageLinkCategoryUrls = request.urls || [];
    // For now, we will merge these with sitemap URLs before sending to selector_tool for simplicity,
    // or selector_tool can handle merging. Let's have selector_tool merge.
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs){
        if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: "categoryDetectionComplete", 
                source: "background", 
                detectedUrls: detectedPageLinkCategoryUrls, 
                detectionType: "pagelinks"
            });
        }
    });
    sendResponse({status: "Page link categories received by background", count: detectedPageLinkCategoryUrls.length});
    return; 

  } else if (request.action === "saveConfiguration") {
    console.log("[BG_SAVE_CONFIG] Received action: saveConfiguration");
    console.log("[BG_SAVE_CONFIG] Request.config data:", JSON.parse(JSON.stringify(request.config)));

    // Update currentScraperConfig in memory first
    currentScraperConfig.domain = request.config.domain || currentScraperConfig.domain;
    currentScraperConfig.selectors = request.config.selectors || currentScraperConfig.selectors;
    currentScraperConfig.productContainersXpath = request.config.productContainersXpath !== undefined ? request.config.productContainersXpath : currentScraperConfig.productContainersXpath;
    currentScraperConfig.configName = request.config.configName || currentScraperConfig.configName;
    currentScraperConfig.paginationMethod = request.config.paginationMethod || currentScraperConfig.paginationMethod;
    currentScraperConfig.paginationDetails = request.config.paginationDetails || currentScraperConfig.paginationDetails;
    currentScraperConfig.categoryUrls = request.config.categoryUrls || [];
    console.log("[BG_SAVE_CONFIG] currentScraperConfig updated in memory.");

    (async () => {
      console.log("[BG_SAVE_CONFIG] Async IIFE started.");
      try {
        console.log("[BG_SAVE_CONFIG] Step 1: Getting 'scraperConfigs' from local storage...");
        const data = await new Promise((resolve, reject) => {
          chrome.storage.local.get('scraperConfigs', (result) => {
            if (chrome.runtime.lastError) {
              console.error("[BG_SAVE_CONFIG] Error in Step 1 (chrome.storage.local.get):", chrome.runtime.lastError.message);
              return reject(new Error(`Storage get error: ${chrome.runtime.lastError.message}`));
            }
            console.log("[BG_SAVE_CONFIG] Step 1 successful. Data retrieved:", result);
            resolve(result);
          });
        });

        let configs = data.scraperConfigs || [];
        console.log("[BG_SAVE_CONFIG] Step 2: Processing existing configs. Found:", configs.length);
        const existingConfigIndex = configs.findIndex(c =>
          (currentScraperConfig.id && c.id === currentScraperConfig.id) ||
          (c.domain === currentScraperConfig.domain && c.configName === currentScraperConfig.configName)
        );
        console.log("[BG_SAVE_CONFIG] Step 2.1: Existing config index:", existingConfigIndex);

        const newConfigData = {
          ...currentScraperConfig,
          id: existingConfigIndex > -1 ? configs[existingConfigIndex].id : (currentScraperConfig.id || `config_${Date.now()}`),
          lastUpdated: new Date().toISOString()
        };
        if (existingConfigIndex === -1 && !newConfigData.createdAt) {
          newConfigData.createdAt = new Date().toISOString();
        }
        console.log("[BG_SAVE_CONFIG] Step 2.2: Prepared newConfigData with id:", newConfigData.id);

        if (existingConfigIndex > -1) {
          configs[existingConfigIndex] = { ...configs[existingConfigIndex], ...newConfigData };
        } else {
          configs.push(newConfigData);
        }
        console.log("[BG_SAVE_CONFIG] Step 2.3: Configs array updated.");

        currentScraperConfig.id = newConfigData.id;
        if (newConfigData.createdAt) currentScraperConfig.createdAt = newConfigData.createdAt;
        currentScraperConfig.lastUpdated = newConfigData.lastUpdated;
        console.log("[BG_SAVE_CONFIG] Step 2.4: In-memory currentScraperConfig updated with new ID/timestamps.");

        console.log("[BG_SAVE_CONFIG] Step 3: Setting 'scraperConfigs' and 'currentScraperConfig' to local storage...");
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ scraperConfigs: configs, currentScraperConfig: currentScraperConfig }, () => {
            if (chrome.runtime.lastError) {
              console.error("[BG_SAVE_CONFIG] Error in Step 3 (chrome.storage.local.set):", chrome.runtime.lastError.message);
              return reject(new Error(`Storage set error: ${chrome.runtime.lastError.message}`));
            }
            console.log("[BG_SAVE_CONFIG] Step 3 successful. Local storage updated.");
            resolve();
          });
        });

        console.log("[BG_SAVE_CONFIG] Step 4: Calling saveConfigToBackend...");
        await saveConfigToBackend(newConfigData);
        console.log("[BG_SAVE_CONFIG] Step 4 successful. saveConfigToBackend completed.");

        console.log("[BG_SAVE_CONFIG] Step 5: Sending success response...");
        sendResponse({ status: "Config saved to local storage and backend", localConfigs: configs, activeConfig: newConfigData });
        console.log("[BG_SAVE_CONFIG] Step 5: Success response sent.");

      } catch (error) {
        console.error("[BG_SAVE_CONFIG] Error in Async IIFE catch block:", error.message, error.stack);
        console.log("[BG_SAVE_CONFIG] Sending error response...");
        sendResponse({ status: "Error saving config", error: error.message });
        console.log("[BG_SAVE_CONFIG] Error response sent.");
      }
    })();

    return true;

  } else if (request.action === "scrapeAll") {
    console.log("Scrape All initiated in background.");
    chrome.storage.local.get(['currentScraperConfig', 'apiKey'], async (result) => {
      const currentConfig = result.currentScraperConfig;
      const apiKey = result.apiKey;
      const backendBaseUrl = "http://localhost:3000"; // Ensure this is consistent

      if (!currentConfig || !currentConfig.id) {
        console.error("No active config ID found to scrape.");
        sendResponse({status: "Error: No active configuration ID found.", error: true});
        return;
      }
      if (!apiKey) {
        console.error("API Key not found for backend request.");
        sendResponse({status: "Error: API Key not found.", error: true});
        return;
      }

      console.log(`Requesting backend to scrape config ID: ${currentConfig.id} at ${backendBaseUrl}/api/scrape/${currentConfig.id}`);
      try {
        const response = await fetch(`${backendBaseUrl}/api/scrape/${currentConfig.id}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          // body: JSON.stringify({ userId: "tempUserId123" }) // REMOVE userId from body
          // Backend should derive userId from the validated apiKey
        });

        if (!response.ok) {
          const errorData = await response.json().catch(async () => {
            // If .json() fails, it might be plain text or HTML (e.g. a server crash page)
            const textError = await response.text();
            console.warn("Backend error response was not JSON, attempting to log as text.");
            return { message: textError.substring(0, 500) }; // Return a consistent error object structure
          }); 
          console.error("Backend error during scrape request:", response.status, JSON.stringify(errorData, null, 2));
          throw new Error( (errorData && errorData.message) ? errorData.message : (typeof errorData === 'string' ? errorData : `Backend responded with ${response.status} - see console for details`) );
        }
        const scrapeStartResult = await response.json();
        console.log("Backend response to scrape request:", scrapeStartResult);
        sendResponse({status: "Scraping process started by backend.", data: scrapeStartResult});
        
        // Mocking backend call for now - REMOVE THIS BLOCK
        // console.log("Mocking backend call for /api/scrape/" + currentConfig.id);
        // setTimeout(() => { // Simulate async call
        //     sendResponse({status: "Mock scraping process started by backend.", data: { jobId: "mockJob_"+currentConfig.id }});
        // }, 500);

      } catch (error) {
        console.error("Error triggering scrape on backend:", error);
        sendResponse({status: `Error: ${error.message}`, error: true});
      }
    });
    return true; // Indicates that the response will be sent asynchronously

  } else if (request.action === "exportCsv") {
    console.log("Export CSV initiated in background.");
    chrome.storage.local.get(['currentScraperConfig', 'apiKey'], async (result) => {
      const currentConfig = result.currentScraperConfig;
      const apiKey = result.apiKey;
      const backendBaseUrl = "http://localhost:3000"; // Ensure this is consistent

      if (!currentConfig || !currentConfig.id) {
        console.error("No active config ID found to export CSV for.");
        sendResponse({status: "Error: No active configuration ID found.", error: true});
        return;
      }
      if (!apiKey) {
        console.error("API Key not found for backend request.");
        sendResponse({status: "Error: API Key not found.", error: true});
        return;
      }

      console.log(`Requesting CSV export for config ID: ${currentConfig.id} at ${backendBaseUrl}/api/data/export/${currentConfig.id}`);
      try {
        const response = await fetch(`${backendBaseUrl}/api/data/export/${currentConfig.id}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`
            // Note: If your validateApiKey middleware for GET also needs userId in body, that's unusual.
            // Typically for GET, API key in header is enough, or userId is path/query param.
            // Adjust if your backend specifically requires userId in body for GET requests.
          }
        });

        if (!response.ok) {
          const errorData = await response.text(); // CSV error might not be JSON
          console.error("Backend error during CSV export request:", response.status, errorData);
          throw new Error(errorData || `Backend responded with ${response.status}`);
        }
        const csvText = await response.text();
        
        // Mocking backend call - REMOVE THIS BLOCK if it exists
        // console.log("Mocking backend call for /api/data/export/" + currentConfig.id);
        // const csvText = "col1,col2\nmockValue1,mockValue2_for_config_" + currentConfig.id;

        // Trigger download in the browser
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
          url: url,
          filename: `crocido_export_${currentConfig.id || 'data'}.csv`,
          saveAs: true
        });
        sendResponse({status: "CSV data received, download initiated.", data: { filename: `crocido_export_${currentConfig.id || 'data'}.csv`}});

      } catch (error) {
        console.error("Error fetching CSV from backend:", error);
        sendResponse({status: `Error: ${error.message}`, error: true});
      }
    });
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.action === "xhrDetected") {
    // Sent from page_monitor.js
    console.log("Background received xhrDetected:", request.method, request.url);
    if (currentScraperConfig && currentScraperConfig.paginationMethod === 'xhrInfinite') {
      if (!currentScraperConfig.detectedXhrPatterns) {
        currentScraperConfig.detectedXhrPatterns = [];
      }
      // Avoid duplicates and store relevant info (could be more complex objects later)
      if (!currentScraperConfig.detectedXhrPatterns.some(p => p.url === request.url && p.method === request.method)) {
        currentScraperConfig.detectedXhrPatterns.push({ url: request.url, method: request.method /*, count: 1, firstSeen: Date.now() */ });
        console.log("Added to detectedXhrPatterns:", currentScraperConfig.detectedXhrPatterns);
        // Optionally, save to local storage immediately or wait for explicit saveConfig action
        // For now, it's in memory and will be saved with the next general saveConfig call.
      }
    } else {
      console.log("XHR detected, but current config not set to xhrInfinite or no active config.");
    }
    sendResponse({status: "XHR details received and processed by background"});
    return; // Explicit return for this specific handler if no further async response needed from here.
  }
  // Keep the message channel open for asynchronous responses if needed
  return true;
});

// Placeholder for API interactions
async function saveConfigToBackend(configData) {
  console.log("Attempting to save to backend. Config includes detectedXhrPatterns:", configData.detectedXhrPatterns);
  const backendBaseUrl = "http://localhost:3000"; // Ensure this is consistent
  const FETCH_TIMEOUT_MS = 15000; // 15 seconds timeout

  // Wrap chrome.storage.local.get in a promise to use await
  const getApiKey = () => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get('apiKey', (result) => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result.apiKey);
      });
    });
  };

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      console.warn("API Key not set in storage. Cannot save to backend.");
      throw new Error("API Key not set. Cannot save to backend.");
    }

    const userId = "tempUserId123"; // REMOVE Placeholder.

    console.log(`[saveConfigToBackend] Preparing to save. Using userId: '${userId}', apiKey: '${apiKey ? apiKey.substring(0,10) + '...' : 'null'}'`);
    console.log(`Saving to backend (${backendBaseUrl}/api/config) with API Key: ${apiKey.substring(0, 5)}...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[saveConfigToBackend] Fetch to ${backendBaseUrl}/api/config timed out after ${FETCH_TIMEOUT_MS}ms`);
        controller.abort();
    }, FETCH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${backendBaseUrl}/api/config`, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ userId: userId, config: configData }),
            signal: controller.signal // Abort signal
        });
    } finally {
        clearTimeout(timeoutId); // Clear the timeout whether fetch succeeded, failed, or aborted
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Backend error response: ${response.status}`, errorBody);
      throw new Error(`Backend responded with ${response.status}: ${errorBody}`);
    }

    const backendResult = await response.json();
    console.log("Config saved to backend successfully:", backendResult);
    return backendResult; // Return the result for the caller to know it's done

  } catch (error) {
    console.error("Error saving config to backend:", error);
    // Optionally, notify the user about the backend save error
    // chrome.runtime.sendMessage({action: "backendSaveError", message: error.message});
    throw error; // Re-throw the error so the caller (saveConfig handler) can catch it
  }
}

// TODO: Add listeners for webRequest API to capture headers if specified in PRD for in-browser use
// chrome.webRequest.onBeforeSendHeaders.addListener(...); 