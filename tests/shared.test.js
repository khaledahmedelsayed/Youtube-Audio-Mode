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

test('modeHint picks the hint for each auto-listen mode and list size', () => {
    const api = loadShared();
    const messages = {
        hintEverything: 'Every video starts as audio.',
        hintMyList: '{count} channels in your list.',
        hintMyListOne: '1 channel in your list.',
        hintMyListEmpty: 'Tap Always listen on a video to start your list.',
        hintNothing: 'Videos start as normal video.'
    };
    const t = key => messages[key];
    assert.equal(api.modeHint('always', 3, t), 'Every video starts as audio.');
    assert.equal(api.modeHint('off', 3, t), 'Videos start as normal video.');
    assert.equal(api.modeHint('filtered', 0, t), 'Tap Always listen on a video to start your list.');
    assert.equal(api.modeHint('filtered', 1, t), '1 channel in your list.');
    assert.equal(api.modeHint('filtered', 4, t), '4 channels in your list.');
});

test('summarizeStats adds this month only for the month range', () => {
    const api = loadShared();
    const statsLogs = { '2026-09-01': 600, '2026-09-28': 600, '2026-08-31': 1200, bad: 'x' };
    const activeLogs = { '2026-09-02': 900, '2026-07-01': 100 };
    const now = new Date('2026-09-28T12:00:00Z');
    assert.deepEqual(plain(api.summarizeStats(statsLogs, activeLogs, 'month', now)), {
        listenedSeconds: 1200,
        activeSeconds: 900,
        usage144: 15,
        usage720: 375,
        usage1080: 675,
        saved720: 360,
        saved1080: 660
    });
});

test('summarizeStats adds every day for the all range and handles missing logs', () => {
    const api = loadShared();
    const now = new Date('2026-09-28T12:00:00Z');
    const all = plain(api.summarizeStats({ '2026-09-01': 60, '2025-01-01': 60 }, { '2020-01-01': 5 }, 'all', now));
    assert.equal(all.listenedSeconds, 120);
    assert.equal(all.activeSeconds, 5);
    assert.equal(all.usage144, 1.5);
    assert.equal(all.saved1080, 66);
    const empty = plain(api.summarizeStats(undefined, null, 'all', now));
    assert.deepEqual(empty, {
        listenedSeconds: 0, activeSeconds: 0, usage144: 0, usage720: 0, usage1080: 0, saved720: 0, saved1080: 0
    });
});

test('formatDuration shows the two largest units', () => {
    const api = loadShared();
    const t = key => ({ timeH: 'h', timeM: 'm', timeS: 's' }[key]);
    assert.equal(api.formatDuration(0, t), '0s');
    assert.equal(api.formatDuration(59.9, t), '59s');
    assert.equal(api.formatDuration(125, t), '2m 5s');
    assert.equal(api.formatDuration(3 * 3600 + 7 * 60 + 9, t), '3h 7m');
    assert.equal(api.formatDuration(-5, t), '0s');
});

test('addKeyword trims, ignores empty text and dedupes without mutating', () => {
    const api = loadShared();
    const rules = {
        whitelist: {
            channels: [{ id: 'UC1', name: 'One', addedAt: 1 }],
            keywords: [{ keyword: 'Podcast', caseSensitive: false, addedAt: 2 }]
        }
    };
    const next = plain(api.addKeyword(rules, '  lofi  ', 99));
    assert.deepEqual(next.whitelist.keywords, [
        { keyword: 'Podcast', caseSensitive: false, addedAt: 2 },
        { keyword: 'lofi', caseSensitive: false, addedAt: 99 }
    ]);
    assert.deepEqual(next.whitelist.channels, rules.whitelist.channels);
    assert.equal(rules.whitelist.keywords.length, 1, 'input not mutated');
    assert.equal(plain(api.addKeyword(rules, 'PODCAST', 99)).whitelist.keywords.length, 1);
    assert.equal(plain(api.addKeyword(rules, '   ', 99)).whitelist.keywords.length, 1);
    assert.deepEqual(plain(api.addKeyword(undefined, 'news', 5)), {
        whitelist: { channels: [], keywords: [{ keyword: 'news', caseSensitive: false, addedAt: 5 }] }
    });
});

test('removeKeyword and removeChannel drop one entry without mutating', () => {
    const api = loadShared();
    const rules = {
        whitelist: {
            channels: [{ id: 'UC1', name: 'One', addedAt: 1 }, { id: 'UC2', name: 'Two', addedAt: 2 }],
            keywords: [{ keyword: 'Podcast', caseSensitive: false, addedAt: 3 }, { keyword: 'news', caseSensitive: false, addedAt: 4 }]
        }
    };
    const noKeyword = plain(api.removeKeyword(rules, 'Podcast'));
    assert.deepEqual(noKeyword.whitelist.keywords, [{ keyword: 'news', caseSensitive: false, addedAt: 4 }]);
    assert.equal(noKeyword.whitelist.channels.length, 2);

    const noChannel = plain(api.removeChannel(rules, 'UC1'));
    assert.deepEqual(noChannel.whitelist.channels, [{ id: 'UC2', name: 'Two', addedAt: 2 }]);
    assert.equal(noChannel.whitelist.keywords.length, 2);

    assert.equal(rules.whitelist.channels.length, 2, 'input not mutated');
    assert.equal(rules.whitelist.keywords.length, 2, 'input not mutated');
    assert.equal(plain(api.removeChannel(rules, 'missing')).whitelist.channels.length, 2);
});

test('import keeps showPlayerButton only as a boolean', () => {
    const api = loadShared();
    assert.ok(plain(api.SETTINGS_EXPORT_KEYS).includes('showPlayerButton'));
    const off = api.validateImportedSettings({ app: 'earmode', settings: { showPlayerButton: false } });
    assert.deepEqual(plain(off), { showPlayerButton: false });
    const text = api.validateImportedSettings({ app: 'earmode', settings: { showPlayerButton: 'no', language: 'en' } });
    assert.equal('showPlayerButton' in text, false);
});
