// YouTube Audio Mode - Content Script
// This script runs on YouTube pages and enables audio-only playback

// ===== HELPER: Check if on video page =====
function isOnVideoPage() {
    return window.location.pathname === '/watch' &&
           new URLSearchParams(window.location.search).has('v');
}

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
let lastAppliedVideoId = null;
let currentModeType = 'always'; // 'always' or 'filtered'
let savedQualityBeforeAudioMode = null; // Store user's quality to restore later

// Quality operation locking state - prevents duplicate popup openings
let qualityOperationInProgress = false;
let qualityOperationTimeout = null;
let lastQualityOperationType = null; // 'set' or 'restore'

// Current language and loaded messages
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
        currentLanguage = lang;
        return messages;
    } catch (error) {
        console.error(`Failed to load messages for ${lang}:`, error);
        return null;
    }
}

// Initialize by checking saved preference
if (chrome.runtime?.id) {
    try {
        chrome.storage.sync.get(['audioModeType', 'language', 'preferredQuality'], async function (result) {
            if (chrome.runtime.lastError) {
                console.log('[Audio Mode] Could not load initial state:', chrome.runtime.lastError);
                return;
            }

            // Load language messages
            if (result.language) {
                await loadMessages(result.language);
            } else {
                // Detect from browser
                const detectedLang = chrome.i18n.getUILanguage().startsWith('ar') ? 'ar' : 'en';
                await loadMessages(detectedLang);
            }

            // Load user's preferred quality (for restore after audio mode)
            if (result.preferredQuality) {
                savedQualityBeforeAudioMode = result.preferredQuality;
                console.log('[Audio Mode] Loaded preferred quality:', savedQualityBeforeAudioMode);
            }

            // Set the current mode type
            currentModeType = result.audioModeType || 'always';

            // Apply mode logic
            await applyModeLogic();
        });
    } catch (error) {
        console.log('[Audio Mode] Error during initialization:', error);
    }
}

// ===== MODE LOGIC =====

/**
 * Apply the current mode logic
 * - 'always': Enable audio mode on all YouTube videos
 * - 'filtered': Enable/disable based on filter rules, OFF if no match
 * - 'off': Extension disabled, normal video playback
 */
async function applyModeLogic() {
    // Only apply on video pages
    if (!isOnVideoPage()) {
        // If we navigated away from a video, disable audio mode
        if (audioModeEnabled) {
            disableAudioMode(true);
        }
        return;
    }

    if (currentModeType === 'off') {
        // Off mode: disable audio mode, use preferred quality
        if (audioModeEnabled) {
            disableAudioMode(true);
        } else {
            applyPreferredQuality();
        }
    } else if (currentModeType === 'always') {
        // Always On mode: enable audio mode on all videos
        if (!audioModeEnabled) {
            enableAudioMode(true); // fromAutoRule = true, don't persist
        } else {
            // Already enabled but navigated to new video - re-apply quality
            setLowestQuality();
        }
    } else {
        // Filtered mode: check filter rules
        await applyFilteredMode();
    }
}

/**
 * Apply user's preferred quality to the current video
 * Uses the central quality operation handler to prevent duplicate popups
 */
function applyPreferredQuality() {
    requestQualityOperation('preferred');
}

/**
 * Internal: Apply user's preferred quality to the current video
 * Used when audio mode is OFF (normal video playback)
 * @param {Function} onComplete - Callback when operation completes
 */
