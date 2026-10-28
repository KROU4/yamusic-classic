# Research: Yandex Music, the old design, complaints, My Wave («Моя волна»), censorship, open-source clients

Date: 2026-10-28. Method: web search and reading pages (about 20 queries). Anything that could not be confirmed by sources is marked "not verified".

## 1. The old design (before the redesign) and the "wheel"

### Timeline
- The old design (light theme, red note in the logo) stayed essentially unchanged worldwide for almost 9 years. The big redesign: December 1, 2023 (new logo, black background by default, the home page split into the For you («Для вас») and Trends («Тренды») tabs). https://trashbox.ru/link/2023-12-01-muzyka-obnovila-logotip-glavnuyu-stranicu-i-vizualnyj-stil
- Desktop/web: a new home page with a large My Wave block at the top was in beta; the Habr author noticed it on November 6, 2024, and the old interface could still be restored at the time. https://habr.com/en/articles/856716 , https://workspace.ru/blog/mini-ux-patrul-redizayn-yandeks-muzyki-kotoryy-ne-smog/
- A separate Mac app with the updated design: https://ichip.ru/novosti/yandeks-muzyka-poluchila-obnovlyonnyj-dizajn-i-otdelnoe-prilozhenie-dlya-mac-851502 ; review: https://rozetked.me/reviews/31538-obzor-obnovlennogo-prilozheniya-yandeks-muzyka-krasivo
- Clarification: the "wave" over the cover art with generative animation that adapts to the rhythm and likes: https://snob.ru/news/iandeks-muzyka-obnovila-dizain-moei-volny/

### What the "wheel" is
- The "wheel" (in articles: "round scroll", «круглый скролл») is a large My Wave block at the top of the home page with animation and a circular scroll of settings (mood, activity, genre, character). The Customize wave («Настроить волну») button is hidden inside it; users call this the main problem of the redesign. Sources: https://t-j.ru/unwave-my-music/ , https://workspace.ru/blog/mini-ux-patrul-redizayn-yandeks-muzyki-kotoryy-ne-smog/

### The old home page (what is confirmed)
- Header: logo, the sections Main («Главное»), Podcasts and Books («Подкасты и книги»), Kids («Детям»), Collection («Коллекция»), search, app installation, account.
- Blocks: My Wave (small), playlists (Playlist of the Day («Плейлист дня»), Premiere («Премьера»), Deja Vu («Дежавю»), Stash («Тайник»)), recently played, clips, new releases, chart, collections. In the new version the shared content (charts, collections) was moved to the Trends tab; before, it came right below the personal blocks. Sources: workspace.ru (above), rozetked (above).
- Track card: 3 actions (like, play, share); in the new one, 5+ buttons on hover. A click on the card opened the album on the right; a single click on a premiere/track started playback (now a double click). Source: habr 856716.
- Player: at the bottom, simple. The home page did not reset its scroll position on return (now it does).
- The new Trends tab contains genres, moods, activities, eras, albums of the month, the chart: https://trashbox.ru/link/2023-12-01-muzyka-obnovila-logotip-glavnuyu-stranicu-i-vizualnyj-stil . The Moods and Genres («Настроения и жанры») grid (tiles) belongs to the "old" Main section; the articles found did not describe the exact layout of the old grid.

