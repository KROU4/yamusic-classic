// Прикладной слой: всё, что интерфейс может попросить у бэкенда.
import path from "node:path";
import crypto from "node:crypto";
import { YandexMusic, ApiError } from "./yandex.js";
import { resolveSession } from "./token.js";
import { JsonStore, PlayHistory } from "./store.js";
import { normTrack, normAlbum, normArtist, normPlaylist, normStation, coverUrl } from "./normalize.js";
import { DEFAULT_CURATION, songKey } from "./curate.js";
import { WaveManager, WAVE_SETTINGS } from "./wave.js";
import { Uncensor } from "./uncensor.js";
import { getLyrics } from "./lyrics.js";

export const DEFAULT_PREFS = {
  allowExplicit: true, // не просить у волны «чистую» выдачу
  uncensor: true, // подставлять оригинал вместо подменённого/clean-трека
  aiReduced: true, // меньше ИИ-музыки в волне (заголовок как в официальном клиенте)
  quality: "lossless",
  lyricsPrefer: "auto",
  curation: DEFAULT_CURATION,
  wave: { diversity: "default", moodEnergy: "all", language: "any" },
  theme: "dark",
  volume: 0.8,
  crossfade: 0,
};

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class Service {
  constructor({ dataDir, fetchImpl = globalThis.fetch, log = () => {} }) {
    this.fetch = fetchImpl;
    this.log = log;
    this.store = new JsonStore(path.join(dataDir, "state.json"), { prefs: DEFAULT_PREFS });
    this.history = new PlayHistory(this.store);
    this.api = new YandexMusic({ fetchImpl });
    this.account = null;
    this.sessionSource = null;
    this.library = { liked: new Set(), disliked: new Set(), loadedAt: 0 };
    this.uncensor = new Uncensor(this.api, this.store);
    this.wave = new WaveManager({
      api: this.api,
      history: this.history,
      getLibrary: () => this.library,
      getPrefs: () => this.prefs,
      log,
    });
    this.cache = new Map();
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
    return next;
  }

  // ---------- сессия ----------
  async init() {
    const validate = async (token) => {
      const probe = new YandexMusic({ token, fetchImpl: this.fetch });
      const st = await probe.accountStatus();
      return st?.account?.uid ? st : null;
    };
    const found = await resolveSession({ validate });
    if (!found) {
      this.account = null;
      return { authorized: false };
    }
    this.api.token = found.token;
    this.api.uid = found.account.account.uid;
    this.account = found.account;
    this.sessionSource = found.source;
    const settings = await this.api.accountSettings().catch(() => null);
    if (settings && this.store.get("prefs")?.aiReduced === undefined) {
      this.setPrefs({ aiReduced: settings.aiContentReductionEnabled !== false });
    }
    this.refreshLibrary().catch((e) => this.log("library refresh failed", e.message));
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
      avatar: this.account.defaultEmail ? null : null,
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
    return tracks.map((t) => ({ ...t, liked: this.library.liked.has(t.id), disliked: this.library.disliked.has(t.id) }));
  }

  // ---------- главная ----------
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

  // ---------- сущности ----------
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
    let tracks = (r.tracks || []).map((x) => normTrack(x.track)).filter(Boolean);
    // rich-tracks иногда возвращает только id — догружаем
    const missing = (r.tracks || []).filter((x) => !x.track).map((x) => x.id);
    if (missing.length) tracks = tracks.concat(await this.fullTracks(missing));
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

  // ---------- воспроизведение ----------
  async resolvePlay(track) {
    this.requireAuth();
    const prefs = this.prefs;
    const actual = await this.uncensor.resolve(track, { enabled: prefs.uncensor });
    const stream = await this.api.fileInfo(actual.id, prefs.quality);
    return { track: this.decorate([actual])[0], stream };
  }

  async lyrics(track) {
    this.requireAuth();
    return (await getLyrics(this.api, track, { prefer: this.prefs.lyricsPrefer, fetchImpl: this.fetch })) || { source: null, synced: false, lines: [], plain: "" };
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

  /** Трек доигран или пропущен: локальная история (анти-повтор) + отчёт Яндексу. */
  async played({ track, from, playedSeconds, durationSeconds, playId }) {
    this.requireAuth();
    // в историю анти-повтора попадает и пропущенное: раз трек промотали, слышать его снова скоро не хочется
    if (playedSeconds >= 3) this.history.record(track, songKey(track));
    await this.api
      .playAudio({
        trackId: track.id,
        albumId: track.albumId,
        from,
        playId: playId || crypto.randomUUID(),
        totalPlayedSeconds: Math.round(playedSeconds),
        endPositionSeconds: Math.round(playedSeconds),
        trackLengthSeconds: Math.round(durationSeconds),
      })
      .catch((e) => this.log("play-audio failed", e.message));
    return { ok: true };
  }

  // ---------- волна ----------
  async waveStart({ stationId, settings }) {
    this.requireAuth();
    const s = settings || this.prefs.wave;
    if (!stationId || stationId === "user:onyourwave") this.setPrefs({ wave: s });
    const info = await this.wave.start({ stationId: stationId || "user:onyourwave", settings: s });
    const tracks = await this.wave.next(4);
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
}
