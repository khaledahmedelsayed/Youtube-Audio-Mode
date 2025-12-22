// Popup script for YouTube Audio Mode extension

const modeAlwaysBtn = document.getElementById('mode-always');
const modeFilteredBtn = document.getElementById('mode-filtered');
const modeOffBtn = document.getElementById('mode-off');
const configureFiltersBtn = document.getElementById('configure-filters-btn');
const langBtn = document.getElementById('lang-btn');

// Current audio mode type: 'always', 'filtered', or 'off'
let currentModeType = 'always';

// Current language and loaded messages
let currentLang = 'en';
let loadedMessages = {};

// Helper function to get translated messages
function t(messageName) {
    // First try to get from loaded messages (for custom language selection)
    if (loadedMessages[messageName] && loadedMessages[messageName].message) {
        return loadedMessages[messageName].message;
    }
    // Fallback to chrome.i18n if not loaded yet
    return chrome.i18n.getMessage(messageName) || messageName;
}

// Load messages for a specific language
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

async function setLanguage(lang) {
    // Load messages for the selected language
    await loadMessages(lang);
    currentLang = lang;

    // Update direction
    document.body.dir = lang === 'ar' ? 'rtl' : 'ltr';

    // Update button text
    langBtn.textContent = lang === 'ar' ? 'En' : 'ع';
    langBtn.title = lang === 'ar' ? 'English' : 'Arabic';

    // Update all elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = t(key);
        if (translation) {
            el.textContent = translation;
        }
    });

    // Update placeholders
    const urlInput = document.getElementById('custom-image-url');
    if (urlInput) {
        urlInput.placeholder = 'https://example.com/image.jpg';
    }

    // Refresh stats to apply new units
    updateStats();

    // Save preference
    chrome.storage.sync.set({ language: lang });

    // Broadcast to active tab (for overlay)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateLanguage',
                language: lang
            }).catch(() => {
                // Ignore errors if content script is not ready
            });
        }
    });
}

// Initialize Language
chrome.storage.sync.get(['language'], (result) => {
    // Use stored language preference, or detect from browser
    const detectedLang = chrome.i18n.getUILanguage().startsWith('ar') ? 'ar' : 'en';
    setLanguage(result.language || detectedLang);
});


// Language Toggle Handler
langBtn.addEventListener('click', () => {
    const newLang = currentLang === 'en' ? 'ar' : 'en';
    setLanguage(newLang);
});

// Initialize popup state - load saved mode type
chrome.storage.sync.get(['audioModeType'], (result) => {
    currentModeType = result.audioModeType || 'always';
    updateModeUI(currentModeType);
});

// Update mode selector UI
function updateModeUI(mode) {
    // Remove active from all mode buttons
    modeAlwaysBtn.classList.remove('active');
    modeFilteredBtn.classList.remove('active');
    modeOffBtn.classList.remove('active');

    // Set active on selected mode and show/hide configure button
    if (mode === 'always') {
        modeAlwaysBtn.classList.add('active');
        configureFiltersBtn.classList.add('hidden');
    } else if (mode === 'filtered') {
        modeFilteredBtn.classList.add('active');
        configureFiltersBtn.classList.remove('hidden');
    } else {
        // 'off' mode
        modeOffBtn.classList.add('active');
        configureFiltersBtn.classList.add('hidden');
    }
}

// Handle mode selection
function selectMode(mode) {
    if (mode === currentModeType) return;

    currentModeType = mode;
    updateModeUI(mode);

    // Save to storage
    chrome.storage.sync.set({ audioModeType: mode });

    // Notify content script about mode change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];
        if (currentTab?.url?.includes('youtube.com')) {
            chrome.tabs.sendMessage(currentTab.id, {
                action: 'modeChanged',
                mode: mode
            }).catch(() => {
                // Content script not ready, will pick up from storage
            });
        }
    });
}

// Mode button click handlers
modeAlwaysBtn.addEventListener('click', () => selectMode('always'));
modeFilteredBtn.addEventListener('click', () => selectMode('filtered'));
modeOffBtn.addEventListener('click', () => selectMode('off'));

// Configure filters button opens the filter panel
configureFiltersBtn.addEventListener('click', () => {
    filterPanel.classList.add('open');
    document.body.classList.add('panel-open');
    loadFilterRules();
    fetchCurrentVideoInfo();
});

