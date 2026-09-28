const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, loadContentScript } = require('./helpers/load-content');
const { FakeElement } = require('./helpers/fake-dom');

// Values from the vm context come from another realm; normalize before deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));

test('normalizePlayerLook keeps known looks and falls back to card', () => {
    const api = loadContentScript(createTimers());
    assert.equal(api.normalizePlayerLook('waves'), 'waves');
    assert.equal(api.normalizePlayerLook('blur'), 'blur');
    assert.equal(api.normalizePlayerLook('bars'), 'card');
    assert.equal(api.normalizePlayerLook(undefined), 'card');
});

test('thumbnailUrl only accepts real video ids', () => {
    const api = loadContentScript(createTimers());
    assert.equal(api.thumbnailUrl('bad id!'), null);
    assert.equal(api.thumbnailUrl(null), null);
    assert.equal(api.thumbnailUrl('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

function createFakeVideo() {
    return {
        paused: true,
        listeners: { play: [], pause: [] },
        addEventListener(type, fn) {
            this.listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
            this.listeners[type] = this.listeners[type].filter(listener => listener !== fn);
        }
    };
}

function setupOverlayDom(api, { title = 'Song <b>title</b>', search = '?v=dQw4w9WgXcQ', h1 = null, enabled = true } = {}) {
    const container = new FakeElement('div');
    const dom = { video: createFakeVideo(), h1 };
    api.setAudioModeEnabled(enabled);
    api.setDocumentForTest({
        title: `${title} - YouTube`,
        body: {},
        contains: () => true,
        createElement: tag => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag, ns),
        querySelector(selector) {
            if (selector === '.html5-video-container') return container;
            if (selector === 'video') return dom.video;
            if (selector === 'ytd-watch-metadata h1 yt-formatted-string' && dom.h1) return { textContent: dom.h1 };
            return null;
        },
        querySelectorAll: () => [],
        addEventListener() {},
        dispatchEvent() {}
    });
    api.setSearchForTest(search);
    return { container, video: dom.video, dom };
}

const classesOf = el => [...el.walk()].map(child => child.className).filter(Boolean);

test('card look builds the now-playing card with safe text', async () => {
    const api = loadContentScript(createTimers());
    const { container } = setupOverlayDom(api);
    await api.createAudioModeOverlay();

    const overlay = api.getOverlayForTest();
    assert.equal(container.children[0], overlay);
    assert.equal(overlay.id, 'youtube-audio-mode-overlay');
    assert.equal(overlay.className, 'earmode-look-card paused');
    assert.deepEqual(plain(classesOf(overlay)), ['em-np-card', 'em-np-art', 'em-np-meta', 'em-kicker', 'em-title', 'em-channel']);
    assert.equal(overlay.querySelector('.em-title').textContent, 'Song <b>title</b>');
    assert.equal(overlay.querySelector('.em-kicker').textContent, 'overlayListening');
    assert.equal(overlay.style.props['--em-thumb'], 'url("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")');
});

test('minimal and waves looks build their graphics with SVG elements', async () => {
    const api = loadContentScript(createTimers());
    setupOverlayDom(api);

    api.setPlayerLook('minimal');
    await api.createAudioModeOverlay();
    let overlay = api.getOverlayForTest();
    assert.equal(overlay.classList.contains('earmode-look-minimal'), true);
    const ring = overlay.querySelector('.em-ring');
    assert.equal(ring.children[0].tagName, 'svg');
    assert.equal(ring.children[0].namespace, 'http://www.w3.org/2000/svg');
    assert.deepEqual(plain(ring.children[0].children.map(child => child.tagName)), ['path', 'rect', 'rect']);

    api.setPlayerLook('waves');
    await new Promise(resolve => setImmediate(resolve));
    overlay = api.getOverlayForTest();
    assert.equal(overlay.classList.contains('earmode-look-waves'), true);
    const waves = overlay.querySelector('.em-waves');
    assert.equal(waves.children.length, 2);
    assert.ok(overlay.querySelector('.em-ov-text'));
});

test('invalid video id leaves no thumbnail and theme sets --em-bg', async () => {
    const api = loadContentScript(createTimers());
    setupOverlayDom(api, { search: '?v=bad' });
    api.setPlayerLook('blur');
    await api.createAudioModeOverlay();

    const overlay = api.getOverlayForTest();
    assert.equal(overlay.style.props['--em-thumb'], undefined);
    api.updateOverlayTheme('color', '#123456');
    assert.equal(overlay.style.props['--em-bg'], '#123456');
});

test('rebuilding the overlay does not stack play/pause listeners', async () => {
    const api = loadContentScript(createTimers());
    const { video } = setupOverlayDom(api);
    await api.createAudioModeOverlay();
    await api.createAudioModeOverlay();
    assert.equal(video.listeners.play.length, 1);
    assert.equal(video.listeners.pause.length, 1);

    video.listeners.play[0]();
    assert.equal(api.getOverlayForTest().classList.contains('paused'), false);
});

test('a pending rebuild does not bring the overlay back after disable', async () => {
    const api = loadContentScript(createTimers());
    const { container } = setupOverlayDom(api, { enabled: false });
    await api.createAudioModeOverlay();
    assert.equal(api.getOverlayForTest(), null);
    assert.equal(container.children.length, 0);
});

test('video title drops the YouTube notification count', () => {
    const api = loadContentScript(createTimers());
    setupOverlayDom(api, { title: '(3) Song title' });
    assert.equal(api.getCurrentVideoInfo().videoTitle, 'Song title');
});

test('overlay prefers the watch page heading for the title', async () => {
    const api = loadContentScript(createTimers());
    const { dom } = setupOverlayDom(api, { title: 'Old title', h1: '  New title  ' });
    await api.createAudioModeOverlay();
    assert.equal(api.getOverlayForTest().querySelector('.em-title').textContent, 'New title');

    dom.h1 = null;
    api.updateOverlayContent();
    assert.equal(api.getOverlayForTest().querySelector('.em-title').textContent, 'Old title');
});

test('listeners are detached from the video they were attached to', async () => {
    const api = loadContentScript(createTimers());
    const { dom } = setupOverlayDom(api);
    await api.createAudioModeOverlay();
    const firstVideo = dom.video;
    dom.video = createFakeVideo();
    api.clearVideoCacheForTest();

    await api.createAudioModeOverlay();
    assert.equal(firstVideo.listeners.play.length, 0);
    assert.equal(firstVideo.listeners.pause.length, 0);
    assert.equal(dom.video.listeners.play.length, 1);
});

test('YouTube placeholder thumbnail counts as missing', async () => {
    const api = loadContentScript(createTimers());
    const images = [];
    api.setImageForTest(class {
        constructor() {
            images.push(this);
        }
    });
    setupOverlayDom(api);
    await api.createAudioModeOverlay();
    const overlay = api.getOverlayForTest();
    assert.ok(overlay.style.props['--em-thumb']);

    images[0].naturalWidth = 120;
    images[0].onload();
    assert.equal(overlay.style.props['--em-thumb'], undefined);
});

test('image background also feeds --em-bg', async () => {
    const api = loadContentScript(createTimers());
    setupOverlayDom(api);
    await api.createAudioModeOverlay();
    api.updateOverlayTheme('image', 'https://example.com/a.png');
    assert.equal(api.getOverlayForTest().style.props['--em-bg'], 'url("https://example.com/a.png")');
});
