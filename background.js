// Background script for Earmode
// Handles badge updates

// Initialize state on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(['audioModeType'], (result) => {
        updateBadge(result.audioModeType || 'always');
    });

    // Log storage quota on install
    monitorStorageQuota();
});

// Also initialize badge on startup (not just install)
chrome.storage.sync.get(['audioModeType'], (result) => {
    updateBadge(result.audioModeType || 'always');
});

// Debounced badge update to prevent excessive calls
let badgeUpdateTimeout = null;
function debouncedUpdateBadge(modeType) {
    if (badgeUpdateTimeout) {
        clearTimeout(badgeUpdateTimeout);
    }
    badgeUpdateTimeout = setTimeout(() => {
        updateBadge(modeType);
    }, 100);
}

// Update badge when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.audioModeType) {
        debouncedUpdateBadge(changes.audioModeType.newValue);
    }
});

function setBadgeColors() {
    chrome.action.setBadgeBackgroundColor({ color: '#F2C14E' });
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#1C1B22' });
}

function updateBadge(modeType) {
    if (modeType === 'always') {
        chrome.action.setBadgeText({ text: 'A' });
        setBadgeColors();
    } else if (modeType === 'filtered') {
        chrome.action.setBadgeText({ text: 'L' });
        setBadgeColors();
    } else {
        // Off mode - no badge
        chrome.action.setBadgeText({ text: '' });
    }
}

// Monitor storage quota
function monitorStorageQuota() {
    chrome.storage.sync.getBytesInUse(null, (bytes) => {
        const quotaLimit = chrome.storage.sync.QUOTA_BYTES || 102400; // 100KB
        const usagePercent = (bytes / quotaLimit) * 100;

        if (usagePercent > 90) {
            console.warn(`[Earmode] Storage quota at ${usagePercent.toFixed(1)}% (${bytes}/${quotaLimit} bytes)`);
        } else {
            console.log(`[Earmode] Storage usage: ${usagePercent.toFixed(1)}% (${bytes}/${quotaLimit} bytes)`);
        }
    });
}

