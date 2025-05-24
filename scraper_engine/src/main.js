const puppeteer = require('puppeteer'); // Or playwright
const MAX_PAGINATION_CLICKS = 5; // Safety limit for development

async function launchBrowser() {
  console.log("[ScraperEngine] launchBrowser: Launching browser...");
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  });
  console.log("[ScraperEngine] launchBrowser: Browser launched.");
  return browser;
}

async function scrapePageContent(page, config) {
  let pageScrapedData = [];
  console.log(`[ScraperEngine] Scraping content from current page URL: ${page.url()}`);
  console.log(`[ScraperEngine] Using Product Container XPath: ${config.productContainersXpath || '(Whole Page)'}`);

  const productElementsHandles = config.productContainersXpath 
    ? await page.$x(config.productContainersXpath) 
    : [page]; // Treat the whole page as one container if no specific XPath

  console.log(`[ScraperEngine] Found ${productElementsHandles.length} product containers (or page as container).`);

  for (const productHandle of productElementsHandles) {
    let product = {};
    let isSinglePageContainer = !config.productContainersXpath;

    // For debugging: Get HTML of the current product handle or page
    // const productHtml = await page.evaluate(el => el.outerHTML || el.innerHTML, productHandle);
    // console.log(`[ScraperEngine] HTML of current context/container: ${productHtml.substring(0, 500)}...`);

    for (const selector of config.selectors) {
      try {
        let value = null;
        const contextNode = isSinglePageContainer ? page : productHandle;
        let effectiveXPath = selector.xpath;

        if (!isSinglePageContainer) { 
          if (selector.xpath.startsWith('id(')) {
            // No change to effectiveXPath needed here if it starts with id()
          } else if (selector.xpath.startsWith('//')) {
            effectiveXPath = '.' + selector.xpath;
          } else if (!selector.xpath.startsWith('.') && !selector.xpath.startsWith('(')) {
            effectiveXPath = './/' + selector.xpath;
          }
        }
        console.log(`[ScraperEngine] Processing selector: '${selector.name}', Original XPath: '${selector.xpath}', Effective XPath: '${effectiveXPath}'`);
        const elements = await contextNode.$x(effectiveXPath);
        console.log(`[ScraperEngine] Found ${elements.length} elements for '${selector.name}' with XPath '${effectiveXPath}'`);
        
        if (elements.length > 0) {
          const firstElement = elements[0];
          if (selector.xpath.includes('/@')) { // If XPath explicitly asks for an attribute
            value = await page.evaluate(el => el.nodeValue, firstElement);
          } else {
            // Check if this selector is for an image and try to get src, then textContent as fallback
            const tagName = await page.evaluate(el => el.tagName.toLowerCase(), firstElement);
            if (tagName === 'img') {
              value = await page.evaluate(el => el.getAttribute('src') || el.getAttribute('data-src'), firstElement);
              if (!value) { // Fallback for some lazy-loaded images or other attributes
                value = await page.evaluate(el => el.currentSrc || el.src, firstElement);
              }
              console.log(`[ScraperEngine] Attempted to get 'src' or 'data-src' for <img> for selector '${selector.name}'. Value: '${value}'`);
            }
            // If not an img or src wasn't found, get textContent (or if src was found but empty, this will overwrite, which is fine for now)
            if (value === null || value === undefined || value === '') { 
              value = await page.evaluate(el => el.textContent.trim(), firstElement);
            }
          }
          console.log(`[ScraperEngine] Extracted value for '${selector.name}': '${value}'`);
          await firstElement.dispose(); 
        }
        product[selector.name] = value;
      } catch (e) {
        console.warn(`[ScraperEngine] Error processing selector ${selector.name} (${selector.xpath}): ${e.message}`);
        product[selector.name] = null;
      }
    }
    // Mandatory fields check - ensure 'Link' is also there.
    if (!product.Title || !product.Price || !product.Link) { // Added !product.Link
      console.log("[ScraperEngine] Skipping product due to missing mandatory fields (Title, Price, or Link):", JSON.stringify(product));
    } else {
      pageScrapedData.push(product);
    }
    if (!isSinglePageContainer && productHandle.dispose) {
      await productHandle.dispose();
    }
  }
  return pageScrapedData;
}

