const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, loadContentScript } = require('./helpers/load-content');

test('forceLowestQuality retries when the first UI fallback is interrupted', () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const video = {
        paused: false,
        currentTime: 123,
        play() {
            return Promise.resolve();
        }
    };
    const player = {
        quality: 'hd720',
        getPlaybackQuality() {
            return this.quality;
        },
        setPlaybackQuality() {},
        setPlaybackQualityRange() {},
        setInternalQuality() {},
        setPreferredQuality() {}
    };
    let uiFallbacks = 0;
    let completed = false;

    api.setAudioModeEnabled(true);
    api.forceLowestQuality(player, video, () => {
        completed = true;
    }, {
        clickQuality: (targetText, onComplete) => {
            assert.equal(targetText, '144p');
            uiFallbacks++;
            if (uiFallbacks === 2) {
                player.quality = 'tiny';
            }
            onComplete();
        }
    });

    timers.runAll();

    assert.equal(uiFallbacks, 2);
    assert.equal(player.quality, 'tiny');
    assert.equal(completed, true);
});

test('clickQualitySetting closes the settings popup with the gear, without any Escape', () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const settingsPanel = { style: {} };
    const popup = { style: {} };
    let settingsOpen = false;
    let settingsButtonClicks = 0;
    const settingsButton = {
        click() {
            settingsButtonClicks++;
            settingsOpen = !settingsOpen;
        },
        getAttribute(name) {
            if (name === 'aria-expanded') {
                return settingsOpen ? 'true' : 'false';
            }
            return null;
        }
    };
    let qualityPaneOpen = false;
    const qualityMenuItem = {
        textContent: 'Quality',
        click() {
            qualityPaneOpen = true;
        }
    };
    const targetOption = {
        textContent: '144p',
        click() {}
    };

    api.setAudioModeEnabled(true);

    const dispatched = [];
    const contextDocument = {
        querySelector(selector) {
            if (selector === '.ytp-settings-menu') return settingsPanel;
            if (selector === '.ytp-popup') return popup;
            if (selector === '.ytp-settings-button') return settingsButton;
            return null;
        },
        querySelectorAll(selector) {
            if (selector !== '.ytp-menuitem' || !settingsOpen) return [];
            return qualityPaneOpen ? [targetOption] : [qualityMenuItem];
        },
        dispatchEvent(event) {
            dispatched.push(event);
        }
    };

    api.setDocumentForTest(contextDocument);
    api.clickQualitySetting('144p');

    timers.runAll();

    assert.equal(settingsButtonClicks, 2);
    assert.equal(settingsOpen, false);
    assert.equal(dispatched.length, 0);
    assert.deepEqual(settingsPanel.style, {
        opacity: '',
        pointerEvents: '',
        visibility: ''
    });
    assert.deepEqual(popup.style, {
        opacity: '',
        pointerEvents: '',
        visibility: ''
    });
});

test('extractPageChannels ignores channel links outside the video owner box', () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const link = (href, text) => ({
        getAttribute: name => (name === 'href' ? href : null),
        textContent: text
    });
    const ownerLink = link('/@yehiatech', 'Yehia Tech');
    const strayLink = link('/channel/UCkhaled', 'Khaled Ahmed');
    const owner = {
        querySelectorAll: () => [ownerLink]
    };

    api.setDocumentForTest({
        querySelector: () => null,
        querySelectorAll(selector) {
            if (/ytd-video-owner-renderer$/.test(selector.trim())) return [owner];
            if (selector.includes('/channel/')) return [ownerLink, strayLink];
            return [ownerLink];
        }
    });

    const channels = api.extractPageChannels();

    assert.deepEqual(
        Array.from(channels, channel => channel.name),
        ['Yehia Tech']
    );
});

/**
 * Enable audio mode on a fake page whose player reports the given quality
 * @returns {Promise<{ api: object, syncWrites: object[] }>}
 */
