// Discord Rich Presence через локальный IPC Discord (\\?\pipe\discord-ipc-N) без сторонних библиотек.
// Протокол: кадр = op (int32 LE) + длина (int32 LE) + JSON. op 0 — рукопожатие, op 1 — команда.
import net from "node:net";
import crypto from "node:crypto";

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

const pipePath = (i) => (process.platform === "win32" ? `\\\\?\\pipe\\discord-ipc-${i}` : `${process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp"}/discord-ipc-${i}`);

export class DiscordPresence {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.sock = null;
    this.clientId = null;
    this.ready = false;
    this.pending = null; // последняя активность, отправим после подключения
    this.retryTimer = null;
  }

  async connect(clientId) {
    if (this.sock && this.clientId === clientId) return;
    this.disconnect();
    this.clientId = clientId;
    for (let i = 0; i < 10; i++) {
      const ok = await new Promise((resolve) => {
        const s = net.createConnection(pipePath(i), () => resolve(s));
        s.once("error", () => resolve(null));
      });
      if (!ok) continue;
      this.sock = ok;
      this.sock.on("data", (buf) => this.onData(buf));
      this.sock.on("close", () => this.onClose());
      this.sock.on("error", () => {});
      this.sock.write(encode(OP_HANDSHAKE, { v: 1, client_id: clientId }));
      return;
    }
    // Discord не запущен — попробуем позже
    this.scheduleRetry();
  }

  onData(buf) {
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const op = buf.readInt32LE(offset);
      const len = buf.readInt32LE(offset + 4);
      const body = buf.subarray(offset + 8, offset + 8 + len).toString("utf8");
      offset += 8 + len;
      let msg = null;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (op === OP_FRAME && msg.evt === "READY") {
        this.ready = true;
        this.log("discord: подключено");
        if (this.pending !== null) this.setActivity(this.pending);
      } else if (op === OP_CLOSE || msg.evt === "ERROR") {
        this.log("discord: отказ", msg.data?.message || msg.message || "");
      }
    }
  }

  onClose() {
    this.sock = null;
    this.ready = false;
    if (this.clientId) this.scheduleRetry();
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.clientId && this.connect(this.clientId), 30000);
    this.retryTimer.unref?.();
  }

  /** activity = null — очистить статус. */
  setActivity(activity) {
    this.pending = activity;
    if (!this.sock || !this.ready) return;
    this.sock.write(encode(OP_FRAME, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: activity || undefined }, nonce: crypto.randomUUID() }));
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    const s = this.sock;
    this.clientId = null;
    this.sock = null;
    this.ready = false;
    if (s) {
      try {
        s.end();
      } catch {
        // уже закрыт
      }
    }
  }
}

/** Активность «Слушает» из состояния плеера. */
export function activityFromState(st, now = Date.now()) {
  if (!st?.id) return null;
  const clip = (s, n = 120) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || undefined);
  const activity = {
    type: 2, // Listening
    details: clip(st.title),
    state: clip(st.artist ? `${st.artist}` : undefined),
    assets: st.cover ? { large_image: st.cover, large_text: clip(st.album || st.title) } : undefined,
    buttons: st.albumId ? [{ label: "Открыть в Яндекс Музыке", url: `https://music.yandex.ru/album/${st.albumId}/track/${st.id}` }] : undefined,
  };
  if (st.playing && st.durationSec > 0) {
    const start = now - (st.positionSec || 0) * 1000;
    activity.timestamps = { start, end: start + st.durationSec * 1000 };
  }
  return activity;
}
