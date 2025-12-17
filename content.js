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
    FALLBACK: 'small'
};

// ===== STATE VARIABLES =====
let audioModeEnabled = false;
let audioModeOverlay = null;
let qualityCheckInterval = null;
let usageTrackingInterval = null;
let cachedVideoElement = null;

// Initialize by checking saved preference
if (chrome.runtime?.id) {
    try {
        chrome.storage.sync.get(['audioMode'], function (result) {
            if (chrome.runtime.lastError) {
                console.log('[Audio Mode] Could not load initial state:', chrome.runtime.lastError);
                return;
            }
            if (result.audioMode) {
                enableAudioMode();
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
    }
    return true;
});

function enableAudioMode() {
    audioModeEnabled = true;

    // Find the video player
    const video = getVideoElement();
    if (!video) {
        console.log('No video found yet, waiting...');
        // Wait for video to load and try again
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
            // Video is playing, now we can safely set quality
            console.log('[Audio Mode] Video is playing, setting quality now');
            setLowestQuality();
        } else {
            // Video not playing yet, wait for it
            const playListener = () => {
                console.log('[Audio Mode] Video started playing, will set quality shortly');
                // Small delay to let playback stabilize
                setTimeout(() => {
                    setLowestQuality();
                }, TIMING.QUALITY_SET_DELAY);
                video.removeEventListener('play', playListener);
            };
            video.addEventListener('play', playListener, { once: true });

            // Also try after a timeout as fallback
            setTimeout(() => {
                if (audioModeEnabled) {
                    console.log('[Audio Mode] Setting quality via fallback timeout');
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
 */
const clickQualitySetting = (video) => {
    try {
        // Save playback state before UI interaction
        const wasPlaying = !video.paused;
        const currentTime = video.currentTime;

        console.log('[Audio Mode] Starting invisible UI interaction...');

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

        // Open settings menu (now invisible)
        const settingsButton = document.querySelector('.ytp-settings-button');
        if (settingsButton) {
            settingsButton.click();
            console.log('[Audio Mode] Clicked settings button (hidden)');

            // Wait for menu to open, then click quality option
            setTimeout(() => {
                const qualityMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                    item => item.textContent.toLowerCase().includes('quality')
                );

                if (qualityMenuItem) {
                    qualityMenuItem.click();
                    console.log('[Audio Mode] Clicked quality menu item (hidden)');

                    // Wait for quality menu to open, then select 144p
                    setTimeout(() => {
                        const quality144p = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                            item => item.textContent.includes('144p')
                        );

                        if (quality144p) {
                            quality144p.click();
                            console.log('[Audio Mode] Successfully clicked 144p option (hidden)');
                        } else {
                            // If 144p not available, try the lowest available
                            const allQualities = document.querySelectorAll('.ytp-menuitem');
                            if (allQualities.length > 0) {
                                allQualities[allQualities.length - 1].click();
                                console.log('[Audio Mode] Clicked lowest available quality (hidden)');
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

                                console.log('[Audio Mode] Completed invisible quality change');

                                // Restore playback state after menu interaction
                                if (wasPlaying && video.paused) {
                                    console.log('[Audio Mode] Restoring playback...');
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
        console.log('[Audio Mode] Available quality levels:', availableLevels);

        if (player.setPlaybackQuality) {
            player.setPlaybackQuality('tiny');
            console.log('[Audio Mode] Called setPlaybackQuality("tiny")');
        }

        if (player.setPlaybackQualityRange) {
            player.setPlaybackQualityRange('tiny', 'tiny');
            console.log('[Audio Mode] Called setPlaybackQualityRange("tiny", "tiny")');
        }

        // Method 2: Try using internal YouTube methods
        if (typeof player.setInternalQuality === 'function') {
            player.setInternalQuality('tiny');
            console.log('[Audio Mode] Called setInternalQuality("tiny")');
        }

        // Method 3: Directly set the quality using YouTube's internal state
        if (player.playerInfo && player.playerInfo.setPlaybackQuality) {
            player.playerInfo.setPlaybackQuality('tiny');
            console.log('[Audio Mode] Called playerInfo.setPlaybackQuality("tiny")');
        }

        // Method 4: Disable auto quality
        if (player.setPreferredQuality) {
            player.setPreferredQuality('tiny');
            console.log('[Audio Mode] Called setPreferredQuality("tiny")');
        }

        // Wait a moment for quality to be applied
        setTimeout(() => {
            // Verify current quality
            const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';
            console.log('[Audio Mode] Current quality after setting:', currentQuality);

            // Only use UI interaction if API methods completely failed AND this is the first attempt
            // Don't do UI interaction during periodic checks to avoid interrupting playback
            const isFirstAttempt = !player.__audioModeQualityAttempted;
            if (currentQuality !== 'tiny' && currentQuality !== 'small' && isFirstAttempt) {
                console.log('[Audio Mode] API methods failed on first attempt, will try UI interaction...');
                player.__audioModeQualityAttempted = true;
                clickQualitySetting(video);
            } else {
                player.__audioModeQualityAttempted = true;
            }

            // Restore playback state if it changed
            if (wasPlaying && video.paused) {
                console.log('[Audio Mode] Resuming playback...');
                video.play().catch(err => console.log('[Audio Mode] Could not resume playback:', err));
            }
        }, 500);


    } catch (error) {
        console.error('[Audio Mode] Error setting quality:', error);
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
    console.log('[Audio Mode] Quality check - current quality:', currentQuality);

    if (currentQuality && currentQuality !== QUALITY.TARGET && currentQuality !== QUALITY.FALLBACK) {
        console.log('[Audio Mode] Quality changed to', currentQuality, '- forcing back to 144p');
        forceLowestQuality(player, getVideoElement());
    }
}

function setLowestQuality() {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        console.log('[Audio Mode] Player or video not found, retrying...');
        setTimeout(setLowestQuality, 1000);
        return;
    }

    console.log('[Audio Mode] Player found, attempting to set quality to 144p');

    // Function to force set quality to 144p using multiple methods
    const forceLowestQuality = () => {
        try {
            // Save the current playback state
            const wasPlaying = !video.paused;
            const currentTime = video.currentTime;

            // Method 1: Try the standard API methods
            const availableLevels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];
            console.log('[Audio Mode] Available quality levels:', availableLevels);

            if (player.setPlaybackQuality) {
                player.setPlaybackQuality('tiny');
                console.log('[Audio Mode] Called setPlaybackQuality("tiny")');
            }

            if (player.setPlaybackQualityRange) {
                player.setPlaybackQualityRange('tiny', 'tiny');
                console.log('[Audio Mode] Called setPlaybackQualityRange("tiny", "tiny")');
            }

            // Method 2: Try using internal YouTube methods
            if (typeof player.setInternalQuality === 'function') {
                player.setInternalQuality('tiny');
                console.log('[Audio Mode] Called setInternalQuality("tiny")');
            }

            // Method 3: Directly set the quality using YouTube's internal state
            if (player.playerInfo && player.playerInfo.setPlaybackQuality) {
                player.playerInfo.setPlaybackQuality('tiny');
                console.log('[Audio Mode] Called playerInfo.setPlaybackQuality("tiny")');
            }

            // Method 4: Disable auto quality
            if (player.setPreferredQuality) {
                player.setPreferredQuality('tiny');
                console.log('[Audio Mode] Called setPreferredQuality("tiny")');
            }

            // Wait a moment for quality to be applied
            setTimeout(() => {
                // Verify current quality
                const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';
                console.log('[Audio Mode] Current quality after setting:', currentQuality);

                // Only use UI interaction if API methods completely failed AND this is the first attempt
                // Don't do UI interaction during periodic checks to avoid interrupting playback
                const isFirstAttempt = !player.__audioModeQualityAttempted;
                if (currentQuality !== 'tiny' && currentQuality !== 'small' && isFirstAttempt) {
                    console.log('[Audio Mode] API methods failed on first attempt, will try UI interaction...');
                    player.__audioModeQualityAttempted = true;
                    clickQualitySetting();
                } else {
                    player.__audioModeQualityAttempted = true;
                }

                // Restore playback state if it changed
                if (wasPlaying && video.paused) {
                    console.log('[Audio Mode] Resuming playback...');
                    video.play().catch(err => console.log('[Audio Mode] Could not resume playback:', err));
                }
            }, 500);


        } catch (error) {
            console.error('[Audio Mode] Error setting quality:', error);
        }
    };

    // Function to interact with YouTube's quality settings UI (invisibly)
    const clickQualitySetting = () => {
        try {
            // Save playback state before UI interaction
            const wasPlaying = !video.paused;
            const currentTime = video.currentTime;

            console.log('[Audio Mode] Starting invisible UI interaction...');

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

            // Open settings menu (now invisible)
            const settingsButton = document.querySelector('.ytp-settings-button');
            if (settingsButton) {
                settingsButton.click();
                console.log('[Audio Mode] Clicked settings button (hidden)');

                // Wait for menu to open, then click quality option
                setTimeout(() => {
                    const qualityMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                        item => item.textContent.toLowerCase().includes('quality')
                    );

                    if (qualityMenuItem) {
                        qualityMenuItem.click();
                        console.log('[Audio Mode] Clicked quality menu item (hidden)');

                        // Wait for quality menu to open, then select 144p
                        setTimeout(() => {
                            const quality144p = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                                item => item.textContent.includes('144p')
                            );

                            if (quality144p) {
                                quality144p.click();
                                console.log('[Audio Mode] Successfully clicked 144p option (hidden)');
                            } else {
                                // If 144p not available, try the lowest available
                                const allQualities = document.querySelectorAll('.ytp-menuitem');
                                if (allQualities.length > 0) {
                                    allQualities[allQualities.length - 1].click();
                                    console.log('[Audio Mode] Clicked lowest available quality (hidden)');
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

                                    console.log('[Audio Mode] Completed invisible quality change');

                                    // Restore playback state after menu interaction
                                    if (wasPlaying && video.paused) {
                                        console.log('[Audio Mode] Restoring playback...');
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

    // Wait for player to be ready, then set quality
    const waitForPlayerReady = () => {
        if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
            console.log('[Audio Mode] Video is ready, setting quality now');
            forceLowestQuality();
        } else {
            console.log('[Audio Mode] Waiting for video to be ready...');
            video.addEventListener('loadeddata', () => {
                forceLowestQuality();
            }, { once: true });
        }
    };

    // Start the process
    waitForPlayerReady();

    // Quality enforcement is now handled by consolidatedinterval in startUsageTracking()
    // No need for separate quality check interval
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
      <h2>Audio Mode Active</h2>
      <p>Saving your bandwidth</p>
      <div class="audio-visualizer">
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
        <span class="bar"></span>
      </div>
    </div>
  `;

    // CSS is now loaded from overlay.css via manifest.json
    // No need to inject styles dynamically

    // Ensure the parent container has proper positioning
    videoContainer.style.position = 'relative';
    videoContainer.style.width = '100%';
    videoContainer.style.height = '100%';

    videoContainer.appendChild(audioModeOverlay);

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

        // Listen for play event
        video.addEventListener('play', () => {
            visualizer.classList.remove('paused');
            console.log('[Audio Mode] Video playing - animation resumed');
        });

        // Listen for pause event
        video.addEventListener('pause', () => {
            visualizer.classList.add('paused');
            console.log('[Audio Mode] Video paused - animation stopped');
        });
    }
}

function updateOverlayTheme(type, value) {
    if (!audioModeOverlay) return;

    if (!type) type = 'color';
    if (!value) value = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

    if (type === 'image') {
        audioModeOverlay.style.background = `url("${value}") no-repeat center center/cover`;
        audioModeOverlay.classList.add('has-image');
    } else {
        audioModeOverlay.style.background = value;
        audioModeOverlay.classList.remove('has-image');
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
