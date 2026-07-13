// js/state.js - All global variables and initialization

export const state = {
    mapperConfig: { test_groups: [] },
    locatorsConfig: { pages: [] },
    mappingState: null,
    currentPageIndex: -1,
    currentElementIndex: -1,
    isModalOpen: false,
    isInspectMode: false,
    currentHoveredElement: null,
    matchedDomElementsSet: new Set(),
    domToElementMap: new Map(),
    filteredIndices: [],
    selectedElements: new Set(),
    isAutoFit: true,
    manualZoom: 1.0,
    logicalWidth: 1440,
    isV2: false,
    jsonEditorState: {
        originalJson: null,
        currentJson: null,
        isModified: false,
        activeView: 'raw',
        fullConfig: null,
        folder: ''
    }
};

window.initApp = initApp;

export async function initApp() {
    await loadMapperConfig();
    if (window.populateGroupsDropdown) {
        window.populateGroupsDropdown();
    }
}

export async function loadMapperConfig() {
    try {
        const config = await dbHelper.getConfig('mapper');
        if (config) {
            state.mapperConfig = config;
        } else {
            try {
                const res = await fetch('/api/mapper');
                if (res.ok) {
                    state.mapperConfig = await res.json();
                } else {
                    state.mapperConfig = { test_groups: [] };
                }
            } catch (err) {
                state.mapperConfig = { test_groups: [] };
            }
        }
    } catch(e) {
        console.error("Error loading mapper config from IndexedDB:", e);
        state.mapperConfig = { test_groups: [] };
    }
}