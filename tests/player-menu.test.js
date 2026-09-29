const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createTimers, loadContentScript } = require('./helpers/load-content');
const { FakeElement } = require('./helpers/fake-dom');

// Values from the vm context come from another realm; normalize before deepEqual.
const plain = value => JSON.parse(JSON.stringify(value));
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Load content.js + player-menu.js with a fake #movie_player.
 * `dom.player` / `dom.container` can be swapped to simulate YouTube building the player late.
 * Timers set after setup are captured in `timers` instead of running.
 */
function setupMenu({ search = '?v=dQw4w9WgXcQ', withPlayer = true, syncStorage = {} } = {}) {
    const api = loadContentScript(createTimers(), { extraScripts: ['player-menu.js'], syncStorage });
    const ctx = api.context;
    const player = new FakeElement('div');
    player.id = 'movie_player';
    const dom = { player: withPlayer ? player : null, container: null };
    const docListeners = {};
    const doc = {
        title: 'Song - YouTube',
        body: {},
        activeElement: null,
        contains: () => true,
        createElement: tag => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag, ns),
        querySelector(selector) {
            if (selector === '#movie_player') return dom.player;
            if (selector === '#player-container') return dom.container;
            return null;
        },
        querySelectorAll: () => [],
        addEventListener(type, fn, options) {
            (docListeners[type] ||= []).push({ fn, capture: options === true || !!options?.capture });
        },
        removeEventListener(type, fn) {
            docListeners[type] = (docListeners[type] || []).filter(entry => entry.fn !== fn);
        },
        dispatchEvent() {}
    };
    api.setDocumentForTest(doc);
    api.setSearchForTest(search);
    const writes = [];
    ctx.chrome.storage.sync.set = items => {
        writes.push(plain(items));
        return Promise.resolve();
    };
    // Capture timers set from here on; content.js timers queued at load never run
    const timers = [];
    ctx.setTimeout = (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
    };
    ctx.clearTimeout = id => {
        if (timers[id - 1]) timers[id - 1].fn = null;
    };
    // Run the timers pending now (not ones they add); returns how many ran
    const runTimers = () => {
        const pending = timers.filter(timer => timer.fn);
        pending.forEach(timer => {
            const fn = timer.fn;
            timer.fn = null;
            fn();
        });
        return pending.length;
    };
    const run = code => vm.runInContext(code, ctx);
    return { api, ctx, player, dom, doc, docListeners, writes, run, timers, runTimers };
}

const buttonOf = player => player.querySelector('.em-player-btn');
const menuOf = player => player.querySelector('.em-player-menu');
const textOf = el => [el, ...el.walk()].map(node => node.textContent).join('');

test('menuModel maps status, mode and look to labels and pressed states', () => {
    const { ctx } = setupMenu();
    const t = key => `<${key}>`;
    const model = plain(ctx.menuModel({ onVideo: true, audio: true, reason: 'manual' }, 'filtered', 'waves', t));

    assert.equal(model.on, true);
    assert.equal(model.buttonText, 'Earmode · <nowAudio>');
    assert.deepEqual(model.titles, { thisVideo: '<menuThisVideo>', autoListen: '<menuAutoListen>', playerLook: '<menuPlayerLook>' });
    assert.deepEqual(model.switchOptions, [
        { audio: false, label: '<switchVideo>', pressed: false },
        { audio: true, label: '<switchAudio>', pressed: true }
    ]);
    assert.equal(model.showBackToAuto, true);
    assert.equal(model.backToAutoLabel, '<backToAuto>');
    assert.deepEqual(model.modes.map(mode => [mode.value, mode.label, mode.pressed]), [
        ['always', '<modeEverything>', false],
        ['filtered', '<modeMyList>', true],
        ['off', '<modeNothing>', false]
    ]);
    assert.deepEqual(model.looks.map(look => [look.value, look.label, look.pressed]), [
        ['card', '<lookCard>', false],
        ['blur', '<lookBlur>', false],
        ['minimal', '<lookSimple>', false],
        ['waves', '<lookWaves>', true]
    ]);

    const auto = plain(ctx.menuModel({ onVideo: true, audio: false, reason: 'all' }, 'bogus', 'nope', t));
    assert.equal(auto.buttonText, 'Earmode · <nowVideo>');
    assert.equal(auto.showBackToAuto, false);
    assert.deepEqual(auto.modes.map(mode => mode.pressed), [true, false, false]);
    assert.deepEqual(auto.looks.map(look => look.pressed), [true, false, false, false]);
});

