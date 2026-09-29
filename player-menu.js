// Earmode - in-player button and menu
// Runs after content.js in the same isolated world and uses its globals:
// getEarmodeStatus, setVideoAudio, clearOverride, isOnVideoPage, t, currentLanguage,
// currentPlayerLook, normalizePlayerLook, SVG_NS.

const PLAYER_MENU_ID = 'em-player-menu';
const PLAYER_MENU_RETRY_MS = 500;
const PLAYER_MENU_MAX_RETRIES = 20;

const PLAYER_MENU_MODES = [
    { value: 'always', key: 'modeEverything' },
    { value: 'filtered', key: 'modeMyList' },
    { value: 'off', key: 'modeNothing' }
];

const PLAYER_MENU_LOOKS = [
    { value: 'card', key: 'lookCard' },
    { value: 'blur', key: 'lookBlur' },
    { value: 'minimal', key: 'lookSimple' },
    { value: 'waves', key: 'lookWaves' }
];

// Events that must not reach YouTube's player (pause, seek, fullscreen, keyboard shortcuts)
const PLAYER_MENU_BLOCKED_EVENTS = [
    'click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'dblclick',
    'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu'
];

// Icon shapes: [tag, attributes] per child of a 24x24 stroke SVG
const PLAYER_MENU_ICONS = {
    eye: [
        ['path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }],
        ['circle', { cx: '12', cy: '12', r: '3' }]
    ],
    headphones: [
        ['path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3' }],
        ['rect', { x: '3', y: '14', width: '5', height: '7', rx: '2' }],
        ['rect', { x: '16', y: '14', width: '5', height: '7', rx: '2' }]
    ]
};

/** Elements of the mounted button and menu, or null when not mounted */
let playerMenuEls = null;
let playerMenuOpen = false;
let playerMenuRetryTimer = null;

/**
 * Labels and pressed states for the in-player button and menu
 * @param {{ audio: boolean, reason: string }} status - From getEarmodeStatus()
 * @param {string} mode - 'always' | 'filtered' | 'off' (unknown values count as 'always')
 * @param {string} look - One of PLAYER_LOOKS (unknown values count as 'card')
 * @param {function(string): string} translate - Message lookup
 * @returns {object} Render model
 */
function menuModel(status, mode, look, translate) {
    const on = status?.audio === true;
    const activeMode = PLAYER_MENU_MODES.some(item => item.value === mode) ? mode : 'always';
    const activeLook = PLAYER_MENU_LOOKS.some(item => item.value === look) ? look : 'card';

    return {
        on,
        buttonText: `Earmode · ${translate(on ? 'nowAudio' : 'nowVideo')}`,
        titles: {
            thisVideo: translate('menuThisVideo'),
            autoListen: translate('menuAutoListen'),
            playerLook: translate('menuPlayerLook')
        },
        switchLabel: translate('switchLabel'),
        switchOptions: [
            { audio: false, label: translate('switchVideo'), pressed: !on },
            { audio: true, label: translate('switchAudio'), pressed: on }
        ],
        showBackToAuto: status?.reason === 'manual',
        backToAutoLabel: translate('backToAuto'),
        modes: PLAYER_MENU_MODES.map(item => ({
            value: item.value,
            label: translate(item.key),
            pressed: item.value === activeMode
        })),
        looks: PLAYER_MENU_LOOKS.map(item => ({
            value: item.value,
            label: translate(item.key),
            pressed: item.value === activeLook
        }))
    };
}

/**
 * Create an element with a class name
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function playerMenuEl(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
}

/**
 * Build a stroke icon as real SVG elements
 * @param {'eye'|'headphones'} name
 * @returns {SVGElement}
 */
function playerMenuIcon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const attrs = {
        width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'aria-hidden': 'true'
    };
    Object.entries(attrs).forEach(([key, value]) => svg.setAttribute(key, value));
    PLAYER_MENU_ICONS[name].forEach(([tag, shapeAttrs]) => {
        const shape = document.createElementNS(SVG_NS, tag);
        Object.entries(shapeAttrs).forEach(([key, value]) => shape.setAttribute(key, value));
        svg.appendChild(shape);
    });
    return svg;
}

