// js/iframe.js - Iframe helpers, CSS/XPath matching, highlights, zoom, blocker styles

import { state } from './state.js';

export function setupIframeMessagePassing() {
    const iframe = document.getElementById('preview-iframe');
    iframe.onload = () => {
        const indicator = document.getElementById('loaded-file-indicator');
        const groupSelect = document.getElementById('group-select');
        const stepSelect = document.getElementById('step-select');
        
        const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
        const groupIdx = parseInt(groupSelect.value);
        const stepIdx = parseInt(stepSelect.value);
        
        if (!isNaN(groupIdx) && !isNaN(stepIdx)) {
            const group = activeGroups[groupIdx];
            const mapping = group.mappings[stepIdx];
            
            indicator.textContent = mapping.mhtml_file;
            indicator.title = `${group.folder || ''}/${mapping.mhtml_file}`;
            
            injectStyleSheetToIframe();
            
            // Re-bind inspect listeners if inspect mode is active
            if (state.isInspectMode) {
                window.enableInspectListeners();
            }
            
            // Recalculate Zoom
            updateIframeZoom();
            
            // Perform verification matches check
            if (state.currentPageIndex >= 0 && state.locatorsConfig.pages && state.locatorsConfig.pages.length > 0) {
                evaluateAllLocatorsInIframe();
                window.updateStatsPanel();
                window.renderElementsList();
                if (state.currentElementIndex >= 0) {
                    window.selectElement(state.currentElementIndex);
                }
            }
        } else {
            indicator.textContent = "No MHTML File Active";
            indicator.title = "No MHTML File Active";
        }
    };
}

export function getIframeDocument() {
    const iframe = document.getElementById('preview-iframe');
    return iframe.contentDocument || iframe.contentWindow.document;
}

export function injectStyleSheetToIframe() {
    const doc = getIframeDocument();
    if (!doc || doc.getElementById('verifier-style-tag')) return;
    
    const style = doc.createElement('style');
    style.id = 'verifier-style-tag';
    style.textContent = `
        .locator-highlight {
            outline: 3px solid #7c3aed !important;
            outline-offset: 2px !important;
            background-color: rgba(124, 58, 237, 0.15) !important;
            box-shadow: 0 0 25px rgba(124, 58, 237, 0.6), inset 0 0 0 9999px rgba(124, 58, 237, 0.2) !important;
            transition: all 0.15s ease-in-out;
            animation: pulseBorder 1.5s infinite alternate !important;
            position: relative !important;
            z-index: 9999969 !important;
        }
        @keyframes pulseBorder {
            from {
                outline-color: #7c3aed;
                box-shadow: 0 0 15px rgba(124, 58, 237, 0.5), inset 0 0 0 9999px rgba(124, 58, 237, 0.15);
            }
            to {
                outline-color: #c084fc;
                box-shadow: 0 0 30px rgba(192, 132, 252, 0.9), inset 0 0 0 9999px rgba(192, 132, 252, 0.35);
            }
        }
        
        /* Structural table element cell highlight fallback */
        tbody.locator-highlight td,
        tr.locator-highlight td,
        table.locator-highlight td,
        thead.locator-highlight th,
        tfoot.locator-highlight td {
            outline: 2px solid #7c3aed !important;
            outline-offset: -2px !important;
            background-color: rgba(124, 58, 237, 0.1) !important;
            box-shadow: inset 0 0 0 9999px rgba(124, 58, 237, 0.15) !important;
            animation: pulseCellBorder 1.5s infinite alternate !important;
        }
        @keyframes pulseCellBorder {
            from {
                outline-color: #7c3aed;
                box-shadow: inset 0 0 0 9999px rgba(124, 58, 237, 0.15);
            }
            to {
                outline-color: #c084fc;
                box-shadow: inset 0 0 0 9999px rgba(192, 132, 252, 0.3);
            }
        }
        .inspect-hover-matched {
            outline: 3px dashed #10b981 !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 15px rgba(16, 185, 129, 0.6) !important;
            cursor: crosshair !important;
        }
        .inspect-hover-mismatched {
            outline: 3px dashed #ef4444 !important;
            outline-offset: 2px !important;
            box-shadow: 0 0 15px rgba(239, 68, 68, 0.6) !important;
            cursor: crosshair !important;
        }
        .parent-locator-highlight {
            outline: 3px dashed #ea580c !important;
            outline-offset: 4px !important;
            background-color: rgba(234, 88, 12, 0.08) !important;
            box-shadow: 0 0 15px rgba(234, 88, 12, 0.4), inset 0 0 0 9999px rgba(234, 88, 12, 0.1) !important;
            transition: all 0.15s ease-in-out;
            position: relative !important;
            z-index: 9999960 !important;
        }
        tbody.parent-locator-highlight td,
        tr.parent-locator-highlight td,
        table.parent-locator-highlight td,
        thead.parent-locator-highlight th,
        tfoot.parent-locator-highlight td {
            outline: 2px dashed #ea580c !important;
            outline-offset: -2px !important;
            background-color: rgba(234, 88, 12, 0.05) !important;
            box-shadow: inset 0 0 0 9999px rgba(234, 88, 12, 0.08) !important;
        }
        html, body {
            overflow: auto !important;
        }
    `;
    doc.head.appendChild(style);
}

