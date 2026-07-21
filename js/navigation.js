// js/navigation.js - Groups dropdown, step selection, nav buttons, keyboard shortcuts

import { state } from './state.js';
import { escapeHtml } from './utils.js';

let pendingDeleteGroup = null;

export function populateGroupsDropdown() {
    const select = document.getElementById('group-select');
    select.innerHTML = '<option value="">-- Load a test group --</option>';

    const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);

    activeGroups.forEach((group, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = group.name;
        select.appendChild(opt);
    });

    // Auto-select first group if available
    if (activeGroups.length > 0) {
        select.value = 0;
        onGroupChanged();
    } else {
        select.value = "";
        document.getElementById('btn-delete-group').style.display = 'none';
        const stepSelect = document.getElementById('step-select');
        stepSelect.innerHTML = '<option value="">-- Select a step --</option>';
        stepSelect.disabled = true;
        window.toggleWelcomeDashboard(true);
    }
}

export function onGroupChanged() {
    window.resetInspectMode();
    const groupSelect = document.getElementById('group-select');
    const stepSelect = document.getElementById('step-select');

    const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);

    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= activeGroups.length) {
        document.getElementById('btn-delete-group').style.display = 'none';
        stepSelect.innerHTML = '<option value="">-- Select a step --</option>';
        stepSelect.disabled = true;
        state.locatorsConfig = { pages: [] };
        state.currentPageIndex = -1;
        state.currentElementIndex = -1;
        window.closeDetailsModal();
        window.renderEmptyListPlaceholder();
        window.updateStatsPanel();

        const summary = document.getElementById('filter-results-summary');
        if (summary) summary.style.display = 'none';

        window.toggleWelcomeDashboard(true);
        return;
    }

    const group = activeGroups[groupIdx];
    document.getElementById('btn-delete-group').style.display = 'flex';
    stepSelect.innerHTML = '';
    stepSelect.disabled = false;

    group.mappings.forEach((mapping, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = mapping.page_name;
        stepSelect.appendChild(opt);
    });

    // Auto-select first step
    stepSelect.value = 0;
    onStepChanged();
}

export function confirmDeleteGroup() {
    const groupSelect = document.getElementById('group-select');
    const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);

    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= activeGroups.length) return;

    pendingDeleteGroup = activeGroups[groupIdx];

    document.getElementById('confirm-delete-group-desc').textContent =
        `Are you sure you want to delete "${pendingDeleteGroup.name}"? This action cannot be undone.`;
    document.getElementById('confirm-delete-group-name').textContent =
        `Group: ${pendingDeleteGroup.name}`;

    const details = [
        'Group mapping will be removed',
        'Locator configuration will be deleted',
        'Batch associations will be removed',
        'MHTML archive files will be deleted'
    ];
    document.getElementById('confirm-delete-group-details').innerHTML = details.map(d =>
        `<div class="confirm-list-item">${escapeHtml(d)}</div>`
    ).join('');

    document.getElementById('confirm-delete-group-modal').style.display = 'flex';
}

export function closeConfirmDeleteGroupModal() {
    document.getElementById('confirm-delete-group-modal').style.display = 'none';
    pendingDeleteGroup = null;
}

export async function executeDeleteGroup() {
    if (!pendingDeleteGroup) return;

    const group = pendingDeleteGroup;

    const fullIdx = state.mapperConfig.test_groups.findIndex(g => g.folder === group.folder);
    if (fullIdx !== -1) {
        state.mapperConfig.test_groups.splice(fullIdx, 1);
    }

    await dbHelper.setConfig('mapper', state.mapperConfig);

    if (group.folder) {
        await dbHelper.deleteConfig(`locators||${group.folder}`);
        await dbHelper.deleteConfig(`mhtml_batch||${group.folder}`);
    } else {
        await dbHelper.deleteConfig('locators||');
        await dbHelper.deleteConfig('mhtml_batch');
    }

    // Delete MHTML files referenced by this group's mappings
    if (group.mappings && Array.isArray(group.mappings)) {
        for (const mapping of group.mappings) {
            if (mapping.mhtml_file) {
                try {
                    await dbHelper.deleteMhtmlFile(mapping.mhtml_file);
                } catch (err) {
                    console.warn(`Failed to delete MHTML file "${mapping.mhtml_file}":`, err);
                }
            }
        }
    }

    closeConfirmDeleteGroupModal();
    populateGroupsDropdown();
    await window.initApp();
}

export function populateFiltersDropdowns() {
    const typeSelect = document.getElementById('filter-type');
    const modeSelect = document.getElementById('filter-mode');

    typeSelect.innerHTML = '<option value="">All Types</option>';
    modeSelect.innerHTML = '<option value="">All Modes</option>';

    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) return;

    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements || [];

    const types = new Set();
    const modes = new Set();

    elements.forEach(el => {
        const type = el.type || el.elementType;
        if (type) types.add(type);
        if (el.mode) modes.add(el.mode);
    });

    Array.from(types).sort().forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        typeSelect.appendChild(opt);
    });

    Array.from(modes).sort().forEach(mode => {
        const opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = mode;
        modeSelect.appendChild(opt);
    });
}

