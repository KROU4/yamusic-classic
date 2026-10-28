import { describe, it, expect } from "vitest";
import { parseYaml } from "../server/yaml-lite.js";
import { parseLyricsfile, parseWordTags, attachWords, normLine, finishWords } from "../server/lyrics-words.js";
import { parseLrc, withWords, getLyrics } from "../server/lyrics.js";
import { chunkLines, parseGtx, translateLines, cyrillicShare } from "../server/lyrics-translate.js";

// All lyric text below is made up for the tests.
const LYRICSFILE = `version: '1.0'
metadata:
  title: Paper Lanterns
  artist: Nobody Real
  duration_ms: 200000
  instrumental: false
lines:
  - text: Paper lanterns drift
    start_ms: 1000
    end_ms: 3000
    words:
      - text: "Paper "
        start_ms: 1000
        end_ms: 1400
      - text: 'lanterns '
        start_ms: 1500
      - text: drift
        start_ms: 2200
  - text: Over quiet water
    start_ms: 4000
  - text: ""
    start_ms: 6000
plain: |
  Paper lanterns drift
  Over quiet water
`;

describe("yaml-lite", () => {
  it("reads nested mappings, sequences of mappings and quoted/block scalars", () => {
    const doc = parseYaml(LYRICSFILE);
    expect(doc.version).toBe("1.0");
    expect(doc.metadata).toEqual({ title: "Paper Lanterns", artist: "Nobody Real", duration_ms: 200000, instrumental: false });
    expect(doc.lines).toHaveLength(3);
    expect(doc.lines[0].words.map((w) => w.text)).toEqual(["Paper ", "lanterns ", "drift"]);
    expect(doc.lines[2].text).toBe("");
    expect(doc.plain).toBe("Paper lanterns drift\nOver quiet water\n");
  });
  it("handles flow mappings, escapes, comments and a sequence at its key's indent", () => {
    const doc = parseYaml(`# header\nmetadata: { title: "A \\"b\\"", offset_ms: -250, language: en }\nlines:\n- text: 'it''s'  \n  start_ms: 5 # five\n- [1, 2]\n`);
    expect(doc.metadata).toEqual({ title: 'A "b"', offset_ms: -250, language: "en" });
    expect(doc.lines[0]).toEqual({ text: "it's", start_ms: 5 });
    expect(doc.lines[1]).toEqual([1, 2]);
  });
  it("keeps anchors/aliases as plain text and rejects garbage", () => {
    expect(parseYaml("a: *ref\nb: &x hi")).toEqual({ a: "*ref", b: "&x hi" });
    expect(() => parseYaml("a: 1\n   b: 2\n c")).toThrow();
    expect(() => parseYaml('a: "open')).toThrow();
    expect(parseYaml("__proto__: 1\nx: 2")).toEqual({ x: 2 });
  });
});

describe("Lyricsfile", () => {
  it("turns word timings into seconds with filled-in ends", () => {
    const f = parseLyricsfile(LYRICSFILE);
    expect(f.wordSync).toBe(true);
    expect(f.lines[0]).toEqual({
      t: 1,
      text: "Paper lanterns drift",
      words: [
        { t: 1, end: 1.4, text: "Paper " },
        { t: 1.5, end: 2.2, text: "lanterns " },
        { t: 2.2, end: 3, text: "drift" }, // last word: the line's end_ms
      ],
    });
    // a line without words stays line-level
    expect(f.lines[1]).toEqual({ t: 4, text: "Over quiet water" });
  });
  it("applies offset_ms like LRC [offset:] (positive = earlier) and caps a lonely last word", () => {
    const src = "version: '1.0'\nmetadata:\n  offset_ms: 500\nlines:\n  - text: Far away\n    start_ms: 10000\n    words:\n      - text: 'Far '\n        start_ms: 10000\n      - text: away\n        start_ms: 10600\n  - text: later\n    start_ms: 60000\n";
    const f = parseLyricsfile(src);
    expect(f.lines[0].t).toBe(9.5);
    expect(f.lines[0].words).toEqual([
      { t: 9.5, end: 10.1, text: "Far " },
      { t: 10.1, end: 13.1, text: "away" }, // next line is 50 s away: capped at 3 s
    ]);
  });
  it("returns null for empty, broken or unknown-version files", () => {
    expect(parseLyricsfile(null)).toBe(null);
    expect(parseLyricsfile("")).toBe(null);
    expect(parseLyricsfile("lines: [")).toBe(null);
    expect(parseLyricsfile("version: '2.0'\nlines: []")).toBe(null);
    expect(parseLyricsfile("version: '1.0'\nlines: []")).toEqual({ lines: [], wordSync: false });
  });
  it("repairs overlapping words, words before their line and missing line text", () => {
    const src = "lines:\n  - start_ms: 2000\n    words:\n      - { text: 'Sun ', start_ms: 1800, end_ms: 2600 }\n      - { text: rise, start_ms: 2400, end_ms: 2300 }\n";
    const f = parseLyricsfile(src);
    expect(f.lines[0].text).toBe("Sun rise");
    expect(f.lines[0].t).toBe(1.8);
    expect(f.lines[0].words).toEqual([
      { t: 1.8, end: 2.4, text: "Sun " },
      { t: 2.4, end: 5.4, text: "rise" },
    ]);
  });
});

