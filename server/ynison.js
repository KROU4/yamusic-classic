// Ynison: Yandex Music's cross-device playback sync ("play on another device", phone as a remote).
// Two WebSocket hops: the redirector hands out a state-service host and a one-time ticket, the state service
// then streams the account's full shared state (devices, active device, queue, playing status) as JSON frames.
// Protocol notes and what is verified live: see the spec referenced in docs; message shapes follow the official
// client 5.124.1 and the open implementations (MarshalX/yandex-music-api, ma-provider-yandex-ynison).
// The OAuth token travels in the handshake subprotocol: nothing here ever logs headers, tickets or frames.
import os from "node:os";
import crypto from "node:crypto";
import { WsClient } from "./wsclient.js";
import { ApiError } from "./yandex.js";

export const REDIRECTOR_URL = "wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison";
export const STATE_PATH = "/ynison_state.YnisonStateService/PutYnisonState";
export const ORIGIN = "https://music.yandex.ru"; // the redirector answers 403 without it (verified)
// Same identity as the API client (CLIENT_ID in yandex.js): this exact Device-Info is the one verified live
export const APP_NAME = "Desktop";
export const APP_VERSION = "5.124.1";
export const DEVICE_INFO = JSON.stringify({ app_name: APP_NAME, app_version: APP_VERSION, type: 1 });
const DEVICE_TYPE = "WEB_DESKTOP";
// status author the server uses when it paused playback because the active device went away (per MA, unverified)
export const SERVER_PAUSED = "server-paused-on-active-device-disconnecting";
const DEFAULT_LADDER = [1000, 5000, 30000]; // official connector's reconnect steps
const IDLE_RETRY_MS = 5 * 60 * 1000; // after the ladder: keep trying, but slowly
const MAX_ATTEMPTS = 12; // hard cap on failed attempts in a row, so a broken setup can't hammer the redirector
const IMMEDIATE_CODES = new Set(["300100001", "300100002"]); // rebalanced / not served: reconnect right away
const WINDOW = 100; // the official client sends at most 200 playables: -100..+100 around the current one
const CONNECT_TIMEOUT_MS = 15000;

// ---------- pure protocol helpers (unit-tested) ----------

/** Random int63 as a decimal string: 2^63 itself overflows int64, and Number loses precision. */
export function randomVersion() {
  const b = crypto.randomBytes(8);
  b[0] &= 0x7f;
  return b.readBigUInt64BE(0).toString();
}

/** int64 fields go out as strings (proto3 JSON): MA reports HTTP 500 for numeric progress/version fields. */
export const makeVersion = (deviceId, now = Date.now()) => ({ device_id: deviceId, version: randomVersion(), timestamp_ms: String(Math.max(0, Math.round(now))) });

/** 19-digit session id the client invents for the redirector hop (the hub uses the one the redirector returns). */
export function newSessionId() {
  const digits = crypto.randomInt(1, 10) + Array.from({ length: 18 }, () => crypto.randomInt(0, 10)).join("");
  return digits;
}

/** Handshake fields for the Sec-WebSocket-Protocol JSON, as the official client builds them. */
export function authFields({ deviceId, token, ticket, sessionId }) {
  const h = { "Ynison-Device-Id": deviceId, "Ynison-Device-Info": DEVICE_INFO };
  if (ticket) h["Ynison-Redirect-Ticket"] = ticket;
  if (sessionId) h["Ynison-Session-Id"] = String(sessionId);
  h.authorization = `OAuth ${token}`;
  return h;
}

export const subprotocols = (fields) => ["Bearer", "v2", encodeURIComponent(JSON.stringify(fields))];

/** Request envelope: exactly one oneof body plus rid / action time / interception mode. */
export function envelope(body, { now = Date.now(), interception = "DO_NOT_INTERCEPT_BY_DEFAULT", initial = false, rid = crypto.randomUUID() } = {}) {
  return { ...body, rid, player_action_timestamp_ms: initial ? "0" : String(Math.round(now)), activity_interception_type: interception };
}

/** Empty paused state with zero-time versions: loses every merge, so it never overrides what another device plays. */
export function emptyPlayerState(deviceId) {
  return {
    player_queue: {
      current_playable_index: -1,
      entity_id: "",
      entity_type: "VARIOUS",
      playable_list: [],
      options: { repeat_mode: "NONE" },
      shuffle_optional: null,
      entity_context: "BASED_ON_ENTITY_BY_DEFAULT",
      version: makeVersion(deviceId, 0),
      from_optional: "",
      initial_entity_optional: null,
      adding_options_optional: null,
      queue: null,
    },
    status: { duration_ms: "0", paused: true, playback_speed: 1, progress_ms: "0", version: makeVersion(deviceId, 0) },
    player_queue_inject_optional: null,
  };
}