/**
 * Keep an event away from YouTube's player; a user's Escape also closes the menu.
 * Synthetic Escapes (closeSettingsPopup dispatches them on the focused element) do not.
 * @param {Event} event
 */
function playerMenuShield(event) {
    if (event.type === 'keydown' && event.key === 'Escape' && playerMenuOpen && event.isTrusted) {
        event.preventDefault();
        setPlayerMenuOpen(false, true);
    }
    event.stopPropagation();
}

/**
 * Close the menu on clicks outside the button and menu (document capture listener).
 * Ignores synthetic clicks, like the quality fallback clicking the settings gear.
 * @param {Event} event
 */
function playerMenuOutsideClick(event) {
    if (!playerMenuEls || !event.isTrusted) return;
    const { button, menu, player } = playerMenuEls;
    if (button.contains(event.target) || menu.contains(event.target)) return;
    // A click on the video only dismisses the menu; it must not also toggle play
    if (player.contains(event.target)) {
        event.stopPropagation();
        event.preventDefault();
    }
    setPlayerMenuOpen(false, false);
}

/**
 * @returns {boolean} True when keyboard focus is on the button or inside the menu
 */
function playerMenuHasFocus() {
    if (!playerMenuEls) return false;
    const active = document.activeElement;
    return !!active && (playerMenuEls.button.contains(active) || playerMenuEls.menu.contains(active));
}

/**
 * Close on a user's Escape; focus returns to the button only if it was on the button or in the menu.
 * Ignores the synthetic Escapes closeSettingsPopup dispatches.
 * @param {KeyboardEvent} event
 */
function playerMenuDocumentKeydown(event) {
    if (!event.isTrusted || event.key !== 'Escape' || !playerMenuOpen) return;
    // This Escape only closes the menu; YouTube should not also act on it
    event.preventDefault();
    event.stopPropagation();
    setPlayerMenuOpen(false, playerMenuHasFocus());
}

/**
 * Open or close the menu
 * @param {boolean} open
 * @param {boolean} returnFocus - Move focus back to the button when closing
 */
function setPlayerMenuOpen(open, returnFocus) {
    const next = !!open && !!playerMenuEls;
    if (next !== playerMenuOpen) {
        playerMenuOpen = next;
        if (next) {
            document.addEventListener('click', playerMenuOutsideClick, true);
            document.addEventListener('keydown', playerMenuDocumentKeydown, true);
        } else {
            document.removeEventListener('click', playerMenuOutsideClick, true);
            document.removeEventListener('keydown', playerMenuDocumentKeydown, true);
        }
    }
    renderPlayerMenu();
    if (!next && returnFocus && playerMenuEls) playerMenuEls.button.focus();
}

/**
 * Save one sync setting; content.js and the popup react through storage.onChanged
 * @param {object} items
 */
function savePlayerMenuSetting(items) {
    try {
        chrome.storage.sync.set(items)?.catch?.(error => {
            console.log('[Earmode] Could not save setting from player menu:', error);
        });
    } catch (error) {
        console.log('[Earmode] Could not save setting from player menu:', error);
    }
}

/**
 * Switch handler: clicking the side that already plays does nothing unless it was a manual pick
 * @param {boolean} audio
 */
function onPlayerMenuSwitch(audio) {
    const status = getEarmodeStatus();
    if (!status.onVideo) return;
    if (status.audio === audio && status.reason !== 'manual') return;
    setVideoAudio(audio);
}

/**
 * @param {string} mode
 */
function onPlayerMenuMode(mode) {
    if (mode === getEarmodeStatus().mode) return;
    savePlayerMenuSetting({ audioModeType: mode });
}

/**
 * @param {string} look
 */
function onPlayerMenuLook(look) {
    if (look === currentPlayerLook) return;
    savePlayerMenuSetting({ playerLook: look });
}

/**
 * Build a titled block for the menu
 * @param {string} titleId
 * @param {HTMLElement} body
 * @returns {{ block: HTMLElement, title: HTMLElement }}
 */
function buildPlayerMenuBlock(titleId, body) {
    const block = playerMenuEl('div', 'em-pm-block');
    const title = playerMenuEl('span', 'em-pm-title');
    title.id = titleId;
    body.setAttribute('role', 'group');
    body.setAttribute('aria-labelledby', titleId);
    block.appendChild(title);
    block.appendChild(body);
    return { block, title };
}

