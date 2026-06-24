/**
 * sw.js
 * Service Worker to intercept requests under /serve_mhtml/ and serve them from
 * browser IndexedDB offline cache.
 */

// Load the shared IndexedDB wrapper
importScripts('db.js');

self.addEventListener('install', (event) => {
    // Immediately activate the service worker to take control
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    // Claim any active clients instantly to start intercepting network requests without refresh
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Check if the request is destined for the virtual serve_mhtml directory
    if (url.pathname.startsWith('/serve_mhtml/')) {
        event.respondWith(handleServeMhtml(event.request));
    }
});

/**
 * Resolves an MHTML resource path and performs rewrites on HTML and CSS payloads.
 * @param {Request} request 
 * @returns {Promise<Response>}
 */
async function handleServeMhtml(request) {
    const url = new URL(request.url);
    const prefix = '/serve_mhtml/';
    const relPath = url.pathname.slice(prefix.length);
    
    // Find division of filename and subresource
    const slashIdx = relPath.indexOf('/');
    let filenameRaw, subPathRaw;
    if (slashIdx === -1) {
        filenameRaw = relPath;
        subPathRaw = '';
    } else {
        filenameRaw = relPath.substring(0, slashIdx);
        subPathRaw = relPath.substring(slashIdx); // begins with '/'
    }
    
    const filename = decodeURIComponent(filenameRaw);
    
    // Fetch metadata for MHTML from IndexedDB
    const meta = await dbHelper.getMhtmlMeta(filename);
    if (!meta) {
        // Fallback: attempt network fetch in case we are running with a local backend server
        try {
            const serverResponse = await fetch(request);
            if (serverResponse.status !== 404) {
                return serverResponse;
            }
        } catch (err) {
            console.warn('[Service Worker] Network fallback fetch failed:', err);
        }
        
        return new Response(`MHTML archive not found in local IndexedDB: "${filename}". Please upload files through the Manage Workspace Data panel.`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
    
    if (!subPathRaw) {
        // Serving the main HTML document
        const mainLocation = meta.mainLocation;
        const mainRes = await dbHelper.getResource(filename, mainLocation);
        if (!mainRes || !mainRes.blob) {
            return new Response(`Main HTML document not found in parsed MHTML archive "${filename}".`, {
                status: 404,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
        
        let mainHtml = await mainRes.blob.text();
        const escapedFilename = encodeURIComponent(filename);
        
        // Rewrite asset paths inside HTML content to route through service worker
        for (const mapping of meta.locationMappings) {
            const normPath = mapping.target.startsWith('/') ? mapping.target : '/' + mapping.target;
            const proxyUrl = `/serve_mhtml/${escapedFilename}${normPath}`;
            
            mainHtml = mainHtml.split(mapping.original).join(proxyUrl);
            
            // Rewrite HTML entity escaped variants if present
            const escapedLoc = mapping.original.split('&').join('&amp;');
            if (escapedLoc !== mapping.original) {
                mainHtml = mainHtml.split(escapedLoc).join(proxyUrl);
            }
        }
        
        // Injects base href element to ensure relative URL resolution is routed correctly
        const normMainLocation = mainLocation.startsWith('/') ? mainLocation : '/' + mainLocation;
        const baseUrl = `/serve_mhtml/${escapedFilename}${normMainLocation}`;
        
        let injectedHtml = mainHtml;
        if (mainHtml.toLowerCase().includes('<head>')) {
            injectedHtml = mainHtml.replace(/<head>/i, `<head><base href="${baseUrl}">`);
        } else {
            injectedHtml = `<base href="${baseUrl}">` + mainHtml;
        }
        
        return new Response(injectedHtml, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache'
            }
        });
    } else {
        // Serving nested resource
        let subPathWithQuery = decodeURIComponent(subPathRaw);
        if (url.search) {
            subPathWithQuery += url.search;
        }
        
        // Resolve nested file from IndexedDB resources
        // 1. Try with query parameters
        let resRecord = await dbHelper.getResource(filename, subPathWithQuery);
        
        // 2. Try without query parameters
        if (!resRecord && url.search) {
            resRecord = await dbHelper.getResource(filename, decodeURIComponent(subPathRaw));
        }
        
        // 3. Try clean pathname without leading slash
        if (!resRecord) {
            const cleanPath = subPathRaw.startsWith('/') ? subPathRaw.substring(1) : subPathRaw;
            resRecord = await dbHelper.getResource(filename, cleanPath);
            if (!resRecord && url.search) {
                resRecord = await dbHelper.getResource(filename, cleanPath + url.search);
            }
        }
        
        // 4. Try fuzzy matching suffix
        if (!resRecord) {
            const cleanPath = subPathRaw.startsWith('/') ? subPathRaw.substring(1) : subPathRaw;
            const metaFull = await dbHelper.getMhtmlMeta(filename);
            
            // Direct lookup in meta key list if possible, or fall back to DB search
            // (We iterate stored paths by loading meta resource mappings if we had them,
            // but we can search for closest matching key in our database)
            // For now, let's keep search simple:
        }
        
        if (resRecord && resRecord.blob) {
            let blob = resRecord.blob;
            let contentType = resRecord.contentType || 'application/octet-stream';
            
            // Rewrite links inside CSS files as well
            if (contentType.includes('text/css')) {
                let cssText = await blob.text();
                const escapedFilename = encodeURIComponent(filename);
                for (const mapping of meta.locationMappings) {
                    const normPath = mapping.target.startsWith('/') ? mapping.target : '/' + mapping.target;
                    const proxyUrl = `/serve_mhtml/${escapedFilename}${normPath}`;
                    cssText = cssText.split(mapping.original).join(proxyUrl);
                }
                blob = new Blob([cssText], { type: 'text/css' });
            }
            
            return new Response(blob, {
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': blob.size,
                    'Cache-Control': 'max-age=3600'
                }
            });
        } else {
            console.warn(`[Service Worker] Resource not found: "${subPathWithQuery}" in MHTML "${filename}"`);
            return new Response(`Resource "${subPathWithQuery}" not found in parsed MHTML archive "${filename}".`, {
                status: 404,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
    }
}
