const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Values from the vm context come from another realm; normalize before deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));

function loadShared() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
    const context = {
        console: { log() {}, error() {}, warn() {} },
        chrome: {
            i18n: { getMessage: name => `i18n:${name}` },
            runtime: { getURL: p => `chrome-extension://test/${p}` }
        },
        fetch: async () => ({ json: async () => ({ hello: { message: 'Hola' } }) })
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    return context.Earmode;
}

test('exposes Earmode on globalThis with expected helpers', () => {
    const api = loadShared();
    assert.ok(api);
    for (const name of ['t', 'loadMessages', 'getDefaultFilterRules', 'sanitizeFilterRules',
        'validateImportedSettings', 'buildExportPayload', 'exportFileName']) {
        assert.equal(typeof api[name], 'function', name);
    }
    assert.ok(plain(api.SETTINGS_EXPORT_KEYS).includes('playerLook'));
    assert.deepEqual(plain(api.PLAYER_LOOKS), ['card', 'blur', 'minimal', 'waves']);
});

test('t falls back to chrome.i18n then uses loaded messages', async () => {
    const api = loadShared();
    assert.equal(api.t('hello'), 'i18n:hello');
    await api.loadMessages('es');
    assert.equal(api.t('hello'), 'Hola');
    assert.equal(api.getLanguage(), 'es');
});

test('import accepts an old youtube-audio-mode file', () => {
    const api = loadShared();
    const settings = api.validateImportedSettings({
        app: 'youtube-audio-mode',
        version: 1,
        settings: { audioModeType: 'filtered', preferredQuality: 'hd720' }
    });
    assert.deepEqual(plain(settings), { audioModeType: 'filtered', preferredQuality: 'hd720' });
});

test('import accepts earmode and missing app ids', () => {
    const api = loadShared();
    assert.deepEqual(plain(api.validateImportedSettings({ app: 'earmode', settings: { language: 'ar' } })), { language: 'ar' });
    assert.deepEqual(plain(api.validateImportedSettings({ settings: { language: 'en' } })), { language: 'en' });
    assert.deepEqual(plain(api.validateImportedSettings({ language: 'en' })), { language: 'en' });
});

test('import rejects an unknown app id', () => {
    const api = loadShared();
    assert.throws(() => api.validateImportedSettings({ app: 'something-else', settings: { language: 'en' } }));
});

test('import keeps only known player looks', () => {
    const api = loadShared();
    const bars = api.validateImportedSettings({ app: 'earmode', settings: { playerLook: 'bars', language: 'en' } });
    assert.equal('playerLook' in bars, false);
    const waves = api.validateImportedSettings({ app: 'earmode', settings: { playerLook: 'waves' } });
    assert.deepEqual(plain(waves), { playerLook: 'waves' });
});

test('export payload uses the earmode app id and includes playerLook', () => {
    const api = loadShared();
    const payload = plain(api.buildExportPayload({ playerLook: 'blur', audioModeType: 'always' }));
    assert.equal(payload.app, 'earmode');
    assert.equal(payload.version, 1);
    assert.equal(typeof payload.exportedAt, 'string');
    assert.equal(payload.settings.playerLook, 'blur');
    assert.ok(plain(api.SETTINGS_EXPORT_KEYS).includes('playerLook'));
});

test('export filename follows earmode-settings-YYYY-MM-DD.json', () => {
    const api = loadShared();
    assert.match(api.exportFileName(), /^earmode-settings-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(api.exportFileName(new Date('2026-09-28T12:00:00Z')), 'earmode-settings-2026-09-28.json');
});