// Stats Update Logic
let currentFilter = 'month'; // 'month' or 'all'

const filterBtns = document.querySelectorAll('.stats-filter');
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        updateStats();
    });
});

function updateStats() {
    try {
        // Get both logs
        chrome.storage.local.get(['statsLogs', 'activeLogs', 'audioModeSeconds'], (result) => {
            const statsLogs = result.statsLogs || {};
            const activeLogs = result.activeLogs || {};

            // Legacy support: if we have audioModeSeconds but no logs, maybe credit it to today?
            // Or just ignore legacy data for the new accurate system. 
            // Let's rely on new logs.

            const now = new Date();
            const currentMonthPrefix = now.toISOString().slice(0, 7); // YYYY-MM

            let totalListenedSeconds = 0;
            let totalActiveSeconds = 0;

            // Aggregate Listened Time (Accurate Playback)
            Object.entries(statsLogs).forEach(([date, seconds]) => {
                if (currentFilter === 'month') {
                    if (date.startsWith(currentMonthPrefix)) {
                        totalListenedSeconds += seconds;
                    }
                } else {
                    totalListenedSeconds += seconds;
                }
            });

            // Aggregate Active Time (Wall Clock)
            Object.entries(activeLogs).forEach(([date, seconds]) => {
                if (currentFilter === 'month') {
                    if (date.startsWith(currentMonthPrefix)) {
                        totalActiveSeconds += seconds;
                    }
                } else {
                    totalActiveSeconds += seconds;
                }
            });

            // Calculate Data
            const listenedMinutes = totalListenedSeconds / 60;

            // Data Rates (MB per minute)
            const RATE_144P = 0.75;
            const RATE_720P = 18.75;
            const RATE_1080P = 33.75;

            const usage144p = listenedMinutes * RATE_144P;
            const usage720p = listenedMinutes * RATE_720P;
            const usage1080p = listenedMinutes * RATE_1080P;

            const savedVs720p = usage720p - usage144p;
            const savedVs1080p = usage1080p - usage144p;

            // Update UI
            const dataSavedElement = document.getElementById('data-saved-value');
            const listenedTimeElement = document.getElementById('listened-time-value');
            const activeTimeElement = document.getElementById('active-time-value');

            if (dataSavedElement) {
                dataSavedElement.textContent = formatData(savedVs720p);
            }

            if (listenedTimeElement) {
                listenedTimeElement.textContent = formatTime(totalListenedSeconds);
            }

            if (activeTimeElement) {
                activeTimeElement.textContent = formatTime(totalActiveSeconds);
            }

            // Update Table (Comparison uses statsLogs data mainly)
            updateTableVal('usage-144p', usage144p);
            updateTableVal('usage-720p', usage720p);
            updateTableVal('saved-720p', savedVs720p, true);
            updateTableVal('usage-1080p', usage1080p);
            updateTableVal('saved-1080p', savedVs1080p, true);
        });
    } catch (error) {
        console.error('[Audio Mode] Error updating stats:', error);
    }
}

function formatTime(seconds) {
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);

    const timeH = t('timeH');
    const timeM = t('timeM');
    const timeS = t('timeS');

    if (h > 0) return `${h}${timeH} ${m}${timeM}`;
    if (m > 0) return `${m}${timeM} ${s}${timeS}`;
    return `${s}${timeS}`;
}

function updateTableVal(id, mbValue, isSavings = false) {
    const el = document.getElementById(id);
    if (!el) return;

    // Add + or - sign if it's a savings/diff value
    const prefix = isSavings ? '+' : '';
    el.textContent = `${prefix}${formatData(mbValue)}`;
}

function formatData(mb) {
    const unitGB = t('unitGB');
    const unitMB = t('unitMB');
    if (mb >= 1024) {
        return `${(mb / 1024).toFixed(2)}${unitGB}`;
    }
    return `${Math.round(mb)}${unitMB}`;
}

// Update stats immediately
updateStats();

// Listen for storage changes instead of polling
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.statsLogs || changes.activeLogs)) {
        updateStats();
    }
});