describe("enhanced LRC word tags", () => {
  it("parses <mm:ss> word tags with a trailing end tag", () => {
    expect(parseWordTags("<00:01.00>Glass <00:01.50>houses<00:02.25>", 1)).toEqual({
      text: "Glass houses",
      words: [
        { t: 1, text: "Glass " },
        { t: 1.5, end: 2.25, text: "houses" },
      ],
    });
    expect(parseWordTags("no tags here", 1)).toBe(null);
  });
  it("parseLrc strips word tags from text and shifts them for repeated stamps", () => {
    const lines = parseLrc("﻿[00:01.00]<00:01.00>Glass <00:01.50>houses<00:02.25>\n[00:03.00][00:10.00]Hum <00:03.50>along\n[00:05.00]plain line");
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [1, "Glass houses"],
      [3, "Hum along"],
      [5, "plain line"],
      [10, "Hum along"],
    ]);
    expect(lines[0].words).toEqual([
      { t: 1, end: 1.5, text: "Glass " },
      { t: 1.5, end: 2.25, text: "houses" },
    ]);
    expect(lines[3].words).toEqual([
      { t: 10, end: 10.5, text: "Hum " },
      { t: 10.5, end: 13.5, text: "along" },
    ]);
    expect(lines[2].words).toBeUndefined();
  });
  it("a tagged line without a line stamp starts at its first word", () => {
    const lines = parseLrc("<00:07.00>Only <00:07.40>words");
    expect(lines[0].t).toBe(7);
    expect(lines[0].text).toBe("Only words");
  });
  it("plain LRC stays exactly as before (no words key)", () => {
    expect(parseLrc("[00:01.50]first\n[00:02.00]second")).toEqual([
      { t: 1.5, text: "first" },
      { t: 2, text: "second" },
    ]);
  });
  it("finishWords drops empty word lists", () => {
    expect(finishWords([{ t: 0, text: "x", words: [] }])).toEqual([{ t: 0, text: "x" }]);
  });
});

describe("attaching LRCLIB words to Yandex lines", () => {
  const words = (t, ...parts) => parts.map((text, k) => ({ t: t + k * 0.5, end: t + k * 0.5 + 0.4, text }));
  const wordLines = [
    { t: 1.2, text: "Ёлки, зелёные!", words: words(1.2, "Ёлки, ", "зелёные!") },
    { t: 4.0, text: "Chorus line", words: words(4.0, "Chorus ", "line") },
    { t: 12.0, text: "Chorus line", words: words(12.0, "Chorus ", "line") },
  ];
  it("normalizes case, ё, punctuation and spacing", () => {
    expect(normLine("Ёлки,  зелёные!")).toBe(normLine("елки зеленые"));
    expect(normLine("Don’t stop")).toBe(normLine("dont STOP"));
  });
  it("matches by text and time, shifting words onto the Yandex line start", () => {
    const yandex = [
      { t: 1, text: "елки зеленые" },
      { t: 4.3, text: "Chorus line" },
      { t: 8, text: "a censored b***" },
      { t: 12.1, text: "Chorus line" },
    ];
    const m = attachWords(yandex, wordLines);
    expect(m.matched).toBe(3);
    expect(m.total).toBe(4);
    expect(m.lines[0].words[0]).toEqual({ t: 1, end: 1.4, text: "Ёлки, " });
    expect(m.lines[1].words[0].t).toBe(4.3);
    expect(m.lines[2].words).toBeUndefined();
    expect(m.lines[3].words[0].t).toBe(12.1);
    expect(yandex[0].words).toBeUndefined(); // input untouched
  });
  it("withWords: same recording -> Yandex lines get words; different wording -> LRCLIB text; other duration -> untouched", () => {
    const yandex = { source: "yandex", synced: true, wordSync: false, lines: [{ t: 1, text: "Paper lanterns drift" }, { t: 4, text: "Over quiet water" }], plain: "" };
    const rec = { duration: 200, hasWordSync: true, lyricsfile: LYRICSFILE, plainLyrics: "x" };
    // both lines agree by text; only the first has words in the file
    const merged = withWords(yandex, rec, 201);
    expect(merged.source).toBe("yandex");
    expect(merged.wordSync).toBe(true);
    expect(merged.lines[0].words).toHaveLength(3);
    expect(merged.lines[1].words).toBeUndefined();
    const other = { ...yandex, lines: [{ t: 1, text: "Completely different words" }, { t: 4, text: "Nothing alike" }] };
    const replaced = withWords(other, rec, 200);
    expect(replaced.source).toBe("lrclib"); // different wording: LRCLIB's own text with its words
    expect(replaced.wordSync).toBe(true);
    const single = { ...yandex, lines: [{ t: 1.1, text: "paper lanterns, drift" }] };
    const m2 = withWords(single, rec, 200);
    expect(m2.source).toBe("yandex");
    expect(m2.wordSource).toBe("lrclib");
    expect(m2.lines[0].words[0].t).toBe(1.1);
    expect(withWords(single, rec, 230)).toBe(single);
    expect(withWords(single, { ...rec, hasWordSync: false }, 200)).toBe(single);
    expect(withWords(single, null, 200)).toBe(single);
  });
});

