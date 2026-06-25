// js/elementDetail.js - Detail modal, locator rendering

import { state } from './state.js';

export function openDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'flex';
    state.isModalOpen = true;
}

export function closeDetailsModal() {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'none';
    state.isModalOpen = false;
}

window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
