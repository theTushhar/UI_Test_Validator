// js/jsonEditor.js - Raw editor, form editor, validation, save-to-DB/disk, toast

import { state } from './state.js';
import { escapeHtml, showToast } from './utils.js';

export function openJsonEditor() {
    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) {
        alert("No locator configuration loaded. Select a group and step first.");
        return;
    }

    loadFullLocatorConfig().then(config => {
        if (!config) {
            alert("No locator configuration found in IndexedDB.");
            return;
        }

        state.jsonEditorState.fullConfig = config;
        state.jsonEditorState.folder = getCurrentFolder();
        state.jsonEditorState.originalJson = JSON.stringify(config, null, 2);
        state.jsonEditorState.currentJson = state.jsonEditorState.originalJson;
        state.jsonEditorState.isModified = false;
        state.jsonEditorState.searchQuery = '';

        const searchInput = document.getElementById('json-search-input');
        if (searchInput) searchInput.value = '';

        const textarea = document.getElementById('json-editor-textarea');
        textarea.value = state.jsonEditorState.originalJson;
        textarea.classList.remove('has-error');

        updateJsonEditorStatus('valid', 'Valid JSON');
        updateSaveHint();
        updateLineInfo(textarea);

        renderFormEditor();

        document.getElementById('json-editor-modal').style.display = 'flex';
    });
}

export function closeJsonEditor() {
    if (state.jsonEditorState.isModified) {
        if (!confirm("You have unsaved changes. Are you sure you want to close?")) return;
    }
    document.getElementById('json-editor-modal').style.display = 'none';
    state.jsonEditorState.originalJson = null;
    state.jsonEditorState.currentJson = null;
    state.jsonEditorState.isModified = false;
    state.jsonEditorState.searchQuery = '';
}

export function switchEditorView(view) {
    state.jsonEditorState.activeView = view;

    document.getElementById('tab-raw').classList.toggle('tab-active', view === 'raw');
    document.getElementById('tab-form').classList.toggle('tab-active', view === 'form');

    document.getElementById('json-editor-raw-view').style.display = view === 'raw' ? 'flex' : 'none';
    document.getElementById('json-editor-form-view').style.display = view === 'form' ? 'flex' : 'none';

    if (view === 'raw') {
        const textarea = document.getElementById('json-editor-textarea');
        updateLineInfo(textarea);
        if (state.jsonEditorState.searchQuery) {
            onJsonSearchInput(state.jsonEditorState.searchQuery);
        }
    } else if (view === 'form') {
        syncJsonToFormEditor();
        if (state.jsonEditorState.searchQuery) {
            renderFormEditor(state.jsonEditorState.searchQuery);
        }
    }
}

export function syncJsonToFormEditor() {
    try {
        const textarea = document.getElementById('json-editor-textarea');
        const config = JSON.parse(textarea.value);
        state.jsonEditorState.fullConfig = config;
        renderFormEditor(state.jsonEditorState.searchQuery || '');
    } catch (e) {
        alert("Cannot switch to Form Editor: JSON is invalid.\n\nFix the JSON errors first.");
        switchEditorView('raw');
    }
}

export function renderFormEditor(filterQuery = '') {
    const container = document.getElementById('form-editor-container');
    const config = state.jsonEditorState.fullConfig;

    if (!config || !config.pages || config.pages.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full text-base-content/40 text-sm gap-2">
                <div class="text-3xl">&#x1F4DD;</div>
                <div>No pages found in the locator configuration</div>
            </div>`;
        return;
    }

    let html = '';
    const query = filterQuery.toLowerCase().trim();

    config.pages.forEach((page, pageIdx) => {
        let pageHtml = '';
        let matchedCount = 0;

        (page.elements || []).forEach((el, elIdx) => {
            const name = (el.name || '').toLowerCase();
            const type = (el.type || el.elementType || '').toLowerCase();
            const mode = (el.mode || '').toLowerCase();
            const locatorsStr = el.locators ? el.locators.map(l => l.value).join(' ').toLowerCase() : '';
            const locatorStrSingle = el.locator ? el.locator.toLowerCase() : '';

            if (query && !name.includes(query) && !type.includes(query) && !mode.includes(query) && !locatorsStr.includes(query) && !locatorStrSingle.includes(query)) {
                return;
            }

            matchedCount++;
            pageHtml += renderFormElement(el, pageIdx, elIdx);
        });

        if (matchedCount > 0 || !query) {
            html += `<div class="mb-5">`;
            html += `<div class="text-xs font-bold text-base-content/40 uppercase tracking-wider mb-2.5 pb-1.5 border-b border-base-300">Page: ${escapeHtml(page.name)} (${matchedCount} elements)</div>`;
            html += pageHtml;
            html += `</div>`;
        }
    });

    if (!html) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center p-10 text-base-content/40 text-sm gap-2">
                <div class="text-3xl">🔍</div>
                <div>No elements match "${escapeHtml(filterQuery)}"</div>
            </div>`;
    } else {
        container.innerHTML = html;
    }
}

