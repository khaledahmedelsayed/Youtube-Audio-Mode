// Earmode options page: listening, your list, video quality, stats, backup and language.
// Depends on shared.js (globalThis.Earmode).

const {
    t,
    loadMessages,
    getLanguage,
    DEFAULT_BACKGROUND_COLOR,
    SETTINGS_EXPORT_KEYS,
    VALID_MODE_TYPES,
    VALID_LANGUAGES,
    VALID_QUALITY_VALUES,
    PLAYER_LOOKS,
    ACCENT_PRESETS,
    DEFAULT_ACCENT,
    normalizeAccent,
    applyAccent,
    getDefaultFilterRules,
    sanitizeFilterRules,
    validateImportedSettings,
    buildExportPayload,
    exportFileName,
    summarizeStats,
    formatDuration,
    formatSavedAmount,
    fillTemplate,
    modeHint,
    addKeyword,
    removeKeyword,
    removeChannel
} = globalThis.Earmode;

// Accent color before anything renders; follows changes from other pages
globalThis.Earmode.watchAccent(document.documentElement);

const TOAST_MS = 2000;
const DEFAULT_QUALITY = 'hd720';
const YOUTUBE_TABS = 'https://www.youtube.com/*';
const SECTION_IDS = new Set(['listening', 'list', 'quality', 'stats', 'backup', 'language']);

const $ = id => document.getElementById(id);

const els = {
    modeButtons: [...document.querySelectorAll('#mode-seg button')],
    modeHint: $('mode-hint'),
    lookButtons: [...document.querySelectorAll('#looks .look')],
    accents: $('accents'),
    accentButtons: [],
    bgColor: $('bg-color'),
    bgValue: $('bg-value'),
    playerButtonToggle: $('player-button-toggle'),
    channelsList: $('channels-list'),
    channelsEmpty: $('channels-empty'),
    keywordInput: $('keyword-input'),
    keywordAdd: $('keyword-add'),
    keywordsList: $('keywords-list'),
    keywordsEmpty: $('keywords-empty'),
    qualitySelect: $('quality-select'),
    rangeButtons: [...document.querySelectorAll('#range-seg button')],
    statSaved: $('stat-saved'),
    statListened: $('stat-listened'),
    statActive: $('stat-active'),
    usage144: $('usage-144'),
    usage720: $('usage-720'),
    usage1080: $('usage-1080'),
    saved720: $('saved-720'),
    saved1080: $('saved-1080'),
    exportBtn: $('export-btn'),
    importBtn: $('import-btn'),
    importFile: $('import-file'),
    langButtons: [...document.querySelectorAll('#lang-seg button')],
    toast: $('toast')
};

/** Page state, kept in step with storage through chrome.storage.onChanged. */
const state = {
    mode: 'always',
    look: 'card',
    accent: DEFAULT_ACCENT,
    background: DEFAULT_BACKGROUND_COLOR,
    showPlayerButton: true,
    quality: DEFAULT_QUALITY,
    filterRules: getDefaultFilterRules(),
    statsLogs: {},
    activeLogs: {},
    range: 'month'
};

let toastTimer = null;

// ---------- helpers ----------

/**
 * @param {string} message
 */
function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), TOAST_MS);
}

/**
 * Write to sync storage; on failure run `restore`, re-render and show an error toast.
 * @param {object} items
 * @param {function(): void} [restore] Puts the previous page state back
 * @returns {Promise<boolean>} True when the write succeeded
 */
async function saveSync(items, restore = () => { }) {
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
 * Send a message to every open YouTube tab. Tabs without the content script are ignored.
 * @param {object} message
 */
async function sendToYouTubeTabs(message) {
    try {
        const tabs = await chrome.tabs.query({ url: YOUTUBE_TABS });
        await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, message).catch(() => { })));
    } catch (error) {
        // No tabs to update
    }
}

/**
 * @param {string} type Stored backgroundType
 * @param {string} value Stored backgroundValue
 * @returns {string} A #rrggbb colour, or the default.
 */
