// js/elementList.js - List rendering, filtering, stats panel, floating nav

import { state } from './state.js';
import { escapeHtml, escapeJs, scrollIntoViewOnlyContainer } from './utils.js';
import { highlightElementInIframe, clearHighlightsInIframe } from './iframe.js';

export function renderEmptyListPlaceholder() {
    const list = document.getElementById('element-list');
    list.innerHTML = `
        <div class="flex flex-col items-center justify-center gap-4 p-10 text-base-content/50 border-2 border-dashed border-base-300 rounded-lg">
            <div class="text-4xl opacity-35" style="animation: float 3s ease-in-out infinite;">&#x1F4CB;</div>
            <div class="text-sm">Select a test group and step to load elements</div>
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
        const locs = el.locators || [];
        let preferredLoc = locs.find(l => l.preferred);
        if (preferredLoc) {
            isVisible = (preferredLoc.visible_count > 0);
        } else {
            isVisible = locs.some(l => l.visible_count > 0);
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
    
    // Group and structure elements for tree/hierarchical representation
    const roots = [];
    const childrenMap = new Map();
    const elementsWithIndex = elements.map((el, originalIdx) => ({ el, originalIdx }));
    
    elementsWithIndex.forEach(item => {
        const parentUuid = item.el.parent;
        if (!parentUuid) {
            roots.push(item);
        } else {
            const parentExists = elements.some(p => p.uuid === parentUuid);
            if (parentExists) {
                if (!childrenMap.has(parentUuid)) {
                    childrenMap.set(parentUuid, []);
                }
                childrenMap.get(parentUuid).push(item);
            } else {
                roots.push(item);
            }
        }
    });
    
    // Determine which elements match the filters directly
    const matchesFilter = new Set();
    elementsWithIndex.forEach(item => {
        const el = item.el;
        
        if (searchQuery && !el.name.toLowerCase().includes(searchQuery)) {
            return;
        }
        if (filterType && (el.type || el.elementType) !== filterType) {
            return;
        }
        if (filterMode && el.mode !== filterMode) {
            return;
        }
        
        const totalMatches = el.matched_count || 0;
        let isVisible = false;
        if (el.locators && el.locators.length > 0) {
            let preferredLoc = el.locators.find(l => l.preferred);
            if (preferredLoc) {
                isVisible = (preferredLoc.visible_count > 0);
            } else {
                isVisible = el.locators.some(l => l.visible_count > 0);
            }
        }
        let actualStatus = "mismatched";
        if (totalMatches > 0) {
            actualStatus = isVisible ? "matched" : "hidden";
        }
        
        if (filterStatus) {
            if (filterStatus === "matched" && actualStatus !== "matched") return;
            if (filterStatus === "mismatched" && actualStatus !== "mismatched") return;
            if (filterStatus === "unchecked" && actualStatus !== "hidden") return;
        }
        
        matchesFilter.add(item.originalIdx);
    });
    
    // Determine which elements should be visible in the tree (including context parents/children)
    const visibleIndices = new Set();
    
    function hasMatchingDescendant(originalIdx) {
        const el = elements[originalIdx];
        const children = childrenMap.get(el.uuid) || [];
        for (const child of children) {
            if (matchesFilter.has(child.originalIdx) || hasMatchingDescendant(child.originalIdx)) {
                return true;
            }
        }
        return false;
    }
    
    function hasMatchingAncestor(originalIdx) {
        const el = elements[originalIdx];
        if (!el.parent) return false;
        const parentIdx = elements.findIndex(p => p.uuid === el.parent);
        if (parentIdx === -1) return false;
        if (matchesFilter.has(parentIdx) || hasMatchingAncestor(parentIdx)) {
            return true;
        }
        return false;
    }
    
    elementsWithIndex.forEach(item => {
        const idx = item.originalIdx;
        if (matchesFilter.has(idx) || hasMatchingDescendant(idx) || hasMatchingAncestor(idx)) {
            visibleIndices.add(idx);
        }
    });
    
    state.filteredIndices = [];
    
    function renderItem(item, depth, ancestorGuides, isLast) {
        const idx = item.originalIdx;
        const el = item.el;
        const totalMatches = el.matched_count || 0;
        
        let isVisible = false;
        if (el.locators && el.locators.length > 0) {
            let preferredLoc = el.locators.find(l => l.preferred);
            if (preferredLoc) {
                isVisible = (preferredLoc.visible_count > 0);
            } else {
                isVisible = el.locators.some(l => l.visible_count > 0);
            }
        }
        
        let badgeClass = "badge-mismatched";
        let badgeText = "No Match";
        if (totalMatches > 0) {
            badgeClass = isVisible ? "badge-matched" : "badge-commented";
            badgeText = isVisible ? "Visible" : "Hidden";
        }
        
        let totalVisibleMatches = 0;
        if (el.locators && el.locators.length > 0) {
            let preferredLoc = el.locators.find(l => l.preferred);
            if (preferredLoc) {
                totalVisibleMatches = preferredLoc.visible_count || 0;
            } else {
                el.locators.forEach(l => {
                    totalVisibleMatches = Math.max(totalVisibleMatches, l.visible_count || 0);
                });
            }
        }
        
        const bubbleTitle = `Matches on page: ${totalMatches} (${totalVisibleMatches} visible)`;
        const bubbleText = `${totalVisibleMatches}/${totalMatches} visible`;
        
        const divItem = document.createElement('div');
        divItem.className = `element-item ${idx === state.currentElementIndex ? 'active' : ''}`;
        divItem.id = `el-item-${idx}`;
        divItem.onclick = () => selectElement(idx, false, true);

        // Build tree guide columns so nested children (including grandchildren) are
        // always visually indented under their parent, independent of JSON schema version.
        let guidesHtml = '';
        if (depth > 0) {
            divItem.classList.add('element-item-child');
            for (let g = 0; g < depth - 1; g++) {
                guidesHtml += `<span class="tree-guide ${ancestorGuides[g] ? 'has-line' : ''}"></span>`;
            }
            guidesHtml += `<span class="tree-guide tree-elbow ${isLast ? 'is-last' : ''}"></span>`;
        }

        // Mute item style if context-only (the item itself does not match filter directly)
        const directlyMatches = matchesFilter.has(idx);
        if (!directlyMatches) {
            divItem.style.opacity = '0.55';
            divItem.style.filter = 'grayscale(30%)';
        }
        
        const isSelected = state.selectedElements.has(idx);
        divItem.innerHTML = `
            ${guidesHtml}
            <div class="el-select" onclick="event.stopPropagation();">
                <input type="checkbox" class="el-checkbox" ${isSelected ? 'checked' : ''} onchange="toggleElementSelection(${idx}, this.checked)">
            </div>
            <div class="el-info">
                <span class="el-name" title="${escapeHtml(el.name)}">${idx + 1}. ${escapeHtml(el.name)}</span>
                <span class="el-type">${escapeHtml(el.type || el.elementType || 'element')} <span class="status-badge ${badgeClass}">${badgeText}</span></span>
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
        list.appendChild(divItem);
    }
    
    function traverse(items, depth, ancestorGuides) {
        const visibleItems = items.filter(item => visibleIndices.has(item.originalIdx));
        visibleItems.forEach((item, i) => {
            const isLast = i === visibleItems.length - 1;
            state.filteredIndices.push(item.originalIdx);
            renderItem(item, depth, ancestorGuides, isLast);

            const children = childrenMap.get(item.el.uuid) || [];
            traverse(children, depth + 1, [...ancestorGuides, !isLast]);
        });
    }

    traverse(roots, 0, []);
    
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
            <div class="flex flex-col items-center justify-center gap-4 p-10 text-base-content/50 border-2 border-dashed border-base-300 rounded-lg">
                <div class="text-4xl opacity-35">&#x1F50D;</div>
                <div class="text-sm">No elements match your filters</div>
            </div>
        `;
        clearHighlightsInIframe();
        state.currentElementIndex = -1;
        updateFloatNavButtons();
        window.updateRemoveButtonState();
        return;
    }
    
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
    const detailElInteraction = document.getElementById('detail-el-interaction');
    if (detailElInteraction) detailElInteraction.textContent = "-";
    const detailElUuid = document.getElementById('detail-el-uuid');
    if (detailElUuid) detailElUuid.textContent = "-";
    
    const propSection = document.getElementById('detail-properties-section');
    if (propSection) propSection.style.display = 'none';
    const ddSection = document.getElementById('detail-dropdown-section');
    if (ddSection) ddSection.style.display = 'none';
    
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
    document.getElementById('detail-el-type').textContent = el.type || el.elementType || 'N/A';
    document.getElementById('detail-el-mode').textContent = el.mode || 'N/A';
    document.getElementById('detail-el-event').textContent = el.event || 'N/A';
    
    const detailElInteraction = document.getElementById('detail-el-interaction');
    if (detailElInteraction) {
        detailElInteraction.textContent = (el.interaction && el.interaction.length > 0) ? el.interaction.join(', ') : 'N/A';
    }
    const detailElUuid = document.getElementById('detail-el-uuid');
    if (detailElUuid) {
        detailElUuid.textContent = el.uuid || 'N/A';
    }
    
    const parentRow = document.getElementById('detail-el-parent-row');
    const parentVal = document.getElementById('detail-el-parent');
    if (parentRow && parentVal) {
        if (el.parent) {
            const parentEl = elements.find(p => p.uuid === el.parent);
            parentVal.textContent = parentEl ? parentEl.name : el.parent;
            parentVal.title = `UUID: ${el.parent}`;
            parentRow.style.display = 'flex';
        } else {
            parentRow.style.display = 'none';
        }
    }
    
    // Build locators
    const locContainer = document.getElementById('detail-locators-container');
    locContainer.innerHTML = '';
    
    el.locators.forEach((loc, lIdx) => {
        const locBox = document.createElement('div');
        locBox.className = `locator-item ${loc.preferred ? 'selected-loc' : ''}`;
        
        let matchesIndicator = `<span class="loc-matches-tag text-error">0 matches</span>`;
        if (loc.matched_count > 0) {
            const visibleCount = loc.visible_count !== undefined ? loc.visible_count : 0;
            if (visibleCount === 0) {
                matchesIndicator = `<span class="loc-matches-tag text-warning">${loc.matched_count} match(es) (Hidden)</span>`;
            } else if (visibleCount < loc.matched_count) {
                matchesIndicator = `<span class="loc-matches-tag text-info">${loc.matched_count} match(es) (${visibleCount} visible)</span>`;
            } else {
                const clr = loc.matched_count === 1 ? 'text-success' : 'text-info';
                matchesIndicator = `<span class="loc-matches-tag ${clr}">${loc.matched_count} match(es) (Visible)</span>`;
            }
        }
        
        locBox.innerHTML = `
            <div class="loc-header">
                <span class="loc-type">${escapeHtml(loc.locator_type)}</span>
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
        
        // Add click interaction to highlight specific locator in iframe
        locBox.onclick = (e) => {
            if (e.target.closest('.copy-btn') || e.target.closest('button')) return;
            
            // Highlight active locator item card in UI details panel
            document.querySelectorAll('.locator-item').forEach(li => li.classList.remove('active-locator-card'));
            locBox.classList.add('active-locator-card');
            
            if (typeof window.highlightSpecificLocatorInIframe === 'function') {
                window.highlightSpecificLocatorInIframe(loc.locator_type, loc.value);
            }
        };
        
        locContainer.appendChild(locBox);
    });
    
    // Build properties section if properties exist
    const propSection = document.getElementById('detail-properties-section');
    const propContainer = document.getElementById('detail-properties-container');
    if (propSection && propContainer) {
        propContainer.innerHTML = '';
        const props = el.properties || {};
        const entries = Object.entries(props);
        if (entries.length > 0) {
            entries.forEach(([key, val]) => {
                const row = document.createElement('div');
                row.className = 'flex flex-col gap-1 bg-base-200 p-2.5 rounded border border-base-300';
                row.innerHTML = `
                    <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/50">${escapeHtml(key)}</span>
                    <div class="flex justify-between items-center gap-2">
                        <code class="text-xs text-secondary font-mono">${escapeHtml(String(val))}</code>
                        <button class="copy-btn btn btn-xs btn-ghost p-1" onclick="copyToClipboard('${escapeJs(String(val))}')" title="Copy Property">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586A1 1 0 0117 3.414l4 4A1 1 0 0121.586 8V19a2 2 0 01-2 2H10a2 2 0 01-2-2v-2"/></svg>
                        </button>
                    </div>
                `;
                propContainer.appendChild(row);
            });
            propSection.style.display = 'block';
        } else {
            propSection.style.display = 'none';
        }
    }

    // Build dropdown locators if they exist
    const ddSection = document.getElementById('detail-dropdown-section');
    const ddContainer = document.getElementById('detail-dropdown-container');
    if (ddSection && ddContainer) {
        ddContainer.innerHTML = '';
        const ddl = el.dropdown_locators;
        if (ddl) {
            // Flavour
            const flavourRow = document.createElement('div');
            flavourRow.className = 'flex justify-between items-center gap-2 bg-base-200/50 px-2 py-1 rounded border border-base-300/40';
            flavourRow.innerHTML = `
                <span class="text-[10px] font-bold uppercase text-base-content/50">Flavour</span>
                <span class="text-xs font-semibold badge badge-sm badge-outline">${escapeHtml(ddl.flavour || 'N/A')}</span>
            `;
            ddContainer.appendChild(flavourRow);

            // Native Select / Options Panel sub-selectors
            const subSelectors = [
                { key: 'Native Select', data: ddl.native_select },
                { key: 'Options Panel', data: ddl.options_panel }
            ];

            subSelectors.forEach(({ key, data }) => {
                if (data && data.value) {
                    const row = document.createElement('div');
                    row.className = 'flex flex-col gap-1.5 bg-base-200 p-2.5 rounded border border-base-300';
                    row.innerHTML = `
                        <div class="flex justify-between items-center">
                            <span class="text-[10px] font-bold uppercase tracking-wider text-base-content/50">${escapeHtml(key)} (${escapeHtml(data.locator_type)})</span>
                            ${data.note ? `<span class="text-[9px] text-base-content/40 font-medium" title="${escapeHtml(data.note)}">ℹ️ Note</span>` : ''}
                        </div>
                        <div class="flex justify-between items-center gap-2">
                            <code class="text-xs text-secondary font-mono break-all" style="word-break: break-all;">${escapeHtml(data.value)}</code>
                            <button class="copy-btn btn btn-xs btn-ghost p-1" onclick="copyToClipboard('${escapeJs(data.value)}')" title="Copy Selector">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586A1 1 0 0117 3.414l4 4A1 1 0 0121.586 8V19a2 2 0 01-2 2H10a2 2 0 01-2-2v-2"/></svg>
                            </button>
                        </div>
                    `;
                    ddContainer.appendChild(row);
                }
            });
            ddSection.style.display = 'block';
        } else {
            ddSection.style.display = 'none';
        }
    }
    
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
