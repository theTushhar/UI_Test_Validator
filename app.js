let mapperConfig = { test_groups: [] };
let locatorsConfig = { pages: [] };
let mappingState = null;

let currentPageIndex = -1;
let currentElementIndex = -1;
let isModalOpen = false;
let isInspectMode = false;
let currentHoveredElement = null;
let matchedDomElementsSet = new Set();
let filteredIndices = [];

// Zoom State
let isAutoFit = true;
let manualZoom = 1.0;
const logicalWidth = 1440; // Logical Desktop Width

// Register Service Worker for client-side offline MHTML routing
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[Service Worker] Registered successfully with scope:', reg.scope))
            .catch(err => console.error('[Service Worker] Registration failed:', err));
    });
}

window.addEventListener('load', async () => {
    await initApp();
    setupIframeMessagePassing();
    setupKeyboardShortcuts();
    setupDragAndDrop();
    
    // Set up window resize handler for Auto Fit
    window.addEventListener('resize', () => {
        if (isAutoFit) {
            updateIframeZoom();
        }
    });
    
    // Close modal on click outside content
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('details-modal');
        if (e.target === modal) {
            closeDetailsModal();
        }
        
        const uploadModal = document.getElementById('upload-modal');
        if (e.target === uploadModal) {
            closeUploadModal();
        }
    });
});

function openDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'flex';
    isModalOpen = true;
}

function closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'none';
    isModalOpen = false;
}

function toggleWelcomeDashboard(show) {
    const welcome = document.getElementById('welcome-dashboard');
    const scalerWrapper = document.getElementById('iframe-scaler-wrapper');
    const fileIndicator = document.getElementById('loaded-file-indicator');
    
    if (show) {
        if (welcome) welcome.style.display = 'flex';
        if (scalerWrapper) scalerWrapper.style.display = 'none';
        if (fileIndicator) {
            fileIndicator.textContent = 'No MHTML File Active';
            fileIndicator.title = 'No MHTML File Active';
        }
        updateWelcomeDashboardStats();
    } else {
        if (welcome) welcome.style.display = 'none';
        if (scalerWrapper) scalerWrapper.style.display = 'flex';
    }
}

async function updateWelcomeDashboardStats() {
    const welcome = document.getElementById('welcome-dashboard');
    if (!welcome || welcome.style.display === 'none') return;
    
    try {
        const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
        const groupsNum = document.getElementById('db-stat-groups');
        if (groupsNum) groupsNum.textContent = activeGroups.length;
        
        const mhtmlFiles = await dbHelper.getAllMhtmlFiles();
        const screensNum = document.getElementById('db-stat-screens');
        if (screensNum) screensNum.textContent = mhtmlFiles.length;
        
        // Count locator configs in DB config store
        const db = await dbHelper.init();
        const keys = await new Promise((resolve, reject) => {
            const tx = db.transaction('config', 'readonly');
            const store = tx.objectStore('config');
            const req = store.getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        const locatorKeys = keys.filter(k => k.startsWith('locators||'));
        const locatorsNum = document.getElementById('db-stat-locators');
        if (locatorsNum) locatorsNum.textContent = locatorKeys.length;
    } catch (e) {
        console.error("Error updating welcome dashboard stats:", e);
    }
}

async function initApp() {
    await loadMapperConfig();
    populateGroupsDropdown();
    
    // If no mapper config is present, prompt user to upload workspace data
    if (!mapperConfig.test_groups || mapperConfig.test_groups.length === 0) {
        setTimeout(() => {
            openUploadModal();
        }, 600);
    }
}

async function loadMapperConfig() {
    try {
        const config = await dbHelper.getConfig('mapper');
        if (config) {
            mapperConfig = config;
        } else {
            // Fallback: try to fetch from local server endpoint if running
            try {
                const res = await fetch('/api/mapper');
                if (res.ok) {
                    mapperConfig = await res.json();
                } else {
                    mapperConfig = { test_groups: [] };
                }
            } catch (err) {
                mapperConfig = { test_groups: [] };
            }
        }
    } catch(e) {
        console.error("Error loading mapper config from IndexedDB:", e);
        mapperConfig = { test_groups: [] };
    }
}

function populateGroupsDropdown() {
    const select = document.getElementById('group-select');
    select.innerHTML = '<option value="">-- Load a test group --</option>';
    
    const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
    
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
        toggleWelcomeDashboard(true);
    }
}

function onGroupChanged() {
    resetInspectMode();
    const groupSelect = document.getElementById('group-select');
    const stepSelect = document.getElementById('step-select');
    
    const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);
    
    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= activeGroups.length) {
        document.getElementById('btn-delete-group').style.display = 'none';
        stepSelect.innerHTML = '<option value="">-- Select a step --</option>';
        stepSelect.disabled = true;
        locatorsConfig = { pages: [] };
        currentPageIndex = -1;
        currentElementIndex = -1;
        closeDetailsModal();
        renderEmptyListPlaceholder();
        updateStatsPanel();
        
        const summary = document.getElementById('filter-results-summary');
        if (summary) summary.style.display = 'none';
        
        toggleWelcomeDashboard(true);
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

async function deleteSelectedGroup() {
    const groupSelect = document.getElementById('group-select');
    const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);
    
    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= activeGroups.length) return;
    
    const group = activeGroups[groupIdx];
    if (!confirm(`Delete group "${group.name}"?\n\nThis will remove the group mapping, locator config, and batch associations. MHTML archive files will NOT be deleted.`)) return;
    
    // Remove the group from test_groups (find in full array, not filtered)
    const fullIdx = mapperConfig.test_groups.findIndex(g => g.folder === group.folder);
    if (fullIdx !== -1) {
        mapperConfig.test_groups.splice(fullIdx, 1);
    }
    
    // Save updated mapper config
    await dbHelper.setConfig('mapper', mapperConfig);
    
    // Clean up locator config and batch associations for this folder
    if (group.folder) {
        await dbHelper.deleteConfig(`locators||${group.folder}`);
        await dbHelper.deleteConfig(`mhtml_batch||${group.folder}`);
    } else {
        await dbHelper.deleteConfig('locators||');
        await dbHelper.deleteConfig('mhtml_batch');
    }
    
    populateGroupsDropdown();
    await initApp();
}

