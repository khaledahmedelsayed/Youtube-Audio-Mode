# Earmode: Audio Only for YouTube

Listen to YouTube with the video turned off. Pick channels that always play as audio and save mobile data.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/youtube-audio-mode/chjcfgfdkjkodkjcmooholonanhldeeh)

## What it does

Earmode plays YouTube videos as sound. It drops the picture to 144p and covers the player with a calm "player look", so a podcast, a lecture or a long mix uses much less data.

## Features

- **Video or Audio switch.** Click the Earmode icon on any video and flip one big switch. It only changes the video you have open; the next video follows your auto-listen choice. A line under the switch says why the video plays the way it does, for example "because this channel is in your list". **Back to auto** undoes your pick.
- **Auto-listen for new videos.** Choose **Everything**, **My list** or **Nothing**.
- **Your list.** Tap **Always listen** in the popup to add the channel of the video you are watching. Keywords also match video titles. Open **Your list** in the popup to see, add and remove channels and keywords without leaving the video.
- **Button on the player.** A round headphones button in the top corner of the YouTube player switches the open video between video and audio and changes the player look. You can hide it on the settings page.
- **Four player looks.** Card (video art and title), Blur (a blurred copy of the video picture), Simple (a headphones ring on a solid color you choose) and Waves (a slow wave line).
- **Stats.** Data saved this month and all time, estimated against 720p, plus time listened.
- **Settings page.** Your channels and keywords, the quality to use when audio is off, background color, the player button, backup (export and import) and language.
- **English and Arabic**, with a full right-to-left layout in Arabic.
- **Private.** Everything stays in your browser. No account, no analytics, no servers.

## Development setup

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the repository folder.

After you change a file, click the reload button on the Earmode card in `chrome://extensions/` and reload the YouTube tab.

## Tests

The tests use Node's built-in test runner, so there is nothing to install:

```
node --test tests/
```

## Project layout

- `manifest.json`: extension manifest (Manifest V3)
- `background.js`: service worker and toolbar badge
- `content.js`: runs on YouTube; quality switching, list matching and the player looks
- `player-menu.js`, `player-menu.css`: the Earmode button and menu on the player
- `overlay.css`: styles for the player looks
- `popup.html`, `popup.js`, `popup.css`: the toolbar popup
- `options.html`, `options.js`, `options.css`: the settings page
- `shared.js`: helpers shared by the popup and the settings page
- `_locales/`: English and Arabic text
- `fonts/`: bundled Fredoka, Nunito Sans and Cairo fonts (SIL OFL 1.1)
- `tests/`: unit tests

## Data use estimates

Saved data is an estimate based on average bitrates: about 0.75 MB per minute at 144p, 18.75 MB per minute at 720p and 33.75 MB per minute at 1080p. Real numbers change with the video, the codec and your network.

## Privacy

Earmode does not collect any personal data. Settings, your list and stats are kept with Chrome's storage API in your browser. Settings and your list use Chrome sync storage, so they follow you to your other browsers when Chrome sync is on. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## License

MIT License. See [LICENSE](LICENSE).

Earmode by [Khaled Ahmed Elsayed](https://github.com/khaledahmedelsayed).
