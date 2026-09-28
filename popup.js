// Earmode popup: the Video | Audio switch, auto-listen mode, player look and a stats line.
// Depends on shared.js (globalThis.Earmode).

const {
    t,
    loadMessages,
    getLanguage,
    VALID_MODE_TYPES,
    VALID_LANGUAGES,
    PLAYER_LOOKS,
    getDefaultFilterRules,
    sanitizeFilterRules,
    sumMonthSeconds,
    savedMegabytes,
    formatSavedAmount,
    modeHint,
    videoChannels,
    channelsInList,
    toggleChannels
} = globalThis.Earmode;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;
const SWITCH_REFRESH_MS = 300;
const RULES_REFRESH_MS = 600;
const TOAST_MS = 1800;

const REASON_KEYS = {
    manual: 'reasonManual',
    all: 'reasonAll',
    inList: 'reasonInList',
    notInList: 'reasonNotInList',
    none: 'reasonNone'
};

const $ = id => document.getElementById(id);

const els = {
    langBtn: $('lang-btn'),
    gearBtn: $('gear-btn'),
    switchBox: $('switch'),
    switchButtons: [$('switch-video'), $('switch-audio')],
    statePill: $('state-pill'),
    stateText: $('state-text'),
    backToAuto: $('back-to-auto'),
    channel: $('channel'),
    channelAvatar: $('channel-avatar'),
    channelName: $('channel-name'),
    channelAdd: $('channel-add'),
    modeButtons: [...document.querySelectorAll('#mode-seg button')],
    modeHint: $('mode-hint'),
    lookButtons: [...document.querySelectorAll('#looks .look')],
    stats: $('stats'),
    statsText: $('stats-text'),
    statsGo: $('stats-go'),
    toast: $('toast')
};

/**
 * Popup state. `tab` is the active tab; `onWatch` is true for youtube.com/watch URLs.
 * `status` comes from the content script's getStatus; `contentMissing` is set when it never answers.
 */
const state = {
    tab: null,
    onWatch: false,
    status: null,
    contentMissing: false,
    videoInfo: null,
    mode: 'always',
    look: 'card',
    filterRules: getDefaultFilterRules(),
    statsLogs: {}
};

let statusRefreshTimer = null;
let toastTimer = null;
let channelWritePending = false;

// ---------- messaging ----------

/**
 * Send a message to the active tab's content script.
 * @param {object} message
 * @returns {Promise<*>} The response, or undefined when nothing answers.
 */
async function sendToTab(message) {
    if (!state.tab?.id) return undefined;
    try {
        return await chrome.tabs.sendMessage(state.tab.id, message);
    } catch (error) {
        return undefined;
    }
}

/**
 * Send a message, retrying while the response is not complete yet (page still loading).
 * @param {object} message
 * @param {function(*): boolean} isComplete
 * @returns {Promise<*>} The last response received.
 */
async function sendWithRetry(message, isComplete) {
    let response;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        response = await sendToTab(message);
        if (isComplete(response)) return response;
    }
    return response;
}

/**
 * Ask the content script for the current status and re-render.
 */
async function refreshStatus() {
    if (!state.onWatch) return;
    const status = await sendToTab({ action: 'getStatus' });
    if (status) {
        state.status = status;
        state.contentMissing = false;
        render();
    }
}

/**
 * Re-query status after a delay, collapsing repeated calls into one.
 * @param {number} delay
 */
function scheduleStatusRefresh(delay) {
    clearTimeout(statusRefreshTimer);
    statusRefreshTimer = setTimeout(refreshStatus, delay);
}

// ---------- language ----------

/**
 * Load messages for a language, set direction and fill every [data-i18n] element.
 * @param {string} lang
 */
async function applyLanguage(lang) {
    await loadMessages(lang);
    const current = getLanguage();
    const isArabic = current === 'ar';

    document.documentElement.lang = current;
    document.body.dir = isArabic ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });

    els.langBtn.textContent = isArabic ? 'EN' : 'ع';
    els.langBtn.title = t('languageLabel');
    els.langBtn.setAttribute('aria-label', t('languageLabel'));
    els.gearBtn.title = t('settingsLabel');
    els.gearBtn.setAttribute('aria-label', t('settingsLabel'));
    els.statsGo.textContent = isArabic ? '‹' : '›';
}

// ---------- rendering ----------

/**
 * Set text only when it differs, so the aria-live state line is not re-announced.
 * @param {HTMLElement} el
 * @param {string} text
 */
function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
}

/**
 * Pick a stable avatar colour from a channel name.
 * @param {string} name
 * @returns {string}
 */
function avatarColor(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return `hsl(${hash % 360}, 55%, 45%)`;
}

