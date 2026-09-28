# Earmode redesign

Date: 2026-09-28
Prototype: https://claude.ai/artifact/7gHeTax6fWin4SJjqnPxnx (version 2, approved)

## Why

The live extension ("YouTube Audio Mode", store id `chjcfgfdkjkodkjcmooholonanhldeeh`) was inspired by another store extension with the same name (`dpngpgebeakfkhliebaehgojmonappcf`). Today they share the name, the exact store description sentence, a bar visualizer overlay, and a similar popup. The name also starts with Google's "YouTube" trademark. The store listing reads as generated copy and the icon is weak.

Goal: a distinct name, flow, look, icon, and listing. Keep the working core (144p forcing, filters, stats).

## Name

- Brand: **Earmode**.
- Store and manifest title: **Earmode: Audio Only for YouTube** (brand first, "for YouTube" last, allowed by YouTube brand rules, keeps search terms).
- No em dashes anywhere in names or copy.
- The store listing id stays the same, so installed users update in place and keep their settings.

## Popup

Top to bottom:

1. **Header:** headphones logo, "Earmode", language button (`ع` / `EN`), settings gear. The gear opens the options page.
2. **Big two-way switch: Video | Audio.** Both halves always show. The active half is filled: dark for Video, sunflower yellow for Audio. Sub-labels: "Full picture" and "144p, saves data". It only changes the open video (a per-video override).
3. **State line:** a pill ("Audio only" or "Video") plus the reason, for example "because this channel is in your list" or "because you picked it for this video". When an override is active, a "Back to auto" link clears it.
4. **Channel card:** avatar letter, channel name, and a "+ Always listen" button. After adding, it reads "✓ In your list" and a tap removes it. The card is hidden when not on a video.
5. **Auto-listen for new videos:** a 3-way segmented control, **Everything / My list / Nothing**. It maps to the existing `audioModeType` values `always / filtered / off`. A hint line below shows the count of channels in the list.
6. **Player look:** 4 small tiles (Card, Blur, Simple, Waves).
7. **Stats line:** "Saved 2.3 GB this month". A tap opens the options page on the stats section.

When not on a video page, the switch is disabled and the state line says "Open a YouTube video to use the switch."

Removed from the popup: the 3 mode cards, emoji stat cards, the data table, the This Month / All Time toggle, and the slide-in settings panel.

## In-player control

- A small pill button, "Earmode · Audio" or "Earmode · Video", sits in the top-start corner of the player. A dot shows yellow for audio, grey for video.
- It is placed on top of `#movie_player`, not inside the YouTube control bar, because the control bar changes often.
- It fades in with the YouTube controls (on hover, while paused) and stays visible while audio mode is on.
- A click opens a small menu with the same 3 controls: the Video | Audio switch, the Auto-listen control, and the Player look tiles. Click outside or press Esc to close.
- It flips for Arabic (RTL).

## Player looks (replaces the bar visualizer)

The video is still hidden and set to 144p. The overlay shows one of:

- **Card** (default): blurred video thumbnail as the background, and a card with the thumbnail, "Listening", the title, and the channel.
- **Blur:** the blurred thumbnail full size, with the title and channel at the bottom.
- **Simple:** a solid background with a headphones ring, the title, and the channel.
- **Waves:** a solid background with a slow drifting yellow wave line, and the title and channel.

Simple and Waves use the existing background colour setting (`backgroundValue`). The thumbnail comes from `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg`, loaded as a CSS background image. If it fails, the look falls back to the solid colour. Waves respects `prefers-reduced-motion`.

## Options page (new, `options.html`)

A full page for everything that left the popup:

- Channels list and keywords list (add, remove).
- Player look and background colour.
- Preferred quality when audio is off.
- Language.
- Stats: this month and all time, data saved, time listened, and the estimate table.
- Import and export settings.

## State and storage

- **Per-video override:** new, in memory in the content script only: `manualOverride = { videoId, audio: true|false } | null`. It is cleared when the video id changes. The mode logic checks the override first, then the auto rule.
- **Reason:** the content script computes a reason code (`manual`, `all`, `inList`, `notInList`, `none`) and returns it with the status.
- **New sync key:** `playerLook`: `'card' | 'blur' | 'minimal' | 'waves'`, default `'card'`. It is added to import and export.
- All existing keys stay unchanged, so no data migration is needed.
- Export `app` becomes `'earmode'`. Import still accepts `'youtube-audio-mode'` files.
- **New messages (popup or in-player menu to the content script):**
  - `getStatus` returns `{ onVideo, audio, reason, mode, channel }`.
  - `setVideoAudio {audio}` sets the override.
  - `clearOverride` clears it.
  - `playerLookChanged {look}` updates the overlay live.
- The in-player menu writes storage directly (`audioModeType`, `playerLook`). Existing `storage.onChanged` listeners pick up the change.
- The popup refreshes its state from `storage.onChanged` and a status message from the tab.

## Visual identity

- Colours:
  - ink `#1C1B22`
  - sunflower `#F2C14E` (audio / "listening")
  - leaf green `#2F8F5B` (data saved)
  - cool grey ground `#E9EAF0`
  - a matching dark theme through `prefers-color-scheme`
- Fonts: Fredoka for the brand and switch labels, Nunito Sans for body text, Cairo for Arabic. They are bundled as local font files (no remote fonts in the extension).
- Icon: a rounded ink square with sunflower headphones, drawn as SVG and exported to 16, 32, 48, and 128 PNG. Also a store icon at 128 with padding.
- Badge: `ON` / `FLT` becomes a small sunflower dot or `A` / `L` text. It is only shown when auto-listen is Everything or My list.

## Store listing

- Title: Earmode: Audio Only for YouTube
- Short description (under 132 characters): "Listen to YouTube with the video turned off. Pick channels that always play as audio and save mobile data."
- Long description: plain and specific, written from the user's side. No emoji walls, no em dashes, no "stunning" or "seamless". Sections: what it does, how the switch works, your channel list, player looks, privacy (no data leaves the browser, no accounts).
- New screenshots (1280x800): the popup on a real video, the in-player menu, the 4 player looks, and the options page. Promo tile 440x280 in the new colours.
- The `extDescription` locale string is rewritten so it no longer matches the other extension.

## Error handling

- Channel not found yet: the channel card shows "Finding channel…" and retries (the popup's existing retry logic).
- Content script not ready: the popup shows the switch disabled with "Reload the YouTube tab" after the retries fail.
- Thumbnail fails to load: fall back to the solid colour.
- In-player button: re-attached by the existing navigation hooks if YouTube re-renders the player.

## Testing

- Unit tests (node:test, like `tests/content-quality.test.js`):
  - override logic and reason codes
  - override cleared on video change
  - import accepts old and new `app` ids
  - `playerLook` validation
- Manual checklist: each auto mode on a listed channel and an unlisted one; the switch both ways; Back to auto; SPA navigation to the next video clears the override; the in-player menu opens, closes, and flips in Arabic; each player look; dark theme; the options page lists and import/export.

## Out of scope

- A button inside the YouTube control bar.
- Per-channel player looks.
- Syncing stats across devices.