export function deviceBlock({ deviceId, title, volume = 0.5 }) {
  const v = Math.max(0, Math.min(1, Number(volume) || 0));
  return {
    volume: v,
    // a player (the phone can hand playback to us) and a remote (we can steer the phone)
    capabilities: { can_be_player: true, can_be_remote_controller: true, volume_granularity: 20 },
    info: { app_name: APP_NAME, app_version: APP_VERSION, title, device_id: deviceId, type: DEVICE_TYPE },
    volume_info: { volume: v, version: null },
    // not a shadow/spectator: shadow devices are invisible as players and ignore incoming state
    is_shadow: false,
  };
}

/**
 * First message after every (re)connect — the server drops the connection if anything else comes first (verified).
 * Always a fresh empty state and is_currently_active:false, never a replay of stored state: MA saw replays pause
 * the playing device. If we were active, the server pauses on our disconnect and the UI re-intercepts if needed.
 */
export function fullStateMessage({ deviceId, title, volume }, opts = {}) {
  return envelope(
    {
      update_full_state: {
        player_state: emptyPlayerState(deviceId),
        device: deviceBlock({ deviceId, title, volume }),
        is_currently_active: false,
        sync_state_from_eov_optional: null,
      },
    },
    { ...opts, initial: true },
  );
}

const ms = (v) => Math.max(0, Math.round(Number(v) || 0));

export function playingStatus({ deviceId, paused, progressMs, durationMs, speed = 1, now = Date.now() }) {
  return { progress_ms: String(ms(progressMs)), duration_ms: String(ms(durationMs)), paused: !!paused, playback_speed: Number(speed) || 1, version: makeVersion(deviceId, now) };
}

export const playingStatusMessage = (status, opts = {}) => envelope({ update_playing_status: { playing_status: status } }, opts);
export const playerStateMessage = (playerState, opts = {}) => envelope({ update_player_state: { player_state: playerState } }, opts);
export const activeDeviceMessage = (deviceId, opts = {}) => envelope({ update_active_device: { device_id_optional: deviceId || null } }, opts);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Order in which the queue plays: shuffle indices when they match the list, else 0..n-1. */
export function playOrder(queue) {
  const n = queue?.playable_list?.length || 0;
  const idx = queue?.shuffle_optional?.playable_indices;
  if (Array.isArray(idx) && idx.length === n) return idx.map(Number);
  return Array.from({ length: n }, (_, i) => i);
}

/** Neighbour of the current playable in play order (shuffle-aware, wraps with repeat ALL); -1 when there is none. */
export function neighborIndex(queue, dir) {
  const order = playOrder(queue);
  const pos = order.indexOf(Number(queue?.current_playable_index));
  if (pos < 0 || !order.length) return -1;
  let p = pos + (dir < 0 ? -1 : 1);
  if (p < 0 || p >= order.length) {
    if (queue?.options?.repeat_mode !== "ALL") return -1;
    p = (p + order.length) % order.length;
  }
  return order[p];
}

/**
 * Extrapolated progress. Anchored at the status version's time, but never later than when we first saw it,
 * so a device with a fast clock can't push progress into the future; a zero version uses the receive time.
 */
export function progressAt(status, anchorAt, now = Date.now()) {
  if (!status) return 0;
  const p = num(status.progress_ms);
  const d = num(status.duration_ms);
  if (status.paused) return p;
  const ts = num(status.version?.timestamp_ms);
  const base = ts > 0 ? Math.min(ts, anchorAt || ts) : anchorAt || now;
  const v = p + Math.max(0, now - base) * (num(status.playback_speed) || 1);
  return d > 0 ? Math.min(v, d) : v;
}

/** Merge a broadcast into the retained state: it's a full state, but missing top-level keys keep their old value. */
export function mergeFrame(prev, frame) {
  const next = { ...prev };
  const ps = frame?.player_state;
  if (ps && typeof ps === "object") {
    const merged = { ...(prev.player_state || {}) };
    for (const k of Object.keys(ps)) merged[k] = ps[k]; // sub-objects are replaced whole, never deep-merged
    next.player_state = merged;
  }
  if ("devices" in (frame || {})) next.devices = Array.isArray(frame.devices) ? frame.devices : [];
  if ("active_device_id_optional" in (frame || {})) next.active = frame.active_device_id_optional || "";
  else if (ps?.status?.version?.device_id === SERVER_PAUSED) next.active = "";
  if (frame?.timestamp_ms != null) next.timestamp = String(frame.timestamp_ms);
  return next;
}

const versionKey = (v) => (v ? `${v.device_id || ""}:${v.version ?? ""}:${v.timestamp_ms ?? ""}` : "");

/** API track id of a playable, or null for local files, videos and other non-catalogue items. */
export function trackRef(p) {
  if (!p || (p.playable_type && p.playable_type !== "TRACK")) return null;
  const id = String(p.playable_id ?? "");
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const albumId = p.album_id_optional != null && /^\d+$/.test(String(p.album_id_optional)) ? String(p.album_id_optional) : null;
  return { id, albumId };
}

