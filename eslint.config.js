const globals = require('globals');

// Shared globals for anything that ends up loaded into the browser page (this app's
// modules reach across files via classic <script> globals like `dbHelper`, not imports).
const browserAppGlobals = {
    ...globals.browser,
    dbHelper: 'readonly',
    MHTMLArchiveBrowser: 'readonly',
};

module.exports = [
    {
        ignores: ['node_modules/**', 'css/dist/**'],
    },

    // Node/CommonJS backend + root config files
    {
        files: ['server.js', 'db.js', 'mhtmlParser.js', 'api/**/*.js', '*.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },

    // db.js is dual-loaded: as a classic <script> in the browser page AND via
    // importScripts() in sw.js, so it needs both sets of globals.
    {
        files: ['db.js'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser, ...globals.serviceworker },
        },
    },

    // Browser parser: loaded as a classic <script>, but also require()'d from Node tests
    // via a guarded `typeof module !== 'undefined'` export — needs `module` as a global too.
    {
        files: ['mhtmlParserBrowser.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...globals.browser, module: 'readonly' },
        },
    },

    // Service worker
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...globals.serviceworker, dbHelper: 'readonly' },
        },
    },

    // Baseline rules everywhere
    {
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
            'no-undef': 'error',
        },
    },

    // Frontend ES modules.
    // Note: eslint-plugin-no-unsanitized (suggested in IMPROVEMENTS.md to catch raw
    // innerHTML assignments) was evaluated but crashes ESLint entirely on this codebase's
    // `el.innerHTML = someVariable` pattern (a plugin bug, not invalid code — see
    // https://github.com/mozilla/eslint-plugin-no-unsanitized), so it was dropped rather
    // than ship a linter that can't run. The actual XSS bugs it would have flagged were
    // found and fixed via manual review instead (see IMPROVEMENTS.md).
    //
    // `no-undef` is 'warn' here (not 'error' like elsewhere): every module attaches its
    // public functions via `window.fn = fn` at the bottom of the file and other modules/
    // inline HTML onclick="..." handlers call them as bare identifiers, which resolves
    // correctly at runtime (unqualified names fall through to the global object) but isn't
    // statically visible to ESLint without hand-listing every one of those names as a global.
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: browserAppGlobals,
        },
        rules: {
            'no-undef': 'warn',
        },
    },

    // Node test files
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },
];
