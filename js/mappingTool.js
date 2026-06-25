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
    
    // Scan IndexedDB for locator config keys and pick the latest
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
        alert("No JSON config found. Please upload a JSON config file first.");
        exitMappingMode();
        return;
    }
    
    // Pick the latest key (most recent timestamp)
    const latestKey = locatorKeys.sort((a, b) => {
        const tsA = a.split('||')[1] || '';
        const tsB = b.split('||')[1] || '';
        return tsB.localeCompare(tsA);
    })[0];
    
    const activeFolder = latestKey.split('||')[1] || 'root';
    const locatorsData = await dbHelper.getConfig(latestKey);
    
    if (!locatorsData) {
        alert("No JSON config found. Please upload a JSON config file first.");
        exitMappingMode();
        return;
    }
    
    let mhtmlList = await dbHelper.getConfig(`mhtml_batch||${activeFolder}`);
    const currentBatch = await dbHelper.getConfig('mhtml_batch') || [];
    
    if (mhtmlList) {
        // Replace any stale entries: if a file in currentBatch has a _v{N} suffix
        // that corresponds to an original name in mhtmlList, swap them.
        const staleNames = [];
        const updatedList = [...mhtmlList];
        
        for (const currentFile of currentBatch) {
            const baseMatch = currentFile.match(/^(.+)_v(\d+)(\.mhtml)$/i);
            if (baseMatch) {
                const baseName = baseMatch[1] + baseMatch[3];
                const idx = updatedList.indexOf(baseName);
                if (idx !== -1) {
                    staleNames.push(baseName);
                    updatedList[idx] = currentFile;
                }
            }
        }
        
        // Add any genuinely new files not in the list
        const finalSet = new Set(updatedList);
        for (const f of currentBatch) {
            if (!finalSet.has(f)) {
                updatedList.push(f);
            }
        }
        
        mhtmlList = updatedList;
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
                    style="flex: 1; padding: 3px 6px; font-size: 0.7rem; border-radius: 3px; border: 1px solid var(--border-glass); background: transparent;"
                    title="Rename MHTML file">
            `;
            mhtmlList.appendChild(badge);
        });
    } else {
        mhtmlList.innerHTML = '<div style="font-size: 0.7rem; color: var(--text-muted); text-align: center; padding: 16px 0;">All MHTML files mapped</div>';
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
                style="width: 100%; padding: 4px 8px; font-size: 0.75rem; font-weight: 600; border-radius: 3px; border: 1px solid var(--border-glass); margin-bottom: 4px;"
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
    
    const folderLabel = state.mappingState.folder === '' ? 'Default Test Group' :
        state.mappingState.folder.startsWith('_v') ? `Test Group ${state.mappingState.folder.replace('_v', 'v')}` :
        state.mappingState.folder;
    
    const newGroup = {
        name: folderLabel,
        folder: state.mappingState.folder,
        active: true,
        mappings: mappings
    };
    
    let testGroups = state.mapperConfig.test_groups || [];
    testGroups.push(newGroup);
    
    const newMapperConfig = {
        test_groups: testGroups
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
