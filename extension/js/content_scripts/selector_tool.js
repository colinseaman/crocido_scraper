// selector_tool.js
console.log("Crocido Selector Tool Loaded");

let isSetupModeActive = false;
let highlighter = null;
let tooltip = null;
let setupSidebar = null;
let productContainerSelectionMode = false; // Will be 'awaitingFirstContainer', 'awaitingSecondContainer', or false
let firstSelectedContainerXPath = null; // Store the first selected container's XPath
let firstSelectedContainerElement = null; // ADDED: Store the first selected DOM element
let selectedContainerXPaths = [];
let detectedProductContainerXPath = null;
let containerPreviewHighlighters = []; // Array to store highlighter elements
let detectedCategoryUrlsFromSitemap = [];
let manualCategoryUrls = []; // To store manually added category URLs
let isSelectingPaginationElement = false; // New state variable
let currentFieldSelectionMode = null; // Possible values: "Title", "Price", "Description", "ImageSrc", null

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
  ImageSrc: { xpath: '', name: 'ImageSrc' },      // Assuming image means src
  Link: { xpath: '', name: 'Link' } // ADDED Link field
};

// Helper to get an element from an XPath
function getElementByXPath(xpath) {
  try {
    console.log("[Crocido getElementByXPath] Evaluating XPath:", xpath); // ADDED
    const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!element) {
        console.warn("[Crocido getElementByXPath] XPath did not find an element:", xpath); // ADDED
    }
    return element;
  } catch (e) {
    console.error("[Crocido getElementByXPath] Error evaluating XPath:", xpath, e);
    return null;
  }
}

// MODIFIED getXPath function
function getXPath(element, baseElement = null) {
    console.log("[Crocido getXPath] Generating XPath for element:", element, "Is baseElement:", !!baseElement, baseElement);

    if (baseElement) {
        // Strategy for more robust relative XPaths:
        // 1. Try direct child with specific classes or ID if unique within the baseElement
        // 2. Try descendant with specific classes or ID
        // 3. Fallback to basic relative path but make it less index-heavy if possible.

        let relativePath = '';
        // Attempt 1: Element's own tag and classes, if it's a direct child or easily identifiable
        const tagName = element.tagName.toLowerCase();
        let classSelector = '';
        if (element.classList && element.classList.length > 0) {
            // Create a selector from classes that are reasonably specific (e.g., not just "item")
            const specificClasses = Array.from(element.classList).filter(c => c.length > 3 && !c.startsWith('js-'));
            if (specificClasses.length > 0) {
                classSelector = specificClasses.map(c => `contains(@class, '${c}')`).join(' and ');
            }
        }

        if (classSelector) {
            relativePath = `.//${tagName}[${classSelector}]`;
            // Test this relative XPath FROM the baseElement
            try {
                const testResult = document.evaluate(relativePath, baseElement, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                let foundSelf = false;
                for (let i = 0; i < testResult.snapshotLength; i++) {
                    if (testResult.snapshotItem(i) === element) {
                        foundSelf = true;
                        break;
                    }
                }
                if (foundSelf && testResult.snapshotLength === 1) { // Ideal: unique match
                    console.log("[Crocido getXPath] Generated robust relative XPath (tag+class, unique):", relativePath);
                    return relativePath;
                } else if (foundSelf) {
                    console.log("[Crocido getXPath] Generated relative XPath (tag+class, non-unique but contains self):", relativePath);
                    // This might be okay if it's the first one. Add index if needed.
                    // For now, we'll proceed and see if the default handles indexing better for non-unique.
                    // Or, let it fall through to the more detailed path generation.
                }
            } catch (e) {
                console.warn("[Crocido getXPath] Error testing class-based relative XPath:", e);
            }
        }
         // Fallback to original relative path generation if specific class based one fails or is not specific enough
    }

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
    console.log("[Crocido getXPath] Generated XPath:", finalPath, "for element:", element); // ADDED logging
    return finalPath;
}

// New helper function for validation
function validateGeneralizedXPath(xpath, el1, el2, minCount = 2) {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (result.snapshotLength < minCount) {
      console.warn(`[Crocido Validation] XPath '${xpath}' found ${result.snapshotLength} elements, expected at least ${minCount}.`);
      return false;
    }
    
    let found1 = false;
    let found2 = false;
    for (let i = 0; i < result.snapshotLength; i++) {
      const item = result.snapshotItem(i);
      if (item === el1) found1 = true;
      if (item === el2) found2 = true;
    }

    if (found1 && found2) {
      console.log(`[Crocido Validation] XPath '${xpath}' successful. Found ${result.snapshotLength} elements, including both selected items.`);
      return true;
    } else {
      console.warn(`[Crocido Validation] XPath '${xpath}' found ${result.snapshotLength} elements, but did not include both original selections. Found1: ${found1}, Found2: ${found2}.`);
      return false;
    }
  } catch (e) {
    console.warn(`[Crocido Validation] Error evaluating XPath '${xpath}':`, e);
    return false;
  }
}