/** Yandex "avatars…/%%" cover template to an https URL of the given size; anything else is dropped. */
export function coverFromTemplate(uri, size = 200) {
  if (typeof uri !== "string" || !uri) return null;
  const u = uri.replace("%%", `${size}x${size}`);
  const full = u.startsWith("http") ? u : `https://${u}`;
  return /^https:\/\/[\w.-]+\.(yandex\.net|yandex\.ru|yastatic\.net)\//.test(full) ? full : null;
}

/** Our cover URL ("https://…/200x200") back to the template form playables carry. */
export function coverToTemplate(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  return url.replace(/^https:\/\//, "").replace(/\d+x\d+$/, "%%");
}

const DEVICE_RANK = (d) => (d.active ? 0 : d.me ? 1 : d.offline ? 3 : 2);

/** Compact view for the UI: devices, who plays, what plays, where. */
export function summarize(state, { me, now = Date.now(), anchorAt, details } = {}) {
  const active = state.active || "";
  const devices = (state.devices || [])
    .filter((d) => d?.info?.device_id)
    .map((d) => ({
      id: String(d.info.device_id),
      title: String(d.info.title || d.info.app_name || "Устройство").slice(0, 80),
      type: String(d.info.type || "UNSPECIFIED"),
      app: String(d.info.app_name || "").slice(0, 40),
      offline: !!d.is_offline,
      canPlay: d.capabilities?.can_be_player !== false,
      me: d.info.device_id === me,
      active: !!active && d.info.device_id === active,
    }))
    .sort((a, b) => DEVICE_RANK(a) - DEVICE_RANK(b));
  const q = state.player_state?.player_queue || null;
  const st = state.player_state?.status || null;
  const list = q?.playable_list || [];
  const index = Number.isInteger(Number(q?.current_playable_index)) ? Number(q.current_playable_index) : -1;
  const cur = list[index] || null;
  const ref = trackRef(cur);
  const extra = ref ? details?.get(ref.id) : null;
  const track = cur
    ? {
        id: ref?.id || null,
        albumId: ref?.albumId || null,
        title: extra?.title || String(cur.title || ""),
        artists: extra?.artists || [],
        cover: extra?.cover || coverFromTemplate(cur.cover_url_optional),
        playable: !!ref,
      }
    : null;
  return {
    me,
    active: active || null,
    activeIsMe: !!active && active === me,
    activeDevice: devices.find((d) => d.active) || null,
    devices,
    track,
    index,
    ids: list.map((p) => trackRef(p)?.id || null),
    entityType: q?.entity_type || null,
    entityId: q?.entity_id || null,
    repeat: q?.options?.repeat_mode || "NONE",
    paused: st ? !!st.paused : true,
    progressMs: Math.round(progressAt(st, anchorAt, now)),
    durationMs: num(st?.duration_ms),
    speed: num(st?.playback_speed) || 1,
    queueVer: { author: q?.version?.device_id || "", key: versionKey(q?.version) },
    statusVer: { author: st?.version?.device_id || "", key: versionKey(st?.version) },
    at: now,
  };
}

/** Error frame from either hop: the redirector puts directives in extra_headers, the hub in details. */
export function parseError(err) {
  const details = { ...(err?.extra_headers || {}), ...(err?.details || {}) };
  const code = String(details["ynison-error-code"] || "");
  const goAway = Number(details["ynison-go-away-for-seconds"]);
  const ladder = typeof details["ynison-backoff-millis"] === "string"
    ? [...new Set(details["ynison-backoff-millis"].split(":").map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 0))].sort((a, b) => a - b)
    : [];
  const httpCode = Number(err?.http_code) || 0;
  const grpcCode = Number(err?.grpc_code) || 0;
  let retry = "backoff";
  // bad token, or a 4xx-class code (e.g. 400090001: the same device id connected elsewhere) — retrying only fights
  if ((grpcCode === 16 && httpCode === 401) || httpCode === 401 || httpCode === 403 || code.startsWith("4")) retry = "never";
  else if (IMMEDIATE_CODES.has(code)) retry = "immediate";
  return { code, httpCode, grpcCode, goAwayMs: Number.isFinite(goAway) && goAway > 0 ? goAway * 1000 : 0, ladder, retry, message: String(err?.message || "").slice(0, 200) };
}

/** Reconnect schedule: server go-away > server ladder > default ladder > slow idle retries; capped in total. */
export class ReconnectPolicy {
  constructor({ ladder = DEFAULT_LADDER, idleMs = IDLE_RETRY_MS, maxAttempts = MAX_ATTEMPTS } = {}) {
    this.defaults = ladder;
    this.idleMs = idleMs;
    this.maxAttempts = maxAttempts;
    this.onHealthy();
  }