export function clearHighlightsInIframe() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    const highlighted = doc.querySelectorAll('.locator-highlight');
    highlighted.forEach(el => {
        el.classList.remove('locator-highlight');
    });

    const parentHighlighted = doc.querySelectorAll('.parent-locator-highlight');
    parentHighlighted.forEach(el => {
        el.classList.remove('parent-locator-highlight');
    });
}

export function isElementVisible(el) {
    if (!el) return false;
    
    // 1. Check computed styles of the element itself
    try {
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
            return false;
        }
    } catch(e) {
        return false;
    }
    
    // 2. Check bounding box dimensions
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return false;
    }
    
    // 3. Walk up the ancestor tree to ensure no parent is hidden
    let parent = el.parentElement;
    while (parent) {
        try {
            const parentStyle = parent.ownerDocument.defaultView.getComputedStyle(parent);
            if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden' || parseFloat(parentStyle.opacity) === 0) {
                return false;
            }
        } catch(e) {
            return false;
        }
        parent = parent.parentElement;
    }
    
    return true;
}

export function evaluateAllLocatorsInIframe() {
    state.matchedDomElementsSet.clear();
    if (state.domToElementMap) {
        state.domToElementMap.clear();
    } else {
        state.domToElementMap = new Map();
    }
    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) return;
    const doc = getIframeDocument();
    if (!doc) return;
    
    const page = state.locatorsConfig.pages[state.currentPageIndex];

    if (!state.isV2) {
        page.elements.forEach((el, idx) => {
            let maxLocMatches = 0;
            
            el.locators.forEach(loc => {
                let matches = [];
                const type = (loc.locator_type || '').toLowerCase();
                if (type === 'css') {
                    matches = findCSSMatches(loc.value, doc);
                } else if (type === 'xpath') {
                    matches = findXPathMatches(loc.value, doc);
                }
                loc.matched_count = matches.length;
                
                let visibleCount = 0;
                matches.forEach(domEl => {
                    if (isElementVisible(domEl)) {
                        visibleCount++;
                    }
                });
                loc.visible_count = visibleCount;
                
                if (matches.length > 0) {
                    maxLocMatches = Math.max(maxLocMatches, matches.length);
                    matches.forEach(domEl => {
                        state.matchedDomElementsSet.add(domEl);
                        
                        let matchScore = 0;
                        if (matches.length === 1) matchScore += 100;
                        if (loc.preferred) matchScore += 50;
                        matchScore += (loc.score || 0);
                        
                        const existing = state.domToElementMap.get(domEl);
                        if (!existing || matchScore > existing.score) {
                            state.domToElementMap.set(domEl, { idx, score: matchScore });
                        }
                    });
                }
            });
            
            el.matched_count = maxLocMatches;
        });
    } else {
        // V2 evaluation (supporting relative locators and parent-child hierarchy)
        const elementUuidToDomMatches = new Map();
        
        function resolveLocatorTemplate(locatorValue, locatorType) {
            if (!locatorValue || !locatorValue.includes('{{variable}}')) {
                return locatorValue || '';
            }
            if (locatorType.toLowerCase() === 'xpath') {
                return locatorValue.replace(/\[\s*\{\{variable\}\}\s*\]/g, '')
                                   .replace(/\{\{variable\}\}/g, '*');
            } else {
                return locatorValue.replace(/\[\s*([a-zA-Z0-9_-]+)\s*=\s*['"]\{\{variable\}\}['"]\s*\]/g, '[$1]')
                                   .replace(/\{\{variable\}\}/g, '');
            }
        }
        
        function getDomMatchesForElement(el) {
            if (elementUuidToDomMatches.has(el.uuid)) {
                return elementUuidToDomMatches.get(el.uuid);
            }
            
            const locatorValue = resolveLocatorTemplate(el.locator, el.locatorType || '');
            const locatorType = (el.locatorType || '').toLowerCase();
            
            let matches = [];
            
            if (!el.parent) {
                if (locatorType === 'css') {
                    matches = findCSSMatches(locatorValue, doc);
                } else if (locatorType === 'xpath') {
                    matches = findXPathMatches(locatorValue, doc);
                }
            } else {
                const parentEl = page.elements.find(p => p.uuid === el.parent);
                if (parentEl) {
                    const parentMatches = getDomMatchesForElement(parentEl);
                    parentMatches.forEach(parentDomNode => {
                        let subMatches = [];
                        if (locatorType === 'css') {
                            try {
                                subMatches = Array.from(parentDomNode.querySelectorAll(locatorValue));
                            } catch(e) {}
                        } else if (locatorType === 'xpath') {
                            try {
                                const results = doc.evaluate(locatorValue, parentDomNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                                for (let i = 0; i < results.snapshotLength; i++) {
                                    subMatches.push(results.snapshotItem(i));
                                }
                            } catch(e) {}
                        }
                        matches.push(...subMatches);
                    });
                }
            }
            
            elementUuidToDomMatches.set(el.uuid, matches);
            return matches;
        }
        
        page.elements.forEach((el, idx) => {
            const matches = getDomMatchesForElement(el);
            el.matched_count = matches.length;
            
            let visibleCount = 0;
            matches.forEach(domEl => {
                if (isElementVisible(domEl)) {
                    visibleCount++;
                }
            });
            el.visible_count = visibleCount;
            
            matches.forEach(domEl => {
                state.matchedDomElementsSet.add(domEl);
                
                let matchScore = 100;
                if (matches.length === 1) matchScore += 100;
                
                const existing = state.domToElementMap.get(domEl);
                if (!existing || matchScore > existing.score) {
                    state.domToElementMap.set(domEl, { idx, score: matchScore });
                }
            });
            
            // Sync properties for rendering compatibility
            el.type = el.elementType;
            
            el.locators = [
                {
                    locator_type: el.locatorType,
                    value: el.locator,
                    preferred: true,
                    score: 100,
                    strategy: el.parent ? 'relative' : 'document-root',
                    matched_count: el.matched_count,
                    visible_count: el.visible_count
                }
            ];
            
            if (el.dropdown_locators) {
                const dl = el.dropdown_locators;
                if (dl.native_select) {
                    const val = resolveLocatorTemplate(dl.native_select.value, dl.native_select.locator_type);
                    let subMatches = [];
                    if (dl.native_select.locator_type.toLowerCase() === 'xpath') {
                        subMatches = findXPathMatches(val, doc);
                    } else {
                        subMatches = findCSSMatches(val, doc);
                    }
                    el.locators.push({
                        locator_type: dl.native_select.locator_type,
                        value: dl.native_select.value,
                        preferred: false,
                        score: 80,
                        strategy: 'dropdown-native',
                        matched_count: subMatches.length,
                        visible_count: subMatches.filter(isElementVisible).length
                    });
                }
                if (dl.options_panel) {
                    const val = resolveLocatorTemplate(dl.options_panel.value, dl.options_panel.locator_type);
                    let subMatches = [];
                    if (dl.options_panel.locator_type.toLowerCase() === 'xpath') {
                        subMatches = findXPathMatches(val, doc);
                    } else {
                        subMatches = findCSSMatches(val, doc);
                    }
                    el.locators.push({
                        locator_type: dl.options_panel.locator_type,
                        value: dl.options_panel.value,
                        preferred: false,
                        score: 60,
                        strategy: 'dropdown-panel',
                        matched_count: subMatches.length,
                        visible_count: subMatches.filter(isElementVisible).length
                    });
                }
            }
        });
    }
}

export function highlightElementInIframe(element) {
    const doc = getIframeDocument();
    if (!doc) return;
    
    clearHighlightsInIframe();
    
    let matchedElements = [];
    
    if (!state.isV2) {
        let preferredLoc = element.locators.find(l => l.preferred);
        
        if (preferredLoc) {
            const type = (preferredLoc.locator_type || '').toLowerCase();
            if (type === 'css') {
                matchedElements = findCSSMatches(preferredLoc.value, doc);
            } else if (type === 'xpath') {
                matchedElements = findXPathMatches(preferredLoc.value, doc);
            }
        }
        
        if (matchedElements.length === 0) {
            for (let i = 0; i < element.locators.length; i++) {
                const loc = element.locators[i];
                let matches = [];
                const type = (loc.locator_type || '').toLowerCase();
                if (type === 'css') {
                    matches = findCSSMatches(loc.value, doc);
                } else if (type === 'xpath') {
                    matches = findXPathMatches(loc.value, doc);
                }
                if (matches.length > 0) {
                    matchedElements = matches;
                    break;
                }
            }
        }
    } else {
        const page = state.locatorsConfig.pages[state.currentPageIndex];
        
        function resolveLocatorTemplate(locatorValue, locatorType) {
            if (!locatorValue || !locatorValue.includes('{{variable}}')) {
                return locatorValue || '';
            }
            if (locatorType.toLowerCase() === 'xpath') {
                return locatorValue.replace(/\[\s*\{\{variable\}\}\s*\]/g, '')
                                   .replace(/\{\{variable\}\}/g, '*');
            } else {
                return locatorValue.replace(/\[\s*([a-zA-Z0-9_-]+)\s*=\s*['"]\{\{variable\}\}['"]\s*\]/g, '[$1]')
                                   .replace(/\{\{variable\}\}/g, '');
            }
        }
        
        function getDomMatches(el) {
            const locatorValue = resolveLocatorTemplate(el.locator, el.locatorType || '');
            const locatorType = (el.locatorType || '').toLowerCase();
            let matches = [];
            
            if (!el.parent) {
                if (locatorType === 'css') {
                    matches = findCSSMatches(locatorValue, doc);
                } else if (locatorType === 'xpath') {
                    matches = findXPathMatches(locatorValue, doc);
                }
            } else {
                const parentEl = page.elements.find(p => p.uuid === el.parent);
                if (parentEl) {
                    const parentMatches = getDomMatches(parentEl);
                    parentMatches.forEach(parentDomNode => {
                        let subMatches = [];
                        if (locatorType === 'css') {
                            try {
                                subMatches = Array.from(parentDomNode.querySelectorAll(locatorValue));
                            } catch(e) {}
                        } else if (locatorType === 'xpath') {
                            try {
                                const results = doc.evaluate(locatorValue, parentDomNode, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                                for (let i = 0; i < results.snapshotLength; i++) {
                                    subMatches.push(results.snapshotItem(i));
                                }
                            } catch(e) {}
                        }
                        matches.push(...subMatches);
                    });
                }
            }
            return matches;
        }
        
        if (element.parent) {
            const parentEl = page.elements.find(p => p.uuid === element.parent);
            if (parentEl) {
                const parentMatches = getDomMatches(parentEl);
                parentMatches.forEach(el => {
                    el.classList.add('parent-locator-highlight');
                });
            }
        }
        
        matchedElements = getDomMatches(element);
    }
    
    if (matchedElements.length > 0) {
        matchedElements.forEach(el => {
            el.classList.add('locator-highlight');
        });
        
        matchedElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
}

export function findCSSMatches(css, doc) {
    try {
        return Array.from(doc.querySelectorAll(css));
    } catch(e) {
        return [];
    }
}

export function findXPathMatches(xpath, doc) {
    const list = [];
    try {
        const results = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < results.snapshotLength; i++) {
            list.push(results.snapshotItem(i));
        }
    } catch(e) {
        // Invalid XPath
    }
    return list;
}

// Auto Fit & Zoom functionality
export function updateIframeZoom() {
    const container = document.getElementById('iframe-container-box');
    const scaler = document.getElementById('iframe-scaler');
    
    if (!container || !scaler) return;
    
    const containerWidth = container.clientWidth - 48; // 24px padding on each side
    const containerHeight = container.clientHeight - 48; // 24px padding
    
    let scale = 1.0;
    
    if (state.isAutoFit) {
        scale = containerWidth / state.logicalWidth;
        if (scale > 1.0) scale = 1.0;
        state.manualZoom = scale;
    } else {
        scale = state.manualZoom;
    }
    
    // Set layout dimensions of the parent scaler container to match its visually scaled size.
    // This allows the browser layout engine to calculate centering, margins, and scrollbars accurately.
    scaler.style.width = `${state.logicalWidth * scale}px`;
    scaler.style.height = `${containerHeight}px`;
    scaler.style.marginLeft = '0px'; // Handled natively by CSS margin: 0 auto
    
    // Scale the iframe inside the scaler container
    const iframe = document.getElementById('preview-iframe');
    if (iframe) {
        iframe.style.width = `${state.logicalWidth}px`;
        iframe.style.height = `${containerHeight / scale}px`;
        iframe.style.transform = `scale(${scale})`;
        iframe.style.transformOrigin = 'top left';
    }
    
    document.getElementById('zoom-percentage').textContent = `${Math.round(scale * 100)}%`;
    
    const autoFitBtn = document.getElementById('btn-autofit');
    if (state.isAutoFit) {
        autoFitBtn.classList.add('active');
    } else {
        autoFitBtn.classList.remove('active');
    }
}

export function toggleAutoFit() {
    state.isAutoFit = !state.isAutoFit;
    updateIframeZoom();
}

export function adjustManualZoom(delta) {
    state.isAutoFit = false;
    state.manualZoom = Math.max(0.1, Math.min(3.0, state.manualZoom + delta));
    updateIframeZoom();
}

export function reloadIframe() {
    const iframe = document.getElementById('preview-iframe');
    iframe.src = iframe.src;
}

export function clearCacheAndRefresh() {
    // Delete specifically our database to avoid wiping out other unrelated databases on this origin
    indexedDB.deleteDatabase('LocatorVerifierDB');
    
    // Unregister any active service worker to ensure fresh loading of the application resources
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            for (let registration of registrations) {
                registration.unregister();
            }
        });
    }
    
    setTimeout(() => location.reload(true), 300);
}

export function highlightSpecificLocatorInIframe(locatorType, value) {
    const doc = getIframeDocument();
    if (!doc) return;
    
    clearHighlightsInIframe();
    
    let matchedElements = [];
    const type = (locatorType || '').toLowerCase();
    
    if (type === 'css') {
        matchedElements = findCSSMatches(value, doc);
    } else if (type === 'xpath') {
        matchedElements = findXPathMatches(value, doc);
    }
    
    if (matchedElements.length > 0) {
        matchedElements.forEach(el => {
            el.classList.add('locator-highlight');
        });
        
        // Use smooth scrolling to scroll the element inside the preview iframe into viewport
        matchedElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Window exposure for HTML onclick handlers and cross-module calls
window.adjustManualZoom = adjustManualZoom;
window.toggleAutoFit = toggleAutoFit;
window.reloadIframe = reloadIframe;
window.clearCacheAndRefresh = clearCacheAndRefresh;
window.evaluateAllLocatorsInIframe = evaluateAllLocatorsInIframe;
window.highlightSpecificLocatorInIframe = highlightSpecificLocatorInIframe;