function applyPreferredQualityInternal(onComplete = null) {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        // Retry if player not ready
        setTimeout(() => applyPreferredQualityInternal(onComplete), 500);
        return;
    }

    chrome.storage.sync.get(['preferredQuality'], (result) => {
        const quality = result.preferredQuality;
        if (!quality || quality === 'auto') {
            // Auto or not set - let YouTube handle it
            onComplete?.();
            return;
        }

        // Map quality codes to UI text for click fallback
        const qualityToText = {
            'hd2160': '2160p',
            'hd1440': '1440p',
            'hd1080': '1080p',
            'hd720': '720p',
            'large': '480p',
            'medium': '360p',
            'small': '240p',
            'tiny': '144p'
        };
        const uiTargetText = qualityToText[quality] || '720p';

        console.log('[Audio Mode] Applying preferred quality:', quality);

        try {
            // Try API methods first
            if (player.setPlaybackQualityRange) {
                player.setPlaybackQualityRange(quality, quality);
            }
            if (player.setPlaybackQuality) {
                player.setPlaybackQuality(quality);
            }

            // Verify after a moment and use UI fallback if needed
            setTimeout(() => {
                const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';

                if (currentQuality !== quality) {
                    console.log('[Audio Mode] API failed, using UI click for preferred quality');
                    clickQualitySetting(video, uiTargetText, onComplete);
                } else {
                    onComplete?.();
                }
            }, 500);
        } catch (e) {
            console.log('[Audio Mode] Could not apply preferred quality:', e);
            onComplete?.();
        }
    });
}

/**
 * Apply filtered mode logic (whitelist-only)
 * If channel/keyword matches whitelist → enable audio mode
 * Otherwise → normal video (no audio mode)
 */
async function applyFilteredMode(retryCount = 0) {
    if (!chrome.runtime?.id) return;
    if (!isOnVideoPage()) return; // Safeguard

    const MAX_RETRIES = 5;
    const RETRY_DELAY = 600;

    try {
        const result = await new Promise(resolve => {
            chrome.storage.sync.get(['filterRules'], resolve);
        });

        // Wait for DOM to settle after SPA navigation
        // First attempt needs longer delay for YouTube to update DOM
        const initialDelay = retryCount === 0 ? 500 : 400;
        await new Promise(resolve => setTimeout(resolve, initialDelay));

        const videoInfo = getCurrentVideoInfo();
        console.log('[Audio Mode] Video info:', videoInfo, 'Retry:', retryCount);

        // If we can't get video info, retry a few times before giving up
        // Check for both channelId AND videoTitle to ensure keyword filtering works
        if (!videoInfo || !videoInfo.channelId || !videoInfo.videoTitle) {
            if (retryCount < MAX_RETRIES) {
                console.log('[Audio Mode] No video info yet, retrying...');
                setTimeout(() => applyFilteredMode(retryCount + 1), RETRY_DELAY);
                return;
            }

            // Max retries reached - disable audio mode
            if (audioModeEnabled) {
                console.log('[Audio Mode] No video info after retries - disabling');
                disableAudioMode(true);
            }
            return;
        }

        // Track this video
        lastAppliedVideoId = videoInfo.videoId;

        // Check whitelist only
        const shouldEnable = checkWhitelist(videoInfo, result.filterRules);
        console.log('[Audio Mode] Should enable:', shouldEnable);

        if (shouldEnable) {
            if (!audioModeEnabled) {
                console.log('[Audio Mode] Whitelist match - enabling');
                enableAudioMode(true);
            } else {
                // Already enabled but navigated to new video - re-apply quality
                console.log('[Audio Mode] Already enabled, re-applying 144p quality');
                setLowestQuality();
            }
        } else {
            // No match - normal video
            if (audioModeEnabled) {
                console.log('[Audio Mode] No whitelist match - disabling');
                disableAudioMode(true);
            } else {
                // Not in audio mode - apply user's preferred quality
                console.log('[Audio Mode] Normal video - applying preferred quality');
                applyPreferredQuality();
            }
        }
    } catch (error) {
        console.error('[Audio Mode] Error in filtered mode:', error);
    }
}

/**
 * Check if video matches whitelist (channels or keywords)
 */
