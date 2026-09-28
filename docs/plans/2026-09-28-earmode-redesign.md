# Earmode Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand "YouTube Audio Mode" to "Earmode: Audio Only for YouTube" with a new popup (Video | Audio switch, channel card, auto-listen control, player looks), an in-player control menu, 4 player looks replacing the bar visualizer, a new options page, new icon, and new store listing.

**Architecture:** Plain MV3 extension, no build step, no npm dependencies. The content script (`content.js`) keeps all YouTube logic and gains a per-video override, a status API, and the new overlay looks. A second content script (`player-menu.js`) adds the in-player button and menu and talks to `content.js` through shared globals in the same isolated world. `shared.js` holds code used by both the popup and the new options page (i18n loader, settings sanitizers, export format). The popup gets rebuilt from the approved prototype. Settings, lists, and stats move to `options.html`.

**Tech Stack:** Vanilla JS, HTML, CSS, Chrome extension APIs (storage, tabs, runtime), `node:test` for unit tests (run with `node --test tests/`).

**Reference files:**
- Design: `docs/plans/2026-09-28-earmode-redesign-design.md`
- Approved prototype (copy styles, markup, and copy text from here): `docs/plans/2026-09-28-earmode-prototype.html`
- Existing test harness: `tests/content-quality.test.js` (`loadContentScript(timers)` runs `content.js` in a `vm` context and exposes internals through `globalThis.__audioModeTestApi`)

**Rules for every task:**
- Never use em dashes in UI text, locale strings, store copy, or README.
- Keep existing storage keys and values. Add, do not rename.
- Every user-facing string goes in both `_locales/en/messages.json` and `_locales/ar/messages.json`.
- Values crossing the `vm` boundary in tests: compare with `Array.from(...)` or `JSON.parse(JSON.stringify(...))`, never `deepEqual` on raw vm arrays and objects.
- Run `node --test tests/` before each commit. All tests must pass.

---

### Task 1: Pure decision function for audio on or off

**Files:**
- Modify: `content.js`, near `applyModeLogic` (line ~169)
- Test: `tests/content-mode.test.js` (new). Move the `createTimers` and `loadContentScript` helpers from `tests/content-quality.test.js` into `tests/helpers/load-content.js` and require them from both test files. Export `decideAudio` in the test API.

**Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, loadContentScript } = require('./helpers/load-content');

const plain = value => JSON.parse(JSON.stringify(value));

test('decideAudio: override wins over every mode', () => {
    const api = loadContentScript(createTimers());
    assert.deepEqual(plain(api.decideAudio({ override: true, mode: 'off', inList: false })), { audio: true, reason: 'manual' });
    assert.deepEqual(plain(api.decideAudio({ override: false, mode: 'always', inList: true })), { audio: false, reason: 'manual' });
});

test('decideAudio: auto modes', () => {
    const api = loadContentScript(createTimers());
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'always', inList: false })), { audio: true, reason: 'all' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'off', inList: true })), { audio: false, reason: 'none' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'filtered', inList: true })), { audio: true, reason: 'inList' });
    assert.deepEqual(plain(api.decideAudio({ override: null, mode: 'filtered', inList: false })), { audio: false, reason: 'notInList' });
});
```

**Step 2: Run** `node --test tests/`. Expected: FAIL, `api.decideAudio is not a function`.

**Step 3: Implement**

```js
/**
 * Decide whether the current video plays as audio.
 * @param {{override: boolean|null, mode: 'always'|'filtered'|'off', inList: boolean}} input
 * @returns {{audio: boolean, reason: 'manual'|'all'|'none'|'inList'|'notInList'}}
 */