function backgroundFrom(type, value) {
    return type === 'color' && /^#[0-9a-f]{6}$/i.test(value || '') ? value : DEFAULT_BACKGROUND_COLOR;
}

/**
 * Build a remove button for a list row.
 * @param {string} name Shown in the accessible label
 * @param {function(): void} onClick
 * @returns {HTMLButtonElement}
 */
function removeButton(name, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-small';
    button.textContent = t('remove');
    button.setAttribute('aria-label', fillTemplate(t('removeItem'), { name }));
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Build a list row.
 * @param {string} title
 * @param {HTMLButtonElement} button
 * @returns {HTMLLIElement}
 */
function ruleRow(title, button) {
    const item = document.createElement('li');
    item.className = 'rule';
    const text = document.createElement('span');
    text.className = 'rule-text';
    const bold = document.createElement('b');
    bold.textContent = title;
    bold.title = title;
    text.append(bold);
    item.append(text, button);
    return item;
}

// ---------- language ----------

/**
 * Load messages for a language, set direction and fill every [data-i18n] element.
 * @param {string} lang
 */
async function applyLanguage(lang) {
    await loadMessages(lang);
    const current = getLanguage();

    document.documentElement.lang = current;
    document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
    document.title = `Earmode: ${t('settingsLabel')}`;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
}

// ---------- rendering ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build one round swatch button per accent preset (labels are set in renderListening).
 * @returns {HTMLButtonElement[]}
 */
function buildAccentButtons() {
    return ACCENT_PRESETS.map(preset => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'accent';
        button.dataset.accent = preset.id;
        button.setAttribute('aria-pressed', 'false');
        button.style.setProperty('--swatch', preset.color);
        button.style.setProperty('--swatch-ink', preset.ink);

        // Check mark, shown on the selected swatch
        const svg = document.createElementNS(SVG_NS, 'svg');
        const attrs = {
            width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            'stroke-width': '3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
        };
        Object.entries(attrs).forEach(([name, value]) => svg.setAttribute(name, value));
        const check = document.createElementNS(SVG_NS, 'path');
        check.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
        svg.appendChild(check);
        button.appendChild(svg);

        button.addEventListener('click', () => selectAccent(preset.id));
        return button;
    });
}

/**
 * @param {HTMLElement[]} buttons
 * @param {string} key dataset key
 * @param {string} value selected value
 */
function setPressed(buttons, key, value) {
    buttons.forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset[key] === value));
    });
}

function renderListening() {
    setPressed(els.modeButtons, 'mode', state.mode);
    els.modeHint.textContent = modeHint(state.mode, state.filterRules.whitelist.channels.length, t);
    setPressed(els.lookButtons, 'look', state.look);
    setPressed(els.accentButtons, 'accent', state.accent);
    els.accentButtons.forEach((button, index) => {
        const name = t(ACCENT_PRESETS[index].nameKey);
        button.setAttribute('aria-label', name);
        button.title = name;
    });
    applyAccent(document.documentElement, state.accent);
    if (document.activeElement !== els.bgColor) els.bgColor.value = state.background;
    els.bgValue.textContent = els.bgColor.value;
    els.playerButtonToggle.checked = state.showPlayerButton;
}

function renderList() {
    const { channels, keywords } = state.filterRules.whitelist;

    els.channelsList.replaceChildren(...channels.map(channel => (
        ruleRow(channel.name, removeButton(channel.name, () => deleteChannel(channel.id)))
    )));
    els.channelsEmpty.hidden = channels.length > 0;

    els.keywordsList.replaceChildren(...keywords.map(item => (
        ruleRow(item.keyword, removeButton(item.keyword, () => deleteKeyword(item.keyword)))
    )));
    els.keywordsEmpty.hidden = keywords.length > 0;
}

function renderQuality() {
    els.qualitySelect.value = state.quality;
}

/**
 * Show a signed amount in a left-to-right span so the sign stays with the number in Arabic.
 * @param {HTMLElement} el
 * @param {string} text
 */
