import { describe, it, expect, afterEach } from "vitest";
import { encodeFrame, FrameParser, OP, WsClient } from "../server/wsclient.js";
import {
  randomVersion,
  authFields,
  subprotocols,
  fullStateMessage,
  envelope,
  neighborIndex,
  progressAt,
  mergeFrame,
  parseError,
  ReconnectPolicy,
  summarize,
  trackRef,
  coverFromTemplate,
  coverToTemplate,
  localPlayerState,
  stepPlayerState,
  sanitizeLocal,
  entityOf,
  SERVER_PAUSED,
  DEVICE_INFO,
  YnisonClient,
  YnisonManager,
  ynisonRoutes,
} from "../server/ynison.js";
import { startYnisonMock, phoneState, PHONE } from "./helpers/ynison-mock.js";

const ME = "11111111-2222-4333-8444-555555555555";
const waitFor = async (cond, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};
/** Every int64 field of an outgoing status/version is a decimal string. */
const int64Strings = (st) => typeof st.progress_ms === "string" && typeof st.duration_ms === "string" && typeof st.version.version === "string" && typeof st.version.timestamp_ms === "string";

describe("websocket frames", () => {
  it("masked client frames round-trip through the parser, any length, split anywhere", () => {
    for (const len of [0, 5, 125, 126, 300, 65535, 70000]) {
      const payload = Buffer.alloc(len, 7);
      const frame = encodeFrame(OP.TEXT, payload);
      expect((frame[1] & 0x80) !== 0).toBe(true);
      const p = new FrameParser();
      const out = [...p.push(frame.subarray(0, 3)), ...p.push(frame.subarray(3))];
      expect(out).toHaveLength(1);
      expect(out[0].opcode).toBe(OP.TEXT);
      expect(out[0].payload.equals(payload)).toBe(true);
    }
  });
  it("server frames are unmasked; two frames in one chunk; oversized frames are refused", () => {
    const a = encodeFrame(OP.TEXT, Buffer.from("a"), { mask: false });
    const b = encodeFrame(OP.PING, Buffer.alloc(0), { mask: false });
    expect(a[1] & 0x80).toBe(0);
    const out = new FrameParser().push(Buffer.concat([a, b]));
    expect(out.map((f) => f.opcode)).toEqual([OP.TEXT, OP.PING]);
    expect(() => new FrameParser({ maxPayload: 10 }).push(encodeFrame(OP.TEXT, Buffer.alloc(11)))).toThrow();
  });
});

describe("Ynison message builders", () => {
  it("version numbers are int63 decimal strings", () => {
    for (let i = 0; i < 50; i++) {
      const v = randomVersion();
      expect(v).toMatch(/^\d+$/);
      expect(BigInt(v) < 2n ** 63n).toBe(true);
    }
  });
  it("handshake fields: device id, nested Device-Info JSON, ticket and session for the hub", () => {
    const f = authFields({ deviceId: ME, token: "TOKEN", ticket: "T", sessionId: "123" });
    expect(f).toEqual({ "Ynison-Device-Id": ME, "Ynison-Device-Info": DEVICE_INFO, "Ynison-Redirect-Ticket": "T", "Ynison-Session-Id": "123", authorization: "OAuth TOKEN" });
    expect(JSON.parse(f["Ynison-Device-Info"])).toEqual({ app_name: "Desktop", app_version: "5.124.1", type: 1 });
    const [a, b, c] = subprotocols(f);
    expect([a, b]).toEqual(["Bearer", "v2"]);
    expect(c).not.toMatch(/[,\s]/); // one header token: commas would split the subprotocol list
    expect(JSON.parse(decodeURIComponent(c))).toEqual(f);
    expect(authFields({ deviceId: ME, token: "X" })).not.toHaveProperty("Ynison-Redirect-Ticket");
  });
  it("update_full_state: empty paused state with zero-time versions, visible player, passive", () => {
    const m = fullStateMessage({ deviceId: ME, title: "YM Classic — PC", volume: 0.8 });
    expect(Object.keys(m)[0]).toBe("update_full_state");
    expect(m.rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.player_action_timestamp_ms).toBe("0");
    expect(m.activity_interception_type).toBe("DO_NOT_INTERCEPT_BY_DEFAULT");
    const u = m.update_full_state;
    expect(u.is_currently_active).toBe(false);
    expect(u.sync_state_from_eov_optional).toBeNull();
    expect(u.player_state.player_queue.current_playable_index).toBe(-1);
    expect(u.player_state.player_queue.playable_list).toEqual([]);
    expect(u.player_state.player_queue.version.timestamp_ms).toBe("0");
    expect(u.player_state.status).toMatchObject({ paused: true, progress_ms: "0", duration_ms: "0" });
    expect(int64Strings(u.player_state.status)).toBe(true);
    expect(u.player_state.status.version.timestamp_ms).toBe("0");
    expect(u.device.info).toEqual({ app_name: "Desktop", app_version: "5.124.1", title: "YM Classic — PC", device_id: ME, type: "WEB_DESKTOP" });
    expect(u.device.capabilities).toEqual({ can_be_player: true, can_be_remote_controller: true, volume_granularity: 20 });
    expect(u.device.is_shadow).toBe(false);
    expect(u.device.volume_info).toEqual({ volume: 0.8, version: null });
  });
  it("envelope: action time as a string, interception passes through", () => {
    const m = envelope({ update_active_device: { device_id_optional: ME } }, { now: 1730000000000, interception: "INTERCEPT_EAGER" });
    expect(m.player_action_timestamp_ms).toBe("1730000000000");
    expect(m.activity_interception_type).toBe("INTERCEPT_EAGER");
  });
});

