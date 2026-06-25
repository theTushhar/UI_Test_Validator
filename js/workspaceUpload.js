// js/workspaceUpload.js - Upload modal, file parsing, drag-drop, DB persistence

import { state } from './state.js';
import { escapeJs, escapeHtml, findUniqueFilename, findUniqueLocatorKey, readFileAsText, readFileAsArrayBuffer, logToModalConsole } from './utils.js';
import { initApp } from './state.js';

export function openUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.style.display = 'flex';
    document.getElementById('upload-log-box').style.display = 'none';
    document.getElementById('upload-log-box').textContent = '';
    
    // Clear out files input elements
    const mhtmlInput = document.getElementById('mhtml-file-input');
    const jsonInput = document.getElementById('json-file-input');
    if (mhtmlInput) mhtmlInput.value = '';
    if (jsonInput) jsonInput.value = '';
    
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
                <span class="mhtml-file-name" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
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

export async function deleteMhtmlFileRecord(filename) {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
        await dbHelper.deleteMhtmlFile(filename);
        refreshUploadStatusDisplay();
        await initApp();
    }
}

export async function clearAllWorkspaceData() {
    if (confirm("Are you sure you want to delete all stored workspace data? This will clear all configs and files.")) {
        await dbHelper.clearAllData();
        refreshUploadStatusDisplay();
        await initApp();
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
        await dbHelper.setConfig('mhtml_batch', batchNames);
    }
    
    refreshUploadStatusDisplay();
}

export async function handleJsonFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('upload-log-box').style.display = 'block';
    document.getElementById('upload-log-box').textContent = '';
    
    logToModalConsole(`Reading locator config file: ${file.name}...`, 'info');
    
    try {
        const text = await readFileAsText(file);
        const json = JSON.parse(text);
        
        if (!json.pages) {
            throw new Error("Invalid JSON config: 'pages' key is missing.");
        }
        
        const locatorKey = await findUniqueLocatorKey();
        const folderName = locatorKey.split('||')[1] || 'root';
        logToModalConsole(`Saving as folder: "${folderName}".`, 'info');
        
        await dbHelper.setConfig(locatorKey, json);
        
        // Associate current MHTML batch with this locator folder
        const currentBatch = await dbHelper.getConfig('mhtml_batch');
        if (currentBatch && currentBatch.length > 0) {
            await dbHelper.setConfig(`mhtml_batch||${folderName}`, currentBatch);
        }
        
        logToModalConsole(`Success: JSON config imported (folder: ${folderName}).`, 'success');
        refreshUploadStatusDisplay();
    } catch (err) {
        logToModalConsole(`Error processing locator JSON: ${err.message}`, 'error');
        console.error(err);
    }
}

export function setupDragAndDrop() {
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

// Window exposure for HTML onclick handlers
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.triggerMhtmlInput = triggerMhtmlInput;
window.triggerJsonInput = triggerJsonInput;
window.handleMhtmlFilesSelected = handleMhtmlFilesSelected;
window.handleJsonFileSelected = handleJsonFileSelected;
window.deleteMhtmlFileRecord = deleteMhtmlFileRecord;
window.clearAllWorkspaceData = clearAllWorkspaceData;
window.applyAndCloseUploadModal = applyAndCloseUploadModal;
