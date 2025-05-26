# Project Crocido Scraper - To-Do List

## Phase 1: Existing UI/Logic Refinements (Mostly Done)

- [x] **Custom Fields**: Remove custom field UI and logic from the setup sidebar (`selector_tool.js`).
- [x] **Pagination UI**: Change pagination method selection from radio buttons to actual clickable buttons (`selector_tool.js`).
    - [x] Ensure "None" and "XHR/Infinite Scroll" options do not require further element selection.
    - [x] Ensure "Next Button" and "Load More Button" prompt user to select the element on page.
- [x] **XPath Input for Fields**: Remove the text input field for predefined field XPaths (Title, Price, etc.). Rely on button states ("Select"/"Update"/"Clear") for feedback (`selector_tool.js`).
- [x] **Error Handling**: Fix `stopXhrDetection is not defined` error in `destroySetupUI` (`selector_tool.js`).

## Phase 2: Core Logic for Configuration and Scraping Flow

### 2.1. Configuration Loading and Domain Matching (Addressing current issue)
- **[HIGH PRIORITY]** **Problem**: "No active config ID found to scrape" when a config for the domain should exist.
- **Tasks**:
    - [x] **`main.js` (`onInstalled`):** Review and ensure `currentScraperConfig` is correctly loaded from storage if a valid one (with an ID) exists. (New flow with `popupOpened` handles active domain context).
    - [x] **`main.js` (Popup Interaction/Opening Sidebar):** When the popup is opened or the sidebar is activated:
        - [x] Get the current tab's domain.
        - [x] Query `chrome.storage.local` for `scraperConfigs`.
        - [x] Find if a configuration exists in `scraperConfigs` that matches the current domain.
        - [x] If a match is found:
            - [x] Set this matched configuration as the `currentScraperConfig` in `chrome.storage.local`.
            - [x] Update the in-memory `currentScraperConfig` variable in `main.js`.
            - [x] Send this configuration to `selector_tool.js` to be loaded into the UI.
        - [x] If no match is found:
            - [x] The `selector_tool.js` should open with a blank/default setup for the current domain.
            - [x] `currentScraperConfig` in storage should reflect this new, unsaved configuration state.
    - [x] **`main.js` (`scrapeAll` action):**
        - [x] Ensure it *always* uses `currentScraperConfig` from `chrome.storage.local` which should have been correctly set by the popup/sidebar activation logic above.
        - [x] The check `if (!currentConfig || !currentConfig.id)` should then correctly prevent scraping if no config is truly active or properly set for the current context.

### 2.2. Local Scraping Implementation
- **Tasks**:
    - [x] **UI (Popup/Sidebar):** Add a button/option to trigger "Local Scraping".
    - [x] **`main.js` (Background Script):**
        - [x] Create a new message handler for `startLocalScrape`.
        - [x] Retrieve `currentScraperConfig` (for the active tab/domain).
        - [x] Send this config to `selector_tool.js`.
    - [x] **`selector_tool.js` (`executeLocalScrape` handler):
        - [x] Implement the scraping logic directly within the content script using the provided config.
            - [x] Iterate through product containers, extract data fields, and handle basic pagination (Next Button, Load More Button with fixed delay).
        - [x] Collect all scraped data in an array of objects.
    - [x] **Data Handling (Local Scraping):**
        - [x] **CSV Export:**
            - [x] Once local scraping is complete, provide the collected data to `main.js`.
            - [x] In `main.js`, convert the array of objects to CSV format.
            - [x] Use `chrome.downloads.download()` to trigger a CSV file download for the user.
        - [x] **Save to Server (Optional):** (Frontend/Extension part completed)
            - [x] Add a UI option (e.g., a checkbox or a separate button) "Save local scrape to server".
            - [x] If selected, after local scraping, send the scraped data along with the API key and relevant config ID to a new backend endpoint for storage.
            - [ ] Backend: Create a new endpoint `/api/data/local-batch` to receive and store this data, associating it with the user and config ID. (Backend implementation pending by user)

## Phase 3: Backend Adjustments (If necessary for local scraping save)

- [ ] **Backend API (`scraperService.js`, `routes.js`):** (Guidance provided, implementation pending by user)
    - [ ] If implementing "Save local scrape to server", create the new endpoint (`POST /api/data/local-batch`) to accept an array of scraped items and a `configId`.
    - [ ] Ensure proper validation and association with the `userId` (derived from API key).
    - [ ] Store the data appropriately (likely in the same table as server-scraped items, or a similar one).
- [ ] **Scraper Engine Stability**: Investigate and fix Puppeteer "Target closed" errors occurring during server-side scraping (see `backend/server.log` for details, e.g., error in `scraper_engine/src/main.js`).

## Future Considerations / Nice-to-haves

- [ ] More sophisticated UI for managing multiple saved configurations (e.g., a list in the popup to select, edit, delete configs).
- [ ] Visual feedback during local scraping (e.g., progress indicator).
- [ ] Advanced error handling and reporting for local scraping.
- [ ] UI for viewing/managing scraped data directly in the extension (before export/save).
- [ ] UI for configuring pagination parameters (max pages/clicks, delay) in `selector_tool.js`.
- [ ] More robust "wait for content" mechanism for local pagination (e.g., `MutationObserver`).
- [ ] Implement "XHR/Infinite Scroll" for local scraping. 