function populateFiltersDropdowns() {
    const typeSelect = document.getElementById('filter-type');
    const modeSelect = document.getElementById('filter-mode');
    
    typeSelect.innerHTML = '<option value="">All Types</option>';
    modeSelect.innerHTML = '<option value="">All Modes</option>';
    
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) return;
    
    const page = locatorsConfig.pages[currentPageIndex];
    const elements = page.elements || [];
    
    const types = new Set();
    const modes = new Set();
    
    elements.forEach(el => {
        if (el.type) types.add(el.type);
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

async function onStepChanged() {
    resetInspectMode();
    const groupSelect = document.getElementById('group-select');
    const stepSelect = document.getElementById('step-select');
    
    const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
    const groupIdx = parseInt(groupSelect.value);
    const stepIdx = parseInt(stepSelect.value);
    
    if (isNaN(groupIdx) || isNaN(stepIdx)) {
        toggleWelcomeDashboard(true);
        return;
    }
    
    const group = activeGroups[groupIdx];
    const mapping = group ? group.mappings[stepIdx] : null;
    
    if (!mapping || !mapping.mhtml_file) {
        toggleWelcomeDashboard(true);
        return;
    }
    
    toggleWelcomeDashboard(false);
    
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
            locatorsConfig = { pages: filteredPages };
        } else {
            locatorsConfig = { pages: [] };
        }
        
        currentPageIndex = 0; // Filtered pages array only contains this single page
        currentElementIndex = 0;
        
        // Reset filters on step change
        document.getElementById('search-input').value = '';
        document.getElementById('filter-type').value = '';
        document.getElementById('filter-mode').value = '';
        document.getElementById('filter-status').value = '';
        
        populateFiltersDropdowns();
        updateStatsPanel();
        updateNavButtons();
    } catch(e) {
        console.error("Error loading step locators config from IndexedDB:", e);
    }
}

function setupIframeMessagePassing() {
    const iframe = document.getElementById('preview-iframe');
    iframe.onload = () => {
        const indicator = document.getElementById('loaded-file-indicator');
        const groupSelect = document.getElementById('group-select');
        const stepSelect = document.getElementById('step-select');
        
        const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
        const groupIdx = parseInt(groupSelect.value);
        const stepIdx = parseInt(stepSelect.value);
        
        if (!isNaN(groupIdx) && !isNaN(stepIdx)) {
            const group = activeGroups[groupIdx];
            const mapping = group.mappings[stepIdx];
            
            indicator.textContent = mapping.mhtml_file;
            indicator.title = `${group.folder || ''}/${mapping.mhtml_file}`;
            
            injectStyleSheetToIframe();
            
            // Re-bind inspect listeners if inspect mode is active
            if (isInspectMode) {
                enableInspectListeners();
            }
            
            // Apply blocker styles based on checkbox state
            const chk = document.getElementById('hide-blockers-chk');
            applyBlockerStyles(chk.checked);
            
            // Recalculate Zoom
            updateIframeZoom();
            
            // Perform verification matches check
            if (currentPageIndex >= 0 && locatorsConfig.pages && locatorsConfig.pages.length > 0) {
                evaluateAllLocatorsInIframe();
                updateStatsPanel();
                renderElementsList();
                if (currentElementIndex >= 0) {
                    selectElement(currentElementIndex);
                }
            }
        } else {
            indicator.textContent = "No MHTML File Active";
            indicator.title = "No MHTML File Active";
        }
    };
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ignore key events when typing in search input field or inside upload modal logs
        if (document.activeElement === document.getElementById('search-input')) {
            return;
        }
        
        if (e.key === 'ArrowRight') {
            nextElement();
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            prevElement();
            e.preventDefault();
        } else if (e.key === 'Enter') {
            nextElement();
            e.preventDefault();
        } else if (e.key === ']') {
            navigateSteps(1);
            e.preventDefault();
        } else if (e.key === '[') {
            navigateSteps(-1);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            closeDetailsModal();
            closeUploadModal();
            e.preventDefault();
        }
    });
}

function navigateSteps(direction) {
    const stepSelect = document.getElementById('step-select');
    if (stepSelect.disabled) return;
    
    const currentIdx = stepSelect.selectedIndex;
    const newIdx = currentIdx + direction;
    
    if (newIdx < 0 || newIdx >= stepSelect.options.length) return;
    
    stepSelect.selectedIndex = newIdx;
    onStepChanged();
}

