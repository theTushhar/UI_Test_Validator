/**
 * mhtmlParserBrowser.js
 * Browser-compatible parser for MHTML files.
 * Decodes Quoted-Printable and Base64 encoded sub-resources, converts them into Blobs,
 * and extracts routing maps for service-worker path rewriting.
 */

class MHTMLArchiveBrowser {
    constructor() {
        this.resources = {};
        this.contentTypeMap = {};
        this.html = "";
        this.mainLocation = "";
        this.locationMappings = [];
    }

    /**
     * Parses the given MHTML file array buffer.
     * @param {ArrayBuffer} arrayBuffer 
     * @param {string} filename 
     * @returns {Promise<{mainLocation: string, locationMappings: Array, resources: Array}>}
     */
    async parse(arrayBuffer, filename) {
        console.log(`[MHTMLParser] Parsing MHTML archive: ${filename}...`);
        
        const uint8Array = new Uint8Array(arrayBuffer);
        const decoder = new TextDecoder('utf-8');
        
        // Read the beginning of the file to extract the boundary delimiter
        const headerTextPart = decoder.decode(uint8Array.subarray(0, Math.min(uint8Array.length, 10000)));
        const boundaryMatch = headerTextPart.match(/boundary="?([^"\s;]+)"?/i) || headerTextPart.match(/boundary=([^\s;]+)/i);
        if (!boundaryMatch) {
            console.log(`[MHTMLParser] Could not find boundary in MHTML file: ${filename}. Treating as a plain HTML file.`);
            const pathKey = '/' + filename;
            const blob = new Blob([uint8Array], { type: 'text/html' });
            
            this.resources[pathKey] = { blob, contentType: 'text/html' };
            this.mainLocation = pathKey;
            this.locationMappings = [];
            
            try {
                this.html = new TextDecoder('utf-8').decode(uint8Array);
            } catch (e) {
                this.html = new TextDecoder('windows-1252').decode(uint8Array);
            }
            
            const parsedResources = [{ path: pathKey, blob, contentType: 'text/html' }];
            return {
                mainLocation: this.mainLocation,
                locationMappings: this.locationMappings,
                resources: parsedResources
            };
        }
        
        const boundary = boundaryMatch[1];
        const delimiter = new TextEncoder().encode('--' + boundary);
        
