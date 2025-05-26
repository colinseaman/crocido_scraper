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

// Keep track of the tabId for which the currentScraperConfig is relevant
let activeConfigContextTabId = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log("Crocido Scraper Extension Installed");
  chrome.storage.local.get(['apiKey', 'scraperConfigs', 'currentScraperConfig'], (result) => {
    if (!result.apiKey) chrome.storage.local.set({ apiKey: null });
    if (!result.scraperConfigs) chrome.storage.local.set({ scraperConfigs: [] });
    
    if (result.currentScraperConfig && result.currentScraperConfig.id) {
      // If a valid currentScraperConfig (with an ID) was saved, load it into the in-memory variable.
      currentScraperConfig = result.currentScraperConfig;
      console.log("Loaded currentScraperConfig from storage:", currentScraperConfig);
      // No need to set it back to storage here if it was already there and valid.
    } else {
      // If no valid currentScraperConfig in storage (or it lacks an ID), 
      // set the default (in-memory) one to storage.
      // This default one will get an ID upon the first saveConfiguration.
      chrome.storage.local.set({ currentScraperConfig: currentScraperConfig });
      console.log("Initialized default currentScraperConfig in storage:", currentScraperConfig);
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in background:", request.action, "from:", sender.tab ? `Tab ${sender.tab.id}`: "Extension", "Domain in request:", request.domain);

  if (request.action === "popupOpened") {
    const { domain, tabId } = request;
    activeConfigContextTabId = tabId; // Store the tabId for context

    chrome.storage.local.get(['scraperConfigs', 'apiKey'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Storage error in popupOpened:", chrome.runtime.lastError.message);
        sendResponse({ statusMessage: "Error accessing storage.", configLoaded: false });
        return;
      }

      const configs = result.scraperConfigs || [];
      const apiKey = result.apiKey;
      const existingConfig = configs.find(c => c.domain === domain);

      if (existingConfig) {
        console.log(`Found existing config for domain ${domain}:`, existingConfig);
        currentScraperConfig = { ...existingConfig }; // Update in-memory
        chrome.storage.local.set({ currentScraperConfig: currentScraperConfig }, () => {
          if (chrome.runtime.lastError) {
            console.error("Error setting currentScraperConfig in storage:", chrome.runtime.lastError.message);
            sendResponse({ statusMessage: "Error saving active config.", configLoaded: false, apiKey: apiKey });
          } else {
            console.log("Set active config in storage for domain:", domain);
            sendResponse({ 
              statusMessage: `Existing config for ${domain} loaded.`, 
              configLoaded: true, 
              configName: currentScraperConfig.configName,
              apiKey: apiKey
            });
          }
        });
      } else {
        console.log(`No existing config found for domain ${domain}. Initializing new default.`);
        // Initialize a new default config for this domain
        currentScraperConfig = {
          domain: domain,
          selectors: [],
          headers: {},
          categoryUrls: [],
          paginationMethod: 'none',
          paginationDetails: {},
          detectedXhrPatterns: [],
          productContainersXpath: null,
          configName: `New Config for ${domain}`,
          id: null, // No ID until saved
          createdAt: null,
          lastUpdated: null
        };
        chrome.storage.local.set({ currentScraperConfig: currentScraperConfig }, () => {
          if (chrome.runtime.lastError) {
            console.error("Error setting new default currentScraperConfig in storage:", chrome.runtime.lastError.message);
            sendResponse({ statusMessage: "Error initializing new config.", configLoaded: false, apiKey: apiKey });
          } else {
            console.log("Initialized new default config in storage for domain:", domain);
            sendResponse({ 
              statusMessage: `Ready to create new config for ${domain}.`, 
              configLoaded: false, 
              apiKey: apiKey 
            });
          }
        });
      }
    });
    return true; // Indicates asynchronous response

  } else if (request.action === "elementSelected") {
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

  } else if (request.action === "startLocalScrape") {
    console.log("'startLocalScrape' action received in background. Save to server:", request.saveToServer);
    const shouldSaveToServer = request.saveToServer || false;

    chrome.storage.local.get(['currentScraperConfig', 'apiKey'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error getting currentScraperConfig for local scrape:", chrome.runtime.lastError.message);
        sendResponse({statusMessage: "Error: Could not retrieve config for local scrape.", error: true});
        return;
      }
      const localConfig = result.currentScraperConfig;
      const apiKey = result.apiKey; // May or may not be needed for purely local CSV, but good to have.

      if (!localConfig || !localConfig.domain) { // Domain is a good proxy for a config being at least initialized
        console.error("No valid configuration loaded to start local scrape. Domain missing.");
        sendResponse({statusMessage: "Error: No valid configuration loaded for the current page to start local scraping.", error: true});
        return;
      }
      // We need an ID if we intend to save results to backend later, but not strictly for local CSV download.
      if (!localConfig.id) {
          console.warn("Local scrape initiated for a configuration that hasn't been saved yet (no ID). Results can only be downloaded as CSV.");
          // Proceed, but saving to backend for this scrape won't be possible without a config ID.
      }

      console.log("Preparing for local scrape with config:", JSON.parse(JSON.stringify(localConfig)));
      
      if (!activeConfigContextTabId) {
        console.error("Cannot start local scrape: activeConfigContextTabId is not set. Was popupOpened called?");
        sendResponse({statusMessage: "Error: Active tab context not established for local scraping.", error: true});
        return; // Important to return here
      }

      // Send the config to the content script of the active tab to perform the scrape
      chrome.tabs.sendMessage(activeConfigContextTabId, 
        { action: "executeLocalScrape", config: localConfig }, 
        (scrapeResponse) => {
          if (chrome.runtime.lastError) {
            console.error("Error messaging content script for local scrape or receiving response:", chrome.runtime.lastError.message);
            // No sendResponse() here to popup, as it might have closed. Log and potentially notify via other means if needed.
            // Or, if popup is likely still open, we could try to send an error status update.
            return;
          }
          if (scrapeResponse && scrapeResponse.success && scrapeResponse.data) {
            console.log("Local scrape successful. Data received from content script:", scrapeResponse.data.length, "items.");
            let csvDownloaded = false;
            if (scrapeResponse.data.length > 0) {
              const csvData = convertArrayOfObjectsToCSV(scrapeResponse.data);
              triggerCSVDownload(csvData, localConfig.configName || localConfig.domain);
              csvDownloaded = true;
            } else {
              console.log("No data returned from local scrape to download.");
            }

            // Optionally send data to backend
            if (shouldSaveToServer && scrapeResponse.data.length > 0) {
              if (localConfig.id) {
                console.log("Attempting to save locally scraped data to backend for config ID:", localConfig.id);
                saveLocalDataToBackend(scrapeResponse.data, localConfig.id, apiKey)
                  .then(backendResponse => console.log("Backend save response:", backendResponse))
                  .catch(err => console.error("Error saving local data to backend:", err));
              } else {
                console.warn("Cannot save local data to backend: Configuration has no ID (it might not have been saved yet).");
              }
            } else if (shouldSaveToServer && scrapeResponse.data.length === 0) {
                console.log("Save to server was checked, but no data was scraped locally.");
            }

          } else {
            console.error("Local scrape failed or returned no data. Response:", scrapeResponse);
          }
        }
      );
      // Initial response to popup to confirm initiation
      sendResponse({statusMessage: "Local scraping process initiated with current config. Content script contacted.", configDomain: localConfig.domain });
    });
    return true; // Indicates asynchronous response.

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
  } else if (request.action === "initiateSetupForTab") {
    const { tabId, domain } = request;
    console.log(`'initiateSetupForTab' requested for tab ${tabId}, domain ${domain}`);
    // currentScraperConfig should already be set by popupOpened or be the default in-memory one.
    // We ensure it matches the requested domain, crucial if popupOpened wasn't the last message.
    if (currentScraperConfig && currentScraperConfig.domain === domain) {
      console.log("Proceeding with currentScraperConfig for setup:", currentScraperConfig);
      chrome.tabs.sendMessage(tabId, {action: "startSetup", config: currentScraperConfig}, (response) => {
        if (chrome.runtime.lastError) {
          console.error(`Error sending 'startSetup' to content script for tab ${tabId}:`, chrome.runtime.lastError.message);
          sendResponse({status: `Error initializing setup on page: ${chrome.runtime.lastError.message}`});
        } else {
          console.log("'startSetup' message sent to content script, response:", response);
          sendResponse({status: "Setup initiated on page.", data: response});
        }
      });
    } else {
      // This case should ideally be rare if popupOpened always precedes initiateSetupForTab for the same domain.
      // However, as a fallback, reload/reinitialize the config for the domain.
      console.warn(`currentScraperConfig domain (${currentScraperConfig ? currentScraperConfig.domain : 'N/A'}) does not match requested domain ${domain}. Re-fetching/initializing.`);
      chrome.storage.local.get('scraperConfigs', (result) => {
        const configs = result.scraperConfigs || [];
        const existingConfig = configs.find(c => c.domain === domain);
        if (existingConfig) {
          currentScraperConfig = { ...existingConfig };
        } else {
          currentScraperConfig = {
            domain: domain, selectors: [], headers: {}, categoryUrls: [], paginationMethod: 'none',
            paginationDetails: {}, detectedXhrPatterns: [], productContainersXpath: null,
            configName: `New Config for ${domain}`, id: null, createdAt: null, lastUpdated: null
          };
        }
        // Save this re-evaluated currentScraperConfig to storage as well
        chrome.storage.local.set({ currentScraperConfig: currentScraperConfig }, () => {
            chrome.tabs.sendMessage(tabId, {action: "startSetup", config: currentScraperConfig}, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`Error sending 'startSetup' to content script (after fallback) for tab ${tabId}:`, chrome.runtime.lastError.message);
                sendResponse({status: `Error initializing setup on page (fallback): ${chrome.runtime.lastError.message}`});
            } else {
                console.log("'startSetup' message sent to content script (after fallback), response:", response);
                sendResponse({status: "Setup initiated on page (fallback).", data: response});
            }
            });
        });
      });
    }
    return true; // Indicates asynchronous response
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

