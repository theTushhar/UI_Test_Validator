const express = require('express');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { MHTMLArchive } = require('./mhtmlParser');

const app = express();
const PORT = process.env.PORT || 3000;

// Use process.cwd() on Vercel because files are located in the build output directory, 
// otherwise use __dirname for local development.
const projectRoot = process.env.VERCEL ? process.cwd() : __dirname;

// Ephemeral in-memory fallback for locator findings when running in a read-only environment like Vercel
let inMemoryFindings = {};

// Enable JSON parsing middleware with a larger limit for locator findings payload
app.use(express.json({ limit: '50mb' }));

// Security headers. Note: script-src still allows 'unsafe-inline' because the frontend
// currently relies on inline onclick="..." handlers throughout index.html; that is a
// larger app-wide refactor (see IMPROVEMENTS.md) tracked separately. This is defense-in-depth
// for the fact that uploaded MHTML/JSON content is rendered/interpolated in the app —
// it restricts which origins scripts/styles/frames can load from even if an escaping bug slips through.
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "frame-src 'self'",
            "object-src 'none'",
            "base-uri 'self'"
        ].join('; ')
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

// Cache for parsed MHTML archives to avoid re-parsing on every asset request.
// Bounded LRU keyed by filename, invalidated whenever the underlying file's mtime changes.
const MHTML_CACHE_MAX_ENTRIES = 50;
const mhtmlCache = new Map();

/**
 * Joins `relativePath` onto `baseDir` and verifies the resolved path is still
 * contained within `baseDir`, rejecting any `..` escape (path traversal).
 * @param {string} baseDir
 * @param {string} relativePath
 * @returns {string|null} The resolved absolute path, or null if it escapes baseDir
 */
function safeJoin(baseDir, relativePath) {
    const cleanRelPath = relativePath.split(/[/\\]+/).join(path.sep);
    const resolvedBase = path.resolve(baseDir);
    const target = path.resolve(resolvedBase, cleanRelPath);
    if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
        return null;
    }
    return target;
}

/**
 * Robust path resolver. Checks both the workspace root and the "Data" subfolder.
 * Rejects any path that would escape either directory (path traversal).
 * @param {string} relativePath
 * @returns {string|null} The resolved absolute path, or null if not found
 */
function resolvePath(relativePath) {
    if (!relativePath) return null;

    // 1. Try directly in workspace root
    const path1 = safeJoin(projectRoot, relativePath);
    if (path1 && fs.existsSync(path1)) {
        return path1;
    }

    // 2. Try inside "Data" folder
    const path2 = safeJoin(path.join(projectRoot, 'Data'), relativePath);
    if (path2 && fs.existsSync(path2)) {
        return path2;
    }

    return null;
}

/**
 * Loads the mapper.json configuration file.
 * Checks both root and Data directories.
 * @returns {object} The parsed mapper object
 */
function loadMapper() {
    const mapperPath = resolvePath('mapper.json') || path.join(projectRoot, 'mapper.json');
    if (fs.existsSync(mapperPath)) {
        try {
            const data = fs.readFileSync(mapperPath, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            console.error(`[Server] Error parsing mapper.json:`, e);
        }
    }
    return { test_groups: [] };
}

/**
 * Gets all MHTML files recursively under a directory (async, non-blocking).
 * Skips dependency and cache folders to stay performant.
 */
async function getMhtmlFilesRecursively(dir, baseDir, fileList = []) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
        return fileList;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            const lowerFile = entry.name.toLowerCase();
            if (
                lowerFile !== 'node_modules' &&
                lowerFile !== '.git' &&
                lowerFile !== '.gemini' &&
                lowerFile !== '.agents' &&
                lowerFile !== '__pycache__'
            ) {
                await getMhtmlFilesRecursively(fullPath, baseDir, fileList);
            }
        } else if (entry.isFile() && (entry.name.endsWith('.mhtml') || (entry.name.endsWith('.html') && entry.name !== 'index.html'))) {
            let relPath = path.relative(baseDir, fullPath);
            relPath = relPath.split(path.sep).join('/');
            fileList.push(relPath);
        }
    }
    return fileList;
}

/**
 * Returns MHTMLArchive instance for caching. The cache entry is invalidated
 * whenever the source file's mtime changes, and the cache is bounded to an
 * LRU of MHTML_CACHE_MAX_ENTRIES to avoid unbounded memory growth.
 * @param {string} filename
 * @returns {MHTMLArchive|null}
 */
function getMHTMLArchive(filename) {
    const resolvedPath = resolvePath(filename);
    if (!resolvedPath) {
        console.error(`[Server] Could not locate MHTML file: ${filename}`);
        return null;
    }

    let mtimeMs;
    try {
        mtimeMs = fs.statSync(resolvedPath).mtimeMs;
    } catch (e) {
        return null;
    }

    const cached = mhtmlCache.get(filename);
    if (cached && cached.mtimeMs === mtimeMs) {
        // Refresh LRU order (Map preserves insertion order)
        mhtmlCache.delete(filename);
        mhtmlCache.set(filename, cached);
        return cached.archive;
    }

    const archive = new MHTMLArchive(resolvedPath);
    mhtmlCache.set(filename, { mtimeMs, archive });

    if (mhtmlCache.size > MHTML_CACHE_MAX_ENTRIES) {
        const oldestKey = mhtmlCache.keys().next().value;
        mhtmlCache.delete(oldestKey);
    }

    return archive;
}