  onHealthy() {
    this.attempt = 0; // failed attempts in a row, for the hard cap
    this.step = 0; // position on the backoff ladder
    this.ladder = null;
    this.goAwayMs = 0;
    this.immediate = false;
    this.stopped = false;
    this.lastImmediate = false;
  }

  onError(info) {
    if (info.retry === "never") this.stopped = true;
    if (info.goAwayMs) this.goAwayMs = info.goAwayMs;
    if (info.ladder?.length) this.ladder = info.ladder;
    if (info.retry === "immediate") this.immediate = true;
  }

  /** Milliseconds to wait before the next attempt, or null to give up until the user retries. */
  next() {
    if (this.stopped) return null;
    this.attempt += 1;
    if (this.attempt > this.maxAttempts) return null;
    if (this.goAwayMs) {
      const d = this.goAwayMs;
      this.goAwayMs = 0;
      this.step = 0; // after the server's window the ladder starts over
      return d;
    }
    // one immediate retry per error streak: two rebalances in a row fall back to the ladder
    if (this.immediate && !this.lastImmediate) {
      this.immediate = false;
      this.lastImmediate = true;
      return 0;
    }
    this.immediate = false;
    const ladder = this.ladder || this.defaults;
    const step = this.step++;
    return step < ladder.length ? ladder[step] : this.idleMs;
  }
}

/** Entity of a local playback context, as player_queue entity fields. */
export function entityOf(context) {
  if (context?.type === "wave" || context?.resumeWave) {
    const id = String(context.stationId || "user:onyourwave");
    return { entity_type: "RADIO", entity_id: /^[\w.-]+:[\w.-]+$/.test(id) ? id : "user:onyourwave" };
  }
  const link = String(context?.link || "");
  let m;
  if ((m = /^\/album\/(\d+)$/.exec(link))) return { entity_type: "ALBUM", entity_id: m[1] };
  if ((m = /^\/artist\/(\d+)$/.exec(link))) return { entity_type: "ARTIST", entity_id: m[1] };
  if ((m = /^\/playlist\/([\w.-]+)\/(\d+)$/.exec(link))) return { entity_type: "PLAYLIST", entity_id: `${m[1]}:${m[2]}` };
  return { entity_type: "VARIOUS", entity_id: "" };
}

const REPEAT = { none: "NONE", all: "ALL", one: "ONE" };

/**
 * Shared player_state for what we play locally. Our queue is already in play order (shuffle reorders the list
 * itself), so shuffle_optional stays null; only a ±100 window around the current track is sent.
 */
export function localPlayerState(local, { deviceId, now = Date.now() }) {
  const tracks = Array.isArray(local?.tracks) ? local.tracks : [];
  const index = Math.max(0, Math.min(tracks.length - 1, Number(local?.index) || 0));
  const start = Math.max(0, index - WINDOW);
  const win = tracks.slice(start, index + WINDOW);
  const from = typeof local?.context?.from === "string" && local.context.from ? local.context.from.slice(0, 120) : "desktop_win-own_tracks-track-default";
  const entity = entityOf(local?.context);
  return {
    player_queue: {
      current_playable_index: win.length ? index - start : -1,
      ...entity,
      entity_context: "BASED_ON_ENTITY_BY_DEFAULT",
      playable_list: win.map((t) => ({
        playable_id: String(t.id),
        album_id_optional: t.albumId ? String(t.albumId) : null,
        playable_type: "TRACK",
        from,
        title: String(t.title || "").slice(0, 200),
        cover_url_optional: coverToTemplate(t.cover),
      })),
      options: { repeat_mode: REPEAT[local?.repeat] || "NONE" },
      shuffle_optional: null,
      from_optional: from,
      initial_entity_optional: null,
      adding_options_optional: null,
      queue: null,
      version: makeVersion(deviceId, now),
    },
    status: playingStatus({ deviceId, paused: !local?.playing, progressMs: local?.positionMs, durationMs: local?.durationMs, speed: local?.rate, now }),
    player_queue_inject_optional: null,
  };
}

/** Next/previous on another device: full queue copy with the neighbour index, status reset to 0 (as receivers expect). */
export function stepPlayerState(playerState, dir, { deviceId, now = Date.now() }) {
  const q = playerState?.player_queue;
  const i = neighborIndex(q, dir);
  if (i < 0) return null;
  const st = playerState.status || {};
  return {
    player_queue: { ...q, current_playable_index: i, version: makeVersion(deviceId, now) },
    status: playingStatus({ deviceId, paused: !!st.paused, progressMs: 0, durationMs: 0, speed: st.playback_speed, now }),
    player_queue_inject_optional: playerState.player_queue_inject_optional ?? null,
  };
}

// ---------- connection ----------

