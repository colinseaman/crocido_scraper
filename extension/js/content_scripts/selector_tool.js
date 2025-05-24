// selector_tool.js
console.log("Crocido Selector Tool Loaded");

let isSetupModeActive = false;
let highlighter = null;
let tooltip = null;
let setupSidebar = null;
let productContainerSelectionMode = false;
let selectedContainerXPaths = [];
let detectedProductContainerXPath = null;
let containerPreviewHighlighters = []; // Array to store highlighter elements
let detectedCategoryUrlsFromSitemap = [];
let manualCategoryUrls = []; // To store manually added category URLs
let isSelectingPaginationElement = false; // New state variable
let currentFieldSelectionMode = null; // Possible values: "Title", "Price", "Description", "ImageSrc", null

// NEW: Structure to hold custom field XPaths
let customFieldSelectors = {};

let currentConfigFromUI = {
  configName: '',
  domain: '',
  productContainersXpath: null,
  selectors: [],
  paginationMethod: 'none', // Default pagination method
  paginationDetails: {},
  categoryUrls: [],
  detectedXhrPatterns: [] // Default XHR patterns
};

// Structure to hold XPaths for predefined fields
let predefinedFieldSelectors = {
  Title: { xpath: '', name: 'Title' },
  Price: { xpath: '', name: 'Price' },
  ImageSrc: { xpath: '', name: 'ImageSrc' }      // Assuming image means src
};