function updateNavButtons() {
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
        const activeGroups = (mapperConfig.test_groups || []).filter(g => g.active !== false);
        const group = activeGroups[parseInt(groupSelect.value)];
        label.textContent = `${idx + 1} / ${total} — ${stepSelect.options[idx].textContent}`;
        label.title = `${group.name} workflow step`;
    } else {
        label.textContent = 'No active step';
        label.removeAttribute('title');
    }
}

function renderEmptyListPlaceholder() {
    const list = document.getElementById('element-list');
    list.innerHTML = `
        <div class="placeholder-view">
            <div class="placeholder-icon">📋</div>
            <div>Select a test group and step to load elements</div>
        </div>
    `;
}

function updateStatsPanel() {
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) {
        document.getElementById('stat-total').textContent = "0";
        document.getElementById('stat-matched').textContent = "0";
        document.getElementById('stat-mismatched').textContent = "0";
        return;
    }
    
    const page = locatorsConfig.pages[currentPageIndex];
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

function renderElementsList() {
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) {
        const summary = document.getElementById('filter-results-summary');
        if (summary) summary.style.display = 'none';
        return;
    }
    
    const page = locatorsConfig.pages[currentPageIndex];
    const elements = page.elements;
    const list = document.getElementById('element-list');
    list.innerHTML = '';
    
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    const filterType = document.getElementById('filter-type').value;
    const filterMode = document.getElementById('filter-mode').value;
    const filterStatus = document.getElementById('filter-status').value;
    
    filteredIndices = [];
    
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
        
        filteredIndices.push(idx);
    });
    
    // Update summary banner
    const summary = document.getElementById('filter-results-summary');
    if (summary) {
        summary.style.display = 'block';
        summary.textContent = `Showing ${filteredIndices.length} of ${elements.length} elements`;
    }
    
    if (filteredIndices.length === 0) {
        list.innerHTML = `
            <div class="placeholder-view">
                <div class="placeholder-icon">🔍</div>
                <div>No elements match your filters</div>
            </div>
        `;
        clearHighlightsInIframe();
        currentElementIndex = -1;
        updateFloatNavButtons();
        return;
    }
    
    // Render the filtered elements
    filteredIndices.forEach(idx => {
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
        item.className = `element-item ${idx === currentElementIndex ? 'active' : ''}`;
        item.id = `el-item-${idx}`;
        item.onclick = () => selectElement(idx, false);
        
        item.innerHTML = `
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
    if (filteredIndices.length > 0) {
        const stillVisibleIdx = filteredIndices.indexOf(currentElementIndex);
        if (stillVisibleIdx === -1) {
            selectElement(filteredIndices[0]);
        } else {
            selectElement(currentElementIndex);
        }
    }
}

function filterElementsList() {
    renderElementsList();
}

function selectElement(index, forceOpenModal = false) {
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) return;
    
    const page = locatorsConfig.pages[currentPageIndex];
    const elements = page.elements;
    
    if (index < 0 || index >= elements.length) return;
    
    const items = document.querySelectorAll('.element-item');
    items.forEach(it => it.classList.remove('active'));
    
    currentElementIndex = index;
    const activeItem = document.getElementById(`el-item-${currentElementIndex}`);
    if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    if (forceOpenModal || isModalOpen) {
        openDetailsModal();
    }
    
    highlightElementInIframe(el);
    updateFloatNavButtons();
}

function prevElement() {
    if (filteredIndices.length === 0) return;
    const currentFilteredIdx = filteredIndices.indexOf(currentElementIndex);
    if (currentFilteredIdx > 0) {
        selectElement(filteredIndices[currentFilteredIdx - 1]);
    }
}

function nextElement() {
    if (filteredIndices.length === 0) return;
    const currentFilteredIdx = filteredIndices.indexOf(currentElementIndex);
    if (currentFilteredIdx >= 0 && currentFilteredIdx < filteredIndices.length - 1) {
        selectElement(filteredIndices[currentFilteredIdx + 1]);
    }
}

function updateFloatNavButtons() {
    const btnPrev = document.getElementById('float-btn-prev');
    const btnNext = document.getElementById('float-btn-next');
    if (!btnPrev || !btnNext) return;
    
    if (filteredIndices.length <= 1 || currentElementIndex === -1) {
        btnPrev.disabled = true;
        btnNext.disabled = true;
        return;
    }
    
    const currentFilteredIdx = filteredIndices.indexOf(currentElementIndex);
    btnPrev.disabled = currentFilteredIdx <= 0;
    btnNext.disabled = currentFilteredIdx >= filteredIndices.length - 1;
}

// Iframe helper routines
function getIframeDocument() {
    const iframe = document.getElementById('preview-iframe');
    return iframe.contentDocument || iframe.contentWindow.document;
}

function injectStyleSheetToIframe() {
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
    `;
    doc.head.appendChild(style);
}

function clearHighlightsInIframe() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    const highlighted = doc.querySelectorAll('.locator-highlight');
    highlighted.forEach(el => {
        el.classList.remove('locator-highlight');
    });
}

function isElementVisible(el) {
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

function evaluateAllLocatorsInIframe() {
    matchedDomElementsSet.clear();
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) return;
    const doc = getIframeDocument();
    if (!doc) return;
    
    const page = locatorsConfig.pages[currentPageIndex];
    page.elements.forEach(el => {
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
                    matchedDomElementsSet.add(domEl);
                });
            }
        });
        
        el.matched_count = maxLocMatches;
    });
}

