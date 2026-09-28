const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createTimers() {
    const queue = [];

    return {
        setTimeout(callback) {
            queue.push(callback);
            return queue.length;
        },
        clearTimeout() {},
        setInterval() {
            return 1;
        },
        clearInterval() {},
        runAll(limit = 50) {
            let runs = 0;
            while (queue.length > 0) {
                assert.ok(runs < limit, 'timer queue did not drain');
                const callback = queue.shift();
                callback();
                runs++;
            }
        }
    };
}

function loadContentScript(timers) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
    const initialVideo = {
        addEventListener() {},
        removeEventListener() {}
    };
    const context = {
        console: {
            log() {},
            error() {},
            warn() {}
        },
        URLSearchParams,
        KeyboardEvent: class KeyboardEvent {},
        MutationObserver: class MutationObserver {
            observe() {}
            disconnect() {}
        },
        window: {
            location: {
                href: 'https://www.youtube.com/watch?v=test',
                pathname: '/watch',
                search: '?v=test'
            },
            addEventListener() {}
        },
        location: {
            href: 'https://www.youtube.com/watch?v=test',
            pathname: '/watch',
            search: '?v=test'
        },
        document: {
            body: {},
            querySelector(selector) {
                if (selector === 'video') {
                    return initialVideo;
                }
                return null;
            },
            querySelectorAll() {
                return [];
            },
            addEventListener() {},
            dispatchEvent() {}
        },
        chrome: {
            runtime: {
                id: null,
                onMessage: {
                    addListener() {}
                }
            },
            storage: {
                sync: {
                    get(_keys, callback) {
                        callback({});
                    },
                    set() {}
                },
                local: {
                    get(_keys, callback) {
                        callback({});
                    },
                    set() {}
                },
                onChanged: {
                    addListener() {}
                }
            },
            i18n: {
                getMessage(messageName) {
                    return messageName;
                },
                getUILanguage() {
                    return 'en';
                }
            }
        },
        fetch: async () => ({
            async json() {
                return {};
            }
        }),
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval
    };

    vm.createContext(context);
    vm.runInContext(`${source}
globalThis.__audioModeTestApi = {
    forceLowestQuality,
    clickQualitySetting,
    extractPageChannels,
    setDocumentForTest(documentForTest) {
        globalThis.document = documentForTest;
    },
    setAudioModeEnabled(value) {
        audioModeEnabled = value;
    }
};`, context);

    return context.__audioModeTestApi;
}

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