async function enableWithPlayerQuality(quality) {
    const api = loadContentScript(createTimers());
    const syncWrites = [];
    api.context.chrome.storage.sync.set = values => syncWrites.push(JSON.parse(JSON.stringify(values)));
    const video = { style: {}, readyState: 0, paused: true, addEventListener() {}, removeEventListener() {} };
    const player = { getPlaybackQuality: () => quality };
    api.setDocumentForTest({
        body: {},
        contains: () => true,
        getElementById: id => (id === 'movie_player' ? player : null),
        querySelector: selector => (selector === 'video' ? video : null),
        querySelectorAll: () => [],
        addEventListener() {},
        dispatchEvent() {}
    });
    api.clearVideoCacheForTest();
    api.setPlayerForTest(player);
    await api.enableAudioMode(true).catch(() => {});
    return { api, syncWrites };
}

const savedQuality = api => require('node:vm').runInContext('savedQualityBeforeAudioMode', api.context);

test('enabling audio mode does not store the player quality as preferredQuality', async () => {
    const { api, syncWrites } = await enableWithPlayerQuality('hd1080');
    assert.equal(syncWrites.some(values => 'preferredQuality' in values), false);
    assert.equal(savedQuality(api), 'hd1080');
});

test('enabling audio mode only remembers qualities it can restore', async () => {
    for (const quality of ['unknown', 'highres', 'tiny', 'small']) {
        const { api } = await enableWithPlayerQuality(quality);
        assert.equal(savedQuality(api), null, quality);
    }
});

// Values from the vm context come from another realm; normalize before deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));

/**
 * A page whose player API is reachable and lists the given qualities
 * @returns {object} `calls` records what the player was told; `gearClicks()` counts hidden menu openings
 */
