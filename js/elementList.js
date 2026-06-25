// js/elementList.js - List rendering, filtering, stats panel, floating nav

import { state } from './state.js';
import { escapeHtml, escapeJs, scrollIntoViewOnlyContainer } from './utils.js';
import { highlightElementInIframe, clearHighlightsInIframe } from './iframe.js';

export function renderEmptyListPlaceholder() {
    const list = document.getElementById('element-list');
    list.innerHTML = `
        <div class="placeholder-view">
            <div class="placeholder-icon">📋</div>
            <div>Select a test group and step to load elements</div>
        </div>
    `;
}

export function updateStatsPanel() {
    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) {
        document.getElementById('stat-total').textContent = "0";
        document.getElementById('stat-matched').textContent = "0";
        document.getElementById('stat-mismatched').textContent = "0";
        return;
    }
    
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements;
    
    document.getElementById('stat-total').textContent = elements.length;
    
    let matched = 0;
    let mismatched = 0;
    
    elements.forEach(el => {
        let isVisible = false;
        let preferredLoc = el.locators.find(l => l.preferred);
        if (preferredLoc) {
            isVisible = (preferredLoc.visible_count > 0);
        } else {
            isVisible = el.locators.some(l => l.visible_count > 0);
        }
        
        if (el.matched_count > 0 && isVisible) {
            matched++;
        } else {
            mismatched++;
        }
    });
    
    document.getElementById('stat-matched').textContent = matched;
    document.getElementById('stat-mismatched').textContent = mismatched;
}

export function renderElementsList() {
    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) {
        const summary = document.getElementById('filter-results-summary');
        if (summary) summary.style.display = 'none';
        const toolbar = document.getElementById('bulk-actions-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        return;
    }
    
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements;
    const list = document.getElementById('element-list');
    list.innerHTML = '';
    
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    const filterType = document.getElementById('filter-type').value;
    const filterMode = document.getElementById('filter-mode').value;
    const filterStatus = document.getElementById('filter-status').value;
    
    state.filteredIndices = [];
    
    elements.forEach((el, idx) => {
        // 1. Filter by Name Search
        if (searchQuery && !el.name.toLowerCase().includes(searchQuery)) {
            return;
        }
        
        // 2. Filter by Dynamic Type
        if (filterType && el.type !== filterType) {
            return;
        }
        
        // 3. Filter by Dynamic Mode
        if (filterMode && el.mode !== filterMode) {
            return;
        }
        
        const totalMatches = el.matched_count || 0;
        let hasMatches = totalMatches > 0;
        
        let isVisible = false;
        let preferredLoc = el.locators.find(l => l.preferred);
        if (preferredLoc) {
            isVisible = (preferredLoc.visible_count > 0);
        } else {
            isVisible = el.locators.some(l => l.visible_count > 0);
        }
        
        let actualStatus = "mismatched";
        if (hasMatches) {
            actualStatus = isVisible ? "matched" : "hidden";
        }
        
        // 4. Filter by Status
        if (filterStatus) {
            if (filterStatus === "matched" && actualStatus !== "matched") return;
            if (filterStatus === "mismatched" && actualStatus !== "mismatched") return;
            if (filterStatus === "unchecked" && actualStatus !== "hidden") return;
        }
        
        state.filteredIndices.push(idx);
    });
    
    // Update summary banner
    const summary = document.getElementById('filter-results-summary');
    if (summary) {
        summary.style.display = 'block';
        summary.textContent = `Showing ${state.filteredIndices.length} of ${elements.length} elements`;
    }
    
    // Show/hide bulk actions toolbar
    const toolbar = document.getElementById('bulk-actions-toolbar');
    if (toolbar) {
        toolbar.style.display = state.filteredIndices.length > 0 ? 'flex' : 'none';
    }

    // Sync select-all checkbox state
    const selectAllBtn = document.getElementById('btn-select-all');
    if (selectAllBtn) {
        const allFilteredSelected = state.filteredIndices.length > 0 && state.filteredIndices.every(idx => state.selectedElements.has(idx));
        const someSelected = state.filteredIndices.some(idx => state.selectedElements.has(idx));
        selectAllBtn.checked = allFilteredSelected;
        selectAllBtn.indeterminate = !allFilteredSelected && someSelected;
    }

    if (state.filteredIndices.length === 0) {
        list.innerHTML = `
            <div class="placeholder-view">
                <div class="placeholder-icon">🔍</div>
                <div>No elements match your filters</div>
            </div>
        `;
        clearHighlightsInIframe();
        state.currentElementIndex = -1;
        updateFloatNavButtons();
        window.updateRemoveButtonState();
        return;
    }
    
    // Render the filtered elements
    state.filteredIndices.forEach(idx => {
        const el = elements[idx];
        const totalMatches = el.matched_count || 0;
        
        let isVisible = false;
        let preferredLoc = el.locators.find(l => l.preferred);
        if (preferredLoc) {
            isVisible = (preferredLoc.visible_count > 0);
        } else {
            isVisible = el.locators.some(l => l.visible_count > 0);
        }
        
        let badgeClass = "badge-mismatched";
        let badgeText = "No Match";
        if (totalMatches > 0) {
            badgeClass = isVisible ? "badge-matched" : "badge-commented";
            badgeText = isVisible ? "Visible" : "Hidden";
        }
        
        let totalVisibleMatches = 0;
        if (preferredLoc) {
            totalVisibleMatches = preferredLoc.visible_count || 0;
        } else {
            el.locators.forEach(l => {
                totalVisibleMatches = Math.max(totalVisibleMatches, l.visible_count || 0);
            });
        }
        
        const bubbleTitle = `Matches on page: ${totalMatches} (${totalVisibleMatches} visible)`;
        const bubbleText = `${totalVisibleMatches}/${totalMatches} visible`;
        
        const item = document.createElement('div');
        item.className = `element-item ${idx === state.currentElementIndex ? 'active' : ''}`;
        item.id = `el-item-${idx}`;
        item.onclick = () => selectElement(idx, false, true);
        
        const isSelected = state.selectedElements.has(idx);
        item.innerHTML = `
            <div class="el-select" onclick="event.stopPropagation();">
                <input type="checkbox" class="el-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleElementSelection(${idx}, this.checked)">
            </div>
            <div class="el-info">
                <span class="el-name" title="${el.name}">${idx + 1}. ${el.name}</span>
                <span class="el-type">${el.type || 'element'} <span class="status-badge ${badgeClass}">${badgeText}</span></span>
            </div>
            <div class="el-actions">
                <div class="el-match-status">
                    <span class="matches-bubble" title="${bubbleTitle}">${bubbleText}</span>
                </div>
                <button class="details-icon-btn" onclick="event.stopPropagation(); selectElement(${idx}, true);" title="View Details">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                    </svg>
                </button>
            </div>
        `;
        list.appendChild(item);
    });
    
    // Auto-select selection adjustment
    if (state.filteredIndices.length > 0) {
        if (state.currentElementIndex !== -1) {
            const stillVisibleIdx = state.filteredIndices.indexOf(state.currentElementIndex);
            if (stillVisibleIdx === -1) {
                selectElement(state.filteredIndices[0]);
            } else {
                selectElement(state.currentElementIndex);
            }
        }
    }
    
    window.updateRemoveButtonState();
}

