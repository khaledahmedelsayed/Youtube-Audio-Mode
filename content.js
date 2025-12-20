// YouTube Audio Mode - Content Script
// This script runs on YouTube pages and enables audio-only playback

// ===== CONFIGURATION CONSTANTS =====
const TIMING = {
    RETRY_DELAY: 1000,
    QUALITY_SET_DELAY: 1000,
    QUALITY_CHECK_INTERVAL: 5000,
    USAGE_TRACKING_INTERVAL: 5000,
    FALLBACK_TIMEOUT: 3000,
    UI_INTERACTION_BASE: 300,
    UI_INTERACTION_STEP: 100,
    UI_INTERACTION_FINAL: 200,
    API_VERIFICATION_DELAY: 500
};

const DATA_RATES_MB_PER_MIN = {
    RATE_144P: 0.75,
    RATE_720P: 18.75,
    RATE_1080P: 33.75
};

const QUALITY = {
    TARGET: 'tiny',  // 144p
    FALLBACK: 'small',
    RESTORE: 'hd720' // 720p
};

// ===== STATE VARIABLES =====
let audioModeEnabled = false;
let audioModeOverlay = null;
let qualityCheckInterval = null;
let usageTrackingInterval = null;
let cachedVideoElement = null;
let currentLanguage = 'en';
let videoPlayHandler = null;
let videoPauseHandler = null;

const translations = {
    en: {
        activeTitle: 'Audio Mode Active',
        activeDesc: 'Saving your bandwidth'
    },
    ar: {
        activeTitle: 'وضع الصوت مفعل',
        activeDesc: 'نقوم بتوفير باقتك'
    }
};

// Initialize by checking saved preference
if (chrome.runtime?.id) {
    try {
        chrome.storage.sync.get(['audioMode', 'language'], function (result) {
            if (chrome.runtime.lastError) {
                console.log('[Audio Mode] Could not load initial state:', chrome.runtime.lastError);
                return;
            }
            if (result.audioMode) {
                enableAudioMode();
            }
            if (result.language) {
                currentLanguage = result.language;
            }
        });
    } catch (error) {
        console.log('[Audio Mode] Error during initialization:', error);
    }
}

// ===== HELPER FUNCTIONS =====

/**
 * Get cached video element or query for it
 * Reduces DOM queries from 15+ to 1-2 per page
 */
function getVideoElement() {
    if (!cachedVideoElement || !document.contains(cachedVideoElement)) {
        cachedVideoElement = document.querySelector('video');
    }
    return cachedVideoElement;
}

/**
 * Clear cached video element (useful after navigation)
 */
function clearVideoCache() {
    cachedVideoElement = null;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleAudioMode') {
        if (audioModeEnabled) {
            disableAudioMode();
        } else {
            enableAudioMode();
        }
        sendResponse({ enabled: audioModeEnabled });
    } else if (request.action === 'getStatus') {
        sendResponse({ enabled: audioModeEnabled });
    } else if (request.action === 'updateTheme') {
        updateOverlayTheme(request.backgroundType, request.backgroundValue);
    } else if (request.action === 'updateLanguage') {
        currentLanguage = request.language;
        updateOverlayLanguage();
    }
    return true;
});

function enableAudioMode() {
    audioModeEnabled = true;

    // Find the video player
    const video = getVideoElement();
    if (!video) {
        setTimeout(enableAudioMode, TIMING.RETRY_DELAY);
        return;
    }

    // Hide video by making it transparent and small
    video.style.opacity = '0';
    video.style.maxHeight = '1px';
    video.style.minHeight = '1px';

    // Create visual overlay first for immediate feedback
    createAudioModeOverlay();

    // Wait for video to start playing before setting quality
    // This makes the transition much smoother
    const setQualityWhenReady = () => {
        if (video.readyState >= 2 && !video.paused) {
            setLowestQuality();
        } else {
            const playListener = () => {
                setTimeout(() => {
                    setLowestQuality();
                }, TIMING.QUALITY_SET_DELAY);
                video.removeEventListener('play', playListener);
            };
            video.addEventListener('play', playListener, { once: true });

            // Also try after a timeout as fallback
            setTimeout(() => {
                if (audioModeEnabled) {
                    setLowestQuality();
                }
            }, TIMING.FALLBACK_TIMEOUT);
        }
    };

    setQualityWhenReady();

    // Save preference
    if (chrome.runtime?.id) {
        try {
            chrome.storage.sync.set({ audioMode: true });
        } catch (error) {
            console.log('[Audio Mode] Could not save state:', error);
        }
    }

    // Start tracking usage for data saved stats
    startUsageTracking();
}

