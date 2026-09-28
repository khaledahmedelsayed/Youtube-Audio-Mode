const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, loadContentScript } = require('./helpers/load-content');

// Values from the vm context come from another realm; normalize before deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));

test('decideAudio: override wins over every mode', () => {
    const api = loadContentScript(createTimers());
    assert.deepEqual(plain(api.decideAudio({ override: true, mode: 'off', inList: false })), { audio: true, reason: 'manual' });
    assert.deepEqual(plain(api.decideAudio({ override: false, mode: 'always', inList: true })), { audio: false, reason: 'manual' });
});

test('decideAudio: auto modes', () => {
    const api = loadContentScript(createTimers());
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'always', inList: false })), { audio: true, reason: 'all' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'off', inList: true })), { audio: false, reason: 'none' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'filtered', inList: true })), { audio: true, reason: 'inList' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'filtered', inList: false })), { audio: false, reason: 'notInList' });
});

test('setVideoAudio sets an override for the current video only', () => {
    const api = loadContentScript(createTimers());
    assert.equal(api.getEarmodeStatus().override, null);

    api.setVideoAudio(true);
    assert.equal(api.getEarmodeStatus().override, true);

    api.setSearchForTest('?v=other');
    assert.equal(api.getEarmodeStatus().override, null);
});

test('clearOverride returns the video to auto', () => {
    const api = loadContentScript(createTimers());
    api.setVideoAudio(false);
    assert.equal(api.getEarmodeStatus().override, false);

    api.clearOverride();
    assert.equal(api.getEarmodeStatus().override, null);
});

test('getEarmodeStatus reports page, audio, reason and mode', () => {
    const api = loadContentScript(createTimers());
    const status = plain(api.getEarmodeStatus());
    assert.equal(status.onVideo, true);
    assert.equal(status.audio, false);
    assert.equal(status.reason, 'none');
    assert.equal(typeof status.mode, 'string');
    assert.equal(status.override, null);
});

// Drain timers and the promise continuations they unblock.
async function settle(timers, rounds = 20) {
    for (let i = 0; i < rounds; i++) {
        timers.runAll();
        await new Promise(resolve => setImmediate(resolve));
    }
}

test('manual switch turns audio on in off mode', async () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    api.stubAudioPathsForTest();
    api.setModeForTest('off');

    api.setVideoAudio(true);
    await settle(timers);

    const status = plain(api.getEarmodeStatus());
    assert.equal(status.audio, true);
    assert.equal(status.reason, 'manual');
});

test('manual switch turns audio off in always mode, clearOverride returns to auto', async () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    api.stubAudioPathsForTest();
    api.setModeForTest('always');

    api.setVideoAudio(false);
    await settle(timers);
    let status = plain(api.getEarmodeStatus());
    assert.equal(status.audio, false);
    assert.equal(status.reason, 'manual');

    api.clearOverride();
    await settle(timers);
    status = plain(api.getEarmodeStatus());
    assert.equal(status.audio, true);
    assert.equal(status.reason, 'all');
});

test('applyDecision re-applies lowest quality when audio is already on', () => {
    const api = loadContentScript(createTimers());
    const calls = api.stubAudioPathsForTest();
    api.setAudioModeEnabled(true);

    api.applyDecision({ audio: true });

    assert.deepEqual(Array.from(calls, call => call.name), ['lowest']);
});

test('setVideoAudio is ignored off a video page', () => {
    const api = loadContentScript(createTimers());
    api.setSearchForTest('');

    api.setVideoAudio(true);

    assert.equal(api.getEarmodeStatus().override, null);
});

test('filtered mode without video info falls back to preferred quality', async () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const calls = api.stubAudioPathsForTest();
    // applyFilteredMode bails out when the extension context is gone.
    api.setRuntimeIdForTest('test-extension');
    api.setModeForTest('filtered');

    api.applyFilteredMode();
    await settle(timers, 40);

    assert.equal(api.getEarmodeStatus().reason, 'notInList');
    assert.deepEqual(Array.from(calls, call => call.name), ['preferred']);
});

