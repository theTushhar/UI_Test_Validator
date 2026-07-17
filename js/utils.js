// js/utils.js - Utility functions

export function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Escapes a value for safe embedding inside a single-quoted JS string literal
// that itself sits inside a double-quoted HTML attribute (the app's
// onclick="fn('${escapeJs(x)}')" pattern). Must escape backslashes/quotes for
// JS-string safety AND double quotes for the surrounding HTML attribute, or a
// value containing a literal `"` can break out of the attribute entirely.
export function escapeJs(unsafe) {
    return String(unsafe)
         .replace(/\\/g, "\\\\")
         .replace(/'/g, "\\'")
         .replace(/"/g, "&quot;")
         .replace(/\n/g, "\\n")
         .replace(/\r/g, "\\r");
}

export function showToast(message, type = 'info') {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'toast-notification ' + type;
    toast.style.display = 'block';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// Copies `text` to the clipboard, giving the user visible confirmation (a toast,
// plus a brief success flash on the triggering `btn`, if passed) rather than
// silently succeeding/failing — copy buttons throughout the app previously gave
// no feedback at all, which reads as broken even when the copy worked.
export function copyToClipboard(text, btn) {
    const doCopy = () => {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        // Fallback for non-secure contexts (e.g. plain http://) where the
        // async Clipboard API isn't available.
        return new Promise((resolve, reject) => {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (ok) resolve(); else reject(new Error('execCommand copy failed'));
            } catch (err) {
                reject(err);
            }
        });
    };

    return doCopy().then(() => {
        showToast('Copied to clipboard', 'success');
        if (btn) {
            btn.classList.add('copy-btn-flash');
            clearTimeout(btn._copyFlashTimeout);
            btn._copyFlashTimeout = setTimeout(() => btn.classList.remove('copy-btn-flash'), 900);
        }
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showToast('Copy failed — clipboard access was denied', 'error');
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
window.showToast = showToast;
window.copyToClipboard = copyToClipboard;
window.scrollIntoViewOnlyContainer = scrollIntoViewOnlyContainer;