// ==========================================
// REST API Routes
// ==========================================

// Get Mapper Configuration
app.get('/api/mapper', (req, res) => {
    const mapper = loadMapper();
    res.json(mapper);
});

// List all MHTML files (either from mapper config or workspace walking)
app.get('/api/files', async (req, res) => {
    const useMapper = (req.query.mapper || 'false').toLowerCase() === 'true';

    if (useMapper) {
        const mapper = loadMapper();
        const activeGroups = (mapper.test_groups || []).filter(g => g.active !== false);
        const filesSet = new Set();
        
        for (const group of activeGroups) {
            const folder = group.folder || '';
            for (const mapping of (group.mappings || [])) {
                const mhtmlFile = mapping.mhtml_file || '';
                const fullPath = folder ? `${folder}/${mhtmlFile}` : mhtmlFile;
                filesSet.add(fullPath);
            }
        }
        const files = Array.from(filesSet);
        files.sort();
        return res.json(files);
    } else {
        const files = await getMhtmlFilesRecursively(projectRoot, projectRoot);
        files.sort();
        return res.json(files);
    }
});

// Get Locator Config by subdirectory and optional page name
app.get('/api/locators', (req, res) => {
    const subdir = req.query.dir || '';
    const pageName = req.query.page || '';
    
    let locatorPath = null;
    if (subdir) {
        locatorPath = resolvePath(path.join(subdir, 'locator.json'));
    } else {
        locatorPath = resolvePath('locator.json');
    }
    
    let data = { pages: [] };
    if (locatorPath && fs.existsSync(locatorPath)) {
        try {
            const content = fs.readFileSync(locatorPath, 'utf-8');
            const fullData = JSON.parse(content);
            
            if (pageName) {
                const filteredPages = (fullData.pages || []).filter(p => p.name === pageName);
                data = { pages: filteredPages };
            } else {
                data = fullData;
            }
        } catch (e) {
            console.error(`[Server] Error reading/parsing locator file at ${locatorPath}:`, e);
        }
    } else {
        console.warn(`[Server] Locator configuration not found for subdir: "${subdir}"`);
    }
    
    res.json(data);
});

// Get User Findings
app.get('/api/findings', (req, res) => {
    const findingsPath = resolvePath('locator_findings.json') || path.join(projectRoot, 'locator_findings.json');
    let data = {};
    
    if (fs.existsSync(findingsPath)) {
        try {
            const content = fs.readFileSync(findingsPath, 'utf-8');
            data = JSON.parse(content);
        } catch (e) {
            console.error(`[Server] Error parsing findings:`, e);
        }
    } else {
        // Fallback to in-memory store if the file doesn't exist
        data = inMemoryFindings;
    }
    res.json(data);
});

// Save Locator Config (PUT) — persists locator.json to disk
app.put('/api/locators', (req, res) => {
    const subdir = req.query.dir || '';
    const locatorData = req.body;
    
    if (!locatorData || !locatorData.pages) {
        return res.status(400).json({ error: 'Invalid locator config: missing "pages" key.' });
    }
    
    let locatorPath = null;
    if (subdir) {
        const dataDir = safeJoin(path.join(projectRoot, 'Data'), subdir);
        if (!dataDir) {
            return res.status(400).json({ error: 'Invalid "dir" parameter.' });
        }
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        locatorPath = path.join(dataDir, 'locator.json');
    } else {
        locatorPath = path.join(projectRoot, 'locator.json');
    }

    try {
        fs.writeFileSync(locatorPath, JSON.stringify(locatorData, null, 2), 'utf-8');
        res.json({ status: 'success', file: locatorPath });
    } catch (e) {
        console.error(`[Server] Failed to write locator config:`, e);
        res.status(500).json({ error: 'Failed to write locator config to disk.' });
    }
});

// Save User Findings
app.post('/api/save', (req, res) => {
    const findings = req.body;
    let findingsPath = resolvePath('locator_findings.json');
    
    if (!findingsPath) {
        // If not found, write to root or Data/ if Data exists
        const dataDir = path.join(projectRoot, 'Data');
        if (fs.existsSync(dataDir)) {
            findingsPath = path.join(dataDir, 'locator_findings.json');
        } else {
            findingsPath = path.join(projectRoot, 'locator_findings.json');
        }
    }
    
    try {
        fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2), 'utf-8');
        res.json({ status: 'success', persisted: true, file: findingsPath });
    } catch (e) {
        // Expected on read-only serverless filesystems (e.g. Vercel). This in-memory value is
        // NOT reliably preserved across requests on serverless platforms (no instance affinity),
        // so callers must not treat this as durable storage — report it as such rather than "success".
        console.warn(`[Server] Failed to write findings to disk. Falling back to in-memory storage (not durable on serverless platforms).`, e);
        inMemoryFindings = findings;
        res.status(202).json({
            status: 'not_persisted',
            persisted: false,
            storage: 'memory',
            warning: 'Filesystem is read-only and this environment does not guarantee in-memory persistence across requests. Findings were NOT durably saved.'
        });
    }
});