describe("getLyrics word sync flow", () => {
  const track = { id: "1", title: "T", artists: [{ name: "A" }], album: { title: "Al" }, durationMs: 200000, lyrics: { sync: true, text: true } };
  const api = { lyrics: async () => ({ text: "[00:01.10]Paper lanterns drift" }) };
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  it("borrows LRCLIB words for clean Yandex lines and retries one 503", async () => {
    let calls = 0;
    const fetchImpl = async () => (++calls === 1 ? res(503, {}) : res(200, { duration: 200, hasWordSync: true, lyricsfile: LYRICSFILE, syncedLyrics: "[00:01.00]x" }));
    const out = await getLyrics(api, track, { fetchImpl });
    expect(calls).toBe(2);
    expect(out.source).toBe("yandex");
    expect(out.wordSync).toBe(true);
    expect(out.lines[0].words.map((w) => w.text)).toEqual(["Paper ", "lanterns ", "drift"]);
  });
  it("a slow LRCLIB doesn't hold Yandex lyrics back", async () => {
    const fetchImpl = () => new Promise(() => {});
    const out = await getLyrics(api, track, { fetchImpl, wordBudgetMs: 20 });
    expect(out.source).toBe("yandex");
    expect(out.wordSync).toBe(false);
  });
  it("prefer=yandex never asks LRCLIB when Yandex has lyrics", async () => {
    let calls = 0;
    const out = await getLyrics(api, track, { prefer: "yandex", fetchImpl: async () => (calls++, res(404, {})) });
    expect(calls).toBe(0);
    expect(out.lines).toHaveLength(1);
  });
});

describe("translation", () => {
  it("detects Cyrillic text", () => {
    expect(cyrillicShare("Привет, мир")).toBe(1);
    expect(cyrillicShare("hello")).toBe(0);
    expect(cyrillicShare("123")).toBe(0);
  });
  it("chunks lines under the size limit without splitting a line", () => {
    expect(chunkLines(["aaaa", "bbbb", "cc"], 10)).toEqual([["aaaa", "bbbb"], ["cc"]]);
    expect(chunkLines([], 10)).toEqual([]);
  });
  it("parses the gtx response", () => {
    expect(parseGtx([[["Один\n", "One\n"], ["Два", "Two"]], null, "en"])).toEqual({ text: "Один\nДва", lang: "en" });
    expect(parseGtx(null)).toBe(null);
    expect(parseGtx([[]])).toBe(null);
  });
  it("maps translations back to distinct lines and drops misaligned chunks", async () => {
    const fetchImpl = async (url, init) => {
      const q = new URLSearchParams(init.body).get("q").split("\n");
      return { ok: true, json: async () => [[[q.map((l) => `RU ${l}`).join("\n"), "src"]], null, "en"] };
    };
    const out = await translateLines(["One", " One ", "", "Two"], { fetchImpl });
    expect(out).toEqual({ lang: "en", target: "ru", lines: { One: "RU One", Two: "RU Two" } });
    const bad = await translateLines(["One", "Two"], { fetchImpl: async () => ({ ok: true, json: async () => [[["Только одна строка", "x"]], null, "en"] }) });
    expect(bad.lines).toEqual({});
  });
});

describe("yaml-lite worst cases", () => {
  it("stays linear on hostile multi-row strings and flows", async () => {
    const { parseYaml } = await import("../server/yaml-lite.js");
    const t0 = performance.now();
    for (const src of ['k: "' + "x\n".repeat(60000), "k: [" + "1,\n".repeat(60000), "k: ['" + "a\n".repeat(60000)]) {
      try {
        parseYaml(src);
      } catch {
        // malformed on purpose: only the time matters
      }
    }
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(() => parseYaml("k" + " ".repeat(5000) + "x")).toThrow();
    expect(parseYaml("a: 'it''s'\nb: [\"x\", 'y''z']")).toEqual({ a: "it's", b: ["x", "y'z"] });
  });
});