// Helper function to convert array of objects to CSV format
function convertArrayOfObjectsToCSV(dataArray) {
  if (!dataArray || dataArray.length === 0) {
    return '';
  }
  const columnDelimiter = ',';
  const lineDelimiter = '\n';
  const keys = Object.keys(dataArray[0]);

  let result = '';
  result += keys.join(columnDelimiter);
  result += lineDelimiter;

  dataArray.forEach(item => {
    let ctr = 0;
    keys.forEach(key => {
      if (ctr > 0) result += columnDelimiter;
      let value = item[key];
      if (typeof value === 'string') {
        // Escape double quotes by doubling them, and enclose in double quotes if it contains delimiter, newline or double quote
        if (value.includes('"') || value.includes(columnDelimiter) || value.includes(lineDelimiter)) {
          value = '"' + value.replace(/"/g, '""') + '"';
        }
      }
      result += value;
      ctr++;
    });
    result += lineDelimiter;
  });
  return result;
}

// Helper function to trigger CSV download
function triggerCSVDownload(csvString, baseFileName = 'export') {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-uFEFF;' }); // Adding BOM for Excel compatibility
  const url = URL.createObjectURL(blob);
  const filename = `crocido_local_scrape_${baseFileName.replace(/[^a-z0-9_]/gi, '_')}_${new Date().toISOString().slice(0,10)}.csv`;

  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true // Prompt user for save location
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error("Error starting download:", chrome.runtime.lastError.message);
    } else {
      console.log("CSV Download started with ID:", downloadId);
    }
    URL.revokeObjectURL(url); // Clean up object URL
  });
}

