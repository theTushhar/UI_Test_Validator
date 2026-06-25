// js/jsonEditor.js - Raw editor, form editor, validation, save-to-DB/disk, toast

import { state } from './state.js';
import { escapeHtml } from './utils.js';

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
}

export function switchEditorView(view) {
    state.jsonEditorState.activeView = view;

    document.getElementById('tab-raw').classList.toggle('active', view === 'raw');
    document.getElementById('tab-form').classList.toggle('active', view === 'form');

    document.getElementById('json-editor-raw-view').style.display = view === 'raw' ? 'flex' : 'none';
    document.getElementById('json-editor-form-view').style.display = view === 'form' ? 'flex' : 'none';

    if (view === 'raw') {
        const textarea = document.getElementById('json-editor-textarea');
        updateLineInfo(textarea);
    } else if (view === 'form') {
        syncJsonToFormEditor();
    }
}

export function syncJsonToFormEditor() {
    try {
        const textarea = document.getElementById('json-editor-textarea');
        const config = JSON.parse(textarea.value);
        state.jsonEditorState.fullConfig = config;
        renderFormEditor();
    } catch (e) {
        alert("Cannot switch to Form Editor: JSON is invalid.\n\nFix the JSON errors first.");
        switchEditorView('raw');
    }
}

export function renderFormEditor() {
    const container = document.getElementById('form-editor-container');
    const config = state.jsonEditorState.fullConfig;

    if (!config || !config.pages || config.pages.length === 0) {
        container.innerHTML = `
            <div class="form-editor-placeholder">
                <div class="placeholder-icon">📝</div>
                <div>No pages found in the locator configuration</div>
            </div>`;
        return;
    }

    let html = '';

    config.pages.forEach((page, pageIdx) => {
        html += `<div class="form-section">`;
        html += `<div class="form-section-title">Page: ${escapeHtml(page.name)}</div>`;

        (page.elements || []).forEach((el, elIdx) => {
            html += renderFormElement(el, pageIdx, elIdx);
        });

        html += `</div>`;
    });

    container.innerHTML = html;
}

export function renderFormElement(el, pageIdx, elIdx) {
    const preferredLocIdx = el.locators ? el.locators.findIndex(l => l.preferred) : -1;

    let html = `
        <div class="form-element-block" data-page="${pageIdx}" data-el="${elIdx}" style="margin-bottom: 14px; padding: 12px; border: 1px solid var(--border-glass); border-radius: var(--border-radius-sm); background: var(--bg-primary);">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <strong style="font-size: 0.82rem; color: var(--text-primary);">${escapeHtml(el.name)}</strong>
                <span style="font-size: 0.7rem; color: var(--text-muted);">${el.type || 'element'} / ${el.mode || 'N/A'}</span>
            </div>
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">Name</label>
                    <input class="form-input" type="text" value="${escapeHtml(el.name)}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'name', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Type</label>
                    <input class="form-input" type="text" value="${escapeHtml(el.type || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'type', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Mode</label>
                    <input class="form-input" type="text" value="${escapeHtml(el.mode || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'mode', this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Event</label>
                    <input class="form-input" type="text" value="${escapeHtml(el.event || '')}" onchange="updateFormElementField(${pageIdx}, ${elIdx}, 'event', this.value)">
                </div>
            </div>`;

    html += `<div style="margin-top: 10px;"><div class="form-section-title" style="font-size: 0.72rem; margin-bottom: 6px;">Locators</div>`;

    (el.locators || []).forEach((loc, locIdx) => {
        const isPreferred = loc.preferred;
        html += `
            <div class="locator-form-row ${isPreferred ? 'preferred' : ''}">
                <div class="locator-form-fields">
                    <select class="form-select" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'locator_type', this.value)">
                        <option value="css" ${loc.locator_type === 'css' ? 'selected' : ''}>CSS</option>
                        <option value="xpath" ${loc.locator_type === 'xpath' ? 'selected' : ''}>XPath</option>
                    </select>
                    <input class="form-input mono" type="text" value="${escapeHtml(loc.value)}" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'value', this.value)" title="Locator value">
                    <select class="form-select" onchange="updateFormLocatorField(${pageIdx}, ${elIdx}, ${locIdx}, 'preferred', this.value === 'true')" title="Preferred locator">
                        <option value="false" ${!loc.preferred ? 'selected' : ''}>Normal</option>
                        <option value="true" ${loc.preferred ? 'selected' : ''}>Preferred</option>
                    </select>
                </div>
                <button class="locator-remove-btn" onclick="removeFormLocator(${pageIdx}, ${elIdx}, ${locIdx})" title="Remove locator">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>`;
    });

    html += `<button class="locator-add-btn" onclick="addFormLocator(${pageIdx}, ${elIdx})">+ Add Locator</button>`;
    html += `</div></div>`;

    return html;
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
        hint.style.color = 'var(--comment-color)';
    } else {
        hint.textContent = "No changes";
        hint.style.color = 'var(--text-muted)';
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

export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message;
    toast.className = 'toast-notification ' + type;
    toast.style.display = 'block';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.display = 'none';
    }, 2500);
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