function checkWhitelist(videoInfo, filterRules) {
    if (!videoInfo || !filterRules) return false;

    const { videoTitle, channelId } = videoInfo;
    const whitelist = filterRules.whitelist;

    if (!whitelist) return false;

    // Check channel whitelist
    if (channelId && whitelist.channels?.length > 0) {
        const match = whitelist.channels.find(c => c.id === channelId);
        if (match) {
            console.log(`[Audio Mode] Channel match: ${match.name}`);
            return true;
        }
    }

    // Check keyword whitelist
    if (videoTitle && whitelist.keywords?.length > 0) {
        const titleLower = videoTitle.toLowerCase();
        for (const kw of whitelist.keywords) {
            const pattern = kw.keyword.toLowerCase();
            if (titleLower.includes(pattern)) {
                console.log(`[Audio Mode] Keyword match: "${kw.keyword}"`);
                return true;
            }
        }
    }

    return false;
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

/**
 * Reset quality attempt flag (needed when navigating to new video)
 * This allows the UI fallback to work on the new video
 */
function resetQualityAttemptFlag() {
    const player = document.getElementById('movie_player');
    if (player) {
        delete player.__audioModeQualityAttempted;
    }
}

/**
 * Central handler for quality operations with debouncing and mutual exclusion
 * Prevents duplicate quality popup openings when multiple events trigger quality changes
 * @param {string} type - 'set' (144p) or 'restore' (user preferred)
 * @param {number} debounceMs - Debounce delay (default 300ms)
 */
function requestQualityOperation(type, debounceMs = 300) {
    // Cancel any pending operation request
    if (qualityOperationTimeout) {
        clearTimeout(qualityOperationTimeout);
        qualityOperationTimeout = null;
    }

    // If same type operation already in progress, skip
    if (qualityOperationInProgress && lastQualityOperationType === type) {
        console.log(`[Audio Mode] Quality operation '${type}' already in progress, skipping`);
        return;
    }

    // Debounce to consolidate rapid triggers
    qualityOperationTimeout = setTimeout(() => {
        qualityOperationTimeout = null;
        executeQualityOperation(type);
    }, debounceMs);
}

/**
 * Execute a quality operation with mutual exclusion
 * @param {string} type - 'set', 'restore', or 'preferred'
 */
function executeQualityOperation(type) {
    if (qualityOperationInProgress) {
        console.log(`[Audio Mode] Quality operation in progress, queuing '${type}'`);
        // Queue for after current operation completes
        setTimeout(() => requestQualityOperation(type, 100), 500);
        return;
    }

    qualityOperationInProgress = true;
    lastQualityOperationType = type;

    const cleanup = () => {
        qualityOperationInProgress = false;
        lastQualityOperationType = null;
    };

    if (type === 'set') {
        setLowestQualityInternal(cleanup);
    } else if (type === 'restore') {
        restoreQualityInternal(cleanup);
    } else if (type === 'preferred') {
        applyPreferredQualityInternal(cleanup);
    }
}

/**
 * Cancel any pending quality operations
 * Called during navigation to prevent stale operations
 */
function cancelPendingQualityOperations() {
    if (qualityOperationTimeout) {
        clearTimeout(qualityOperationTimeout);
        qualityOperationTimeout = null;
    }
    // Don't reset qualityOperationInProgress here - let ongoing operations complete
}

// ===== VIDEO INFO EXTRACTION (for whitelist/blacklist) =====

/**
 * Extract channel information from YouTube page
 * Uses DOM-based extraction which is more reliable after SPA navigation
 * @returns {Object|null} Channel info or null
 */
function extractChannelInfo() {
    try {
        // Method 1: DOM-based extraction (most reliable for SPA navigation)
        // Try multiple selectors for channel link
        const channelSelectors = [
            '#owner ytd-channel-name a',
            'ytd-video-owner-renderer ytd-channel-name a',
            '#channel-name a',
            'ytd-channel-name a'
        ];

        for (const selector of channelSelectors) {
            const channelLink = document.querySelector(selector);
            if (channelLink) {
                const href = channelLink.getAttribute('href');
                const channelName = channelLink.textContent?.trim();

                // Extract channel ID from href
                let channelId = null;
                if (href) {
                    // Match /channel/UCxxxxxx pattern
                    const channelIdMatch = href.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
                    if (channelIdMatch) {
                        channelId = channelIdMatch[1];
                    } else {
                        // Match /@username pattern - use the href as identifier
                        const handleMatch = href.match(/\/@([^\/\?]+)/);
                        if (handleMatch) {
                            channelId = `@${handleMatch[1]}`;
                        }
                    }
                }

                if (channelId && channelName) {
                    console.log(`[Audio Mode] Channel found: ${channelName} (${channelId})`);
                    return { channelId, channelName };
                }
            }
        }

        // Method 2: Try ytInitialPlayerResponse (embedded in page)
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent;
            if (text && text.includes('ytInitialPlayerResponse')) {
                const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
                if (match) {
                    try {
                        const data = JSON.parse(match[1]);
                        const channelId = data?.videoDetails?.channelId;
                        const channelName = data?.videoDetails?.author;
                        if (channelId && channelName) {
                            return { channelId, channelName };
                        }
                    } catch (e) {
                        // JSON parse failed, continue
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error('[Audio Mode] Error extracting channel info:', error);
        return null;
    }
}

/**
 * Extract current video information from YouTube page
 * @returns {Object|null} Video info object or null if not available
 */
function getCurrentVideoInfo() {
    try {
        // Get video ID from URL
        const videoId = new URLSearchParams(window.location.search).get('v');
        if (!videoId) return null;

        // Get video title - try multiple sources for SPA navigation compatibility
        let videoTitle = '';

        // Method 1: document.title (updates during SPA navigation)
        // Format: "Video Title - YouTube"
        if (document.title && document.title !== 'YouTube') {
            videoTitle = document.title.replace(/ - YouTube$/, '').trim();
        }

        // Method 2: Modern YouTube layout h1 selectors
        if (!videoTitle) {
            const h1Selectors = [
                'h1.ytd-watch-metadata yt-formatted-string',
                'ytd-watch-metadata h1 yt-formatted-string',
                '#title h1 yt-formatted-string',
                'h1.ytd-video-primary-info-renderer'
            ];
            for (const selector of h1Selectors) {
                const h1 = document.querySelector(selector);
                if (h1?.textContent?.trim()) {
                    videoTitle = h1.textContent.trim();
                    break;
                }
            }
        }

        // Method 3: Meta tag (fallback, may be stale during SPA)
        if (!videoTitle) {
            const titleMeta = document.querySelector('meta[name="title"]');
            videoTitle = titleMeta?.getAttribute('content') || '';
        }

        // Get channel info
        const channelInfo = extractChannelInfo();

        return {
            videoId,
            videoTitle,
            channelId: channelInfo?.channelId || null,
            channelName: channelInfo?.channelName || null
        };
    } catch (error) {
        console.error('[Audio Mode] Error extracting video info:', error);
        return null;
    }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.action === 'modeChanged') {
        // Mode was changed in popup
        currentModeType = request.mode;
        lastAppliedVideoId = null; // Force re-evaluation
        applyModeLogic().then(() => {
            sendResponse({ success: true });
        });
        return true; // Keep channel open for async
    } else if (request.action === 'getStatus') {
        sendResponse({ enabled: audioModeEnabled, mode: currentModeType });
    } else if (request.action === 'updateTheme') {
        updateOverlayTheme(request.backgroundType, request.backgroundValue);
    } else if (request.action === 'updateLanguage') {
        currentLanguage = request.language;
        updateOverlayLanguage().then(() => {
            sendResponse({ success: true });
        }).catch(err => {
            sendResponse({ success: false, error: err.message });
        });
        return true; // Keep message channel open for async response
    } else if (request.action === 'getVideoInfo') {
        sendResponse(getCurrentVideoInfo());
    }
    return true;
});

// Listen for storage changes to re-apply mode logic
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        if (changes.audioModeType) {
            // Mode type changed
            currentModeType = changes.audioModeType.newValue || 'always';
            lastAppliedVideoId = null;
            applyModeLogic();
        } else if (changes.filterRules && currentModeType === 'filtered') {
            // Filter rules changed while in filtered mode
            lastAppliedVideoId = null;
            applyFilteredMode();
        }
    }
});