/**
 * One account session: redirector -> state service, keep-alive pings, reconnects with backoff.
 * emits via onChange() after every state/status change.
 */
export class YnisonClient {
  constructor({ getToken, deviceId, title, volume = 0.5, redirectorUrl = REDIRECTOR_URL, hubHost = null, wsFactory = (url, o) => new WsClient(url, o), onChange = () => {}, log = () => {}, policy = new ReconnectPolicy(), minKeepAliveS = 5 }) {
    this.minKeepAliveS = minKeepAliveS; // floor for server-sent keep-alive values (tests lower it)
    this.getToken = getToken;
    this.deviceId = deviceId;
    this.title = title;
    this.volume = volume;
    this.redirectorUrl = redirectorUrl;
    this.hubHost = hubHost; // host:port the redirector may point to (local mock only); null = *.ynison.music.yandex.ru
    this.wsFactory = wsFactory;
    this.onChange = onChange;
    this.log = log;
    this.policy = policy;
    this.state = { player_state: null, devices: [], active: "", timestamp: null };
    this.status = "off"; // off | connecting | online | waiting | stopped
    this.error = null;
    this.ws = null;
    this.wanted = false;
    this.timers = new Set();
    this.statusAnchor = { key: "", at: 0 };
    this.gen = 0;
  }

  setStatus(status, error = this.error) {
    this.status = status;
    this.error = error;
    this.onChange();
  }

  later(fn, delay) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, delay);
    t.unref?.();
    this.timers.add(t);
    return t;
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.policy.onHealthy();
    this.connect();
  }

  stop() {
    this.wanted = false;
    this.gen++;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close(1000, "[CLIENT-REASON] disabled");
      } catch {
        // already gone
      }
    }
    this.state = { player_state: null, devices: [], active: "", timestamp: null };
    this.setStatus("off", null);
  }

  /** Redirector hop: one frame with host + ticket, then the server closes. */
  redirect(token) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = this.wsFactory(this.redirectorUrl, {
        protocols: subprotocols(authFields({ deviceId: this.deviceId, token, sessionId: newSessionId() })),
        headers: { Origin: ORIGIN },
      });
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close(1000, "[CLIENT-REASON] redirect received");
        } catch {
          // closed by the server already
        }
        fn(v);
      };
      const timer = setTimeout(() => finish(reject, new Error("redirector timeout")), CONNECT_TIMEOUT_MS);
      timer.unref?.();
      ws.on("error", (e) => finish(reject, Object.assign(new Error(`redirector: ${e.message}`), { status: e.status })));
      ws.on("close", () => finish(reject, new Error("redirector closed without an answer")));
      ws.on("message", (data, binary) => {
        if (binary) return;
        try {
          finish(resolve, JSON.parse(data));
        } catch {
          finish(reject, new Error("redirector sent invalid JSON"));
        }
      });
    });
  }

  validHost(host) {
    if (typeof host !== "string") return false;
    if (this.hubHost) return host === this.hubHost;
    return /^[a-z0-9-]{1,63}\.ynison\.music\.yandex\.ru$/i.test(host);
  }

  async connect() {
    const gen = ++this.gen;
    const token = this.getToken();
    if (!token) return this.setStatus("stopped", "Нет сессии Яндекс Музыки");
    this.setStatus("connecting", null);
    let redir;
    try {
      redir = await this.redirect(token);
    } catch (e) {
      if (gen !== this.gen) return;
      this.log("ynison redirector failed:", e.message);
      if (e.status === 401 || e.status === 403) this.policy.onError({ retry: "never" });
      return this.retry("Не удалось подключиться к Ynison");
    }
    if (gen !== this.gen) return;
    if (redir?.error) {
      const info = parseError(redir.error);
      this.log("ynison redirector error:", info.code || info.httpCode || "?");
      this.policy.onError(info);
      return this.retry(info.retry === "never" ? "Яндекс отклонил подключение Ynison" : "Ynison временно недоступен");
    }
    if (!this.validHost(redir?.host) || !redir?.redirect_ticket) {
      this.log("ynison redirector: unexpected answer");
      return this.retry("Неожиданный ответ Ynison");
    }
    const keep = redir.keep_alive_params || {};
    const pingMs = Math.max(this.minKeepAliveS, num(keep.keep_alive_time_seconds) || 60) * 1000;
    const pongMs = Math.max(this.minKeepAliveS, num(keep.keep_alive_timeout_seconds) || 30) * 1000;
    const scheme = new URL(this.redirectorUrl).protocol; // wss: in production, ws: only for the local mock
    const ws = this.wsFactory(`${scheme}//${redir.host}${STATE_PATH}`, {
      protocols: subprotocols(authFields({ deviceId: this.deviceId, token, ticket: redir.redirect_ticket, sessionId: redir.session_id })),
      headers: { Origin: ORIGIN },
    });
    this.ws = ws;
    let pingTimer = null;
    let pongTimer = null;
    let serverDirective = false;
    let healthy = false;
    const alive = () => {
      clearTimeout(pongTimer);
      pongTimer = null;
    };
    ws.on("open", () => {
      if (gen !== this.gen) return ws.close(1000, "[CLIENT-REASON] stale");
      ws.send(JSON.stringify(fullStateMessage({ deviceId: this.deviceId, title: this.title, volume: this.volume })));
      // our own pings: the server's keep-alive window is 60 s + 30 s, and a silent idle hub would otherwise look dead
      pingTimer = setInterval(() => {
        if (pongTimer) return;
        ws.ping();
        pongTimer = setTimeout(() => ws.terminate(), pongMs);
        pongTimer.unref?.();
      }, pingMs);
      pingTimer.unref?.();
    });
    ws.on("pong", alive);
    ws.on("error", (e) => {
      this.log("ynison socket:", e.message);
      if (e.status === 401 || e.status === 403) this.policy.onError({ retry: "never" });
    });
    ws.on("message", (data, binary) => {
      alive();
      if (binary || gen !== this.gen) return;
      let frame;
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      if (frame.error) {
        const info = parseError(frame.error);
        serverDirective = true;
        this.log("ynison error frame:", info.code || info.httpCode || "?");
        this.policy.onError(info);
        this.error = info.code === "400090001" ? "Это устройство подключено к Ynison в другом окне" : info.retry === "never" ? "Яндекс отклонил подключение Ynison" : "Ynison временно недоступен";
        return ws.close(1000, "[CLIENT-REASON] server error");
      }
      if (!healthy) {
        healthy = true;
        this.policy.onHealthy();
      }
      this.apply(frame);
    });
    ws.on("close", () => {
      clearInterval(pingTimer);
      alive();
      if (this.ws === ws) this.ws = null;
      if (gen !== this.gen || !this.wanted) return;
      if (!serverDirective && !healthy) this.policy.onError({ retry: "backoff" });
      this.state = { ...this.state, active: "" };
      this.retry(this.error || "Соединение с Ynison потеряно");
    });
  }

  retry(message) {
    if (!this.wanted) return;
    const delay = this.policy.next();
    if (delay == null) return this.setStatus("stopped", message);
    this.setStatus("waiting", message);
    this.later(() => this.wanted && this.connect(), delay);
  }

  apply(frame, now = Date.now()) {
    this.state = mergeFrame(this.state, frame);
    const st = this.state.player_state?.status;
    const key = versionKey(st?.version) + `|${st?.progress_ms}|${st?.paused}`;
    if (key !== this.statusAnchor.key) this.statusAnchor = { key, at: now };
    this.status = "online";
    this.error = null;
    this.onChange();
  }

  view(details, now = Date.now()) {
    return summarize(this.state, { me: this.deviceId, now, anchorAt: this.statusAnchor.at, details });
  }

  send(msg) {
    if (this.status !== "online" || !this.ws || this.ws.readyState !== 1) throw new ApiError("Нет соединения с Ynison", 409);
    this.ws.send(JSON.stringify(msg));
    return { ok: true, rid: msg.rid };
  }
}

