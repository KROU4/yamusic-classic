// Minimal RFC 6455 WebSocket client for the backend.
// Why not the global WebSocket: Ynison needs an explicit Origin header (403 without it), and keep-alive needs
// client pings — undici's WebSocket can't send pings and its `headers` option is a non-standard extension
// whose support in Electron's Node isn't guaranteed. This client works the same under Electron and `node server/cli.js`.
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

export const OP = { CONT: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 };
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export const acceptKey = (key) => crypto.createHash("sha1").update(key + GUID).digest("base64");

/** One frame. Clients must mask what they send (RFC 6455 §5.3); servers must not. */
export function encodeFrame(opcode, payload = Buffer.alloc(0), { mask = true, fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const buf = Buffer.alloc(head + (mask ? 4 : 0) + len);
  buf[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) buf[1] = len;
  else if (len < 65536) {
    buf[1] = 126;
    buf.writeUInt16BE(len, 2);
  } else {
    buf[1] = 127;
    buf.writeBigUInt64BE(BigInt(len), 2);
  }
  if (mask) {
    buf[1] |= 0x80;
    const key = crypto.randomBytes(4);
    key.copy(buf, head);
    for (let i = 0; i < len; i++) buf[head + 4 + i] = data[i] ^ key[i & 3];
  } else data.copy(buf, head);
  return buf;
}

/** Incremental frame decoder: push() raw socket bytes, get back complete frames. Unmasks masked frames. */
export class FrameParser {
  constructor({ maxPayload = 8 * 1024 * 1024 } = {}) {
    this.buf = Buffer.alloc(0);
    this.maxPayload = maxPayload;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      const b = this.buf;
      if (b.length < 2) break;
      const fin = !!(b[0] & 0x80);
      const opcode = b[0] & 0x0f;
      const masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        const big = b.readBigUInt64BE(2);
        // a size this large is a protocol error or an attack, not a state frame
        if (big > BigInt(this.maxPayload)) throw new Error("frame too large");
        len = Number(big);
        off = 10;
      }
      if (len > this.maxPayload) throw new Error("frame too large");
      const total = off + (masked ? 4 : 0) + len;
      if (b.length < total) break;
      let payload = b.subarray(off + (masked ? 4 : 0), total);
      if (masked) {
        const key = b.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      }
      frames.push({ fin, opcode, payload: Buffer.from(payload) });
      this.buf = b.subarray(total);
    }
    return frames;
  }
}

/**
 * Events: open, message(data: string|Buffer, isBinary), pong, close(code, reason), error(err).
 * Errors never carry request headers: the subprotocol holds the OAuth token.
 */
export class WsClient extends EventEmitter {
  constructor(url, { protocols = [], headers = {}, handshakeTimeoutMs = 15000, maxPayload = 8 * 1024 * 1024 } = {}) {
    super();
    this.readyState = 0; // 0 connecting, 1 open, 2 closing, 3 closed
    this.protocol = "";
    this.socket = null;
    this.parser = new FrameParser({ maxPayload });
    this.fragments = null;
    this.closeSent = false;
    this.closeInfo = null;
    this.closeTimer = null;
    const u = new URL(url);
    const secure = u.protocol === "wss:";
    if (!secure && u.protocol !== "ws:") throw new Error("unsupported scheme");
    const key = crypto.randomBytes(16).toString("base64");
    const req = (secure ? https : http).request({
      host: u.hostname,
      port: u.port || (secure ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        ...(protocols.length ? { "Sec-WebSocket-Protocol": protocols.join(", ") } : {}),
        ...headers,
      },
    });
    this.req = req;
    const timer = setTimeout(() => {
      req.destroy();
      this.fail("handshake timeout");
    }, handshakeTimeoutMs);
    timer.unref?.();
    req.on("response", (res) => {
      clearTimeout(timer);
      res.resume();
      this.fail(`handshake rejected: HTTP ${res.statusCode}`, res.statusCode);
    });
    req.on("error", (e) => {
      clearTimeout(timer);
      this.fail(`connection failed: ${e.code || "error"}`);
    });
    req.on("upgrade", (res, socket, head) => {
      clearTimeout(timer);
      if (res.headers["sec-websocket-accept"] !== acceptKey(key)) {
        socket.destroy();
        return this.fail("handshake rejected: bad accept key");
      }
      this.protocol = String(res.headers["sec-websocket-protocol"] || "");
      this.socket = socket;
      this.readyState = 1;
      socket.setNoDelay(true);
      socket.on("data", (d) => this.onData(d));
      socket.on("close", () => this.finish());
      socket.on("error", () => socket.destroy());
      this.emit("open");
      if (head?.length) this.onData(head);
    });
    req.end();
  }

  fail(message, status) {
    if (this.readyState === 3) return;
    const err = new Error(message);
    if (status) err.status = status;
    // an unhandled "error" event would throw and take the backend down
    if (this.listenerCount("error")) this.emit("error", err);
    this.readyState = 3;
    this.emit("close", 1006, "");
  }

  onData(chunk) {
    let frames;
    try {
      frames = this.parser.push(chunk);
    } catch {
      return this.close(1009, "too large");
    }
    for (const f of frames) this.onFrame(f);
  }

  onFrame({ fin, opcode, payload }) {
    if (opcode === OP.PING) return this.write(OP.PONG, payload);
    if (opcode === OP.PONG) return this.emit("pong");
    if (opcode === OP.CLOSE) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
      this.closeInfo = { code, reason };
      if (!this.closeSent) {
        this.closeSent = true;
        this.write(OP.CLOSE, payload.subarray(0, 2));
      }
      this.socket?.end();
      return;
    }
    if (opcode === OP.TEXT || opcode === OP.BINARY) {
      if (fin) return this.deliver(opcode, payload);
      this.fragments = { opcode, parts: [payload] };
      return;
    }
    if (opcode === OP.CONT && this.fragments) {
      this.fragments.parts.push(payload);
      if (fin) {
        const { opcode: op, parts } = this.fragments;
        this.fragments = null;
        this.deliver(op, Buffer.concat(parts));
      }
    }
  }

  deliver(opcode, payload) {
    if (opcode === OP.TEXT) this.emit("message", payload.toString("utf8"), false);
    else this.emit("message", payload, true);
  }

  write(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return false;
    this.socket.write(encodeFrame(opcode, payload));
    return true;
  }

  send(text) {
    if (this.readyState !== 1) return false;
    return this.write(OP.TEXT, Buffer.from(String(text), "utf8"));
  }

  ping() {
    return this.readyState === 1 && this.write(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    if (this.readyState === 0) {
      this.req?.destroy();
      return this.fail("closed before open");
    }
    this.readyState = 2;
    if (!this.closeSent) {
      this.closeSent = true;
      const r = Buffer.from(String(reason).slice(0, 120), "utf8");
      const p = Buffer.alloc(2 + r.length);
      p.writeUInt16BE(code, 0);
      r.copy(p, 2);
      this.write(OP.CLOSE, p);
      this.closeInfo ||= { code, reason: String(reason) };
    }
    // the server should answer with its close frame; don't hang forever if it doesn't
    this.closeTimer = setTimeout(() => this.terminate(), 3000);
    this.closeTimer.unref?.();
  }

  terminate() {
    if (this.readyState === 0) {
      this.req?.destroy();
      return this.fail("terminated");
    }
    this.socket?.destroy();
    this.finish();
  }

  finish() {
    if (this.readyState === 3) return;
    clearTimeout(this.closeTimer);
    this.readyState = 3;
    const info = this.closeInfo || { code: 1006, reason: "" };
    this.emit("close", info.code, info.reason);
  }
}