function renderSwitch() {
    const enabled = state.onWatch && !!state.status?.onVideo;
    const on = enabled && state.status.audio === true;

    els.switchBox.dataset.on = String(on);
    els.switchBox.dataset.disabled = String(!enabled);
    els.switchButtons.forEach(button => {
        const isAudio = button.dataset.audio === 'true';
        button.disabled = !enabled;
        button.setAttribute('aria-pressed', String(enabled && isAudio === on));
    });
}

function renderState() {
    const showMessage = key => {
        els.statePill.hidden = true;
        els.backToAuto.hidden = true;
        setText(els.stateText, key ? t(key) : '');
    };

    if (!state.onWatch) return showMessage('noVideoSwitch');
    if (state.contentMissing) return showMessage('reloadTab');
    if (!state.status) return showMessage('');
    if (!state.status.onVideo) return showMessage('noVideoSwitch');

    els.statePill.hidden = false;
    setText(els.statePill, t(state.status.audio ? 'nowAudio' : 'nowVideo'));
    setText(els.stateText, t(REASON_KEYS[state.status.reason] || 'reasonNone'));
    els.backToAuto.hidden = state.status.reason !== 'manual';
}

function renderChannel() {
    const channels = videoChannels(state.videoInfo);
    if (!state.onWatch || state.contentMissing || channels.length === 0) {
        els.channel.hidden = true;
        return;
    }

    const name = channels.map(channel => channel.name).join(', ');
    const inList = channelsInList(state.filterRules, channels);

    els.channel.hidden = false;
    els.channelAvatar.textContent = Array.from(channels[0].name.trim())[0]?.toUpperCase() || '?';
    els.channelAvatar.style.background = avatarColor(channels[0].name);
    els.channelName.textContent = name;
    els.channelName.title = name;
    els.channelAdd.dataset.in = String(inList);
    els.channelAdd.setAttribute('aria-pressed', String(inList));
    els.channelAdd.textContent = t(inList ? 'inYourList' : 'alwaysListen');
    els.channelAdd.disabled = channelWritePending;
}

function renderMode() {
    els.modeButtons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    });

    els.modeHint.textContent = modeHint(state.mode, state.filterRules.whitelist.channels.length, t);
}

function renderLooks() {
    els.lookButtons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.look === state.look));
    });
}

function renderStats() {
    const amount = formatSavedAmount(savedMegabytes(sumMonthSeconds(state.statsLogs)), t);
    const [before, after = ''] = t('savedThisMonth').split('{amount}');
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = amount;
    els.statsText.replaceChildren(before, num, after);
}

function render() {
    renderSwitch();
    renderState();
    renderChannel();
    renderMode();
    renderLooks();
    renderStats();
}

// ---------- toast ----------

/**
 * @param {string} message
 */
function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, TOAST_MS);
}

// ---------- actions ----------

/**
 * Write to sync storage; on failure run `restore`, re-render and show an error toast.
 * @param {object} items
 * @param {function(): void} restore Puts the previous popup state back
 * @returns {Promise<boolean>} True when the write succeeded
 */
async function saveSync(items, restore) {
    try {
        await chrome.storage.sync.set(items);
        return true;
    } catch (error) {
        console.error('[Earmode] Failed to save settings:', error);
        restore();
        render();
        showToast(t('saveFailed'));
        return false;
    }
}

/**
 * @param {boolean} audio
 */
async function setVideoAudio(audio) {
    if (!state.status?.onVideo) return;
    // Clicking the side that is already playing does nothing unless it was a manual pick
    if (state.status.audio === audio && state.status.reason !== 'manual') return;
    state.status = { ...state.status, audio, reason: 'manual', override: audio };
    render();
    await sendToTab({ action: 'setVideoAudio', audio });
    scheduleStatusRefresh(SWITCH_REFRESH_MS);
}

async function backToAuto() {
    await sendToTab({ action: 'clearOverride' });
    scheduleStatusRefresh(SWITCH_REFRESH_MS);
}

async function toggleCurrentChannels() {
    const channels = videoChannels(state.videoInfo);
    if (channels.length === 0 || channelWritePending) return;

    channelWritePending = true;
    const previousRules = state.filterRules;
    try {
        const { filterRules } = await chrome.storage.sync.get(['filterRules']);
        const wasInList = channelsInList(filterRules, channels);
        state.filterRules = toggleChannels(filterRules, channels, Date.now());
        render();

        const saved = await saveSync({ filterRules: state.filterRules }, () => {
            state.filterRules = previousRules;
        });
        if (saved) {
            showToast(t(wasInList ? 'removedFromList' : 'addedToList'));
            scheduleStatusRefresh(RULES_REFRESH_MS);
        }
    } catch (error) {
        console.error('[Earmode] Failed to read the channel list:', error);
        showToast(t('saveFailed'));
    } finally {
        channelWritePending = false;
        render();
    }
}

