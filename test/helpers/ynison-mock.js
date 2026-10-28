// Local stand-in for both Ynison hops (redirector + state service), for unit tests and smoke runs.
// Behaves like the real server where it matters: requires Origin, negotiates "Bearer", the redirector sends one
// frame and closes, the hub stays silent until the first message and drops the socket unless it's update_full_state,
// every accepted request is answered with a full-state broadcast carrying the request's rid.
import http from "node:http";
import { acceptKey, encodeFrame, FrameParser, OP } from "../../server/wsclient.js";

export const PHONE = "phone-device-id";

export function phoneState() {
  const v = (ts) => ({ device_id: PHONE, version: "4242", timestamp_ms: String(ts) });
  return {
    player_state: {
      player_queue: {
        current_playable_index: 1,
        entity_id: "3192570",
        entity_type: "ALBUM",
        entity_context: "BASED_ON_ENTITY_BY_DEFAULT",
        playable_list: [
          { playable_id: "28150463", album_id_optional: "3192570", playable_type: "TRACK", from: "mobile-album", title: "Первый", cover_url_optional: "avatars.yandex.net/get-music-content/1/a/%%" },
          { playable_id: "28150464", album_id_optional: "3192570", playable_type: "TRACK", from: "mobile-album", title: "Второй", cover_url_optional: "avatars.yandex.net/get-music-content/1/b/%%" },
          { playable_id: "28150465", album_id_optional: "3192570", playable_type: "TRACK", from: "mobile-album", title: "Третий", cover_url_optional: null },
        ],
        options: { repeat_mode: "NONE" },
        shuffle_optional: null,
        version: v(Date.now() - 60000),
      },
      status: { progress_ms: "30000", duration_ms: "200000", paused: false, playback_speed: 1, version: v(Date.now() - 5000) },
      player_queue_inject_optional: null,
    },
    devices: [
      {
        info: { device_id: PHONE, title: "Pixel 8", type: "ANDROID", app_name: "Yandex Music", app_version: "2026.10" },
        capabilities: { can_be_player: true, can_be_remote_controller: true, volume_granularity: 16 },
        volume_info: { volume: 0.7, version: null },
        is_offline: false,
      },
      {
        info: { device_id: "speaker-id", title: "Станция Мини", type: "SMART_SPEAKER", app_name: "Alice", app_version: "1" },
        capabilities: { can_be_player: true, can_be_remote_controller: false, volume_granularity: 10 },
        volume_info: { volume: 0.3, version: null },
        is_offline: true,
      },
    ],
    active_device_id_optional: PHONE,
    timestamp_ms: String(Date.now()),
  };
}

export async function startYnisonMock({ state = phoneState(), redirectError = null, hubError = null, keepAlive = { keep_alive_time_seconds: 60, keep_alive_timeout_seconds: 30 }, silentPongs = false } = {}) {
  const mock = {
    state: structuredClone(state),
    messages: [], // every client message the hub received, parsed
    handshakes: [], // { path, origin, protocols: [..], auth: parsed JSON }
    redirects: 0,
    hubs: new Set(),
    pings: 0,
    rejectNext: 0, // answer the next N upgrades with HTTP 503
  };
  const server = http.createServer((req, res) => {
    res.writeHead(426);
    res.end();
  });

  const sendText = (socket, obj) => socket.write(encodeFrame(OP.TEXT, Buffer.from(JSON.stringify(obj)), { mask: false }));
  const broadcast = (rid) => {
    for (const s of mock.hubs) sendText(s, { ...mock.state, rid: rid || "server", timestamp_ms: String(Date.now()) });
  };
  mock.broadcast = broadcast;
  mock.push = (frame) => {
    for (const s of mock.hubs) sendText(s, frame);
  };
  mock.dropAll = () => {
    for (const s of mock.hubs) s.destroy();
  };

  function onHubMessage(socket, msg, ctx) {
    mock.messages.push(msg);
    if (!ctx.started) {
      if (!msg.update_full_state) return socket.destroy(); // like the real hub (verified with update_session_params)
      ctx.started = true;
      if (hubError) return sendText(socket, { error: hubError });
      const dev = msg.update_full_state.device;
      mock.state.devices = [...mock.state.devices.filter((d) => d.info.device_id !== dev.info.device_id), { ...dev, is_offline: false }];
      return broadcast(msg.rid);
    }
    if (msg.update_active_device) mock.state.active_device_id_optional = msg.update_active_device.device_id_optional || "";
    if (msg.update_playing_status) mock.state.player_state.status = msg.update_playing_status.playing_status;
    if (msg.update_player_state) {
      mock.state.player_state = { ...mock.state.player_state, ...msg.update_player_state.player_state };
      if (msg.activity_interception_type === "INTERCEPT_EAGER") mock.state.active_device_id_optional = ctx.deviceId;
    }
    broadcast(msg.rid);
  }

  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const protocols = String(req.headers["sec-websocket-protocol"] || "").split(",").map((s) => s.trim());
    let auth = null;
    try {
      auth = JSON.parse(decodeURIComponent(protocols[2] || ""));
    } catch {
      // malformed: rejected below
    }
    const url = new URL(req.url, "http://x");
    mock.handshakes.push({ path: url.pathname, origin: req.headers.origin, protocols: protocols.slice(0, 2), auth });
    if (mock.rejectNext > 0) {
      mock.rejectNext -= 1;
      socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    if (req.headers.origin !== "https://music.yandex.ru" || protocols[0] !== "Bearer" || !auth?.authorization) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "Sec-WebSocket-Protocol: Bearer", "", ""].join("\r\n"));
    const parser = new FrameParser();
    const ctx = { started: false, deviceId: auth["Ynison-Device-Id"] };
    const isHub = url.pathname === "/ynison_state.YnisonStateService/PutYnisonState";
    socket.on("error", () => {});
    socket.on("close", () => mock.hubs.delete(socket));
    socket.on("data", (d) => {
      for (const f of parser.push(d)) {
        if (f.opcode === OP.PING) {
          mock.pings += 1;
          if (!silentPongs) socket.write(encodeFrame(OP.PONG, f.payload, { mask: false }));
        } else if (f.opcode === OP.CLOSE) {
          socket.end(encodeFrame(OP.CLOSE, f.payload.subarray(0, 2), { mask: false }));
        } else if (f.opcode === OP.TEXT && isHub) {
          let msg = null;
          try {
            msg = JSON.parse(f.payload.toString("utf8"));
          } catch {
            // ignore
          }
          if (msg) onHubMessage(socket, msg, ctx);
        }
      }
    });
    if (isHub) {
      if (!auth["Ynison-Redirect-Ticket"]) return socket.destroy();
      mock.hubs.add(socket);
      return;
    }
    mock.redirects += 1;
    const port = server.address().port;
    sendText(socket, redirectError ? { error: redirectError } : { host: `127.0.0.1:${port}`, redirect_ticket: "ticket-1", session_id: "1234567890123456789", keep_alive_params: keepAlive });
    socket.end(encodeFrame(OP.CLOSE, Buffer.from([0x03, 0xe8]), { mask: false }));
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  mock.port = port;
  mock.url = `ws://127.0.0.1:${port}/redirector.YnisonRedirectService/GetRedirectToYnison`;
  mock.close = () =>
    new Promise((r) => {
      for (const s of mock.hubs) s.destroy();
      server.close(r);
      server.closeAllConnections?.();
    });
  return mock;
}
