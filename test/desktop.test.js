import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { activityFromState } from "../electron/discord.js";
import { renderPng, SHAPES } from "../electron/png.js";

describe("Discord Rich Presence", () => {
  const st = { id: "1", albumId: "2", title: "Song", artist: "Artist", album: "Album", cover: "https://x/400x400", playing: true, durationSec: 200, positionSec: 50 };

  it("собирает «Слушает» с таймером и кнопкой", () => {
    const a = activityFromState(st, 1_000_000);
    expect(a).toMatchObject({ type: 2, details: "Song", state: "Artist", assets: { large_image: "https://x/400x400" } });
    expect(a.timestamps).toEqual({ start: 1_000_000 - 50_000, end: 1_000_000 - 50_000 + 200_000 });
    expect(a.buttons[0].url).toBe("https://music.yandex.ru/album/2/track/1");
  });

  it("на паузе без таймера, без трека — пусто, длинные строки обрезаются", () => {
    expect(activityFromState({ ...st, playing: false }).timestamps).toBeUndefined();
    expect(activityFromState({ playing: false })).toBeNull();
    expect(activityFromState({ ...st, title: "x".repeat(300) }).details).toHaveLength(120);
  });
});

describe("протокол Discord IPC", () => {
  it("собирает кадр READY, пришедший по частям, и шлёт отложенную активность", async () => {
    const { DiscordPresence } = await import("../electron/discord.js");
    const d = new DiscordPresence();
    const sent = [];
    d.sock = { write: (b) => sent.push(b) };
    d.pending = { type: 2, details: "x" };
    const json = Buffer.from(JSON.stringify({ cmd: "DISPATCH", evt: "READY" }));
    const head = Buffer.alloc(8);
    head.writeInt32LE(1, 0);
    head.writeInt32LE(json.length, 4);
    const frame = Buffer.concat([head, json]);
    d.onData(frame.subarray(0, 5));
    expect(d.ready).toBe(false);
    d.onData(frame.subarray(5));
    expect(d.ready).toBe(true);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].subarray(8).toString()).cmd).toBe("SET_ACTIVITY");
  });
});

describe("иконки панели задач", () => {
  it("рисует валидный PNG с прозрачностью", () => {
    const png = renderPng(16, SHAPES.play);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // распаковываем IDAT и проверяем, что есть и прозрачные, и закрашенные пиксели
    const idatStart = png.indexOf("IDAT") + 4;
    const len = png.readUInt32BE(idatStart - 8);
    const raw = zlib.inflateSync(png.subarray(idatStart, idatStart + len));
    const alphas = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) alphas.push(raw[y * 65 + 1 + x * 4 + 3]);
    expect(alphas).toContain(0);
    expect(alphas).toContain(255);
  });
});