async function scrapeCategory(browser, initialUrl, config) {
  let page; // Define page here to access in finally block
  let clickCount = 0; // Initialize clickCount here
  let allCategoryData = []; // Initialize here
  console.log(`[ScraperEngine] scrapeCategory: Starting for URL: ${initialUrl}`);
  try {
    page = await browser.newPage();
    console.log(`[ScraperEngine] scrapeCategory: New page created for ${initialUrl}`);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36');

    if (config.headers) {
      console.log("[ScraperEngine] Note: Header setting might require puppeteer-extra or Playwright.");
    }
    console.log(`[ScraperEngine] Navigating to initial category URL: ${initialUrl}`);
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`[ScraperEngine] Successfully navigated to: ${initialUrl}`);

    // Attempt to click the cookie consent button
    try {
      const cookieButtonSelector = '#onetrust-accept-btn-handler';
      console.log(`[ScraperEngine] Looking for cookie button: ${cookieButtonSelector}`);
      await page.waitForSelector(cookieButtonSelector, { visible: true, timeout: 10000 });
      await page.click(cookieButtonSelector);
      console.log("[ScraperEngine] Clicked cookie consent button (onetrust-accept-btn-handler).");
      await page.waitForTimeout(2000); // Wait for banner to disappear and page to settle
    } catch (e) {
      console.log("[ScraperEngine] Cookie consent button (onetrust-accept-btn-handler) not found or timed out. Continuing...");
    }

    // The main while loop for scraping and pagination
    while (clickCount < MAX_PAGINATION_CLICKS) {
      console.log(`[ScraperEngine] scrapeCategory: Start of pagination loop iteration ${clickCount + 1}`);
      const initialDataLength = allCategoryData.length;
      const newData = await scrapePageContent(page, config);
      
      if (config.paginationMethod === 'xhrInfinite' && allCategoryData.length > 0) {
         console.log(`[ScraperEngine] XHR scroll: Previously had ${initialDataLength}, scraped ${newData.length} this iteration.`);
      }
      allCategoryData = allCategoryData.concat(newData);
      if (allCategoryData.length > initialDataLength && config.selectors.some(s => s.name === 'Link')) {
          const uniqueLinks = new Set();
          allCategoryData = allCategoryData.filter(item => {
              if (!item.Link || !uniqueLinks.has(item.Link)) {
                  if(item.Link) uniqueLinks.add(item.Link);
                  return true;
              }
              return false;
          });
      }      
      console.log(`[ScraperEngine] Scraped items after potential deduplication. Total for category: ${allCategoryData.length}`);

      if ((config.paginationMethod === 'nextButton' || config.paginationMethod === 'loadMoreButton') && 
          config.paginationDetails && config.paginationDetails.selector) {
        
        const buttonSelector = config.paginationDetails.selector;
        console.log(`[ScraperEngine] Attempting to find and click pagination button: ${buttonSelector}`);
        
        const buttonElement = await page.$(buttonSelector);

        if (buttonElement) {
          const isVisible = await page.evaluate(el => el.offsetParent !== null, buttonElement);
          if (!isVisible) {
            console.log("[ScraperEngine] Pagination button found but not visible. Stopping pagination.");
            break;
          }
          try {
            await page.waitForTimeout(500);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => console.log('[ScraperEngine] Navigation timeout/no navigation after click, continuing...')),
                buttonElement.click()
            ]);
            console.log("[ScraperEngine] Clicked pagination button.");
            await buttonElement.dispose();
            clickCount++;
            await page.waitForTimeout(config.xhrInfiniteScrollDelay || 2000);
          } catch (clickError) {
            console.error(`[ScraperEngine] Error clicking pagination button (${buttonSelector}): ${clickError.message}. Stopping pagination.`);
            await buttonElement.dispose().catch(()=>{});
            break;
          }
        } else {
          console.log("[ScraperEngine] Pagination button not found. Stopping pagination for this category.");
          break;
        }
      } else if (config.paginationMethod === 'xhrInfinite') {
        console.log(`[ScraperEngine] Performing XHR/Infinite scroll (attempt ${clickCount + 1}/${MAX_PAGINATION_CLICKS})`);
        try {
          await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
          console.log("[ScraperEngine] Scrolled to bottom of page.");
          const scrollWaitTimeout = config.paginationDetails?.xhrInfiniteScrollDelay || 3000;
          let waitedForXHR = false;
          if (config.detectedXhrPatterns && config.detectedXhrPatterns.length > 0) {
            console.log(`[ScraperEngine] Attempting to wait for XHRs based on ${config.detectedXhrPatterns.length} detected patterns.`);
            const xhrPromises = config.detectedXhrPatterns.map(pattern => {
              return page.waitForResponse(
                response => response.url().includes(pattern.url) && response.ok(),
                { timeout: scrollWaitTimeout }
              ).then(response => {
                console.log(`[ScraperEngine] XHR detected matching pattern: ${pattern.url}, Status: ${response.status()}`);
                return true;
              }).catch(() => { return false; });
            });
            try {
              const results = await Promise.allSettled(xhrPromises);
              if (results.some(r => r.status === 'fulfilled' && r.value === true)) {
                console.log("[ScraperEngine] At least one detected XHR pattern matched and completed.");
                waitedForXHR = true;
              } else {
                console.log("[ScraperEngine] No detected XHR patterns matched within timeout. Falling back to fixed delay.");
              }
            } catch (e) {
              console.warn("[ScraperEngine] Error during XHR checks. Falling back to fixed delay.", e.message);
            }
          }
          if (!waitedForXHR) {
            console.log(`[ScraperEngine] Waiting for fixed ${scrollWaitTimeout}ms for content to load after scroll...`);
            await page.waitForTimeout(scrollWaitTimeout);
          }
          clickCount++;
        } catch (scrollError) {
          console.error(`[ScraperEngine] Error during programmatic scroll or XHR wait: ${scrollError.message}. Stopping pagination.`);
          break;
        }
        if (clickCount >= MAX_PAGINATION_CLICKS) {
            console.log("[ScraperEngine] Reached max XHR scroll attempts.");
            break;
        }
      } else {
        console.log("[ScraperEngine] No further pagination configured. Ending scrape for this category.");
        break;
      }
      console.log(`[ScraperEngine] scrapeCategory: End of pagination loop iteration ${clickCount}`);
    }
  } catch (error) {
      console.error(`[ScraperEngine] Error during scraping category ${initialUrl}: ${error.message}`, error.stack);
  } finally {
    console.log(`[ScraperEngine] scrapeCategory: Entering finally block for ${initialUrl}`);
    if (page && !page.isClosed()) {
      try {
        console.log(`[ScraperEngine] scrapeCategory: Attempting to close page for ${initialUrl}`);
        await page.close();
        console.log(`[ScraperEngine] scrapeCategory: Successfully closed page for ${initialUrl}`);
      } catch (closeError) {
        console.error(`[ScraperEngine] scrapeCategory: Error closing page for ${initialUrl}: ${closeError.message}`);
      }
    } else {
      console.log(`[ScraperEngine] scrapeCategory: Page for ${initialUrl} was already closed or not initialized.`);
    }
  }
  
  if (clickCount >= MAX_PAGINATION_CLICKS) {
    console.warn(`[ScraperEngine] Reached max pagination clicks (${MAX_PAGINATION_CLICKS}) for ${initialUrl}.`);
  }
  return allCategoryData;
}

