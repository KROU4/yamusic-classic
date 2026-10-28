# Research on the original Yandex Music client 5.124.1

What was learned from taking apart the official Windows desktop app (Electron, `resources/app.asar`) and its API. YM Classic is built on these findings.

## App structure

- Electron shell: `index.js` (main, about 620 KB), `preload.js`, `app/`. `app/` holds a static Next.js export, the "next" web version of about 47 MB: 188 chunks, 126 experiment flags.
- For comparison: the built YM Classic frontend weighs about 125 KB of JS and 37 KB of CSS. The window opens about 0.5 s after launch.
- The session is stored in `%APPDATA%\YandexMusic\Local Storage\leveldb`; it is an OAuth token `y0_…`. YM Classic reads it from there, so no second sign-in is needed. The token stays in the memory of the local server and does not reach the UI, the logs or the disk.
- The keys `modSettings`, `devMode`, `defaultMusicExperimentOverrides` in `%APPDATA%\YandexMusic\config.json` are written by the PulseSync mod, not by the original. They are not present in the original `index.js`.

## Developer settings and the "old design"

- The original bundle has no flag that would bring back the classic interface: the old UI code has been removed entirely.
- Flags related to the wave and the home page: `WebNextNewWaveTab`, `WebNextNewWaveTabFeatCover`, `WebNextDisableVibe`, `WebNextDisableVibeSettings`, `WebNextWaveScreenWordsInWave*`, `WebNextQueryToVibe*`, `WebNextWaveForTwo*` and others. Full list: [experiments-5.124.1.txt](experiments-5.124.1.txt).
- Hidden tools: the `OverwrittenExperimentsModal` modal (experiment overrides), `VibeDebugPanel`, the wave animation "Lite mode" («Lite-режим», `isLiteVersionModeAvailableForToggle`).
- Conclusion: the old design cannot be restored with flags, so YM Classic reimplements the 2023–2024 design. That design has a sidebar with pins, a large generative My Wave («Моя волна») hero with its own audio-reactive WebGL shader instead of the genre wheel, wave settings for activity, character, mood and language, and For you («Для вас») / Trends («Тренды») tabs on the home page. It also has lite/off animation modes, mirroring the official client's lite mode (`isLiteVersionModeAvailableForToggle`).

## Request signatures (recovered from the bundle)

| Request | Data for HMAC-SHA256 | Format |
|---|---|---|
| `get-file-info` | `ts + trackId + quality + codecs.join("") + transports.join("")` | base64 without the last character |
| `tracks/{id}/lyrics` | `trackId + ts` | full base64 |

The keys are the player's public per-platform constants (`config.player.secretKey`), see `server/sign.js`.

## Playback and quality

- `get-file-info` with `transports=raw` returns unencrypted AAC-MP4 or MP3, which the browser plays directly.
- The official client gets lossless through `encraw`: the stream is AES-encrypted and the key comes in the response. YM Classic deliberately does **not** implement decryption, since that would circumvent content protection. So the quality is 192 kbit/s AAC, the same as the server gives in the open stream.

## How the "censorship" works

Nobody cuts words out in real time. There are three mechanisms:

1. **The `allowExplicit` flag in the wave request** (`rotor/session/new`). With `false` the server returns "clean" results. Verified: on the same `genre:rap` station there are no explicit tracks with `false`, and there are with `true`. YM Classic always sends `true`; this is configurable.
2. **Track substitution.** A different track comes back in the response (a clean version, live, cover), and the original sits in the `substituted` field. If the original is available, YM Classic plays it.
3. **"Clean" releases** (`contentWarning: clean`). YM Classic looks for the explicit version of the same song by the same artist with a similar duration and substitutes it.

Limitation: if the rights holder or Yandex **replaced the audio file in place** (as with the Anacondaz track in 2025), the original is not in the API and the client cannot bring it back.

**Lyrics.** In Yandex's lyrics the censorship shows up as `б***`. YM Classic recognizes this and shows the full synced lyrics from [LRCLIB](https://lrclib.net).

## Why the wave repeats and what was done about it

From user reviews: the wave keeps cycling through Liked («Мне нравится») tracks and disliked ones, "Shake up" («Встряхнуть») barely changes anything, there is a lot of AI music, and the same song comes in five remakes (slowed / sped up / hardtekk).

On top of Yandex's recommendations, YM Classic:

- passes the `queue` parameter with recently played tracks to `rotor/session/new` and `/tracks`. Verified: the overlap of the next batch with the queue is 0;
- keeps a local history and does not repeat a track for N days (14 by default);
- keeps a distance between tracks by the same artist;
- treats different versions of one song as a repeat (title normalization) and, optionally, removes remakes entirely;
- limits the share of tracks from Liked («Мне нравится») (by default no more than one in eight);
- sends the `X-Yandex-Music-AI-Content-Rate: reduced` header, like the official client, to get less AI music;
- sends full feedback (`radioStarted`, `trackStarted`, `trackFinished`, `skip`, `like`, `dislike`) and `play-audio` reports, so that Yandex's recommendations learn from listens.

Sources of reviews and articles: [research-sources.md](research-sources.md).

## Audio graph and CORS

The audio CDN (`*.strm.yandex.net`) only returns `Access-Control-Allow-Origin` for `https://music.yandex.ru`. Without that header, `createMediaElementSource` outputs silence. So the Electron shell adds the header to every media response (the window only loads media from Yandex stream URLs; a narrower host filter would make a stream from an unexpected CDN host or redirect fail to play at all), and the renderer sets `crossOrigin="anonymous"`. That enables the 10-band EQ and the audio-reactive animation. Chromium does not apply `HTMLMediaElement.volume` to a MediaElementSource output, so volume, mute and crossfade use a per-element GainNode. The probe script is `scripts/probe-cors.js`.
