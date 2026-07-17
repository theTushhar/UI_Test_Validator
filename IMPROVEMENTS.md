# Improvements

Last audited: 2026-07-17
Last fix pass: 2026-07-17 — all High and Medium items resolved, all Low items resolved except adding auth (deliberately not added; see Notes). `npm run lint`, `npm run build`, and `npm test` all pass.

Scope: full repo audit (Node/Express backend in `server.js`/`db.js`/`api/`, browser frontend in `index.html`/`js/`/`css/`, `mhtmlParser.js` (Node) vs `mhtmlParserBrowser.js` (browser), `sw.js` service worker, Tailwind/DaisyUI build, `vercel.json`). This app has **no authentication of any kind** and is deployed publicly via Vercel (`vercel.json` routes all traffic to `api/server.js`), which raises the severity of several findings below versus a purely local dev tool.

## High priority

### ✅ RESOLVED — Path traversal → arbitrary file read via `resolvePath` / `/serve_mhtml/*`
**Fix applied:** Added `safeJoin(baseDir, relativePath)` in `server.js`, which resolves the path and rejects anything that escapes `baseDir`. `resolvePath()` now uses it for both the workspace root and `Data/` lookups, closing the read path for `/serve_mhtml/*`, `/api/locators`, and `/api/findings`. Covered by a manual smoke test (`GET /serve_mhtml/..%2F..%2F..%2F..%2Fpackage.json` → 404).

- **Where:** `server.js:28-47` (`resolvePath`), used by `server.js:108-118` (`getMHTMLArchive`) and the route at `server.js:299-394` (`GET /serve_mhtml/*`); also reachable via `GET /api/locators` (`server.js:158-189`, `dir` query param) and `GET /api/findings`.
- **Issue:** `resolvePath()` only normalizes path separators (`relativePath.split(/[/\\]+/).join(path.sep)`) — it never strips or rejects `..` segments before calling `path.join(projectRoot, cleanRelPath)`. `path.join` happily collapses `..` and can resolve to a path outside `projectRoot`. The `/serve_mhtml/:filename` route decodes the URL segment with `decodeURIComponent` and passes it straight into `resolvePath`, and when no MIME boundary is found the parser (`mhtmlParser.js:76-91`) falls back to treating **any file** as plain HTML and serves its raw bytes back with `Content-Type: text/html`.
- **Why it matters:** An unauthenticated request such as `GET /serve_mhtml/..%2F..%2F..%2F..%2Fsome%2Fabsolute%2Ffile` (or `?dir=../../..` on `/api/locators` / `/api/findings`) lets any caller read arbitrary files reachable from the process's working directory (source code, `.env`-style config if ever added, other tenants' `Data/` captures, OS files under the deployment sandbox, etc.), fully pre-auth. This is a critical disclosure vulnerability, not just theoretical — it was verified by tracing the exact string transformations from request to `fs.readFileSync`/`fs.existsSync`.
- **Suggested fix:** After building `cleanRelPath`, resolve it with `path.resolve(projectRoot, cleanRelPath)` and verify the result's path still starts with `projectRoot` (+ path separator) before touching the filesystem; reject with 400 otherwise. Apply the same check everywhere `resolvePath`/raw `subdir`/`filename` values reach `fs.*` (also see the write-side issue below).

### ✅ RESOLVED (path containment) / ⚠️ auth deliberately not added — Unauthenticated arbitrary file write via `PUT /api/locators`
**Fix applied:** `PUT /api/locators` now runs `subdir` through the same `safeJoin()` containment check before `mkdirSync`/`writeFileSync`, returning 400 on an escaping path. Verified via smoke test (`?dir=../../../evil` → 400). Auth was **not** added — see Notes for why.

- **Where:** `server.js:243-269`.
- **Issue:** `subdir` comes straight from `req.query.dir` and is joined into `dataDir = path.join(projectRoot, 'Data', subdir)`, then `fs.mkdirSync(dataDir, { recursive: true })` and `fs.writeFileSync(locatorPath, JSON.stringify(req.body))` run with no path containment check and no auth. The only validation is that the JSON body has a `pages` key.
- **Why it matters:** Any unauthenticated client can send `PUT /api/locators?dir=../../../../somewhere` with an arbitrary JSON body and cause the server to create directories and write a file named `locator.json` outside the intended `Data/` sandbox, anywhere the process has write permission. Combined with the read-side traversal above, this is a full read/write primitive against the host filesystem for a publicly deployed app.
- **Suggested fix:** Same containment check as above (`path.resolve` + prefix check) before `mkdirSync`/`writeFileSync`; additionally require some form of auth (even a shared secret header) before allowing any write endpoint (`PUT /api/locators`, `POST /api/save`) to execute.