test('enableAudioMode retry keeps the fromAutoRule flag', () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    api.setDocumentForTest({
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null
    });

    api.enableAudioMode(true);
    const retries = [];
    api.replaceEnableAudioModeForTest((...args) => retries.push(args));
    timers.runAll();

    assert.deepEqual(plain(retries), [[true]]);
});

test('state changes broadcast earmodeState to the extension', () => {
    const api = loadContentScript(createTimers());
    api.setRuntimeIdForTest('ext');
    api.setVideoAudio(true);
    const sent = JSON.parse(JSON.stringify(api.getSentRuntimeMessagesForTest()));
    const last = sent[sent.length - 1];
    assert.equal(last.action, 'earmodeState');
    assert.equal(last.status.override, true);
    assert.equal(last.status.reason !== undefined, true);
});

test('no earmodeState broadcast when the extension context is gone', () => {
    const api = loadContentScript(createTimers());
    api.setRuntimeIdForTest(null);
    api.setVideoAudio(true);
    assert.equal(api.getSentRuntimeMessagesForTest().length, 0);
});

test('status reason is manual right after setVideoAudio, before mode logic runs', () => {
    const api = loadContentScript(createTimers());
    api.setRuntimeIdForTest('ext');
    api.setVideoAudio(true);

    assert.equal(api.getEarmodeStatus().reason, 'manual');
    const sent = plain(api.getSentRuntimeMessagesForTest());
    assert.equal(sent[sent.length - 1].status.reason, 'manual');
});

test('status reason is not a stale manual right after clearOverride', async () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    api.stubAudioPathsForTest();
    api.setRuntimeIdForTest('ext');
    api.setModeForTest('always');

    api.setVideoAudio(false);
    await settle(timers);
    assert.equal(api.getEarmodeStatus().reason, 'manual');

    api.clearOverride();
    assert.equal(api.getEarmodeStatus().reason, 'all');
    const sent = plain(api.getSentRuntimeMessagesForTest());
    assert.equal(sent[sent.length - 1].status.reason, 'all');
});

test('clearOverride in filtered mode keeps the last list decision', async () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    api.stubAudioPathsForTest();
    api.setRuntimeIdForTest('test-extension');
    api.setModeForTest('filtered');

    api.applyFilteredMode();
    await settle(timers, 40);
    assert.equal(api.getEarmodeStatus().reason, 'notInList');

    api.setVideoAudio(true);
    await settle(timers);
    assert.equal(api.getEarmodeStatus().reason, 'manual');

    api.clearOverride();
    assert.equal(api.getEarmodeStatus().reason, 'notInList');
});

/**
 * Send a runtime message to content.js the way the popup or options page would
 * @returns {{ returned: *, responses: object[] }}
 */
function sendMessage(api, request) {
    const responses = [];
    const [listener] = api.context.chrome.runtime.onMessage.listeners;
    const returned = listener(request, {}, response => responses.push(plain(response)));
    return { returned, responses };
}

test('message listener keeps the channel open only for async replies', () => {
    const api = loadContentScript(createTimers());

    const theme = sendMessage(api, { action: 'updateTheme', backgroundType: 'color', backgroundValue: '#123456' });
    assert.notEqual(theme.returned, true);
    assert.deepEqual(theme.responses, [{ ok: true }]);

    const status = sendMessage(api, { action: 'getStatus' });
    assert.notEqual(status.returned, true);
    assert.equal(status.responses[0].onVideo, true);

    const unknown = sendMessage(api, { action: 'nothingHere' });
    assert.notEqual(unknown.returned, true);

    const language = sendMessage(api, { action: 'updateLanguage', language: 'ar' });
    assert.equal(language.returned, true);
});
