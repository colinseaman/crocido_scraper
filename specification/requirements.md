# Project Crocido Scraper - Requirements

## 1. Core Scraping Configuration (Extension Sidebar)

### 1.1. Configuration Management
- Users must be able to create, save, and load scraping configurations.
- Each configuration should be associated with a specific domain.
- Configurations should be stored locally in the browser and synced with a backend server.
- An API key must be used for authenticating with the backend server.

### 1.2. Domain-Specific Configuration
- When the extension sidebar is opened on a webpage, if a configuration already exists for that domain, it should be automatically loaded and set as the active configuration.
- If no configuration exists for the current domain, the user should be able to create a new one.

### 1.3. Product Container Selection
- Users must be able to define product containers by clicking on example elements on the page.
- The system should attempt to generalize an XPath for these containers.
- Users must be able to preview the detected containers based on the XPath.
- Users must be able to reset the container selection.

### 1.4. Data Field Definition (Relative to Container)
- Users must be able to define specific data fields to be scraped (e.g., Title, Price, ImageSrc, Description).
- Field selection must be done by clicking on the corresponding element *within* a product container.
- XPaths for these fields should be generated relative to the product container.
- The UI should not allow manual typing of XPaths for these predefined fields; selection must be by clicking.
- Users must be able to clear a selected XPath for a field.

### 1.5. Category URL Management
- Users must be able to manually input category URLs.
- The system should provide functionality to detect category URLs from sitemaps or page links (details to be refined).
- Detected URLs should be presented to the user for confirmation or addition.

### 1.6. Pagination Handling
- The UI must allow users to select the pagination method for a website.
- Options: "None", "Next Button", "Load More Button", "XHR/Infinite Scroll".
- Selection should be done via dedicated buttons for each method.
- If "Next Button" or "Load More Button" is selected, the user must be able to define the pagination element by clicking on it on the page.
- The UI should not require further clicks if "None" or "XHR/Infinite Scroll" is selected.
- For "XHR/Infinite Scroll", the system should attempt to detect XHR patterns.

### 1.7. UI/UX (Sidebar)
- No custom fields on the initial setup page (focus on predefined, essential fields).
- XPath input fields (for product container, data fields, pagination elements) should be populated by clicking elements on the page, not by manual typing for data fields.

## 2. Scraping Execution

### 2.1. Server-Side Scraping
- Users must be able to initiate scraping for the active configuration.
- The scraping process should be executed on a backend server.
- The backend server will use the saved configuration (including API key for its operations if necessary, though primarily for user auth to backend).
- Scraped data should be stored on the backend.

### 2.2. Local Scraping (New Requirement)
- The system must provide an option for local scraping, using the user's current browser instance.
- Scraped data from local scraping should be exportable as a CSV file directly to the user's machine.
- Optionally, data from local scraping should also be saveable to the backend server.

### 2.3. Data Export
- Users must be able to export scraped data (presumably from the backend) as a CSV file.

## 3. Error Handling and Feedback
- The system should provide clear feedback to the user regarding the status of operations (e.g., saving configuration, starting scrape, errors).
- Errors should be logged appropriately (console and/or UI).

## Non-Functional Requirements
- Ease of use: The configuration process should be intuitive.
- Robustness: XPath generation and element selection should be as reliable as possible.
- Performance: Scraping should be efficient. (Primarily a backend concern for server-side, but local scraping needs to be mindful of browser resources). 