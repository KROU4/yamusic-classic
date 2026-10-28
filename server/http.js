// Local HTTP server: API for the UI + serving the built frontend.
// Listens on 127.0.0.1 only, requires a launch key and checks Host (DNS rebinding protection).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ApiError } from "./yandex.js";
import { podcastRoutes } from "./podcasts.js";
import { ynisonRoutes } from "./ynison.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new ApiError("Слишком большой запрос", 413);
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** IANA zone from the request (Europe/Moscow); anything suspicious is dropped, then we use the tz offset. */
function zoneParam(v) {
  return typeof v === "string" && v.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(v) ? v : null;
}

export function buildRoutes(svc) {
  return [
    ["GET", /^\/api\/me$/, () => svc.me()],
    ["POST", /^\/api\/reconnect$/, async () => (await svc.init(), svc.me())],
    ["GET", /^\/api\/home$/, () => svc.home()],
    ["GET", /^\/api\/stations$/, () => svc.stations()],
    ["GET", /^\/api\/chart$/, () => svc.chart()],
    ["GET", /^\/api\/new-releases$/, () => svc.newReleases()],
    ["GET", /^\/api\/search$/, (q) => svc.search(q.get("q") || "", q.get("type") || "all")],
    ["GET", /^\/api\/suggest$/, (q) => svc.suggest(q.get("q") || "")],
    ["GET", /^\/api\/album\/(\d+)$/, (q, m) => svc.album(m[1])],
    ["GET", /^\/api\/artist\/(\d+)$/, (q, m) => svc.artist(m[1])],
    ["GET", /^\/api\/artist\/(\d+)\/tracks$/, (q, m) => svc.artistTracks(m[1], Number(q.get("page") || 0))],
    ["GET", /^\/api\/playlist\/([\w.-]+)\/(\d+)$/, (q, m) => svc.playlist(m[1], m[2])],
    ["GET", /^\/api\/collection$/, () => svc.collection()],
    ["GET", /^\/api\/collection\/likes$/, () => svc.likedTracks()],
    ["GET", /^\/api\/track\/(\d+)\/similar$/, (q, m) => svc.similar(m[1])],
    ["POST", /^\/api\/play\/resolve$/, (q, m, b) => svc.resolvePlay(b.track)],
    ["POST", /^\/api\/played$/, (q, m, b) => svc.played(b)],
    ["POST", /^\/api\/lyrics$/, (q, m, b) => svc.lyrics(b.track)],
    ["POST", /^\/api\/lyrics\/translate$/, (q, m, b) => svc.lyricsTranslate(b)],
    ["POST", /^\/api\/like$/, (q, m, b) => svc.setLike(String(b.trackId), !!b.liked)],
    ["POST", /^\/api\/dislike$/, (q, m, b) => svc.setDislike(String(b.trackId), !!b.disliked)],
    ["GET", /^\/api\/wave$/, () => svc.waveMeta()],
    ["POST", /^\/api\/wave\/start$/, (q, m, b) => svc.waveStart(b)],
    ["GET", /^\/api\/wave\/next$/, (q) => svc.waveNext(Number(q.get("count") || 3))],
    ["POST", /^\/api\/wave\/feedback$/, (q, m, b) => svc.waveFeedback(b)],
    ["GET", /^\/api\/prefs$/, () => svc.prefs],
    ["POST", /^\/api\/prefs$/, (q, m, b) => svc.setPrefs(b)],
    ["POST", /^\/api\/history\/clear$/, () => (svc.history.clear(), { ok: true })],
    ["GET", /^\/api\/stats$/, (q) => svc.stats(Math.min(365, Math.max(1, Number(q.get("days")) || 7)), Math.max(-840, Math.min(840, Number(q.get("tz")) || 0)), zoneParam(q.get("zone")))],
    ["POST", /^\/api\/stats\/clear$/, () => (svc.playlog.clear(), { ok: true })],
    ["GET", /^\/api\/my\/playlists$/, () => svc.myPlaylists()],
    ["POST", /^\/api\/my\/playlists$/, (q, m, b) => svc.createPlaylist(b.title, b.tracks || [])],
    ["POST", /^\/api\/my\/playlists\/(\d+)\/add$/, (q, m, b) => svc.addToPlaylist(m[1], b.tracks || [])],
    ["POST", /^\/api\/my\/playlists\/(\d+)\/remove$/, (q, m, b) => svc.removeFromPlaylist(m[1], b.track, b.index)],
    ["POST", /^\/api\/my\/playlists\/(\d+)\/rename$/, (q, m, b) => svc.renamePlaylist(m[1], b.title)],
    ["POST", /^\/api\/my\/playlists\/(\d+)\/delete$/, (q, m) => svc.deletePlaylist(m[1])],
    ["GET", /^\/api\/vibe\/assets$/, () => svc.vibeAssets()],
    ["GET", /^\/api\/overrides$/, () => svc.listOverrides()],
    ["POST", /^\/api\/overrides$/, (q, m, b) => svc.setOverride(String(b.trackId), b.path)],
    ["POST", /^\/api\/overrides\/remove$/, (q, m, b) => svc.removeOverride(String(b.trackId))],
    ...podcastRoutes(svc),
    // My Wave for two: room ids ride in bodies so they never reach the request log
    ["GET", /^\/api\/rooms$/, () => svc.rooms.list()],
    ["POST", /^\/api\/rooms\/create$/, () => svc.rooms.create()],
    ["POST", /^\/api\/rooms\/get$/, (q, m, b) => svc.rooms.get(b.ref)],
    ["POST", /^\/api\/rooms\/enter$/, (q, m, b) => svc.rooms.enter(b.ref)],
    ["POST", /^\/api\/rooms\/exit$/, (q, m, b) => svc.rooms.exit(b.ref)],
    ...(svc.ynison ? ynisonRoutes(svc.ynison) : []),
  ];
}

