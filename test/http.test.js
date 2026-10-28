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
  it("неизвестный маршрут — 404", async () => {
    const r = await request(port, "/api/nope", { headers: { "x-ymc-key": key } });
    expect(r.status).toBe(404);
  });
});
