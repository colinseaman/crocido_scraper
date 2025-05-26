document.addEventListener('DOMContentLoaded', () => {
  const startSetupBtn = document.getElementById('startSetup');
  const exportCsvBtn = document.getElementById('exportCsv');
  const scrapeAllBtn = document.getElementById('scrapeAll');
  const localScrapeBtn = document.getElementById('localScrape');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
  const statusMessageElement = document.getElementById('statusMessage');

  // Inform background script when popup opens and get active config status
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (tabs && tabs.length > 0 && tabs[0].id != null) {
      const currentTab = tabs[0];
      let domain = null;
      try {
        const url = new URL(currentTab.url);
        domain = url.hostname;
      } catch (e) {
        console.error("Error parsing URL for domain:", e);
        if (statusMessageElement) statusMessageElement.textContent = "Error: Could not parse current URL.";
        // Disable buttons if domain can't be parsed?
        startSetupBtn.disabled = true;
        scrapeAllBtn.disabled = true;
        exportCsvBtn.disabled = true;
        return;
      }

      chrome.runtime.sendMessage({action: "popupOpened", domain: domain, tabId: currentTab.id}, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending popupOpened message or receiving response:", chrome.runtime.lastError.message);
          if (statusMessageElement) statusMessageElement.textContent = "Error communicating with background.";
          return;
        }
        if (response) {
          console.log("Response from background for popupOpened:", response);
          if (statusMessageElement) statusMessageElement.textContent = response.statusMessage || "Ready.";
          if (response.configLoaded) {
            if (startSetupBtn) startSetupBtn.textContent = "Edit Setup";
          } else {
            if (startSetupBtn) startSetupBtn.textContent = "Start Setup";
          }
          // Update API key input if it was part of the response, though current logic loads it separately
          if (response.apiKey && apiKeyInput) {
            apiKeyInput.value = response.apiKey;
          }
        }
      });
    } else {
      console.error("Could not get active tab to inform background script.");
      if (statusMessageElement) statusMessageElement.textContent = "Error: No active tab found.";
      startSetupBtn.disabled = true;
      scrapeAllBtn.disabled = true;
      exportCsvBtn.disabled = true;
    }
  });

  // Load saved API key on popup open
  if (apiKeyInput) {
    chrome.storage.local.get('apiKey', (result) => {
      if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
      }
    });
  }

  if (startSetupBtn) {
    startSetupBtn.addEventListener('click', () => {
      console.log("'Start/Edit Setup' button clicked.");
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id != null) {
          const tabId = tabs[0].id;
          let domain = null;
          try {
            const url = new URL(tabs[0].url);
            domain = url.hostname;
          } catch (e) {
            console.error("Error parsing URL for domain in startSetupBtn:", e);
            if (statusMessageElement) statusMessageElement.textContent = "Error: Cannot determine domain.";
            return;
          }
          // Send message to background script to orchestrate setup
          chrome.runtime.sendMessage({action: "initiateSetupForTab", tabId: tabId, domain: domain}, (response) => {
            if (chrome.runtime.lastError) {
              console.error(`Error sending 'initiateSetupForTab' message:`, chrome.runtime.lastError.message);
              if (statusMessageElement) statusMessageElement.textContent = "Error starting setup.";
            } else {
              console.log(`Response from background for 'initiateSetupForTab':`, response ? response.status : "No response");
              if (statusMessageElement && response) statusMessageElement.textContent = response.status;
            }
            window.close(); // Close popup
          });
        } else {
          console.error("Could not get active tab ID for 'initiateSetupForTab'.");
          if (statusMessageElement) statusMessageElement.textContent = "Error: No active tab.";
        }
      });
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({action: "exportCsv"}, (response) => {
        console.log(response.status);
        // Handle response, e.g., feedback to user
      });
    });
  }

  if (scrapeAllBtn) {
    scrapeAllBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({action: "scrapeAll"}, (response) => {
        console.log(response.status);
        // Handle response
      });
    });
  }

  if (localScrapeBtn) {
    localScrapeBtn.addEventListener('click', () => {
      console.log("'Local Scrape' button clicked.");
      const saveToServerCheckbox = document.getElementById('saveLocalToServer');
      const shouldSaveToServer = saveToServerCheckbox ? saveToServerCheckbox.checked : false;
      console.log("Save to server preference:", shouldSaveToServer);

      // It's assumed that popupOpened has already set the correct currentScraperConfig for the active domain
      chrome.runtime.sendMessage({action: "startLocalScrape", saveToServer: shouldSaveToServer}, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending 'startLocalScrape' message:", chrome.runtime.lastError.message);
          if (statusMessageElement) statusMessageElement.textContent = "Error starting local scrape.";
          // alert("Error starting local scrape: " + chrome.runtime.lastError.message);
        } else {
          console.log("Response from background for 'startLocalScrape':", response);
          if (statusMessageElement && response) statusMessageElement.textContent = response.statusMessage || "Local scraping initiated...";
          // alert(response.statusMessage || "Local scraping process initiated.");
        }
        // Optionally close popup or keep it open for status updates
        // window.close(); 
      });
    });
  }

  if (saveApiKeyBtn && apiKeyInput) {
    saveApiKeyBtn.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        chrome.storage.local.set({apiKey: apiKey}, () => {
          console.log('API Key saved.');
          alert('API Key saved!'); // Simple feedback
        });
      } else {
        alert('Please enter an API Key.');
      }
    });
  }
}); 