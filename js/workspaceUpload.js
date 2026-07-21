// js/workspaceUpload.js - Upload modal, file parsing, drag-drop, DB persistence

import { state } from './state.js';
import { escapeJs, escapeHtml, showToast, readFileAsText, readFileAsArrayBuffer, logToModalConsole, findAutoMapMatch } from './utils.js';
import { showAppConfirm } from './dialogs.js';
import { initApp } from './state.js';

export async function ensureFreshSession() {
    if (!state.isSessionFresh) {
        logToModalConsole("Starting fresh upload. Clearing old workspace data...", "info");
        await dbHelper.clearAllData();
        await dbHelper.deleteConfig('mhtml_batch');
        state.isSessionFresh = true;
    }
}

export function openUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('upload-log-box').style.display = 'none';
    document.getElementById('upload-log-box').textContent = '';
    
    // Clear out files input elements
    const unifiedInput = document.getElementById('unified-file-input');
    if (unifiedInput) unifiedInput.value = '';
    
    // Mark session as not fresh yet, so the first file upload triggers clean slate
    state.isSessionFresh = false;

    refreshUploadStatusDisplay();
}

export function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'none';
}

/**
 * Updates status indicators in the upload modal from IndexedDB contents.
 */
export async function refreshUploadStatusDisplay() {
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
            
            // Format dynamic timestamp labels nicely, fallback to folder name if not run timestamp
            let label = folder;
            if (folder === 'active') {
                label = 'Active Workspace';
            } else if (folder.startsWith('Run ')) {
                label = folder.replace('_', ' ').replace(/(\d{2})-(\d{2})-(\d{2})$/, '$1:$2:$3');
            } else {
                label = folder === 'v1' ? 'v1 (Version 1)' : folder === 'v2' ? 'v2 (Version 2)' : folder === '' ? 'Default (v1)' : folder.startsWith('_v') ? `Upload ${folder.replace('_v', 'v')}` : folder;
            }
            chip.textContent = label;
            locatorsContainer.appendChild(chip);
        });
    } else {
        locatorsContainer.innerHTML = '<span class="text-xs text-base-content/40">None loaded</span>';
    }
    
    // 3. Check loaded MHTML archives for the current session
    const mhtmlList = document.getElementById('status-mhtml-list');
    mhtmlList.innerHTML = '';
    
    const files = await dbHelper.getConfig('mhtml_batch') || [];
    if (files.length > 0) {
        files.forEach(filename => {
            const item = document.createElement('div');
            item.className = 'mhtml-file-item';
            item.innerHTML = `
                <span class="mhtml-file-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
                <button class="mhtml-file-delete" onclick="deleteMhtmlFileRecord('${escapeJs(filename)}')" title="Delete File">&times;</button>
            `;
            mhtmlList.appendChild(item);
        });
    } else {
        mhtmlList.innerHTML = '<div class="text-xs text-base-content/40 text-center py-2.5 w-full">No MHTML files uploaded in this session</div>';
    }

    // Toggle proceed-to-mapping action button visibility
    const proceedBtn = document.getElementById('btn-proceed-mapping');
    const closeBtn = document.getElementById('btn-close-upload');
    if (proceedBtn) {
        if (activeFolders.length > 0 || files.length > 0) {
            proceedBtn.style.display = 'inline-flex';
            if (closeBtn) closeBtn.style.display = 'none';
        } else {
            proceedBtn.style.display = 'none';
            if (closeBtn) closeBtn.style.display = 'inline-flex';
        }
    }
}

export async function deleteMhtmlFileRecord(filename) {
    const confirmed = await showAppConfirm(`Are you sure you want to delete ${filename}?`, { title: 'Delete File', confirmLabel: 'Delete' });
    if (confirmed) {
        await dbHelper.deleteMhtmlFile(filename);
        let currentBatch = await dbHelper.getConfig('mhtml_batch') || [];
        currentBatch = currentBatch.filter(f => f !== filename);
        await dbHelper.setConfig('mhtml_batch', currentBatch);
        refreshUploadStatusDisplay();
        await initApp();
    }
}

export async function clearAllWorkspaceData() {
    const confirmed = await showAppConfirm(
        "Are you sure you want to delete all stored workspace data? This will clear all configs and files, so you can start a brand new workspace upload from a clean slate.",
        { title: 'Reset Workspace', confirmLabel: 'Reset Workspace' }
    );
    if (confirmed) {
        await dbHelper.clearAllData();

        // The DB is now empty, so the next file drop shouldn't trigger another
        // (redundant) wipe via ensureFreshSession().
        state.isSessionFresh = true;
        state.mappingState = null;

        // Clear file input elements and log so stale selections/messages don't linger
        const unifiedInput = document.getElementById('unified-file-input');
        if (unifiedInput) unifiedInput.value = '';
        const logBox = document.getElementById('upload-log-box');
        if (logBox) {
            logBox.style.display = 'none';
            logBox.textContent = '';
        }

        // If the mapping view was open, drop back to the plain upload view
        const uploadView = document.getElementById('upload-mode-view');
        const mappingView = document.getElementById('mapping-mode-view');
        if (uploadView) uploadView.style.display = 'block';
        if (mappingView) mappingView.style.display = 'none';
        const modalBox = document.getElementById('upload-modal-box');
        if (modalBox) modalBox.classList.remove('wide-modal');

        refreshUploadStatusDisplay();
        await initApp();
        showToast('Workspace reset. All configs and files were removed.', 'success');
    }
}