// Helper to get an element from an XPath
function getElementByXPath(xpath) {
  try {
    return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (e) {
    console.error("Error evaluating XPath:", xpath, e);
    return null;
  }
}

// MODIFIED getXPath function
function getXPath(element, baseElement = null) {
    // If element is the baseElement, its relative XPath is '.'
    if (element === baseElement) {
        return '.';
    }

    // Prioritize structural paths when baseElement is specified.
    if (element.id !== '' && !baseElement) { 
        try {
            // Check if ID is unique using a more robust querySelectorAll
            // Escape quotes in ID for the query selector - CORRECTED LINE
            const escapedId = element.id.replace(/[\"'\\]/g, '\\$&'); 
            if (document.querySelectorAll(`[id="${escapedId}"]`).length === 1) {
                 return `id("${element.id}")`; // Use original non-escaped ID for XPath
            }
        } catch (e) { /* Malformed ID, fall through */ console.warn("Error checking ID uniqueness:", e); }
    }

    let pathSegments = [];
    let currentElement = element;

    while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
        if (baseElement && currentElement === baseElement) {
            pathSegments.reverse();
            return '.' + (pathSegments.length > 0 ? '/' + pathSegments.join('/') : '');
        }

        let segment = currentElement.tagName.toLowerCase();
        let parent = currentElement.parentNode;

        // Check if parentNode exists and is an element before counting siblings
        if (parent && parent.nodeType === Node.ELEMENT_NODE) {
            let ix = 1;
            let sibling = currentElement.previousSibling;
            while(sibling){
                if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === currentElement.tagName) {
                    ix++;
                }
                sibling = sibling.previousSibling;
            }
            // Check if this element is uniquely identifiable by its tag name among its siblings
            let nextSibling = currentElement.nextSibling;
            let hasSameTagFollowingSibling = false;
            while(nextSibling){
                if(nextSibling.nodeType === Node.ELEMENT_NODE && nextSibling.tagName === currentElement.tagName){
                    hasSameTagFollowingSibling = true;
                    break;
                }
                nextSibling = nextSibling.nextSibling;
            }
            if(ix > 1 || hasSameTagFollowingSibling) {
                 segment += '[' + ix + ']';
            } // Otherwise, if ix is 1 and no following siblings of same tag, index is not needed for uniqueness at this level.
          
        } else if (!parent) { // No parent, top-level element (e.g. html)
           // No change to segment, it's just the tag name
        } else {
            // Parent is not an element (e.g. document), stop further path construction if baseElement is not met.
            // This case implies currentElement is likely document.documentElement (html tag)
            // If baseElement is not involved, we let it form an absolute path.
            if (baseElement) break; // Stop if relative path construction hits non-element parent
        }

        pathSegments.push(segment);

        if (!parent || currentElement === document.body || currentElement === document.documentElement) { // Stop at html or body for absolute, or if no parent
             if (!baseElement) break; // For absolute paths, stop at body/html
        }
        // If baseElement is defined, loop continues until currentElement is baseElement or no parent
        currentElement = parent;
        if (baseElement && currentElement === baseElement) { // Final check if parent is baseElement
            pathSegments.reverse();
            return '.' + (pathSegments.length > 0 ? '/' + pathSegments.join('/') : '');
        }
    }

    pathSegments.reverse();
    let finalPath = pathSegments.join('/');

    if (!baseElement && !finalPath.startsWith('/') && !finalPath.startsWith('id(')) {
        finalPath = '/' + finalPath;
    }
    return finalPath;
}

// New function to generalize XPaths for product containers
function generalizeProductContainerXPaths(xpath1, xpath2) {
  console.log("[Crocido] Attempting to generalize XPaths:", xpath1, xpath2);
  const element1 = getElementByXPath(xpath1);
  const element2 = getElementByXPath(xpath2);

  if (!element1 || !element2) {
    console.warn("[Crocido] Could not find one or both elements for generalization. Falling back to common ancestor.");
    return findCommonAncestorXPath([xpath1, xpath2]); // Fallback
  }

  // Scenario 1: Elements are siblings and share tag + classes
  if (element1.parentNode === element2.parentNode && element1.tagName === element2.tagName) {
    const parentXPath = getXPath(element1.parentNode);
    const tagName = element1.tagName.toLowerCase();
    let classConditions = "";
    
    if (element1.classList.length > 0 && element2.classList.length > 0) {
        const commonClasses = Array.from(element1.classList).filter(cls => element2.classList.contains(cls));
        if (commonClasses.length > 0) {
            // Filter out very generic classes if possible, or ensure specificity
            const specificCommonClasses = commonClasses.filter(c => c.length > 3 && !c.startsWith("js-") && !c.match(/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/)); // Basic heuristic
            const classesToUse = specificCommonClasses.length > 0 ? specificCommonClasses : commonClasses;
            classConditions = classesToUse.map(cls => `contains(@class, '${cls}')`).join(' and ');
        }
    }

    if (classConditions) {
      const generalizedXPath = `${parentXPath}/${tagName}[${classConditions}]`;
      console.log("[Crocido] Attempting generalized sibling XPath:", generalizedXPath);
      try {
        const resultTest = document.evaluate(generalizedXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        let found1 = false;
        let found2 = false;
        for(let i=0; i < resultTest.snapshotLength; i++) {
            if(resultTest.snapshotItem(i) === element1) found1 = true;
            if(resultTest.snapshotItem(i) === element2) found2 = true;
        }
        if (found1 && found2 && resultTest.snapshotLength >= 2) {
            console.log("[Crocido] Sibling generalization successful:", generalizedXPath);
            return generalizedXPath;
        } else {
             console.warn("[Crocido] Sibling generalization didn't reliably find original elements or found too few. XPath:", generalizedXPath, "Found in document:", resultTest.snapshotLength);
        }
      } catch(e){
          console.warn("[Crocido] Error testing sibling generalization:", e);
      }
    } else if (element1.tagName === element2.tagName) {
        // Siblings, same tag, no common classes. Try just tag.
        const generalizedXPath = `${parentXPath}/${tagName}`;
        console.log("[Crocido] Attempting generalized sibling XPath (tag only):", generalizedXPath);
         try {
            const resultTest = document.evaluate(generalizedXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (resultTest.snapshotLength >= 2) { // Check if it finds at least two (could be more)
                 console.log("[Crocido] Sibling generalization (tag only) seems plausible:", generalizedXPath);
                 return generalizedXPath; // This might be too broad, but it's an option
            }
        } catch(e) { /* ignore */ }
    }
  }

  // Scenario 2: Generalize based on tag and common classes globally (if not direct siblings or above failed)
  if (element1.tagName === element2.tagName && element1.classList.length > 0 && element2.classList.length > 0) {
    const tagName = element1.tagName.toLowerCase();
    const commonClasses = Array.from(element1.classList).filter(cls => element2.classList.contains(cls));
    if (commonClasses.length > 0) {
        const specificCommonClasses = commonClasses.filter(c => c.length > 3 && !c.startsWith("js-") && !c.match(/^-?[_a-zA-Z]+[_a-zA-Z0-9-]*$/));
        const classesToUse = specificCommonClasses.length > 0 ? specificCommonClasses : commonClasses;
        const classConditions = classesToUse.map(cls => `contains(@class, '${cls}')`).join(' and ');
        const generalizedXPath = `//${tagName}[${classConditions}]`;
        console.log("[Crocido] Attempting generalized global XPath:", generalizedXPath);
         try {
            const resultTest = document.evaluate(generalizedXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            let found1 = false;
            let found2 = false;
            for(let i=0; i < resultTest.snapshotLength; i++) {
                if(resultTest.snapshotItem(i) === element1) found1 = true;
                if(resultTest.snapshotItem(i) === element2) found2 = true;
            }
            if (found1 && found2 && resultTest.snapshotLength >= 2) {
                console.log("[Crocido] Global generalization successful:", generalizedXPath);
                return generalizedXPath;
            } else {
                 console.warn("[Crocido] Global generalization didn't reliably find original elements or found too few. XPath:", generalizedXPath, "Found in document:", resultTest.snapshotLength);
            }
        } catch(e){
             console.warn("[Crocido] Error testing global generalization:", e);
        }
    }
  }

  console.log("[Crocido] All specific generalizations failed or not applicable. Falling back to common ancestor XPath.");
  return findCommonAncestorXPath([xpath1, xpath2]);
}

function getCssSelector(element) {
  if (!element || !(element instanceof Element)) {
    return '';
  }
  // Basic strategy: prefer ID, then unique class, then tag + nth-child
  if (element.id) {
    // Escape special characters in ID for CSS selector if any (though less common than in values)
    const id = element.id.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
    return `#${id}`;
  }

  // Try to find a unique class combination
  if (element.classList && element.classList.length > 0) {
    const uniqueClasses = Array.from(element.classList).filter(className => {
      // A class is unique if this element is the only one with it on the page
      // This can be slow for many classes, so use with caution or refine
      // For simplicity, let's just take the first class or all classes for now
      // A more robust approach would check document.getElementsByClassName(className).length === 1
      return true; // Take all classes for now
    });
    if (uniqueClasses.length > 0) {
      return uniqueClasses.map(c => `.${c.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1")}`).join('');
    }
  }
  
  // Fallback: tag name (more complex: add nth-of-type or similar for specificity)
  let path = element.tagName.toLowerCase();
  let parent = element.parentElement;
  while(parent){
      const siblings = Array.from(parent.children);
      const同tagSiblings = siblings.filter(sibling => sibling.tagName === element.tagName);
      if(同tagSiblings.length > 1){
          const index = 同tagSiblings.indexOf(element);
          path = `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
          // Check if this selector is unique enough within the parent
          try {
            if (parent.querySelectorAll(path).length === 1) break;
          } catch (e) { /* ignore invalid intermediate selector */ }
      }
      if(parent.id) {
          path = `#${parent.id.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1")} > ${path}`;
          break;
      }
      // Could add class-based parent selectors too
      parent = parent.parentElement;
  }
  return path;
}

function showHighlighter(element) {
  if (!highlighter) {
    highlighter = document.createElement('div');
    highlighter.className = 'crocido-highlight';
    document.body.appendChild(highlighter);
  }
  const rect = element.getBoundingClientRect();
  highlighter.style.left = rect.left + window.scrollX + 'px';
  highlighter.style.top = rect.top + window.scrollY + 'px';
  highlighter.style.width = rect.width + 'px';
  highlighter.style.height = rect.height + 'px';
  highlighter.style.display = 'block';
}

function hideHighlighter() {
  if (highlighter) {
    highlighter.style.display = 'none';
  }
}

function showTooltip(element, xpath) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'crocido-tooltip';
    document.body.appendChild(tooltip);
  }
  const rect = element.getBoundingClientRect();
  tooltip.textContent = xpath;
  tooltip.style.left = rect.left + window.scrollX + 'px';
  tooltip.style.top = rect.top + window.scrollY - 20 + 'px';
  tooltip.style.display = 'block';
}

function hideTooltip() {
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function findCommonAncestorXPath(xpathList) {
  if (!xpathList || xpathList.length === 0) return null;
  if (xpathList.length === 1) return xpathList[0];

  const paths = xpathList.map(xpath => xpath.split('/').filter(p => p));

  let shortestPathLength = Math.min(...paths.map(p => p.length));
  let commonPrefix = [];

  for (let i = 0; i < shortestPathLength; i++) {
    const firstPathSegment = paths[0][i];
    if (paths.every(p => p[i] === firstPathSegment)) {
      commonPrefix.push(firstPathSegment);
    } else {
      // If segments differ, but elements at this level might still be what we want to generalize for containers
      // e.g. /div/ul/li[1] and /div/ul/li[2] -> common ancestor is /div/ul
      // The original function correctly breaks here. The generalization is handled by generalizeProductContainerXPaths
      break;
    }
  }

  if (commonPrefix.length === 0) {
    console.warn("[Crocido] No common XPath prefix found for common ancestor.");
    // Attempt to find a common ancestor element directly if paths are too different.
    if (xpathList.length === 2) {
        const el1 = getElementByXPath(xpathList[0]);
        const el2 = getElementByXPath(xpathList[1]);
        if (el1 && el2) {
            let parent1 = el1.parentElement;
            while(parent1) {
                if (parent1.contains(el2)) return getXPath(parent1); // parent1 is an ancestor of el2
                parent1 = parent1.parentElement;
            }
        }
    }
    return '/'; // Default if truly no commonality or error
  }
  
  let commonAncestorPathString = commonPrefix.join('/');

  if (commonAncestorPathString.startsWith('id(') || commonAncestorPathString.startsWith('/') || commonAncestorPathString.startsWith('//')) {
    return commonAncestorPathString; 
  } else {
    return '//' + commonAncestorPathString;
  }
}

function clearContainerPreviewHighlighters() {
  containerPreviewHighlighters.forEach(h => h.remove());
  containerPreviewHighlighters = [];
}

function resetContainerSelection() {
  console.log("[Crocido] Resetting container selection.");
  selectedContainerXPaths = [];
  detectedProductContainerXPath = null;
  clearContainerPreviewHighlighters();
  productContainerSelectionMode = true; // Re-enable selection mode
  // Update UI elements to reflect the reset state
  if (setupSidebar) {
    updateContainerDetectionUI(); // This should update the status message and button states
    // Any other specific UI resets related to containers can go here
    // For example, if fields section should be hidden until containers are re-confirmed:
    // document.getElementById('crocido-field-selectors').style.display = 'none'; 
    // (Adjust based on desired UI flow)
  }
  // Provide user feedback
  const statusMsgEl = document.getElementById('crocido-status-message');
  if (statusMsgEl) {
    statusMsgEl.textContent = "Container selection has been reset. Please select new examples.";
    setTimeout(() => { statusMsgEl.textContent = ""; }, 3000);
  }
}

function previewProductContainers(xpath) {
  clearContainerPreviewHighlighters();
  if (!xpath) return;

  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < result.snapshotLength; i++) {
      const element = result.snapshotItem(i);
      if (element) {
        const rect = element.getBoundingClientRect();
        const previewHighlighter = document.createElement('div');
        previewHighlighter.className = 'crocido-container-preview-highlight'; // New class for distinct styling
        previewHighlighter.style.left = rect.left + window.scrollX + 'px';
        previewHighlighter.style.top = rect.top + window.scrollY + 'px';
        previewHighlighter.style.width = rect.width + 'px';
        previewHighlighter.style.height = rect.height + 'px';
        document.body.appendChild(previewHighlighter);
        containerPreviewHighlighters.push(previewHighlighter);
      }
    }
    console.log(`Previewing ${containerPreviewHighlighters.length} containers for XPath: ${xpath}`);
    if (setupSidebar && result.snapshotLength === 0) {
        const detectionInfo = setupSidebar.querySelector('#crocido-container-detection-info');
        if(detectionInfo) detectionInfo.textContent += " (Preview found 0 elements)";
    } else if (setupSidebar && result.snapshotLength > 0) {
        const detectionInfo = setupSidebar.querySelector('#crocido-container-detection-info');
        if(detectionInfo) detectionInfo.textContent += ` (Preview found ${result.snapshotLength} elements)`;
    }
  } catch (e) {
    console.error("Error evaluating XPath for container preview:", e);
    alert("Invalid XPath for container preview: " + e.message);
     if (setupSidebar) {
        const detectionInfo = setupSidebar.querySelector('#crocido-container-detection-info');
        if(detectionInfo) detectionInfo.textContent += " (Invalid XPath for preview)";
    }
  }
}

function updateContainerDetectionUI() {
  if (!setupSidebar) return;
  const detectionStatusDiv = setupSidebar.querySelector('#crocido-container-detection-status');
  const previewButton = setupSidebar.querySelector('#crocido-preview-containers');

  if (!detectionStatusDiv || !previewButton) {
    console.error("Could not find container detection UI elements. Check IDs.");
    return;
  }

  // Reset potential preview messages from info text
  if (detectionStatusDiv.textContent.includes("(Preview found")) {
      detectionStatusDiv.textContent = detectionStatusDiv.textContent.substring(0, detectionStatusDiv.textContent.indexOf("(Preview found"));
  }

  if (productContainerSelectionMode) {
    if (selectedContainerXPaths.length === 0) {
      detectionStatusDiv.textContent = "Click on the first product container example on the page.";
      previewButton.disabled = true;
    } else if (selectedContainerXPaths.length === 1) {
      detectionStatusDiv.textContent = "Click on a second product container example.";
      previewButton.disabled = false; // Can preview the single selection
    } else { // 2 or more selections made, generalization attempted
      if (detectedProductContainerXPath) {
        detectionStatusDiv.textContent = `Common XPath detected: ${detectedProductContainerXPath.substring(0, 50)}... Preview to verify.`;
      } else {
        // This case might occur if generalization failed
        detectionStatusDiv.textContent = "Could not generalize from 2 selections. Try different examples or reset.";
      }
      previewButton.disabled = !detectedProductContainerXPath; // Enable preview if generalization was successful
    }
  } else { // Product container selection mode is OFF (meaning XPath is considered set)
    if (detectedProductContainerXPath) {
      detectionStatusDiv.textContent = `Product Containers XPath: ${detectedProductContainerXPath.substring(0,50)}...`;
      previewButton.disabled = false;
    } else {
      // Should ideally not happen if selection mode is off without a detected XPath
      detectionStatusDiv.textContent = "No Product Container XPath set. Please select containers.";
      previewButton.disabled = true;
      productContainerSelectionMode = true; // Re-enable selection mode
    }
  }
}

// NEW FUNCTION DEFINITION
function handleAddCustomField() {
  if (!setupSidebar) return;

  const customFieldNameInput = document.getElementById('crocido-custom-field-name');
  const fieldName = customFieldNameInput.value.trim();

  if (!fieldName) {
    alert("Please enter a name for the custom field.");
    return;
  }

  // Sanitize fieldName to be used as an ID or key (basic example)
  const sanitizedFieldName = fieldName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

  if (predefinedFieldSelectors[sanitizedFieldName] || customFieldSelectors[sanitizedFieldName]) {
    alert(`Field '${fieldName}' already exists.`);
    return;
  }

  console.log(`[Crocido] Adding custom field: ${fieldName} (Sanitized: ${sanitizedFieldName})`);

  // Add to custom selectors
  customFieldSelectors[sanitizedFieldName] = { xpath: '', name: fieldName, isCustom: true };

  // Create and append the new field block to the UI
  const fieldSelectorsDiv = document.getElementById('crocido-field-selectors');
  if (fieldSelectorsDiv) {
    const newFieldBlock = createFieldSelectorBlock(sanitizedFieldName, fieldName); // Use original name as label
    fieldSelectorsDiv.appendChild(newFieldBlock);
    updateFieldSelectorBlockUI(sanitizedFieldName); // Update its UI state (e.g., disable clear button)
  } else {
    console.error("[Crocido] Could not find 'crocido-field-selectors' div to append custom field.");
  }

  customFieldNameInput.value = ''; // Clear the input
}

// NEW HELPER FUNCTION for loading config
function addCustomFieldFromConfig(fieldName, xpath, name) {
    if (predefinedFieldSelectors[fieldName] || customFieldSelectors[fieldName]) {
        console.warn(`[Crocido] Field '${fieldName}' already exists or is predefined. Skipping duplicate from config.`);
        return;
    }
    customFieldSelectors[fieldName] = { xpath: xpath, name: name, isCustom: true };
    const fieldSelectorsDiv = document.getElementById('crocido-field-selectors');
    if (fieldSelectorsDiv) {
        const newFieldBlock = createFieldSelectorBlock(fieldName, name);
        fieldSelectorsDiv.appendChild(newFieldBlock);
        // updateFieldSelectorBlockUI will be called by updateAllFieldSelectorBlocksUI later in loadConfigIntoUI
    } else {
        console.error("[Crocido] Could not find 'crocido-field-selectors' div to append custom field from config.");
    }
}

function createSetupUI() {
  console.log("[Crocido] createSetupUI called."); // Ensure this log is present
  if (setupSidebar) {
    setupSidebar.style.display = 'block';
    updateContainerDetectionUI(); // Update with current state
    updateAllFieldSelectorBlocksUI();
    renderPaginationMethod();
    renderDetectedXhrPatterns(); // Re-render XHR patterns if any
    renderManualCategoryUrls(); // Re-render manual category URLs
    return;
  }

  setupSidebar = document.createElement('div');
  setupSidebar.id = 'crocido-setup-sidebar';
  setupSidebar.classList.add('crocido-setup-sidebar');

  // Initial basic structure
  setupSidebar.innerHTML = `
    <h3>Crocido Scraper Setup</h3>
    <div class="crocido-config-name-section">
        <label for="crocido-config-name">Configuration Name:</label>
        <input type="text" id="crocido-config-name" value="New Config ${new Date().toISOString().slice(0,10)}">
    </div>
    <hr>
    <h4>1. Select Product Containers</h4>
    <div id="crocido-container-detection-status">Click on 2 example product containers.</div>
    <button id="crocido-preview-containers" disabled>Preview Detected Containers</button>
    <button id="crocido-reset-containers">Reset Container Selection</button>
    <hr>
    <h4>2. Define Data Fields (Relative to Container)</h4>
    <div id="crocido-field-selectors">
      <!-- Field selectors will be added here by createFieldSelectorBlock -->
    </div>
    <div id="crocido-add-custom-field-section">
        <input type="text" id="crocido-custom-field-name" placeholder="Custom field name">
        <button id="crocido-add-custom-field-btn">Add Custom Field</button>
    </div>
    <hr>
    <h4>3. Category URLs</h4>
    <div id="crocido-category-urls-section">
        <p>Enter category URLs (one per line):</p>
        <textarea id="crocido-manual-category-urls" rows="5" style="width: 95%;"></textarea>
        <button id="crocido-update-manual-categories">Update & Store Categories</button>
        <div id="crocido-manual-categories-stored-count">Stored: 0 URLs</div>
        <p>Detected from sitemap/page (auto-added): <span id="crocido-detected-category-count">0</span></p>
        <ul id="crocido-detected-category-list" style="max-height: 100px; overflow-y: auto; font-size: 0.9em;"></ul>
    </div>
    <hr>
    <h4>4. Pagination</h4>
    <div id="crocido-pagination-options">
        <label><input type="radio" name="paginationMethod" value="none" checked> None</label>
        <label><input type="radio" name="paginationMethod" value="nextButton"> Next Button</label>
        <label><input type="radio" name="paginationMethod" value="loadMoreButton"> Load More Button</label>
        <label><input type="radio"   name="paginationMethod" value="xhrInfinite"> XHR/Infinite Scroll</label>
    </div>
    <div id="crocido-pagination-selector-section" style="display: none;">
        <button id="crocido-select-pagination-element">Select Pagination Element</button>
        <span id="crocido-pagination-element-xpath"></span>
    </div>
    <div id="crocido-xhr-patterns-section" style="display:none;">
        <p>Detected XHR URL Patterns (for xhrInfinite):</p>
        <ul id="crocido-xhr-list"></ul>
        <button id="crocido-clear-xhr-patterns">Clear Detected Patterns</button>
    </div>
    <hr>
    <button id="crocido-save-config">Save Configuration</button>
    <button id="crocido-close-setup">Close Setup</button>
    <div id="crocido-status-message" style="margin-top:10px; color: green;"></div>
  `;

  document.body.appendChild(setupSidebar);

  // Add listeners for new UI elements
  document.getElementById('crocido-reset-containers').addEventListener('click', resetContainerSelection);
  document.getElementById('crocido-preview-containers').addEventListener('click', () => {
    if (detectedProductContainerXPath) {
      previewProductContainers(detectedProductContainerXPath);
    } else {
      alert("Please select 2 container examples first, or a common XPath could not be determined.");
    }
  });

  document.getElementById('crocido-add-custom-field-btn').addEventListener('click', handleAddCustomField);


  // Add listeners for pagination options
  document.querySelectorAll('input[name="paginationMethod"]').forEach(radio => {
    radio.addEventListener('change', handlePaginationMethodChange);
  });
  document.getElementById('crocido-select-pagination-element').addEventListener('click', () => {
    isSelectingPaginationElement = true;
    // Provide feedback to the user (e.g., change cursor, show message)
    document.getElementById('crocido-status-message').textContent = "Click on the pagination element (e.g., Next or Load More button).";
    hideSetupSidebarTemporarily();
  });

   document.getElementById('crocido-clear-xhr-patterns').addEventListener('click', () => {
        currentConfigFromUI.detectedXhrPatterns = [];
        chrome.runtime.sendMessage({ action: "clearXhrPatternsInMemory" }, response => { // Inform background if it's also storing them
            console.log(response.status);
        });
        renderDetectedXhrPatterns(); // Update UI
    });

  // Create blocks for predefined fields
  const fieldSelectorsDiv = document.getElementById('crocido-field-selectors');
  if (fieldSelectorsDiv) {
    Object.keys(predefinedFieldSelectors).forEach(fieldName => {
      const field = predefinedFieldSelectors[fieldName];
      const newFieldBlock = createFieldSelectorBlock(field.name, field.name); // Use name as label for predefined
      fieldSelectorsDiv.appendChild(newFieldBlock);
    });
  } else {
    console.error("[Crocido] Could not find 'crocido-field-selectors' div to append predefined fields.");
  }

  document.getElementById('crocido-save-config').addEventListener('click', saveCurrentConfig);
  document.getElementById('crocido-close-setup').addEventListener('click', () => toggleSetupMode(false));
  
  // Listener for the new category URL update button
  document.getElementById('crocido-update-manual-categories').addEventListener('click', updateManualCategoriesFromTextarea);


  // Initial UI updates based on any existing state
  updateContainerDetectionUI();
  updateAllFieldSelectorBlocksUI();
  renderPaginationMethod();
  renderDetectedXhrPatterns();
  loadConfigIntoUI(currentConfigFromUI); // Load current state if any (e.g. from storage)
  renderManualCategoryUrls(); // Render manual category URLs
}

function createFieldSelectorBlock(fieldName, labelText) {
  const fieldBlock = document.createElement('div');
  fieldBlock.className = 'crocido-field-selector';
  fieldBlock.innerHTML = `
    <label for="xpath-${fieldName}">${labelText}:</label>
    <input type="text" id="xpath-${fieldName}" data-field="${fieldName}" readonly placeholder="XPath for ${labelText}">
    <button class="crocido-select-field-btn crocido-btn crocido-btn-sm" data-field="${fieldName}">Select ${labelText}</button>
    <button class="crocido-clear-field-btn crocido-btn crocido-btn-sm crocido-btn-link" data-field="${fieldName}" disabled>Clear</button>
  `;

  fieldBlock.querySelector('.crocido-select-field-btn').addEventListener('click', (event) => {
    currentFieldSelectionMode = event.target.dataset.field;
    isSelectingPaginationElement = false; // Not selecting pagination if selecting a field
    alert(`Click on the ${labelText} within one of the product containers.`);
    // Highlight containers to guide user where to click
    if(detectedProductContainerXPath) previewProductContainers(detectedProductContainerXPath);

  });

  fieldBlock.querySelector('.crocido-clear-field-btn').addEventListener('click', (event) => {
    const fieldKey = event.target.dataset.field;
    // Check if it's a predefined or custom field to update the correct object
    if (predefinedFieldSelectors[fieldKey]) {
        predefinedFieldSelectors[fieldKey].xpath = '';
    } else if (customFieldSelectors[fieldKey]) {
        // For custom fields, clearing means removing it entirely
        delete customFieldSelectors[fieldKey];
        // Remove the field block from the UI
        event.target.closest('.crocido-field-selector').remove(); 
        // If we remove the block, no need to call updateFieldSelectorBlockUI for this field
        // However, we might need to update the main config object if it was saved there
        const fieldIndexInConfig = currentConfigFromUI.selectors.findIndex(s => s.id === fieldKey);
        if (fieldIndexInConfig > -1) {
            currentConfigFromUI.selectors.splice(fieldIndexInConfig, 1);
        }
        return; // Exit early as the block is removed
    }
    updateFieldSelectorBlockUI(fieldKey);
  });

  return fieldBlock;
}

function updateFieldSelectorBlockUI(fieldName) {
  if (!setupSidebar) return;
  const input = setupSidebar.querySelector(`#xpath-${fieldName}`);
  const selectBtn = setupSidebar.querySelector(`.crocido-select-field-btn[data-field="${fieldName}"]`);
  const clearBtn = setupSidebar.querySelector(`.crocido-clear-field-btn[data-field="${fieldName}"]`);

  // Determine if it's a predefined or custom field
  let fieldData = predefinedFieldSelectors[fieldName] || customFieldSelectors[fieldName];

  if (input && fieldData) {
    input.value = fieldData.xpath || '';
    if (fieldData.xpath) {
      selectBtn.disabled = true; // Or change text to "Reselect"
      clearBtn.disabled = false;
    } else {
      selectBtn.disabled = false;
      clearBtn.disabled = true;
    }
  } else if (!fieldData && input) {
      // This case might happen if a custom field was just cleared and its block removed.
      // If the block wasn't removed (e.g. error or different logic), ensure UI is clear.
      input.value = '';
      if(selectBtn) selectBtn.disabled = false;
      if(clearBtn) clearBtn.disabled = true;
  }
}

function updateAllFieldSelectorBlocksUI() {
    Object.keys(predefinedFieldSelectors).forEach(fieldName => {
        updateFieldSelectorBlockUI(fieldName);
    });
    Object.keys(customFieldSelectors).forEach(fieldName => {
        updateFieldSelectorBlockUI(fieldName);
    });
}

function handlePaginationMethodChange(event) {
  if (!setupSidebar) return;
  const selectedMethod = event.target.value;
  const paginationSelectorSection = document.getElementById('crocido-pagination-selector-section');
  const xhrPatternsSection = document.getElementById('crocido-xhr-patterns-section');

  if (selectedMethod === 'nextButton' || selectedMethod === 'loadMoreButton') {
    paginationSelectorSection.style.display = 'block';
    xhrPatternsSection.style.display = 'none';
    if (currentConfigFromUI) currentConfigFromUI.paginationMethod = selectedMethod;
  } else if (selectedMethod === 'xhrInfinite') {
    paginationSelectorSection.style.display = 'none';
    xhrPatternsSection.style.display = 'block';
    if (currentConfigFromUI) currentConfigFromUI.paginationMethod = selectedMethod;
    // Start XHR detection if not already active and this method is chosen
    // startXhrDetection(); // This is called globally when setup mode starts
    renderDetectedXhrPatterns(); // Re-render if switching to this view
  } else { // 'none'
    paginationSelectorSection.style.display = 'none';
    xhrPatternsSection.style.display = 'none';
    if (currentConfigFromUI) currentConfigFromUI.paginationMethod = selectedMethod;
  }
}

function renderPaginationMethod() {
  if (!setupSidebar || !currentConfigFromUI) return;
  const method = currentConfigFromUI.paginationMethod || 'none';
  const radioToCheck = document.querySelector(`input[name="paginationMethod"][value="${method}"]`);
  if (radioToCheck) {
    radioToCheck.checked = true;
    // Manually trigger the change handler to update UI sections visibility
    handlePaginationMethodChange({ target: radioToCheck });
  }
  // Ensure details (like selected XPath) are also rendered if applicable
  const paginationElementXpathDisplay = document.getElementById('crocido-pagination-element-xpath');
  if (paginationElementXpathDisplay && currentConfigFromUI.paginationDetails) {
    if (method === 'nextButton' || method === 'loadMoreButton') {
        paginationElementXpathDisplay.textContent = currentConfigFromUI.paginationDetails.selector || '';
    } else {
        paginationElementXpathDisplay.textContent = '';
    }
  }
}

// Store for detected XHR patterns for current session (not persisted across page loads unless saved in config)
// let currentDetectedXhrPatternsForSaving = []; // This is now currentConfigFromUI.detectedXhrPatterns
function renderDetectedXhrPatterns() {
    if (!setupSidebar) return;
    const xhrList = setupSidebar.querySelector('#crocido-xhr-list'); // Changed from displayDiv
    if (!xhrList) {
        console.warn("Could not find #crocido-xhr-list element for rendering XHR patterns.");
        return;
    }

    xhrList.innerHTML = ''; // Clear previous
    const patterns = currentConfigFromUI.detectedXhrPatterns || [];

    if (patterns.length === 0) {
        const  placeholderLi = document.createElement('li');
        placeholderLi.textContent = "Scroll the page to detect XHRs for infinite loading, or they will appear here if loaded from config.";
        xhrList.appendChild(placeholderLi);
      } else {
        patterns.forEach((pattern, index) => {
            const li = document.createElement('li');
            li.textContent = `${pattern.method || 'ANY'}: ${pattern.url.substring(0,100)}${pattern.url.length > 100 ? '...' : ''}`;
            
            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'crocido-btn-link crocido-btn-sm'; // Assuming these classes exist
            removeBtn.style.marginLeft = '10px';
            removeBtn.onclick = () => {
                currentConfigFromUI.detectedXhrPatterns.splice(index, 1);
                renderDetectedXhrPatterns(); // Re-render the list
            };
            li.appendChild(removeBtn);
            xhrList.appendChild(li);
        });
    }
}

// Event handler for mouseover to show highlighter and tooltip
function handleMouseOver(event) {
  if (!isSetupModeActive || (setupSidebar && setupSidebar.contains(event.target))) {
    return;
  }
  const element = event.target;
  showHighlighter(element);
  // showTooltip(element, getXPath(element)); // Tooltip can be noisy, optional
}

// Event handler for mouseout to hide highlighter and tooltip
function handleMouseOut(event) {
  if (!isSetupModeActive) return;
  hideHighlighter();
  // hideTooltip();
}

// Main click handler - MODIFIED for relative field XPaths
function handleClick(event) {
  if (!isSetupModeActive || (setupSidebar && setupSidebar.contains(event.target))) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();

  const clickedElement = event.target;
  hideHighlighter();

  if (productContainerSelectionMode) {
    const xpath = getXPath(clickedElement); // Absolute XPath for containers
    console.log("[Crocido] Clicked element XPath for Container Selection:", xpath);
    if (!selectedContainerXPaths.includes(xpath)) {
      selectedContainerXPaths.push(xpath);
      const tempHighlight = document.createElement('div');
      tempHighlight.className = 'crocido-temp-container-selection-highlight';
      document.body.appendChild(tempHighlight);
      const rect = clickedElement.getBoundingClientRect();
      Object.assign(tempHighlight.style, {
          position: 'absolute',
          left: rect.left + window.scrollX + 'px',
          top: rect.top + window.scrollY + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px',
          backgroundColor: 'rgba(255, 165, 0, 0.3)',
          border: '2px solid orange',
          zIndex: '9998',
          pointerEvents: 'none'
      });
      setTimeout(() => tempHighlight.remove(), 1200);

      if (selectedContainerXPaths.length === 2) {
        detectedProductContainerXPath = generalizeProductContainerXPaths(selectedContainerXPaths[0], selectedContainerXPaths[1]);
        console.log("[Crocido] Detected Product Container XPath from generalization:", detectedProductContainerXPath);
        if (detectedProductContainerXPath) {
            productContainerSelectionMode = false;
        }
      }
    }
    updateContainerDetectionUI();
    previewProductContainers(detectedProductContainerXPath || (selectedContainerXPaths.length > 0 ? selectedContainerXPaths[selectedContainerXPaths.length -1] : null) );

  } else if (isSelectingPaginationElement) { // Keep this variable separate from currentFieldSelectionMode
    const xpath = getXPath(clickedElement);
    console.log("[Crocido] Clicked element XPath for Pagination:", xpath);
    currentConfigFromUI.paginationDetails.selector = xpath;
    const paginationElementXpathDisplay = document.getElementById('crocido-pagination-element-xpath');
    if (paginationElementXpathDisplay) paginationElementXpathDisplay.textContent = xpath;
    alert(`Pagination element XPath set to: ${xpath}`);
    isSelectingPaginationElement = false;
    showSetupSidebarFromTemporaryHide();

  } else if (currentFieldSelectionMode) { 
    let fieldObject;
    let fieldKey = currentFieldSelectionMode; 

    if (predefinedFieldSelectors[fieldKey]) {
        fieldObject = predefinedFieldSelectors[fieldKey];
    } else if (customFieldSelectors[fieldKey]) {
        fieldObject = customFieldSelectors[fieldKey];
    }

    if (fieldObject) {
        let finalXpathToStore = null;
        if (detectedProductContainerXPath) {
            let parentContainerElement = null;
            try {
                const containerNodes = document.evaluate(detectedProductContainerXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < containerNodes.snapshotLength; i++) {
                    const containerInstance = containerNodes.snapshotItem(i);
                    if (containerInstance.contains(clickedElement)) {
                        parentContainerElement = containerInstance;
                        break;
                    }
                }
            } catch (e) {
                console.error("Error evaluating product container XPath during field selection:", e);
                alert("Error with product container XPath. Cannot determine relative field path. Please reset containers.");
                return;
            }

            if (!parentContainerElement) {
                alert("Please click on the field INSIDE one of the highlighted product containers.");
                previewProductContainers(detectedProductContainerXPath);
                return;
            }
            finalXpathToStore = getXPath(clickedElement, parentContainerElement);
            console.log(`[Crocido] Relative XPath for ${fieldObject.name}: ${finalXpathToStore}`);
        } else {
            finalXpathToStore = getXPath(clickedElement);
            console.warn(`[Crocido] No product container defined. Storing absolute XPath for ${fieldObject.name}: ${finalXpathToStore}`);
            alert("Warning: No product container is defined. The XPath for this field will be absolute and might not work well for multiple items.");
        }

        fieldObject.xpath = finalXpathToStore;
        updateFieldSelectorBlockUI(fieldKey);
        alert(`${fieldObject.name} XPath set to: ${finalXpathToStore}`);
        currentFieldSelectionMode = null;
        if(detectedProductContainerXPath) previewProductContainers(detectedProductContainerXPath);
    } else {
        console.warn("currentFieldSelectionMode was set, but no matching field object found for key:", fieldKey);
        currentFieldSelectionMode = null; // Reset to avoid issues
    }
  }
}

function destroySetupUI() {
  if (setupSidebar) {
    setupSidebar.remove();
    setupSidebar = null;
  }
  if (highlighter) {
    highlighter.remove();
    highlighter = null;
  }
  if (tooltip) {
    tooltip.remove();
    tooltip = null;
  }
  clearContainerPreviewHighlighters();
  stopXhrDetection(); // Stop XHR monitoring
}

// Main function to toggle setup mode
function toggleSetupMode(isActive) {
  console.log(`[Crocido] toggleSetupMode called with isActive: ${isActive}`); // Ensure this log is present
  isSetupModeActive = isActive;
  if (isSetupModeActive) {
    createSetupUI();
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleClick, true); // Use capture phase for click
    // startXhrDetection(); // Ensure this line is REMOVED or commented out
  } else {
    destroySetupUI();
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    document.removeEventListener('click', handleClick, true);
    // stopXhrDetection(); // Ensure this line is REMOVED or commented out
    // Reset states
    productContainerSelectionMode = false;
    selectedContainerXPaths = [];
    detectedProductContainerXPath = null;
    currentFieldSelectionMode = null;
    isSelectingPaginationElement = false;
  }
}