// Display and Manage Shortcuts
function updateShortcutDisplay() {
    const keysContainer = document.getElementById('shortcut-display');
    if (!keysContainer) return;

    // Helper to setup click handler
    const setupClickable = () => {
        keysContainer.classList.add('clickable');
        keysContainer.title = 'Click to configure extension shortcuts';
        keysContainer.onclick = () => {
            chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
        };
    };

    if (!chrome.commands) {
        // Fallback for contexts where chrome.commands isn't available
        chrome.runtime.getPlatformInfo((info) => {
            if (info.os === 'mac') {
                keysContainer.innerHTML = '<kbd>Option</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>';
            } else {
                keysContainer.innerHTML = '<kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>';
            }
        });
        return;
    }

    chrome.commands.getAll((commands) => {
        const toggleCommand = commands.find(c => c.name === 'toggle-audio-mode');

        if (toggleCommand && toggleCommand.shortcut) {
            chrome.runtime.getPlatformInfo((info) => {
                let shortcutDisplay = toggleCommand.shortcut;

                // Customize for Mac: "Option" instead of "Alt"
                if (info.os === 'mac') {
                    shortcutDisplay = shortcutDisplay.replace('Alt', 'Option');
                }

                // Shortcut is set, display it
                const parts = shortcutDisplay.split('+');
                const html = parts.map(part => `<kbd>${part.trim()}</kbd>`).join(' + ');
                keysContainer.innerHTML = html;
            });
        } else {
            // No shortcut set
            keysContainer.innerHTML = '<span class="set-shortcut-link">⚠️ Click to set shortcut</span>';
        }

        // ALWAYS make it clickable/configurable
        setupClickable();
    });
}

// Initial call
updateShortcutDisplay();

// --- Settings Panel Logic ---

const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const colorOptions = document.getElementById('color-options');
const imageOptions = document.getElementById('image-options');
const toggleBtns = document.querySelectorAll('.toggle-btn');
const themeBtns = document.querySelectorAll('.theme-btn');
const colorPicker = document.getElementById('custom-color-picker');
const colorValueText = document.getElementById('color-value-text');
const imageUrlInput = document.getElementById('custom-image-url');
const applyImageBtn = document.getElementById('apply-image-btn');

// Toggle Settings Panel
settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('open');
    document.body.classList.add('panel-open');
});

closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
    document.body.classList.remove('panel-open');
});

// Load Saved Settings
chrome.storage.sync.get(['backgroundType', 'backgroundValue'], (result) => {
    const type = result.backgroundType || 'color';
    const value = result.backgroundValue || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

    // Set Type Toggle
    toggleBtns.forEach(btn => {
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show correct section
    if (type === 'image') {
        colorOptions.classList.add('hidden');
        imageOptions.classList.remove('hidden');
        imageUrlInput.value = value;
    } else {
        colorOptions.classList.remove('hidden');
        imageOptions.classList.add('hidden');

        // Try to match preset
        // If value starts with #, it might be custom color
        if (value.startsWith('#')) {
            colorPicker.value = value;
            colorValueText.textContent = value;
        }
    }
});

// Handle Type Toggle
toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active from all
        toggleBtns.forEach(b => b.classList.remove('active'));
        // Add to clicked
        btn.classList.add('active');

        const type = btn.dataset.type;
        if (type === 'color') {
            colorOptions.classList.remove('hidden');
            imageOptions.classList.add('hidden');
            // Re-apply current color/preset
            saveAndApplyTheme('color', getCurrentColorValue());
        } else {
            colorOptions.classList.add('hidden');
            imageOptions.classList.remove('hidden');
            // Re-apply current image
            saveAndApplyTheme('image', imageUrlInput.value);
        }
    });
});

// Handle Presets
themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all
        themeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const bg = btn.style.background;
        saveAndApplyTheme('color', bg);
    });
});

// Handle Color Picker
colorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    colorValueText.textContent = color;
    // Remove active from presets
    themeBtns.forEach(b => b.classList.remove('active'));

    saveAndApplyTheme('color', color);
});

// Handle Image Apply
applyImageBtn.addEventListener('click', () => {
    const url = imageUrlInput.value.trim();
    if (url) {
        saveAndApplyTheme('image', url);
        // Visual feedback
        const originalText = applyImageBtn.textContent;
        applyImageBtn.textContent = t('applied');
        setTimeout(() => {
            applyImageBtn.textContent = originalText;
        }, 1500);
    }
});

// --- Quality Selector Logic ---
const qualitySelect = document.getElementById('quality-select');

// Load saved quality preference
chrome.storage.sync.get(['preferredQuality'], (result) => {
    if (result.preferredQuality && qualitySelect) {
        qualitySelect.value = result.preferredQuality;
    }
});

