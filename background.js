// Background script for YouTube Audio Mode
// Handles keyboard shortcuts and badge updates

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

function updateBadge(modeType) {
    if (modeType === 'always') {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
    } else {
        // Filtered mode - show FLT with same purple as ON
        chrome.action.setBadgeText({ text: 'FLT' });
        chrome.action.setBadgeBackgroundColor({ color: '#667eea' });
    }
}

// Monitor storage quota
function monitorStorageQuota() {
    chrome.storage.sync.getBytesInUse(null, (bytes) => {
        const quotaLimit = chrome.storage.sync.QUOTA_BYTES || 102400; // 100KB
        const usagePercent = (bytes / quotaLimit) * 100;

        if (usagePercent > 90) {
            console.warn(`[Audio Mode] Storage quota at ${usagePercent.toFixed(1)}% (${bytes}/${quotaLimit} bytes)`);
        } else {
            console.log(`[Audio Mode] Storage usage: ${usagePercent.toFixed(1)}% (${bytes}/${quotaLimit} bytes)`);
        }
    });
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-audio-mode') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (currentTab && currentTab.url.includes('youtube.com')) {
                // Send toggle message to content script
                chrome.tabs.sendMessage(currentTab.id, { action: 'toggleAudioMode' }, (response) => {
                    // Update storage if content script handles it
                    // (The content script updates storage, which triggers the onChanged listener above)

                    // Fallback: inject content script if not ready
                    if (chrome.runtime.lastError) {
                        console.log('Content script not ready, injecting script...');
                        chrome.scripting.executeScript({
                            target: { tabId: currentTab.id },
                            files: ['content.js']
                        }, () => {
                            // Toggle state after script is loaded
                            chrome.storage.sync.get(['audioMode'], (result) => {
                                const newState = !result.audioMode;
                                chrome.storage.sync.set({ audioMode: newState });
                            });
                        });
                    }
                });
            }
        });
    }
});