// COMBINED_MESSAGE_LISTENER_START
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Crocido] Message received in content_script:", message.action, "Sender origin:", sender.origin, "Sender tab:", sender.tab ? sender.tab.id : "N/A");

  // Actions from the original first listener (around line 763)
  if (message.action === "startSetup") {
    // Expect this from popup (no sender.tab) or specific extension ID
    if (!sender.tab) { 
      console.log("[Crocido] Handling startSetup action from popup/extension.");
      toggleSetupMode(true);
      sendResponse({ status: "Setup mode activated in content script." });
    } else {
      // console.warn("[Crocido] startSetup message received from a tab. If intended, review sender logic.");
      // Potentially allow if it's from own extension tab? For now, strict to non-tab senders for popup.
      sendResponse({ status: "startSetup ignored, sender was a tab."});
    }
  } else if (message.action === "cancelSetup") {
    if (!sender.tab) {
      console.log("[Crocido] Handling cancelSetup action from popup/extension.");
      toggleSetupMode(false);
      sendResponse({ status: "Setup mode deactivated." });
    }
  } else if (message.action === "getConfigurationForCurrentTab") {
    console.log("[Crocido] Handling getConfigurationForCurrentTab action.");
    if (isSetupModeActive && detectedProductContainerXPath && Object.values(predefinedFieldSelectors).some(s => s.xpath)) {
        const configNameInput = document.getElementById('crocido-config-name');
        const configName = configNameInput ? configNameInput.value : "Auto Config";
        const domain = window.location.hostname;
        const finalSelectors = Object.values(predefinedFieldSelectors).filter(s => s.xpath);
        const paginationMethodRadio = document.querySelector('input[name="paginationMethod"]:checked');
        const paginationMethodValue = paginationMethodRadio ? paginationMethodRadio.value : "none";
        let paginationDetailsValue = {};

        if (paginationMethodValue === 'nextButton' || paginationMethodValue === 'loadMoreButton') {
            const paginationElementXpathEl = document.getElementById('crocido-pagination-element-xpath');
            if (paginationElementXpathEl) paginationDetailsValue.selector = paginationElementXpathEl.textContent;
        } else if (paginationMethodValue === 'xhrInfinite') {
             paginationDetailsValue.xhrPatterns = currentConfigFromUI.detectedXhrPatterns || [];
        }

        sendResponse({
            configName: configName,
            domain: domain,
            productContainersXpath: detectedProductContainerXPath,
            selectors: finalSelectors,
            paginationMethod: paginationMethodValue,
            paginationDetails: paginationDetailsValue,
            detectedXhrPatterns: currentConfigFromUI.detectedXhrPatterns || [],
            status: "Configuration available"
        });
    } else {
        sendResponse({ status: "Configuration not ready or setup not active." });
    }
  // Actions from the original second listener (around line 1109)
  } else if (message.action === "activateSetupMode") { 
    console.log("[Crocido] Handling activateSetupMode action (ensure this is not clashing with 'startSetup').");
    // This seems redundant if popup sends "startSetup". Consider merging or ensuring distinct use cases.
    isSetupModeActive = true;
    createSetupUI();
    sendResponse({status: "Setup mode activated via activateSetupMode"});
  } else if (message.action === "deactivateSetupMode") {
    console.log("[Crocido] Handling deactivateSetupMode action.");
    isSetupModeActive = false;
    destroySetupUI();
    sendResponse({status: "Setup mode deactivated via deactivateSetupMode"});
  } else if (message.action === "updateCurrentConfig") { 
    console.log("[Crocido] Handling updateCurrentConfig action.");
    if (message.config) {
      console.log("Content script received 'updateCurrentConfig' from background:", message.config);
      currentConfigFromUI = JSON.parse(JSON.stringify(message.config)); 
      if (isSetupModeActive && setupSidebar) {
         loadConfigIntoUI(currentConfigFromUI); 
      }
      sendResponse({status: "Content script currentConfig updated"});
    } else {
      sendResponse({status: "Error: No config provided in updateCurrentConfig", error: true});
    }
  } else if (message.action === "categoryDetectionComplete") { 
    console.log("[Crocido] Handling categoryDetectionComplete action.");
    if (message.detectedUrls && message.detectedUrls.length > 0) {
      message.detectedUrls.forEach(url => { 
        if (!detectedCategoryUrlsFromSitemap.includes(url)) {
          detectedCategoryUrlsFromSitemap.push(url);
        }
      });
      updateDetectedCategoryListUI();
    }
    const detectButton = document.getElementById('crocido-detect-categories-sitemap'); 
    if (detectButton) detectButton.disabled = false;
    
    const statusMsgEl = document.getElementById('crocido-status-message');
    if (statusMsgEl) {
      let messageText = "Found ";
      if (message.detectedUrls) {
        messageText += message.detectedUrls.length;
      } else {
        messageText += "0";
      }
      messageText += " categories via " + message.detectionType + ".";
      statusMsgEl.textContent = messageText;
    }
  } else if (message.action === "xhrPatternDetectedForUI") { 
    console.log("[Crocido] Handling xhrPatternDetectedForUI action.");
    if (message.pattern && isSetupModeActive && setupSidebar) {
        if (!currentConfigFromUI.detectedXhrPatterns) {
            currentConfigFromUI.detectedXhrPatterns = [];
        }
        if (!currentConfigFromUI.detectedXhrPatterns.some(p => p.url === message.pattern.url && p.method === message.pattern.method)) {
            currentConfigFromUI.detectedXhrPatterns.push(message.pattern);
            renderDetectedXhrPatterns(); 
        }
    }
    sendResponse({status: "XHR pattern noted by UI."});
  } else {
    console.warn("[Crocido] Received unhandled message action in content script:", message.action);
    sendResponse({status: "Unknown action in content script", error: true});
  }
  return true; // Keep true for asynchronous responses from any branch
});
// COMBINED_MESSAGE_LISTENER_END

