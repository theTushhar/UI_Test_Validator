// js/utils.js - Utility functions

export function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

export function escapeJs(unsafe) {
    return unsafe.replace(/'/g, "\\'");
}

export function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Successful copy
    }).catch(err => {
        console.error('Could not copy text: ', err);
    });
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

export function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

export async function findUniqueFilename(originalName) {
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

export async function findUniqueLocatorKey() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const folderName = `_${timestamp}`;
    const key = `locators||${folderName}`;
    return key;
}

export function logToModalConsole(msg, type = 'info') {
    const box = document.getElementById('upload-log-box');
    box.style.display = 'block';
    const time = new Date().toLocaleTimeString();
    box.textContent += `[${time}] [${type.toUpperCase()}] ${msg}\n`;
    box.scrollTop = box.scrollHeight;
}

export function scrollIntoViewOnlyContainer(elem, container) {
    if (!elem || !container) return;
    
    const elemRect = elem.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    const elemTop = elemRect.top - containerRect.top + container.scrollTop;
    const elemBottom = elemTop + elemRect.height;
    
    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    
    if (elemTop < containerTop) {
        container.scrollTo({ top: elemTop, behavior: 'smooth' });
    } else if (elemBottom > containerBottom) {
        container.scrollTo({ top: elemBottom - container.clientHeight, behavior: 'smooth' });
    }
}

// Expose to window for onclick handlers in HTML
window.escapeHtml = escapeHtml;
window.escapeJs = escapeJs;
window.copyToClipboard = copyToClipboard;
window.scrollIntoViewOnlyContainer = scrollIntoViewOnlyContainer;