async function enableAudioMode(fromAutoRule = false) {
    audioModeEnabled = true;

    // Reset quality attempt flag to allow fresh UI fallback attempt
    // This is important when enabling audio mode after adding a channel to whitelist
    resetQualityAttemptFlag();

    // Find the video player
    const video = getVideoElement();
    if (!video) {
        setTimeout(enableAudioMode, TIMING.RETRY_DELAY);
        return;
    }

    // Save current quality before changing (to restore later)
    // Only save if NOT already in audio mode quality (tiny/small)
    const player = document.getElementById('movie_player');
    if (player && player.getPlaybackQuality) {
        const currentQuality = player.getPlaybackQuality();
        // Only save if it's a real quality (not audio mode's 144p/240p)
        if (currentQuality !== 'tiny' && currentQuality !== 'small') {
            savedQualityBeforeAudioMode = currentQuality;
            // Persist to storage so it survives page reloads
            chrome.storage.sync.set({ preferredQuality: currentQuality });
            console.log('[Audio Mode] Saved quality:', savedQualityBeforeAudioMode);
        }
    }

    // Hide video by making it transparent and small
    video.style.opacity = '0';
    video.style.maxHeight = '1px';
    video.style.minHeight = '1px';

    // Create visual overlay first for immediate feedback
    await createAudioModeOverlay();

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

    // Save preference (only if manually enabled, not from auto-rules)
    if (!fromAutoRule && chrome.runtime?.id) {
        try {
            chrome.storage.sync.set({ audioMode: true });
        } catch (error) {
            console.log('[Audio Mode] Could not save state:', error);
        }
    }

    // Start tracking usage for data saved stats
    startUsageTracking();
}

