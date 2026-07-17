// js/elementEditForm.js - Inline single-element edit form shown inside the
// details modal. Distinct from js/jsonEditor.js, which edits the *entire*
// multi-page locator config; this only ever touches the one selected element.
//
// Edits are made on a draft clone and only committed (to state + IndexedDB +
// optionally disk) when the user explicitly saves, mirroring the existing
// whole-config editor's "load a copy, only apply on save" convention.

import { state } from './state.js';
import { escapeHtml, showToast } from './utils.js';
import { loadFullLocatorConfig, getCurrentFolder } from './jsonEditor.js';

let draft = null;

export function openElementEditForm() {
    if (state.currentPageIndex < 0 || state.currentElementIndex < 0) return;
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const el = page && page.elements[state.currentElementIndex];
    if (!el) return;

    draft = JSON.parse(JSON.stringify(el));

    document.getElementById('details-readonly-view').style.display = 'none';
    document.getElementById('details-hotkey-footer').style.display = 'none';
    document.getElementById('element-edit-view').style.display = 'flex';
    document.getElementById('element-edit-footer').style.display = 'flex';

    renderElementEditForm();
}

export function closeElementEditForm() {
    draft = null;
    document.getElementById('element-edit-view').style.display = 'none';
    document.getElementById('element-edit-footer').style.display = 'none';
    document.getElementById('details-readonly-view').style.display = 'flex';
    document.getElementById('details-hotkey-footer').style.display = 'flex';
}

function renderElementEditForm() {
    const container = document.getElementById('element-edit-form-container');
    if (!container || !draft) return;
    container.innerHTML = state.isV2 ? renderV2Form() : renderV1Form();
}

function renderV2Form() {
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const interactions = draft.interaction || [];

    let parentOptionsHtml = '<option value="">-- No Parent (Root) --</option>';
    (page.elements || []).forEach(otherEl => {
        if (otherEl.uuid !== draft.uuid) {
            const selectedAttr = draft.parent === otherEl.uuid ? 'selected' : '';
            parentOptionsHtml += `<option value="${escapeHtml(otherEl.uuid)}" ${selectedAttr}>${escapeHtml(otherEl.name)}</option>`;
        }
    });

    return `
        <div class="form-grid">
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Name</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.name || '')}" onchange="updateDraftField('name', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Element Type</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.elementType || '')}" onchange="updateDraftField('elementType', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Event</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.event || '')}" onchange="updateDraftField('event', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Parent Component</label>
                <select class="select select-bordered select-sm" onchange="updateDraftField('parent', this.value || null)">
                    ${parentOptionsHtml}
                </select>
            </div>
        </div>

        <div class="flex flex-col gap-1 mt-3">
            <label class="text-xs font-semibold text-base-content/60">Interaction</label>
            <div class="edit-chip-row">
                <label class="edit-chip-toggle ${interactions.includes('Input') ? 'active' : ''}">
                    <input type="checkbox" ${interactions.includes('Input') ? 'checked' : ''} onchange="updateDraftInteraction('Input', this.checked)">
                    Input
                </label>
                <label class="edit-chip-toggle ${interactions.includes('Output') ? 'active' : ''}">
                    <input type="checkbox" ${interactions.includes('Output') ? 'checked' : ''} onchange="updateDraftInteraction('Output', this.checked)">
                    Output
                </label>
            </div>
        </div>

        <div class="mt-3">
            <div class="text-xs font-bold text-base-content/40 uppercase tracking-wider mb-1.5">Locator</div>
            <div class="locator-form-row preferred">
                <div class="locator-form-fields grid grid-cols-[100px_1fr] gap-2 items-center">
                    <select class="select select-bordered select-sm" onchange="updateDraftField('locatorType', this.value)">
                        <option value="CSS" ${String(draft.locatorType).toUpperCase() === 'CSS' ? 'selected' : ''}>CSS</option>
                        <option value="XPATH" ${String(draft.locatorType).toUpperCase() === 'XPATH' ? 'selected' : ''}>XPath</option>
                    </select>
                    <input class="input input-bordered input-sm font-mono text-xs" type="text" value="${escapeHtml(draft.locator || '')}" onchange="updateDraftField('locator', this.value)" title="Locator value">
                </div>
            </div>
        </div>

        <div class="flex flex-col gap-2 mt-3">
            <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="checkbox checkbox-sm" ${draft.is_page_load_identifier ? 'checked' : ''} onchange="updateDraftCheckbox('is_page_load_identifier', this.checked)">
                Page Load Identifier
            </label>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="checkbox checkbox-sm" ${draft.locator_unresolved ? 'checked' : ''} onchange="updateDraftCheckbox('locator_unresolved', this.checked)">
                Locator Unresolved
            </label>
        </div>
    `;
}