/**
 * @param {string} mode 'always' | 'filtered' | 'off'
 */
async function selectMode(mode) {
    if (!VALID_MODE_TYPES.has(mode) || mode === state.mode) return;
    const previousMode = state.mode;
    state.mode = mode;
    render();
    const saved = await saveSync({ audioModeType: mode }, () => {
        state.mode = previousMode;
    });
    if (!saved) return;
    await sendToTab({ action: 'modeChanged', mode });
    scheduleStatusRefresh(RULES_REFRESH_MS);
}

/**
 * @param {string} look
 */
async function selectLook(look) {
    if (!PLAYER_LOOKS.includes(look) || look === state.look) return;
    const previousLook = state.look;
    state.look = look;
    render();
    const saved = await saveSync({ playerLook: look }, () => {
        state.look = previousLook;
    });
    if (saved) await sendToTab({ action: 'playerLookChanged', look });
}

async function toggleLanguage() {
    const lang = getLanguage() === 'ar' ? 'en' : 'ar';
    const saved = await saveSync({ language: lang }, () => { });
    if (!saved) return;
    await applyLanguage(lang);
    render();
    await sendToTab({ action: 'updateLanguage', language: lang });
}

async function openStats() {
    try {
        await chrome.storage.session?.set({ optionsSection: 'stats' });
    } catch (error) {
        // The options page opens on its default section
    }
    chrome.runtime.openOptionsPage().catch(() => { });
}

// ---------- wiring ----------

els.switchButtons.forEach(button => {
    button.addEventListener('click', () => setVideoAudio(button.dataset.audio === 'true'));
});
els.backToAuto.addEventListener('click', backToAuto);
els.channelAdd.addEventListener('click', toggleCurrentChannels);
els.modeButtons.forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
});
els.lookButtons.forEach(button => {
    button.addEventListener('click', () => selectLook(button.dataset.look));
});
els.langBtn.addEventListener('click', toggleLanguage);
els.gearBtn.addEventListener('click', () => chrome.runtime.openOptionsPage().catch(() => { }));
els.stats.addEventListener('click', openStats);

// Live status pushed by the content script whenever the video's state changes
chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.action !== 'earmodeState' || !message.status) return;
    if (!state.tab?.id || sender.tab?.id !== state.tab.id) return;
    state.status = message.status;
    state.contentMissing = false;
    render();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        let rerender = false;
        if (changes.audioModeType) {
            const mode = changes.audioModeType.newValue;
            state.mode = VALID_MODE_TYPES.has(mode) ? mode : 'always';
            rerender = true;
        }
        if (changes.playerLook) {
            const look = changes.playerLook.newValue;
            state.look = PLAYER_LOOKS.includes(look) ? look : 'card';
            rerender = true;
        }
        if (changes.filterRules) {
            state.filterRules = sanitizeFilterRules(changes.filterRules.newValue);
            rerender = true;
        }
        if (rerender) render();
        if (changes.audioModeType || changes.filterRules) scheduleStatusRefresh(RULES_REFRESH_MS);
    } else if (namespace === 'local' && changes.statsLogs) {
        state.statsLogs = changes.statsLogs.newValue || {};
        renderStats();
    }
});

async function init() {
    const sync = await chrome.storage.sync.get(['language', 'audioModeType', 'playerLook', 'filterRules']);
    const local = await chrome.storage.local.get(['statsLogs']);

    const uiLang = chrome.i18n.getUILanguage().startsWith('ar') ? 'ar' : 'en';
    state.mode = VALID_MODE_TYPES.has(sync.audioModeType) ? sync.audioModeType : 'always';
    state.look = PLAYER_LOOKS.includes(sync.playerLook) ? sync.playerLook : 'card';
    state.filterRules = sanitizeFilterRules(sync.filterRules);
    state.statsLogs = local.statsLogs || {};

    await applyLanguage(VALID_LANGUAGES.has(sync.language) ? sync.language : uiLang);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tab = tab || null;
    state.onWatch = /^https:\/\/(www\.)?youtube\.com\/watch/.test(tab?.url || '');
    render();

    if (!state.onWatch) return;

    const [status, videoInfo] = await Promise.all([
        sendWithRetry({ action: 'getStatus' }, response => !!response),
        sendWithRetry({ action: 'getVideoInfo' }, response => !!response?.channelName)
    ]);

    state.status = status || null;
    state.contentMissing = !status;
    state.videoInfo = videoInfo?.channelName ? videoInfo : null;
    render();
}

init();
