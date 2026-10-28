import { describe, it, expect } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { MediaRegistry, ctrIv, parseRange, audioMime } from "../server/media.js";

const KEY = crypto.randomBytes(16);
const PLAIN = crypto.randomBytes(100_003); // odd size: the last AES block is partial
const ENC = (() => {
  const c = crypto.createCipheriv("aes-128-ctr", KEY, Buffer.alloc(16));
  return Buffer.concat([c.update(PLAIN), c.final()]);
})();

/** Fake CDN: serves ENC with Range support; `expired` makes the first n requests answer 403. */
function cdn({ expired = 0 } = {}) {
  let calls = 0;
  return async (url, init = {}) => {
    calls++;
    if (calls <= expired || url.includes("stale")) return new Response("gone", { status: 403 });
    const m = /^bytes=(\d+)-(\d*)$/.exec(init.headers?.Range || "");
    if (!m) return new Response(ENC, { status: 200, headers: { "content-length": String(ENC.length) } });
    const s = Number(m[1]);
    const e = m[2] ? Math.min(Number(m[2]), ENC.length - 1) : ENC.length - 1;
    return new Response(ENC.subarray(s, e + 1), { status: 206, headers: { "content-range": `bytes ${s}-${e}/${ENC.length}` } });
  };
}

function serve(media) {
  const srv = http.createServer(async (req, res) => {
    const id = req.url.split("/").pop();
    if (!(await media.handle(req, res, id))) res.writeHead(404).end();
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

async function get(srv, link, range) {
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${link}`, { headers: range ? { Range: range } : {} });
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
}

describe("media proxy", () => {
  it("counter block for an offset is the big-endian block index", () => {
    expect(ctrIv(0).equals(Buffer.alloc(16))).toBe(true);
    expect(ctrIv(16 * 258).subarray(14).toString("hex")).toBe("0102");
  });

  it("parses byte ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=10-", null)).toEqual({ start: 10, end: null });
    expect(parseRange("items=1-2", 10)).toBe(null);
    expect(parseRange(undefined, 10)).toBe(null);
  });

  it("decrypts the whole file and arbitrary unaligned ranges", async () => {
    const media = new MediaRegistry({ fetchImpl: cdn() });
    const link = media.register({ kind: "enc", url: "https://cdn/x", key: KEY.toString("hex"), mime: "audio/mp4" });
    const srv = await serve(media);
    try {
      const full = await get(srv, link);
      expect(full.status).toBe(200);
      expect(full.body.equals(PLAIN)).toBe(true);
      for (const [s, e] of [[0, 15], [7, 40], [4095, 9000], [99_990, 100_002]]) {
        const part = await get(srv, link, `bytes=${s}-${e}`);
        expect(part.status).toBe(206);
        expect(part.headers.get("content-range")).toBe(`bytes ${s}-${e}/${PLAIN.length}`);
        expect(part.body.equals(PLAIN.subarray(s, e + 1))).toBe(true);
      }
      const open = await get(srv, link, "bytes=33333-");
      expect(open.body.equals(PLAIN.subarray(33333))).toBe(true);
      expect((await get(srv, link, `bytes=${PLAIN.length + 5}-`)).status).toBe(416);
    } finally {
      srv.close();
    }
  });

  it("refreshes an expired CDN link once", async () => {
    const media = new MediaRegistry({ fetchImpl: cdn() });
    let refreshed = 0;
    const link = media.register({
      kind: "enc",
      url: "https://cdn/stale",
      key: KEY.toString("hex"),
      mime: "audio/flac",
      refresh: async () => (refreshed++, { url: "https://cdn/fresh", key: KEY.toString("hex") }),
    });
    const srv = await serve(media);
    try {
      const r = await get(srv, link, "bytes=100-199");
      expect(r.status).toBe(206);
      expect(r.body.equals(PLAIN.subarray(100, 200))).toBe(true);
      expect(refreshed).toBe(1);
    } finally {
      srv.close();
    }
  });

  it("serves local replacement files with ranges, unknown ids are 404", async () => {
    const file = path.join(os.tmpdir(), `ymc-media-test-${process.pid}.mp3`);
    fs.writeFileSync(file, PLAIN);
    const media = new MediaRegistry({ fetchImpl: cdn() });
    const link = media.register({ kind: "file", path: file, mime: audioMime(file) });
    const srv = await serve(media);
    try {
      const r = await get(srv, link, "bytes=10-19");
      expect(r.status).toBe(206);
      expect(r.headers.get("content-type")).toBe("audio/mpeg");
      expect(r.body.equals(PLAIN.subarray(10, 20))).toBe(true);
      expect((await get(srv, "/media/" + "0".repeat(32))).status).toBe(404);
    } finally {
      srv.close();
      fs.unlinkSync(file);
    }
  });

  it("accepts only audio extensions for replacements", () => {
    expect(audioMime("C:/music/song.FLAC")).toBe("audio/flac");
    expect(audioMime("C:/x/evil.exe")).toBe(null);
  });
});
