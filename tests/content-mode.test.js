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