test('ensurePlayerMenu is idempotent', () => {
    const { ctx, player } = setupMenu();
    assert.equal(ctx.ensurePlayerMenu(), true);
    assert.equal(ctx.ensurePlayerMenu(), true);
    assert.equal(player.querySelectorAll('.em-player-btn').length, 1);
    assert.equal(player.querySelectorAll('.em-player-menu').length, 1);
});

test('button reflects the audio state', () => {
    const { api, ctx, player } = setupMenu();
    ctx.ensurePlayerMenu();
    const button = buttonOf(player);
    assert.equal(textOf(button), 'Earmode · nowVideo');
    assert.equal(button.dataset.on, 'false');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(button.getAttribute('aria-controls'), menuOf(player).id);

    api.setAudioModeEnabled(true);
    ctx.renderPlayerMenu();
    assert.equal(textOf(button), 'Earmode · nowAudio');
    assert.equal(button.dataset.on, 'true');
});

test('menu is built from elements with SVG icons and three blocks', () => {
    const { ctx, player } = setupMenu();
    ctx.ensurePlayerMenu(); // FakeElement throws on innerHTML
    const menu = menuOf(player);
    assert.equal(menu.hidden, true);
    assert.deepEqual(plain(menu.querySelectorAll('.em-pm-title').map(el => el.textContent)),
        ['menuThisVideo', 'menuAutoListen', 'menuPlayerLook']);
    assert.equal(menu.querySelectorAll('.em-pm-opt').length, 2);
    assert.equal(menu.querySelectorAll('.em-pm-mode').length, 3);
    assert.equal(menu.querySelectorAll('.em-pm-look').length, 4);
    const svgs = [...menu.walk()].filter(el => el.tagName === 'svg');
    assert.equal(svgs.length, 2);
    svgs.forEach(svg => assert.equal(svg.namespace, SVG_NS));
    assert.equal(menu.querySelector('.em-pm-back').hidden, true);
});