function highlightElementInIframe(element) {
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

function findCSSMatches(css, doc) {
    try {
        return Array.from(doc.querySelectorAll(css));
    } catch(e) {
        return [];
    }
}

function findXPathMatches(xpath, doc) {
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

function onHideBlockersChanged() {
    const chk = document.getElementById('hide-blockers-chk');
    applyBlockerStyles(chk.checked);
}

function applyBlockerStyles(hide) {
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
function updateIframeZoom() {
    const container = document.getElementById('iframe-container-box');
    const scaler = document.getElementById('iframe-scaler');
    
    if (!container || !scaler) return;
    
    const containerWidth = container.clientWidth - 48; // 24px padding on each side
    const containerHeight = container.clientHeight - 48; // 24px padding
    
    let scale = 1.0;
    
    if (isAutoFit) {
        scale = containerWidth / logicalWidth;
        if (scale > 1.0) scale = 1.0;
        manualZoom = scale;
    } else {
        scale = manualZoom;
    }
    
    scaler.style.width = `${logicalWidth}px`;
    scaler.style.height = `${containerHeight / scale}px`;
    scaler.style.transform = `scale(${scale})`;
    scaler.style.transformOrigin = 'top left';
    
    document.getElementById('zoom-percentage').textContent = `${Math.round(scale * 100)}%`;
    
    const autoFitBtn = document.getElementById('btn-autofit');
    if (isAutoFit) {
        autoFitBtn.classList.add('active');
    } else {
        autoFitBtn.classList.remove('active');
    }
}

function toggleAutoFit() {
    isAutoFit = !isAutoFit;
    updateIframeZoom();
}

function adjustManualZoom(delta) {
    isAutoFit = false;
    manualZoom = Math.max(0.1, Math.min(3.0, manualZoom + delta));
    updateIframeZoom();
}

function reloadIframe() {
    const iframe = document.getElementById('preview-iframe');
    iframe.src = iframe.src;
}

// Copy utilities
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Successful copy
    }).catch(err => {
        console.error('Could not copy text: ', err);
    });
}

// String escapers
function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
function escapeJs(unsafe) {
    return unsafe.replace(/'/g, "\\'");
}

// Inspect Element Mode Functions
function toggleInspectMode() {
    isInspectMode = !isInspectMode;
    const btn = document.getElementById('btn-inspect');
    if (!btn) return;
    
    if (isInspectMode) {
        btn.classList.add('active');
        enableInspectListeners();
    } else {
        btn.classList.remove('active');
        disableInspectListeners();
    }
}

function resetInspectMode() {
    isInspectMode = false;
    const btn = document.getElementById('btn-inspect');
    if (btn) btn.classList.remove('active');
    disableInspectListeners();
}

function enableInspectListeners() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    doc.addEventListener('mouseover', handleIframeMouseOver, true);
    doc.addEventListener('mouseout', handleIframeMouseOut, true);
    doc.addEventListener('click', handleIframeClick, true);
}

function disableInspectListeners() {
    const doc = getIframeDocument();
    if (!doc) return;
    
    doc.removeEventListener('mouseover', handleIframeMouseOver, true);
    doc.removeEventListener('mouseout', handleIframeMouseOut, true);
    doc.removeEventListener('click', handleIframeClick, true);
    
    if (currentHoveredElement) {
        try {
            currentHoveredElement.classList.remove('inspect-hover-matched');
            currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
        currentHoveredElement = null;
    }
}

function checkHoverElementMatch(domElement) {
    const doc = getIframeDocument();
    if (!doc) return false;
    
    let current = domElement;
    while (current && current !== doc.body && current !== doc.documentElement) {
        if (matchedDomElementsSet.has(current)) {
            return true;
        }
        current = current.parentElement;
    }
    return false;
}

function handleIframeMouseOver(e) {
    if (!isInspectMode) return;
    e.stopPropagation();
    
    if (currentHoveredElement && currentHoveredElement !== e.target) {
        try {
            currentHoveredElement.classList.remove('inspect-hover-matched');
            currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
    }
    
    currentHoveredElement = e.target;
    if (currentHoveredElement && currentHoveredElement.classList) {
        const isMatched = checkHoverElementMatch(currentHoveredElement);
        if (isMatched) {
            currentHoveredElement.classList.add('inspect-hover-matched');
        } else {
            currentHoveredElement.classList.add('inspect-hover-mismatched');
        }
    }
}

function handleIframeMouseOut(e) {
    if (!isInspectMode) return;
    if (currentHoveredElement) {
        try {
            currentHoveredElement.classList.remove('inspect-hover-matched');
            currentHoveredElement.classList.remove('inspect-hover-mismatched');
        } catch(e) {}
        currentHoveredElement = null;
    }
}

function handleIframeClick(e) {
    if (!isInspectMode) return;
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

function matchElementFromIframe(domElement) {
    if (currentPageIndex < 0 || !locatorsConfig.pages || locatorsConfig.pages.length === 0) return;
    
    const page = locatorsConfig.pages[currentPageIndex];
    const doc = getIframeDocument();
    if (!doc) return;
    
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let idx = 0; idx < page.elements.length; idx++) {
        const el = page.elements[idx];
        
        for (const loc of el.locators) {
            let matchedElements = [];
            const type = (loc.locator_type || '').toLowerCase();
            if (type === 'css') {
                matchedElements = findCSSMatches(loc.value, doc);
            } else if (type === 'xpath') {
                matchedElements = findXPathMatches(loc.value, doc);
            }
            
            if (matchedElements.includes(domElement)) {
                let matchScore = 0;
                if (matchedElements.length === 1) {
                    matchScore += 100;
                }
                if (loc.preferred) {
                    matchScore += 50;
                }
                matchScore += (loc.score || 0);
                
                if (matchScore > bestScore) {
                    bestScore = matchScore;
                    bestIndex = idx;
                }
            }
        }
    }
    
    if (bestIndex !== -1) {
        selectElement(bestIndex, true);
    } else {
        const parent = domElement.parentElement;
        if (parent && parent !== doc.body && parent !== doc.documentElement) {
            matchElementFromIframe(parent);
        } else {
            alert("No matching locator found in the database for the clicked element.");
        }
    }
}

// ============================================================================
// Manage Workspace Data (IndexedDB File Upload & Parsing Routines)
// ============================================================================

function openUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('upload-log-box').style.display = 'none';
    document.getElementById('upload-log-box').textContent = '';
    
    // Clear out files input elements
    document.getElementById('folder-upload-input').value = '';
    document.getElementById('file-upload-input').value = '';
    
    refreshUploadStatusDisplay();
}

function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'none';
}