function disableAudioMode(fromAutoRule = false) {
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

    // Cancel any pending quality setting operations
    currentQualityOperationId++;

    // Reset YouTube's settings UI styles (uses the resetSettingsUIStyles function)
    resetSettingsUIStyles();

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

    // Save preference (only if manually disabled, not from auto-rules)
    if (!fromAutoRule && chrome.runtime?.id) {
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

// Track current quality setting operation to cancel stale callbacks
let currentQualityOperationId = 0;

/**
 * Reset YouTube player settings UI styles
 * Call this after any operation that might have hidden the settings panel
 */
function resetSettingsUIStyles() {
    const settingsPanel = document.querySelector('.ytp-settings-menu');
    const popup = document.querySelector('.ytp-popup');

    if (settingsPanel) {
        settingsPanel.style.visibility = '';
        settingsPanel.style.opacity = '';
        settingsPanel.style.pointerEvents = '';
    }
    if (popup) {
        popup.style.visibility = '';
        popup.style.opacity = '';
        popup.style.pointerEvents = '';
    }
}

/**
 * Function to interact with YouTube's quality settings UI (invisibly)
 * @param {HTMLVideoElement} video - The video element
 * @param {string} targetText - The text to look for (e.g. '144p', '720p', 'Auto')
 * @param {Function} onComplete - Optional callback when operation completes
 */
const clickQualitySetting = (video, targetText = '144p', onComplete = null) => {
    // Increment operation ID to invalidate any pending callbacks
    const operationId = ++currentQualityOperationId;

    try {
        const wasPlaying = !video.paused;
        const currentTime = video.currentTime;

        // Hide the settings panel from view (re-query each time)
        const settingsPanel = document.querySelector('.ytp-settings-menu');
        const popup = document.querySelector('.ytp-popup');

        if (settingsPanel) {
            settingsPanel.style.visibility = 'hidden';
            settingsPanel.style.opacity = '0';
            settingsPanel.style.pointerEvents = 'none';
        }

        if (popup) {
            popup.style.visibility = 'hidden';
            popup.style.opacity = '0';
            popup.style.pointerEvents = 'none';
        }

        const settingsButton = document.querySelector('.ytp-settings-button');
        if (settingsButton) {
            settingsButton.click();

            setTimeout(() => {
                // Check if this operation is still valid
                if (operationId !== currentQualityOperationId) {
                    resetSettingsUIStyles();
                    onComplete?.();
                    return;
                }

                const qualityMenuItem = Array.from(document.querySelectorAll('.ytp-menuitem')).find(
                    item => item.textContent.toLowerCase().includes('quality')
                );

                if (qualityMenuItem) {
                    qualityMenuItem.click();

                    setTimeout(() => {
                        // Check if this operation is still valid
                        if (operationId !== currentQualityOperationId) {
                            resetSettingsUIStyles();
                            onComplete?.();
                            return;
                        }

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
                            // Check if this operation is still valid
                            if (operationId !== currentQualityOperationId) {
                                resetSettingsUIStyles();
                                onComplete?.();
                                return;
                            }

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

                            // Re-query and restore styles after a brief delay
                            setTimeout(() => {
                                // Always reset styles, regardless of operation validity
                                resetSettingsUIStyles();

                                if (wasPlaying && video.paused) {
                                    video.currentTime = currentTime;
                                    video.play().catch(err => console.log('[Audio Mode] Could not resume:', err));
                                }

                                // Signal completion
                                onComplete?.();
                            }, 200);
                        }, 100);
                    }, 300);
                } else {
                    // No quality menu found, cleanup
                    resetSettingsUIStyles();
                    onComplete?.();
                }
            }, 300);
        } else {
            // No settings button found
            onComplete?.();
        }
    } catch (error) {
        console.error('[Audio Mode] Error in invisible UI interaction:', error);
        resetSettingsUIStyles();
        onComplete?.();
    }
};

