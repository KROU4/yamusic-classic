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
- Quality values: `lq` (HE-AAC-MP4 64), `nq` (AAC-MP4 192), `lossless` (FLAC / FLAC-in-MP4), plus `hq`, `preview`, `smart_preview`. The official Electron client asks for `codecs=flac,aac,he-aac,mp3,flac-mp4,aac-mp4,he-aac-mp4` with `transports=encraw`.
- **`encraw` encryption** (from chunk 9616 and verified on the live CDN): AES-128-CTR, the 16-byte key is `downloadInfo.key` (32 hex chars), the initial counter is 16 zero bytes and the whole file is one CTR stream — byte `N` decrypts with counter `floor(N/16)` (128-bit big-endian) after skipping `N % 16` keystream bytes. A decrypted `encraw` file is byte-identical to the `raw` file of the same track. Files are plain (non-fragmented) MP4 with `moov` up front, which Chromium plays directly.
- YM Classic decrypts on the fly in its local backend (`server/media.js`): the player gets a one-off `/media/<random id>` link, each HTTP range is fetched from the CDN aligned to 16 bytes and decrypted from the right counter, so seeking works without downloading the file. The key never reaches the UI and nothing is written to disk — this is playback for an entitled subscriber, the same as the official client does.
- **Lossless availability is decided by Yandex per account/region.** For the account this was developed on (`account/about` region codes point outside Russia) every request for `lossless` or `hq` is silently answered with `quality: "nq"` (AAC 192) — for 15 popular tracks, with official headers and signing keys, on all three file-info endpoints. The client therefore shows the codec/bitrate actually returned and falls back to AAC 192.

## How the "censorship" works

Nobody cuts words out in real time. There are three mechanisms:

1. **The `allowExplicit` flag in the wave request** (`rotor/session/new`). With `false` the server returns "clean" results. Verified: on the same `genre:rap` station there are no explicit tracks with `false`, and there are with `true`. YM Classic always sends `true`; this is configurable.
2. **Track substitution.** A different track comes back in the response (a clean version, live, cover), and the original sits in the `substituted` field. If the original is available, YM Classic plays it.
3. **"Clean" releases** (`contentWarning: clean`). YM Classic looks for the explicit version of the same song by the same artist with a similar duration and substitutes it.

Limitation: if the rights holder or Yandex **replaced the audio file in place** (as with the Anacondaz track in 2025), the original is not in the API and the client cannot bring it back.

**Case study: МУККА «Девочка с каре»** (track 50400505, the only version in the catalogue, album 2019, `contentWarning: explicit`). All quality levels and both transports return the same AAC 192 file. An RMS envelope (20 ms windows) shows no muted gaps in the mix but a repeatable ~6 dB dip about 1 s into every chorus line (0:16, 0:55, 1:08, 1:59, 2:12, 2:24 by LRCLIB timings) — the vocal is ducked on one word while the beat keeps going. That is an edit of the master itself, so no request can return the original. YM Classic offers «Заменить звук своим файлом…»: the user's own copy is served for that track through the same local media endpoint.

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

## My Wave from a text prompt and "My Wave for two"

- **Query to Vibe.** The official client starts My Wave from free text with a `q2v:` seed in `rotor/session/new`; the seed is built locally from the text (see `src/lib/q2v.js`), no search request is needed. Settings seeds are not mixed in, so the prompt is not overridden by mood/language filters.
- **Multivibe ("for two").** Rooms are created/joined through the rooms API (`server/rooms.js`); an invite is a `https://music.yandex.ru/multivibe/<id>` link. Creating and accepting an invite needs two accounts and was not exercised live; error codes are mapped to readable messages.

## Podcasts and audiobooks

Landing blocks, the user's shelf, categories, episode lists and listening progress follow the official client (`server/podcasts.js`). Progress is saved like the official client does — on pause, on track change, every 30 s and on window close — and an episode resumes from the server position; reporting starts only after the resume seek has happened, so a few seconds from zero never overwrite the saved place.

## Lyrics: translation and word timing

- Yandex's lyrics API has formats TEXT / LRC / RICH_JSON but **no translation**; the «Перевод» toggle uses machine translation (Google Translate) for non-Russian lyrics and labels it as such.
- Word timings come from LRCLIB when a record has them (enhanced LRC `<mm:ss.xx>` word tags or a YAML "Lyricsfile"); they are aligned onto Yandex's lines when the texts match, otherwise the LRCLIB lyrics are shown whole.

## Ynison (cross-device sync)

Connection: `wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison` with auth and device info in the `Sec-WebSocket-Protocol` JSON (an `Origin` header is required), then the state service on the returned host with the ticket. A newly connected device first sends an empty, paused `update_full_state` marked not active; control commands are `update_playing_status` / `update_player_state` with incremented versions; int64 fields are sent as strings. YM Classic keeps this **off by default**. The handshake was verified live (passively); the state exchange was verified against a local mock server only, never by sending state to the real service during development.