describe("Ynison state logic", () => {
  const q = (index, n = 4, extra = {}) => ({ current_playable_index: index, playable_list: Array.from({ length: n }, (_, i) => ({ playable_id: String(i) })), options: { repeat_mode: "NONE" }, ...extra });
  it("neighbour index follows the list, shuffle order and repeat-all wrap", () => {
    expect(neighborIndex(q(1), 1)).toBe(2);
    expect(neighborIndex(q(1), -1)).toBe(0);
    expect(neighborIndex(q(3), 1)).toBe(-1);
    expect(neighborIndex(q(0), -1)).toBe(-1);
    expect(neighborIndex(q(3, 4, { options: { repeat_mode: "ALL" } }), 1)).toBe(0);
    expect(neighborIndex(q(0, 4, { options: { repeat_mode: "ALL" } }), -1)).toBe(3);
    const sh = q(0, 4, { shuffle_optional: { playable_indices: [2, 0, 3, 1] } });
    expect(neighborIndex(sh, 1)).toBe(3);
    expect(neighborIndex(sh, -1)).toBe(2);
    // shuffle indices of the wrong length are ignored
    expect(neighborIndex(q(0, 4, { shuffle_optional: { playable_indices: [1, 0] } }), 1)).toBe(1);
  });
  it("progress extrapolation: paused, playing, capped, future clocks, zero version", () => {
    const st = (o) => ({ progress_ms: "10000", duration_ms: "60000", paused: false, playback_speed: 1, version: { timestamp_ms: "100000" }, ...o });
    expect(progressAt(st({ paused: true }), 100000, 200000)).toBe(10000);
    expect(progressAt(st(), 100000, 105000)).toBe(15000);
    expect(progressAt(st({ playback_speed: 2 }), 100000, 105000)).toBe(20000);
    expect(progressAt(st(), 100000, 900000)).toBe(60000);
    // the author's clock runs 10 s ahead: anchor at when we first saw the status instead
    expect(progressAt(st({ version: { timestamp_ms: "110000" } }), 100000, 103000)).toBe(13000);
    expect(progressAt(st({ version: { device_id: "", version: "0", timestamp_ms: "0" } }), 100000, 102000)).toBe(12000);
  });
  it("broadcast merge keeps missing keys, replaces sub-objects whole, server pause clears the active device", () => {
    let s = { player_state: null, devices: [], active: "", timestamp: null };
    s = mergeFrame(s, phoneState());
    expect(s.active).toBe(PHONE);
    expect(s.devices).toHaveLength(2);
    const s2 = mergeFrame(s, { player_state: { status: { progress_ms: "1", paused: true } } });
    expect(s2.player_state.player_queue).toBe(s.player_state.player_queue);
    expect(s2.player_state.status).toEqual({ progress_ms: "1", paused: true });
    expect(s2.active).toBe(PHONE);
    expect(s2.devices).toBe(s.devices);
    const s3 = mergeFrame(s2, { player_state: { status: { paused: true, version: { device_id: SERVER_PAUSED } } } });
    expect(s3.active).toBe("");
    expect(mergeFrame(s, { active_device_id_optional: null }).active).toBe("");
  });
  it("error frames: hub details, redirector extra_headers, retry decisions", () => {
    expect(parseError({ http_code: 400, grpc_code: 9, details: { "ynison-error-code": "400090001" } }).retry).toBe("never");
    expect(parseError({ http_code: 401, grpc_code: 16, extra_headers: {} }).retry).toBe("never");
    expect(parseError({ details: { "ynison-error-code": "300100001" } }).retry).toBe("immediate");
    const e = parseError({ http_code: 503, extra_headers: { "ynison-go-away-for-seconds": "120", "ynison-backoff-millis": "0:1000:5000:30000", "ynison-error-code": "500" } });
    expect(e).toMatchObject({ retry: "backoff", goAwayMs: 120000, ladder: [0, 1000, 5000, 30000], code: "500" });
  });
  it("reconnect policy: default ladder, idle retries, cap, go-away, one immediate retry, stop", () => {
    const p = new ReconnectPolicy({ ladder: [1000, 5000, 30000], idleMs: 300000, maxAttempts: 5 });
    expect([p.next(), p.next(), p.next(), p.next(), p.next(), p.next()]).toEqual([1000, 5000, 30000, 300000, 300000, null]);
    p.onHealthy();
    p.onError({ goAwayMs: 60000, ladder: [2000] });
    expect(p.next()).toBe(60000);
    expect(p.next()).toBe(2000);
    p.onHealthy();
    p.onError({ retry: "immediate" });
    expect(p.next()).toBe(0);
    p.onError({ retry: "immediate" });
    expect(p.next()).toBe(1000); // second rebalance in a row: back on the ladder
    p.onError({ retry: "never" });
    expect(p.next()).toBeNull();
  });
  it("summary for the UI: devices ranked, current track, ids with gaps for non-tracks", () => {
    const st = phoneState();
    st.player_state.player_queue.playable_list.push({ playable_id: "local:1", playable_type: "LOCAL_TRACK", title: "файл" });
    st.devices.push({ info: { device_id: ME, title: "YM Classic", type: "WEB_DESKTOP", app_name: "Desktop" }, capabilities: { can_be_player: true } });
    const s = mergeFrame({ devices: [], active: "" }, st);
    const details = new Map([["28150464", { title: "Второй (Live)", artists: [{ id: 1, name: "Кино" }], cover: "https://avatars.yandex.net/x/200x200" }]]);
    const v = summarize(s, { me: ME, now: Date.now(), anchorAt: Date.now(), details });
    expect(v.devices.map((d) => d.id)).toEqual([PHONE, ME, "speaker-id"]);
    expect(v.activeDevice.title).toBe("Pixel 8");
    expect(v.activeIsMe).toBe(false);
    expect(v.track).toMatchObject({ id: "28150464", albumId: "3192570", title: "Второй (Live)", artists: [{ id: 1, name: "Кино" }], playable: true });
    expect(v.ids).toEqual(["28150463", "28150464", "28150465", null]);
    expect(v.paused).toBe(false);
    expect(v.progressMs).toBeGreaterThanOrEqual(30000);
    expect(v.queueVer.author).toBe(PHONE);
  });
  it("playables: catalogue ids only, covers only from Yandex hosts", () => {
    expect(trackRef({ playable_id: "123", album_id_optional: "9", playable_type: "TRACK" })).toEqual({ id: "123", albumId: "9" });
    expect(trackRef({ playable_id: "123", playable_type: "VIDEO_CLIP" })).toBeNull();
    expect(trackRef({ playable_id: "a/b" })).toBeNull();
    expect(coverFromTemplate("avatars.yandex.net/get-music-content/1/a/%%")).toBe("https://avatars.yandex.net/get-music-content/1/a/200x200");
    expect(coverFromTemplate("evil.example/%%")).toBeNull();
    expect(coverToTemplate("https://avatars.yandex.net/get-music-content/1/a/200x200")).toBe("avatars.yandex.net/get-music-content/1/a/%%");
  });
  it("local queue as shared state: ±100 window, entity from the context, string int64s", () => {
    const tracks = Array.from({ length: 400 }, (_, i) => ({ id: String(1000 + i), albumId: "7", title: `t${i}`, cover: null }));
    const ps = localPlayerState({ tracks, index: 150, context: { link: "/album/7", from: "desktop_win-album-album-default" }, repeat: "all", playing: true, positionMs: 12345.6, durationMs: 200000, rate: 1 }, { deviceId: ME, now: 1730000000000 });
    const pq = ps.player_queue;
    expect(pq.playable_list).toHaveLength(200);
    expect(pq.current_playable_index).toBe(100);
    expect(pq.playable_list[100].playable_id).toBe("1150");
    expect(pq).toMatchObject({ entity_type: "ALBUM", entity_id: "7", options: { repeat_mode: "ALL" }, shuffle_optional: null, from_optional: "desktop_win-album-album-default" });
    expect(pq.version).toMatchObject({ device_id: ME, timestamp_ms: "1730000000000" });
    expect(ps.status).toMatchObject({ paused: false, progress_ms: "12346", duration_ms: "200000" });
    expect(int64Strings(ps.status)).toBe(true);
    expect(entityOf({ type: "wave", stationId: "genre:rock" })).toEqual({ entity_type: "RADIO", entity_id: "genre:rock" });
    expect(entityOf({ link: "/playlist/user.name/3" })).toEqual({ entity_type: "PLAYLIST", entity_id: "user.name:3" });
    expect(entityOf({ link: "/chart" })).toEqual({ entity_type: "VARIOUS", entity_id: "" });
  });
  it("next/prev for another device: neighbour index, status reset, our version", () => {
    const ps = phoneState().player_state;
    const n = stepPlayerState(ps, 1, { deviceId: ME, now: 5 });
    expect(n.player_queue.current_playable_index).toBe(2);
    expect(n.player_queue.playable_list).toBe(ps.player_queue.playable_list);
    expect(n.player_queue.version).toMatchObject({ device_id: ME, timestamp_ms: "5" });
    expect(n.status).toMatchObject({ progress_ms: "0", duration_ms: "0", paused: false });
    expect(stepPlayerState({ ...ps, player_queue: { ...ps.player_queue, current_playable_index: 2 } }, 1, { deviceId: ME })).toBeNull();
  });
  it("UI snapshot is coerced: bad ids dropped, numbers clamped", () => {
    const l = sanitizeLocal({ tracks: [{ id: "1", albumId: "x" }, { id: "../etc" }, null], index: 9, repeat: "weird", rate: 10, positionMs: -5, context: { type: "wave", stationId: 5 } });
    expect(l.tracks).toEqual([{ id: "1", albumId: null, title: "", cover: null }]);
    expect(l).toMatchObject({ index: 0, repeat: "none", rate: 2, positionMs: 0, context: { type: "wave", stationId: "" } });
  });
});