export function createServer({ svc, staticDir, key = crypto.randomBytes(24).toString("hex"), log = () => {} }) {
  const routes = buildRoutes(svc);
  let allowedHosts = new Set();

  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "Cache-Control": "no-store", ...headers });
      res.end(body);
    };
    if (!allowedHosts.has(req.headers.host)) return send(421, "Misdirected Request");

    const url = new URL(req.url, "http://local");
    // media links carry their own random id as the capability (<audio> can't send the key header)
    const media = /^\/media\/([0-9a-f]{32})$/.exec(url.pathname);
    if (media && svc.media) {
      if (await svc.media.handle(req, res, media[1])) return;
      return send(404, "not found");
    }
    if (url.pathname.startsWith("/api/")) {
      // compare lengths in bytes: a non-ASCII header gives a different buffer size, and timingSafeEqual would throw
      const given = Buffer.from(String(req.headers["x-ymc-key"] || ""));
      const expected = Buffer.from(key);
      const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (!ok) return send(403, JSON.stringify({ error: "forbidden" }), { "Content-Type": "application/json" });
      const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
      if (!route) return send(404, JSON.stringify({ error: "not found" }), { "Content-Type": "application/json" });
      try {
        const body = req.method === "POST" ? await readJson(req) : {};
        const result = await route[2](url.searchParams, url.pathname.match(route[1]), body);
        return send(200, JSON.stringify(result ?? null), { "Content-Type": "application/json; charset=utf-8" });
      } catch (e) {
        const status = e instanceof ApiError ? e.status || 502 : 500;
        log("api error", req.method, url.pathname, status, e.message);
        return send(status >= 400 ? status : 502, JSON.stringify({ error: e.message }), { "Content-Type": "application/json; charset=utf-8" });
      }
    }

    // static files of the built frontend, SPA fallback to index.html
    if (!staticDir) return send(404, "no static");
    let rel;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    } catch {
      return send(400, "bad path");
    }
    const base = path.resolve(staticDir);
    let file = path.resolve(base, rel || "index.html");
    if (file !== base && !file.startsWith(base + path.sep)) return send(400, "bad path");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, "index.html");
    const ext = path.extname(file);
    const cache = ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
    // a read error (file deleted between the check and open) must not crash the process
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  });

  return {
    key,
    server,
    /** port is the desired port; if it's taken and fallback=true, a random free one is used. */
    listen(port = 0, { fallback = false } = {}) {
      return new Promise((resolve, reject) => {
        const onError = (err) => {
          if (fallback && port !== 0 && err.code === "EADDRINUSE") {
            server.listen(0, "127.0.0.1");
          } else reject(err);
        };
        server.on("error", onError);
        server.once("listening", () => {
          server.off("error", onError);
          const p = server.address().port;
          allowedHosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`]);
          resolve({ port: p, url: `http://127.0.0.1:${p}/` });
        });
        server.listen(port, "127.0.0.1");
      });
    },
    allowHost(host) {
      allowedHosts.add(host);
    },
    close() {
      return new Promise((r) => server.close(r));
    },
  };
}
