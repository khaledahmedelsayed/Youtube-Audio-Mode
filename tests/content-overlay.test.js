const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, loadContentScript } = require('./helpers/load-content');

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

// Minimal DOM: enough for the overlay builder (createElement, classes, styles, queries).
class FakeElement {
    constructor(tagName, namespace = null) {
        this.tagName = tagName;
        this.namespace = namespace;
        this.children = [];
        this.parent = null;
        this.attributes = {};
        this.dataset = {};
        this.textContent = '';
        this.id = '';
        this.listeners = {};
        const props = {};
        this.style = {
            props,
            setProperty(name, value) {
                props[name] = value;
            },
            removeProperty(name) {
                delete props[name];
            }
        };
        const classes = new Set();
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name)
        };
        this.classes = classes;
    }
    get className() {
        return [...this.classes].join(' ');
    }
    set className(value) {
        this.classes.clear();
        String(value).split(/\s+/).filter(Boolean).forEach(name => this.classes.add(name));
    }
    set innerHTML(_value) {
        throw new Error('innerHTML must not be used');
    }
    setAttribute(name, value) {
        this.attributes[name] = value;
        if (name === 'class') this.className = value;
    }
    removeAttribute(name) {
        delete this.attributes[name];
    }
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
        return child;
    }
    remove() {
        if (this.parent) {
            this.parent.children = this.parent.children.filter(child => child !== this);
            this.parent = null;
        }
    }
    *walk() {
        for (const child of this.children) {
            yield child;
            yield* child.walk();
        }
    }
    querySelector(selector) {
        const name = selector.replace(/^\./, '');
        for (const el of this.walk()) {
            if (el.classes.has(name)) return el;
        }
        return null;
    }
}

function setupOverlayDom(api, { title = 'Song <b>title</b>', search = '?v=dQw4w9WgXcQ' } = {}) {
    const container = new FakeElement('div');
    const video = {
        paused: true,
        listeners: { play: [], pause: [] },
        addEventListener(type, fn) {
            this.listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
            this.listeners[type] = this.listeners[type].filter(listener => listener !== fn);
        }
    };
    api.setDocumentForTest({
        title: `${title} - YouTube`,
        body: {},
        contains: () => true,
        createElement: tag => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag, ns),
        querySelector(selector) {
            if (selector === '.html5-video-container') return container;
            if (selector === 'video') return video;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener() {},
        dispatchEvent() {}
    });
    api.setSearchForTest(search);
    return { container, video };
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
