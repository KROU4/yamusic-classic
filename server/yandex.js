// Клиент неофициального API Яндекс Музыки (api.music.yandex.net).
// Эндпоинты и форматы сверены с бандлом официального клиента 5.124.1.
import { fileInfoSign, lyricsSign, nowSeconds } from "./sign.js";

export const API_BASE = "https://api.music.yandex.net";
export const CLIENT_ID = "YandexMusicDesktopAppWindows/5.124.1";

// Порядок как в официальном клиенте: lossless-кодеки первыми
export const CODECS = ["flac", "flac-mp4", "aac-mp4", "he-aac-mp4", "mp3", "aac", "he-aac"];

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class YandexMusic {
  constructor({ token, fetchImpl = globalThis.fetch, base = API_BASE } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
    this.base = base;
    this.uid = null;
  }

  headers(extra = {}) {
    const h = {
      "X-Yandex-Music-Client": CLIENT_ID,
      "Accept-Language": "ru",
      ...extra,
    };
    if (this.token) h.Authorization = `OAuth ${this.token}`;
    return h;
  }

  async request(method, url, { query, json, form, headers, raw = false } = {}) {
    let full = url.startsWith("http") ? url : `${this.base}${url}`;
    if (query) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) q.set(k, String(v));
      const s = q.toString();
      if (s) full += (full.includes("?") ? "&" : "?") + s;
    }
    const init = { method, headers: this.headers(headers) };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers["Content-Type"] = "application/json";
    } else if (form) {
      init.body = new URLSearchParams(form).toString();
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const res = await this.fetch(full, init);
    if (raw) return res;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body?.error?.message || body?.error?.name || `HTTP ${res.status}`;
      throw new ApiError(msg, res.status, body);
    }
    return body && typeof body === "object" && "result" in body ? body.result : body;
  }

  get(url, opts) {
    return this.request("GET", url, opts);
  }
  post(url, opts) {
    return this.request("POST", url, opts);
  }

  // ---- аккаунт ----
  async accountStatus() {
    const r = await this.get("/account/status");
    this.uid = r?.account?.uid ?? null;
    return r;
  }
  accountSettings() {
    return this.get("/account/settings");
  }

  // ---- главная ----
  landing(blocks) {
    return this.get("/landing3", { query: { blocks: blocks.join(",") } });
  }
  chart(id = "") {
    return this.get(`/landing3/chart${id ? `/${id}` : ""}`);
  }
  newReleases() {
    return this.get("/landing3/new-releases");
  }
  newPlaylists() {
    return this.get("/landing3/new-playlists");
  }

  // ---- сущности ----
  tracks(ids) {
    if (!ids.length) return Promise.resolve([]);
    return this.post("/tracks", { form: { "track-ids": ids.join(","), "with-positions": "true" } });
  }
  similar(trackId) {
    return this.get(`/tracks/${trackId}/similar`);
  }
  album(id) {
    return this.get(`/albums/${id}/with-tracks`);
  }
  albums(ids) {
    if (!ids.length) return Promise.resolve([]);
    return this.post("/albums", { form: { "album-ids": ids.join(",") } });
  }
  artist(id) {
    return this.get(`/artists/${id}/brief-info`);
  }
  artistTracks(id, page = 0, pageSize = 50) {
    return this.get(`/artists/${id}/tracks`, { query: { page, "page-size": pageSize } });
  }
  artistAlbums(id, page = 0, pageSize = 50) {
    return this.get(`/artists/${id}/direct-albums`, { query: { page, "page-size": pageSize, "sort-by": "year" } });
  }
  artists(ids) {
    if (!ids.length) return Promise.resolve([]);
    return this.post("/artists", { form: { "artist-ids": ids.join(",") } });
  }
  playlist(uid, kind) {
    return this.get(`/users/${uid}/playlists/${kind}`, { query: { "rich-tracks": "true" } });
  }
  userPlaylists(uid) {
    return this.get(`/users/${uid}/playlists/list`);
  }
  search(text, type = "all", page = 0) {
    return this.get("/search", { query: { text, type, page, nocorrect: "false" } });
  }
  searchSuggest(part) {
    return this.get("/search/suggest", { query: { part } });
  }
  history() {
    return this.get("/music-history", { query: { fullModelsCount: 30 } });
  }

  // ---- коллекция ----
  likedTracks(uid) {
    return this.get(`/users/${uid}/likes/tracks`);
  }
  dislikedTracks(uid) {
    return this.get(`/users/${uid}/dislikes/tracks`);
  }
  likedAlbums(uid) {
    return this.get(`/users/${uid}/likes/albums`, { query: { rich: "true" } });
  }
  likedArtists(uid) {
    return this.get(`/users/${uid}/likes/artists`, { query: { "with-timestamps": "false" } });
  }
  likedPlaylists(uid) {
    return this.get(`/users/${uid}/likes/playlists`);
  }
  setTrackLike(uid, trackId, liked) {
    const action = liked ? "add-multiple" : "remove";
    return this.post(`/users/${uid}/likes/tracks/${action}`, { form: { "track-ids": trackId } });
  }
  setTrackDislike(uid, trackId, disliked) {
    const action = disliked ? "add-multiple" : "remove";
    return this.post(`/users/${uid}/dislikes/tracks/${action}`, { form: { "track-ids": trackId } });
  }

  // ---- воспроизведение ----
  /** Прямая ссылка на аудио. transport=raw отдаёт незашифрованный файл, который браузер играет сам. */
  async fileInfo(trackId, quality = "lossless", codecs = CODECS) {
    const ts = nowSeconds();
    const transports = ["raw"];
    const sign = fileInfoSign({ ts, trackId, quality, codecs, transports });
    const r = await this.get("/get-file-info", {
      query: { ts, trackId, quality, codecs: codecs.join(","), transports: transports.join(","), sign },
    });
    const info = r?.downloadInfo;
    if (!info?.urls?.length && !info?.url) throw new ApiError("Нет ссылки на аудио", 404, r);
    return {
      url: info.urls?.[0] || info.url,
      codec: info.codec,
      bitrate: info.bitrate,
      quality: info.quality,
      gain: info.gain || false,
    };
  }

  async lyrics(trackId, format = "LRC") {
    const ts = nowSeconds();
    const r = await this.get(`/tracks/${trackId}/lyrics`, {
      query: { format, timeStamp: ts, sign: lyricsSign({ trackId, ts }) },
    });
    if (!r?.downloadUrl) return null;
    const res = await this.fetch(r.downloadUrl);
    if (!res.ok) return null;
    return { text: await res.text(), format, writers: r.writers || [], major: r.major?.prettyName || null };
  }

  /** Отчёт о прослушивании — без него Яндекс не видит историю и рекомендации деградируют. */
  playAudio({ trackId, albumId, from, playId, totalPlayedSeconds, endPositionSeconds, trackLengthSeconds, uid }) {
    const now = new Date().toISOString();
    return this.post("/play-audio", {
      form: {
        "track-id": trackId,
        "album-id": albumId || "",
        from: from || "desktop_win-own_tracks-track-default",
        "play-id": playId,
        uid: uid || this.uid,
        timestamp: now,
        "client-now": now,
        "from-cache": "false",
        "track-length-seconds": trackLengthSeconds,
        "total-played-seconds": totalPlayedSeconds,
        "end-position-seconds": endPositionSeconds,
      },
    });
  }

  // ---- волна (rotor) ----
  waveSettings() {
    return this.get("/rotor/wave/settings");
  }
  stationsList() {
    return this.get("/rotor/stations/list", { query: { language: "ru" } });
  }
  stationsDashboard() {
    return this.get("/rotor/stations/dashboard");
  }
  sessionNew({ seeds, queue = [], allowExplicit = true, aiReduced = false }) {
    return this.post("/rotor/session/new", {
      json: { seeds, queue, includeTracksInResponse: true, allowExplicit },
      headers: aiReduced ? { "X-Yandex-Music-AI-Content-Rate": "reduced" } : undefined,
    });
  }
  sessionTracks(sessionId, { queue = [], aiReduced = false } = {}) {
    return this.post(`/rotor/session/${sessionId}/tracks`, {
      json: { queue },
      headers: aiReduced ? { "X-Yandex-Music-AI-Content-Rate": "reduced" } : undefined,
    });
  }
  sessionFeedback(sessionId, batchId, event) {
    return this.post(`/rotor/session/${sessionId}/feedback/`, { json: { event, batchId } });
  }
}