function setIsolated(el, text) {
    const span = document.createElement('span');
    span.dir = 'ltr';
    span.className = 'num';
    span.textContent = text;
    el.replaceChildren(span);
}

function renderStats() {
    const stats = summarizeStats(state.statsLogs, state.activeLogs, state.range, new Date());
    const amount = mb => formatSavedAmount(mb, t);

    setPressed(els.rangeButtons, 'range', state.range);
    els.statSaved.textContent = amount(stats.saved720);
    els.statListened.textContent = formatDuration(stats.listenedSeconds, t);
    els.statActive.textContent = formatDuration(stats.activeSeconds, t);
    els.usage144.textContent = amount(stats.usage144);
    els.usage720.textContent = amount(stats.usage720);
    els.usage1080.textContent = amount(stats.usage1080);
    setIsolated(els.saved720, `+${amount(stats.saved720)}`);
    setIsolated(els.saved1080, `+${amount(stats.saved1080)}`);
}

function renderLanguage() {
    setPressed(els.langButtons, 'lang', getLanguage());
}

function render() {
    renderListening();
    renderList();
    renderQuality();
    renderStats();
    renderLanguage();
}

// ---------- actions ----------

/**
 * @param {string} mode 'always' | 'filtered' | 'off'
 */
async function selectMode(mode) {
    if (!VALID_MODE_TYPES.has(mode) || mode === state.mode) return;
    const previous = state.mode;
    state.mode = mode;
    render();
    await saveSync({ audioModeType: mode }, () => { state.mode = previous; });
}

/**
 * @param {string} look
 */
async function selectLook(look) {
    if (!PLAYER_LOOKS.includes(look) || look === state.look) return;
    const previous = state.look;
    state.look = look;
    render();
    await saveSync({ playerLook: look }, () => { state.look = previous; });
}

/**
 * @param {string} accent Preset id
 */
async function selectAccent(accent) {
    if (normalizeAccent(accent) !== accent || accent === state.accent) return;
    const previous = state.accent;
    state.accent = accent;
    render();
    await saveSync({ accentColor: accent }, () => { state.accent = previous; });
}

/**
 * @param {boolean} show
 */
async function selectShowPlayerButton(show) {
    if (show === state.showPlayerButton) return;
    const previous = state.showPlayerButton;
    state.showPlayerButton = show;
    render();
    await saveSync({ showPlayerButton: show }, () => { state.showPlayerButton = previous; });
}

/** Live preview while dragging the colour picker; no storage write. */
function previewBackground() {
    els.bgValue.textContent = els.bgColor.value;
    sendToYouTubeTabs({ action: 'updateTheme', backgroundType: 'color', backgroundValue: els.bgColor.value });
}

/** Undo the live preview when the picker loses focus without saving. */
function revertBackgroundPreview() {
    if (els.bgColor.value === state.background) return;
    els.bgColor.value = state.background;
    els.bgValue.textContent = state.background;
    sendToYouTubeTabs({ action: 'updateTheme', backgroundType: 'color', backgroundValue: state.background });
}

/** Save the picked colour once the picker closes. */
async function saveBackground() {
    const color = els.bgColor.value;
    if (color === state.background) return;
    const previous = state.background;
    state.background = color;
    const saved = await saveSync({ backgroundType: 'color', backgroundValue: color }, () => {
        state.background = previous;
    });
    sendToYouTubeTabs({ action: 'updateTheme', backgroundType: 'color', backgroundValue: state.background });
    if (!saved) els.bgColor.value = state.background;
    renderListening();
}

/**
 * Read the latest rules, apply `change` and save.
 * @param {function(object): object} change Returns the new rules; must not mutate its input
 * @returns {Promise<{current: object, next: object}|null>} Rules before and after, or null on failure
 */
async function updateRules(change) {
    const previous = state.filterRules;
    try {
        const { filterRules } = await chrome.storage.sync.get(['filterRules']);
        const current = sanitizeFilterRules(filterRules);
        const next = change(current);
        state.filterRules = next;
        render();
        await chrome.storage.sync.set({ filterRules: next });
        return { current, next };
    } catch (error) {
        console.error('[Earmode] Failed to save the list:', error);
        state.filterRules = previous;
        render();
        showToast(t('saveFailed'));
        return null;
    }
}