function decideAudio({ override, mode, inList }) {
    if (override === true || override === false) return { audio: override, reason: 'manual' };
    if (mode === 'always') return { audio: true, reason: 'all' };
    if (mode === 'off') return { audio: false, reason: 'none' };
    return inList ? { audio: true, reason: 'inList' } : { audio: false, reason: 'notInList' };
}
```

Add `decideAudio` to the test API block in `tests/helpers/load-content.js`.

**Step 4: Run** `node --test tests/`. Expected: all PASS.

**Step 5: Commit** `git commit -m "Add decideAudio for per-video audio decisions"`

---

### Task 2: Per-video override and status in the content script

**Files:**
- Modify: `content.js`: state variables (~line 41), `applyModeLogic` (~169), `applyFilteredMode` (~294), message listener (~688)
- Test: `tests/content-mode.test.js`

**Behavior:**
- New state: `let manualOverride = null; // { videoId, audio }` and `let lastDecision = { audio: false, reason: 'none' };`
- `getCurrentVideoId()` returns `new URLSearchParams(window.location.search).get('v')`.
- `getActiveOverride()` returns `manualOverride.audio` when `manualOverride.videoId === getCurrentVideoId()`. Otherwise it sets `manualOverride = null` and returns `null`.
- `applyModeLogic` after the `isOnVideoPage()` check:
  - `always` / `off`: `lastDecision = decideAudio({ override: getActiveOverride(), mode: currentModeType, inList: false })`, then `applyDecision(lastDecision)`.
  - `filtered`: if an override is active, decide and apply at once (no page scraping). Otherwise keep `applyFilteredMode`, and replace its enable/disable block with `lastDecision = decideAudio({ override: null, mode: 'filtered', inList: shouldEnable }); applyDecision(lastDecision);`. The "no video info after retries" path sets `lastDecision = { audio: false, reason: 'notInList' }`.
- `applyDecision({ audio })`: when audio is true, `enableAudioMode(true)` if off, else `setLowestQuality()`. When false, `disableAudioMode(true)` if on, else `applyPreferredQuality()`. This is the same code that is duplicated today in 4 places, so reuse it there.
- New messages in the `chrome.runtime.onMessage` listener:
  - `getStatus`: respond `{ onVideo: isOnVideoPage(), audio: audioModeEnabled, reason: lastDecision.reason, mode: currentModeType, override: getActiveOverride() }`
  - `setVideoAudio` `{ audio }`: `manualOverride = { videoId: getCurrentVideoId(), audio: !!request.audio }`, `scheduleModeLogic('manual switch', 0)`, respond `{ ok: true }`
  - `clearOverride`: `manualOverride = null`, `scheduleModeLogic('back to auto', 0)`, respond `{ ok: true }`
- After each state change, dispatch `window.dispatchEvent(new CustomEvent('earmode:state'))` so the in-player menu (Task 6) can re-render. Do this at the end of `enableAudioMode`, `disableAudioMode`, and `applyDecision`, and when the override changes.
- Expose `getEarmodeStatus()` (same object as `getStatus`), `setVideoAudio(audio)`, and `clearOverride()` as plain functions. `player-menu.js` calls them directly.

**Tests (write first, watch them fail):**
- `setVideoAudio(true)` then `getEarmodeStatus().override === true`.
- When `window.location.search` changes to `?v=other`, `getEarmodeStatus().override === null`. Make `location` mutable in the harness.
- `clearOverride()` makes `override` null.

**Commit:** `git commit -m "Add per-video override and status API to content script"`

---

### Task 3: Player looks replace the bar visualizer

**Files:**
- Modify: `content.js` `createAudioModeOverlay` (~1392-1478), `updateOverlayTheme` (~1480), `updateOverlayLanguage` (~1496), storage listener (~715)
- Modify: `overlay.css` (replace the `.audio-visualizer`, `.bar`, and `@keyframes wave` rules)
- Test: `tests/content-overlay.test.js` (new)

**Behavior:**
- `const PLAYER_LOOKS = ['card', 'blur', 'minimal', 'waves'];` and `function normalizePlayerLook(value) { return PLAYER_LOOKS.includes(value) ? value : 'card'; }`
- `let currentPlayerLook = 'card';`. Read `playerLook` in the initial `chrome.storage.sync.get` (line ~93) together with the other keys.
- The overlay root keeps the id `youtube-audio-mode-overlay` (so existing code paths keep working) and gets the class `earmode-look-<look>`.
- Build the inner DOM with `document.createElement` and `textContent`, not innerHTML with the title (titles are untrusted). Structure per look, matching the prototype's `overlayHTML`:
  - card: `.em-np-card > .em-np-art + .em-np-meta(.em-kicker, b.em-title, span.em-channel)`
  - blur: `.em-ov-text(.em-kicker, b.em-title, span.em-channel)` at the bottom
  - minimal: `.em-ov-text` centred with `.em-ring` containing the headphones SVG (build the SVG with `createElementNS`)
  - waves: an SVG wave (2 paths, see prototype) plus `.em-ov-text`