function triggerFolderInput() {
    document.getElementById('folder-upload-input').click();
}

function triggerFileInput() {
    document.getElementById('file-upload-input').click();
}

/**
 * Updates status indicators in the upload modal from IndexedDB contents.
 */
async function refreshUploadStatusDisplay() {
    // (mapper.json status row removed)
    
    // 2. Check loaded locators configurations
    const locatorsContainer = document.getElementById('status-locators');
    locatorsContainer.innerHTML = '';
    
    // Scan all keys in 'config' store starting with 'locators||'
    const db = await dbHelper.init();
    const activeFolders = [];
    
    const tx = db.transaction('config', 'readonly');
    const store = tx.objectStore('config');
    
    await new Promise((resolve) => {
        store.openKeyCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const key = cursor.key;
                if (key.startsWith('locators||')) {
                    const folder = key.split('||')[1] || 'root';
                    activeFolders.push(folder);
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
    });
    
    if (activeFolders.length > 0) {
        activeFolders.forEach(folder => {
            const chip = document.createElement('span');
            chip.className = 'status-chip loaded';
            chip.style.margin = '2px';
            const label = folder === '' ? 'Default (v1)' : folder.startsWith('_v') ? `Upload ${folder.replace('_v', 'v')}` : folder;
            chip.textContent = label;
            locatorsContainer.appendChild(chip);
        });
    } else {
        locatorsContainer.innerHTML = '<span style="font-size: 0.72rem; color: var(--text-muted);">None loaded</span>';
    }
    
    // 3. Check loaded MHTML archives
    const mhtmlList = document.getElementById('status-mhtml-list');
    mhtmlList.innerHTML = '';
    
    const files = await dbHelper.getAllMhtmlFiles();
    if (files.length > 0) {
        files.forEach(filename => {
            const item = document.createElement('div');
            item.className = 'mhtml-file-item';
            item.innerHTML = `
                <span class="mhtml-file-name" title="${filename}">${filename}</span>
                <button class="mhtml-file-delete" onclick="deleteMhtmlFileRecord('${escapeJs(filename)}')" title="Delete File">&times;</button>
            `;
            mhtmlList.appendChild(item);
        });
    } else {
        mhtmlList.innerHTML = '<div style="font-size: 0.72rem; color: var(--text-muted); text-align: center; padding: 10px 0; width: 100%;">No MHTML files uploaded</div>';
    }

    // Toggle proceed-to-mapping action button visibility
    const proceedBtn = document.getElementById('btn-proceed-mapping');
    const closeBtn = document.getElementById('btn-close-upload');
    if (proceedBtn) {
        if (activeFolders.length > 0 && files.length > 0) {
            proceedBtn.style.display = 'inline-flex';
            if (closeBtn) closeBtn.style.display = 'none';
        } else {
            proceedBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'inline-flex';
        }
    }
}

async function deleteMhtmlFileRecord(filename) {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
        await dbHelper.deleteMhtmlFile(filename);
        refreshUploadStatusDisplay();
        await initApp();
    }
}

async function clearAllWorkspaceData() {
    if (confirm("Are you sure you want to delete all stored workspace data? This will clear all configs and files.")) {
        await dbHelper.clearAllData();
        refreshUploadStatusDisplay();
        await initApp();
    }
}

async function applyAndCloseUploadModal() {
    closeUploadModal();
    // Reload state
    await initApp();
}

function logToModalConsole(msg, type = 'info') {
    const box = document.getElementById('upload-log-box');
    box.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    box.textContent += `[${time}] [${type.toUpperCase()}] ${msg}\n`;
    box.scrollTop = box.scrollHeight;
}

function triggerMhtmlInput() {
    document.getElementById('mhtml-file-input').click();
}

function triggerJsonInput() {
    document.getElementById('json-file-input').click();
}

