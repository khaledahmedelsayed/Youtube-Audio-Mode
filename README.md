# YouTube Audio Mode

> Enhanced fork of [YouTube Audio Mode](https://github.com/devahmedadli/youtube-audio-mode) by [Ahmed Adli](https://github.com/devahmedadli).

Save bandwidth and keep YouTube focused on listening. This Chrome extension switches YouTube videos into audio-only playback by forcing low video quality, hiding the video player, and showing a lightweight audio-mode overlay.

## Key Features

- **Three audio modes:** choose Always On, Filtered, or Off from the popup.
- **Filtered audio mode:** enable audio mode only for saved channels or title keywords.
- **Multi-channel detection:** videos with multiple credited channels can be added to filters and matched reliably.
- **Preferred quality restore:** choose the quality YouTube should use when audio mode is off.
- **Usage statistics:** estimate saved data compared with 720p and 1080p, plus listened and active time.
- **Audio-mode overlay background:** customize the player overlay background color. This setting affects the audio-mode overlay only, not the popup UI.
- **Settings import/export:** back up and restore mode, appearance, preferred quality, and filter rules as JSON.
- **English and Arabic UI:** includes RTL support for Arabic.
- **Private by default:** preferences and usage data stay in Chrome storage on your device.

## Operating Modes

**Always On**
Audio mode is enabled for all YouTube videos.

**Filtered**
Audio mode is enabled only when the current video matches your saved channel or keyword rules. The Configure Filters button opens Settings directly at the filter section.

**Off**
The extension is disabled and YouTube plays normally using your preferred quality.

## Filter Rules

Filtered mode supports:

- Saved YouTube channels
- Videos credited to multiple channels
- Title keywords
- Quick-add for the current video channel

Videos matching saved channels or keywords play in audio mode. All other videos play normally.

## Settings

The Settings panel includes:

- Audio-mode overlay background color
- Preferred quality for normal video playback
- Import / Export Settings
- Current channel quick-add
- Keyword entry
- Saved channel and keyword lists

Exported settings include extension mode, language, overlay background, preferred quality, and filter rules. Usage statistics are not included in settings exports.

## Installation

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.

## How To Use

1. Open any YouTube video.
2. Click the **YouTube Audio Mode** extension icon.
3. Pick **Always On**, **Filtered**, or **Off**.
4. In Filtered mode, click **Configure Filters** to add channels or keywords.
5. Use Settings to change preferred quality, overlay background, or import/export settings.

## Data Usage Estimates

The popup estimates savings using average bitrate values:

- **144p audio mode:** about 0.75 MB/min
- **720p video:** about 18.75 MB/min
- **1080p video:** about 33.75 MB/min

These numbers are estimates and can vary by video, codec, and network conditions.

## Privacy

This extension does not collect personal data. Settings are stored with the Chrome Storage API, and usage statistics are stored locally. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

## Development

Project structure:

- `manifest.json` - Chrome extension manifest
- `background.js` - service worker and badge handling
- `content.js` - YouTube page behavior, quality switching, filter matching, overlay logic
- `popup.html`, `popup.js`, `popup.css` - popup UI and settings
- `overlay.css` - audio-mode overlay styles
- `_locales/` - English and Arabic translations

Tech stack:

- HTML, CSS, JavaScript
- Chrome Extension API
- Manifest V3

## License

This project is licensed under the MIT License.

Original extension by [Ahmed Adli](https://github.com/devahmedadli).
Fork enhancements by [Khaled Ahmed Elsayed](https://github.com/khaledahmedelsayed).
