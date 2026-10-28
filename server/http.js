// Локальный HTTP-сервер: API для интерфейса + раздача собранного фронтенда.
// Слушает только 127.0.0.1, требует ключ запуска и проверяет Host (защита от DNS rebinding).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ApiError } from "./yandex.js";

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
    ["POST", /^\/api\/like$/, (q, m, b) => svc.setLike(String(b.trackId), !!b.liked)],
    ["POST", /^\/api\/dislike$/, (q, m, b) => svc.setDislike(String(b.trackId), !!b.disliked)],
    ["GET", /^\/api\/wave$/, () => svc.waveMeta()],
    ["POST", /^\/api\/wave\/start$/, (q, m, b) => svc.waveStart(b)],
    ["GET", /^\/api\/wave\/next$/, (q) => svc.waveNext(Number(q.get("count") || 3))],
    ["POST", /^\/api\/wave\/feedback$/, (q, m, b) => svc.waveFeedback(b)],
    ["GET", /^\/api\/prefs$/, () => svc.prefs],
    ["POST", /^\/api\/prefs$/, (q, m, b) => svc.setPrefs(b)],
    ["POST", /^\/api\/history\/clear$/, () => (svc.history.clear(), { ok: true })],
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
    if (url.pathname.startsWith("/api/")) {
      const given = req.headers["x-ymc-key"] || "";
      const ok = given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
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

    // статика собранного фронтенда, SPA-фолбэк на index.html
    if (!staticDir) return send(404, "no static");
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    let file = path.resolve(staticDir, rel || "index.html");
    if (!file.startsWith(path.resolve(staticDir))) return send(400, "bad path");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, "index.html");
    const ext = path.extname(file);
    const cache = ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": cache });
    fs.createReadStream(file).pipe(res);
  });

  return {
    key,
    server,
    listen(port = 0) {
      return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const p = server.address().port;
          allowedHosts = new Set([`127.0.0.1:${p}`, `localhost:${p}`]);
          resolve({ port: p, url: `http://127.0.0.1:${p}/` });
        });
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