test('button toggles the menu and events do not reach the player', () => {
    const { ctx, player, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    const reached = [];
    ['click', 'keydown', 'dblclick', 'mousedown'].forEach(type => {
        player.addEventListener(type, () => reached.push(type));
    });
    const button = buttonOf(player);
    const menu = menuOf(player);

    button.dispatch('click');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(menu.hidden, false);
    assert.equal(docListeners.click.filter(entry => entry.capture).length, 1);

    button.dispatch('keydown', { key: 'k' });
    button.dispatch('dblclick');
    menu.querySelector('.em-pm-mode').dispatch('mousedown');
    assert.deepEqual(reached, []);

    button.dispatch('click');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(menu.hidden, true);
    assert.equal((docListeners.click || []).length, 0);
});

test('Escape and outside clicks close the menu', () => {
    const { ctx, player, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    const button = buttonOf(player);
    const menu = menuOf(player);

    button.dispatch('click');
    FakeElement.focused = null;
    menu.querySelector('.em-pm-look').dispatch('keydown', { key: 'Escape' });
    assert.equal(menu.hidden, true);
    assert.equal(FakeElement.focused, button);

    button.dispatch('click');
    const inside = { target: menu.querySelector('.em-pm-look'), isTrusted: true };
    docListeners.click.forEach(entry => entry.fn(inside));
    assert.equal(menu.hidden, false);
    docListeners.click.forEach(entry => entry.fn({ target: new FakeElement('div'), isTrusted: true }));
    assert.equal(menu.hidden, true);
});

test('switch sets the video audio and ignores the active automatic side', () => {
    const { api, ctx, player } = setupMenu();
    ctx.ensurePlayerMenu();
    const [videoOpt, audioOpt] = menuOf(player).querySelectorAll('.em-pm-opt');

    videoOpt.dispatch('click'); // already video by auto rule: nothing happens
    assert.equal(api.getEarmodeStatus().override, null);

    audioOpt.dispatch('click');
    assert.equal(api.getEarmodeStatus().override, true);
    ctx.renderPlayerMenu();
    assert.equal(menuOf(player).querySelector('.em-pm-back').hidden, false); // manual pick shows right away
});

test('back to auto shows for manual picks and clears the override', () => {
    const { api, ctx, player } = setupMenu();
    ctx.ensurePlayerMenu();
    api.setVideoAudio(true);
    ctx.renderPlayerMenu();
    const back = menuOf(player).querySelector('.em-pm-back');
    assert.equal(back.hidden, false);
    assert.equal(back.textContent, 'backToAuto');

    back.dispatch('click');
    assert.equal(api.getEarmodeStatus().override, null);
});

test('auto-listen and look buttons write to sync storage', () => {
    const { ctx, player, writes } = setupMenu();
    ctx.ensurePlayerMenu();
    const menu = menuOf(player);
    menu.querySelectorAll('.em-pm-mode')[2].dispatch('click');
    menu.querySelectorAll('.em-pm-look')[3].dispatch('click');
    menu.querySelectorAll('.em-pm-mode')[0].dispatch('click'); // already 'always': no write
    assert.deepEqual(writes, [{ audioModeType: 'off' }, { playerLook: 'waves' }]);
});

test('direction follows the language and the menu leaves non-video pages', () => {
    const { api, ctx, player, run } = setupMenu();
    ctx.ensurePlayerMenu();
    assert.equal(menuOf(player).getAttribute('dir'), 'ltr');
    run("currentLanguage = 'ar'");
    ctx.renderPlayerMenu();
    assert.equal(menuOf(player).getAttribute('dir'), 'rtl');
    assert.equal(buttonOf(player).getAttribute('dir'), 'rtl');

    api.setSearchForTest('');
    assert.equal(ctx.ensurePlayerMenu(), false);
    assert.equal(player.children.length, 0);
});

/**
 * An Escape keydown that records stopPropagation and preventDefault
 * @param {boolean} [isTrusted] - False for events the extension dispatches itself
 */
function escapeEvent(isTrusted = true) {
    const event = { key: 'Escape', isTrusted, stopped: false, prevented: false };
    event.stopPropagation = () => { event.stopped = true; };
    event.preventDefault = () => { event.prevented = true; };
    return event;
}

test('Escape from outside the menu closes it without moving focus', () => {
    const { ctx, player, doc, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    buttonOf(player).dispatch('click');
    FakeElement.focused = null;
    doc.activeElement = new FakeElement('input');
    docListeners.keydown.forEach(entry => entry.fn(escapeEvent()));
    assert.equal(menuOf(player).hidden, true);
    assert.equal(FakeElement.focused, null);

    buttonOf(player).dispatch('click');
    doc.activeElement = menuOf(player).querySelector('.em-pm-mode');
    docListeners.keydown.forEach(entry => entry.fn(escapeEvent()));
    assert.equal(FakeElement.focused, buttonOf(player));
});

/**
 * A click event object as the document capture listener sees it
 * @param {object} target
 * @param {boolean} [isTrusted] - False for clicks the extension makes itself
 */
function clickEvent(target, isTrusted = true) {
    return {
        target,
        isTrusted,
        stopped: false,
        defaultPrevented: false,
        stopPropagation() {
            this.stopped = true;
        },
        preventDefault() {
            this.defaultPrevented = true;
        }
    };
}

test('dismissing click inside the player does not reach YouTube', () => {
    const { ctx, player, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    const video = player.appendChild(new FakeElement('video'));
    buttonOf(player).dispatch('click');

    const inside = clickEvent(video);
    docListeners.click.forEach(entry => entry.fn(inside));
    assert.equal(menuOf(player).hidden, true);
    assert.equal(inside.stopped, true);
    assert.equal(inside.defaultPrevented, true);

    buttonOf(player).dispatch('click');
    const outside = clickEvent(new FakeElement('div'));
    docListeners.click.forEach(entry => entry.fn(outside));
    assert.equal(menuOf(player).hidden, true);
    assert.equal(outside.stopped, false);
    assert.equal(outside.defaultPrevented, false);
});

test('touch and pointerup events do not reach the player', () => {
    const { ctx, player } = setupMenu();
    ctx.ensurePlayerMenu();
    const reached = [];
    ['pointerup', 'touchstart', 'touchend'].forEach(type => {
        player.addEventListener(type, () => reached.push(type));
        buttonOf(player).dispatch(type);
        menuOf(player).querySelector('.em-pm-look').dispatch(type);
    });
    assert.deepEqual(reached, []);
});

test('schedulePlayerMenu retries until the player appears', () => {
    const { ctx, player, dom, timers, runTimers } = setupMenu({ withPlayer: false });
    ctx.schedulePlayerMenu();
    assert.equal(timers.filter(timer => timer.fn).length, 1);
    runTimers();
    runTimers();
    dom.player = player;
    runTimers();
    assert.equal(player.querySelectorAll('.em-player-btn').length, 1);
    assert.equal(runTimers(), 0);
});

test('schedulePlayerMenu stops after the retry limit', () => {
    const { ctx, timers, runTimers, run } = setupMenu({ withPlayer: false });
    const max = run('PLAYER_MENU_MAX_RETRIES');
    ctx.schedulePlayerMenu();
    let rounds = 0;
    while (runTimers() > 0) rounds++;
    assert.equal(rounds, max);
    assert.equal(timers.length, max);
});

test('schedulePlayerMenu stops retrying off video pages', () => {
    const { api, ctx, timers, runTimers } = setupMenu({ withPlayer: false });
    ctx.schedulePlayerMenu();
    assert.equal(timers.length, 1);
    api.setSearchForTest('');
    runTimers();
    assert.equal(timers.length, 1);
});

test('fallback container mount keeps looking for #movie_player', () => {
    const { ctx, player, dom, runTimers } = setupMenu({ withPlayer: false });
    const container = new FakeElement('div');
    dom.container = container;
    ctx.schedulePlayerMenu();
    assert.equal(container.querySelectorAll('.em-player-btn').length, 1);

    dom.player = player;
    runTimers();
    assert.equal(container.querySelectorAll('.em-player-btn').length, 0);
    assert.equal(player.querySelectorAll('.em-player-btn').length, 1);
    assert.equal(player.querySelectorAll('.em-player-menu').length, 1);
    assert.equal(runTimers(), 0);
});

test('earmode:state and storage changes re-render the menu', () => {
    const { ctx, player, run } = setupMenu();
    ctx.ensurePlayerMenu();
    run('audioModeEnabled = true; emitEarmodeState()');
    assert.equal(buttonOf(player).dataset.on, 'true');

    run("currentModeType = 'off'");
    ctx.chrome.storage.onChanged.listeners.forEach(fn => fn({ audioModeType: { newValue: 'off' } }, 'sync'));
    const pressed = menuOf(player).querySelectorAll('.em-pm-mode').map(el => el.getAttribute('aria-pressed'));
    assert.deepEqual(plain(pressed), ['false', 'false', 'true']);
});

test('removePlayerMenu while open drops the document listeners', () => {
    const { ctx, player, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    buttonOf(player).dispatch('click');
    assert.equal(docListeners.click.length, 1);
    assert.equal(docListeners.keydown.length, 1);

    ctx.removePlayerMenu();
    assert.equal(docListeners.click.length, 0);
    assert.equal(docListeners.keydown.length, 0);
    assert.equal(player.children.length, 0);
});

test('document Escape that closes the menu does not reach YouTube', () => {
    const { ctx, player, doc, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();

    buttonOf(player).dispatch('click');
    doc.activeElement = new FakeElement('input');
    const closing = escapeEvent();
    docListeners.keydown.forEach(entry => entry.fn(closing));
    assert.equal(menuOf(player).hidden, true);
    assert.equal(closing.stopped, true);
    assert.equal(closing.prevented, true);
});

test('synthetic clicks and Escapes from the quality fallback leave the menu open', () => {
    const { ctx, player, doc, docListeners } = setupMenu();
    ctx.ensurePlayerMenu();
    const gear = player.appendChild(new FakeElement('button'));
    buttonOf(player).dispatch('click');

    // The quality fallback clicks the settings gear programmatically
    const syntheticClick = clickEvent(gear, false);
    docListeners.click.forEach(entry => entry.fn(syntheticClick));
    assert.equal(menuOf(player).hidden, false);
    assert.equal(syntheticClick.stopped, false);
    assert.equal(syntheticClick.defaultPrevented, false);

    // closeSettingsPopup dispatches Escape on document, activeElement, body and window
    doc.activeElement = new FakeElement('input');
    const syntheticEscape = escapeEvent(false);
    docListeners.keydown.forEach(entry => entry.fn(syntheticEscape));
    assert.equal(menuOf(player).hidden, false);
    assert.equal(syntheticEscape.stopped, false);
    assert.equal(syntheticEscape.prevented, false);

    // A synthetic Escape on a focused menu button does not close it either
    const look = menuOf(player).querySelector('.em-pm-look');
    const onButton = look.dispatch('keydown', { key: 'Escape', isTrusted: false });
    assert.equal(menuOf(player).hidden, false);
    assert.equal(onButton.stopped, true); // still kept away from YouTube

    // Real user input still closes it
    const trustedClick = clickEvent(gear);
    docListeners.click.forEach(entry => entry.fn(trustedClick));
    assert.equal(menuOf(player).hidden, true);
    assert.equal(trustedClick.stopped, true);

    buttonOf(player).dispatch('click');
    docListeners.keydown.forEach(entry => entry.fn(escapeEvent()));
    assert.equal(menuOf(player).hidden, true);
});

test('showPlayerButton false keeps the button off the player', () => {
    const { ctx, player, timers } = setupMenu({ syncStorage: { showPlayerButton: false } });
    assert.equal(ctx.ensurePlayerMenu(), false);
    ctx.schedulePlayerMenu();
    assert.equal(player.children.length, 0);
    assert.equal(timers.filter(timer => timer.fn).length, 0); // no retries while hidden
});

test('changing showPlayerButton removes and restores the button live', () => {
    const { ctx, player } = setupMenu();
    ctx.ensurePlayerMenu();
    assert.equal(player.querySelectorAll('.em-player-btn').length, 1);
    const change = changes => ctx.chrome.storage.onChanged.listeners.forEach(fn => fn(changes, 'sync'));

    change({ showPlayerButton: { oldValue: true, newValue: false } });
    assert.equal(player.children.length, 0);
    assert.equal(ctx.ensurePlayerMenu(), false);

    change({ showPlayerButton: { oldValue: false, newValue: true } });
    assert.equal(player.querySelectorAll('.em-player-btn').length, 1);
    assert.equal(player.querySelectorAll('.em-player-menu').length, 1);
});