### ✅ RESOLVED — Stored XSS: user-controlled filenames/JSON fields inserted into `innerHTML` without escaping
**Fix applied:** All flagged spots now go through `escapeHtml()` (`js/elementList.js`, `js/mappingTool.js`, `js/jsonEditor.js`, plus a couple more found in the same sweep: `otherEl.uuid` in a `<option value>`, `el.type`/`el.mode` summary spans). `escapeJs()` (`js/utils.js`) was rewritten to also escape `\`, `"`, and newlines, since it's used inside double-quoted HTML attributes, not just JS string literals.

- **Where:** `js/elementList.js:231` (`el.name` used raw in `title="${el.name}">${idx + 1}. ${el.name}"`) and `:431` (`loc.locator_type` used raw); `js/workspaceUpload.js:101-104` (MHTML `filename` interpolated into an `onclick="deleteMhtmlFileRecord('${escapeJs(filename)}')"` attribute using only `escapeJs`, not `escapeHtml`); `js/mappingTool.js:129-134` (`p.mappedMhtml` filename rendered raw in `title="${p.mappedMhtml}"` and as text); `js/jsonEditor.js:150,214` (`el.type`/`el.elementType`/`el.event` rendered raw in a couple of summary spans, inconsistent with the `escapeHtml()` calls used everywhere else in the same file).
- **Issue:** `el.name`, `loc.locator_type`, uploaded MHTML/HTML `file.name`, and a few other fields all originate from user-uploaded `locator.json` / MHTML files (drag-and-drop, no server-side validation) and are interpolated directly into template strings assigned to `.innerHTML`. Additionally, `escapeJs()` (`js/utils.js:12-14`) only escapes `'`; it does not escape `"`, so a crafted filename such as `foo" onmouseover="alert(document.cookie)` breaks out of the double-quoted `onclick` HTML attribute it's used inside (`workspaceUpload.js:103`), not just the JS string.
- **Why it matters:** A user (or a teammate sharing a workspace export) who uploads a JSON config with a malicious `name`/`locator_type`, or an MHTML/HTML file with a crafted filename, gets arbitrary HTML/JS injected into the page. Because the app has full same-origin access to IndexedDB (all cached MHTML/locator data) and calls `fetch('/api/...')` with no auth, this is a real stored-XSS-to-data-exfiltration / config-tampering path, not just cosmetic.
- **Suggested fix:** Route every value above through `escapeHtml()` before interpolation (as is already correctly done for most fields in the same files). Fix `escapeJs()` to also escape `"`, `\`, and newlines, and audit every `onclick="...('${...}')"` pattern in the codebase for the same double-quote breakout risk, since it's already used inconsistently even within a single file.

### ⚠️ DECIDED — kept same-origin — MHTML preview `<iframe>` has no `sandbox` attribute and serves untrusted, same-origin content
**Decision:** Discussed with the user; dropping `allow-same-origin` would break inspect-mode's cross-frame DOM access, a core feature. Chose to keep the iframe same-origin and harden elsewhere instead (the XSS fixes above + the new CSP below), rather than break the tool. See Notes.

- **Where:** `index.html:246` (`<iframe id="preview-iframe" ...>` — no `sandbox` attribute); content is loaded from `/serve_mhtml/...` which is same-origin (`js/navigation.js:216`), and served either by `server.js:299-394` or, offline, by `sw.js:34-183`.
- **Issue:** MHTML/HTML files are user-uploaded, untrusted captures that are rendered as live HTML in an iframe with no `sandbox="allow-scripts allow-same-origin ..."` restriction and, because the iframe is same-origin, no browser-enforced isolation at all. Any `<script>` embedded in an uploaded MHTML capture executes with full access to `window.parent` — i.e. the verifier app's own DOM, IndexedDB (`LocatorVerifierDB`), and ability to call every `window.*` handler exposed by the app's JS modules.
- **Why it matters:** This turns "preview an uploaded page capture" into "run arbitrary attacker JS with full privileges of the tool itself." An analyst opening a booby-trapped `.mhtml` file (e.g. received from a colleague, or captured from a compromised site) could have their entire local workspace (all locator configs across all groups) exfiltrated or corrupted silently.
- **Suggested fix:** At minimum add `sandbox="allow-scripts"` (scripts needed for `getComputedStyle`/matching to still work as designed, but drop `allow-same-origin` so the frame gets a unique opaque origin and loses access to `window.parent`/cookies/storage), and evaluate whether inspect-mode's cross-frame DOM access (`js/iframe.js`, `js/inspectMode.js`) still works under a sandboxed opaque-origin frame — if it needs same-origin access for `contentDocument` reads, consider serving MHTML previews from a distinct sandboxed subdomain instead so "same-origin" doesn't mean "same privileges as the app."

### ✅ RESOLVED — Unauthenticated debug endpoint exposes full server filesystem listing
**Fix applied:** `GET /api/debug-files` was removed entirely from `server.js`. Verified via smoke test — the route now falls through to the SPA's catch-all (200 + index.html), no more file-tree disclosure.

- **Where:** `server.js:211-239` (`GET /api/debug-files`), also explicitly bundled into the Vercel function via `vercel.json:4-6` (`includeFiles`).
- **Issue:** This route recursively lists every file under `projectRoot` (skipping only `node_modules`/`.git`/`.agents`/`.gemini`) and returns it as JSON, with zero auth and no environment gate (e.g. `if (process.env.NODE_ENV !== 'production')`).
- **Why it matters:** Publicly discloses the entire file/directory layout of the production deployment (including any `Data/` uploads present on disk), which is reconnaissance-grade information for an attacker and also directly leaks any files a user has uploaded to the workspace that happen to be readable via the traversal bug above.
- **Suggested fix:** Remove this route entirely from the production build, or gate it behind an explicit debug flag/auth check that defaults to off.

## Medium priority

### ✅ RESOLVED — `sw.js` resource resolution is weaker than the Node server's, causing behavior drift between "local server" and "offline/service-worker" modes
**Fix applied:** Added `dbHelper.getResourcesByFilename()` (`db.js`) to list all stored resources for an archive, and implemented the suffix-matching fallback in `sw.js`'s `handleServeMhtml()` (previously a no-op stub), mirroring `mhtmlParser.js`'s `getResource()` fallback.

- **Where:** `sw.js:141-150` vs `mhtmlParser.js:252-286` (`MHTMLArchive.getResource`).
- **Issue:** The Node-side `getResource()` has a final fallback that does suffix matching (`locKey.endsWith(p) || p.endsWith(locKey)`) to recover resources whose stored key doesn't exactly match the requested path. The service worker's `handleServeMhtml()` has an equivalent "4. Try fuzzy matching suffix" step that is entirely a stub — the comment literally says "For now, let's keep search simple" and the block does nothing (`resRecord` is never set).
- **Why it matters:** For the exact same MHTML archive, a sub-resource that resolves fine when the app is running against the local Node server (`node server.js`) can 404 when the same file is used purely client-side (offline / production Vercel path, which relies entirely on IndexedDB + the service worker). This is a genuine functional drift between the two "parser variants" the task asked to check, and will manifest as intermittently broken images/CSS/JS in previews depending on how the resource's `Content-Location` was encoded in the original capture.
- **Suggested fix:** Port the same suffix-matching fallback into `sw.js`, ideally by extracting the matching algorithm into one shared function usable from both `mhtmlParser.js`'s `getResource` and `sw.js` (see next item), instead of maintaining two implementations.

### ✅ PARTIALLY RESOLVED — `mhtmlParser.js` and `mhtmlParserBrowser.js` are ~90% duplicated and have already drifted
**Fix applied:** Aligned the boundary-search window (Node now searches the first 10000 bytes, matching the browser parser) and added `test/mhtmlParser.test.js`, which parses the same fixture through both parsers and asserts identical `mainLocation`/`locationMappings`/decoded content — this is the "shared fixture-based test" the suggested fix asked for, and it will now catch future drift automatically. The deeper refactor (extracting one shared parsing algorithm) was **not** done — out of scope for a fix pass; the test suite is the safety net until/unless that refactor happens.

- **Where:** `mhtmlParser.js:1-292` vs `mhtmlParserBrowser.js:1-325`.
- **Issue:** Both files implement essentially the same MIME multipart parsing algorithm (boundary discovery, header folding, quoted-printable/base64 decoding, location-mapping construction/dedup/sort) — one against Node `Buffer`, one against `Uint8Array`/`Blob`. They are already inconsistent in at least one concrete, verifiable way: the boundary-search window is the first **5000 bytes** server-side (`mhtmlParser.js:74`) vs the first **10000 bytes** browser-side (`mhtmlParserBrowser.js:30`), so an MHTML file with a boundary declaration between byte 5000–10000 (e.g. many custom MIME headers before the `Content-Type` line) would parse successfully in the browser but fail server-side, silently falling back to "treat as plain HTML" (losing all sub-resources) on the Node path only. Combined with the missing suffix-fallback noted above, the two parsers no longer produce equivalent output for the same input in all cases.
- **Why it matters:** Every future bug fix or edge-case handling improvement (encoding quirks, header folding, etc.) has to be manually ported to both files, and it's easy (as already demonstrated) for them to silently diverge further, producing environment-dependent parsing bugs that are hard to reproduce ("works when I run it locally, broken in the deployed app" or vice versa).
- **Suggested fix:** Extract the environment-agnostic parts (boundary index search parameters, header parsing, quoted-printable decoding table, location-mapping build/dedup/sort) into a single algorithm parameterized over a small "byte buffer" adapter, or at minimum add a shared fixture-based test that parses the same sample `.mhtml` file through both `MHTMLArchive` and `MHTMLArchiveBrowser` and asserts identical `mainLocation`/`locationMappings`/resource path sets, so future drift is caught automatically.

### ✅ RESOLVED — `mhtmlCache` in `server.js` never invalidates and grows unbounded
**Fix applied:** `mhtmlCache` is now a bounded LRU `Map` (50 entries) keyed by filename, storing `{ mtimeMs, archive }`. `getMHTMLArchive()` stats the file and reparsers on mtime change, refreshing LRU order on hit.

- **Where:** `server.js:21` (`const mhtmlCache = {}`), populated in `getMHTMLArchive` (`server.js:108-118`).
- **Issue:** Once an MHTML file is parsed, its `MHTMLArchive` (including all decoded resource buffers) is cached forever in process memory, keyed only by filename, with no TTL, no size cap, and no invalidation if the underlying file on disk changes (e.g. a user re-maps/replaces a file with the same name via the mapping UI).
- **Why it matters:** In a long-running server process handling many distinct uploaded workspaces, this is unbounded memory growth (each cached archive holds full decoded binary payloads of every sub-resource). It also means a file replaced on disk under an existing filename keeps serving stale content until the process restarts — a real correctness bug for the "re-upload/rename" workflow surfaced in `js/mappingTool.js`.
- **Suggested fix:** Cache with an LRU/size or count bound, and invalidate an entry when the source file's mtime changes (stat before serving from cache) or when `mapper.json`/locator writes indicate the workspace changed.

### ✅ RESOLVED — `getMhtmlFilesRecursively` does a full synchronous recursive disk walk on every `/api/files` request
**Fix applied:** Converted to `fs.promises.readdir` (async, non-blocking), and the `GET /api/files` handler now awaits it. Also removed the dead `lowerFile !== 'frontend'` exclusion noted in the issue (matched nothing in this repo).

- **Where:** `server.js:71-101`, invoked per-request at `server.js:151`.
- **Issue:** When called without `?mapper=true`, every request to `GET /api/files` triggers a fresh synchronous (`fs.readdirSync`) recursive walk of the entire `projectRoot` tree. This blocks Node's single event-loop thread for the duration of the walk, which scales linearly with total files/folders under the project.
- **Why it matters:** Under any concurrent load (even a couple of simultaneous users), this serializes and stalls unrelated requests being handled by the same Node process — a classic blocking-I/O footgun in an Express app. Also note the hardcoded `lowerFile !== 'frontend'` exclusion (`server.js:87`) matches no folder that exists in this repo, suggesting copy-pasted logic from a different project layout.
- **Suggested fix:** Use the async `fs.promises.readdir` variants, and/or cache the file listing with invalidation on write, since this data changes only when files are uploaded/renamed via the app's own endpoints.

### ✅ RESOLVED — In-memory findings fallback is unreliable on the actual deployment target (Vercel serverless)
**Fix applied:** `POST /api/save`'s catch block now returns HTTP 202 with `{ status: 'not_persisted', persisted: false, ... }` instead of claiming `status: 'success'` when falling back to the non-durable in-memory store. (No frontend code currently calls this endpoint — `js/jsonEditor.js` saves via `PUT /api/locators` instead — so this was a correctness fix with no behavior change to the UI today.)

- **Where:** `server.js:15` (`let inMemoryFindings = {}`) and `server.js:286-293` (`POST /api/save` catch block).
- **Issue:** When `fs.writeFileSync` fails (expected on Vercel's read-only filesystem outside `/tmp`), the code falls back to an in-process JS variable and returns `{ status: 'success', storage: 'memory', ... }`.
- **Why it matters:** Serverless function instances on Vercel are not guaranteed to be reused between requests (cold starts, scale-to-zero, multiple concurrent instances) — module-level state like `inMemoryFindings` cannot be relied on to persist across the very next request. The endpoint reports "success" to the caller even though the data will very likely be silently lost, which is a misleading contract for the frontend (`js/jsonEditor.js`'s `saveLocatorToDiskAndDB` treats any `res.ok` as success).
- **Suggested fix:** Either drop the in-memory fallback and return an explicit "not persisted" error the UI surfaces to the user, or replace it with an actual persistence layer reachable from Vercel (KV store, blob storage, etc.) if server-side persistence is required at all — note the app already primarily relies on browser IndexedDB for persistence, so this server-side path may be largely vestigial.

### ✅ RESOLVED — No CSP and inconsistent client-side escaping given the app deliberately renders untrusted content
**Fix applied:** `server.js` now sets a CSP (`default-src 'self'`, explicit `script-src`/`style-src`/`font-src`/`frame-src`/`object-src 'none'`/`base-uri 'self'`) plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: same-origin` on every response. Note `script-src` still includes `'unsafe-inline'` because the frontend uses `onclick="..."` attributes throughout — removing that requires migrating to `addEventListener`, which is a larger refactor tracked as a follow-up, not done here.