/**
 * Create the button and menu elements (not attached)
 * @returns {object} Element references used by renderPlayerMenu
 */
function buildPlayerMenu() {
    const button = playerMenuEl('button', 'em-player-btn');
    button.setAttribute('type', 'button');
    button.setAttribute('aria-controls', PLAYER_MENU_ID);
    button.setAttribute('aria-expanded', 'false');
    const led = playerMenuEl('span', 'em-pm-led');
    led.setAttribute('aria-hidden', 'true');
    const label = playerMenuEl('span', 'em-pm-label');
    button.appendChild(led);
    button.appendChild(label);
    button.addEventListener('click', () => setPlayerMenuOpen(!playerMenuOpen, false));

    const menu = playerMenuEl('div', 'em-player-menu');
    menu.id = PLAYER_MENU_ID;
    menu.hidden = true;

    // This video: Video | Audio switch + Back to auto
    const switchBox = playerMenuEl('div', 'em-pm-switch');
    const knob = playerMenuEl('span', 'em-pm-knob');
    knob.setAttribute('aria-hidden', 'true');
    switchBox.appendChild(knob);
    const switchButtons = [
        { audio: false, icon: 'eye', className: 'em-pm-opt em-pm-opt-video' },
        { audio: true, icon: 'headphones', className: 'em-pm-opt em-pm-opt-audio' }
    ].map(({ audio, icon, className }) => {
        const option = playerMenuEl('button', className);
        option.setAttribute('type', 'button');
        option.appendChild(playerMenuIcon(icon));
        const text = playerMenuEl('b');
        option.appendChild(text);
        option.addEventListener('click', () => onPlayerMenuSwitch(audio));
        switchBox.appendChild(option);
        return { option, text };
    });
    const thisVideo = buildPlayerMenuBlock('em-pm-title-video', switchBox);
    const backToAuto = playerMenuEl('button', 'em-pm-back');
    backToAuto.setAttribute('type', 'button');
    backToAuto.hidden = true;
    backToAuto.addEventListener('click', () => clearOverride());
    thisVideo.block.appendChild(backToAuto);

    // Auto-listen: Everything | My list | Nothing
    const seg = playerMenuEl('div', 'em-pm-seg');
    const modeButtons = PLAYER_MENU_MODES.map(({ value }) => {
        const modeButton = playerMenuEl('button', 'em-pm-mode');
        modeButton.setAttribute('type', 'button');
        modeButton.addEventListener('click', () => onPlayerMenuMode(value));
        seg.appendChild(modeButton);
        return modeButton;
    });
    const autoListen = buildPlayerMenuBlock('em-pm-title-auto', seg);

    // Player look tiles
    const looks = playerMenuEl('div', 'em-pm-looks');
    const lookButtons = PLAYER_MENU_LOOKS.map(({ value }) => {
        const lookButton = playerMenuEl('button', 'em-pm-look');
        lookButton.setAttribute('type', 'button');
        const swatch = playerMenuEl('span', `em-pm-sw em-pm-sw-${value}`);
        swatch.setAttribute('aria-hidden', 'true');
        const text = playerMenuEl('span');
        lookButton.appendChild(swatch);
        lookButton.appendChild(text);
        lookButton.addEventListener('click', () => onPlayerMenuLook(value));
        looks.appendChild(lookButton);
        return { lookButton, text };
    });
    const playerLook = buildPlayerMenuBlock('em-pm-title-look', looks);

    menu.appendChild(thisVideo.block);
    menu.appendChild(autoListen.block);
    menu.appendChild(playerLook.block);

    PLAYER_MENU_BLOCKED_EVENTS.forEach(type => {
        // Only keydown may call preventDefault (Escape); the rest can be passive
        const options = type === 'keydown' ? false : { passive: true };
        button.addEventListener(type, playerMenuShield, options);
        menu.addEventListener(type, playerMenuShield, options);
    });

    return {
        button, label, menu, switchBox, switchButtons, backToAuto, modeButtons, lookButtons,
        titles: { thisVideo: thisVideo.title, autoListen: autoListen.title, playerLook: playerLook.title }
    };
}

