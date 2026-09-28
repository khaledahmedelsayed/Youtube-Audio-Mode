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

test('sanitizeFilterRules dedupes channels by id and keywords case-insensitively after trimming', () => {
    const api = loadShared();
    const rules = plain(api.sanitizeFilterRules({
        whitelist: {
            channels: [
                { id: ' UC1 ', name: ' One ', addedAt: 5 },
                { id: 'UC1', name: 'Dup', addedAt: 6 },
                { id: 'UC2', name: '', addedAt: 7 },
                { id: '', name: 'No id' },
                null,
                'junk'
            ],
            keywords: [
                { keyword: '  Podcast ', addedAt: 1 },
                { keyword: 'podcast', addedAt: 2 },
                { keyword: 'PODCAST  ', addedAt: 3 },
                { keyword: '   ' },
                { keyword: 'Talk', caseSensitive: true, addedAt: 4 }
            ]
        }
    }));
    assert.deepEqual(rules.whitelist.channels, [
        { id: 'UC1', name: 'One', addedAt: 5 },
        { id: 'UC2', name: 'UC2', addedAt: 7 }
    ]);
    assert.deepEqual(rules.whitelist.keywords, [
        { keyword: 'Podcast', caseSensitive: false, addedAt: 1 },
        { keyword: 'Talk', caseSensitive: true, addedAt: 4 }
    ]);
});

test('sanitizeFilterRules returns empty lists for bad input', () => {
    const api = loadShared();
    assert.deepEqual(plain(api.sanitizeFilterRules(null)), { whitelist: { channels: [], keywords: [] } });
    assert.deepEqual(plain(api.sanitizeFilterRules({ whitelist: 'x' })), { whitelist: { channels: [], keywords: [] } });
});

test('sumMonthSeconds adds only the current month', () => {
    const api = loadShared();
    const logs = { '2026-09-01': 60, '2026-09-28': 120, '2026-08-31': 999, '2025-09-10': 50, '2026-09-15': 'x' };
    assert.equal(api.sumMonthSeconds(logs, new Date('2026-09-28T12:00:00Z')), 180);
    assert.equal(api.sumMonthSeconds(null, new Date('2026-09-28T12:00:00Z')), 0);
});

test('savedMegabytes uses 720p minus 144p rate', () => {
    const api = loadShared();
    assert.equal(api.savedMegabytes(0), 0);
    assert.equal(api.savedMegabytes(600), 180); // 10 minutes * 18 MB
});

test('formatSavedAmount shows MB below 1024 and GB with one decimal above', () => {
    const api = loadShared();
    const t = key => ({ unitGB: ' GB', unitMB: ' MB' }[key]);
    assert.equal(api.formatSavedAmount(0, t), '0 MB');
    assert.equal(api.formatSavedAmount(512.6, t), '513 MB');
    assert.equal(api.formatSavedAmount(1023.4, t), '1023 MB');
    assert.equal(api.formatSavedAmount(1024, t), '1.0 GB');
    assert.equal(api.formatSavedAmount(2355, t), '2.3 GB');
});

test('videoChannels dedupes the channel list and falls back to the primary channel', () => {
    const api = loadShared();
    assert.deepEqual(plain(api.videoChannels({
        channelId: 'UC1', channelName: 'One',
        channels: [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }, { id: 'UC1', name: 'One again' }, { name: 'no id' }]
    })), [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }]);
    assert.deepEqual(plain(api.videoChannels({ channelId: 'UC9', channelName: 'Nine', channels: [] })), [{ id: 'UC9', name: 'Nine' }]);
    assert.deepEqual(plain(api.videoChannels(null)), []);
});

test('channelsInList is true only when every channel is saved', () => {
    const api = loadShared();
    const rules = { whitelist: { channels: [{ id: 'UC1', name: 'One', addedAt: 1 }], keywords: [] } };
    assert.equal(api.channelsInList(rules, [{ id: 'UC1', name: 'One' }]), true);
    assert.equal(api.channelsInList(rules, [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }]), false);
    assert.equal(api.channelsInList(rules, []), false);
    assert.equal(api.channelsInList(undefined, [{ id: 'UC1', name: 'One' }]), false);
});

test('toggleChannels adds missing channels when not all are in the list', () => {
    const api = loadShared();
    const rules = {
        whitelist: {
            channels: [{ id: 'UC1', name: 'One', addedAt: 1 }],
            keywords: [{ keyword: 'news', caseSensitive: false, addedAt: 2 }]
        }
    };
    const next = plain(api.toggleChannels(rules, [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }], 500));
    assert.deepEqual(next.whitelist.channels, [
        { id: 'UC1', name: 'One', addedAt: 1 },
        { id: 'UC2', name: 'Two', addedAt: 500 }
    ]);
    assert.deepEqual(next.whitelist.keywords, rules.whitelist.keywords);
    assert.equal(rules.whitelist.channels.length, 1, 'input not mutated');
});

test('toggleChannels removes all channels when all are in the list', () => {
    const api = loadShared();
    const rules = {
        whitelist: {
            channels: [{ id: 'UC1', name: 'One', addedAt: 1 }, { id: 'UC2', name: 'Two', addedAt: 2 }, { id: 'UC3', name: 'Three', addedAt: 3 }],
            keywords: []
        }
    };
    const next = plain(api.toggleChannels(rules, [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }], 500));
    assert.deepEqual(next.whitelist.channels, [{ id: 'UC3', name: 'Three', addedAt: 3 }]);
});

test('toggleChannels works from empty rules', () => {
    const api = loadShared();
    const next = plain(api.toggleChannels(undefined, [{ id: 'UC1', name: 'One' }], 42));
    assert.deepEqual(next, { whitelist: { channels: [{ id: 'UC1', name: 'One', addedAt: 42 }], keywords: [] } });
});

test('fillTemplate replaces named placeholders', () => {
    const api = loadShared();
    assert.equal(api.fillTemplate('{count} channels in your list.', { count: 3 }), '3 channels in your list.');
    assert.equal(api.fillTemplate('Saved {amount} this month', { amount: '2.3 GB' }), 'Saved 2.3 GB this month');
    assert.equal(api.fillTemplate('No {missing}', {}), 'No {missing}');
});