- Thumbnail: set the CSS custom property `--em-thumb: url("https://i.ytimg.com/vi/<videoId>/hqdefault.jpg")` on the overlay root. Build it only from the `v` URL parameter after checking it matches `/^[\w-]{11}$/`. Preload it with `new Image()`. On `error`, remove the property so the CSS falls back to `--em-bg`.
- `--em-bg` holds the user's `backgroundValue` colour (default `#172554`). `updateOverlayTheme` now sets `--em-bg` instead of `style.background`.
- Title and channel come from `getCurrentVideoInfo()`. Re-fill them on `yt-navigate-finish` if the overlay exists (the existing nav hook calls into `updateOverlayContent()`, a new function).
- The `.paused` class toggle stays. For the waves look it pauses the drift animation.
- `chrome.storage.onChanged` on `playerLook`: update `currentPlayerLook` and rebuild the overlay if it is open. Also handle the message `playerLookChanged {look}`.
- `overlay.css`: port `.ov-card`, `.ov-blur`, `.ov-minimal`, `.ov-waves`, `.np-card`, `.np-art`, `.kicker`, and `@keyframes drift` from the prototype, renamed with an `em-` prefix and scoped under `#youtube-audio-mode-overlay`. Add `@media (prefers-reduced-motion: reduce) { #youtube-audio-mode-overlay * { animation: none !important; } }`. Keep the Cairo `@font-face` and the RTL rules.

**Tests:** `normalizePlayerLook('waves') === 'waves'`, `normalizePlayerLook('bars') === 'card'`, `normalizePlayerLook(undefined) === 'card'`. Also a `thumbnailUrl(videoId)` helper test: it returns null for `'bad id!'` and the i.ytimg URL for `'dQw4w9WgXcQ'`.

**Manual check:** load the unpacked extension, set each look through the DevTools console (`chrome.storage.sync.set({playerLook:'waves'})` in the extension service worker console), and confirm each renders on a real video.

**Commit:** `git commit -m "Replace visualizer with four player looks"`

---

### Task 4: Shared module for popup and options

**Files:**
- Create: `shared.js`
- Modify: `popup.js` (move code out)
- Test: `tests/shared.test.js` (new). Load `shared.js` in a `vm` context with a stub `chrome`.

**Move from `popup.js` into `shared.js` (unchanged logic):** `t`, `loadMessages`, `DEFAULT_BACKGROUND_COLOR`, `SETTINGS_EXPORT_KEYS`, `VALID_MODE_TYPES`, `VALID_QUALITY_VALUES`, `getDefaultFilterRules`, `sanitizeFilterRules`, the import validator (popup.js ~420-461), and the export payload builder (~508-528). Expose them on `globalThis.Earmode = { ... }`.

**Changes while moving:**
- Add `playerLook` to `SETTINGS_EXPORT_KEYS`. Validate it with the same list as Task 3 (`card|blur|minimal|waves`).
- Export `app: 'earmode'`. The import accepts `payload.app` of `'earmode'`, `'youtube-audio-mode'`, or missing.
- Export filename: `earmode-settings-YYYY-MM-DD.json`.

**Tests (first):** import accepts an old file with `app:'youtube-audio-mode'`; import drops `playerLook:'bars'` and keeps `playerLook:'waves'`; the export payload has `app === 'earmode'` and includes `playerLook`.

**Commit:** `git commit -m "Extract shared settings helpers for popup and options"`

---

### Task 5: New popup

**Files:**
- Rewrite: `popup.html`, `popup.css`, `popup.js`
- Modify: `_locales/en/messages.json`, `_locales/ar/messages.json`

