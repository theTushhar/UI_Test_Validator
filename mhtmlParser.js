const fs = require('fs');
const path = require('path');

/**
 * Decodes a Quoted-Printable encoded buffer into a raw Buffer.
 * Hand-coded to prevent encoding errors on binary resources and support UTF-8 characters.
 * @param {Buffer} input 
 * @returns {Buffer}
 */
function decodeQuotedPrintableToBuffer(input) {
    const len = input.length;
    const out = Buffer.allocUnsafe(len);
    let outIdx = 0;
    let i = 0;

    const hexVal = (c) => {
        if (c >= 48 && c <= 57) return c - 48; // '0'-'9'
        if (c >= 65 && c <= 70) return c - 55; // 'A'-'F'
        if (c >= 97 && c <= 102) return c - 87; // 'a'-'f'
        return -1;
    };

    while (i < len) {
        if (input[i] === 61) { // '=' character
            if (i + 1 < len && input[i + 1] === 13) { // '\r'
                if (i + 2 < len && input[i + 2] === 10) { // '\n'
                    i += 3; // Skip soft line break "=\r\n"
                } else {
                    i += 2; // Skip "=\r"
                }
            } else if (i + 1 < len && input[i + 1] === 10) { // '\n'
                i += 2; // Skip soft line break "=\n"
            } else if (i + 2 < len) {
                const val1 = hexVal(input[i + 1]);
                const val2 = hexVal(input[i + 2]);
                if (val1 !== -1 && val2 !== -1) {
                    out[outIdx++] = (val1 << 4) | val2;
                    i += 3;
                } else {
                    out[outIdx++] = input[i];
                    i++;
                }
            } else {
                out[outIdx++] = input[i];
                i++;
            }
        } else {
            out[outIdx++] = input[i];
            i++;
        }
    }
    return out.subarray(0, outIdx);
}

class MHTMLArchive {
    constructor(filepath) {
        this.resources = {};
        this.contentTypeMap = {};
        this.html = "";
        this.mainLocation = "";
        this.locationMappings = [];

        console.log(`[MHTMLParser] Parsing MHTML file: ${filepath}...`);
        
        let fileBuffer;
        try {
            fileBuffer = fs.readFileSync(filepath);
        } catch (e) {
            console.error(`[MHTMLParser] Error reading MHTML file:`, e);
            return;
        }

        // Find the boundary defined in the Content-Type header of the file
        const headerStr = fileBuffer.toString('utf-8', 0, Math.min(fileBuffer.length, 5000));
        const boundaryMatch = headerStr.match(/boundary="?([^"\s;]+)"?/i) || headerStr.match(/boundary=([^\s;]+)/i);
        if (!boundaryMatch) {
            console.log(`[MHTMLParser] Could not find boundary in file: ${filepath}. Treating as plain HTML.`);
            const baseName = path.basename(filepath);
            const pathKey = '/' + baseName;
            this.resources[pathKey] = fileBuffer;
            this.contentTypeMap[pathKey] = 'text/html';
            this.mainLocation = pathKey;
            
            try {
                this.html = fileBuffer.toString('utf-8');
            } catch (e) {
                this.html = fileBuffer.toString('latin1');
            }
            this.locationMappings = [];
            return;
        }
        
        const boundary = boundaryMatch[1];
        const delimiter = Buffer.from('--' + boundary);

        // Find all indices of the delimiter in the MHTML file
        const indices = [];
        let pos = fileBuffer.indexOf(delimiter, 0);
        while (pos !== -1) {
            indices.push(pos);
            pos = fileBuffer.indexOf(delimiter, pos + delimiter.length);
        }

        console.log(`[MHTMLParser] Found ${indices.length} boundaries in MHTML file.`);

