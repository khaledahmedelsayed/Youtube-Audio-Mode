<!-- ![YouTube Audio Mode](promo_images/marquee_promo.png) -->

# YouTube Audio Mode (Enhanced Fork)

> **This is a fork of [YouTube Audio Mode](https://github.com/devahmedadli/youtube-audio-mode) by [Ahmed Adli](https://github.com/devahmedadli).**

**Save bandwidth and enjoy distraction-free listening on YouTube.**

YouTube Audio Mode is a lightweight Chrome extension that transforms your YouTube experience by playing videos in audio-only mode. It intelligently forces the video quality to 144p and hides the video player, replacing it with a beautiful audio visualizer. This drastically reduces internet data usage, listening to podcasts, or saving bandwidth on metered connections.

## ✨ Key Features

- **🎧 One-Click Audio Mode:** Toggle audio-only playback instantly with a simple switch or keyboard shortcut (`Alt+Shift+A`) for Windows and `Option+Shift+A` for macOS.
- **📉 Smart Data Saving:** Automatically sets video quality to **144p** to minimize bandwidth consumption while keeping audio clear.
- **📊 Usage Statistics:** Track exactly how much data you've saved compared to 720p/1080p, along with your total listening time.
- **🎵 Audio Visualizer:** A stunning, animated visualizer replaces the blank video screen.
- **🎨 Custom Themes:** Choose from 6 beautiful gradient presets or customize the background with your own colors or images.
- **🔒 Privacy Focused:** All data and preferences are stored locally on your device. No external tracking.

---

## 🆕 New Features in This Fork

### Three Operating Modes
- **Always On:** Audio mode enabled on all YouTube videos (original behavior)
- **Filtered:** Audio mode only for whitelisted channels/keywords
- **Off:** Extension completely disabled, normal YouTube experience

### Filter Mode (Whitelist-based)
- **Channel Whitelist:** Audio mode activates only for specific channels you add
- **Keyword Filtering:** Match video titles against keywords (e.g., "podcast", "music")
- **Quick-Add Button:** Instantly add the current channel to your whitelist from the popup
- **Playlist Support:** Properly handles playlists with mixed content (some videos filtered, some not)
- **Badge Indicator:** Shows "ON" for always mode, "FLT" for filtered mode, or no badge when off

### Quality Preference Management
- **Preferred Quality Selector:** Choose your default video quality (720p, 1080p, 4K, etc.)
- **Smart Quality Restore:** When audio mode is disabled, video restores to your preferred quality
- **Persistent Settings:** Quality preference saved across sessions

### Internationalization (i18n)
- **Multi-language Support:** Full English and Arabic translations
- **RTL Support:** Proper right-to-left layout for Arabic

### Bug Fixes & Improvements
- Fixed audio mode not triggering on YouTube SPA navigation
- Fixed settings icon becoming unclickable after navigating between videos
- Improved keyword filtering reliability during navigation
- Better quality restoration when toggling audio mode off
- Fixed 144p quality not being applied when navigating between filtered videos
- Fixed playlist navigation not re-checking filter rules between videos
- Improved video detection reliability on initial page load
- Added retry logic for popup channel info fetching

## 🚀 Installation

 Manual Installation (Developer Mode)

1.  Clone or download this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** in the top-right corner.
4.  Click **Load unpacked**.
5.  Select the folder where you downloaded this repository.

## 📖 How to Use

1.  Open any YouTube video.
2.  Click the **YouTube Audio Mode** icon in your browser toolbar.
3.  Select your preferred mode:
    - **Always On:** Audio mode on all videos
    - **Filtered:** Audio mode only for whitelisted channels/keywords
    - **Off:** Disable the extension
4.  For Filtered mode, click **Configure Filters** to add channels or keywords.
5.  The video player will be hidden, and the visualizer will appear when audio mode is active.
6.  To customize the look, click the **Settings (Gear)** icon in the popup.

## ⌨️ Shortcuts

- **Toggle Audio Mode:** `Alt` + `Shift` + `A` for Windows and `Option` + `Shift` + `A` for macOS.

## 📊 Statistics & Privacy

This extension calculates data savings based on average YouTube bitrate values:

- **144p (Audio Mode):** ~0.75 MB/min
- **720p (Standard):** ~18.75 MB/min
- **1080p (HD):** ~33.75 MB/min

**Privacy Policy:**
We do not collect any personal data. All preferences and usage statistics are stored locally on your machine using the Chrome Storage API. For more details, see [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## 🛠️ Development

### Project Structure

- `manifest.json` - Extension configuration (Manifest V3)
- `background.js` - Service worker for background tasks
- `content.js` - Main logic for handling the video player and visualizer DOM
- `popup.html/js/css` - The extension interface
- `overlay.css` - Styles for the visualizer overlay

### Tech Stack

- HTML5, CSS3, JavaScript (ES6+)
- Chrome Extension API (Manifest V3)

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or bug fixes:

1.  Fork the repository.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

## 📝 License

This project is licensed under the MIT License.

---

_Original extension by [Ahmed Adli](https://github.com/devahmedadli)_

_Fork enhancements by [Khaled Ahmed Elsayed](https://github.com/khaledahmedelsayed)_
