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
        'playerLook',
        'showPlayerButton'
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


    // Data rates in MB per minute, used to estimate data saved by listening at 144p
    const RATE_720P_MB_PER_MIN = 18.75;
    const RATE_144P_MB_PER_MIN = 0.75;
    const RATE_1080P_MB_PER_MIN = 33.75;

    /**
     * Sum the listened seconds logged in the month of `now`.
     * Log keys are UTC dates (YYYY-MM-DD), matching the content script.
     * @param {Object<string, number>} statsLogs
     * @param {Date} [now]
     * @returns {number}
     */
    function sumMonthSeconds(statsLogs, now = new Date()) {
        return sumLogSeconds(statsLogs, now.toISOString().slice(0, 7));
    }

    /**
     * Sum logged seconds, optionally only for dates starting with `prefix`.
     * @param {Object<string, number>} logs
     * @param {string} [prefix] Like 'YYYY-MM'; empty adds every day
     * @returns {number}
     */
    function sumLogSeconds(logs, prefix = '') {
        if (!logs || typeof logs !== 'object') return 0;
        return Object.entries(logs).reduce((total, [date, seconds]) => (
            date.startsWith(prefix) && Number.isFinite(seconds) ? total + seconds : total
        ), 0);
    }

    /**
     * Summarize listening stats for the stats section.
     * Usage values are estimated megabytes for the listened time at each quality.
     * @param {Object<string, number>} statsLogs Listened seconds per UTC day
     * @param {Object<string, number>} activeLogs Active seconds per UTC day
     * @param {'month'|'all'} range
     * @param {Date} [now]
     * @returns {{listenedSeconds: number, activeSeconds: number, usage144: number, usage720: number,
     *     usage1080: number, saved720: number, saved1080: number}}
     */
    function summarizeStats(statsLogs, activeLogs, range, now = new Date()) {
        const prefix = range === 'month' ? now.toISOString().slice(0, 7) : '';
        const listenedSeconds = sumLogSeconds(statsLogs, prefix);
        const activeSeconds = sumLogSeconds(activeLogs, prefix);
        const minutes = listenedSeconds / 60;
        const usage144 = minutes * RATE_144P_MB_PER_MIN;
        const usage720 = minutes * RATE_720P_MB_PER_MIN;
        const usage1080 = minutes * RATE_1080P_MB_PER_MIN;

        return {
            listenedSeconds,
            activeSeconds,
            usage144,
            usage720,
            usage1080,
            saved720: usage720 - usage144,
            saved1080: usage1080 - usage144
        };
    }

    /**
     * Format seconds with the two largest units, like "3h 7m", "2m 5s" or "9s".
     * @param {number} seconds
     * @param {function(string): string} translate Message lookup for timeH/timeM/timeS
     * @returns {string}
     */
    function formatDuration(seconds, translate) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(total / 3600);
        const m = Math.floor(total / 60) % 60;
        const s = total % 60;
        if (h > 0) return `${h}${translate('timeH')} ${m}${translate('timeM')}`;
        if (m > 0) return `${m}${translate('timeM')} ${s}${translate('timeS')}`;
        return `${s}${translate('timeS')}`;
    }

    /**
     * Estimate megabytes saved by listening instead of watching at 720p.
     * @param {number} seconds Listened seconds
     * @returns {number}
     */
    function savedMegabytes(seconds) {
        return (seconds / 60) * (RATE_720P_MB_PER_MIN - RATE_144P_MB_PER_MIN);
    }

    /**
     * Format a saved amount: GB with one decimal from 1024 MB, whole MB below.
     * @param {number} mb
     * @param {function(string): string} translate Message lookup for unitGB/unitMB
     * @returns {string}
     */
    function formatSavedAmount(mb, translate) {
        if (mb >= 1024) return `${(mb / 1024).toFixed(1)}${translate('unitGB')}`;
        return `${Math.round(mb)}${translate('unitMB')}`;
    }

    /**
     * Replace {name} placeholders in a message.
     * @param {string} message
     * @param {Object<string, string|number>} values
     * @returns {string}
     */
    function fillTemplate(message, values) {
        return String(message).replace(/\{(\w+)\}/g, (match, name) => (
            Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
        ));
    }

    /**
     * Hint text under the auto-listen choices.
     * @param {string} mode 'always' | 'filtered' | 'off'
     * @param {number} channelCount Channels in the list
     * @param {function(string): string} translate
     * @returns {string}
     */
    function modeHint(mode, channelCount, translate) {
        if (mode === 'always') return translate('hintEverything');
        if (mode === 'off') return translate('hintNothing');
        if (channelCount === 0) return translate('hintMyListEmpty');
        if (channelCount === 1) return translate('hintMyListOne');
        return fillTemplate(translate('hintMyList'), { count: channelCount });
    }

    /**
     * All channels of a video (collaborations included), deduped by id.
     * Falls back to the primary channelId/channelName.
     * @param {{channelId?: string, channelName?: string, channels?: Array<{id: string, name: string}>}|null} videoInfo
     * @returns {Array<{id: string, name: string}>}
     */
    function videoChannels(videoInfo) {
        if (!videoInfo) return [];
        const listed = Array.isArray(videoInfo.channels) ? videoInfo.channels : [];
        const primary = videoInfo.channelId ? [{ id: videoInfo.channelId, name: videoInfo.channelName }] : [];
        const seen = new Set();
        return [...listed, ...primary].reduce((items, channel) => {
            if (!channel?.id || seen.has(channel.id)) return items;
            seen.add(channel.id);
            items.push({ id: channel.id, name: channel.name || channel.id });
            return items;
        }, []);
    }

    /**
     * @param {*} filterRules
     * @param {Array<{id: string}>} channels
     * @returns {boolean} True when there is at least one channel and all are saved.
     */
    function channelsInList(filterRules, channels) {
        if (!channels.length) return false;
        const saved = new Set(sanitizeFilterRules(filterRules).whitelist.channels.map(channel => channel.id));
        return channels.every(channel => saved.has(channel.id));
    }

    /**
     * Remove the channels when all are saved, otherwise add the missing ones.
     * Does not mutate the input.
     * @param {*} filterRules
     * @param {Array<{id: string, name: string}>} channels
     * @param {number} [now] Timestamp for addedAt
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function toggleChannels(filterRules, channels, now = Date.now()) {
        const rules = sanitizeFilterRules(filterRules);
        const ids = new Set(channels.map(channel => channel.id));

        if (channelsInList(rules, channels)) {
            rules.whitelist.channels = rules.whitelist.channels.filter(channel => !ids.has(channel.id));
        } else {
            channels.forEach(channel => {
                rules.whitelist.channels.push({ id: channel.id, name: channel.name, addedAt: now });
            });
        }
        return sanitizeFilterRules(rules);
    }

    /**
     * Add a keyword to the list (trimmed, case-insensitive dedupe). Does not mutate the input.
     * @param {*} filterRules
     * @param {string} text
     * @param {number} [now] Timestamp for addedAt
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function addKeyword(filterRules, text, now = Date.now()) {
        const rules = sanitizeFilterRules(filterRules);
        const keyword = typeof text === 'string' ? text.trim() : '';
        if (keyword) rules.whitelist.keywords.push({ keyword, caseSensitive: false, addedAt: now });
        return sanitizeFilterRules(rules);
    }

    /**
     * Remove a keyword (exact match). Does not mutate the input.
     * @param {*} filterRules
     * @param {string} keyword
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function removeKeyword(filterRules, keyword) {
        const rules = sanitizeFilterRules(filterRules);
        rules.whitelist.keywords = rules.whitelist.keywords.filter(item => item.keyword !== keyword);
        return rules;
    }

    /**
     * Remove a channel by id. Does not mutate the input.
     * @param {*} filterRules
     * @param {string} channelId
     * @returns {{whitelist: {channels: Array, keywords: Array}}}
     */
    function removeChannel(filterRules, channelId) {
        const rules = sanitizeFilterRules(filterRules);
        rules.whitelist.channels = rules.whitelist.channels.filter(channel => channel.id !== channelId);
        return rules;
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

        if (typeof source.showPlayerButton === 'boolean') {
            settings.showPlayerButton = source.showPlayerButton;
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
        exportFileName,
        sumMonthSeconds,
        savedMegabytes,
        summarizeStats,
        formatDuration,
        formatSavedAmount,
        fillTemplate,
        modeHint,
        videoChannels,
        channelsInList,
        toggleChannels,
        addKeyword,
        removeKeyword,
        removeChannel
    };
})();