### Not verified (screenshots needed from Wayback / archive.org music.yandex.ru for 2021-2023)
- The exact order of blocks on the old home page, the composition of the Moods and Genres tile grid.
- Colors and font: the yellow accent (#ffdb4d / #fc3) and YS Text come from the user's assignment and general knowledge, not confirmed by sources. Recommendation: take the tokens directly from web.archive.org snapshots and the CSS of the old music.yandex.ru.

## 2. User complaints

Sources: https://dtf.ru/5124533-post-nenavisti-k-yandeks-muzyke , https://t-j.ru/unwave-my-music/ , https://habr.com/en/articles/856716 , https://habr.com/en/news/894440/comments , https://www.iphones.ru/iNotes/user-posts/nenavizhu-neyromuzyku , https://uniseller.io/blog/neyromusika-v-yandex-music-problema-i-reshenie

- Request #1: bring back the old design or give a choice. Many write that recommendations used to be more accurate.
- The wheel: needless scrolling, hidden settings; autoplay on launch; Play starts Liked («Мне нравится») instead of the wave; the home page scrolls back to the top.
- Recommendations: the wave repeats Liked and disliked tracks; Shake up my wave («Встряхнуть мою волну») barely changes anything; quality drops after 5-10 tracks; a lot of unlabeled AI music (Suno) and no filter; disliking one AI artist gets replaced by ten new ones.
- Bugs: tracks play several times when flipping quickly, images do not load, jerky scrolling, slow track start, Bluetooth autoplay. Service outages (March 2025): https://www.iphones.ru/iNotes/yandeks-muzyka-slomalas-vtoroy-raz-za-nedelyu-nichego-ne-zagruzhaetsya
- Interface: overloaded cards, label pages removed, scroll lag (Habr comments), the concerts block above the music, blurry song lyrics, small track title.
- Track substitution: tracks removed from playlists are replaced with covers/live versions (dtf).
- Electron/heaviness: found no direct reviews about memory (the Electron client is confirmed indirectly). Not verified, data from 4pda/Microsoft Store is needed.
- Wishes: a choice of design, an AI-music filter, proper dislikes, a deterministic Play, downloads/cache on another drive, a mini-player, scrobbling.

## 3. Fighting My Wave repeats

- Built-in settings: language (12 languages were added in 2025: French, German, Japanese, Kazakh and others; before, it was Russian / non-Russian / no words), No words («Без слов»), mood, character (Favorite («Любимое») / Unfamiliar («Незнакомое») / Popular («Популярное»)), activity. https://habr.com/ru/news/963670 , https://rozetked.me/news/42594-moya-volna-v-yandeks-muzyke-teper-podbiraet-muzyku-na-dvenadcati-raznyh-yazykah , https://www.iphones.ru/iNotes/v-yandeks-muzyke-poyavilis-rekomendacii-trekov-bez-slov-03-16-2023
- My Wave by track/artist/album («Моя волна по треку/исполнителю/альбому») as a way to reset the selection. https://t-j.ru/lt-my-vibe-yandex-music/
- Folk workarounds: mass dislikes, cleaning up Liked, listening to Liked instead of the wave. Reliability is low, going by the complaints themselves.
- Unofficial API (the yandex-music-api library, the `RotorSettings` field): `language` in {`not-russian`, `russian`, `any`}; `diversity` in {`favorite`, `popular`, `discover`, `default`}; `mood_energy` in {`fun`, `active`, `calm`, `sad`, `all`}; deprecated `mood`/`energy` (int) from settings1. https://ym.marshal.dev/en/main/yandex_music.rotor.rotor_settings.html (mirror https://yandex-music.readthedocs.io/en/main/yandex_music.rotor.rotor_settings.html). There is no official documentation; check values with live requests.
- An idea for our client (client side): keep a local history of the last N tracks and filter out/skip repeats and disliked tracks when receiving a rotor batch (`rotor/station/.../tracks` with `queue` of the last track); keep our own artist "ban list". The implementation and the API behavior are not verified; this is a hypothesis.

## 4. Censorship

- Two-stage moderation of uploaded content (a neural network, then humans), an Explicit label, possible hiding from recommendations or removal; the initiator is the music industry association. https://www.iguides.ru/main/other/yandeks_muzyka_nachala_zhestko_tsenzurirovat_treki/ , https://www.securitylab.ru/news/543246.php
- In 2023, more than 4000 tracks and podcasts were removed at the authorities' request: https://novayagazeta.eu/articles/2023/11/01/iandeks-muzyka-po-trebovaniiu-vlastei-udalila-bolee-chetyrekh-tysiach-pesen-i-podkastov-s-nachala-goda-news
- October 2025: in the Anacondaz track "Mama, I love" («Мама, я люблю») words were cut out and guitar riffs sit in their place; in "Brighter than the stars" («Ярче звезд») (mild profanity, «полматери») individual words were replaced: https://novayagazeta.eu/articles/2025/10/07/na-iandeks-muzyke-zatsenzurili-trek-anacondaz-mama-ia-liubliu-iz-pesni-ubrali-slova-kokain-satana-i-nekrofil-news ; general overview: https://novayagazeta.ru/articles/2025/05/20/a-ne-to-ia-zavoiu-a-ne-to-ia-zalaiu
- Settings: App settings («Настройки приложения») -> Adult content filtering («Фильтрация контента для взрослых») (the No restrictions («Без ограничений») option), an "E" label on tracks with profanity; albums may have Other versions («Другие версии») (look for the uncensored version). Kids mode («Детский режим») controls the Kids section. https://teletype.in/@soveti/kak-ubrat-detskij-rezhim-yandeks-muzyka
- Substitution of removed tracks with live versions/covers in playlists (dtf complaints).
- Found no public workarounds (client patches). Not verified: whether the API returns separate trackIds for the "clean" and "original" versions of a censored track, and whether it exposes a `contentWarning`/`explicit` field. Idea: in our client, highlight the "E" label and the album's "Other versions", and offer switching to the original; the bleeps are baked into the audio and cannot be fixed on the client.

## 5. Open-source clients and mods

- YandexMusicModClient (TheKing-OfTime), MIT, 601 stars, archived since 9.02.2026 (the author recommends PulseSync). Features: Discord RPC, Last.fm scrobbling, a mini-player above windows, cache on another drive, global hotkeys, "repeat track in My Wave", codec/quality display, downloading tracks/albums/playlists/podcasts/books, 75-200% zoom, bug fixes, DevTools. Requires a Plus subscription. https://github.com/TheKing-OfTime/YandexMusicModClient
- PulseSync (formerly YMusic-DRPC): Discord RPC, mods, themes (community), its own license. Themes/lyrics/addons are not confirmed on the repository page. https://github.com/PulseSync-LLC/YMusic-DRPC , https://discord.com/servers/pulsesync-1227552882744754267
- Yandex Music Mod (Discord): https://discord.com/servers/yandex-music-mod-1410905688372154400
- Cassette (GTK/Adwaita, Linux, Flathub): offline playlists, karaoke mode. https://flathub.org/apps/io.github.Rirusha.Cassette
- YaYmp (Qt, cross-platform, lightweight). https://alternativeto.net/software/yaymp/about/
- YamSync (Android/PC/iOS, an open player + downloader, 10-band equalizer). https://github.com/audiz/YamSync
- yamusic-tui (Go, TUI). https://gittrend.io/repo/DECE2183/yamusic-tui
- next-music: a web client with themes, addons, Discord RPC, an OBS widget: https://www.linux-meta.duckdns.org/en/p/next-music
- API libraries: MarshalX/yandex-music-api (Python), kontsevoye/ym-api (Node), p0rterB/YM-API (Swift), yandex-music-open-api. https://github.com/kontsevoye/ym-api , https://github.com/p0rterB/YM-API
- What people value: Discord RPC, downloads/cache, mini-player, Last.fm, hotkeys, themes, lightness, karaoke/lyrics. LRCLIB is not confirmed in the projects found (an idea for our client: https://lrclib.net as a source of synced lyrics, not verified through search).

## Sources worth reading next
- Wayback Machine music.yandex.ru for 2022 (screenshots of the old home page, CSS tokens).
- The 4pda thread for Yandex Music (could not be found by search).
- The source of MarshalX/yandex-music-api: the methods `rotor_station_tracks`, `rotor_station_settings2`.