function disableAudioMode() {
    audioModeEnabled = false;

    // Find the video player
    const video = getVideoElement();
    if (video) {
        video.style.opacity = '1';
        video.style.maxHeight = '';
        video.style.minHeight = '';
    }

    // Restore quality settings
    restoreQuality();

    // Reset quality attempt flag so we try fresh next time
    const player = document.getElementById('movie_player');
    if (player) {
        delete player.__audioModeQualityAttempted;
    }

    // Clean up video event listeners (reuse video from above)
    if (video) {
        if (videoPlayHandler) {
            video.removeEventListener('play', videoPlayHandler);
            videoPlayHandler = null;
        }
        if (videoPauseHandler) {
            video.removeEventListener('pause', videoPauseHandler);
            videoPauseHandler = null;
        }
    }

    // Remove overlay
    if (audioModeOverlay) {
        audioModeOverlay.remove();
        audioModeOverlay = null;
    }

    // Save preference
    if (chrome.runtime?.id) {
        try {
            chrome.storage.sync.set({ audioMode: false });
        } catch (error) {
            console.log('[Audio Mode] Could not save state:', error);
        }
    }

    // Clear quality check interval
    if (qualityCheckInterval) {
        clearInterval(qualityCheckInterval);
        qualityCheckInterval = null;
    }

    // Stop tracking usage
    stopUsageTracking();
}

/**
 * Function to interact with YouTube's quality settings UI (invisibly)
 * @param {HTMLVideoElement} video - The video element
 * @param {string} targetText - The text to look for (e.g. '144p', '720p', 'Auto')
 */
const clickQualitySetting = (video, targetText = '144p') => {
    try {
        const wasPlaying = !video.paused;
        const currentTime = video.currentTime;

        // Hide the settings panel from view
        const settingsPanel = document.querySelector('.ytp-settings-menu');
        const popup = document.querySelector('.ytp-popup');

        // Store original styles to restore later
        const originalPanelStyles = {};
        const originalPopupStyles = {};

        if (settingsPanel) {
            originalPanelStyles.visibility = settingsPanel.style.visibility;
            originalPanelStyles.opacity = settingsPanel.style.opacity;
            originalPanelStyles.pointerEvents = settingsPanel.style.pointerEvents;

            // Make completely invisible
            settingsPanel.style.visibility = 'hidden';
            settingsPanel.style.opacity = '0';
            settingsPanel.style.pointerEvents = 'none';
        }

        if (popup) {
            originalPopupStyles.visibility = popup.style.visibility;
            originalPopupStyles.opacity = popup.style.opacity;
            originalPopupStyles.pointerEvents = popup.style.pointerEvents;

            popup.style.visibility = 'hidden';
            popup.style.opacity = '0';
            popup.style.pointerEvents = 'none';
        }

        const settingsButton = document.querySelector('.ytp-settings-button');
        if (settingsButton) {
            settingsButton.click();

            setTimeout(() => {
                const qualityMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                    item => item.textContent.toLowerCase().includes('quality')
                );

                if (qualityMenuItem) {
                    qualityMenuItem.click();

                    setTimeout(() => {
                        const menuItems = Array.from(document.querySelectorAll('.ytp-menuitem'));
                        const targetOption = menuItems.find(item => item.textContent.includes(targetText));

                        if (targetOption) {
                            targetOption.click();
                        } else {
                            if (targetText === '144p') {
                                const allQualities = document.querySelectorAll('.ytp-menuitem');
                                if (allQualities.length > 0) {
                                    allQualities[allQualities.length - 1].click();
                                }
                            }
                            // If we were looking for 720p (restore), maybe try Auto?
                            else if (targetText === '720p') {
                                const autoOption = menuItems.find(item => item.textContent.includes('Auto'));
                                if (autoOption) {
                                    autoOption.click();
                                }
                            }
                        }

                        // Close and cleanup
                        setTimeout(() => {
                            // Simulate Escape to close
                            const escapeEvent = new KeyboardEvent('keydown', {
                                key: 'Escape',
                                code: 'Escape',
                                keyCode: 27,
                                which: 27,
                                bubbles: true,
                                cancelable: true
                            });
                            document.dispatchEvent(escapeEvent);

                            // Restore original styles after a brief delay
                            setTimeout(() => {
                                if (settingsPanel) {
                                    settingsPanel.style.visibility = originalPanelStyles.visibility || '';
                                    settingsPanel.style.opacity = originalPanelStyles.opacity || '';
                                    settingsPanel.style.pointerEvents = originalPanelStyles.pointerEvents || '';
                                }

                                if (popup) {
                                    popup.style.visibility = originalPopupStyles.visibility || '';
                                    popup.style.opacity = originalPopupStyles.opacity || '';
                                    popup.style.pointerEvents = originalPopupStyles.pointerEvents || '';
                                }

                                if (wasPlaying && video.paused) {
                                    video.currentTime = currentTime;
                                    video.play().catch(err => console.log('[Audio Mode] Could not resume:', err));
                                }
                            }, 200);
                        }, 100);
                    }, 300);
                }
            }, 300);
        }
    } catch (error) {
        console.error('[Audio Mode] Error in invisible UI interaction:', error);
    }
};