async function handleMhtmlFilesSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    document.getElementById('upload-log-box').style.display = 'block';
    document.getElementById('upload-log-box').textContent = '';
    
    logToModalConsole(`Reading ${files.length} MHTML files...`, 'info');
    
    // Track filenames uploaded in this batch
    const batchNames = [];
    
    let successCount = 0;
    for (const file of files) {
        try {
            logToModalConsole(`Parsing MHTML file: ${file.name}...`, 'info');
            const arrayBuffer = await readFileAsArrayBuffer(file);
            
            const parser = new MHTMLArchiveBrowser();
            const parsed = await parser.parse(arrayBuffer, file.name);
            
            const uniqueName = await findUniqueFilename(file.name);
            if (uniqueName !== file.name) {
                logToModalConsole(`Duplicate detected: "${file.name}" already exists. Saving as "${uniqueName}".`, 'info');
            }
            
            // Save metadata
            await dbHelper.saveMhtmlMeta({
                filename: uniqueName,
                mainLocation: parsed.mainLocation,
                locationMappings: parsed.locationMappings
            });
            
            // Save resources
            for (const res of parsed.resources) {
                await dbHelper.saveResource({
                    id: `${uniqueName}||${res.path}`,
                    filename: uniqueName,
                    path: res.path,
                    contentType: res.contentType,
                    blob: res.blob
                });
            }
            
            successCount++;
            batchNames.push(uniqueName);
            logToModalConsole(`Success: ${uniqueName} imported.`, 'success');
        } catch (err) {
            logToModalConsole(`Error processing MHTML file ${file.name}: ${err.message}`, 'error');
            console.error(err);
        }
    }
    logToModalConsole(`Finished importing MHTML files: ${successCount} successfully processed.`, 'success');
    
    // Save this batch so mapping mode only shows these files
    if (batchNames.length > 0) {
        const prev = await dbHelper.getConfig('mhtml_batch') || [];
        await dbHelper.setConfig('mhtml_batch', [...prev, ...batchNames]);
    }
    
    refreshUploadStatusDisplay();
}

async function handleJsonFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('upload-log-box').style.display = 'block';
    document.getElementById('upload-log-box').textContent = '';
    
    logToModalConsole(`Reading locator config file: ${file.name}...`, 'info');
    
    try {
        const text = await readFileAsText(file);
        const json = JSON.parse(text);
        
        if (!json.pages) {
            throw new Error("Invalid locator.json: 'pages' key is missing.");
        }
        
        const locatorKey = await findUniqueLocatorKey();
        const folderName = locatorKey.split('||')[1] || 'root';
        if (locatorKey !== 'locators||') {
            logToModalConsole(`Duplicate locator config detected. Saving as folder: "${folderName}".`, 'info');
        }
        
        await dbHelper.setConfig(locatorKey, json);
        
        // Associate current MHTML batch with this locator folder
        const currentBatch = await dbHelper.getConfig('mhtml_batch');
        if (currentBatch && currentBatch.length > 0) {
            await dbHelper.setConfig(`mhtml_batch||${folderName}`, currentBatch);
        }
        
        logToModalConsole(`Success: locator.json configuration imported (folder: ${folderName}).`, 'success');
        refreshUploadStatusDisplay();
    } catch (err) {
        logToModalConsole(`Error processing locator JSON: ${err.message}`, 'error');
        console.error(err);
    }
}

/**
 * Finds a unique filename by appending _v2, _v3, etc. if the original already exists.
 */
async function findUniqueFilename(originalName) {
    const existingMeta = await dbHelper.getMhtmlMeta(originalName);
    if (!existingMeta) return originalName;

    const dotIdx = originalName.lastIndexOf('.');
    const baseName = dotIdx > 0 ? originalName.substring(0, dotIdx) : originalName;
    const ext = dotIdx > 0 ? originalName.substring(dotIdx) : '';

    let version = 2;
    while (true) {
        const candidate = `${baseName}_v${version}${ext}`;
        const meta = await dbHelper.getMhtmlMeta(candidate);
        if (!meta) return candidate;
        version++;
    }
}

/**
 * Finds the next available locator config key with version suffix if needed.
 */
async function findUniqueLocatorKey() {
    const rootKey = 'locators||';
    const existing = await dbHelper.getConfig(rootKey);
    if (!existing) return rootKey;

    let version = 2;
    while (true) {
        const candidate = `locators||_v${version}`;
        const data = await dbHelper.getConfig(candidate);
        if (!data) return candidate;
        version++;
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

function setupDragAndDrop() {
    const colMhtml = document.getElementById('col-mhtml');
    const colJson = document.getElementById('col-json');
    
    if (colMhtml) {
        ['dragenter', 'dragover'].forEach(name => {
            colMhtml.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colMhtml.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            colMhtml.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colMhtml.classList.remove('dragover');
            });
        });
        colMhtml.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            handleMhtmlFilesSelected({ target: { files } });
        });
    }
    
    if (colJson) {
        ['dragenter', 'dragover'].forEach(name => {
            colJson.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colJson.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            colJson.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colJson.classList.remove('dragover');
            });
        });
        colJson.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            handleJsonFileSelected({ target: { files } });
        });
    }
}

// ============================================================================
// Interactive Page Mapping Tool Logic
// ============================================================================

