// js/mappingTool.js - Mapping UI, drag-drop, rename, auto-map, save

import { state, initApp } from './state.js';
import { escapeHtml, escapeJs } from './utils.js';
import { refreshUploadStatusDisplay } from './workspaceUpload.js';

// ============================================================================
// Interactive Page Mapping Tool Logic
// ============================================================================

export async function enterMappingMode() {
    document.getElementById('upload-mode-view').style.display = 'none';
    document.getElementById('mapping-mode-view').style.display = 'block';
    
    const modalBox = document.getElementById('upload-modal-box');
    modalBox.classList.add('wide-modal');
    
    const activeFolder = 'active';
    const locatorsData = await dbHelper.getConfig(`locators||${activeFolder}`);
    
    if (!locatorsData) {
        alert("No JSON config found. Please upload a JSON config file first.");
        exitMappingMode();
        return;
    }
    
    let mhtmlList = await dbHelper.getConfig(`mhtml_batch||${activeFolder}`);
    const currentBatch = await dbHelper.getConfig('mhtml_batch') || [];
    
    if (mhtmlList) {
        // Add any genuinely new files not in the list
        const finalSet = new Set(mhtmlList);
        for (const f of currentBatch) {
            if (!finalSet.has(f)) {
                mhtmlList.push(f);
            }
        }
        await dbHelper.setConfig(`mhtml_batch||${activeFolder}`, mhtmlList);
    } else {
        // No association yet — use current batch and create the association.
        mhtmlList = currentBatch;
        if (mhtmlList.length > 0) {
            await dbHelper.setConfig(`mhtml_batch||${activeFolder}`, mhtmlList);
        }
    }
    
    // Map existing paired steps if mapper configuration exists
    state.mappingState = {
        folder: activeFolder,
        originalLocatorsData: locatorsData,
        pages: (locatorsData.pages || []).map(p => {
            let mappedMhtml = '';
            const existingGroup = (state.mapperConfig.test_groups || []).find(g => g.folder === activeFolder);
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

export function exitMappingMode() {
    document.getElementById('upload-mode-view').style.display = 'block';
    document.getElementById('mapping-mode-view').style.display = 'none';
    
    const modalBox = document.getElementById('upload-modal-box');
    modalBox.classList.remove('wide-modal');
    
    refreshUploadStatusDisplay();
}

export function renderMappingInterface() {
    const pagesList = document.getElementById('mapping-pages-list');
    const mhtmlList = document.getElementById('mapping-mhtml-list');
    
    pagesList.innerHTML = '';
    mhtmlList.innerHTML = '';
    
    // Render MHTML Files (Left Side - Draggables)
    const mappedFiles = new Set(state.mappingState.pages.map(p => p.mappedMhtml).filter(Boolean));
    const unmappedMhtml = state.mappingState.mhtmlFiles.filter(f => !mappedFiles.has(f));
    
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
                    class="flex-1 px-1.5 py-0.5 text-xs rounded border border-base-300 bg-transparent"
                    title="Rename MHTML file">
            `;
            mhtmlList.appendChild(badge);
        });
    } else {
        mhtmlList.innerHTML = '<div class="text-xs text-base-content/40 text-center py-4">All MHTML files mapped</div>';
    }

    // Render Pages Targets (Right Side - Drop Targets)
    state.mappingState.pages.forEach((p, idx) => {
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
            slotContent = `<div class="mapping-slot-placeholder">Drop MHTML here</div>`;
        }
        
        card.innerHTML = `
            <input type="text" class="mapping-page-input" value="${escapeHtml(p.name)}" 
                onchange="renamePage(${idx}, this.value)" 
                class="w-full px-2 py-1 text-xs font-semibold rounded border border-base-300 mb-1"
                title="Rename page title">
            <div class="mapping-drop-slot" id="page-slot-${idx}">
                ${slotContent}
            </div>
        `;
        pagesList.appendChild(card);
    });
}

export function handleMhtmlDragStart(e, filename) {
    e.dataTransfer.setData("text/plain", filename);
}

export function allowDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

export function handleMhtmlDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
}

export function handleMhtmlDrop(e, pageIdx) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const filename = e.dataTransfer.getData("text/plain");
    if (!filename) return;
    
    state.mappingState.pages[pageIdx].mappedMhtml = filename;
    renderMappingInterface();
}

export function unlinkMhtml(pageIdx) {
    state.mappingState.pages[pageIdx].mappedMhtml = '';
    renderMappingInterface();
}

export function renamePage(pageIdx, newName) {
    if (!newName.trim()) return;
    const cleanNewName = newName.trim();
    state.mappingState.pages[pageIdx].name = cleanNewName;
    
    if (state.mappingState.pages[pageIdx].originalName !== cleanNewName) {
        state.mappingState.pageRenames[state.mappingState.pages[pageIdx].originalName] = cleanNewName;
    }
}

export function renameMhtmlFile(oldName, newName) {
    if (!newName.trim() || oldName === newName.trim()) return;
    
    const cleanNewName = newName.trim();
    const finalNewName = cleanNewName.toLowerCase().endsWith('.mhtml') ? cleanNewName : cleanNewName + '.mhtml';
    
    // Update files lists
    const idx = state.mappingState.mhtmlFiles.indexOf(oldName);
    if (idx !== -1) {
        state.mappingState.mhtmlFiles[idx] = finalNewName;
    }
    
    // Update any active links
    state.mappingState.pages.forEach(p => {
        if (p.mappedMhtml === oldName) {
            p.mappedMhtml = finalNewName;
        }
    });
    
    // Cascade renames chain
    let originalName = oldName;
    for (const orig in state.mappingState.renames) {
        if (state.mappingState.renames[orig] === oldName) {
            originalName = orig;
            break;
        }
    }
    state.mappingState.renames[originalName] = finalNewName;
    
    renderMappingInterface();
}

export function autoMapBySuffix() {
    let matchCount = 0;
    state.mappingState.pages.forEach(p => {
        if (!p.mappedMhtml) {
            const pageClean = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const match = state.mappingState.mhtmlFiles.find(f => {
                const dotIdx = f.lastIndexOf('.');
                const base = dotIdx > 0 ? f.substring(0, dotIdx) : f;
                const fileClean = base.toLowerCase().replace(/[^a-z0-9]/g, '');
                return fileClean.includes(pageClean) || pageClean.includes(fileClean);
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

export async function saveMappingConfig() {
    // 1. Rename files in IndexedDB
    for (const [oldName, newName] of Object.entries(state.mappingState.renames)) {
        await dbRenameMhtmlFile(oldName, newName);
    }
    
    // 2. Rename pages in locator configurations inside IndexedDB
    const locators = state.mappingState.originalLocatorsData;
    let locatorsChanged = false;
    
    (locators.pages || []).forEach(p => {
        if (state.mappingState.pageRenames[p.name]) {
            p.name = state.mappingState.pageRenames[p.name];
            locatorsChanged = true;
        }
    });
    
    if (locatorsChanged) {
        await dbHelper.setConfig(`locators||${state.mappingState.folder}`, locators);
    }
    
    // 3. Construct and write new mapper.json
    const mappings = [];
    state.mappingState.pages.forEach(p => {
        if (p.mappedMhtml) {
            mappings.push({
                page_name: p.name,
                mhtml_file: p.mappedMhtml
            });
        }
    });
    
    // Analyze original locators config to detect schema version (v1 vs v2)
    let isV2 = false;
    if (locators && locators.pages && locators.pages.length > 0) {
        const pageWithElements = locators.pages.find(p => p.elements && p.elements.length > 0);
        if (pageWithElements) {
            const firstEl = pageWithElements.elements[0];
            isV2 = (firstEl.elementType !== undefined || firstEl.locator !== undefined);
        }
    }
    const versionTag = isV2 ? 'v2' : 'v1';
    
    // Generate timestamp for when this workspace was saved
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    const folderLabel = `Active Workspace (${versionTag}) - ${timestamp}`;
    
    const newGroup = {
        name: folderLabel,
        folder: state.mappingState.folder,
        active: true,
        mappings: mappings
    };
    
    // Maintain only the single active workspace group (no history)
    const newMapperConfig = {
        test_groups: [newGroup]
    };
    
    await dbHelper.setConfig('mapper', newMapperConfig);
    state.mapperConfig = newMapperConfig;
    
    alert("Mapping saved! mapper.json has been created and verified.");
    window.closeUploadModal();
    await initApp();
}

export async function dbRenameMhtmlFile(oldName, newName) {
    const db = await dbHelper.init();
    
    const meta = await dbHelper.getMhtmlMeta(oldName);
    if (!meta) return;
    
    meta.filename = newName;
    await dbHelper.saveMhtmlMeta(meta);
    
    const tx = db.transaction('mhtml_resources', 'readwrite');
    const store = tx.objectStore('mhtml_resources');
    const index = store.index('filename');
    const request = index.openCursor(IDBKeyRange.only(oldName));
    
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        
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
                
                store.put(newResource);
                cursor.continue();
            }
        };
        request.onerror = () => reject(request.error);
    });
    
    await dbHelper.deleteMhtmlFile(oldName);
}

// Window exposure for HTML onclick/onchange handlers
window.enterMappingMode = enterMappingMode;
window.exitMappingMode = exitMappingMode;
window.autoMapBySuffix = autoMapBySuffix;
window.saveMappingConfig = saveMappingConfig;
window.unlinkMhtml = unlinkMhtml;
window.renamePage = renamePage;
window.renameMhtmlFile = renameMhtmlFile;