// ---------- service glue ----------

const ACTIONS = new Set(["toggle", "play", "pause", "next", "prev", "seek"]);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

/** Local playback snapshot from the UI, coerced to a strict shape before it becomes a shared queue. */
export function sanitizeLocal(b) {
  const tracks = (Array.isArray(b?.tracks) ? b.tracks : [])
    .slice(0, 400)
    .filter((t) => t && /^[\w-]{1,64}$/.test(String(t.id)))
    .map((t) => ({ id: String(t.id), albumId: /^\d+$/.test(String(t.albumId ?? "")) ? String(t.albumId) : null, title: str(t.title, 200), cover: str(t.cover, 300) || null }));
  const ctx = b?.context && typeof b.context === "object" ? b.context : {};
  return {
    tracks,
    index: Math.max(0, Math.min(tracks.length - 1, Math.floor(num(b?.index)))),
    context: { type: str(ctx.type, 16), stationId: str(ctx.stationId, 80), link: str(ctx.link, 120), from: str(ctx.from, 120), resumeWave: !!ctx.resumeWave },
    repeat: ["none", "all", "one"].includes(b?.repeat) ? b.repeat : "none",
    playing: !!b?.playing,
    positionMs: ms(b?.positionMs),
    durationMs: ms(b?.durationMs),
    rate: Math.max(0.5, Math.min(2, num(b?.rate) || 1)),
  };
}

