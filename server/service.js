// Application layer: everything the UI can ask of the backend.
import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { YandexMusic, ApiError, CODECS } from "./yandex.js";
import { MediaRegistry, audioMime } from "./media.js";
import { resolveSession } from "./token.js";
import { JsonStore, PlayHistory } from "./store.js";
import { normTrack, normAlbum, normArtist, normPlaylist, normStation, coverUrl } from "./normalize.js";
import { DEFAULT_CURATION, songKey } from "./curate.js";
import { WaveManager, WAVE_SETTINGS, isPureStation, cleanSeeds } from "./wave.js";
import { WaveRooms } from "./rooms.js";
import { Uncensor } from "./uncensor.js";
import { getLyrics } from "./lyrics.js";
import { translateLines } from "./lyrics-translate.js";
import { PlayLog, computeStats } from "./stats.js";
import { Podcasts } from "./podcasts.js";
import { YnisonManager } from "./ynison.js";

export const DEFAULT_PREFS = {
  allowExplicit: true, // don't ask the wave for "clean" output
  uncensor: true, // substitute the original for a replaced/clean track
  aiReduced: true, // less AI music in the wave (header as in the official client)
  quality: "lossless", // lq | nq | lossless (FLAC where the track has it, otherwise AAC 192)
  lyricsPrefer: "auto",
  curation: DEFAULT_CURATION,
  wave: { diversity: "default", moodEnergy: "all", language: "any" },
  theme: "dark",
  volume: 0.8,
  crossfade: 0, // seconds of track overlap, 0 = off
  normalize: false, // R128 loudness normalization
  // Windows shell
  closeToTray: false,
  autostart: false,
  startMinimized: false,
  globalHotkeys: false,
  autoUpdate: true, // check GitHub Releases; the installed build updates itself on restart
  ynison: false, // cross-device sync: off by default, never connects until the user opts in
};

