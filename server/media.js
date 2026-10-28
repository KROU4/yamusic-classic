// Media served by the local server under unguessable one-off links (/media/<id>):
//  - "enc": a lossless stream that Yandex delivers encrypted (transport encraw). It is AES-128-CTR with the key
//    from get-file-info and a zero initial counter over the whole file, so any byte range can be decrypted on
//    its own: the counter for offset N is N/16. Decrypted only in memory, for playback in this client.
//  - "file": a local audio file the user chose to play instead of a track (e.g. their own uncensored copy).
// <audio> cannot send the API key header, so the random id itself is the capability; Host is still checked.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { Readable } from "node:stream";

const TTL = 6 * 60 * 60 * 1000;
export const AUDIO_EXT = { ".mp3": "audio/mpeg", ".flac": "audio/flac", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav" };

/** Counter block for byte offset `offset` (a multiple of 16): 128-bit big-endian block index. */
export function ctrIv(offset) {
  const iv = Buffer.alloc(16);
  let block = BigInt(offset / 16);
  for (let i = 15; i >= 0 && block > 0n; i--) {
    iv[i] = Number(block & 0xffn);
    block >>= 8n;
  }
  return iv;
}

/** Parses "bytes=a-b" / "bytes=a-" / "bytes=-n" against a known or unknown size. null = whole file. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    if (size == null) return null;
    const n = Math.min(Number(m[2]), size);
    return { start: size - n, end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? (size != null ? size - 1 : null) : Math.min(Number(m[2]), size != null ? size - 1 : Infinity);
  return { start, end };
}

/** Drops the first `skip` bytes of a stream (the part of the first AES block before the requested offset). */
function skipBytes(skip) {
  let left = skip;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (left >= chunk.length) {
        left -= chunk.length;
        return cb();
      }
      const out = left ? chunk.subarray(left) : chunk;
      left = 0;
      cb(null, out);
    },
  });
}

export class MediaRegistry {
  constructor({ fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.fetch = fetchImpl;
    this.log = log;
    this.items = new Map();
  }

  register(entry) {
    this.sweep();
    const id = crypto.randomBytes(16).toString("hex");
    this.items.set(id, { ...entry, expires: Date.now() + TTL });
    return `/media/${id}`;
  }

  sweep() {
    const now = Date.now();
    for (const [id, e] of this.items) if (e.expires < now) this.items.delete(id);
  }

  /** Handles GET/HEAD /media/<id>. Returns false if the id is unknown (caller answers 404). */
  async handle(req, res, id) {
    const e = this.items.get(id);
    if (!e || e.expires < Date.now()) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return true;
    }
    try {
      if (e.kind === "file") await this.serveFile(req, res, e);
      else await this.serveEncrypted(req, res, e);
    } catch (err) {
      this.log("media error", err.message);
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" }).end("media unavailable");
      else res.destroy();
    }
    return true;
  }

  async serveFile(req, res, e) {
    const size = fs.statSync(e.path).size;
    const range = parseRange(req.headers.range, size);
    const head = { "Content-Type": e.mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    if (range && (range.start >= size || range.start > range.end)) {
      res.writeHead(416, { ...head, "Content-Range": `bytes */${size}` }).end();
      return;
    }
    const { start, end } = range || { start: 0, end: size - 1 };
    res.writeHead(range ? 206 : 200, { ...head, "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(e.path, { start, end }).on("error", () => res.destroy()).pipe(res);
  }

  async upstream(e, rangeHeader) {
    let r = await this.fetch(e.url, { headers: rangeHeader ? { Range: rangeHeader } : {} });
    // signed CDN links expire; ask the owner for a fresh one once
    if ((r.status === 403 || r.status === 410 || r.status === 404) && e.refresh) {
      const fresh = await e.refresh();
      e.url = fresh.url;
      e.key = fresh.key;
      r = await this.fetch(e.url, { headers: rangeHeader ? { Range: rangeHeader } : {} });
    }
    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);
    return r;
  }

  async serveEncrypted(req, res, e) {
    const want = parseRange(req.headers.range, e.size ?? null);
    const start = want ? want.start : 0;
    const aligned = start - (start % 16);
    const upRange = want ? `bytes=${aligned}-${want.end ?? ""}` : aligned ? `bytes=${aligned}-` : null;
    const up = await this.upstream(e, upRange);
    // total size from the upstream answer: Content-Range "bytes s-e/total" or Content-Length of a full response
    const cr = /\/(\d+)$/.exec(up.headers.get("content-range") || "");
    const total = cr ? Number(cr[1]) : Number(up.headers.get("content-length")) + aligned;
    if (Number.isFinite(total)) e.size = total;
    const end = want?.end != null ? Math.min(want.end, total - 1) : total - 1;
    if (start >= total) {
      up.body?.cancel?.();
      res.writeHead(416, { "Content-Range": `bytes */${total}` }).end();
      return;
    }
    const head = { "Content-Type": e.mime, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "Content-Length": end - start + 1 };
    if (want) head["Content-Range"] = `bytes ${start}-${end}/${total}`;
    res.writeHead(want ? 206 : 200, head);
    if (req.method === "HEAD") {
      up.body?.cancel?.();
      return res.end();
    }
    const decipher = crypto.createDecipheriv("aes-128-ctr", Buffer.from(e.key, "hex"), ctrIv(aligned));
    const src = Readable.fromWeb(up.body);
    // the player aborts ranges all the time while seeking: tear the upstream down with it
    res.on("close", () => src.destroy());
    src.on("error", () => res.destroy());
    src.pipe(decipher).pipe(skipBytes(start - aligned)).pipe(res);
  }
}

/** Local replacement files: only real audio files, by extension. */
export function audioMime(file) {
  return AUDIO_EXT[path.extname(file).toLowerCase()] || null;
}