// Add some basic CSS for highlighter and tooltip (can be moved to a CSS file)
const styleElement = document.createElement('style');
styleElement.textContent = `
  .crocido-highlight {
    position: absolute;
    background-color: rgba(100, 149, 237, 0.5); /* Cornflower blue */
    border: 2px solid #6495ED;
    z-index: 9999;
    pointer-events: none; /* Allow clicks to pass through */
  }
  .crocido-container-preview-highlight {
    position: absolute;
    background-color: rgba(50, 205, 50, 0.2); /* LimeGreen, more transparent */
    border: 1px dashed #32CD32;
    z-index: 9997; /* Below main highlighter */
    pointer-events: none;
  }
  .crocido-temp-container-selection-highlight {
      /* Style defined inline in handleClick for now */
  }
  .crocido-tooltip {
    position: absolute;
    background-color: black;
    color: white;
    padding: 5px;
    border-radius: 3px;
    z-index: 10000;
    font-size: 12px;
    pointer-events: none;
  }
  #crocido-setup-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 350px;
    height: 100%;
    background-color: #f0f0f0;
    border-left: 1px solid #ccc;
    box-shadow: -2px 0 5px rgba(0,0,0,0.1);
    z-index: 10000;
    overflow-y: auto;
    font-family: Arial, sans-serif;
    font-size: 14px;
  }
  .crocido-sidebar-content { padding: 15px; }
  .crocido-sidebar-close-btn {
    position: absolute;
    top: 5px;
    right: 10px;
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
  }
  .crocido-section { margin-bottom: 20px; border-bottom: 1px solid #ddd; padding-bottom: 15px; }
  .crocido-section:last-child { border-bottom: none; }
  .crocido-section h3, .crocido-section h4 { margin-top: 0; color: #333; }
  .crocido-section p { font-size: 0.9em; color: #555; margin-bottom: 8px;}
  #crocido-setup-sidebar input[type="text"], #crocido-setup-sidebar input[type="number"], #crocido-setup-sidebar select {
    width: calc(100% - 10px);
    padding: 8px 5px;
    margin-bottom: 10px;
    border: 1px solid #ccc;
    border-radius: 3px;
    box-sizing: border-box;
  }
  .crocido-btn {
    padding: 8px 12px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
    margin-right: 5px;
  }
  .crocido-btn-primary { background-color: #007bff; color: white; }
  .crocido-btn-secondary { background-color: #6c757d; color: white; }
  .crocido-btn-success { background-color: #28a745; color: white; }
  .crocido-btn-danger { background-color: #dc3545; color: white; }
  .crocido-btn-sm { padding: 5px 8px; font-size: 0.8em; }
  .crocido-btn-link { background: none; color: #007bff; text-decoration: underline; padding: 2px 4px;}
  .crocido-btn:disabled { background-color: #e9ecef; color: #6c757d; cursor: not-allowed; }
  .crocido-button-group { display: flex; margin-top: 5px; }
  .crocido-button-group .crocido-btn { flex-grow: 1; }
  .crocido-field-selector { margin-bottom: 10px; padding: 8px; background-color: #fff; border: 1px solid #e0e0e0; border-radius: 3px;}
  .crocido-field-selector label { display: block; margin-bottom: 3px; font-weight: bold; }
  #crocido-detected-xhr-patterns-display ul { list-style: none; padding-left: 0; font-size:0.85em; }
  #crocido-detected-xhr-patterns-display li { background-color: #fff; padding: 5px; margin-bottom: 3px; border-radius: 3px; border: 1px solid #eee; display:flex; justify-content: space-between; align-items:center; }
`;
document.head.appendChild(styleElement);

