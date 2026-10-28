import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createServer } from "../server/http.js";

// Сервис-заглушка: проверяем только транспорт и защиту
const svc = {
  me: () => ({ authorized: true, login: "test" }),
  prefs: { theme: "dark" },
  setPrefs: (b) => b,
};

function request(port, path, { headers = {}, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("локальный HTTP-сервер", () => {
  let srv;
  let port;
  const key = "a".repeat(48);
  beforeAll(async () => {
    srv = createServer({ svc, staticDir: null, key });
    ({ port } = await srv.listen(0));
  });
  afterAll(() => srv.close());

  it("без ключа запуска — 403", async () => {
    const r = await request(port, "/api/me");
    expect(r.status).toBe(403);
  });
  it("с неверным ключом — 403", async () => {
    const r = await request(port, "/api/me", { headers: { "x-ymc-key": "b".repeat(48) } });
    expect(r.status).toBe(403);
  });
  it("не-ASCII ключ той же длины в символах — 403, сервер не падает", async () => {
    const r = await request(port, "/api/me", { headers: { "x-ymc-key": "é".repeat(48) } });
    expect(r.status).toBe(403);
    const again = await request(port, "/api/me", { headers: { "x-ymc-key": key } });
    expect(again.status).toBe(200);
  });
  it("с ключом — отвечает", async () => {
    const r = await request(port, "/api/me", { headers: { "x-ymc-key": key } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).login).toBe("test");
  });
  it("чужой Host (DNS rebinding) — 421", async () => {
    const r = await request(port, "/api/me", { headers: { "x-ymc-key": key, host: "evil.example:80" } });
    expect(r.status).toBe(421);
  });
  it("POST с JSON", async () => {
    const r = await request(port, "/api/prefs", {
      method: "POST",
      headers: { "x-ymc-key": key, "content-type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    expect(JSON.parse(r.body)).toEqual({ theme: "light" });
  });
  it("статика: битый %-escape и выход из каталога не роняют сервер", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ymc-static-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<p>ok</p>");
    const s2 = createServer({ svc, staticDir: dir, key });
    const { port: p2 } = await s2.listen(0);
    try {
      expect((await request(p2, "/%E0")).status).toBe(400);
      expect((await request(p2, "/..%2f..%2fetc")).status).toBe(400);
      expect((await request(p2, "/")).body).toContain("ok");
    } finally {
      await s2.close();
    }
  });
  it("занятый желаемый порт — откат на свободный", async () => {
    const s2 = createServer({ svc, staticDir: null, key });
    const { port: p2 } = await s2.listen(port, { fallback: true });
    try {
      expect(p2).not.toBe(port);
      expect((await request(p2, "/api/me", { headers: { "x-ymc-key": key } })).status).toBe(200);
    } finally {
      await s2.close();
    }
  });
  it("неизвестный маршрут — 404", async () => {
    const r = await request(port, "/api/nope", { headers: { "x-ymc-key": key } });
    expect(r.status).toBe(404);
  });
});
