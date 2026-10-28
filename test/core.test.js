import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { fileInfoSign, lyricsSign, PLAYER_KEYS } from "../server/sign.js";
import { extractCandidates, resolveSession } from "../server/token.js";
import { curate, baseTitle, isRework, songKey } from "../server/curate.js";
import { parseLrc, isCensoredText } from "../server/lyrics.js";
import { preferOriginal, isExplicitTwin } from "../server/uncensor.js";
import { normTrack, coverUrl } from "../server/normalize.js";
import { settingsSeeds } from "../server/wave.js";

const track = (id, artistId, title, extra = {}) => ({
  id: String(id),
  title,
  version: null,
  artists: [{ id: artistId, name: `artist${artistId}` }],
  available: true,
  durationMs: 180000,
  ...extra,
});

describe("подписи", () => {
  it("file-info: HMAC-SHA256 в base64 без последнего символа", () => {
    const expected = crypto
      .createHmac("sha256", PLAYER_KEYS.win32)
      .update("100123lossless" + "flacmp3" + "raw")
      .digest("base64")
      .slice(0, -1);
    expect(fileInfoSign({ ts: 100, trackId: "123", quality: "lossless", codecs: ["flac", "mp3"], transports: ["raw"] })).toBe(expected);
  });
  it("lyrics: trackId + ts, base64 целиком", () => {
    const expected = crypto.createHmac("sha256", PLAYER_KEYS.win32).update("555" + "100").digest("base64");
    expect(lyricsSign({ trackId: "555", ts: 100 })).toBe(expected);
  });
});

describe("поиск сессии", () => {
  const tok = (c) => `y0_${c.repeat(40)}`;
  it("свежие файлы и последние записи идут первыми, дубликаты убираются", () => {
    const files = [
      { name: "000005.ldb", mtimeMs: 1, content: Buffer.from(`xx${tok("A")}\x00yy`) },
      { name: "000350.log", mtimeMs: 5, content: Buffer.from(`${tok("B")}..${tok("C")}..${tok("A")}`) },
    ];
    expect(extractCandidates(files)).toEqual([tok("A"), tok("C"), tok("B")]);
  });
  it("приклеенные ASCII-байты: пробует и обрезанный до типичной длины вариант", () => {
    const real = `y0_${"Z".repeat(50)}`; // 53 символа
    const out = extractCandidates([{ name: "1.log", mtimeMs: 1, content: Buffer.from(`\x01${real}Ab9\x00`) }]);
    expect(out[0]).toBe(`${real}Ab9`);
    expect(out).toContain(real);
  });
  it("выбирает первый токен, прошедший проверку", async () => {
    const dir = await import("node:fs").then((fs) => fs.mkdtempSync(`${(process.env.TEMP || "/tmp")}/ymc-`));
    const r = await resolveSession({
      env: { YM_TOKEN: "bad" },
      stored: "good",
      dirs: [dir],
      validate: async (t) => (t === "good" ? { account: { uid: 1 } } : null),
    });
    expect(r.source).toBe("stored");
    expect(r.token).toBe("good");
  });
  it("без рабочего токена возвращает null", async () => {
    const r = await resolveSession({ env: {}, dirs: [], validate: async () => null });
    expect(r).toBeNull();
  });
});

