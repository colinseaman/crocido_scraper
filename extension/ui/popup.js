document.addEventListener('DOMContentLoaded', () => {
  const startSetupBtn = document.getElementById('startSetup');
  const exportCsvBtn = document.getElementById('exportCsv');
  const scrapeAllBtn = document.getElementById('scrapeAll');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');

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
      console.log("Start Setup button clicked."); // Log button click
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id != null) { // Check id is not null or undefined
          const tabId = tabs[0].id;
          console.log(`Attempting to send 'startSetup' to tab ID: ${tabId}`);
          chrome.tabs.sendMessage(tabId, {action: "startSetup"}, (response) => {
            if (chrome.runtime.lastError) {
              console.error(`Error sending 'startSetup' message to tab ${tabId}:`, chrome.runtime.lastError.message);
              // alert(`Error starting setup: ${chrome.runtime.lastError.message}`); // Optional: for more visible error
            } else {
              console.log(`Response from content script for 'startSetup' (tab ${tabId}):`, response ? response.status : "No response or no status field");
            }
            // It's common to close the popup even if there's an error or no response,
            // but for debugging, you might temporarily comment this out.
            window.close(); // Close popup after initiating
          });
        } else {
          console.error("Could not get active tab ID to send 'startSetup' message.");
          // alert("Error: Could not identify active tab to start setup."); // Optional
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