console.log("Crocido Selector Tool fully initialized with UI styles and generalization logic.");

function renderManualCategoryUrls() {
    const textarea = document.getElementById('crocido-manual-category-urls');
    const countDisplay = document.getElementById('crocido-manual-categories-stored-count');
    if (textarea) {
        textarea.value = manualCategoryUrls.join('\n');
    }
    if (countDisplay) {
        countDisplay.textContent = `Stored: ${manualCategoryUrls.length} URLs`;
    }
}

function updateManualCategoriesFromTextarea() {
    const textarea = document.getElementById('crocido-manual-category-urls');
    if (textarea) {
        manualCategoryUrls = textarea.value.split('\n').map(url => url.trim()).filter(url => url.length > 0 && (url.startsWith('http://') || url.startsWith('https://')));
        console.log("Updated manualCategoryUrls:", manualCategoryUrls);
        renderManualCategoryUrls(); // Update the display
        // Optionally, provide feedback to the user
        document.getElementById('crocido-status-message').textContent = `Updated ${manualCategoryUrls.length} manual category URLs.`;
         setTimeout(() => {
            if(document.getElementById('crocido-status-message')) {
                 document.getElementById('crocido-status-message').textContent = "";
            }
        }, 3000);
    }
}

async function saveCurrentConfig() {
  // ...
  const configName = document.getElementById('crocido-config-name') ? document.getElementById('crocido-config-name').value : "Untitled Config";
  const domain = window.location.hostname;

  let selectors = [];
  // Add predefined fields
  Object.keys(predefinedFieldSelectors).forEach(fieldName => {
    if (predefinedFieldSelectors[fieldName].xpath) { // Only save if an XPath is set
      selectors.push({
        id: fieldName, // Using the key as id
        name: predefinedFieldSelectors[fieldName].name,
        xpath: predefinedFieldSelectors[fieldName].xpath,
        fieldType: predefinedFieldSelectors[fieldName].name // for backward compatibility or specific handling
      });
    }
  });
  
  // Add custom fields from the customFieldSelectors object
  Object.keys(customFieldSelectors).forEach(fieldKey => {
    if (customFieldSelectors[fieldKey] && customFieldSelectors[fieldKey].xpath) { // Only save if an XPath is set
      selectors.push({
        id: fieldKey, // The sanitized key used in customFieldSelectors
        name: customFieldSelectors[fieldKey].name, // The original display name
        xpath: customFieldSelectors[fieldKey].xpath,
        fieldType: customFieldSelectors[fieldKey].name, // Or perhaps a generic 'custom' type
        isCustom: true
      });
    }
  });

  // Pagination
  const paginationMethod = document.querySelector('input[name="paginationMethod"]:checked').value;
  let paginationDetails = {};
  if (paginationMethod === 'nextButton' || paginationMethod === 'loadMoreButton') {
    paginationDetails.selector = document.getElementById('crocido-pagination-element-xpath').textContent || null;
  } else if (paginationMethod === 'xhrInfinite') {
    // XHR patterns are already part of currentConfigFromUI or updated directly from background
    // We should ensure they are correctly added to the config object here
    // Assuming currentConfigFromUI.detectedXhrPatterns is up-to-date
     paginationDetails.xhrPatterns = currentConfigFromUI.detectedXhrPatterns || [];
  }
  
  // Consolidate category URLs
  // Start with a copy of manually entered URLs
  let consolidatedCategoryUrls = [...manualCategoryUrls]; 
  // Add detected URLs, ensuring no duplicates
  detectedCategoryUrlsFromSitemap.forEach(url => {
      if (!consolidatedCategoryUrls.includes(url)) {
          consolidatedCategoryUrls.push(url);
      }
  });
  // If you have other sources like detectedPageLinkCategoryUrls, add them similarly


  const config = {
    configName: configName,
    domain: domain,
    productContainersXpath: detectedProductContainerXPath,
    selectors: selectors,
    paginationMethod: paginationMethod,
    paginationDetails: paginationDetails,
    categoryUrls: consolidatedCategoryUrls, // Use the consolidated list
    // Include other necessary fields like detectedXhrPatterns if not covered by paginationDetails
    // For XHR/Infinite, detectedXhrPatterns are crucial.
    detectedXhrPatterns: paginationMethod === 'xhrInfinite' ? (currentConfigFromUI.detectedXhrPatterns || []) : []
  };

  console.log("Configuration to save:", config);
  // Send to background script to save
  chrome.runtime.sendMessage({
    action: "saveConfiguration",
    config: config
  }, response => {
    if (chrome.runtime.lastError) {
      console.error("Error saving config:", chrome.runtime.lastError.message);
      alert("Error saving config: " + chrome.runtime.lastError.message);
    } else {
      console.log("Save config response:", response);
      alert(response.status || "Configuration saved/updated.");
      if (response.success) {
          // Optionally close or reset UI
          // toggleSetupMode(false); 
      }
    }
  });
}