describe("курирование волны", () => {
  const now = 1_000_000_000_000;
  it("убирает недавно сыгранное, но пропускает сыгранное давно", () => {
    const history = new Map([
      ["1", now - 1000],
      ["2", now - 40 * 86400000],
    ]);
    const { accepted, rejected } = curate([track(1, 1, "a"), track(2, 2, "b")], { history, now });
    expect(accepted.map((t) => t.id)).toEqual(["2"]);
    expect(rejected[0].reason).toBe("recently-played");
  });
  it("держит дистанцию между треками одного исполнителя", () => {
    const { accepted } = curate([track(1, 7, "a"), track(2, 7, "b"), track(3, 8, "c")], { now, settings: { artistGap: 5 } });
    expect(accepted.map((t) => t.id)).toEqual(["1", "3"]);
  });
  it("считает slowed/sped up/hardtekk-версии одной песней", () => {
    const list = [track(1, 1, "Sometimes"), track(2, 1, "SOMETIMES - HARDTEKK"), track(3, 1, "Sometimes (Slowed + Reverb)")];
    const { accepted, rejected } = curate(list, { now, settings: { artistGap: 0 } });
    expect(accepted).toHaveLength(1);
    expect(rejected.every((r) => r.reason === "same-song")).toBe(true);
  });
  it("ограничивает долю лайкнутых", () => {
    const liked = new Set(["1", "2", "3"]);
    const list = [track(1, 1, "a"), track(2, 2, "b"), track(3, 3, "c"), track(4, 4, "d")];
    expect(curate(list, { now, liked, settings: { likedEvery: 0 } }).accepted.map((t) => t.id)).toEqual(["4"]);
    expect(curate(list, { now, liked, settings: { likedEvery: 8 } }).accepted.map((t) => t.id)).toEqual(["1", "4"]);
  });
  it("дизлайкнутые и недоступные не проходят, доступный оригинал спасает подменённый трек", () => {
    const sub = track(9, 9, "orig");
    const list = [track(1, 1, "a", { available: false }), track(2, 2, "b", { available: false, substituted: sub }), track(3, 3, "c")];
    const { accepted } = curate(list, { now, disliked: new Set(["3"]) });
    expect(accepted.map((t) => t.id)).toEqual(["2"]);
  });
  it("фильтр переделок отличает «Slow Dancing» от «(slowed)»", () => {
    expect(isRework(track(1, 1, "Slow Dancing in the Dark"))).toBe(false);
    expect(isRework(track(1, 1, "Song (Slowed)"))).toBe(true);
    expect(isRework(track(1, 1, "Song", { version: "Radio Edit" }))).toBe(true);
    expect(isRework(track(1, 1, "MONTAGEM XONADA (Super Slowed)"))).toBe(true);
    expect(isRework(track(1, 1, "Mix Tape"))).toBe(false);
  });
  it("baseTitle нормализует пометки", () => {
    expect(baseTitle("Too Much (hardtekk)")).toBe("too much");
    expect(baseTitle("Decode - Sped Up")).toBe("decode");
    expect(baseTitle("Song (feat. X)")).toBe("song feat x");
    expect(songKey(track(1, 1, "A (Slowed)"))).toBe(songKey(track(2, 1, "A")));
  });
});

describe("тексты", () => {
  it("разбирает LRC, включая несколько меток на строке", () => {
    const lines = parseLrc("[ar:x]\n[00:01.50]first\n[00:03.00][00:10.25]chorus\n[00:05.123]third");
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [1.5, "first"],
      [3, "chorus"],
      [5.123, "third"],
      [10.25, "chorus"],
    ]);
  });
  it("распознаёт следы цензуры", () => {
    expect(isCensoredText("какой-то б*** текст")).toBe(true);
    expect(isCensoredText("*** ***")).toBe(true);
    expect(isCensoredText("обычный текст с 5*2 = 10")).toBe(false);
  });
});

describe("без цензуры", () => {
  it("играет доступный оригинал вместо подмены", () => {
    const orig = track(2, 1, "x");
    const t = track(1, 1, "x", { substituted: orig });
    expect(preferOriginal(t).id).toBe("2");
    expect(preferOriginal(t).replacedFrom).toBe("1");
    expect(preferOriginal(track(1, 1, "x", { substituted: { ...orig, available: false } })).id).toBe("1");
  });
  it("explicit-близнец: тот же артист, то же название, близкая длительность", () => {
    const clean = track(1, 5, "Song", { clean: true });
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: true }))).toBe(true);
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: false }))).toBe(false);
    expect(isExplicitTwin(clean, track(2, 6, "Song", { explicit: true }))).toBe(false);
    expect(isExplicitTwin(clean, track(2, 5, "Song", { explicit: true, durationMs: 240000 }))).toBe(false);
  });
});

describe("нормализация", () => {
  it("строит URL обложки и вытаскивает подмену", () => {
    expect(coverUrl("avatars.yandex.net/get-music-content/1/a/%%", 200)).toBe("https://avatars.yandex.net/get-music-content/1/a/200x200");
    const t = normTrack({
      id: 1,
      title: "t",
      artists: [{ id: 2, name: "a" }],
      albums: [{ id: 3, title: "al" }],
      contentWarning: "explicit",
      substituted: { id: 4, title: "orig", artists: [], albums: [], available: true },
    });
    expect(t).toMatchObject({ id: "1", albumId: "3", explicit: true, substituted: { id: "4" } });
  });
  it("сиды настроек волны", () => {
    expect(settingsSeeds({ diversity: "discover", moodEnergy: "all", language: "russian" })).toEqual(["settingDiversity:discover", "settingLanguage:russian"]);
    expect(settingsSeeds({})).toEqual([]);
  });
});