export function renderFormElement(el, pageIdx, elIdx) {
    if (!state.isV2) {
        let html = `
            <div class="form-element-block mb-3 p-3 border border-base-300 rounded-lg bg-base-200" data-page="${pageIdx}" data-el="${elIdx}">
                <div class="flex items-center justify-between mb-2.5">
                    <strong class="text-sm font-semibold">${escapeHtml(el.name)}</strong>
                    <span class="text-xs text-base-content/50">${escapeHtml(el.type || 'element')} / ${escapeHtml(el.mode || 'N/A')}</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-semibold text-base-content/60">Name</label>
                        <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.name)}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'name', this.value)">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-semibold text-base-content/60">Type</label>
                        <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.type || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'type', this.value)">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-semibold text-base-content/60">Mode</label>
                        <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.mode || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'mode', this.value)">
                    </div>
                    <div class="flex flex-col gap-1">
                        <label class="text-xs font-semibold text-base-content/60">Event</label>
                        <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.event || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'event', this.value)">
                    </div>
                </div>`;

        html += `<div class="mt-2.5"><div class="text-xs font-bold text-base-content/40 uppercase tracking-wider mb-1.5">Locators</div>`;

        (el.locators || []).forEach((loc, locIdx) => {
            const isPreferred = loc.preferred;
            html += `
                <div class="locator-form-row ${isPreferred ? 'preferred' : ''}">
                    <div class="locator-form-fields">
                        <select class="select select-bordered select-sm" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'locator_type', this.value)">
                            <option value="css" ${loc.locator_type === 'css' ? 'selected' : ''}>CSS</option>
                            <option value="xpath" ${loc.locator_type === 'xpath' ? 'selected' : ''}>XPath</option>
                        </select>
                        <input class="input input-bordered input-sm font-mono text-xs" type="text" value="${escapeHtml(loc.value)}" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'value', this.value)" title="Locator value">
                        <select class="select select-bordered select-sm" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'preferred', this.value === 'true')" title="Preferred locator">
                            <option value="false" ${!loc.preferred ? 'selected' : ''}>Normal</option>
                            <option value="true" ${loc.preferred ? 'selected' : ''}>Preferred</option>
                        </select>
                    </div>
                    <button class="btn btn-xs btn-ghost text-error shrink-0" onclick="removeFormLocator(${pageIdx}, ${elIdx}, ${locIdx})" title="Remove locator">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>`;
        });

        html += `<button class="btn btn-xs btn-outline border-dashed w-full mt-2 gap-1" onclick="addFormLocator(${pageIdx}, ${elIdx})">+ Add Locator</button>`;
        html += `</div></div>`;

        return html;
    } else {
        const config = state.jsonEditorState.fullConfig;
        const page = config.pages[pageIdx];
        
        let parentOptionsHtml = `<option value="">-- No Parent (Root) --</option>`;
        (page.elements || []).forEach(otherEl => {
            if (otherEl.uuid !== el.uuid) {
                const selectedAttr = (el.parent === otherEl.uuid) ? 'selected' : '';
                parentOptionsHtml += `<option value="${escapeHtml(otherEl.uuid)}" ${selectedAttr}>${escapeHtml(otherEl.name)}</option>`;
            }
        });
        
        let html = `
        <div class="form-element-block mb-3 p-3 border border-base-300 rounded-lg bg-base-200" data-page="${pageIdx}" data-el="${elIdx}">
            <div class="flex items-center justify-between mb-2.5">
                <strong class="text-sm font-semibold">${escapeHtml(el.name)}</strong>
                <span class="text-xs text-base-content/50">${escapeHtml(el.elementType || 'element')} / Event: ${escapeHtml(el.event || 'N/A')}</span>
            </div>
            <div class="form-grid">
                <div class="flex flex-col gap-1">
                        <label class="text-xs font-semibold text-base-content/60">Name</label>
                        <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.name)}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'name', this.value)">
                </div>
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-base-content/60">Element Type</label>
                    <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.elementType || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'elementType', this.value)">
                </div>
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-base-content/60">Event</label>
                    <input class="input input-bordered input-sm" type="text" value="${escapeHtml(el.event || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'event', this.value)">
                </div>
                <div class="flex flex-col gap-1">
                    <label class="text-xs font-semibold text-base-content/60">Parent Component</label>
                    <select class="select select-bordered select-sm" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'parent', this.value || null)">
                        ${parentOptionsHtml}
                    </select>
                </div>
            </div>
            <div class="mt-2.5">
                <div class="text-xs font-bold text-base-content/40 uppercase tracking-wider mb-1.5">Locator</div>
                <div class="locator-form-row preferred">
                    <div class="locator-form-fields grid grid-cols-[100px_1fr] gap-2 items-center">
                        <select class="select select-bordered select-sm" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'locatorType', this.value)">
                            <option value="CSS" ${String(el.locatorType).toUpperCase() === 'CSS' ? 'selected' : ''}>CSS</option>
                            <option value="XPATH" ${String(el.locatorType).toUpperCase() === 'XPATH' ? 'selected' : ''}>XPath</option>
                        </select>
                        <input class="input input-bordered input-sm font-mono text-xs" type="text" value="${escapeHtml(el.locator || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'locator', this.value)" title="Locator value">
                    </div>
                </div>
            </div>
        </div>`;
        return html;
    }
}