export async function onStepChanged() {
    window.resetInspectMode();
    const groupSelect = document.getElementById('group-select');
    const stepSelect = document.getElementById('step-select');

    const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);
    const stepIdx = parseInt(stepSelect.value);

    if (isNaN(groupIdx) || isNaN(stepIdx)) {
        window.toggleWelcomeDashboard(true);
        return;
    }

    const group = activeGroups[groupIdx];
    const mapping = group ? group.mappings[stepIdx] : null;

    if (!mapping || !mapping.mhtml_file) {
        window.toggleWelcomeDashboard(true);
        return;
    }

    window.toggleWelcomeDashboard(false);

    const folder = group.folder || '';
    const mhtmlFile = mapping.mhtml_file;
    const pageName = mapping.page_name;

    const relativePath = mhtmlFile;
    const iframe = document.getElementById('preview-iframe');

    // 1. Set iframe source to serve the MHTML archive (intercepted by Service Worker)
    iframe.src = `/serve_mhtml/${encodeURIComponent(relativePath)}`;

    // 2. Load locator configuration specifically for this group and page name from IndexedDB
    try {
        const key = `locators||${folder}`;
        let locatorsData = await dbHelper.getConfig(key) || await dbHelper.getConfig('locators||');

        // Fallback: try fetching locator config from local backend server
        if (!locatorsData) {
            try {
                let url = `/api/locators?page=${encodeURIComponent(pageName)}`;
                if (folder) {
                    url += `&dir=${encodeURIComponent(folder)}`;
                }
                const res = await fetch(url);
                if (res.ok) {
                    locatorsData = await res.json();
                }
            } catch (err) {
                console.warn('[App] Local backend server locator config fetch failed:', err);
            }
        }

        if (locatorsData) {
            const filteredPages = (locatorsData.pages || []).filter(p => p.name === pageName);
            state.locatorsConfig = { pages: filteredPages };
        } else {
            state.locatorsConfig = { pages: [] };
        }

        // Detect V2 schema
        let isV2 = false;
        if (state.locatorsConfig.pages && state.locatorsConfig.pages.length > 0) {
            const elements = state.locatorsConfig.pages[0].elements || [];
            isV2 = elements.some(el => el.elementType !== undefined || el.locator !== undefined);
        }
        state.isV2 = isV2;

        state.currentPageIndex = 0; // Filtered pages array only contains this single page
        state.currentElementIndex = 0;

        // Reset filters on step change
        document.getElementById('search-input').value = '';
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-mode').value = '';
        document.getElementById('filter-status').value = '';
        state.selectedElements.clear();

        populateFiltersDropdowns();
        window.updateStatsPanel();
        // Render immediately with the loaded config. The iframe's `onload` handler
        // (js/iframe.js) will also re-render once it finishes evaluating locators against
        // the live DOM — but that's a race against this same fetch, and if the iframe
        // (often just a small local file) finishes loading before this async fetch resolves,
        // that onload fires too early and skips the render entirely, leaving the sidebar
        // list stuck empty. Rendering here guarantees the list always appears.
        window.renderElementsList();
        updateNavButtons();
    } catch(e) {
        console.error("Error loading step locators config from IndexedDB:", e);
    }
}

export function navigateSteps(direction) {
    const stepSelect = document.getElementById('step-select');
    if (stepSelect.disabled) return;

    const currentIdx = stepSelect.selectedIndex;
    const newIdx = currentIdx + direction;

    if (newIdx < 0 || newIdx >= stepSelect.options.length) return;

    stepSelect.selectedIndex = newIdx;
    onStepChanged();
}

export function updateNavButtons() {
    const groupSelect = document.getElementById('group-select');
    const stepSelect = document.getElementById('step-select');

    const idx = stepSelect.selectedIndex;
    const total = stepSelect.options.length;
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const label = document.getElementById('nav-label');

    btnPrev.disabled = idx <= 0;
    btnNext.disabled = idx >= total - 1 || total <= 1;

    if (idx >= 0 && idx < total) {
        const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
        const group = activeGroups[parseInt(groupSelect.value)];
        label.textContent = `${idx + 1} / ${total} — ${stepSelect.options[idx].textContent}`;
        label.title = `${group.name} workflow step`;
    } else {
        label.textContent = 'No active step';
        label.removeAttribute('title');
    }
}

export function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore key events when typing in search input field or inside upload modal logs
        if (document.activeElement === document.getElementById('search-input')) {
            return;
        }

        if (e.key === 'ArrowRight') {
            window.nextElement();
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            window.prevElement();
            e.preventDefault();
        } else if (e.key === 'Enter') {
            window.nextElement();
            e.preventDefault();
        } else if (e.key === ']') {
            navigateSteps(1);
            e.preventDefault();
        } else if (e.key === '[') {
            navigateSteps(-1);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            if (typeof window.closeElementEditForm === 'function') {
                window.closeElementEditForm();
            }
            window.closeDetailsModal();
            window.closeUploadModal();
            window.closeConfirmRemoveModal();
            window.closeJsonEditor();
            window.dismissAppDialog();
            e.preventDefault();
        } else if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            window.openJsonEditor();
        }
    });
}

// Window exposure for HTML onclick handlers and cross-module calls
window.populateGroupsDropdown = populateGroupsDropdown;
window.onGroupChanged = onGroupChanged;
window.onStepChanged = onStepChanged;
window.confirmDeleteGroup = confirmDeleteGroup;
window.closeConfirmDeleteGroupModal = closeConfirmDeleteGroupModal;
window.executeDeleteGroup = executeDeleteGroup;
window.navigateSteps = navigateSteps;
window.populateFiltersDropdowns = populateFiltersDropdowns;