/**
 * Function to force set quality to 144p using multiple methods
 * @param {HTMLElement} player - The YouTube player element
 * @param {HTMLVideoElement} video - The video element
 * @param {Function} onComplete - Optional callback when operation completes
 */
const forceLowestQuality = (player, video, onComplete = null) => {
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
                    // Use the generalized click function, pass onComplete callback
                    clickQualitySetting(video, '144p', onComplete);
                } else {
                    // Not first attempt, skip UI interaction
                    onComplete?.();
                }
            } else {
                player.__audioModeQualityAttempted = true;
                // API methods succeeded, signal completion
                onComplete?.();
            }

            // Restore playback state if it changed
            if (wasPlaying && video.paused) {
                video.play().catch(err => console.log('[Audio Mode] Could not resume playback:', err));
            }
        }, 500);

    } catch (error) {
        console.error('[Audio Mode] Error setting quality:', error);
        onComplete?.();
    }
};

/**
 * Restore quality to user's previous setting (public API)
 * Uses the central quality operation handler to prevent duplicate popups
 */
function restoreQuality() {
    requestQualityOperation('restore');
}

/**
 * Internal: Restore quality to user's previous setting
 * Uses saved quality from session, falls back to stored preference, then 720p
 * @param {Function} onComplete - Callback when operation completes
 * @param {number} attempts - Number of retry attempts remaining
 */
const restoreQualityInternal = (onComplete = null, attempts = 3) => {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        if (attempts > 0) {
            setTimeout(() => restoreQualityInternal(onComplete, attempts - 1), 100);
        } else {
            onComplete?.();
        }
        return;
    }

    // Load from storage to get user's preferred quality as fallback
    chrome.storage.sync.get(['preferredQuality'], (result) => {
        try {
            const availableLevels = player.getAvailableQualityLevels ? player.getAvailableQualityLevels() : [];

            // Map quality codes to UI text for click fallback
            const qualityToText = {
                'hd2160': '2160p',
                'hd1440': '1440p',
                'hd1080': '1080p',
                'hd720': '720p',
                'large': '480p',
                'medium': '360p',
                'small': '240p',
                'tiny': '144p',
                'auto': 'Auto'
            };

            // Use saved quality from session, then stored preference, then 720p
            // NEVER restore to audio mode qualities (tiny/small)
            let target = savedQualityBeforeAudioMode;
            if (!target || target === 'tiny' || target === 'small') {
                // Fall back to stored preference (last quality user used)
                target = result.preferredQuality;
            }
            if (!target || target === 'tiny' || target === 'small') {
                // Last resort: 720p
                target = QUALITY.RESTORE;
            }
            let uiTargetText = qualityToText[target] || '720p';

            console.log('[Audio Mode] Restoring quality to:', target);

            // If saved quality is not available, fallback to auto
            if (availableLevels.length > 0 && !availableLevels.includes(target)) {
                target = 'auto';
                uiTargetText = 'Auto';
            }

            // Clear session saved quality after restoring (keep storage preference)
            savedQualityBeforeAudioMode = null;

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

            // VERIFY and FALLBACK
            setTimeout(() => {
                const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : 'unknown';

                // If not successful yet, try UI click once
                if (target !== 'auto' && currentQuality !== target) {
                    // Use UI click with onComplete callback
                    clickQualitySetting(video, uiTargetText, onComplete);
                } else {
                    // API methods succeeded
                    onComplete?.();
                }
            }, 500);

        } catch (e) {
            console.error('[Audio Mode] Error restoring quality:', e);
            onComplete?.();
        }
    });
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
    // Skip if a quality operation is already in progress to avoid duplicate popup
    if (qualityOperationInProgress) return;

    const player = document.getElementById('movie_player');
    if (!player || !audioModeEnabled) return;

    const currentQuality = player.getPlaybackQuality ? player.getPlaybackQuality() : null;

    if (currentQuality && currentQuality !== QUALITY.TARGET && currentQuality !== QUALITY.FALLBACK) {
        forceLowestQuality(player, getVideoElement());
    }
}