export function updateFormElementField(pageIdx, elIdx, field, value) {
    const page = state.jsonEditorState.fullConfig.pages[pageIdx];
    if (!page || !page.elements[elIdx]) return;

    page.elements[elIdx][field] = value;
    markModified();
    syncFormToJson();
}

export function updateFormLocatorField(pageIdx, elIdx, locIdx, field, value) {
    const page = state.jsonEditorState.fullConfig.pages[pageIdx];
    if (!page || !page.elements[elIdx] || !page.elements[elIdx].locators[locIdx]) return;

    page.elements[elIdx].locators[locIdx][field] = value;

    if (field === 'preferred' && value === true) {
        page.elements[elIdx].locators.forEach((l, i) => {
            if (i !== locIdx) l.preferred = false;
        });
    }

    markModified();
    syncFormToJson();
}

export function addFormLocator(pageIdx, elIdx) {
    const page = state.jsonEditorState.fullConfig.pages[pageIdx];
    if (!page || !page.elements[elIdx]) return;

    page.elements[elIdx].locators.push({
        locator_type: 'css',
        value: '',
        preferred: false,
        score: 0,
        strategy: 'default',
        matched_count: 0,
        visible_count: 0
    });

    markModified();
    syncFormToJson();
}

export function removeFormLocator(pageIdx, elIdx, locIdx) {
    const page = state.jsonEditorState.fullConfig.pages[pageIdx];
    if (!page || !page.elements[elIdx]) return;

    page.elements[elIdx].locators.splice(locIdx, 1);
    markModified();
    syncFormToJson();
}

export function syncFormToJson() {
    const jsonStr = JSON.stringify(state.jsonEditorState.fullConfig, null, 2);
    document.getElementById('json-editor-textarea').value = jsonStr;
    state.jsonEditorState.currentJson = jsonStr;

    const validation = validateJsonString(jsonStr);
    if (validation.valid) {
        updateJsonEditorStatus('valid', 'Valid JSON');
    }
}

export function markModified() {
    state.jsonEditorState.isModified = true;
    updateSaveHint();
}

export function formatJsonEditor() {
    const textarea = document.getElementById('json-editor-textarea');
    try {
        const parsed = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(parsed, null, 2);
        state.jsonEditorState.currentJson = textarea.value;
        textarea.classList.remove('has-error');
        updateJsonEditorStatus('valid', 'Valid JSON');
        markModified();
    } catch (e) {
        textarea.classList.add('has-error');
        updateJsonEditorStatus('invalid', 'Invalid JSON');
    }
}

export function minifyJsonEditor() {
    const textarea = document.getElementById('json-editor-textarea');
    try {
        const parsed = JSON.parse(textarea.value);
        textarea.value = JSON.stringify(parsed);
        state.jsonEditorState.currentJson = textarea.value;
        textarea.classList.remove('has-error');
        updateJsonEditorStatus('valid', 'Valid JSON');
        markModified();
    } catch (e) {
        textarea.classList.add('has-error');
        updateJsonEditorStatus('invalid', 'Invalid JSON');
    }
}