function setupPlayer({ preferred, levels, quality = 'unknown' }) {
    const timers = createTimers();
    const api = loadContentScript(timers, { syncStorage: { preferredQuality: preferred } });
    const calls = [];
    let gearClicks = 0;
    const player = {
        levels,
        quality,
        getAvailableQualityLevels() {
            return this.levels;
        },
        getPlaybackQuality() {
            return this.quality;
        },
        setPlaybackQualityRange: (min, max) => calls.push(['range', min, max]),
        setPlaybackQuality: value => calls.push(['set', value])
    };
    const video = {
        paused: false,
        playCalls: 0,
        play() {
            this.playCalls++;
            return Promise.resolve();
        }
    };
    const gear = {
        click() {
            gearClicks++;
        },
        getAttribute: () => 'false'
    };
    api.setDocumentForTest({
        contains: () => true,
        getElementById: () => null,
        querySelector(selector) {
            if (selector === 'video') return video;
            if (selector === '.ytp-settings-button') return gear;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {}
    });
    api.clearVideoCacheForTest();
    api.setPlayerForTest(player);
    return { api, timers, player, video, calls, gearClicks: () => gearClicks };
}

const qualityLevels = ['hd720', 'large', 'medium', 'small', 'tiny', 'auto'];

test('resolveQuality falls back to the best quality below the wanted one', () => {
    const { resolveQuality } = loadContentScript(createTimers()).context;

    assert.equal(resolveQuality('hd1080', ['hd1080', 'hd720', 'auto']), 'hd1080');
    assert.equal(resolveQuality('hd1080', qualityLevels), 'hd720');
    assert.equal(resolveQuality('hd2160', qualityLevels), 'hd720');
    assert.equal(resolveQuality('hd720', ['medium', 'tiny', 'auto']), 'medium');
    // Nothing at or below the wanted quality
    assert.equal(resolveQuality('medium', ['hd1080', 'hd720', 'auto']), 'auto');
    assert.equal(resolveQuality('auto', qualityLevels), 'auto');
    // Levels not known
    assert.equal(resolveQuality('hd1080', null), 'hd1080');
    assert.equal(resolveQuality('hd1080', []), 'hd1080');
});

test('lowestQuality picks the lowest quality the video has', () => {
    const { lowestQuality } = loadContentScript(createTimers()).context;

    assert.equal(lowestQuality(qualityLevels), 'tiny');
    assert.equal(lowestQuality(['hd720', 'medium', 'auto']), 'medium');
    assert.equal(lowestQuality(null), 'tiny');
});

test('pickQualityMenuItem falls back to the highest row at or below the target', () => {
    const { pickQualityMenuItem } = loadContentScript(createTimers()).context;
    const rows = (...texts) => texts.map(textContent => ({ textContent }));
    const pick = (items, target) => pickQualityMenuItem(items, target)?.textContent;
    const menu = rows('1080p Premium', '1080p', '720p60', '480p', '360p', 'Auto');

    assert.equal(pick(menu, '1080p'), '1080p'); // not the Premium upsell
    assert.equal(pick(menu, '2160p'), '1080p');
    assert.equal(pick(menu, '720p'), '720p60');
    assert.equal(pick(menu, '144p'), '360p'); // nothing lower: the lowest row, not Auto
    assert.equal(pick(menu, 'Auto'), 'Auto');
    assert.equal(pick(rows('Auto'), '720p'), undefined);
});

test('preferred quality falls back to a lower one when the video lacks it', () => {
    const { api, timers, calls, gearClicks } = setupPlayer({ preferred: 'hd1080', levels: qualityLevels });
    let completed = false;

    api.context.applyPreferredQualityInternal(() => {
        completed = true;
    });
    timers.runAll();

    assert.deepEqual(plain(calls), [['range', 'hd720', 'hd720'], ['set', 'hd720']]);
    assert.equal(gearClicks(), 0);
    assert.equal(completed, true);
});

test('preferred quality waits for YouTube to list the qualities', () => {
    const { api, timers, player, calls } = setupPlayer({ preferred: 'hd1080', levels: [] });

    api.context.applyPreferredQualityInternal();
    assert.equal(calls.length, 0);

    player.levels = qualityLevels;
    timers.runAll();
    assert.deepEqual(plain(calls), [['range', 'hd720', 'hd720'], ['set', 'hd720']]);
});

test('preferred quality leaves the player alone when it already plays that quality', () => {
    const { api, timers, calls, gearClicks } = setupPlayer({ preferred: 'hd720', levels: qualityLevels, quality: 'hd720' });

    api.context.applyPreferredQualityInternal();
    timers.runAll();

    assert.equal(calls.length, 0);
    assert.equal(gearClicks(), 0);
});

test('preferred quality uses the settings menu only when the player API cannot be reached', () => {
    const { api, timers, gearClicks } = setupPlayer({ preferred: 'hd1080', levels: undefined });

    api.context.applyPreferredQualityInternal();
    timers.runAll();

    assert.equal(gearClicks(), 1);
});

test('restoring quality falls back to a lower one, not auto', () => {
    const { api, timers, calls, gearClicks } = setupPlayer({ preferred: 'hd1080', levels: qualityLevels });

    api.restoreQualityInternal();
    timers.runAll();

    assert.deepEqual(plain(calls), [['range', 'auto', 'auto'], ['range', 'hd720', 'hd720'], ['set', 'hd720']]);
    assert.equal(gearClicks(), 0);
});

test('audio mode asks for the lowest quality without the menu and never resumes a pause', () => {
    const { api, timers, player, video, calls, gearClicks } = setupPlayer({ levels: ['hd720', 'medium', 'auto'], quality: 'hd720' });
    let completed = false;

    api.setAudioModeEnabled(true);
    api.forceLowestQuality(player, video, () => {
        completed = true;
    });
    video.paused = true; // the user pauses right away
    timers.runAll();

    assert.deepEqual(plain(calls), [['range', 'auto', 'auto'], ['range', 'medium', 'auto']]);
    assert.equal(gearClicks(), 0);
    assert.equal(video.playCalls, 0);
    assert.equal(completed, true);
});

test('audio mode drops quality once without a reload, and reloads only when YouTube ignores it', () => {
    const vm = require('node:vm');
    const { api, timers, player, video, calls } = setupPlayer({ levels: qualityLevels, quality: 'hd720' });
    const drop = () => {
        api.forceLowestQuality(player, video);
        timers.runAll();
    };

    api.setAudioModeEnabled(true);
    drop();
    assert.deepEqual(plain(calls), [['range', 'auto', 'auto'], ['range', 'tiny', 'auto']]);

    // YouTube has not reported the new quality yet: nothing to do
    drop();
    assert.equal(calls.length, 2);

    vm.runInContext('softDropAskedAt = Date.now() - TIMING.SOFT_DROP_WAIT', api.context);
    drop();
    assert.deepEqual(plain(calls[2]), ['range', 'tiny', 'tiny']);
});

test('a new video gets the drop without a reload again', () => {
    const { api, timers, player, video, calls } = setupPlayer({ levels: qualityLevels, quality: 'hd720' });

    api.setAudioModeEnabled(true);
    api.forceLowestQuality(player, video);
    api.context.resetQualityAttemptFlag();
    api.forceLowestQuality(player, video);
    timers.runAll();

    assert.deepEqual(plain(calls.slice(2)), [['range', 'auto', 'auto'], ['range', 'tiny', 'auto']]);
});

test('restoring to auto reloads at a real quality, then lets go of it', () => {
    const { api, timers, calls } = setupPlayer({ preferred: 'auto', levels: qualityLevels });

    api.restoreQualityInternal();
    timers.runAll();

    assert.deepEqual(plain(calls), [
        ['range', 'auto', 'auto'],
        ['range', 'hd720', 'hd720'],
        ['range', 'auto', 'auto'],
        ['set', 'auto']
    ]);
});

/**
 * A video playing at 50 seconds, and a hold on it. Timers run only through `timers.runAll`.
 */
function setupHold({ muted = false, paused = false } = {}) {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const listeners = {};
    const video = {
        muted,
        paused,
        seeking: false,
        readyState: 4,
        currentTime: 50,
        addEventListener(type, fn) {
            listeners[type] = fn;
        },
        removeEventListener(type) {
            delete listeners[type];
        }
    };
    let released = 0;
    api.context.holdUntilQualityReloaded(video, () => released++);
    const reload = () => {
        listeners.emptied();
        video.currentTime = 0;
        video.readyState = 0;
    };
    return { api, timers, video, listeners, reload, released: () => released };
}

test('reload hold keeps the sound off until the video passes the point it left', () => {
    const { timers, video, listeners, reload, released } = setupHold();
    const poll = () => timers.runOne();

    assert.equal(video.muted, true);
    poll();
    assert.equal(released(), 0); // no reload yet

    video.currentTime = 50.2;
    poll();
    reload();
    poll();
    assert.equal(released(), 0); // reloading

    video.readyState = 4;
    video.seeking = true;
    video.currentTime = 50;
    poll();
    assert.equal(released(), 0); // still seeking

    video.seeking = false;
    poll();
    assert.equal(released(), 0); // back before the point it left

    video.currentTime = 50.2;
    poll();
    assert.equal(released(), 1);
    assert.equal(video.muted, false);
    assert.equal(listeners.emptied, undefined);
});

test('reload hold keeps a mute the user had', () => {
    const { timers, video, reload } = setupHold({ muted: true });

    reload();
    video.readyState = 4;
    video.currentTime = 51;
    timers.runOne();

    assert.equal(video.muted, true);
});

test('reload hold does not wait for a paused video to move', () => {
    const { timers, video, reload, released } = setupHold({ paused: true });

    reload();
    video.readyState = 4;
    video.currentTime = 49.8;
    timers.runOne();

    assert.equal(released(), 1);
});

test('reload hold lets go when no reload comes or the reload takes too long', () => {
    const vm = require('node:vm');
    const late = wait => vm.runInContext(`(() => { const now = Date.now(); Date.now = () => now + TIMING.${wait}; })()`, late.api.context);

    const noReload = setupHold();
    late.api = noReload.api;
    late('RELOAD_START_WAIT');
    noReload.timers.runOne();
    assert.equal(noReload.released(), 1);
    assert.equal(noReload.video.muted, false);

    const slowReload = setupHold();
    slowReload.reload();
    late.api = slowReload.api;
    late('RELOAD_START_WAIT');
    slowReload.timers.runOne();
    assert.equal(slowReload.released(), 0);
    late('RELOAD_HOLD_MAX');
    slowReload.timers.runOne();
    assert.equal(slowReload.released(), 1);
});

test('switching back to audio during a reload hold ends it first', async () => {
    const { api, video, released } = setupHold();

    await api.enableAudioMode(true).catch(() => {});

    assert.equal(released(), 1);
    assert.equal(video.muted, false);
});

/**
 * Switch audio mode off on a fake page, with the overlay up
 */
function setupDisable(audioVideoId) {
    const vm = require('node:vm');
    const timers = createTimers();
    const api = loadContentScript(timers);
    const video = {
        style: { opacity: '0', maxHeight: '1px', minHeight: '1px' },
        muted: false,
        paused: false,
        seeking: false,
        readyState: 4,
        currentTime: 50,
        addEventListener() {},
        removeEventListener() {}
    };
    let overlayRemoved = false;
    api.setDocumentForTest({
        contains: () => true,
        getElementById: () => null,
        querySelector: selector => (selector === 'video' ? video : null),
        querySelectorAll: () => [],
        addEventListener() {},
        dispatchEvent() {}
    });
    api.clearVideoCacheForTest();
    api.setAudioModeEnabled(true);
    api.context.__overlay = { remove: () => { overlayRemoved = true; } };
    vm.runInContext(`audioModeOverlay = __overlay; audioModeVideoId = ${JSON.stringify(audioVideoId)};`, api.context);
    api.context.disableAudioMode(true);
    return { video, overlayRemoved: () => overlayRemoved };
}

test('switching to video on the same video keeps the overlay up during the reload', () => {
    const { video, overlayRemoved } = setupDisable('test');

    assert.equal(video.muted, true);
    assert.equal(video.style.opacity, '0');
    assert.equal(overlayRemoved(), false);
});

test('switching to video after a navigation shows the new video at once', () => {
    const { video, overlayRemoved } = setupDisable('other');

    assert.equal(video.muted, false);
    assert.equal(video.style.opacity, '1');
    assert.equal(video.style.maxHeight, '');
    assert.equal(overlayRemoved(), true);
});

test('audio mode does not retry the menu when the quality cannot be read', () => {
    const { api, timers, player, video } = setupPlayer({ levels: undefined, quality: undefined });
    let uiFallbacks = 0;
    player.getPlaybackQuality = () => undefined;

    api.setAudioModeEnabled(true);
    api.forceLowestQuality(player, video, null, {
        clickQuality: (_targetText, onComplete) => {
            uiFallbacks++;
            onComplete();
        }
    });
    timers.runAll();

    assert.equal(uiFallbacks, 1);
});

test('player calls reach the page-world player through player-bridge.js', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const api = loadContentScript(createTimers());
    const listeners = {};
    const received = [];
    const moviePlayer = {
        getPlaybackQuality: () => 'hd720',
        getAvailableQualityLevels: () => ['hd720', 'auto'],
        setPlaybackQualityRange: (min, max) => received.push([min, max]),
        getVideoData: () => {
            throw new Error('not on the allowed list');
        }
    };
    let player = moviePlayer;
    api.setDocumentForTest({
        getElementById: id => (id === 'movie_player' ? player : null),
        addEventListener(type, fn) {
            (listeners[type] ||= []).push(fn);
        },
        removeEventListener(type, fn) {
            listeners[type] = listeners[type].filter(listener => listener !== fn);
        },
        dispatchEvent(event) {
            (listeners[event.type] || []).forEach(fn => fn(event));
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'player-bridge.js'), 'utf8'), api.context);
    const { callPlayer, getPlayer } = api.context;

    assert.equal(getPlayer().getPlaybackQuality(), 'hd720');
    assert.deepEqual(plain(getPlayer().getAvailableQualityLevels()), ['hd720', 'auto']);
    getPlayer().setPlaybackQualityRange('tiny', 'tiny');
    assert.deepEqual(plain(received), [['tiny', 'tiny']]);

    // Not on the allowed list, or no such method: no answer and no error
    assert.equal(callPlayer('getVideoData'), undefined);
    assert.equal(callPlayer('setPlaybackQuality', 'tiny'), undefined);
    assert.equal(listeners['earmode:player-result'].length, 0);

    // The player left the page
    player = null;
    assert.equal(getPlayer(), null);
    assert.equal(callPlayer('getPlaybackQuality'), undefined);
});