        // Helper to find indices of sub-arrays
        function findSubArrayIndices(arr, sub) {
            const indices = [];
            const subLen = sub.length;
            if (subLen === 0) return indices;
            const firstByte = sub[0];
            let pos = 0;
            while (true) {
                pos = arr.indexOf(firstByte, pos);
                if (pos === -1 || pos > arr.length - subLen) {
                    break;
                }
                let match = true;
                for (let j = 1; j < subLen; j++) {
                    if (arr[pos + j] !== sub[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    indices.push(pos);
                    pos += subLen; // Skip match length
                } else {
                    pos++;
                }
            }
            return indices;
        }

        const indices = findSubArrayIndices(uint8Array, delimiter);
        console.log(`[MHTMLParser] Found ${indices.length} boundaries in MHTML file.`);
        
        const parsedResources = [];

        for (let i = 0; i < indices.length - 1; i++) {
            const start = indices[i] + delimiter.length;
            const end = indices[i + 1];
            const partBuffer = uint8Array.subarray(start, end);

            // If part starts with '--', we reached the end of MIME parts
            if (partBuffer.length >= 2 && partBuffer[0] === 45 && partBuffer[1] === 45) { // '--'
                break;
            }

            // Find double newline separating headers from payload body (\r\n\r\n or \n\n)
            let doubleNewlineIndex = -1;
            let newlineLength = 4;
            
            // Fast scan for \r\n\r\n
            for (let j = 0; j < partBuffer.length - 3; j++) {
                if (partBuffer[j] === 13 && partBuffer[j+1] === 10 && partBuffer[j+2] === 13 && partBuffer[j+3] === 10) {
                    doubleNewlineIndex = j;
                    newlineLength = 4;
                    break;
                }
            }
            
            // Fallback scan for \n\n
            if (doubleNewlineIndex === -1) {
                for (let j = 0; j < partBuffer.length - 1; j++) {
                    if (partBuffer[j] === 10 && partBuffer[j+1] === 10) {
                        doubleNewlineIndex = j;
                        newlineLength = 2;
                        break;
                    }
                }
            }

            if (doubleNewlineIndex === -1) continue;

            const headersBuffer = partBuffer.subarray(0, doubleNewlineIndex);
            let bodyBuffer = partBuffer.subarray(doubleNewlineIndex + newlineLength);

            // Strip trailing CRLF/LF boundary character sequences
            if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 13 && bodyBuffer[bodyBuffer.length - 1] === 10) {
                bodyBuffer = bodyBuffer.subarray(0, bodyBuffer.length - 2);
            } else if (bodyBuffer.length >= 1 && bodyBuffer[bodyBuffer.length - 1] === 10) {
                bodyBuffer = bodyBuffer.subarray(0, bodyBuffer.length - 1);
            }

            // Parse MIME headers
            const headersStr = decoder.decode(headersBuffer);
            const headersList = headersStr.split(/\r?\n/);
            const headers = {};
            let currentHeaderName = null;
            
            for (const line of headersList) {
                if (line.startsWith(' ') || line.startsWith('\t')) {
                    if (currentHeaderName) {
                        headers[currentHeaderName] += ' ' + line.trim();
                    }
                } else {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex !== -1) {
                        const name = line.substring(0, colonIndex).trim().toLowerCase();
                        const value = line.substring(colonIndex + 1).trim();
                        headers[name] = value;
                        currentHeaderName = name;
                    }
                }
            }

            const loc = headers['content-location'];
            const ctypeRaw = headers['content-type'] || '';
            const ctype = ctypeRaw.split(';')[0].trim().toLowerCase();

            if (!loc) continue;

            // Decode body data
            const encoding = (headers['content-transfer-encoding'] || '').toLowerCase();
            let payloadBytes;
            if (encoding === 'base64') {
                const bodyStr = decoder.decode(bodyBuffer);
                try {
                    let binaryStr;
                    try {
                        // Modern browsers atob ignores spaces/newlines. Try happy path first.
                        binaryStr = atob(bodyStr);
                    } catch (e) {
                        binaryStr = atob(bodyStr.replace(/\s+/g, ''));
                    }
                    payloadBytes = new Uint8Array(binaryStr.length);
                    for (let b = 0; b < binaryStr.length; b++) {
                        payloadBytes[b] = binaryStr.charCodeAt(b);
                    }
                } catch(err) {
                    console.error("Base64 decode error on resource:", loc, err);
                    payloadBytes = bodyBuffer;
                }
            } else if (encoding === 'quoted-printable') {
                payloadBytes = decodeQuotedPrintableToUint8Array(bodyBuffer);
            } else {
                payloadBytes = bodyBuffer;
            }

            const blob = new Blob([payloadBytes], { type: ctype });

            // Parse Content-Location URL and build normalized path matching keys
            let parsedLoc;
            try {
                parsedLoc = new URL(loc);
            } catch (e) {
                try {
                    parsedLoc = new URL(loc, 'http://localhost');
                } catch (err) {
                    continue;
                }
            }
            
            const pathKey = parsedLoc.pathname;
            const unquotedPath = decodeURIComponent(pathKey);
            
            const queryKey = pathKey + (parsedLoc.search || '');
            const unquotedQueryKey = decodeURIComponent(queryKey);

            // Store inside local archive caches
            this.resources[pathKey] = { blob, contentType: ctype };
            this.resources[unquotedPath] = { blob, contentType: ctype };
            this.resources[queryKey] = { blob, contentType: ctype };
            this.resources[unquotedQueryKey] = { blob, contentType: ctype };

            // Queue for IndexedDB storage
            parsedResources.push({ path: pathKey, blob, contentType: ctype });
            if (unquotedPath !== pathKey) {
                parsedResources.push({ path: unquotedPath, blob, contentType: ctype });
            }
            if (queryKey !== pathKey) {
                parsedResources.push({ path: queryKey, blob, contentType: ctype });
            }
            if (unquotedQueryKey !== queryKey && unquotedQueryKey !== unquotedPath) {
                parsedResources.push({ path: unquotedQueryKey, blob, contentType: ctype });
            }

            // Setup location mapping for URL proxy routing
            const normPath = pathKey.startsWith('/') ? pathKey : '/' + pathKey;
            const querySuffix = parsedLoc.search || '';
            const normPathWithQuery = normPath + querySuffix;

            this.locationMappings.push({ original: loc, target: normPathWithQuery });
            if (parsedLoc.search) {
                const baseLoc = loc.split('?')[0];
                this.locationMappings.push({ original: baseLoc, target: normPath });
            }

            // Save the main HTML document if we encounter it
            if ((ctype === 'text/html' || ctypeRaw.includes('text/html')) && !this.html) {
                try {
                    this.html = new TextDecoder('utf-8').decode(payloadBytes);
                } catch (e) {
                    this.html = new TextDecoder('windows-1252').decode(payloadBytes);
                }
                this.mainLocation = pathKey;
            }
        }