export function validateJsonEditor() {
    const textarea = document.getElementById('json-editor-textarea');
    const result = validateJsonString(textarea.value);

    if (result.valid) {
        textarea.classList.remove('has-error');
        updateJsonEditorStatus('valid', 'Valid JSON');
        alert("JSON is valid!");
    } else {
        textarea.classList.add('has-error');
        updateJsonEditorStatus('invalid', 'Invalid JSON');
        alert("JSON Error:\n\n" + result.error);
    }
}

export function validateJsonString(text) {
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object') {
            return { valid: false, error: 'Root must be a JSON object or array.' };
        }
        if (!parsed.pages) {
            return { valid: false, error: 'Missing required "pages" key.' };
        }
        if (!Array.isArray(parsed.pages)) {
            return { valid: false, error: '"pages" must be an array.' };
        }
        return { valid: true, error: null };
    } catch (e) {
        const match = e.message.match(/position\s+(\d+)/i);
        let detail = '';
        if (match) {
            const pos = parseInt(match[1]);
            const lines = text.substring(0, pos).split('\n');
            detail = ` (line ${lines.length}, col ${lines[lines.length - 1].length})`;
        }
        return { valid: false, error: e.message + detail };
    }
}

export function updateJsonEditorStatus(status, text) {
    const el = document.getElementById('json-editor-status');
    el.className = 'json-editor-status ' + status;
    el.textContent = text;
}

export function updateSaveHint() {
    const hint = document.getElementById('json-editor-save-hint');
    if (state.jsonEditorState.isModified) {
        hint.textContent = "Unsaved changes";
        hint.style.color = 'oklch(var(--wa))';
    } else {
        hint.textContent = "No changes";
        hint.style.color = 'oklch(var(--bc) / 0.5)';
    }
}

export function updateLineInfo(textarea) {
    const info = document.getElementById('json-editor-line-info');
    const val = textarea.value;
    const pos = textarea.selectionStart;
    const lines = val.substring(0, pos).split('\n');
    const ln = lines.length;
    const col = lines[lines.length - 1].length + 1;
    info.textContent = `Ln ${ln}, Col ${col}`;
}

export async function loadFullLocatorConfig() {
    const folder = getCurrentFolder();
    const key = `locators||${folder}`;
    let config = await dbHelper.getConfig(key) || await dbHelper.getConfig('locators||');

    if (config) {
        const currentPage = state.locatorsConfig.pages[state.currentPageIndex];
        if (currentPage) {
            const fullPage = config.pages.find(p => p.name === currentPage.name);
            if (fullPage) {
                fullPage.elements = currentPage.elements;
            }
        }
    }

    return config;
}

export function getCurrentFolder() {
    const groupSelect = document.getElementById('group-select');
    const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);

    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= activeGroups.length) return '';
    return activeGroups[groupIdx].folder || '';
}

export async function saveLocatorToDBOnly() {
    const textarea = document.getElementById('json-editor-textarea');
    const validation = validateJsonString(textarea.value);

    if (!validation.valid) {
        alert("Cannot save: JSON is invalid.\n\n" + validation.error);
        return;
    }

    try {
        const config = JSON.parse(textarea.value);
        const folder = state.jsonEditorState.folder;
        const key = `locators||${folder}`;

        await dbHelper.setConfig(key, config);
        state.jsonEditorState.fullConfig = config;
        state.jsonEditorState.originalJson = JSON.stringify(config, null, 2);
        state.jsonEditorState.currentJson = state.jsonEditorState.originalJson;
        state.jsonEditorState.isModified = false;

        applyConfigToUI(config);
        updateSaveHint();
        showToast("Saved to browser", "success");
    } catch (e) {
        console.error("Error saving to DB:", e);
        showToast("Save failed: " + e.message, "error");
    }
}