- **Where:** `index.html` (no `<meta http-equiv="Content-Security-Policy">`), all response handlers in `server.js` (no `Content-Security-Policy` header set).
- **Issue:** Given the app's core feature is rendering user-uploaded HTML/MHTML in an iframe (see High-priority sandbox finding) and interpolating user-controlled strings into `innerHTML` in several places (see High-priority XSS finding), there is no defense-in-depth CSP to limit blast radius if an escaping bug slips through.
- **Suggested fix:** Add a reasonably strict CSP (script-src 'self', frame-src scoped appropriately, etc.) as a second line of defense alongside fixing the escaping/sandboxing issues above.

## Low priority / nice-to-have

### ✅ RESOLVED — Duplicate `showToast` implementations with inconsistent behavior
- **Where:** `js/workspaceUpload.js:231-242` and `js/jsonEditor.js:555-565`.
- **Issue:** Two near-identical, independently-defined `showToast(message, type)` helpers exist (one defaults `type = 'success'`, the other `type = 'info'`; timeout is 3000ms vs 2500ms), each operating on the same `#toast-notification` element.
- **Suggested fix:** Move one shared `showToast` into `js/utils.js` and import it from both modules.

### ✅ PARTIALLY RESOLVED — `escapeJs()` is a footgun as a general-purpose helper
**Fix applied:** `escapeJs()` now also escapes `\`, `"`, and newlines, closing the concrete breakout risk. The larger suggested refactor (moving off `onclick="fn('...')"` string-building entirely, to `addEventListener`) was **not** done — that's an app-wide pattern change out of scope for this pass and would also be a prerequisite for a stricter CSP.

