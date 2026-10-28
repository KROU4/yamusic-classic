<p align="center"><img src="build/logo.svg" width="112" alt=""></p>

<h1 align="center">YM Classic</h1>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/KROU4/yamusic-classic?label=release&color=ffcc33" alt="Latest release"></a>
  <a href="../../actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/KROU4/yamusic-classic/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/downloads/KROU4/yamusic-classic/total?color=555" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/KROU4/yamusic-classic?color=555" alt="MIT license"></a>
</p>

An unofficial open-source Yandex Music desktop client for Windows. It recreates the Yandex Music design of 2023–2024: a sidebar, an animated "My Wave" hero and no genre wheel. It also fixes the most common complaints about the official app: repeats in recommendations, censored tracks and lyrics, and a slow, heavy UI.

> Not affiliated with Yandex. You need a Yandex Music account. The client signs in with the session of the official Yandex Music app installed on the same computer, so the official app has to be logged in once.

The user interface is in Russian, like the service it is built for. The code, comments and docs are in English.

## Features

**Design**
- The official layout and design tokens: a full-height sidebar (Home, Chart, New releases, Radio, Podcasts & books, Collection, Stats, "Liked", your pins, Settings and your Yandex avatar, which opens your Yandex ID account), a rounded content panel and a floating player bar tinted with the cover colour. The sidebar can collapse to icons.
- **My Wave hero.**
  - The official orb: the client plays the My Wave animation loop of the **official app installed on the same PC** (read from its own files at runtime, nothing is bundled) and makes it react to the music — it breathes with the bass and flares on a like.
  - Its hue follows the selected mood or activity.
  - **Smooth at any refresh rate.** The official loop is 25 fps; the client cross-fades its decoded frames in WebGL, so the orb moves at 60 fps or at your screen's own rate (120/144 Hz). A 30 fps economy mode plays the plain video.
  - Modes: official (default when the official app is installed), own WebGL shader, lite (CSS only) and off. The music reaction can be turned off.
  - It pauses when off-screen or minimised.