/**
 * Update the mounted button and menu from the current state and language
 */
function renderPlayerMenu() {
    const els = playerMenuEls;
    if (!els) return;

    const status = getEarmodeStatus();
    const model = menuModel(status, status.mode, currentPlayerLook, t);
    const dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';

    els.button.setAttribute('dir', dir);
    els.button.dataset.on = String(model.on);
    els.button.setAttribute('aria-expanded', String(playerMenuOpen));
    els.label.textContent = model.buttonText;

    els.menu.setAttribute('dir', dir);
    els.menu.setAttribute('aria-label', 'Earmode');
    els.menu.hidden = !playerMenuOpen;

    els.titles.thisVideo.textContent = model.titles.thisVideo;
    els.titles.autoListen.textContent = model.titles.autoListen;
    els.titles.playerLook.textContent = model.titles.playerLook;

    els.switchBox.dataset.on = String(model.on);
    els.switchBox.setAttribute('aria-label', model.switchLabel);
    model.switchOptions.forEach((item, index) => {
        const { option, text } = els.switchButtons[index];
        text.textContent = item.label;
        option.setAttribute('aria-pressed', String(item.pressed));
    });
    els.backToAuto.hidden = !model.showBackToAuto;
    els.backToAuto.textContent = model.backToAutoLabel;

    model.modes.forEach((item, index) => {
        els.modeButtons[index].textContent = item.label;
        els.modeButtons[index].setAttribute('aria-pressed', String(item.pressed));
    });
    model.looks.forEach((item, index) => {
        const { lookButton, text } = els.lookButtons[index];
        text.textContent = item.label;
        lookButton.setAttribute('aria-pressed', String(item.pressed));
    });
}

/**
 * Detach the button and menu
 */
function removePlayerMenu() {
    if (!playerMenuEls) return;
    setPlayerMenuOpen(false, false);
    playerMenuEls.button.remove();
    playerMenuEls.menu.remove();
    playerMenuEls = null;
}

/**
 * Attach the button and menu to the player once, then render them.
 * Removes them when the page is not a video page.
 * @returns {boolean} True when the menu is mounted
 */
function ensurePlayerMenu() {
    if (!isOnVideoPage()) {
        removePlayerMenu();
        return false;
    }

    const moviePlayer = document.querySelector('#movie_player');
    const player = moviePlayer || document.querySelector('#player-container');
    if (!player) return false;

    const existing = player.querySelector('.em-player-btn');
    if (!existing || !playerMenuEls || existing !== playerMenuEls.button) {
        // Stale copies (e.g. a replaced player or an earlier fallback container)
        removePlayerMenu();
        ['.em-player-btn', '.em-player-menu'].forEach(selector => {
            player.querySelectorAll(selector).forEach(el => el.remove());
        });
        playerMenuEls = buildPlayerMenu();
        playerMenuEls.player = player;
        playerMenuEls.onFallback = !moviePlayer;
        player.appendChild(playerMenuEls.button);
        player.appendChild(playerMenuEls.menu);
    }

    renderPlayerMenu();
    return true;
}

/**
 * Mount the menu, retrying briefly while YouTube builds the player.
 * Keeps retrying while mounted on the #player-container fallback so it can move into #movie_player.
 * @param {number} [attempt]
 */
function schedulePlayerMenu(attempt = 0) {
    if (playerMenuRetryTimer) {
        clearTimeout(playerMenuRetryTimer);
        playerMenuRetryTimer = null;
    }
    const mounted = ensurePlayerMenu();
    if ((mounted && !playerMenuEls.onFallback) || !isOnVideoPage() || attempt >= PLAYER_MENU_MAX_RETRIES) return;
    playerMenuRetryTimer = setTimeout(() => schedulePlayerMenu(attempt + 1), PLAYER_MENU_RETRY_MS);
}

document.addEventListener('yt-navigate-finish', () => schedulePlayerMenu());
window.addEventListener('earmode:state', () => ensurePlayerMenu());

// Reflect changes made in the popup or options page
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.audioModeType || changes.playerLook)) {
        renderPlayerMenu();
    }
});

schedulePlayerMenu();