function renderV1Form() {
    let locatorsHtml = '';
    (draft.locators || []).forEach((loc, locIdx) => {
        locatorsHtml += `
            <div class="locator-form-row ${loc.preferred ? 'preferred' : ''}">
                <div class="locator-form-fields">
                    <select class="select select-bordered select-sm" onchange="updateDraftLocatorField(${locIdx}, 'locator_type', this.value)">
                        <option value="css" ${loc.locator_type === 'css' ? 'selected' : ''}>CSS</option>
                        <option value="xpath" ${loc.locator_type === 'xpath' ? 'selected' : ''}>XPath</option>
                    </select>
                    <input class="input input-bordered input-sm font-mono text-xs" type="text" value="${escapeHtml(loc.value || '')}" onchange="updateDraftLocatorField(${locIdx}, 'value', this.value)" title="Locator value">
                    <select class="select select-bordered select-sm" onchange="updateDraftLocatorField(${locIdx}, 'preferred', this.value === 'true')" title="Preferred locator">
                        <option value="false" ${!loc.preferred ? 'selected' : ''}>Normal</option>
                        <option value="true" ${loc.preferred ? 'selected' : ''}>Preferred</option>
                    </select>
                </div>
                <button class="btn btn-xs btn-ghost text-error shrink-0" onclick="removeDraftLocator(${locIdx})" title="Remove locator">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>`;
    });

    return `
        <div class="form-grid">
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Name</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.name || '')}" onchange="updateDraftField('name', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Type</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.type || '')}" onchange="updateDraftField('type', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Mode</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.mode || '')}" onchange="updateDraftField('mode', this.value)">
            </div>
            <div class="flex flex-col gap-1">
                <label class="text-xs font-semibold text-base-content/60">Event</label>
                <input class="input input-bordered input-sm" type="text" value="${escapeHtml(draft.event || '')}" onchange="updateDraftField('event', this.value)">
            </div>
        </div>

        <div class="mt-3">
            <div class="text-xs font-bold text-base-content/40 uppercase tracking-wider mb-1.5">Locators</div>
            ${locatorsHtml}
            <button class="btn btn-xs btn-outline border-dashed w-full mt-2 gap-1" onclick="addDraftLocator()">+ Add Locator</button>
        </div>
    `;
}

export function updateDraftField(field, value) {
    if (!draft) return;
    draft[field] = value;
}

export function updateDraftCheckbox(field, checked) {
    if (!draft) return;
    draft[field] = checked;
}

export function updateDraftInteraction(value, checked) {
    if (!draft) return;
    const set = new Set(draft.interaction || []);
    if (checked) {
        set.add(value);
    } else {
        set.delete(value);
    }
    draft.interaction = Array.from(set);
}

export function updateDraftLocatorField(locIdx, field, value) {
    if (!draft || !draft.locators || !draft.locators[locIdx]) return;
    draft.locators[locIdx][field] = value;

    if (field === 'preferred' && value === true) {
        draft.locators.forEach((l, i) => {
            if (i !== locIdx) l.preferred = false;
        });
    }
    renderElementEditForm();
}

export function addDraftLocator() {
    if (!draft) return;
    if (!draft.locators) draft.locators = [];
    draft.locators.push({
        locator_type: 'css',
        value: '',
        preferred: false,
        score: 0,
        strategy: 'default',
        matched_count: 0,
        visible_count: 0
    });
    renderElementEditForm();
}

export function removeDraftLocator(locIdx) {
    if (!draft || !draft.locators) return;
    draft.locators.splice(locIdx, 1);
    renderElementEditForm();
}

export async function saveElementEdit(persistToDisk) {
    if (!draft) return;
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const idx = state.currentElementIndex;
    if (!page || idx < 0) return;

    const previous = page.elements[idx];
    page.elements[idx] = draft;
    const savedDraft = draft;

    try {
        const fullConfig = await loadFullLocatorConfig();
        if (!fullConfig) throw new Error('No locator configuration found in IndexedDB.');

        const folder = getCurrentFolder();
        const key = `locators||${folder}`;
        await dbHelper.setConfig(key, fullConfig);

        if (persistToDisk) {
            let url = '/api/locators';
            if (folder) url += `?dir=${encodeURIComponent(folder)}`;

            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fullConfig)
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Server write failed');
        }

        draft = null;
        closeElementEditForm();
        if (typeof window.evaluateAllLocatorsInIframe === 'function') {
            window.evaluateAllLocatorsInIframe();
        }
        window.renderElementsList();
        window.selectElement(idx);
        showToast(persistToDisk ? "Element saved to disk & browser" : "Element saved to browser", "success");
    } catch (e) {
        page.elements[idx] = previous;
        draft = savedDraft;
        console.error('Error saving element:', e);
        showToast("Save failed: " + e.message, "error");
    }
}

window.openElementEditForm = openElementEditForm;
window.closeElementEditForm = closeElementEditForm;
window.updateDraftField = updateDraftField;
window.updateDraftCheckbox = updateDraftCheckbox;
window.updateDraftInteraction = updateDraftInteraction;
window.updateDraftLocatorField = updateDraftLocatorField;
window.addDraftLocator = addDraftLocator;
window.removeDraftLocator = removeDraftLocator;
window.saveElementEdit = saveElementEdit;
