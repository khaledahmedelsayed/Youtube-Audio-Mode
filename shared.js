// Shared helpers for the Earmode popup and options page.
// Loaded as a classic script before the page script; exposes globalThis.Earmode.

(function () {
    const DEFAULT_BACKGROUND_COLOR = '#172554';
    const SETTINGS_EXPORT_KEYS = [
        'audioMode',
        'audioModeType',
        'language',
        'backgroundType',
        'backgroundValue',
        'preferredQuality',
        'filterRules',
        'playerLook'
    ];
    const VALID_MODE_TYPES = new Set(['always', 'filtered', 'off']);
    const VALID_LANGUAGES = new Set(['en', 'ar']);
    const VALID_QUALITY_VALUES = new Set(['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'auto']);
    const PLAYER_LOOKS = ['card', 'blur', 'minimal', 'waves'];

    const EXPORT_APP_ID = 'earmode';
    const ACCEPTED_APP_IDS = new Set(['earmode', 'youtube-audio-mode']);

    // Current language and loaded messages
    let currentLang = 'en';
    let loadedMessages = {};

    /**
     * Get a translated message, preferring the manually loaded locale.
     * @param {string} messageName
     * @returns {string}
     */
    function t(messageName) {
        // First try to get from loaded messages (for custom language selection)
        if (loadedMessages[messageName] && loadedMessages[messageName].message) {
            return loadedMessages[messageName].message;
        }
        // Fallback to chrome.i18n if not loaded yet
        return chrome.i18n.getMessage(messageName) || messageName;
    }

    /**
     * Load messages for a specific language from the extension bundle.
     * @param {string} lang
     * @returns {Promise<object|null>}
     */
    async function loadMessages(lang) {
        try {
            const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
            const response = await fetch(url);
            const messages = await response.json();
            loadedMessages = messages;
            currentLang = lang;
            return messages;
        } catch (error) {
            console.error(`Failed to load messages for ${lang}:`, error);
            return null;
        }
    }

    /**
     * @returns {string} The language whose messages were last loaded.
     */
    function getLanguage() {
        return currentLang;
    }

    /**
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function getDefaultFilterRules() {
        return { whitelist: { channels: [], keywords: [] } };
    }

    /**
     * Normalize filter rules: drop invalid entries and duplicates.
     * @param {*} filterRules
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function sanitizeFilterRules(filterRules) {
        const rules = filterRules && typeof filterRules === 'object' ? filterRules : getDefaultFilterRules();
        const whitelist = rules.whitelist && typeof rules.whitelist === 'object' ? rules.whitelist : {};
        const seenChannels = new Set();
        const seenKeywords = new Set();

        const channels = Array.isArray(whitelist.channels) ? whitelist.channels : [];
        const keywords = Array.isArray(whitelist.keywords) ? whitelist.keywords : [];

        return {
            whitelist: {
                channels: channels.reduce((items, channel) => {
                    if (!channel || typeof channel !== 'object') return items;

                    const id = typeof channel.id === 'string' ? channel.id.trim() : '';
                    const name = typeof channel.name === 'string' ? channel.name.trim() : '';
                    if (!id || seenChannels.has(id)) return items;

                    seenChannels.add(id);
                    items.push({
                        id,
                        name: name || id,
                        addedAt: Number.isFinite(channel.addedAt) ? channel.addedAt : Date.now()
                    });
                    return items;
                }, []),
                keywords: keywords.reduce((items, keywordRule) => {
                    if (!keywordRule || typeof keywordRule !== 'object') return items;

                    const keyword = typeof keywordRule.keyword === 'string' ? keywordRule.keyword.trim() : '';
                    const keywordKey = keyword.toLowerCase();
                    if (!keyword || seenKeywords.has(keywordKey)) return items;

                    seenKeywords.add(keywordKey);
                    items.push({
                        keyword,
                        caseSensitive: keywordRule.caseSensitive === true,
                        addedAt: Number.isFinite(keywordRule.addedAt) ? keywordRule.addedAt : Date.now()
                    });
                    return items;
                }, [])
            }
        };
    }

    /**
     * Validate a parsed settings file and return only the supported, valid settings.
     * Accepts files exported by Earmode, by the older YouTube Audio Mode, or with no app id.
     * @param {*} payload Parsed JSON from the settings file.
     * @returns {object} Settings safe to write to chrome.storage.sync.
     * @throws {Error} When the file is invalid, from another app, or has no supported settings.
     */
    function validateImportedSettings(payload) {
        if (payload?.app && !ACCEPTED_APP_IDS.has(payload.app)) {
            throw new Error('Settings file is from another app');
        }

        const source = payload?.settings && typeof payload.settings === 'object'
            ? payload.settings
            : payload;

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('Invalid settings file');
        }

        const settings = {};

        if (VALID_MODE_TYPES.has(source.audioModeType)) {
            settings.audioModeType = source.audioModeType;
        }

        if (typeof source.audioMode === 'boolean') {
            settings.audioMode = source.audioMode;
        }

        if (VALID_LANGUAGES.has(source.language)) {
            settings.language = source.language;
        }

        if (source.backgroundType === 'color' && /^#[0-9a-f]{6}$/i.test(source.backgroundValue || '')) {
            settings.backgroundType = 'color';
            settings.backgroundValue = source.backgroundValue;
        }

        if (VALID_QUALITY_VALUES.has(source.preferredQuality)) {
            settings.preferredQuality = source.preferredQuality;
        }

        if (source.filterRules) {
            settings.filterRules = sanitizeFilterRules(source.filterRules);
        }

        if (PLAYER_LOOKS.includes(source.playerLook)) {
            settings.playerLook = source.playerLook;
        }

        if (Object.keys(settings).length === 0) {
            throw new Error('No supported settings found');
        }

        return settings;
    }

    /**
     * Build the JSON payload written to an exported settings file.
     * @param {object} settings Values read from chrome.storage.sync for SETTINGS_EXPORT_KEYS.
     * @param {Date} [now]
     * @returns {{app: string, version: number, exportedAt: string, settings: object}}
     */
    function buildExportPayload(settings, now = new Date()) {
        return {
            app: EXPORT_APP_ID,
            version: 1,
            exportedAt: now.toISOString(),
            settings
        };
    }

    /**
     * @param {Date} [now]
     * @returns {string} File name like earmode-settings-YYYY-MM-DD.json
     */
    function exportFileName(now = new Date()) {
        return `earmode-settings-${now.toISOString().slice(0, 10)}.json`;
    }

    globalThis.Earmode = {
        t,
        loadMessages,
        getLanguage,
        DEFAULT_BACKGROUND_COLOR,
        SETTINGS_EXPORT_KEYS,
        VALID_MODE_TYPES,
        VALID_LANGUAGES,
        VALID_QUALITY_VALUES,
        PLAYER_LOOKS,
        getDefaultFilterRules,
        sanitizeFilterRules,
        validateImportedSettings,
        buildExportPayload,
        exportFileName
    };
})();