/**
 * Set quality to 144p (public API)
 * Uses the central quality operation handler to prevent duplicate popups
 */
function setLowestQuality() {
    requestQualityOperation('set');
}

/**
 * Internal: Set quality to 144p
 * @param {Function} onComplete - Callback when operation completes
 */
function setLowestQualityInternal(onComplete = null) {
    const player = document.getElementById('movie_player');
    const video = getVideoElement();

    if (!player || !video) {
        setTimeout(() => setLowestQualityInternal(onComplete), 1000);
        return;
    }

    // Use the global function with completion callback
    forceLowestQuality(player, video, onComplete);
}

async function createAudioModeOverlay() {
    // Ensure messages are loaded for current language
    await loadMessages(currentLanguage);

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
      <h2 id="am-overlay-title">${t('activeTitle')}</h2>
      <p id="am-overlay-desc">${t('activeDesc')}</p>
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


async function updateOverlayLanguage() {
    // Load messages for the new language
    await loadMessages(currentLanguage);

    // If overlay exists, update its text content only (don't recreate)
    if (audioModeOverlay) {
        const title = audioModeOverlay.querySelector('#am-overlay-title');
        const desc = audioModeOverlay.querySelector('#am-overlay-desc');

        if (title) title.textContent = t('activeTitle');
        if (desc) desc.textContent = t('activeDesc');

        // Update RTL direction
        if (currentLanguage === 'ar') {
            audioModeOverlay.setAttribute('dir', 'rtl');
        } else {
            audioModeOverlay.removeAttribute('dir');
        }
    }
}

// Handle YouTube's SPA navigation with optimized MutationObserver
let lastUrl = location.href;
let navigationObserver = null;
let navigationDebounceTimer = null;

function initNavigationObserver() {
    if (navigationObserver) return;

    // Target specific container instead of entire document (70-80% performance improvement)
    const targetNode = document.querySelector('#content') || document.body;

    navigationObserver = new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            clearVideoCache(); // Clear cached video element on navigation
            lastAppliedVideoId = null; // Reset for new video
            resetQualityAttemptFlag(); // Allow UI fallback on new video
            cancelPendingQualityOperations(); // Cancel any pending quality popup operations

            // Debounce to avoid multiple rapid calls during SPA transition
            if (navigationDebounceTimer) {
                clearTimeout(navigationDebounceTimer);
            }

            // Wait for YouTube to update DOM before applying mode logic
            navigationDebounceTimer = setTimeout(() => {
                console.log('[Audio Mode] Navigation detected, re-applying mode logic');
                applyModeLogic();
            }, 600); // Wait 600ms for YouTube to update DOM
        }
    });

    navigationObserver.observe(targetNode, {
        subtree: true,
        childList: true
    });
}

// Initialize observer
initNavigationObserver();

// Listen for YouTube's navigation finish event (more reliable than MutationObserver alone)
document.addEventListener('yt-navigate-finish', () => {
    console.log('[Audio Mode] yt-navigate-finish event fired');
    clearVideoCache();
    lastAppliedVideoId = null;
    resetQualityAttemptFlag(); // Allow UI fallback on new video

    // Small delay to ensure video player is ready
    setTimeout(() => {
        applyModeLogic();
    }, 300);
});

// Also listen for video element becoming ready
// This handles cases where mode logic runs before video is fully loaded
let currentVideoElement = null;

