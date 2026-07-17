// js/inspectMode.js - Inspect mode, hover/click handlers, match from iframe

import { state } from './state.js';
import { getIframeDocument } from './iframe.js';

export function toggleInspectMode() {
    state.isInspectMode = !state.isInspectMode;
    const btn = document.getElementById('btn-inspect');
    if (!btn) return;
    
    if (state.isInspectMode) {
        btn.classList.add('active');
        enableInspectListeners();
    } else {
        btn.classList.remove('active');
        disableInspectListeners();
    }
}

export function resetInspectMode() {
    state.isInspectMode = false;
    const btn = document.getElementById('btn-inspect');
    if (btn) btn.classList.remove('active');
    disableInspectListeners();
}

export function enableInspectListeners() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    doc.addEventListener('mouseover', handleIframeMouseOver, true);
    doc.addEventListener('mouseout', handleIframeMouseOut, true);
    doc.addEventListener('click', handleIframeClick, true);
}

export function disableInspectListeners() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    doc.removeEventListener('mouseover', handleIframeMouseOver, true);
    doc.removeEventListener('mouseout', handleIframeMouseOut, true);
    doc.removeEventListener('click', handleIframeClick, true);
    
    if (state.currentHoveredElement) {
        try {
            state.currentHoveredElement.classList.remove('inspect-hover-matched');
            state.currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
        state.currentHoveredElement = null;
    }
}

export function checkHoverElementMatch(domElement) {
    const doc = getIframeDocument();
    if (!doc) return false;
    
    let current = domElement;
    while (current && current !== doc.body && current !== doc.documentElement) {
        if (state.matchedDomElementsSet.has(current)) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

export function handleIframeMouseOver(e) {
    if (!state.isInspectMode) return;
    e.stopPropagation();
    
    if (state.currentHoveredElement && state.currentHoveredElement !== e.target) {
        try {
            state.currentHoveredElement.classList.remove('inspect-hover-matched');
            state.currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
    }
    
    state.currentHoveredElement = e.target;
    if (state.currentHoveredElement && state.currentHoveredElement.classList) {
        const isMatched = checkHoverElementMatch(state.currentHoveredElement);
        if (isMatched) {
            state.currentHoveredElement.classList.add('inspect-hover-matched');
        } else {
            state.currentHoveredElement.classList.add('inspect-hover-mismatched');
        }
    }
}

export function handleIframeMouseOut(e) {
    if (!state.isInspectMode) return;
    if (state.currentHoveredElement) {
        try {
            state.currentHoveredElement.classList.remove('inspect-hover-matched');
            state.currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
        state.currentHoveredElement = null;
    }
}

export function handleIframeClick(e) {
    if (!state.isInspectMode) return;
    e.preventDefault();
    e.stopPropagation();
    
    const clickedEl = e.target;
    if (clickedEl && clickedEl.classList) {
        clickedEl.classList.remove('inspect-hover-matched');
        clickedEl.classList.remove('inspect-hover-mismatched');
    }
    
    toggleInspectMode();
    matchElementFromIframe(clickedEl);
}

export function matchElementFromIframe(domElement) {
    const doc = getIframeDocument();
    if (!doc) return;
    
    let current = domElement;
    while (current && current !== doc.body && current !== doc.documentElement) {
        if (state.domToElementMap && state.domToElementMap.has(current)) {
            const match = state.domToElementMap.get(current);
            window.selectElement(match.idx, true);
            return;
        }
        current = current.parentElement;
    }
    
    alert("No matching locator found in the database for the clicked element.");
}

window.toggleInspectMode = toggleInspectMode;
window.resetInspectMode = resetInspectMode;
window.enableInspectListeners = enableInspectListeners;
