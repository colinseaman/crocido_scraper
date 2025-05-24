# Crocido Scraper

Visual Ecommerce Scraper Tool (Chrome Extension)

This project is a Chrome extension that allows users to visually select data points on e-commerce websites and scrape product information. It includes a backend for storing configurations and scraped data, and a scraper engine for performing the scraping tasks.

## Features

- Visual Selector Tool
- Product Container Detection
- Pagination & Infinite Scroll Detection (Button-based and XHR-based)
- Sitewide Category Detection (Sitemap & Page Links)
- Config Saving to PostgreSQL Database
- Scraped Data Saving to PostgreSQL Database
- API Key based (conceptual) authentication for backend
- CSV Export of Scraped Data

## Project Structure

- `/extension`: Chrome extension (frontend, content scripts, background scripts)
- `/backend`: Node.js API and database (PostgreSQL)
  - `/backend/config`: Configuration files for server and database.
  - `/backend/src`: Source code for the backend server.
  - `/backend/db`: Database connection logic.
- `/scraper_engine`: Headless browser scraping logic (Puppeteer)
- `/specification`: Project requirements and to-do lists.

## Setup and Usage

### 1. Prerequisites

- **Node.js and npm (or yarn)**: Ensure you have a recent version of Node.js installed. (e.g., v16+).
- **PostgreSQL**: A running PostgreSQL server instance.
- **Google Chrome**: For using the extension.

### 2. Database Setup

1.  **Create a PostgreSQL Database**:
    *   Connect to your PostgreSQL server (e.g., using `psql` or a GUI tool like pgAdmin).
    *   Create a new database. For example:
        ```sql
        CREATE DATABASE crocido_scraper_db;
        ```
2.  **Create Tables**: Run the following SQL statements against your newly created database to set up the required tables.

    #### `users` table (Conceptual - for API Key context)

    This table is for context on how API keys might be managed. For the current version, the API key validation in the backend uses a placeholder.

    ```sql
    -- Run this if you want to align with the conceptual API key validation structure
    -- For initial testing, you can skip creating this table and the backend will use a placeholder key.
    CREATE TABLE users (
         id VARCHAR(255) PRIMARY KEY,         -- e.g., a UUID or a unique username
         email VARCHAR(255) UNIQUE,
         api_key VARCHAR(255) UNIQUE NOT NULL,
         created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    -- -- Example insert if you create the table and want to use a specific key:
    INSERT INTO users (id, api_key) VALUES ('kylepage', 'api-key-123');
    ```

    #### `scraper_configs` table

    Stores the scraper configurations created by users.

    ```sql
    CREATE TABLE scraper_configs (
        id VARCHAR(255) PRIMARY KEY,                   -- Unique ID for the config (e.g., "config_" + timestamp)
        user_id VARCHAR(255) NOT NULL,                 -- User ID (matches placeholder for now)
        config_name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        selectors_json JSONB,
        product_container_xpath TEXT,
        pagination_method VARCHAR(50),
        pagination_details_json JSONB,
        detected_xhr_patterns_json JSONB,
        category_urls_json JSONB,
        headers_json JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, domain, config_name)
    );

    CREATE INDEX idx_scraper_configs_user_id ON scraper_configs(user_id);
    CREATE INDEX idx_scraper_configs_domain ON scraper_configs(domain);
    ```

    #### `scraped_products` table

    Stores the actual product data scraped by the scraper engine.

    ```sql
    CREATE TABLE scraped_products (
        id SERIAL PRIMARY KEY,
        config_id VARCHAR(255) NOT NULL REFERENCES scraper_configs(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL,
        scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        title TEXT,
        price VARCHAR(100),
        product_link TEXT UNIQUE,
        image_url TEXT,
        description TEXT,
        custom_fields JSONB,
        raw_data_snapshot JSONB
    );

    CREATE INDEX idx_scraped_products_config_id ON scraped_products(config_id);
    CREATE INDEX idx_scraped_products_user_id ON scraped_products(user_id);
    CREATE INDEX idx_scraped_products_product_link ON scraped_products(product_link);
    CREATE INDEX idx_scraped_products_scraped_at ON scraped_products(scraped_at);
    ```

### 3. Backend Configuration

1.  **Database Connection**: Edit `backend/config/db.config.js`.
    *   Update `user`, `host`, `database`, `password`, and `port` to match your PostgreSQL setup.
    *   Alternatively, you can set these as environment variables (e.g., `DB_USER`, `DB_HOST`, etc.).
        ```javascript
        // backend/config/db.config.js example
        module.exports = {
          user: 'your_postgres_user',       // Replace
          host: 'localhost',
          database: 'crocido_scraper_db', // Replace if you used a different name
          password: 'your_postgres_password', // Replace
          port: 5432,
        };
        ```