// ---------- against a local mock server ----------
let mock = null;
let clients = [];
afterEach(async () => {
  for (const c of clients) c.stop();
  clients = [];
  await mock?.close();
  mock = null;
});

function client(opts = {}) {
  const c = new YnisonClient({ getToken: () => "TOKEN", deviceId: ME, title: "YM Classic — test", redirectorUrl: mock.url, hubHost: `127.0.0.1:${mock.port}`, policy: new ReconnectPolicy({ ladder: [50, 50, 50], idleMs: 50, maxAttempts: 5 }), ...opts });
  clients.push(c);
  return c;
}

describe("Ynison client against a mock server", () => {
  it("the mock refuses a handshake without Origin, like the real redirector", async () => {
    mock = await startYnisonMock();
    const ws = new WsClient(mock.url, { protocols: subprotocols(authFields({ deviceId: ME, token: "T" })) });
    const err = await new Promise((r) => ws.on("error", r));
    expect(err.status).toBe(403);
  });

  it("redirector -> hub handshake, update_full_state first, shared state goes online", async () => {
    mock = await startYnisonMock();
    const c = client();
    c.start();
    await waitFor(() => c.status === "online");
    const [redir, hub] = mock.handshakes;
    expect(redir.origin).toBe("https://music.yandex.ru");
    expect(redir.protocols).toEqual(["Bearer", "v2"]);
    expect(redir.auth).toMatchObject({ "Ynison-Device-Id": ME, authorization: "OAuth TOKEN" });
    expect(redir.auth["Ynison-Session-Id"]).toMatch(/^\d{19}$/);
    expect(redir.auth).not.toHaveProperty("Ynison-Redirect-Ticket");
    expect(hub.path).toBe("/ynison_state.YnisonStateService/PutYnisonState");
    expect(hub.auth).toMatchObject({ "Ynison-Redirect-Ticket": "ticket-1", "Ynison-Session-Id": "1234567890123456789" });
    expect(mock.messages).toHaveLength(1);
    expect(mock.messages[0]).toHaveProperty("update_full_state");
    const v = c.view(new Map());
    expect(v.activeDevice.id).toBe(PHONE);
    expect(v.devices.some((d) => d.me)).toBe(true);
    expect(v.track.title).toBe("Второй");
  });

  it("refuses a hub host the redirector shouldn't send the token to", async () => {
    mock = await startYnisonMock();
    const c = client({ hubHost: "127.0.0.1:1" });
    c.start();
    await waitFor(() => c.status === "waiting" || c.status === "stopped");
    expect(mock.handshakes).toHaveLength(1); // only the redirector hop happened
  });

  it("reconnects after a dropped socket and sends a fresh full state again", async () => {
    mock = await startYnisonMock();
    const c = client();
    c.start();
    await waitFor(() => c.status === "online");
    mock.dropAll();
    await waitFor(() => mock.redirects === 2 && c.status === "online");
    expect(mock.messages.filter((m) => m.update_full_state)).toHaveLength(2);
  });

  it("a 4xx error frame (same device id elsewhere) stops without retrying", async () => {
    mock = await startYnisonMock({ hubError: { http_code: 400, grpc_code: 9, message: "dup", details: { "ynison-error-code": "400090001" } } });
    const c = client();
    c.start();
    await waitFor(() => c.status === "stopped");
    expect(c.error).toMatch(/другом окне/);
    await new Promise((r) => setTimeout(r, 200));
    expect(mock.redirects).toBe(1);
  });

  it("redirector go-away is honoured before the next attempt", async () => {
    mock = await startYnisonMock({ redirectError: { http_code: 503, grpc_code: 14, extra_headers: { "ynison-go-away-for-seconds": "60" } } });
    const c = client();
    c.start();
    await waitFor(() => c.status === "waiting");
    await new Promise((r) => setTimeout(r, 200));
    expect(mock.redirects).toBe(1); // still waiting out the 60 s window
  });

  it("gives up after the attempt cap when the server keeps failing", async () => {
    mock = await startYnisonMock();
    mock.rejectNext = 100;
    const c = client();
    c.start();
    await waitFor(() => c.status === "stopped", 3000);
    expect(mock.handshakes.length).toBe(6); // first try + 5 retries
  });

  it("keep-alive: pings the hub and reconnects when pongs stop", async () => {
    mock = await startYnisonMock({ keepAlive: { keep_alive_time_seconds: 0.1, keep_alive_timeout_seconds: 0.1 }, silentPongs: true });
    const c = client({ minKeepAliveS: 0.05 });
    c.start();
    await waitFor(() => c.status === "online");
    await waitFor(() => mock.pings >= 1 && mock.redirects >= 2, 3000);
  });
});