// Save quality preference on change
qualitySelect.addEventListener('change', () => {
    const quality = qualitySelect.value;
    chrome.storage.sync.set({ preferredQuality: quality });
});

function getCurrentColorValue() {
    // Check if a preset is active
    const activePreset = document.querySelector('.theme-btn.active');
    if (activePreset) {
        return activePreset.style.background;
    }
    // Otherwise return picker value
    return colorPicker.value;
}

function saveAndApplyTheme(type, value) {
    if (!value) return; // Don't save empty values

    // Save to storage
    chrome.storage.sync.set({
        backgroundType: type,
        backgroundValue: value
    });

    // Send to active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url.includes('youtube.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {
                action: 'updateTheme',
                backgroundType: type,
                backgroundValue: value
            }).catch(() => {
                // Ignore errors if content script is not ready
            });
        }
    });
}

// --- Filter Rules Panel Logic ---

const filterPanel = document.getElementById('filter-panel');
const closeFilterBtn = document.getElementById('close-filter');
const quickAddChannelBtn = document.getElementById('quick-add-channel');
const newRuleInput = document.getElementById('new-rule-input');
const addRuleBtn = document.getElementById('add-rule-btn');

let currentVideoInfo = null;

closeFilterBtn.addEventListener('click', () => {
    filterPanel.classList.remove('open');
    document.body.classList.remove('panel-open');
});

// Fetch current video info from content script with retry logic
async function fetchCurrentVideoInfo(retryCount = 0) {
    const currentChannelName = document.getElementById('current-channel-name');
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 800;

    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];

        if (!currentTab?.url?.match(/youtube\.com\/watch/)) {
            currentChannelName.textContent = t('notOnVideo');
            quickAddChannelBtn.disabled = true;
            return;
        }

        // Show loading state on first attempt
        if (retryCount === 0) {
            currentChannelName.textContent = '...';
        }

        const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getVideoInfo' });

        if (response?.channelName) {
            currentVideoInfo = response;
            currentChannelName.textContent = response.channelName;
            quickAddChannelBtn.disabled = false;

            // Check if already added
            updateQuickAddButtonState();
        } else {
            // Retry if channel not found yet (YouTube might still be loading)
            if (retryCount < MAX_RETRIES) {
                setTimeout(() => fetchCurrentVideoInfo(retryCount + 1), RETRY_DELAY);
            } else {
                currentChannelName.textContent = t('channelNotFound');
                quickAddChannelBtn.disabled = true;
            }
        }
    } catch (error) {
        // Retry on error (content script might not be ready)
        if (retryCount < MAX_RETRIES) {
            setTimeout(() => fetchCurrentVideoInfo(retryCount + 1), RETRY_DELAY);
        } else {
            currentChannelName.textContent = t('notOnVideo');
            quickAddChannelBtn.disabled = true;
        }
    }
}

// Update quick add button state based on current rules
async function updateQuickAddButtonState() {
    if (!currentVideoInfo?.channelId) return;

    const result = await chrome.storage.sync.get(['filterRules']);
    const rules = result.filterRules || { whitelist: { channels: [], keywords: [] } };

    const inWhitelist = rules.whitelist?.channels?.some(c => c.id === currentVideoInfo.channelId) || false;

    quickAddChannelBtn.classList.toggle('active', inWhitelist);

    const btnSpan = quickAddChannelBtn.querySelector('span');
    if (btnSpan) btnSpan.textContent = inWhitelist ? t('remove') : t('add');
}

// Load and display filter rules (whitelist-only)
async function loadFilterRules() {
    const result = await chrome.storage.sync.get(['filterRules']);
    const rules = result.filterRules || {
        whitelist: { channels: [], keywords: [] }
    };

    // Render the whitelist
    renderRulesList(rules);
}

