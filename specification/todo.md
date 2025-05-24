# Crocido Scraper TODO List

## High Priority
- [ ] **Revamp Selector Tool UI (Content Script):**
    - [ ] Replace dynamic field selection list with dedicated sections for:
        - Product Title
        - Product Price
        - Product Description
        - Product Image
    - [ ] Each section should have:
        - A clear label (e.g., "Product Title").
        - An input field to display/edit the XPath for this specific field.
        - A "Select Title" (or "Select Price", etc.) button. Clicking this button will activate selection mode *for that specific field*.
    - [ ] Field names ("Title", "Price", "Description", "Image") should be predefined and used when saving the configuration.
    - [ ] Ensure these field selectors are correctly made relative to the product container during scraping.
- [ ] **Generalization of Selectors:**
    - [ ] Ensure the XPaths captured for Title, Price, etc., within one product example are correctly applied to all other product containers by the scraper engine. (Partially addressed by making XPaths relative, but needs to be confirmed with new UI).

## Medium Priority
- [ ] **Advanced Cookie/Popup Handling (Scraper Engine):**
    - [ ] Implement more robust/automatic detection and handling of common cookie consent banners and popups beyond hardcoded selectors.
    - [ ] Explore generic selectors or heuristics.

## Low Priority
- [ ] **Configuration Management:**
    - [ ] Allow naming and managing multiple scraper configurations.
    - [ ] UI for loading/editing existing configurations.

## Completed
- [X] Initial setup of relative XPath handling in `scraper_engine/src/main.js`. 