/** Yandex ID avatar; "0/0-0" (or empty) is the grey placeholder — the UI shows the initial instead. */
export function avatarUrl(id, size) {
  if (typeof id !== "string" || !/^\d+\/[\w-]+$/.test(id) || id.startsWith("0/0")) return null;
  return `https://avatars.mds.yandex.net/get-yapic/${id}/${size}`;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class Service {
  constructor({ dataDir, fetchImpl = globalThis.fetch, log = () => {} }) {
    this.fetch = fetchImpl;
    this.log = log;
    this.store = new JsonStore(path.join(dataDir, "state.json"), { prefs: DEFAULT_PREFS });
    this.history = new PlayHistory(this.store);
    this.playlog = new PlayLog(this.store);
    this.prefListeners = [];
    this.api = new YandexMusic({ fetchImpl });
    this.account = null;
    this.sessionSource = null;
    this.library = { liked: new Set(), disliked: new Set(), loadedAt: 0 };
    this.uncensor = new Uncensor(this.api, this.store);
    this.media = new MediaRegistry({ fetchImpl, log });
    this.wave = new WaveManager({
      api: this.api,
      history: this.history,
      getLibrary: () => this.library,
      getPrefs: () => this.prefs,
      log,
    });
    // "My Wave for two" rooms (wave/rooms)
    this.rooms = new WaveRooms({ api: this.api, requireAuth: () => this.requireAuth() });
    this.cache = new Map();
    this.playlistLocks = new Map(); // kind -> tail of this playlist's edit chain
    this.podcasts = new Podcasts(this);
    this.ynison = new YnisonManager(this);
    this.onPrefs((next, patch) => "ynison" in patch && this.ynison.sync());
  }

  get prefs() {
    const p = this.store.get("prefs") || {};
    return { ...DEFAULT_PREFS, ...p, curation: { ...DEFAULT_CURATION, ...(p.curation || {}) }, wave: { ...DEFAULT_PREFS.wave, ...(p.wave || {}) } };
  }

  setPrefs(patch) {
    const cur = this.prefs;
    const next = {
      ...cur,
      ...patch,
      curation: { ...cur.curation, ...(patch.curation || {}) },
      wave: { ...cur.wave, ...(patch.wave || {}) },
    };
    this.store.set("prefs", next);
    for (const fn of this.prefListeners) fn(next, patch);
    return next;
  }

  /** Subscription to settings changes (Electron applies autostart, hotkeys). */
  onPrefs(fn) {
    this.prefListeners.push(fn);
  }

  // ---------- session ----------
  async init() {
    const validate = async (token) => {
      const probe = new YandexMusic({ token, fetchImpl: this.fetch });
      const st = await probe.accountStatus();
      return st?.account?.uid ? st : null;
    };
    const found = await resolveSession({ validate });
    if (!found) {
      this.account = null;
      this.ynison.sync();
      return { authorized: false };
    }
    this.api.token = found.token;
    this.api.uid = found.account.account.uid;
    this.account = found.account;
    this.sessionSource = found.source;
    const [settings, about] = await Promise.all([this.api.accountSettings().catch(() => null), this.api.accountAbout().catch(() => null)]);
    this.about = about;
    if (settings && this.store.get("prefs")?.aiReduced === undefined) {
      this.setPrefs({ aiReduced: settings.aiContentReductionEnabled !== false });
    }
    this.refreshLibrary().catch((e) => this.log("library refresh failed", e.message));
    this.ynison.reconnect(); // a new session (or token) gets a fresh connection, if the user enabled it
    return { authorized: true };
  }

  requireAuth() {
    if (!this.account) throw new ApiError("Нет сессии Яндекс Музыки. Войдите в официальное приложение один раз.", 401);
  }

  me() {
    if (!this.account) return { authorized: false };
    const a = this.account.account;
    return {
      authorized: true,
      source: this.sessionSource,
      uid: a.uid,
      login: a.login,
      name: a.displayName || a.fullName || a.login,
      hasPlus: !!this.account.plus?.hasPlus,
      avatar: avatarUrl(this.about?.avatarId, "islands-retina-middle"),
      avatarLarge: avatarUrl(this.about?.avatarId, "islands-200"),
      region: a.region,
    };
  }

  async refreshLibrary() {
    const uid = this.api.uid;
    const [likes, dislikes] = await Promise.all([this.api.likedTracks(uid), this.api.dislikedTracks(uid).catch(() => null)]);
    this.library = {
      liked: new Set((likes?.library?.tracks || []).map((t) => String(t.id))),
      likedOrder: (likes?.library?.tracks || []).map((t) => String(t.id)),
      disliked: new Set((dislikes?.library?.tracks || []).map((t) => String(t.id))),
      loadedAt: Date.now(),
    };
    return this.library;
  }

  async cached(key, ttlMs, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await fn();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  async fullTracks(ids) {
    const parts = await Promise.all(chunk(ids, 250).map((c) => this.api.tracks(c)));
    return parts.flat().map(normTrack).filter(Boolean);
  }

  decorate(tracks) {
    const ov = this.store.get("overrides") || {};
    return tracks.map((t) => ({ ...t, liked: this.library.liked.has(t.id), disliked: this.library.disliked.has(t.id), ...(ov[t.id] ? { localFile: ov[t.id].name } : {}) }));
  }

  // ---------- home ----------
  async home() {
    this.requireAuth();
    return this.cached("home", 5 * 60 * 1000, async () => {
      const [landing, stations] = await Promise.all([
        this.api.landing(["personalplaylists", "play_contexts", "new-releases", "new-playlists", "chart"]),
        this.stations().catch(() => null),
      ]);
      const out = { personal: [], recent: [], chart: [], newReleases: [], playlists: [], stations };
      for (const block of landing?.blocks || []) {
        if (block.type === "personal-playlists") {
          out.personal = block.entities
            .map((e) => ({ ...normPlaylist(e.data?.data), kindName: e.data?.type, ready: e.data?.ready !== false, note: e.data?.previewDescription || "" }))
            .filter((p) => p.kind != null);
        } else if (block.type === "play-contexts") {
          out.recent = block.entities.map((e) => this.playContext(e.data)).filter(Boolean);
        } else if (block.type === "chart") {
          out.chart = block.entities
            .map((e) => ({ ...normTrack(e.data?.track), position: e.data?.chartPosition?.position, progress: e.data?.chartPosition?.progress }))
            .filter((t) => t.id);
        } else if (block.type === "new-releases") {
          out.newReleases = block.entities.map((e) => normAlbum(e.data)).filter(Boolean);
        } else if (block.type === "new-playlists") {
          out.playlists = block.entities.map((e) => normPlaylist(e.data)).filter(Boolean);
        }
      }
      out.chart = this.decorate(out.chart);
      return out;
    });
  }

  playContext(d) {
    if (!d?.payload) return null;
    const p = d.payload;
    if (d.context === "playlist") return { type: "playlist", item: normPlaylist(p) };
    if (d.context === "album") return { type: "album", item: normAlbum(p) };
    if (d.context === "artist") return { type: "artist", item: normArtist(p) };
    return null;
  }

  async stations() {
    return this.cached("stations", 60 * 60 * 1000, async () => {
      const list = await this.api.stationsList();
      const groups = { genre: [], mood: [], activity: [], epoch: [], "local-language": [] };
      for (const x of list) {
        const st = normStation(x.station);
        if (st && !st.parent && groups[st.type]) groups[st.type].push(st);
      }
      return groups;
    });
  }

  async chart() {
    this.requireAuth();
    const r = await this.cached("chart", 10 * 60 * 1000, () => this.api.chart());
    const tracks = (r?.chart?.tracks || []).map((x) => ({ ...normTrack(x.track), position: x.chart?.position, progress: x.chart?.progress }));
    return { title: r?.title || "Чарт", tracks: this.decorate(tracks.filter((t) => t.id)) };
  }

  async newReleases() {
    this.requireAuth();
    const ids = await this.cached("new-releases", 30 * 60 * 1000, async () => (await this.api.newReleases())?.newReleases || []);
    const albums = await this.api.albums(ids.slice(0, 60));
    return albums.map(normAlbum);
  }

  // ---------- entities ----------
  async search(q, type = "all") {
    this.requireAuth();
    const r = await this.api.search(q, type, 0);
    const best = r?.best;
    let bestItem = null;
    if (best?.type === "track") bestItem = { type: "track", item: normTrack(best.result) };
    else if (best?.type === "album") bestItem = { type: "album", item: normAlbum(best.result) };
    else if (best?.type === "artist") bestItem = { type: "artist", item: normArtist(best.result) };
    else if (best?.type === "playlist") bestItem = { type: "playlist", item: normPlaylist(best.result) };
    return {
      text: r?.text,
      corrected: r?.misspellCorrected ? r.text : null,
      best: bestItem,
      tracks: this.decorate((r?.tracks?.results || []).map(normTrack).filter(Boolean)),
      albums: (r?.albums?.results || []).map(normAlbum),
      artists: (r?.artists?.results || []).map(normArtist),
      playlists: (r?.playlists?.results || []).map(normPlaylist),
    };
  }

  async suggest(q) {
    this.requireAuth();
    const r = await this.api.searchSuggest(q);
    return { suggestions: r?.suggestions || [] };
  }

  async album(id) {
    this.requireAuth();
    const r = await this.api.album(id);
    const tracks = (r.volumes || []).flat().map(normTrack).filter(Boolean);
    return { album: { ...normAlbum(r), cover: coverUrl(r.coverUri, 400), labels: (r.labels || []).map((l) => l.name), releaseDate: r.releaseDate || null }, tracks: this.decorate(tracks) };
  }

  async artist(id) {
    this.requireAuth();
    const [info, albums] = await Promise.all([this.api.artist(id), this.api.artistAlbums(id).catch(() => null)]);
    return {
      artist: { ...normArtist(info.artist), cover: coverUrl(info.artist?.cover?.uri, 400), likes: info.artist?.likesCount || 0, description: info.artist?.description?.text || "" },
      popular: this.decorate((info.popularTracks || []).map(normTrack).filter(Boolean)),
      albums: (albums?.albums || info.albums || []).map(normAlbum),
      similar: (info.similarArtists || []).map(normArtist),
      playlists: (info.playlists || []).map(normPlaylist),
    };
  }

  async artistTracks(id, page = 0) {
    this.requireAuth();
    const r = await this.api.artistTracks(id, page, 100);
    return { tracks: this.decorate((r.tracks || []).map(normTrack).filter(Boolean)), pager: r.pager };
  }

  async playlist(uid, kind) {
    this.requireAuth();
    const r = await this.api.playlist(uid, kind);
    const entries = r.tracks || [];
    // rich-tracks sometimes returns only ids: load the rest, keeping the original order:
    // the on-screen index must match the position in the playlist (deleting a track goes by index)
    const missing = entries.filter((x) => !x.track).map((x) => String(x.id));
    const loaded = missing.length ? new Map((await this.fullTracks(missing)).map((t) => [t.id, t])) : new Map();
    const tracks = entries.map((x) => (x.track ? normTrack(x.track) : loaded.get(String(x.id)) || null)).filter(Boolean);
    return { playlist: { ...normPlaylist(r), cover: coverUrl(r.cover?.uri || r.ogImage, 400) }, tracks: this.decorate(tracks) };
  }

  async likedTracks() {
    this.requireAuth();
    await this.refreshLibrary();
    const tracks = await this.fullTracks(this.library.likedOrder || []);
    return { tracks: this.decorate(tracks) };
  }

  async collection() {
    this.requireAuth();
    const uid = this.api.uid;
    const [own, albums, artists, playlists] = await Promise.all([
      this.api.userPlaylists(uid).catch(() => []),
      this.api.likedAlbums(uid).catch(() => []),
      this.api.likedArtists(uid).catch(() => []),
      this.api.likedPlaylists(uid).catch(() => []),
    ]);
    return {
      likedCount: this.library.liked.size,
      playlists: [...(own || []).map(normPlaylist), ...(playlists || []).map((x) => normPlaylist(x.playlist || x))],
      albums: (albums || []).map((x) => normAlbum(x.album || x)),
      artists: (artists || []).map((x) => normArtist(x.artist || x)),
    };
  }

  async similar(trackId) {
    this.requireAuth();
    const r = await this.api.similar(trackId);
    return { tracks: this.decorate((r?.similarTracks || []).map(normTrack).filter(Boolean)) };
  }

  // ---------- playback ----------
  async resolvePlay(track) {
    this.requireAuth();
    const prefs = this.prefs;
    // the user's own file for this track (e.g. an uncensored copy) wins over anything Yandex has
    const local = this.localFile(track.id);
    if (local) {
      const url = this.media.register({ kind: "file", path: local.path, mime: local.mime });
      return { track: this.decorate([track])[0], stream: { url, codec: "local", bitrate: null, quality: "local", gain: false } };
    }
    const actual = await this.uncensor.resolve(track, { enabled: prefs.uncensor });
    const stream = await this.streamFor(actual.id, prefs.quality);
    return { track: this.decorate([actual])[0], stream };
  }

  /** Stream for the chosen quality. Lossless goes through the local decrypting proxy; the key never reaches the UI. */
  async streamFor(trackId, quality) {
    if (quality === "lossless") {
      const enc = await this.api.fileInfo(trackId, "lossless", CODECS, "encraw").catch((e) => (this.log("lossless info failed", e.message), null));
      if (enc?.key && /^flac/.test(enc.codec || "")) {
        const refresh = async () => {
          const f = await this.api.fileInfo(trackId, "lossless", CODECS, "encraw");
          return { url: f.url, key: f.key };
        };
        const url = this.media.register({ kind: "enc", url: enc.url, key: enc.key, mime: enc.codec === "flac" ? "audio/flac" : "audio/mp4", refresh });
        return { url, codec: enc.codec, bitrate: enc.bitrate, quality: "lossless", gain: enc.gain };
      }
      // no lossless master for this track: the best open stream
    }
    const { key, ...open } = await this.api.fileInfo(trackId, quality === "lq" ? "lq" : "nq");
    return open;
  }

  // ---------- local replacement files ----------
  localFile(trackId) {
    const o = (this.store.get("overrides") || {})[trackId];
    if (!o) return null;
    const mime = audioMime(o.path);
    return mime && fs.existsSync(o.path) ? { ...o, mime } : null;
  }

  listOverrides() {
    return this.store.get("overrides") || {};
  }

  setOverride(trackId, file) {
    if (!/^\d+$/.test(String(trackId))) throw new ApiError("Неверный трек", 400);
    if (typeof file !== "string" || !audioMime(file)) throw new ApiError("Нужен аудиофайл: mp3, flac, m4a, aac, ogg, opus или wav", 400);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError("Файл не найден", 404);
    const all = { ...(this.store.get("overrides") || {}), [trackId]: { path: file, name: path.basename(file), at: Date.now() } };
    this.store.set("overrides", all);
    return all[trackId];
  }

  removeOverride(trackId) {
    const all = { ...(this.store.get("overrides") || {}) };
    delete all[trackId];
    this.store.set("overrides", all);
    return { ok: true };
  }

  async lyrics(track) {
    this.requireAuth();
    // the side panel and Now Playing each mount a lyrics view: one fetch per track serves both, and LRCLIB
    // (asked on every lookup for word timings) isn't hit again on every remount
    const cache = (this.lyricsCache ??= new Map());
    const key = `${track?.id}:${this.prefs.lyricsPrefer}`;
    const hit = cache.get(key);
    if (hit && Date.now() < hit.until) return hit.promise;
    // the in-flight promise is cached too: both views asking at once share one Yandex + LRCLIB round
    const promise = getLyrics(this.api, track, { prefer: this.prefs.lyricsPrefer, fetchImpl: this.fetch }).then(
      (d) => d || { source: null, synced: false, lines: [], plain: "" },
    );
    const entry = { promise, until: Date.now() + 60000 };
    cache.set(key, entry);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    try {
      const data = await promise;
      // an empty answer may be a transient LRCLIB failure, and a late LRCLIB may still bring word timings:
      // keep those briefly, a complete answer for half an hour
      const complete = (data.lines.length || data.plain) && !data.wordsPending;
      entry.until = Date.now() + (complete ? 30 * 60000 : 60000);
      return data;
    } catch (e) {
      if (cache.get(key) === entry) cache.delete(key);
      throw e;
    }
  }

  async lyricsTranslate({ id, lines } = {}) {
    const cache = (this.lyricsTrCache ??= new Map());
    const key = `${id}:${crypto.createHash("sha1").update(JSON.stringify(lines || [])).digest("hex")}`;
    if (cache.has(key)) return cache.get(key);
    // cache the request itself so two views toggling at once send one translation request
    const promise = translateLines(lines, { target: "ru", fetchImpl: this.fetch });
    cache.set(key, promise);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    try {
      return await promise;
    } catch (e) {
      if (cache.get(key) === promise) cache.delete(key);
      throw e;
    }
  }

  async setLike(trackId, liked) {
    this.requireAuth();
    await this.api.setTrackLike(this.api.uid, trackId, liked);
    if (liked) {
      this.library.liked.add(trackId);
      this.library.disliked.delete(trackId);
    } else this.library.liked.delete(trackId);
    return { liked };
  }

  async setDislike(trackId, disliked) {
    this.requireAuth();
    await this.api.setTrackDislike(this.api.uid, trackId, disliked);
    if (disliked) {
      this.library.disliked.add(trackId);
      this.library.liked.delete(trackId);
    } else this.library.disliked.delete(trackId);
    return { disliked };
  }

  /** Track finished or skipped: local history (anti-repeat) + report to Yandex. */
  async played({ track, from, playedSeconds, durationSeconds, playId, endPositionSeconds }) {
    this.requireAuth();
    // skipped tracks also go into the anti-repeat history: if a track was skipped, the user doesn't want to hear it again soon
    if (playedSeconds >= 3) {
      this.history.record(track, songKey(track));
      this.playlog.add(track, playedSeconds);
    }
    await this.api
      .playAudio({
        trackId: track.id,
        albumId: track.albumId,
        from,
        playId: playId || crypto.randomUUID(),
        totalPlayedSeconds: Math.round(playedSeconds),
        // episodes report the player position (they resume mid-way); music keeps the old played-seconds value
        endPositionSeconds: Math.round(Number.isFinite(endPositionSeconds) ? endPositionSeconds : playedSeconds),
        trackLengthSeconds: Math.round(durationSeconds),
      })
      .catch((e) => this.log("play-audio failed", e.message));
    return { ok: true };
  }

  // ---------- wave ----------
  async waveStart({ stationId, settings, extraSeeds }) {
    this.requireAuth();
    const s = isPureStation(stationId) ? {} : settings || this.prefs.wave;
    if (!stationId || stationId === "user:onyourwave") this.setPrefs({ wave: s });
    const info = await this.wave.start({ stationId: stationId || "user:onyourwave", settings: s, extraSeeds: cleanSeeds(extraSeeds) });
    // another station may have started while this one was launching: don't hand its buffer to this request
    const session = this.wave.session;
    const stale = () => this.wave.session !== session || session?.id !== info.sessionId;
    if (stale()) throw new ApiError("Запуск станции отменён более новым", 409);
    const tracks = await this.wave.next(4);
    if (stale()) throw new ApiError("Запуск станции отменён более новым", 409);
    return { ...info, tracks: this.decorate(tracks), wave: this.wave.info() };
  }

  async waveNext(count = 3) {
    this.requireAuth();
    return { tracks: this.decorate(await this.wave.next(count)), wave: this.wave.info() };
  }

  async waveFeedback({ type, track, playedSeconds }) {
    this.requireAuth();
    await this.wave.feedback(type, track, playedSeconds).catch((e) => this.log("wave feedback failed", e.message));
    return { ok: true };
  }

  waveMeta() {
    return { options: WAVE_SETTINGS, current: this.prefs.wave, info: this.wave.info() };
  }

  // ---------- statistics ----------
  async stats(days = 7, tzOffsetMin = 0, timeZone = null) {
    const s = computeStats(this.playlog.entries, { days, tzOffsetMin, timeZone });
    // load top tracks in full so they can be played right from the statistics
    if (this.account && s.topTracks.length) {
      const full = await this.fullTracks(s.topTracks.map((t) => t.id)).catch(() => []);
      const byId = new Map(this.decorate(full).map((t) => [t.id, t]));
      // couldn't load: keep a minimal playable track from the log instead of dropping it from the top
      s.topTracks = s.topTracks.map((t) => (byId.has(t.id) ? { ...byId.get(t.id), plays: t.plays, seconds: t.seconds } : this.decorate([Service.logTrack(t)])[0]));
    }
    return s;
  }

  /** Track from a log entry in normTrack form, for when full data couldn't be fetched. */
  static logTrack(t) {
    return {
      id: t.id,
      albumId: t.albumId,
      title: t.title,
      artists: t.artists,
      cover: t.cover,
      durationMs: 0,
      available: true,
      explicit: false,
      clean: false,
      version: null,
      album: null,
      lyrics: { sync: false, text: false },
      substituted: null,
      plays: t.plays,
      seconds: t.seconds,
    };
  }

  // ---------- own playlists ----------
  async myPlaylists() {
    this.requireAuth();
    const list = await this.api.userPlaylists(this.api.uid);
    return { playlists: (list || []).map(normPlaylist) };
  }

  async createPlaylist(title, tracks = []) {
    this.requireAuth();
    const name = String(title || "").trim().slice(0, 100) || "Новый плейлист";
    const pl = await this.api.createPlaylist(this.api.uid, name);
    this.cache.delete("home");
    // the playlist is already created: report the add error separately, otherwise a retry creates duplicates
    let addError = null;
    if (tracks.length) {
      try {
        await this.addToPlaylist(pl.kind, tracks);
      } catch (e) {
        addError = e.message;
        this.log("playlist add failed", e.message);
      }
    }
    return { playlist: normPlaylist(pl), addError };
  }

  /** Edits of a single playlist go strictly in order: each takes a fresh revision after the previous one. */
  withPlaylistLock(kind, fn) {
    const key = String(kind);
    const prev = this.playlistLocks.get(key) || Promise.resolve();
    const run = prev.then(fn);
    // one edit's error doesn't break the chain for the following ones
    const tail = run.catch(() => {});
    this.playlistLocks.set(key, tail);
    tail.then(() => {
      if (this.playlistLocks.get(key) === tail) this.playlistLocks.delete(key);
    });
    return run;
  }

  async addToPlaylist(kind, tracks) {
    this.requireAuth();
    const items = tracks.filter((t) => t?.id).map((t) => ({ id: String(t.id), albumId: t.albumId ? String(t.albumId) : undefined }));
    if (!items.length) throw new ApiError("Нечего добавлять", 400);
    return this.withPlaylistLock(kind, async () => {
      const pl = await this.api.playlist(this.api.uid, kind);
      // new tracks go to the end of the playlist, as in the classic client
      const diff = [{ op: "insert", at: pl.trackCount || 0, tracks: items }];
      const r = await this.api.changePlaylist(this.api.uid, kind, pl.revision, diff);
      return { playlist: normPlaylist(r), added: items.length };
    });
  }

  async removeFromPlaylist(kind, track, index) {
    this.requireAuth();
    return this.withPlaylistLock(kind, async () => {
      const pl = await this.api.playlist(this.api.uid, kind);
      // take the position from the current playlist: the on-screen index may be stale
      const at = (pl.tracks || []).findIndex((x, i) => String(x.id) === String(track.id) && (index == null || i === index));
      const pos = at >= 0 ? at : (pl.tracks || []).findIndex((x) => String(x.id) === String(track.id));
      if (pos < 0) throw new ApiError("Трека уже нет в плейлисте", 404);
      const entry = pl.tracks[pos];
      const diff = [{ op: "delete", from: pos, to: pos + 1, tracks: [{ id: String(entry.id), albumId: entry.albumId ? String(entry.albumId) : undefined }] }];
      await this.api.changePlaylist(this.api.uid, kind, pl.revision, diff);
      return { ok: true };
    });
  }

  async deletePlaylist(kind) {
    this.requireAuth();
    return this.withPlaylistLock(kind, async () => {
      await this.api.deletePlaylist(this.api.uid, kind);
      this.cache.delete("home");
      return { ok: true };
    });
  }

  async renamePlaylist(kind, title) {
    this.requireAuth();
    const name = String(title || "").trim().slice(0, 100);
    if (!name) throw new ApiError("Пустое название", 400);
    return this.withPlaylistLock(kind, async () => {
      const r = await this.api.renamePlaylist(this.api.uid, kind, name);
      return { playlist: normPlaylist(r) };
    });
  }
}