2.  **Server Port (Optional)**: Edit `backend/config/server.config.js` if you want to change the default port (3000).
3.  **API Key and User ID Placeholders**: For initial testing, the application uses placeholder values:
    *   **API Key**: The backend (`backend/src/api/routes.js` in `validateApiKey`) expects `valid-api-key-placeholder`.
    *   **User ID**: The background script (`extension/js/background_scripts/main.js` in `saveConfigToBackend` and `scrapeAll`) and the backend route (`backend/src/api/routes.js` in `validateApiKey`) use `tempUserId123` when making/validating requests.
    *   You will need to use this API key in the extension popup.

### 4. Install Dependencies

Navigate to the project root directory in your terminal and run:

```sh
npm install
# or if you use yarn
# yarn install
```

### 5. Running the Application

1.  **Start the Backend Server**:
    ```sh
    npm run start:backend
    ```
    You should see messages indicating the server is listening (default on port 3000) and successfully connected to PostgreSQL.

2.  **Load the Chrome Extension**:
    *   Open Google Chrome.
    *   Navigate to `chrome://extensions`.
    *   Enable "Developer mode" (usually a toggle in the top right).
    *   Click "Load unpacked".
    *   Select the `extension` directory from this project.
    *   The Crocido Scraper extension icon should appear in your Chrome toolbar.

### 6. Basic Usage Workflow

1.  **Set API Key**: Click the Crocido Scraper icon in your Chrome toolbar to open the popup.
    *   In the "API Key" input field, enter ``.
    *   Click "Save API Key".
2.  **Navigate to Target Site**: Open a new tab and go to an e-commerce product listing page you want to scrape (e.g., a category page).
3.  **Start Setup Mode**: Click the Crocido Scraper icon again, then click "Start Setup". The popup will close, and a sidebar will appear on the webpage.
4.  **Configure Scraper in Sidebar**:
    *   **Select Fields**: Click on individual data elements on the page (like product title, price, image URL, product link). They will appear in the sidebar. Name them appropriately (e.g., `Title`, `Price`, `Link`, `Image`). **Mandatory fields for the scraper engine to consider a product valid are `Title`, `Price`, and `Link`** (case-sensitive as you name them).
    *   **Product Container (Optional but Recommended for Lists)**: Click "Select Product Containers". Then click on at least two elements on the page that represent individual product containers/cards. A common XPath for these containers will be detected. You can edit this XPath or click "Confirm Container XPath". Preview with "Preview Containers".
    *   **Pagination & Scrolling**: Choose the pagination method used by the site (`'Next' Button/Link`, `'Load More' Button`, `Infinite Scroll (XHR Monitoring)`, or `None`).
        *   If button-based, provide the CSS selector for the button.
        *   If XHR, you can adjust the scroll delay. The extension will try to monitor XHRs as you scroll during setup if this option is active.
    *   **Category URLs**: Add category URLs manually (one per line) or try "Detect Categories (Sitemap)" or "Detect Categories (Page Links)". Select the desired URLs from the detected list.
5.  **Save Configuration**: Click "Save Configuration" in the sidebar. This saves the configuration to your local Chrome storage and also sends it to the backend to be saved in the database.
6.  **Close Setup (Optional)**: Click "Close Setup" in the sidebar to hide it.
7.  **Start Scraping**: Click the Crocido Scraper icon in the toolbar, then click "Scrape All".
    *   This sends a request to your backend, which then uses the saved configuration for the current domain to start the Puppeteer scraper engine.
    *   Check your backend console logs for scraping progress.valid-api-key-placeholder
8.  **Export Scraped Data**: After the scraper has run (allow some time), click the Crocido Scraper icon, then "Export CSV".
    *   This will fetch the scraped data from the backend for the current site's configuration and trigger a CSV file download.

## Troubleshooting & Notes

*   **Console Logs**: Check the Chrome DevTools console for the extension (inspect popup, background script via `chrome://extensions`) AND the terminal console where your backend server is running for logs and errors.
*   **Database**: Use a PostgreSQL GUI or `psql` to inspect the `scraper_configs` and `scraped_products` tables to verify data is being saved correctly.
*   **Puppeteer**: The first time Puppeteer runs (via the backend), it might download a compatible browser binary, which can take a few moments.
*   **Placeholders**: Remember the placeholder API key and User ID. For a real application, these would be managed securely.

## Contributing

Please read `CONTRIBUTING.md` for details on our code of conduct, and the process for submitting pull requests to us.

## License

This project is licensed under the ISC License - see the `LICENSE` file for details. 