- **Wave settings like in 2023.** Activity (waking up, workout, on the road, working, studying, party, falling asleep), character, mood and language. Changes apply live to the playing wave, and any combination can be pinned to the sidebar.
- **My Wave from a text prompt.** Describe what you want ("спокойный джаз для работы") and the wave starts from it; prompts can be pinned too.
- **My Wave for two.** Create an invite link or join one and listen to a shared wave with another person (needs the feature enabled for both accounts on Yandex's side).
- **Pins.** Pin playlists, albums, artists and wave settings to the sidebar, then reorder them by dragging.
- The home page has "For you" and "Trends" tabs, with genres, moods, activities and epochs.
- A calm player bar: transport in the middle; lyrics, queue and volume on the right; source, quality, sleep timer, speed, equalizer and mini player behind «Ещё». Only non-default states (a running timer, a changed speed, FLAC) show as small chips.
- Layouts for every window size Windows snapping produces — maximised, half, quarter and a third of a 1080p screen: the sidebar compacts and scrolls, the player turns into a compact bar with a thin seek line, Now Playing switches between cover and lyrics.
- A full-screen "Now playing" view with karaoke lyrics, a mini player, and dark and light themes with six accent colours. Keyboard-operable sliders and visible focus everywhere.

**Settings**
- One page with a section index and a card per area; what the official app doesn't have is marked «Только в YM Classic».
- My Wave: animation mode with a live preview, smoothness (30 / 60 fps / screen rate), music reaction.
- Look: theme, accent colour (yellow, orange, pink, violet, blue, mint), UI zoom, fewer animations.
- Player: seek step (5–30 s) and volume step (2–10%) for the keyboard, sliders, mouse wheel and global hotkeys; time left instead of the length; cover-tinted player bar; a silent Windows notification on track change while the window is in the background.

**Sound**
- **Quality**: economy (HE-AAC 64), normal (AAC 192) or lossless. Lossless plays FLAC wherever Yandex offers it to your account: the encrypted stream (AES-128-CTR, key from the API) is decrypted on the fly by the local backend for playback only, with seeking.
- A **10-band equalizer** with presets, routed through a Web Audio graph. The preamp compensates the peak of the combined response, so boosts don't clip.
- **Crossfade** of 3–12 s with equal-power curves.
- **Loudness normalisation** by EBU R128. Loud tracks are attenuated and quiet ones boosted by up to +4 dB.
- **Playback speed** from 0.5× to 2×. Pitch stays the same.
- A **sleep timer** for 15 min – 1.5 h or until the end of the track, with a soft fade.

**Recommendations without repeats**
- A local play history: a track is not repeated for N days.
- A minimum distance between tracks by the same artist.
- Slowed, sped-up and hardtekk versions count as the same song.
- A cap on how many tracks come from "Liked".
- A request for less AI-generated music.
- Full wave feedback and play reports, so Yandex's own recommendations keep learning.

**No censorship**
- The explicit wave feed (`allowExplicit`).
- The original track instead of a substituted one.
- An explicit twin for "clean" releases.
- Full synced lyrics from [LRCLIB](https://lrclib.net) when Yandex's lyrics are censored.
- **Your own file for a track.** When Yandex edited the audio master itself (the word is muted in the only file it has — e.g. МУККА «Девочка с каре»), no API request can bring the original back. Choose «Заменить звук своим файлом…» in the track menu and the client plays your copy instead; likes, queue and stats keep working.

**Lyrics**
- Synced karaoke lyrics with **word-by-word highlighting** where LRCLIB has word timings (enhanced LRC / Lyricsfile), line-level otherwise.
- A **«Перевод»** toggle for non-Russian lyrics: a machine translation (Google Translate) under each line. Yandex has no lyrics translation API.

**Podcasts & audiobooks**
- A «Подкасты и книги» section with the official landing blocks, your shelf, categories and "continue listening".
- Podcast and book pages with episodes/chapters, publication dates, listened state and progress; playback resumes where you stopped, and progress is saved back to Yandex like the official client does.

**Library**
- A track context menu: queue, wave by track, add to playlist (or create one in place), go to album or artist, like or dislike, copy link.
- Create, rename and delete your own playlists, and remove tracks from them.
- A drag-and-drop queue.
- **My stats**, computed locally: listening time, streak, charts by day and by hour, top artists and top tracks.

**Other devices (Ynison, beta, off by default)**
- Turn it on in Settings, and the client joins your account's device list: the phone can hand playback over to it and pause, seek or switch tracks here.
- The «Устройства» button in the player bar shows what plays on your other devices, controls it (play/pause, previous/next, seek) and takes it over with «Слушать здесь» from the same position.

**Updates**
- The installed version updates itself from GitHub Releases in the background and installs on restart; the portable version shows when a new release is available.

**Windows integration**
- Thumbnail toolbar buttons, a tray icon showing the current track, and close to tray.
- Autostart, optionally minimised.
- Global hotkeys:
  - Ctrl+Alt+P: pause or play;
  - Ctrl+Alt+← / →: previous or next track;
  - Ctrl+Alt+↑ / ↓: volume;
  - Ctrl+Alt+L: like.
- System media keys and the SMTC overlay.
- UI zoom from 75% to 150%. Press `?` to see every shortcut.

**Fast.** The window opens in about 0.5 s. The UI bundle is about 195 KB of JS and 65 KB of CSS, while the official app ships a ~47 MB web bundle. Revisited pages load instantly, and scroll positions are kept.

## Download

Prebuilt binaries are attached to [GitHub Releases](../../releases):

- `YM-Classic-Setup-<version>.exe`: the installer.
- `YM-Classic-<version>-portable.exe`: a single exe that needs no installation.
- `SHA256SUMS.txt`: checksums for both.

The binaries are unsigned. Windows SmartScreen may ask you to confirm the first launch.

## Build from source

```bash
npm install
```

```bash
npm start
```

| Command | What it does |
|---|---|
| `npm start` | Builds the UI and opens the Electron window |
| `npm run dev` | Builds the UI and serves it with the backend, without Electron, for a regular browser. The URL, including its key, is printed to the console (no EQ or audio-reactive animation in a browser) |
| `npm test` | Unit tests: signatures, session lookup, anti-repeat rules, LRC, uncensor, HTTP hardening, stats, pins |
| `npm run dist` | Builds the installer and the portable exe into `release/` |
| `node scripts/smoke.js` | Live backend check against your own session. It prints summaries only, never the token |
| `npx electron scripts/render-icons.cjs` | Renders `build/logo.svg`, `build/tray.svg` and `build/social.svg` into the app, tray and social-preview PNGs |

If `npm install` did not download Electron (npm 11 blocks install scripts), run `npm approve-scripts electron`.

## Releases (CI)

`.github/workflows/release.yml` builds on `windows-latest`:

1. It runs the tests.
2. It runs `vite build`, then `electron-builder --win` (NSIS installer and portable exe).
3. It writes `SHA256SUMS.txt`.
4. It creates or updates the GitHub release for the tag.

There are two ways to trigger it:

- Push a tag:

  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

- Or run the **Release** workflow manually with a version number.

The version in `package.json` is set from the tag. `.github/workflows/ci.yml` runs the tests and the UI build on every push and pull request to `main`.

## How it works

```
electron/main.js      window, tray, mini player, taskbar buttons, hotkeys, autostart,
                      CORS header for the audio CDN (enables Web Audio), smoke mode (YMC_SHOTS)
electron/preload.cjs  narrow renderer → shell bridge (player state, mini mode, zoom)
server/               local backend on 127.0.0.1:47819 (falls back to a free port; YMC_PORT overrides),
                      reachable only with the per-launch key and a Host check
  token.js            finds the official app's session
  yandex.js           API client (request signatures in sign.js)
  wave.js             My Wave sessions with a buffer of filtered tracks
  curate.js           anti-repeat rules
  uncensor.js         originals instead of substitutes, explicit twins
  lyrics.js           Yandex and LRCLIB lyrics
  stats.js            local play log and stats
  ynison.js           Ynison device sync (redirector + state socket, reconnects; wsclient.js is the WebSocket)
src/                  Preact + signals UI
  player/engine.js    playback, queue, crossfade, sleep timer, wave continuation
  player/audiograph.js  Web Audio graph: per-element gain, EQ, analyser
  components/VibeCanvas.jsx  the My Wave shader
```

Notes on the official client, request signatures, how the censorship works and the audio quality: [docs/RESEARCH.md](docs/RESEARCH.md).

## Limitations

- Lossless depends on Yandex: it offers FLAC only to some accounts/regions (the account this was developed on only gets AAC 192, the official client included). Without it the "lossless" setting falls back to AAC 192.
- If a track's audio file was replaced with an edited one on the server, the original cannot be recovered from Yandex — use your own file for that track.
- Ynison (cross-device sync) is a beta and off by default; it was verified against a local mock and the live handshake, not yet against a real phone session.
- Offline downloads are not supported.
- The equalizer and the audio-reactive animation work only in the desktop app. In a plain browser the audio CDN does not allow cross-origin analysis, so the animation falls back to an idle "breathing" mode.

## License

MIT.
