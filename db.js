/**
 * db.js
 * Lightweight IndexedDB wrapper shared between main application thread (app.js)
 * and Service Worker thread (sw.js).
 */

const dbHelper = {
    db: null,
    
    /**
     * Initializes the IndexedDB database and object stores.
     * @returns {Promise<IDBDatabase>}
     */
    init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);
            
            // Standard IndexedDB open call
            const request = indexedDB.open('LocatorVerifierDB', 1);
            
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                
                // Store for general key-value configs (mapper.json, locator.json, etc.)
                if (!db.objectStoreNames.contains('config')) {
                    db.createObjectStore('config');
                }
                
                // Store for MHTML archives metadata
                if (!db.objectStoreNames.contains('mhtml_meta')) {
                    db.createObjectStore('mhtml_meta', { keyPath: 'filename' });
                }
                
                // Store for MHTML sub-resources (HTML, CSS, images, JS, etc.)
                // Uses filename index for fast cascaded deletes
                if (!db.objectStoreNames.contains('mhtml_resources')) {
                    const store = db.createObjectStore('mhtml_resources', { keyPath: 'id' });
                    store.createIndex('filename', 'filename', { unique: false });
                }
            };
            
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            
            request.onerror = (e) => {
                console.error('[IndexedDB] Database connection error:', e.target.error);
                reject(e.target.error);
            };
        });
    },
    
    /**
     * Gets a config value by key.
     */
    async getConfig(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('config', 'readonly');
            const store = tx.objectStore('config');
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Sets a config value by key.
     */
    async setConfig(key, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('config', 'readwrite');
            const store = tx.objectStore('config');
            const req = store.put(value, key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Deletes a config value by key.
     */
    async deleteConfig(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('config', 'readwrite');
            const store = tx.objectStore('config');
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Saves MHTML Archive metadata.
     */
    async saveMhtmlMeta(meta) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_meta', 'readwrite');
            const store = tx.objectStore('mhtml_meta');
            const req = store.put(meta);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Gets MHTML Archive metadata by filename.
     */
    async getMhtmlMeta(filename) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_meta', 'readonly');
            const store = tx.objectStore('mhtml_meta');
            const req = store.get(filename);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Saves a parsed MHTML resource blob.
     */
    async saveResource(resource) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_resources', 'readwrite');
            const store = tx.objectStore('mhtml_resources');
            const req = store.put(resource);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Gets a parsed MHTML resource blob by key (filename + '||' + path).
     */
    async getResource(filename, path) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_resources', 'readonly');
            const store = tx.objectStore('mhtml_resources');
            const id = filename + "||" + path;
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Lists all resource records stored for a given filename. Used by sw.js's suffix-match
     * fallback lookup, mirroring the equivalent fallback in mhtmlParser.js's getResource().
     */
    async getResourcesByFilename(filename) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_resources', 'readonly');
            const store = tx.objectStore('mhtml_resources');
            const index = store.index('filename');
            const req = index.getAll(IDBKeyRange.only(filename));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Lists all uploaded MHTML filenames in database.
     */
    async getAllMhtmlFiles() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('mhtml_meta', 'readonly');
            const store = tx.objectStore('mhtml_meta');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result.map(r => r.filename));
            req.onerror = () => reject(req.error);
        });
    },
    
    /**
     * Deletes an MHTML file metadata and all its parsed resources.
     */
    async deleteMhtmlFile(filename) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['mhtml_meta', 'mhtml_resources'], 'readwrite');
            
            // Delete metadata
            tx.objectStore('mhtml_meta').delete(filename);
            
            // Delete all resource blocks using the filename index range query
            const resStore = tx.objectStore('mhtml_resources');
            const index = resStore.index('filename');
            const request = index.openCursor(IDBKeyRange.only(filename));
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(tx.error || e.target.error);
        });
    },
    
    /**
     * Clears all IndexedDB stores.
     */
    async clearAllData() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(['config', 'mhtml_meta', 'mhtml_resources'], 'readwrite');
            tx.objectStore('config').clear();
            tx.objectStore('mhtml_meta').clear();
            tx.objectStore('mhtml_resources').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(tx.error || e.target.error);
        });
    }
};
