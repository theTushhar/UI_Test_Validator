// js/init.js - Entry point: imports all modules and boots the app

// Side-effect imports: each module attaches functions to window for HTML onclick handlers
import './utils.js';
import './locatorMerge.js';
import './navigation.js';
import './iframe.js';
import './inspectMode.js';
import './elementDetail.js';
import './jsonEditor.js';
import './elementEditForm.js';
import './elementList.js';
import './workspaceUpload.js';
import './mappingTool.js';
import './bulkActions.js';
import './welcome.js';

// Named imports for boot sequence
import { initApp } from './state.js';
import { setupIframeMessagePassing, updateIframeZoom } from './iframe.js';
import { setupKeyboardShortcuts } from './navigation.js';
import { setupDragAndDrop } from './workspaceUpload.js';

// Register Service Worker for client-side offline MHTML routing
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[Service Worker] Registered successfully with scope:', reg.scope))
            .catch(err => console.error('[Service Worker] Registration failed:', err));
    });
}

window.addEventListener('load', async () => {
    await initApp();
    setupIframeMessagePassing();
    setupKeyboardShortcuts();
    setupDragAndDrop();
    
    // Lock main viewport scroll to prevent inspect or layout shift from hiding header
    const lockScroll = () => {
        if (window.scrollY !== 0 || window.scrollX !== 0) {
            window.scrollTo(0, 0);
        }
        if (document.documentElement.scrollTop !== 0 || document.documentElement.scrollLeft !== 0) {
            document.documentElement.scrollTop = 0;
            document.documentElement.scrollLeft = 0;
        }
        if (document.body.scrollTop !== 0 || document.body.scrollLeft !== 0) {
            document.body.scrollTop = 0;
            document.body.scrollLeft = 0;
        }
    };
    window.addEventListener('scroll', lockScroll, { passive: true });
    document.addEventListener('scroll', lockScroll, { passive: true });
    
    // Set up window resize handler for Auto Fit and alignment update
    window.addEventListener('resize', () => {
        updateIframeZoom();
    });
    
    // Close modal on click outside content
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('details-modal');
        if (e.target === modal) {
            window.closeDetailsModal();
        }
        
        const uploadModal = document.getElementById('upload-modal');
        if (e.target === uploadModal) {
            window.closeUploadModal();
        }
        
        const confirmModal = document.getElementById('confirm-remove-modal');
        if (e.target === confirmModal) {
            window.closeConfirmRemoveModal();
        }
        
        const jsonEditorModal = document.getElementById('json-editor-modal');
        if (e.target === jsonEditorModal) {
            window.closeJsonEditor();
        }
    });
});