function setupVideoReadyListener() {
    // Only setup on video pages
    if (!isOnVideoPage()) {
        // Retry later in case we navigate to a video
        setTimeout(setupVideoReadyListener, 1000);
        return;
    }

    const video = document.querySelector('video');
    if (!video) {
        // Retry if video not found yet
        setTimeout(setupVideoReadyListener, 500);
        return;
    }

    // Avoid adding duplicate listeners
    if (video === currentVideoElement) {
        return;
    }
    currentVideoElement = video;

    // Listen for video source changes (new video loaded)
    video.addEventListener('loadeddata', () => {
        console.log('[Audio Mode] Video loadeddata event');
        if (!isOnVideoPage()) return;

        // Check if video ID changed (important for playlists)
        const currentVideoId = new URLSearchParams(window.location.search).get('v');
        const videoIdChanged = currentVideoId && currentVideoId !== lastAppliedVideoId;

        if (videoIdChanged) {
            console.log('[Audio Mode] Video ID changed:', lastAppliedVideoId, '->', currentVideoId);
            resetQualityAttemptFlag(); // Allow UI fallback on new video
        }

        // Re-apply mode logic after video loads
        if (currentModeType === 'off') {
            // Off mode - apply preferred quality
            if (audioModeEnabled) {
                disableAudioMode(true);
            } else {
                applyPreferredQuality();
            }
        } else if (currentModeType === 'filtered') {
            // Filtered mode - ALWAYS re-check filter rules on video change
            // This handles playlist navigation where videos have different filter matches
            if (videoIdChanged || !audioModeEnabled) {
                applyFilteredMode();
            } else {
                setLowestQuality();
            }
        } else if (currentModeType === 'always') {
            // Always mode - enable or re-apply quality
            if (!audioModeEnabled) {
                enableAudioMode(true);
            } else {
                setLowestQuality();
            }
        }
    });
}

// Initialize video listener
setupVideoReadyListener();

// Re-setup video listener on navigation (video element may be replaced)
document.addEventListener('yt-navigate-finish', () => {
    // Small delay to let YouTube create new video element
    setTimeout(setupVideoReadyListener, 500);
});

// Listen for YouTube's page data update event (fires when video metadata is ready)
document.addEventListener('yt-page-data-updated', () => {
    if (!isOnVideoPage()) return;
    console.log('[Audio Mode] yt-page-data-updated event fired');

    // Check if video ID changed (for playlist navigation)
    const currentVideoId = new URLSearchParams(window.location.search).get('v');
    const videoIdChanged = currentVideoId && currentVideoId !== lastAppliedVideoId;

    if (videoIdChanged && currentModeType === 'filtered') {
        // In filtered mode, always re-check when video changes
        console.log('[Audio Mode] Video changed in playlist, re-checking filters');
        setTimeout(() => applyFilteredMode(), 200);
    } else if (currentModeType === 'filtered' && !audioModeEnabled) {
        // Not enabled yet, check filters
        setTimeout(() => applyFilteredMode(), 200);
    }
});

// Playlist video change detection (fallback for when events don't fire)
let lastCheckedVideoId = null;
let playlistCheckInterval = null;

function startPlaylistCheck() {
    if (playlistCheckInterval) return;

    playlistCheckInterval = setInterval(() => {
        if (!isOnVideoPage()) return;

        const currentVideoId = new URLSearchParams(window.location.search).get('v');
        if (currentVideoId && currentVideoId !== lastCheckedVideoId) {
            console.log('[Audio Mode] Playlist check detected video change:', lastCheckedVideoId, '->', currentVideoId);
            lastCheckedVideoId = currentVideoId;

            // If video ID differs from last applied, re-apply mode logic
            if (currentVideoId !== lastAppliedVideoId) {
                resetQualityAttemptFlag();
                applyModeLogic();
            }
        }
    }, 1500); // Check every 1.5 seconds
}

// Start playlist check when on YouTube
if (isOnVideoPage()) {
    lastCheckedVideoId = new URLSearchParams(window.location.search).get('v');
}
startPlaylistCheck();

// Cleanup on extension unload
window.addEventListener('beforeunload', () => {
    if (navigationObserver) {
        navigationObserver.disconnect();
        navigationObserver = null;
    }
    if (playlistCheckInterval) {
        clearInterval(playlistCheckInterval);
        playlistCheckInterval = null;
    }
    stopUsageTracking();
});