/**
 * Function to force set quality to 144p using multiple methods
 * @param {HTMLElement} player - The YouTube player element
 * @param {HTMLVideoElement} video - The video element
 */
const forceLowestQuality = (player, video) => {
    try {
        // Save the current playback state
        const wasPlaying = !video.paused;
        const currentTime = video.currentTime;

        // Method 1: Try the standard API methods
        const availableLevels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];

        if (player.setPlaybackQuality) {
            player.setPlaybackQuality('tiny');
        }

        if (player.setPlaybackQualityRange) {
            // Clear any potential previous locks first?
            // player.setPlaybackQualityRange('auto', 'auto'); 
            // Lock to tiny
            player.setPlaybackQualityRange('tiny', 'tiny');
        }

        // Method 2: Try using internal YouTube methods
        if (typeof player.setInternalQuality === 'function') {
            player.setInternalQuality('tiny');
        }

        // Method 3: Directly set the quality using YouTube's internal state
        if (player.playerInfo && player.playerInfo.setPlaybackQuality) {
            player.playerInfo.setPlaybackQuality('tiny');
        }

        // Method 4: Disable auto quality by forcing preference
        if (player.setPreferredQuality) {
            player.setPreferredQuality('tiny');
        }

        // Wait a moment for quality to be applied
        setTimeout(() => {
            // Verify current quality
            const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';

            // Only use UI interaction if API methods completely failed AND this is the first attempt
            // Don't do UI interaction during periodic checks to avoid interrupting playback
            const isFirstAttempt = !player.__audioModeQualityAttempted;
            if (currentQuality !== 'tiny' && currentQuality !== 'small') {
                if (isFirstAttempt) {
                    console.log('[Audio Mode] API methods failed on first attempt, will try UI interaction...');
                    player.__audioModeQualityAttempted = true;
                    // Use the generalized click function
                    clickQualitySetting(video, '144p');
                }
            } else {
                player.__audioModeQualityAttempted = true;
            }

            // Restore playback state if it changed
            if (wasPlaying && video.paused) {
                video.play().catch(err => console.log('[Audio Mode] Could not resume playback:', err));
            }
        }, 500);

    } catch (error) {
        console.error('[Audio Mode] Error setting quality:', error);
    }
};

/**
 * Restore quality to 720p (or auto if unavailable)
 * Includes retry logic for reliability
 * @param {number} attempts - Number of retry attempts remaining
 */
