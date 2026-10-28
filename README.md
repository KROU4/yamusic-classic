# YM Classic

An unofficial open-source Yandex Music desktop client for Windows. It recreates the Yandex Music design of 2023–2024: a sidebar, an animated "My Wave" hero and no genre wheel. It also fixes the most common complaints about the official app: repeats in recommendations, censored tracks and lyrics, and a slow, heavy UI.

> Not affiliated with Yandex. You need a Yandex Music account. The client signs in with the session of the official Yandex Music app installed on the same computer, so the official app has to be logged in once.

The user interface is in Russian, like the service it is built for. The code, comments and docs are in English.

## Features

**Design**
- A 2023-era layout. The sidebar holds the sections (Home, Chart, New releases, Radio, Collection, Stats), "Liked" and your pinned items. It can collapse to icons.
- **My Wave hero.**
  - A generative, audio-reactive animation on its own WebGL shader: a glowing ring breathes with the bass and ripples outward.
  - The colours follow the selected mood or activity, and liking a track makes the ring flash.
  - Three modes: full, lite (CSS only) and off.
  - It pauses when off-screen or minimised.
- **Wave settings like in 2023.** Activity (waking up, workout, on the road, working, studying, party, falling asleep), character, mood and language. Changes apply live to the playing wave, and any combination can be pinned to the sidebar.
- **Pins.** Pin playlists, albums, artists and wave settings to the sidebar, then reorder them by dragging.
- The home page has "For you" and "Trends" tabs, with genres, moods, activities and epochs.
- A centred player bar, a full-screen "Now playing" view with karaoke lyrics (the wave animation plays behind it), a mini player, and dark and light themes.

**Sound**
- A **10-band equalizer** with presets, routed through a Web Audio graph. Boosts are offset by a preamp, so they don't clip.
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

**Library**
- A track context menu: queue, wave by track, add to playlist (or create one in place), go to album or artist, like or dislike, copy link.
- Create, rename and delete your own playlists, and remove tracks from them.
- A drag-and-drop queue.
- **My stats**, computed locally: listening time, streak, charts by day and by hour, top artists and top tracks.

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

**Fast.** The window opens in about 0.5 s. The UI bundle is about 125 KB of JS and 37 KB of CSS, while the official app ships a ~47 MB web bundle. Revisited pages load instantly, and scroll positions are kept.

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
| `npm run dev` | Backend and UI without Electron. The URL, including its key, is printed to the console |
| `npm test` | Unit tests: signatures, session lookup, anti-repeat rules, LRC, uncensor, HTTP hardening, stats, pins |
| `npm run dist` | Builds the installer and the portable exe into `release/` |
| `node scripts/smoke.js` | Live backend check against your own session. It prints summaries only, never the token |

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
  git tag v0.2.0
  git push origin v0.2.0
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
src/                  Preact + signals UI
  player/engine.js    playback, queue, crossfade, sleep timer, wave continuation
  player/audiograph.js  Web Audio graph: per-element gain, EQ, analyser
  components/VibeCanvas.jsx  the My Wave shader
```

Notes on the official client, request signatures, how the censorship works and the audio quality: [docs/RESEARCH.md](docs/RESEARCH.md).

## Limitations

- Audio quality tops out at 192 kbps AAC. The official app gets lossless as an encrypted stream, and this client deliberately does not decrypt it.
- If a track's audio file was replaced with an edited one on the server, the original cannot be recovered.
- Podcasts and audiobooks, Ynison (remote control from another device) and offline downloads are not supported.
- The equalizer and the audio-reactive animation work only in the desktop app. In a plain browser the audio CDN does not allow cross-origin analysis, so the animation falls back to an idle "breathing" mode.

## License

MIT.
