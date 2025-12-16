![YouTube Audio Mode](promo_images/marquee_promo.png)

# YouTube Audio Mode

**Save bandwidth and enjoy distraction-free listening on YouTube.**

YouTube Audio Mode is a lightweight Chrome extension that transforms your YouTube experience by playing videos in audio-only mode. It intelligently forces the video quality to 144p and hides the video player, replacing it with a beautiful audio visualizer. This drastically reduces internet data usage, making it perfect for music streaming, listening to podcasts, or saving bandwidth on metered connections.

## ✨ Key Features

- **🎧 One-Click Audio Mode:** Toggle audio-only playback instantly with a simple switch or keyboard shortcut (`Alt+Shift+A`).
- **📉 Smart Data Saving:** Automatically sets video quality to **144p** to minimize bandwidth consumption while keeping audio clear.
- **📊 Usage Statistics:** Track exactly how much data you've saved compared to 720p/1080p, along with your total listening time.
- **🎵 Audio Visualizer:** A stunning, animated visualizer replaces the blank video screen.
- **🎨 Custom Themes:** Choose from 6 beautiful gradient presets or customize the background with your own colors or images.
- **🔒 Privacy Focused:** All data and preferences are stored locally on your device. No external tracking.

## 🚀 Installation

### Option 1: Chrome Web Store (Recommended)

_Link coming soon once the review process is complete!_

### Option 2: Manual Installation (Developer Mode)

1.  Clone or download this repository.
2.  Open Chrome and go to `chrome://extensions/`.
3.  Enable **Developer mode** in the top-right corner.
4.  Click **Load unpacked**.
5.  Select the folder where you downloaded this repository.

## 📖 How to Use

1.  Open any YouTube video.
2.  Click the **YouTube Audio Mode** icon in your browser toolbar.
3.  Toggle the switch to **On**.
4.  The video player will be hidden, and the visualizer will appear.
5.  To customize the look, click the **Settings (Gear)** icon in the popup.

## ⌨️ Shortcuts

- **Toggle Audio Mode:** `Alt` + `Shift` + `A`

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

_Developed with ❤️ by [Ahmed Adli](https://github.com/devahmedadli)_