**Build from the prototype** (`docs/plans/2026-09-28-earmode-prototype.html`): header, `.switch` (Video | Audio), `.state` line with "Back to auto", `.channel` card, `.seg` auto-listen control with hint, `.looks` tiles, `.stats` line. Width 340px. Copy the CSS tokens, including the dark theme through `prefers-color-scheme` (no `data-theme` blocks needed in the extension). Fonts come from Task 8 (use the local `@font-face` names `Fredoka`, `Nunito Sans`, and `Cairo`). Until Task 8 lands, the fallbacks render.

**Wiring (`popup.js`, loads `shared.js` first):**
- On open: load the language, then query the active tab. If the URL matches `youtube.com/watch`, send `getStatus` and `getVideoInfo` (reuse the existing retry logic from the old `fetchCurrentVideoInfo`). Render.
- Switch halves: `chrome.tabs.sendMessage(tab.id, { action: 'setVideoAudio', audio })`, then re-query `getStatus` after 300ms and render.
- "Back to auto": `clearOverride`.
- The state line maps `reason` to strings: `manual`, `all`, `inList`, `notInList`, `none` (keys `reasonManual`, `reasonAll`, `reasonInList`, `reasonNotInList`, `reasonNone`).
- Channel card: add or remove all channels from `getCurrentVideoChannels()` in `filterRules.whitelist.channels` (reuse the old quick-add logic, popup.js ~672-720). Toast on change.
- Auto-listen control: writes `audioModeType` (`always|filtered|off`) and sends `modeChanged` as today. The hint shows the channel count.
- Look tiles: write `playerLook`, and send `playerLookChanged`.
- Stats line: sum this month from `statsLogs` (reuse the old `updateStats` math). Format with the `unitGB` / `unitMB` strings. Click: `chrome.runtime.openOptionsPage()` and set `location.hash`-free intent via `chrome.storage.session.set({ optionsSection: 'stats' })`.
- Gear: `chrome.runtime.openOptionsPage()`.
- Language button: same behaviour as today (`setLanguage`, `updateLanguage` message).
- Listen to `chrome.storage.onChanged` for `audioModeType`, `playerLook`, `filterRules`, and `statsLogs`, and re-render.
- Not on a video: switch disabled, state text `noVideoSwitch`, channel card hidden.

**New locale keys (en / ar):** `appName`, `switchVideo`, `switchAudio`, `switchVideoSub`, `switchAudioSub`, `nowAudio`, `nowVideo`, `reason*` (5), `backToAuto`, `alwaysListen`, `inYourList`, `autoListenLabel`, `modeEverything`, `modeMyList`, `modeNothing`, `hintEverything`, `hintMyList` (with `$COUNT$` placeholder), `hintNothing`, `playerLookLabel`, `lookCard`, `lookBlur`, `lookSimple`, `lookWaves`, `savedThisMonth` (with `$AMOUNT$`), `noVideoSwitch`, `addedToList`, `removedFromList`, `reloadTab`. Take the English and Arabic text from the prototype's `T` object. Remove keys that nothing uses any more after Tasks 5 and 7.

**Manual check:** every control in the popup on a listed channel, an unlisted channel, and the YouTube home page, in English and Arabic, light and dark.

**Commit:** `git commit -m "Rebuild popup around the Video | Audio switch"`

---

### Task 6: In-player button and menu

**Files:**
- Create: `player-menu.js`, `player-menu.css`
- Modify: `manifest.json` content_scripts: `"js": ["content.js", "player-menu.js"]`, `"css": ["overlay.css", "player-menu.css"]`

