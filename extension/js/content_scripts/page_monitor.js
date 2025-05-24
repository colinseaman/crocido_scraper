// page_monitor.js
console.log("Crocido Page Monitor Loaded");

let xhrMonitoringActive = false;
let detectedXhrUrls = new Set(); // To store unique URLs

// Store original methods
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;
const originalFetch = window.fetch;

function startXHRMonitoring() {
  if (xhrMonitoringActive) return;
  xhrMonitoringActive = true;
  detectedXhrUrls.clear(); // Clear previously detected URLs for a new session
  console.log("Crocido XHR Monitoring STARTED");

  // Override XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
    this._crocido_xhr_url = url; // Store URL for send method
    this._crocido_xhr_method = method;
    // console.log(`XHR open: ${method} ${url}`);
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    if (xhrMonitoringActive && this._crocido_xhr_url) {
      this.addEventListener('load', function() {
        if (this.status >= 200 && this.status < 300) { // Successful responses
          console.log(`XHR request to: ${this._crocido_xhr_url} completed with status ${this.status}.`);
          // Basic check: if responseType is json or text, and it has some content
          if ((this.responseType === '' || this.responseType === 'text' || this.responseType === 'json') && this.responseText && this.responseText.length > 50) {
            if (!detectedXhrUrls.has(this._crocido_xhr_url)) {
              detectedXhrUrls.add(this._crocido_xhr_url);
              console.log("Potential data XHR detected (page_monitor):", this._crocido_xhr_method, this._crocido_xhr_url);
              chrome.runtime.sendMessage({
                action: "xhrDetected", 
                url: this._crocido_xhr_url, 
                method: this._crocido_xhr_method,
                // responseText: this.responseText.substring(0, 500) // Sending a snippet can be large, consider just URL/pattern
              });
            }
          }
        }
      });
    }
    return originalXHRSend.apply(this, arguments);
  };

  // Override fetch
  window.fetch = async function(...args) {
    const url = args[0] instanceof Request ? args[0].url : args[0];
    const method = args[0] instanceof Request ? args[0].method : (args[1] ? args[1].method : 'GET');
    // console.log(`Fetch request: ${method} ${url}`);
    
    const response = await originalFetch.apply(this, args);
    
    if (xhrMonitoringActive && response.ok) {
      // console.log(`Fetch to: ${url} completed with status ${response.status}.`);
      // Clone response to read it, as body can be consumed only once
      const clonedResponse = response.clone();
      try {
        const responseBody = await clonedResponse.text(); // or .json()
        if (responseBody && responseBody.length > 50) { // Basic check for content
          if (!detectedXhrUrls.has(url)) {
            detectedXhrUrls.add(url);
            console.log("Potential data Fetch detected (page_monitor):", method, url);
            chrome.runtime.sendMessage({
              action: "xhrDetected", 
              url: url, 
              method: method,
              // responseText: responseBody.substring(0, 500) // Sending a snippet can be large
            });
          }
        }
      } catch (e) {
        // console.warn("Error reading fetch response body for XHR detection:", e);
      }
    }
    return response;
  };
}

function stopXHRMonitoring() {
  if (!xhrMonitoringActive) return;
  xhrMonitoringActive = false;
  console.log("Crocido XHR Monitoring STOPPED. Detected URLs:", Array.from(detectedXhrUrls));
  // Restore original methods
  XMLHttpRequest.prototype.open = originalXHROpen;
  XMLHttpRequest.prototype.send = originalXHRSend;
  window.fetch = originalFetch;
}

