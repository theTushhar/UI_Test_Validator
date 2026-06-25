// js/welcome.js - Welcome dashboard toggle and stats

import { state } from './state.js';

export function toggleWelcomeDashboard(show) {
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

export async function updateWelcomeDashboardStats() {
    const welcome = document.getElementById('welcome-dashboard');
    if (!welcome || welcome.style.display === 'none') return;

    try {
        const activeGroups = (state.mapperConfig.test_groups || []).filter(g => g.active !== false);
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

window.toggleWelcomeDashboard = toggleWelcomeDashboard;
