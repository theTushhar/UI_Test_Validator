// js/dialogs.js - In-app alert/confirm dialogs (replaces window.alert/confirm)

const ICONS = {
    info: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--in, #64748b)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    warning: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--wa, #d97706)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    error: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--er, #dc2626)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    success: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--su, #16a34a)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
};

// Holds the resolver for whichever dialog is currently open, plus the value
// to resolve with if the user dismisses via backdrop click / Escape instead
// of clicking one of the rendered buttons.
let activeDialog = null;

function resolveActiveDialog(value) {
    if (!activeDialog) return;
    document.getElementById('app-dialog-modal').style.display = 'none';
    const { resolve } = activeDialog;
    activeDialog = null;
    resolve(value);
}

// Wired to backdrop clicks (init.js) and the Escape key (navigation.js).
export function dismissAppDialog() {
    if (!activeDialog) return;
    resolveActiveDialog(activeDialog.dismissValue);
}

function openDialog({ title, message, type, dismissValue, buttons }) {
    return new Promise((resolve) => {
        // Guard against a second dialog being requested while one is already
        // showing — resolve the stale one first so its caller isn't left hanging.
        if (activeDialog) {
            resolveActiveDialog(activeDialog.dismissValue);
        }
        activeDialog = { resolve, dismissValue };

        document.getElementById('app-dialog-icon').innerHTML = ICONS[type] || ICONS.info;
        document.getElementById('app-dialog-title').textContent = title;
        document.getElementById('app-dialog-message').textContent = message;

        const footer = document.getElementById('app-dialog-footer');
        footer.innerHTML = '';
        buttons.forEach(({ label, className, value }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = className;
            btn.textContent = label;
            btn.addEventListener('click', () => resolveActiveDialog(value));
            footer.appendChild(btn);
        });

        document.getElementById('app-dialog-modal').style.display = 'flex';
    });
}

/**
 * Drop-in replacement for window.alert(). Shows an in-app modal with a
 * single "OK" button. Resolves once dismissed.
 */
export function showAppAlert(message, { title = 'Notice', type = 'info' } = {}) {
    return openDialog({
        title,
        message,
        type,
        dismissValue: undefined,
        buttons: [{ label: 'OK', className: 'btn btn-sm btn-primary', value: undefined }]
    });
}

/**
 * Drop-in replacement for window.confirm(). Shows an in-app modal with
 * Cancel/Confirm buttons. Resolves to true/false.
 */
export function showAppConfirm(message, { title = 'Please Confirm', type = 'warning', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = true } = {}) {
    return openDialog({
        title,
        message,
        type,
        dismissValue: false,
        buttons: [
            { label: cancelLabel, className: 'btn btn-sm btn-ghost', value: false },
            { label: confirmLabel, className: danger ? 'btn btn-sm btn-outline btn-error' : 'btn btn-sm btn-primary', value: true }
        ]
    });
}

window.dismissAppDialog = dismissAppDialog;