async function enterMappingMode() {
    document.getElementById('upload-mode-view').style.display = 'none';
    document.getElementById('mapping-mode-view').style.display = 'block';
    
    const modalBox = document.getElementById('upload-modal-box');
    modalBox.classList.add('wide-modal');
    
    // Scan IndexedDB for locator config keys and pick the latest version
    const db = await dbHelper.init();
    const tx = db.transaction('config', 'readonly');
    const store = tx.objectStore('config');
    
    let locatorKeys = [];
    
    await new Promise((resolve) => {
        store.openKeyCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const key = cursor.key;
                if (key.startsWith('locators||')) {
                    locatorKeys.push(key);
                }
                cursor.continue();
            } else {
                resolve();
            }
        };
    });
    
    if (locatorKeys.length === 0) {
        alert("No locator.json config found. Please upload test files first.");
        exitMappingMode();
        return;
    }
    
    // Pick the latest key (highest version number)
    const latestKey = locatorKeys.sort((a, b) => {
        const vA = a.split('_v')[1] || '0';
        const vB = b.split('_v')[1] || '0';
        return parseInt(vB) - parseInt(vA);
    })[0];
    
    const activeFolder = latestKey.split('||')[1] || 'root';
    const locatorsData = await dbHelper.getConfig(latestKey);
    
    if (!locatorsData) {
        alert("No locator.json config found. Please upload test files first.");
        exitMappingMode();
        return;
    }
    
    const mhtmlList = (await dbHelper.getConfig(`mhtml_batch||${activeFolder}`))
        || (await dbHelper.getConfig('mhtml_batch'))
        || await dbHelper.getAllMhtmlFiles();
    
    // Map existing paired steps if mapper configuration exists
    mappingState = {
        folder: activeFolder,
        originalLocatorsData: locatorsData,
        pages: (locatorsData.pages || []).map(p => {
            let mappedMhtml = '';
            const existingGroup = (mapperConfig.test_groups || []).find(g => g.folder === activeFolder);
            if (existingGroup) {
                const mapping = (existingGroup.mappings || []).find(m => m.page_name === p.name);
                if (mapping) {
                    mappedMhtml = mapping.mhtml_file;
                }
            }
            return {
                originalName: p.name,
                name: p.name,
                mappedMhtml: mappedMhtml
            };
        }),
        mhtmlFiles: mhtmlList,
        renames: {},
        pageRenames: {}
    };
    
    renderMappingInterface();
}

function exitMappingMode() {
    document.getElementById('upload-mode-view').style.display = 'block';
    document.getElementById('mapping-mode-view').style.display = 'none';
    
    const modalBox = document.getElementById('upload-modal-box');
    modalBox.classList.remove('wide-modal');
    
    refreshUploadStatusDisplay();
}

function renderMappingInterface() {
    const pagesList = document.getElementById('mapping-pages-list');
    const mhtmlList = document.getElementById('mapping-mhtml-list');
    
    pagesList.innerHTML = '';
    mhtmlList.innerHTML = '';
    
    // Render Pages Targets (Left Side)
    mappingState.pages.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'mapping-page-card';
        card.setAttribute('data-page-idx', idx);
        
        card.addEventListener('dragover', allowDrop);
        card.addEventListener('dragleave', handleMhtmlDragLeave);
        card.addEventListener('drop', (e) => handleMhtmlDrop(e, idx));
        
        let slotContent = '';
        if (p.mappedMhtml) {
            slotContent = `
                <div class="mapped-mhtml-badge">
                    <span class="mapped-mhtml-name" title="${p.mappedMhtml}">${p.mappedMhtml}</span>
                    <button class="mapping-unlink-btn" onclick="unlinkMhtml(${idx})" title="Unlink File">&times;</button>
                </div>
            `;
        } else {
            slotContent = `<div class="mapping-slot-placeholder">Drop MHTML file here to map</div>`;
        }
        
        card.innerHTML = `
            <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 8px;">
                <input type="text" class="mapping-page-input" value="${escapeHtml(p.name)}" 
                    onchange="renamePage(${idx}, this.value)" 
                    style="flex: 1; padding: 6px 10px; font-size: 0.8rem; font-weight: 600; border-radius: 4px; border: 1px solid var(--border-glass);"
                    title="Rename page title">
            </div>
            <div class="mapping-drop-slot" id="page-slot-${idx}">
                ${slotContent}
            </div>
        `;
        pagesList.appendChild(card);
    });
    
    // Filter out unmapped files (Right Side)
    const mappedFiles = new Set(mappingState.pages.map(p => p.mappedMhtml).filter(Boolean));
    const unmappedMhtml = mappingState.mhtmlFiles.filter(f => !mappedFiles.has(f));
    
    if (unmappedMhtml.length > 0) {
        unmappedMhtml.forEach(filename => {
            const badge = document.createElement('div');
            badge.className = 'draggable-mhtml-badge';
            badge.setAttribute('draggable', 'true');
            badge.id = `mhtml-badge-${filename}`;
            
            badge.addEventListener('dragstart', (e) => handleMhtmlDragStart(e, filename));
            
            badge.innerHTML = `
                <span class="drag-handle">☰</span>
                <input type="text" class="mhtml-rename-input" value="${escapeHtml(filename)}" 
                    onchange="renameMhtmlFile('${escapeJs(filename)}', this.value)" 
                    style="flex: 1; padding: 4px 8px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--border-glass); background: transparent;"
                    title="Rename MHTML file">
            `;
            mhtmlList.appendChild(badge);
        });
    } else {
        mhtmlList.innerHTML = '<div style="font-size: 0.72rem; color: var(--text-muted); text-align: center; padding: 20px 0;">All MHTML files mapped</div>';
    }
}

