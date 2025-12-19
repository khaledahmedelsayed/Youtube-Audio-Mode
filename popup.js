// Popup script for YouTube Audio Mode extension

const audioToggle = document.getElementById('audioToggle');
const statusText = document.getElementById('status-text');
const toggleSection = document.querySelector('.toggle-section');

// Initialize popup state
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];

    // Check if we're on YouTube watch page
    if (!currentTab || !currentTab.url || !currentTab.url.match(/youtube\.com\/watch/)) {
        statusText.textContent = 'Only works on YouTube videos';
        audioToggle.disabled = true;
        toggleSection.style.opacity = '0.5';
        return;
    }

    // Get current audio mode status from content script
    chrome.tabs.sendMessage(currentTab.id, { action: 'getStatus' })
        .then((response) => {
            if (response) {
                updateUI(response.enabled);
            } else {
                // Fallback to storage
                checkStorageState();
            }
        })
        .catch((error) => {
            // Content script not ready yet, check storage
            console.log('Content script not ready:', error.message);
            checkStorageState();
        });
});

// Fallback function to check storage
function checkStorageState() {
    chrome.storage.sync.get(['audioMode'], (result) => {
        updateUI(result.audioMode || false);
    });
}

// Handle toggle change
audioToggle.addEventListener('change', () => {
    const enabled = audioToggle.checked;

    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentTab = tabs[0];

        chrome.tabs.sendMessage(currentTab.id, { action: 'toggleAudioMode' })
            .then((response) => {
                if (response) {
                    updateUI(response.enabled);
                }
            })
            .catch((error) => {
                console.log('Could not send message to content script:', error.message);
                // Update storage directly as fallback
                chrome.storage.sync.set({ audioMode: enabled }, () => {
                    updateUI(enabled);
                    // Reload the tab to apply changes
                    if (currentTab && currentTab.url && currentTab.url.match(/youtube\.com\/watch/)) {
                        chrome.tabs.reload(currentTab.id);
                    }
                });
            });
    });
});

function updateUI(enabled) {
    audioToggle.checked = enabled;

    if (enabled) {
        statusText.textContent = 'Audio mode is ON';
        statusText.classList.add('active');
        toggleSection.classList.add('active');
    } else {
        statusText.textContent = 'Audio mode is OFF';
        statusText.classList.remove('active');
        toggleSection.classList.remove('active');
    }
}

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

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function updateTableVal(id, mbValue, isSavings = false) {
    const el = document.getElementById(id);
    if (!el) return;

    // Add + or - sign if it's a savings/diff value
    const prefix = isSavings ? '+' : '';
    el.textContent = `${prefix}${formatData(mbValue)}`;
}

function formatData(mb) {
    if (mb >= 1024) {
        return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${Math.round(mb)} MB`;
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
});

closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
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
        applyImageBtn.textContent = 'Applied!';
        setTimeout(() => {
            applyImageBtn.textContent = originalText;
        }, 1500);
    }
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
            });
        }
    });
}