async function submitKeyword() {
    const text = els.keywordInput.value.trim();
    if (!text) {
        els.keywordInput.focus();
        return;
    }
    const result = await updateRules(rules => addKeyword(rules, text, Date.now()));
    if (!result) return;
    els.keywordInput.value = '';
    const added = result.next.whitelist.keywords.length > result.current.whitelist.keywords.length;
    showToast(t(added ? 'addedToList' : 'alreadyInList'));
}

/**
 * @param {string} keyword
 */
async function deleteKeyword(keyword) {
    const result = await updateRules(rules => removeKeyword(rules, keyword));
    if (result) {
        showToast(t('removedFromList'));
        els.keywordInput.focus();
    }
}

/**
 * @param {string} channelId
 */
async function deleteChannel(channelId) {
    const result = await updateRules(rules => removeChannel(rules, channelId));
    if (result) showToast(t('removedFromList'));
}

async function selectQuality() {
    const quality = els.qualitySelect.value;
    if (!VALID_QUALITY_VALUES.has(quality) || quality === state.quality) return;
    const previous = state.quality;
    state.quality = quality;
    await saveSync({ preferredQuality: quality }, () => { state.quality = previous; });
}

/**
 * @param {string} range 'month' | 'all'
 */
function selectRange(range) {
    state.range = range === 'all' ? 'all' : 'month';
    renderStats();
}

/**
 * Save the language; the storage listener applies it to the page.
 * @param {string} lang
 */
async function selectLanguage(lang) {
    if (!VALID_LANGUAGES.has(lang) || lang === getLanguage()) return;
    if (!await saveSync({ language: lang })) return;
    sendToYouTubeTabs({ action: 'updateLanguage', language: lang });
}

async function exportSettings() {
    const settings = await chrome.storage.sync.get(SETTINGS_EXPORT_KEYS);
    const payload = buildExportPayload(settings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = exportFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(t('settingsExported'));
}

/**
 * Write the validated settings; the storage listener updates the page.
 * @param {File} file
 */
async function importSettings(file) {
    const settings = validateImportedSettings(JSON.parse(await file.text()));
    await chrome.storage.sync.set(settings);

    if (settings.language) {
        sendToYouTubeTabs({ action: 'updateLanguage', language: settings.language });
    }
    if (settings.backgroundType) {
        sendToYouTubeTabs({
            action: 'updateTheme',
            backgroundType: settings.backgroundType,
            backgroundValue: settings.backgroundValue
        });
    }
    showToast(t('settingsImported'));
}

// ---------- loading ----------

/** Read every setting and stat into `state`. */
async function loadSettings() {
    const [sync, local] = await Promise.all([
        chrome.storage.sync.get(['audioModeType', 'playerLook', 'backgroundType', 'backgroundValue',
            'preferredQuality', 'filterRules', 'language', 'showPlayerButton', 'accentColor']),
        chrome.storage.local.get(['statsLogs', 'activeLogs'])
    ]);

    state.mode = VALID_MODE_TYPES.has(sync.audioModeType) ? sync.audioModeType : 'always';
    state.look = PLAYER_LOOKS.includes(sync.playerLook) ? sync.playerLook : 'card';
    state.accent = normalizeAccent(sync.accentColor);
    state.background = backgroundFrom(sync.backgroundType, sync.backgroundValue);
    state.showPlayerButton = sync.showPlayerButton !== false;
    state.quality = VALID_QUALITY_VALUES.has(sync.preferredQuality) ? sync.preferredQuality : DEFAULT_QUALITY;
    state.filterRules = sanitizeFilterRules(sync.filterRules);
    state.statsLogs = local.statsLogs || {};
    state.activeLogs = local.activeLogs || {};
    return sync;
}

/** Scroll to the section the popup asked for, then forget it. */
async function openRequestedSection() {
    try {
        const { optionsSection } = await chrome.storage.session.get('optionsSection');
        if (!optionsSection) return;
        await chrome.storage.session.remove('optionsSection');
        const section = SECTION_IDS.has(optionsSection) ? $(optionsSection) : null;
        if (!section) return;
        section.scrollIntoView({ block: 'start' });
        const heading = section.querySelector('h2');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    } catch (error) {
        // Session storage unavailable; stay at the top
    }
}

// ---------- wiring ----------

els.modeButtons.forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
});
els.lookButtons.forEach(button => {
    button.addEventListener('click', () => selectLook(button.dataset.look));
});
els.accentButtons = buildAccentButtons();
els.accents.replaceChildren(...els.accentButtons);
els.playerButtonToggle.addEventListener('change', () => selectShowPlayerButton(els.playerButtonToggle.checked));
els.bgColor.addEventListener('input', previewBackground);
els.bgColor.addEventListener('change', saveBackground);
els.bgColor.addEventListener('blur', revertBackgroundPreview);
els.keywordAdd.addEventListener('click', submitKeyword);
els.keywordInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        submitKeyword();
    }
});
els.qualitySelect.addEventListener('change', selectQuality);
els.rangeButtons.forEach(button => {
    button.addEventListener('click', () => selectRange(button.dataset.range));
});
els.langButtons.forEach(button => {
    button.addEventListener('click', () => selectLanguage(button.dataset.lang));
});
els.exportBtn.addEventListener('click', () => {
    exportSettings().catch(error => {
        console.error('[Earmode] Failed to export settings:', error);
        showToast(t('settingsExportFailed'));
    });
});
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
    const file = els.importFile.files?.[0];
    els.importFile.value = '';
    if (!file) return;
    importSettings(file).catch(error => {
        console.error('[Earmode] Failed to import settings:', error);
        showToast(t('settingsImportFailed'));
    });
});

chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'sync') {
        if (changes.audioModeType) {
            const mode = changes.audioModeType.newValue;
            state.mode = VALID_MODE_TYPES.has(mode) ? mode : 'always';
        }
        if (changes.playerLook) {
            const look = changes.playerLook.newValue;
            state.look = PLAYER_LOOKS.includes(look) ? look : 'card';
        }
        if (changes.accentColor) {
            state.accent = normalizeAccent(changes.accentColor.newValue);
        }
        if (changes.showPlayerButton) {
            state.showPlayerButton = changes.showPlayerButton.newValue !== false;
        }
        if (changes.filterRules) {
            state.filterRules = sanitizeFilterRules(changes.filterRules.newValue);
        }
        if (changes.preferredQuality) {
            const quality = changes.preferredQuality.newValue;
            state.quality = VALID_QUALITY_VALUES.has(quality) ? quality : DEFAULT_QUALITY;
        }
        if (changes.backgroundType || changes.backgroundValue) {
            const type = changes.backgroundType ? changes.backgroundType.newValue : 'color';
            const value = changes.backgroundValue ? changes.backgroundValue.newValue : state.background;
            state.background = backgroundFrom(type, value);
        }
        const lang = changes.language?.newValue;
        if (VALID_LANGUAGES.has(lang) && lang !== getLanguage()) await applyLanguage(lang);
        render();
    } else if (namespace === 'session' && changes.optionsSection?.newValue) {
        // The popup asked for a section while this page was already open
        openRequestedSection();
    } else if (namespace === 'local' && (changes.statsLogs || changes.activeLogs)) {
        if (changes.statsLogs) state.statsLogs = changes.statsLogs.newValue || {};
        if (changes.activeLogs) state.activeLogs = changes.activeLogs.newValue || {};
        renderStats();
    }
});

async function init() {
    const sync = await loadSettings();
    const uiLang = chrome.i18n.getUILanguage().startsWith('ar') ? 'ar' : 'en';
    await applyLanguage(VALID_LANGUAGES.has(sync.language) ? sync.language : uiLang);
    render();
    await openRequestedSection();
}

init();