**Behavior:**
- `ensurePlayerMenu()` attaches `button.em-player-btn` and `div.em-player-menu` to `#movie_player` (fallback `#player-container`). It is idempotent: it checks for an existing `.em-player-btn` inside the player first. Call it on `yt-navigate-finish`, on `earmode:state`, and once at load. Remove the button when `isOnVideoPage()` is false.
- The button text is `Earmode · ` + `t('nowAudio')` or `t('nowVideo')`, with a dot. `data-on` follows `getEarmodeStatus().audio`.
- Visibility: `opacity: 0` by default. Visible when `#movie_player` has the class `ytp-autohide` absent (YouTube shows controls), when `.paused-mode` is set, when audio is on, or when the menu is open. Do it with CSS: `#movie_player:not(.ytp-autohide) .em-player-btn, #movie_player.paused-mode .em-player-btn, .em-player-btn[data-on="true"], .em-player-btn[aria-expanded="true"] { opacity: 1; }`
- The menu holds the same 3 blocks as the prototype's `.menu`: a switch calling `setVideoAudio`, a segmented control writing `audioModeType` to `chrome.storage.sync` (the existing onChanged listener re-runs mode logic), and look tiles writing `playerLook`.
- Build all DOM with `createElement` / `textContent`.
- Stop `click`, `mousedown`, `keydown`, and `dblclick` from propagating out of the button and menu, so YouTube does not pause, seek, or go fullscreen.
- Close on an outside click and on `Escape`, and return focus to the button.
- `dir` follows the current language (`currentLanguage` from content.js). Re-render on `earmode:state` and on language change (hook into `updateOverlayLanguage`).
- z-index above the overlay (`#youtube-audio-mode-overlay`) and below YouTube's settings popup (`.ytp-popup` uses z-index ~70; use 65).
- CSS from the prototype `.em-btn` and `.menu`, prefixed `em-player-`. Use the menu's fixed dark palette (it sits on video).

**Manual check:** on a real video: hover shows the button; click opens the menu without pausing the video; each control works; Esc closes; fullscreen and theater mode keep the button in the corner; the next video in the playlist keeps one button (no duplicates); Arabic flips it.

**Commit:** `git commit -m "Add in-player Earmode button and menu"`

---

### Task 7: Options page

**Files:**
- Create: `options.html`, `options.css`, `options.js` (loads `shared.js` first)
- Modify: `manifest.json`: add `"options_page": "options.html"`

**Sections (one page, left nav on wide screens, stacked on narrow):**
1. **Listening:** auto-listen control (same as the popup), player look tiles, background colour picker (`backgroundValue`, only affects Simple and Waves, say so in a hint).
2. **Your list:** channels (name, remove button) and keywords (add input, remove). Port the old rule list rendering and add/remove code from `popup.js` (~740-890).
3. **Video quality:** the preferred quality select (old popup.html lines 55-66).
4. **Stats:** This month / All time toggle, data saved, time listened, time active, and the estimate table. Port the old `updateStats` and table markup.
5. **Backup:** export and import buttons (shared.js).
6. **Language:** English / العربية.

- On load, read `chrome.storage.session.get('optionsSection')`, scroll that section into view, then clear it.
- Live-sync through `chrome.storage.onChanged`.
- Same tokens, fonts, and dark theme as the popup. Use the design tokens from the prototype. The page body gets `max-width: 760px` centred.

**Manual check:** add and remove a channel and a keyword; the popup reflects it; export, then import the file back; import an old `youtube-audio-mode` export; change quality and colour; switch language.

**Commit:** `git commit -m "Add options page for lists, stats, and backup"`

---

### Task 8: Bundled fonts

**Files:**
- Create: `fonts/Fredoka-Variable.woff2` (or static 500 and 600), `fonts/NunitoSans-Variable.woff2`, `fonts/OFL.txt`
- Modify: `popup.css`, `options.css`, `player-menu.css`, `overlay.css` (`@font-face`), `manifest.json` web_accessible_resources (add the new font files for the content-script CSS)

**Steps:**
1. Fetch the CSS from `https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito+Sans:wght@400;600;700&display=swap` with a Chrome user agent (so it returns woff2), download the latin woff2 files it lists, and save them under `fonts/`.
2. Add both fonts' SIL Open Font License text to `fonts/OFL.txt`.
3. Declare `@font-face` in each CSS file. In content-script CSS use `url("chrome-extension://__MSG_@@extension_id__/fonts/...")` like the existing Cairo rule in `overlay.css`.

**Commit:** `git commit -m "Bundle Fredoka and Nunito Sans fonts"`

---

### Task 9: Icon, badge, name, and manifest