// MODIFIED: Now accepts elements directly
function generalizeProductContainerXPaths(element1, element2) { // CHANGED: Accepts elements
  console.log("[Crocido] Attempting to generalize XPaths for elements:", element1, element2);
  // const element1 = getElementByXPath(xpath1); // REMOVED
  // const element2 = getElementByXPath(xpath2); // REMOVED

  if (!element1 || !element2) {
    console.warn("[Crocido] One or both elements for generalization are null.");
    if (!element1) console.error("Element 1 is null");
    if (!element2) console.error("Element 2 is null");
    return null;
  }

  // Scenario 1: Elements are siblings
  if (element1.parentNode === element2.parentNode) {
    if (element1.tagName === element2.tagName) {
      const parentXPath = getXPath(element1.parentNode);
      const tagName = element1.tagName.toLowerCase();
      
      let classConditions = "";
      if (element1.classList.length > 0 && element2.classList.length > 0) {
        const commonClasses = Array.from(element1.classList).filter(cls => element2.classList.contains(cls));
        if (commonClasses.length > 0) {
          // Revised filter for specific classes
          const specificCommonClasses = commonClasses.filter(c => c.length > 3 && !c.startsWith("js-"));
          const classesToUse = specificCommonClasses.length > 0 ? specificCommonClasses : commonClasses;
          if (classesToUse.length > 0) {
            classConditions = classesToUse.map(cls => `contains(@class, '${cls}')`).join(' and ');
          }
        }
      }

      // Attempt 1.1: Siblings, common tag, common classes
      if (classConditions) {
        const generalizedXPath = `${parentXPath}/${tagName}[${classConditions}]`;
        console.log("[Crocido] Attempting SIBLING generalization (tag + classes):", generalizedXPath);
        if (validateGeneralizedXPath(generalizedXPath, element1, element2)) {
          return generalizedXPath;
        }
      }
      
      // Attempt 1.2: Siblings, common tag, NO common classes (or class-based failed)
      const generalizedXPathTagOnly = `${parentXPath}/${tagName}`;
      console.log("[Crocido] Attempting SIBLING generalization (tag only):", generalizedXPathTagOnly);
      if (validateGeneralizedXPath(generalizedXPathTagOnly, element1, element2)) {
        return generalizedXPathTagOnly;
      }
    } else {
      console.warn("[Crocido] Selected elements are siblings but have different tags. Cannot use sibling generalization by tag.", element1.tagName, element2.tagName);
    }
  }

  // Scenario 2: Elements are NOT siblings, or sibling generalization failed.
  // Try global search with tag and common classes if elements share a tag.
  if (element1.tagName === element2.tagName) {
      if (element1.classList.length > 0 && element2.classList.length > 0) {
        const tagName = element1.tagName.toLowerCase();
        const commonClasses = Array.from(element1.classList).filter(cls => element2.classList.contains(cls));
        if (commonClasses.length > 0) {
          const specificCommonClasses = commonClasses.filter(c => c.length > 3 && !c.startsWith("js-"));
          const classesToUse = specificCommonClasses.length > 0 ? specificCommonClasses : commonClasses;
          if (classesToUse.length > 0) {
            const classConditions = classesToUse.map(cls => `contains(@class, '${cls}')`).join(' and ');
            const generalizedXPath = `//${tagName}[${classConditions}]`;
            console.log("[Crocido] Attempting GLOBAL generalization (tag + classes):", generalizedXPath);
            if (validateGeneralizedXPath(generalizedXPath, element1, element2)) {
              return generalizedXPath;
            }
          }
        }
      }

      // Scenario 3: Fallback to common ancestor + child tag
      const ancestorPath = findCommonAncestorXPath([element1, element2]); // CHANGED: Pass elements
      const childTagName = element1.tagName.toLowerCase();
      if (ancestorPath) {
        const generalizedXPathAncestorChild = `${ancestorPath}/${childTagName}`;
        console.log("[Crocido] Attempting FALLBACK generalization (common ancestor + child tag):", generalizedXPathAncestorChild);
        if (validateGeneralizedXPath(generalizedXPathAncestorChild, element1, element2)) {
          return generalizedXPathAncestorChild;
        }
      }
  }


  console.warn("[Crocido] All generalization strategies failed. Falling back to the direct common ancestor path. This will likely select the parent container, not the list of items. Check if the two selected items are truly representative and share a clear common structure or parent.");
  const directAncestorPath = findCommonAncestorXPath([element1, element2]); // CHANGED: Pass elements
  if (directAncestorPath && element1 && element2) { // Ensure elements are available for this check
      try {
        const resultTest = document.evaluate(directAncestorPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (resultTest.snapshotLength === 1) {
            const singleMatch = resultTest.snapshotItem(0);
            // Check if element1 and element2 are not null before calling contains
            if (singleMatch && element1 && element2 && singleMatch.contains(element1) && singleMatch.contains(element2)) {
                 console.warn(`[Crocido] The final fallback XPath '${directAncestorPath}' selects a single element that is an ancestor of both your selections. This means it's selecting a parent/wrapper, not the list of items themselves. You may need to select two items that are more direct siblings or have a more obvious repeating pattern at a lower level.`);
            }
        }
      } catch(e) { console.warn("[Crocido] Error during diagnostic check for direct ancestor path:", e); }
  }
  return directAncestorPath; 
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

// MODIFIED: Accepts array of elements
function findCommonAncestorXPath(elements) { // CHANGED: Accepts elements
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return getXPath(elements[0]); // Get XPath of the single element

  // Convert elements to their XPaths for path splitting logic (original logic can remain similar)
  // Or, alternatively, walk up the DOM tree directly. Let's try DOM walking for robustness.

  if (elements.some(el => !el)) {
    console.warn("[Crocido findCommonAncestorXPath] One or more elements in the list are null.");
    return "/"; // Cannot determine common ancestor
  }
  
  let ancestors = [];
  let currentElement = elements[0];
  while (currentElement) {
    ancestors.push(currentElement);
    currentElement = currentElement.parentNode;
  }

  for (let i = 1; i < elements.length; i++) {
    let currentAncestors = [];
    let el = elements[i];
    while (el) {
      if (ancestors.includes(el)) { // Found a common ancestor
        // Prune the 'ancestors' list to this common one and its parents
        ancestors = ancestors.slice(ancestors.indexOf(el));
        break; 
      }
      el = el.parentNode;
    }
    if (!el) { // No common ancestor found with the current element in the list
      console.warn("[Crocido findCommonAncestorXPath] No common ancestor found for all elements.");
      return "/"; // Or a more appropriate fallback like body or html
    }
  }
  
  // The first element in the 'ancestors' list is now the lowest common ancestor
  if (ancestors.length > 0) {
    const commonAncestorElement = ancestors[0];
    console.log("[Crocido findCommonAncestorXPath] Common ancestor element found:", commonAncestorElement);
    return getXPath(commonAncestorElement); // Return XPath of the common ancestor element
  }

  console.warn("[Crocido findCommonAncestorXPath] Could not determine common ancestor. Defaulting to root.");
  return "/"; // Default if truly no commonality or error
}

function clearContainerPreviewHighlighters() {
  containerPreviewHighlighters.forEach(h => h.remove());
  containerPreviewHighlighters = [];
}

function resetContainerSelection() {
  // Clear existing highlights for individual containers if any
  if (containerPreviewHighlighters && containerPreviewHighlighters.length > 0) {
      containerPreviewHighlighters.forEach(h => h.remove());
      containerPreviewHighlighters = [];
  }
  
  productContainerSelectionMode = 'awaitingFirstContainer'; // Start by waiting for the first
  firstSelectedContainerXPath = null;
  detectedProductContainerXPath = null; // Clear any previously detected/generalized XPath
  currentConfigFromUI.productContainersXpath = null; // Clear from config object

  // Update UI elements
  const pcStatus = document.getElementById('crocido-product-container-status');
  const pcXpathDisplay = document.getElementById('crocido-pc-xpath-display');
  const pcCountDisplay = document.getElementById('crocido-pc-count-display');
  const previewButton = document.getElementById('crocido-preview-pc-button');
  const clearButton = document.getElementById('crocido-clear-pc-button');
  const selectButton = document.getElementById('crocido-select-pc-button');

  if (pcStatus) pcStatus.textContent = 'Select the FIRST product container.';
  if (pcXpathDisplay) pcXpathDisplay.textContent = 'No container XPath generated yet.';
  if (pcCountDisplay) pcCountDisplay.textContent = '';
  if (previewButton) previewButton.disabled = true;
  if (selectButton) selectButton.textContent = 'Select First Container'; // Or similar text

  console.log("[Crocido] Product container selection reset. Mode: awaitingFirstContainer");
  updateContainerDetectionUI(); // Call this to refresh the entire block's state
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
  const pcStatus = document.getElementById('crocido-product-container-status');
  const pcXpathDisplay = document.getElementById('crocido-pc-xpath-display');
  const pcCountDisplay = document.getElementById('crocido-pc-count-display');
  const previewButton = document.getElementById('crocido-preview-pc-button');
  const clearButton = document.getElementById('crocido-clear-pc-button');
  const selectButton = document.getElementById('crocido-select-pc-button'); // Assuming this button starts the process or indicates current state

  if (!pcStatus || !pcXpathDisplay || !pcCountDisplay || !previewButton || !clearButton || !selectButton) {
    console.warn("[Crocido] One or more UI elements for container detection are missing.");
    return;
  }

  clearContainerPreviewHighlighters(); // Clear previous previews

  if (productContainerSelectionMode === 'awaitingFirstContainer') {
    pcStatus.textContent = 'Click on the FIRST example of a product container.';
    selectButton.textContent = 'Cancel Selection'; // Or "Stop Selecting"
    pcXpathDisplay.textContent = firstSelectedContainerXPath ? `1st: ${firstSelectedContainerXPath}` : 'No first container selected.';
    pcCountDisplay.textContent = '';
    previewButton.disabled = true;
  } else if (productContainerSelectionMode === 'awaitingSecondContainer') {
    pcStatus.textContent = 'Click on a SECOND, DISTINCT example of a product container.';
    selectButton.textContent = 'Cancel Selection';
    pcXpathDisplay.textContent = firstSelectedContainerXPath ? `1st: ${firstSelectedContainerXPath}` : 'Issue: First container XPath missing.';
    pcCountDisplay.textContent = '';
    previewButton.disabled = true;
  } else if (detectedProductContainerXPath) { // A generalized XPath has been set
    pcStatus.textContent = 'Product container XPath generated:';
    selectButton.textContent = 'Reselect Containers'; // To restart the 2-click process
    pcXpathDisplay.textContent = detectedProductContainerXPath;
    try {
      const elements = document.evaluate(detectedProductContainerXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      pcCountDisplay.textContent = `Matches: ${elements.snapshotLength} element(s).`;
      previewButton.disabled = elements.snapshotLength === 0;
      currentConfigFromUI.productContainersXpath = detectedProductContainerXPath; // Update config
    } catch (e) {
      pcCountDisplay.textContent = 'Error evaluating generated XPath.';
      previewButton.disabled = true;
    }
  } else { // Initial state or after clearing, not actively selecting
    pcStatus.textContent = 'Product container XPath not yet defined.';
    selectButton.textContent = 'Select Product Containers'; // To start the 2-click process
    pcXpathDisplay.textContent = 'None';
    pcCountDisplay.textContent = '';
    previewButton.disabled = true;
  }
  // Ensure the "Clear" button always calls resetContainerSelection to go back to 'awaitingFirstContainer' if active, or clear a generated one.
}

function createSetupUI() {
  console.log("[Crocido] createSetupUI called.");
  if (setupSidebar) {
    setupSidebar.style.display = 'block';
    updateContainerDetectionUI();
    updateAllFieldSelectorBlocksUI();
    renderPaginationMethod();
    renderDetectedXhrPatterns();
    renderManualCategoryUrls();
    return;
  }

  setupSidebar = document.createElement('div');
  setupSidebar.id = 'crocido-setup-sidebar';
  setupSidebar.classList.add('crocido-setup-sidebar');

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
    <hr>
    <h4>3. Category URLs</h4>
    <div id="crocido-category-urls-section">
        <p>Enter category URLs (one per line):</p>
        <textarea id="crocido-manual-category-urls" rows="5" style="width: 95%;"></textarea>
        <button id="crocido-update-manual-categories" class="crocido-btn crocido-btn-sm">Update & Store Categories</button>
        <div id="crocido-manual-categories-stored-count">Stored: 0 URLs</div>
        <p>Detected from sitemap/page (auto-added): <span id="crocido-detected-category-count">0</span></p>
        <ul id="crocido-detected-category-list" style="max-height: 100px; overflow-y: auto; font-size: 0.9em;"></ul>
    </div>
    <hr>
    <h4>4. Pagination</h4>
    <div id="crocido-pagination-options" class="crocido-button-group">
        <button class="crocido-btn crocido-btn-sm" data-method="none">None</button>
        <button class="crocido-btn crocido-btn-sm" data-method="nextButton">Next Button</button>
        <button class="crocido-btn crocido-btn-sm" data-method="loadMoreButton">Load More Button</button>
        <button class="crocido-btn crocido-btn-sm" data-method="xhrInfinite">XHR/Infinite Scroll</button>
    </div>
    <div id="crocido-pagination-selector-section" style="display: none;">
        <button id="crocido-select-pagination-element" class="crocido-btn crocido-btn-sm">Select Pagination Element</button>
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

  document.getElementById('crocido-reset-containers').addEventListener('click', resetContainerSelection);
  document.getElementById('crocido-preview-containers').addEventListener('click', () => {
    if (detectedProductContainerXPath) {
      previewProductContainers(detectedProductContainerXPath);
    } else {
      alert("Please select 2 container examples first, or a common XPath could not be determined.");
    }
  });

  document.querySelectorAll('#crocido-pagination-options button').forEach(button => {
    button.addEventListener('click', handlePaginationMethodButtonClick);
  });
  document.getElementById('crocido-select-pagination-element').addEventListener('click', () => {
    isSelectingPaginationElement = true;
    document.getElementById('crocido-status-message').textContent = "Click on the pagination element (e.g., Next or Load More button).";
    hideSetupSidebarTemporarily();
  });

   document.getElementById('crocido-clear-xhr-patterns').addEventListener('click', () => {
        currentConfigFromUI.detectedXhrPatterns = [];
        chrome.runtime.sendMessage({ action: "clearXhrPatternsInMemory" }, response => {
            console.log(response.status);
        });
        renderDetectedXhrPatterns();
    });

  const fieldSelectorsDiv = document.getElementById('crocido-field-selectors');
  if (fieldSelectorsDiv) {
    Object.keys(predefinedFieldSelectors).forEach(fieldName => {
      const field = predefinedFieldSelectors[fieldName];
      const newFieldBlock = createFieldSelectorBlock(field.name, field.name);
      fieldSelectorsDiv.appendChild(newFieldBlock);
    });
  } else {
    console.error("[Crocido] Could not find 'crocido-field-selectors' div to append predefined fields.");
  }

  document.getElementById('crocido-save-config').addEventListener('click', saveCurrentConfig);
  document.getElementById('crocido-close-setup').addEventListener('click', () => toggleSetupMode(false));
  document.getElementById('crocido-update-manual-categories').addEventListener('click', updateManualCategoriesFromTextarea);

  updateContainerDetectionUI();
  updateAllFieldSelectorBlocksUI();
  renderPaginationMethod();
  renderDetectedXhrPatterns();
  loadConfigIntoUI(currentConfigFromUI);
  renderManualCategoryUrls();

  // Product Container Section
  const pcTitle = document.createElement('h3');
  pcTitle.textContent = 'Product Containers';
  setupSidebar.appendChild(pcTitle);

  const pcStatus = document.createElement('div');
  pcStatus.id = 'crocido-product-container-status';
  pcStatus.textContent = 'Product container XPath not yet defined.';
  setupSidebar.appendChild(pcStatus);

  const pcXpathDisplay = document.createElement('div');
  pcXpathDisplay.id = 'crocido-pc-xpath-display';
  pcXpathDisplay.textContent = 'None';
  pcXpathDisplay.style.wordBreak = 'break-all';
  pcXpathDisplay.style.marginTop = '5px';
  pcXpathDisplay.style.padding = '5px';
  pcXpathDisplay.style.border = '1px solid #ccc';
  pcXpathDisplay.style.minHeight = '20px';
  setupSidebar.appendChild(pcXpathDisplay);

  const pcCountDisplay = document.createElement('div');
  pcCountDisplay.id = 'crocido-pc-count-display';
  pcCountDisplay.textContent = '';
  pcCountDisplay.style.marginTop = '5px';
  setupSidebar.appendChild(pcCountDisplay);

  const pcButtonsContainer = document.createElement('div');
  pcButtonsContainer.style.marginTop = '10px';

  const selectContainerButton = document.createElement('button');
  selectContainerButton.id = 'crocido-select-pc-button';
  selectContainerButton.textContent = 'Select Product Containers'; // Initial text
  selectContainerButton.addEventListener('click', () => {
    if (productContainerSelectionMode === 'awaitingFirstContainer' || productContainerSelectionMode === 'awaitingSecondContainer') {
      // If already selecting, this button acts as a "Cancel"
      productContainerSelectionMode = false; 
      firstSelectedContainerXPath = null;
      clearContainerPreviewHighlighters(); // Clear selection highlights
      hideHighlighter(); // Clear general hover highlighter
      hideTooltip();
      console.log("[Crocido] Product container selection cancelled by user.");
    } else {
      // If not selecting, or if an XPath is already set, this button starts/restarts the process
      // resetContainerSelection(); // This sets it to awaitingFirstContainer and updates UI
      // More explicitly for starting:
      productContainerSelectionMode = 'awaitingFirstContainer';
      firstSelectedContainerXPath = null;
      detectedProductContainerXPath = null;
      currentConfigFromUI.productContainersXpath = null;
      clearContainerPreviewHighlighters();
      console.log("[Crocido] Started product container selection. Mode: awaitingFirstContainer.");
    }
    updateContainerDetectionUI(); // Update UI based on new mode
  });
  pcButtonsContainer.appendChild(selectContainerButton);

  const previewContainerButton = document.createElement('button');
  previewContainerButton.id = 'crocido-preview-pc-button';
  previewContainerButton.textContent = 'Preview Containers';
  previewContainerButton.disabled = true; // Initially disabled
  previewContainerButton.addEventListener('click', () => {
    if (detectedProductContainerXPath) {
      previewProductContainers(detectedProductContainerXPath);
    } else {
      console.warn("[Crocido] Preview clicked but no XPath is set to preview.");
      alert("No container XPath has been generated or set yet.");
    }
  });
  pcButtonsContainer.appendChild(previewContainerButton);

  const clearContainerButton = document.createElement('button');
  clearContainerButton.id = 'crocido-clear-pc-button';
  clearContainerButton.textContent = 'Clear XPath';
  clearContainerButton.addEventListener('click', () => {
     productContainerSelectionMode = false; // Explicitly stop any active selection
     firstSelectedContainerXPath = null;
     detectedProductContainerXPath = null;
     currentConfigFromUI.productContainersXpath = null;
     clearContainerPreviewHighlighters(); // Clear any visual feedback
     hideHighlighter();
     hideTooltip();
     console.log("[Crocido] Product container XPath cleared and selection stopped.");
     updateContainerDetectionUI(); // Refresh UI to initial/cleared state
  });
  pcButtonsContainer.appendChild(clearContainerButton);
  setupSidebar.appendChild(pcButtonsContainer);
  
  // separator
  const separatorPC = document.createElement('hr');
  separatorPC.style.margin = '15px 0';
  setupSidebar.appendChild(separatorPC);

  // ... (rest of the UI creation code for fields, pagination, etc.)
  // Update initial UI states
  updateContainerDetectionUI(); 
  updateAllFieldSelectorBlocksUI();
  renderPaginationMethod();
  // renderDetectedXhrPatterns(); // Assuming this is called when patterns are available
  renderManualCategoryUrls();
  updateDetectedCategoryListUI();
}

function createFieldSelectorBlock(fieldName, labelText) {
  const fieldBlock = document.createElement('div');
  fieldBlock.className = 'crocido-field-selector';
  fieldBlock.innerHTML = `
    <label for="crocido-xpath-${fieldName}">${labelText} XPath:</label> 
    <input type="text" id="crocido-xpath-${fieldName}" name="crocido-xpath-${fieldName}" style="width: 100%; margin-bottom: 5px;" placeholder="Relative XPath to ${labelText}">
    <button class="crocido-select-field-btn crocido-btn crocido-btn-sm" data-field="${fieldName}">Auto-Select ${labelText}</button>
    <button class="crocido-clear-field-btn crocido-btn crocido-btn-sm crocido-btn-link" data-field="${fieldName}" disabled>Clear</button>
  `;

  const xpathInput = fieldBlock.querySelector(`#crocido-xpath-${fieldName}`);
  xpathInput.addEventListener('change', (event) => {
    const fieldKey = fieldName; // fieldName is in scope here
    if (predefinedFieldSelectors[fieldKey]) {
      predefinedFieldSelectors[fieldKey].xpath = event.target.value;
      console.log(`[Crocido] Manually updated XPath for ${fieldKey} to: ${event.target.value}`);
      updateFieldSelectorBlockUI(fieldKey); // Update button states, etc.
    }
  });

  fieldBlock.querySelector('.crocido-select-field-btn').addEventListener('click', (event) => {
    currentFieldSelectionMode = event.target.dataset.field;
    isSelectingPaginationElement = false; // Ensure this is reset
    // productContainerSelectionMode = false; // Ensure this is reset
    alert(`Click on the ${labelText} within one of the product containers to attempt auto-selection.\nOr, you can manually edit the XPath above.`);
    if(detectedProductContainerXPath) {
        previewProductContainers(detectedProductContainerXPath); // Highlight containers to guide user
    } else {
        alert("Please define and preview Product Containers first so field selection can be relative.");
    }
  });

  fieldBlock.querySelector('.crocido-clear-field-btn').addEventListener('click', (event) => {
    const fieldKey = event.target.dataset.field;
    if (predefinedFieldSelectors[fieldKey]) {
        predefinedFieldSelectors[fieldKey].xpath = '';
        xpathInput.value = ''; // Clear the input field
    }
    updateFieldSelectorBlockUI(fieldKey);
  });

  return fieldBlock;
}

function updateFieldSelectorBlockUI(fieldName) {
  if (!setupSidebar) return;
  const selectBtn = setupSidebar.querySelector(`.crocido-select-field-btn[data-field="${fieldName}"]`);
  const clearBtn = setupSidebar.querySelector(`.crocido-clear-field-btn[data-field="${fieldName}"]`);
  const xpathInput = setupSidebar.querySelector(`#crocido-xpath-${fieldName}`);

  let fieldData = predefinedFieldSelectors[fieldName];

  if (selectBtn && clearBtn && xpathInput && fieldData) {
    xpathInput.value = fieldData.xpath || ''; // Populate input with current XPath

    if (fieldData.xpath) {
      // selectBtn.disabled = true; // Keep select active for re-selection attempt
      selectBtn.textContent = `Attempt Re-Select ${fieldData.name}`;
      clearBtn.disabled = false;
    } else {
      // selectBtn.disabled = false;
      selectBtn.textContent = `Auto-Select ${fieldData.name}`;
      clearBtn.disabled = true;
    }
  } else if (selectBtn && clearBtn && xpathInput && !fieldData) { // Should not happen if predefinedFieldSelectors is correct
      // selectBtn.disabled = false;
      clearBtn.disabled = true;
      if (predefinedFieldSelectors[fieldName]) { // Check again, though condition implies it's false
        selectBtn.textContent = `Auto-Select ${predefinedFieldSelectors[fieldName].name}`;
      }
      xpathInput.value = '';
  }
}

function updateAllFieldSelectorBlocksUI() {
    Object.keys(predefinedFieldSelectors).forEach(fieldName => {
        updateFieldSelectorBlockUI(fieldName);
    });
}

function handlePaginationMethodButtonClick(event) {
  if (!setupSidebar) return;
  const selectedMethod = event.target.dataset.method;
  currentConfigFromUI.paginationMethod = selectedMethod;

  // Update button active states
  document.querySelectorAll('#crocido-pagination-options button').forEach(button => {
    if (button.dataset.method === selectedMethod) {
      button.classList.add('crocido-btn-active');
    } else {
      button.classList.remove('crocido-btn-active');
    }
  });

  const paginationSelectorSection = document.getElementById('crocido-pagination-selector-section');
  const xhrPatternsSection = document.getElementById('crocido-xhr-patterns-section');
  const selectPaginationElementButton = document.getElementById('crocido-select-pagination-element');

  if (selectedMethod === 'nextButton' || selectedMethod === 'loadMoreButton') {
    paginationSelectorSection.style.display = 'block';
    xhrPatternsSection.style.display = 'none';
    // Prompt to select element, this button itself is for selection
    document.getElementById('crocido-status-message').textContent = `Pagination: ${selectedMethod}. Click 'Select Pagination Element'.`;
    selectPaginationElementButton.textContent = `Select ${selectedMethod === 'nextButton' ? 'Next Button' : 'Load More Button'}`;
  } else if (selectedMethod === 'xhrInfinite') {
    paginationSelectorSection.style.display = 'none';
    xhrPatternsSection.style.display = 'block';
    document.getElementById('crocido-status-message').textContent = "Pagination: XHR/Infinite Scroll. Patterns will be detected.";
    renderDetectedXhrPatterns(); 
  } else { // 'none'
    paginationSelectorSection.style.display = 'none';
    xhrPatternsSection.style.display = 'none';
    document.getElementById('crocido-status-message').textContent = "Pagination: None.";
  }
  // Persist the change immediately to currentConfigFromUI for this part
    if (currentConfigFromUI) currentConfigFromUI.paginationMethod = selectedMethod;
}

function renderPaginationMethod() {
  if (!setupSidebar || !currentConfigFromUI) return;
  const method = currentConfigFromUI.paginationMethod || 'none';
  
  document.querySelectorAll('#crocido-pagination-options button').forEach(button => {
    if (button.dataset.method === method) {
      button.classList.add('crocido-btn-active');
    } else {
      button.classList.remove('crocido-btn-active');
    }
  });

  // Manually trigger the handler to update UI sections visibility and other details
  const activeButton = document.querySelector(`#crocido-pagination-options button[data-method="${method}"]`);
  if (activeButton) {
    handlePaginationMethodButtonClick({ target: activeButton }); 
  }

  const paginationElementXpathDisplay = document.getElementById('crocido-pagination-element-xpath');
  if (paginationElementXpathDisplay && currentConfigFromUI.paginationDetails) {
    if (method === 'nextButton' || method === 'loadMoreButton') {
        paginationElementXpathDisplay.textContent = currentConfigFromUI.paginationDetails.selector || 'No element selected';
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
  console.log(`[Crocido handleMouseOver] Active: ${isSetupModeActive}, PC Mode: ${productContainerSelectionMode}, Target not sidebar: ${!(setupSidebar && setupSidebar.contains(event.target))}`);
  if (!isSetupModeActive || (setupSidebar && setupSidebar.contains(event.target))) {
    return;
  }
  const element = event.target;
  console.log("[Crocido handleMouseOver] Showing highlighter for:", element);
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
  console.log(`[Crocido handleClick Start] Active: ${isSetupModeActive}, PC Mode: ${productContainerSelectionMode}, Field Mode: ${currentFieldSelectionMode}, Target in sidebar: ${setupSidebar && setupSidebar.contains(event.target)}`);
  if (!isSetupModeActive) return;

  // Prevent click from propagating to elements underneath setup UI
  if (setupSidebar && setupSidebar.contains(event.target)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const targetElement = event.target;
  hideHighlighter(); // Hide previous highlight
  showHighlighter(targetElement); // Highlight the new one

  if (productContainerSelectionMode === 'awaitingFirstContainer') {
    firstSelectedContainerXPath = getXPath(targetElement);
    firstSelectedContainerElement = targetElement; // ADDED: Store the DOM element
    console.log(`[Crocido] First product container selected: ${firstSelectedContainerXPath}`, firstSelectedContainerElement);
    // Highlight this first selection semi-permanently (or differently)
    // For now, the general highlighter will move, which is okay.
    // We need a way to visually distinguish the first selected container or keep its highlight.
    // Consider adding to containerPreviewHighlighters here with a special style.
    
    // Preview this single selection
    clearContainerPreviewHighlighters(); // Clear previous multi-previews
    const tempHighlighter = document.createElement('div');
    const rect = targetElement.getBoundingClientRect();
    Object.assign(tempHighlighter.style, {
        position: 'fixed',
        left: `${rect.left + window.scrollX}px`,
        top: `${rect.top + window.scrollY}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        backgroundColor: 'rgba(0, 255, 0, 0.3)', // Greenish for first selection
        border: '2px solid green',
        zIndex: '9998',
        pointerEvents: 'none'
    });
    document.body.appendChild(tempHighlighter);
    containerPreviewHighlighters.push(tempHighlighter);


    productContainerSelectionMode = 'awaitingSecondContainer';
    updateContainerDetectionUI();
    showTooltip(targetElement, `1st: ${firstSelectedContainerXPath}. Now click a SECOND product container.`);
    return; // Wait for the second click
  } else if (productContainerSelectionMode === 'awaitingSecondContainer') {
    if (!firstSelectedContainerXPath) {
      console.error("[Crocido] Cannot select second container, first was not selected.");
      showTooltip(targetElement, "Error: Select the first container again.");
      // Optionally reset to awaitingFirstContainer
      // productContainerSelectionMode = 'awaitingFirstContainer'; 
      // updateContainerDetectionUI();
      return;
    }
    const secondSelectedContainerElement = targetElement; // Get the second element
    console.log(`[Crocido] Second product container selected:`, secondSelectedContainerElement);
    
    // Highlight the second selection too
    const tempHighlighter = document.createElement('div');
    const rect = targetElement.getBoundingClientRect();
    Object.assign(tempHighlighter.style, {
        position: 'fixed',
        left: `${rect.left + window.scrollX}px`,
        top: `${rect.top + window.scrollY}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        backgroundColor: 'rgba(0, 200, 255, 0.3)', // Bluish for second selection
        border: '2px solid blue',
        zIndex: '9998',
        pointerEvents: 'none'
    });
    document.body.appendChild(tempHighlighter);
    containerPreviewHighlighters.push(tempHighlighter);

    detectedProductContainerXPath = generalizeProductContainerXPaths(firstSelectedContainerElement, secondSelectedContainerElement); 
    
    if (detectedProductContainerXPath) {
      currentConfigFromUI.productContainersXpath = detectedProductContainerXPath;
      console.log(`[Crocido] Generalized Product Container XPath: ${detectedProductContainerXPath}`);
      showTooltip(targetElement, `Generalized: ${detectedProductContainerXPath}`);
      // Preview the generalized XPath immediately
      previewProductContainers(detectedProductContainerXPath); 
    } else {
      console.warn("[Crocido] Failed to generalize product container XPath. Using fallback or none.");
      // Keep specific selections for now or fallback (findCommonAncestorXPath might already be doing this)
      // For simplicity, if generalizeProductContainerXPaths returns null/undefined, we might indicate failure.
      // currentConfigFromUI.productContainersXpath = firstSelectedContainerXPath; // Or some fallback
      showTooltip(targetElement, "Could not generalize. Try different pair or check console.");
    }
    productContainerSelectionMode = false; // End selection mode for containers
    firstSelectedContainerXPath = null; // Clear for next attempt
    firstSelectedContainerElement = null; // ADDED: Clear the stored element
    updateContainerDetectionUI(); // Update UI with the new XPath or status
    return; 
  } else if (currentFieldSelectionMode) { 
    let fieldObject;
    let fieldKey = currentFieldSelectionMode; 

    if (predefinedFieldSelectors[fieldKey]) {
        fieldObject = predefinedFieldSelectors[fieldKey];
    }

    if (fieldObject) {
        let finalXpathToStore = null;
        let clickedElementForXPath = targetElement; // Element to base XPath generation on

        if (fieldKey === 'Link') {
            const anchorParent = targetElement.closest('a');
            if (anchorParent) {
                console.log("[Crocido] Link selection: Found parent anchor:", anchorParent);
                clickedElementForXPath = anchorParent; // Use the anchor itself for XPath
                // We'll get the relative XPath to this anchor, and scraper engine will get href
            } else {
                console.warn("[Crocido] Link selection: No parent anchor found for clicked element. Using clicked element directly.");
            }
        }

        if (detectedProductContainerXPath) {
            let parentContainerElement = null;
            try {
                const containerNodes = document.evaluate(detectedProductContainerXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < containerNodes.snapshotLength; i++) {
                    const containerInstance = containerNodes.snapshotItem(i);
                    if (containerInstance.contains(targetElement)) {
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
            // Generate XPath for clickedElementForXPath (which might be the anchor for Link)
            finalXpathToStore = getXPath(clickedElementForXPath, parentContainerElement); 
            
            // If it's a Link, and we used an anchor, ensure it captures the href intent
            // The scraper engine handles getting .href, so the XPath just needs to point to the <a>
            if (fieldKey === 'Link' && clickedElementForXPath.tagName === 'A') {
                 // No specific change to finalXpathToStore needed here for /@href, 
                 // as scraper_engine/main.js extractFieldData is now designed to get .href
                 // from an element if fieldType/name is 'Link'.
                 console.log(`[Crocido] Relative XPath for Link (anchor tag): ${finalXpathToStore}`);
            } else {
                 console.log(`[Crocido] Relative XPath for ${fieldObject.name}: ${finalXpathToStore}`);
            }

        } else {
            // If no container, get direct XPath. For Link, if it's an anchor, point to it.
            if (fieldKey === 'Link' && clickedElementForXPath.tagName === 'A') {
                finalXpathToStore = getXPath(clickedElementForXPath); 
                // Again, scraper engine handles .href extraction.
                console.warn(`[Crocido] No product container. Absolute XPath for Link (anchor): ${finalXpathToStore}`);
                alert("Warning: No product container. Storing absolute XPath for Link. This might not work well for multiple items.");
            } else {
                finalXpathToStore = getXPath(clickedElementForXPath);
                console.warn(`[Crocido] No product container defined. Storing absolute XPath for ${fieldObject.name}: ${finalXpathToStore}`);
                alert("Warning: No product container is defined. The XPath for this field will be absolute and might not work well for multiple items.");
            }
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
  // stopXhrDetection(); // Stop XHR monitoring - Removed as function is not defined
}

// Main function to toggle setup mode and manage UI elements
function toggleSetupMode(isActive, configToLoad = null) {
  console.log(`[Crocido] toggleSetupMode called. isActive: ${isActive}. Config provided:`, configToLoad ? JSON.parse(JSON.stringify(configToLoad)) : 'None');
  if (isActive) {
    isSetupModeActive = true;
    createSetupUI(); // Creates the basic structure of the sidebar
    if (configToLoad) {
      console.log("[Crocido] toggleSetupMode: Loading specific config into UI:", configToLoad);
      loadConfigIntoUI(configToLoad); // Load the provided config into the UI elements
    } else {
      // If no specific config is passed, loadConfigIntoUI(null) handles creating/displaying a new default state.
      console.log("[Crocido] toggleSetupMode: No specific config provided, loading default state via loadConfigIntoUI(null).");
      loadConfigIntoUI(null); 
    }
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleClick, true); // Use capture phase for click
    console.log("[Crocido] Setup mode activated. Event listeners added.");
  } else {
    isSetupModeActive = false;
    destroySetupUI(); // Removes UI and cleans up
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    document.removeEventListener('click', handleClick, true);
    // Reset critical state variables
    productContainerSelectionMode = false;
    selectedContainerXPaths = [];
    detectedProductContainerXPath = null;
    currentFieldSelectionMode = null;
    isSelectingPaginationElement = false;
    // currentConfigFromUI = {}; // Optionally clear or reset currentConfigFromUI to a default state
    console.log("[Crocido] Setup mode deactivated. Event listeners removed and UI destroyed.");
  }
}

// Event listener for messages from the popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[Crocido Content Script] Received message - Action:", request.action, "Sender Tab ID:", sender.tab ? sender.tab.id : "N/A", "Request Data:", request);

  if (request.action === "startSetup") {
    // This message now comes from the background script (main.js) and includes the config
    console.log("[Crocido Content Script] 'startSetup' action received.");
    if (request.config) {
      console.log("[Crocido Content Script] Config received with startSetup for domain:", request.config.domain, JSON.parse(JSON.stringify(request.config)));
      toggleSetupMode(true, request.config); // Activate setup UI and load the provided config
      sendResponse({status: "Setup UI activated with received config.", loadedDomain: request.config.domain});
    } else {
      // Fallback if, for some reason, config is missing. Should ideally not happen with new flow.
      console.warn("[Crocido Content Script] 'startSetup' received WITHOUT a config. This is unexpected. Initializing default for current page.");
      toggleSetupMode(true); // Activate setup mode; toggleSetupMode will call loadConfigIntoUI(null)
      sendResponse({status: "Setup UI activated (no specific config provided, using default)."});
    }
    return true; // Indicate response may be asynchronous or to keep channel open

  } else if (request.action === "stopSetup") { // Could be triggered by a 'cancel' or 'close' from popup/background
    console.log("[Crocido Content Script] 'stopSetup' action received.");
      toggleSetupMode(false);
    sendResponse({status: "Setup UI deactivated."});
    // No return true needed if response is immediate and channel can close.

  } else if (request.action === "updateCurrentConfig") { // If background pushes an updated config (e.g., after a save)
    console.log("[Crocido Content Script] 'updateCurrentConfig' action received.");
    if (request.config) {
      console.log("Content script received 'updateCurrentConfig' from background:", JSON.parse(JSON.stringify(request.config)));
      currentConfigFromUI = JSON.parse(JSON.stringify(request.config)); // Update the global working copy
      if (isSetupModeActive && setupSidebar) {
         loadConfigIntoUI(currentConfigFromUI); // Re-load into the active UI
      }
      sendResponse({status: "Content script currentConfig updated and UI refreshed if active.", updatedDomain: request.config.domain });
    } else {
      console.error("[Crocido Content Script] Error: No config provided in updateCurrentConfig");
      sendResponse({status: "Error: No config provided in updateCurrentConfig", error: true});
    }
    return true; // Indicate async response may be used.

  } else if (request.action === "categoryDetectionComplete") {
    console.log("[Crocido Content Script] 'categoryDetectionComplete' received from:", request.source, "Type:", request.detectionType);
    console.log("[Crocido Content Script] Detected URLs:", request.detectedUrls);
    if (request.detectedUrls && Array.isArray(request.detectedUrls)) {
        request.detectedUrls.forEach(url => {
        if (!detectedCategoryUrlsFromSitemap.includes(url)) {
          detectedCategoryUrlsFromSitemap.push(url);
        }
      });
        updateDetectedCategoryListUI(); // Update the UI with the new list
        if (setupSidebar) {
            const msgElement = setupSidebar.querySelector('#crocido-category-detection-message');
            if (msgElement) {
                msgElement.textContent = `${request.detectedUrls.length} URLs from ${request.detectionType} added. Total detected: ${detectedCategoryUrlsFromSitemap.length}.`;
                setTimeout(() => { if(msgElement) msgElement.textContent = ''; }, 5000);
            }
        }
        sendResponse({status: "Category URLs updated in UI", count: detectedCategoryUrlsFromSitemap.length});
      } else {
        sendResponse({status: "No new category URLs provided or data was not an array.", count: detectedCategoryUrlsFromSitemap.length});
    }
    // Re-enable button in UI if it was disabled during detection
    const detectButton = setupSidebar ? setupSidebar.querySelector('#crocido-detect-sitemap-categories') : null; // Ensure correct ID
    if(detectButton) detectButton.disabled = false;
    return true; // Keep channel open as UI updates might be considered async by caller

  } else if (request.action === "xhrPatternDetectedForUI") { 
    console.log("[Crocido Content Script] 'xhrPatternDetectedForUI' action received.", request.pattern);
    if (request.pattern && isSetupModeActive && setupSidebar) {
        if (!currentConfigFromUI.detectedXhrPatterns) {
            currentConfigFromUI.detectedXhrPatterns = [];
        }
        // Ensure pattern is an object with url and method
        if (request.pattern.url && request.pattern.method && !currentConfigFromUI.detectedXhrPatterns.some(p => p.url === request.pattern.url && p.method === request.pattern.method)) {
            currentConfigFromUI.detectedXhrPatterns.push(request.pattern);
            renderDetectedXhrPatterns(); // Update the UI to show the new pattern
            sendResponse({status: "XHR pattern added and UI updated.", pattern: request.pattern});
        } else {
            sendResponse({status: "XHR pattern already exists or invalid.", pattern: request.pattern});
        }
    } else {
         sendResponse({status: "XHR pattern not processed; setup not active or pattern missing.", error: true});
    }
    return true;

  } else if (request.action === "executeLocalScrape") {
    console.log("[Crocido Content Script] 'executeLocalScrape' action received with config:", JSON.parse(JSON.stringify(request.config)));
    const config = request.config;
    if (!config || !config.productContainersXpath || !config.selectors || !Array.isArray(config.selectors)) {
      console.error("Local scrape cannot proceed: Essential config details missing or selectors not an array.");
      sendResponse({ success: false, error: "Essential configuration details missing or invalid for local scrape." });
      return;
    }

    // Function to perform the actual scraping on the current page
    async function performLocalScrape(currentConfig) {
      let resultsArray = [];
      console.log("[Crocido Local Scrape] Starting scrape with XPath:", currentConfig.productContainersXpath);

      try {
        const containerNodesSnapshot = document.evaluate(currentConfig.productContainersXpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        console.log("[Crocido Local Scrape] Found", containerNodesSnapshot.snapshotLength, "product containers.");

        for (let i = 0; i < containerNodesSnapshot.snapshotLength; i++) {
          const containerElement = containerNodesSnapshot.snapshotItem(i);
          let item = {};
          let allFieldsNullForThisItem = true; // Flag to check if we extracted any data for the item

          for (const selector of currentConfig.selectors) {
            let value = null;
            if (containerElement && selector.xpath) {
              try {
                // Resolve XPath relative to the containerElement
                const fieldElementSnapshot = document.evaluate(selector.xpath, containerElement, null, XPathResult.ANY_TYPE, null);
                let fieldElement = fieldElementSnapshot.snapshotItem ? fieldElementSnapshot.snapshotItem(0) : fieldElementSnapshot.singleNodeValue;
                
                if(fieldElementSnapshot.resultType === XPathResult.NUMBER_TYPE) {
                    value = fieldElementSnapshot.numberValue;
                } else if (fieldElementSnapshot.resultType === XPathResult.STRING_TYPE) {
                    value = fieldElementSnapshot.stringValue;
                } else if (fieldElementSnapshot.resultType === XPathResult.BOOLEAN_TYPE) {
                    value = fieldElementSnapshot.booleanValue;
  } else {
                    // For snapshot types or single node value from ANY_TYPE if not primitive
                    fieldElement = fieldElementSnapshot.singleNodeValue || (fieldElementSnapshot.snapshotItem && fieldElementSnapshot.snapshotItem(0));
                }

                if (fieldElement) {
                  // Smartly get content based on field type or common patterns
                  if (selector.fieldType && selector.fieldType.toLowerCase().includes('image') || selector.name.toLowerCase().includes('image')) {
                    value = fieldElement.src || fieldElement.getAttribute('data-src') || fieldElement.href;
                    // Ensure URL is absolute
                    if (value && typeof value === 'string' && !value.startsWith('http')){
                        try { value = new URL(value, window.location.href).href; } catch(e){ /* ignore if not valid relative */}
                    }
                  } else if (selector.fieldType && selector.fieldType.toLowerCase().includes('link') || selector.name.toLowerCase().includes('link')) {
                    value = fieldElement.href;
                    if (value && typeof value === 'string' && !value.startsWith('http')){
                        try { value = new URL(value, window.location.href).href; } catch(e){}
                    }
                  } else {
                    value = fieldElement.textContent;
                  }
                  if (value) value = value.trim();
                }
              } catch (e) {
                console.warn(`[Crocido Local Scrape] Error evaluating XPath "${selector.xpath}" for field "${selector.name}" within a container:`, e);
                value = null;
              }
            }
            item[selector.name || selector.id || 'field_'+i] = value;
            if (value !== null) {
                allFieldsNullForThisItem = false;
            }
          }
          if(!allFieldsNullForThisItem){
             resultsArray.push(item);
          }
        }
      } catch (e) {
        console.error("[Crocido Local Scrape] Major error during XPath evaluation for containers or field extraction:", e);
        // Send error back if a major issue occurs
        sendResponse({ success: false, error: "Error during local scrape: " + e.message });
        return; // Stop further execution in this function
      }
      
      console.log("[Crocido Local Scrape] Scraping of current page complete. Items found:", resultsArray.length);
      
      // --- Pagination Logic Start ---
      if (currentConfig.paginationMethod === 'nextButton' && currentConfig.paginationDetails && currentConfig.paginationDetails.selector) {
        console.log("[Crocido Local Scrape] Next button pagination detected. Selector:", currentConfig.paginationDetails.selector);
        let currentPage = 1; // Or 0 if you prefer 0-indexed
        const maxPages = currentConfig.paginationDetails.maxPages || 5; // Default max pages to prevent infinite loops

        while (currentPage < maxPages) {
          const nextButton = getElementByXPath(currentConfig.paginationDetails.selector);
          if (nextButton && !nextButton.disabled && nextButton.offsetParent !== null) { // Check if button exists, is enabled, and visible
            console.log(`[Crocido Local Scrape] Clicking next button (Page ${currentPage + 1}).`);
            nextButton.click();

            // Wait for new content to load - this is a critical and potentially flaky part
            // Option 1: Fixed delay (simple but unreliable)
            await new Promise(resolve => setTimeout(resolve, currentConfig.paginationDetails.delay || 3000)); // Configurable delay
            // Option 2: MutationObserver (more complex but robust - for future iteration if needed)

            console.log("[Crocido Local Scrape] Scraping content after clicking next button...");
            const nextPageContainerNodesSnapshot = document.evaluate(currentConfig.productContainersXpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            console.log("[Crocido Local Scrape] Found", nextPageContainerNodesSnapshot.snapshotLength, "product containers on new page section.");
            let itemsFromNewPage = 0;
            for (let i = 0; i < nextPageContainerNodesSnapshot.snapshotLength; i++) {
              const containerElement = nextPageContainerNodesSnapshot.snapshotItem(i);
              let item = {};
              let allFieldsNullForThisItem = true;
              for (const selector of currentConfig.selectors) {
                let value = null;
                if (containerElement && selector.xpath) {
                  try {
                    const fieldElementSnapshot = document.evaluate(selector.xpath, containerElement, null, XPathResult.ANY_TYPE, null);
                    let fieldElement = fieldElementSnapshot.snapshotItem ? fieldElementSnapshot.snapshotItem(0) : fieldElementSnapshot.singleNodeValue;
                    if(fieldElementSnapshot.resultType === XPathResult.NUMBER_TYPE) value = fieldElementSnapshot.numberValue;
                    else if (fieldElementSnapshot.resultType === XPathResult.STRING_TYPE) value = fieldElementSnapshot.stringValue;
                    else if (fieldElementSnapshot.resultType === XPathResult.BOOLEAN_TYPE) value = fieldElementSnapshot.booleanValue;
                    else fieldElement = fieldElementSnapshot.singleNodeValue || (fieldElementSnapshot.snapshotItem && fieldElementSnapshot.snapshotItem(0));

                    if (fieldElement) {
                        if (selector.fieldType && selector.fieldType.toLowerCase().includes('image') || selector.name.toLowerCase().includes('image')) {
                            value = fieldElement.src || fieldElement.getAttribute('data-src') || fieldElement.href;
                            if (value && typeof value === 'string' && !value.startsWith('http')) try { value = new URL(value, window.location.href).href; } catch(e){}
                        } else if (selector.fieldType && selector.fieldType.toLowerCase().includes('link') || selector.name.toLowerCase().includes('link')) {
                            value = fieldElement.href;
                            if (value && typeof value === 'string' && !value.startsWith('http')) try { value = new URL(value, window.location.href).href; } catch(e){}
                        } else {
                            value = fieldElement.textContent;
                        }
                        if (value) value = value.trim();
                    }
                  } catch (e) { console.warn(`[Crocido Local Scrape] Error on paginated field "${selector.name}":`, e); value = null; }
                }
                item[selector.name || selector.id || 'field_'+i] = value;
                if (value !== null) allFieldsNullForThisItem = false;
              }
              if(!allFieldsNullForThisItem) {
                resultsArray.push(item);
                itemsFromNewPage++;
              }
            }
            console.log("[Crocido Local Scrape] Added", itemsFromNewPage, "items from page/scroll", currentPage + 1);
            if (itemsFromNewPage === 0 && nextPageContainerNodesSnapshot.snapshotLength > 0) {
                // If containers were found but no data extracted, it might indicate end of unique items or issues with selectors on later items.
                console.log("[Crocido Local Scrape] No new data extracted from visible containers on page", currentPage + 1, ". Might be end of unique items or selector issues.");
            }
            currentPage++;
          } else {
            console.log("[Crocido Local Scrape] Next button not found, disabled, or not visible. Ending pagination.");
            break; // Exit loop if no next button
          }
        }
      } else if (currentConfig.paginationMethod === 'loadMoreButton' && currentConfig.paginationDetails && currentConfig.paginationDetails.selector) {
        // Similar logic for "Load More" - often the button stays the same and content appends.
        // The main difference is that you might not need to re-evaluate *all* containers, 
        // but only new ones, or re-evaluate all if structure is flat.
        // For simplicity, we can re-evaluate all for now.
        console.log("[Crocido Local Scrape] Load More button pagination detected. Selector:", currentConfig.paginationDetails.selector);
        let clickCount = 0;
        const maxClicks = currentConfig.paginationDetails.maxClicks || 5; // Default max clicks

        while(clickCount < maxClicks) {
            const loadMoreButton = getElementByXPath(currentConfig.paginationDetails.selector);
            if (loadMoreButton && !loadMoreButton.disabled && loadMoreButton.offsetParent !== null) {
                console.log(`[Crocido Local Scrape] Clicking load more button (Click ${clickCount + 1}).`);
                loadMoreButton.click();
                await new Promise(resolve => setTimeout(resolve, currentConfig.paginationDetails.delay || 3000));
                
                // Re-scrape the entire container list, assuming new items are added or existing list is replaced.
                // A more optimized approach might identify only new items, but that's more complex.
                // For now, let's clear results and re-populate to avoid duplicates if items are re-rendered.
                // This is a simplification; a robust solution would handle merging or identifying new items.
                console.log("[Crocido Local Scrape] Re-evaluating product containers after Load More click...");
                // It's safer to assume a full re-scrape after load more and de-duplicate later if necessary,
                // or ensure that the primary scraping logic only adds *new* items.
                // For this iteration, we'll add all found items. Duplicates might occur if not handled by XPaths.
                const loadMoreContainerNodes = document.evaluate(currentConfig.productContainersXpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                let itemsFromLoadMore = 0;
                for (let i = 0; i < loadMoreContainerNodes.snapshotLength; i++) {
                  const containerElement = loadMoreContainerNodes.snapshotItem(i);
                  // Check if this container was already processed (simple check by content, very naive)
                  // A more robust check would use unique IDs or more stable attributes if available.
                  // For now, we risk duplicates to ensure all items are captured.
                  let item = {};
                  let allFieldsNullForThisItem = true;
                  for (const selector of currentConfig.selectors) {
                    let value = null;
                    if (containerElement && selector.xpath) {
                      try {
                        const fieldElementSnapshot = document.evaluate(selector.xpath, containerElement, null, XPathResult.ANY_TYPE, null);
                        let fieldElement = fieldElementSnapshot.snapshotItem ? fieldElementSnapshot.snapshotItem(0) : fieldElementSnapshot.singleNodeValue;
                        if(fieldElementSnapshot.resultType === XPathResult.NUMBER_TYPE) value = fieldElementSnapshot.numberValue;
                        else if (fieldElementSnapshot.resultType === XPathResult.STRING_TYPE) value = fieldElementSnapshot.stringValue;
                        else if (fieldElementSnapshot.resultType === XPathResult.BOOLEAN_TYPE) value = fieldElementSnapshot.booleanValue;
                        else fieldElement = fieldElementSnapshot.singleNodeValue || (fieldElementSnapshot.snapshotItem && fieldElementSnapshot.snapshotItem(0));

                        if (fieldElement) {
                            if (selector.fieldType && selector.fieldType.toLowerCase().includes('image') || selector.name.toLowerCase().includes('image')) {
                                value = fieldElement.src || fieldElement.getAttribute('data-src') || fieldElement.href;
                                if (value && typeof value === 'string' && !value.startsWith('http')) try { value = new URL(value, window.location.href).href; } catch(e){}
                            } else if (selector.fieldType && selector.fieldType.toLowerCase().includes('link') || selector.name.toLowerCase().includes('link')) {
                                value = fieldElement.href;
                                if (value && typeof value === 'string' && !value.startsWith('http')) try { value = new URL(value, window.location.href).href; } catch(e){}
                            } else {
                                value = fieldElement.textContent;
                            }
                            if (value) value = value.trim();
                        }
                      } catch (e) { console.warn(`[Crocido Local Scrape] Error on loadMore field "${selector.name}":`, e); value = null; }
                    }
                    item[selector.name || selector.id || 'field_'+i] = value;
                    if (value !== null) allFieldsNullForThisItem = false;
                  }
                  // To avoid duplicates with 'load more', we need a strategy.
                  // Simplest: assume XPaths are stable and only add if not already present (very basic check based on stringifying item).
                  // A proper de-duplication would require a unique key per item.
                  const itemString = JSON.stringify(item); 
                  if(!allFieldsNullForThisItem && !resultsArray.some(existingItem => JSON.stringify(existingItem) === itemString)){
                     resultsArray.push(item);
                     itemsFromLoadMore++;
                  }
                }
                 console.log("[Crocido Local Scrape] Added/updated", itemsFromLoadMore, "items after Load More click", clickCount + 1);
                 clickCount++;
            } else {
                console.log("[Crocido Local Scrape] Load More button not found, disabled, or not visible. Ending pagination.");
                break;
            }
        }
      }
      // --- Pagination Logic End ---

      console.log("[Crocido Local Scrape] Total items after pagination (if any):", resultsArray.length);
      sendResponse({ success: true, data: resultsArray, message: "Local scrape (with pagination if applicable) complete." });
    }

    performLocalScrape(config); // Call the scraping function

    return true; // Important: indicates asynchronous response as performLocalScrape calls sendResponse

  } else {
    console.warn("[Crocido Content Script] Received unhandled message action:", request.action);
    sendResponse({status: "Unknown action in content script: " + request.action, error: true});
    // No return true, let channel close unless a default async behavior is desired.
  }
});

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
  .crocido-button-group .crocido-btn.crocido-btn-active {
    background-color: #0056b3; /* Darker blue for active state */
    color: white;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
  }
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
  console.log("[Crocido] Attempting to save current config from UI.");
  currentConfigFromUI.configName = document.getElementById('crocido-config-name')?.value || `Config ${Date.now()}`;
  currentConfigFromUI.domain = window.location.hostname;
  
  currentConfigFromUI.selectors = [];
  Object.keys(predefinedFieldSelectors).forEach(fieldName => {
    const field = predefinedFieldSelectors[fieldName];
    const xpathInput = document.getElementById(`crocido-xpath-${fieldName}`);
    
    // Prioritize XPath from the input field if it exists and has a value
    let xpathValue = field.xpath; // Default to what's in memory (could be from auto-select or previous load)
    if (xpathInput && xpathInput.value.trim() !== '') {
      xpathValue = xpathInput.value.trim();
    } else if (xpathInput) { // Input exists but is empty, ensure we save empty
        xpathValue = '';
    }
    // If xpathValue is not null or an empty string after checks, save it.
    // Allow saving empty/null XPaths if user cleared them.
    // if (xpathValue) { // This was preventing clearing an XPath
    currentConfigFromUI.selectors.push({
      id: fieldName,
      name: field.name, // Make sure 'name' is part of predefinedFieldSelectors object
      xpath: xpathValue,
      fieldType: fieldName // Assuming fieldName is also the fieldType
    });
    // Also update the in-memory predefinedFieldSelectors to match what will be saved
    predefinedFieldSelectors[fieldName].xpath = xpathValue;
    // }
  });
  
  // Consolidate category URLs before saving
  let consolidatedCategoryUrls = [...manualCategoryUrls]; 
  detectedCategoryUrlsFromSitemap.forEach(url => {
      if (!consolidatedCategoryUrls.includes(url)) {
          consolidatedCategoryUrls.push(url);
      }
  });
  currentConfigFromUI.categoryUrls = consolidatedCategoryUrls;

  console.log("[Crocido] Config to save:", JSON.stringify(currentConfigFromUI, null, 2));

  chrome.runtime.sendMessage({ action: "saveConfiguration", config: currentConfigFromUI }, response => {
    if (chrome.runtime.lastError) { // It's good practice to check chrome.runtime.lastError first
      console.error("[Crocido] Error sending saveConfiguration message:", chrome.runtime.lastError.message);
      document.getElementById('crocido-status-message').textContent = "Error saving: " + chrome.runtime.lastError.message;
    } else if (response && response.status && response.status.includes("Error")) { // Check response for error status
      console.error("[Crocido] Failed to save configuration (error from background):", response.error || response.status);
      document.getElementById('crocido-status-message').textContent = "Error saving configuration: " + (response.error || response.status);
    } else if (response && response.activeConfig && response.activeConfig.id) { // Check for success based on typical response structure
      console.log("[Crocido] Configuration saved successfully by background. Active config ID:", response.activeConfig.id);
      document.getElementById('crocido-status-message').textContent = "Configuration saved!";
      // Optionally, update currentConfigFromUI with the version returned from background (which includes ID and timestamps)
      currentConfigFromUI = JSON.parse(JSON.stringify(response.activeConfig));
      // loadConfigIntoUI(currentConfigFromUI); // Could reload to ensure UI consistency with saved state, if needed.
    } else {
      // Fallback for unexpected response structure
      console.warn("[Crocido] Failed to save configuration or unexpected response structure:", response);
      document.getElementById('crocido-status-message').textContent = "Error saving configuration or unexpected response.";
    }
    setTimeout(() => {
      if(document.getElementById('crocido-status-message')) {
          document.getElementById('crocido-status-message').textContent = "";
      }
    }, 3000);
  });
}

function loadConfigIntoUI(config) {
  if (!setupSidebar) { // If sidebar isn't even up, don't try to load into it.
      console.warn("[Crocido] loadConfigIntoUI: Setup sidebar not found. Aborting UI load.");
      // Still, we should update the currentConfigFromUI and related global states
      if (!config) {
        currentConfigFromUI = createDefaultConfig(); // Use a function that returns a fresh default config object
        detectedProductContainerXPath = null;
        firstSelectedContainerXPath = null;
        firstSelectedContainerElement = null;
        manualCategoryUrls = [];
        detectedCategoryUrlsFromSitemap = [];
        Object.keys(predefinedFieldSelectors).forEach(key => {
            if(predefinedFieldSelectors[key]) predefinedFieldSelectors[key].xpath = '';
        });
      } else {
        currentConfigFromUI = JSON.parse(JSON.stringify(config)); // Deep copy
        detectedProductContainerXPath = currentConfigFromUI.productContainersXpath;
        // firstSelectedContainerXPath and firstSelectedContainerElement are transient selection states, don't load.
        manualCategoryUrls = Array.isArray(currentConfigFromUI.categoryUrls) ? currentConfigFromUI.categoryUrls.filter(url => typeof url === 'string') : [];
        // detectedCategoryUrlsFromSitemap is also more of a session discovery thing.
        // XHR patterns should be part of currentConfigFromUI

        // Update predefinedFieldSelectors from the loaded config
        Object.keys(predefinedFieldSelectors).forEach(key => {
             if(predefinedFieldSelectors[key]) predefinedFieldSelectors[key].xpath = ''; // Reset first
        });
        if (currentConfigFromUI.selectors && Array.isArray(currentConfigFromUI.selectors)) {
            currentConfigFromUI.selectors.forEach(selector => {
            if (predefinedFieldSelectors[selector.id]) {
                predefinedFieldSelectors[selector.id].xpath = selector.xpath;
                predefinedFieldSelectors[selector.id].name = selector.name; // Ensure name is also updated
            }
            });
        }
      }
      return; // Exit if no sidebar to update
  }

  // If sidebar exists, proceed to update it.
  if (!config) {
    console.warn("[Crocido] loadConfigIntoUI: No config provided or config is null/undefined. Resetting UI to default.");
    currentConfigFromUI = createDefaultConfig(); // Reset global working config
    document.getElementById('crocido-config-name').value = currentConfigFromUI.configName;
    
    detectedProductContainerXPath = null;
    // selectedContainerXPaths = []; // This is not directly used in load, more for selection process
    productContainerSelectionMode = false; // Reset selection mode
    firstSelectedContainerXPath = null;
    firstSelectedContainerElement = null;

    Object.keys(predefinedFieldSelectors).forEach(key => {
        if(predefinedFieldSelectors[key]) predefinedFieldSelectors[key].xpath = '';
    });
    
    manualCategoryUrls = [];
    detectedCategoryUrlsFromSitemap = []; // Reset this as well
    // currentConfigFromUI.paginationMethod is handled by createDefaultConfig()
    // currentConfigFromUI.paginationDetails is handled by createDefaultConfig()
    // currentConfigFromUI.categoryUrls is handled by createDefaultConfig()
    // currentConfigFromUI.detectedXhrPatterns is handled by createDefaultConfig()
    
  } else {
    console.log("[Crocido] Loading config into UI:", JSON.stringify(config, null, 2));
    currentConfigFromUI = JSON.parse(JSON.stringify(config)); // Deep copy to our working config

    document.getElementById('crocido-config-name').value = currentConfigFromUI.configName || `Config ${new Date().toISOString().slice(0,10)}`;
    
    detectedProductContainerXPath = currentConfigFromUI.productContainersXpath;
    // selectedContainerXPaths = detectedProductContainerXPath ? [detectedProductContainerXPath] : []; 
    productContainerSelectionMode = !detectedProductContainerXPath; // If XPath exists, not in selection mode initially.

    // Reset predefinedFieldSelectors before loading new ones from config
    Object.keys(predefinedFieldSelectors).forEach(key => {
        if(predefinedFieldSelectors[key]) predefinedFieldSelectors[key].xpath = '';
    });
    if (currentConfigFromUI.selectors && Array.isArray(currentConfigFromUI.selectors)) {
      currentConfigFromUI.selectors.forEach(selector => {
        if (predefinedFieldSelectors[selector.id]) {
          predefinedFieldSelectors[selector.id].xpath = selector.xpath;
          predefinedFieldSelectors[selector.id].name = selector.name; // Important for UI labels
        }
      });
    }
    
    // paginationMethod and paginationDetails are part of currentConfigFromUI
    
    manualCategoryUrls = Array.isArray(currentConfigFromUI.categoryUrls) ? currentConfigFromUI.categoryUrls.filter(url => typeof url === 'string') : [];
    // detectedXhrPatterns are part of currentConfigFromUI
  }

  // Update all UI sections that depend on the loaded config
  if (setupSidebar) { // Double check setupSidebar as it might have been destroyed if setup was toggled off
    updateContainerDetectionUI();
    updateAllFieldSelectorBlocksUI(); // This will now use the XPaths from predefinedFieldSelectors to populate inputs
    renderPaginationMethod(); // Uses currentConfigFromUI
    renderDetectedXhrPatterns(); // Uses currentConfigFromUI
    renderManualCategoryUrls(); // Uses global manualCategoryUrls
    updateDetectedCategoryListUI(); // Uses global detectedCategoryUrlsFromSitemap
  }
}

// Helper function to create a default config structure
function createDefaultConfig() {
    return {
        configName: `New Config ${new Date().toISOString().slice(0,10)}`,
        domain: window.location.hostname,
        productContainersXpath: null,
        selectors: [ // Initialize with all predefined fields having null/empty XPaths
            { id: 'Title', name: 'Title', xpath: '', fieldType: 'Title'},
            { id: 'Price', name: 'Price', xpath: '', fieldType: 'Price'},
            { id: 'ImageSrc', name: 'ImageSrc', xpath: '', fieldType: 'ImageSrc'},
            { id: 'Link', name: 'Link', xpath: '', fieldType: 'Link'}
        ],
        paginationMethod: 'none',
        paginationDetails: {},
        categoryUrls: [],
        detectedXhrPatterns: []
    };
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