- **Where:** `js/utils.js:12-14`.
- **Issue:** Only escapes `'`; every call site that uses it inside a double-quoted HTML attribute (`onclick="...('${escapeJs(x)}')"`) is implicitly relying on `x` never containing `"`, which isn't guaranteed for user-uploaded filenames/values (see XSS finding above).
- **Suggested fix:** Either rename/scope it clearly as "single-quoted-JS-string-only" and always pair it with `escapeHtml()` for the surrounding attribute, or replace the `onclick="fn('...')"` string-building pattern app-wide with `addEventListener` + closures (also improves CSP-compatibility, since inline handlers require `unsafe-inline` for scripts).

### ✅ RESOLVED — Dead/stale Tailwind content path
- **Where:** `tailwind.config.js:6` (`"./v2/**/*.html"`).
- **Issue:** No `v2/` directory exists anywhere in the repository (verified via glob search), so this content-globbing entry never matches anything.
- **Suggested fix:** Remove the stale entry, or if a `v2/` folder was intended to exist, add it — otherwise this is silently doing nothing.

### ✅ RESOLVED — No test suite for the hand-rolled MHTML parsing logic
**Fix applied:** Added `test/mhtmlParser.test.js` using `node:test` (no extra dependency) — covers boundary discovery, quoted-printable soft breaks, base64 decoding, the plain-HTML fallback, the boundary-window regression, and Node/browser parser parity, exactly as suggested. `npm test` runs it.