describe("Ynison manager (service glue)", () => {
  function fakeSvc(prefs = { ynison: true, volume: 0.5 }) {
    const data = new Map();
    return {
      prefs,
      account: { account: { uid: 1 } },
      api: { token: "TOKEN" },
      store: { get: (k) => data.get(k), set: (k, v) => data.set(k, v) },
      log: () => {},
      requireAuth() {},
      decorate: (x) => x,
      fullTracks: async (ids) => ids.map((id) => ({ id, title: `T${id}`, version: null, artists: [{ id: 1, name: "Артист" }], album: { title: "Альбом" }, cover: null })),
    };
  }
  const managers = [];
  afterEach(() => {
    for (const m of managers) m.stop();
    managers.length = 0;
  });
  const manager = (svc, env) => {
    const m = new YnisonManager(svc, { env: { YMC_YNISON_URL: mock.url, ...env } });
    managers.push(m);
    return m;
  };

  it("off by default: no connection at all while the setting is off", async () => {
    mock = await startYnisonMock();
    const m = manager(fakeSvc({ ynison: false }));
    m.sync();
    await new Promise((r) => setTimeout(r, 150));
    expect(mock.handshakes).toHaveLength(0);
    expect(m.view()).toMatchObject({ enabled: false, status: "off" });
  });

  it("smoke runs never reach the real server; overrides must be loopback", () => {
    const m1 = new YnisonManager(fakeSvc(), { env: { YMC_NO_REPORT: "1" } });
    expect(m1.blocked).toBe(true);
    const m2 = new YnisonManager(fakeSvc(), { env: { YMC_YNISON_URL: "ws://evil.example/x" } });
    expect(m2.override).toBeNull();
    const m3 = new YnisonManager(fakeSvc(), { env: { YMC_YNISON_URL: "wss://127.0.0.1/x" } });
    expect(m3.override).toBeNull();
  });

  it("persistent own device id", async () => {
    mock = await startYnisonMock();
    const svc = fakeSvc();
    const m = manager(svc);
    const id = m.deviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.deviceId()).toBe(id);
  });

  it("remote control of the phone: pause carries the extrapolated position, next moves the index", async () => {
    mock = await startYnisonMock();
    const svc = fakeSvc();
    const m = manager(svc);
    m.sync();
    await waitFor(() => m.view().status === "online");
    const me = m.deviceId();
    m.control({ action: "toggle" });
    await waitFor(() => mock.messages.length === 2);
    const st = mock.messages[1].update_playing_status.playing_status;
    expect(st.paused).toBe(true);
    expect(Number(st.progress_ms)).toBeGreaterThanOrEqual(30000);
    expect(st.version.device_id).toBe(me);
    expect(Number(st.version.timestamp_ms)).toBeGreaterThan(Date.now() - 5000);
    expect(int64Strings(st)).toBe(true);
    m.control({ action: "next" });
    await waitFor(() => mock.messages.length === 3);
    expect(mock.messages[2].update_player_state.player_state.player_queue.current_playable_index).toBe(2);
    expect(() => m.control({ action: "rm -rf" })).toThrow();
  });

  it("«Слушать здесь» makes us active; publishing is refused while passive unless intercepting", async () => {
    mock = await startYnisonMock();
    const m = manager(fakeSvc());
    m.sync();
    await waitFor(() => m.view().status === "online");
    const local = { kind: "queue", tracks: [{ id: "5", title: "Песня" }], index: 0, playing: true, positionMs: 1000, durationMs: 100000 };
    expect(() => m.publish(local)).toThrow(/не активно/);
    m.take();
    await waitFor(() => m.view().activeIsMe);
    expect(mock.messages.at(-1).update_active_device.device_id_optional).toBe(m.deviceId());
    expect(() => m.control({ action: "toggle" })).toThrow(/это устройство/i);
    m.publish(local);
    await waitFor(() => mock.messages.at(-1).update_player_state);
    expect(mock.messages.at(-1).activity_interception_type).toBe("DO_NOT_INTERCEPT_BY_DEFAULT");
    m.publish({ ...local, kind: "status", playing: false });
    await waitFor(() => mock.messages.at(-1).update_playing_status);
  });

  it("explicit local play while the phone plays intercepts eagerly", async () => {
    mock = await startYnisonMock();
    const m = manager(fakeSvc());
    m.sync();
    await waitFor(() => m.view().status === "online");
    m.publish({ kind: "queue", intercept: "eager", tracks: [{ id: "5" }], index: 0, playing: true });
    await waitFor(() => m.view().activeIsMe);
    expect(mock.messages.at(-1).activity_interception_type).toBe("INTERCEPT_EAGER");
  });

  it("shared queue as local tracks, current index mapped past non-track items", async () => {
    const st = phoneState();
    st.player_state.player_queue.playable_list.splice(1, 0, { playable_id: "v1", playable_type: "VIDEO_CLIP" });
    st.player_state.player_queue.current_playable_index = 1; // the video
    mock = await startYnisonMock({ state: st });
    const m = manager(fakeSvc());
    m.sync();
    await waitFor(() => m.view().status === "online");
    const r = await m.queue();
    expect(r.tracks.map((t) => t.id)).toEqual(["28150463", "28150464", "28150465"]);
    expect(r.index).toBe(1);
    expect(r.title).toBe("Альбом");
    expect(r.paused).toBe(false);
  });

  it("long-poll answers at once when behind, otherwise on change; details load the artist", async () => {
    mock = await startYnisonMock();
    const m = manager(fakeSvc());
    const routes = ynisonRoutes(m);
    const state = routes.find((r) => r[1].test("/api/ynison/state"))[2];
    const first = await state(new URLSearchParams(""));
    const pending = state(new URLSearchParams(`rev=${first.rev}&wait=5000`));
    m.sync();
    const next = await pending;
    expect(next.rev).toBeGreaterThan(first.rev);
    await waitFor(() => m.view().track?.artists?.length > 0);
    expect(m.view().track.artists[0].name).toBe("Артист");
  });
});