export function filterElementsList() {
    renderElementsList();
}

export function deselectElement() {
    state.currentElementIndex = -1;
    
    const items = document.querySelectorAll('.element-item');
    items.forEach(it => it.classList.remove('active'));
    
    clearHighlightsInIframe();
    
    const detailElName = document.getElementById('detail-el-name');
    if (detailElName) detailElName.textContent = "Component Name";
    const detailElType = document.getElementById('detail-el-type');
    if (detailElType) detailElType.textContent = "-";
    const detailElMode = document.getElementById('detail-el-mode');
    if (detailElMode) detailElMode.textContent = "-";
    const detailElEvent = document.getElementById('detail-el-event');
    if (detailElEvent) detailElEvent.textContent = "-";
    
    const locContainer = document.getElementById('detail-locators-container');
    if (locContainer) locContainer.innerHTML = '';
    
    if (state.isModalOpen) {
        window.closeDetailsModal();
    }
    
    updateFloatNavButtons();
    if (typeof window.updateRemoveButtonState === 'function') {
        window.updateRemoveButtonState();
    }
}

export function selectElement(index, forceOpenModal = false, allowDeselect = false) {
    if (state.currentPageIndex < 0 || !state.locatorsConfig.pages || state.locatorsConfig.pages.length === 0) return;
    
    const page = state.locatorsConfig.pages[state.currentPageIndex];
    const elements = page.elements;
    
    if (index < 0 || index >= elements.length) return;
    
    if (allowDeselect && index === state.currentElementIndex) {
        deselectElement();
        return;
    }
    
    const items = document.querySelectorAll('.element-item');
    items.forEach(it => it.classList.remove('active'));
    
    state.currentElementIndex = index;
    const activeItem = document.getElementById(`el-item-${state.currentElementIndex}`);
    if (activeItem) {
        activeItem.classList.add('active');
        const listContainer = document.getElementById('element-list');
        scrollIntoViewOnlyContainer(activeItem, listContainer);
    }
    
    const el = elements[index];
    
    // Details panel setup
    document.getElementById('detail-el-name').textContent = el.name;
    document.getElementById('detail-el-type').textContent = el.type || 'N/A';
    document.getElementById('detail-el-mode').textContent = el.mode || 'N/A';
    document.getElementById('detail-el-event').textContent = el.event || 'N/A';
    
    // Build locators
    const locContainer = document.getElementById('detail-locators-container');
    locContainer.innerHTML = '';
    
    el.locators.forEach((loc, lIdx) => {
        const locBox = document.createElement('div');
        locBox.className = `locator-item ${loc.preferred ? 'selected-loc' : ''}`;
        
        let matchesIndicator = `<span class="loc-matches-tag" style="color: var(--mismatch-color)">0 matches</span>`;
        if (loc.matched_count > 0) {
            const visibleCount = loc.visible_count !== undefined ? loc.visible_count : 0;
            if (visibleCount === 0) {
                matchesIndicator = `<span class="loc-matches-tag" style="color: var(--comment-color)">${loc.matched_count} match(es) (Hidden)</span>`;
            } else if (visibleCount < loc.matched_count) {
                matchesIndicator = `<span class="loc-matches-tag" style="color: #60a5fa">${loc.matched_count} match(es) (${visibleCount} visible)</span>`;
            } else {
                const clr = loc.matched_count === 1 ? 'var(--match-color)' : '#93c5fd';
                matchesIndicator = `<span class="loc-matches-tag" style="color: ${clr}">${loc.matched_count} match(es) (Visible)</span>`;
            }
        }
        
        locBox.innerHTML = `
            <div class="loc-header">
                <span class="loc-type">${loc.locator_type}</span>
                ${loc.preferred ? '<span class="badge-preferred">★ Preferred</span>' : ''}
            </div>
            <div class="loc-value-box">
                <span style="font-size: 0.75rem;">${escapeHtml(loc.value)}</span>
                <button class="copy-btn" onclick="copyToClipboard('${escapeJs(loc.value)}')" title="Copy Selector">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586A1 1 0 0117 3.414l4 4A1 1 0 0121.586 8V19a2 2 0 01-2 2H10a2 2 0 01-2-2v-2"/></svg>
                </button>
            </div>
            <div class="loc-footer">
                <span>Score: ${loc.score} | Strategy: ${loc.strategy || 'default'}</span>
                ${matchesIndicator}
            </div>
        `;
        
        locContainer.appendChild(locBox);
    });
    
    // Show modal if forced or already open
    if (forceOpenModal || state.isModalOpen) {
        window.openDetailsModal();
    }
    
    highlightElementInIframe(el);
    updateFloatNavButtons();
}