        // Deduplicate and sort mappings by length descending
        const uniqueMappings = [];
        const seen = new Set();
        for (const mapping of this.locationMappings) {
            const key = `${mapping.original}||${mapping.target}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueMappings.push(mapping);
            }
        }
        uniqueMappings.sort((a, b) => b.original.length - a.original.length);
        this.locationMappings = uniqueMappings;

        console.log(`[MHTMLParser] Done. Main Location: ${this.mainLocation}. Extracted ${parsedResources.length} sub-resources.`);
        
        return {
            mainLocation: this.mainLocation,
            locationMappings: this.locationMappings,
            resources: parsedResources
        };
    }
}

/**
 * Decodes a Quoted-Printable encoded Uint8Array into raw bytes.
 * @param {Uint8Array} uint8Array 
 * @returns {Uint8Array}
 */
function decodeQuotedPrintableToUint8Array(uint8Array) {
    const len = uint8Array.length;
    const out = new Uint8Array(len); // Max possible size
    let outIdx = 0;
    let i = 0;

    const hexVal = (c) => {
        if (c >= 48 && c <= 57) return c - 48; // '0'-'9'
        if (c >= 65 && c <= 70) return c - 55; // 'A'-'F'
        if (c >= 97 && c <= 102) return c - 87; // 'a'-'f'
        return -1;
    };

    while (i < len) {
        if (uint8Array[i] === 61) { // '=' character
            if (i + 1 < len && uint8Array[i + 1] === 13) { // '\r'
                if (i + 2 < len && uint8Array[i + 2] === 10) { // '\n'
                    i += 3; // Skip soft line break "=\r\n"
                } else {
                    i += 2; // Skip "=\r"
                }
            } else if (i + 1 < len && uint8Array[i + 1] === 10) { // '\n'
                i += 2; // Skip soft line break "=\n"
            } else if (i + 2 < len) {
                const val1 = hexVal(uint8Array[i + 1]);
                const val2 = hexVal(uint8Array[i + 2]);
                if (val1 !== -1 && val2 !== -1) {
                    out[outIdx++] = (val1 << 4) | val2;
                    i += 3;
                } else {
                    out[outIdx++] = uint8Array[i];
                    i++;
                }
            } else {
                out[outIdx++] = uint8Array[i];
                i++;
            }
        } else {
            out[outIdx++] = uint8Array[i];
            i++;
        }
    }
    return out.subarray(0, outIdx);
}

// Exposed for Node-based tests only (see test/mhtmlParser.test.js); has no effect in the
// browser, where `module` is undefined and this file is loaded as a plain <script>.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MHTMLArchiveBrowser };
}