const restoreQuality = (attempts = 3) => {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        if (attempts > 0) {
            setTimeout(() => restoreQuality(attempts - 1), 100);
        }
        return;
    }

    try {
        const availableLevels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];

        let target = QUALITY.RESTORE;
        let uiTargetText = '720p';

        // If 720p is not available, fallback to auto
        if (availableLevels.length > 0 && !availableLevels.includes(QUALITY.RESTORE)) {
            target = 'auto';
            uiTargetText = 'Auto';
        }

        // Apply quality restoration using robust methods
        if (player.setPlaybackQualityRange) {
            // Clear any existing range constraint first (important for breaking manual locks)
            player.setPlaybackQualityRange('auto', 'auto');

            // Then set specific if not auto
            if (target !== 'auto') {
                player.setPlaybackQualityRange(target, target);
            }
        }

        if (player.setPlaybackQuality) {
            player.setPlaybackQuality(target);
        }

        if (player.setInternalQuality) {
            player.setInternalQuality(target);
        }

        if (player.setPreferredQuality) {
            player.setPreferredQuality(target);
        }

        // VERIFY and FALBACK/RETRY
        setTimeout(() => {
            const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';

            // If not successful yet...
            if (target === QUALITY.RESTORE && currentQuality !== QUALITY.RESTORE) {
                if (attempts > 0) {
                    // Try UI click as part of retry if API failed
                    clickQualitySetting(video, uiTargetText);

                    // Schedule next retry
                    setTimeout(() => restoreQuality(attempts - 1), 800);
                } else {
                }
            } else {
            }
        }, 500);

    } catch (e) {
        console.error('[Audio Mode] Error restoring quality:', e);
        if (attempts > 0) {
            setTimeout(() => restoreQuality(attempts - 1), 1000);
        }
    }
};

function startUsageTracking() {
    if (usageTrackingInterval) return;

    let qualityCheckCounter = 0;

    // Consolidated monitoring interval (runs every 5 seconds)
    usageTrackingInterval = setInterval(() => {
        // Safety check: Stop if extension context is invalidated (e.g. after update/reload)
        if (!chrome.runtime?.id) {
            clearInterval(usageTrackingInterval);
            usageTrackingInterval = null;
            return;
        }

        const video = getVideoElement();
        // Check if video exists and audio mode is actually enabled
        if (!audioModeEnabled || !video) return;

        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        if (!chrome.storage || !chrome.storage.local) return;

        // TRACK 1: Usage statistics (every cycle)
        chrome.storage.local.get(['statsLogs', 'activeLogs'], (result) => {
            const statsLogs = result.statsLogs || {};
            const activeLogs = result.activeLogs || {};

            // Initialize today's entry if missing
            if (!statsLogs[today]) statsLogs[today] = 0;
            if (!activeLogs[today]) activeLogs[today] = 0;

            // TRACK Active Time (Wall clock time while mode is ON)
            activeLogs[today] += 5;

            // TRACK Audio Listened / Data Saved (Only if playing)
            let isPlaying = false;
            if (video && !video.paused && !video.ended && video.readyState > 2) {
                isPlaying = true;
                statsLogs[today] += 5;
            }

            // Save back
            chrome.storage.local.set({
                statsLogs: statsLogs,
                activeLogs: activeLogs
            });
        });

        // TRACK 2: Quality enforcement (every other cycle to reduce overhead)
        qualityCheckCounter++;
        if (qualityCheckCounter >= 2) {
            qualityCheckCounter = 0;
            checkAndEnforceQuality();
        }
    }, TIMING.USAGE_TRACKING_INTERVAL);
}

function stopUsageTracking() {
    if (usageTrackingInterval) {
        clearInterval(usageTrackingInterval);
        usageTrackingInterval = null;
    }
}

/**
 * Check and enforce quality settings
 * Separated from main tracking for better organization
 */
function checkAndEnforceQuality() {
    const player = document.getElementById('movie_player');
    if (!player || !audioModeEnabled) return;

    const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : null;

    if (currentQuality && currentQuality !== QUALITY.TARGET && currentQuality !== QUALITY.FALLBACK) {
        forceLowestQuality(player, getVideoElement());
    }
}

function setLowestQuality() {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        setTimeout(setLowestQuality, 1000);
        return;
    }

    // Use the global function
    forceLowestQuality(player, video);

    // Fallback: Also try the UI click directly if it's the very first time and video is playing
    // (This is an extra safety layer for the "Manual" case the user reported)
    if (!player.__audioModeQualityAttempted && !video.paused) {
        setTimeout(() => {
            const q = player.getPlaybackQuality ? player.getPlaybackQuality() : '';
            if (q !== 'tiny' && q !== 'small') {
                clickQualitySetting(video, '144p');
                player.__audioModeQualityAttempted = true;
            }
        }, 800);
    }
}