**Files:**
- Create: `icons/icon.svg`, `scripts/render-icons.md` (how the PNGs were made)
- Replace: `icons/icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `store-assets/store-icon-128.png`
- Modify: `manifest.json`, `background.js`, `_locales/*/messages.json`

**Steps:**
1. `icons/icon.svg`: the prototype's brand mark (rounded ink square `#1C1B22`, rx 9 of 32, sunflower `#F2C14E` headphones). For 16px, make a simplified variant with a thicker band (stroke 3.2) and no inner gaps, so it stays readable.
2. Render the PNGs with a headless browser (Playwright: `page.setContent` with the SVG at each size, `omitBackground: true` screenshot). The store icon is 128x128 with the mark at 96x96 centred (Chrome Web Store asks for 16px of padding).
3. `manifest.json`: `version` and `version_name` become `2.0.0`. `name` stays `__MSG_appName__`. Add `"short_name": "__MSG_appShortName__"`. `appName` = "Earmode: Audio Only for YouTube" (ar: "Earmode: صوت فقط ليوتيوب"). `appShortName` = "Earmode". `extDescription` = "Listen to YouTube with the video turned off. Pick channels that always play as audio and save mobile data." Add a matching Arabic line. Keep it under 132 characters.
4. `background.js`: badge text `A` for `always`, `L` for `filtered`, empty for `off`. Colour `#F2C14E`, and text colour `#1C1B22` via `chrome.action.setBadgeTextColor` (guard with `if (chrome.action.setBadgeTextColor)`).
5. Rename console prefixes `[Audio Mode]` to `[Earmode]` across all JS files (a mechanical replace).

**Commit:** `git commit -m "Rename to Earmode with new icon and badge"`

---

### Task 10: Store listing, screenshots, README

**Files:**
- Rewrite: `store-assets/chrome-store-listing.md`, `store-assets/store-assets.html`
- Replace: `store-assets/screenshot-*.png` (new names below), `store-assets/small-promo-440x280.png`
- Modify: `README.md`, `PRIVACY_POLICY.md` (name only)

**Listing copy rules:** plain, specific, written from the user's side. No em dashes, no emoji lists, no "stunning", "seamless", "effortless", "unlock", or "elevate". Short paragraphs.

**Listing structure (`chrome-store-listing.md`):**
- Title: Earmode: Audio Only for YouTube
- Summary (132 characters max): same as `extDescription`
- Description sections: what it does (one paragraph); the Video | Audio switch; your channel list and keywords; the player button; the 4 player looks; data saved stats; privacy (everything stays in your browser, no account, no tracking); Arabic support.
- Category: Tools. Language: English, Arabic.

**Screenshots (1280x800), built in `store-assets.html` from the real popup and overlay CSS and rendered with Playwright:**
1. `screenshot-switch-1280x800.png`: the popup over a blurred video page, with the caption "Switch any video to audio".
2. `screenshot-player-menu-1280x800.png`: the in-player menu open, with the caption "Control it from the player".
3. `screenshot-looks-1280x800.png`: 4 player looks in a 2x2 grid, with the caption "Pick how the player looks".
4. `screenshot-list-1280x800.png`: the options page lists, with the caption "Always listen to the channels you choose".

Captions use Fredoka 56px on the ground colour. Use a neutral example channel and title (no real creators' names or thumbnails; use gradient art).

- `small-promo-440x280.png`: the logo, "Earmode", and "Audio only for YouTube" on ink with sunflower.
- `README.md`: the new name, a one-line summary, the store link (unchanged URL), features matching the listing, dev setup (`Load unpacked`), tests (`node --test tests/`).
- Delete the old screenshot files.

**Commit:** `git commit -m "New store listing, screenshots, and README for Earmode"`

---

### Task 11: Final verification

1. `node --test tests/`: all pass.
2. Load unpacked from the worktree in Chrome and run the design doc's manual checklist (Testing section) end to end.
3. Search the repo for leftover names: `rg -n "YouTube Audio Mode|youtube-audio-mode|Audio Mode\]" --glob '!docs/**' --glob '!dist/**'`. Only the store URL slug in README may remain.
4. Search for em dashes in shipped files: `rg -n "—" --glob '!docs/**'`. Expected: no matches.
5. Build the zip: `dist/earmode-2.0.0.zip` containing only the manifest, JS, CSS, HTML, `_locales`, `fonts`, and `icons` (no tests, docs, or store-assets).
6. Use superpowers:finishing-a-development-branch.
