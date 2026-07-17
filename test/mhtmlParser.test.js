// test/mhtmlParser.test.js
// Fixture-based coverage for the hand-rolled MHTML parsing logic, asserting the Node
// parser (mhtmlParser.js) and the browser parser (mhtmlParserBrowser.js) produce
// equivalent output for the same input — this is the drift the two parsers had
// (see IMPROVEMENTS.md) and previously had zero automated coverage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MHTMLArchive } = require('../mhtmlParser');
const { MHTMLArchiveBrowser } = require('../mhtmlParserBrowser');

const CRLF = '\r\n';
const BOUNDARY = 'TESTBOUNDARY001';

const HTML_BODY_RAW = `<html><head><link rel=3D"stylesheet" href=3D"https://example.com/style.c=${CRLF}ss"></head><body>Hello=E2=80=99s World</body></html>`;
const HTML_BODY_DECODED = `<html><head><link rel="stylesheet" href="https://example.com/style.css"></head><body>Hello’s World</body></html>`;
const CSS_BODY = 'body { color: red; }';
const IMG_BYTES = Buffer.from('FAKE-IMAGE-BYTES-FOR-TEST-FIXTURE', 'utf-8');

function buildFixture({ paddingBytes = 0 } = {}) {
    const padding = paddingBytes > 0
        ? [`X-Filler: ${'A'.repeat(paddingBytes)}`, '']
        : [];

    const headerPart = [
        'MIME-Version: 1.0',
        ...padding,
        `Content-Type: multipart/related; boundary="${BOUNDARY}"`,
        ''
    ].join(CRLF);

    const part1 = [
        `--${BOUNDARY}`,
        'Content-Type: text/html',
        'Content-Transfer-Encoding: quoted-printable',
        'Content-Location: https://example.com/page.html',
        '',
        HTML_BODY_RAW
    ].join(CRLF);

    const part2 = [
        `--${BOUNDARY}`,
        'Content-Type: text/css',
        'Content-Transfer-Encoding: quoted-printable',
        'Content-Location: https://example.com/style.css',
        '',
        CSS_BODY
    ].join(CRLF);

    const part3 = [
        `--${BOUNDARY}`,
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        'Content-Location: https://example.com/img/logo.png',
        '',
        IMG_BYTES.toString('base64')
    ].join(CRLF);

    const closing = `--${BOUNDARY}--`;

    return Buffer.from([headerPart, part1, part2, part3, closing].join(CRLF), 'utf-8');
}

function withTempFile(buffer, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhtml-test-'));
    const filePath = path.join(dir, 'fixture.mhtml');
    fs.writeFileSync(filePath, buffer);
    try {
        return fn(filePath);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('Node MHTMLArchive parses boundaries, decodes quoted-printable and base64, and resolves resources', () => {
    const buffer = buildFixture();
    withTempFile(buffer, (filePath) => {
        const archive = new MHTMLArchive(filePath);

        assert.equal(archive.mainLocation, '/page.html');
        assert.equal(archive.html, HTML_BODY_DECODED);

        const css = archive.getResource('/style.css');
        assert.equal(css.contentType, 'text/css');
        assert.equal(css.payload.toString('utf-8'), CSS_BODY);

        const img = archive.getResource('/img/logo.png');
        assert.equal(img.contentType, 'image/png');
        assert.equal(Buffer.compare(img.payload, IMG_BYTES), 0);

        const targets = archive.locationMappings.map(m => m.target).sort();
        assert.deepEqual(targets, ['/img/logo.png', '/page.html', '/style.css']);
    });
});

test('Node MHTMLArchive.getResource() suffix-matching fallback resolves paths that don\'t exactly match the stored key', () => {
    const buffer = buildFixture();
    withTempFile(buffer, (filePath) => {
        const archive = new MHTMLArchive(filePath);

        // "logo.png" is a suffix of the stored "/img/logo.png" key but not an exact match —
        // this only resolves via the fallback loop at the end of getResource().
        const result = archive.getResource('logo.png');
        assert.ok(result.payload, 'expected suffix-match fallback to resolve a resource');
        assert.equal(Buffer.compare(result.payload, IMG_BYTES), 0);
    });
});

test('Node MHTMLArchive falls back to treating the file as plain HTML when no boundary is present', () => {
    const buffer = Buffer.from('<html><body>No MHTML wrapper here</body></html>', 'utf-8');
    withTempFile(buffer, (filePath) => {
        const archive = new MHTMLArchive(filePath);
        assert.equal(archive.html, buffer.toString('utf-8'));
        assert.deepEqual(archive.locationMappings, []);
    });
});

test('Node MHTMLArchive finds the boundary even when declared beyond the old 5000-byte search window (regression: server/browser window drift)', () => {
    // Regression test for the drift where mhtmlParser.js searched only the first 5000
    // bytes for the boundary declaration while mhtmlParserBrowser.js searched 10000,
    // so a file with enough preceding header bytes parsed in the browser but silently
    // fell back to "plain HTML" (losing all sub-resources) on the Node/server path.
    const buffer = buildFixture({ paddingBytes: 6000 });
    assert.ok(buffer.length > 5000 && buffer.indexOf(`boundary="${BOUNDARY}"`) > 5000,
        'test fixture setup: boundary declaration must actually fall past byte 5000');

    withTempFile(buffer, (filePath) => {
        const archive = new MHTMLArchive(filePath);
        assert.equal(archive.mainLocation, '/page.html', 'boundary should still be found within the 10000-byte window');
        assert.equal(archive.html, HTML_BODY_DECODED);
    });
});

test('Browser MHTMLArchiveBrowser produces equivalent output to the Node parser for the same input', async () => {
    const buffer = buildFixture();
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const browserArchive = new MHTMLArchiveBrowser();
    const result = await browserArchive.parse(arrayBuffer, 'fixture.mhtml');

    assert.equal(result.mainLocation, '/page.html');
    assert.equal(browserArchive.html, HTML_BODY_DECODED);

    const targets = result.locationMappings.map(m => m.target).sort();
    assert.deepEqual(targets, ['/img/logo.png', '/page.html', '/style.css']);

    const cssResource = result.resources.find(r => r.path === '/style.css');
    assert.ok(cssResource, 'expected /style.css to be extracted');
    assert.equal(await cssResource.blob.text(), CSS_BODY);

    const imgResource = result.resources.find(r => r.path === '/img/logo.png');
    assert.ok(imgResource, 'expected /img/logo.png to be extracted');
    const imgArrayBuffer = await imgResource.blob.arrayBuffer();
    assert.equal(Buffer.compare(Buffer.from(imgArrayBuffer), IMG_BYTES), 0);
});

test('Browser MHTMLArchiveBrowser falls back to treating the file as plain HTML when no boundary is present', async () => {
    const html = '<html><body>No MHTML wrapper here</body></html>';
    const buffer = Buffer.from(html, 'utf-8');
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    const browserArchive = new MHTMLArchiveBrowser();
    const result = await browserArchive.parse(arrayBuffer, 'fixture.html');

    assert.equal(browserArchive.html, html);
    assert.deepEqual(result.locationMappings, []);
});
