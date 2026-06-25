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
            
            // Apply blocker styles based on checkbox state
            const chk = document.getElementById('hide-blockers-chk');
            applyBlockerStyles(chk.checked);
            
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
}

export function highlightElementInIframe(element) {
    const doc = getIframeDocument();
    if (!doc) return;
    
    clearHighlightsInIframe();
    
    let matchedElements = [];
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
    
    if (matchedElements.length > 0) {
        matchedElements.forEach(el => {
            el.classList.add('locator-highlight');
        });
        
        matchedElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const chk = document.getElementById('hide-blockers-chk');
    applyBlockerStyles(chk.checked);
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

export function onHideBlockersChanged() {
    const chk = document.getElementById('hide-blockers-chk');
    applyBlockerStyles(chk.checked);
}

export function applyBlockerStyles(hide) {
    const doc = getIframeDocument();
    if (!doc) return;
    
    let styleEl = doc.getElementById('blocker-style-injector');
    if (hide) {
        if (!styleEl) {
            styleEl = doc.createElement('style');
            styleEl.id = 'blocker-style-injector';
            doc.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            .ui-widget-overlay, .ui-dialog-overlay, .ui-blockui, #cornerSpinnerLoading, .ui-dialog-docking-zone {
                display: none !important;
                pointer-events: none !important;
            }
            .ui-dialog:not(:has(.locator-highlight)), .ui-confirmdialog:not(:has(.locator-highlight)), #dialogBox:not(:has(.locator-highlight)) {
                display: none !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
        `;
    } else {
        if (styleEl) {
            styleEl.remove();
        }
    }
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

// Window exposure for HTML onclick handlers and cross-module calls
window.onHideBlockersChanged = onHideBlockersChanged;
window.adjustManualZoom = adjustManualZoom;
window.toggleAutoFit = toggleAutoFit;
window.reloadIframe = reloadIframe;
window.clearCacheAndRefresh = clearCacheAndRefresh;
window.evaluateAllLocatorsInIframe = evaluateAllLocatorsInIframe;