async function saveLocalDataToBackend(data, configId, apiKey) {
  const backendBaseUrl = "http://localhost:3000"; // Ensure this is consistent
  const endpoint = `${backendBaseUrl}/api/data/local-batch`;
  console.log(`[saveLocalDataToBackend] Sending ${data.length} items to ${endpoint} for configId ${configId}`);

  if (!apiKey) {
    console.error("[saveLocalDataToBackend] API Key not available. Cannot send data.");
    throw new Error("API Key not available for backend operation.");
  }
  if (!configId) {
    console.error("[saveLocalDataToBackend] Config ID not available. Cannot send data.");
    throw new Error("Config ID not available for backend operation.");
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ configId: configId, items: data })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[saveLocalDataToBackend] Backend error: ${response.status}`, errorBody);
      throw new Error(`Backend responded with ${response.status}: ${errorBody}`);
    }
    const result = await response.json();
    console.log("[saveLocalDataToBackend] Data saved to backend successfully:", result);
    return result;
  } catch (error) {
    console.error("[saveLocalDataToBackend] Error during fetch operation:", error);
    throw error; // Re-throw to be caught by caller
  }
}

// TODO: Add listeners for webRequest API to capture headers if specified in PRD for in-browser use
// chrome.webRequest.onBeforeSendHeaders.addListener(...); 