function renderRulesList(rules) {
    const whitelist = rules.whitelist || { channels: [], keywords: [] };

    // Render channels
    const channelsList = document.getElementById('channels-list');
    if (whitelist.channels?.length > 0) {
        channelsList.innerHTML = whitelist.channels.map(channel => `
            <div class="rule-item" data-id="${escapeHtml(channel.id)}" data-type="channel">
                <span class="rule-name">${escapeHtml(channel.name)}</span>
                <button class="remove-rule-btn" data-id="${escapeHtml(channel.id)}" data-type="channel">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `).join('');
    } else {
        channelsList.innerHTML = `<div class="empty-state">${t('noChannels')}</div>`;
    }

    // Render keywords
    const keywordsList = document.getElementById('keywords-list');
    if (whitelist.keywords?.length > 0) {
        keywordsList.innerHTML = whitelist.keywords.map(kw => `
            <div class="rule-item" data-keyword="${escapeHtml(kw.keyword)}" data-type="keyword">
                <span class="rule-name">"${escapeHtml(kw.keyword)}"</span>
                <button class="remove-rule-btn" data-keyword="${escapeHtml(kw.keyword)}" data-type="keyword">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        `).join('');
    } else {
        keywordsList.innerHTML = `<div class="empty-state">${t('noKeywords')}</div>`;
    }

    // Add event listeners for remove buttons
    document.querySelectorAll('.remove-rule-btn').forEach(btn => {
        btn.addEventListener('click', () => removeRule(btn.dataset));
    });
}

// Add a new rule to whitelist
async function addRule(ruleType, value) {
    if (!value) return;

    const result = await chrome.storage.sync.get(['filterRules']);
    const rules = result.filterRules || {
        whitelist: { channels: [], keywords: [] }
    };

    // Ensure whitelist exists
    if (!rules.whitelist) {
        rules.whitelist = { channels: [], keywords: [] };
    }

    if (ruleType === 'channel') {
        // For channel, value should be { id, name }
        if (!rules.whitelist.channels.some(c => c.id === value.id)) {
            rules.whitelist.channels.push({
                id: value.id,
                name: value.name,
                addedAt: Date.now()
            });
        }
    } else {
        // For keyword
        const keyword = typeof value === 'string' ? value.trim() : value;
        if (keyword && !rules.whitelist.keywords.some(k => k.keyword.toLowerCase() === keyword.toLowerCase())) {
            rules.whitelist.keywords.push({
                keyword: keyword,
                caseSensitive: false,
                addedAt: Date.now()
            });
        }
    }

    await chrome.storage.sync.set({ filterRules: rules });
    loadFilterRules();

    // Show feedback
    showToast(t('ruleAdded'));
}

// Remove a rule from whitelist
async function removeRule(dataset) {
    const result = await chrome.storage.sync.get(['filterRules']);
    const rules = result.filterRules;
    if (!rules || !rules.whitelist) return;

    if (dataset.type === 'channel') {
        rules.whitelist.channels = rules.whitelist.channels.filter(c => c.id !== dataset.id);
    } else {
        rules.whitelist.keywords = rules.whitelist.keywords.filter(k => k.keyword !== dataset.keyword);
    }

    await chrome.storage.sync.set({ filterRules: rules });
    loadFilterRules();
    updateQuickAddButtonState();

    showToast(t('ruleRemoved'));
}

// Helper: Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper: Show toast notification
function showToast(message) {
    // Create toast element if not exists - append to body for fixed positioning
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

// Add rule button (handles keywords only)
addRuleBtn.addEventListener('click', () => {
    const value = newRuleInput.value.trim();
    if (!value) return;

    addRule('keyword', value);
    newRuleInput.value = '';
});

// Enter key to add rule
newRuleInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addRuleBtn.click();
    }
});

// Quick add channel button (toggle whitelist)
quickAddChannelBtn.addEventListener('click', async () => {
    if (!currentVideoInfo?.channelId) return;

    const result = await chrome.storage.sync.get(['filterRules']);
    const rules = result.filterRules || { whitelist: { channels: [], keywords: [] } };

    // Ensure whitelist exists
    if (!rules.whitelist) {
        rules.whitelist = { channels: [], keywords: [] };
    }

    const existingIndex = rules.whitelist.channels.findIndex(c => c.id === currentVideoInfo.channelId);

    if (existingIndex >= 0) {
        // Remove from whitelist
        rules.whitelist.channels.splice(existingIndex, 1);
        showToast(t('ruleRemoved'));
    } else {
        // Add to whitelist
        rules.whitelist.channels.push({
            id: currentVideoInfo.channelId,
            name: currentVideoInfo.channelName,
            addedAt: Date.now()
        });
        showToast(t('ruleAdded'));
    }

    await chrome.storage.sync.set({ filterRules: rules });
    loadFilterRules();
    updateQuickAddButtonState();
});
