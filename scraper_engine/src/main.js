const puppeteer = require('puppeteer'); // Or playwright
const MAX_PAGINATION_CLICKS = 5; // Safety limit for development

async function launchBrowser() {
  console.log("[ScraperEngine] launchBrowser: Launching browser...");
  const browser = await puppeteer.launch({
    headless: 'new',
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

async function extractFieldData(page, contextNode, selectorConfig) {
  let extractedValue = null;
  const { xpath, fieldType, name: selectorName } = selectorConfig;

  if (!xpath || xpath.trim() === '') {
    console.warn(`[ScraperEngine] XPath for selector '${selectorName}' is empty. Skipping extraction.`);
    return null;
  }

  try {
    const elements = await contextNode.$x(xpath);
    if (elements.length > 0) {
      const element = elements[0]; // Use the first matched element

      if (fieldType === 'ImageSrc' || selectorName === 'ImageSrc') {
        extractedValue = await page.evaluate(el => el.src || el.getAttribute('data-src') || el.currentSrc, element);
        if (extractedValue && typeof extractedValue === 'string' && !extractedValue.startsWith('http')) {
            try {
                extractedValue = new URL(extractedValue, page.url()).href;
            } catch (e) {
                console.warn(`[ScraperEngine] Could not construct absolute URL for ImageSrc: ${extractedValue}`);
            }
        }
      } else if (fieldType === 'Link' || selectorName === 'Link') {
        extractedValue = await page.evaluate(el => el.href, element);
        if (extractedValue && typeof extractedValue === 'string' && !extractedValue.startsWith('http')) {
            try {
                extractedValue = new URL(extractedValue, page.url()).href;
            } catch (e) {
                console.warn(`[ScraperEngine] Could not construct absolute URL for Link: ${extractedValue}`);
            }
        }
      } else if (xpath.includes('/@')) { // If XPath explicitly asks for an attribute
            extractedValue = await page.evaluate(el => el.nodeValue, element);
      }else {
        extractedValue = await page.evaluate(el => el.textContent, element);
      }

      if (extractedValue && typeof extractedValue === 'string') {
        extractedValue = extractedValue.trim();
      }
      console.log(`[ScraperEngine] Extracted value for '${selectorName}': '${extractedValue}'`);
      await element.dispose();
    } else {
      console.log(`[ScraperEngine] No elements found for '${selectorName}' with XPath '${xpath}'`);
    }
  } catch (e) {
    console.warn(`[ScraperEngine] Error processing selector ${selectorName} (${xpath}): ${e.message}`);
  }
  return extractedValue;
}

async function scrapePageContent(page, config) {
  let pageScrapedData = [];
  console.log(`[ScraperEngine] Scraping content from current page URL: ${page.url()}`);
  console.log(`[ScraperEngine] Using Product Container XPath: ${config.productContainersXpath || '(Whole Page)'}`);

  try {
    await page.screenshot({ path: 'debug_before_xpath_wait.png' });
    console.log("[ScraperEngine] Screenshot taken: debug_before_xpath_wait.png");
  } catch (screenShotError) {
    console.error("[ScraperEngine] Error taking screenshot before XPath wait: ", screenShotError.message);
  }

  if (config.productContainersXpath) {
    try {
      console.log(`[ScraperEngine] Waiting for product containers to appear with XPath: ${config.productContainersXpath}`);
      await page.waitForXPath(config.productContainersXpath, { timeout: 30000 });
      console.log("[ScraperEngine] Product containers found or timeout reached.");
    } catch (e) {
      console.warn(`[ScraperEngine] Timeout or error waiting for product containers XPath: ${config.productContainersXpath} - ${e.message}`);
      // Continue anyway, maybe some are there or it's a false negative for waitForXPath
    }
  }

  const productElementsHandles = config.productContainersXpath
    ? await page.$x(config.productContainersXpath)
    : [page]; // Treat the whole page as one container

  console.log(`[ScraperEngine] Found ${productElementsHandles.length} product containers (or page as container).`);

  for (const productHandle of productElementsHandles) {
    let item = {};
    const isSinglePageContainer = !config.productContainersXpath;
    const contextNode = isSinglePageContainer ? page : productHandle;

    for (const selector of config.selectors) {
      let effectiveXPath = selector.xpath;
      if (selector.xpath && selector.xpath.trim() !== '') { // Only modify if xpath is not empty
        if (!isSinglePageContainer && !selector.xpath.startsWith('.') && !selector.xpath.startsWith('id(') && !selector.xpath.startsWith('(')) {
          effectiveXPath = '.' + (selector.xpath.startsWith('/') ? selector.xpath : '//' + selector.xpath);
        }
      } else {
        effectiveXPath = ''; // Ensure it's truly empty if original was empty
      }
      console.log(`[ScraperEngine] Processing selector: '${selector.name}', Original XPath: '${selector.xpath}', Effective XPath: '${effectiveXPath}'`);
      item[selector.name] = await extractFieldData(page, contextNode, { ...selector, xpath: effectiveXPath });
    }

    // Mandatory fields check
    if (item.Title && item.Price && item.Link) {
      pageScrapedData.push(item);
    } else {
      console.log(`[ScraperEngine] Skipping product due to missing mandatory fields (Title, Price, or Link): ${JSON.stringify(item)}`);
    }

    if (!isSinglePageContainer && productHandle.dispose) {
      await productHandle.dispose();
    }
  }
  return pageScrapedData;
}

async function scrapeCategory(browser, initialUrl, config) {
  let page;
  let clickCount = 0;
  let allCategoryData = [];
  console.log(`[ScraperEngine] scrapeCategory: Starting for URL: ${initialUrl}`);
  try {
    page = await browser.newPage();
    console.log(`[ScraperEngine] scrapeCategory: New page created for ${initialUrl}`);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36');

    if (config.headers) {
      console.log("[ScraperEngine] Note: Header setting might require puppeteer-extra or Playwright.");
      // If you were to set headers: await page.setExtraHTTPHeaders(config.headers);
    }
    console.log(`[ScraperEngine] Navigating to initial category URL: ${initialUrl}`);
    await page.goto(initialUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log(`[ScraperEngine] Successfully navigated to: ${initialUrl}`);

    const cookieBannerSelector = '#onetrust-banner-sdk';
    try {
      console.log("[ScraperEngine] Attempting to find and click cookie consent button by prioritized text content...");
      const clickResult = await page.evaluate(() => {
        const orderedKeywords = [
          "Accept All Cookies", "Accept all cookies", "Continue and accept", "Continue & accept",
          "Allow All Cookies", "Allow all cookies", "Accept All", "Accept all", "Allow All", "Allow all",
          "Agree to All", "Agree To All", "Agree and Continue", "Yes, I Accept", "Yes, I Agree",
          "I Accept", "I Agree", "Accept & Continue", "Continue & Accept", "Proceed and Agree",
          "Agree and Proceed", "OK and Continue", "Continue and OK", "Accept", "Agree", "OK",
          "Okay", "Continue", "Proceed", "Understood", "Got it", "Alle akzeptieren", "Akzeptieren",
          "Tout accepter", "Accepter", "Aceptar todo", "Aceptar"
        ];
        const elementSelectors = ['button', 'a', '[role="button"]'];
        for (const keyword of orderedKeywords) {
          for (const sel of elementSelectors) {
            const elements = Array.from(document.querySelectorAll(sel));
            for (const el of elements) {
              if (!el) continue;
              const textContent = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
              if (textContent.toLowerCase().includes(keyword.toLowerCase())) {
                const lowerText = textContent.toLowerCase();
                if (keyword.length <= 8 && ["accept", "agree", "ok", "okay", "continue", "proceed"].includes(keyword.toLowerCase())) {
                  if (lowerText.includes("setting") || lowerText.includes("preference") ||
                      lowerText.includes("manage") || lowerText.includes("choose") ||
                      lowerText.includes("select") || lowerText.includes("customise") ||
                      lowerText.includes("more info") || lowerText.includes("learn more")) {
                     const isMoreSpecificAccept = orderedKeywords.slice(0, 15).some(specificKw => lowerText.includes(specificKw.toLowerCase()));
                     if (!isMoreSpecificAccept) {
                        console.log(`Puppeteer Evaluate: Skipping element with text "${textContent}" (matched general keyword "${keyword}") due to preference-like words.`);
                        continue;
                     }
                  }
                }
                const isVisible = el.offsetParent !== null;
                const isDisabled = el.disabled || el.getAttribute('aria-disabled') === 'true';
                if (isVisible && !isDisabled) {
                  el.click();
                  console.log(`Puppeteer Evaluate: Clicked element with text: "${textContent}" matching keyword: "${keyword}"`);
                  return { clicked: true, text: textContent, keywordMatch: keyword };
                }
              }
            }
          }
        }
        return { clicked: false, text: null, keywordMatch: null };
      });

      if (clickResult.clicked) {
        console.log(`[ScraperEngine] Clicked cookie button with text: ${clickResult.text} (matched keyword: ${clickResult.keywordMatch})`);
        await page.waitForTimeout(3500);
      } else {
        console.warn("[ScraperEngine] No cookie consent button found or clicked via prioritized text content search.");
        await page.screenshot({ path: 'debug_cookie_consent_error.png' });
      }

      const bannerElement = await page.$(cookieBannerSelector);
      if (bannerElement) {
        const bannerIsVisible = await page.evaluate(sel => {
          const elem = document.querySelector(sel);
          if (!elem) return false;
          const style = window.getComputedStyle(elem);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && elem.offsetHeight > 0;
        }, cookieBannerSelector);
        if (bannerIsVisible) {
            console.warn(`[ScraperEngine] Cookie banner (${cookieBannerSelector}) appears to STILL BE VISIBLE.`);
            await page.screenshot({ path: 'debug_cookie_banner_still_visible.png' });
        } else {
            console.log(`[ScraperEngine] Cookie banner (${cookieBannerSelector}) no longer visible or was never found.`);
        }
      } else {
        console.log(`[ScraperEngine] Cookie banner (${cookieBannerSelector}) not found by selector.`);
      }
    } catch (e) {
      console.warn(`[ScraperEngine] Error during cookie consent: ${e.message}. Continuing...`);
      await page.screenshot({ path: 'debug_cookie_consent_exception.png' });
    }

    while (clickCount < MAX_PAGINATION_CLICKS) {
      console.log(`[ScraperEngine] scrapeCategory: Pagination loop iteration ${clickCount + 1}`);
      const initialDataLength = allCategoryData.length;
      const newData = await scrapePageContent(page, config);
      allCategoryData = allCategoryData.concat(newData);

      // Basic deduplication based on Link if available
      if (config.selectors.some(s => s.name === 'Link')) {
          const uniqueLinks = new Set();
          allCategoryData = allCategoryData.filter(item => {
              if (item.Link && !uniqueLinks.has(item.Link)) {
                  uniqueLinks.add(item.Link);
                  return true;
              } else if (!item.Link) { // Keep items without a link if Link selector wasn't successful
                  return true;
              }
              return false;
          });
      }
      console.log(`[ScraperEngine] Scraped items after deduplication. Total for category: ${allCategoryData.length}`);
      if (newData.length === 0 && clickCount > 0) { // If a pagination click yielded no new items
          console.log("[ScraperEngine] No new items found after pagination click. Assuming end of content.");
          break;
      }

      if ((config.paginationMethod === 'nextButton' || config.paginationMethod === 'loadMoreButton') &&
          config.paginationDetails && config.paginationDetails.selector) {
        const buttonSelector = config.paginationDetails.selector;
        console.log(`[ScraperEngine] Attempting pagination click: ${buttonSelector}`);
        const buttonElement = await page.$(buttonSelector);
        if (buttonElement) {
          const isVisible = await page.evaluate(el => el.offsetParent !== null, buttonElement);
          if (!isVisible) {
            console.log("[ScraperEngine] Pagination button found but not visible. Stopping.");
            break;
          }
          try {
            await page.waitForTimeout(500); // Small pause before click
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => console.log('[ScraperEngine] No navigation after click, or timeout.')),
                buttonElement.click()
            ]);
            console.log("[ScraperEngine] Clicked pagination button.");
            await buttonElement.dispose();
            clickCount++;
            await page.waitForTimeout(config.paginationDetails.delay || 3000); // Wait for content
          } catch (clickError) {
            console.error(`[ScraperEngine] Error clicking pagination button: ${clickError.message}. Stopping.`);
            await buttonElement.dispose().catch(()=>{});
            break;
          }
        } else {
          console.log("[ScraperEngine] Pagination button not found. Stopping.");
          break;
        }
      } else if (config.paginationMethod === 'xhrInfinite') {
        console.log(`[ScraperEngine] XHR/Infinite scroll (attempt ${clickCount + 1})`);
        try {
          await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
          console.log("[ScraperEngine] Scrolled to bottom.");
          const scrollWaitTimeout = config.paginationDetails?.xhrInfiniteScrollDelay || 3000;
          // Simplified: just wait after scroll. More complex XHR detection can be added.
          await page.waitForTimeout(scrollWaitTimeout);
          console.log(`[ScraperEngine] Waited ${scrollWaitTimeout}ms after scroll.`);
          clickCount++;
        } catch (scrollError) {
          console.error(`[ScraperEngine] Error during scroll: ${scrollError.message}. Stopping.`);
          break;
        }
      } else {
        console.log("[ScraperEngine] No further pagination. Ending scrape for category.");
        break;
      }
    }
  } catch (error) {
      console.error(`[ScraperEngine] Error in scrapeCategory ${initialUrl}: ${error.message}`, error.stack);
  } finally {
    console.log(`[ScraperEngine] scrapeCategory: finally block for ${initialUrl}`);
    if (page && !page.isClosed()) {
      try {
        await page.close();
        console.log(`[ScraperEngine] Successfully closed page for ${initialUrl}`);
      } catch (closeError) {
        console.error(`[ScraperEngine] Error closing page for ${initialUrl}: ${closeError.message}`);
      }
    }
  }
  return allCategoryData;
}

async function start(config) {
  console.log(`[ScraperEngine] Starting scraper engine for config: ${config.id}`);
  let allScrapedData = [];
  const configToUse = config; // Assuming config is already parsed and validated by the service

  if (!configToUse.categoryUrls || configToUse.categoryUrls.length === 0) {
    console.warn("[ScraperEngine] No category URLs provided.");
    return [];
  }
  console.log(`[ScraperEngine] Processing ${configToUse.categoryUrls.length} category URLs.`);

  for (const categoryUrl of configToUse.categoryUrls) {
    let browser = null;
    try {
      console.log(`[ScraperEngine] Launching browser for category: ${categoryUrl}`);
      browser = await launchBrowser();
      if (!browser) {
        console.error(`[ScraperEngine] Failed to launch browser for ${categoryUrl}. Skipping.`);
        continue;
      }
      const categoryData = await scrapeCategory(browser, categoryUrl, configToUse);
      if (categoryData && categoryData.length > 0) {
        allScrapedData = allScrapedData.concat(categoryData);
      }
      console.log(`Finished category ${categoryUrl}, scraped ${categoryData ? categoryData.length : 0} items. Total overall: ${allScrapedData.length}`);
    } catch (categoryError) {
      console.error(`[ScraperEngine] Critical error for category ${categoryUrl}: ${categoryError.message}`, categoryError.stack);
    } finally {
      if (browser) {
        try {
          console.log(`[ScraperEngine] Closing browser for category: ${categoryUrl}`);
          await browser.close();
          console.log(`[ScraperEngine] Successfully closed browser for ${categoryUrl}`);
        } catch (closeError) {
          console.error(`[ScraperEngine] Error closing browser for ${categoryUrl}: ${closeError.message}`);
        }
      }
    }
  }

  console.log(`Total items scraped from all categories: ${allScrapedData.length}`);
  return allScrapedData;
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