// ==========================================
// MHTML Static Resource / Sub-resource Proxy
// ==========================================
app.get('/serve_mhtml/*', (req, res) => {
    // The app's own preview <iframe> loads this route same-origin (a deliberate design
    // choice — see IMPROVEMENTS.md). The blanket X-Frame-Options: DENY set above would
    // block that same-origin framing entirely, breaking the preview. Relax it to
    // SAMEORIGIN for this route only; every other response stays DENY.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const prefix = '/serve_mhtml/';
    const relPath = req.originalUrl.slice(prefix.length);
    
    // Split on first slash: raw filename and subpath
    const slashIndex = relPath.indexOf('/');
    let filenameRaw, subPathRaw;
    if (slashIndex === -1) {
        filenameRaw = relPath;
        subPathRaw = '';
    } else {
        filenameRaw = relPath.substring(0, slashIndex);
        subPathRaw = relPath.substring(slashIndex); // starts with '/'
    }

    const filename = decodeURIComponent(filenameRaw);
    const archive = getMHTMLArchive(filename);

    if (!archive) {
        return res.status(404).send(`MHTML archive not found: ${filename}`);
    }

    if (!subPathRaw) {
        // Serve the main HTML document from the MHTML archive
        let mainHtml = archive.html;
        const escapedFilename = encodeURIComponent(filename);

        // Perform dynamic rewriting of resource URLs in the main HTML to route through our proxy
        for (const mapping of archive.locationMappings) {
            const normPath = mapping.target.startsWith('/') ? mapping.target : '/' + mapping.target;
            const proxyUrl = `/serve_mhtml/${escapedFilename}${normPath}`;

            mainHtml = mainHtml.split(mapping.original).join(proxyUrl);

            // Also check for HTML-escaped variants (e.g. &amp; instead of & in URLs)
            const escapedLoc = mapping.original.split('&').join('&amp;');
            if (escapedLoc !== mapping.original) {
                mainHtml = mainHtml.split(escapedLoc).join(proxyUrl);
            }
        }

        const normMainLocation = archive.mainLocation.startsWith('/') ? archive.mainLocation : '/' + archive.mainLocation;
        const baseUrl = `/serve_mhtml/${escapedFilename}${normMainLocation}`;

        // Inject <base href> tag to guarantee relative resources load through our proxy as well
        let injectedHtml = mainHtml;
        if (mainHtml.includes('<head>')) {
            injectedHtml = mainHtml.replace('<head>', `<head><base href="${baseUrl}">`);
        } else {
            injectedHtml = `<base href="${baseUrl}">` + mainHtml;
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(injectedHtml);
    } else {
        // Serve sub-resource (CSS, Image, JS, etc.)
        let subPathWithQuery = decodeURIComponent(subPathRaw);
        
        // Append query params if request has them
        const parsedUrl = url.parse(req.originalUrl);
        if (parsedUrl.search) {
            subPathWithQuery += parsedUrl.search;
        }

        let { payload, contentType } = archive.getResource(subPathWithQuery);
        if (payload !== null) {
            // If the sub-resource is a stylesheet, rewrite any URLs inside it too
            if (contentType && contentType.includes('text/css')) {
                let cssText;
                let encoding = 'utf-8';
                try {
                    cssText = payload.toString('utf-8');
                } catch (e) {
                    cssText = payload.toString('latin1');
                    encoding = 'latin1';
                }

                const escapedFilename = encodeURIComponent(filename);
                for (const mapping of archive.locationMappings) {
                    const normPath = mapping.target.startsWith('/') ? mapping.target : '/' + mapping.target;
                    const proxyUrl = `/serve_mhtml/${escapedFilename}${normPath}`;
                    cssText = cssText.split(mapping.original).join(proxyUrl);
                }
                payload = Buffer.from(cssText, encoding);
            }

            if (contentType) {
                res.setHeader('Content-Type', contentType);
            }
            res.setHeader('Content-Length', payload.length);
            return res.end(payload);
        } else {
            return res.status(404).send(`Resource not found: ${subPathWithQuery}`);
        }
    }
});

// ==========================================
// Static Files & Frontend Routing Fallback
// ==========================================

// Serve frontend static assets (CSS, JS, images, etc.) from root directory
app.use(express.static(projectRoot));

// Fallback to index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(projectRoot, 'index.html'));
});

// Export app for serverless deployment on platforms like Vercel
module.exports = app;

// Start the consolidated Express Server only if run directly (local development)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n==================================================`);
        console.log(`🚀 Unified JS Server is running at: http://localhost:${PORT}`);
        console.log(`📂 Scanning files in: ${projectRoot}`);
        console.log(`==================================================\n`);
    });
}