function handleMhtmlDragStart(e, filename) {
    e.dataTransfer.setData("text/plain", filename);
}

function allowDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

function handleMhtmlDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

function handleMhtmlDrop(e, pageIdx) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const filename = e.dataTransfer.getData("text/plain");
    if (!filename) return;
    
    mappingState.pages[pageIdx].mappedMhtml = filename;
    renderMappingInterface();
}

function unlinkMhtml(pageIdx) {
    mappingState.pages[pageIdx].mappedMhtml = '';
    renderMappingInterface();
}

function renamePage(pageIdx, newName) {
    if (!newName.trim()) return;
    const cleanNewName = newName.trim();
    mappingState.pages[pageIdx].name = cleanNewName;
    
    if (mappingState.pages[pageIdx].originalName !== cleanNewName) {
        mappingState.pageRenames[mappingState.pages[pageIdx].originalName] = cleanNewName;
    }
}

function renameMhtmlFile(oldName, newName) {
    if (!newName.trim() || oldName === newName.trim()) return;
    
    const cleanNewName = newName.trim();
    const finalNewName = cleanNewName.toLowerCase().endsWith('.mhtml') ? cleanNewName : cleanNewName + '.mhtml';
    
    // Update files lists
    const idx = mappingState.mhtmlFiles.indexOf(oldName);
    if (idx !== -1) {
        mappingState.mhtmlFiles[idx] = finalNewName;
    }
    
    // Update any active links
    mappingState.pages.forEach(p => {
        if (p.mappedMhtml === oldName) {
            p.mappedMhtml = finalNewName;
        }
    });
    
    // Cascade renames chain
    let originalName = oldName;
    for (const orig in mappingState.renames) {
        if (mappingState.renames[orig] === oldName) {
            originalName = orig;
            break;
        }
    }
    mappingState.renames[originalName] = finalNewName;
    
    renderMappingInterface();
}

function autoMapBySuffix() {
    let matchCount = 0;
    mappingState.pages.forEach(p => {
        if (!p.mappedMhtml) {
            const pageClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const match = mappingState.mhtmlFiles.find(f => {
                const fileClean = f.toLowerCase().replace(/[^a-z0-9]/g, '');
                return fileClean.includes(pageClean) || pageClean.includes(fileClean.replace('mhtml', ''));
            });
            if (match) {
                p.mappedMhtml = match;
                matchCount++;
            }
        }
    });
    
    if (matchCount > 0) {
        renderMappingInterface();
    } else {
        alert("No additional matches were found automatically.");
    }
}

async function saveMappingConfig() {
    // 1. Rename files in IndexedDB
    for (const [oldName, newName] of Object.entries(mappingState.renames)) {
        await dbRenameMhtmlFile(oldName, newName);
    }
    
    // 2. Rename pages in locator configurations inside IndexedDB
    const locators = mappingState.originalLocatorsData;
    let locatorsChanged = false;
    
    (locators.pages || []).forEach(p => {
        if (mappingState.pageRenames[p.name]) {
            p.name = mappingState.pageRenames[p.name];
            locatorsChanged = true;
        }
    });
    
    if (locatorsChanged) {
        await dbHelper.setConfig(`locators||${mappingState.folder}`, locators);
    }
    
    // 3. Construct and write new mapper.json
    const mappings = [];
    mappingState.pages.forEach(p => {
        if (p.mappedMhtml) {
            mappings.push({
                page_name: p.name,
                mhtml_file: p.mappedMhtml
            });
        }
    });
    
    const folderLabel = mappingState.folder === '' ? 'Default Test Group' :
        mappingState.folder.startsWith('_v') ? `Test Group ${mappingState.folder.replace('_v', 'v')}` :
        mappingState.folder;
    
    const newGroup = {
        name: folderLabel,
        folder: mappingState.folder,
        active: true,
        mappings: mappings
    };
    
    let testGroups = mapperConfig.test_groups || [];
    testGroups.push(newGroup);
    
    const newMapperConfig = {
        test_groups: testGroups
    };
    
    await dbHelper.setConfig('mapper', newMapperConfig);
    mapperConfig = newMapperConfig;
    
    alert("Mapping saved! mapper.json has been created and verified.");
    closeUploadModal();
    await initApp();
}

async function dbRenameMhtmlFile(oldName, newName) {
    const db = await dbHelper.init();
    
    const meta = await dbHelper.getMhtmlMeta(oldName);
    if (!meta) return;
    
    meta.filename = newName;
    await dbHelper.saveMhtmlMeta(meta);
    
    const tx = db.transaction('mhtml_resources', 'readwrite');
    const store = tx.objectStore('mhtml_resources');
    const index = store.index('filename');
    const request = index.openCursor(IDBKeyRange.only(oldName));
    
    const copyPromises = [];
    await new Promise((resolve) => {
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const resource = cursor.value;
                const resPath = resource.path;
                
                const newResource = {
                    id: `${newName}||${resPath}`,
                    filename: newName,
                    path: resPath,
                    contentType: resource.contentType,
                    blob: resource.blob
                };
                
                copyPromises.push(dbHelper.saveResource(newResource));
                cursor.continue();
            } else {
                resolve();
            }
        };
    });
    
    await Promise.all(copyPromises);
    await dbHelper.deleteMhtmlFile(oldName);
}
