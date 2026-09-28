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
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'content.js'), 'utf8');
    const location = {
        href: 'https://www.youtube.com/watch?v=test',
        pathname: '/watch',
        search: '?v=test'
    };
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
        Image: class Image {},
        KeyboardEvent: class KeyboardEvent {},
        MutationObserver: class MutationObserver {
            observe() {}
            disconnect() {}
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        // window.location and location share one object so tests can change the URL.
        window: {
            location,
            addEventListener() {},
            dispatchEvent() {
                return true;
            }
        },
        location,
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
    normalizePlayerLook,
    thumbnailUrl,
    createAudioModeOverlay,
    setPlayerLook,
    updateOverlayTheme,
    updateOverlayContent,
    getCurrentVideoInfo,
    setImageForTest(ImageClass) {
        globalThis.Image = ImageClass;
    },
    clearVideoCacheForTest() {
        clearVideoCache();
    },
    getOverlayForTest() {
        return audioModeOverlay;
    },
    setDocumentForTest(documentForTest) {
        globalThis.document = documentForTest;
    },
    setAudioModeEnabled(value) {
        audioModeEnabled = value;
    },
    setSearchForTest(search) {
        window.location.search = search;
        location.search = search;
        location.href = 'https://www.youtube.com' + location.pathname + search;
    },
    decideAudio,
    getEarmodeStatus,
    setVideoAudio,
    clearOverride,
    applyModeLogic,
    applyDecision,
    applyFilteredMode,
    enableAudioMode(fromAutoRule) {
        return enableAudioMode(fromAutoRule);
    },
    setRuntimeIdForTest(id) {
        chrome.runtime.id = id;
    },
    setModeForTest(mode) {
        currentModeType = mode;
    },
    replaceEnableAudioModeForTest(fn) {
        enableAudioMode = fn;
    },
    // Replace the DOM-heavy audio paths with recorders. Tests using this check
    // which path the decision logic takes, not what those paths do to the page.
    stubAudioPathsForTest() {
        const calls = [];
        enableAudioMode = fromAutoRule => {
            calls.push({ name: 'enable', fromAutoRule });
            audioModeEnabled = true;
            emitEarmodeState();
        };
        disableAudioMode = fromAutoRule => {
            calls.push({ name: 'disable', fromAutoRule });
            audioModeEnabled = false;
            emitEarmodeState();
        };
        setLowestQuality = () => {
            calls.push({ name: 'lowest' });
        };
        applyPreferredQuality = () => {
            calls.push({ name: 'preferred' });
        };
        return calls;
    }
};`, context);

    return context.__audioModeTestApi;
}

module.exports = { createTimers, loadContentScript };
