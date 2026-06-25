// js/bulkActions.js - Element selection, select-all, remove, export

import { state } from './state.js';
import { escapeHtml } from './utils.js';

export function toggleElementSelection(idx, checked) {
    if (checked) {
        state.selectedElements.add(idx);
    } else {
        state.selectedElements.delete(idx);
    }
    updateRemoveButtonState();
    updateSelectAllState();
}

export function toggleSelectAll() {
    const selectAllBtn = document.getElementById('btn-select-all');
    if (!selectAllBtn) return;
    
    const shouldSelect = selectAllBtn.checked;

    state.filteredIndices.forEach(idx => {
        if (shouldSelect) {
            state.selectedElements.add(idx);
        } else {
            state.selectedElements.delete(idx);
        }
    });

    updateRemoveButtonState();
    window.renderElementsList();
}

export function updateSelectAllState() {
    const selectAllBtn = document.getElementById('btn-select-all');
    if (!selectAllBtn) return;
    const allFilteredSelected = state.filteredIndices.length > 0 && state.filteredIndices.every(idx => state.selectedElements.has(idx));
    const someSelected = state.filteredIndices.some(idx => state.selectedElements.has(idx));
    
    selectAllBtn.checked = allFilteredSelected;
    selectAllBtn.indeterminate = !allFilteredSelected && someSelected;
}

export function updateRemoveButtonState() {
    const btn = document.getElementById('btn-remove-selected');
    const badge = document.getElementById('remove-count-badge');
    if (!btn || !badge) return;

    const count = state.selectedElements.size;
    badge.textContent = count;
    btn.disabled = count === 0;
}

export function removeSelectedElements() {
    if (state.selectedElements.size === 0) return;

    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements;
    const selectedNames = [];

    state.selectedElements.forEach(idx => {
        if (elements[idx]) {
            selectedNames.push(elements[idx].name);
        }
    });

    // Populate confirmation modal
    const desc = document.getElementById('confirm-remove-desc');
    const countEl = document.getElementById('confirm-remove-count');
    const listEl = document.getElementById('confirm-remove-list');

    desc.textContent = `Are you sure you want to remove ${selectedNames.length} element${selectedNames.length > 1 ? 's' : ''} from the locator configuration? This action cannot be undone.`;
    countEl.textContent = `${selectedNames.length} element${selectedNames.length > 1 ? 's' : ''} will be removed`;

    listEl.innerHTML = selectedNames.map(name =>
        `<div class="confirm-list-item">${escapeHtml(name)}</div>`
    ).join('');

    document.getElementById('confirm-remove-modal').style.display = 'flex';
}

export function closeConfirmRemoveModal() {
    document.getElementById('confirm-remove-modal').style.display = 'none';
}

export async function confirmRemoveElements() {
    if (state.selectedElements.size === 0) return;

    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements;

    // Sort indices descending to remove from end first (preserve earlier indices)
    const sortedIndices = Array.from(state.selectedElements).sort((a, b) => b - a);
    sortedIndices.forEach(idx => {
        if (idx >= 0 && idx < elements.length) {
            elements.splice(idx, 1);
        }
    });

    // Save updated config back to IndexedDB
    await saveLocatorConfigToDB();

    // Clear selection
    state.selectedElements.clear();
    state.currentElementIndex = Math.min(state.currentElementIndex, elements.length - 1);

    // Close modal and re-render
    closeConfirmRemoveModal();
    window.updateStatsPanel();
    window.renderElementsList();
}

export async function saveLocatorConfigToDB() {
    try {
        // Reconstruct the full locator config from IndexedDB
        const groupSelect = document.getElementById('group-select');
        const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
        const groupIdx = parseInt(groupSelect.value);
        const group = activeGroups[groupIdx];
        if (!group) return;

        const folder = group.folder || '';
        const key = `locators||${folder}`;
        let fullConfig = await dbHelper.getConfig(key) || await dbHelper.getConfig('locators||');
        if (!fullConfig) return;

        // Update the current page's elements in the full config
        const currentPage = state.locatorsConfig.pages[state.currentPageIndex];
        if (currentPage) {
            const fullPage = fullConfig.pages.find(p => p.name === currentPage.name);
            if (fullPage) {
                fullPage.elements = currentPage.elements;
            }
        }

        await dbHelper.setConfig(key, fullConfig);
    } catch (e) {
        console.error("Error saving locator config to DB:", e);
    }
}

export async function exportLocatorJson() {
    try {
        // Fetch full locator config from IndexedDB
        const groupSelect = document.getElementById('group-select');
        const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
        const groupIdx = parseInt(groupSelect.value);
        const group = activeGroups[groupIdx];
        if (!group) {
            alert("No active test group selected. Cannot export.");
            return;
        }

        const folder = group.folder || '';
        const key = `locators||${folder}`;
        let fullConfig = await dbHelper.getConfig(key) || await dbHelper.getConfig('locators||');
        if (!fullConfig || !fullConfig.pages || fullConfig.pages.length === 0) {
            alert("No locator configuration found to export.");
            return;
        }

        // Apply any in-memory changes for the current page
        const currentPage = state.locatorsConfig.pages[state.currentPageIndex];
        if (currentPage) {
            const fullPage = fullConfig.pages.find(p => p.name === currentPage.name);
            if (fullPage) {
                fullPage.elements = currentPage.elements;
            }
        }

        // Create and trigger download
        const jsonStr = JSON.stringify(fullConfig, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `locator_config_${folder || 'default'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Error exporting locator JSON:", e);
        alert("Failed to export JSON. See console for details.");
    }
}

// Window exposure
window.toggleElementSelection = toggleElementSelection;
window.toggleSelectAll = toggleSelectAll;
window.removeSelectedElements = removeSelectedElements;
window.closeConfirmRemoveModal = closeConfirmRemoveModal;
window.confirmRemoveElements = confirmRemoveElements;
window.exportLocatorJson = exportLocatorJson;