        for (let i = 0; i < indices.length - 1; i++) {
            const start = indices[i] + delimiter.length;
            const end = indices[i + 1];
            const partBuffer = fileBuffer.subarray(start, end);

            // Check if this part marks the end of the multipart section (begins with '--')
            if (partBuffer.length >= 2 && partBuffer[0] === 45 && partBuffer[1] === 45) { // '--'
                break;
            }

            // Find double newline separating headers from the body in this MIME part
            let doubleNewlineIndex = partBuffer.indexOf('\r\n\r\n');
            let newlineLength = 4;
            if (doubleNewlineIndex === -1) {
                doubleNewlineIndex = partBuffer.indexOf('\n\n');
                newlineLength = 2;
            }
            if (doubleNewlineIndex === -1) {
                continue;
            }

            const headersBuffer = partBuffer.subarray(0, doubleNewlineIndex);
            let bodyBuffer = partBuffer.subarray(doubleNewlineIndex + newlineLength);

            // Strip the preceding CRLF/LF boundary prefix from the body
            if (bodyBuffer.length >= 2 && bodyBuffer[bodyBuffer.length - 2] === 13 && bodyBuffer[bodyBuffer.length - 1] === 10) {
                bodyBuffer = bodyBuffer.subarray(0, bodyBuffer.length - 2);
            } else if (bodyBuffer.length >= 1 && bodyBuffer[bodyBuffer.length - 1] === 10) {
                bodyBuffer = bodyBuffer.subarray(0, bodyBuffer.length - 1);
            }

            // Parse headers
            const headersStr = headersBuffer.toString('utf-8');
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

            if (!loc) {
                continue;
            }

            // Decode body payload
            const encoding = (headers['content-transfer-encoding'] || '').toLowerCase();
            let payload;
            if (encoding === 'base64') {
                // Node's Buffer.from ignores whitespace automatically when decoding base64
                payload = Buffer.from(bodyBuffer.toString('ascii'), 'base64');
            } else if (encoding === 'quoted-printable') {
                payload = decodeQuotedPrintableToBuffer(bodyBuffer);
            } else {
                payload = bodyBuffer;
            }

            // Parse the Content-Location URL and build normalized path matching keys
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

            this.resources[pathKey] = payload;
            this.contentTypeMap[pathKey] = ctype;

            this.resources[unquotedPath] = payload;
            this.contentTypeMap[unquotedPath] = ctype;

            const queryKey = pathKey + (parsedLoc.search || '');
            const unquotedQueryKey = decodeURIComponent(queryKey);

            this.resources[queryKey] = payload;
            this.contentTypeMap[queryKey] = ctype;

            this.resources[unquotedQueryKey] = payload;
            this.contentTypeMap[unquotedQueryKey] = ctype;

            // Prepare location mappings for dynamic proxy rewrite
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
                    this.html = payload.toString('utf-8');
                } catch (e) {
                    this.html = payload.toString('latin1');
                }
                this.mainLocation = pathKey;
            }
        }

        // Deduplicate and sort mappings by length descending to prevent partial word/prefix replaces
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

        console.log(`[MHTMLParser] Done. Main Location: ${this.mainLocation}. Parsed ${Object.keys(this.resources).length} resources.`);
    }

    /**
     * Retrieve a matching resource payload and Content-Type by searching paths
     * @param {string} requestedPathWithQuery 
     * @returns {{payload: Buffer|null, contentType: string|null}}
     */
    getResource(requestedPathWithQuery) {
        const unquoted = decodeURIComponent(requestedPathWithQuery);
        const keysToTry = [requestedPathWithQuery, unquoted];
        
        for (const k of keysToTry) {
            if (this.resources[k] !== undefined) {
                return { payload: this.resources[k], contentType: this.contentTypeMap[k] };
            }
        }

        let parsed;
        try {
            parsed = new URL(requestedPathWithQuery, 'http://localhost');
        } catch (e) {
            return { payload: null, contentType: null };
        }
        const pathname = parsed.pathname;
        const unquotedPath = decodeURIComponent(pathname);

        for (const p of [pathname, unquotedPath]) {
            if (this.resources[p] !== undefined) {
                return { payload: this.resources[p], contentType: this.contentTypeMap[p] };
            }
        }

        for (const p of [pathname, unquotedPath]) {
            for (const locKey in this.resources) {
                if (locKey.endsWith(p) || p.endsWith(locKey)) {
                    return { payload: this.resources[locKey], contentType: this.contentTypeMap[locKey] };
                }
            }
        }

        return { payload: null, contentType: null };
    }
}

module.exports = {
    MHTMLArchive
};
