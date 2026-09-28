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
 */
function setupMenu({ search = '?v=dQw4w9WgXcQ' } = {}) {
    const api = loadContentScript(createTimers(), { extraScripts: ['player-menu.js'] });
    const ctx = api.context;
    const player = new FakeElement('div');
    player.id = 'movie_player';
    const docListeners = {};
    api.setDocumentForTest({
        title: 'Song - YouTube',
        body: {},
        contains: () => true,
        createElement: tag => new FakeElement(tag),
        createElementNS: (ns, tag) => new FakeElement(tag, ns),
        querySelector(selector) {
            if (selector === '#movie_player') return player;
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
    });
    api.setSearchForTest(search);
    const writes = [];
    ctx.chrome.storage.sync.set = items => {
        writes.push(plain(items));
        return Promise.resolve();
    };
    const run = code => vm.runInContext(code, ctx);
    return { api, ctx, player, docListeners, writes, run };
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
    const inside = { target: menu.querySelector('.em-pm-look') };
    docListeners.click.forEach(entry => entry.fn(inside));
    assert.equal(menu.hidden, false);
    docListeners.click.forEach(entry => entry.fn({ target: new FakeElement('div') }));
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
    assert.equal(menuOf(player).querySelector('.em-pm-back').hidden, true); // reason still auto until logic runs
});

test('back to auto shows for manual picks and clears the override', () => {
    const { api, ctx, player, run } = setupMenu();
    ctx.ensurePlayerMenu();
    api.setVideoAudio(true);
    run("lastDecision = { audio: true, reason: 'manual' }");
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