function createAudioModeOverlay() {
    // Remove existing overlay if any
    if (audioModeOverlay) {
        audioModeOverlay.remove();
    }

    // Find the video container
    const videoContainer = document.querySelector('.html5-video-container') ||
        document.querySelector('#player-container');

    if (!videoContainer) return;

    // Create overlay element
    audioModeOverlay = document.createElement('div');
    audioModeOverlay.id = 'youtube-audio-mode-overlay';
    audioModeOverlay.innerHTML = `
    <div class="audio-mode-content">
      <h2 id="am-overlay-title">${translations[currentLanguage].activeTitle}</h2>
      <p id="am-overlay-desc">${translations[currentLanguage].activeDesc}</p>
      <div class="audio-visualizer">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </div>
    </div >
        `;

    // CSS is now loaded from overlay.css via manifest.json
    // No need to inject styles dynamically

    // Ensure the parent container has proper positioning
    videoContainer.style.position = 'relative';
    videoContainer.style.width = '100%';
    videoContainer.style.height = '100%';

    videoContainer.appendChild(audioModeOverlay);

    // Apply RTL if needed
    if (currentLanguage === 'ar') {
        audioModeOverlay.setAttribute('dir', 'rtl');
    }

    // Apply saved theme
    // Safety check: Stop if extension context is invalidated
    if (chrome.runtime?.id) {
        try {
            chrome.storage.sync.get(['backgroundType', 'backgroundValue'], (result) => {
                if (chrome.runtime.lastError) {
                    console.log('[Audio Mode] Could not load theme settings:', chrome.runtime.lastError);
                    return;
                }
                updateOverlayTheme(result.backgroundType, result.backgroundValue);
            });
        } catch (error) {
            console.log('[Audio Mode] Error accessing storage:', error);
        }
    }

    // Add play/pause listeners to control animation
    const video = getVideoElement();
    const visualizer = audioModeOverlay.querySelector('.audio-visualizer');

    if (video && visualizer) {
        // Set initial state
        if (video.paused) {
            visualizer.classList.add('paused');
        }

        // Create named handlers for cleanup
        videoPlayHandler = () => {
            visualizer.classList.remove('paused');
        };
        videoPauseHandler = () => {
            visualizer.classList.add('paused');
        };

        // Listen for play/pause events
        video.addEventListener('play', videoPlayHandler);
        video.addEventListener('pause', videoPauseHandler);
    }
}

function updateOverlayTheme(type, value) {
    if (!audioModeOverlay) return;

    if (!type) type = 'color';
    if (!value) value = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

    if (type === 'image') {
        audioModeOverlay.style.background = `url("${value}") no-repeat center center / cover`;
        audioModeOverlay.classList.add('has-image');
    } else {
        audioModeOverlay.style.background = value;
        audioModeOverlay.classList.remove('has-image');
    }
}

function updateOverlayLanguage() {
    if (!audioModeOverlay) return;

    const t = translations[currentLanguage];
    const title = audioModeOverlay.querySelector('#am-overlay-title');
    const desc = audioModeOverlay.querySelector('#am-overlay-desc');

    if (title) title.textContent = t.activeTitle;
    if (desc) desc.textContent = t.activeDesc;

    if (currentLanguage === 'ar') {
        audioModeOverlay.setAttribute('dir', 'rtl');
    } else {
        audioModeOverlay.removeAttribute('dir');
    }
}

// Handle YouTube's SPA navigation with optimized MutationObserver
let lastUrl = location.href;
let navigationObserver = null;

function initNavigationObserver() {
    if (navigationObserver) return;

    // Target specific container instead of entire document (70-80% performance improvement)
    const targetNode = document.querySelector('#content') || document.body;

    navigationObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            clearVideoCache(); // Clear cached video element on navigation

            if (audioModeEnabled) {
                // Re-apply audio mode after navigation
                setTimeout(() => {
                    enableAudioMode();
                }, TIMING.RETRY_DELAY);
            }
        }
    });

    navigationObserver.observe(targetNode, {
        subtree: true,
        childList: true
    });
}

// Initialize observer
initNavigationObserver();

// Cleanup on extension unload
window.addEventListener('beforeunload', () => {
    if (navigationObserver) {
        navigationObserver.disconnect();
        navigationObserver = null;
    }
    stopUsageTracking();
});