async function start(config) {
  if (!config || !config.categoryUrls || config.categoryUrls.length === 0) {
    console.error("Scraper start failed: No category URLs provided in config.");
    return { error: "No category URLs" };
  }

  const browser = await launchBrowser();
  let allScrapedData = [];

  for (const categoryUrl of config.categoryUrls) {
    console.log(`Starting scrape for category: ${categoryUrl}`);
    try {
      const categoryData = await scrapeCategory(browser, categoryUrl, config);
      allScrapedData = allScrapedData.concat(categoryData);
      console.log(`Finished category ${categoryUrl}, scraped ${categoryData.length} items. Total overall: ${allScrapedData.length}`);
      // TODO: Save data to Postgres progressively
    } catch (error) {
      console.error(`Error scraping category ${categoryUrl}: ${error.message}`);
    }
  }

  await browser.close();
  console.log(`Total items scraped from all categories: ${allScrapedData.length}`);
  return { data: allScrapedData, count: allScrapedData.length };
}

module.exports = {
  start,
};

// Example Usage (for testing directly):
/*
async function testScrape() {
  const mockConfig = {
    categoryUrls: ['https://www.example.com/products'], // Replace with a real test URL
    selectors: [
      { name: 'Title', xpath: "//h1[@class='product-title']" }, // Adjust XPaths
      { name: 'Price', xpath: "//span[@class='price']" },
      { name: 'Link', xpath: "//a[@class='product-link']/@href" } // Example for href
    ],
    productContainersXpath: "//div[@class='product-item']", // Adjust if needed
    // headers: { 'User-Agent': 'MyScraperBot/1.0' }
  };
  const result = await start(mockConfig);
  console.log("Test scrape result:", JSON.stringify(result, null, 2));
}

testScrape();
*/ 