async function fetchAndParseSitemap() {
  console.log("Attempting to fetch and parse sitemap(s).");
  let sitemapUrlsToTry = [];
  let sitemapIndexUrls = []; // This will be populated with actual sitemaps to process
  let allUrlsFromSitemaps = new Set();
  let processedSitemapIndexes = new Set(); // Tracks processed *final* sitemap URLs to avoid re-parsing

  // 1. Try to get sitemap URLs from robots.txt
  try {
    const robotsUrl = new URL('/robots.txt', window.location.origin).href;
    console.log(`Fetching ${robotsUrl}`);
    const robotsResponse = await fetch(robotsUrl);
    if (robotsResponse.ok) {
      const robotsText = await robotsResponse.text();
      const lines = robotsText.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().startsWith('sitemap:')) {
          const url = line.substring(line.indexOf(':') + 1).trim();
          if (url) {
            sitemapUrlsToTry.push(url);
            console.log(`Found sitemap URL in robots.txt: ${url}`);
          }
        }
      }
    } else {
      console.warn(`Failed to fetch robots.txt: ${robotsResponse.statusText}`);
    }
  } catch (robotsError) {
    console.warn("Error fetching or parsing robots.txt:", robotsError);
  }

  // 2. If no sitemaps from robots.txt, or as a fallback, try default /sitemap.xml
  if (sitemapUrlsToTry.length === 0) {
    console.log("No sitemaps found in robots.txt, trying default /sitemap.xml");
    sitemapUrlsToTry.push(new URL('/sitemap.xml', window.location.origin).href);
  }

  // Add all candidates to the sitemapIndexUrls queue for processing
  sitemapIndexUrls.push(...sitemapUrlsToTry);

  async function processSingleSitemap(urlToFetch) {
    if (processedSitemapIndexes.has(urlToFetch)) return;
    processedSitemapIndexes.add(urlToFetch);
    console.log(`Processing sitemap: ${urlToFetch}`);

    try {
      const response = await fetch(urlToFetch);
      if (!response.ok) {
        console.warn(`Failed to fetch sitemap ${urlToFetch}: ${response.statusText}`);
        return;
      }
      const sitemapText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(sitemapText, "text/xml");
      
      // Check for errors in XML parsing
      const parseError = xmlDoc.getElementsByTagName('parsererror');
      if (parseError.length > 0) {
        console.warn(`Error parsing XML for ${urlToFetch}:`, parseError[0].textContent);
        return;
      }

      // Check for sitemap index file first (nested sitemaps)
      const sitemapElements = xmlDoc.getElementsByTagName('sitemap');
      if (sitemapElements.length > 0) {
        console.log(`Detected sitemap index: ${urlToFetch}. Processing sub-sitemaps.`);
        for (let sitemapNode of sitemapElements) {
          const locNode = sitemapNode.getElementsByTagName('loc')[0];
          if (locNode && locNode.textContent) {
            const subSitemapUrl = locNode.textContent.trim();
            // Add to the main queue to be processed, it will be guarded by processedSitemapIndexes
            if (!processedSitemapIndexes.has(subSitemapUrl) && !sitemapIndexUrls.includes(subSitemapUrl)) {
                 sitemapIndexUrls.push(subSitemapUrl); 
            }
          }
        }
      }

      // Process URLs within the current sitemap
      const urlElements = xmlDoc.getElementsByTagName('url');
      for (let urlNode of urlElements) {
        const locNode = urlNode.getElementsByTagName('loc')[0];
        if (locNode && locNode.textContent) {
          allUrlsFromSitemaps.add(locNode.textContent.trim());
        }
      }
      console.log(`Finished processing ${urlToFetch}. Found ${urlElements.length} <url> entries. Total unique URLs so far: ${allUrlsFromSitemaps.size}`);

    } catch (error) {
      console.error(`Error fetching or parsing sitemap ${urlToFetch}:`, error);
    }
  }

  // Process all sitemaps in the queue (handles nested sitemap indexes)
  // Keep a copy of initial sitemapIndexUrls to iterate over, as processSingleSitemap might add to it.
  // A better approach for dynamic queue processing is a while loop that shifts from the queue.
  let initialQueue = [...sitemapIndexUrls]; // sitemapIndexUrls might grow
  sitemapIndexUrls = []; // Reset and let it be repopulated if needed by index files.
                        // The initialQueue will be processed first.

  for(const sitemapToProcess of initialQueue) {
      if (!processedSitemapIndexes.has(sitemapToProcess)) {
        await processSingleSitemap(sitemapToProcess);
      }
  }
  // After processing initial and potentially some from sitemap indexes, check if sitemapIndexUrls (the global one) has more.
  // This handles sitemaps discovered from *within* other sitemaps.
  while(sitemapIndexUrls.length > 0) {
    const currentSitemapToProcess = sitemapIndexUrls.shift();
    if (!processedSitemapIndexes.has(currentSitemapToProcess)) {
        await processSingleSitemap(currentSitemapToProcess);
    }
  }
  
  // Basic heuristic filter for category-like URLs (example)
  const categoryKeywords = ['category', 'collection', 'group', 'department', 'browse', 'list', 'shop', '/c/', '/g/', '/d/', '/s/'];
  const exclusionKeywords = ['product', 'item', 'detail', '/p/', '/i/', '/-', '.xml', '.pdf', 'customer', 'account', 'login', 'cart', 'checkout']; // Removed .html as it might be used for categories

  const potentialCategoryUrls = Array.from(allUrlsFromSitemaps).filter(url => {
    const lowerUrl = url.toLowerCase();
    let pathOnly = '';
    try {
        pathOnly = new URL(url).pathname.toLowerCase();
    } catch(e) { return false; /* Invalid URL found in sitemap */ }

    const hasCategoryKeyword = categoryKeywords.some(kw => lowerUrl.includes(kw));
    const hasExclusionKeyword = exclusionKeywords.some(kw => pathOnly.includes(kw) || (kw.startsWith('.') && lowerUrl.endsWith(kw)) ); // check full URL for extension
    
    const pathSegments = pathOnly.split('/').filter(Boolean).length;

    return hasCategoryKeyword && !hasExclusionKeyword && pathSegments < 4 && pathSegments > 0;
  }).slice(0, 50);

  console.log("Potential category URLs from sitemap(s):", potentialCategoryUrls);
  chrome.runtime.sendMessage({ 
    action: "sitemapCategoriesDetected", 
    urls: potentialCategoryUrls, 
    source: "page_monitor"
  });
}

