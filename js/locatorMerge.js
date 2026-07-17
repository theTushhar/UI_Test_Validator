// js/locatorMerge.js - V2 parent-chain locator merging
//
// V2 element locators are relative to their parent's matched DOM node (see
// js/iframe.js evaluateAllLocatorsInIframe's V2 branch, which resolves matches
// the same way at runtime). This module computes a standalone, copy-pasteable
// locator string by walking the parent chain and concatenating each level.

// Returns the chain from root ancestor down to `el` itself, e.g. [grandparent, parent, el].
// Stops (without including el) if a parent UUID can't be found or a cycle is detected.
export function getAncestorChain(el, elements) {
    const chain = [el];
    const seen = new Set([el.uuid]);
    let current = el;

    while (current.parent) {
        const parentEl = elements.find(e => e.uuid === current.parent);
        if (!parentEl) {
            return { chain, broken: true };
        }
        if (seen.has(parentEl.uuid)) {
            return { chain, broken: true };
        }
        seen.add(parentEl.uuid);
        chain.unshift(parentEl);
        current = parentEl;
    }

    return { chain, broken: false };
}

// Combines a chain of XPath locators (root -> ... -> el) into one standalone XPath.
// Each descendant locator is expected to be context-relative (starting with ".").
function mergeXPathChain(chain) {
    let result = chain[0].locator || '';
    for (let i = 1; i < chain.length; i++) {
        const loc = chain[i].locator || '';
        if (loc.startsWith('.')) {
            result += loc.slice(1);
        } else if (loc.startsWith('/')) {
            result += loc;
        } else {
            result += '//' + loc;
        }
    }
    return result;
}

// Combines a chain of CSS locators (root -> ... -> el) using descendant combinators.
function mergeCssChain(chain) {
    return chain.map(node => (node.locator || '').trim()).join(' ');
}

// Builds a standalone locator for `el` by merging its parent chain.
// Returns { value, merged, error }:
//   - merged: false when there's nothing to merge (root element) or merging isn't possible
//   - error: human-readable reason when merged is false but el.parent is set
export function buildMergedLocator(el, elements) {
    if (!el.parent) {
        return { value: el.locator || '', merged: false, error: null };
    }

    const { chain, broken } = getAncestorChain(el, elements);
    if (broken) {
        return { value: el.locator || '', merged: false, error: 'Parent element could not be found on this page.' };
    }

    const locatorType = (el.locatorType || '').toLowerCase();
    const mismatched = chain.some(node => (node.locatorType || '').toLowerCase() !== locatorType);
    if (mismatched) {
        return { value: el.locator || '', merged: false, error: 'Ancestors use a different locator type — cannot auto-merge.' };
    }

    let value;
    if (locatorType === 'css') {
        value = mergeCssChain(chain);
    } else if (locatorType === 'xpath') {
        value = mergeXPathChain(chain);
    } else {
        return { value: el.locator || '', merged: false, error: `Unsupported locator type "${el.locatorType}" for merging.` };
    }

    return { value, merged: true, error: null, levels: chain.length - 1 };
}

window.getAncestorChain = getAncestorChain;
window.buildMergedLocator = buildMergedLocator;
