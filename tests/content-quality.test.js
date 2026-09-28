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
        clickQuality: (_video, targetText, onComplete) => {
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

test('clickQualitySetting closes the settings popup when document Escape misses it', () => {
    const timers = createTimers();
    const api = loadContentScript(timers);
    const video = {
        paused: false,
        currentTime: 123,
        play() {
            return Promise.resolve();
        }
    };
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
        dispatchEvent() {
            // Simulate focus being elsewhere: document Escape does not close YouTube's popup.
        }
    };

    api.setDocumentForTest(contextDocument);
    api.clickQualitySetting(video, '144p');

    timers.runAll();

    assert.equal(settingsButtonClicks, 2);
    assert.equal(settingsOpen, false);
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