export async function applyAndCloseUploadModal() {
    closeUploadModal();
    // Reload state
    await initApp();
}

export function triggerMhtmlInput() {
    document.getElementById('mhtml-file-input').click();
}

export function triggerJsonInput() {
    document.getElementById('json-file-input').click();
}

export async function handleMhtmlFilesSelected(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    document.getElementById('upload-log-box').style.display = 'block';
    document.getElementById('upload-log-box').textContent = '';
    
    await ensureFreshSession();
    
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
            
            const uniqueName = file.name;
            
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
        await dbHelper.setConfig('mhtml_batch', batchNames);
    }
    
    refreshUploadStatusDisplay();
}

export function triggerUnifiedInput() {
    const input = document.getElementById('unified-file-input');
    if (input) input.click();
}

export function handleUnifiedFilesSelected(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        handleUnifiedFiles(files);
    }
}

export async function handleUnifiedFiles(files) {
    if (!files || files.length === 0) return;

    // Show log box
    const logBox = document.getElementById('upload-log-box');
    if (logBox) {
        logBox.style.display = 'block';
        logBox.textContent = '';
    }

    await ensureFreshSession();

    // Separate files
    const mhtmlFileList = [];
    let jsonFile = null;

    for (const file of files) {
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) {
            if (!jsonFile) {
                jsonFile = file;
            } else {
                logToModalConsole(`Multiple JSON configs detected. Using the first one: ${jsonFile.name}`, 'warning');
            }
        } else if (name.endsWith('.mhtml') || name.endsWith('.html')) {
            mhtmlFileList.push(file);
        }
    }

    if (!jsonFile && mhtmlFileList.length === 0) {
        logToModalConsole("No locator.json or MHTML files detected in upload.", "error");
        return;
    }

    let jsonSuccess = false;
    let jsonConfig = null;

    // Process JSON configuration
    if (jsonFile) {
        logToModalConsole(`Reading locator config: ${jsonFile.name}...`, 'info');
        try {
            const text = await readFileAsText(jsonFile);
            jsonConfig = JSON.parse(text);
            if (!jsonConfig.pages) {
                throw new Error("Invalid JSON: 'pages' key is missing.");
            }
            const folderName = 'active';
            const locatorKey = `locators||${folderName}`;
            await dbHelper.setConfig(locatorKey, jsonConfig);
            jsonSuccess = true;
            logToModalConsole(`Success: JSON config imported.`, 'success');
        } catch (err) {
            logToModalConsole(`Error processing locator JSON: ${err.message}`, 'error');
            console.error(err);
        }
    }

    // Process MHTML/HTML files
    const batchNames = [];
    let mhtmlSuccessCount = 0;

    if (mhtmlFileList.length > 0) {
        logToModalConsole(`Reading ${mhtmlFileList.length} HTML/MHTML files...`, 'info');
        for (const file of mhtmlFileList) {
            try {
                logToModalConsole(`Parsing file: ${file.name}...`, 'info');
                const arrayBuffer = await readFileAsArrayBuffer(file);
                
                const parser = new MHTMLArchiveBrowser();
                const parsed = await parser.parse(arrayBuffer, file.name);
                
                const uniqueName = file.name;
                
                await dbHelper.saveMhtmlMeta({
                    filename: uniqueName,
                    mainLocation: parsed.mainLocation,
                    locationMappings: parsed.locationMappings
                });
                
                for (const res of parsed.resources) {
                    await dbHelper.saveResource({
                        id: `${uniqueName}||${res.path}`,
                        filename: uniqueName,
                        path: res.path,
                        contentType: res.contentType,
                        blob: res.blob
                    });
                }
                
                mhtmlSuccessCount++;
                batchNames.push(uniqueName);
                logToModalConsole(`Success: ${uniqueName} imported.`, 'success');
            } catch (err) {
                logToModalConsole(`Error processing MHTML file ${file.name}: ${err.message}`, 'error');
                console.error(err);
            }
        }
        
        if (batchNames.length > 0) {
            await dbHelper.setConfig('mhtml_batch', batchNames);
            const folderName = 'active';
            await dbHelper.setConfig(`mhtml_batch||${folderName}`, batchNames);
        }
    }

    logToModalConsole(`Import summary: JSON: ${jsonSuccess ? 'Success' : 'No new config'}, MHTML: ${mhtmlSuccessCount} files.`, 'success');

    // Run Auto-Mapping check
    await runAutoMappingCheck();
}