async function scanPageForCategoryLinks() {
  console.log("Attempting to scan page for category links");
  const allLinks = Array.from(document.getElementsByTagName('a'));
  const potentialCategoryUrls = new Set();
  const currentHostname = window.location.hostname;

  // Keywords that might indicate a category link text or URL part
  const categoryKeywords = ['category', 'categories', 'collection', 'collections', 'group', 'department', 'browse', 'shop', 'all', 'view all', 'products', 'items', 'deals', 'offers'];
  // Keywords/patterns to exclude
  const exclusionKeywords = ['product/', '/p/', '/item/', '/product.php', 'customer', 'account', 'login', 'register', 'cart', 'checkout', 'wishlist', 'compare', 'tel:', 'mailto:', 'javascript:', '#', '.pdf', '.jpg', '.png', 'about', 'contact', 'terms', 'privacy', 'policy', 'faq', 'support', 'blog', 'news'];
  const minPathSegments = 1; // e.g., /mens
  const maxPathSegments = 3; // e.g., /mens/shirts/casual (less likely to be a product page)

  allLinks.forEach(link => {
    const href = link.href;
    try {
      const url = new URL(href, window.location.origin);
      // Only internal links
      if (url.hostname !== currentHostname) return;

      const path = url.pathname.toLowerCase();
      const linkText = link.textContent.toLowerCase().trim();

      // Exclusion checks
      if (exclusionKeywords.some(kw => path.includes(kw) || linkText.includes(kw) || href.startsWith(kw))) return;
      // Basic file extension check for path
      if (path.includes('.') && !path.endsWith('/') && !path.includes('.php') && !path.includes('.asp')) { // allow .php/.asp, deny .html, .jpg etc unless it ends with /
        const ext = path.substring(path.lastIndexOf('.') + 1);
        if (['html', 'htm', 'xml', 'txt', 'pdf', 'doc', 'xls', 'jpg', 'jpeg', 'png', 'gif'].includes(ext)) return;
      }
      if (url.search.includes('product_id=') || url.search.includes('item_id=')) return; // Query param check

      const pathSegments = path.split('/').filter(Boolean).length;
      if (pathSegments < minPathSegments || pathSegments > maxPathSegments) return;
      
      // Check if link text or path contains category-like keywords
      let isPotentialCategory = false;
      if (categoryKeywords.some(kw => path.includes(kw) || linkText.includes(kw))) {
        isPotentialCategory = true;
      }
      // Check for common e-commerce patterns like /c/ or /category/
      if (path.match(/\/([a-z]{1,3}|category|collection|shop|browse|group|department|warengruppe)\//i)) {
          isPotentialCategory = true;
      }
      // Heuristic: if link text is short and seems like a noun/plural noun
      if (linkText.length > 2 && linkText.length < 25 && !linkText.includes(' ') && pathSegments > 0) {
          // Could add more checks here, e.g. if it is all alpha
          // isPotentialCategory = true; // This might be too broad, use with caution
      }

      if (isPotentialCategory) {
        potentialCategoryUrls.add(url.href); // Add the full URL
      }
    } catch (e) {
      // Invalid URL, ignore
    }
  });

  const finalUrls = Array.from(potentialCategoryUrls).slice(0, 50); // Limit suggestions
  console.log("Potential category URLs from page links:", finalUrls);
  chrome.runtime.sendMessage({ 
    action: "pageLinkCategoriesDetected", 
    urls: finalUrls, 
    source: "page_monitor"
  });
}

// Modify the existing message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.source === "selector_tool") {
      if (request.action === "monitorXHR_start") {
        startXHRMonitoring();
        sendResponse({status: "XHR monitoring started by page_monitor"});
      } else if (request.action === "monitorXHR_stop") {
        stopXHRMonitoring();
        sendResponse({status: "XHR monitoring stopped by page_monitor", detectedUrls: Array.from(detectedXhrUrls)});
      } else if (request.action === "detectCategories_start") {
        if (request.type === "sitemap") {
          fetchAndParseSitemap();
          sendResponse({status: "Sitemap detection initiated by page_monitor"});
        } else if (request.type === "pagelinks") {
          scanPageForCategoryLinks();
          sendResponse({status: "Page link scan initiated by page_monitor"});
        }
      }
  }
  return true; 
});