export function prevElement() {
    if (state.filteredIndices.length === 0) return;
    const currentFilteredIdx = state.filteredIndices.indexOf(state.currentElementIndex);
    if (currentFilteredIdx > 0) {
        selectElement(state.filteredIndices[currentFilteredIdx - 1]);
    }
}

export function nextElement() {
    if (state.filteredIndices.length === 0) return;
    const currentFilteredIdx = state.filteredIndices.indexOf(state.currentElementIndex);
    if (currentFilteredIdx >= 0 && currentFilteredIdx < state.filteredIndices.length - 1) {
        selectElement(state.filteredIndices[currentFilteredIdx + 1]);
    }
}

export function updateFloatNavButtons() {
    const btnPrev = document.getElementById('float-btn-prev');
    const btnNext = document.getElementById('float-btn-next');
    if (!btnPrev || !btnNext) return;
    
    if (state.filteredIndices.length <= 1 || state.currentElementIndex === -1) {
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }
    
    const currentFilteredIdx = state.filteredIndices.indexOf(state.currentElementIndex);
    btnPrev.disabled = currentFilteredIdx <= 0;
    btnNext.disabled = currentFilteredIdx >= state.filteredIndices.length - 1;
}

// Window exposure for onclick handlers and cross-module calls
window.selectElement = selectElement;
window.deselectElement = deselectElement;
window.prevElement = prevElement;
window.nextElement = nextElement;
window.filterElementsList = filterElementsList;
window.updateStatsPanel = updateStatsPanel;
window.renderElementsList = renderElementsList;
window.renderEmptyListPlaceholder = renderEmptyListPlaceholder;