export async function runAutoMappingCheck() {
    const activeFolder = 'active';
    const locatorsData = await dbHelper.getConfig(`locators||${activeFolder}`);
    const mhtmlList = await dbHelper.getConfig(`mhtml_batch||${activeFolder}`) || [];

    if (!locatorsData) {
        logToModalConsole("No locator config available. Please upload a JSON config to run auto-mapping.", "info");
        return;
    }

    if (mhtmlList.length === 0) {
        logToModalConsole("No MHTML files available. Please upload MHTML files to run auto-mapping.", "info");
        return;
    }

    const pages = locatorsData.pages || [];
    const mappings = [];
    let unmappedCount = 0;
    const usedFiles = new Set();

    logToModalConsole("Running auto-mapping matching algorithm...", "info");

    for (const page of pages) {
        const pageName = page.name;
        const availableFiles = mhtmlList.filter(f => !usedFiles.has(f));

        let match = findAutoMapMatch(pageName, availableFiles);

        if (!match && pages.length === 1 && availableFiles.length === 1) {
            match = availableFiles[0];
            logToModalConsole(`Heuristics: Mapping single page to single MHTML file: ${match}`, 'info');
        }

        if (match) {
            usedFiles.add(match);
            mappings.push({
                page_name: pageName,
                mhtml_file: match
            });
            logToModalConsole(`Mapped page "${pageName}" &rarr; "${match}"`, 'success');
        } else {
            unmappedCount++;
            logToModalConsole(`Unmapped page: "${pageName}"`, 'warning');
        }
    }

    if (unmappedCount === 0 && pages.length > 0) {
        logToModalConsole("Auto-mapping 100% successful! Activating workspace...", "success");

        let isV2 = false;
        const pageWithElements = pages.find(p => p.elements && p.elements.length > 0);
        if (pageWithElements) {
            const firstEl = pageWithElements.elements[0];
            isV2 = (firstEl.elementType !== undefined || firstEl.locator !== undefined);
        }
        const versionTag = isV2 ? 'v2' : 'v1';

        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        const folderLabel = `Active Workspace (${versionTag}) - ${timestamp}`;

        const newGroup = {
            name: folderLabel,
            folder: activeFolder,
            active: true,
            mappings: mappings
        };

        const newMapperConfig = {
            test_groups: [newGroup]
        };

        await dbHelper.setConfig('mapper', newMapperConfig);
        state.mapperConfig = newMapperConfig;

        closeUploadModal();
        showToast("Workspace successfully loaded and auto-mapped!", "success");
        await initApp();
    } else {
        logToModalConsole(`Auto-mapping incomplete. ${unmappedCount} pages require manual mapping. Entering mapping mode...`, 'warning');
        openUploadModal();
        await enterMappingMode();
    }
}

export function setupDragAndDrop() {
    const colUnified = document.getElementById('col-unified');
    const welcomeDropzone = document.getElementById('welcome-dropzone');
    
    // Welcome Page Dropzone styling listeners
    if (welcomeDropzone) {
        ['dragenter', 'dragover'].forEach(name => {
            welcomeDropzone.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                welcomeDropzone.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            welcomeDropzone.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                welcomeDropzone.classList.remove('dragover');
            });
        });
        welcomeDropzone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleUnifiedFiles(files);
            }
        });
    }

    // Modal Dropzone styling listeners
    if (colUnified) {
        ['dragenter', 'dragover'].forEach(name => {
            colUnified.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colUnified.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(name => {
            colUnified.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                colUnified.classList.remove('dragover');
            });
        });
        colUnified.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleUnifiedFiles(files);
            }
        });
    }

    // Prevent the browser's default "navigate to dropped file" behavior anywhere
    // outside the dedicated dropzones above, and treat such drops as a fallback
    // unified file upload. No full-screen overlay — the dropzones already show
    // their own drag feedback.
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleUnifiedFiles(files);
        }
    });
}

// Window exposure for HTML handlers
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.triggerUnifiedInput = triggerUnifiedInput;
window.handleUnifiedFilesSelected = handleUnifiedFilesSelected;
window.handleUnifiedFiles = handleUnifiedFiles;
window.runAutoMappingCheck = runAutoMappingCheck;
window.deleteMhtmlFileRecord = deleteMhtmlFileRecord;
window.clearAllWorkspaceData = clearAllWorkspaceData;
window.applyAndCloseUploadModal = applyAndCloseUploadModal;