/** Owns the client for the Service: follows the setting, keeps the device id, serves the UI routes. */
export class YnisonManager {
  constructor(svc, { env = process.env, wsFactory } = {}) {
    this.svc = svc;
    this.env = env;
    this.wsFactory = wsFactory;
    this.client = null;
    this.rev = 0;
    this.waiters = new Set();
    this.details = new Map(); // track id -> { title, artists, cover } for the remote "now playing"
    this.pendingDetails = new Set();
    // local mock override for smoke runs and manual protocol tests; only loopback hosts, never a real server
    const o = env.YMC_YNISON_URL ? new URL(env.YMC_YNISON_URL) : null;
    this.override = o && o.protocol === "ws:" && ["127.0.0.1", "localhost"].includes(o.hostname) ? o : null;
    // smoke runs are silent and isolated: no live Ynison unless pointed at a local mock
    this.blocked = env.YMC_NO_REPORT === "1" && !this.override;
  }

  get enabled() {
    return !!this.svc.prefs.ynison;
  }

  deviceId() {
    let id = this.svc.store.get("ynisonDeviceId");
    // our own persistent id: reusing the official app's id would kick it off (one live connection per id)
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) {
      id = crypto.randomUUID();
      this.svc.store.set("ynisonDeviceId", id);
    }
    return id;
  }

  bump() {
    this.rev += 1;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  /** Start or stop the connection to match the setting and the session. */
  sync() {
    const want = this.enabled && !!this.svc.account && !this.blocked;
    if (want && !this.client) {
      this.client = new YnisonClient({
        getToken: () => this.svc.api.token,
        deviceId: this.deviceId(),
        title: `YM Classic — ${os.hostname()}`.slice(0, 60),
        volume: this.svc.prefs.volume,
        redirectorUrl: this.override ? this.override.href : REDIRECTOR_URL,
        hubHost: this.override ? this.override.host : null,
        wsFactory: this.wsFactory,
        onChange: () => this.bump(),
        log: this.svc.log,
      });
      this.client.start();
    } else if (!want && this.client) {
      const c = this.client;
      this.client = null;
      c.stop();
    }
    this.bump();
  }

  /** User asked to try again after the client gave up. */
  reconnect() {
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
    this.sync();
    return this.view();
  }

  stop() {
    this.client?.stop();
    this.client = null;
  }

  view() {
    const base = { enabled: this.enabled, rev: this.rev, blocked: this.blocked };
    if (!this.client) return { ...base, status: "off", error: this.blocked && this.enabled ? "В тестовом режиме Ynison отключён" : null, devices: [], track: null };
    const v = this.client.view(this.details);
    if (v.track?.id && !v.track.artists.length) this.loadDetails(v.track.id);
    return { ...base, status: this.client.status, error: this.client.error, ...v };
  }

  loadDetails(id) {
    if (this.details.has(id) || this.pendingDetails.has(id) || !this.svc.account) return;
    this.pendingDetails.add(id);
    const remember = (v) => {
      if (this.details.size > 100) this.details.delete(this.details.keys().next().value);
      this.details.set(id, v);
    };
    this.svc
      .fullTracks([id])
      .then(([t]) => {
        // unknown track: remember the miss too, otherwise every long-poll answer would ask the API again
        remember(t ? { title: t.version ? `${t.title} (${t.version})` : t.title, artists: t.artists.map((a) => ({ id: a.id, name: a.name })), cover: t.cover } : { title: null, artists: [], cover: null });
        this.bump();
      })
      .catch(() => remember({ title: null, artists: [], cover: null }))
      .finally(() => this.pendingDetails.delete(id));
  }

  /** Long-poll: answers at once when the UI is behind, otherwise on the next change or after `waitMs`. */
  wait(rev, waitMs = 25000) {
    if (!Number.isFinite(rev) || rev !== this.rev) return Promise.resolve(this.view());
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        this.waiters.delete(done);
        resolve(this.view());
      };
      const t = setTimeout(done, Math.max(0, Math.min(waitMs, 30000)));
      this.waiters.add(done);
    });
  }

  requireClient() {
    if (!this.client) throw new ApiError("Ynison выключен", 409);
    return this.client;
  }

  /** Tracks of the shared queue as playable local tracks (for «Слушать здесь» and for following the phone). */
  async queue() {
    this.svc.requireAuth();
    const c = this.requireClient();
    const q = c.state.player_state?.player_queue;
    const list = q?.playable_list || [];
    const refs = list.map(trackRef);
    const ids = [...new Set(refs.filter(Boolean).map((r) => r.id))];
    const full = ids.length ? await this.svc.fullTracks(ids) : [];
    const byId = new Map(this.svc.decorate(full).map((t) => [t.id, t]));
    const tracks = [];
    // the current playable may be a video or a local file we can't play: start from the next track, else the last one before
    let index = -1;
    let before = -1;
    const cur = Number(q?.current_playable_index);
    refs.forEach((r, i) => {
      const t = r && byId.get(r.id);
      if (!t) return;
      if (i === cur || (i > cur && index < 0)) index = tracks.length;
      else if (i < cur) before = tracks.length;
      tracks.push(t);
    });
    if (index < 0) index = before;
    const v = c.view(this.details);
    const entity = q?.entity_type || "VARIOUS";
    const first = tracks[0];
    const title =
      entity === "RADIO" ? "Моя волна" : entity === "ALBUM" ? first?.album?.title || "Альбом" : entity === "ARTIST" ? first?.artists?.[0]?.name || "Исполнитель" : entity === "PLAYLIST" ? "Плейлист" : "С другого устройства";
    return {
      tracks,
      index: Math.max(0, index),
      entityType: entity,
      entityId: q?.entity_id || "",
      from: q?.from_optional || list[0]?.from || "",
      title,
      paused: v.paused,
      progressMs: v.progressMs,
      at: v.at,
      queueVer: v.queueVer,
    };
  }

  /** Remote control of another active device. Never sent for our own device: local controls handle that. */
  control(body) {
    const c = this.requireClient();
    const action = String(body?.action || "");
    if (!ACTIONS.has(action)) throw new ApiError("Неизвестная команда", 400);
    const ps = c.state.player_state;
    if (!c.state.active || !ps?.status) throw new ApiError("Сейчас ни одно устройство не играет", 409);
    if (c.state.active === c.deviceId) throw new ApiError("Играет это устройство", 409);
    const now = Date.now();
    const st = ps.status;
    const progress = progressAt(st, c.statusAnchor.at, now);
    const status = (paused, progressMs) => playingStatusMessage(playingStatus({ deviceId: c.deviceId, paused, progressMs, durationMs: st.duration_ms, speed: st.playback_speed, now }), { now });
    if (action === "toggle" || action === "play" || action === "pause") {
      const paused = action === "toggle" ? !st.paused : action === "pause";
      // the extrapolated position goes along, otherwise a pause would rewind to the last reported one
      return c.send(status(paused, progress));
    }
    if (action === "seek") {
      const dur = num(st.duration_ms);
      const to = Math.max(0, num(body.positionMs));
      return c.send(status(!!st.paused, dur > 0 ? Math.min(to, dur) : to));
    }
    // «назад» after the first seconds restarts the track, as players do
    if (action === "prev" && progress > 3000) return c.send(status(!!st.paused, 0));
    const next = stepPlayerState(ps, action === "next" ? 1 : -1, { deviceId: c.deviceId, now });
    if (!next) {
      if (action === "prev") return c.send(status(!!st.paused, 0));
      throw new ApiError("Это последний трек в очереди", 409);
    }
    return c.send(playerStateMessage(next, { now }));
  }

  /** «Слушать здесь»: become the active device; the UI then picks up the shared queue and position. */
  take() {
    const c = this.requireClient();
    if (c.state.active === c.deviceId) return { ok: true };
    return c.send(activeDeviceMessage(c.deviceId));
  }

  /**
   * Publish what we play. Normally only while we are the active device; `intercept` is the explicit-play
   * takeover ("eager", like the official client's interceptActivity) or "if_none" when nobody plays.
   */
  publish(body) {
    const c = this.requireClient();
    const local = sanitizeLocal(body);
    const now = Date.now();
    const isActive = c.state.active === c.deviceId;
    let interception = "DO_NOT_INTERCEPT_BY_DEFAULT";
    if (!isActive) {
      if (body?.intercept === "eager") interception = "INTERCEPT_EAGER";
      else if (body?.intercept === "if_none") interception = "INTERCEPT_IF_NO_ONE_ACTIVE";
      else throw new ApiError("Это устройство сейчас не активно", 409);
    }
    if (body?.kind === "status") {
      if (!isActive) throw new ApiError("Это устройство сейчас не активно", 409);
      return c.send(playingStatusMessage(playingStatus({ deviceId: c.deviceId, paused: !local.playing, progressMs: local.positionMs, durationMs: local.durationMs, speed: local.rate, now }), { now }));
    }
    if (!local.tracks.length) throw new ApiError("Очередь пуста", 400);
    return c.send(playerStateMessage(localPlayerState(local, { deviceId: c.deviceId, now }), { now, interception }));
  }
}

/** Routes under /api (behind the launch key like every other route). */
export function ynisonRoutes(mgr) {
  return [
    ["GET", /^\/api\/ynison\/state$/, (q) => mgr.wait(q.has("rev") ? Number(q.get("rev")) : NaN, Number(q.get("wait") ?? 25000))],
    ["GET", /^\/api\/ynison\/queue$/, () => mgr.queue()],
    ["POST", /^\/api\/ynison\/control$/, (q, m, b) => mgr.control(b)],
    ["POST", /^\/api\/ynison\/take$/, () => mgr.take()],
    ["POST", /^\/api\/ynison\/publish$/, (q, m, b) => mgr.publish(b)],
    ["POST", /^\/api\/ynison\/reconnect$/, () => mgr.reconnect()],
  ];
}