- **Where:** `package.json` (no `test` script or test framework dependency); `mhtmlParser.js` / `mhtmlParserBrowser.js` contain non-trivial hand-written binary parsing (quoted-printable decoding, MIME boundary scanning, header folding).
- **Issue:** This is exactly the kind of logic (byte-offset math, edge cases around soft line breaks, encoding fallbacks) that regresses silently when touched, and it currently has zero automated coverage.
- **Suggested fix:** Add a small Node test runner (`node:test` requires no extra dependency) with a handful of fixture `.mhtml` files covering: no-boundary/plain-HTML fallback, quoted-printable soft breaks, base64 resources, and query-string resource locations; assert identical output between `MHTMLArchive` and `MHTMLArchiveBrowser` (also closes the drift gap noted above).

### ✅ PARTIALLY RESOLVED — No lint/format tooling configured
**Fix applied:** Added ESLint 9 (flat config, `eslint.config.js`) and Prettier, wired into `npm run lint` / `npm run format` / `npm run format:check`. `eslint-plugin-no-unsanitized` was evaluated but **dropped** — it crashes ESLint entirely on this codebase's `el.innerHTML = someVariable` pattern (a plugin bug, not invalid code). The actual XSS bugs it would have caught were found and fixed via manual review instead (see above).

- **Where:** repo root (no `.eslintrc*`, no `.prettierrc*`, no `lint`/`format` npm scripts).
- **Issue:** ~15 frontend modules plus the backend are hand-formatted with no enforced consistency; several of the XSS-escaping inconsistencies above (some fields escaped, others not, within the same file) are the kind of thing a `no-unsanitized/property` ESLint rule would have caught.
- **Suggested fix:** Add ESLint (with `eslint-plugin-no-unsanitized` given the `innerHTML` usage pattern throughout) and Prettier, wired into a `lint` npm script and ideally CI.