export async function saveLocatorToDiskAndDB() {
    const textarea = document.getElementById('json-editor-textarea');
    const validation = validateJsonString(textarea.value);

    if (!validation.valid) {
        alert("Cannot save: JSON is invalid.\n\n" + validation.error);
        return;
    }

    try {
        const config = JSON.parse(textarea.value);
        const folder = state.jsonEditorState.folder;
        const key = `locators||${folder}`;

        await dbHelper.setConfig(key, config);

        let url = '/api/locators';
        if (folder) {
            url += `?dir=${encodeURIComponent(folder)}`;
        }

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });

        const result = await res.json();

        if (!res.ok) {
            throw new Error(result.error || 'Server write failed');
        }

        state.jsonEditorState.fullConfig = config;
        state.jsonEditorState.originalJson = JSON.stringify(config, null, 2);
        state.jsonEditorState.currentJson = state.jsonEditorState.originalJson;
        state.jsonEditorState.isModified = false;

        applyConfigToUI(config);
        updateSaveHint();
        showToast("Saved to disk & browser", "success");
    } catch (e) {
        console.error("Error saving to disk:", e);
        showToast("Disk save failed: " + e.message + ". Saved to browser only.", "error");

        try {
            const config = JSON.parse(textarea.value);
            const key = `locators||${state.jsonEditorState.folder}`;
            await dbHelper.setConfig(key, config);
            state.jsonEditorState.fullConfig = config;
            state.jsonEditorState.originalJson = JSON.stringify(config, null, 2);
            state.jsonEditorState.currentJson = state.jsonEditorState.originalJson;
            state.jsonEditorState.isModified = false;
            applyConfigToUI(config);
            updateSaveHint();
        } catch (err2) {
            console.error("Fallback DB save also failed:", err2);
        }
    }
}

export function applyConfigToUI(config) {
    if (!config || !config.pages) return;

    const page = state.locatorsConfig.pages[state.currentPageIndex];
    if (page) {
        const updatedPage = config.pages.find(p => p.name === page.name);
        if (updatedPage) {
            state.locatorsConfig.pages[state.currentPageIndex] = updatedPage;
        }
    }

    if (state.currentPageIndex >= 0 && state.locatorsConfig.pages && state.locatorsConfig.pages.length > 0) {
        window.evaluateAllLocatorsInIframe();
    }

    window.updateStatsPanel();
    window.renderElementsList();
    window.populateFiltersDropdowns();
}

const textarea = document.getElementById('json-editor-textarea');
if (textarea) {
    textarea.addEventListener('input', () => {
        const result = validateJsonString(textarea.value);
        if (result.valid) {
            textarea.classList.remove('has-error');
            updateJsonEditorStatus('valid', 'Valid JSON');
        } else {
            textarea.classList.add('has-error');
            updateJsonEditorStatus('invalid', 'Invalid JSON');
        }
        markModified();
    });

    textarea.addEventListener('keyup', () => updateLineInfo(textarea));
    textarea.addEventListener('click', () => updateLineInfo(textarea));
}

export function onJsonSearchInput(query) {
    state.jsonEditorState.searchQuery = query;
    if (state.jsonEditorState.activeView === 'form') {
        renderFormEditor(query);
    } else {
        const textarea = document.getElementById('json-editor-textarea');
        const text = textarea.value;
        
        if (!query) {
            const validation = validateJsonString(text);
            updateJsonEditorStatus(validation.valid ? 'valid' : 'invalid', validation.valid ? 'Valid JSON' : 'Invalid JSON');
            return;
        }
        
        let count = 0;
        let firstMatchIdx = -1;
        let pos = text.toLowerCase().indexOf(query.toLowerCase());
        while (pos !== -1) {
            if (count === 0) firstMatchIdx = pos;
            count++;
            pos = text.toLowerCase().indexOf(query.toLowerCase(), pos + query.length);
        }
        
        updateJsonEditorStatus('valid', `${count} matches found`);
        
        if (firstMatchIdx !== -1) {
            textarea.focus();
            textarea.setSelectionRange(firstMatchIdx, firstMatchIdx + query.length);
            
            // Scroll to selection
            const line = text.substring(0, firstMatchIdx).split('\n').length;
            const lineHeight = 18;
            textarea.scrollTop = (line - 5) * lineHeight;
            updateLineInfo(textarea);
        }
    }
}

// Window exposure
window.openJsonEditor = openJsonEditor;
window.closeJsonEditor = closeJsonEditor;
window.switchEditorView = switchEditorView;
window.formatJsonEditor = formatJsonEditor;
window.minifyJsonEditor = minifyJsonEditor;
window.validateJsonEditor = validateJsonEditor;
window.saveLocatorToDBOnly = saveLocatorToDBOnly;
window.saveLocatorToDiskAndDB = saveLocatorToDiskAndDB;
window.updateFormElementField = updateFormElementField;
window.updateFormLocatorField = updateFormLocatorField;
window.addFormLocator = addFormLocator;
window.removeFormLocator = removeFormLocator;
window.onJsonSearchInput = onJsonSearchInput;