function loadConfigIntoUI(config) {
  if (!config) return;
  if (!setupSidebar) createSetupUI(); // Ensure UI is created

  console.log("Loading config into UI:", JSON.parse(JSON.stringify(config)));

  // Config Name
  const configNameInput = document.getElementById('crocido-config-name');
  if (configNameInput) configNameInput.value = config.configName || `Config for ${config.domain || 'current site'}`;

  // Product Containers
  if (config.productContainersXpath) {
    detectedProductContainerXPath = config.productContainersXpath;
    selectedContainerXPaths = []; // Reset individual selections if loading a generalized one
  }
  updateContainerDetectionUI();

  // Field Selectors
  const fieldSelectorsDiv = document.getElementById('crocido-field-selectors');
  if (fieldSelectorsDiv) {
    const childrenToRemove = [];
    for (let i = 0; i < fieldSelectorsDiv.children.length; i++) {
        const child = fieldSelectorsDiv.children[i];
        const fieldKey = child.querySelector('[data-field]')?.dataset.field;
        // If it has a fieldKey and it's NOT in predefined, it's a custom one added by load/add
        if (fieldKey && !predefinedFieldSelectors[fieldKey]) {
            childrenToRemove.push(child);
        }
    }
    childrenToRemove.forEach(child => child.remove());
  }
  customFieldSelectors = {}; // Clear custom selectors data
  
  // Reset XPaths for predefined fields before loading
  Object.keys(predefinedFieldSelectors).forEach(fieldName => {
    predefinedFieldSelectors[fieldName].xpath = ''; 
  });

  if (config.selectors && Array.isArray(config.selectors)) {
    config.selectors.forEach(selector => {
      // selector.id should be the key (sanitized name), selector.name is display name
      const fieldKey = selector.id || selector.name; // Fallback to name if id is missing for older configs
      if (predefinedFieldSelectors[fieldKey]) {
        predefinedFieldSelectors[fieldKey].xpath = selector.xpath;
      } else {
        // This is a custom field from the loaded config
        // Use the fieldKey (which should be the sanitized version if available) and original name for display
        addCustomFieldFromConfig(fieldKey, selector.xpath, selector.name || fieldKey);
      }
    });
  }
  updateAllFieldSelectorBlocksUI();

  // Category URLs
  manualCategoryUrls = config.categoryUrls ? [...config.categoryUrls] : []; // Populate manual list from loaded config
  // Note: detectedCategoryUrlsFromSitemap is typically live data and might not be part of a saved static config in this way,
  // or if it is, decide if you want to merge or replace. For now, manual list takes loaded URLs.
  renderManualCategoryUrls();
  // If your config *also* stores sitemap URLs separately and you want to display them:
  // detectedCategoryUrlsFromSitemap = config.sitemapUrls || []; // Example
  // updateDetectedCategoryListUI(); // You'd need this function


  // Pagination Method
  const paginationMethodRadios = document.querySelectorAll('input[name="paginationMethod"]');
  let foundPaginationMethod = false;
  paginationMethodRadios.forEach(radio => {
    if (radio.value === config.paginationMethod) {
      radio.checked = true;
      foundPaginationMethod = true;
    } else {
      radio.checked = false;
    }
  });
  if (!foundPaginationMethod) { // Default to 'none' if not specified or invalid
    const noneRadio = document.querySelector('input[name="paginationMethod"][value="none"]');
    if (noneRadio) noneRadio.checked = true;
  }
  
  // Trigger the change handler to show/hide relevant sections
  handlePaginationMethodChange({ target: document.querySelector('input[name="paginationMethod"]:checked') });


  // Pagination Details (Selector or XHR patterns)
  if (config.paginationMethod === 'nextButton' || config.paginationMethod === 'loadMoreButton') {
    const paginationElementXpathDisplay = document.getElementById('crocido-pagination-element-xpath');
    if (paginationElementXpathDisplay && config.paginationDetails && config.paginationDetails.selector) {
      paginationElementXpathDisplay.textContent = config.paginationDetails.selector;
    } else if (paginationElementXpathDisplay) {
      paginationElementXpathDisplay.textContent = ''; // Clear if no selector
    }
  } else if (config.paginationMethod === 'xhrInfinite') {
    // XHR patterns should be part of the config.paginationDetails.xhrPatterns or config.detectedXhrPatterns
    currentConfigFromUI.detectedXhrPatterns = (config.paginationDetails && config.paginationDetails.xhrPatterns) ? 
                                              [...(config.paginationDetails.xhrPatterns)] : 
                                              (config.detectedXhrPatterns ? [...(config.detectedXhrPatterns)] : []);
    renderDetectedXhrPatterns();
  }


  // Update currentConfigFromUI to reflect the loaded config
  // This is important if other parts of the script rely on currentConfigFromUI being the source of truth for the UI's state.
  currentConfigFromUI = JSON.parse(JSON.stringify(config)); // Deep copy

  console.log("UI updated with loaded config. currentConfigFromUI set.");
  document.getElementById('crocido-status-message').textContent = "Configuration loaded into UI.";
  setTimeout(() => {
    if(document.getElementById('crocido-status-message')) {
      document.getElementById('crocido-status-message').textContent = "";
    }
  }, 3000);
}

function updateDetectedCategoryListUI() {
    const listElement = document.getElementById('crocido-detected-category-list');
    const countElement = document.getElementById('crocido-detected-category-count');

    if (!listElement || !countElement) return;

    listElement.innerHTML = ''; // Clear previous items
    if (detectedCategoryUrlsFromSitemap.length > 0) {
        detectedCategoryUrlsFromSitemap.forEach(url => {
            const listItem = document.createElement('li');
            listItem.textContent = url;
            listElement.appendChild(listItem);
        });
    } else {
        const listItem = document.createElement('li');
        listItem.textContent = 'No categories detected yet.';
        listElement.appendChild(listItem);
    }
    countElement.textContent = detectedCategoryUrlsFromSitemap.length;
} 