// Initial state: monitoring is off
// Call stopXHRMonitoring on script load to ensure originals are set if script is re-injected.
// However, this might stop monitoring if another part of the extension started it.
// A more robust system might use a flag in chrome.storage or rely on explicit start/stop messages.
// For now, we rely on explicit messages from selector_tool.js

// TODO: Implement logic to monitor XHR requests for infinite scroll
// TODO: Implement logic to detect pagination links
// TODO: Implement logic to scan for sitemap.xml and category links

// Example of listening for XHR requests (very basic)
// This would need to be more sophisticated to identify relevant product-loading requests.
/*
(function(open) {
    XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
        this.addEventListener("load", function() {
            console.log("XHR Loaded:", method, url, this.responseText.substring(0,100));
            // Potentially send to background script if it looks like product data
            // chrome.runtime.sendMessage({action: "xhrCompleted", url: url, response: this.responseText});
        });
        open.call(this, method, url, async, user, pass);
    };
})(XMLHttpRequest.prototype.open);
*/

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "detectPagination") {
    // Add logic to detect pagination
    console.log("Attempting to detect pagination...");
    sendResponse({status: "Pagination detection initiated"});
  } else if (request.action === "detectCategories") {
    // Add logic to detect categories
    console.log("Attempting to detect categories...");
    sendResponse({status: "Category detection initiated"});
  }
  return true;
}); 