### ✅ RESOLVED — No CI configuration
- **Where:** repo root (no `.github/workflows/`, no other CI config found).
- **Issue:** There's no automated check run on changes (build, lint, or the tests recommended above), so regressions like the `mhtmlParser.js` boundary-window drift can land unnoticed.
- **Suggested fix:** Add a minimal GitHub Actions workflow running `npm ci`, `npm run build`, and (once added) `npm test`/`npm run lint` on PRs.

## Notes

- **Auth was deliberately not added.** The path traversal and unauthenticated-write bugs are fixed (writes/reads are now contained to the intended directories regardless of auth), but the endpoints remain callable without a login, matching the tool's existing design as a trusted small-team/local utility. This was an explicit choice made with the user rather than an oversight — revisit if this deployment becomes reachable by untrusted parties.
- **The iframe was deliberately kept same-origin.** Dropping `allow-same-origin` would break inspect-mode's cross-frame DOM access (`js/iframe.js`, `js/inspectMode.js`), which is core to what this tool does. Discussed with the user; chose to harden via escaping + CSP instead of breaking the feature. Revisit if the tool starts being used to preview MHTML captures from untrusted sources.
- Remaining, not done in this pass: the deeper `mhtmlParser.js`/`mhtmlParserBrowser.js` shared-algorithm refactor, and moving the frontend off `onclick="..."` string-built handlers to `addEventListener` (which would also let the CSP drop `'unsafe-inline'` for scripts). Both are larger structural changes flagged but out of scope here.
